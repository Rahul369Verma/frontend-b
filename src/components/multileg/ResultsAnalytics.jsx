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
 * The panel owns its own days window (30 / 90 / all) and inherits book,
 * deployment and symbol from the Results tab's filter row.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
    ComposedChart, Bar, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import ZoomableChart from '../charts/ZoomableChart';
import PnlCalendar from '../charts/PnlCalendar.jsx';
import { useChartTheme } from '../../theme/chartTheme.js';
import { API_URL } from '../../config/api.js';
import { num, fmt, rup, shortDate } from './builderFormat';
import { Tile } from './builderUi';

const DAY_OPTS = [
    { v: 30, label: '30d' },
    { v: 90, label: '90d' },
    { v: 'all', label: 'All' },
];

const COLS = [
    { k: 'key', label: 'Key', align: 'left' },
    { k: 'trades', label: 'Trades', align: 'right' },
    { k: 'winRate', label: 'Win%', align: 'right' },
    { k: 'net', label: 'Net ₹', align: 'right' },
    { k: 'perTrade', label: 'Per trade ₹', align: 'right' },
];

function Th({ col, sort, onSort }) {
    const on = sort.k === col.k;
    return (
        <th className={`${col.align === 'right' ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-fg-3 ${on ? 'text-fg-3' : ''}`}
            onClick={() => onSort(col.k)}
            title={`Sort by ${col.label}`}>
            {col.label}{on ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
        </th>
    );
}

export default function ResultsAnalytics({
    tradeMode = 'all', deploymentId = 'all', symbol = 'all',
    templateFilter = 'all', templates = [],
}) {
    const ct = useChartTheme();
    const [days, setDays] = useState('all');
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

    useEffect(() => {
        let dead = false;
        const params = {};
        if (deploymentId && deploymentId !== 'all') params.deploymentId = deploymentId;
        if (tradeMode && tradeMode !== 'all') params.trade_mode = tradeMode;
        if (symbol && symbol !== 'all') params.symbol = symbol;
        if (days !== 'all') params.days = days;
        // the endpoint honours `template` now, so the Structure filter reaches
        // these figures instead of only the table below
        if (templateFilter && templateFilter !== 'all') params.template = templateFilter;
        axios.get(`${API_URL}/multileg/analytics`, { params })
            .then((r) => { if (!dead) setRes({ key: reqKey, data: r.data || null, err: null }); })
            .catch((e) => { if (!dead) setRes({ key: reqKey, data: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [reqKey, deploymentId, tradeMode, symbol, days, templateFilter]);

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
        const list = Array.isArray(active?.rows) ? [...active.rows] : [];
        const dir = sort.dir === 'desc' ? -1 : 1;
        return list.sort((a, b) => {
            if (sort.k === 'key') return dir * String(a.key ?? '').localeCompare(String(b.key ?? ''));
            return dir * ((num(a?.[sort.k]) ?? 0) - (num(b?.[sort.k]) ?? 0));
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
    const rupTick = (v) => (Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${Math.round(v)}`);

    return (
        <div className="bg-surface rounded-xl border border-line p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-semibold text-fg">
                    Analytics <span className="text-fg-5 font-normal text-2xs">— booked round-trips only, quarantined fills excluded</span>
                </div>
                <div className="flex items-center gap-1">
                    {DAY_OPTS.map((o) => (
                        <button key={String(o.v)} onClick={() => setDays(o.v)}
                            className={`text-3xs px-2 py-0.5 rounded border ${days === o.v
                                ? 'border-primary bg-primary/15 text-primary-ink'
                                : 'border-line-2 bg-slate-800 text-fg-5 hover:text-fg-3'}`}>{o.label}</button>
                    ))}
                    <button onClick={() => setNonce((n) => n + 1)}
                        className="ml-1 px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-3xs text-fg-4 hover:text-fg flex items-center gap-1">
                        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
            </div>

            {templateFilter !== 'all' && (
                <div className="text-3xs text-fg-5 border border-line-0 rounded px-2 py-1 bg-slate-800/30">
                    Filtered to <span className="text-fg-3">{templates.find((t) => t.key === templateFilter)?.name || templateFilter}</span>.
                    Every figure below covers only that structure.
                </div>
            )}

            {err ? <div className="text-xs text-red-400">Analytics failed: {err}</div>
                : !summary ? <div className="text-xs text-fg-5">{loading ? 'Loading…' : 'No analytics available.'}</div>
                : summary.trades === 0 ? (
                    <div className="text-xs text-fg-5">
                        No booked round-trips in this window{days !== 'all' ? ` (last ${days} days)` : ''}.
                        {num(summary.excludedQuarantined) > 0 ? ` ${summary.excludedQuarantined} quarantined trade(s) were excluded.` : ''}
                    </div>
                ) : (
                    <>
                        {/* 1 ── Summary tiles */}
                        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                            <Tile label="Net P&L" value={rup(summary.netPnl)} good={num(summary.netPnl) > 0} bad={num(summary.netPnl) < 0} />
                            <Tile label="Per trade" value={rup(summary.perTrade)}
                                good={num(summary.perTrade) > 0} bad={num(summary.perTrade) < 0}
                                title="Total net ÷ number of trades — the true mean, scratches included. Deliberately NOT winRate×avgWin + (1−winRate)×avgLoss, which counts every ₹0 scratch as an average loss." />
                            <Tile label="Win rate" value={num(summary.winRate) == null ? '—' : `${fmt(summary.winRate)}%`}
                                good={num(summary.winRate) >= 50} bad={num(summary.winRate) < 50} />
                            <Tile label="Profit factor" value={summary.profitFactor == null ? '—' : fmt(summary.profitFactor, 2)}
                                good={num(summary.profitFactor) >= 1.3} bad={num(summary.profitFactor) != null && num(summary.profitFactor) < 1}
                                title={summary.profitFactor == null ? 'Undefined — there are no losing trades in this window.' : 'Gross wins ÷ gross losses.'} />
                            <Tile label="Max drawdown" value={rup(summary.maxDrawdown)} bad={num(summary.maxDrawdown) < 0} />
                            {/* Gross sits NEXT to charges deliberately. On this book the
                                gross is Rs9,552 and the charges Rs16,483 — costs are 1.7x the
                                trading profit, which is invisible if you only ever see net. */}
                            <Tile label="Gross (pre-cost)" value={rup(summary.grossPnl)}
                                good={num(summary.grossPnl) > 0} bad={num(summary.grossPnl) < 0}
                                title="Profit before brokerage, STT, exchange and stamp charges. Compare it with the charges tile beside it — if charges are a large fraction of gross, the edge is being spent on costs." />
                            <Tile label="Charges paid" value={rup(summary.charges)} bad
                                title={num(summary.grossPnl) > 0
                                    ? `${Math.round((num(summary.charges) / num(summary.grossPnl)) * 100)}% of gross profit`
                                    : 'Round-trip costs across every trade in this window.'} />
                            <Tile label="Avg hold" value={num(summary.avgHoldHours) != null ? `${fmt(summary.avgHoldHours, 1)} h` : '—'}
                                title="Mean time a structure stayed open, in hours." />
                            <Tile label="Best trade" value={rup(summary.bestTrade)} good={num(summary.bestTrade) > 0} />
                            <Tile label="Worst trade" value={rup(summary.worstTrade)} bad={num(summary.worstTrade) < 0} />
                            <Tile label="Trades" value={fmt(summary.trades)} />
                            <Tile label="Trading days" value={fmt(summary.tradingDays)} />
                            <Tile label="Avg win" value={rup(summary.avgWin)} good />
                            <Tile label="Avg loss" value={rup(summary.avgLoss)} bad />
                            <Tile label="Best day" value={rup(summary.bestDay)} good={num(summary.bestDay) > 0} />
                            <Tile label="Worst day" value={rup(summary.worstDay)} bad={num(summary.worstDay) < 0} />
                        </div>

                        {num(summary.excludedQuarantined) > 0 && (
                            <div className="text-2xs text-amber-300 border border-amber-800/60 bg-amber-950/10 rounded px-2 py-1.5">
                                ⚠ {summary.excludedQuarantined} quarantined trade{num(summary.excludedQuarantined) === 1 ? '' : 's'} excluded
                                from every figure on this panel. They were booked on prices that never existed, so any P&L they
                                carry is fiction. They are still listed in the trades table below, struck through, so the correction
                                stays visible.
                            </div>
                        )}

                        {/* 2 ── Daily P&L */}
                        <div>
                            <div className="text-2xs font-semibold text-fg-3 mb-1">Daily net P&L (₹, by exit day IST)</div>
                            <ZoomableChart data={dailyRows} height={200}>
                                <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={26} />
                                    <YAxis width={54} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={rupTick} />
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
                                Equity curve <span className="text-fg-6 font-normal">— cumulative net, with the drawdown from peak shaded beneath</span>
                            </div>
                            <ZoomableChart data={dailyRows} height={230}>
                                <ComposedChart margin={{ top: 6, right: 10, bottom: 2, left: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                    <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={26} />
                                    <YAxis width={54} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={rupTick} />
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

                        {/* 4 ── Breakdowns + the day-grid calendar (last tab) */}
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
                                                {rows.map((r, i) => (
                                                    <tr key={`${r.key}-${i}`} className="border-t border-line-0">
                                                        <td className="truncate max-w-[11rem]" title={String(r.key ?? '')}>{rowLabel(r.key)}</td>
                                                        <td className="text-right">{fmt(r.trades)}</td>
                                                        <td className="text-right text-fg-4">{num(r.winRate) == null ? '—' : `${fmt(r.winRate)}%`}</td>
                                                        <td className={`text-right font-semibold ${num(r.net) > 0 ? 'text-emerald-300' : num(r.net) < 0 ? 'text-red-300' : 'text-fg-4'}`}>{rup(r.net)}</td>
                                                        <td className={`text-right ${num(r.perTrade) > 0 ? 'text-emerald-300' : num(r.perTrade) < 0 ? 'text-red-300' : 'text-fg-4'}`}>{rup(r.perTrade)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
        </div>
    );
}
