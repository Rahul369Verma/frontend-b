/**
 * The words around a SAVED what-if replay (user, 18-Nov-2026: "save the replay so it will not calculate
 * again and again; it will show the history and we can recalculate it anytime"). The server keeps one
 * per question (backend logic/services/whatIfStore.js) and says, next to it, what has changed since.
 * Pure: the server's `saved` and `prices` in, sentences out.
 */
import { istDateTime } from '../viz/tokens';

/** "12 s", "1 min 5 s", "1 h 2 min". */
export function durationText(ms) {
    if (!(ms >= 0)) return null;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
    return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** "Saved replay: calculated 18 Nov 2026, 05:21 in 1 min 0 s, on 30 trades." */
export function savedLine(saved) {
    if (!saved) return 'Calculated just now and saved.';
    const took = durationText(saved.durationMs);
    return `Saved replay: calculated ${istDateTime(saved.computedAt)}${took ? ` in ${took}` : ''}${saved.trades ? `, on ${saved.trades} trade${saved.trades === 1 ? '' : 's'}` : ''}.`;
}

/** What changed since it was saved, each a reason to recalculate. */
export function savedWarnings(saved) {
    if (!saved) return [];
    const out = [];
    if (saved.outdated) out.push('Calculated with an older method: before the quote tape and before stops were decided on the last traded price. Recalculate for the accurate replay.');
    if (saved.newTrades > 0) out.push(`${saved.newTrades} newer trade${saved.newTrades === 1 ? '' : 's'} since it was calculated: recalculate to include ${saved.newTrades === 1 ? 'it' : 'them'}.`);
    if (saved.settingsChanged) out.push('The settings changed since it was calculated: recalculate to replay the current ones.');
    if (saved.limitChanged) out.push('It was calculated on a different number of trades.');
    return out;
}

/** "10 of 30 trades on the quote tape (every tick, from 2 Nov 2026); 20 on the archive's minute quotes." */
export function pricesLine(prices) {
    if (!prices) return null;
    const n = (prices.tape || 0) + (prices.minutes || 0);
    if (!n) return null;
    const from = prices.tapeFrom ? istDateTime(`${prices.tapeFrom}T09:15:00+05:30`).replace(/,.*$/, '') : '2 Nov 2026';
    if (!prices.tape) return `All ${n} on the archive's minute quotes (the quote tape starts ${from}).`;
    if (!prices.minutes) return `All ${n} on the quote tape (every tick).`;
    return `${prices.tape} of ${n} trades on the quote tape (every tick, from ${from}); ${prices.minutes} on the archive's minute quotes.`;
}
