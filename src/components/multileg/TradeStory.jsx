/**
 * TradeStory — why a round trip ended the way it did, and what happened while it was open (user,
 * 27-Oct-2026: the LIVE straddle's round trip read "UNWIND −₹160" with no reason; its PE had been
 * rejected for margin). From the trade's `entryFailure` (recorded by the engine) or, for trades
 * booked before that, its journal (GET /api/multileg/trades/details → `journal`, `entryFailure`).
 */
import React from 'react';
import { failureLines, TONE_CLASS } from './tradeStoryFormat.js';

export default function TradeStory({ trade, istTime }) {
    const lines = failureLines(trade);
    const journal = (trade && trade.journal) || [];
    if (!lines.length && !journal.length) return null;
    return (
        <div className="mb-2 space-y-1.5 text-3xs" data-testid="trade-story">
            {lines.length > 0 && (
                <div className="rounded border border-red-800/50 bg-red-950/20 px-2 py-1 text-fg-3 space-y-0.5">
                    <div className="font-semibold text-danger">Why it was unwound</div>
                    {lines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
            )}
            {journal.length > 0 && (
                <details>
                    <summary className="cursor-pointer text-fg-4">What happened while it was open ({journal.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                        {journal.map((j, i) => (
                            <li key={i} className="font-mono">
                                <span className="text-fg-5">{istTime ? istTime(j.at) : j.at}</span>{' '}
                                <span className={TONE_CLASS[j.tone] || 'text-fg-4'}>{j.label}</span>
                                <span className="text-fg-4">: {j.text}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}
