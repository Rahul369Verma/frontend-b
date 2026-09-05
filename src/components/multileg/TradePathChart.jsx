'use strict';
/**
 * TradePathChart — what a booked structure DID while it was open.
 *
 * A round-trip row tells you where a trade ended. It does not tell you whether
 * it was ever winning, how far under water it went first, or how much of a
 * won trade was handed back before the exit fired. Those three numbers are the
 * difference between "the structure was wrong" and "the structure was right and
 * the exit was mismanaged", and they are only visible against the path.
 *
 * The engine samples an open structure once a minute into `trade.path`:
 *   [{ t: ISO, net: ₹, gross: ₹|null, spot: index level|null }, …]
 * plus the two extremes it saw, `maeRupees` (worst mark) and `mfeRupees` (best).
 *
 * WHY SPOT IS ON ITS OWN AXIS
 * P&L is in rupees and spot is an index level; on one axis the ₹ line flattens
 * to a hairline against a 24,000-point y-range. The right-hand axis is what
 * makes "we bled as the index ran" readable at all — the whole reason spot is
 * recorded next to the mark.
 *
 * EVERY trade booked before this feature shipped has no path. That is the
 * common case for a while, so it gets one quiet sentence naming the reason —
 * never an empty chart frame (which reads as "the trade did nothing") and never
 * a crash on `path.map`.
 */
import React, { useMemo, useState } from 'react';
import {
    ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { useChartTheme } from '../../theme/chartTheme.js';
import { num, fmt, rup } from './builderFormat';

/** Elapsed hold, entry→exit. Distinct from MultiLeg's fmtDur, which is
 *  now-relative (a closed trade needs the span, not the age). */
function fmtHold(fromIso, toIso) {
    const a = Date.parse(fromIso), b = Date.parse(toIso);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
    const m = Math.round((b - a) / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function Stat({ label, value, good, bad, warn, title }) {
    return (
        <div className="min-w-[5rem]" title={title}>
            <div className="text-4xs text-fg-6 uppercase tracking-wide">{label}</div>
            <div className={`text-2xs font-mono ${good ? 'text-emerald-300' : bad ? 'text-red-300' : warn ? 'text-amber-300' : 'text-fg-2'}`}>{value}</div>
        </div>
    );
}

export default function TradePathChart({ trade, istTime, istDateTime, istSpan }) {
    const ct = useChartTheme();
    const [showGross, setShowGross] = useState(true);

    // Rows keep the raw ISO for the tooltip and a pre-formatted IST label for
    // the axis: recharts hands the axis value straight to the tick renderer, so
    // formatting there would re-run per tick on every hover.
    const rows = useMemo(() => {
        const raw = Array.isArray(trade?.path) ? trade.path : [];
        const pts = raw
            .map((p) => {
                const ts = p && p.t ? String(p.t) : null;
                return { ts, net: num(p?.net), gross: num(p?.gross), spot: num(p?.spot) };
            })
            .filter((r) => r.ts && r.net != null);
        // A bare "13:42" is ambiguous the moment a structure is held overnight,
        // and multileg positions routinely are — so a path that spans sessions
        // gets the date on its ticks.
        const first = pts.length ? Date.parse(pts[0].ts) : NaN;
        const last = pts.length ? Date.parse(pts[pts.length - 1].ts) : NaN;
        const overnight = Number.isFinite(first) && Number.isFinite(last) && (last - first) > 12 * 3600e3;
        const lab = (overnight ? istDateTime : istTime) || String;
        return pts.map((r) => ({ ...r, label: lab(r.ts) || r.ts }));
    }, [trade, istTime, istDateTime]);

    const mae = num(trade?.maeRupees);
    const mfe = num(trade?.mfeRupees);
    const finalNet = num(trade?.netPnl) ?? (rows.length ? rows[rows.length - 1].net : null);
    // The number that says a WINNER was mismanaged: peak mark minus what was
    // actually booked. Only meaningful when the peak was above the close.
    const gaveBack = (mfe != null && finalNet != null && mfe > finalNet) ? mfe - finalNet : null;

    const hasGross = rows.some((r) => r.gross != null);
    const hasSpot = rows.some((r) => r.spot != null);

    const span = istSpan ? istSpan(trade?.entryAt, trade?.exitAt) : '—';
    const hold = fmtHold(trade?.entryAt, trade?.exitAt);

    if (!rows.length) {
        return (
            <div className="text-3xs text-fg-5 border border-line-0 rounded p-2 bg-slate-800/20">
                No minute-by-minute P&amp;L path stored for this trade. The path (and its MAE/MFE
                extremes) is only recorded for structures <span className="text-fg-4">opened after this feature was deployed</span> —
                every earlier round-trip keeps only its entry and exit.
            </div>
        );
    }

    return (
        <div className="border border-line-0 rounded p-2 bg-slate-800/20">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <div className="text-3xs font-semibold text-fg-3">
                    P&amp;L while open <span className="text-fg-6 font-normal">— {rows.length} marks, ~1/min</span>
                </div>
                {hasGross && (
                    <label className="flex items-center gap-1 text-4xs text-fg-5 cursor-pointer">
                        <input type="checkbox" checked={showGross} onChange={(e) => setShowGross(e.target.checked)} className="accent-sky-500" />
                        gross (pre-cost)
                    </label>
                )}
            </div>

            {/* Stat strip — the six numbers the path exists to expose. */}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-2">
                <Stat label="Entry → Exit" value={span} />
                <Stat label="Held" value={hold} />
                <Stat label="MAE (worst)" value={mae == null ? '—' : rup(mae)} bad={mae != null && mae < 0}
                    title="Maximum Adverse Excursion — the deepest the mark went against you while the structure was open." />
                <Stat label="MFE (best)" value={mfe == null ? '—' : rup(mfe)} good={mfe != null && mfe > 0}
                    title="Maximum Favourable Excursion — the best mark this structure ever showed." />
                <Stat label="Final net" value={finalNet == null ? '—' : rup(finalNet)}
                    good={finalNet != null && finalNet > 0} bad={finalNet != null && finalNet < 0} />
                <Stat label="Gave back" value={gaveBack == null ? '—' : rup(gaveBack)} warn={gaveBack != null}
                    title={gaveBack == null
                        ? 'The exit booked at or above the best mark — nothing was handed back.'
                        : 'Best mark minus what was actually booked. This is the mismanagement number: the structure earned it, the exit did not keep it.'} />
            </div>

            <ZoomableChart data={rows} height={200} controls={rows.length > 8}>
                <ComposedChart margin={{ top: 8, right: hasSpot ? 4 : 10, bottom: 2, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                    <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={34} />
                    <YAxis yAxisId="pnl" width={52} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }}
                        tickFormatter={(v) => (Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${Math.round(v)}`)} />
                    {/* Spot rides its own right-hand axis on its own domain — see
                        the header note. 'auto' (not dataMin/dataMax) so a flat
                        session still gets a sane band instead of a zero range. */}
                    {hasSpot && (
                        <YAxis yAxisId="spot" orientation="right" width={46} domain={['auto', 'auto']}
                            tick={{ fontSize: ct.type['5xs'], fill: ct.text.muted }}
                            tickFormatter={(v) => fmt(v)} />
                    )}
                    <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })}
                        cursor={{ stroke: ct.mark.live, strokeDasharray: '3 3' }}
                        formatter={(v, n) => (num(v) == null ? null : [n === 'spot' ? fmt(v) : rup(v), n])} />
                    <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                    {/* extendDomain, not the default: MAE/MFE can sit outside the
                        sampled marks (the extreme is tracked every tick, the path
                        only once a minute) and a clipped reference line is a
                        silently missing one. */}
                    {mae != null && (
                        <ReferenceLine yAxisId="pnl" y={mae} stroke={ct.status.critical} strokeDasharray="4 3" ifOverflow="extendDomain"
                            label={{ value: `MAE ${rup(mae)}`, fontSize: ct.type['5xs'], fill: ct.status.critical, position: 'insideBottomLeft' }} />
                    )}
                    {mfe != null && (
                        <ReferenceLine yAxisId="pnl" y={mfe} stroke={ct.status.good} strokeDasharray="4 3" ifOverflow="extendDomain"
                            label={{ value: `MFE ${rup(mfe)}`, fontSize: ct.type['5xs'], fill: ct.status.good, position: 'insideTopLeft' }} />
                    )}
                    {hasSpot && (
                        <Line yAxisId="spot" type="monotone" name="spot" dataKey="spot" stroke={ct.mark.live}
                            dot={false} strokeWidth={1} strokeDasharray="5 3" connectNulls isAnimationActive={false} />
                    )}
                    {hasGross && showGross && (
                        <Line yAxisId="pnl" type="monotone" name="gross" dataKey="gross" stroke={ct.mark.equity} strokeOpacity={0.45}
                            dot={false} strokeWidth={1} connectNulls isAnimationActive={false} />
                    )}
                    <Line yAxisId="pnl" type="monotone" name="net" dataKey="net" stroke={ct.categorical[0]}
                        dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
            </ZoomableChart>
        </div>
    );
}
