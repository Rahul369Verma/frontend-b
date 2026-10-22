/**
 * The Multi-Leg Results page's ONE time window, by EXIT time (IST) — pure helpers.
 *
 * A window is either a preset (the last 30 / 90 days, or all) or a date RANGE: From → To,
 * whole IST days, To inclusive. One day is a range whose From and To are the same date
 * (user, 23-Oct-2026: "see the results of a particular day … structure round-trips with
 * a date filter"). The server reads `since` (inclusive) and `until` (EXCLUSIVE) as epoch ms,
 * so a day is [its IST midnight, the next IST midnight).
 */
const DAY_MS = 864e5;
const IST_MS = 5.5 * 3600e3;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → that date's 00:00 IST as epoch ms (NaN when not a date). */
export const istMidnightMs = (ymd) => (YMD.test(String(ymd || '')) ? Date.parse(`${ymd}T00:00:00+05:30`) : NaN);

/** The IST calendar date of an instant. */
export const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);

/** A date `n` trading days away (Saturdays and Sundays skipped; exchange holidays are not known here). */
export function stepTradingDay(ymd, n) {
    let t = istMidnightMs(ymd);
    if (!Number.isFinite(t)) return ymd;
    const dir = n < 0 ? -1 : 1;
    for (let left = Math.abs(n); left > 0;) {
        t += dir * DAY_MS;
        const wd = new Date(t + IST_MS).getUTCDay();
        if (wd !== 0 && wd !== 6) left--;
    }
    return istDate(t);
}

/** A preset window: the last `days` days (from now), or 'all'. */
export function presetWindow(days, now = Date.now()) {
    return { days, since: days === 'all' ? null : now - Number(days) * DAY_MS, until: null, from: null, to: null };
}

/** A date range (To inclusive; swapped if given backwards), or null when a date is not valid. */
export function rangeWindow(from, to = from) {
    let a = String(from || ''), b = String(to || from || '');
    if (!Number.isFinite(istMidnightMs(a)) || !Number.isFinite(istMidnightMs(b))) return null;
    if (a > b) [a, b] = [b, a];
    return { days: 'range', since: istMidnightMs(a), until: istMidnightMs(b) + DAY_MS, from: a, to: b };
}

const fmtDay = (ymd, withYear = true) => new Date(istMidnightMs(ymd) + IST_MS).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** "21 Oct 2026" · "14 Oct – 21 Oct 2026" · "the last 30 days" · "all time". */
export function windowLabel(w) {
    if (!w || w.days === 'all') return 'all time';
    if (w.days === 'range' && w.from) {
        if (w.from === w.to) return fmtDay(w.from);
        return `${fmtDay(w.from, w.from.slice(0, 4) !== w.to.slice(0, 4))} – ${fmtDay(w.to)}`;
    }
    return `the last ${w.days} days`;
}

/** The window as URL params (?from=&to=), so a day can be bookmarked or shared. */
export function windowFromParams(params) {
    const from = params && params.get ? params.get('from') : null;
    if (!from) return null;
    return rangeWindow(from, params.get('to') || from);
}
