'use strict';
/**
 * LivePortfolio — the RESULTS HUB. Every deployment's results, combined and
 * per strategy, on one page, for both engines.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 * Every other view answers "how is THIS strategy doing". Answering "how is the
 * account doing" meant opening each deployment in turn and holding the
 * comparison in your head — which is exactly how a strategy bleeds quietly for
 * a month. This page is the portfolio answer, and it holds BOTH books:
 *
 *   Single-leg  the live engine (one option per trade), from trade_history
 *   Multi-leg   the structure engine (spreads, condors, straddles), from
 *               multileg_trades — rendered by the same <ResultsAnalytics> the
 *               Multi-Leg page uses, so the two places can never disagree.
 *
 * Served by GET /api/analytics/live-portfolio. The server computes every
 * number; the browser only draws. The response carries the combined series AND
 * the same trades partitioned per strategy / per deployment (`groups`), built by
 * the same functions, so a strategy's card here equals its own detail page.
 *
 * ── THE ONE PIECE OF ARITHMETIC THAT IS NOT NEGOTIABLE ──────────────────────
 * `perTrade` is total ÷ n and is rendered as-is. It is NEVER recomputed as
 * winRate × avgWin + (1 − winRate) × avgLoss: that decomposition charges every
 * scratch trade (exactly ₹0) as an average LOSS and invents a deficit that is
 * not in the book. That mistake already produced one wrong conclusion in this
 * project, which is why the server owns the number and this file formats it.
 *
 * ── EVERY NUMBER FALLS BACK TO AN EM DASH ───────────────────────────────────
 * A trading screen that prints "₹NaN" beside a real figure is worse than one
 * that prints nothing, because both look equally authoritative. `profitFactor`
 * is legitimately `null` in a window with no losing trades — a fact, not a
 * missing value — and renders as '—' with an explanatory title.
 *
 * ── NOTHING IS DROPPED SILENTLY ─────────────────────────────────────────────
 * Trades with no deploymentId (booked before deployments mode existed) appear
 * under a labelled "no deployment" row, so every breakdown tab sums to the
 * header above it. A missing capability (older backend without `groups`) says
 * so on the page instead of rendering an empty section.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
    ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
    Legend as RcLegend, ResponsiveContainer,
} from 'recharts';
import {
    RefreshCw, Wallet, ExternalLink, Layers, Activity, ChevronDown, ChevronUp, CheckSquare, Square, X,
} from 'lucide-react';
import {
    Card, StatTile, StatRow, DataTable, Placeholder, StatusBadge, DivergingBars, PageHeader, Tabs, Segmented, Chip,
    Skeleton, SkeletonTiles, EmptyState,
} from '../components/viz/primitives';
import { inr, useChartTheme, rupeeTick } from '../components/viz/tokens';
import ZoomableChart from '../components/charts/ZoomableChart';
import PnlCalendar from '../components/charts/PnlCalendar.jsx';
import ResultsAnalytics from '../components/multileg/ResultsAnalytics.jsx';
import ExcursionsPanel from '../components/multileg/ExcursionsPanel.jsx';
import RoundTripsTable from '../components/singleleg/RoundTripsTable.jsx';
import SingleLegDayByDay from '../components/singleleg/SingleLegDayByDay.jsx';
import ApplySingleStopDialog from '../components/singleleg/ApplySingleStopDialog.jsx';
import TradeDetailsModal from '../components/TradeDetailsModal';
import { API_URL } from '../config/api.js';
import { ROUTES, strategyDetailHref } from '../config/routes.js';

// ── formatting ───────────────────────────────────────────────────────────────

/** Finite number or null. The gate every render below passes through. */
const n = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
};
const int = (v) => (n(v) == null ? '—' : Math.round(n(v)).toLocaleString('en-IN'));
const pct = (v, d = 0) => (n(v) == null ? '—' : `${n(v).toFixed(d)}%`);
const dec = (v, d = 2) => (n(v) == null ? '—' : n(v).toFixed(d));
const toneOf = (v) => ((n(v) ?? 0) > 0 ? 'positive' : (n(v) ?? 0) < 0 ? 'negative' : 'neutral');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → '28 Aug'. Parsed by hand, not through Date: a browser west of
 *  UTC renders the PREVIOUS day for an IST day key parsed as UTC midnight. */
const shortDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || '?'}` : '—';
};
/** An ISO instant → IST day + time, for "last trade". */
const istStamp = (v) => {
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
};

// ── page-level constants ─────────────────────────────────────────────────────

const VIEWS = [
    { id: 'single', label: 'Single-leg', icon: Activity, hint: 'Live engine — one option per trade' },
    { id: 'multi', label: 'Multi-leg', icon: Layers, hint: 'Structure engine — spreads, condors, straddles' },
];
const VIEW_IDS = new Set(VIEWS.map((v) => v.id));
const VIEW_STORAGE = 'lp.view';

const DAY_OPTS = [
    { v: 7, label: '7d' },
    { v: 30, label: '30d' },
    { v: 90, label: '90d' },
    { v: 'all', label: 'All' },
];

/** Sort spec per breakdown column. `net` descending is the default because the
 *  ranking IS the point — the worst strategy should be one click away, at the
 *  bottom of a list whose top is the best. */
const COLS = [
    { k: 'key', label: 'Key', align: 'left', help: 'The bucket this row groups trades by — open a row to see the deployments in it' },
    { k: 'trades', label: 'Trades', align: 'right', help: 'Closed trades in this row' },
    { k: 'winRate', label: 'Win %', align: 'right', help: "Share of this row's trades that made money after charges (net > ₹0). A trade that ended at exactly ₹0 counts as not a win" },
    { k: 'net', label: 'Net', align: 'right', help: "Sum of this row's net P&L (after charges where they were recorded)" },
    { k: 'perTrade', label: 'Per trade', align: 'right', help: 'Net ÷ trades — the average result per trade, scratches included' },
    { k: 'costPct', label: 'Costs ÷ gross', align: 'right', help: 'Charges as a share of gross (pre-cost) profit, over the trades that recorded charges. — = none recorded, or the row lost money before costs' },
    { k: 'best', label: 'Best', align: 'right', help: 'Best single trade' },
    { k: 'worst', label: 'Worst', align: 'right', help: 'Worst single trade' },
    { k: 'lastTradeAt', label: 'Last trade', align: 'right', help: 'Most recent exit in this row' },
];

/** Below this many trades, a strategy's figures are shown but not judged. */
const MIN_TRADES = 20;

/** How many strategy curves the compare chart shows before anyone picks. Four
 *  iso-lightness categorical hues stay separable; a fifth starts to collide. */
const DEFAULT_COMPARE = 4;

// ── small shared pieces ──────────────────────────────────────────────────────

/** Sortable column header. A real <button>, not an onClick on the <th>: a bare
 *  handler on a non-interactive element is unreachable by keyboard. */
function SortHeader({ col, sort, onSort }) {
    const on = sort.k === col.k;
    return (
        <button
            type="button"
            onClick={() => onSort(col.k)}
            title={`${col.help ? `${col.help}. ` : ''}Click to sort by ${col.label}.`}
            aria-label={`Sort by ${col.label}`}
            className={`inline-flex items-center gap-0.5 hover:text-fg rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'text-fg-3' : ''}`}
        >
            {col.label}
            <span aria-hidden="true" className="text-fg-5">{on ? (sort.dir === 'desc' ? '▾' : '▴') : ''}</span>
        </button>
    );
}

/** Signed rupee value — the sign is in the glyph, colour only reinforces it. */
function Money({ v, bold = false, className = '' }) {
    const ct = useChartTheme();
    const x = n(v);
    const color = x == null ? undefined : x > 0 ? ct.diverging.positive : x < 0 ? ct.diverging.negative : undefined;
    return (
        <span className={`${x == null || x === 0 ? 'text-fg-4' : ''} ${bold ? 'font-semibold' : ''} tabular-nums ${className}`} style={color ? { color } : undefined}>
            {inr(v)}
        </span>
    );
}

/** A tiny labelled value — "7d  +₹1,240" — for the recent-form row on a card. */
function FormChip({ label, v, title }) {
    return (
        <span className="inline-flex items-baseline gap-1 text-2xs" title={title}>
            <span className="text-fg-5 uppercase tracking-wide">{label}</span>
            <Money v={v} />
        </span>
    );
}

/** One-series equity sparkline — no axes, a zero rule, filled toward zero. */
function Sparkline({ daily, color, height = 44 }) {
    const ct = useChartTheme();
    const rows = useMemo(() => (Array.isArray(daily) ? daily : []).map((d) => ({ x: d?.date, y: n(d?.equity) ?? 0 })), [daily]);
    if (rows.length < 2) {
        return <div className="flex items-center text-2xs text-fg-5" style={{ height }}>Fewer than two trading days — no curve yet.</div>;
    }
    return (
        <div style={{ height }} aria-hidden="true">
            <ResponsiveContainer width="100%" height={height}>
                <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <ReferenceLine y={0} stroke={ct.axis} strokeOpacity={0.5} />
                    <Area type="monotone" dataKey="y" baseValue={0} stroke={color} strokeWidth={1.5}
                        fill={color} fillOpacity={0.14} dot={false} isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── strategy card ────────────────────────────────────────────────────────────

/**
 * One strategy, as a card: identity (name · symbols · modes), its equity
 * sparkline, four headline numbers, recent form, and three actions —
 * compare (adds its curve to the overlay), details (expands a full panel
 * below the grid), open page (its own detail route).
 *
 * The left rail is the strategy's hue in the compare chart, so a card and its
 * line are the same colour, and a losing card also carries a red border — the
 * hue alone must never be the only carrier of "this one is losing".
 */
function StrategyCard({ g, color, selected, expanded, onToggleSelect, onToggleExpand, href, depById }) {
    const s = g?.summary || {};
    const net = n(s.netPnl) ?? 0;
    const trades = n(s.trades) ?? 0;
    const bleeding = net < 0;
    // Up overall but down over the last 30 days: the "quietly turning" case
    // this page exists to surface. Needs enough trades to mean anything.
    const fading = !bleeding && (n(s.net30d) ?? 0) < 0 && trades >= 5;
    const deps = (g?.deployments || []).map((id) => depById.get(String(id))).filter(Boolean);
    const activeCount = deps.filter((d) => d?.meta?.active).length;
    const modes = [...new Set(deps.map((d) => d?.meta?.mode).filter(Boolean))];
    const pf = n(s.profitFactor);

    return (
        <article
            className={`bg-surface border rounded-lg p-3 flex flex-col gap-2.5 min-w-0 transition-shadow ${bleeding ? 'border-red-500/50' : 'border-line/60'} ${expanded ? 'ring-1 ring-primary/60' : ''}`}
            style={{ borderLeft: `3px solid ${color}` }}
            aria-label={`${g.key} results`}
        >
            <header className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0">
                    {/* the name opens the card's Details panel — a card is clickable, not only its buttons */}
                    <h3 className="text-sm font-semibold text-fg truncate">
                        <button type="button" onClick={onToggleExpand} aria-expanded={expanded} className="truncate max-w-full text-left hover:text-primary-ink hover:underline"
                            title={`${g.key} — ${expanded ? 'hide' : 'show'} its daily P&L, exit reasons and deployments`}>{g.key}</button>
                    </h3>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                        {(g.symbols || []).map((sym) => <Chip key={sym} title="Underlying">{sym}</Chip>)}
                        {modes.map((m) => (
                            <Chip key={m} tone={String(m).toUpperCase() === 'LIVE' ? 'live' : 'paper'} title="Trade mode of its deployments">{String(m).toUpperCase()}</Chip>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {bleeding && <StatusBadge level="critical" title="Net negative over this window">Bleeding</StatusBadge>}
                    {fading && <StatusBadge level="warning" title="Positive overall, negative over the last 30 days">Fading</StatusBadge>}
                    {!bleeding && !fading && activeCount > 0 && <StatusBadge level="good" title={`${activeCount} active deployment(s)`}>Running</StatusBadge>}
                    {activeCount === 0 && deps.length > 0 && <span className="text-3xs text-fg-5">stopped</span>}
                    {trades < MIN_TRADES && (
                        <Chip title={`Only ${trades} closed trade${trades === 1 ? '' : 's'} in this window — the figures are real, but too few to tell a working strategy from luck. A verdict needs ${MIN_TRADES}.`}>
                            too few to judge ({trades}/{MIN_TRADES})
                        </Chip>
                    )}
                </div>
            </header>

            <Sparkline daily={g.daily} color={color} />

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div className="min-w-0">
                    <div className="text-3xs uppercase tracking-wide text-fg-5">Net</div>
                    <Money v={s.netPnl} bold className="text-lg" />
                </div>
                <div className="min-w-0">
                    <div className="text-3xs uppercase tracking-wide text-fg-5">Per trade</div>
                    <Money v={s.perTrade} className="text-sm" />
                </div>
                <div className="min-w-0">
                    <div className="text-3xs uppercase tracking-wide text-fg-5">Win rate</div>
                    <span className="text-sm text-fg-3 tabular-nums">{pct(s.winRate)}</span>
                    <span className="text-3xs text-fg-5 ml-1">of {int(s.trades)}</span>
                </div>
                <div className="min-w-0">
                    <div className="text-3xs uppercase tracking-wide text-fg-5">Profit factor</div>
                    <span className="text-sm tabular-nums text-fg-3" title={pf == null ? 'No losing trades in this window' : 'Gross wins ÷ gross losses'}>
                        {pf == null ? '—' : dec(pf, 2)}
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-0 pt-2">
                <div className="flex items-center gap-3">
                    <FormChip label="7d" v={s.net7d} title="Net over the last 7 calendar days" />
                    <FormChip label="30d" v={s.net30d} title="Net over the last 30 calendar days" />
                </div>
                <span className="text-3xs text-fg-5" title="Most recent closed trade">last {istStamp(s.lastTradeAt)}</span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={onToggleSelect} aria-pressed={selected}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-2xs ${selected ? 'border-primary/50 bg-primary/10 text-primary-ink' : 'border-line-2 text-fg-5 hover:text-fg-3'}`}
                    title="Show this strategy's equity curve in the compare chart">
                    {selected ? <CheckSquare className="w-3 h-3" aria-hidden="true" /> : <Square className="w-3 h-3" aria-hidden="true" />}
                    Compare
                </button>
                <button type="button" onClick={onToggleExpand} aria-expanded={expanded}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-2xs ${expanded ? 'border-primary/50 bg-primary/10 text-primary-ink' : 'border-line-2 text-fg-5 hover:text-fg-3'}`}
                    title="Daily P&L, equity, exit reasons and deployments for this strategy">
                    {expanded ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
                    Details
                </button>
                {href ? (
                    <Link to={href} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 text-2xs text-primary-ink hover:underline"
                        title="Open this strategy's detail page (trades, charts, AI review)">
                        Open page <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </Link>
                ) : (
                    <span className="ml-auto text-3xs text-fg-5" title="No deployment with a symbol runs this strategy, so there is no detail route to open">no detail page</span>
                )}
            </div>
        </article>
    );
}

// ── deployment cards ─────────────────────────────────────────────────────────

/**
 * One card per DEPLOYMENT (a strategy on one index, in one mode) — the unit that
 * actually trades. Clicking a card filters the whole page to it: tiles, breakdowns,
 * how trades travelled, every round trip and the day-by-day curves. The selected card
 * is ringed; "All deployments" clears it. A deployment with no trades in the window
 * still appears when it is selected, so a filter never silently empties the list.
 */
function DeploymentCards({ deployments, selected, onSelect, linkForDeployment }) {
    const ct = useChartTheme();
    if (!deployments.length) return <Placeholder>No deployment closed a trade in this window.</Placeholder>;
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3" data-testid="deployment-cards">
            {deployments.map((d) => {
                const s = d.summary || {};
                const m = d.meta || {};
                const id = String(d.key);
                const on = selected === id;
                const net = n(s.netPnl) ?? 0;
                const trades = n(s.trades) ?? 0;
                const label = m.name || (id === 'no deployment (symbol-config mode)' ? 'No deployment (symbol-config mode)' : `${m.strategyName || 'strategy'} · ${String(m.symbol || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')}`);
                const href = linkForDeployment(d);
                const filterId = id === 'no deployment (symbol-config mode)' ? 'none' : id;
                return (
                    <article key={id} className={`rounded-lg border p-3 flex flex-col gap-2 min-w-0 transition-shadow ${on ? 'border-primary ring-1 ring-primary/60 bg-primary/5' : net < 0 ? 'border-red-500/40' : 'border-line/60'} bg-surface`}>
                        <button type="button" onClick={() => onSelect(on ? null : filterId)} aria-pressed={on}
                            className="text-left space-y-2 min-w-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                            title={on ? 'Showing only this deployment — click to show all again' : 'Show only this deployment on this page: its trades, breakdowns, day by day and stop analysis'}>
                            <div className="flex items-start justify-between gap-2 min-w-0">
                                <div className="min-w-0">
                                    <h3 className="text-sm font-semibold text-fg truncate" title={label}>{label}</h3>
                                    <div className="flex flex-wrap items-center gap-1 mt-1">
                                        {m.strategyName && <Chip title="Strategy">{m.strategyName}</Chip>}
                                        {(d.symbols || []).map((sym) => <Chip key={sym} title="Underlying">{sym}</Chip>)}
                                        {m.mode && <Chip tone={String(m.mode).toUpperCase() === 'LIVE' ? 'live' : 'paper'}>{String(m.mode).toUpperCase()}</Chip>}
                                        {m.timeframe && <Chip title="Candle timeframe">{m.timeframe}m</Chip>}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                    {m.active ? <StatusBadge level="good">Running</StatusBadge> : d.meta ? <span className="text-3xs text-fg-5">stopped</span> : null}
                                    {trades < MIN_TRADES && <Chip title={`Only ${trades} closed trade${trades === 1 ? '' : 's'} — too few to tell a working strategy from luck. A verdict needs ${MIN_TRADES}.`}>too few to judge ({trades}/{MIN_TRADES})</Chip>}
                                </div>
                            </div>
                            <Sparkline daily={d.daily} color={net < 0 ? ct.diverging.negative : ct.diverging.positive} height={36} />
                            <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-2xs">
                                <div><div className="text-3xs uppercase tracking-wide text-fg-5">Net · {int(trades)}</div><Money v={s.netPnl} bold className="text-sm" /></div>
                                <div><div className="text-3xs uppercase tracking-wide text-fg-5">Per trade</div><Money v={s.perTrade} /></div>
                                <div><div className="text-3xs uppercase tracking-wide text-fg-5">Win</div><span className="text-fg-3 tabular-nums">{pct(s.winRate)}</span></div>
                                <div><div className="text-3xs uppercase tracking-wide text-fg-5">Max DD</div><Money v={s.maxDrawdown} /></div>
                                <div><div className="text-3xs uppercase tracking-wide text-fg-5">7d</div><Money v={s.net7d} /></div>
                                <div><div className="text-3xs uppercase tracking-wide text-fg-5">30d</div><Money v={s.net30d} /></div>
                            </div>
                        </button>
                        <div className="flex items-center justify-between gap-2 border-t border-line-0 pt-2">
                            <span className="text-3xs text-fg-5">last {istStamp(s.lastTradeAt)}</span>
                            {href ? (
                                <Link to={href} className="inline-flex items-center gap-1 text-2xs text-primary-ink hover:underline" title="Open this deployment's own page">
                                    Open page <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                </Link>
                            ) : <span className="text-3xs text-fg-5">no detail page</span>}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}

/** The single-leg view's filter bar: every deployment of the window, or one. */
function DeploymentFilter({ dep, setDep, cards, depName }) {
    const opts = cards.map((d) => {
        const id = String(d.key) === 'no deployment (symbol-config mode)' ? 'none' : String(d.key);
        return { id, label: depName(id), n: n(d.summary?.trades) };
    });
    if (dep && !opts.some((o) => o.id === dep)) opts.unshift({ id: dep, label: depName(dep), n: null });
    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="deployment-filter">
            <label className="flex items-center gap-1.5 text-2xs text-fg-4">Deployment
                <select value={dep || 'all'} onChange={(e) => setDep(e.target.value === 'all' ? null : e.target.value)}
                    className="h-8 max-w-[22rem] bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2" aria-label="Show one deployment">
                    <option value="all">All deployments</option>
                    {opts.map((o) => <option key={o.id} value={o.id}>{o.label}{o.n != null ? ` (${o.n})` : ''}</option>)}
                </select>
            </label>
            {dep && (
                <span className="inline-flex items-center gap-1.5 text-2xs text-primary-ink">
                    Showing only <b className="font-semibold">{depName(dep)}</b>
                    <button type="button" onClick={() => setDep(null)} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-line-2 text-fg-4 hover:text-fg"
                        aria-label="Show all deployments"><X className="w-3 h-3" aria-hidden="true" />All deployments</button>
                </span>
            )}
        </div>
    );
}

// ── open now + costs ─────────────────────────────────────────────────────────

/** What the live engine holds right now, marked like the Dashboard card. Closed
 *  trades are all this page otherwise shows, so open risk was invisible here. */
function OpenNowSingle({ open, depById, linkForDeployment }) {
    const [show, setShow] = useState(false);
    if (!open) return null;
    const rows = Array.isArray(open.rows) ? open.rows : [];
    return (
        <Card docs="live-portfolio#open-now" title="Open now" subtitle="Live engine positions, marked at the latest quote. Pre-cost — charges are booked at exit."
            right={open.n > 0 ? (
                <button type="button" onClick={() => setShow((v) => !v)} aria-expanded={show}
                    className="text-2xs px-2 py-0.5 rounded border border-line-2 text-fg-4 hover:text-fg">{show ? 'Hide list' : 'Show list'}</button>
            ) : null}>
            {open.n === 0 ? (
                <p className="text-xs text-fg-5">Nothing open — every figure below is a closed trade.</p>
            ) : (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-xs text-fg-3">{int(open.n)} position{open.n === 1 ? '' : 's'}</span>
                        <span className="text-sm font-semibold">MTM <Money v={open.mtm} bold /></span>
                        {open.unmarked > 0 && <span className="text-2xs text-warning">{int(open.unmarked)} without a quote (not in the total)</span>}
                    </div>
                    {show && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-2xs text-fg-3">
                                <thead><tr className="text-fg-5 text-left">
                                    <th className="py-1 pr-3 font-semibold">Deployment</th><th className="pr-3 font-semibold">Contract</th>
                                    <th className="pr-3 font-semibold">Since (IST)</th><th className="pr-3 text-right font-semibold">Entry → now</th>
                                    <th className="text-right font-semibold">MTM</th>
                                </tr></thead>
                                <tbody>
                                    {rows.map((r, i) => {
                                        const d = r.deploymentId ? depById.get(String(r.deploymentId)) : null;
                                        const href = d ? linkForDeployment(d) : null;
                                        const label = d?.meta?.name || r.strategyName || '—';
                                        return (
                                            <tr key={`${r.symbol}-${i}`} className="border-t border-line-0">
                                                <td className="py-1 pr-3">{href ? <Link to={href} className="text-primary-ink hover:underline">{label}</Link> : label}</td>
                                                <td className="pr-3 text-fg-4">{String(r.symbol || '—').replace(/^(NSE|BSE):/, '')} · {r.type || '—'}</td>
                                                <td className="pr-3 text-fg-4 whitespace-nowrap">{istStamp(r.entryTime)}</td>
                                                <td className="pr-3 text-right tabular-nums text-fg-4">{r.entryPrice == null ? '—' : `₹${r.entryPrice}`} → {r.ltp == null ? '—' : `₹${r.ltp}`}</td>
                                                <td className="text-right">{r.mtm == null ? <span className="text-warning">no quote</span> : <Money v={r.mtm} bold />}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

/** What trading cost against what it made before costs — said out loud, and
 *  honest about how many trades recorded their charges at all. */
function CostLine({ costs }) {
    if (!costs || !n(costs.covered)) {
        return <p className="text-2xs text-fg-5">No trade in this window recorded its charges, so the cost of trading cannot be shown.</p>;
    }
    const partial = n(costs.covered) < n(costs.n);
    const scope = partial ? ` on the ${int(costs.covered)} of ${int(costs.n)} trades that recorded charges` : '';
    if (n(costs.costPct) == null) {
        return <p className="text-xs text-danger">Losing before costs{scope}: gross {inr(costs.gross)}, then {inr(costs.charges)} of charges on top.</p>;
    }
    const pct = n(costs.costPct);
    const tone = pct >= 100 ? 'text-danger' : pct >= 30 ? 'text-warning' : 'text-fg-3';
    return (
        <p className={`text-xs ${tone}`}>
            Charges took <span className="font-semibold">{pct}%</span> of gross profit{scope} — {inr(costs.charges)} of {inr(costs.gross)}.
            {pct >= 100 ? ' Costs ate the whole edge.' : ''}
            {partial && <span className="text-fg-5"> Charges are recorded per trade since 23 Sep 2026; older trades have none.</span>}
            <span className="text-fg-5"> The Costs ÷ gross column in Breakdowns shows where.</span>
        </p>
    );
}

// ── expanded strategy panel ──────────────────────────────────────────────────

function StrategyPanel({ g, color, depById, linkForDeployment, onClose }) {
    const ct = useChartTheme();
    const s = g?.summary || {};
    const rows = useMemo(() => (Array.isArray(g?.daily) ? g.daily : []).map((d) => {
        const v = n(d?.net) ?? 0;
        return { date: d?.date, label: shortDate(d?.date), net: v, up: v >= 0 ? v : null, down: v < 0 ? v : null,
            trades: n(d?.trades), winRate: n(d?.winRate), equity: n(d?.equity), drawdown: n(d?.drawdown) };
    }), [g]);
    const exitRows = useMemo(() => (Array.isArray(g?.exitReasons) ? g.exitReasons : []).map((r) => ({
        label: `${r.key} · ${int(r.trades)}`, value: n(r.net) ?? 0,
        hint: `${r.key}: ${int(r.trades)} trade(s), net ${inr(r.net)}`,
    })), [g]);
    const depRows = useMemo(() => (g?.deployments || []).map((id) => {
        const d = depById.get(String(id));
        return { _key: String(id), id: String(id), meta: d?.meta || null, summary: d?.summary || null, href: d ? linkForDeployment(d) : null };
    }).sort((a, b) => (n(b.summary?.netPnl) ?? 0) - (n(a.summary?.netPnl) ?? 0)), [g, depById, linkForDeployment]);

    const chartTip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    const axisTick = { fontSize: ct.type['5xs'], fill: ct.text.secondary };

    const depCols = [
        { key: 'name', header: 'Deployment', render: (r) => (r.href
            ? <Link to={r.href} className="text-primary-ink hover:underline inline-flex items-center gap-1">{r.meta?.name || r.id}<ExternalLink className="w-3 h-3" aria-hidden="true" /></Link>
            : <span className="text-fg-3">{r.meta?.name || r.id}</span>) },
        { key: 'symbol', header: 'Symbol', render: (r) => <span className="text-fg-4">{String(r.meta?.symbol || '—').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')}</span> },
        { key: 'mode', header: 'Mode', render: (r) => (r.meta?.mode ? <Chip tone={String(r.meta.mode).toUpperCase() === 'LIVE' ? 'live' : 'paper'}>{String(r.meta.mode).toUpperCase()}</Chip> : '—') },
        { key: 'state', header: 'State', render: (r) => (r.meta ? (r.meta.active ? <StatusBadge level="good">Active</StatusBadge> : <span className="text-fg-5">stopped</span>) : '—') },
        { key: 'trades', header: 'Trades', align: 'right', render: (r) => <span className="text-fg-3">{int(r.summary?.trades)}</span> },
        { key: 'net', header: 'Net', align: 'right', render: (r) => <Money v={r.summary?.netPnl} bold /> },
        { key: 'perTrade', header: 'Per trade', align: 'right', render: (r) => <Money v={r.summary?.perTrade} /> },
    ];

    return (
        <Card docs="live-portfolio#strategies"
            title={<span className="inline-flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />{g.key}</span>}
            subtitle="This strategy alone, over the selected window. Same arithmetic as the header, same window."
            right={(
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-2xs text-fg-5 hover:text-fg px-1.5 py-0.5 rounded border border-line-2" title="Collapse">
                    <X className="w-3 h-3" aria-hidden="true" /> Close
                </button>
            )}
        >
            <div className="space-y-3">
                <StatRow cols={6}>
                    <StatTile label="Net" value={inr(s.netPnl)} tone={toneOf(s.netPnl)} hint={`${int(s.trades)} trades · ${int(s.tradingDays)} days`} />
                    <StatTile label="Per trade" value={inr(s.perTrade)} tone={toneOf(s.perTrade)} hint="Total ÷ trades" />
                    <StatTile label="Win rate" value={pct(s.winRate)} hint={`Avg win ${inr(s.avgWin)} · avg loss ${inr(s.avgLoss)}`} />
                    <StatTile label="Profit factor" value={n(s.profitFactor) == null ? '—' : dec(s.profitFactor, 2)}
                        tone={n(s.profitFactor) == null ? 'neutral' : n(s.profitFactor) >= 1 ? 'positive' : 'negative'} hint="Gross wins ÷ gross losses" />
                    <StatTile label="Max drawdown" value={inr(s.maxDrawdown)} tone={(n(s.maxDrawdown) ?? 0) < 0 ? 'negative' : 'neutral'} hint="Deepest fall from its own peak" />
                    <StatTile label="Best / worst" value={`${inr(s.bestTrade, { compact: true })} / ${inr(s.worstTrade, { compact: true })}`} hint="Single-trade extremes" />
                </StatRow>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Card docs="live-portfolio#daily-equity" title="Daily net P&L" subtitle="By exit day IST. Drag to zoom.">
                        <ZoomableChart data={rows} height={180}>
                            <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                <YAxis width={54} tick={axisTick} tickFormatter={rupeeTick} />
                                <Tooltip contentStyle={chartTip}
                                    formatter={(v, name) => (n(v) == null ? null : [inr(v), name === 'up' || name === 'down' ? 'net' : name])}
                                    labelFormatter={(l, p) => { const d = p?.[0]?.payload; return d ? `${d.date} · ${int(d.trades)} trade(s) · ${pct(d.winRate)} win` : String(l); }} />
                                <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                <Bar name="up" dataKey="up" stackId="net" fill={ct.diverging.positive} isAnimationActive={false} />
                                <Bar name="down" dataKey="down" stackId="net" fill={ct.diverging.negative} isAnimationActive={false} />
                            </ComposedChart>
                        </ZoomableChart>
                    </Card>
                    <Card docs="live-portfolio#daily-equity" title="Equity curve" subtitle="Cumulative net with drawdown shaded beneath.">
                        <ZoomableChart data={rows} height={180}>
                            <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                <YAxis width={54} tick={axisTick} tickFormatter={rupeeTick} />
                                <Tooltip contentStyle={chartTip} formatter={(v, name) => (n(v) == null ? null : [inr(v), name])}
                                    labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                                <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                <Area type="monotone" name="drawdown" dataKey="drawdown" baseValue={0} stroke={ct.status.critical} strokeOpacity={0.45}
                                    strokeWidth={1} fill={ct.status.critical} fillOpacity={0.16} isAnimationActive={false} />
                                <Line type="monotone" name="equity" dataKey="equity" stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
                            </ComposedChart>
                        </ZoomableChart>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Card docs="live-portfolio#breakdowns" title="Exit reasons" subtitle="Net by how the trade ended. SL-heavy means a broken entry; TP-heavy with a negative total means the stop is too wide.">
                        <DivergingBars data={exitRows} emptyText="No exits recorded." labelWidth={150} />
                    </Card>
                    <Card docs="live-portfolio#strategies" title="Deployments running it" subtitle="Each row is one deployment of this strategy; the link opens its detail page.">
                        <DataTable columns={depCols} rows={depRows} dense empty="No deployment carries this strategy — these trades were booked in symbol-config mode." />
                    </Card>
                </div>
            </div>
        </Card>
    );
}

// ── the page ─────────────────────────────────────────────────────────────────

export default function LivePortfolio() {
    const ct = useChartTheme();
    const [searchParams, setSearchParams] = useSearchParams();

    // Which book. URL wins (a shared link lands on the right view), then the
    // remembered choice, then single-leg. Read once, in the initialiser — no
    // effect writes state here.
    const [view, setViewState] = useState(() => {
        const q = searchParams.get('view');
        if (VIEW_IDS.has(q)) return q;
        try { const s = localStorage.getItem(VIEW_STORAGE); if (VIEW_IDS.has(s)) return s; } catch { /* no storage */ }
        return 'single';
    });
    const setView = useCallback((id) => {
        setViewState(id);
        try { localStorage.setItem(VIEW_STORAGE, id); } catch { /* quota / private mode */ }
        setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('view', id); return p; }, { replace: true });
    }, [setSearchParams]);

    const [days, setDays] = useState(30);
    const [nonce, setNonce] = useState(0);
    // One deployment (a clicked card) filters the whole single-leg view. In the URL so a
    // link lands on the same deployment; 'none' = trades from symbol-config mode.
    const [dep, setDepState] = useState(() => searchParams.get('dep') || null);
    const setDep = useCallback((id) => {
        setDepState(id || null);
        setSearchParams((prev) => { const p = new URLSearchParams(prev); if (id) p.set('dep', id); else p.delete('dep'); return p; }, { replace: true });
    }, [setSearchParams]);
    const [detailId, setDetailId] = useState(null);
    const [tab, setTab] = useState(0);
    const [sort, setSort] = useState({ k: 'net', dir: 'desc' });
    const [expanded, setExpanded] = useState(null);
    // null = "the default pick" (top strategies by trade count), derived below.
    const [selected, setSelected] = useState(null);

    // The response carries the request it answers, so "still loading" and "these
    // numbers belong to the PREVIOUS window" are derived rather than flagged by a
    // setState inside the effect — which would paint last window's P&L under this
    // window's heading for a frame.
    const [res, setRes] = useState({ key: null, data: null, err: null });
    const reqKey = useMemo(() => JSON.stringify([days, nonce, dep]), [days, nonce, dep]);
    // The deployment cards always list EVERY deployment of the window (not only the
    // selected one), so they are kept from the unfiltered answer, per window.
    const cardsKey = JSON.stringify([days, nonce]);
    const [cardsRes, setCardsRes] = useState({ key: null, list: [] });
    useEffect(() => {
        let dead = false;
        const params = {};
        if (days !== 'all') params.days = days;
        if (dep) params.deploymentId = dep;
        axios.get(`${API_URL}/analytics/live-portfolio`, { params })
            .then((r) => {
                if (dead) return;
                setRes({ key: reqKey, data: r.data || null, err: null });
                if (!dep && Array.isArray(r.data?.groups?.deployment)) setCardsRes({ key: cardsKey, list: r.data.groups.deployment });
            })
            .catch((e) => { if (!dead) setRes({ key: reqKey, data: null, err: e?.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [reqKey, days, dep, cardsKey]);
    useEffect(() => {
        if (!dep || cardsRes.key === cardsKey) return undefined;
        let dead = false;
        const params = {};
        if (days !== 'all') params.days = days;
        axios.get(`${API_URL}/analytics/live-portfolio`, { params })
            .then((r) => { if (!dead && Array.isArray(r.data?.groups?.deployment)) setCardsRes({ key: cardsKey, list: r.data.groups.deployment }); })
            .catch(() => { /* the filtered answer's own list is shown instead */ });
        return () => { dead = true; };
    }, [dep, cardsKey, cardsRes.key, days]);

    // Template names for the multi-leg view's Structure breakdown. Fetched only
    // once that view is opened; a failure leaves slugs, never a broken page.
    const [templates, setTemplates] = useState([]);
    useEffect(() => {
        if (view !== 'multi' || templates.length) return undefined;
        let dead = false;
        axios.get(`${API_URL}/multileg/templates`)
            .then((r) => { if (!dead) setTemplates(Array.isArray(r.data) ? r.data : (r.data?.templates || [])); })
            .catch(() => { /* slugs render instead of names */ });
        return () => { dead = true; };
    }, [view, templates.length]);

    const fresh = res.key === reqKey;
    const loading = !fresh;
    const data = fresh ? res.data : null;
    const err = fresh ? res.err : null;
    const summary = data?.summary || null;
    const daily = useMemo(() => (Array.isArray(data?.daily) ? data.daily : []), [data]);
    const breakdowns = useMemo(() => (Array.isArray(data?.breakdowns) ? data.breakdowns : []), [data]);
    const hasGroups = !!(data && data.groups && Array.isArray(data.groups.strategy));
    const strategies = useMemo(() => (hasGroups ? data.groups.strategy : []), [data, hasGroups]);
    const deployments = useMemo(() => (hasGroups && Array.isArray(data.groups.deployment) ? data.groups.deployment : []), [data, hasGroups]);
    const deploymentCards = useMemo(() => (cardsRes.key === cardsKey && cardsRes.list.length ? cardsRes.list : deployments), [cardsRes, cardsKey, deployments]);
    // names for every deployment of the window, even while one is selected
    const depById = useMemo(() => new Map([...deploymentCards, ...deployments].map((d) => [String(d.key), d])), [deploymentCards, deployments]);
    const depName = useCallback((id) => {
        if (id === 'none') return 'No deployment (symbol-config mode)';
        const m = depById.get(String(id))?.meta;
        return m ? (m.name || `${m.strategyName || 'strategy'} · ${String(m.symbol || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')}`) : String(id);
    }, [depById]);

    // Card ↔ line colour: the strategy's index in the ranked list, so the same
    // strategy keeps its hue as the selection changes.
    const colorOf = useCallback((key) => {
        const i = strategies.findIndex((g) => g.key === key);
        const pal = ct.categorical || [];
        return pal.length ? pal[(i < 0 ? 0 : i) % pal.length] : ct.mark.equity;
    }, [strategies, ct]);

    const defaultKeys = useMemo(() => [...strategies]
        .sort((a, b) => (n(b.summary?.trades) ?? 0) - (n(a.summary?.trades) ?? 0))
        .slice(0, DEFAULT_COMPARE).map((g) => g.key), [strategies]);
    const selectedKeys = selected ?? defaultKeys;
    const toggleSelect = useCallback((key) => setSelected((prev) => {
        const base = new Set(prev ?? defaultKeys);
        if (base.has(key)) base.delete(key); else base.add(key);
        return [...base];
    }), [defaultKeys]);

    // Link targets. A deployment has a symbol, so it has a detail route; a
    // strategy resolves through a deployment that runs it (active preferred).
    const linkForDeployment = useCallback((d) => {
        const m = d?.meta;
        return m?.symbol ? strategyDetailHref({ symbol: m.symbol, deploymentId: d.key, strategyName: m.strategyName, label: m.name }) : null;
    }, []);
    const linkForStrategy = useCallback((g) => {
        const deps = (g?.deployments || []).map((id) => depById.get(String(id))).filter((d) => d?.meta?.symbol)
            .sort((a, b) => (b.meta.active ? 1 : 0) - (a.meta.active ? 1 : 0));
        return deps.length ? linkForDeployment(deps[0]) : null;
    }, [depById, linkForDeployment]);
    const strategyByKey = useMemo(() => new Map(strategies.map((g) => [g.key, g])), [strategies]);

    // ── combined series rows ────────────────────────────────────────────────
    // Split the day's net into two stacked series rather than per-bar <Cell>s:
    // ZoomableChart hands the chart a SLICE of the data, so cells generated from
    // the full array would paint the wrong bars the moment anyone zooms.
    const dailyRows = useMemo(() => daily.map((d) => {
        const v = n(d?.net) ?? 0;
        return { date: d?.date, label: shortDate(d?.date), net: v, up: v >= 0 ? v : null, down: v < 0 ? v : null,
            trades: n(d?.trades), winRate: n(d?.winRate), equity: n(d?.equity), drawdown: n(d?.drawdown) };
    }), [daily]);

    // ── compare rows: one x-axis, forward-filled equity per strategy ────────
    const compareRows = useMemo(() => {
        const series = strategies.filter((g) => selectedKeys.includes(g.key));
        const dates = new Set(daily.map((d) => d.date));
        series.forEach((g) => (g.daily || []).forEach((d) => dates.add(d.date)));
        const sorted = [...dates].filter(Boolean).sort();
        const idx = new Map(series.map((g) => [g.key, new Map((g.daily || []).map((d) => [d.date, n(d.equity) ?? 0]))]));
        const combined = new Map(daily.map((d) => [d.date, n(d.equity) ?? 0]));
        // A plain loop, not .map with a captured `let`: the compiler lint treats a
        // reassigned outer binding inside a callback as a render-time mutation.
        const last = new Map();
        const out = [];
        let lastC = 0;
        for (const date of sorted) {
            const row = { date, label: shortDate(date) };
            if (combined.has(date)) lastC = combined.get(date);
            row.Combined = lastC;
            for (const g of series) { const m = idx.get(g.key); if (m.has(date)) last.set(g.key, m.get(date)); row[g.key] = last.get(g.key) ?? 0; }
            out.push(row);
        }
        return out;
    }, [strategies, selectedKeys, daily]);

    // ── breakdown table ─────────────────────────────────────────────────────
    const tabIdx = breakdowns.length ? Math.min(tab, breakdowns.length - 1) : 0;
    const active = breakdowns.length ? breakdowns[tabIdx] : null;
    const isStrategyTab = active?.label === 'Strategy';
    const isDeploymentTab = active?.label === 'Deployment';

    const rows = useMemo(() => {
        const list = Array.isArray(active?.rows) ? [...active.rows] : [];
        const dir = sort.dir === 'desc' ? -1 : 1;
        return list.sort((a, b) => {
            if (sort.k === 'key') return dir * String(a?.key ?? '').localeCompare(String(b?.key ?? ''));
            if (sort.k === 'lastTradeAt') return dir * ((new Date(a?.lastTradeAt || 0).getTime() || 0) - (new Date(b?.lastTradeAt || 0).getTime() || 0));
            // a row with no value (no charges recorded) sorts last either way —
            // ranking it as 0 would slot it among the genuinely cheap rows
            const av = n(a?.[sort.k]), bv = n(b?.[sort.k]);
            if (av == null || bv == null) return (av == null) - (bv == null);
            return dir * (av - bv);
        });
    }, [active, sort]);
    const onSort = useCallback((k) => setSort((s) => (s.k === k
        ? { k, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { k, dir: k === 'key' ? 'asc' : 'desc' })), []);

    const linkFor = useCallback((row) => {
        const key = String(row?.key ?? '');
        if (!key) return null;
        if (isDeploymentTab) { const d = depById.get(key); return d ? linkForDeployment(d) : null; }
        if (isStrategyTab) { const g = strategyByKey.get(key); return g ? linkForStrategy(g) : null; }
        return null;
    }, [depById, strategyByKey, isDeploymentTab, isStrategyTab, linkForDeployment, linkForStrategy]);
    const rowLabel = useCallback((row) => {
        const key = String(row?.key ?? '');
        if (!key) return '—';
        if (!isDeploymentTab) return key;
        const m = depById.get(key)?.meta;
        return m ? (m.name || `${m.strategyName || 'strategy'} · ${String(m.symbol || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')}`) : key;
    }, [depById, isDeploymentTab]);

    // ── drill-down: a breakdown row opened into the deployments in it ────────
    // Keyed to the request, so a new window closes every row instead of showing
    // the previous window's deployments under the new figures.
    const [openBk, setOpenBk] = useState({ reqKey: null, ids: [] });
    const openIds = useMemo(() => new Set(openBk.reqKey === reqKey ? openBk.ids : []), [openBk, reqKey]);
    const toggleBk = useCallback((id) => setOpenBk((o) => {
        const ids = new Set(o.reqKey === reqKey ? o.ids : []);
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        return { reqKey, ids: [...ids] };
    }), [reqKey]);
    const depLabel = useCallback((id) => {
        const m = depById.get(String(id))?.meta;
        return m ? (m.name || `${m.strategyName || 'strategy'} · ${String(m.symbol || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')}`) : String(id);
    }, [depById]);

    const columns = useMemo(() => COLS.map((c) => ({
        key: c.k,
        align: c.align,
        header: <SortHeader col={c} sort={sort} onSort={onSort} />,
        render: (r) => {
            if (c.k === 'key' && r._child) {
                const d = r.deploymentId ? depById.get(String(r.deploymentId)) : null;
                const href = d ? linkForDeployment(d) : null;
                const label = r.deploymentId ? depLabel(r.deploymentId) : r.key;
                return (
                    <span className="inline-flex items-center gap-1 pl-5 min-w-0 text-fg-4">
                        {href
                            ? <Link to={href} className="text-primary-ink hover:underline truncate max-w-[18rem]" title={`Open ${label}`}>{label}</Link>
                            : <span className="truncate max-w-[18rem]" title={label}>{label}</span>}
                    </span>
                );
            }
            if (c.k === 'key' && Array.isArray(r.children) && r.children.length) {
                const id = `${active?.label}::${r.key}`;
                const isOpen = openIds.has(id);
                const count = r.children.length;
                return (
                    <button type="button" onClick={() => toggleBk(id)} aria-expanded={isOpen}
                        className="inline-flex items-center gap-1 text-left hover:text-fg min-w-0"
                        title={`Show the ${count} deployment${count === 1 ? '' : 's'} in this row`}>
                        {isOpen ? <ChevronUp className="w-3 h-3 flex-shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
                        <span className="truncate max-w-[16rem]">{rowLabel(r)}</span>
                        <span className="text-fg-5 flex-shrink-0">· {count} deployment{count === 1 ? '' : 's'}</span>
                        {(isStrategyTab && (n(r.net) ?? 0) < 0) && <StatusBadge level="critical" title="Net negative over this window">Bleeding</StatusBadge>}
                    </button>
                );
            }
            if (c.k === 'costPct') {
                const v = n(r.costPct);
                const tone = v == null ? 'text-fg-5' : v >= 100 ? 'text-danger font-semibold' : v >= 50 ? 'text-warning' : 'text-fg-4';
                const title = v != null
                    ? `${inr(r.charges)} of charges against ${inr(r.gross)} gross profit, on the ${int(r.chargesN)} of ${int(r.trades)} trades that recorded charges`
                    : n(r.chargesN) ? `Losing before costs on the ${int(r.chargesN)} trades that recorded charges (gross ${inr(r.gross)})` : 'No trade in this row recorded its charges';
                return <span className={`tabular-nums ${tone}`} title={title}>{v == null ? '—' : `${v}%`}</span>;
            }
            if (c.k === 'key') {
                const href = linkFor(r);
                const losing = (isStrategyTab || isDeploymentTab) && (n(r.net) ?? 0) < 0;
                const label = rowLabel(r);
                const body = href ? (
                    <Link to={href} className="text-primary-ink hover:underline inline-flex items-center gap-1" title={`Open ${label} detail`}>
                        <span className="truncate max-w-[16rem] align-middle">{label}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                    </Link>
                ) : (
                    <span className="truncate max-w-[16rem] inline-block align-middle" title={label}>{label}</span>
                );
                return (
                    <span className={`inline-flex items-center gap-2 min-w-0 ${losing ? 'border-l-2 border-red-500 pl-2 -ml-2' : ''}`}>
                        {body}
                        {losing && <StatusBadge level="critical" title="Net negative over this window">Bleeding</StatusBadge>}
                    </span>
                );
            }
            if (c.k === 'trades') return <span className="text-fg-3">{int(r.trades)}</span>;
            if (c.k === 'winRate') return <span className="text-fg-4">{pct(r.winRate)}</span>;
            if (c.k === 'net') return <Money v={r.net} bold />;
            if (c.k === 'perTrade' || c.k === 'best' || c.k === 'worst') return <Money v={r[c.k]} />;
            return <span className="text-fg-5">{istStamp(r.lastTradeAt)}</span>;
        },
    })), [sort, onSort, linkFor, rowLabel, isStrategyTab, isDeploymentTab, active, openIds, toggleBk, depById, depLabel, linkForDeployment]);
    const tableRows = useMemo(() => rows.flatMap((r, i) => {
        const parent = { ...r, _key: `${r?.key ?? i}-${i}` };
        const id = `${active?.label}::${r.key}`;
        if (!openIds.has(id) || !Array.isArray(r.children)) return [parent];
        return [parent, ...r.children.map((c, j) => ({ ...c, _child: true, _key: `${parent._key}::${c.key ?? j}` }))];
    }), [rows, active, openIds]);

    const chartTip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    
    const axisTick = { fontSize: ct.type['5xs'], fill: ct.text.secondary };
    const calendarDays = days === 'all' ? null : (Number(days) || null);
    const pf = n(summary?.profitFactor);
    const expandedGroup = expanded ? strategyByKey.get(expanded) : null;
    const viewMeta = VIEWS.find((v) => v.id === view) || VIEWS[0];

    return (
        <div className="p-6 space-y-4">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <PageHeader foldAll docs="live-portfolio"
                icon={Wallet}
                title="Live Portfolio"
                subtitle={`Every deployment's results in one place — combined, and one card per strategy. ${viewMeta.hint}.`}
                actions={(
                    <>
                        <Segmented options={VIEWS.map((v) => ({ v: v.id, label: v.label, icon: v.icon, hint: v.hint }))} value={view} onChange={setView} size="md" />
                        {view === 'single' && (
                            <>
                                <Segmented options={DAY_OPTS.map((o) => ({ v: o.v, label: o.label, hint: o.v === 'all' ? 'Entire history' : `Last ${o.v} days` }))} value={days} onChange={setDays} />
                                <button type="button" onClick={() => setNonce((x) => x + 1)} title="Refresh"
                                    className="px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-4 hover:text-fg inline-flex items-center gap-1">
                                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> Refresh
                                </button>
                            </>
                        )}
                    </>
                )}
            />

            {/* ══════════════════ MULTI-LEG BOOK ══════════════════ */}
            {view === 'multi' && (
                <>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-xs text-fg-5">
                            Every multileg deployment as one book, from the structure engine. The same view lives on the Multi-Leg page's Results tab — this is it, without leaving the hub.
                        </p>
                        <Link to={ROUTES.multiLegResults} className="text-2xs text-primary-ink hover:underline inline-flex items-center gap-1" title="Filters by deployment, symbol and structure, plus every round-trip">
                            Open Multi-Leg → Results <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </Link>
                    </div>
                    <ResultsAnalytics templates={templates} />
                </>
            )}

            {/* ══════════════════ SINGLE-LEG BOOK ══════════════════ */}
            {/* the filter sits above every state (loading, empty, error) so a
                selected deployment with no trades can always be cleared */}
            {view === 'single' && <DeploymentFilter dep={dep} setDep={setDep} cards={deploymentCards} depName={depName} />}
            {view === 'single' && (err ? (
                <Card collapsible={false} title="Portfolio unavailable">
                    <p className="text-xs text-danger">{String(err)}</p>
                </Card>
            ) : !summary ? (
                loading ? (
                    // Skeletons keep the page's shape while the numbers load, so
                    // nothing jumps when they land.
                    <>
                        <SkeletonTiles count={5} cols={5} />
                        <Card title="Strategies"><Skeleton lines={5} /></Card>
                        <Card title="Equity curve"><Skeleton lines={4} /></Card>
                    </>
                ) : (
                    <Card><EmptyState icon={Wallet} title="No portfolio analytics available.">The server returned nothing for this window. Refresh, or widen the window.</EmptyState></Card>
                )
            ) : n(summary.trades) === 0 ? (
                <Card>
                    <EmptyState icon={Wallet} title={`No closed trades${days !== 'all' ? ` in the last ${days} days` : ''}.`}
                        action={days !== 'all' ? <button type="button" onClick={() => setDays('all')} className="text-2xs text-primary-ink hover:underline">Show all history</button> : null}>
                        Only closed round-trips carry a realised P&L; open positions appear here once they exit.
                    </EmptyState>
                </Card>
            ) : (
                <>
                    {/* ── 0 · What is open right now (not in any figure below) ── */}
                    <OpenNowSingle open={data?.open} depById={depById} linkForDeployment={linkForDeployment} />

                    {/* ── 1 · Combined summary ───────────────────────────── */}
                    <StatRow cols={5}>
                        <StatTile label="Net P&L" hero value={inr(summary.netPnl)} tone={toneOf(summary.netPnl)} hint={`${int(summary.trades)} closed trades · ${int(summary.tradingDays)} trading days`} />
                        <StatTile label="Per trade" value={inr(summary.perTrade)} tone={toneOf(summary.perTrade)} hint="Total ÷ trades — scratches included" />
                        <StatTile label="Win rate" value={pct(summary.winRate)} hint={`Avg win ${inr(summary.avgWin)} · avg loss ${inr(summary.avgLoss)}`} />
                        <StatTile label="Profit factor" value={pf == null ? '—' : dec(pf, 2)} tone={pf == null ? 'neutral' : pf >= 1 ? 'positive' : 'negative'}
                            hint={pf == null ? 'No losing trades in this window' : 'Gross wins ÷ gross losses'} />
                        <StatTile label="Max drawdown" value={inr(summary.maxDrawdown)} tone={(n(summary.maxDrawdown) ?? 0) < 0 ? 'negative' : 'neutral'}
                            hint={`Best day ${inr(summary.bestDay)} · worst day ${inr(summary.worstDay)}`} />
                    </StatRow>
                    <CostLine costs={summary.costs} />

                    {/* ── 1b · Deployments — click one to filter the page ─── */}
                    <Card docs="live-portfolio#strategies" title="Deployments"
                        subtitle="One card per deployment, ranked by net. Click a card to see only its results on this page — trades, breakdowns, day by day and the stop analysis."
                        right={<span>{int(deploymentCards.length)} deployment{deploymentCards.length === 1 ? '' : 's'}{dep ? ' · 1 selected' : ''}</span>}>
                        <DeploymentCards deployments={deploymentCards} selected={dep} onSelect={setDep} linkForDeployment={linkForDeployment} />
                    </Card>

                    {/* ── 2 · Strategies ─────────────────────────────────── */}
                    <Card docs="live-portfolio#strategies"
                        title="Strategies"
                        subtitle="One card per strategy, ranked by net. Compare overlays its curve below; Details opens its own P&L, exits and deployments."
                        right={hasGroups ? <span>{int(strategies.length)} strategies · {int(deployments.filter((d) => d.meta).length)} deployments</span> : null}
                    >
                        {!hasGroups ? (
                            <Placeholder>
                                Per-strategy series are not in this response — the backend predates them. Deploy the backend to see strategy cards here; the combined figures above are unaffected.
                            </Placeholder>
                        ) : strategies.length === 0 ? (
                            <Placeholder>No strategies closed a trade in this window.</Placeholder>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                                {strategies.map((g) => (
                                    <StrategyCard
                                        key={g.key}
                                        g={g}
                                        color={colorOf(g.key)}
                                        selected={selectedKeys.includes(g.key)}
                                        expanded={expanded === g.key}
                                        onToggleSelect={() => toggleSelect(g.key)}
                                        onToggleExpand={() => setExpanded((cur) => (cur === g.key ? null : g.key))}
                                        href={linkForStrategy(g)}
                                        depById={depById}
                                    />
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* ── 3 · Expanded strategy ──────────────────────────── */}
                    {expandedGroup && (
                        <StrategyPanel g={expandedGroup} color={colorOf(expandedGroup.key)} depById={depById}
                            linkForDeployment={linkForDeployment} onClose={() => setExpanded(null)} />
                    )}

                    {/* ── 4 · Compare ────────────────────────────────────── */}
                    {hasGroups && strategies.length > 0 && (
                        <Card docs="live-portfolio#compare"
                            title="Compare equity curves"
                            subtitle="Selected strategies against the combined book, on one axis. Each line's colour is its card's rail. Drag to zoom."
                            right={(
                                <div className="flex items-center gap-2">
                                    <span>{int(selectedKeys.length)} of {int(strategies.length)} shown</span>
                                    {selected !== null && (
                                        <button type="button" onClick={() => setSelected(null)} className="text-2xs text-primary-ink hover:underline" title={`Back to the ${DEFAULT_COMPARE} most-traded`}>reset</button>
                                    )}
                                </div>
                            )}
                        >
                            {selectedKeys.length === 0 ? (
                                <Placeholder>Pick at least one strategy with its Compare button.</Placeholder>
                            ) : (
                                <ZoomableChart data={compareRows} height={260}>
                                    <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                        <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                        <YAxis width={54} tick={axisTick} tickFormatter={rupeeTick} />
                                        <Tooltip contentStyle={chartTip} formatter={(v, name) => (n(v) == null ? null : [inr(v), name])}
                                            labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                                        <RcLegend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                                        <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                        <Line type="monotone" name="Combined" dataKey="Combined" stroke={ct.mark.equity} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                                        {strategies.filter((g) => selectedKeys.includes(g.key)).map((g) => (
                                            <Line key={g.key} type="monotone" name={g.key} dataKey={g.key} stroke={colorOf(g.key)} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        ))}
                                    </ComposedChart>
                                </ZoomableChart>
                            )}
                        </Card>
                    )}

                    {/* ── 5 · Combined daily + equity ────────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Card docs="live-portfolio#daily-equity" title="Daily net P&L — combined" subtitle="One bar per trading day, by exit day IST. Drag to zoom.">
                            <ZoomableChart data={dailyRows} height={210}>
                                <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                    <YAxis width={54} tick={axisTick} tickFormatter={rupeeTick} />
                                    {/* Returning null from a recharts formatter DROPS that item, which
                                        is how the empty half of the up/down pair stays out of the
                                        tooltip instead of printing "down —". */}
                                    <Tooltip contentStyle={chartTip}
                                        formatter={(v, name) => (n(v) == null ? null : [inr(v), name === 'up' || name === 'down' ? 'net' : name])}
                                        labelFormatter={(l, p) => { const d = p?.[0]?.payload; return d ? `${d.date} · ${int(d.trades)} trade(s) · ${pct(d.winRate)} win` : String(l); }} />
                                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                    <Bar name="up" dataKey="up" stackId="net" fill={ct.diverging.positive} isAnimationActive={false} />
                                    <Bar name="down" dataKey="down" stackId="net" fill={ct.diverging.negative} isAnimationActive={false} />
                                </ComposedChart>
                            </ZoomableChart>
                        </Card>
                        <Card docs="live-portfolio#daily-equity" title="Equity curve — combined" subtitle="Cumulative net, with the drawdown from peak shaded beneath.">
                            <ZoomableChart data={dailyRows} height={210}>
                                <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                    <YAxis width={54} tick={axisTick} tickFormatter={rupeeTick} />
                                    <Tooltip contentStyle={chartTip} formatter={(v, name) => (n(v) == null ? null : [inr(v), name])}
                                        labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                                    <RcLegend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                                    {/* baseValue={0}: drawdown is ≤ 0 and must hang from the zero
                                        line, not from the axis floor — otherwise the shading
                                        inverts on a book that never recovered. */}
                                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                    <Area type="monotone" name="drawdown" dataKey="drawdown" baseValue={0} stroke={ct.status.critical} strokeOpacity={0.45}
                                        strokeWidth={1} fill={ct.status.critical} fillOpacity={0.16} isAnimationActive={false} />
                                    <Line type="monotone" name="equity" dataKey="equity" stroke={ct.mark.equity} dot={false} strokeWidth={2} isAnimationActive={false} />
                                </ComposedChart>
                            </ZoomableChart>
                        </Card>
                    </div>

                    {/* ── 6 · Calendar ───────────────────────────────────── */}
                    <Card docs="live-portfolio#calendar" title="Daily P&L calendar" subtitle="Grey = no exits that day. The darkest shade is a day past ±₹5,000.">
                        <PnlCalendar daily={daily} rangeDays={calendarDays} title={null} />
                    </Card>

                    {/* ── 7 · Breakdowns ─────────────────────────────────── */}
                    <Card docs="live-portfolio#breakdowns"
                        title="Breakdowns"
                        subtitle="Ranked by net over this window. Every tab sums to the header above — rows with no deployment or strategy are labelled, never dropped."
                    >
                        {breakdowns.length === 0 ? (
                            <Placeholder>Nothing to break down in this window.</Placeholder>
                        ) : (
                            <>
                                <Tabs size="sm" ariaLabel="Breakdowns" className="mb-2"
                                    tabs={breakdowns.map((b, i) => ({ id: i, label: b.label }))}
                                    value={tabIdx} onChange={setTab} />
                                {(isStrategyTab || isDeploymentTab) && (
                                    <p className="text-2xs text-fg-5 mb-2">
                                        A row marked <span className="text-danger font-semibold">Bleeding</span> has lost money over this window.
                                        Sort by <span className="text-fg-3">Net</span> ascending to put the worst first.
                                    </p>
                                )}
                                <DataTable columns={columns} rows={tableRows} dense empty="Nothing to break down here." />
                            </>
                        )}
                    </Card>

                    {/* ── 8 · How trades travelled ───────────────────────── */}
                    <Card docs="live-portfolio#excursions" title="How trades travelled"
                        subtitle="Worst and best point while open, and what a stop or target at that level alone would have done.">
                        <ExcursionsPanel excursions={data?.excursions} basis="gross"
                            missingNote="the live engine started recording each trade's path on 7 Oct 2026"
                            canApplyStop ApplyDialog={ApplySingleStopDialog}
                            applyNote=" Setting it caps each chosen deployment's stop-loss from its next entry (the per-lot max_single_trade_loss the live engine and every backtest apply): a wider stop is pulled in to this level, a tighter one is left alone." />
                    </Card>

                    {/* ── 9 · Every round trip ───────────────────────────── */}
                    <Card docs="live-portfolio#round-trips" title={`Round trips${dep ? ` — ${depName(dep)}` : ''}`}
                        subtitle="Every closed trade in this window. Open a row for its minute-by-minute path with India VIX, and to replay it with no stop (held to its target or the time exit).">
                        <RoundTripsTable filters={{ deploymentId: dep || 'all', days }} depLabel={(id, s) => `${depName(id)}${s && !depName(id).includes(s) ? ` · ${s}` : ''}`} onDetails={setDetailId}
                            emptyText={`No closed trade${days !== 'all' ? ` in the last ${days} days` : ''}.`} />
                    </Card>

                    {/* ── 10 · Day by day (longest section — last) ───────── */}
                    <Card docs="live-portfolio#day-by-day" title="Day by day" defaultOpen={false}
                        subtitle="Each day's P&L minute by minute, every trade of the day under it, and India VIX (tick the box). Loaded when opened.">
                        <SingleLegDayByDay days={days} deploymentId={dep} />
                    </Card>
                    <TradeDetailsModal tradeId={detailId} onClose={() => setDetailId(null)} />
                </>
            ))}
        </div>
    );
}
