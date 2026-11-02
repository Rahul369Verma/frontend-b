/**
 * The Compare tab's sections, each fed by GET /api/multileg/compare and the helpers in
 * compareFormat.js. Every deployment keeps ONE colour (its slot) in every table and chart.
 *
 *   IdentityCards   who they are: structure, legs, index, mode, status, net and the curve
 *   MetricsTable    results row by row; the best and worst of each ranked row marked
 *   ConfigTable     settings as the engine runs them; rows that differ first-class
 *   ChartsPanel     equity, drawdown, daily P&L, P&L distribution — overlaid, one frame each
 *   BreakdownGrid   exit reasons, entry hour, weekday — a tinted grid
 *   TogetherPanel   correlation, head-to-head on shared days, the selection as one book
 */
import React, { useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { Trophy, X } from 'lucide-react';
import { Chip, ModeChip, Segmented, StatusBadge } from '../../viz/primitives';
import { inr, rupeeTick, istDateTime } from '../../viz/tokens.js';
import { useChartTheme } from '../../../theme/chartTheme.js';
import ZoomableChart from '../../charts/ZoomableChart';
import useRemWidth from '../../../hooks/useRemWidth.js';
import { METRICS, rankRow, configRows, curveRows, histogramRows, diversificationLine, compactRup } from './compareFormat.js';

const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const shortSym = (s) => String(s || '—').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '');
const tone = (v) => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-fg-4');
// computeScorecard's verdicts (backend logic/analytics/multilegScorecard.js)
const VERDICT = {
    'on-track': ['good', 'on track with its backtest'], ahead: ['good', 'ahead of its backtest'], 'below-backtest': ['warning', 'below its backtest'],
    drifting: ['critical', 'drifting from its backtest'], profitable: ['good', 'profitable (no backtest to check)'], bleeding: ['critical', 'losing (no backtest to check)'],
    'too-few': ['info', 'too few trades to judge'], 'no-trades': ['info', 'no trades in this window'],
};

const ageText = (ms) => (ms < 3600e3 ? `${Math.round(ms / 60e3)}m` : ms < 86400e3 ? `${Math.round(ms / 3600e3)}h` : `${Math.round(ms / 86400e3)}d`);
/**
 * An open structure and its last mark. A mark older than 30 minutes says how old it is: with the
 * engines off (or a stopped deployment) the stored mark can be days old, and must not read as now.
 * `now` is when the comparison was fetched (render stays pure; the age is as of that answer).
 */
export function OpenChip({ pos, now }) {
    const at = pos.markedAt ? new Date(pos.markedAt).getTime() : null;
    const age = at != null && Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, now - at) : null;
    const stale = age == null || age > 30 * 60e3;
    const mark = fin(pos.mtmNet) != null ? inr(pos.mtmNet, { dp: 0, sign: true }) : null;
    const title = `${String(pos.state || 'OPEN').toLowerCase()} since ${pos.since ? istDateTime(pos.since) : '—'} · ${at != null ? `last marked ${istDateTime(pos.markedAt)}` : 'never marked'}${stale ? ' — not a current price' : ''}`;
    return (
        <Chip tone={stale ? 'warning' : 'live'} title={title}>
            open{mark ? ` ${mark}` : ''}{stale ? (age == null ? ' · unmarked' : ` · mark ${ageText(age)} old`) : ''}
        </Chip>
    );
}

// Room for a comparison table, in rem so the Text Size setting moves the switch: the label column
// and a readable column per deployment. A narrower panel gets the stacked layout instead — one block
// per row, a line per deployment — rather than a table that only scrolls sideways.
const LABEL_REM = 11, COL_REM = 9;
function useFits(n) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    return [ref, rem == null || rem >= LABEL_REM + n * COL_REM];
}

/** One row of a comparison, stacked: its label, then a line per deployment (colour dot, name, value). */
function StackedRow({ label, title, deps, colors, cell, rowClass = '', lineClass, lineStyle }) {
    return (
        <div className={`border-t border-line-0 py-1.5 ${rowClass}`}>
            <div className="text-2xs text-fg-4" title={title}>{label}</div>
            <ul className="mt-0.5 space-y-0.5">
                {deps.map((d, i) => (
                    <li key={d.id} className={`flex items-center justify-between gap-2 text-2xs rounded px-1 ${lineClass ? lineClass(i) : ''}`} style={lineStyle ? lineStyle(i) : undefined}>
                        {/* the name gives way (truncates); the value keeps its width and wraps only at spaces */}
                        <span className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[i] }} aria-hidden="true" />
                            <span className="truncate opacity-80" title={d.name}>{d.name}</span>
                        </span>
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-1 tabular-nums text-right flex-shrink-0 max-w-[65%]">{cell(d, i)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
const GroupHead = ({ children }) => <h4 className="pt-2.5 pb-1 text-4xs uppercase tracking-wider text-fg-5 font-semibold">{children}</h4>;

/** A name cell header used by the tables: colour dot + name, sticky at the top. */
function DepHead({ d, color }) {
    return (
        <th scope="col" className="px-2 py-1.5 text-left font-semibold text-fg-2 align-bottom min-w-[9rem] max-w-[14rem]">
            <span className="flex items-start gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ background: color }} aria-hidden="true" />
                <span className="break-words leading-snug" title={d.name}>{d.name}</span>
            </span>
        </th>
    );
}

// ── identity cards ───────────────────────────────────────────────────────────
export function IdentityCards({ deps, colors, wins, ranked, onRemove, asOf }) {
    const ct = useChartTheme();
    const top = Math.max(0, ...wins);
    return (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(15rem, 100%), 1fr))' }} data-testid="compare-cards">
            {deps.map((d, i) => {
                const r = d.results || {};
                const v = VERDICT[r.verdict] || null;
                const curve = (d.daily || []).map((x) => ({ day: x.day, y: x.equity }));
                return (
                    <article key={d.id} className="relative rounded-lg border border-line/60 bg-surface p-3 flex flex-col gap-2 min-w-0" style={{ borderLeft: `4px solid ${colors[i]}` }}>
                        <header className="flex items-start justify-between gap-2 min-w-0">
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-fg break-words">{d.name}</h3>
                                <div className="flex flex-wrap items-center gap-1 mt-1">
                                    {/* the structure's name can be long ("Zone Strangle (market-implied strikes)"): a chip that wraps */}
                                    <span title="Structure" className="inline-flex px-1.5 py-px rounded border text-3xs font-medium bg-card-2 text-fg-4 border-line-0 break-words min-w-0">{d.templateName || d.template || '—'}</span>
                                    <Chip title="Index">{shortSym(d.symbol)}</Chip>
                                    {d.tradeMode && <ModeChip mode={d.tradeMode} />}
                                    {d.status !== 'ACTIVE' && <Chip tone={d.status === 'DELETED' ? 'warning' : 'muted'}>{String(d.status).toLowerCase()}</Chip>}
                                    {d.position && <OpenChip pos={d.position} now={asOf} />}
                                </div>
                            </div>
                            {onRemove && (
                                <button type="button" onClick={() => onRemove(d.id)} className="p-1 rounded text-fg-5 hover:text-danger flex-shrink-0" aria-label={`Remove ${d.name}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
                            )}
                        </header>
                        {d.legs?.length > 0 && <div className="text-3xs font-mono text-fg-4 break-words">{d.legs.join(' · ')}{d.intraday === false ? ' · positional' : d.intraday ? ' · intraday' : ''}</div>}
                        <div className="h-10" aria-hidden="true">
                            {curve.length > 1 ? (
                                <ResponsiveContainer width="100%" height={40}>
                                    <AreaChart data={curve} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                                        <ReferenceLine y={0} stroke={ct.axis} strokeOpacity={0.4} />
                                        <Area type="monotone" dataKey="y" baseValue={0} stroke={colors[i]} fill={colors[i]} fillOpacity={0.14} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : <span className="text-3xs text-fg-5">Fewer than two trading days — no curve yet.</span>}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-2xs">
                            <div><div className="text-4xs uppercase tracking-wide text-fg-5">Net</div><div className={`text-sm font-semibold tabular-nums ${tone(r.net)}`}>{r.trades ? inr(r.net, { dp: 0, sign: true }) : '—'}</div></div>
                            <div><div className="text-4xs uppercase tracking-wide text-fg-5">Per trade</div><div className={`tabular-nums ${tone(r.perTrade)}`}>{r.perTrade != null ? inr(r.perTrade, { dp: 0, sign: true }) : '—'}</div></div>
                            <div><div className="text-4xs uppercase tracking-wide text-fg-5">Trades · win</div><div className="tabular-nums text-fg-3">{r.trades ?? 0}{r.winRate != null ? ` · ${r.winRate}%` : ''}</div></div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-line-0 pt-2">
                            {v && <StatusBadge level={v[0]}>{v[1]}</StatusBadge>}
                            {ranked > 0 && wins[i] === top && top > 0 && deps.length > 1 && (
                                <span className="inline-flex items-center gap-1 text-3xs text-warning" title="Leads on the most ranked rows of the results table"><Trophy className="w-3 h-3" aria-hidden="true" />leads on {wins[i]} of {ranked}</span>
                            )}
                            {(ranked > 0 && !(wins[i] === top && top > 0)) && deps.length > 1 && <span className="text-3xs text-fg-5">leads on {wins[i]} of {ranked}</span>}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}

// ── results table ────────────────────────────────────────────────────────────
export function MetricsTable({ deps, colors }) {
    const [bars, setBars] = useState(true);
    const [ref, fits] = useFits(deps.length);
    const groups = [...new Set(METRICS.map((m) => m.group))];
    const valueTone = (m, v) => (m.key === 'net' || m.key === 'perTrade' || m.key === 'gap' ? tone(v) : 'text-fg-2');
    const marks = (isBest, isWorst) => (
        <>
            {isBest && <span className="text-success" aria-label="best">▲</span>}
            {isWorst && <span className="text-danger" aria-label="worst">▼</span>}
        </>
    );
    return (
        <div className="space-y-2" ref={ref}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-3xs text-fg-5">
                <span><span className="text-success font-semibold">▲ best</span> and <span className="text-danger font-semibold">▼ worst</span> of each row that can be ranked; hover a label for what it measures.</span>
                {fits && <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={bars} onChange={(e) => setBars(e.target.checked)} className="accent-sky-500" />bars</label>}
            </div>
            {!fits ? (
                <div data-testid="compare-metrics-stacked">
                    {groups.map((g) => (
                        <section key={g}>
                            <GroupHead>{g}</GroupHead>
                            {METRICS.filter((m) => m.group === g).map((m) => {
                                const vals = deps.map(m.get);
                                const { best, worst } = rankRow(vals, m.better);
                                return (
                                    <StackedRow key={m.key} label={m.label} title={m.help || undefined} deps={deps} colors={colors}
                                        lineClass={(i) => (best.has(i) ? 'bg-success/10 font-semibold' : worst.has(i) ? 'bg-danger/10' : '')}
                                        cell={(d, i) => <>{marks(best.has(i), worst.has(i))}<span className={valueTone(m, vals[i])}>{m.fmt(vals[i])}</span></>} />
                                );
                            })}
                        </section>
                    ))}
                </div>
            ) : (
            <div className="overflow-x-auto rounded border border-line-0">
                <table className="w-full text-2xs text-fg-3 border-collapse" data-testid="compare-metrics">
                    <thead className="bg-card-2/60">
                        <tr>
                            <th scope="col" className="sticky left-0 z-10 bg-card-2 px-2 py-1.5 text-left font-semibold text-fg-5 min-w-[11rem]">Result</th>
                            {deps.map((d, i) => <DepHead key={d.id} d={d} color={colors[i]} />)}
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map((g) => (
                            <React.Fragment key={g}>
                                <tr><th colSpan={deps.length + 1} scope="colgroup" className="sticky left-0 bg-surface px-2 pt-2.5 pb-1 text-left text-4xs uppercase tracking-wider text-fg-5 font-semibold">{g}</th></tr>
                                {METRICS.filter((m) => m.group === g).map((m) => {
                                    const vals = deps.map(m.get);
                                    const { best, worst } = rankRow(vals, m.better);
                                    const maxAbs = Math.max(0, ...vals.filter((v) => v != null).map(Math.abs));
                                    return (
                                        <tr key={m.key} className="border-t border-line-0 hover:bg-slate-800/30">
                                            <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal text-fg-4" title={m.help || undefined}>
                                                {m.label}{m.help && <span className="text-fg-5"> ⓘ</span>}
                                            </th>
                                            {vals.map((v, i) => {
                                                const isBest = best.has(i), isWorst = worst.has(i);
                                                return (
                                                    <td key={deps[i].id} className={`px-2 py-1 text-right tabular-nums ${isBest ? 'bg-success/10 font-semibold' : isWorst ? 'bg-danger/10' : ''}`}>
                                                        <span className="inline-flex items-center gap-1 justify-end">
                                                            {marks(isBest, isWorst)}
                                                            <span className={valueTone(m, v)}>{m.fmt(v)}</span>
                                                        </span>
                                                        {bars && v != null && maxAbs > 0 && m.better && (
                                                            <span className="block h-1 mt-0.5 rounded-full bg-line-0 overflow-hidden" aria-hidden="true">
                                                                <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (Math.abs(v) / maxAbs) * 100)}%`, background: colors[i], opacity: 0.75 }} />
                                                            </span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            )}
            {deps.some((d) => (d.results?.trades ?? 0) < 20) && (
                <p className="text-3xs text-fg-5">Some columns have fewer than 20 trades: their figures are real, but a lead between small samples can be luck.</p>
            )}
        </div>
    );
}

// ── settings ─────────────────────────────────────────────────────────────────
export function ConfigTable({ deps, colors, groups }) {
    const [onlyDiff, setOnlyDiff] = useState(true);
    const [ref, fits] = useFits(deps.length);
    const rows = useMemo(() => configRows(deps, groups), [deps, groups]);
    const differing = rows.filter((r) => r.differs).length;
    const shown = onlyDiff && deps.length > 1 ? rows.filter((r) => r.differs) : rows;
    const groupLabel = new Map((groups || []).map((g) => [g.id, g.label]));
    const head = [
        { label: 'Structure', cell: (d) => d.templateName || d.template || '—' },
        { label: 'Legs', cell: (d) => (d.legs?.length ? d.legs.join(' · ') : '—'), mono: true },
        { label: 'Index', cell: (d) => shortSym(d.symbol) },
        { label: 'Entry trigger', cell: (d) => (d.entryMode === 'signal' ? `signal: ${d.signalStrategy || '—'}` : d.entryMode === 'time' ? 'time' : '—') },
        { label: 'Mode · status', cell: (d) => `${d.tradeMode || '—'} · ${String(d.status || '—').toLowerCase()}` },
        { label: 'Deployed', cell: (d) => (d.createdAt ? istDateTime(d.createdAt) : '—') },
        { label: 'Edited', cell: (d) => (d.edits ? `${d.edits} time${d.edits === 1 ? '' : 's'}${d.editedAt ? `, last ${istDateTime(d.editedAt)}` : ''}` : 'never') },
    ];
    const cellTitle = (c) => (c ? (c.from === 'unset' ? 'not set — the engine\'s own fallback applies' : c.overridden ? `the structure's default is ${c.defaultDisplay}` : c.from === 'template' ? 'the structure\'s default' : 'set on the deployment') : 'not set on this deployment');
    const cellBody = (c) => (
        <>
            {c && c.display != null ? c.display : <span className="text-fg-5">—</span>}
            {c && c.overridden && <span className="text-warning ml-1" aria-label={`differs from the default ${c.defaultDisplay}`}>●</span>}
        </>
    );
    return (
        <div className="space-y-2" ref={ref}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-3xs text-fg-5">
                <span>
                    Settings as the engine runs them: the structure&apos;s defaults, then each deployment&apos;s own values.
                    {' '}<span className="text-warning">●</span> differs from the structure&apos;s default.
                    {deps.length > 1 && <> <b className="text-fg-3">{differing}</b> of {rows.length} settings differ.</>}
                </span>
                {deps.length > 1 && (
                    <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="accent-sky-500" />only the differences</label>
                )}
            </div>
            {!fits ? (
                <div data-testid="compare-config-stacked">
                    {head.map((h) => (
                        <StackedRow key={h.label} label={h.label} deps={deps} colors={colors}
                            cell={(d) => <span className={`text-fg-2 ${h.mono ? 'font-mono text-3xs' : ''}`}>{h.cell(d)}</span>} />
                    ))}
                    {shown.map((r, ri) => (
                        <React.Fragment key={r.key}>
                            {(ri === 0 || shown[ri - 1].group !== r.group) && <GroupHead>{groupLabel.get(r.group) || r.group}</GroupHead>}
                            <StackedRow label={r.label} title={[r.help, `key: ${r.key}`].filter(Boolean).join(' — ')} deps={deps} colors={colors}
                                rowClass={r.differs ? 'bg-warning/5 border-l-2 border-l-warning pl-1.5' : ''}
                                cell={(d, i) => <span className="text-fg-2" title={cellTitle(r.cells[i])}>{cellBody(r.cells[i])}</span>} />
                        </React.Fragment>
                    ))}
                    {shown.length === 0 && <p className="text-2xs text-fg-5 py-2">Every setting is the same — they differ only in structure, index or mode above.</p>}
                </div>
            ) : (
            <div className="overflow-x-auto rounded border border-line-0">
                <table className="w-full text-2xs text-fg-3 border-collapse" data-testid="compare-config">
                    <thead className="bg-card-2/60">
                        <tr>
                            <th scope="col" className="sticky left-0 z-10 bg-card-2 px-2 py-1.5 text-left font-semibold text-fg-5 min-w-[11rem]">Setting</th>
                            {deps.map((d, i) => <DepHead key={d.id} d={d} color={colors[i]} />)}
                        </tr>
                    </thead>
                    <tbody>
                        {head.map((h) => (
                            <tr key={h.label} className="border-t border-line-0">
                                <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal text-fg-4">{h.label}</th>
                                {deps.map((d) => <td key={d.id} className={`px-2 py-1 text-fg-2 break-words ${h.mono ? 'font-mono text-3xs' : ''}`}>{h.cell(d)}</td>)}
                            </tr>
                        ))}
                        {shown.map((r, ri) => {
                            const groupRow = ri === 0 || shown[ri - 1].group !== r.group ? ((
                                <tr key={`g-${r.group}`}><th colSpan={deps.length + 1} scope="colgroup" className="sticky left-0 bg-surface px-2 pt-2.5 pb-1 text-left text-4xs uppercase tracking-wider text-fg-5 font-semibold">{groupLabel.get(r.group) || r.group}</th></tr>
                            )) : null;
                            return (
                                <React.Fragment key={r.key}>
                                    {groupRow}
                                    <tr className={`border-t border-line-0 ${r.differs ? 'bg-warning/5' : ''}`}>
                                        <th scope="row" className={`sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal ${r.differs ? 'text-fg-2 border-l-2 border-warning' : 'text-fg-4'}`} title={[r.help, `key: ${r.key}`].filter(Boolean).join(' — ')}>{r.label}</th>
                                        {r.cells.map((c, i) => (
                                            <td key={deps[i].id} className="px-2 py-1 tabular-nums text-fg-2" title={cellTitle(c)}>{cellBody(c)}</td>
                                        ))}
                                    </tr>
                                </React.Fragment>
                            );
                        })}
                        {shown.length === 0 && (
                            <tr><td colSpan={deps.length + 1} className="px-2 py-3 text-center text-fg-5">Every setting is the same — they differ only in structure, index or mode above.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            )}
        </div>
    );
}

// ── charts ───────────────────────────────────────────────────────────────────
const CHARTS = [
    { v: 'equity', label: 'Equity' }, { v: 'drawdown', label: 'Drawdown' }, { v: 'daily', label: 'Daily P&L' }, { v: 'dist', label: 'P&L distribution' },
];
export function ChartsPanel({ data, deps, colors }) {
    const ct = useChartTheme();
    const [view, setView] = useState('equity');
    const [combined, setCombined] = useState(deps.length > 1);
    const rows = useMemo(() => curveRows(deps, data.combined), [deps, data.combined]);
    const hist = useMemo(() => histogramRows(data.distribution, deps), [data.distribution, deps]);
    const tick = { fontSize: ct.type['5xs'], fill: ct.text.secondary };
    const tip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    const nameOf = Object.fromEntries(deps.map((d) => [d.id, d.name]));
    const fmtTip = (v, key) => [v == null ? '—' : inr(v, { dp: 0 }), String(key)];
    if (!rows.length) return <p className="text-xs text-fg-5">No closed trades in this window, so there is nothing to chart.</p>;
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Segmented options={CHARTS} value={view} onChange={setView} />
                {(view === 'equity' || view === 'drawdown') && deps.length > 1 && (
                    <label className="inline-flex items-center gap-1 text-3xs text-fg-4 cursor-pointer"><input type="checkbox" checked={combined} onChange={(e) => setCombined(e.target.checked)} className="accent-sky-500" />all of them as one book</label>
                )}
            </div>
            {(view === 'equity' || view === 'drawdown') && (
                <ZoomableChart data={rows} height="18rem" title={view === 'equity' ? 'Compare — equity' : 'Compare — drawdown'}>
                    <LineChart margin={{ top: 8, right: 12, bottom: 2, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                        <XAxis dataKey="label" tick={tick} minTickGap={24} />
                        <YAxis width={58} tick={tick} tickFormatter={rupeeTick} />
                        <Tooltip contentStyle={tip} formatter={fmtTip} labelFormatter={(l, p) => p?.[0]?.payload?.day || l} />
                        <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                        <ReferenceLine y={0} stroke={ct.axis} />
                        {deps.map((d, i) => (
                            <Line key={d.id} type="linear" dataKey={`${view === 'equity' ? 'eq' : 'dd'}_${d.id}`} name={nameOf[d.id]} stroke={colors[i]} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                        ))}
                        {combined && deps.length > 1 && (
                            <Line type="linear" dataKey={`${view === 'equity' ? 'eq' : 'dd'}_combined`} name="all together" stroke={ct.text.primary} strokeDasharray="5 3" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                        )}
                    </LineChart>
                </ZoomableChart>
            )}
            {view === 'daily' && (
                <ZoomableChart data={rows} height="18rem" title="Compare — daily P&L">
                    <BarChart margin={{ top: 8, right: 12, bottom: 2, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                        <XAxis dataKey="label" tick={tick} minTickGap={24} />
                        <YAxis width={58} tick={tick} tickFormatter={rupeeTick} />
                        <Tooltip contentStyle={tip} formatter={fmtTip} labelFormatter={(l, p) => p?.[0]?.payload?.day || l} />
                        <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                        <ReferenceLine y={0} stroke={ct.axis} />
                        {deps.map((d, i) => <Bar key={d.id} dataKey={`net_${d.id}`} name={nameOf[d.id]} fill={colors[i]} isAnimationActive={false} />)}
                    </BarChart>
                </ZoomableChart>
            )}
            {view === 'dist' && (
                <>
                    <ZoomableChart data={hist} height="18rem" title="Compare — P&L distribution">
                        <BarChart margin={{ top: 8, right: 12, bottom: 2, left: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                            <XAxis dataKey="label" tick={tick} interval={0} angle={-25} textAnchor="end" height={46} />
                            <YAxis width={36} tick={tick} allowDecimals={false} />
                            <Tooltip contentStyle={tip} formatter={(v, k) => [`${v} trade${v === 1 ? '' : 's'}`, k]} />
                            <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                            {deps.map((d, i) => <Bar key={d.id} dataKey={`n_${d.id}`} name={nameOf[d.id]} fill={colors[i]} isAnimationActive={false} />)}
                        </BarChart>
                    </ZoomableChart>
                    <div className="overflow-x-auto">
                        <table className="text-3xs text-fg-4 tabular-nums">
                            <thead><tr className="text-fg-5"><th className="text-left pr-3 font-normal">Per trade</th>{['min', 'p10', 'p25', 'median', 'p75', 'p90', 'max'].map((k) => <th key={k} className="px-2 text-right font-normal">{k}</th>)}</tr></thead>
                            <tbody>
                                {deps.map((d, i) => {
                                    const qv = data.distribution?.byId?.[d.id]?.quantiles;
                                    return (
                                        <tr key={d.id} className="border-t border-line-0">
                                            <td className="pr-3 py-0.5"><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors[i] }} aria-hidden="true" />{d.name}</td>
                                            {['min', 'p10', 'p25', 'median', 'p75', 'p90', 'max'].map((k) => <td key={k} className={`px-2 text-right ${tone(qv?.[k])}`}>{qv ? compactRup(qv[k]) : '—'}</td>)}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <p className="text-4xs text-fg-5 mt-1">One set of buckets for all ({compactRup(data.distribution?.clippedAt?.low)} to {compactRup(data.distribution?.clippedAt?.high)}, the 2nd–98th percentile of every trade); a trade beyond them falls in the end bucket.</p>
                    </div>
                </>
            )}
        </div>
    );
}

// ── breakdowns ───────────────────────────────────────────────────────────────
const BREAKDOWNS = [{ v: 'exitReasons', label: 'Exit reasons' }, { v: 'entryHour', label: 'Entry hour (IST)' }, { v: 'weekday', label: 'Weekday' }];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function BreakdownGrid({ deps, colors }) {
    const ct = useChartTheme();
    const [view, setView] = useState('exitReasons');
    const [ref, fits] = useFits(deps.length);
    const keys = useMemo(() => {
        const ks = [];
        for (const d of deps) for (const r of d.breakdowns?.[view] || []) if (!ks.includes(r.key)) ks.push(r.key);
        // hours sort as text ("09:00" < "14:00"); weekdays keep the week's order; exit reasons as the server ranked them
        if (view === 'entryHour') return ks.sort();
        if (view === 'weekday') return ks.sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b));
        return ks;
    }, [deps, view]);
    const cell = (d, k) => (d.breakdowns?.[view] || []).find((r) => r.key === k) || null;
    const maxAbs = Math.max(1, ...deps.flatMap((d) => (d.breakdowns?.[view] || []).map((r) => Math.abs(r.net))));
    // the theme's diverging ramp (as the app's other heat tables), and ink that stays legible on it
    const paint = (v) => {
        if (v == null || v === 0) return {};
        const bg = ct.divergingRgba(v, maxAbs);
        return { background: bg, color: ct.ink(bg) };
    };
    const cellTitle = (c) => (c ? `${c.n} trade${c.n === 1 ? '' : 's'} · net ${inr(c.net, { dp: 0, sign: true })} · ${inr(c.perTrade, { dp: 0, sign: true })} per trade · ${c.winRate}% win` : 'no trades');
    return (
        <div className="space-y-2" ref={ref}>
            <Segmented options={BREAKDOWNS} value={view} onChange={setView} />
            {keys.length === 0 ? <p className="text-xs text-fg-5">No closed trades in this window.</p> : !fits ? (
                <div data-testid="compare-breakdown-stacked">
                    {keys.map((k) => (
                        <StackedRow key={k} label={k} deps={deps} colors={colors}
                            lineStyle={(i) => paint(cell(deps[i], k)?.net)}
                            cell={(d) => {
                                const c = cell(d, k);
                                return c
                                    ? <span title={cellTitle(c)}><b>{inr(c.net, { dp: 0, sign: true })}</b> <span className="text-4xs opacity-80">{c.n} · {c.winRate}% win</span></span>
                                    : <span className="text-fg-5">—</span>;
                            }} />
                    ))}
                </div>
            ) : (
                <div className="overflow-x-auto rounded border border-line-0">
                    <table className="w-full text-2xs border-collapse" data-testid="compare-breakdown">
                        <thead className="bg-card-2/60">
                            <tr>
                                <th scope="col" className="sticky left-0 z-10 bg-card-2 px-2 py-1.5 text-left font-semibold text-fg-5 min-w-[9rem]">{BREAKDOWNS.find((b) => b.v === view).label}</th>
                                {deps.map((d, i) => <DepHead key={d.id} d={d} color={colors[i]} />)}
                            </tr>
                        </thead>
                        <tbody>
                            {keys.map((k) => (
                                <tr key={k} className="border-t border-line-0">
                                    <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal text-fg-3 break-words">{k}</th>
                                    {deps.map((d) => {
                                        const c = cell(d, k);
                                        return (
                                            <td key={d.id} className="px-2 py-1 tabular-nums" style={paint(c?.net)} title={cellTitle(c)}>
                                                {c ? (
                                                    <>
                                                        <span className="block font-semibold">{inr(c.net, { dp: 0, sign: true })}</span>
                                                        <span className="block text-4xs opacity-80">{c.n} · {c.winRate}% win</span>
                                                    </>
                                                ) : <span className="text-fg-5">—</span>}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="text-3xs text-fg-5">Each cell: net, then trades and win rate. Shaded in the theme&apos;s gain or loss colour; the stronger the shade, the larger the amount. Hover a cell for per trade.</p>
        </div>
    );
}

// ── together ─────────────────────────────────────────────────────────────────
export function TogetherPanel({ data, deps, colors }) {
    const ct = useChartTheme();
    const idx = new Map(deps.map((d, i) => [d.id, i]));
    const pair = (a, b) => data.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    const c = data.combined;
    // moving together is the risk, so a high correlation takes the LOSS pole and an offsetting pair the gain pole
    const corrPaint = (r) => {
        if (r == null || r === 0) return {};
        const bg = ct.divergingRgba(-r, 1);
        return { background: bg, color: ct.ink(bg) };
    };
    if (deps.length < 2) return <p className="text-xs text-fg-5">Pick two or more deployments to see how they behave together.</p>;
    return (
        <div className="space-y-4">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(10rem, 100%), 1fr))' }}>
                <div className="rounded border border-line-0 p-2"><div className="text-4xs uppercase tracking-wide text-fg-5">All of them as one book</div><div className={`text-base font-semibold tabular-nums ${tone(c.net)}`}>{inr(c.net, { dp: 0, sign: true })}</div></div>
                <div className="rounded border border-line-0 p-2"><div className="text-4xs uppercase tracking-wide text-fg-5">Its worst drawdown</div><div className="text-base font-semibold tabular-nums text-danger">{inr(c.maxDrawdown, { dp: 0 })}</div></div>
                <div className="rounded border border-line-0 p-2"><div className="text-4xs uppercase tracking-wide text-fg-5">Their drawdowns added up</div><div className="text-base tabular-nums text-fg-3">{inr(c.sumOfMemberDrawdowns, { dp: 0 })}</div></div>
                <div className="rounded border border-line-0 p-2"><div className="text-4xs uppercase tracking-wide text-fg-5">Up days · down days</div><div className="text-base tabular-nums text-fg-3">{c.upDays} · {c.downDays}</div></div>
            </div>
            {diversificationLine(c) && <p className="text-xs text-fg-3">{diversificationLine(c)}</p>}

            <div className="space-y-1">
                <h4 className="text-xs font-semibold text-fg-2">Do they win and lose on the same days?</h4>
                <div className="overflow-x-auto">
                    <table className="text-2xs border-collapse" data-testid="compare-correlation">
                        <thead>
                            <tr>
                                <th className="sticky left-0 bg-surface" />
                                {deps.map((d, i) => <th key={d.id} scope="col" className="px-1.5 py-1 font-normal text-fg-5" title={d.name}><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colors[i] }} aria-label={d.name} /></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {deps.map((a, i) => (
                                <tr key={a.id}>
                                    <th scope="row" className="sticky left-0 bg-surface pr-2 py-1 text-left font-normal text-fg-4 max-w-[12rem] truncate" title={a.name}>
                                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors[i] }} aria-hidden="true" />{a.name}
                                    </th>
                                    {deps.map((b) => {
                                        if (a.id === b.id) return <td key={b.id} className="w-14 h-9 text-center text-fg-5 border border-line-0">—</td>;
                                        const p = pair(a.id, b.id);
                                        return (
                                            <td key={b.id} className="w-14 h-9 text-center tabular-nums border border-line-0" style={corrPaint(p?.correlation)}
                                                title={p ? (p.correlation == null ? `only ${p.overlapDays} shared trading day(s) — needs ${data.minOverlap} for a correlation` : `${p.overlapDays} shared days · correlation ${p.correlation} · same direction on ${p.sameDirectionPct}% of them`) : ''}>
                                                {p?.correlation == null ? <span className="text-fg-5 text-4xs">{p ? `${p.overlapDays}d` : '—'}</span> : <span className="font-semibold">{Number(p.correlation).toFixed(2)}</span>}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-3xs text-fg-5">Correlation of daily P&L over the days both traded: near +1 they move together (no protection), near 0 or below they offset each other. A pair needs {data.minOverlap} shared days for a number; otherwise the cell shows how many there were.</p>
            </div>

            <div className="space-y-1">
                <h4 className="text-xs font-semibold text-fg-2">Head to head, on the days both traded</h4>
                <ul className="space-y-1">
                    {data.pairs.map((p) => {
                        const A = deps[idx.get(p.a)], B = deps[idx.get(p.b)];
                        if (!A || !B) return null;
                        const lead = p.aWins === p.bWins ? null : p.aWins > p.bWins ? A : B;
                        return (
                            <li key={`${p.a}-${p.b}`} className="text-2xs text-fg-3 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: colors[idx.get(p.a)] }} aria-hidden="true" />{A.name}</span>
                                <span className="text-fg-5">vs</span>
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: colors[idx.get(p.b)] }} aria-hidden="true" />{B.name}</span>
                                <span className="text-fg-5">—</span>
                                {p.overlapDays
                                    ? <span>{p.overlapDays} shared day{p.overlapDays === 1 ? '' : 's'}: <b className="tabular-nums">{p.aWins}</b>–<b className="tabular-nums">{p.bWins}</b>{p.ties ? ` (${p.ties} tied)` : ''}{lead ? `, ${lead.name} ahead more often` : ', level'} · on those days {inr(p.aNet, { dp: 0, sign: true })} vs {inr(p.bNet, { dp: 0, sign: true })}{p.correlation != null ? ` · correlation ${Number(p.correlation).toFixed(2)}` : ''}</span>
                                    : <span className="text-fg-5">never traded on the same day</span>}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
