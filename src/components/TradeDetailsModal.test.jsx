/**
 * The Details view must show BOTH sides' confidence, say how far the traded side was
 * from the floor, and never pass a reconstruction off as a recorded verdict.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TradeDetailsView } from './TradeDetailsModal.jsx';
import { marginText, verdictVsOutcome, flatten } from './tradeDetailsUtil.js';

const trade = {
    _id: '6ac4b0b38731f455ccf030d3', symbol: 'NSE:BANKNIFTY26OCT55100CE', type: 'CE', strategyName: 'breakout_range', isPaper: true,
    status: 'CLOSED', entryTime: '2026-10-07T04:47:05Z', exitTime: '2026-10-07T04:49:40Z', quantity: 30, entryPrice: 907.4, exitPrice: 975.2,
    pnl: 2034, net_pnl: 1933.15, charges: { total: 100.85 }, reason: 'AI_PROTECT_HIT (tick)', slPoints: 30, tpPoints: 70,
    entry_risk: { strike: 55100, iv: 0.16, greeks: { delta: 0.48, theta: -13, vega: 57 } },
};
const recordedGate = {
    side: 'CE', source: 'recorded', mode: 'shadow', decision: 'BLOCK', label: 'WOULD REJECT (shadow — trade still taken)',
    confidence: 0.3068, floor: 0.4, marginPts: -9.3, reason: 'weak side (31% < 40%) — next probe in 2 signals',
    sides: { CE: { confidence: 0.3068, n: 39, nEff: 15.2, winRate: 0.4, meanR: -0.2 }, PE: { confidence: 0.7918, n: 72, nEff: 17.7, winRate: 0.51, meanR: 0.32 } },
    settings: { floor: 0.4, probeEvery: 3, halfLifeSessions: 3, minNeff: 3 }, credit: 0.33, decidedAt: '2026-10-07T04:47:05Z',
};

describe('TradeDetailsView', () => {
    it('shows the verdict, both sides, and the margin to the floor', () => {
        render(<TradeDetailsView data={{ trade, position: { entryPrice: 907.4, lots: 1 }, aiLogs: [], gate: recordedGate }} />);
        const g = screen.getByTestId('gate-section');
        expect(within(g).getByText(/WOULD REJECT/)).toBeTruthy();
        expect(within(g).getByText('recorded')).toBeTruthy();
        expect(g.textContent).toMatch(/9\.3 pts below the 40% floor/);
        expect(within(screen.getByTestId('gate-side-CE')).getByText(/31%/)).toBeTruthy();
        expect(within(screen.getByTestId('gate-side-PE')).getByText(/79%/)).toBeTruthy();
        // weak-side trade that WON must say blocking would have cost money
        expect(g.textContent).toMatch(/blocking it would have cost money/);
    });
    it('labels a reconstruction as such', () => {
        const gate = { ...recordedGate, source: 'reconstructed', mode: null, decision: 'BLOCK_OR_PROBE', label: 'WEAK SIDE at entry — would be rejected or probed (reconstructed)', credit: null, decidedAt: null };
        render(<TradeDetailsView data={{ trade, position: null, aiLogs: [], gate }} />);
        expect(within(screen.getByTestId('gate-section')).getByText('reconstructed')).toBeTruthy();
    });
    it('lists every stored field', () => {
        render(<TradeDetailsView data={{ trade, position: null, aiLogs: [], gate: recordedGate }} />);
        expect(screen.getByTestId('all-fields').textContent).toMatch(/entry_risk\.greeks\.delta/);
    });
});

describe('tradeDetailsUtil', () => {
    it('margin wording', () => {
        expect(marginText({ marginPts: 39.2, floor: 0.4 })).toBe('39.2 pts above the 40% floor');
        expect(marginText({ marginPts: 0, floor: 0.4 })).toBe('exactly at the 40% floor');
        expect(marginText(null)).toBe(null);
    });
    it('outcome vs verdict only for closed trades', () => {
        expect(verdictVsOutcome({ decision: 'ALLOW' }, { status: 'OPEN', net_pnl: 5 })).toBe(null);
        expect(verdictVsOutcome({ decision: 'BLOCK' }, { status: 'CLOSED', net_pnl: -409 })).toMatch(/read it right/);
        expect(verdictVsOutcome({ decision: 'ALLOW' }, { status: 'CLOSED', net_pnl: null, pnl: -10 })).toMatch(/did not see/);
    });
    it('flatten keeps nulls visible and nests keys', () => {
        const rows = flatten({ a: { b: 1.234567, c: null }, d: [] });
        expect(rows).toEqual([{ key: 'a.b', value: '1.2346' }, { key: 'a.c', value: 'null' }, { key: 'd', value: '[]' }]);
    });
});
