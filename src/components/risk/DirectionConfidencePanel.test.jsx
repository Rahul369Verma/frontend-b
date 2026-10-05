/**
 * The direction card must never overstate what it knows: a thin side says THIN DATA,
 * a weak side shows its probe cadence, and the scorecard phrases savings vs cost by
 * the sign of the would-be-blocked trades' real P&L.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { DirectionConfidenceView } from './DirectionConfidencePanel.jsx';
import { sideState } from './directionState.js';

const base = {
    mode: 'shadow',
    opts: { halfLifeSessions: 3, floor: 0.4, probeEvery: 3, minNeff: 3, lookbackSessions: 20, priorTrades: 4 },
    sides: {
        CE: { confidence: 0.12, n: 9, nEff: 6.2, meanR: -0.8, postMeanR: -0.5, winRate: 0.22, netRs: -4200, lastExitMs: 1 },
        PE: { confidence: 0.91, n: 2, nEff: 1.4, meanR: 1.2, postMeanR: 0.3, winRate: 1, netRs: 3100, lastExitMs: 1 },
    },
    excluded: { count: 1, reasons: { 'orphan/manual close (not a strategy outcome)': 1 } },
    history: [{ date: '2026-09-30', CE: 0.3, PE: 0.7, ceN: 5, peN: 1 }, { date: '2026-10-01', CE: 0.12, PE: 0.91, ceN: 9, peN: 2 }],
    scorecard: { decisions: { BLOCK: { n: 12, net: -4800 }, PROBE: { n: 4, net: 900 } }, wouldBlock: { n: 12, net: -4800, wins: 2, savedIfEnforced: 4800 }, unrecorded: { n: 3, net: 100 }, verdict: 'blocking would have helped' },
    live: { stale: false, credit: { CE: 2 / 3, PE: 0 }, recent: [{ at: Date.parse('2026-10-01T08:00:00Z'), side: 'CE', strategy: 'breakout_range', decision: 'BLOCK', enforced: false, reason: 'weak' }] },
};

describe('DirectionConfidenceView', () => {
    it('labels a weak side, a thin side, and the probe cadence', () => {
        render(<DirectionConfidenceView data={base} onMode={() => {}} />);
        const ce = screen.getByTestId('side-CE');
        expect(within(ce).getByText('WEAK')).toBeTruthy();
        expect(within(ce).getByText(/next probe in 1 signal\b/)).toBeTruthy();
        // PE has 91% confidence but only 1.4 effective trades — must NOT read as STRONG
        expect(within(screen.getByTestId('side-PE')).getByText('THIN DATA')).toBeTruthy();
    });
    it('scores blocking from real outcomes and counts unrecorded trades', () => {
        render(<DirectionConfidenceView data={base} onMode={() => {}} />);
        const sc = screen.getByTestId('scorecard');
        expect(within(sc).getByText('blocking would have helped')).toBeTruthy();
        expect(sc.textContent).toMatch(/would have saved/);
        expect(sc.textContent).toMatch(/3 trades have no recorded verdict/);
    });
    it('says "cost" when the would-be-blocked trades made money', () => {
        const d = { ...base, scorecard: { ...base.scorecard, wouldBlock: { n: 12, net: 5000, wins: 9, savedIfEnforced: -5000 }, verdict: 'blocking would have cost money' } };
        render(<DirectionConfidenceView data={d} onMode={() => {}} />);
        expect(screen.getByTestId('scorecard').textContent).toMatch(/would have cost/);
    });
    it('mode switch reports the chosen mode', () => {
        const onMode = vi.fn();
        render(<DirectionConfidenceView data={base} onMode={onMode} />);
        fireEvent.click(screen.getByRole('button', { name: 'Enforce' }));
        expect(onMode).toHaveBeenCalledWith('enforce');
    });
    it('sideState thresholds', () => {
        expect(sideState(null).label).toBe('NO DATA');
        expect(sideState({ confidence: 0.7, nEff: 9 }, base.opts).label).toBe('STRONG');
        expect(sideState({ confidence: 0.5, nEff: 9 }, base.opts).label).toBe('NEUTRAL');
    });
});
