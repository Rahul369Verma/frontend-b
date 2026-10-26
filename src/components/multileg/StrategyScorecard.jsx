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
 *   LIVE CHECK  (23-Oct-2026) per row: the Go-Live page's own evidence checks plus four quality
 *               checks, with consistency (the single-leg backtest's score), return on margin,
 *               worst trade and t — and FILTERS / sorts over all of them (scorecardFilters.js).
 *               Filters and chosen columns are remembered per browser; hidden rows are counted.
 *
 * Layout follows the panel's width in rem (useRemWidth): every chosen column when there is
 * room, the low-priority ones folded into Details when narrower, cards when narrower still —
 * so a larger Text Size moves the switch points.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import NewTabLink from '../NewTabLink.jsx';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { ROUTES } from '../../config/routes.js';
import { Chip, Panel } from '../viz/primitives';
import { pnlTone, rupeeTick } from '../viz/tokens';
import { useChartTheme } from '../../theme/chartTheme.js';
import useRemWidth from '../../hooks/useRemWidth';
import { fmt, num, rup, shortSym } from './builderFormat';
import DocLink from '../DocLink.jsx';
import useLocalStorage from '../../hooks/useLocalStorage';
import ConsistencyPanel from '../viz/ConsistencyPanel.jsx';
import { consistencyText, consistencyVerdict } from '../viz/consistencyFormat.js';
import {
    DEFAULT_FILTERS, LIVE_CANDIDATES, NUMBER_FILTERS, SORTS, activeFilterCount, normaliseFilters, passes, sortRows,
} from './scorecardFilters.js';

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
                                    <td className="py-1 pr-3"><Link to={deploymentHref(r.deploymentId)} className="text-primary-ink hover:underline">{r.name}</Link><NewTabLink href={deploymentHref(r.deploymentId)} label={r.name} className="ml-0.5 align-middle" /></td>
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

// ── Ready for live? ─────────────────────────────────────────────────────────

const STATUS_MARK = { pass: ['✓', 'text-success'], fail: ['✗', 'text-danger'], warn: ['!', 'text-warning'], unknown: ['?', 'text-fg-5'] };
const READY_TEXT = { live: ['LIVE', 'live'], ready: ['Ready', 'good'], 'not-ready': ['Not yet', 'neutral'] };

function readinessSentence(rd) {
    if (!rd) return 'No checks for this row.';
    if (rd.status === 'live') return 'LIVE — this deployment already trades real money.';
    if (rd.status === 'ready') return 'Ready for go-live: every required evidence check the Go-Live page makes passes.';
    const n = rd.failing.length;
    return `Not ready for go-live: ${n} required check${n === 1 ? '' : 's'} fail${n === 1 ? 's' : ''} — ${rd.failing.join('; ')}. Promoting it now would need an override.`;
}

/** The Live check cell: Ready / Not yet · passed/total / LIVE — a button that opens the row's details. */
function LiveCheck({ r, open, onToggle }) {
    const rd = r.readiness;
    if (!rd) return <span className="text-fg-5">—</span>;
    const [word, tone] = READY_TEXT[rd.status] || READY_TEXT['not-ready'];
    const label = rd.status === 'live' ? word : `${word} · ${rd.passed}/${rd.total}`;
    return (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`Live check for ${r.name}: ${label}. ${open ? 'Hide' : 'Show'} details`}
            className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <Chip tone={tone} title={readinessSentence(rd)}>{label}</Chip>
        </button>
    );
}

function Checklist({ checks }) {
    return (
        <ul className="space-y-1.5">
            {checks.map(c => {
                const [mark, tone] = STATUS_MARK[c.status] || STATUS_MARK.unknown;
                return (
                    <li key={c.id} className="flex gap-2 text-2xs">
                        <span className={`w-3 shrink-0 font-bold ${tone}`} aria-hidden="true">{mark}</span>
                        <div className="min-w-0">
                            <div className="text-fg-2"><span className="sr-only">{c.status}: </span>{c.title}{c.level === 'soft' && <span className="text-fg-5"> · required</span>}</div>
                            <div className="text-fg-4 break-words">{c.have} <span className="text-fg-5">— needs {c.need}</span></div>
                            {c.fix && <div className="text-fg-5">{c.fix}</div>}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

const signedRup = (v) => (v == null ? '—' : rup(v));
function marginText(r) {
    if (!r.margin) return 'not recorded';
    return `${rup(r.margin.perLot)} per lot · ${r.margin.basis === 'span' ? 'broker SPAN' : 'estimate (ran ~2× the broker for naked shorts)'}`;
}

/** Everything behind the row: the checklist, the figures, and where the profit came from. */
function RowDetail({ r, windowed, wide }) {
    const rd = r.readiness;
    const evidence = (rd?.checks || []).filter(c => c.group === 'evidence');
    const quality = (rd?.checks || []).filter(c => c.group === 'quality');
    const figures = [
        ['Worst trade', signedRup(r.worstTrade), pnlTone(r.worstTrade)],
        ['Best trade', signedRup(r.bestTrade), pnlTone(r.bestTrade)],
        ['Average win / loss', `${signedRup(r.avgWin)} / ${signedRup(r.avgLoss)}`, ''],
        ['Profit factor', r.profitFactor == null ? '—' : r.profitFactor.toFixed(2), ''],
        ['t (edge ÷ noise)', r.tStat == null ? '—' : r.tStat.toFixed(2), ''],
        ['Net ÷ worst drawdown', r.recovery == null ? '—' : `${r.recovery.toFixed(1)}×`, ''],
        ['Days traded', String(r.daysTraded ?? '—'), ''],
        ['Margin', marginText(r), ''],
        ['Return ÷ margin', r.romPct == null ? '—' : `${r.romPct.toFixed(2)}% per trade`, pnlTone(r.romPct)],
        ['Charges ÷ gross', r.costPct == null ? (r.trades ? 'losing before costs' : '—') : `${r.costPct}% (₹${fmt(r.charges)} of ₹${fmt(r.gross)})`, costTone(r.costPct)],
    ];
    return (
        <div className={`grid gap-4 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`} data-testid={`detail-${r.deploymentId || r.name}`}>
            <section className="min-w-0 space-y-2">
                <h4 className="text-xs font-semibold text-fg-2">{readinessSentence(rd)}</h4>
                {windowed && <p className="text-3xs text-warning">Judged on the trades in this date window. The Go-Live page judges the whole paper record.</p>}
                <h5 className="text-2xs font-semibold text-fg-4 uppercase tracking-wide">Go-live evidence — the Go-Live page's own checks</h5>
                <Checklist checks={evidence} />
                <h5 className="text-2xs font-semibold text-fg-4 uppercase tracking-wide pt-1">Quality</h5>
                <Checklist checks={quality} />
                <p className="text-3xs text-fg-5">
                    Broker checks (login, IP whitelist, funds, a drill) are on the <Link to={ROUTES.goLive} className="text-primary-ink hover:underline">Go-Live page</Link>, where promotion happens.
                </p>
            </section>
            <section className="min-w-0 space-y-3">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
                    {figures.map(([k, v, tone]) => (
                        <div key={k} className="min-w-0"><dt className="text-fg-5">{k}</dt><dd className={`text-fg-3 tabular-nums break-words ${tone}`}>{v}</dd></div>
                    ))}
                </dl>
                <ConsistencyPanel data={r.consistency} />
            </section>
        </div>
    );
}

// ── Columns ─────────────────────────────────────────────────────────────────
// `p: 2` columns give way first when the panel is narrow (useRemWidth); each is still in Details.

const COLUMNS = [
    { k: 'verdict', label: 'Verdict', left: true, on: true, title: 'Live vs the backtest it was deployed from — no verdict on too few trades' },
    { k: 'ready', label: 'Live check', sort: 'ready', left: true, on: true, title: 'The Go-Live page\'s evidence checks plus four quality checks. Click one for the list.' },
    { k: 'trades', label: 'Trades', sort: 'trades', on: true },
    { k: 'net', label: 'Net', sort: 'net', on: true },
    { k: 'perTrade', label: 'Per trade', sort: 'perTrade', on: true },
    { k: 'gap', label: 'vs backtest /trade', sort: 'gap', p: 2, on: true },
    { k: 'consistency', label: 'Consistency', sort: 'consistency', on: true, title: '0–100: profitable periods × how straight the equity line is (the single-leg backtest\'s score)' },
    { k: 'winRate', label: 'Win%', sort: 'winRate', on: true },
    { k: 'profitFactor', label: 'PF', sort: 'profitFactor', on: true, title: 'Profit factor: gross wins ÷ gross losses' },
    { k: 'maxDrawdown', label: 'Max DD', sort: 'maxDrawdown', on: true },
    { k: 'romPct', label: 'Return ÷ margin', sort: 'romPct', on: true, title: 'Net per trade ÷ the margin it blocks, per lot' },
    { k: 'costPct', label: 'Costs ÷ gross', sort: 'costPct', p: 2, on: false },
    { k: 'worstTrade', label: 'Worst trade', sort: 'worstTrade', p: 2, on: false },
    { k: 'tStat', label: 't', sort: 'tStat', p: 2, on: false, title: 'Per-trade mean ÷ its standard error: below ~2 the average could be luck' },
    { k: 'recovery', label: 'Net ÷ DD', sort: 'recovery', p: 2, on: false, title: 'Net profit ÷ the worst drawdown' },
    { k: 'equity', label: 'Equity', p: 2, left: true, on: true },
    { k: 'open', label: 'Open MTM', sort: 'open', p: 2, on: false },
];
const DEFAULT_COLUMNS = COLUMNS.filter(c => c.on).map(c => c.k);
const WIDE_REM = 100;     // every chosen column fits
const TABLE_REM = 64;     // below this, cards

function consTone(score, good) {
    if (score == null) return 'text-fg-5';
    return score >= good ? 'text-success' : score < 15 ? 'text-danger' : 'text-fg-3';
}

function Cell({ k, r, ctx }) {
    const td = (cls, children, title) => <td className={`py-2 px-2 text-right tabular-nums ${cls}`} title={title}>{children}</td>;
    switch (k) {
        case 'verdict': return <td className="py-2 pr-3"><Verdict r={r} minTrades={ctx.minTrades} /></td>;
        case 'ready': return <td className="py-2 pr-3 whitespace-nowrap"><LiveCheck r={r} open={ctx.open} onToggle={ctx.onToggle} /></td>;
        case 'trades': return td('', r.trades);
        case 'net': return td(`font-semibold ${pnlTone(r.net)}`, r.trades ? rup(r.net) : '—');
        case 'perTrade': return td(pnlTone(r.perTrade), r.perTrade == null ? '—' : rup(r.perTrade));
        case 'gap': return td('whitespace-nowrap', <VsBacktest r={r} />);
        case 'consistency': {
            const c = r.consistency;
            return td(consTone(c?.score, ctx.goodConsistency), consistencyText(c?.score),
                c ? `${consistencyVerdict(c.score)} — ${c.profitable} of ${c.profitable + c.losing} ${c.bucket}s profitable, straightness ${c.r2 == null ? '—' : c.r2.toFixed(2)}` : 'No trades');
        }
        case 'winRate': return td('', r.winRate == null ? '—' : `${r.winRate}%`);
        case 'profitFactor': return td(r.profitFactor != null && r.profitFactor < 1 ? 'text-danger' : '', r.profitFactor == null ? '—' : r.profitFactor.toFixed(2));
        case 'maxDrawdown': return td('text-danger', r.maxDrawdown ? rup(r.maxDrawdown) : '—');
        case 'romPct': return td(pnlTone(r.romPct), r.romPct == null ? '—' : `${r.romPct.toFixed(2)}%${r.margin?.basis === 'estimate' ? '*' : ''}`,
            r.margin ? `Per trade, on ${marginText(r)}` : 'No margin recorded');
        case 'costPct': return td(costTone(r.costPct), r.costPct == null ? '—' : `${r.costPct}%`,
            r.costPct == null ? (r.trades ? 'Losing before costs — gross P&L is not positive.' : '') : `₹${fmt(r.charges)} of charges against ₹${fmt(r.gross)} gross profit`);
        case 'worstTrade': return td(pnlTone(r.worstTrade), signedRup(r.worstTrade));
        case 'tStat': return td('', r.tStat == null ? '—' : r.tStat.toFixed(2));
        case 'recovery': return td('', r.recovery == null ? '—' : `${r.recovery.toFixed(1)}×`);
        case 'equity': return <td className="py-2 px-2"><Spark curve={r.curve} color={ctx.ct.mark.equity} zero={ctx.ct.axis} /></td>;
        case 'open': return td(r.open ? pnlTone(r.open.mtmNet) : 'text-fg-5', r.open ? (r.open.mtmNet == null ? 'unmarked' : rup(r.open.mtmNet)) : '—');
        default: return <td />;
    }
}

// ── Filters ─────────────────────────────────────────────────────────────────

const btn = 'h-8 px-2 rounded-md border text-xs whitespace-nowrap';
const btnOff = `${btn} border-line bg-slate-800 text-fg-3 hover:text-fg`;
const btnOn = `${btn} border-primary bg-primary/15 text-primary-ink`;

function FilterPanel({ filters, setFilters }) {
    const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
    return (
        <div className="rounded-lg border border-line bg-slate-900/30 p-3 mb-3 space-y-3" data-testid="scorecard-filters">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xs text-fg-5">Presets</span>
                <button type="button" className={btnOff} onClick={() => setFilters({ ...LIVE_CANDIDATES })}
                    title="20+ trades, consistency ≥ 50, profit factor ≥ 1.5, charges ≤ 50% of gross, profitable, not fading">Live candidates</button>
                <button type="button" className={btnOff} onClick={() => setFilters({ ...DEFAULT_FILTERS, readiness: 'ready' })}>Ready for go-live</button>
                <button type="button" className={btnOff} onClick={() => setFilters({ ...DEFAULT_FILTERS, verdicts: ['drifting', 'bleeding'] })}>Needs attention</button>
                <button type="button" className={btnOff} onClick={() => setFilters({ ...DEFAULT_FILTERS })}>Clear all</button>
            </div>
            <div className="grid gap-x-3 gap-y-2 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
                {NUMBER_FILTERS.map(nf => (
                    <label key={nf.k} className="flex flex-col gap-0.5 text-2xs text-fg-4">
                        {nf.label}
                        <input type="number" inputMode="decimal" step={nf.step} value={filters[nf.k] ?? ''} onChange={e => set(nf.k, e.target.value)}
                            className="h-8 bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2" />
                    </label>
                ))}
                <label className="flex flex-col gap-0.5 text-2xs text-fg-4">
                    Live check
                    <select value={filters.readiness} onChange={e => set('readiness', e.target.value)} className="h-8 bg-slate-800 border border-line rounded-md px-1 text-xs text-fg-2">
                        <option value="all">Any</option>
                        <option value="ready">Ready for go-live</option>
                        <option value="not-ready">Not ready yet</option>
                        <option value="live">Already LIVE</option>
                    </select>
                </label>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-3">
                {[['profitable', 'Profitable only'], ['hideFading', 'Hide fading (last 10 trades losing)'], ['activeOnly', 'Active deployments only']].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!filters[k]} onChange={e => set(k, e.target.checked)} />{l}</label>
                ))}
            </div>
            <p className="text-3xs text-fg-5">A row without the figure a minimum asks for (no margin recorded, no trades yet) is hidden by it. Verdict chips above filter too — click one or more.</p>
        </div>
    );
}

function ColumnPicker({ cols, setCols }) {
    const toggle = (k) => setCols(c => (c.includes(k) ? c.filter(x => x !== k) : COLUMNS.filter(x => c.includes(x.k) || x.k === k).map(x => x.k)));
    return (
        <div className="rounded-lg border border-line bg-slate-900/30 p-3 mb-3" data-testid="scorecard-columns">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-2xs text-fg-3">
                {COLUMNS.map(c => (
                    <label key={c.k} className="flex items-center gap-1.5" title={c.title}>
                        <input type="checkbox" checked={cols.includes(c.k)} onChange={() => toggle(c.k)} />{c.label}
                    </label>
                ))}
                <button type="button" onClick={() => setCols(DEFAULT_COLUMNS)} className="text-primary-ink hover:underline">Default columns</button>
            </div>
        </div>
    );
}

/** The Strategies card: the scorecard table (cards when narrow), filters, the live check, and Compare. */
export default function StrategyScorecard({ sc, templates = [], single = false }) {
    const ct = useChartTheme();
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const asTable = rem == null || rem >= TABLE_REM;
    const narrow = rem != null && rem < WIDE_REM;
    const [sort, setSort] = useState({ k: 'net', dir: 'desc' });
    const [q, setQ] = useState('');
    const [all, setAll] = useState(false);
    const [picked, setPicked] = useState([]);
    const [openRows, setOpenRows] = useState([]);
    const [panel, setPanel] = useState(null);          // 'filters' | 'columns' | null
    const [storedFilters, setFilters] = useLocalStorage('multileg:scorecard:filters', DEFAULT_FILTERS);
    const filters = useMemo(() => normaliseFilters(storedFilters), [storedFilters]);
    const [cols, setCols] = useLocalStorage('multileg:scorecard:columns', DEFAULT_COLUMNS, { validate: Array.isArray });
    const data = sc?.data || null;
    const err = sc?.err || null;
    const allRows = useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]);
    const tplName = useCallback((k) => templates.find(t => t.key === k)?.name || k || '—', [templates]);
    const searched = useMemo(() => {
        const s = q.trim().toLowerCase();
        return allRows.filter(r => !s || [r.name, r.template, tplName(r.template), shortSym(r.symbol)].some(x => String(x || '').toLowerCase().includes(s)));
    }, [allRows, q, tplName]);
    const rows = useMemo(() => sortRows(searched.filter(r => passes(r, filters)), sort), [searched, filters, sort]);
    const hidden = searched.length - rows.length;
    const nFilters = activeFilterCount(filters);
    const shown = all ? rows : rows.slice(0, COLLAPSED_ROWS);
    const pickedRows = picked.map(id => allRows.find(r => (r.deploymentId || r.name) === id)).filter(Boolean);
    const togglePick = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_COMPARE ? p : [...p, id]));
    const toggleRow = (id) => setOpenRows(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]));
    const onSort = (k) => setSort(s => (s.k === k ? { k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { k, dir: 'desc' }));
    const toggleVerdict = (v) => setFilters(f => { const n = normaliseFilters(f); return { ...n, verdicts: n.verdicts.includes(v) ? n.verdicts.filter(x => x !== v) : [...n.verdicts, v] }; });
    const counts = data?.verdictCounts || {};
    const ready = data?.readinessCounts || {};
    const chosen = COLUMNS.filter(c => cols.includes(c.k));
    const visible = narrow ? chosen.filter(c => c.p !== 2) : chosen;
    const droppedForWidth = chosen.filter(c => !visible.includes(c));
    const goodConsistency = data?.quality?.minConsistency ?? 50;
    const span = visible.length + 1 + (single ? 0 : 1);

    return (
            <Panel ref={ref} storageKey="fold:results|strategies" title={`Strategies ${data ? `(${allRows.length})` : ''}`}
                subtitle="Booked results per deployment, live vs the backtest it was deployed from, and whether it is ready for real money" docs="multi-leg#results-tab"
                right={!single && allRows.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter strategies…"
                                aria-label="Filter strategies" className="h-8 w-44 bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2 placeholder:text-fg-5" />
                            <label className="flex items-center gap-1 text-2xs text-fg-4">Sort
                                <select value={sort.k} onChange={e => setSort({ k: e.target.value, dir: 'desc' })} className="h-8 bg-slate-800 border border-line rounded-md px-1 text-xs text-fg-2">
                                    {SORTS.map(s => <option key={s.k} value={s.k}>{s.label}</option>)}
                                </select>
                            </label>
                            <button type="button" onClick={() => setSort(s => ({ ...s, dir: s.dir === 'desc' ? 'asc' : 'desc' }))} className={btnOff}
                                aria-label={`Sort ${sort.dir === 'desc' ? 'descending' : 'ascending'} — switch`}>{sort.dir === 'desc' ? '▾' : '▴'}</button>
                            <button type="button" onClick={() => setPanel(p => (p === 'filters' ? null : 'filters'))} aria-expanded={panel === 'filters'}
                                className={nFilters ? btnOn : btnOff}>Filters{nFilters ? ` (${nFilters})` : ''}</button>
                            <button type="button" onClick={() => setPanel(p => (p === 'columns' ? null : 'columns'))} aria-expanded={panel === 'columns'} className={btnOff}>Columns</button>
                        </div>
                    )}>
                {panel === 'filters' && <FilterPanel filters={filters} setFilters={setFilters} />}
                {panel === 'columns' && <ColumnPicker cols={cols} setCols={setCols} />}
                {Object.keys(counts).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-2xs text-fg-5">
                        {Object.entries(counts).map(([v, n]) => {
                            const on = filters.verdicts.includes(v);
                            return (
                                <button key={v} type="button" onClick={() => toggleVerdict(v)} aria-pressed={on}
                                    className={`rounded ${on ? 'ring-2 ring-primary' : ''} ${filters.verdicts.length && !on ? 'opacity-50' : ''}`}>
                                    <Chip tone={(VERDICT[v] || {}).tone || 'neutral'} title={`${(VERDICT[v] || {}).help || ''} Click to show only these.`}>{(VERDICT[v] || { label: v }).label} · {n}</Chip>
                                </button>
                            );
                        })}
                        {counts['too-few'] > 0 && <span className="self-center">A verdict needs {data.minTrades} trades; until then ▲/▼ shows only which way it is leaning.</span>}
                    </div>
                )}
                {Object.keys(ready).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-2 text-2xs text-fg-5">
                        <span>Live check:</span>
                        {['ready', 'not-ready', 'live'].filter(s => ready[s]).map(s => {
                            const on = filters.readiness === s;
                            const [word, tone] = READY_TEXT[s];
                            return (
                                <button key={s} type="button" onClick={() => setFilters(f => ({ ...normaliseFilters(f), readiness: on ? 'all' : s }))} aria-pressed={on}
                                    className={`rounded ${on ? 'ring-2 ring-primary' : ''}`}>
                                    <Chip tone={tone}>{s === 'not-ready' ? 'Not ready yet' : s === 'ready' ? 'Ready for go-live' : word} · {ready[s]}</Chip>
                                </button>
                            );
                        })}
                        {!ready.ready && <span>Nothing passes every required go-live check yet — open a row's Live check to see what is missing.</span>}
                    </div>
                )}
                {err ? <div className="text-xs text-danger">Scorecard failed: {err}</div>
                    : !data ? <div className="text-xs text-fg-5">Loading…</div>
                    : !allRows.length ? <div className="text-xs text-fg-5">No deployments in this filter.</div>
                    : !rows.length ? <div className="text-xs text-fg-5">No strategy matches the filters.</div>
                    : asTable ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-fg-3">
                                <thead><tr className="text-2xs text-fg-5 text-left">
                                    {!single && <th className="pb-1.5 pr-2 font-semibold"><span className="sr-only">Compare</span></th>}
                                    <th className="pb-1.5 pr-3 font-semibold">Strategy</th>
                                    {visible.map(c => (
                                        <th key={c.k} title={c.title} className={`pb-1.5 ${c.left ? 'pr-3' : 'px-2 text-right'} font-semibold whitespace-nowrap`}
                                            aria-sort={c.sort && sort.k === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                                            {c.sort ? <button type="button" onClick={() => onSort(c.sort)} className={`hover:text-fg-2 ${sort.k === c.sort ? 'text-fg-2' : ''}`}>{c.label}{sort.k === c.sort ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}</button> : c.label}
                                        </th>
                                    ))}
                                </tr></thead>
                                <tbody>
                                    {shown.map(r => {
                                        const id = r.deploymentId || r.name;
                                        const on = picked.includes(id);
                                        const open = openRows.includes(id);
                                        const ctx = { minTrades: data.minTrades, ct, goodConsistency, open, onToggle: () => toggleRow(id) };
                                        return (
                                            <React.Fragment key={id}>
                                                <tr className={`border-t border-line-0 ${on ? 'bg-primary/5' : ''}`}>
                                                    {!single && (
                                                        <td className="py-2 pr-2">
                                                            <input type="checkbox" checked={on} onChange={() => togglePick(id)} disabled={!on && picked.length >= MAX_COMPARE}
                                                                aria-label={`Compare ${r.name}`} title={!on && picked.length >= MAX_COMPARE ? `Compare up to ${MAX_COMPARE}` : 'Add to the comparison'} />
                                                        </td>
                                                    )}
                                                    <td className="py-2 pr-3 min-w-[14rem]">
                                                        <div className="flex items-start gap-1">
                                                            <button type="button" onClick={() => toggleRow(id)} aria-expanded={open} aria-label={`Details for ${r.name}`}
                                                                className="mt-px w-4 shrink-0 text-fg-5 hover:text-fg-2">{open ? '▾' : '▸'}</button>
                                                            <div className="min-w-0">
                                                                {r.deploymentId ? <><Link to={deploymentHref(r.deploymentId)} className="font-semibold text-fg-2 hover:underline break-words">{r.name}</Link><NewTabLink href={deploymentHref(r.deploymentId)} label={r.name} className="ml-0.5 align-middle" /></>
                                                                    : <span className="font-semibold text-fg-2">{r.name}</span>}
                                                                <div className="text-2xs text-fg-5">
                                                                    {tplName(r.template)} · {shortSym(r.symbol)} · {r.tradeMode}{r.lots > 1 ? ` · ${r.lots} lots` : ''}
                                                                    {r.status !== 'ACTIVE' && <span className="text-warning"> · {r.status.toLowerCase()}</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    {visible.map(c => <Cell key={c.k} k={c.k} r={r} ctx={ctx} />)}
                                                </tr>
                                                {open && (
                                                    <tr className="bg-slate-900/30"><td colSpan={span} className="px-3 py-3"><RowDetail r={r} windowed={data.windowed} wide={rem == null || rem >= 70} /></td></tr>
                                                )}
                                            </React.Fragment>
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
                                const open = openRows.includes(id);
                                return (
                                    <article key={id} className={`rounded-lg border p-3 ${open ? 'col-span-full' : ''} ${on ? 'border-primary bg-primary/5' : 'border-line bg-slate-900/30'}`}>
                                        <div className="flex items-start gap-2">
                                            {!single && <input type="checkbox" className="mt-1" checked={on} onChange={() => togglePick(id)} disabled={!on && picked.length >= MAX_COMPARE} aria-label={`Compare ${r.name}`} />}
                                            <div className="min-w-0 flex-1">
                                                {r.deploymentId ? <><Link to={deploymentHref(r.deploymentId)} className="text-sm font-semibold text-fg-2 hover:underline break-words">{r.name}</Link><NewTabLink href={deploymentHref(r.deploymentId)} label={r.name} className="ml-0.5 align-middle" /></>
                                                    : <span className="text-sm font-semibold text-fg-2">{r.name}</span>}
                                                <div className="text-2xs text-fg-5">{tplName(r.template)} · {shortSym(r.symbol)} · {r.tradeMode}</div>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5"><Verdict r={r} minTrades={data.minTrades} /><LiveCheck r={r} open={open} onToggle={() => toggleRow(id)} /></div>
                                        <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-2xs">
                                            <div><dt className="text-fg-5">Net · {r.trades} trades</dt><dd className={`text-sm font-semibold ${pnlTone(r.net)}`}>{r.trades ? rup(r.net) : '—'}</dd></div>
                                            <div><dt className="text-fg-5">Per trade</dt><dd className={`text-sm font-semibold ${pnlTone(r.perTrade)}`}>{r.perTrade == null ? '—' : rup(r.perTrade)}</dd></div>
                                            <div className="min-w-0"><dt className="text-fg-5">vs backtest</dt><dd className="text-xs"><VsBacktest r={r} /></dd></div>
                                            <div><dt className="text-fg-5">Consistency</dt><dd className={`text-xs ${consTone(r.consistency?.score, goodConsistency)}`}>{consistencyText(r.consistency?.score)}</dd></div>
                                            <div><dt className="text-fg-5">Win% · PF</dt><dd className="text-xs">{r.winRate == null ? '—' : `${r.winRate}%`} · {r.profitFactor == null ? '—' : r.profitFactor.toFixed(2)}</dd></div>
                                            <div><dt className="text-fg-5">Return ÷ margin</dt><dd className={`text-xs ${pnlTone(r.romPct)}`}>{r.romPct == null ? '—' : `${r.romPct.toFixed(2)}%`}</dd></div>
                                            <div><dt className="text-fg-5">Max DD</dt><dd className="text-xs text-danger">{r.maxDrawdown ? rup(r.maxDrawdown) : '—'}</dd></div>
                                            <div><dt className="text-fg-5">Worst trade</dt><dd className={`text-xs ${pnlTone(r.worstTrade)}`}>{signedRup(r.worstTrade)}</dd></div>
                                            <div><dt className="text-fg-5">Open MTM</dt><dd className={`text-xs ${r.open ? pnlTone(r.open.mtmNet) : 'text-fg-5'}`}>{r.open ? rup(r.open.mtmNet) : '—'}</dd></div>
                                        </dl>
                                        <div className="mt-2"><Spark curve={r.curve} width={180} height={28} color={ct.mark.equity} zero={ct.axis} /></div>
                                        {open && <div className="mt-3 border-t border-line pt-3"><RowDetail r={r} windowed={data.windowed} wide={false} /></div>}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-5">
                    {hidden > 0 && (
                        <span>
                            {rows.length} of {searched.length} match the filters — {hidden} hidden.{' '}
                            <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS })} className="text-primary-ink hover:underline">Clear filters</button>
                        </span>
                    )}
                    {rows.length > COLLAPSED_ROWS && (
                        <span>
                            Showing {shown.length} of {rows.length}{q ? ` matching “${q}”` : ''}.{' '}
                            <button type="button" onClick={() => setAll(a => !a)} className="text-primary-ink hover:underline">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
                        </span>
                    )}
                    {asTable && droppedForWidth.length > 0 && (
                        <span>Narrow panel: {droppedForWidth.map(c => c.label).join(', ')} hidden — each row's Details has them.</span>
                    )}
                    {allRows.some(r => r.margin?.basis === 'estimate') && chosen.some(c => c.k === 'romPct') && (
                        <span>* return on an estimated margin (before 19-Oct the margin was estimated, about 2× the broker's for naked shorts).</span>
                    )}
                </div>
                {!single && allRows.length > 1 && pickedRows.length < 2 && (
                    <div className="mt-2 text-2xs text-fg-5">Tick 2–{MAX_COMPARE} strategies to overlay their equity curves.{pickedRows.length === 1 ? ' One picked — pick one more.' : ''}</div>
                )}
                {pickedRows.length >= 2 && <ComparePanel rows={pickedRows} onClear={() => setPicked([])} />}
            </Panel>
    );
}
