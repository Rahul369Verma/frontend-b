/**
 * DirectionGateHistory — is the CE/PE confidence gate actually worth it? All history, day by day.
 *
 * The gate's VALUE on a day = the book WITH the gate − the book WITHOUT it:
 *   Shadow   nothing was blocked; enforcing would have removed the trades it marked BLOCK,
 *            so value = −(what those trades made).
 *   Enforce  blocked signals were followed as GHOST trades (same entry path, same exit
 *            rules, real prices, never an order). Gate off would have had the ghosts and
 *            NOT the knock-on trades (real trades that only happened because a block left
 *            the deployment flat), so value = knock-on net − ghost net.
 * Positive = the gate made money. Backend: src/domain/risk/directionGateHistory.js.
 *
 * Nothing is hidden: trades without a verdict, probes, and blocked signals that were not
 * followed (a later check stopped them, or a ghost was already open) are all counted.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { API_URL } from '../../config/api.js';
import ZoomableChart from '../charts/ZoomableChart';
import { useChartTheme } from '../../theme/chartTheme.js';
import { StatusBadge, Chip, Segmented, Spinner, DataTable, Placeholder } from '../viz/primitives';
import { inr, istDateTime, pnlTone, rupeeTick } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import useRemWidth from '../../hooks/useRemWidth.js';
import DocLink from '../DocLink.jsx';
import { RANGE_OPTIONS, verdictLevel, decidedCount, modeLabel, nNet, notFollowedTitle, ghostAiSummary } from './directionGateHistoryFormat.js';

function ValueTooltip({ active, payload, ct }) {
    if (!active || !Array.isArray(payload) || !payload.length) return null;
    const r = payload[0]?.payload;
    if (!r) return null;
    return (
        <div className="px-2 py-1 space-y-0.5" style={ct.tooltipStyle({ fontSize: ct.type['3xs'] })}>
            <div className="font-semibold">{r.day} · {modeLabel(r.modes)}</div>
            <div>that day {inr(r.value, { sign: true })}</div>
            <div>cumulative {inr(r.cumulative, { sign: true })}</div>
            {r.wouldBlock.n > 0 && <div>would-block {nNet(r.wouldBlock)}</div>}
            {r.ghosts.n > 0 && <div>ghosts {nNet(r.ghosts)}</div>}
            {r.knockOn.n > 0 && <div>knock-on {nNet(r.knockOn)}</div>}
        </div>
    );
}

function ValueChart({ rows }) {
    const ct = useChartTheme();
    if (rows.length < 2) return null;
    return (
        <div data-testid="gate-value-chart">
            <p className="text-2xs uppercase tracking-wide text-fg-5 mb-1">Gate value, cumulative (above 0 = the gate made money)</p>
            <ZoomableChart data={rows} height={180} controls={rows.length > 12}>
                <ComposedChart margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                    <XAxis dataKey="day" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={34} />
                    <YAxis width={56} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={rupeeTick} />
                    <Tooltip cursor={{ stroke: ct.mark.live, strokeDasharray: '3 3' }} content={<ValueTooltip ct={ct} />} />
                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                    <Line type="monotone" dataKey="cumulative" name="cumulative value" stroke={ct.categorical[0]} strokeWidth={2}
                        dot={rows.length <= 30 ? { r: 3, fill: ct.categorical[0], stroke: ct.surface, strokeWidth: 2 } : false}
                        activeDot={{ r: 5, stroke: ct.surface, strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
            </ZoomableChart>
        </div>
    );
}

function DailyTable({ rows, narrow }) {
    const newest = rows.slice().reverse();
    if (narrow) {
        return (
            <div className="space-y-1.5 max-h-80 overflow-auto" data-testid="gate-days">
                {newest.map(r => (
                    <div key={r.day} className="border border-line/60 rounded px-2 py-1.5 text-2xs text-fg-4 space-y-0.5">
                        <div className="flex justify-between gap-2">
                            <span className="text-fg-2 font-medium">{r.day} · {modeLabel(r.modes)}</span>
                            <span className={`tabular-nums ${pnlTone(r.value)}`}>{inr(r.value, { sign: true })}</span>
                        </div>
                        <div>would-block {nNet(r.wouldBlock)} · ghosts {nNet(r.ghosts)}{r.ghosts.open ? ` (+${r.ghosts.open} open)` : ''} · knock-on {nNet(r.knockOn)}</div>
                        {r.blockedNotFollowed > 0 && <div title={notFollowedTitle(r)}>{r.blockedNotFollowed} blocked but not followed</div>}
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div data-testid="gate-days">
            <DataTable dense maxHeight={320} rows={newest.map(r => ({ ...r, _key: r.day }))} empty="No gate decisions in this range"
                columns={[
                    { key: 'day', header: 'Day' },
                    { key: 'modes', header: 'Mode', render: r => modeLabel(r.modes) },
                    { key: 'decided', header: 'Signals', align: 'right', render: r => decidedCount(r) || '—' },
                    { key: 'wouldBlock', header: 'Would-block (shadow)', align: 'right', render: r => nNet(r.wouldBlock) },
                    { key: 'ghosts', header: 'Ghosts (enforce)', align: 'right', render: r => `${nNet(r.ghosts)}${r.ghosts.open ? ` +${r.ghosts.open} open` : ''}` },
                    { key: 'knockOn', header: 'Knock-on', align: 'right', render: r => nNet(r.knockOn) },
                    { key: 'nf', header: 'Not followed', align: 'right', render: r => (r.blockedNotFollowed ? <span title={notFollowedTitle(r)}>{r.blockedNotFollowed}</span> : '—') },
                    { key: 'probes', header: 'Probes', align: 'right', render: r => nNet(r.probes) },
                    { key: 'value', header: 'Gate value', align: 'right', render: r => <span className={pnlTone(r.value)}>{inr(r.value, { sign: true })}</span> },
                    { key: 'cumulative', header: 'Cumulative', align: 'right', render: r => <span className={pnlTone(r.cumulative)}>{inr(r.cumulative, { sign: true })}</span> },
                ]} />
        </div>
    );
}

function GhostTable({ ghosts, total, open, narrow }) {
    const live = Object.fromEntries((open || []).map(o => [o.ghostId, o]));
    const rows = (ghosts || []).map(g => ({ ...g, _key: g.ghostId, _live: live[g.ghostId] || null }));
    const net = (g) => (g.status === 'CLOSED' ? g.net_pnl : g._live ? g._live.unrealized : null);
    return (
        <div className="space-y-1" data-testid="gate-ghosts">
            <p className="text-xs font-semibold text-fg-2">
                Blocked trades, followed as ghosts ({total}{total > rows.length ? `, newest ${rows.length} shown` : ''})
                <DocLink to="glossary#ghost-trade" className="ml-1" />
            </p>
            {narrow ? (
                <div className="space-y-1.5 max-h-80 overflow-auto">
                    {rows.map(g => (
                        <div key={g._key} className="border border-line/60 rounded px-2 py-1.5 text-2xs text-fg-4">
                            <div className="flex justify-between gap-2">
                                <span className="text-fg-2">{istDateTime(g.entryTime)} · {g.strategyName || '—'} · {g.type}</span>
                                <span className={`tabular-nums ${pnlTone(net(g))}`}>{net(g) == null ? '—' : inr(net(g), { sign: true })}</span>
                            </div>
                            <div>{g.symbol} · ₹{g.entryPrice} → {g.exitPrice != null ? `₹${g.exitPrice}` : 'open'} · {g.exitReason || g.status}</div>
                            {ghostAiSummary(g) && <div title={ghostAiSummary(g).title}>{ghostAiSummary(g).label}</div>}
                        </div>
                    ))}
                </div>
            ) : (
                <DataTable dense maxHeight={320} rows={rows} empty="No blocked trades yet — ghosts appear once the gate is enforcing"
                    columns={[
                        { key: 'entryTime', header: 'Blocked at', render: g => istDateTime(g.entryTime) },
                        { key: 'strategyName', header: 'Strategy', render: g => g.strategyName || '—' },
                        { key: 'symbol', header: 'Contract', render: g => <span className="whitespace-nowrap">{g.symbol}</span> },
                        { key: 'type', header: 'Side' },
                        { key: 'entryPrice', header: 'Entry ₹', align: 'right' },
                        { key: 'exitPrice', header: 'Exit ₹', align: 'right', render: g => (g.exitPrice != null ? g.exitPrice : g._live ? `${g._live.lastLtp} (live)` : '—') },
                        { key: 'exitReason', header: 'Exit', render: g => (g.status === 'CLOSED' ? <span title={g.exitPriceSource ? `priced from ${g.exitPriceSource}` : undefined}>{g.exitReason}</span> : <Chip tone="info">OPEN</Chip>) },
                        { key: 'net', header: 'Would-have net', align: 'right', render: g => <span className={pnlTone(net(g))}>{net(g) == null ? '—' : inr(net(g), { sign: true })}</span> },
                        { key: 'mae', header: 'MAE / MFE', align: 'right', render: g => (g.maeRupees != null ? `${inr(g.maeRupees)} / ${inr(g.mfeRupees)}` : '—') },
                        { key: 'ai', header: 'AI review', render: g => { const a = ghostAiSummary(g); return a ? <Chip tone="info" title={a.title}>{a.label}</Chip> : '—'; } },
                        { key: 'caveats', header: '', render: g => (g.caveats && g.caveats.length ? <Chip tone="warning" title={g.caveats.join(' · ')}>caveat</Chip> : null) },
                    ]} />
            )}
        </div>
    );
}

export function DirectionGateHistoryView({ data, days, onDays }) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const narrow = rem != null && rem < 52;
    const rows = useMemo(() => (data && data.rows) || [], [data]);
    if (!data) return null;
    const s = data.summary || {};
    const e = s.enforce || {};
    return (
        <div ref={ref} className="space-y-3" data-testid="gate-history">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg-2">Scorecard history — has the gate made or cost money? <DocLink to="dashboard#direction-gate-history" label="What do these columns mean?" /></span>
                <Segmented value={days} onChange={onDays} options={RANGE_OPTIONS} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <StatusBadge level={verdictLevel(s)}>{s.verdict || '—'}</StatusBadge>
                <span className="text-2xs text-fg-4">
                    total <b className={pnlTone(s.value)}>{inr(s.value, { sign: true })}</b> over {s.days || 0} day{s.days === 1 ? '' : 's'}
                    {(s.daysBetter || s.daysWorse) ? ` · better on ${s.daysBetter}, worse on ${s.daysWorse}` : ''}
                </span>
            </div>
            <p className="text-2xs text-fg-4">
                Shadow: {s.shadow?.n ?? 0} would-be-blocked trade{s.shadow?.n === 1 ? '' : 's'} made {inr(s.shadow?.net ?? 0, { sign: true })}.
                {' '}Enforce: {e.ghosts ?? 0} ghost{e.ghosts === 1 ? '' : 's'} would have made {inr(e.ghostNet ?? 0, { sign: true })}
                {e.ghostsOpen ? ` (+${e.ghostsOpen} still open)` : ''}; {e.knockOn ?? 0} knock-on trade{e.knockOn === 1 ? '' : 's'} made {inr(e.knockOnNet ?? 0, { sign: true })}
                {e.blockedNotFollowed ? `; ${e.blockedNotFollowed} blocked signal${e.blockedNotFollowed === 1 ? '' : 's'} not followed` : ''}.
                {' '}Probes {nNet(s.probes || { n: 0, net: 0 })}.
                {s.unrecorded?.n ? ` ${s.unrecorded.n} trade${s.unrecorded.n === 1 ? '' : 's'} have no verdict (gate off, or before it existed).` : ''}
            </p>

            <ValueChart rows={rows} />
            <DailyTable rows={rows} narrow={narrow} />
            <GhostTable ghosts={data.ghosts} total={data.ghostsTotal ?? (data.ghosts || []).length} open={data.open} narrow={narrow} />

            <p className="text-3xs text-fg-5">
                A ghost is a blocked signal carried down the real entry path (same later checks, strike, stop and target) and
                closed by the live exit rules at real prices — never an order, never in your P&L, never shown to the gate&apos;s own
                learning. It skips the AI entry confirmation, but where the deployment has AI in-flight review on, the ghost gets the
                same reviews and exit consults as a real trade (kept on the ghost, never in the live feed or Telegram). One deployment
                holds at most one ghost (with the gate off it would still be in that trade). A knock-on trade is a real trade taken
                while that deployment&apos;s ghost was still open.
            </p>
        </div>
    );
}

export default function DirectionGateHistory() {
    const [days, setDays] = useState(90);
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const load = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/analytics/direction-confidence/history`, { params: { days } });
            setData(r.data); setErr(null);
        } catch (e) {
            setErr(e?.response?.data?.error || e.message);
        }
    }, [days]);
    usePolling(load, 60000);
    return (
        <div className="border-t border-line/60 pt-3">
            {err && <Placeholder>Could not load the gate history: {err}</Placeholder>}
            {!data && !err && <Spinner label="Loading gate history…" />}
            <DirectionGateHistoryView data={data} days={days} onDays={setDays} />
        </div>
    );
}
