/**
 * The India VIX breakdown must never imply coverage it does not have: an empty
 * band shows a dash, not a zero that reads as "made nothing"; trades that could
 * not be placed in a band are counted on screen; and a thin sample says so.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VixBreakdownPanel from './VixBreakdownPanel.jsx';

const data = {
    source: { daily: 'archive', intraday: 'not requested' },
    simIv: { model: 'fixed', vix: 0, fallback: 0, fixed: 7 },
    sessions: { total: 60, unmeasured: 1, byBand: { '<11': 20, '11-13': 25, '13-15': 10, '15-18': 4, '>=18': 0 },
        detail: {
            '<11': { sessions: 20, firstDay: '2025-09-01', lastDay: '2026-01-20', episodes: 2 },
            '11-13': { sessions: 25, firstDay: '2026-03-02', lastDay: '2026-05-29', episodes: 1 },
            '13-15': { sessions: 10, firstDay: '2026-06-01', lastDay: '2026-06-30', episodes: 1 },
            '15-18': { sessions: 4, firstDay: '2026-07-01', lastDay: '2026-07-06', episodes: 1 },
            '>=18': { sessions: 0, firstDay: null, lastDay: null, episodes: 0 },
        } },
    gate: { evaluated: 12, blocked: 5, byCode: { BELOW_MIN: 5, IN_BAND: 6, UNMEASURED: 1 }, fellBack: 0 },
    breakdown: {
        field: 'vix_prev_close',
        bands: [
            { band: '<11', trades: 4, winRatePct: 75, netPnl: 5200, avgPnlPerTrade: 1300, days: 3, avgPnlPerDay: 1733.33 },
            { band: '11-13', trades: 3, winRatePct: 33.3, netPnl: -900, avgPnlPerTrade: -300, days: 3, avgPnlPerDay: -300 },
            { band: '13-15', trades: 0, winRatePct: null, netPnl: 0, avgPnlPerTrade: null, days: 0, avgPnlPerDay: null },
            { band: '15-18', trades: 0, winRatePct: null, netPnl: 0, avgPnlPerTrade: null, days: 0, avgPnlPerDay: null },
            { band: '>=18', trades: 0, winRatePct: null, netPnl: 0, avgPnlPerTrade: null, days: 0, avgPnlPerDay: null },
        ],
        excluded: { noVix: 2, noPnl: 0, noVixPnl: 640 },
        caution: 'only 7 trades carry a VIX value — too few to rank bands',
    },
};

describe('VixBreakdownPanel', () => {
    it('renders every fixed band, including the ones with no trades', () => {
        render(<VixBreakdownPanel data={data} />);
        for (const b of ['<11', '11-13', '13-15', '15-18', '>=18']) expect(screen.getByText(b)).toBeTruthy();
        // An untraded band is a dash, never a ₹0 that reads as "earned nothing".
        const row = screen.getByText('13-15').closest('tr');
        expect(row.textContent).not.toMatch(/₹0/);
        expect(row.textContent).toContain('—');
        // ...but its SESSION count is still shown: the band occurred, it was just not traded.
        expect(row.textContent).toContain('10');
    });

    it('surfaces what the filter did and what it could not measure', () => {
        render(<VixBreakdownPanel data={data} />);
        expect(screen.getByText('Signals checked')).toBeTruthy();
        expect(screen.getByText('Blocked')).toBeTruthy();
        expect(screen.getByText('Unmeasured')).toBeTruthy();
        expect(screen.getByText(/2 trades with no VIX value/)).toBeTruthy();
        expect(screen.getByText(/too few to rank bands/)).toBeTruthy();
        expect(screen.getByText(/VIX source: local archive/)).toBeTruthy();
    });

    it('omits the filter tiles when the filter was off, and renders nothing without data', () => {
        const { container, rerender } = render(<VixBreakdownPanel data={{ ...data, gate: { evaluated: 0, blocked: 0, byCode: {}, fellBack: 0 } }} />);
        expect(screen.queryByText('Signals checked')).toBeNull();
        expect(container.querySelector('table')).toBeTruthy();
        rerender(<VixBreakdownPanel data={null} />);
        expect(container.innerHTML).toBe('');
    });

    it('says which IV priced the premiums, and warns when a flat IV biases the bands', () => {
        render(<VixBreakdownPanel data={data} />);
        expect(screen.getByText(/premiums priced at: fixed 15% IV/)).toBeTruthy();
        expect(screen.getByText(/flatters option buyers/)).toBeTruthy();
        const { container } = render(<VixBreakdownPanel data={{ ...data, simIv: { model: 'vix', vix: 7, fallback: 0, fixed: 0 } }} />);
        expect(container.textContent).toContain('India VIX at entry');
        expect(container.textContent).not.toMatch(/flatters option buyers/);
    });

    it('shows when each band happened and flags a band seen in only one episode', () => {
        render(<VixBreakdownPanel data={data} />);
        expect(screen.getByText(/Sep 2025 – Jan 2026 · 2 episodes/)).toBeTruthy();
        // 11-13 was traded AND seen in one stretch only -> called out
        expect(screen.getByText(/11-13 occurred in a single stretch of time/)).toBeTruthy();
    });

    it('states whether the band differences beat chance', () => {
        const { container, rerender } = render(<VixBreakdownPanel data={{ ...data, nullTest: { pRotation: 0.53, pShuffle: 0.48, units: 1008, verdict: 'no group is distinguishable from chance' } }} />);
        expect(container.textContent).toMatch(/not distinguishable from chance/);
        expect(container.textContent).toMatch(/p = 0\.53/);
        rerender(<VixBreakdownPanel data={{ ...data, nullTest: { pRotation: 0.004, pShuffle: 0.001, units: 1008, verdict: 'x' } }} />);
        expect(container.textContent).toMatch(/larger than chance \(p = 0\.004\)/);
        expect(container.textContent).toMatch(/Confirm on a later period/);
        rerender(<VixBreakdownPanel data={{ ...data, nullTest: { pRotation: null, pShuffle: null, verdict: 'too few units in at least two groups to test' } }} />);
        expect(container.textContent).toMatch(/Significance: too few units/);
    });
});
