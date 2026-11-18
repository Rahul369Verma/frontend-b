/**
 * "Which target, on these trades" (27-Oct-2026): the grid with the current target ringed, a
 * target that never fired said in words, a best target resting on one trade flagged, and how
 * close each trade came to its target.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tpLabel, tpWords, bestText, reachSummary } from './targetReplayFormat.js';

const cell = (tp, maxLoss, net, worst, targets) => ({ tp, maxLoss, n: 3, wins: 2, net, worst, avg: Math.round(net / 3), targets });
const RESULT = {
    deploymentId: 'd1', key: 'tp_pct_credit', keyLabel: '% of the credit',
    current: { tp: 40, maxLoss: 0 }, legStop: 1.5, structureStop: 1.6, trades: 3, skipped: [],
    rows: [
        cell(20, 0, 13005, -3155, 1), cell(40, 0, 11553, -4325, 0), cell(0, 0, 11553, -4325, 0),
        cell(10, 0, 8180, -4325, 4), cell(20, 3000, 12000, -3000, 1), cell(40, 3000, 11000, -3000, 0), cell(0, 3000, 11000, -3000, 0), cell(10, 3000, 7000, -3000, 4),
    ],
    perTrade: [
        { id: 't1', entryAt: '2026-10-26T05:30:00Z', booked: 2373, withTarget: 2304, withTargetReason: 'SQUARE_OFF', withTargetExitAt: '2026-10-26T09:40:00Z', firstStop: { kind: 'LEG_SL', at: '2026-10-26T05:15:00Z' }, stopsDid: -1000, noTarget: 2304, noTargetReason: 'SQUARE_OFF', hit: false, targetRupees: 5461, bestGross: 3187, bestInTargetUnit: 23.3, targetEffect: 0, afterTarget: null },
        { id: 't2', entryAt: '2026-10-23T05:30:00Z', booked: 2730, withTarget: 2741, firstStop: null, stopsDid: 0, noTarget: 2741, hit: false, targetRupees: 7683, bestGross: 2835, bestInTargetUnit: 14.8, targetEffect: 0, afterTarget: null },
        { id: 't3', entryAt: '2026-10-22T05:30:00Z', booked: -1943, withTarget: 1141, firstStop: null, stopsDid: 0, noTarget: 1141, hit: false, targetRupees: 7775, bestGross: 1643, bestInTargetUnit: 8.5, targetEffect: 0, afterTarget: null },
    ],
    caveats: ['Each trade keeps its own strikes…'],
};
let calls = 0;
vi.mock('axios', () => {
    const get = vi.fn((url, cfg) => {
        if (/target-grid$/.test(url)) {
            // opening the panel only peeks for a saved replay: none saved here
            if (cfg?.params?.peek) return Promise.resolve({ data: { status: 'none', result: null, saved: null } });
            calls++;
            return Promise.resolve({ data: calls === 1
                ? { status: 'running', done: 10, total: 60, limit: 30 }
                : { status: 'done', done: 60, total: 60, result: RESULT, limit: 30, closedTrades: 3, beyondLimit: 0, quarantinedExcluded: 0 } });
        }
        return Promise.resolve({ data: {} });
    });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import TargetGridPanel from './TargetReplay.jsx';

describe('targetReplayFormat', () => {
    it('names a target in its own unit', () => {
        expect(tpLabel('tp_pct_credit', 20)).toBe('20%');
        expect(tpLabel('tp_x_debit', 1.5)).toBe('1.5×');
        expect(tpLabel('tp_pct_credit', 0)).toBe('off');
        expect(tpWords('tp_pct_credit', 40)).toBe('40% of the credit');
        expect(tpWords('tp_pct_max_profit', 50)).toBe('50% of the max profit');
        expect(tpWords('tp_x_debit', 0)).toBe('no target');
        expect(bestText('tp_x_debit', 0.6)).toBe('0.6× the debit');
    });
    it('how far the trades got: median and highest best point, and how many reached the target', () => {
        expect(reachSummary(RESULT.perTrade)).toEqual({ n: 3, median: 14.8, top: 23.3, topDay: '2026-10-26', hit: 0 });
        expect(reachSummary([{ bestInTargetUnit: 4 }, { bestInTargetUnit: 6 }, { bestInTargetUnit: null }]).median).toBe(5);
        expect(reachSummary([]).median).toBe(null);
    });
});

describe('TargetGridPanel', () => {
    it('needs one deployment', () => {
        render(<TargetGridPanel deploymentId="all" />);
        expect(screen.getByText(/Pick one deployment/)).toBeTruthy();
    });
    it('polls the job, then shows the grid, the current target that never fired, and a best that rests on one trade', async () => {
        render(<TargetGridPanel deploymentId="d1" />);
        fireEvent.click(screen.getByText(/Replay its last 30 trades with other profit targets/));
        await waitFor(() => expect(screen.getByText(/Replaying… 10\/60/)).toBeTruthy());
        await waitFor(() => expect(screen.getByLabelText('Net P&L by profit target and rupee stop')).toBeTruthy(), { timeout: 4000 });
        const head = screen.getByText(/Best net on these trades/).textContent;
        expect(head).toMatch(/target 20% of the credit \+ rupee off → \+₹13,005/);
        expect(head).toMatch(/fired on 1 of 3/);
        expect(head).toMatch(/Current 40% of the credit \+ rupee off → \+₹11,553 \(fired on 0\)/);
        expect(head).toMatch(/No target \(rupee stop as now\) → \+₹11,553/);
        expect(screen.getByText(/The current target never fired on these trades/)).toBeTruthy();
        expect(screen.getByText(/rests on that one trade alone/).textContent).toMatch(/\+₹1,452 over no target/);
        expect(screen.getByTitle(/CURRENT setting/).textContent).toMatch(/₹11,553/);
        expect(screen.getAllByText('never fired').length).toBeGreaterThan(0);
        // how close they came
        const reach = screen.getByText(/How far the trades got/).textContent;
        expect(reach).toMatch(/median 14.8% of the credit/);
        expect(reach).toMatch(/highest 23.3% of the credit \(Mon 26 Oct\)/);
        expect(reach).toMatch(/0 of 3 reached it/);
        // 18-Nov-2026: the per-trade table says which settings the replay used, and that Booked is the real one
        const per = screen.getByRole('table', { name: 'Each trade with and without the current target' });
        const [groups, heads] = within(per).getAllByRole('row');
        expect(groups.textContent).toBe('Replayed with the current settings · leg 1.5× · rupee off · target 40%How far the trade got');
        expect([...heads.cells].map((c) => c.textContent)).toEqual(['Day', 'Booked (real)', 'Net · ended', 'Target off', 'Target did', 'Stops did', 'Best point (before costs)', 'Target at', 'After the target']);
        expect(screen.getByText(/^Booked \(real\) is what happened, with the engine's own fills\. Every other figure is a replay\. From 2 Nov 2026 it runs on the quote tape \(every tick\) and decides stops and the target on the last traded price/)).toBeTruthy();
        expect(screen.getAllByText('not reached')).toHaveLength(3);
        expect(screen.getByText(/· 23.3% of the credit/)).toBeTruthy();
        // 17-Nov-2026: the table also says how each trade ended and what the stops did on it
        expect(screen.getByText('leg stop 10:45 → square-off 15:10')).toBeTruthy();
        expect(screen.getByText('cost ₹1,000')).toBeTruthy();
        expect(screen.getAllByText('no stop fired')).toHaveLength(2);
        expect(screen.getByText(/With the current settings the target never fired/).textContent)
            .toMatch(/the target never fired, so it changed nothing; the stops acted on 1 of 3 trades and cost ₹1,000 in all \(saved on 0, cost on 1\)\./);
    });
});
