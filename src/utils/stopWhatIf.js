'use strict';
/**
 * stopWhatIf — "what would a stop at −₹X have done to these trades?", for any X,
 * and a suggested X that is checked on trades it was NOT chosen on.
 *
 * Same arithmetic as the backend table (backend/logic/analytics/excursions.js,
 * stopIf): every trade whose worst mark reached −X exits at exactly −X instead of
 * its result. Optimistic — marks are about a minute apart and a stop fills worse
 * than its level — so treat the figures as an upper bound.
 *
 * The suggestion is chosen on the OLDER 70% of trades and then measured on the
 * NEWEST 30%, the hold-out the rest of the platform uses: the best level in hindsight
 * on all trades always looks good, so only a level that also helped on trades it
 * never saw is offered as a suggestion.
 */

/** points: [[mae, mfe, net, label, day, id], …] from the analytics → rows. */
export function rowsOf(points) {
    return (points || []).map((p) => ({ mae: Number(p[0]), mfe: Number(p[1]), net: Number(p[2]), label: p[3] ?? null, day: p[4] ?? null, id: p[5] ?? null }))
        .filter((r) => Number.isFinite(r.mae) && Number.isFinite(r.net));
}

/** The effect of a stop at −level on these rows. */
export function stopEffect(rows, level) {
    const T = Number(level);
    if (!(T > 0)) return { level: null, hit: 0, netChange: 0, recovered: 0, n: rows.length };
    const hit = rows.filter((r) => r.mae <= -T);
    return {
        level: T,
        n: rows.length,
        hit: hit.length,
        netChange: Math.round(hit.reduce((a, r) => a + (-T - r.net), 0)),
        // stopped out, though they would have finished in profit — what the stop costs
        recovered: hit.filter((r) => r.net > 0).length,
    };
}

/** The worst single result once a stop at −level is in place (a hit trade books exactly −level). */
export function worstAfter(rows, level) {
    const T = Number(level);
    let w = null;
    for (const r of rows) {
        const v = T > 0 && r.mae <= -T ? -T : r.net;
        if (w == null || v < w) w = v;
    }
    return w == null ? null : Math.round(w);
}

/**
 * The stop with the LOWEST LOSS on these trades (user, 23-Oct-2026: "it does not tell the
 * minimum-loss stop-loss"): of every level just past a trade's worst point, the one whose
 * total result is best. HINDSIGHT — chosen on the same trades it is scored on; suggestStop
 * is the version checked on trades it never saw. `level: null` = no stop does best.
 * Ties go to the LOOSER level (fewer trades stopped for the same result).
 */
export function lowestLossStop(rows) {
    const total = Math.round(rows.reduce((a, r) => a + r.net, 0));
    let best = { level: null, netChange: 0, hit: 0, recovered: 0, n: rows.length };
    for (const T of candidates(rows)) {
        const e = stopEffect(rows, T);
        if (e.netChange > best.netChange || (e.netChange === best.netChange && best.level != null && T > best.level)) best = e;
    }
    return { ...best, total, netAfter: total + best.netChange, worstAfter: worstAfter(rows, best.level), worstWithout: worstAfter(rows, null) };
}

/** A readable sweep: round levels, plus any `extra` ones (the lowest-loss, the suggestion), each with its result. */
export function stopTable(rows, extra = []) {
    const total = Math.round(rows.reduce((a, r) => a + r.net, 0));
    const deepest = rows.reduce((m, r) => Math.min(m, r.mae), 0);
    const grid = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000].filter((x) => x <= -deepest + 50);
    const levels = [...new Set([...grid, ...extra.filter((x) => Number(x) > 0).map(Number)])].sort((a, b) => a - b);
    return levels.map((T) => {
        const e = stopEffect(rows, T);
        return { level: T, hit: e.hit, recovered: e.recovered, netChange: e.netChange, netAfter: total + e.netChange, worst: worstAfter(rows, T) };
    });
}

/** Older → newer (by exit day; undated trades keep their order, which is newest-last from the server). */
export function splitByTime(rows, testShare = 0.3) {
    const dated = rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.day && b.r.day ? a.r.day.localeCompare(b.r.day) : 0) || a.i - b.i).map((x) => x.r);
    const cut = Math.round(dated.length * (1 - testShare));
    return { older: dated.slice(0, cut), newer: dated.slice(cut) };
}

/**
 * Candidate levels: one ₹50 step BEYOND each trade's worst point. The effect only
 * changes at those points and falls in between (a deeper stop books every hit trade
 * at a bigger loss), so the best level always sits just past some trade's worst
 * point — never AT it, which would also stop out the trade that dipped exactly that
 * far and recovered.
 */
function candidates(rows) {
    const s = new Set();
    for (const r of rows) if (r.mae < 0) s.add(Math.floor(-r.mae / 50) * 50 + 50);
    return [...s].sort((a, b) => a - b);
}

/**
 * @returns {{ok:true, level, older, newer, all} | {ok:false, reason, older?, newer?}}
 *   older/newer/all are stopEffect()s at the suggested level.
 */
export function suggestStop(rows, { testShare = 0.3, minTrades = 20 } = {}) {
    if (rows.length < minTrades) return { ok: false, reason: `only ${rows.length} trades with a recorded worst point — too few to suggest a stop` };
    const { older, newer } = splitByTime(rows, testShare);
    const minHits = Math.max(5, Math.ceil(older.length * 0.03));
    let best = null;
    for (const T of candidates(older)) {
        const e = stopEffect(older, T);
        if (e.hit < minHits) continue;
        if (!best || e.netChange > best.netChange) best = e;
    }
    if (!best || best.netChange <= 0) return { ok: false, reason: 'no stop level would have added to net on these trades — the losses mostly recovered or were already small' };
    const onNewer = stopEffect(newer, best.level);
    const all = stopEffect(rows, best.level);
    if (onNewer.netChange <= 0) {
        return { ok: false, reason: `the best level on the older trades (₹${best.level.toLocaleString('en-IN')}) did not help on the newest ${newer.length} — it would have changed their net by ₹${onNewer.netChange.toLocaleString('en-IN')}`, level: best.level, older: best, newer: onNewer, all };
    }
    return { ok: true, level: best.level, older: best, newer: onNewer, all };
}
