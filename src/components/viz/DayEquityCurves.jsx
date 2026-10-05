'use strict';
/**
 * DayEquityCurves — one intraday P&L curve per trading day, both books.
 *
 * The daily bar/calendar says HOW MUCH a day made. It cannot say how the day
 * got there: a +₹4,000 day that was −₹9,000 at 11:30 and a +₹4,000 day that
 * never went red are the same bar and completely different risk. This draws
 * the second thing — the day's running P&L against IST clock time.
 *
 * INPUT is precomputed by utils/dayCurves.js (buildDayCurves); this component
 * does no P&L arithmetic of its own, so the invariant "day totals sum to the
 * booked P&L" is tested once, there, not re-derived here.
 *   days     — DayCurve[] newest first
 *              { day, startMs, endMs, total, points:[{ms,pnl}],
 *                trades:[{id,label,entryMs,exitMs,contribution,carriedIn,carriedOut,marked,pathSource}],
 *                markers:[{ms,kind,id,label}], coverage:{trades,marked,bookedOnly} }
 *   excluded — { [reason]: count } of trades NOT drawn. Every non-zero count
 *              is printed with its reason: a trade missing from a curve with
 *              nothing said is exactly the silent omission this app bans.
 *   markBasis — what a path mark means in this book, which decides what the
 *              step at an exit (booked result − last mark) is made of:
 *              'pre-cost' (single-leg) → charges + fill slippage;
 *              'net-of-estimated-costs' (multileg) → slippage + estimate error.
 *              Absent → the step is described without naming its causes.
 *
 * A position still open at a day's close with no marks that day contributes
 * an UNKNOWN amount to that day (its whole result lands on its exit day). It is
 * shown as unknown, never as ₹0 — a day made only of such positions has no
 * total, not a flat one.
 *
 * WHY THE COLLAPSED ROWS ARE HAND-DRAWN SVG
 * A book with a year of history is 250 rows. A recharts instance per row is 250
 * ResizeObservers and SVG trees for sparklines nobody is hovering; one <path>
 * per row costs nothing. Recharts is mounted only for a day the reader opens.
 *
 * INDIA VIX (the "India VIX" checkbox, off by default, remembered per browser)
 * Option premiums carry vega, so a day's P&L is partly a VIX move. When on:
 * each row gets the day's official VIX close-to-close change, an opened day
 * overlays its 1-minute VIX path on a SECOND, right-hand axis, each trade gets
 * "VIX while held", and a summary above the rows correlates day P&L with the
 * VIX change under a rotation null (utils/vixOverlay.js). Fetching is owned
 * here (hooks/useVixDays.js) so both pages get it with no page code;
 * `vixFetcher` exists only so tests can inject one. With the box unticked no
 * request is made and the rows and charts are exactly what they were.
 * VIX moves are NEVER coloured good/bad: a VIX rise helps a long option and
 * hurts a short-premium structure, and this component draws both books.
 */
import React, { memo, useCallback, useId, useMemo, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts';
import { useChartTheme } from '../../theme/chartTheme.js';
import { inr, pnlTone, rupeeTick, istTime, istDateTime, istDayLabel } from './tokens';
import { Chip, DataTable, Spinner } from './primitives';
import { PathSourceChip } from './TradePathChart';
import { unknownOnDay, dayIsUnknown } from '../../utils/dayCurves.js';
import {
    mergeDayWithVix, pnlVsVix, toCsv, vixWhileHeld, formatP, P_ALPHA, MIN_DAYS_FOR_ALPHA,
} from '../../utils/vixOverlay.js';
import useLocalStorage from '../../hooks/useLocalStorage.js';
import useVixDays from '../../hooks/useVixDays.js';

/** Days rendered before the "Show N more" button. */
const DAY_PAGE = 30;

/** localStorage key for the India VIX checkbox — one choice shared by both pages. */
const VIX_PREF_KEY = 'dayCurves.showVix';

// IST = UTC+05:30, no DST — hour ticks are arithmetic, never the browser's zone.
const IST_OFFSET_MS = 5.5 * 3600e3;
const HOUR_MS = 3600e3;

// Human reasons for the excluded buckets buildDayCurves (and the pages) report.
// An unknown key is still printed, by its own name, rather than dropped.
const EXCLUDED_REASON = {
    noExit: 'still open (no exit yet)',
    noBooked: 'no booked P&L',
    invalidTime: 'unreadable entry/exit time',
    quarantined: 'quarantined (fake fill, excluded from every total)',
    unreadable: 'could not be read',
    entryFailed: 'entry never filled (no position was held)',
    recoveryUnknown: 'closed by recovery with no known exit (its ₹0 is a placeholder)',
    partialDays: 'earlier day(s) not drawn: only positions carried out of them fall in this date range, so they would look complete when they are not',
};

// What the step at an exit is made of, per book (see markBasis above).
const EXIT_STEP_NOTE = {
    'pre-cost': 'The step at an exit is the booked result minus the last mark: charges plus fill slippage, because these marks are pre-cost.',
    'net-of-estimated-costs': 'The step at an exit is the booked net minus the last mark: fill slippage plus any gap between estimated and actual charges, because these marks already deduct estimated costs.',
};
const EXIT_STEP_DEFAULT = 'The step at an exit is the booked result minus the last mark.';

function excludedEntries(excluded) {
    if (!excluded || typeof excluded !== 'object') return [];
    return Object.entries(excluded)
        .filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n > 0)
        .map(([key, n]) => ({ key, n, reason: EXCLUDED_REASON[key] || key }));
}

/** 'HH:MM' IST, with seconds only when the instant is not on the minute. */
const clock = (ms) => istTime(ms, { seconds: ms % 60000 !== 0 });

// ── India VIX formatting ─────────────────────────────────────────────────────
// VIX is an index level, not rupees: plain 2dp, ASCII minus (pastes as a number).
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const vix2 = (v) => (isNum(v) ? v.toFixed(2) : '—');
const signed2 = (v) => (!isNum(v) ? '—' : v > 0 ? `+${v.toFixed(2)}` : v < 0 ? `-${Math.abs(v).toFixed(2)}` : '±0.00');
const arrow2 = (v) => (!isNum(v) ? '' : v > 0 ? `▲${v.toFixed(2)}` : v < 0 ? `▼${Math.abs(v).toFixed(2)}` : '±0.00');
const diff2 = (a, b) => Math.round((a - b) * 100) / 100 + 0;
const VIX_AXIS_TICK = (v) => String(+Number(v).toFixed(2));

const VIX_ROW_TITLE = "India VIX: the day's OFFICIAL close against the previous session's official close.";
const VIX_HELD_TITLE = 'India VIX from the later of this trade\'s entry and the first 1-minute bar of the day, to the earlier of its exit and the day\'s end — only the part of the trade on this day. '
    + 'All else equal a VIX rise lifts premiums: it helps a long option and hurts a short-premium structure.';

function hourTicks(startMs, endMs) {
    const span = endMs - startMs;
    if (!(span > 0)) return [startMs];
    const step = span > 12 * HOUR_MS ? 3 * HOUR_MS : span > 8 * HOUR_MS ? 2 * HOUR_MS : HOUR_MS;
    const ticks = [startMs];
    let t = Math.ceil((startMs + IST_OFFSET_MS) / HOUR_MS) * HOUR_MS - IST_OFFSET_MS;
    if (t - startMs < 20 * 60000) t += HOUR_MS;           // 09:15 then 10:00, never 09:15 + 09:17
    for (; t < endMs - 20 * 60000; t += step) ticks.push(t);
    ticks.push(endMs);
    return ticks;
}

/** Last point at or before `ms` (points are sorted ascending). */
function valueAt(points, ms) {
    let lo = 0, hi = points.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].ms <= ms) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best >= 0 ? points[best].pnl : 0;
}

// ── Collapsed-row sparkline: one step path, zero rule, no library ────────────
function Sparkline({ points, startMs, endMs, color, zeroColor, width = 120, height = 24 }) {
    const d = useMemo(() => {
        if (!Array.isArray(points) || !points.length) return null;
        let lo = 0, hi = 0;
        for (const p of points) { if (p.pnl < lo) lo = p.pnl; if (p.pnl > hi) hi = p.pnl; }
        const vSpan = (hi - lo) || 1;
        const tSpan = (endMs - startMs) || 1;
        const x = (ms) => (1 + ((ms - startMs) / tSpan) * (width - 2)).toFixed(1);
        const y = (v) => (height - 2 - ((v - lo) / vSpan) * (height - 4)).toFixed(1);
        let path = `M${x(points[0].ms)},${y(points[0].pnl)}`;
        let prev = points[0].pnl;
        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            if (p.pnl === prev) continue;                        // the next H covers a flat run
            path += `H${x(p.ms)}V${y(p.pnl)}`;
            prev = p.pnl;
        }
        path += `H${x(endMs)}`;
        return { path, zeroY: y(0) };
    }, [points, startMs, endMs, width, height]);
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="flex-shrink-0">
            {d && <line x1="0" x2={width} y1={d.zeroY} y2={d.zeroY} stroke={zeroColor} strokeWidth="1" />}
            {d && <path d={d.path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />}
        </svg>
    );
}

function CoverageChip({ coverage, count, unknown }) {
    const n = typeof coverage?.trades === 'number' ? coverage.trades : count;
    const m = typeof coverage?.marked === 'number' ? coverage.marked : 0;
    if (unknown) {
        return (
            <Chip tone="muted" title="Every trade on this day was still open at the close and has no marks here, so the day's P&L is unknown. Each result lands on the day it exited.">
                unmarked, carried out
            </Chip>
        );
    }
    if (m === 0) {
        return (
            <Chip tone="muted" title="No trade on this day has a minute-by-minute path, so the curve is a step at each exit.">
                booked only
            </Chip>
        );
    }
    return (
        <Chip tone="info" title={`${m} of ${n} trades on this day have per-minute marks; the rest appear as a single step at their exit.`}>
            marked {m}/{n}
        </Chip>
    );
}

function TradePathCell({ trade }) {
    if (!trade.marked) {
        return <Chip tone="muted" title="No marks on this day — this trade is a single step at its exit.">booked only</Chip>;
    }
    if (trade.pathSource === 'recorded' || trade.pathSource === 'archive') return <PathSourceChip source={trade.pathSource} />;
    return <Chip tone="neutral" title="Per-minute marks drawn from this trade's path.">marked</Chip>;
}

/** The row's VIX: official close vs previous official close, or '—' with the reason. Neutral tone always. */
function VixDayChip({ vix, loading, error }) {
    if (!vix) {
        if (loading) return <Chip tone="muted" title="Loading India VIX…">VIX …</Chip>;
        return <Chip tone="muted" title={error ? `India VIX could not be loaded: ${error}` : 'India VIX not loaded for this day.'}>VIX —</Chip>;
    }
    if (!isNum(vix.close)) {
        return <Chip tone="muted" title={`India VIX unavailable: ${vix.reason || 'no official close for this day'}.`}>VIX —</Chip>;
    }
    const title = [
        VIX_ROW_TITLE,
        vix.provisional ? 'Provisional: this is today and the session is still open, so the close and the change are running values.' : null,
        isNum(vix.changePct) ? `Change ${signed2(vix.changePct)}%.` : null,
        !isNum(vix.prevClose) ? `No previous close: ${vix.reason || 'unknown'}.` : null,
    ].filter(Boolean).join(' ');
    return (
        <Chip tone={vix.provisional ? 'info' : 'neutral'} title={title} className="tabular-nums">
            VIX {isNum(vix.prevClose) ? `${vix2(vix.prevClose)} → ` : ''}{vix2(vix.close)}
            {isNum(vix.change) ? ` ${arrow2(vix.change)}` : ''}{vix.provisional ? ' · so far' : ''}
        </Chip>
    );
}

/** What VIX did over the part of a trade held on this day. Never coloured good/bad (see the module comment). */
function VixHeldCell({ trade, intra, dayEndMs }) {
    if (!intra || intra.state === 'loading') return <span className="text-fg-5" title="Loading India VIX…">…</span>;
    if (intra.state === 'error') return <span className="text-fg-5" title={`India VIX could not be loaded: ${intra.error}`}>—</span>;
    if (!intra.intraday) return <span className="text-fg-5" title={`No 1-minute India VIX for this day: ${intra.reason || 'unknown'}.`}>—</span>;
    const { move, reason, code } = vixWhileHeld(trade, intra.intraday.points, dayEndMs);
    if (!move) {
        return (
            <span className="text-fg-5" title={reason}>
                —{code === 'beforeFirstBar' ? ' before first bar' : ''}
            </span>
        );
    }
    return (
        <span className="tabular-nums text-fg-3" title={VIX_HELD_TITLE}>
            {vix2(move.from)} → {vix2(move.to)} ({signed2(move.change)})
        </span>
    );
}

function DayTooltip({ active, payload, ct, eventsAt, showVix, vixRef }) {
    if (!active || !Array.isArray(payload) || !payload.length) return null;
    const r = payload[0]?.payload;
    if (!r) return null;
    const events = eventsAt.get(r.ms) || [];
    return (
        <div className="px-2 py-1 space-y-0.5 max-w-[16rem]" style={ct.tooltipStyle({ fontSize: ct.type['3xs'] })}>
            <div className="font-semibold">{clock(r.ms)} IST</div>
            <div>day P&amp;L {inr(r.pnl, { sign: true })}</div>
            {showVix && (
                <div>
                    {isNum(r.vix)
                        ? <>VIX {vix2(r.vix)}{isNum(vixRef) ? ` (${signed2(diff2(r.vix, vixRef))} vs prev close)` : ''}</>
                        : <>VIX — (no 1-minute bar closed yet)</>}
                </div>
            )}
            {events.map((e, i) => (
                <div key={`${e.id}-${e.kind}-${i}`} className="truncate">{e.kind === 'entry' ? 'entry' : 'exit'} · #{e.n} {e.label}</div>
            ))}
        </div>
    );
}

const SMALL_BUTTON = 'px-2 py-0.5 rounded border border-line bg-card-2 text-fg-3 hover:text-fg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** Under an opened day's chart: what the VIX line is, or why there is none. */
function VixDayNote({ vixDay, vixIntra, onRetry }) {
    if (!vixIntra || vixIntra.state === 'loading') {
        return <div className="mt-1"><Spinner size="xs" label="Loading India VIX for this day…" /></div>;
    }
    if (vixIntra.state === 'error') {
        return (
            <p className="text-4xs text-warning mt-1 flex flex-wrap items-center gap-2">
                <span>⚠ India VIX could not be loaded for this day: {vixIntra.error}.</span>
                {onRetry && <button type="button" onClick={onRetry} className={SMALL_BUTTON}>Retry</button>}
            </p>
        );
    }
    if (!vixIntra.intraday) {
        // A 200 can still carry a passing reason (no broker session, a rate
        // limit): the timer asks again, and Retry asks now.
        return (
            <p className="text-4xs text-warning mt-1 flex flex-wrap items-center gap-2">
                <span>No India VIX line for this day: {vixIntra.reason || 'no 1-minute bars'}.</span>
                {!vixIntra.settled && onRetry && <button type="button" onClick={onRetry} className={SMALL_BUTTON}>Retry</button>}
            </p>
        );
    }
    const { last, bars } = vixIntra.intraday;
    return (
        <p className="text-4xs text-fg-5 mt-1">
            India VIX line: {bars} one-minute bar closes, each drawn when its bar ends (the 09:15 bar appears at 09:16), so
            nothing is drawn before the first bar has closed.
            {isNum(vixDay?.close) && (
                <> The row&apos;s figures are official closes ({vix2(vixDay.close)}
                    {isNum(vixDay.prevClose) ? ` vs ${vix2(vixDay.prevClose)} the session before, ${signed2(vixDay.change)}` : ''}),
                    which can differ slightly from the last bar&apos;s close ({vix2(last.v)} at {clock(last.ms)}).</>
            )}
            {vixDay?.provisional && ' Today, session still open: the line and the close are still moving (asked again every minute).'}
        </p>
    );
}

// ── One expanded day: the full chart + its trades ────────────────────────────
function DayDetail({ day, vixOn = false, vixDay = null, vixIntra = null, onVixRetry }) {
    const ct = useChartTheme();
    const points = useMemo(() => (Array.isArray(day.points) ? day.points : []), [day.points]);
    const trades = useMemo(() => (Array.isArray(day.trades) ? day.trades : []), [day.trades]);

    // The VIX line is drawn only when there are bars; until then (or without
    // them) the chart is exactly the P&L chart, and a note says why.
    const intraday = vixOn && vixIntra?.state === 'ready' ? vixIntra.intraday : null;
    const vixPts = intraday ? intraday.points : null;
    const prevClose = vixOn && isNum(vixDay?.prevClose) ? vixDay.prevClose : null;
    const data = useMemo(() => (vixPts ? mergeDayWithVix(points, vixPts) : points), [points, vixPts]);
    // Its own domain, padded, and stretched to take in the previous close so the
    // overnight gap is visible. Never the P&L axis: rupees and index points
    // share no scale, and forcing one would flatten whichever is smaller.
    const vixDomain = useMemo(() => {
        if (!intraday) return null;
        let lo = intraday.low, hi = intraday.high;
        if (prevClose != null) { lo = Math.min(lo, prevClose); hi = Math.max(hi, prevClose); }
        const pad = Math.max((hi - lo) * 0.15, 0.05);
        return [Math.floor((lo - pad) * 20) / 20, Math.ceil((hi + pad) * 20) / 20];
    }, [intraday, prevClose]);
    const vixColor = ct.categorical[1];

    // Trades are numbered within the day; the chart markers carry the number and
    // the table below carries the name, so dense days stay legible.
    const { markers, eventsAt } = useMemo(() => {
        const numOf = new Map(trades.map((t, i) => [String(t.id), i + 1]));
        const list = (Array.isArray(day.markers) ? day.markers : []).map((m) => ({
            ...m, n: numOf.get(String(m.id)) ?? '?', y: valueAt(points, m.ms),
        }));
        const at = new Map();
        for (const m of list) {
            if (!at.has(m.ms)) at.set(m.ms, []);
            at.get(m.ms).push(m);
        }
        return { markers: list, eventsAt: at };
    }, [day.markers, trades, points]);

    const ticks = useMemo(() => hourTicks(day.startMs, day.endMs), [day.startMs, day.endMs]);
    const labelMarkers = markers.length <= 24;

    const columns = [
        { key: 'n', header: '#', render: (r) => r._n },
        { key: 'label', header: 'Trade', render: (r) => <span className="font-mono text-fg-3">{r.label || '—'}</span> },
        {
            key: 'span', header: 'Entry → exit (IST)',
            render: (r) => (
                <span className="text-fg-4">
                    {r.carriedIn ? istDateTime(r.entryMs) : clock(r.entryMs)}
                    {' → '}
                    {r.exitMs == null ? 'open' : r.carriedOut ? istDateTime(r.exitMs) : clock(r.exitMs)}
                </span>
            ),
        },
        {
            key: 'contribution', header: 'On this day', align: 'right',
            render: (r) => (unknownOnDay(r)
                ? <span className="text-fg-5" title="Still open at this day's close with no marks on this day: what it made or lost here is unknown. Its whole result lands on its exit day.">— lands on exit day</span>
                : <span className={`font-semibold ${pnlTone(r.contribution)}`}>{inr(r.contribution, { sign: true })}</span>),
        },
        ...(vixOn ? [{
            key: 'vixHeld', header: 'VIX while held', align: 'right',
            render: (r) => <VixHeldCell trade={r} intra={vixIntra} dayEndMs={day.endMs} />,
        }] : []),
        {
            key: 'carry', header: 'Carry',
            render: (r) => (!r.carriedIn && !r.carriedOut ? <span className="text-fg-5">—</span> : (
                <span className="inline-flex gap-1">
                    {r.carriedIn && (
                        <Chip tone="info" title={r.spansEarlierDays
                            ? "Carried in from a day on which it had no marks: what it shows here includes that earlier day's move, so this day's total is not this day's P&L alone."
                            : "Opened on an earlier day; only what it made or lost on this day counts here (its overnight gap lands at this day's first mark)."}>
                            carried in
                        </Chip>
                    )}
                    {r.carriedOut && <Chip tone="info" title="Still open at this day's close; the rest of its P&L lands on the day it exited.">carried out</Chip>}
                </span>
            )),
        },
        { key: 'path', header: 'Path', render: (r) => <TradePathCell trade={r} /> },
    ];
    const rows = trades.map((t, i) => ({ ...t, _n: i + 1, _key: `${t.id}-${i}` }));
    const unknownCount = trades.filter(unknownOnDay).length;

    return (
        <div className="px-2 pb-3 pt-1">
            {points.length ? (
                <ResponsiveContainer width="100%" height={220}>
                    {/* Every P&L mark names yAxisId 'pnl': with a second axis present,
                        recharts drops a mark whose axis id matches no YAxis. The grid
                        too: on the default id 0 it finds no axis and draws only the
                        top and bottom lines, VIX box ticked or not. */}
                    <LineChart data={data} margin={{ top: 14, right: vixPts ? 4 : 12, bottom: 2, left: 4 }}>
                        <CartesianGrid yAxisId="pnl" stroke={ct.gridSoft} strokeDasharray="3 3" />
                        <XAxis dataKey="ms" type="number" scale="time" domain={[day.startMs, day.endMs]} ticks={ticks}
                            tickFormatter={(ms) => istTime(ms, { seconds: false })}
                            tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} stroke={ct.axis} />
                        <YAxis yAxisId="pnl" width={56} tickFormatter={rupeeTick} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} stroke={ct.axis} />
                        {vixPts && (
                            <YAxis yAxisId="vix" orientation="right" width={40} domain={vixDomain} tickFormatter={VIX_AXIS_TICK}
                                tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} stroke={ct.axis} />
                        )}
                        <Tooltip cursor={{ stroke: ct.mark.live, strokeDasharray: '3 3' }}
                            content={<DayTooltip ct={ct} eventsAt={eventsAt} showVix={!!vixPts} vixRef={prevClose} />} />
                        <ReferenceLine yAxisId="pnl" y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                        {/* The VIX marks sit one z-layer BELOW the P&L line (default 400):
                            recharts 3 paints in registration order, and these mount after the
                            P&L line (their bars arrive later), so without the zIndex they
                            would be drawn on top of the series the chart is about. */}
                        {vixPts && prevClose != null && (
                            <ReferenceLine yAxisId="vix" y={prevClose} stroke={vixColor} strokeOpacity={0.7} strokeDasharray="4 3" zIndex={390}
                                label={{ value: 'VIX prev close', position: 'insideBottomRight', fontSize: ct.type['5xs'], fill: ct.text.secondary }} />
                        )}
                        {/* Thinner and translucent as well. */}
                        {vixPts && (
                            <Line yAxisId="vix" type="stepAfter" dataKey="vix" name="India VIX" stroke={vixColor} strokeWidth={1.25}
                                strokeOpacity={0.85} dot={false} isAnimationActive={false} connectNulls={false} zIndex={390} />
                        )}
                        <Line yAxisId="pnl" type="stepAfter" dataKey="pnl" name="day P&L" stroke={ct.categorical[0]} strokeWidth={2}
                            dot={false} isAnimationActive={false} />
                        {markers.map((m, i) => (
                            <ReferenceDot yAxisId="pnl" key={`${m.id}-${m.kind}-${i}`} x={m.ms} y={m.y} r={3.5} ifOverflow="extendDomain"
                                fill={m.kind === 'entry' ? ct.surface : ct.text.primary}
                                stroke={m.kind === 'entry' ? ct.mark.live : ct.surface} strokeWidth={1.5}
                                label={labelMarkers ? { value: String(m.n), position: 'top', fontSize: ct.type['5xs'], fill: ct.text.secondary } : undefined} />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <p className="text-3xs text-fg-5 py-2">No points to draw for this day.</p>
            )}
            <p className="text-4xs text-fg-5 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {vixPts && (
                    <>
                        <span className="inline-flex items-center gap-1">
                            <svg width="14" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke={ct.categorical[0]} strokeWidth="2" /></svg>
                            day P&amp;L (left axis)
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <svg width="14" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke={vixColor} strokeWidth="1.5" /></svg>
                            India VIX (right axis)
                        </span>
                        {prevClose != null && (
                            <span className="inline-flex items-center gap-1">
                                <svg width="14" height="8" aria-hidden="true"><line x1="0" y1="4" x2="14" y2="4" stroke={vixColor} strokeWidth="1" strokeDasharray="3 2" /></svg>
                                VIX prev close {vix2(prevClose)}
                            </span>
                        )}
                    </>
                )}
                <span className="inline-flex items-center gap-1">
                    <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" fill={ct.surface} stroke={ct.mark.live} strokeWidth="1.5" /></svg>
                    entry
                </span>
                <span className="inline-flex items-center gap-1">
                    <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3.5" fill={ct.text.primary} /></svg>
                    exit
                </span>
                <span>numbers match the # column below{labelMarkers ? '' : ` (unlabelled: ${markers.length} markers is too dense to number — hover for names)`}</span>
            </p>
            {vixOn && <VixDayNote vixDay={vixDay} vixIntra={vixIntra} onRetry={onVixRetry} />}
            {unknownCount > 0 && (
                <p className="text-4xs text-warning mt-1">
                    {unknownCount} position{unknownCount === 1 ? ' was' : 's were'} still open at this day&apos;s close with no marks on this day:
                    what {unknownCount === 1 ? 'it' : 'they'} made or lost here is unknown and is not in this curve. The whole result lands on the exit day.
                </p>
            )}
            <div className="mt-2">
                <DataTable dense columns={columns} rows={rows} empty="No trades on this day." />
            </div>
        </div>
    );
}

// ── One day row: a button that owns its panel ────────────────────────────────
const DayRow = memo(function DayRow({ day, open, onToggle, colors, panelId, vixOn = false, vixDay, vixLoading, vixError, vixIntra, onVixRetry }) {
    const count = Array.isArray(day.trades) ? day.trades.length : 0;
    const label = istDayLabel(day.day);
    const unknown = dayIsUnknown(day);
    const color = day.total > 0 ? colors.pos : day.total < 0 ? colors.neg : colors.flat;
    return (
        <li className="border-b border-line-0 last:border-b-0">
            <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined}
                onClick={() => onToggle(day.day)}
                className="w-full flex items-center gap-3 flex-wrap px-2 py-1.5 text-left rounded hover:bg-card-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span aria-hidden="true" className="text-fg-5 w-3">{open ? '▾' : '▸'}</span>
                <span className="text-xs text-fg-2 w-32 whitespace-nowrap">{label}</span>
                {unknown
                    ? <span className="text-xs tabular-nums w-24 text-right text-fg-5" title="Unknown: every trade on this day was still open at the close with no marks here.">—</span>
                    : <span className={`text-xs font-semibold tabular-nums w-24 text-right ${pnlTone(day.total)}`}>{inr(day.total, { sign: true })}</span>}
                <span className="text-2xs text-fg-5 w-16 whitespace-nowrap">{count} trade{count === 1 ? '' : 's'}</span>
                {/* An unknown day draws no line: a flat one would read as "flat day". */}
                <Sparkline points={unknown ? null : day.points} startMs={day.startMs} endMs={day.endMs} color={color} zeroColor={colors.zero} />
                <CoverageChip coverage={day.coverage} count={count} unknown={unknown} />
                {vixOn && <VixDayChip vix={vixDay} loading={vixLoading} error={vixError} />}
            </button>
            {open && (
                <div id={panelId} role="region" aria-label={`P&L on ${label}`}>
                    <DayDetail day={day} vixOn={vixOn} vixDay={vixDay} vixIntra={vixIntra} onVixRetry={onVixRetry} />
                </div>
            )}
        </li>
    );
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "P&L vs India VIX" — the across-days view, above the rows. Every day the
 * figures leave out is counted by reason; the verdict is worded by the
 * rotation p, and the smallest p this many days CAN produce is printed beside
 * it. Below MIN_DAYS_FOR_ALPHA days the test cannot reach p < 0.05 at all, and
 * the verdict says THAT rather than "not distinguishable from chance", so a
 * reader never mistakes "too few days to tell" for "no relationship".
 */
function VixSummary({ days, vix }) {
    const [csvError, setCsvError] = useState(null);
    const stats = useMemo(() => pnlVsVix(days, vix.byDay), [days, vix.byDay]);
    const { n, r, pRotation, minP, rReason, up, down, flat, excluded } = stats;
    const src = vix.source?.daily;
    const noneDays = vix.sourceDays?.none ?? 0;

    const download = () => {
        setCsvError(null);
        try {
            const keys = days.map((d) => d?.day).filter((d) => typeof d === 'string').sort();
            const blob = new Blob([toCsv(days, vix.byDay)], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pnl-vs-india-vix_${keys[0] || 'none'}_${keys[keys.length - 1] || 'none'}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Revoked on the next tick, not synchronously: some browsers resolve
            // the blob URL after click() returns, and a revoked URL saves nothing.
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (err) {
            setCsvError(err?.message || String(err));
        }
    };

    const excludedParts = [
        excluded.noVix > 0 && `${plural(excluded.noVix, 'day')} with no VIX change`,
        excluded.unknownPnl > 0 && `${plural(excluded.unknownPnl, 'day')} whose P&L is unknown (every trade carried out unmarked)`,
        excluded.partialPnl > 0 && `${plural(excluded.partialPnl, 'day')} whose P&L is partial (a position held across a close with no marks there: its move is missing, or lands on a later day)`,
        excluded.provisional > 0 && `${plural(excluded.provisional, 'provisional day')} (today, session still open)`,
    ].filter(Boolean);
    const reachable = minP != null && minP < P_ALPHA;
    const significant = reachable && pRotation != null && pRotation < P_ALPHA;

    return (
        <div role="region" aria-label="P&L vs India VIX" className="border border-line-0 rounded px-2 py-1.5 mb-2 space-y-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-semibold text-fg-2">P&amp;L vs India VIX</h3>
                <div className="flex items-center gap-2">
                    {src && (
                        <Chip tone={src === 'none' ? 'critical' : src === 'partial' ? 'warning' : 'neutral'}
                            title="Where the server read India VIX from, counted per day: a day with no VIX value at all counts as none.">
                            VIX source: {src === 'fyers' ? 'Fyers' : src === 'none' ? 'unavailable' : src === 'partial' ? `Fyers · none for ${plural(noneDays, 'day')}` : src}
                        </Chip>
                    )}
                    <button type="button" onClick={download} disabled={vix.loading} className={`${SMALL_BUTTON} text-2xs`}>
                        Download CSV
                    </button>
                </div>
            </div>
            {vix.loading && <Spinner size="xs" label="Loading India VIX…" />}
            {vix.error && (
                <p className="text-3xs text-warning flex flex-wrap items-center gap-2">
                    <span>⚠ India VIX could not be loaded for {plural(vix.errorDays, 'day')}: {vix.error}.</span>
                    <button type="button" onClick={vix.reload} className={SMALL_BUTTON}>Retry</button>
                </p>
            )}
            {vix.warnings.map((w) => <p key={w} className="text-3xs text-warning">⚠ {w}</p>)}
            {csvError && <p className="text-3xs text-warning">⚠ The CSV could not be built: {csvError}.</p>}
            {!vix.loading && (
                <>
                    <p className="text-3xs text-fg-3">
                        {r == null ? (
                            <>Across {plural(n, 'day')}: {rReason} — no correlation is reported.</>
                        ) : (
                            <>
                                Across {n} days: correlation <strong>r = {r.toFixed(2)}</strong> between day P&amp;L and VIX change
                                (rotation test p = {formatP(pRotation)}; with {n} days the smallest possible p is {formatP(minP)})
                                {' — '}
                                {!reachable
                                    ? <>too few days for this test to reach p &lt; {P_ALPHA} (it needs at least {MIN_DAYS_FOR_ALPHA}), so it cannot yet tell a real link from chance</>
                                    : significant
                                        ? <strong className="text-warning">stronger than chance alignment usually produces; check it holds on a later period before acting on it</strong>
                                        : <>not distinguishable from chance</>}.
                            </>
                        )}
                    </p>
                    <p className="text-3xs text-fg-4">
                        VIX up days: {up.n}{up.n > 0 && <>, avg P&amp;L <span className={pnlTone(up.avgPnl)}>{inr(up.avgPnl, { sign: true })}</span></>}
                        {' · '}VIX down days: {down.n}{down.n > 0 && <>, avg P&amp;L <span className={pnlTone(down.avgPnl)}>{inr(down.avgPnl, { sign: true })}</span></>}
                        {flat.n > 0 && <> · unchanged: {flat.n}</>}
                    </p>
                    {excludedParts.length > 0 && (
                        <p className="text-3xs text-warning">Not in these figures: {excludedParts.join(' · ')}.</p>
                    )}
                    {/* A 200 whose days carry a passing reason (no broker session, a
                        failed chunk) sets no error, so it needs its own Retry. */}
                    {!vix.error && vix.retryableDays > 0 && (
                        <p className="text-3xs text-fg-4 flex flex-wrap items-center gap-2">
                            <span>
                                {plural(vix.retryableDays, 'day')} still {vix.retryableDays === 1 ? 'lacks' : 'lack'} a VIX value the server may yet give
                                (the row chip says why); asked again on their own, every 1 to 16 minutes.
                            </span>
                            <button type="button" onClick={vix.reload} className={SMALL_BUTTON}>Retry</button>
                        </p>
                    )}
                </>
            )}
            <p className="text-4xs text-fg-5">
                VIX change is the day&apos;s official close minus the previous session&apos;s official close. A rise lifts option
                premiums, all else equal: it helps a long option and hurts a short-premium structure, so the sign to expect depends
                on the book. The rotation test slides the VIX series against the P&amp;L series (both keep their own runs of calm
                and nervous days), which is fairer than a shuffle; a correlation is an association, not a cause.
            </p>
        </div>
    );
}

export default function DayEquityCurves({ days, excluded, title = 'Day by day', emptyText, markBasis, vixFetcher }) {
    const ct = useChartTheme();
    const idBase = useId();
    const [open, setOpen] = useState(() => new Set());
    const [shown, setShown] = useState(DAY_PAGE);
    const [vixOn, setVixOn] = useLocalStorage(VIX_PREF_KEY, false, { validate: (v) => typeof v === 'boolean' });

    const list = useMemo(() => (Array.isArray(days) ? days : []), [days]);
    const dropped = useMemo(() => excludedEntries(excluded), [excluded]);
    const net = useMemo(() => list.reduce((a, d) => a + (Number.isFinite(d?.total) ? d.total : 0), 0), [list]);
    const colors = useMemo(() => ({
        pos: ct.diverging.positive, neg: ct.diverging.negative, flat: ct.text.muted, zero: ct.grid,
    }), [ct]);

    const toggle = useCallback((key) => {
        setOpen((s) => {
            const n = new Set(s);
            if (n.has(key)) n.delete(key); else n.add(key);
            return n;
        });
    }, []);

    // Summaries for every listed day (the correlation needs them all); the
    // 1-minute path only for the days the reader has opened.
    const dayKeys = useMemo(() => list.map((d) => d?.day), [list]);
    const openKeys = useMemo(() => [...open], [open]);
    const vix = useVixDays(dayKeys, { expanded: openKeys, enabled: vixOn && list.length > 0, fetcher: vixFetcher });
    const vixShown = vixOn && list.length > 0;

    const visible = list.slice(0, shown);
    const hidden = list.length - visible.length;

    const excludedLine = dropped.length > 0 && (
        <p className="text-3xs text-warning mb-2">
            Not in these curves: {dropped.map((e, i) => (
                <span key={e.key}>{i > 0 ? ' · ' : ''}{e.n} {e.reason}</span>
            ))}.
        </p>
    );

    return (
        <section aria-label={title}>
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <h2 className="text-sm font-semibold text-fg">{title}</h2>
                {list.length > 0 && (
                    <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
                        <span className="text-2xs text-fg-5">
                            {list.length} day{list.length === 1 ? '' : 's'} · net <span className={pnlTone(net)}>{inr(net, { sign: true })}</span>
                        </span>
                        <label className="inline-flex items-center gap-1.5 text-2xs text-fg-4 cursor-pointer select-none"
                            title="Show India VIX beside each day: the official close-to-close change on every row, the 1-minute VIX line on an opened day's chart, and how day P&L lines up with VIX moves.">
                            <input type="checkbox" checked={vixOn} onChange={(e) => setVixOn(e.target.checked)}
                                className="accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                            India VIX
                        </label>
                    </div>
                )}
            </div>
            <p className="text-3xs text-fg-5 mb-2">
                Each day&apos;s running P&amp;L against IST time. Open trades move with their per-minute marks; a trade with
                no path appears as one step at its exit. {EXIT_STEP_NOTE[markBasis] || EXIT_STEP_DEFAULT} A position
                carried in from an earlier day counts only what it made or lost on that day.
            </p>
            {excludedLine}
            {list.length === 0 ? (
                <p className="text-xs text-fg-5 py-4 text-center">{emptyText || 'No closed trades with a booked P&L to draw.'}</p>
            ) : (
                <>
                    {vixShown && <VixSummary days={list} vix={vix} />}
                    <ul className="border border-line-0 rounded">
                        {visible.map((d, i) => (
                            <DayRow key={d.day || i} day={d} open={open.has(d.day)} onToggle={toggle}
                                colors={colors} panelId={`${idBase}-day-${i}`}
                                {...(vixShown ? {
                                    vixOn: true,
                                    vixDay: vix.byDay[d.day],
                                    vixLoading: vix.loading,
                                    vixError: vix.error,
                                    vixIntra: vix.intraByDay[d.day],
                                    onVixRetry: vix.reload,
                                } : null)} />
                        ))}
                    </ul>
                    {hidden > 0 && (
                        <div className="flex items-center gap-2 mt-2 text-2xs text-fg-5">
                            <button type="button" onClick={() => setShown((s) => s + DAY_PAGE)}
                                className="px-2 py-0.5 rounded border border-line bg-card-2 text-fg-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                Show {Math.min(DAY_PAGE, hidden)} more
                            </button>
                            <span>{hidden} older day{hidden === 1 ? '' : 's'} not shown</span>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
