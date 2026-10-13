/**
 * Gate history: every day's value, both modes, the ghost list — and nothing hidden
 * (not-followed blocks, open ghosts, trades without a verdict).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DirectionGateHistoryView } from './DirectionGateHistory.jsx';
import { verdictLevel, decidedCount, notFollowedTitle, ghostAiSummary } from './directionGateHistoryFormat.js';

const row = (day, o = {}) => ({
    day, modes: ['shadow'], decisions: { ALLOW: 3, BLOCK: 1 },
    allowed: { n: 3, net: 400, wins: 2 }, probes: { n: 0, net: 0, wins: 0 }, unrecorded: { n: 0, net: 0, wins: 0 },
    wouldBlock: { n: 1, net: -700, wins: 0 }, ghosts: { n: 0, net: 0, wins: 0, open: 0 }, knockOn: { n: 0, net: 0, wins: 0 },
    blockedNotFollowed: 0, notFollowedReasons: {}, actualNet: -300, value: 700, cumulative: 700, ...o,
});
const data = {
    days: 90,
    rows: [
        row('2026-10-05'),
        row('2026-10-06', { modes: ['enforce'], wouldBlock: { n: 0, net: 0, wins: 0 }, ghosts: { n: 1, net: 900, wins: 1, open: 1 }, knockOn: { n: 1, net: 400, wins: 1 },
            blockedNotFollowed: 2, notFollowedReasons: { 'outside the entry window': 2 }, value: -500, cumulative: 200 }),
    ],
    summary: { days: 2, judgedTrades: 2, shadow: { n: 1, net: -700 }, enforce: { ghosts: 1, ghostNet: 900, ghostsOpen: 1, knockOn: 1, knockOnNet: 400, blockedNotFollowed: 2 },
        probes: { n: 0, net: 0 }, unrecorded: { n: 5, net: 120 }, value: 200, daysBetter: 1, daysWorse: 1, verdict: 'only 2 blocked trades so far — too few to judge' },
    ghosts: [
        { ghostId: 'g1', entryTime: '2026-10-06T04:30:00Z', strategyName: 'trend_line', symbol: 'NSE:NIFTY26OCT25000CE', type: 'CE', entryPrice: 100, exitPrice: 114, status: 'CLOSED', exitReason: 'TP Hit', net_pnl: 900, maeRupees: -120, mfeRupees: 950, caveats: ['AI confirmation is on'] },
        { ghostId: 'g2', entryTime: '2026-10-06T08:30:00Z', strategyName: 'inside_bar', symbol: 'NSE:NIFTY26OCT25100PE', type: 'PE', entryPrice: 80, status: 'OPEN',
            inflightReviews: [{ ts: '2026-10-06T08:45:00Z', action: 'HOLD', confidence: 62, applied: true }, { ts: '2026-10-06T09:00:00Z', action: 'UPDATE_SL', confidence: 70, applied: false }],
            exitConsults: [{ ts: '2026-10-06T09:10:00Z', kind: 'TP', outcome: 'HOLD', note: 'TP re-levelled' }] },
    ],
    ghostsTotal: 2,
    open: [{ ghostId: 'g2', lastLtp: 76, unrealized: -260 }],
};

describe('DirectionGateHistoryView', () => {
    it('shows the verdict, the totals for both modes and what was not followed', () => {
        render(<DirectionGateHistoryView data={data} days={90} onDays={() => {}} />);
        const h = screen.getByTestId('gate-history').textContent;
        expect(h).toMatch(/too few to judge/);
        expect(h).toMatch(/1 would-be-blocked trade made/);
        expect(h).toMatch(/1 ghost would have made/);
        expect(h).toMatch(/\+1 still open/);
        expect(h).toMatch(/2 blocked signals not followed/);
        expect(h).toMatch(/5 trades have no verdict/);
        expect(h).toMatch(/better on 1, worse on 1/);
    });
    it('lists every day newest first with the gate value and cumulative', () => {
        render(<DirectionGateHistoryView data={data} days={90} onDays={() => {}} />);
        const t = screen.getByTestId('gate-days');
        expect(t.textContent.indexOf('2026-10-06')).toBeLessThan(t.textContent.indexOf('2026-10-05'));
        expect(t.textContent).toMatch(/enforce/);
    });
    it('lists the ghosts — closed with their would-have net, open with the live mark', () => {
        render(<DirectionGateHistoryView data={data} days={90} onDays={() => {}} />);
        const g = screen.getByTestId('gate-ghosts').textContent;
        expect(g).toMatch(/followed as ghosts \(2\)/);
        expect(g).toMatch(/TP Hit/);
        expect(g).toMatch(/76 \(live\)/);
        expect(g).toMatch(/OPEN/);
        expect(g).toMatch(/3 AI · UPDATE_SL/);
    });
    it('a ghost\'s AI reviews, consults and scale-outs are listed in IST, refusals marked', () => {
        const a = ghostAiSummary(data.ghosts[1]);
        expect(a.title).toMatch(/14:15 review HOLD 62%/);
        expect(a.title).toMatch(/14:30 review UPDATE_SL 70% \(refused\)/);
        expect(a.title).toMatch(/14:40 exit consult \(TP\) → HOLD: TP re-levelled/);
        expect(ghostAiSummary(data.ghosts[0])).toBe(null);
        expect(ghostAiSummary({ partialExits: [{ ts: '2026-10-06T05:00:00Z', lots: 1, exitPrice: 120 }] }).label).toBe('1 AI · scale-out');
    });
    it('range switch reports the chosen window', () => {
        const onDays = vi.fn();
        render(<DirectionGateHistoryView data={data} days={90} onDays={onDays} />);
        fireEvent.click(screen.getByRole('button', { name: '1y' }));
        expect(onDays).toHaveBeenCalledWith(365);
    });
    it('format helpers', () => {
        expect(verdictLevel({ judgedTrades: 3, value: 900 })).toBe('info');
        expect(verdictLevel({ judgedTrades: 12, value: 900 })).toBe('good');
        expect(verdictLevel({ judgedTrades: 12, value: -1 })).toBe('critical');
        expect(decidedCount(data.rows[0])).toBe(4);
        expect(notFollowedTitle(data.rows[1])).toBe('2 × outside the entry window');
    });
});
