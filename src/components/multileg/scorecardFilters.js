/**
 * The Strategies card's filters and sorts (user, 23-Oct-2026: "filter them based on multiple
 * filters/sort like consistency … and more features which can be good to deploy for live").
 *
 * Every figure comes from GET /api/multileg/scorecard (backend logic/analytics/multilegScorecard.js);
 * this only decides which rows to show and in what order. A row that lacks the figure a minimum
 * asks for is hidden (it cannot be shown to meet it) — and every hidden row is counted on the card.
 */

export const DEFAULT_FILTERS = Object.freeze({
    verdicts: [],          // empty = every verdict
    readiness: 'all',      // 'all' | 'ready' | 'not-ready' | 'live'
    minTrades: '', minConsistency: '', minWinRate: '', minPf: '', minPerTrade: '', minRom: '', minT: '',
    maxDrawdown: '',       // ₹, as a positive number: the worst drawdown may be at most this deep
    maxCostPct: '',
    profitable: false, hideFading: false, activeOnly: false,
});

/** Strategies worth a closer look for real money — the quality checks' own thresholds, plus a sample. */
export const LIVE_CANDIDATES = Object.freeze({
    ...DEFAULT_FILTERS, minTrades: 20, minConsistency: 50, minPf: 1.5, maxCostPct: 50, profitable: true, hideFading: true,
});

/** The number inputs: key, label, the row's figure, and whether the bound is a minimum. */
export const NUMBER_FILTERS = [
    { k: 'minTrades', label: 'Min trades', get: (r) => r.trades, min: true, step: 1 },
    { k: 'minConsistency', label: 'Min consistency (0–100)', get: (r) => r.consistency?.score, min: true, step: 5 },
    { k: 'minWinRate', label: 'Min win %', get: (r) => r.winRate, min: true, step: 5 },
    { k: 'minPf', label: 'Min profit factor', get: (r) => r.profitFactor, min: true, step: 0.1 },
    { k: 'minPerTrade', label: 'Min per trade ₹', get: (r) => r.perTrade, min: true, step: 100 },
    { k: 'minRom', label: 'Min return ÷ margin %/trade', get: (r) => r.romPct, min: true, step: 0.05 },
    { k: 'minT', label: 'Min t (edge ÷ noise)', get: (r) => r.tStat, min: true, step: 0.5 },
    { k: 'maxDrawdown', label: 'Max drawdown ₹', get: (r) => (r.trades ? Math.abs(r.maxDrawdown || 0) : null), min: false, step: 500 },
    { k: 'maxCostPct', label: 'Max charges ÷ gross %', get: (r) => r.costPct, min: false, step: 5 },
];

const bound = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const has = (v) => v != null && Number.isFinite(Number(v));

/** Does a row pass every filter that is set? */
export function passes(r, f = DEFAULT_FILTERS) {
    if (f.verdicts?.length && !f.verdicts.includes(r.verdict)) return false;
    if (f.readiness && f.readiness !== 'all' && r.readiness?.status !== f.readiness) return false;
    for (const nf of NUMBER_FILTERS) {
        const b = bound(f[nf.k]);
        if (b == null) continue;
        const v = nf.get(r);
        if (!has(v)) return false;
        if (nf.min ? Number(v) < b : Number(v) > b) return false;
    }
    if (f.profitable && !(r.net > 0)) return false;
    if (f.hideFading && r.flags?.includes('fading')) return false;
    if (f.activeOnly && r.status !== 'ACTIVE') return false;
    return true;
}

/** How many filters are set (the badge on the Filters button). */
export function activeFilterCount(f = DEFAULT_FILTERS) {
    let n = (f.verdicts?.length ? 1 : 0) + (f.readiness && f.readiness !== 'all' ? 1 : 0);
    for (const nf of NUMBER_FILTERS) if (bound(f[nf.k]) != null) n++;
    return n + ['profitable', 'hideFading', 'activeOnly'].filter((k) => f[k]).length;
}

/** A remembered value of an older shape still opens: unknown keys dropped, missing ones defaulted. */
export function normaliseFilters(v) {
    const out = { ...DEFAULT_FILTERS };
    if (!v || typeof v !== 'object') return out;
    for (const k of Object.keys(DEFAULT_FILTERS)) if (v[k] !== undefined) out[k] = v[k];
    if (!Array.isArray(out.verdicts)) out.verdicts = [];
    return out;
}

const READY_RANK = { live: 3, ready: 2, 'not-ready': 1 };
/** Sort keys. Missing values always sink, whichever way the sort runs. */
export const SORTS = [
    { k: 'net', label: 'Net', get: (r) => r.net },
    { k: 'ready', label: 'Live check', get: (r) => (r.readiness ? READY_RANK[r.readiness.status] * 100 + r.readiness.passed : null) },
    { k: 'consistency', label: 'Consistency', get: (r) => r.consistency?.score ?? null },
    { k: 'perTrade', label: 'Per trade', get: (r) => r.perTrade },
    { k: 'romPct', label: 'Return ÷ margin', get: (r) => r.romPct ?? null },
    { k: 'profitFactor', label: 'Profit factor', get: (r) => r.profitFactor ?? null },
    { k: 'tStat', label: 't (edge ÷ noise)', get: (r) => r.tStat ?? null },
    { k: 'gap', label: 'vs backtest', get: (r) => (r.trades && r.gapPerTrade != null ? Number(r.gapPerTrade) : null) },
    { k: 'trades', label: 'Trades', get: (r) => r.trades },
    { k: 'winRate', label: 'Win%', get: (r) => r.winRate },
    { k: 'maxDrawdown', label: 'Max drawdown', get: (r) => r.maxDrawdown },
    { k: 'worstTrade', label: 'Worst trade', get: (r) => r.worstTrade ?? null },
    { k: 'recovery', label: 'Net ÷ drawdown', get: (r) => r.recovery ?? null },
    { k: 'costPct', label: 'Costs ÷ gross', get: (r) => r.costPct },
    { k: 'open', label: 'Open MTM', get: (r) => (r.open ? r.open.mtmNet : null) },
];

export function sortRows(rows, { k, dir }) {
    const spec = SORTS.find((x) => x.k === k) || SORTS[0];
    const sign = dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
        const x = spec.get(a), y = spec.get(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x - y) * sign;
    });
}
