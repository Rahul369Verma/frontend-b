/**
 * Saved what-if replays (user, 18-Nov-2026: "save the replay so it will not calculate again and again;
 * it will show the history and we can recalculate it anytime, which replaces the saved one").
 *   • opening a grid or a round trip shows its SAVED replay at once and computes nothing;
 *   • it says when it was calculated, and what changed since (newer trades, edited settings, an older method);
 *   • Recalculate runs it again (?recalc=1) and the saved one stays on screen until the new one is done.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { durationText, savedLine, savedWarnings, pricesLine } from './savedReplayFormat.js';

const row = (legSlX, maxLoss, tp, net, worst) => ({ legSlX, maxLoss, tp, n: 2, wins: 1, net, worst, avg: Math.round(net / 2), targets: 0, stopped: 1 });
const CUR = row(1.5, 0, 40, 26070, -1798);
const BEST = row(1.3, 5000, 75, 34613, -3508);
const side = (net, reason) => ({ net, reason, exitAt: '2026-11-17T04:48:10Z', firstStop: null, targetHit: false, noStops: net, noTarget: net, stopsDid: 0, targetDid: 0 });
const RESULT = (net) => ({
    deploymentId: 'd1', key: 'tp_pct_credit', keyLabel: '% of the credit', current: { legSlX: 1.5, maxLoss: 0, tp: 40 }, structureStop: 1.6,
    trades: 2, skipped: [], prices: { tape: 1, minutes: 1, tapeFrom: '2026-11-02' },
    rows: [BEST, { ...CUR, net }], neither: row(0, 0, 0, -29184, -19989),
    picks: { best: BEST, current: { ...CUR, net }, noRiskier: null, safest: BEST },
    holdout: { ok: false, reason: 'too few trades' },
    effects: { current: { n: 2, net, stopsActed: 1, stopsDid: 0, stopsSaved: 0, stopsCost: 0, targetFired: 0, targetDid: 0, targetAdded: 0, targetCost: 0, vsNeither: 0 },
        best: { n: 2, net: 34613, stopsActed: 1, stopsDid: 0, stopsSaved: 0, stopsCost: 0, targetFired: 0, targetDid: 0, targetAdded: 0, targetCost: 0, vsNeither: 0 } },
    perTrade: [{ id: 't17', entryAt: '2026-11-17T03:50:00Z', prices: 'tape', booked: -1964, neither: 2396, bestVsCurrent: 0, current: side(-1798, 'LEG_SL_FLATTEN'), best: side(-1798, 'LEG_SL_FLATTEN') }],
    caveats: [],
});
const SAVED = { computedAt: '2026-11-18T00:51:40Z', durationMs: 59980, version: 2, outdated: false, trades: 30, newTrades: 2, settingsChanged: true, limitChanged: false };
const AT = (hh, mm) => new Date(Date.UTC(2026, 10, 17, hh, mm) - 5.5 * 3600e3).toISOString();
const REPORT = (net) => ({
    tradeId: 'T17', booked: { net: -1964, reason: 'LEG_SL_FLATTEN' },
    configured: { net, reason: 'LEG_SL_FLATTEN', exitAt: AT(10, 18), legStops: [{ leg: '25250PE', at: AT(9, 37), price: 40.15 }], path: [{ t: AT(9, 21), net: -100 }, { t: AT(10, 18), net }] },
    noStopLoss: { net, reason: 'LEG_SL_FLATTEN', exitAt: AT(10, 18), path: [{ t: AT(9, 21), net: -100 }, { t: AT(10, 18), net }] },
    noStops: { net: 2396, reason: 'EXPIRY_DAY', exitAt: AT(15, 0), path: [{ t: AT(9, 21), net: -100 }, { t: AT(15, 0), net: 2396 }] },
    stopped: true, stopEffect: net - 2396, recovery: null, stops: { legSlX: 1.5, slXCredit: 1.6 }, paramsSource: 'trade (as opened)',
    prices: 'tape', tape: { days: ['2026-11-17'], instants: 3611 }, archive: { snapshots: 354, days: ['2026-11-17'], gaps: [] }, caveats: [],
});

let mode = 'saved';
const calls = [];
vi.mock('axios', () => {
    const get = vi.fn((url, cfg) => {
        const p = (cfg && cfg.params) || {};
        calls.push({ url, p });
        if (/combo-grid$/.test(url)) {
            if (p.recalc) { mode = 'recalculating'; return Promise.resolve({ data: { status: 'running', done: 10, total: 100, result: RESULT(26070), saved: SAVED, recalculating: true, limit: 30 } }); }
            if (mode === 'recalculating') { mode = 'recalculated'; return Promise.resolve({ data: { status: 'running', done: 90, total: 100, result: RESULT(26070), saved: SAVED, recalculating: true, limit: 30 } }); }
            if (mode === 'recalculated') return Promise.resolve({ data: { status: 'done', result: RESULT(25900), saved: { ...SAVED, computedAt: '2026-11-18T06:00:00Z', newTrades: 0, settingsChanged: false }, limit: 30, closedTrades: 30, beyondLimit: 0, quarantinedExcluded: 0 } });
            return Promise.resolve({ data: { status: 'done', result: RESULT(26070), saved: SAVED, limit: 30, closedTrades: 30, beyondLimit: 6, quarantinedExcluded: 0 } });
        }
        if (/stop-whatif$/.test(url)) {
            if (p.peek) return Promise.resolve({ data: { ...REPORT(-1798), saved: { ...SAVED, durationMs: 3500, trades: 0, newTrades: 0, settingsChanged: false } } });
            return Promise.resolve({ data: { ...REPORT(-1810), saved: { ...SAVED, computedAt: '2026-11-18T06:00:00Z', durationMs: 4000, trades: 0, newTrades: 0, settingsChanged: false } } });
        }
        return Promise.resolve({ data: {} });
    });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }) }));
import ComboGridPanel from './ComboReplay.jsx';
import { TradeStopReplay } from './StopReplay.jsx';

describe('the words', () => {
    it('when it was calculated, how long it took, and what changed since', () => {
        expect(durationText(59980)).toBe('1 min 0 s');
        expect(durationText(3500)).toBe('4 s');
        expect(savedLine(SAVED)).toMatch(/^Saved replay: calculated 18 Nov 2026, 06:21 in 1 min 0 s, on 30 trades\.$/);
        expect(savedLine(null)).toBe('Calculated just now and saved.');
        expect(savedWarnings(SAVED)).toEqual([
            '2 newer trades since it was calculated: recalculate to include them.',
            'The settings changed since it was calculated: recalculate to replay the current ones.',
        ]);
        expect(savedWarnings({ ...SAVED, newTrades: 0, settingsChanged: false, outdated: true })[0]).toMatch(/^Calculated with an older method/);
    });
    it('which prices each trade was replayed on', () => {
        expect(pricesLine({ tape: 10, minutes: 20, tapeFrom: '2026-11-02' })).toBe('10 of 30 trades on the quote tape (every tick, from 02 Nov 2026); 20 on the archive\'s minute quotes.');
        expect(pricesLine({ tape: 0, minutes: 5, tapeFrom: '2026-11-02' })).toMatch(/^All 5 on the archive's minute quotes/);
        expect(pricesLine(null)).toBe(null);
    });
});

describe('a saved grid', () => {
    beforeEach(() => { mode = 'saved'; calls.length = 0; });
    it('is shown on opening without computing, and Recalculate replaces it while the saved one stays on screen', async () => {
        render(<MemoryRouter><ComboGridPanel deploymentId="d1" /></MemoryRouter>);
        const line = await screen.findByTestId('saved-replay');
        expect(line.textContent).toMatch(/Saved replay: calculated 18 Nov 2026, 06:21 in 1 min 0 s, on 30 trades\./);
        expect(calls.every((c) => c.p.peek === 1)).toBe(true);
        expect(screen.getByText(/2 newer trades since it was calculated/)).toBeTruthy();
        expect(screen.getByText(/The settings changed since it was calculated/)).toBeTruthy();
        expect(screen.getByText(/1 of 2 trades on the quote tape/)).toBeTruthy();
        expect(screen.getAllByText(/\+₹26,070/).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
        await waitFor(() => expect(screen.getByText(/Recalculating: the saved replay below stays until the new one is done/)).toBeTruthy());
        expect(calls.some((c) => c.p.recalc === 1)).toBe(true);
        expect(screen.getAllByText(/\+₹26,070/).length).toBeGreaterThan(0);   // the saved one, meanwhile
        await waitFor(() => expect(screen.getByTestId('saved-replay').textContent).toMatch(/calculated 18 Nov 2026, 11:30/), { timeout: 6000 });
        expect(screen.queryByText(/newer trades since/)).toBeNull();
    });
});

describe('a saved round trip', () => {
    beforeEach(() => { calls.length = 0; });
    it('is shown when the row opens, and Recalculate replaces it', async () => {
        render(<TradeStopReplay trade={{ _id: 'T17', symbol: 'NSE:NIFTY50-INDEX', entryAt: AT(9, 20), exitAt: AT(10, 18), netPnl: -1964, path: [] }} />);
        const line = await screen.findByTestId('saved-trade-replay');
        expect(line.textContent).toMatch(/Saved replay: calculated 18 Nov 2026, 06:21 in 4 s\./);
        expect(screen.queryByText('Replay without stops or target')).toBeNull();
        expect(screen.getByText(/Prices: the quote tape, every tick \(3611 moments marked on 2026-11-17\)/)).toBeTruthy();
        expect(calls.filter((c) => /stop-whatif$/.test(c.url)).every((c) => c.p.peek === 1)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
        await waitFor(() => expect(screen.getByTestId('saved-trade-replay').textContent).toMatch(/calculated 18 Nov 2026, 11:30/));
        expect(calls.some((c) => /stop-whatif$/.test(c.url) && c.p.recalc === 1)).toBe(true);
    });
});
