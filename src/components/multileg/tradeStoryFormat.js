/**
 * Words for TradeStory.jsx and TodayStory.jsx: why an entry could not complete, what happened
 * while a trade was open, and a deployment's day (backend logic/multileg/dayStory.js and the
 * engine's `entryFailure` record).
 */
import { inr } from '../viz/tokens';

const short = (sym) => String(sym || '').replace(/^(NSE|BSE):/, '');
const legName = (l) => (l ? `${l.action} ${l.strike != null ? `${l.strike} ${l.type || ''}`.trim() : short(l.symbol)}` : 'a leg');
const rs = (v) => inr(v, { dp: 0, sign: true });
const ATTEMPT_WORD = { FILLED: 'filled', UNFILLED: 'not taken by the market', REJECTED: 'rejected', UNKNOWN: 'unclear at the broker', UNVERIFIED: 'accepted, unverified' };

/**
 * An unwound entry in sentences: which leg failed and the broker's words, which legs were bought
 * back (sold at, bought at), what that cost, and what was never sent.
 */
export function failureLines(trade) {
    const f = trade && trade.entryFailure;
    if (!f) return [];
    const out = [];
    const how = f.kind === 'rejected' ? 'was rejected by the broker' : f.kind === 'partial' ? 'was only partly filled' : f.kind === 'moved' ? 'was not sent — the market had moved too far' : 'did not fill';
    out.push(`The entry could not complete: ${legName(f.leg)} ${how}${f.message ? ` — “${f.message}”` : ''}.`);
    // every order sent for that leg (9-Nov-2026: an unfilled entry is re-priced and retried)
    const att = Array.isArray(f.attempts) ? f.attempts : [];
    if (att.length > 1) out.push(`Orders sent for it: ${att.map((x) => (x.status === 'NOT_SENT' ? `#${x.n} not sent` : `#${x.n} limit ₹${x.limit} ${ATTEMPT_WORD[x.status] || String(x.status || '').toLowerCase()}`)).join('; ')}.`);
    const unwound = (trade.legs || []).concat(trade.closedLegs || []).filter((l) => l.closeReason === 'UNWIND');
    if (unwound.length) {
        const parts = unwound.map((l) => `${legName(l)} ${l.action === 'SELL' ? 'sold' : 'bought'} at ₹${l.entryPrice}, ${l.action === 'SELL' ? 'bought back' : 'sold'} at ₹${l.exitPrice}`);
        const gross = Number(trade.grossPnl), charges = Number(trade.charges);
        const money = Number.isFinite(gross) && Number.isFinite(charges)
            ? ` That is ${rs(gross)} before charges and ₹${Math.round(charges)} of charges: ${rs(trade.netPnl)} booked.`
            : '';
        out.push(`So the leg${unwound.length === 1 ? '' : 's'} already filled ${unwound.length === 1 ? 'was' : 'were'} closed at once (unwind): ${parts.join('; ')}.${money}`);
    }
    if (f.notSent && f.notSent.length) out.push(`Never sent: ${f.notSent.map(legName).join(', ')}.`);
    if (f.source === 'journal') out.push('(Read from the engine journal: this trade was booked before the engine stored the reason with it.)');
    return out;
}

/** The legs table's extra rows for an unwound entry: the failed leg and those never sent. */
export function failedLegRows(trade) {
    const f = trade && trade.entryFailure;
    if (!f || !f.leg) return [];
    const why = f.kind === 'rejected' ? `rejected: ${f.message || ''}` : f.kind === 'partial' ? `partly filled: ${f.message || ''}` : f.kind === 'moved' ? `not sent: ${f.message || ''}` : `not filled: ${f.message || ''}`;
    return [{ ...f.leg, note: why.trim() }, ...(f.notSent || []).map((l) => ({ ...l, note: 'never sent (the entry stopped before it)' }))];
}

/** "×42" for a repeated line, "" once. */
export const times = (n) => (n > 1 ? ` ×${n}` : '');

export const TONE_CLASS = { bad: 'text-danger', warn: 'text-warning', good: 'text-success', info: 'text-fg-4' };
