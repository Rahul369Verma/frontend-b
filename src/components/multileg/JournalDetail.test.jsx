/**
 * The facts behind a journal row (9-Nov-2026): every LIVE entry order with the quote it was priced
 * at, the limit, the order id and what became of it — folded under the line, readable at any width.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JournalDetail from './JournalDetail.jsx';
import { failureLines, failedLegRows } from './tradeStoryFormat.js';

const ATTEMPTS = [
    { n: 1, at: '2026-11-09T03:50:02.300Z', quote: { ltp: 108, bid: 108.15, ask: 108.45, src: 'tape', ageMs: 400 }, decided: 108, ref: 108.15, basis: 'bid', limit: 106.53, driftPct: -0.14, orderId: '26110900020297', status: 'UNFILLED', message: 'cancelled unfilled', waitedMs: 3900 },
    { n: 2, at: '2026-11-09T03:50:06.600Z', quote: { ltp: 104, bid: 104.1, ask: 104.4, src: 'rest', ageMs: 0 }, decided: 108, ref: 104.1, basis: 'bid', limit: 102.54, driftPct: 3.61, orderId: '26110900020311', status: 'FILLED', fillPrice: 104.1, fillQty: 130, waitedMs: 600 },
];

describe('JournalDetail', () => {
    it('lists every order attempt: quote, basis, drift, limit, order id, outcome', () => {
        render(<JournalDetail detail={{ attempts: ATTEMPTS }} />);
        const summary = screen.getByText('details — 2 order attempts');
        fireEvent.click(summary);
        const items = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(items[0]).toMatch(/^#1 09:20:02 · tape 0\.4 s old: bid 108\.15 \/ ask 108\.45 \(ltp 108\) · off the bid ₹108\.15 \(-0\.14% vs decided ₹108\) · limit ₹106\.53 · order 26110900020297 · not taken by the market — cancelled after 3\.9 s — cancelled unfilled$/);
        expect(items[1]).toMatch(/^#2 09:20:06 · rest: bid 104\.1 \/ ask 104\.4 \(ltp 104\) · off the bid ₹104\.1 \(\+3\.61% vs decided ₹108\) · limit ₹102\.54 · order 26110900020311 · filled @ ₹104\.1 × 130 after 0\.6 s$/);
    });

    it('a single attempt (an ENTRY_ORDER row) reads the same way; other detail is shown as written', () => {
        const { unmount } = render(<JournalDetail detail={{ ...ATTEMPTS[0], status: null, waitedMs: undefined, message: undefined }} />);
        expect(screen.getByText('details — 1 order attempt')).toBeTruthy();
        expect(screen.getByRole('listitem').textContent).toMatch(/limit ₹106\.53 · order 26110900020297 · awaiting the broker$/);
        unmount();
        render(<JournalDetail detail={{ symbol: 'NSE:NIFTY26N0924900CE', chain: { bid: 124.5, ask: 124.65, ageSec: 60, offPct: 13.31 } }} />);
        expect(screen.getByText('details')).toBeTruthy();
        expect(document.querySelector('pre').textContent).toContain('"ageSec": 60');
    });

    it('renders nothing without detail', () => {
        const { container } = render(<JournalDetail detail={null} />);
        expect(container.innerHTML).toBe('');
    });
});

describe('trade story: a failed entry names every order sent for the leg', () => {
    const trade = {
        entryFailure: {
            kind: 'moved', message: 'the bid ₹95 is 12.04% worse than the decided ₹108', leg: { action: 'SELL', type: 'CE', strike: 24900, symbol: 'NSE:NIFTY26N0924900CE' },
            attempts: [{ n: 1, status: 'UNFILLED', limit: 106.53 }, { n: 2, status: 'NOT_SENT', limit: 93.58 }], notSent: [],
        },
        legs: [], closedLegs: [],
    };
    it('in sentences', () => {
        expect(failureLines(trade)).toEqual([
            'The entry could not complete: SELL 24900 CE was not sent — the market had moved too far — “the bid ₹95 is 12.04% worse than the decided ₹108”.',
            'Orders sent for it: #1 limit ₹106.53 not taken by the market; #2 not sent.',
        ]);
    });
    it('in the legs table', () => {
        expect(failedLegRows(trade)[0].note).toBe('not sent: the bid ₹95 is 12.04% worse than the decided ₹108');
    });
});
