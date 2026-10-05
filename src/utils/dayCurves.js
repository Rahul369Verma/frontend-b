/**
 * dayCurves — one intraday P&L curve per IST trading day, built from round
 * trips of EITHER book (single-leg trade_history rows or multileg structures).
 *
 * PURE: no React, no I/O, no clock, no browser-local timezone. Every calendar
 * date here is an IST date (UTC+05:30, no DST) computed from epoch ms by fixed
 * offset arithmetic, never from getHours()/getDate() or toLocaleString.
 *
 * ── THE MATH ────────────────────────────────────────────────────────────────
 * value_i(t), what trade i is worth at instant t:
 *   t <  entry        → 0
 *   entry ≤ t < exit  → the LAST path mark with ms ≤ t (0 before the first
 *                       mark, and 0 throughout when the trade has no path)
 *   t ≥ exit          → bookedNet (the booked result, costs included)
 *
 * Day D's window is [D 09:15 IST, D 15:40 IST], widened to take in every event
 * dated D (an entry, an exit, or a path mark inside a trade's life). Trade i's
 * CONTRIBUTION to D at t is value_i(t) − baseline_i,D, where the baseline is
 * 0 for a trade opened inside D's window and, for a position carried in, the
 * value it held just BEFORE D's window opened (the last mark strictly before
 * startMs). So a carried position contributes only what it made or lost ON D,
 * and its overnight gap lands at D's first mark — not at the open, and not
 * smeared across the day.
 *
 * Why the windows are widened by path marks and not just by entries/exits:
 * a mark falling between one day's window and the next would belong to
 * neither, and its move would vanish from both days. With every mark inside
 * some window, the per-day contributions of a trade telescope exactly:
 *   Σ_D contribution_i,D = value_i(end of exit day) − 0 = bookedNet_i.
 * That is the INVARIANT the tests pin: the day totals of fully-covered trades
 * add up to their booked P&L to the paisa.
 *
 * A trade without a path is honest about it: flat at 0 while open, then one
 * step to bookedNet at its exit. A trade WITH a path also steps at its exit —
 * from the last mark to the booked number — and that step is costs + slippage
 * (single-leg marks are pre-cost gross MTM; multileg marks carry estimated
 * costs; neither is the fill that was actually booked).
 *
 * ── WHAT IS LEFT OUT, AND COUNTED ───────────────────────────────────────────
 * Nothing is dropped silently. A trade is excluded from the curves, and counted
 * in `excluded`, when it is still open (noExit), has no finite booked result
 * (noBooked — this includes quarantined multileg fills, whose booked number is
 * known to be fiction), or has an unreadable/impossible time (invalidTime —
 * also where an unreadable row lands). Path marks with a null/absent net are
 * recorder gaps: they are SKIPPED, never read as ₹0.
 *
 * ── PERFORMANCE ─────────────────────────────────────────────────────────────
 * Each trade is visited only on the days it belongs to (binary search into the
 * ordered, disjoint day windows), and on each such day only over the sample
 * points while it is open, with a forward-only pointer into its sorted marks.
 * A closed trade's post-exit constant is a single difference-array write.
 * Cost ≈ Σ(points while open) + Σ(marks), not days × trades × points.
 */

const MIN_MS = 60000;
const DAY_MS = 86400000;
/** IST is a fixed UTC+05:30 — India has no daylight saving. */
const IST_OFFSET_MS = 330 * MIN_MS;
const SESSION_OPEN_MS = (9 * 60 + 15) * MIN_MS;
const SESSION_CLOSE_MS = (15 * 60 + 40) * MIN_MS;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PATH_SOURCES = new Set(['recorded', 'archive']);

// ISO date-time WITH a zone (Z or ±hh:mm) — unambiguous, Date.parse is exact.
const ISO_ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
// ISO date-time WITHOUT a zone. Date.parse would read it in the BROWSER's zone;
// a trading timestamp with no zone is an Indian-market time, so it is read as IST.
const ISO_BARE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A finite number, or null. ABSENT IS NOT ZERO: null / undefined / '' / NaN /
 * non-numeric strings are all null — never Number(null) === 0.
 */
function finite(v) {
    if (isNum(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * An instant in epoch ms. Returns null when the value is ABSENT (null,
 * undefined, '') and NaN when it is present but unreadable — the distinction
 * is what lets an open trade (no exit) be told apart from a corrupt one.
 */
export function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v instanceof Date) {
        const ms = v.getTime();
        return Number.isFinite(ms) ? ms : NaN;
    }
    if (typeof v === 'string') {
        const s = v.trim();
        if (ISO_ZONED.test(s)) {
            const ms = Date.parse(s);
            return Number.isFinite(ms) ? ms : NaN;
        }
        const m = ISO_BARE.exec(s);
        if (m) {
            const ms = Date.parse(`${m[1]}T${m[2]}+05:30`);
            return Number.isFinite(ms) ? ms : NaN;
        }
        return NaN; // a date-only string or a free-form date is not an instant
    }
    return NaN;
}

/** IST day number: whole days since 1970-01-01 IST. */
const istDayNum = (ms) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
/** 'YYYY-MM-DD' of an IST day number (n·DAY_MS is that date's UTC midnight). */
const dayNumStr = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** The IST calendar date 'YYYY-MM-DD' of an instant, or null. */
export function istDayOf(ms) {
    return isNum(ms) ? dayNumStr(istDayNum(ms)) : null;
}

/**
 * Epoch ms of IST midnight on the IST date containing `ms`, or null. A date
 * range cut at a rolling instant ("now − 7 days" = 12:00 IST a week ago) drops
 * that day's morning trades while its afternoon ones still draw what looks like
 * a complete day; cutting at IST midnight keeps every day whole.
 */
export function istDayStartMs(ms) {
    return isNum(ms) ? istDayNum(ms) * DAY_MS - IST_OFFSET_MS : null;
}

/**
 * Why a single-leg trade_history row is NOT a round trip that belongs on a P&L
 * curve, or null when it is one. Both kinds are CLOSED with pnl 0, and drawing
 * them adds a fake ₹0 "trade" to a day, so callers count them instead:
 *   'entryFailed'     — the order never filled (_failEntryTradeDoc: rejected,
 *                       halted, a PAPER fair-entry that expired). No position.
 *   'recoveryUnknown' — recovery found the position gone at the broker and could
 *                       not learn its exit, so it wrote a placeholder flat close
 *                       (no gross_pnl / net_pnl). The real result is unknown.
 * A recovery close that DID reconcile a real fill carries gross_pnl and stays.
 */
export function singleLegVoidReason(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.entry_failed === true) return 'entryFailed';
    if (t.recovery_closed === true && finite(t.net_pnl) == null && finite(t.gross_pnl) == null) return 'recoveryUnknown';
    return null;
}

/**
 * A day-curve trade still open at the day's close with no marks that day: what
 * it made or lost ON this day is unknown (its whole result lands on its exit
 * day). Its `contribution` is a placeholder, never a ₹0 to be summed.
 */
export const unknownOnDay = (t) => !!t && t.carriedOut === true && !t.marked;

/**
 * Every trade on the day is unknownOnDay → the day has NO total, not ₹0. One
 * rule, shared by the day rows and by anything that correlates day totals
 * (utils/vixOverlay.js), so the two can never disagree about which days count.
 */
export function dayIsUnknown(day) {
    const trades = Array.isArray(day?.trades) ? day.trades : [];
    return trades.length > 0 && trades.every(unknownOnDay);
}

/**
 * A day whose total is KNOWN but not the day's own P&L, or null:
 *   missing — trades unknownOnDay: their move on this day is not in the total
 *   spanning — trades carried in from a day on which they were unmarked
 *              (`spansEarlierDays`): the move shown here includes that day's
 * Either way the total is not "what this day made", so anything that pairs a
 * day total with something else measured over that one day (utils/vixOverlay.js)
 * must count the day out, not use it. A day that is wholly unknown is
 * dayIsUnknown's, not this.
 */
export function dayPnlPartial(day) {
    if (dayIsUnknown(day)) return null;
    const trades = Array.isArray(day?.trades) ? day.trades : [];
    let missing = 0, spanning = 0;
    for (const t of trades) {
        if (unknownOnDay(t)) missing++;
        else if (t && t.spansEarlierDays === true) spanning++;
    }
    return missing || spanning ? { missing, spanning } : null;
}

/** 'YYYY-MM-DD' (an IST date) → 'Mon'..'Sun'. Read from the string, no zone. */
export function istWeekday(day) {
    const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(ms) ? WEEKDAYS[new Date(ms).getUTCDay()] : null;
}

/** Rupees to the paisa; `+ 0` folds -0 into 0 so a flat day never prints "-₹0". */
const round2 = (x) => Math.round(x * 100) / 100 + 0;

/** First index i with arr[i] >= x (arr ascending). */
function lowerBound(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
}

/** First index i with arr[i] > x (arr ascending). */
function upperBound(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] <= x) lo = mid + 1; else hi = mid;
    }
    return lo;
}

/** A recorded/reconstructed path → [{ ms, net }] sorted, or null if no usable mark. */
function normPath(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object') continue;
        const ms = toMs(p.t ?? p.ms);
        const net = finite(p.net);
        // A null net is a recorder gap, not a ₹0 mark — skip it.
        if (!isNum(ms) || net == null) continue;
        out.push({ ms, net });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.ms - b.ms);
    return out;
}

function pathSourceOf(declared, path) {
    if (!path) return null;
    return PATH_SOURCES.has(declared) ? declared : 'recorded';
}

function pathReasonOf(t, path) {
    if (path) return null;
    if (typeof t.pathReason === 'string' && t.pathReason.trim()) return t.pathReason.trim();
    if (Array.isArray(t.path) && t.path.length) return 'path had no usable marks';
    return null;
}

const shortSym = (s) => String(s || '').trim().replace(/^[A-Z]+:/i, '').replace(/-INDEX$/i, '');

function idOf(t, fallback) {
    const raw = t._id ?? t.id;
    if (raw != null && raw !== '') return String(raw);
    return fallback;
}

/**
 * A trade_history row (GET /api/trades) → NormTrade.
 *
 *  - `side` is the OPTION TYPE ('CALL'|'PUT'), not long/short: every single-leg
 *    trade is an option BUY, and a missing `direction` means long.
 *  - Open vs closed is read from `status`, never from `action` (which stays
 *    'ENTRY' after the close). A CLOSED row without a readable exitTime is an
 *    invalid time, not an open trade.
 *  - bookedNet = net_pnl ?? pnl (gross_pnl as a last resort — it equals pnl);
 *    `bookedBasis` says which one was used so the fallbacks can be counted.
 *  - entryPrice/exitPrice are decision prices and are deliberately NOT used.
 *
 * Returns null only for input that is not an object at all.
 */
export function normalizeSingleLegTrade(t) {
    if (!t || typeof t !== 'object') return null;
    const entryMs = toMs(t.entryTime);
    const status = typeof t.status === 'string' && t.status.trim() ? t.status.trim().toUpperCase() : null;
    let exitMs;
    if (status === 'CLOSED') {
        const x = toMs(t.exitTime);
        exitMs = x == null ? NaN : x;
    } else if (status) {
        exitMs = null; // OPEN / ACTIVE / PENDING… — still on the book
    } else {
        exitMs = toMs(t.exitTime);
    }

    const net = finite(t.net_pnl);
    const pnl = finite(t.pnl);
    const gross = finite(t.gross_pnl);
    const bookedNet = net ?? pnl ?? gross;
    const bookedBasis = net != null ? 'net' : (pnl != null || gross != null) ? 'gross' : null;

    const contract = shortSym(t.tradingsymbol || t.symbol || t.spotSymbol) || 'trade';
    const side = t.side === 'CALL' || t.side === 'PUT'
        ? t.side
        : t.type === 'CE' ? 'CALL' : t.type === 'PE' ? 'PUT' : null;
    const short = finite(t.direction) === -1;
    const sideLabel = side ? `${short ? 'short ' : ''}${side}` : (short ? 'short' : null);
    const label = sideLabel ? `${contract} · ${sideLabel}` : contract;

    const path = normPath(t.path);
    return {
        id: idOf(t, `${contract}-${t.entryTime ?? '?'}`),
        label,
        entryMs,
        exitMs,
        bookedNet,
        path,
        pathSource: pathSourceOf(t.pathSource, path),
        pathReason: pathReasonOf(t, path),
        bookedBasis,
    };
}

/**
 * A multileg_trades row (GET /api/multileg/trades) → NormTrade.
 *
 *  - bookedNet = netPnl. A QUARANTINED trade (booked on a price that never
 *    traded) has no trustworthy booked number, so bookedNet is null and it is
 *    counted under excluded.noBooked — kept visible, kept out of the curve.
 *  - Path marks carry estimated costs; the exit step to netPnl is the rest.
 *
 * Returns null only for input that is not an object at all.
 */
export function normalizeMultilegTrade(t) {
    if (!t || typeof t !== 'object') return null;
    const entryMs = toMs(t.entryAt);
    const exitMs = toMs(t.exitAt);
    const quarantined = t.quarantined === true;
    const bookedNet = quarantined ? null : finite(t.netPnl);
    const sym = shortSym(t.symbol);
    const what = (typeof t.template === 'string' && t.template.trim())
        || (typeof t.name === 'string' && t.name.trim())
        || 'structure';
    const label = sym ? `${what} · ${sym}` : what;
    const path = normPath(t.path);
    return {
        id: idOf(t, t.tradeKey ? String(t.tradeKey) : `${t.deploymentId ?? '?'}-${t.entryAt ?? '?'}`),
        label,
        entryMs,
        exitMs,
        bookedNet,
        path,
        pathSource: pathSourceOf(t.pathSource, path),
        pathReason: pathReasonOf(t, path),
        bookedBasis: bookedNet != null ? 'net' : null,
        quarantined,
    };
}

/**
 * NormTrade[] → { days (newest first), excluded, bookedBasis }.
 * See the module comment for the math and the invariant.
 */
export function buildDayCurves(normTrades, { stepMin = 1 } = {}) {
    const stepMs = (isNum(stepMin) && stepMin > 0 ? stepMin : 1) * MIN_MS;
    const excluded = { noExit: 0, noBooked: 0, invalidTime: 0 };
    const bookedBasis = { net: 0, grossFallback: 0 };
    const list = Array.isArray(normTrades) ? normTrades : [];

    // ── 1. validate; keep only marks inside each trade's own life ───────────
    const trades = [];
    for (const nt of list) {
        if (!nt || typeof nt !== 'object') { excluded.invalidTime++; continue; }
        const { entryMs, exitMs } = nt;
        if (!isNum(entryMs) || (exitMs != null && !isNum(exitMs)) || (isNum(exitMs) && exitMs < entryMs)) {
            excluded.invalidTime++;
            continue;
        }
        if (exitMs == null) { excluded.noExit++; continue; }
        if (!isNum(nt.bookedNet)) { excluded.noBooked++; continue; }
        if (nt.bookedBasis === 'gross') bookedBasis.grossFallback++; else bookedBasis.net++;

        let markMs = [], markNet = [];
        if (Array.isArray(nt.path)) {
            let sorted = true;
            for (const p of nt.path) {
                if (!p || !isNum(p.ms) || !isNum(p.net) || p.ms < entryMs || p.ms > exitMs) continue;
                if (markMs.length && p.ms < markMs[markMs.length - 1]) sorted = false;
                markMs.push(p.ms);
                markNet.push(p.net);
            }
            if (!sorted) {
                const order = markMs.map((_, i) => i).sort((a, b) => markMs[a] - markMs[b] || a - b);
                markNet = order.map((i) => markNet[i]);
                markMs = order.map((i) => markMs[i]);
            }
        }
        trades.push({ nt, entryMs, exitMs, booked: nt.bookedNet, markMs, markNet });
    }

    // ── 2. the IST days that have any event, and their event span ───────────
    const span = new Map(); // day number → { n, lo, hi }
    const touch = (ms) => {
        const n = istDayNum(ms);
        const d = span.get(n);
        if (!d) span.set(n, { n, lo: ms, hi: ms });
        else {
            if (ms < d.lo) d.lo = ms;
            if (ms > d.hi) d.hi = ms;
        }
    };
    for (const tr of trades) {
        touch(tr.entryMs);
        touch(tr.exitMs);
        // Marks are sorted: widen each day once with its first and last mark.
        const M = tr.markMs;
        let i = 0;
        while (i < M.length) {
            const n = istDayNum(M[i]);
            let j = i;
            while (j + 1 < M.length && istDayNum(M[j + 1]) === n) j++;
            touch(M[i]);
            touch(M[j]);
            i = j + 1;
        }
    }

    const days = [...span.values()].sort((a, b) => a.n - b.n).map((d) => {
        const midnight = d.n * DAY_MS - IST_OFFSET_MS;
        const open = midnight + SESSION_OPEN_MS;
        return {
            n: d.n,
            open,
            startMs: Math.min(open, d.lo),
            endMs: Math.max(midnight + SESSION_CLOSE_MS, d.hi),
            members: [],
        };
    });
    const dayEnds = days.map((d) => d.endMs);

    // ── 3. membership: open at any point in the window, or exited in it ─────
    for (const tr of trades) {
        for (let i = lowerBound(dayEnds, tr.entryMs); i < days.length && days[i].startMs <= tr.exitMs; i++) {
            days[i].members.push(tr);
        }
    }

    // ── 4. one curve per day ────────────────────────────────────────────────
    // Days run oldest first, so this holds, per trade, whether it was unknown
    // on the last day it was a member of. Carried in from such a day, its
    // baseline is a mark from before THAT day (or 0), and its move here takes
    // in the earlier day's too: the telescoping sum still holds, but this day's
    // total is no longer this day's P&L.
    const unknownOnLastDay = new Map();
    const out = [];
    for (const D of days) {
        const { startMs, endMs, open, members } = D;
        const times = [startMs];
        const k0 = Math.ceil((startMs - open) / stepMs);
        const k1 = Math.floor((endMs - open) / stepMs);
        for (let k = k0; k <= k1; k++) times.push(open + k * stepMs);
        times.push(endMs);

        const markers = [];
        for (const tr of members) {
            if (tr.entryMs >= startMs) {
                times.push(tr.entryMs);
                markers.push({ ms: tr.entryMs, kind: 'entry', id: tr.nt.id, label: tr.nt.label });
            }
            if (tr.exitMs <= endMs) {
                times.push(tr.exitMs);
                markers.push({ ms: tr.exitMs, kind: 'exit', id: tr.nt.id, label: tr.nt.label });
            }
        }
        times.sort((a, b) => a - b);
        let w = 0;
        for (let r = 0; r < times.length; r++) if (r === 0 || times[r] !== times[w - 1]) times[w++] = times[r];
        times.length = w;
        const n = times.length;

        const acc = new Float64Array(n);
        const diff = new Float64Array(n + 1);
        const dayTrades = [];
        let marked = 0;

        for (const tr of members) {
            const M = tr.markMs, V = tr.markNet;
            const carriedIn = tr.entryMs < startMs;
            const carriedOut = tr.exitMs > endMs;
            // Baseline: 0 for a trade opened today; for a carried position,
            // what it was worth just before today's window opened.
            let base = 0;
            if (carriedIn) {
                const b = lowerBound(M, startMs) - 1;
                base = b >= 0 ? V[b] : 0;
            }
            const iOpen = carriedIn ? 0 : lowerBound(times, tr.entryMs);
            const iExit = carriedOut ? n : lowerBound(times, tr.exitMs);

            // While open: last mark at or before each sample (forward-only walk).
            let p = iOpen < iExit ? upperBound(M, times[iOpen]) - 1 : -1;
            let last = p >= 0 ? V[p] : 0;
            for (let j = iOpen; j < iExit; j++) {
                const t = times[j];
                while (p + 1 < M.length && M[p + 1] <= t) p++;
                last = p >= 0 ? V[p] : 0;
                acc[j] += last - base;
            }
            // From the exit on: the booked number, as one range write.
            if (iExit < n) diff[iExit] += tr.booked - base;

            const contribution = carriedOut ? last - base : tr.booked - base;
            const lo = Math.max(tr.entryMs, startMs), hi = Math.min(tr.exitMs, endMs);
            const firstIn = lowerBound(M, lo);
            const isMarked = firstIn < M.length && M[firstIn] <= hi;
            if (isMarked) marked++;
            const spansEarlierDays = carriedIn && unknownOnLastDay.get(tr) === true;
            unknownOnLastDay.set(tr, carriedOut && !isMarked);

            dayTrades.push({
                id: tr.nt.id,
                label: tr.nt.label,
                entryMs: tr.entryMs,
                exitMs: tr.exitMs,
                contribution: round2(contribution),
                carriedIn,
                carriedOut,
                spansEarlierDays,
                marked: isMarked,
                pathSource: tr.nt.pathSource ?? null,
                pathReason: tr.nt.pathReason ?? null,
            });
        }

        const points = new Array(n);
        let run = 0;
        for (let j = 0; j < n; j++) {
            run += diff[j];
            points[j] = { ms: times[j], pnl: round2(acc[j] + run) };
        }

        dayTrades.sort((a, b) => a.entryMs - b.entryMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        markers.sort((a, b) => a.ms - b.ms || (a.kind === b.kind ? 0 : a.kind === 'entry' ? -1 : 1));

        out.push({
            day: dayNumStr(D.n),
            startMs,
            endMs,
            total: n ? points[n - 1].pnl : 0,
            points,
            trades: dayTrades,
            markers,
            coverage: { trades: members.length, marked, bookedOnly: members.length - marked },
        });
    }

    out.reverse(); // newest first
    return { days: out, excluded, bookedBasis };
}
