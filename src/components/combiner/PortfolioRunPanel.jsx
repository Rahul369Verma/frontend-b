import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Play, Plus, Trash2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { API_URL } from '../../config/api.js';
import { Card, DataTable, StatTile, StatRow, Spinner, EmptyState } from '../viz/primitives';
import { inr, pnlTone, istDateTime } from '../viz/tokens';
import { useChartTheme } from '../../theme/chartTheme.js';
import useRemWidth from '../../hooks/useRemWidth.js';
import CollapsibleCard from '../CollapsibleCard';
import CombinerReport from './CombinerReport.jsx';
import MemberBuilder from './MemberBuilder.jsx';
import { getDeployments } from './combinerApi.js';
import ConsistencyPanel from '../viz/ConsistencyPanel.jsx';
import { consistencyText, consistencyVerdict } from '../viz/consistencyFormat.js';

/**
 * Keys of the Backtest form that apply to the whole run (data, costs, mode, size), not to one
 * strategy. Trade windows, holding and strike choice stay each strategy's own — as they are for
 * separate deployments in live.
 */
const RUN_KEYS = ['resolution', 'dataSource', 'backtest_mode', 'slippage_percent', 'brokerage_per_order', 'lot_size', 'lots', 'broker'];

let _rowSeq = 0;
const newRow = (strategy = 'smc_ob', extra = {}) => ({ key: `r${++_rowSeq}`, name: '', strategyName: strategy, preset: '', params: {}, weight: 1, ...extra });

/**
 * "Run together": several strategies on ONE underlying in one backtest — what live deployments
 * mode does when several deployments share an index. Each keeps its own book; the result shows
 * them side by side, the combined curve, the live engine's account-wide daily caps applied to the
 * combined book (every refused entry listed), and how much the strategies overlap.
 * Symbol, dates, capital and data settings come from the Backtest form.
 */
export default function PortfolioRunPanel({ baseParams, strategyOptions = [], presets = {} }) {
    const ct = useChartTheme();
    const box = useRef(null);
    const rem = useRemWidth(box);
    const wide = rem == null || rem >= 64;
    const [rows, setRows] = useState(() => [newRow('smc_ob'), newRow('wyckoff_spring')]);
    const [deployments, setDeployments] = useState(null);
    const [capsOn, setCapsOn] = useState(true);
    const [caps, setCaps] = useState({ max_daily_loss: 2000, max_trades_per_day: 0 });
    const [windowMin, setWindowMin] = useState(15);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    // The account-wide caps the live engine uses (Settings), as the starting values.
    useEffect(() => {
        axios.get(`${API_URL}/settings`).then(r => {
            const s = r.data || {};
            setCaps({ max_daily_loss: Number(s.max_daily_loss) || 2000, max_trades_per_day: Number(s.max_trades_per_day) || 0 });
        }).catch(() => { /* defaults stay */ });
    }, []);

    const update = (key, patch) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
    const labelOf = (id) => (strategyOptions.find(o => o.id === id)?.label || id);

    const addDeployment = (id) => {
        const d = (deployments || []).find(x => x._id === id);
        if (d) setRows(rs => [...rs, newRow(d.strategyName, { name: d.name, params: { ...(d.params || {}) }, fromDeployment: d._id })]);
    };

    const run = async () => {
        setRunning(true); setError(null); setResult(null);
        try {
            const common = {};
            for (const k of RUN_KEYS) if (baseParams[k] !== undefined) common[k] = baseParams[k];
            const deps = rows.map((r, i) => {
                const preset = r.preset ? (presets[r.strategyName] || []).find(p => p.id === r.preset) : null;
                return {
                    name: r.name || `${labelOf(r.strategyName)}${rows.filter(x => x.strategyName === r.strategyName).length > 1 ? ` #${i + 1}` : ''}`,
                    strategyName: r.strategyName,
                    params: { ...(preset ? preset.params : {}), ...r.params },
                    weight: Number(r.weight) || 1,
                };
            });
            const body = {
                ...common,
                symbol: baseParams.symbol, start_date: baseParams.start_date, end_date: baseParams.end_date, capital: baseParams.capital,
                deployments: deps,
                shared_caps: capsOn ? caps : null,
                overlap_window_minutes: windowMin,
            };
            const res = await axios.post(`${API_URL}/engine/backtest/run`, body);
            setResult(res.data);
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally { setRunning(false); }
    };

    const chart = useMemo(() => {
        if (!result) return null;
        const series = [{ name: 'All together', points: result.portfolio?.equityCurve || [] },
            ...(result.perDeployment || []).map(d => ({ name: d.name, points: d.equityCurve || [] }))];
        if (result.withSharedCaps) series.splice(1, 0, { name: 'With account caps', points: result.withSharedCaps.equityCurve || [] });
        const byTs = new Map();
        series.forEach((s, si) => {
            let last = null;
            for (const p of s.points) {
                const t = p.date || p.timestamp;
                if (!t) continue;
                last = p.balance;
                const row = byTs.get(t) || { t };
                row[`s${si}`] = last;
                byTs.set(t, row);
            }
        });
        const data = [...byTs.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
        // forward-fill so lines are continuous
        const prev = {};
        for (const row of data) series.forEach((_, si) => { const k = `s${si}`; if (row[k] == null) row[k] = prev[k] ?? null; else prev[k] = row[k]; });
        return { series, data };
    }, [result]);

    const perCols = [
        { key: 'name', header: 'Strategy', render: d => <span className="text-fg-3">{d.name}{d.error ? <span className="text-danger"> — {d.error}</span> : ''}</span> },
        { key: 'trades', header: 'Trades', align: 'right', render: d => d.metrics?.totalTrades ?? '—' },
        { key: 'net', header: 'Net', align: 'right', render: d => <span className={pnlTone(d.metrics?.totalPnL)}>{inr(d.metrics?.totalPnL, { sign: true })}</span> },
        { key: 'win', header: 'Win %', align: 'right', render: d => (d.metrics?.winRate != null ? `${Number(d.metrics.winRate).toFixed(1)}%` : '—') },
        { key: 'pf', header: 'PF', align: 'right', render: d => (Number.isFinite(Number(d.metrics?.profitFactor)) ? Number(d.metrics.profitFactor).toFixed(2) : '—') },
        { key: 'cons', header: 'Consistency', align: 'right', render: d => <span title={consistencyVerdict(d.metrics?.consistency?.score)}>{consistencyText(d.metrics?.consistency?.score)}</span> },
        ...(wide ? [
            { key: 'dd', header: 'Max DD', align: 'right', render: d => (d.metrics?.maxDrawdown != null ? `${Number(d.metrics.maxDrawdown).toFixed(1)}%` : '—') },
            { key: 'cap', header: 'Capital', align: 'right', render: d => inr(d.capital, { compact: true }) },
        ] : []),
    ];
    const pairCols = [
        { key: 'pair', header: 'Pair', render: p => <span className="text-fg-3 whitespace-normal">{p.a} × {p.b}</span> },
        { key: 'same', header: 'Same side', align: 'right', render: p => `${p.sameSide} of ${p.aEntries}` },
        { key: 'opp', header: 'Opposite side', align: 'right', render: p => p.oppositeSide },
        ...(wide ? [{ key: 'days', header: 'Days both traded', align: 'right', render: p => `${p.daysBothTraded} of ${p.days}` }] : []),
        { key: 'corr', header: 'Daily P&L corr.', align: 'right', render: p => (p.dailyPnlCorrelation == null ? '—' : p.dailyPnlCorrelation.toFixed(2)) },
    ];
    const pm = result?.portfolio?.metrics || {};
    const cm = result?.withSharedCaps?.metrics;

    return (
        <div ref={box} className="space-y-6">
            <Card docs="signal-combiner#run-together" title="Strategies to run together"
                subtitle={`On ${baseParams.symbol || '—'} from ${baseParams.start_date || '—'} to ${baseParams.end_date || '—'}, ${inr(baseParams.capital, { compact: true })} split by weight. Data, timeframe and costs come from the form.`}>
                <div className="space-y-2">
                    {rows.map(r => (
                        <div key={r.key} className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card-2/40 p-2">
                            <label className="flex flex-col gap-0.5 flex-1 min-w-[10rem]">
                                <span className="text-3xs text-fg-5">Strategy</span>
                                <select className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.strategyName}
                                    onChange={e => update(r.key, { strategyName: e.target.value, preset: '', params: {}, fromDeployment: null })}>
                                    {strategyOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                </select>
                            </label>
                            <label className="flex flex-col gap-0.5 flex-1 min-w-[10rem]">
                                <span className="text-3xs text-fg-5">Parameters</span>
                                {r.fromDeployment ? <span className="text-xs text-fg-3 py-1.5">from deployment “{r.name}”</span> : (
                                    <select className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.preset} onChange={e => update(r.key, { preset: e.target.value })}>
                                        <option value="">Code defaults</option>
                                        {(presets[r.strategyName] || []).map(p => <option key={p.id} value={p.id}>Preset: {p.label}</option>)}
                                    </select>
                                )}
                            </label>
                            <label className="flex flex-col gap-0.5 w-[9rem]">
                                <span className="text-3xs text-fg-5">Name</span>
                                <input className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.name} placeholder="(auto)" onChange={e => update(r.key, { name: e.target.value })} />
                            </label>
                            <label className="flex flex-col gap-0.5 w-[5rem]">
                                <span className="text-3xs text-fg-5">Weight</span>
                                <input type="number" min="0" step="0.5" className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.weight} onChange={e => update(r.key, { weight: e.target.value })} />
                            </label>
                            <button type="button" aria-label={`Remove ${r.name || r.strategyName}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}
                                className="p-1.5 rounded border border-line text-fg-5 hover:text-danger hover:border-danger/40"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                            {r.strategyName === 'signal_combiner' && !r.fromDeployment && (
                                <div className="w-full">
                                    <MemberBuilder value={r.params.members} resolution={baseParams.resolution || '5'}
                                        onChange={(members, needs) => update(r.key, { params: { ...r.params, members, ...(needs || {}) } })} />
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setRows(rs => [...rs, newRow(strategyOptions[0]?.id || 'smc_ob')])}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2"><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a strategy</button>
                        <select aria-label="Add a deployment" className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value=""
                            onFocus={() => { if (!deployments) getDeployments().then(setDeployments).catch(() => setDeployments([])); }}
                            onChange={e => addDeployment(e.target.value)}>
                            <option value="">{deployments ? 'Add one of your deployments…' : 'Add one of your deployments (loading)…'}</option>
                            {(deployments || []).map(d => <option key={d._id} value={d._id}>{d.name} · {d.strategyName} · {d.symbol}</option>)}
                        </select>
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-4 text-xs">
                    <label className="flex items-center gap-2 text-fg-4">
                        <input type="checkbox" checked={capsOn} onChange={e => setCapsOn(e.target.checked)} />
                        Apply the live engine's account-wide daily caps
                    </label>
                    {capsOn && (
                        <>
                            <label className="flex flex-col gap-0.5"><span className="text-3xs text-fg-5">Max daily loss (₹)</span>
                                <input type="number" min="0" className="w-[7rem] bg-slate-900 border border-line rounded p-1.5 text-fg" value={caps.max_daily_loss} onChange={e => setCaps(c => ({ ...c, max_daily_loss: Number(e.target.value) || 0 }))} /></label>
                            <label className="flex flex-col gap-0.5"><span className="text-3xs text-fg-5">Max entries per day (0 = none)</span>
                                <input type="number" min="0" className="w-[7rem] bg-slate-900 border border-line rounded p-1.5 text-fg" value={caps.max_trades_per_day} onChange={e => setCaps(c => ({ ...c, max_trades_per_day: Number(e.target.value) || 0 }))} /></label>
                        </>
                    )}
                    <label className="flex flex-col gap-0.5"><span className="text-3xs text-fg-5">Overlap window (minutes)</span>
                        <input type="number" min="0" className="w-[6rem] bg-slate-900 border border-line rounded p-1.5 text-fg" value={windowMin} onChange={e => setWindowMin(Number(e.target.value) || 0)} /></label>
                    <button type="button" disabled={running || rows.length < 1} onClick={run}
                        className="ml-auto inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-on-primary font-bold py-2 px-4 rounded-lg disabled:opacity-60">
                        <Play className="w-4 h-4" aria-hidden="true" /> {running ? 'Running…' : `Run ${rows.length} together`}
                    </button>
                </div>
                {error && <p className="mt-2 text-xs text-danger">✕ {error}</p>}
            </Card>

            {running && <Spinner label="Running every strategy on the same data…" />}
            {!running && !result && !error && (
                <EmptyState title="Nothing run yet">Pick two or more strategies and run them together to see the combined book.</EmptyState>
            )}

            {result && (
                <div className="space-y-6">
                    <StatRow cols={4}>
                        <StatTile label="All together — net" value={inr(pm.totalPnL, { sign: true })} tone={pm.totalPnL > 0 ? 'positive' : pm.totalPnL < 0 ? 'negative' : 'neutral'} hint={`${pm.totalTrades} trades · win ${pm.winRate ?? '—'}%`} />
                        <StatTile label="Profit factor" value={pm.profitFactor ?? '—'} hint={`return ${pm.roiPct ?? '—'}% of ${inr(result.capital, { compact: true })}`} />
                        {cm ? <StatTile label="With account caps — net" value={inr(cm.totalPnL, { sign: true })} tone={cm.totalPnL > 0 ? 'positive' : cm.totalPnL < 0 ? 'negative' : 'neutral'} hint={`${cm.totalTrades} trades · ${result.withSharedCaps.dropped.length} entries refused`} />
                            : <StatTile label="Account caps" value="off" hint="each strategy ran unconstrained" />}
                        <StatTile label="Data loads" value={result.dataLoads ? `${result.dataLoads.distinct} for ${result.dataLoads.requests} requests` : '—'} hint="one load per series, shared" />
                    </StatRow>

                    {pm.consistency && (
                        <Card title="Consistency of the combined book" docs="backtest#consistency"
                            subtitle={`All together: ${consistencyText(pm.consistency.score)} / 100${cm && cm.consistency ? ` · with account caps ${consistencyText(cm.consistency.score)}` : ''}. Compare with each strategy's own score in the table below — combining is worth it when the book is steadier than its parts.`}>
                            <ConsistencyPanel data={pm.consistency} />
                        </Card>
                    )}

                    <Card title="Each strategy" docs="signal-combiner#run-together">
                        <DataTable columns={perCols} rows={(result.perDeployment || []).map((d, i) => ({ ...d, _key: `${i}` }))} />
                        {(result.perDeployment || []).flatMap(d => (d.warnings || []).map(w => `${d.name}: ${w}`)).map((w, i) => <p key={i} className="text-3xs text-warning mt-1">⚠ {w}</p>)}
                    </Card>

                    {chart && chart.data.length > 1 && (
                        <Card title="Equity curves" subtitle="Each strategy on its own share of the capital, all of them added together, and the combined book under the account caps.">
                            <div>
                                <ZoomableChart data={chart.data} height={'20rem'} title="Equity curves">
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                        <XAxis dataKey="t" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={v => String(v).slice(5, 10)} minTickGap={40} />
                                        <YAxis width={64} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={v => inr(v, { compact: true })} domain={['auto', 'auto']} />
                                        <Tooltip contentStyle={ct.tooltipStyle ? ct.tooltipStyle({ fontSize: ct.type['3xs'] }) : undefined} labelFormatter={v => istDateTime(v)} formatter={(v, n) => [inr(v), n]} />
                                        <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                                        {chart.series.map((s, si) => (
                                            <Line key={si} type="stepAfter" dataKey={`s${si}`} name={s.name} dot={false} isAnimationActive={false}
                                                stroke={ct.categorical[si % ct.categorical.length]} strokeWidth={si === 0 ? 2.5 : 1.25} strokeDasharray={s.name === 'With account caps' ? '5 3' : undefined} />
                                        ))}
                                    </LineChart>
                                </ZoomableChart>
                            </div>
                        </Card>
                    )}

                    <Card title="How much they overlap" subtitle={`Entries within ${result.overlap?.windowMinutes ?? '—'} minutes of each other, and how their daily P&L moves together. Strategies that enter together on the same side diversify little — and are candidates for a combiner.`}>
                        <DataTable columns={pairCols} rows={(result.overlap?.pairs || []).map((p, i) => ({ ...p, _key: `${i}` }))} empty="Needs two strategies." />
                    </Card>

                    {result.withSharedCaps && result.withSharedCaps.dropped.length > 0 && (
                        <CollapsibleCard title={`Entries the account caps refused (${result.withSharedCaps.dropped.length})`} storageKey="portfolio:dropped" defaultOpen={false}
                            summary={<span className="text-xs text-fg-5">{Object.entries(result.withSharedCaps.droppedByDeployment).map(([k, n]) => `${k} ${n}`).join(' · ')}</span>}>
                            <p className="text-3xs text-fg-5 mb-2">{result.withSharedCaps.note}</p>
                            <DataTable dense maxHeight="20rem" columns={[
                                { key: 'deployment', header: 'Strategy' },
                                { key: 'entryTime', header: 'Entry', render: d => istDateTime(d.entryTime) },
                                { key: 'type', header: 'Side' },
                                { key: 'pnl', header: 'Its P&L', align: 'right', render: d => <span className={pnlTone(d.pnl)}>{inr(d.pnl, { sign: true })}</span> },
                                { key: 'reason', header: 'Refused by', render: d => <span className="whitespace-normal">{d.reason}</span> },
                            ]} rows={result.withSharedCaps.dropped.map((d, i) => ({ ...d, _key: `${i}` }))} />
                        </CollapsibleCard>
                    )}

                    {(result.perDeployment || []).filter(d => d.strategyReport && d.strategyReport.kind === 'signal_combiner').map((d, i) => (
                        <CollapsibleCard key={i} title={`${d.name} — where every member signal went`} storageKey={`portfolio:combiner:${i}`} defaultOpen={false}>
                            <CombinerReport report={d.strategyReport} />
                        </CollapsibleCard>
                    ))}
                </div>
            )}
        </div>
    );
}
