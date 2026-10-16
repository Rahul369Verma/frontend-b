import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConsistencyPanel from './ConsistencyPanel.jsx';
import { consistencyVerdict, consistencyText } from './consistencyFormat.js';

// wyckoff_spring on NIFTY Jun-2025 → Feb-2026: Sharpe 1.35, +₹32k — but one month carried it.
const LUMPY = {
    score: 3, bucket: 'month', periods: 9, profitable: 4, losing: 5, idle: 0, profitableRate: 0.444, smoothedRate: 0.4545,
    r2: 0.0661, slopePerDay: 40, worstPeriod: { key: '2025-09', net: -5892 }, bestPeriod: { key: '2026-01', net: 27886 },
    top20Share: 1.19, longestUnderwaterDays: 98,
    buckets: [{ key: '2025-06', net: 3045, trades: 20 }, { key: '2026-01', net: 27886, trades: 30 }, { key: '2025-10', net: 0, trades: 0 }],
};

describe('ConsistencyPanel', () => {
    it('says in words that a decent Sharpe can hide a one-stretch result', () => {
        render(<ConsistencyPanel data={LUMPY} />);
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.getByText(/one stretch/)).toBeTruthy();
        expect(screen.getByText('4 of 9')).toBeTruthy();
        expect(screen.getByText(/more than all of it/)).toBeTruthy();
        expect(screen.getByText(/Sep 25/)).toBeTruthy();
        expect(screen.getByText(/98 trading days/)).toBeTruthy();
    });
    it('verdict bands and text', () => {
        expect(consistencyVerdict(70)).toMatch(/steady/);
        expect(consistencyVerdict(40)).toMatch(/uneven/);
        expect(consistencyVerdict(20)).toMatch(/lumpy/);
        expect(consistencyVerdict(null)).toBe('no trades');
        expect(consistencyText(55.6)).toBe('56');
        expect(consistencyText(undefined)).toBe('—');
    });
    it('no trades → says so', () => {
        render(<ConsistencyPanel data={null} />);
        expect(screen.getByText(/nothing to measure/)).toBeTruthy();
    });
});
