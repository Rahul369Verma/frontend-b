'use strict';
/**
 * ResultsAnalytics — the Results tab's real numbers, served by
 * GET /api/multileg/analytics.
 *
 * WHY THE SERVER COMPUTES THIS
 * Two reasons, both correctness rather than performance:
 *
 *  1. QUARANTINED TRADES. Structures booked on prices that never existed are
 *     excluded from every figure here, server-side. They stay in the trades
 *     TABLE below (struck through, "⚠ void") because hiding a correction makes
 *     the history a lie by omission — but a daily P&L bar that includes one is
 *     a lie with a timestamp on it. The count that was dropped is surfaced in
 *     amber rather than swallowed.
 *
 *  2. EXPECTANCY. `summary.perTrade` is total ÷ n. It is NEVER recomputed here
 *     as winRate × avgWin + (1 − winRate) × avgLoss: that decomposition charges
 *     every scratch trade (exactly ₹0) as an average LOSS and manufactures a
 *     deficit that does not exist. That mistake has already produced one wrong
 *     conclusion in this project, so the arithmetic lives in exactly one place.
 *
 * The days window (30 / 90 / all) comes from the page when it passes `days`
 * (Multi-Leg Results: one window for the whole page); otherwise the panel
 * keeps its own toggle (Live Portfolio). Book, deployment and symbol come from
 * the Results tab's filter row.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
    ComposedChart, Bar, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts';
import { RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import ZoomableChart from '../charts/ZoomableChart';
import PnlCalendar from '../charts/PnlCalendar.jsx';
import { useChartTheme } from '../../theme/chartTheme.js';
import { API_URL } from '../../config/api.js';
import { num, fmt, rup, shortDate } from './builderFormat';
import { Tile } from './builderUi';
import { rupeeTick } from '../viz/tokens';
import { ROUTES } from '../../config/routes.js';
import useLocalStorage from '../../hooks/useLocalStorage';
import StrategyScorecard, { OpenNow } from './StrategyScorecard';
import ExcursionsPanel from './ExcursionsPanel';
import { StopGridPanel } from './StopReplay.jsx';
import useScorecard from './useScorecard';
import DocLink from '../DocLink.jsx';
import { Panel } from '../viz/primitives';

// One deployment's own trades: the Results tab scoped to it. Works from the
// Multi-Leg page and from Live Portfolio alike (MultiLeg reads ?deployment=).
const deploymentHref = (id) => `${ROUTES.multiLeg}?tab=results&deployment=${encodeURIComponent(String(id))}`;
const scrollMainTop = () => {
    const main = typeof document !== 'undefined' && document.querySelector('main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
};
const shortSymbol = (s) => String(s || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '');

// The figure cells of a row — shared by a bucket and its per-strategy lines so
// the two can never drift apart.
function FigureCells({ r }) {
    return (
        <>
            <td className="text-right">{fmt(r.trades)}</td>
            <td className="text-right text-fg-4">{num(r.winRate) == null ? '—' : `${fmt(r.winRate)}%`}</td>
            <td className={`text-right font-semibold ${num(r.net) > 0 ? 'text-success' : num(r.net) < 0 ? 'text-danger' : 'text-fg-4'}`}>{rup(r.net)}</td>
            <td className={`text-right ${num(r.perTrade) > 0 ? 'text-success' : num(r.perTrade) < 0 ? 'text-danger' : 'text-fg-4'}`}>{rup(r.perTrade)}</td>
            <td className="text-right text-fg-4" title={marginCoverage(r)}>
                {num(r.avgMargin) == null ? '—' : rup(r.avgMargin)}
                {num(r.marginN) != null && num(r.marginN) < num(r.trades) && <span className="text-4xs text-warning"> {r.marginN}/{r.trades}</span>}
            </td>
            <td className={`text-right ${tone(r.romPct)}`} title={marginCoverage(r)}>{num(r.romPct) == null ? '—' : `${fmt(r.romPct, 2)}%`}</td>
            <td className={`text-right ${costPctOf(r) == null ? 'text-fg-5' : costPctOf(r) >= 100 ? 'text-danger font-semibold' : costPctOf(r) >= 50 ? 'text-warning' : 'text-fg-4'}`}
                title={costPctOf(r) == null
                    ? (num(r.gross) != null ? `Losing before costs: gross ${rup(r.gross)}, charges ${rup(r.charges)}` : '')
                    : `${rup(r.charges)} of charges against ${rup(r.gross)} gross profit`}>
                {costPctOf(r) == null ? '—' : `${costPctOf(r)}%`}
            </td>
        </>
    );
}

// Charges as a share of GROSS profit. Undefined (—) when gross is not positive:
// the row was losing before costs, and a percentage of a loss means nothing.
function costPctOf(r) {
    const g = num(r.gross), c = num(r.charges);
    return g != null && c != null && g > 0 ? Math.round((c / g) * 100) : null;
}

const DAY_OPTS = [
    { v: 30, label: '30d' },
    { v: 90, label: '90d' },
    { v: 'all', label: 'All' },
];

// `help` is the header's hover text: what the number in this row IS.
const COLS = [
    { k: 'key', label: 'Key', align: 'left', help: 'The bucket this row groups trades by' },
    { k: 'trades', label: 'Trades', align: 'right', help: 'Booked round-trips that fall in this row' },
    { k: 'winRate', label: 'Win%', align: 'right', help: "Share of this row's trades that made money after charges (net > ₹0). A trade that ended at exactly ₹0 counts as not a win" },
    { k: 'net', label: 'Net ₹', align: 'right', help: "Sum of this row's trades' net P&L, after charges" },
    { k: 'perTrade', label: 'Per trade ₹', align: 'right', help: 'Net ÷ trades — the average result per trade, scratches included' },
    { k: 'avgMargin', label: 'Avg margin ₹', align: 'right', help: 'Average ₹ blocked per structure at entry' },
    { k: 'romPct', label: 'Per trade ÷ margin', align: 'right', help: 'Σ net ÷ Σ margin over trades that recorded a margin — return on the capital tied up' },
    { k: 'costPct', label: 'Costs ÷ gross', align: 'right', help: 'Charges as a share of gross (pre-cost) profit. Over 100% means costs ate the whole edge; — means the row lost money before costs' },
];

const tone = (v) => (num(v) > 0 ? 'text-success' : num(v) < 0 ? 'text-danger' : 'text-fg-4');
// Margin can be missing on older trades. A row that is only partly covered
// says so, instead of passing for a figure over all of its trades.
const marginCoverage = (r) => (num(r.marginN) != null && num(r.marginN) < num(r.trades)
    ? `margin recorded on ${r.marginN} of ${r.trades} trades — Net ÷ margin covers those only`
    : 'Avg margin = ₹ blocked per structure at entry. Per trade ÷ margin = Per trade ₹ ÷ Avg margin ₹ (Σ net ÷ Σ margin): the average return each structure made on the capital it tied up.');

function Th({ col, sort, onSort }) {
    const on = sort.k === col.k;
    return (
        <th className={`${col.align === 'right' ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-fg-3 ${on ? 'text-fg-3' : ''}`}
            onClick={() => onSort(col.k)}
            title={`${col.help ? `${col.help}. ` : ''}Click to sort by ${col.label}.`}>
            {col.label}{on ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
        </th>
    );
}

export default function ResultsAnalytics({
    tradeMode = 'all', deploymentId = 'all', symbol = 'all',
    templateFilter = 'all', templates = [],
    // Controlled by the page when given (Multi-Leg Results scopes its whole page
    // with one window); otherwise the panel keeps its own (Live Portfolio).
    days: daysProp,
}) {
    const ct = useChartTheme();
    const [ownDays, setDays] = useState('all');
    const days = daysProp !== undefined ? daysProp : ownDays;
    const [nonce, setNonce] = useState(0);
    const [res, setRes] = useState({ key: null, data: null, err: null });
    const [tab, setTab] = useState(0);
    const [sort, setSort] = useState({ k: 'net', dir: 'desc' });

    // The response carries the request it answers, so "still loading" and "these
    // numbers belong to the previous filter" are DERIVED rather than flagged by
    // a setState inside the effect (a cascading render, and one that would paint
    // last filter's P&L under this filter's heading for a frame).
    const reqKey = useMemo(
        () => JSON.stringify([deploymentId, tradeMode, symbol, days, templateFilter, nonce]),
        [deploymentId, tradeMode, symbol, days, templateFilter, nonce],
    );

    const params = useMemo(() => {
        const p = {};
        if (deploymentId && deploymentId !== 'all') p.deploymentId = deploymentId;
        if (tradeMode && tradeMode !== 'all') p.trade_mode = tradeMode;
        if (symbol && symbol !== 'all') p.symbol = symbol;
        if (days !== 'all') p.days = days;
        // the endpoint honours `template` now, so the Structure filter reaches
        // these figures instead of only the table below
        if (templateFilter && templateFilter !== 'all') p.template = templateFilter;
        return p;
    }, [deploymentId, tradeMode, symbol, days, templateFilter]);

    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/multileg/analytics`, { params })
            .then((r) => { if (!dead) setRes({ key: reqKey, data: r.data || null, err: null }); })
            .catch((e) => { if (!dead) setRes({ key: reqKey, data: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [reqKey, params]);

    // ── Drill-down: a bucket opened to show the strategies in it ────────────
    // Fetched per row on demand (`drill`/`key`) under the SAME filters — every
    // row's split at once is ~14x the payload for rows nobody opens. Keyed to
    // the request, so a filter change closes everything instead of showing the
    // previous filter's strategies under the new figures.
    const [drill, setDrill] = useState({ reqKey: null, open: {} });
    const openRows = drill.reqKey === reqKey ? drill.open : {};
    const toggleRow = (label, key) => {
        const id = `${label}::${key}`;
        if (openRows[id]) {
            setDrill(d => { const o = { ...(d.reqKey === reqKey ? d.open : {}) }; delete o[id]; return { reqKey, open: o }; });
            return;
        }
        setDrill(d => ({ reqKey, open: { ...(d.reqKey === reqKey ? d.open : {}), [id]: { loading: true } } }));
        axios.get(`${API_URL}/multileg/analytics`, { params: { ...params, drill: label, key } })
            .then((r) => setDrill(d => (d.reqKey !== reqKey || !d.open[id] ? d
                : { reqKey, open: { ...d.open, [id]: { children: Array.isArray(r.data?.children) ? r.data.children : [] } } })))
            .catch((e) => setDrill(d => (d.reqKey !== reqKey || !d.open[id] ? d
                : { reqKey, open: { ...d.open, [id]: { err: e.response?.data?.error || e.message } } })));
    };
    // Inside one deployment's results there is nothing to split by deployment.
    const canDrill = !deploymentId || deploymentId === 'all';

    // Scorecard (Open now + Strategies) — same filters and window, refreshed
    // with the rest of the panel.
    const sc = useScorecard(params, nonce);
    const [moreFigures, setMoreFigures] = useLocalStorage('multileg:results:moreFigures', false, { validate: (v) => typeof v === 'boolean' });

    const fresh = res.key === reqKey;
    const loading = !fresh;
    const data = fresh ? res.data : null;
    const err = fresh ? res.err : null;
    const summary = data?.summary || null;
    const daily = useMemo(() => (Array.isArray(data?.daily) ? data.daily : []), [data]);
    const breakdowns = useMemo(() => (Array.isArray(data?.breakdowns) ? data.breakdowns : []), [data]);

    // Split the day's net into two stacked series rather than per-bar <Cell>s:
    // ZoomableChart hands the chart a SLICE of the data, so cells generated from
    // the full array would paint the wrong bars the moment anyone zooms.
    const dailyRows = useMemo(() => daily.map((d) => {
        const n = num(d?.net) ?? 0;
        return {
            date: d?.date, label: shortDate(d?.date),
            net: n, up: n >= 0 ? n : null, down: n < 0 ? n : null,
            trades: num(d?.trades), winRate: num(d?.winRate),
            equity: num(d?.equity), drawdown: num(d?.drawdown),
        };
    }), [daily]);

    // The tab strip is the breakdowns PLUS one synthetic tab. Calendar is not a
    // breakdown — it is the `daily` series drawn as a day grid — but it belongs in
    // the same strip because it answers the same question ("where did the P&L come
    // from?") on a different axis, and giving it its own strip would put two rows
    // of tabs on top of each other. It is appended LAST so the existing tab indices
    // (and anyone's muscle memory for them) do not shift.
    const tabs = useMemo(
        () => [...breakdowns.map((b) => ({ label: b.label, breakdown: b })), { label: 'Calendar', calendar: true }],
        [breakdowns],
    );
    const tabIdx = Math.min(tab, tabs.length - 1);
    const activeTab = tabs[tabIdx] || null;
    const active = activeTab?.breakdown || null;
    // 'all' means "span the whole data set", which <PnlCalendar> spells `null`.
    const calendarDays = days === 'all' ? null : (Number(days) || null);
    const rows = useMemo(() => {
        const list = Array.isArray(active?.rows) ? active.rows.map((r) => ({ ...r, costPct: costPctOf(r) })) : [];
        const dir = sort.dir === 'desc' ? -1 : 1;
        return list.sort((a, b) => {
            if (sort.k === 'key') return dir * String(a.key ?? '').localeCompare(String(b.key ?? ''));
            // a row with NO value (no margin recorded) sorts last either way —
            // ranking it as 0 would slot it among the break-even rows
            const av = num(a?.[sort.k]), bv = num(b?.[sort.k]);
            if (av == null || bv == null) return (av == null) - (bv == null);
            return dir * (av - bv);
        });
    }, [active, sort]);

    // The Structure breakdown keys on the template slug; show the human name.
    const rowLabel = (k) => (active?.label === 'Structure'
        ? (templates.find((t) => t.key === k)?.name || k || '—')
        : (k || '—'));

    const onSort = (k) => setSort((s) => (s.k === k
        ? { k, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { k, dir: k === 'key' ? 'asc' : 'desc' }));

    const chartTip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });

    const hasTrades = !!summary && summary.trades > 0;
    const costShare = num(summary?.grossPnl) > 0 ? Math.round((num(summary.charges) / num(summary.grossPnl)) * 100) : null;

    return (
        <div className="space-y-4">
            {/* 0 ── what is open right now (booked figures below exclude it) */}
            <OpenNow sc={sc} templates={templates} />

            {/* 1 ── Summary: five headline figures, the cost of trading, the rest on demand */}
            <Panel bodyClassName="space-y-3" title="Summary" subtitle="Booked round-trips only, quarantined fills excluded" docs="multi-leg#results-tab"
                storageKey="fold:results|summary" right={<div className="flex items-center gap-1">
                        {daysProp === undefined && DAY_OPTS.map((o) => (
                            <button key={String(o.v)} onClick={() => setDays(o.v)} aria-pressed={days === o.v}
                                className={`text-3xs px-2 py-0.5 rounded border ${days === o.v
                                    ? 'border-primary bg-primary/15 text-primary-ink'
                                    : 'border-line-2 bg-slate-800 text-fg-5 hover:text-fg-3'}`}>{o.label}</button>
                        ))}
                        <button onClick={() => setNonce((n) => n + 1)}
                            className="ml-1 px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-3xs text-fg-4 hover:text-fg flex items-center gap-1">
                            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>}>

                {templateFilter !== 'all' && (
                    <div className="text-3xs text-fg-5 border border-line-0 rounded px-2 py-1 bg-slate-800/30">
                        Filtered to <span className="text-fg-3">{templates.find((t) => t.key === templateFilter)?.name || templateFilter}</span>.
                        Every figure below covers only that structure.
                    </div>
                )}

                {err ? <div className="text-xs text-danger">Analytics failed: {err}</div>
                    : !summary ? <div className="text-xs text-fg-5">{loading ? 'Loading…' : 'No analytics available.'}</div>
                    : summary.trades === 0 ? (
                        <div className="text-xs text-fg-5">
                            No booked round-trips in this window{days !== 'all' ? ` (last ${days} days)` : ''}.
                            {num(summary.excludedQuarantined) > 0 ? ` ${summary.excludedQuarantined} quarantined trade(s) were excluded.` : ''}
                        </div>
                    ) : (
                        <>
                            {/* the five that answer "is this book working?" */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                                <HeroTile label="Net P&L" value={rup(summary.netPnl)} tone={num(summary.netPnl)} sub={`${fmt(summary.trades)} trades · ${fmt(summary.tradingDays)} exit days`} />
                                <HeroTile label="Per trade" value={rup(summary.perTrade)} tone={num(summary.perTrade)}
                                    title="Total net ÷ number of trades — the true mean, scratches included. Deliberately NOT winRate×avgWin + (1−winRate)×avgLoss, which counts every ₹0 scratch as an average loss." />
                                <HeroTile label="Win rate" value={num(summary.winRate) == null ? '—' : `${fmt(summary.winRate)}%`}
                                    sub={`avg win ${rup(summary.avgWin)} · avg loss ${rup(summary.avgLoss)}`} />
                                <HeroTile label="Profit factor" value={summary.profitFactor == null ? '—' : fmt(summary.profitFactor, 2)}
                                    tone={summary.profitFactor == null ? null : num(summary.profitFactor) - 1}
                                    title={summary.profitFactor == null ? 'Undefined — there are no losing trades in this window.' : 'Gross wins ÷ gross losses. Above 1 makes money.'} />
                                <HeroTile label="Max drawdown" value={rup(summary.maxDrawdown)} tone={num(summary.maxDrawdown) < 0 ? -1 : null}
                                    title="Deepest fall of the equity curve from a previous peak, by exit day." />
                            </div>

                            {/* the cost of trading, said out loud — net alone hides it */}
                            <CostLine gross={num(summary.grossPnl)} charges={num(summary.charges)} share={costShare} />

                            <div>
                                <button type="button" onClick={() => setMoreFigures((v) => !v)} aria-expanded={moreFigures}
                                    className="text-2xs text-fg-4 hover:text-fg inline-flex items-center gap-1">
                                    {moreFigures ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                                    {moreFigures ? 'Fewer figures' : 'More figures (margin, hold, best/worst, gross, charges…)'}
                                </button>
                                {moreFigures && (
                                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mt-2">
                                        <Tile label="Per trade ÷ margin" value={num(summary.romPct) == null ? '—' : `${fmt(summary.romPct, 2)}%`}
                                            good={num(summary.romPct) > 0} bad={num(summary.romPct) < 0}
                                            title="Per-trade net ÷ per-trade margin (Σ net ÷ Σ margin, over the trades that recorded one) — the average return a structure made on the capital it tied up. Margins are the engine's estimate unless the broker's SPAN was available." />
                                        <Tile label="Avg margin" value={num(summary.avgMargin) == null ? '—' : rup(summary.avgMargin)}
                                            title={num(summary.marginN) ? `₹ blocked per structure at entry, averaged over ${summary.marginN} of ${summary.trades} trades — ${num(summary.marginSpanN) || 0} from the broker's SPAN, the rest estimated.` : 'No margin was recorded on these trades.'} />
                                        <Tile label="Gross (pre-cost)" value={rup(summary.grossPnl)}
                                            good={num(summary.grossPnl) > 0} bad={num(summary.grossPnl) < 0}
                                            title="Profit before brokerage, STT, exchange and stamp charges." />
                                        <Tile label="Charges paid" value={rup(summary.charges)} bad
                                            title={costShare != null ? `${costShare}% of gross profit` : 'Round-trip costs across every trade in this window.'} />
                                        <Tile label="Avg hold" value={num(summary.avgHoldHours) != null ? `${fmt(summary.avgHoldHours, 1)} h` : '—'}
                                            title="Mean time a structure stayed open, in hours." />
                                        <Tile label="Trades" value={fmt(summary.trades)} />
                                        <Tile label="Best trade" value={rup(summary.bestTrade)} good={num(summary.bestTrade) > 0} />
                                        <Tile label="Worst trade" value={rup(summary.worstTrade)} bad={num(summary.worstTrade) < 0} />
                                        <Tile label="Avg win" value={rup(summary.avgWin)} good />
                                        <Tile label="Avg loss" value={rup(summary.avgLoss)} bad />
                                        <Tile label="Best day" value={rup(summary.bestDay)} good={num(summary.bestDay) > 0} />
                                        <Tile label="Worst day" value={rup(summary.worstDay)} bad={num(summary.worstDay) < 0} />
                                        <Tile label="Trading days" value={fmt(summary.tradingDays)} title="Days with at least one exit." />
                                    </div>
                                )}
                            </div>

                            {num(summary.excludedQuarantined) > 0 && (
                                <div className="text-2xs text-warning border border-amber-800/60 bg-amber-950/10 rounded px-2 py-1.5">
                                    ⚠ {summary.excludedQuarantined} quarantined trade{num(summary.excludedQuarantined) === 1 ? '' : 's'} excluded
                                    from every figure on this page. They were booked on prices that never existed, so any P&L they
                                    carry is fiction. They are still listed in the trades table, struck through, so the correction
                                    stays visible.
                                </div>
                            )}
                        </>
                    )}
            </Panel>

            {/* 2 ── which strategies are working (and Compare) */}
            <StrategyScorecard sc={sc} templates={templates} single={!canDrill} />

            {hasTrades && (
                <>
                    {/* 3 ── P&L over time */}
                    <Panel bodyClassName="space-y-4" title="P&L over time" subtitle="Daily net P&L and the equity curve, by exit day (IST)" storageKey="fold:results|pnl-over-time">
{/* 2 ── Daily P&L */}
                <div>
                    <div className="text-2xs font-semibold text-fg-3 mb-1">Daily net P&L (₹, by exit day IST)</div>
                    <ZoomableChart data={dailyRows} height={200}>
                        <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                            <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={26} />
                            <YAxis width={54} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={rupeeTick} />
                            {/* Returning null from a recharts formatter DROPS that item, which
                                is how the empty half of the up/down pair stays out of the
                                tooltip instead of printing "down —". */}
                            <Tooltip contentStyle={chartTip}
                                formatter={(v, n) => (num(v) == null ? null : [rup(v), n === 'up' || n === 'down' ? 'net' : n])}
                                labelFormatter={(l, p) => {
                                    const d = p?.[0]?.payload;
                                    return d ? `${d.date} · ${fmt(d.trades)} trade(s) · ${fmt(d.winRate)}% win` : String(l);
                                }} />
                            <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                            <Bar name="up" dataKey="up" stackId="net" fill={ct.diverging.positive} isAnimationActive={false} />
                            <Bar name="down" dataKey="down" stackId="net" fill={ct.diverging.negative} isAnimationActive={false} />
                        </ComposedChart>
                    </ZoomableChart>
                </div>

                {/* 3 ── Equity + drawdown, one x-axis */}
                <div>
                    <div className="text-2xs font-semibold text-fg-3 mb-1">
                        Equity curve <span className="text-fg-5 font-normal">— cumulative net, with the drawdown from peak shaded beneath</span>
                    </div>
                    <ZoomableChart data={dailyRows} height={230}>
                        <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                            <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={26} />
                            <YAxis width={54} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={rupeeTick} />
                            <Tooltip contentStyle={chartTip} formatter={(v, n) => (num(v) == null ? null : [rup(v), n])}
                                labelFormatter={(l, p) => p?.[0]?.payload?.date || String(l)} />
                            <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                            {/* baseValue={0}: drawdown is ≤ 0 and must hang from the
                                zero line, not from the axis floor — otherwise the
                                shading inverts on a book that never recovered. */}
                            <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                            <Area type="monotone" name="drawdown" dataKey="drawdown" baseValue={0}
                                stroke={ct.status.critical} strokeOpacity={0.45} strokeWidth={1}
                                fill={ct.status.critical} fillOpacity={0.16} isAnimationActive={false} />
                            <Line type="monotone" name="equity" dataKey="equity" stroke={ct.mark.equity}
                                dot={false} strokeWidth={2} isAnimationActive={false} />
                        </ComposedChart>
                    </ZoomableChart>
                </div>
                    </Panel>

                    {/* 4 ── where the P&L came from */}
                    <Panel title="Breakdowns" subtitle="The same trades cut different ways; open a row to see the strategies in it" docs="multi-leg#results-tab" storageKey="fold:results|breakdowns">
{tabs.length > 0 && (
                    <div>
                        <div className="flex flex-wrap gap-1 border-b border-line mb-1">
                            {tabs.map((b, i) => (
                                <button key={b.label || i} onClick={() => setTab(i)}
                                    className={`text-2xs px-2.5 py-1 rounded-t border-b-2 ${i === tabIdx
                                        ? 'border-primary text-primary-ink bg-primary/10'
                                        : 'border-transparent text-fg-5 hover:text-fg-3'}`}>{b.label}</button>
                            ))}
                        </div>
                        {activeTab?.calendar ? (
                            <div className="pt-2">
                                <PnlCalendar daily={daily} rangeDays={calendarDays} title={null} />
                                <div className="text-3xs text-fg-5 mt-1">
                                    One cell per calendar day, by exit day IST. Grey = no exits that day;
                                    the darkest shade is a day past ±₹5,000.
                                </div>
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="text-3xs text-fg-5 py-2">Nothing to break down here.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-2xs text-fg-3">
                                    <thead><tr className="text-fg-5">
                                        {COLS.map((c) => <Th key={c.k} col={c} sort={sort} onSort={onSort} />)}
                                    </tr></thead>
                                    <tbody>
                                        {rows.map((r, i) => {
                                            const id = `${active?.label}::${r.key}`;
                                            const st = openRows[id];
                                            const drillable = canDrill && num(r.strategies) > 0;
                                            return (
                                                <React.Fragment key={`${r.key}-${i}`}>
                                                    <tr className={`border-t border-line-0 ${st ? 'bg-slate-800/30' : ''}`}>
                                                        <td className="max-w-[16rem]" title={String(r.key ?? '')}>
                                                            {drillable ? (
                                                                <button type="button" onClick={() => toggleRow(active.label, r.key)} aria-expanded={!!st}
                                                                    className="inline-flex items-center gap-1 text-left hover:text-fg max-w-full"
                                                                    title={`Show the ${r.strategies} strateg${r.strategies === 1 ? 'y' : 'ies'} in this row`}>
                                                                    {st ? <ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-3 h-3 shrink-0" aria-hidden="true" />}
                                                                    <span className="truncate">{rowLabel(r.key)}</span>
                                                                    <span className="text-fg-5 shrink-0">· {r.strategies} strateg{r.strategies === 1 ? 'y' : 'ies'}</span>
                                                                </button>
                                                            ) : r.deploymentId ? (
                                                                <Link to={deploymentHref(r.deploymentId)} onClick={scrollMainTop}
                                                                    className="truncate block text-primary-ink hover:underline" title="Open this deployment's trades">
                                                                    {rowLabel(r.key)}
                                                                </Link>
                                                            ) : <span className="truncate block">{rowLabel(r.key)}</span>}
                                                        </td>
                                                        <FigureCells r={r} />
                                                    </tr>
                                                    {st?.loading && (
                                                        <tr><td colSpan={COLS.length} className="pl-6 py-1 text-fg-5">Loading strategies…</td></tr>
                                                    )}
                                                    {st?.err && (
                                                        <tr><td colSpan={COLS.length} className="pl-6 py-1 text-danger">Could not load: {st.err}</td></tr>
                                                    )}
                                                    {st?.children?.map((c) => (
                                                        <tr key={`${id}::${c.deploymentId || c.key}`} className="border-t border-line-0/50 bg-slate-900/40 text-fg-4">
                                                            <td className="pl-5 py-0.5 max-w-[16rem]">
                                                                {c.deploymentId ? (
                                                                    <Link to={deploymentHref(c.deploymentId)} onClick={scrollMainTop}
                                                                        className="block truncate text-primary-ink hover:underline" title={`Open ${c.key}'s trades`}>{c.key}</Link>
                                                                ) : <span className="block truncate">{c.key}</span>}
                                                                <span className="block truncate text-4xs text-fg-5">
                                                                    {templates.find((t) => t.key === c.template)?.name || c.template || '—'} · {shortSymbol(c.symbol)}
                                                                </span>
                                                            </td>
                                                            <FigureCells r={c} />
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
                    </Panel>

                    {/* 5 ── how trades travelled before they exited */}
                    <Panel title="How trades travelled" subtitle="Worst and best point while open, and what a stop or target would have done" docs="glossary#mae-mfe" storageKey="fold:results|excursions">
                        <ExcursionsPanel excursions={data?.excursions} canApplyStop />
                    </Panel>

                    {/* 6 ── the same trades replayed with other stops (recorded option chain) */}
                    {deploymentId && deploymentId !== 'all' && (
                        <Panel title="Which stops, on these trades" subtitle="Each trade replayed on the recorded option chain with other stop settings, and with none" storageKey="fold:results|stopgrid">
                            <StopGridPanel deploymentId={deploymentId} />
                        </Panel>
                    )}
                </>
            )}
        </div>
    );
}

/** One of the five headline figures — larger, toned by sign. `tone` is a number
 *  whose SIGN picks the colour (null = neutral). */
function HeroTile({ label, value, sub, tone = null, title }) {
    const t = tone == null ? 'text-fg' : tone > 0 ? 'text-success' : tone < 0 ? 'text-danger' : 'text-fg';
    return (
        <div className="rounded-lg border border-line bg-slate-800/60 p-3" title={title}>
            <div className="text-2xs text-fg-5">{label}</div>
            <div className={`text-xl font-semibold tabular-nums leading-tight mt-0.5 ${t}`}>{value}</div>
            {sub ? <div className="text-3xs text-fg-5 mt-1 truncate">{sub}</div> : null}
        </div>
    );
}

/** What trading cost, against what it made before costs. */
function CostLine({ gross, charges, share }) {
    if (gross == null || charges == null) return null;
    if (gross <= 0) {
        return (
            <p className="text-xs text-danger">
                Losing before costs: gross {rup(gross)}, then {rup(charges)} of charges on top.
            </p>
        );
    }
    const tone = share >= 100 ? 'text-danger' : share >= 30 ? 'text-warning' : 'text-fg-3';
    return (
        <p className={`text-xs ${tone}`}>
            Charges took <span className="font-semibold">{share}%</span> of gross profit — {rup(charges)} of {rup(gross)}.
            {share >= 100 ? ' Costs ate the whole edge: net is negative because of charges, not the trades.' : ''}
            <span className="text-fg-5"> The Costs ÷ gross column in Breakdowns and Strategies shows where.</span>
        </p>
    );
}
