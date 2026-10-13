/**
 * Market Rules formatting — what a reconciliation status means, and how a fact's
 * value and key read to a trader. Shared by the page and its tests.
 */
import { istDayLabel } from '../viz/tokens';

/** What each reconciliation status means, and how loudly to say it. */
export const STATUS_META = {
    confirmed: { level: 'good', label: 'confirmed', hint: 'Two or more independent sources agree' },
    authoritative: { level: 'good', label: 'exchange', hint: "The exchange's own file says so (wins over brokers)" },
    'single-source': { level: 'info', label: 'one source', hint: 'Applied, but only one source reports it' },
    conflict: { level: 'critical', label: 'conflict', hint: 'Sources disagree — the last value is kept until they agree' },
    suspicious: { level: 'warning', label: 'held', hint: 'The change is too large to apply without review — the last value is kept' },
    stale: { level: 'warning', label: 'stale', hint: 'No source has reported it for 3+ days — value kept, not current' },
    'no-data': { level: 'info', label: 'no data', hint: 'No source answered for it' },
};

/** A fact's value in the unit a trader reads it in. */
export function formatValue(family, v) {
    if (v == null) return '—';
    if (family === 'margin') return `${(Number(v) * 100).toFixed(2)}%`;
    if (family === 'rate') return `${(Number(v) * 100).toFixed(4)}%`;
    return String(v);
}

/** 'margin|MCX|GOLD' → 'MCX GOLD'; 'lot|NSE|NIFTY|2026-11' → 'NSE NIFTY · Nov 2026'. */
export function describeKey(key) {
    const [, ex, what, month] = String(key).split('|');
    if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split('-');
        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
        return `${ex} ${what} · ${mon} ${y}`;
    }
    if (what && /^\d{4}-\d{2}-\d{2}$/.test(what)) return `${ex} · ${istDayLabel(what)}`;
    return [ex, what].filter(Boolean).join(' ');
}
