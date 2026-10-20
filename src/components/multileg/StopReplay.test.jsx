/**
 * "Would this trade have come back without its stops?" — the per-trade replay button and
 * the deployment's stop grid. The numbers come from the server (stopWhatIf.js); these
 * tests pin what the page SAYS about them: saved vs cost, touched profit vs finished
 * better, the current setting marked, and nothing excluded silently.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const at = (hh, mm) => new Date(Date.UTC(2026, 9, 12, hh, mm) - 5.5 * 3600e3).toISOString();

const REPORT = {
    tradeId: 't1',
    booked: { net: -1500, reason: 'SQUARE_OFF' },
    configured: { net: -1720, reason: 'SQUARE_OFF', legStops: [{ leg: '23000CE', at: at(9, 36), price: 140 }], path: [{ t: at(9, 21), net: -40 }, { t: at(9, 36), net: -2700 }] },
    noStops: { net: 4380, reason: 'TP_STRUCT', legStops: [], path: [{ t: at(9, 21), net: -40 }, { t: at(11, 0), net: 4380 }] },
    recovery: { firstStopAt: at(9, 36), stopKind: 'LEG_SL', bestAfterStop: 4380, wentPositiveAfterStop: true, endedPositive: true },
    stopped: true, stopEffect: -6100, verdict: 'the stops cost ₹6100 (held without them: ₹4380)',
    stops: { leg_sl_x: 1.4, sl_x_credit: 1.5, sl_pct_debit: 0, max_loss_rupees: 3000 },
    paramsSource: 'trade (as opened)',
    archive: { idx: 'NIFTY50', days: ['2026-10-12'], snapshots: 338, fullChainMinutes: 0, note: null },
    caveats: ['Replayed on the recorded option chain.'],
};

const row = (legSlX, maxLoss, net, worst) => ({ legSlX, maxLoss, n: 3, net, wins: 2, worst, avg: Math.round(net / 3) });
const GRID = {
    deploymentId: 'd1', name: 'straddle', current: { legSlX: 1.4, maxLoss: 3000 }, currentInGrid: true, structureStop: 1.5,
    trades: 3, skipped: [{ id: 'x', why: 'no archived quotes' }],
    rows: [row(1.3, 2000, 9000, -2200), row(1.4, 3000, 7000, -3500), row(1.3, 3000, 6500, -3600), row(1.4, 2000, 6000, -2100)],
    noStops: { n: 3, net: -5000, wins: 1, worst: -7800, avg: -1667 },
    perTrade: [
        { id: 'a', entryAt: at(9, 20), booked: 3294, withStops: 3186, noStops: -7803, stopped: true, stopEffect: 10989, recovery: { firstStopAt: at(9, 24), stopKind: 'LEG_SL', bestAfterStop: -377, wentPositiveAfterStop: false } },
        { id: 'b', entryAt: at(9, 20), booked: -3569, withStops: -3566, noStops: 2839, stopped: true, stopEffect: -6405, recovery: { firstStopAt: at(9, 29), stopKind: 'LEG_SL', bestAfterStop: 2839, wentPositiveAfterStop: true } },
        { id: 'c', entryAt: at(9, 20), booked: 2360, withStops: 1891, noStops: -6091, stopped: true, stopEffect: 7982, recovery: { firstStopAt: at(9, 39), stopKind: 'LEG_SL', bestAfterStop: 2773, wentPositiveAfterStop: true } },
    ],
    caveats: ['Small samples.'],
};

let gridCalls = 0;
vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/stop-whatif$/.test(url)) return Promise.resolve({ data: REPORT });
        if (/stop-grid$/.test(url)) {
            gridCalls++;
            return Promise.resolve({ data: gridCalls === 1
                ? { status: 'running', done: 40, total: 93, limit: 30, closedTrades: 4, beyondLimit: 0, quarantinedExcluded: 1 }
                : { status: 'done', done: 93, total: 93, result: GRID, limit: 30, closedTrades: 34, beyondLimit: 4, quarantinedExcluded: 1 } });
        }
        return Promise.resolve({ data: {} });
    });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import axios from 'axios';
import { TradeStopReplay, StopGridPanel } from './StopReplay.jsx';
import { reasonText, stopsText, recoveryText } from './stopReplayFormat.js';

const trade = {
    _id: 't1', symbol: 'NSE:NIFTY50-INDEX', entryAt: at(9, 20), exitAt: at(15, 10), netPnl: -1500, maeRupees: -2900, mfeRupees: 300,
    path: [{ t: at(9, 21), net: -40, gross: 0, spot: 23000 }, { t: at(9, 36), net: -2700, gross: -2600, spot: 23100 }, { t: at(15, 9), net: -1480, gross: -1400, spot: 23050 }],
};

describe('stop replay wording', () => {
    it('names every exit reason of the shared rules in words', () => {
        expect(reasonText('LEG_SL_FLATTEN')).toBe('every short leg stopped');
        expect(reasonText('TP_STRUCT')).toBe('profit target');
        expect(reasonText('MAX_LOSS')).toBe('rupee stop');
        expect(reasonText('SOMETHING_NEW')).toBe('something new');
        expect(reasonText(null)).toBe('—');
    });
    it('says which stops were replayed, 0 meaning off', () => {
        expect(stopsText(REPORT.stops)).toBe('leg stop 1.4× entry · structure stop 1.5× credit · rupee stop ₹3,000');
        expect(stopsText({ leg_sl_x: 0, sl_x_credit: 0, sl_pct_debit: 0, max_loss_rupees: 0 })).toBe('leg stop off · structure stop off · rupee stop off');
    });
    it('answers "did it come back?" — and says so when no stop fired', () => {
        expect(recoveryText(REPORT)).toMatch(/First stop: leg stop at 09:36 IST — held with no stops, it DID come back into profit — best \+₹4,380/);
        expect(recoveryText({ ...REPORT, stopped: false, recovery: null })).toMatch(/No stop fired/);
        expect(recoveryText({ ...REPORT, recovery: { ...REPORT.recovery, bestAfterStop: -377, wentPositiveAfterStop: false } })).toMatch(/never got back above ₹0/);
    });
});

describe('TradeStopReplay', () => {
    beforeEach(() => { axios.get.mockClear(); });
    it('asks only when clicked, then states saved/cost and the recovery', async () => {
        render(<TradeStopReplay trade={trade} />);
        expect(axios.get).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Replay without stops'));
        await waitFor(() => expect(screen.getByText(/The stops COST ₹6,100 on this trade/)).toBeTruthy());
        expect(axios.get.mock.calls[0][0]).toMatch(/\/multileg\/trades\/t1\/stop-whatif$/);
        expect(screen.getByText(/Replay with no stops/)).toBeTruthy();
        expect(screen.getByText(/it DID come back into profit/)).toBeTruthy();
        expect(screen.getByText(/Stops replayed: leg stop 1.4× entry/)).toBeTruthy();
        expect(screen.queryByText('Replay without stops')).toBeNull();
    });
    it('says plainly when the archive cannot replay the trade', async () => {
        axios.get.mockImplementationOnce(() => Promise.resolve({ data: { ...REPORT, configured: { net: null }, noStops: { net: null }, archive: { note: 'no archived quotes for the trade\'s days' } } }));
        render(<TradeStopReplay trade={trade} />);
        fireEvent.click(screen.getByText('Replay without stops'));
        await waitFor(() => expect(screen.getByText(/Not enough recorded quotes to replay this trade \(no archived quotes/)).toBeTruthy());
    });
});

describe('StopGridPanel', () => {
    beforeEach(() => { gridCalls = 0; });
    it('needs one deployment', () => {
        render(<StopGridPanel deploymentId="all" />);
        expect(screen.getByText(/Pick one deployment/)).toBeTruthy();
    });
    it('polls the job, then shows the grid with the current setting marked and every exclusion counted', async () => {
        render(<StopGridPanel deploymentId="d1" />);
        fireEvent.click(screen.getByText(/Replay its last 30 trades/));
        await waitFor(() => expect(screen.getByText(/Replaying… 40\/93/)).toBeTruthy());
        await waitFor(() => expect(screen.getByLabelText('Net P&L by leg stop and rupee stop')).toBeTruthy(), { timeout: 4000 });
        // best and current, in words
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/leg 1.3× \+ rupee ₹2,000/);
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/Current leg 1.4× \+ rupee ₹3,000/);
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/No stops at all → -₹5,000/);
        // the current cell carries the ring and says so on hover
        const cur = screen.getByTitle(/CURRENT setting/);
        expect(cur.className).toMatch(/ring-1/);
        // visible omissions: older trades, void fills, unreplayable trades
        const head = screen.getByText(/trade\(s\) replayed/).textContent;
        expect(head).toMatch(/4 older trade\(s\) not included \(limit 30\)/);
        expect(head).toMatch(/1 void fill\(s\) excluded/);
        expect(head).toMatch(/1 could not be replayed \(no archived quotes\)/);
        // touched profit is not finished better
        const sum = screen.getByText(/were stopped/).textContent;
        expect(sum).toMatch(/3 of 3 trades were stopped/);
        expect(sum).toMatch(/2 of those touched profit again/);
        expect(sum).toMatch(/only 1 finished better without stops/);
        expect(screen.getByText(/came back to \+₹2,839/)).toBeTruthy();
    });
});
