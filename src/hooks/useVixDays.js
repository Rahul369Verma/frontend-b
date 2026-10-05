'use strict';
/**
 * useVixDays — India VIX for a list of IST trading days, from
 * GET /api/market/vix-days (see utils/vixOverlay.js for what the two VIX
 * numbers mean).
 *
 *   const vix = useVixDays(dayKeys, { expanded, enabled, fetcher });
 *   vix.byDay[day]      → { day, prevClose, close, change, changePct, provisional, reason }
 *   vix.intraByDay[day] → { state: 'loading'|'ready'|'error', intraday, reason, error, settled }  (expanded days only)
 *   vix.loading / vix.error / vix.errorDays / vix.warnings / vix.reload()
 *   vix.source          → { daily: 'fyers'|'none'|'partial'|null, intraday }
 *   vix.sourceDays      → { fyers, none }: listed days with / without any VIX value
 *   vix.retryableDays   → listed days still missing a value the server may yet give
 *
 * REQUEST SHAPE. One request carries the daily summary of every listed day
 * (chunked at the server's 400-day and 1100-calendar-day caps); the 1-minute
 * path is fetched lazily, only for days the reader has opened, at most 5 per
 * request (the server's cap — 375 bars a day). A day asked for its path is not
 * also asked for its summary: the server returns the summary with every
 * intraday day.
 *
 * ONE CACHE PER FETCHER, AT MODULE SCOPE. StrategyDetail and MultiLeg both
 * mount DayEquityCurves; switching between them must not refetch a year of VIX.
 * Keying the cache on the fetcher function means the real one is shared app-wide
 * while a test's injected fetcher always starts empty.
 *
 * WHAT IS KEPT FOR GOOD. The server decides finality with the kernel's rule
 * (backend/src/domain/market/vixDays.js `final`) and keeps everything else 60 s.
 * The contract does not carry that flag, so the rule is mirrored here: a day is
 * SETTLED only when it is BEFORE today (IST) and complete — a close, a previous
 * close and a change — or a weekend the server explains with exactly
 * "no session (weekend/holiday)" and a previous close. Not settled:
 *  - today, all day. After 15:30 `provisional` drops, but the official close can
 *    still differ from the running print (29-Sep: 13.41 vs last bar 13.34).
 *  - a close with no previous close. getHistory returns [] for a failed 100-day
 *    chunk without throwing, so a hole upstream looks exactly like this, and
 *    the next answer may fill it.
 *  - a weekday "no session (weekend/holiday) or no data": the server itself
 *    says it may be missing data.
 * A settled answer is never replaced by an unsettled one (a later reply made
 * while the broker session is down must not blank a known Fyers close).
 *
 * UNSETTLED ANSWERS ARE ASKED AGAIN ON A TIMER while the hook is enabled:
 * every 60 s while today's session runs (the line is still moving), otherwise
 * backing off 1 → 2 → 4 → 8 → 16 min for an answer that keeps coming back
 * incomplete (a holiday, or a broker session that has not come back yet).
 * reload() asks now; it also drops settled weekend answers, whose previous
 * close is the one thing here that only asking again can correct.
 *
 * Errors (HTTP failures) are stored per day and surfaced (vix.error), never
 * swallowed; a failed day is not retried by the timer — only on the next change
 * of inputs or reload().
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api.js';
import { istDayOf, istWeekday } from '../utils/dayCurves.js';

/** Server caps (the contract rejects more with a 400). */
export const VIX_DAYS_PER_REQUEST = 400;
export const VIX_INTRADAY_PER_REQUEST = 5;
/** The server's span cap (vixDays.js MAX_SPAN_DAYS): one request's first and
 *  last dates may be at most this many calendar days apart. */
export const VIX_MAX_SPAN_DAYS = 1100;
/** How long an unsettled answer is trusted before it is asked again: the base,
 *  and the cap the back-off doubles up to. */
const RETRY_AFTER_MS = 60e3;
const RETRY_MAX_MS = 16 * 60e3;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_SESSION = 'no session (weekend/holiday)';
const WEEKEND = new Set(['Sat', 'Sun']);

/** The real fetcher: resolves to the response BODY. Throws on any HTTP error. */
export async function fetchVixDays({ days = [], intraday = [] } = {}) {
    const params = {};
    if (days.length) params.days = days.join(',');
    if (intraday.length) params.intraday = intraday.join(',');
    const res = await axios.get(`${API_URL}/market/vix-days`, { params });
    return res.data;
}

const dayNum = (d) => Date.parse(`${d}T00:00:00Z`) / 86400e3;
/** Sorted days → requests under BOTH server caps: count and calendar span. */
export function chunkDays(sorted, maxCount, maxSpanDays = VIX_MAX_SPAN_DAYS) {
    const out = [];
    let cur = [];
    for (const d of sorted) {
        if (cur.length && (cur.length >= maxCount || dayNum(d) - dayNum(cur[0]) > maxSpanDays)) { out.push(cur); cur = []; }
        cur.push(d);
    }
    if (cur.length) out.push(cur);
    return out;
}

// ABSENT IS NOT ZERO: anything that is not a finite number is null.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normSummary(day, raw) {
    if (!raw || typeof raw !== 'object') {
        return { day, prevClose: null, close: null, change: null, changePct: null, provisional: false,
            reason: 'the server returned nothing for this date' };
    }
    return {
        day,
        prevClose: num(raw.prevClose),
        close: num(raw.close),
        change: num(raw.change),
        changePct: num(raw.changePct),
        provisional: raw.provisional === true,
        reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : null,
    };
}

/** Bar closes only; first/last/high/low are re-derived from the points drawn, so they cannot disagree with the line. */
function normIntraday(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.points)) return null;
    const points = raw.points
        .filter((p) => p && num(p.ms) != null && num(p.v) != null)
        .map((p) => ({ ms: p.ms, v: p.v }))
        .sort((a, b) => a.ms - b.ms);
    if (!points.length) return null;
    let high = -Infinity, low = Infinity;
    for (const p of points) { if (p.v > high) high = p.v; if (p.v < low) low = p.v; }
    return { points, high, low, first: points[0], last: points[points.length - 1], bars: num(raw.bars) ?? points.length };
}

const complete = (s) => s.close != null && s.prevClose != null && s.change != null;
/** The server's settled non-session day: a Saturday/Sunday, one reason, nothing in a hole. */
const settledWeekend = (s) => s.close == null && s.reason === NO_SESSION && WEEKEND.has(istWeekday(s.day));
/** See WHAT IS KEPT FOR GOOD. `today` is the IST date now. */
const summarySettled = (s, today) => !s.provisional && s.day < today
    && (complete(s) || (s.prevClose != null && settledWeekend(s)));
const intradaySettled = (s, intraday, today) => !s.provisional && s.day < today && (intraday != null || settledWeekend(s));

/** 60 s while today's session runs; otherwise doubling per unsettled answer, capped. */
const retryAfter = (e) => (e.settled ? Infinity
    : e.provisional ? RETRY_AFTER_MS
        : Math.min(RETRY_AFTER_MS * 2 ** Math.max(0, e.tries - 1), RETRY_MAX_MS));

function errorMessage(err) {
    const body = err?.response?.data;
    if (body && typeof body.error === 'string' && body.error) return body.error;
    if (err?.response?.status) return `HTTP ${err.response.status}`;
    return err?.message || String(err);
}

/** A per-day in-flight COUNT: a day can be in a summary request and an intraday request at once. */
function counter() {
    const m = new Map();
    return {
        add: (d) => m.set(d, (m.get(d) || 0) + 1),
        done: (d) => { const n = (m.get(d) || 0) - 1; if (n > 0) m.set(d, n); else m.delete(d); },
        has: (d) => m.has(d),
    };
}

function createStore(fetcher) {
    const daily = new Map();        // day → { value, at, settled, provisional, tries }
    const intra = new Map();        // day → { value: { intraday, reason }, at, settled, provisional, tries }
    const busy = { daily: counter(), intra: counter() };
    const errors = { daily: new Map(), intra: new Map() };
    let meta = { intraSource: null, warnings: [] };
    let version = 0;
    const subs = new Set();
    const bump = () => { version++; for (const fn of subs) fn(); };
    const fresh = (map, d, now) => {
        const e = map.get(d);
        return !!e && now - e.at < retryAfter(e);
    };
    /** Store an answer, never downgrading a settled one; count consecutive unsettled answers for the back-off. */
    const put = (map, d, value, at, settled, provisional) => {
        const prev = map.get(d);
        if (prev?.settled && !settled) return;
        const tries = settled || provisional ? 0 : (prev && !prev.settled ? prev.tries : 0) + 1;
        map.set(d, { value, at, settled, provisional, tries });
    };

    function request(dDays, iDays, batch) {
        // An intraday request also answers the summary, but it only counts as
        // loading / failing the SUMMARY for a day that has none yet — opening a
        // day must not blank the across-days figures while its path loads.
        const iNeedsDaily = iDays.filter((d) => !daily.has(d));
        for (const d of dDays) { busy.daily.add(d); errors.daily.delete(d); }
        for (const d of iNeedsDaily) { busy.daily.add(d); errors.daily.delete(d); }
        for (const d of iDays) { busy.intra.add(d); errors.intra.delete(d); }
        return Promise.resolve()
            .then(() => fetcher({ days: dDays, intraday: iDays }))
            .then((body) => {
                if (!body || typeof body !== 'object' || !body.days || typeof body.days !== 'object') {
                    throw new Error('unexpected reply from /api/market/vix-days (no "days" map)');
                }
                const at = Date.now();
                const today = istDayOf(at);
                for (const d of [...dDays, ...iDays]) {
                    const s = normSummary(d, body.days[d]);
                    put(daily, d, s, at, summarySettled(s, today), s.provisional);
                }
                for (const d of iDays) {
                    // THIS reply's reason, not the kept summary's: a settled close
                    // kept above says nothing about why the path is missing now.
                    const s = normSummary(d, body.days[d]);
                    const intraday = normIntraday(body.days[d]?.intraday);
                    const reason = intraday ? null : (s.reason || 'no 1-minute VIX bars were returned for this day');
                    put(intra, d, { intraday, reason }, at, intradaySettled(s, intraday, today), s.provisional);
                }
                const src = body.source && typeof body.source === 'object' ? body.source : {};
                for (const w of Array.isArray(body.warnings) ? body.warnings : []) {
                    if (typeof w === 'string' && w && !batch.warnings.includes(w)) batch.warnings.push(w);
                }
                meta = {
                    // A summary-only reply says intraday 'not requested'; that must not
                    // overwrite what an earlier intraday reply said.
                    intraSource: iDays.length && typeof src.intraday === 'string' ? src.intraday : meta.intraSource,
                    warnings: batch.warnings.slice(),
                };
            })
            .catch((err) => {
                const msg = errorMessage(err);
                for (const d of [...dDays, ...iNeedsDaily]) errors.daily.set(d, msg);
                for (const d of iDays) errors.intra.set(d, msg);
            })
            .finally(() => {
                for (const d of [...dDays, ...iNeedsDaily]) busy.daily.done(d);
                for (const d of iDays) busy.intra.done(d);
                bump();
            });
    }

    return {
        subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
        getVersion: () => version,

        /**
         * Ask for whatever of `days` / `expanded` is not settled, fresh, or already
         * in flight. `auto` (the retry timer) also skips days whose last request
         * FAILED: those wait for a change of inputs or reload().
         */
        load(days, expanded, { auto = false } = {}) {
            const now = Date.now();
            const failed = (errs, d) => auto && errs.has(d);
            const needI = expanded.filter((d) => !fresh(intra, d, now) && !busy.intra.has(d) && !failed(errors.intra, d));
            const asIntra = new Set(needI);
            const needD = days.filter((d) => !asIntra.has(d) && !fresh(daily, d, now) && !busy.daily.has(d) && !failed(errors.daily, d));
            if (!needD.length && !needI.length) return;
            // Warnings describe the requests just made; a new batch replaces the last one's.
            const batch = { warnings: [] };
            for (const c of chunkDays(needD, VIX_DAYS_PER_REQUEST)) request(c, [], batch);
            for (const c of chunkDays(needI, VIX_INTRADAY_PER_REQUEST)) request([], c, batch);
            bump();
        },

        /** ms until the earliest unsettled answer for these days is due again (Infinity: none). */
        nextDue(days, expanded, now) {
            let due = Infinity;
            const scan = (map, busyC, errs, list) => {
                for (const d of list) {
                    const e = map.get(d);
                    if (!e || e.settled || busyC.has(d) || errs.has(d)) continue;
                    due = Math.min(due, e.at + retryAfter(e) - now);
                }
            };
            scan(daily, busy.daily, errors.daily, days);
            scan(intra, busy.intra, errors.intra, expanded);
            return due;
        },

        /** Forget errors, unsettled answers and settled weekends for these days, so the next load asks again. */
        forget(days) {
            for (const d of days) {
                errors.daily.delete(d); errors.intra.delete(d);
                const e = daily.get(d);
                if (e && (!e.settled || !complete(e.value))) daily.delete(d);
                const i = intra.get(d);
                if (i && (!i.settled || !i.value.intraday)) intra.delete(d);
            }
        },

        read(days, expanded) {
            const byDay = {};
            let loading = false, fyers = 0, none = 0, retryableDays = 0;
            const errs = new Map();         // message → day count
            for (const d of days) {
                const e = daily.get(d);
                if (e) {
                    byDay[d] = e.value;
                    // Per day, not the last reply's word: one reply made while the
                    // broker is down must not relabel a page of Fyers closes.
                    if (e.value.close != null || e.value.prevClose != null) fyers++; else none++;
                    if (!e.settled && !e.provisional && !complete(e.value)) retryableDays++;
                }
                const er = errors.daily.get(d);
                if (er) errs.set(er, (errs.get(er) || 0) + 1);
                // Not yet asked (the effect runs after this render) counts as loading:
                // otherwise the first paint would report every day as "no VIX".
                if (busy.daily.has(d) || (!e && !er)) loading = true;
            }
            const intraByDay = {};
            for (const d of expanded) {
                const e = intra.get(d);
                const er = errors.intra.get(d) || null;
                const state = busy.intra.has(d) ? 'loading' : er ? 'error' : e ? 'ready' : 'loading';
                intraByDay[d] = {
                    state, intraday: e?.value.intraday ?? null, reason: e?.value.reason ?? null, error: er, settled: !!e?.settled,
                };
            }
            const [first] = errs.keys();
            let errorDays = 0;
            for (const n of errs.values()) errorDays += n;
            return {
                byDay, intraByDay, loading,
                error: first ?? null, errorDays,
                warnings: meta.warnings,
                source: fyers + none ? { daily: fyers && none ? 'partial' : fyers ? 'fyers' : 'none', intraday: meta.intraSource } : null,
                sourceDays: { fyers, none },
                retryableDays,
            };
        },
    };
}

let STORES = new WeakMap();
function storeFor(fetcher) {
    let s = STORES.get(fetcher);
    if (!s) { s = createStore(fetcher); STORES.set(fetcher, s); }
    return s;
}

/** Drop every cached answer (all fetchers). For tests and a manual "refresh everything". */
export function clearVixDaysCache() { STORES = new WeakMap(); }

/** Distinct valid 'YYYY-MM-DD' keys, sorted — a stable identity for effect deps. */
function keyList(keys) {
    if (!keys) return '';
    const set = new Set();
    for (const k of keys) if (typeof k === 'string' && DAY_RE.test(k)) set.add(k);
    return [...set].sort().join(',');
}
const split = (s) => (s ? s.split(',') : []);

const OFF = Object.freeze({
    byDay: Object.freeze({}), intraByDay: Object.freeze({}), loading: false,
    error: null, errorDays: 0, warnings: Object.freeze([]), source: null,
    sourceDays: Object.freeze({ fyers: 0, none: 0 }), retryableDays: 0,
});

export default function useVixDays(dayKeys, { expanded, enabled = false, fetcher = fetchVixDays } = {}) {
    const store = storeFor(fetcher);
    const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
    const [nonce, setNonce] = useState(0);
    const [tick, setTick] = useState(0);
    const daysKey = useMemo(() => keyList(dayKeys), [dayKeys]);
    const expKey = useMemo(() => keyList(expanded), [expanded]);

    useEffect(() => {
        if (!enabled) return;
        store.load(split(daysKey), split(expKey));
    }, [enabled, store, daysKey, expKey, nonce]);

    // The retry timer: re-armed on every store change, so it always waits for
    // the earliest unsettled answer; a request in flight is not counted (its
    // reply re-arms it). `tick` re-arms it when a firing asked for nothing.
    useEffect(() => {
        if (!enabled) return undefined;
        const wait = store.nextDue(split(daysKey), split(expKey), Date.now());
        if (!Number.isFinite(wait)) return undefined;
        const id = setTimeout(() => {
            store.load(split(daysKey), split(expKey), { auto: true });
            setTick((t) => t + 1);
        }, Math.max(wait, 1000));
        return () => clearTimeout(id);
    }, [enabled, store, daysKey, expKey, version, tick]);

    const reload = useCallback(() => {
        store.forget([...split(daysKey), ...split(expKey)]);
        setNonce((n) => n + 1);
    }, [store, daysKey, expKey]);

    const state = useMemo(
        () => (enabled ? store.read(split(daysKey), split(expKey), version) : OFF),
        [enabled, store, daysKey, expKey, version],
    );
    return useMemo(() => ({ ...state, reload }), [state, reload]);
}
