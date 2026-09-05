'use strict';
/**
 * PnlCalendar — a GitHub-style daily P&L heatmap, one cell per calendar day.
 *
 *   <PnlCalendar daily={[{ date: '2026-08-31', net: -1240 }, …]} rangeDays={30} />
 *
 * WHY THIS IS ITS OWN COMPONENT
 * This grid lived inside `pages/StrategyDetail.jsx` as two private functions
 * (`buildCalendar` + `CalendarView`) plus two module-scope helpers they leaned
 * on (`DATE_RANGES`, `toIst`). That made it unreachable from anywhere else —
 * the multileg Results panel and the live-portfolio page both want the same
 * picture and would otherwise have had to copy it, which is how three
 * calendars with three different colour thresholds happen.
 *
 * THE PROP SHAPE IS THE SERVER'S SHAPE, DELIBERATELY
 * Both analytics endpoints (`/api/multileg/analytics` and
 * `/api/analytics/live-portfolio`) already return `daily: [{ date, net, … }]`
 * with `date` as an IST 'YYYY-MM-DD' key. So this takes that array as-is and
 * buckets it itself, rather than asking every caller to pre-build a Map. Extra
 * fields on a row are ignored.
 *
 * ── IST IS OWNED HERE ───────────────────────────────────────────────────────
 * Every timestamp in the system is UTC; market days are IST (Asia/Kolkata). The
 * `date` keys arriving in `daily` are ALREADY IST day keys, so the only thing
 * this component needs UTC→IST for is deciding which day is "today" — get that
 * wrong and the grid either stops a day short or paints tomorrow as a real,
 * empty (i.e. losing-looking) trading day. All the arithmetic below runs on
 * UTC-midnight Dates whose *calendar* value is the IST day, which is why it
 * uses `getUTCDay()`/`toISOString()` and never a local-time getter: those would
 * re-introduce the browser's timezone into a market-day calculation.
 *
 * ── WHAT `rangeDays` MEANS ──────────────────────────────────────────────────
 *   number → the last N days ending today (IST), so an empty tail is visible
 *            as empty rather than the grid silently ending at the last trade.
 *   null   → span the whole data set (earliest key → today).
 * Either way the first column is padded back to a Monday so the week columns
 * line up with the Mon…Sun row labels.
 */
import React, { useMemo } from 'react';

// ── IST day arithmetic ────────────────────────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86400000;
/** UTC instant → a Date whose UTC calendar fields ARE the IST wall clock. */
const toIst = (utc) => new Date(new Date(utc).getTime() + IST_OFFSET_MS);

/** Rupees, ASCII sign outside the glyph. Non-finite → em dash, never ₹NaN. */
const fmtINR = (n) => {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    const sign = v < 0 ? '-' : '';
    return `${sign}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

/**
 * Cell colour. Four intensity buckets per sign, so a ₹200 day and a ₹40,000 day
 * are not the same green — the point of the grid is spotting the outliers.
 *
 * `null` (no trades) and exactly ₹0 (a scratch day) are deliberately DIFFERENT
 * shades: "we did not trade" and "we traded and made nothing" are different
 * facts, and collapsing them hides idle stretches.
 */
function calendarColor(pnl) {
    if (pnl == null) return 'bg-slate-800 border-line';
    if (pnl === 0)   return 'bg-slate-700 border-line-2';
    const abs = Math.abs(pnl);
    // Logarithmic-ish bucketing: tiny / small / medium / large.
    let intensity;
    if (abs < 500)       intensity = 1;
    else if (abs < 2000) intensity = 2;
    else if (abs < 5000) intensity = 3;
    else                 intensity = 4;
    if (pnl > 0) {
        return [
            'bg-emerald-900/40 border-emerald-800',
            'bg-emerald-700/60 border-emerald-600',
            'bg-emerald-600/80 border-emerald-500',
            'bg-emerald-500 border-emerald-400',
        ][intensity - 1];
    }
    return [
        'bg-red-900/40 border-red-800',
        'bg-red-700/60 border-red-600',
        'bg-red-600/80 border-red-500',
        'bg-red-500 border-red-400',
    ][intensity - 1];
}

/**
 * `[{ date, net }]` → a Map<'YYYY-MM-DD', number>, summing duplicates.
 *
 * A row whose `net` is missing or non-numeric still CREATES the day at 0: the
 * day was traded, and dropping it would render as "no trades" (a different
 * fact, and a different colour). Rows with an unparseable date are skipped.
 */
function toDayMap(daily) {
    const m = new Map();
    if (!Array.isArray(daily)) return m;
    for (const row of daily) {
        const key = String(row?.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        const v = Number(row?.net);
        m.set(key, (m.get(key) || 0) + (Number.isFinite(v) ? v : 0));
    }
    return m;
}

/** Contiguous IST days (earliest → today), Monday-padded, chunked into weeks. */
function buildCalendar(dayMap, rangeDays) {
    const days = [];
    const today = toIst(Date.now());
    today.setUTCHours(0, 0, 0, 0);
    let start;
    if (Number.isFinite(Number(rangeDays)) && Number(rangeDays) > 0) {
        start = new Date(today.getTime() - (Number(rangeDays) - 1) * DAY_MS);
    } else if (dayMap.size > 0) {
        const earliest = [...dayMap.keys()].sort()[0];
        start = new Date(earliest + 'T00:00:00.000Z');
    } else {
        start = new Date(today.getTime() - 29 * DAY_MS);
    }
    // Pad to start on a Monday for clean week columns.
    const dow = (start.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    start = new Date(start.getTime() - dow * DAY_MS);
    for (let t = start.getTime(); t <= today.getTime(); t += DAY_MS) {
        const d = new Date(t);
        const key = d.toISOString().slice(0, 10);
        days.push({ date: key, pnl: dayMap.get(key) ?? null });
    }
    // Chunk into weeks of 7.
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return weeks;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PnlCalendar({ daily, rangeDays = null, title = 'Daily PnL Calendar' }) {
    const weeks = useMemo(() => buildCalendar(toDayMap(daily), rangeDays), [daily, rangeDays]);
    return (
        <div>
            {title ? <h3 className="text-base font-semibold text-fg-2 mb-3">{title}</h3> : null}
            <div className="flex gap-2">
                <div className="flex flex-col gap-1 pt-6 text-3xs text-fg-5">
                    {DAY_LABELS.map(d => <div key={d} className="h-5 flex items-center">{d}</div>)}
                </div>
                <div className="flex gap-1 overflow-x-auto pb-2">
                    {weeks.map((week, wi) => (
                        <div key={wi} className="flex flex-col gap-1">
                            <div className="h-5 text-4xs text-fg-5 text-center">
                                {wi % 4 === 0 && week[0]?.date ? new Date(week[0].date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                            </div>
                            {Array.from({ length: 7 }).map((_, di) => {
                                const cell = week[di];
                                if (!cell) return <div key={di} className="w-5 h-5" />;
                                const isFuture = new Date(cell.date) > new Date();
                                if (isFuture) return <div key={di} className="w-5 h-5 bg-slate-900/40 border border-line-0/60 rounded" />;
                                return (
                                    <div
                                        key={di}
                                        className={`w-5 h-5 rounded border ${calendarColor(cell.pnl)}`}
                                        title={`${cell.date} · ${cell.pnl == null ? 'no trades' : fmtINR(cell.pnl)}`}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-3 mt-4 text-3xs text-fg-5">
                <span>Less</span>
                <div className="w-4 h-4 rounded border bg-red-700/60 border-red-600" />
                <div className="w-4 h-4 rounded border bg-red-900/40 border-red-800" />
                <div className="w-4 h-4 rounded border bg-slate-700 border-line-2" />
                <div className="w-4 h-4 rounded border bg-emerald-900/40 border-emerald-800" />
                <div className="w-4 h-4 rounded border bg-emerald-700/60 border-emerald-600" />
                <span>More</span>
                <span className="ml-4">Hover a cell to see the day&apos;s PnL.</span>
            </div>
        </div>
    );
}
