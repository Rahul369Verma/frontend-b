'use strict';
/**
 * lots — what ONE lot is, for the forms and for every hand-off between them.
 *
 * Sizing is `lots × the exchange lot listed on the trade's own day`: the backtest
 * engine and the live engine both resolve that per trade (backend
 * marketFacts.contractFor). So a form holds
 *   lots      how many lots — the only sizing choice;
 *   lot_size  ONE lot today — shown, and the engine's fallback when no contract lot exists.
 *
 * User, 17-Oct-2026: the Optimizer showed "75" for one NIFTY lot. That was the
 * lot on its window's START date (65 from 31 Dec 2025), handed to Test / Copy JSON
 * / Save as if it were the lot. A window's lots are a timeline (backend
 * marketFacts.lotTimeline); one lot is today's.
 *
 * MCX and Delta size differently (MCX lots, Delta contracts) and keep their own fields.
 */
import { INSTRUMENT_CONFIG } from '../constants';

/** Sized as lots × the exchange lot (index and stock options)? */
export const sizesByLots = (symbol) => typeof symbol === 'string' && symbol.includes(':')
    && !symbol.startsWith('MCX:') && !symbol.startsWith('DELTA:');

/** One lot today, or null when the symbol is unknown. */
export function currentLot(symbol, instrumentConfig = INSTRUMENT_CONFIG) {
    const n = Number(instrumentConfig?.[symbol]?.lotSize);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Settings with the lot made honest: for a lot-sized symbol, `lot_size` is one lot
 * today and `lots` is a whole number ≥ 1. Anything else is left as it is.
 */
export function withCurrentLot(settings, instrumentConfig = INSTRUMENT_CONFIG) {
    const s = { ...(settings || {}) };
    if (!sizesByLots(s.symbol)) return s;
    const lot = currentLot(s.symbol, instrumentConfig);
    if (lot) s.lot_size = lot;
    const lots = parseInt(s.lots, 10);
    s.lots = Number.isFinite(lots) && lots >= 1 ? lots : 1;
    return s;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };

/**
 * "65" · "65 — window: 75 until 30 Dec 2025, then 65" · "30 — window crosses 4 lot changes (30, 35)".
 * @param now     one lot today (number)
 * @param window  [{from, to, size}] from the backend (marketFacts.lotTimeline), or null
 */
export function lotText(now, window = null) {
    const periods = Array.isArray(window) ? window : [];
    const head = now != null ? String(now) : (periods.length ? String(periods[periods.length - 1].size) : '—');
    if (periods.length < 2) return head;
    if (periods.length === 2) return `${head} — window: ${periods[0].size} until ${dmy(periods[0].to)}, then ${periods[1].size}`;
    const sizes = [...new Set(periods.map((p) => p.size))].sort((a, b) => a - b);
    return `${head} — window crosses ${periods.length - 1} lot changes (${sizes.join(', ')})`;
}
