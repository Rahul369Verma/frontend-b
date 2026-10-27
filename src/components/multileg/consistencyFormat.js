/**
 * Words and ordering for ConsistencyView.jsx — is an Auto-optimize result consistent across
 * markets and months? (backend src/domain/regime/trend.js consistencyVerdict; tiers:
 * 0 consistent · 1 partly tested · 2 not consistent).
 */
import { inr } from '../viz/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '');

/**
 * A row's verdict: measured during the run (row.consistency), else by a later "Check consistency"
 * (result.consistencyCheck[kind][i]), else null (a run from before the check, not yet checked).
 */
export function verdictFor(result, kind, i) {
    const row = result && result[kind] ? result[kind][i] : null;
    if (row && row.consistency) return row.consistency;
    const c = result && result.consistencyCheck && result.consistencyCheck[kind] ? result.consistencyCheck[kind][i] : null;
    return c && c.consistency ? c.consistency : null;
}

export const TIER = {
    0: { text: '✓ Consistent', cls: 'text-success border-emerald-800/50 bg-emerald-950/20' },
    1: { text: '◐ Partly tested', cls: 'text-warning border-amber-800/50 bg-amber-950/20' },
    2: { text: '✗ Not consistent', cls: 'text-danger border-red-800/50 bg-red-950/20' },
};

const signedRs = (v) => inr(v, { dp: 0, sign: true });

/** "rising +₹1,27,099 (35)" for each market, in a fixed order. */
export function marketParts(v) {
    if (!v || !v.markets) return [];
    return ['rising', 'falling', 'sideways'].map((k) => {
        const m = v.markets[k] || { n: 0, net: 0 };
        return { key: k, arrow: k === 'rising' ? '↑' : k === 'falling' ? '↓' : '→', n: m.n, net: m.net, text: `${k} ${m.n ? signedRs(m.net) : '—'} (${m.n})` };
    });
}

/** "best month Mar 2026 = 122% of the profit · profitable months 4 of 8" */
export function monthText(v) {
    if (!v) return '';
    const parts = [];
    if (v.bestMonth && v.bestMonthShare != null) parts.push(`best month ${monthLabel(v.bestMonth.month)} = ${Math.round(100 * v.bestMonthShare)}% of the profit`);
    if (v.months && v.months.active) parts.push(`profitable months ${v.months.profitable} of ${v.months.active}`);
    return parts.join(' · ');
}

/** "MIDCPNIFTY: 50 rising · 33 falling · 74 sideways days" */
export function mixText(symbol, m) {
    const sym = String(symbol).replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '');
    const x = (m && m.mix) || {};
    return `${sym}: ${x.rising || 0} rising · ${x.falling || 0} falling · ${x.sideways || 0} sideways days`;
}

/**
 * The rows to show, in order, for the chosen view, and what was left out (counted, never silent).
 *   'ranked'      as the optimizer ranked them
 *   'consistent'  consistent first, then partly tested, then the rest, then not measured
 *   'only'        consistent ones only
 */
export function orderRows(rows = [], verdictAt, view = 'ranked') {
    const all = rows.map((row, i) => ({ row, i, v: verdictAt(i) }));
    const tierOf = (x) => (x.v ? x.v.tier : 3);
    if (view === 'ranked') return { shown: all, hidden: 0, hiddenWhy: null };
    const sorted = all.slice().sort((a, b) => tierOf(a) - tierOf(b) || a.i - b.i);
    if (view === 'consistent') return { shown: sorted, hidden: 0, hiddenWhy: null };
    const shown = sorted.filter((x) => tierOf(x) === 0);
    const left = all.length - shown.length;
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const x of all) if (tierOf(x) !== 0) counts[tierOf(x)]++;
    const why = [counts[2] && `${counts[2]} not consistent`, counts[1] && `${counts[1]} partly tested`, counts[3] && `${counts[3]} not measured`].filter(Boolean).join(', ');
    return { shown, hidden: left, hiddenWhy: why || null };
}
