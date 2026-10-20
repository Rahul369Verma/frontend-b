/**
 * Latest gate decisions: what became of EVERY verdict — an Allowed or Probe signal
 * joined to the trade it became, one that did not trade says why.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GateDecisionsView } from './GateDecisions.jsx';

const DATA = {
    total: 12,
    counts: { traded: 2, skipped: 1, blocked: 1, unknown: 0 },
    rows: [
        { decisionId: 'p', at: '2026-10-19T09:25:21Z', decision: 'PROBE', side: 'PE', confidence: 0.329, strategy: 'hybrid_inside_bar', symbol: 'NSE:MIDCPNIFTY-INDEX', then: { kind: 'skipped', text: 'Not traded — outside the entry window (at/after last_entry_time 14:00)', inferred: true } },
        { decisionId: 'b', at: '2026-10-19T09:25:20Z', decision: 'BLOCK', enforced: true, side: 'PE', confidence: 0.329, strategy: 'inside_bar', symbol: 'NSE:MIDCPNIFTY-INDEX', then: { kind: 'blocked', text: 'Blocked — would have made −₹1,941 (SL Hit)', net: -1941 } },
        { decisionId: 'pr', at: '2026-10-19T07:55:10Z', decision: 'PROBE', side: 'PE', confidence: 0.329, strategy: 'breakout_range', symbol: 'NSE:FINNIFTY-INDEX', then: { kind: 'traded', text: 'Traded — made −₹1,798 (SL Hit)', net: -1798.21, tradeId: 'x' } },
        { decisionId: 'a', at: '2026-10-19T04:01:14Z', decision: 'ALLOW', side: 'PE', confidence: 0.508, strategy: 'inside_bar', symbol: 'NSE:MIDCPNIFTY-INDEX', then: { kind: 'traded', text: 'Traded — made −₹5,118 (SL Hit (tick))', net: -5117.66, tradeId: 'y' } },
    ],
};

describe('GateDecisionsView', () => {
    it('says how many verdicts became trades and why an Enforce-mode trade can still happen', () => {
        render(<GateDecisionsView data={DATA} />);
        expect(screen.getByTestId('gate-decision-counts').textContent).toMatch(/2 became trades .* In Enforce mode a trade still happens when its side is at or above the floor, or as a Probe/);
    });

    it('every row says what became of it — traded, blocked, or why it did not trade', () => {
        render(<GateDecisionsView data={DATA} />);
        expect(screen.getByText('Traded — made −₹1,798 (SL Hit)').className).toMatch(/text-danger/);
        expect(screen.getByText('Traded — made −₹5,118 (SL Hit (tick))')).toBeTruthy();
        const inferred = screen.getByText(/Not traded — outside the entry window/);
        expect(inferred.textContent).toMatch(/\*$/);
        expect(inferred.getAttribute('title')).toMatch(/Worked out from the decision time/);
    });
});
