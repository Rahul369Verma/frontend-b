/**
 * Words and numbers for TargetReplay.jsx — the profit-target grid (backend
 * logic/multileg/tradeWhatIf.js targetGrid / targetWhatIf). A target is one of three kinds:
 *   tp_pct_credit      % of the credit a credit structure took in
 *   tp_pct_max_profit  % of a debit structure's max profit
 *   tp_x_debit         × the debit paid
 */

/** Grid axis label: "20%", "1.5×", "off". */
export function tpLabel(key, v) {
    if (!(Number(v) > 0)) return 'off';
    return key === 'tp_x_debit' ? `${v}×` : `${v}%`;
}

/** In a sentence: "20% of the credit", "1.5× the debit", "no target". */
export function tpWords(key, v) {
    if (!(Number(v) > 0)) return 'no target';
    if (key === 'tp_x_debit') return `${v}× the debit`;
    return `${v}% of the ${key === 'tp_pct_max_profit' ? 'max profit' : 'credit'}`;
}

/** A trade's best point in the target's unit: "8.7% of the credit", "0.6× the debit". */
export function bestText(key, v) {
    if (v == null) return '—';
    if (key === 'tp_x_debit') return `${v}× the debit`;
    return `${v}% of the ${key === 'tp_pct_max_profit' ? 'max profit' : 'credit'}`;
}

/**
 * How far the trades got toward a target: the median and the highest best point (in the
 * target's unit), and how many reached the current target. Any target at or below a trade's
 * best point would have fired on it.
 */
export function reachSummary(perTrade = []) {
    const vals = perTrade.map((t) => t.bestInTargetUnit).filter((v) => v != null).sort((a, b) => a - b);
    const n = vals.length;
    const median = n ? Math.round(10 * (n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2)) / 10 : null;
    const top = n ? vals[n - 1] : null;
    const topTrade = top == null ? null : perTrade.find((t) => t.bestInTargetUnit === top);
    const ms = topTrade ? Date.parse(topTrade.entryAt) : NaN;
    // the IST day (yyyy-mm-dd) the highest one was entered
    const topDay = Number.isFinite(ms) ? new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10) : null;
    return { n, median, top, topDay, hit: perTrade.filter((t) => t.hit).length };
}
