'use strict';
/**
 * Pure helpers for the Multi-Leg Compare tab (CompareDeployments.jsx). The numbers come from
 * GET /api/multileg/compare (backend logic/analytics/multilegCompare.js — the Results tab's own
 * scorecard rows); these only pick, rank and shape them for tables and charts.
 */
import { inr } from '../../viz/tokens.js';

const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const rup = (v) => (fin(v) == null ? '—' : inr(v, { dp: 0 }));
const signedRup = (v) => (fin(v) == null ? '—' : inr(v, { dp: 0, sign: true }));
const pct = (v, dp = 0) => (fin(v) == null ? '—' : `${Number(v).toFixed(dp)}%`);
export function holdText(min) {
    const m = fin(min);
    if (m == null) return '—';
    if (m < 60) return `${Math.round(m)}m`;
    if (m < 24 * 60) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
    return `${(m / 1440).toFixed(1)}d`;
}

/**
 * Every row of the results table. `better`: which way wins ('high' | 'low'); null = not ranked
 * (a count, a date). `get` reads one deployment of the compare response.
 */
export const METRICS = Object.freeze([
    { group: 'Returns', key: 'net', label: 'Net P&L', better: 'high', get: (d) => fin(d.results?.net), fmt: signedRup, help: 'After charges, every closed structure in the window' },
    { group: 'Returns', key: 'perTrade', label: 'Per trade', better: 'high', get: (d) => fin(d.results?.perTrade), fmt: signedRup, help: 'Net ÷ trades' },
    { group: 'Returns', key: 'gap', label: 'vs backtest, per trade', better: 'high', get: (d) => fin(d.results?.gapPerTrade), fmt: signedRup, help: 'Live per trade minus the saved backtest\'s (its out-of-sample figure where there is one). — = no stored backtest' },
    { group: 'Returns', key: 'rom', label: 'Return on margin', better: 'high', get: (d) => fin(d.results?.romPct), fmt: (v) => pct(v, 2), help: 'Net ÷ margin blocked, per trade' },
    { group: 'Returns', key: 'pf', label: 'Profit factor', better: 'high', get: (d) => fin(d.results?.profitFactor), fmt: (v) => (fin(v) == null ? '—' : Number(v).toFixed(2)), help: 'Gross wins ÷ gross losses. — = no losing trade' },
    { group: 'Returns', key: 'tstat', label: 't-stat', better: 'high', get: (d) => fin(d.results?.tStat), fmt: (v) => (fin(v) == null ? '—' : Number(v).toFixed(2)), help: 'How sure the per-trade edge is above zero; about 2 or more is meaningful' },
    { group: 'Hit rate', key: 'win', label: 'Win rate', better: 'high', get: (d) => fin(d.results?.winRate), fmt: (v) => pct(v), help: 'Share of structures that closed in profit after charges' },
    { group: 'Hit rate', key: 'avgWin', label: 'Average win', better: 'high', get: (d) => fin(d.results?.avgWin), fmt: rup },
    { group: 'Hit rate', key: 'avgLoss', label: 'Average loss', better: 'high', get: (d) => fin(d.results?.avgLoss), fmt: signedRup, help: 'Closer to zero is better' },
    { group: 'Hit rate', key: 'best', label: 'Best trade', better: 'high', get: (d) => fin(d.results?.bestTrade), fmt: signedRup },
    { group: 'Hit rate', key: 'worst', label: 'Worst trade', better: 'high', get: (d) => fin(d.results?.worstTrade), fmt: signedRup, help: 'Closer to zero is better' },
    { group: 'Risk', key: 'dd', label: 'Max drawdown', better: 'high', get: (d) => fin(d.results?.maxDrawdown), fmt: signedRup, help: 'Deepest fall from a running peak of the closed-trade curve. Closer to zero is better' },
    { group: 'Risk', key: 'recovery', label: 'Recovery factor', better: 'high', get: (d) => fin(d.results?.recovery), fmt: (v) => (fin(v) == null ? '—' : `${Number(v).toFixed(2)}×`), help: 'Net ÷ max drawdown' },
    { group: 'Risk', key: 'consistency', label: 'Consistency', better: 'high', get: (d) => fin(d.results?.consistency?.score), fmt: (v) => (fin(v) == null ? '—' : `${Math.round(v)}/100`), help: 'Profitable periods × how straight the equity curve is (0–100)' },
    { group: 'Risk', key: 'mae', label: 'Typical worst point while open', better: 'high', get: (d) => fin(d.behaviour?.maeMedian), fmt: signedRup, help: 'Median of each trade\'s worst mark' },
    { group: 'Risk', key: 'giveBack', label: 'Profit handed back', better: 'low', get: (d) => fin(d.behaviour?.giveBackMedianPct), fmt: (v) => pct(v), help: 'Of trades ever in profit, the median share of their best point not kept at exit' },
    { group: 'Costs', key: 'charges', label: 'Charges per trade', better: 'low', get: (d) => (fin(d.results?.charges) != null && d.results?.trades ? d.results.charges / d.results.trades : null), fmt: rup, help: 'Brokerage, taxes and fees ÷ trades (a total would favour whoever traded least)' },
    { group: 'Costs', key: 'costPct', label: 'Charges ÷ gross profit', better: 'low', get: (d) => fin(d.results?.costPct), fmt: (v) => pct(v), help: '— = losing before costs' },
    { group: 'Costs', key: 'margin', label: 'Margin per structure', better: null, get: (d) => fin(d.behaviour?.marginMedian), fmt: rup, help: 'Median margin blocked at entry' },
    { group: 'Costs', key: 'credit', label: 'Credit per unit', better: null, get: (d) => fin(d.behaviour?.creditMedian), fmt: (v) => (fin(v) == null ? '—' : `${v < 0 ? 'debit ' : ''}₹${Math.abs(v).toFixed(2)}`), help: 'Median net premium per unit at entry (a debit for a bought structure)' },
    { group: 'Activity', key: 'trades', label: 'Trades', better: null, get: (d) => fin(d.results?.trades) ?? 0, fmt: (v) => String(v ?? 0) },
    { group: 'Activity', key: 'days', label: 'Days traded', better: null, get: (d) => fin(d.results?.daysTraded), fmt: (v) => (fin(v) == null ? '—' : String(v)) },
    { group: 'Activity', key: 'hold', label: 'Typical hold', better: null, get: (d) => fin(d.behaviour?.holdMinutesMedian), fmt: holdText },
    { group: 'Activity', key: 'open', label: 'Open position, last mark', better: null, get: (d) => fin(d.position?.mtmNet), fmt: (v) => (v == null ? '—' : signedRup(v)), help: 'The open structure\'s last recorded mark; its card says how old that mark is' },
]);

/**
 * One colour per compared deployment, from the ACTIVE theme: its three categorical slots first,
 * then three more of its own hue families (purple, yellow, pink sit between the slots' hues), cut
 * one shade darker on a light theme so they keep their contrast against the card.
 */
export function seriesColors(ct, n) {
    const shade = ct?.mode === 'light' ? 600 : 400;
    const extra = ct?.hue ? ['purple', 'yellow', 'pink'].map((f) => ct.hue(f, shade)) : ['#a78bfa', '#facc15', '#f472b6'];
    const all = [...(ct?.categorical || ['#3b82f6', '#f97316', '#14b8a6']), ...extra];
    return Array.from({ length: n }, (_, i) => all[i % all.length]);
}

/**
 * Best and worst of one row, by its direction. Only a row with two or more values is ranked,
 * and a row where every value is equal has no best or worst.
 */
export function rankRow(values, better) {
    const xs = values.map((v, i) => ({ v, i })).filter((x) => x.v != null);
    if (!better || xs.length < 2) return { best: new Set(), worst: new Set() };
    const top = better === 'high' ? Math.max(...xs.map((x) => x.v)) : Math.min(...xs.map((x) => x.v));
    const bottom = better === 'high' ? Math.min(...xs.map((x) => x.v)) : Math.max(...xs.map((x) => x.v));
    if (top === bottom) return { best: new Set(), worst: new Set() };
    return { best: new Set(xs.filter((x) => x.v === top).map((x) => x.i)), worst: new Set(xs.filter((x) => x.v === bottom).map((x) => x.i)) };
}

/** How many ranked rows each deployment wins — the "leads on N of M" line. */
export function scoreboard(deps) {
    const wins = deps.map(() => 0);
    let ranked = 0;
    for (const m of METRICS) {
        if (!m.better) continue;
        const r = rankRow(deps.map(m.get), m.better);
        if (!r.best.size) continue;
        ranked++;
        for (const i of r.best) wins[i]++;
    }
    return { wins, ranked };
}

/**
 * Settings rows across the deployments, in the server's group order: one row per key, a cell per
 * deployment, `differs` when the values are not all the same.
 */
export function configRows(deps, groups = []) {
    const keys = new Map();
    deps.forEach((d, i) => {
        for (const c of d.config || []) {
            if (!keys.has(c.key)) keys.set(c.key, { key: c.key, label: c.label, group: c.group, help: c.help, cells: deps.map(() => null) });
            keys.get(c.key).cells[i] = c;
        }
    });
    const order = new Map(groups.map((g, i) => [g.id, i]));
    const rows = [...keys.values()].map((r) => {
        const shown = r.cells.map((c) => (c && c.display != null ? c.display : null));
        return { ...r, differs: new Set(shown.map((x) => x ?? '∅')).size > 1 };
    });
    rows.sort((a, b) => ((order.get(a.group) ?? 99) - (order.get(b.group) ?? 99)) || a.label.localeCompare(b.label));
    return rows;
}

/** Day-by-day rows for the overlay charts: every day any of them traded, values carried forward. */
export function curveRows(deps, combined) {
    const days = [...new Set([...deps.flatMap((d) => (d.daily || []).map((x) => x.day)), ...(combined?.daily || []).map((x) => x.day)])].sort();
    const maps = deps.map((d) => new Map((d.daily || []).map((x) => [x.day, x])));
    const comb = new Map((combined?.daily || []).map((x) => [x.day, x]));
    const last = deps.map(() => ({ equity: null, drawdown: null }));
    let lastC = { equity: null, drawdown: null };
    return days.map((day) => {
        const row = { day, label: shortDay(day) };
        deps.forEach((d, i) => {
            const x = maps[i].get(day);
            if (x) last[i] = { equity: x.equity, drawdown: x.drawdown };
            row[`eq_${d.id}`] = last[i].equity;
            row[`dd_${d.id}`] = last[i].drawdown;
            row[`net_${d.id}`] = x ? x.net : null;
        });
        const c = comb.get(day);
        if (c) lastC = c;
        row.eq_combined = lastC.equity;
        row.dd_combined = lastC.drawdown;
        return row;
    });
}

/** Histogram rows: one per bucket, a count per deployment. */
export function histogramRows(distribution, deps) {
    const e = distribution?.edges || [];
    const out = [];
    for (let b = 0; b < e.length - 1; b++) {
        const row = { label: `${compactRup(e[b])}…${compactRup(e[b + 1])}`, lo: e[b], hi: e[b + 1] };
        for (const d of deps) row[`n_${d.id}`] = distribution.byId?.[d.id]?.counts?.[b] ?? 0;
        out.push(row);
    }
    return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDay(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : String(ymd || '');
}
export function compactRup(v) {
    const n = fin(v);
    if (n == null) return '—';
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    return a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(1)}L` : a >= 1000 ? `${s}₹${(a / 1000).toFixed(1)}k` : `${s}₹${Math.round(a)}`;
}

/** One sentence on what running them together did to the drawdown. */
export function diversificationLine(c) {
    if (!c || c.drawdownRatio == null) return null;
    const r = c.drawdownRatio;
    const pctOf = Math.round(r * 100);
    if (r >= 0.9) return `Their drawdowns lined up: the combined book's worst drawdown (${rup(c.maxDrawdown)}) is ${pctOf}% of their drawdowns added up — little diversification.`;
    if (r >= 0.5) return `Some diversification: the combined book's worst drawdown (${rup(c.maxDrawdown)}) is ${pctOf}% of their drawdowns added up (${rup(c.sumOfMemberDrawdowns)}).`;
    return `Their bad days mostly did not coincide: the combined book's worst drawdown (${rup(c.maxDrawdown)}) is only ${pctOf}% of their drawdowns added up (${rup(c.sumOfMemberDrawdowns)}).`;
}

/** The comparison as CSV rows (metrics, then settings), for the download. */
export function csvRowsOf(deps, groups) {
    const head = (label) => Object.fromEntries([['section', label], ...deps.map((d) => [d.name, d.name])]);
    const rows = [head('—')];
    for (const m of METRICS) rows.push({ section: `results: ${m.label}`, ...Object.fromEntries(deps.map((d) => [d.name, (() => { const v = m.get(d); return v == null ? '' : v; })()])) });
    for (const r of configRows(deps, groups)) rows.push({ section: `setting: ${r.label}`, ...Object.fromEntries(deps.map((d, i) => [d.name, r.cells[i]?.display ?? ''])) });
    return rows.slice(1);
}
