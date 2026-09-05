'use strict';
/**
 * TickResults — the tick engine's RESULTS page.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 * /tick-strategies is the CONTROL room: create, toggle, delete, watch the live
 * event feed. It answers "what is running". It does not answer "has any of this
 * ever made money", and the honest answer to that question is not visible
 * anywhere else — the trade log on the management page shows `pnl`, which is the
 * most flattering of the three numbers a tick trade carries.
 *
 * ── THE THREE P&L LAYERS, AND WHY THE DEFAULT IS THE PESSIMISTIC ONE ────────
 * Every tick trade can be priced three ways, and on the real book they do not
 * merely differ in size — the middle one is HALF the first and the last is worse
 * than both:
 *
 *   Underlying      points × qty. What the SIGNAL did, before any cost.
 *   Options gross   the same move as an ATM option leg (delta ≈ 0.5).
 *   Options net     after brokerage/STT/exchange/SEBI/stamp/GST AND slippage.
 *
 * Tick TPs are 4–6 index points. An option round trip costs ~5.6 points on
 * NIFTY and ~12.9 on BANKNIFTY. So a large share of trades WIN on the underlying
 * and still lose money — the engine wins the trade and loses the rupees. The
 * basis switch makes that gap the first thing on the page instead of a footnote,
 * and defaults to `options_net` because it is the one that pays rent.
 *
 * ── EVERY NUMBER FALLS BACK TO AN EM DASH ───────────────────────────────────
 * A trading screen that prints "₹NaN" beside a real figure is worse than one
 * that prints nothing: both look equally authoritative. `profitFactor` is
 * legitimately null in a window with no losing trades — a fact, not a missing
 * value — and renders as '—' with an explanatory title.
 *
 * ── NOTHING IS DROPPED SILENTLY ─────────────────────────────────────────────
 * Rows booked before the option cost model existed cannot be priced as options.
 * They are excluded from the options bases and SAID SO, in a banner with the
 * count and the reason, rather than quietly counted as ₹0.
 *
 * The server (logic/analytics/tickPortfolio.js) computes every number; this file
 * only draws. `perTrade` is total ÷ n and is rendered as-is — never recomposed
 * from win rate, which would charge every scratch trade as an average loss.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
    ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import {
    RefreshCw, Zap, ExternalLink, AlertTriangle, Scissors, ChevronDown, ChevronUp, X, CheckSquare, Square,
} from 'lucide-react';
import {
    Card, StatTile, StatRow, DataTable, StatusBadge, DivergingBars, Waterfall, PageHeader, Tabs, Segmented,
    Chip, ModeChip, Skeleton, SkeletonTiles, EmptyState, Legend,
} from '../components/viz/primitives';
import { inr, useChartTheme } from '../components/viz/tokens';
import ZoomableChart from '../components/charts/ZoomableChart';
import PnlCalendar from '../components/charts/PnlCalendar.jsx';
import { API_URL } from '../config/api.js';

// ── formatting ───────────────────────────────────────────────────────────────
// Same gate as the single-leg hub: a finite number or null, and null renders '—'.

const n = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
};
const int = (v) => (n(v) == null ? '—' : Math.round(n(v)).toLocaleString('en-IN'));
const pct = (v, d = 0) => (n(v) == null ? '—' : `${n(v).toFixed(d)}%`);
const dec = (v, d = 2) => (n(v) == null ? '—' : n(v).toFixed(d));
const pts = (v, d = 2) => (n(v) == null ? '—' : `${n(v).toFixed(d)} pt`);
const toneOf = (v) => ((n(v) ?? 0) > 0 ? 'positive' : (n(v) ?? 0) < 0 ? 'negative' : 'neutral');

/** Seconds → the shortest honest form. Tick holds live between 5s and 6 minutes. */
const secs = (v) => {
    const x = n(v);
    if (x == null) return '—';
    if (x < 90) return `${x.toFixed(x < 10 ? 1 : 0)}s`;
    return `${(x / 60).toFixed(1)}m`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → '28 Aug'. Parsed by hand, not through Date: a browser west of
 *  UTC renders the PREVIOUS day for an IST day key parsed as UTC midnight. */
const shortDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || '?'}` : '—';
};
const istStamp = (v) => {
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
};

// ── page constants ───────────────────────────────────────────────────────────

/**
 * The basis switch. Order is deliberate: the honest number first, so the default
 * is also the leftmost, and reading left-to-right walks costs OFF the book
 * rather than onto it.
 */
const BASES = [
    { id: 'options_net', label: 'Options net', hint: 'After charges + slippage — what you would actually clear. The default, because it is the one that pays rent.' },
    { id: 'options_gross', label: 'Options gross', hint: 'The move priced as an ATM option leg, before any cost.' },
    { id: 'underlying', label: 'Underlying', hint: 'Raw points × qty — what the SIGNAL did. No costs. This is the flattering number the management page shows.' },
];
const BASIS_IDS = new Set(BASES.map((b) => b.id));
const BASIS_STORAGE = 'tickResults.basis';

const DAY_OPTS = [
    { v: 7, label: '7d' }, { v: 30, label: '30d' }, { v: 90, label: '90d' }, { v: 'all', label: 'All' },
];

const COLS = [
    { k: 'key', label: 'Key', align: 'left' },
    { k: 'trades', label: 'Trades', align: 'right' },
    { k: 'winRate', label: 'Win %', align: 'right' },
    { k: 'net', label: 'Net', align: 'right' },
    { k: 'perTrade', label: 'Per trade', align: 'right' },
    { k: 'best', label: 'Best', align: 'right' },
    { k: 'worst', label: 'Worst', align: 'right' },
    { k: 'lastTradeAt', label: 'Last trade', align: 'right' },
];

/** Four iso-lightness categorical hues stay separable on one chart; a fifth collides. */
const DEFAULT_COMPARE = 4;

// ── small shared pieces ──────────────────────────────────────────────────────

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

/** Sortable column header. A real <button>: a bare onClick on a <th> is
 *  unreachable by keyboard. */
function SortHeader({ col, sort, onSort }) {
    const on = sort.k === col.k;
    return (
        <button
            type="button"
            onClick={() => onSort(col.k)}
            title={`Sort by ${col.label}`}
            aria-label={`Sort by ${col.label}`}
            className={`inline-flex items-center gap-0.5 hover:text-fg rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'text-fg-3' : ''}`}
        >
            {col.label}
            <span aria-hidden="true" className="text-fg-5">{on ? (sort.dir === 'desc' ? '▾' : '▴') : ''}</span>
        </button>
    );
}

// ── the cost panel — this page's reason to exist ─────────────────────────────

/**
 * Where the money actually went, and the one table that decides whether a tick
 * strategy can ever work: break-even distance against the move it typically
 * catches. A ratio ≥ 1 means the median trade does not travel far enough to pay
 * for itself, which no amount of signal tuning fixes.
 */
function CostReality({ cost, basis }) {
    const ct = useChartTheme();
    if (!cost) return null;

    const steps = [
        { label: 'Underlying P&L', value: n(cost.underlyingPnl) ?? 0, hint: 'Points captured × qty, before any cost.' },
        { label: 'Option repricing', value: (n(cost.optionsGross) ?? 0) - (n(cost.underlyingPnl) ?? 0), hint: 'Same move expressed as an ATM option leg (delta ≈ 0.5).' },
        { label: 'Charges', value: -(n(cost.charges) ?? 0), hint: 'Brokerage, STT, exchange, SEBI, stamp, GST.' },
        { label: 'Slippage', value: -(n(cost.slippage) ?? 0), hint: 'Premium slippage modelled on entry.' },
    ];

    const beCols = [
        { key: 'symbol', header: 'Symbol', render: (r) => <span className="text-fg-2 font-medium">{r.symbol}</span> },
        { key: 'lotSize', header: 'Lot', align: 'right', render: (r) => <span className="text-fg-4">{int(r.lotSize)}</span> },
        { key: 'trades', header: 'Trades', align: 'right', render: (r) => <span className="text-fg-3">{int(r.trades)}</span> },
        {
            key: 'breakEvenPoints',
            header: 'Break-even',
            align: 'right',
            render: (r) => (
                <span className="text-fg-2" title="Index move an ATM option leg needs to clear charges + slippage. Solved against the engine's own cost function, not sampled.">
                    {pts(r.breakEvenPoints)}
                </span>
            ),
        },
        {
            key: 'medianAbsMovePoints',
            header: 'Median move',
            align: 'right',
            render: (r) => <span className="text-fg-3" title="Median |points| this symbol actually travels per trade.">{pts(r.medianAbsMovePoints)}</span>,
        },
        {
            key: 'breakEvenRatio',
            header: 'Cost ÷ move',
            align: 'right',
            render: (r) => {
                const x = n(r.breakEvenRatio);
                if (x == null) return <span className="text-fg-5">—</span>;
                const bad = x >= 1;
                return (
                    <span
                        className="tabular-nums font-semibold"
                        style={{ color: bad ? ct.diverging.negative : ct.text.primary }}
                        title={bad
                            ? 'The median trade does not move far enough to pay for itself. Signal tuning cannot fix this — only a wider target or a cheaper instrument can.'
                            : 'The median trade clears its own cost.'}
                    >
                        {dec(x, 2)}{bad ? ' ⚠' : ''}
                    </span>
                );
            },
        },
        {
            key: 'winnersTurnedLoser',
            header: 'Winners lost to cost',
            align: 'right',
            render: (r) => (
                <span className="text-fg-3" title="Trades that were profitable on the underlying but negative once the option leg was paid for.">
                    {int(r.winnersTurnedLoser)}<span className="text-fg-5"> / {int(r.winners)}</span>
                </span>
            ),
        },
    ];

    const turned = n(cost.winnersTurnedLoser) ?? 0;
    const winners = n(cost.winnersOnUnderlying) ?? 0;

    return (
        <Card
            title={<span className="inline-flex items-center gap-2"><Scissors className="w-4 h-4 text-fg-4" aria-hidden="true" />Cost reality</span>}
            subtitle="Independent of the basis switch above — changing the lens does not change what trading cost. This is the whole tick question: does the move outrun the fee?"
        >
            <div className="space-y-4">
                <StatRow cols={4}>
                    <StatTile
                        label="Cost drag"
                        value={inr(cost.drag)}
                        tone="negative"
                        hint={`${inr(cost.charges)} charges + ${inr(cost.slippage)} slippage`}
                    />
                    <StatTile label="Drag per trade" value={inr(cost.dragPerTrade)} tone="negative" hint="Every round trip pays this before it can profit" />
                    <StatTile
                        label="Winners lost to cost"
                        value={winners ? `${int(turned)} of ${int(winners)}` : '—'}
                        tone={turned > 0 ? 'negative' : 'neutral'}
                        hint={`${pct(cost.winnersTurnedLoserPct)} of underlying winners ended negative — worth ${inr(cost.netOfTurnedLosers)}`}
                        badge={n(cost.winnersTurnedLoserPct) >= 25
                            ? <StatusBadge level="critical" title="More than a quarter of the signal's wins are taken by costs">{pct(cost.winnersTurnedLoserPct)}</StatusBadge>
                            : null}
                    />
                    <StatTile
                        label="Underlying → net"
                        value={`${inr(cost.underlyingPnl, { compact: true })} → ${inr(cost.optionsNet, { compact: true })}`}
                        tone={toneOf(cost.optionsNet)}
                        hint="What the signal did, versus what you would have banked"
                    />
                </StatRow>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Card title="From signal to settlement" subtitle="Each step is a real deduction, in order.">
                        <Waterfall steps={steps} total={{ label: 'Options net', value: n(cost.optionsNet) ?? 0 }} />
                    </Card>
                    <Card
                        title="Break-even distance by symbol"
                        subtitle="How far the index must move for one option leg to clear its own costs, against how far it typically moves."
                    >
                        <DataTable columns={beCols} rows={(cost.bySymbol || []).map(r => ({ ...r, _key: r.rawSymbol }))} dense empty="No priced trades in this window." />
                        <p className="text-2xs text-fg-5 mt-2">
                            Break-even is <strong>solved</strong> against the engine&apos;s own cost function, not read off the sample —
                            on a losing book the &quot;smallest profitable trade&quot; often does not exist, and a diagnostic that
                            disappears when you need it is not a diagnostic.
                        </p>
                    </Card>
                </div>

                {basis !== 'options_net' && (
                    <p className="text-2xs text-fg-5 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: ct.status.warning }} aria-hidden="true" />
                        <span>
                            The header above is currently on the <strong>{BASES.find(b => b.id === basis)?.label}</strong> basis, which
                            excludes some or all of these costs. The figures in this panel always include them.
                        </span>
                    </p>
                )}
            </div>
        </Card>
    );
}

// ── one strategy, expanded ───────────────────────────────────────────────────

function StrategyPanel({ g, color, onClose }) {
    const ct = useChartTheme();
    const s = g?.summary || {};
    const rows = useMemo(() => (Array.isArray(g?.daily) ? g.daily : []).map((d) => {
        const v = n(d?.net) ?? 0;
        return {
            date: d?.date, label: shortDate(d?.date), net: v, up: v >= 0 ? v : null, down: v < 0 ? v : null,
            trades: n(d?.trades), winRate: n(d?.winRate), equity: n(d?.equity), drawdown: n(d?.drawdown),
        };
    }), [g]);
    const exitRows = useMemo(() => (Array.isArray(g?.exitReasons) ? g.exitReasons : []).map((r) => ({
        label: `${r.key} · ${int(r.trades)}`, value: n(r.net) ?? 0,
        hint: `${r.key}: ${int(r.trades)} trade(s), net ${inr(r.net)}`,
    })), [g]);

    const chartTip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    const rupTick = (v) => (Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${Math.round(v)}`);
    const axisTick = { fontSize: ct.type['5xs'], fill: ct.text.secondary };
    const meta = g?.meta || {};

    return (
        <Card
            title={(
                <span className="inline-flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
                    {meta.name || g.key}
                </span>
            )}
            subtitle="This strategy alone, over the selected window and basis. Same arithmetic as the header."
            right={(
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-2xs text-fg-5 hover:text-fg px-1.5 py-0.5 rounded border border-line-2" title="Collapse">
                    <X className="w-3 h-3" aria-hidden="true" /> Close
                </button>
            )}
        >
            <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap text-2xs">
                    {meta.strategyType && <Chip tone="neutral" title="Registry key">{meta.strategyType}</Chip>}
                    {meta.symbol && <Chip tone="neutral">{String(meta.symbol).replace(/^(NSE|BSE):/, '')}</Chip>}
                    <ModeChip mode={meta.mode || 'PAPER'} />
                    {meta.exists === false
                        ? <StatusBadge level="warning" title="These trades exist but the strategy has since been deleted">deleted</StatusBadge>
                        : meta.active ? <StatusBadge level="good">running</StatusBadge> : <span className="text-fg-5">stopped</span>}
                    <span className="text-fg-5">last trade {istStamp(s.lastTradeAt)}</span>
                </div>

                <StatRow cols={6}>
                    <StatTile label="Net" value={inr(s.netPnl)} tone={toneOf(s.netPnl)} hint={`${int(s.trades)} trades · ${int(s.tradingDays)} days`} />
                    <StatTile label="Per trade" value={inr(s.perTrade)} tone={toneOf(s.perTrade)} hint="Total ÷ trades" />
                    <StatTile label="Win rate" value={pct(s.winRate)} hint={`Avg win ${inr(s.avgWin)} · avg loss ${inr(s.avgLoss)}`} />
                    <StatTile
                        label="Profit factor"
                        value={n(s.profitFactor) == null ? '—' : dec(s.profitFactor, 2)}
                        tone={n(s.profitFactor) == null ? 'neutral' : n(s.profitFactor) >= 1 ? 'positive' : 'negative'}
                        hint={n(s.profitFactor) == null ? 'No losing trades in this window' : 'Gross wins ÷ gross losses'}
                    />
                    <StatTile label="Max drawdown" value={inr(s.maxDrawdown)} tone={(n(s.maxDrawdown) ?? 0) < 0 ? 'negative' : 'neutral'} hint="Deepest fall from its own peak" />
                    <StatTile label="Median hold" value={secs(s.medianHoldSec)} hint={`Avg move ${pts(s.avgMovePoints)}`} />
                </StatRow>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Card title="Daily net P&L" subtitle="By exit day IST. Drag to zoom.">
                        <ZoomableChart data={rows} height={180}>
                            <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                <YAxis width={54} tick={axisTick} tickFormatter={rupTick} />
                                <Tooltip
                                    contentStyle={chartTip}
                                    formatter={(v, name) => (n(v) == null ? null : [inr(v), name === 'up' || name === 'down' ? 'net' : name])}
                                    labelFormatter={(l, p) => { const d = p?.[0]?.payload; return d ? `${d.date} · ${int(d.trades)} trade(s) · ${pct(d.winRate)} win` : String(l); }}
                                />
                                <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                <Bar name="up" dataKey="up" stackId="net" fill={ct.diverging.positive} isAnimationActive={false} />
                                <Bar name="down" dataKey="down" stackId="net" fill={ct.diverging.negative} isAnimationActive={false} />
                            </ComposedChart>
                        </ZoomableChart>
                    </Card>
                    <Card title="Equity curve" subtitle="Cumulative net with drawdown shaded beneath.">
                        <ZoomableChart data={rows} height={180}>
                            <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                <YAxis width={54} tick={axisTick} tickFormatter={rupTick} />
                                <Tooltip contentStyle={chartTip} formatter={(v, name) => (n(v) == null ? null : [inr(v), name])} labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                                <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                <Area type="monotone" name="drawdown" dataKey="drawdown" baseValue={0} stroke={ct.status.critical} strokeOpacity={0.45} strokeWidth={1} fill={ct.status.critical} fillOpacity={0.16} isAnimationActive={false} />
                                <Line type="monotone" name="equity" dataKey="equity" stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
                            </ComposedChart>
                        </ZoomableChart>
                    </Card>
                </div>

                <Card title="Exit reasons" subtitle="Net by how the trade ended. SL-heavy means a broken entry; TP-heavy with a negative total means the target is smaller than the cost of reaching it.">
                    <DivergingBars data={exitRows} emptyText="No exits recorded." labelWidth={170} />
                </Card>
            </div>
        </Card>
    );
}

// ── the page ─────────────────────────────────────────────────────────────────

export default function TickResults() {
    const ct = useChartTheme();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [days, setDays] = useState(30);
    const [basis, setBasis] = useState(() => {
        try {
            const v = localStorage.getItem(BASIS_STORAGE);
            return BASIS_IDS.has(v) ? v : 'options_net';
        } catch { return 'options_net'; }
    });
    const [tab, setTab] = useState(0);
    const [sort, setSort] = useState({ k: 'net', dir: 'desc' });
    const [openStrategy, setOpenStrategy] = useState(null);
    const [compare, setCompare] = useState(null);   // null = "first N", else a Set of keys
    const [showCalendar, setShowCalendar] = useState(true);

    useEffect(() => {
        try { localStorage.setItem(BASIS_STORAGE, basis); } catch { /* private mode — the choice just won't persist */ }
    }, [basis]);

    const fetchAll = useCallback(async () => {
        setLoading(true); setErr(null);
        try {
            const params = { basis };
            if (days !== 'all') params.days = days;
            const res = await axios.get(`${API_URL}/analytics/tick-portfolio`, { params });
            setData(res.data);
        } catch (e) {
            setErr(e.response?.data?.error || e.message);
            setData(null);
        } finally { setLoading(false); }
    }, [basis, days]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const summary = data?.summary || {};
    const cov = data?.coverage || {};
    const daily = useMemo(() => (Array.isArray(data?.daily) ? data.daily : []).map((d) => {
        const v = n(d?.net) ?? 0;
        return {
            date: d?.date, label: shortDate(d?.date), net: v, up: v >= 0 ? v : null, down: v < 0 ? v : null,
            trades: n(d?.trades), winRate: n(d?.winRate), equity: n(d?.equity), drawdown: n(d?.drawdown),
        };
    }), [data]);

    const breakdowns = data?.breakdowns || [];
    const active = breakdowns[Math.min(tab, Math.max(0, breakdowns.length - 1))] || null;
    const sortedRows = useMemo(() => {
        const rows = [...(active?.rows || [])];
        const { k, dir } = sort;
        rows.sort((a, b) => {
            const av = a[k]; const bv = b[k];
            if (k === 'key') return dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
            if (k === 'lastTradeAt') {
                const at = av ? new Date(av).getTime() : 0; const bt = bv ? new Date(bv).getTime() : 0;
                return dir === 'desc' ? bt - at : at - bt;
            }
            return dir === 'desc' ? (n(bv) ?? 0) - (n(av) ?? 0) : (n(av) ?? 0) - (n(bv) ?? 0);
        });
        return rows;
    }, [active, sort]);
    const onSort = (k) => setSort((s) => (s.k === k ? { k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { k, dir: 'desc' }));

    // Memoised: `data?.groups?.strategy || []` mints a NEW array on every render,
    // which would invalidate the compare-series memo below on every keystroke
    // and re-merge the whole per-strategy dataset for nothing.
    const strategies = useMemo(() => data?.groups?.strategy || [], [data]);
    const colorFor = useCallback((i) => {
        const pal = ct.categorical || [];
        return pal.length ? pal[(i < 0 ? 0 : i) % pal.length] : ct.mark.equity;
    }, [ct]);

    // Which strategy curves the compare chart draws. Default = the N with the
    // most trades, because a strategy with 1 trade is noise on a curve chart.
    const compareKeys = useMemo(() => {
        if (compare) return compare;
        const byVolume = [...strategies].sort((a, b) => (b.summary?.trades || 0) - (a.summary?.trades || 0));
        return new Set(byVolume.slice(0, DEFAULT_COMPARE).map((g) => g.key));
    }, [compare, strategies]);

    // One row per day, one column per selected strategy — merged here so recharts
    // gets a single dataset rather than N misaligned ones.
    const compareSeries = useMemo(() => {
        const picked = strategies.filter((g) => compareKeys.has(g.key));
        if (!picked.length) return { rows: [], members: [] };
        const days2 = new Set();
        for (const g of picked) for (const d of (g.daily || [])) if (d?.date) days2.add(d.date);
        const ordered = [...days2].sort();
        const idx = new Map(ordered.map((d, i) => [d, i]));
        const rows = ordered.map((d) => ({ date: d, label: shortDate(d) }));
        const members = picked.map((g) => {
            const i = strategies.findIndex((x) => x.key === g.key);
            return { key: g.key, name: g.meta?.name || g.key, color: colorFor(i) };
        });
        for (const g of picked) {
            let cum = 0;
            const byDay = new Map((g.daily || []).map((d) => [d.date, n(d.net) ?? 0]));
            for (const d of ordered) {
                cum += byDay.get(d) || 0;
                rows[idx.get(d)][g.key] = Math.round(cum);
            }
        }
        return { rows, members };
    }, [strategies, compareKeys, colorFor]);

    const chartTip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    const rupTick = (v) => (Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${Math.round(v)}`);
    const axisTick = { fontSize: ct.type['5xs'], fill: ct.text.secondary };

    const basisMeta = BASES.find((b) => b.id === basis) || BASES[0];
    const basisTotals = data?.bases || {};

    const stratCols = [
        {
            key: 'name',
            header: 'Strategy',
            render: (r) => (
                <button
                    type="button"
                    onClick={() => setOpenStrategy(openStrategy === r.key ? null : r.key)}
                    className="inline-flex items-center gap-1.5 text-left hover:text-primary hover:underline"
                    title="Show this strategy's own curve and exits"
                >
                    <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: r.color }} aria-hidden="true" />
                    <span className="truncate max-w-[220px]">{r.name}</span>
                    {openStrategy === r.key ? <ChevronUp className="w-3 h-3 shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" />}
                </button>
            ),
        },
        { key: 'type', header: 'Type', render: (r) => <span className="text-fg-4">{r.meta?.strategyType || '—'}</span> },
        { key: 'symbol', header: 'Symbol', render: (r) => <span className="text-fg-4">{String(r.meta?.symbol || '—').replace(/^(NSE|BSE):/, '')}</span> },
        {
            key: 'state',
            header: 'State',
            render: (r) => (r.meta?.exists === false
                ? <StatusBadge level="warning" title="Trades exist but the strategy was deleted">deleted</StatusBadge>
                : r.meta?.active ? <StatusBadge level="good">running</StatusBadge> : <span className="text-fg-5">stopped</span>),
        },
        { key: 'trades', header: 'Trades', align: 'right', render: (r) => <span className="text-fg-3">{int(r.summary?.trades)}</span> },
        { key: 'winRate', header: 'Win %', align: 'right', render: (r) => <span className="text-fg-3">{pct(r.summary?.winRate)}</span> },
        { key: 'net', header: 'Net', align: 'right', render: (r) => <Money v={r.summary?.netPnl} bold /> },
        { key: 'perTrade', header: 'Per trade', align: 'right', render: (r) => <Money v={r.summary?.perTrade} /> },
        { key: 'hold', header: 'Median hold', align: 'right', render: (r) => <span className="text-fg-4">{secs(r.summary?.medianHoldSec)}</span> },
        {
            key: 'compare',
            header: 'Chart',
            align: 'right',
            render: (r) => (
                <button
                    type="button"
                    onClick={() => setCompare(() => {
                        const next = new Set(compareKeys);
                        if (next.has(r.key)) next.delete(r.key); else next.add(r.key);
                        return next;
                    })}
                    className="text-fg-5 hover:text-fg"
                    title={compareKeys.has(r.key) ? 'Remove from the compare chart' : 'Add to the compare chart'}
                    aria-label={compareKeys.has(r.key) ? `Remove ${r.name} from chart` : `Add ${r.name} to chart`}
                >
                    {compareKeys.has(r.key) ? <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" /> : <Square className="w-3.5 h-3.5" aria-hidden="true" />}
                </button>
            ),
        },
    ];
    const stratRows = strategies.map((g, i) => ({ ...g, _key: g.key, name: g.meta?.name || g.key, color: colorFor(i) }));

    return (
        <div className="space-y-4">
            <PageHeader
                icon={Zap}
                title="Tick Results"
                subtitle="Every tick strategy's realised book. The management page shows what is running; this shows what it earned."
                badges={[
                    <ModeChip key="mode" mode="PAPER" title="The tick engine places no broker orders — every fill here is simulated" />,
                    data ? <Chip key="n" tone="neutral" title="Closed trades in this window on the selected basis">{int(summary.trades)} trades</Chip> : null,
                    data && n(cov.open) > 0 ? <StatusBadge key="open" level="info" title="Still running — no realised P&L yet, so excluded from every series">{int(cov.open)} open</StatusBadge> : null,
                ].filter(Boolean)}
                actions={(
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link to="/tick-strategies" className="inline-flex items-center gap-1 text-2xs text-fg-4 hover:text-primary px-2 py-1 rounded border border-line-2" title="Create, start, stop and inspect tick strategies">
                            Manage <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </Link>
                        <Segmented
                            options={DAY_OPTS.map((o) => ({ v: o.v, label: o.label, hint: o.v === 'all' ? 'Entire history' : `Last ${o.v} days` }))}
                            value={days}
                            onChange={setDays}
                        />
                        <button
                            type="button"
                            onClick={fetchAll}
                            disabled={loading}
                            className="inline-flex items-center gap-1 text-2xs text-fg-4 hover:text-fg px-2 py-1 rounded border border-line-2 disabled:opacity-50"
                            title="Refresh"
                        >
                            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
                        </button>
                    </div>
                )}
            />

            {/* ── The basis switch. Every total is shown BEFORE you flip, so the
                 choice is informed rather than exploratory. ─────────────────── */}
            <Card
                title="P&L basis"
                subtitle="A tick trade can be priced three ways and they disagree by more than the whole loss. Pick the lens; the header and every breakdown below follow it."
            >
                <div className="flex flex-wrap gap-2">
                    {BASES.map((b) => {
                        const t = basisTotals[b.id];
                        const on = basis === b.id;
                        return (
                            <button
                                key={b.id}
                                type="button"
                                onClick={() => setBasis(b.id)}
                                title={b.hint}
                                aria-pressed={on}
                                className={`text-left px-3 py-2 rounded-lg border transition-colors min-w-[190px] flex-1 ${on ? 'border-primary bg-primary/10' : 'border-line-2 hover:border-line hover:bg-card-2/60'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`text-2xs uppercase tracking-wide ${on ? 'text-primary' : 'text-fg-5'}`}>{b.label}</span>
                                    {b.id === 'options_net' && <span className="text-4xs text-fg-5">default</span>}
                                </div>
                                <div className="mt-0.5"><Money v={t?.total} bold /></div>
                                <div className="text-4xs text-fg-5 mt-0.5">{t ? `${int(t.trades)} priced` : '—'}</div>
                            </button>
                        );
                    })}
                </div>
                <p className="text-2xs text-fg-5 mt-2">{basisMeta.hint}</p>
            </Card>

            {/* Exclusions are stated, not swallowed. */}
            {n(cov.missingOptionEstimate) > 0 && (
                <div className="flex items-start gap-2 text-2xs px-3 py-2 rounded-lg border" style={{ borderColor: ct.status.warning, backgroundColor: `${ct.status.warning}14` }}>
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: ct.status.warning }} aria-hidden="true" />
                    <span className="text-fg-3">{cov.missingNote}</span>
                </div>
            )}

            {err && (
                <div className="px-3 py-2 rounded-lg border text-2xs" style={{ borderColor: ct.status.critical, backgroundColor: `${ct.status.critical}14`, color: ct.text.primary }}>
                    Could not load tick results: {err}
                </div>
            )}

            {loading && !data ? (
                <div className="space-y-3"><SkeletonTiles count={6} cols={6} /><Skeleton lines={8} /></div>
            ) : !data || !summary.trades ? (
                <EmptyState
                    icon={Zap}
                    title="No closed tick trades in this window"
                    action={<Link to="/tick-strategies" className="text-primary hover:underline">Open the tick strategies page</Link>}
                >
                    {n(cov.open) > 0
                        ? `${int(cov.open)} position(s) are still open — they have no realised P&L yet.`
                        : 'Widen the window, or start a strategy to begin booking paper trades.'}
                </EmptyState>
            ) : (
                <>
                    <StatRow cols={6}>
                        <StatTile label="Net P&L" value={inr(summary.netPnl)} tone={toneOf(summary.netPnl)} hero hint={`${int(summary.trades)} trades over ${int(summary.tradingDays)} sessions`} />
                        <StatTile label="Per trade" value={inr(summary.perTrade)} tone={toneOf(summary.perTrade)} hint="Total ÷ trades — never recomposed from win rate" />
                        <StatTile label="Win rate" value={pct(summary.winRate)} hint={`Avg win ${inr(summary.avgWin)} · avg loss ${inr(summary.avgLoss)}`} />
                        <StatTile
                            label="Profit factor"
                            value={n(summary.profitFactor) == null ? '—' : dec(summary.profitFactor, 2)}
                            tone={n(summary.profitFactor) == null ? 'neutral' : n(summary.profitFactor) >= 1 ? 'positive' : 'negative'}
                            hint={n(summary.profitFactor) == null ? 'No losing trades in this window' : 'Gross wins ÷ gross losses'}
                        />
                        <StatTile label="Max drawdown" value={inr(summary.maxDrawdown)} tone={(n(summary.maxDrawdown) ?? 0) < 0 ? 'negative' : 'neutral'} hint="Deepest fall from the running peak" />
                        <StatTile
                            label="Median hold"
                            value={secs(summary.medianHoldSec)}
                            hint={`p10 ${secs(data?.holdTime?.p10)} · p90 ${secs(data?.holdTime?.p90)} · avg move ${pts(summary.avgMovePoints)}`}
                        />
                    </StatRow>

                    <CostReality cost={data.costModel} basis={basis} />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Card title="Daily net P&L" subtitle="By exit day IST. Drag to zoom.">
                            <ZoomableChart data={daily} height={200}>
                                <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                    <YAxis width={54} tick={axisTick} tickFormatter={rupTick} />
                                    <Tooltip
                                        contentStyle={chartTip}
                                        formatter={(v, name) => (n(v) == null ? null : [inr(v), name === 'up' || name === 'down' ? 'net' : name])}
                                        labelFormatter={(l, p) => { const d = p?.[0]?.payload; return d ? `${d.date} · ${int(d.trades)} trade(s) · ${pct(d.winRate)} win` : String(l); }}
                                    />
                                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                    <Bar name="up" dataKey="up" stackId="net" fill={ct.diverging.positive} isAnimationActive={false} />
                                    <Bar name="down" dataKey="down" stackId="net" fill={ct.diverging.negative} isAnimationActive={false} />
                                </ComposedChart>
                            </ZoomableChart>
                        </Card>
                        <Card title="Equity curve" subtitle="Cumulative net with drawdown shaded beneath.">
                            <ZoomableChart data={daily} height={200}>
                                <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                    <YAxis width={54} tick={axisTick} tickFormatter={rupTick} />
                                    <Tooltip contentStyle={chartTip} formatter={(v, name) => (n(v) == null ? null : [inr(v), name])} labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                    <Area type="monotone" name="drawdown" dataKey="drawdown" baseValue={0} stroke={ct.status.critical} strokeOpacity={0.45} strokeWidth={1} fill={ct.status.critical} fillOpacity={0.16} isAnimationActive={false} />
                                    <Line type="monotone" name="equity" dataKey="equity" stroke={ct.mark?.equity || ct.categorical?.[0]} dot={false} strokeWidth={2} isAnimationActive={false} />
                                </ComposedChart>
                            </ZoomableChart>
                        </Card>
                    </div>

                    <Card
                        title="Per-day calendar"
                        subtitle="Every session at a glance — a run of red is a regime, a single red is a day."
                        right={(
                            <button type="button" onClick={() => setShowCalendar((s) => !s)} className="text-2xs text-fg-5 hover:text-fg px-1.5 py-0.5 rounded border border-line-2">
                                {showCalendar ? 'Hide' : 'Show'}
                            </button>
                        )}
                    >
                        {showCalendar ? <PnlCalendar daily={data.daily} title={null} /> : <p className="text-2xs text-fg-5">Hidden.</p>}
                    </Card>

                    {/* ── Per strategy ─────────────────────────────────────── */}
                    <Card
                        title="By strategy"
                        subtitle="One row per tick strategy. Click a name for its own curve; tick the box to overlay it on the compare chart."
                    >
                        <DataTable columns={stratCols} rows={stratRows} dense empty="No strategy has booked a closed trade in this window." />
                    </Card>

                    {compareSeries.members.length > 0 && (
                        <Card title="Compare equity curves" subtitle="Cumulative net per strategy on the selected basis. Default is the four with the most trades — a one-trade strategy is noise on a curve.">
                            <Legend items={compareSeries.members.map((m) => ({ label: m.name, color: m.color }))} />
                            <ResponsiveContainer width="100%" height={240}>
                                <ComposedChart data={compareSeries.rows} margin={{ top: 8, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={axisTick} minTickGap={26} />
                                    <YAxis width={54} tick={axisTick} tickFormatter={rupTick} />
                                    <Tooltip contentStyle={chartTip} formatter={(v, name) => [inr(v), compareSeries.members.find((m) => m.key === name)?.name || name]} labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                    {compareSeries.members.map((m) => (
                                        <Line key={m.key} type="monotone" dataKey={m.key} name={m.key} stroke={m.color} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
                                    ))}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Card>
                    )}

                    {openStrategy && strategies.some((g) => g.key === openStrategy) && (
                        <StrategyPanel
                            g={strategies.find((g) => g.key === openStrategy)}
                            color={colorFor(strategies.findIndex((g) => g.key === openStrategy))}
                            onClose={() => setOpenStrategy(null)}
                        />
                    )}

                    {/* ── Breakdowns ───────────────────────────────────────── */}
                    <Card
                        title="Breakdowns"
                        subtitle="Every tab sums to the header above it — a row with a missing key is bucketed, never dropped."
                    >
                        <Tabs
                            tabs={breakdowns.map((b, i) => ({ id: i, label: b.label }))}
                            value={Math.min(tab, Math.max(0, breakdowns.length - 1))}
                            onChange={setTab}
                            ariaLabel="Breakdown dimension"
                        />
                        <div className="mt-3 overflow-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0" style={{ backgroundColor: ct.surface }}>
                                    <tr className="text-left text-fg-5">
                                        {COLS.map((c) => (
                                            <th key={c.k} className={`font-medium py-1.5 px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`} style={{ borderBottom: `1px solid ${ct.grid}` }}>
                                                <SortHeader col={c} sort={sort} onSort={onSort} />
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRows.map((r, i) => (
                                        <tr key={r.key} className={`${i % 2 === 1 ? 'bg-card-2/40' : ''} hover:bg-card-2/80 transition-colors`}>
                                            <td className="py-1.5 px-2" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}>
                                                <span className="text-fg-2 truncate inline-block max-w-[280px]" title={r.key}>{r.key}</span>
                                            </td>
                                            <td className="py-1.5 px-2 text-right tabular-nums text-fg-3" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}>{int(r.trades)}</td>
                                            <td className="py-1.5 px-2 text-right tabular-nums text-fg-3" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}>{pct(r.winRate)}</td>
                                            <td className="py-1.5 px-2 text-right" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}><Money v={r.net} bold /></td>
                                            <td className="py-1.5 px-2 text-right" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}><Money v={r.perTrade} /></td>
                                            <td className="py-1.5 px-2 text-right" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}><Money v={r.best} /></td>
                                            <td className="py-1.5 px-2 text-right" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}><Money v={r.worst} /></td>
                                            <td className="py-1.5 px-2 text-right tabular-nums text-fg-5" style={{ borderBottom: `1px solid ${ct.gridSoft}` }}>{istStamp(r.lastTradeAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!sortedRows.length && <p className="text-xs text-fg-5 py-4 text-center">No rows in this window.</p>}
                        </div>
                    </Card>

                    <p className="text-2xs text-fg-5">
                        {int(cov.closed)} closed · {int(cov.priced)} priced on this basis
                        {n(cov.missingOptionEstimate) > 0 ? ` · ${int(cov.missingOptionEstimate)} excluded` : ''}
                        {n(cov.open) > 0 ? ` · ${int(cov.open)} still open` : ''}
                        {' · '}all figures are PAPER — the tick engine places no broker orders.
                    </p>
                </>
            )}
        </div>
    );
}
