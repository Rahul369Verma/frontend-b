/**
 * StrategyScorecard — "which strategies are working?", answered first.
 *
 * Two blocks, both from GET /api/multileg/scorecard under the page's filters:
 *   OPEN NOW    structures open right now with their live mark. Results lists
 *               only booked round-trips, so open risk was invisible here.
 *   STRATEGIES  one row per deployment: booked results, its equity line, the
 *               open position, and live vs the backtest it was deployed from —
 *               with a VERDICT that refuses to judge on too few trades.
 *   COMPARE     tick 2-4 rows to overlay their equity curves.
 *
 * Layout follows the panel's width in rem (useRemWidth): a table when there is
 * room, cards when there is not — so a larger Text Size moves the switch point.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { ROUTES } from '../../config/routes.js';
import { Chip } from '../viz/primitives';
import { pnlTone, rupeeTick } from '../viz/tokens';
import { useChartTheme } from '../../theme/chartTheme.js';
import useRemWidth from '../../hooks/useRemWidth';
import { fmt, num, rup, shortSym } from './builderFormat';
import DocLink from '../DocLink.jsx';

const TABLE_REM = 80;
const COLLAPSED_ROWS = 15;
const MAX_COMPARE = 4;
const DASHES = ['0', '6 3', '2 3', '10 4 2 4'];

const deploymentHref = (id) => `${ROUTES.multiLeg}?tab=results&deployment=${encodeURIComponent(String(id))}`;

const VERDICT = {
    'no-trades': { label: 'No trades yet', tone: 'neutral', help: 'Nothing booked in this window.' },
    'too-few': { label: 'Too few trades', tone: 'neutral', help: 'Fewer trades than needed to judge — the range of likely per-trade results is wider than any difference worth acting on.' },
    'on-track': { label: 'On track', tone: 'good', help: "The backtest's per-trade sits inside live's 95% range: live and backtest agree." },
    ahead: { label: 'Ahead of backtest', tone: 'good', help: 'Live is making more per trade than the backtest.' },
    'below-backtest': { label: 'Below backtest', tone: 'warning', help: 'Live is below the backtest, but not by enough to call it drift on this sample.' },
    drifting: { label: 'Drifting', tone: 'critical', help: 'Live per-trade is more than half below the backtest. A prompt to look, not proof of decay.' },
    profitable: { label: 'Profitable · no backtest', tone: 'good', help: 'Enough trades and making money, but there is no saved backtest to compare against.' },
    bleeding: { label: 'Bleeding', tone: 'critical', help: 'Enough trades to judge, losing money, and no backtest to compare against.' },
};

function Verdict({ r, minTrades }) {
    const v = VERDICT[r.verdict] || { label: r.verdict, tone: 'neutral' };
    const lean = r.verdict === 'too-few' && r.leaning
        ? <span className={r.leaning === 'up' ? 'text-success' : r.leaning === 'down' ? 'text-danger' : 'text-fg-5'} aria-label={`leaning ${r.leaning}`}>{r.leaning === 'up' ? ' ▲' : r.leaning === 'down' ? ' ▼' : ''}</span>
        : null;
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            <Chip tone={v.tone} title={`${v.help}${r.why ? ` ${r.why}` : ''}`}>
                {v.label}{r.verdict === 'too-few' ? ` (${r.trades}/${minTrades})` : ''}{lean}
            </Chip>
            {r.flags?.includes('fading') && (
                <Chip tone="warning" title={`Profitable overall, but the last ${r.recent?.n} trades lost ₹${fmt(-r.recent?.net)}.`}>Fading</Chip>
            )}
        </span>
    );
}

/** A cumulative-net line on the row's own scale, zero marked. */
function Spark({ curve, width = 96, height = 22, color, zero }) {
    if (!Array.isArray(curve) || curve.length < 2) return <span className="text-fg-5 text-3xs">—</span>;
    const xs = curve.map(p => p[0]), ys = curve.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
    const X = (v) => (1 + ((v - x0) / ((x1 - x0) || 1)) * (width - 2)).toFixed(1);
    const Y = (v) => (height - 2 - ((v - lo) / ((hi - lo) || 1)) * (height - 4)).toFixed(1);
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <line x1="0" x2={width} y1={Y(0)} y2={Y(0)} stroke={zero} strokeWidth="1" />
            <polyline points={curve.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    );
}

function VsBacktest({ r }) {
    if (!r.expected) return <span className="text-fg-5" title="No saved backtest for this deployment — nothing to compare against.">—</span>;
    const gap = num(r.gapPerTrade);
    return (
        // wraps inside a narrow card; the table cell keeps it on one line (nowrap)
        <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1"
            title={`Expected ₹${fmt(r.expected.perTrade)}/trade from the ${r.expected.label}.${r.ci95 ? ` Live 95% range: ₹${fmt(r.ci95[0])} to ₹${fmt(r.ci95[1])}.` : ''}`}>
            <span className="text-fg-4">₹{fmt(r.expected.perTrade)}</span>
            {r.trades > 0 && gap != null && <span className={pnlTone(gap)}>({gap > 0 ? '+' : ''}{fmt(gap)})</span>}
            <span className="text-fg-5 text-4xs">{r.expected.source === 'oos' ? 'OOS' : 'BT'}</span>
        </span>
    );
}

function costTone(p) {
    if (p == null) return 'text-fg-5';
    return p >= 100 ? 'text-danger font-semibold' : p >= 50 ? 'text-warning' : 'text-fg-4';
}

/** "Open now" — every structure open under the filters, with its live mark. */
export function OpenNow({ sc, templates = [] }) {
    const [show, setShow] = useState(false);
    const data = sc?.data?.open;
    const open = (sc?.data?.rows || []).filter(r => r.open);
    if (sc?.err) return <div className="bg-surface rounded-xl border border-line p-3 text-xs text-danger">Open positions failed to load: {sc.err}</div>;
    if (!data) return null;
    return (
        <div className="bg-surface rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold text-fg">Open now <DocLink to="multi-leg#results-tab" /></h2>
                {data.n ? (
                    <>
                        <span className="text-xs text-fg-3">{data.n} structure{data.n === 1 ? '' : 's'}</span>
                        <span className={`text-sm font-semibold tabular-nums ${pnlTone(data.mtmNet)}`} title="Sum of the latest marks, net of estimated round-trip charges. Not booked — these move until each structure exits.">
                            MTM {rup(data.mtmNet)}
                        </span>
                        {data.unmarked > 0 && <span className="text-2xs text-warning">{data.unmarked} not yet marked (not in the total)</span>}
                        <button type="button" onClick={() => setShow(s => !s)} aria-expanded={show}
                            className="ml-auto text-2xs px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-4 hover:text-fg">
                            {show ? 'Hide list' : 'Show list'}
                        </button>
                    </>
                ) : <span className="text-xs text-fg-5">Nothing open in this filter — every figure below is booked.</span>}
            </div>
            {show && open.length > 0 && (
                <div className="overflow-x-auto mt-2">
                    <table className="w-full text-2xs text-fg-3">
                        <thead><tr className="text-fg-5 text-left">
                            <th className="py-1 pr-3 font-semibold">Deployment</th><th className="pr-3 font-semibold">Structure</th>
                            <th className="pr-3 font-semibold">State</th><th className="pr-3 font-semibold">Open since (IST)</th>
                            <th className="text-right font-semibold">MTM (net)</th>
                        </tr></thead>
                        <tbody>
                            {open.sort((a, b) => (a.open.mtmNet ?? 0) - (b.open.mtmNet ?? 0)).map(r => (
                                <tr key={r.deploymentId} className="border-t border-line-0">
                                    <td className="py-1 pr-3"><Link to={deploymentHref(r.deploymentId)} className="text-primary-ink hover:underline">{r.name}</Link></td>
                                    <td className="pr-3 text-fg-4">{templates.find(t => t.key === r.template)?.name || r.template || '—'} · {shortSym(r.symbol)}</td>
                                    <td className="pr-3 text-warning">{r.open.state}</td>
                                    <td className="pr-3 text-fg-4 whitespace-nowrap">{r.open.since ? new Date(r.open.since).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</td>
                                    <td className={`text-right tabular-nums font-semibold ${pnlTone(r.open.mtmNet)}`}>{r.open.mtmNet == null ? 'unmarked' : rup(r.open.mtmNet)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function ComparePanel({ rows, onClear }) {
    const ct = useChartTheme();
    const colors = [...ct.categorical, ct.mark.live];
    // one row per instant, a column per strategy, carried forward so each line
    // holds its level between its own exits
    const data = useMemo(() => {
        const times = [...new Set(rows.flatMap(r => r.curve.map(p => p[0])))].sort((a, b) => a - b);
        const last = rows.map(() => 0);
        const idx = rows.map(() => 0);
        return times.map(t => {
            const o = { t };
            rows.forEach((r, i) => {
                while (idx[i] < r.curve.length && r.curve[idx[i]][0] <= t) { last[i] = r.curve[idx[i]][1]; idx[i]++; }
                o[`s${i}`] = last[i];
            });
            return o;
        });
    }, [rows]);
    const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
    return (
        <div className="mt-3 rounded-lg border border-line bg-slate-900/30 p-3">
            <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-semibold text-fg-2">Comparing {rows.length} strategies — cumulative net by exit time</h3>
                <button type="button" onClick={onClear} className="ml-auto text-2xs px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-4 hover:text-fg">Clear</button>
            </div>
            {data.length < 2 ? <div className="text-2xs text-fg-5">Not enough booked trades to draw a line yet.</div> : (
                <ZoomableChart data={data} height={240}>
                    <LineChart margin={{ top: 6, right: 12, bottom: 2, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtDay}
                            tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={30} />
                        <YAxis width={56} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={rupeeTick} />
                        <ReferenceLine y={0} stroke={ct.axis} />
                        <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })} labelFormatter={(l) => fmtDay(l)}
                            formatter={(v, k) => [rup(v), rows[Number(String(k).slice(1))]?.name || k]} />
                        <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} formatter={(k) => rows[Number(String(k).slice(1))]?.name || k} />
                        {rows.map((r, i) => (
                            <Line key={r.deploymentId || i} type="stepAfter" dataKey={`s${i}`} stroke={colors[i % colors.length]}
                                strokeDasharray={DASHES[i % DASHES.length]} dot={false} strokeWidth={2} isAnimationActive={false} />
                        ))}
                    </LineChart>
                </ZoomableChart>
            )}
            <div className="overflow-x-auto mt-2">
                <table className="w-full text-2xs text-fg-3">
                    <thead><tr className="text-fg-5 text-left">
                        <th className="py-1 pr-3 font-semibold">Strategy</th><th className="pr-3 text-right font-semibold">Trades</th>
                        <th className="pr-3 text-right font-semibold">Net</th><th className="pr-3 text-right font-semibold">Per trade</th>
                        <th className="pr-3 text-right font-semibold">Win%</th><th className="pr-3 text-right font-semibold">Max DD</th>
                        <th className="text-right font-semibold">vs backtest /trade</th>
                    </tr></thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={r.deploymentId || i} className="border-t border-line-0">
                                <td className="py-1 pr-3">
                                    <span className="inline-block w-3 h-0.5 align-middle mr-1.5" style={{ backgroundColor: colors[i % colors.length] }} aria-hidden="true" />{r.name}
                                </td>
                                <td className="pr-3 text-right tabular-nums">{r.trades}</td>
                                <td className={`pr-3 text-right tabular-nums font-semibold ${pnlTone(r.net)}`}>{rup(r.net)}</td>
                                <td className={`pr-3 text-right tabular-nums ${pnlTone(r.perTrade)}`}>{r.perTrade == null ? '—' : rup(r.perTrade)}</td>
                                <td className="pr-3 text-right tabular-nums">{r.winRate == null ? '—' : `${r.winRate}%`}</td>
                                <td className="pr-3 text-right tabular-nums text-danger">{r.maxDrawdown ? rup(r.maxDrawdown) : '—'}</td>
                                <td className="text-right tabular-nums"><VsBacktest r={r} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const SORTS = [
    { k: 'net', label: 'Net', get: r => r.net },
    { k: 'perTrade', label: 'Per trade', get: r => r.perTrade },
    { k: 'gap', label: 'vs backtest', get: r => (r.trades ? num(r.gapPerTrade) : null) },
    { k: 'trades', label: 'Trades', get: r => r.trades },
    { k: 'winRate', label: 'Win%', get: r => r.winRate },
    { k: 'maxDrawdown', label: 'Max drawdown', get: r => r.maxDrawdown },
    { k: 'costPct', label: 'Costs ÷ gross', get: r => r.costPct },
    { k: 'open', label: 'Open MTM', get: r => (r.open ? r.open.mtmNet : null) },
];

/** The Strategies card: the scorecard table (cards when narrow) and Compare. */
export default function StrategyScorecard({ sc, templates = [], single = false }) {
    const ct = useChartTheme();
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const asTable = rem == null || rem >= TABLE_REM;
    const [sort, setSort] = useState({ k: 'net', dir: 'desc' });
    const [q, setQ] = useState('');
    const [all, setAll] = useState(false);
    const [picked, setPicked] = useState([]);
    const data = sc?.data || null;
    const err = sc?.err || null;
    const allRows = useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]);
    const tplName = useCallback((k) => templates.find(t => t.key === k)?.name || k || '—', [templates]);
    const rows = useMemo(() => {
        const s = q.trim().toLowerCase();
        const spec = SORTS.find(x => x.k === sort.k) || SORTS[0];
        const sign = sort.dir === 'asc' ? 1 : -1;
        return allRows
            .filter(r => !s || [r.name, r.template, tplName(r.template), shortSym(r.symbol)].some(x => String(x || '').toLowerCase().includes(s)))
            .sort((a, b) => {
                const x = spec.get(a), y = spec.get(b);
                if (x == null && y == null) return 0;
                if (x == null) return 1;
                if (y == null) return -1;
                return (x - y) * sign;
            });
    }, [allRows, q, sort, tplName]);
    const shown = all ? rows : rows.slice(0, COLLAPSED_ROWS);
    const pickedRows = picked.map(id => allRows.find(r => (r.deploymentId || r.name) === id)).filter(Boolean);
    const togglePick = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_COMPARE ? p : [...p, id]));
    const onSort = (k) => setSort(s => (s.k === k ? { k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { k, dir: 'desc' }));
    const counts = data?.verdictCounts || {};

    return (
            <div ref={ref} className="bg-surface rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2">
                    <h2 className="text-sm font-semibold text-fg mr-auto">
                        Strategies {data ? `(${allRows.length})` : ''}
                        <span className="text-fg-5 font-normal text-2xs"> — booked results per deployment, and live vs the backtest it was deployed from</span>
                        <DocLink to="multi-leg#results-tab" className="ml-2" />
                    </h2>
                    {!single && allRows.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter strategies…"
                                aria-label="Filter strategies" className="h-8 w-44 bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2 placeholder:text-fg-5" />
                            <label className="flex items-center gap-1 text-2xs text-fg-4">Sort
                                <select value={sort.k} onChange={e => setSort({ k: e.target.value, dir: 'desc' })} className="h-8 bg-slate-800 border border-line rounded-md px-1 text-xs text-fg-2">
                                    {SORTS.map(s => <option key={s.k} value={s.k}>{s.label}</option>)}
                                </select>
                            </label>
                        </div>
                    )}
                </div>
                {Object.keys(counts).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2 text-2xs text-fg-5">
                        {Object.entries(counts).map(([v, n]) => (
                            <Chip key={v} tone={(VERDICT[v] || {}).tone || 'neutral'} title={(VERDICT[v] || {}).help}>{(VERDICT[v] || { label: v }).label} · {n}</Chip>
                        ))}
                        {counts['too-few'] > 0 && <span className="self-center">A verdict needs {data.minTrades} trades; until then ▲/▼ shows only which way it is leaning.</span>}
                    </div>
                )}
                {err ? <div className="text-xs text-danger">Scorecard failed: {err}</div>
                    : !data ? <div className="text-xs text-fg-5">Loading…</div>
                    : !allRows.length ? <div className="text-xs text-fg-5">No deployments in this filter.</div>
                    : asTable ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-fg-3">
                                <thead><tr className="text-2xs text-fg-5 text-left">
                                    {!single && <th className="pb-1.5 pr-2 font-semibold"><span className="sr-only">Compare</span></th>}
                                    <th className="pb-1.5 pr-3 font-semibold">Strategy</th>
                                    <th className="pb-1.5 pr-3 font-semibold">Verdict</th>
                                    {[['trades', 'Trades'], ['net', 'Net'], ['perTrade', 'Per trade'], ['gap', 'vs backtest /trade'], ['winRate', 'Win%'], ['maxDrawdown', 'Max DD'], ['costPct', 'Costs ÷ gross']].map(([k, l]) => (
                                        <th key={k} className="pb-1.5 px-2 text-right font-semibold whitespace-nowrap" aria-sort={sort.k === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                            <button type="button" onClick={() => onSort(k)} className={`hover:text-fg-2 ${sort.k === k ? 'text-fg-2' : ''}`}>{l}{sort.k === k ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}</button>
                                        </th>
                                    ))}
                                    <th className="pb-1.5 px-2 font-semibold">Equity</th>
                                    <th className="pb-1.5 pl-2 text-right font-semibold">Open MTM</th>
                                </tr></thead>
                                <tbody>
                                    {shown.map(r => {
                                        const id = r.deploymentId || r.name;
                                        const on = picked.includes(id);
                                        return (
                                            <tr key={id} className={`border-t border-line-0 ${on ? 'bg-primary/5' : ''}`}>
                                                {!single && (
                                                    <td className="py-2 pr-2">
                                                        <input type="checkbox" checked={on} onChange={() => togglePick(id)} disabled={!on && picked.length >= MAX_COMPARE}
                                                            aria-label={`Compare ${r.name}`} title={!on && picked.length >= MAX_COMPARE ? `Compare up to ${MAX_COMPARE}` : 'Add to the comparison'} />
                                                    </td>
                                                )}
                                                <td className="py-2 pr-3 min-w-[14rem]">
                                                    {r.deploymentId ? <Link to={deploymentHref(r.deploymentId)} className="font-semibold text-fg-2 hover:underline break-words">{r.name}</Link>
                                                        : <span className="font-semibold text-fg-2">{r.name}</span>}
                                                    <div className="text-2xs text-fg-5">
                                                        {tplName(r.template)} · {shortSym(r.symbol)} · {r.tradeMode}{r.lots > 1 ? ` · ${r.lots} lots` : ''}
                                                        {r.status !== 'ACTIVE' && <span className="text-warning"> · {r.status.toLowerCase()}</span>}
                                                    </div>
                                                </td>
                                                <td className="py-2 pr-3"><Verdict r={r} minTrades={data.minTrades} /></td>
                                                <td className="py-2 px-2 text-right tabular-nums">{r.trades}</td>
                                                <td className={`py-2 px-2 text-right tabular-nums font-semibold ${pnlTone(r.net)}`}>{r.trades ? rup(r.net) : '—'}</td>
                                                <td className={`py-2 px-2 text-right tabular-nums ${pnlTone(r.perTrade)}`}>{r.perTrade == null ? '—' : rup(r.perTrade)}</td>
                                                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap"><VsBacktest r={r} /></td>
                                                <td className="py-2 px-2 text-right tabular-nums">{r.winRate == null ? '—' : `${r.winRate}%`}</td>
                                                <td className="py-2 px-2 text-right tabular-nums text-danger">{r.maxDrawdown ? rup(r.maxDrawdown) : '—'}</td>
                                                <td className={`py-2 px-2 text-right tabular-nums ${costTone(r.costPct)}`}
                                                    title={r.costPct == null ? (r.trades ? 'Losing before costs — gross P&L is not positive.' : '') : `₹${fmt(r.charges)} of charges against ₹${fmt(r.gross)} gross profit`}>
                                                    {r.costPct == null ? '—' : `${r.costPct}%`}
                                                </td>
                                                <td className="py-2 px-2"><Spark curve={r.curve} color={ct.mark.equity} zero={ct.axis} /></td>
                                                <td className={`py-2 pl-2 text-right tabular-nums ${r.open ? pnlTone(r.open.mtmNet) : 'text-fg-5'}`}>
                                                    {r.open ? (r.open.mtmNet == null ? 'unmarked' : rup(r.open.mtmNet)) : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className={`grid gap-3 ${rem >= 40 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            {shown.map(r => {
                                const id = r.deploymentId || r.name;
                                const on = picked.includes(id);
                                return (
                                    <article key={id} className={`rounded-lg border p-3 ${on ? 'border-primary bg-primary/5' : 'border-line bg-slate-900/30'}`}>
                                        <div className="flex items-start gap-2">
                                            {!single && <input type="checkbox" className="mt-1" checked={on} onChange={() => togglePick(id)} disabled={!on && picked.length >= MAX_COMPARE} aria-label={`Compare ${r.name}`} />}
                                            <div className="min-w-0 flex-1">
                                                {r.deploymentId ? <Link to={deploymentHref(r.deploymentId)} className="text-sm font-semibold text-fg-2 hover:underline break-words">{r.name}</Link>
                                                    : <span className="text-sm font-semibold text-fg-2">{r.name}</span>}
                                                <div className="text-2xs text-fg-5">{tplName(r.template)} · {shortSym(r.symbol)} · {r.tradeMode}</div>
                                            </div>
                                        </div>
                                        <div className="mt-2"><Verdict r={r} minTrades={data.minTrades} /></div>
                                        <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-2xs">
                                            <div><dt className="text-fg-5">Net · {r.trades} trades</dt><dd className={`text-sm font-semibold ${pnlTone(r.net)}`}>{r.trades ? rup(r.net) : '—'}</dd></div>
                                            <div><dt className="text-fg-5">Per trade</dt><dd className={`text-sm font-semibold ${pnlTone(r.perTrade)}`}>{r.perTrade == null ? '—' : rup(r.perTrade)}</dd></div>
                                            <div className="min-w-0"><dt className="text-fg-5">vs backtest</dt><dd className="text-xs"><VsBacktest r={r} /></dd></div>
                                            <div><dt className="text-fg-5">Win%</dt><dd className="text-xs">{r.winRate == null ? '—' : `${r.winRate}%`}</dd></div>
                                            <div><dt className="text-fg-5">Max DD</dt><dd className="text-xs text-danger">{r.maxDrawdown ? rup(r.maxDrawdown) : '—'}</dd></div>
                                            <div><dt className="text-fg-5">Open MTM</dt><dd className={`text-xs ${r.open ? pnlTone(r.open.mtmNet) : 'text-fg-5'}`}>{r.open ? rup(r.open.mtmNet) : '—'}</dd></div>
                                        </dl>
                                        <div className="mt-2"><Spark curve={r.curve} width={180} height={28} color={ct.mark.equity} zero={ct.axis} /></div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                {rows.length > COLLAPSED_ROWS && (
                    <div className="mt-2 text-2xs text-fg-5">
                        Showing {shown.length} of {rows.length}{q ? ` matching “${q}”` : ''}.{' '}
                        <button type="button" onClick={() => setAll(a => !a)} className="text-primary-ink hover:underline">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
                    </div>
                )}
                {!single && allRows.length > 1 && pickedRows.length < 2 && (
                    <div className="mt-2 text-2xs text-fg-5">Tick 2–{MAX_COMPARE} strategies to overlay their equity curves.{pickedRows.length === 1 ? ' One picked — pick one more.' : ''}</div>
                )}
                {pickedRows.length >= 2 && <ComparePanel rows={pickedRows} onClear={() => setPicked([])} />}
            </div>
    );
}
