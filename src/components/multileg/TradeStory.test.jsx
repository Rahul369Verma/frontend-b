/**
 * Why a round trip was unwound, what happened while it was open, and a deployment's day on its
 * card (27-Oct-2026: the LIVE straddle's PE was rejected for margin, its CE bought back for −₹160,
 * and neither the card nor Results said so).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TradeStory from './TradeStory.jsx';
import TodayStory from './TodayStory.jsx';
import { failureLines, failedLegRows } from './tradeStoryFormat.js';

const UNWIND = {
    exitReason: 'UNWIND', netPnl: -160.06, grossPnl: -100.75, charges: 59.31,
    legs: [{ symbol: 'NSE:NIFTY26OCT22650CE', action: 'SELL', type: 'CE', strike: 22650, entryPrice: 99.9, exitPrice: 101.45, closeReason: 'UNWIND' }],
    closedLegs: [],
    entryFailure: {
        kind: 'rejected', at: '2026-10-27T03:50:10Z', message: 'RED:Margin Shortfall:INR 42,626.67 Available:INR 4,81,346.91',
        leg: { symbol: 'NSE:NIFTY26OCT22650PE', action: 'SELL', type: 'PE', strike: 22650, qty: 65 }, notSent: [],
    },
    journal: [
        { at: '2026-10-27T03:50:10Z', type: 'ENTRY_FAILED', label: 'entry failed', tone: 'bad', text: 'SELL NSE:NIFTY26OCT22650PE rejected: RED:Margin Shortfall:INR 42,626.67' },
        { at: '2026-10-27T03:50:11Z', type: 'UNWIND', label: 'unwound (the entry could not complete)', tone: 'bad', text: 'UNWIND — net ₹-160.06 (gross ₹-100.75, charges ₹59.31)' },
    ],
};

describe('tradeStoryFormat', () => {
    it('an unwind in sentences: the failed leg and the broker\'s words, what was bought back, what it cost', () => {
        const l = failureLines(UNWIND);
        expect(l[0]).toBe('The entry could not complete: SELL 22650 PE was rejected by the broker — “RED:Margin Shortfall:INR 42,626.67 Available:INR 4,81,346.91”.');
        expect(l[1]).toBe('So the leg already filled was closed at once (unwind): SELL 22650 CE sold at ₹99.9, bought back at ₹101.45. That is -₹101 before charges and ₹59 of charges: -₹160 booked.');
        expect(failureLines({ ...UNWIND, entryFailure: { ...UNWIND.entryFailure, source: 'journal', notSent: [{ action: 'BUY', type: 'PE', strike: 22450 }] } }).slice(-2))
            .toEqual(['Never sent: BUY 22450 PE.', '(Read from the engine journal: this trade was booked before the engine stored the reason with it.)']);
        expect(failureLines({ exitReason: 'SQUARE_OFF' })).toEqual([]);
    });
    it('the legs table gets the failed leg and those never sent', () => {
        expect(failedLegRows({ entryFailure: { ...UNWIND.entryFailure, notSent: [{ action: 'BUY', type: 'CE', strike: 22850 }] } }).map((r) => r.note))
            .toEqual(['rejected: RED:Margin Shortfall:INR 42,626.67 Available:INR 4,81,346.91', 'never sent (the entry stopped before it)']);
        expect(failedLegRows({})).toEqual([]);
    });
});

describe('TradeStory', () => {
    it('says why it was unwound, and lists what happened while it was open', () => {
        render(<TradeStory trade={UNWIND} istTime={(v) => v.slice(11, 16)} />);
        const t = screen.getByTestId('trade-story').textContent;
        expect(t).toMatch(/Why it was unwound/);
        expect(t).toMatch(/SELL 22650 PE was rejected by the broker/);
        expect(t).toMatch(/What happened while it was open \(2\)/);
        expect(t).toMatch(/03:50 entry failed: SELL NSE:NIFTY26OCT22650PE rejected/);
    });
    it('a plain trade with no journal shows nothing extra', () => {
        const { container } = render(<TradeStory trade={{ exitReason: 'SQUARE_OFF' }} />);
        expect(container.textContent).toBe('');
    });
});

describe('TodayStory', () => {
    const STORY = {
        headline: { tone: 'bad', text: 'entry failed — SELL NIFTY26OCT22650PE rejected by the broker: RED:Margin Shortfall; SELL NIFTY26OCT22650CE already filled was bought back (unwind). One structure a day: no further entry today.' },
        lines: [
            { at: '2026-10-27T03:50:10Z', lastAt: '2026-10-27T03:50:10Z', count: 1, type: 'ENTRY_FAILED', label: 'entry failed', tone: 'bad', text: 'SELL NSE:NIFTY26OCT22650PE rejected: RED:Margin Shortfall' },
            { at: '2026-10-27T05:00:00Z', lastAt: '2026-10-27T05:30:00Z', count: 42, type: 'ENTRY_SKIPPED', label: 'entry refused', tone: 'warn', text: 'book too wide' },
        ],
        hidden: 3,
    };
    it('the headline on the card; every line of the day on demand, repeats counted, what is left out said', () => {
        render(<TodayStory story={STORY} istTime={(v) => v.slice(11, 16)} />);
        const box = screen.getByTestId('today-story');
        expect(box.textContent).toMatch(/Today:entry failed — SELL NIFTY26OCT22650PE rejected by the broker/);
        expect(box.textContent).not.toMatch(/entry refused/);
        fireEvent.click(screen.getByRole('button', { name: 'all today (5)' }));
        expect(box.textContent).toMatch(/… 3 earlier line\(s\) not shown/);
        expect(box.textContent).toMatch(/05:00–05:30 entry refused ×42: book too wide/);
    });
    it('nothing to say: renders nothing', () => {
        const { container } = render(<TodayStory story={{ headline: null, lines: [] }} />);
        expect(container.textContent).toBe('');
    });
});
