'use strict';
/**
 * TradePathChart — what a booked trade DID while it was open. Both books.
 *
 * A round-trip row tells you where a trade ended. It does not tell you whether
 * it was ever winning, how far under water it went first, or how much of a
 * won trade was handed back before the exit fired. Those three numbers are the
 * difference between "the entry was wrong" and "the entry was right and the
 * exit was mismanaged", and they are only visible against the path.
 *
 * INPUT (one shape for both books)
 *   trade = { entryAt, exitAt, netPnl, maeRupees, mfeRupees, path, pathSource, pathReason,
 *             bookedBasis?, quarantined? }
 *   path  = [{ t: ISO, net: ₹, gross?: ₹, spot?: index level, ltp?: option premium }, …]
 *   bookedBasis — 'gross' when netPnl is really a gross figure (a single-leg doc
 *             with no net_pnl): it is then labelled gross, never "after charges".
 *   quarantined — a multileg fill on a price that never traded: its netPnl is
 *             void, so nothing is presented as booked for it.
 *
 * WHAT A MARK MEANS DIFFERS BY BOOK, AND THE CHART SAYS WHICH
 *   multileg    — `net` is the MTM AFTER ESTIMATED costs, `gross` rides beside it.
 *   single-leg  — `net` is the PRE-COST MTM (no `gross` field); `ltp` is the
 *                 option premium at that mark.
 * So a path WITH gross is labelled "net", one without is labelled "mark
 * (pre-cost)", and the exit-step sentence names the right cause for each.
 *
 * WHERE A PATH CAME FROM (`pathSource`)
 *   'recorded' — the engine sampled it live.
 *   'archive'  — rebuilt after the fact from the 1-minute option-chain archive.
 *                Approximate: archived last-traded prices, not fills. The chip
 *                says so; the chart never lets a reconstruction pass as a record.
 *   absent     — multileg (always engine-recorded) or a caller that did not ask.
 *
 * THE EXIT STEP
 * The last mark and the booked net never agree exactly: the booked figure
 * carries the real fill and (for pre-cost marks) the charges. The booked net is
 * drawn as its own dot at the exit and the difference is stated in words, so a
 * gap between the line's end and the headline number is explained, not hidden.
 *
 * GAVE BACK
 * Only a trade that was once in profit can give anything back. MFE is floored
 * at ₹0 by both producers, so on a trade that was red from the first mark
 * "MFE − booked" would be the whole loss dressed up as a mismanaged winner.
 * It is computed on ONE basis: best mark − booked for net marks (both net of
 * costs), best mark − LAST mark for pre-cost marks (the charges belong to the
 * exit step, not to what the position handed back).
 *
 * WHY SPOT IS ON ITS OWN AXIS
 * P&L is in rupees and spot is an index level; on one axis the ₹ line flattens
 * to a hairline against a 24,000-point y-range. The right-hand axis is what
 * makes "we bled as the index ran" readable at all.
 *
 * A trade with no path gets one quiet sentence naming the reason (the server's
 * `pathReason` when it gave one) — never an empty chart frame, which reads as
 * "the trade did nothing".
 */
import React, { useMemo, useState } from 'react';
import {
    ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { useChartTheme } from '../../theme/chartTheme.js';
import {
    inr, num as fmtNum, premium, rupeeTick,
    istTime as tokIstTime, istDateTime as tokIstDateTime,
} from './tokens';
import { Chip } from './primitives';
import { toMs as parseInstant } from '../../utils/dayCurves';

// ── Parsing — ABSENT IS NOT ZERO ─────────────────────────────────────────────
// `Number(null) === 0` is finite, so a naive coercion turns a missing MAE into
// "₹0 worst mark". Only real numbers and numeric strings count as values.
function finite(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
// The SAME instant parser the day curves use, so a trade sits at the same
// moment in both charts: a zoned ISO string is exact, a zone-less one is read
// as IST (never the browser's zone, which Date.parse would use). Absent and
// unreadable both mean "no instant" here.
function toMs(v) {
    const ms = parseInstant(v);
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

// IST is UTC+05:30 with no DST, so an IST calendar-day index is arithmetic —
// never the browser's local timezone.
const IST_OFFSET_MS = 5.5 * 3600e3;
const istDayIndex = (ms) => Math.floor((ms + IST_OFFSET_MS) / 86400e3);

const rup = (v) => inr(v, { dp: 0 });
const rupSigned = (v) => inr(v, { dp: 0, sign: true });
const defaultTime = (v) => tokIstTime(v, { seconds: false });
const defaultDateTime = (v) => tokIstDateTime(v);

/** Elapsed hold, entry→exit (the span, not the age). */
function fmtHold(fromMs, toMsValue) {
    if (fromMs == null || toMsValue == null || toMsValue < fromMs) return '—';
    const m = Math.round((toMsValue - fromMs) / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function Stat({ label, value, good, bad, warn, title }) {
    return (
        <div className="min-w-[5rem]" title={title}>
            <div className="text-4xs text-fg-5 uppercase tracking-wide">{label}</div>
            <div className={`text-2xs font-mono ${good ? 'text-success' : bad ? 'text-danger' : warn ? 'text-warning' : 'text-fg-2'}`}>{value}</div>
        </div>
    );
}

const ARCHIVE_TITLE = 'Reconstructed after the trade from the 1-minute option-chain archive: this contract\'s archived '
    + 'last-traded price each minute, marked against the entry price. Approximate — minute snapshots, not fills, and pre-cost.';

/** Where the path came from. Exported for the day view's trade table. */
export function PathSourceChip({ source }) {
    if (source === 'recorded') {
        return <Chip tone="good" title="Marks sampled by the engine while the trade was open.">recorded</Chip>;
    }
    if (source === 'archive') {
        return <Chip tone="warning" title={ARCHIVE_TITLE}>rebuilt from archived quotes</Chip>;
    }
    return null;
}

/** Tooltip body: IST time plus every number the mark carries. */
function PathTooltip({ active, payload, ct, fmtAt, markName, bookedName = 'booked net' }) {
    if (!active || !Array.isArray(payload) || !payload.length) return null;
    const r = payload[0]?.payload;
    if (!r) return null;
    return (
        <div className="px-2 py-1 space-y-0.5" style={ct.tooltipStyle({ fontSize: ct.type['3xs'] })}>
            <div className="font-semibold">{fmtAt(r.ms)} IST</div>
            {r.booked != null
                ? <div>{bookedName} {rup(r.booked)}</div>
                : <div>{markName} {rup(r.net)}</div>}
            {r.gross != null && <div>gross {rup(r.gross)}</div>}
            {r.ltp != null && <div>option {premium(r.ltp)}</div>}
            {r.spot != null && <div>spot {fmtNum(r.spot, 0)}</div>}
        </div>
    );
}

export default function TradePathChart({ trade, istTime, istDateTime, istSpan }) {
    const ct = useChartTheme();
    const [showGross, setShowGross] = useState(true);
    const fmtTime = istTime || defaultTime;
    const fmtDateTime = istDateTime || defaultDateTime;

    const entryMs = toMs(trade?.entryAt);
    const exitMs = toMs(trade?.exitAt);
    // A quarantined (void) fill has a number in netPnl, but it was never booked.
    const isVoid = trade?.quarantined === true;
    const booked = isVoid ? null : finite(trade?.netPnl);
    const bookedIsGross = booked != null && trade?.bookedBasis === 'gross';
    const bookedName = bookedIsGross ? 'booked gross' : 'booked net';

    // Rows keep the epoch for the tooltip and a pre-formatted IST label for the
    // axis: recharts hands the axis value straight to the tick renderer, so
    // formatting there would re-run per tick on every hover.
    const { rows, marks, dropped, overnight } = useMemo(() => {
        const raw = Array.isArray(trade?.path) ? trade.path : [];
        const pts = [];
        let skipped = 0;
        for (const p of raw) {
            const ms = toMs(p?.t);
            const net = finite(p?.net);
            if (ms == null || net == null) { skipped++; continue; }
            pts.push({ ms, net, gross: finite(p?.gross), spot: finite(p?.spot), ltp: finite(p?.ltp) });
        }
        pts.sort((a, b) => a.ms - b.ms);
        // A bare "13:42" is ambiguous the moment a position is held overnight,
        // so a path that spans sessions gets the date on its ticks.
        const first = pts.length ? pts[0].ms : null;
        const last = pts.length ? pts[pts.length - 1].ms : null;
        const spansNight = first != null && ((last - first) > 12 * 3600e3
            || (exitMs != null && istDayIndex(exitMs) !== istDayIndex(first)));
        const lab = spansNight ? fmtDateTime : fmtTime;
        const out = pts.map((r) => ({ ...r, booked: null, label: lab(r.ms) }));
        // The booked net as its own point at the exit — the line's end and the
        // headline number are different things and both are drawn.
        if (out.length && booked != null) {
            const at = exitMs != null && exitMs >= last ? exitMs : last;
            out.push({ ms: at, net: null, gross: null, spot: null, ltp: null, booked, label: lab(at), isExit: true });
        }
        return { rows: out, marks: pts, dropped: skipped, overnight: spansNight };
    }, [trade, exitMs, booked, fmtTime, fmtDateTime]);

    const mae = finite(trade?.maeRupees);
    const mfe = finite(trade?.mfeRupees);
    const lastMark = marks.length ? marks[marks.length - 1].net : null;
    let bestMark = null;
    for (const m of marks) if (bestMark == null || m.net > bestMark) bestMark = m.net;
    const exitStep = (booked != null && lastMark != null) ? booked - lastMark : null;
    const showExitStep = exitStep != null && Math.abs(exitStep) >= 0.5;

    const hasGross = marks.some((r) => r.gross != null);
    const hasSpot = marks.some((r) => r.spot != null);
    // With a gross series beside it, `net` already deducts estimated costs
    // (multileg). Without one, the mark is the pre-cost MTM (single-leg).
    const marksAreNet = hasGross;
    const markName = marksAreNet ? 'net' : 'mark';

    // The peak the position reached: the tracked MFE (it can sit above the
    // once-a-minute marks) or, without one, the best drawn mark. MFE is floored
    // at ₹0, so peak > 0 is exactly "this trade was in profit at some point".
    const peak = mfe != null ? Math.max(mfe, bestMark ?? mfe) : bestMark;
    const everInProfit = peak != null && peak > 0;
    // The number that says a WINNER was mismanaged, on one basis (see header).
    const giveBackRef = marksAreNet ? (booked ?? lastMark) : lastMark;
    const gaveBack = everInProfit && giveBackRef != null && peak > giveBackRef ? peak - giveBackRef : null;
    const mfeFloored = mfe != null && mfe <= 0 && bestMark != null && bestMark < 0;

    const span = entryMs == null
        ? '—'
        : istSpan
            ? istSpan(trade?.entryAt, trade?.exitAt)
            : exitMs == null
                ? `${fmtDateTime(entryMs)} → open`
                : `${fmtDateTime(entryMs)} → ${istDayIndex(exitMs) === istDayIndex(entryMs) ? fmtTime(exitMs) : fmtDateTime(exitMs)}`;
    const hold = fmtHold(entryMs, exitMs);
    const reason = typeof trade?.pathReason === 'string' && trade.pathReason.trim() ? trade.pathReason.trim() : null;

    if (!marks.length) {
        return (
            <div className="text-3xs text-fg-5 border border-line-0 rounded p-2 bg-slate-800/20">
                No minute-by-minute P&amp;L path for this trade
                {reason ? <>: <span className="text-fg-4">{reason}</span></> : null}.
                {' '}A path exists only when the engine recorded one while the trade was open, or when it could be
                rebuilt afterwards from archived option quotes; otherwise only the entry and exit are kept.
                {dropped > 0 && <> {dropped} stored mark{dropped === 1 ? '' : 's'} had no usable time or value.</>}
                {booked != null && <> {bookedIsGross ? 'Booked gross (no net recorded, before charges)' : 'Booked net'} <span className={booked > 0 ? 'text-success' : booked < 0 ? 'text-danger' : 'text-fg-4'}>{rup(booked)}</span>.</>}
                {isVoid && <> <span className="text-warning">Void fill: booked on a price that never traded, so it is not a booked result and is excluded from every total.</span></>}
            </div>
        );
    }

    const fmtAt = overnight ? fmtDateTime : fmtTime;

    return (
        <div className="border border-line-0 rounded p-2 bg-slate-800/20">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <div className="text-3xs font-semibold text-fg-3 flex items-center gap-1.5 flex-wrap">
                    <span>P&amp;L while open</span>
                    <span className="text-fg-5 font-normal">
                        — {marks.length} marks, ~1/min, {marksAreNet ? 'net of estimated costs' : 'pre-cost'}
                    </span>
                    <PathSourceChip source={trade?.pathSource} />
                </div>
                {hasGross && (
                    <label className="flex items-center gap-1 text-4xs text-fg-5 cursor-pointer">
                        <input type="checkbox" checked={showGross} onChange={(e) => setShowGross(e.target.checked)} className="accent-sky-500" />
                        gross (pre-cost)
                    </label>
                )}
            </div>

            {/* Stat strip — the numbers the path exists to expose. */}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-2">
                <Stat label="Entry → Exit" value={span} />
                <Stat label="Held" value={hold} />
                <Stat label="MAE (worst)" value={mae == null ? '—' : rup(mae)} bad={mae != null && mae < 0}
                    title="Maximum Adverse Excursion — the deepest the mark went against you while the trade was open." />
                <Stat label="MFE (best)" value={mfe == null ? '—' : rup(mfe)} good={mfe != null && mfe > 0}
                    title={mfeFloored
                        ? `Never in profit: MFE is floored at ₹0. The best mark this trade showed was ${rup(bestMark)}.`
                        : 'Maximum Favourable Excursion — the best mark this trade ever showed.'} />
                <Stat label={bookedIsGross ? 'Booked gross' : 'Booked net'}
                    value={isVoid ? 'void' : booked == null ? '—' : rup(booked)}
                    good={booked != null && booked > 0} bad={booked != null && booked < 0} warn={isVoid}
                    title={isVoid
                        ? 'Void fill: booked on a price that never traded, so it is excluded from every total. Nothing was booked.'
                        : booked == null
                            ? 'No booked result was recorded on this trade.'
                            : bookedIsGross
                                ? 'No net_pnl was recorded on this trade, so this is its gross P&L, BEFORE charges.'
                                : 'What the trade actually booked, after charges.'} />
                {booked == null && lastMark != null && (
                    <Stat label={marksAreNet ? 'Last mark (net)' : 'Last mark (pre-cost)'} value={rup(lastMark)}
                        title="The last per-minute mark while the trade was open. It is not a booked result." />
                )}
                <Stat label="Gave back"
                    value={!everInProfit && peak != null ? 'never in profit' : gaveBack == null ? '—' : rup(gaveBack)}
                    warn={gaveBack != null}
                    title={!everInProfit && peak != null
                        ? 'No mark was ever above ₹0, so nothing was handed back: the trade was never in profit.'
                        : gaveBack == null
                            ? 'The trade finished at or above its best mark, so nothing was handed back.'
                            : marksAreNet
                                ? 'Best mark minus what was booked (both net of costs). The trade showed it; the exit did not keep it.'
                                : 'Best mark minus the last mark (both pre-cost). The trade showed it and handed it back before the exit; charges and slippage are in the exit step, not here.'} />
                {showExitStep && (
                    <Stat label="Exit step" value={rupSigned(exitStep)} warn={exitStep < 0}
                        title={`${bookedIsGross ? 'Booked gross' : 'Booked net'} minus the last mark.`} />
                )}
            </div>

            <ZoomableChart data={rows} height={200} controls={rows.length > 8}>
                <ComposedChart margin={{ top: 8, right: hasSpot ? 4 : 10, bottom: 2, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                    <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={34} />
                    <YAxis yAxisId="pnl" width={52} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }}
                        tickFormatter={rupeeTick} />
                    {/* Spot rides its own right-hand axis on its own domain — see
                        the header note. 'auto' (not dataMin/dataMax) so a flat
                        session still gets a sane band instead of a zero range. */}
                    {hasSpot && (
                        <YAxis yAxisId="spot" orientation="right" width={46} domain={['auto', 'auto']}
                            tick={{ fontSize: ct.type['5xs'], fill: ct.text.muted }}
                            tickFormatter={(v) => fmtNum(v, 0)} />
                    )}
                    <Tooltip cursor={{ stroke: ct.mark.live, strokeDasharray: '3 3' }}
                        content={<PathTooltip ct={ct} fmtAt={fmtAt} markName={marksAreNet ? 'net' : 'mark (pre-cost)'} bookedName={bookedName} />} />
                    <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                    {/* extendDomain, not the default: MAE/MFE can sit outside the
                        sampled marks (the extreme can be tracked every tick, the path
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
                    <Line yAxisId="pnl" type="monotone" name={markName} dataKey="net" stroke={ct.categorical[0]}
                        dot={false} strokeWidth={2} isAnimationActive={false} />
                    {booked != null && (
                        <Line yAxisId="pnl" name="booked" dataKey="booked" stroke={ct.text.primary} legendType="circle"
                            dot={{ r: 4, fill: ct.text.primary, stroke: ct.surface, strokeWidth: 2 }}
                            activeDot={{ r: 5 }} isAnimationActive={false} />
                    )}
                </ComposedChart>
            </ZoomableChart>

            {showExitStep && (
                <p className="text-4xs text-fg-5 mt-1">
                    Exit step {rupSigned(exitStep)}: {bookedName} {rup(booked)} minus the last mark {rup(lastMark)}
                    {marksAreNet
                        ? ' — fill slippage plus any gap between estimated and actual charges (these marks already deduct estimated costs).'
                        : bookedIsGross
                            ? ' — fill slippage only: no net_pnl was recorded, so the booked figure is gross (before charges), like these marks.'
                            : ' — charges plus fill slippage (these marks are pre-cost).'}
                </p>
            )}
            {isVoid && (
                <p className="text-4xs text-warning mt-1">
                    Void fill: this round-trip was booked on a price that never traded, so it is not a booked result and is
                    excluded from every total. Only its marks while open are drawn.
                </p>
            )}
            {dropped > 0 && (
                <p className="text-4xs text-warning mt-0.5">
                    {dropped} stored mark{dropped === 1 ? '' : 's'} had no usable time or value and {dropped === 1 ? 'is' : 'are'} not drawn.
                </p>
            )}
        </div>
    );
}
