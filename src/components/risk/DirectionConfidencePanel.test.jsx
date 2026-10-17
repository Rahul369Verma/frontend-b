/**
 * The direction card must never overstate what it knows: a thin side says THIN DATA,
 * a weak side shows its probe cadence, and the scorecard phrases savings vs cost by
 * the sign of the would-be-blocked trades' real P&L.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { DirectionConfidenceView } from './DirectionConfidencePanel.jsx';
import { gateVerdict, sideMeaning } from './directionState.js';
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
        expect(screen.queryByTestId('scorecard')).toBeNull();   // simple first: the maths is behind a button
        fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
        const sc = screen.getByTestId('scorecard');
        expect(within(sc).getByText('blocking would have helped')).toBeTruthy();
        expect(sc.textContent).toMatch(/would have saved/);
        expect(sc.textContent).toMatch(/3 trades have no recorded verdict/);
    });
    it('says "cost" when the would-be-blocked trades made money', () => {
        const d = { ...base, scorecard: { ...base.scorecard, wouldBlock: { n: 12, net: 5000, wins: 9, savedIfEnforced: -5000 }, verdict: 'blocking would have cost money' } };
        render(<DirectionConfidenceView data={d} onMode={() => {}} />);
        expect(screen.getByTestId('gate-verdict').textContent).toMatch(/would have cost ₹5,000/);
        fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
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
    it('enforce: scores the ghosts and knock-ons, and the ghost switch reports its new state', () => {
        const onTrackBlocked = vi.fn();
        const d = { ...base, mode: 'enforce', opts: { ...base.opts, trackBlocked: true },
            scorecard: { ...base.scorecard, enforce: { ghosts: 4, ghostNet: 2100, ghostsOpen: 1, knockOn: 2, knockOnNet: 300, blockedNotFollowed: 1 }, value: -1800, judged: 16, verdict: 'the gate has cost ₹1800 over 16 blocked trades' } };
        render(<DirectionConfidenceView data={d} onMode={() => {}} onTrackBlocked={onTrackBlocked} />);
        expect(screen.getByTestId('gate-verdict').textContent).toMatch(/behind by ₹1,800/);
        fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
        const en = screen.getByTestId('scorecard-enforce').textContent;
        expect(en).toMatch(/4 blocked trades followed as ghosts would have made/);
        expect(en).toMatch(/\+1 still open/);
        expect(en).toMatch(/2 knock-on trades/);
        fireEvent.click(screen.getByLabelText('Follow blocked trades as ghosts'));
        expect(onTrackBlocked).toHaveBeenCalledWith(false);
    });
    it('says in words what the gate does to each side', () => {
        const weak = { label: 'WEAK' };
        expect(sideMeaning(weak, { mode: 'enforce', probeEvery: 3, left: 2, floor: 0.4 })).toBe('Below the 40% floor — these signals are blocked; 1 in 3 goes through as a probe (next probe in 2 signals).');
        expect(sideMeaning(weak, { mode: 'shadow', probeEvery: 3, left: null, floor: 0.4 })).toMatch(/Enforce would block these signals; Shadow only records it/);
        expect(sideMeaning({ label: 'NEUTRAL' }, { mode: 'enforce' })).toBe('Trusted enough — trades go ahead.');
        expect(sideMeaning({ label: 'THIN DATA' }, { mode: 'enforce' })).toMatch(/Too few recent trades/);
    });
    it('the verdict line never overstates a small sample', () => {
        const v = gateVerdict({ scorecard: { wouldBlock: { n: 3, net: 2000, savedIfEnforced: -2000 } } });
        expect(v.level).toBe('info');
        expect(v.text).toMatch(/would have cost ₹2,000 — too few blocked trades to judge yet/);
        expect(gateVerdict({ scorecard: {} }).text).toMatch(/No weak-side trades/);
    });
    it('the blocked-trades and decisions slots render in the simple view', () => {
        render(<DirectionConfidenceView data={base} onMode={() => {}} blocked={<div>BLOCKED-LIST</div>} decisions={<div>DECISIONS-LIST</div>} history={<div>HISTORY</div>} />);
        expect(screen.getByText('BLOCKED-LIST')).toBeTruthy();
        expect(screen.getByText('DECISIONS-LIST')).toBeTruthy();
        expect(screen.queryByText('HISTORY')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
        expect(screen.getByText('HISTORY')).toBeTruthy();
    });
});
