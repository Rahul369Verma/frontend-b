/**
 * JournalDetail — the facts behind one engine-journal row (`event.detail`), folded under the line.
 *
 * Since 9-Nov-2026 every LIVE entry order is journaled with what it was priced at: the quote (its
 * source and age, the bid/ask it came with), the price it was set off (bid / ask / ltp / decided),
 * the limit, the order id and what became of it (filled, not taken by the market, rejected, not
 * sent). An entry the market did not take is re-priced and retried; this is where the whole story
 * of each attempt is read. Other detail (a stale quote, a chain row that lagged the live price) is
 * shown as it was written.
 */
import React from 'react';
import { istTime } from '../viz/tokens.js';

const OUTCOME = {
    FILLED: { text: 'filled', tone: 'text-success' },
    UNFILLED: { text: 'not taken by the market — cancelled', tone: 'text-warning' },
    REJECTED: { text: 'rejected by the broker', tone: 'text-danger' },
    NOT_SENT: { text: 'not sent', tone: 'text-danger' },
    UNKNOWN: { text: 'fill state unknown', tone: 'text-danger' },
    UNVERIFIED: { text: 'accepted (no status API to verify)', tone: 'text-warning' },
};
const sec = (ms) => (Number.isFinite(Number(ms)) ? `${Math.round(Number(ms) / 100) / 10} s` : null);
const rs = (v) => (v == null || v === '' ? '—' : `₹${v}`);

/** One order attempt, in words. */
export function AttemptLine({ a }) {
    const q = a.quote;
    const o = OUTCOME[a.status] || { text: a.status ? String(a.status).toLowerCase() : 'awaiting the broker', tone: 'text-fg-4' };
    const quoteText = q
        ? `${q.src || 'quote'}${q.ageMs ? ` ${sec(q.ageMs)} old` : ''}: bid ${q.bid ?? '—'} / ask ${q.ask ?? '—'}${q.ltp ? ` (ltp ${q.ltp})` : ''}`
        : 'no quote';
    const drift = Number(a.driftPct);
    return (
        <li className="break-words">
            <span className="text-fg-3 font-medium">#{a.n}</span>
            {a.at && <span className="text-fg-5"> {istTime(a.at)}</span>}
            {' · '}{quoteText}
            {' · '}off the {a.basis || '?'} {rs(a.ref)}
            {Number.isFinite(drift) && drift !== 0 && <span className={drift > 0 ? 'text-warning' : 'text-fg-5'}> ({drift > 0 ? '+' : ''}{drift}% vs decided {rs(a.decided)})</span>}
            {' · '}limit {rs(a.limit)}
            {a.orderId && <> · order <span className="font-mono">{a.orderId}</span></>}
            {' · '}<span className={o.tone}>{o.text}</span>
            {a.fillPrice != null && <> @ {rs(a.fillPrice)}{a.fillQty ? ` × ${a.fillQty}` : ''}</>}
            {a.waitedMs != null && <span className="text-fg-5"> after {sec(a.waitedMs)}</span>}
            {a.message && a.status !== 'FILLED' && <span className="text-fg-5"> — {a.message}</span>}
        </li>
    );
}

export default function JournalDetail({ detail }) {
    if (!detail || typeof detail !== 'object') return null;
    const attempts = Array.isArray(detail.attempts) ? detail.attempts : (detail.n != null && 'limit' in detail ? [detail] : null);
    const rest = attempts && attempts !== detail ? Object.fromEntries(Object.entries(detail).filter(([k]) => k !== 'attempts')) : attempts ? {} : detail;
    const restKeys = Object.keys(rest);
    return (
        <details className="basis-full text-3xs text-fg-4">
            <summary className="cursor-pointer select-none text-fg-5 hover:text-fg-3">
                details{attempts ? ` — ${attempts.length} order attempt${attempts.length === 1 ? '' : 's'}` : ''}
            </summary>
            {attempts && attempts.length > 0 && (
                <ol className="mt-0.5 space-y-0.5 pl-2">
                    {attempts.map((a, i) => <AttemptLine key={`${a.n ?? i}-${a.orderId ?? ''}`} a={a} />)}
                </ol>
            )}
            {restKeys.length > 0 && (
                <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-fg-5">{JSON.stringify(rest, null, 1)}</pre>
            )}
        </details>
    );
}
