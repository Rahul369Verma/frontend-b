/**
 * "Stops and target together, on these trades" (17-Nov-2026: "a combination section … the best SL
 * and TP combined results with all the details, marking current and the best for us"): the named
 * settings side by side with the current one ringed and the best starred, the held-out check in
 * words, what the stops and the target each did, every combination ranked, and per trade current
 * vs best.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { didText, endedText, comboText, sumEffects, stopsSentence, targetSentence, comboParams, tryLink, parseTry, tryText, istDay } from './comboReplayFormat.js';

const row = (legSlX, maxLoss, tp, net, worst, extra = {}) => ({ legSlX, maxLoss, tp, n: 4, wins: 3, net, worst, avg: Math.round(net / 4), targets: 1, stopped: 2, ...extra });
const BEST = row(1.5, 0, 20, 31344, -5527, { targets: 5, stopped: 12 });
const NO_RISKIER = row(1.3, 2000, 20, 27000, -2218, { targets: 4, stopped: 14 });
const CUR = row(1.4, 20000, 35, 23406, -4550, { targets: 1, stopped: 14 });
const SAFEST = row(1.3, 2000, 10, 18839, -2218);
const fillers = Array.from({ length: 20 }, (_, i) => row(2, 5000, 5 + i, 20000 - i * 100, -5000));
fillers[0] = row(0, 0, 20, 19900, -6000, { runnable: false });   // leg stop off on a naked short: the live engine refuses it
const side = (net, reason, extra = {}) => ({ net, reason, exitAt: '2026-11-13T09:40:00Z', firstStop: null, targetHit: reason === 'TP_STRUCT', noStops: net, noTarget: net, stopsDid: 0, targetDid: 0, ...extra });
const RESULT = {
    deploymentId: 'd1', key: 'tp_pct_credit', keyLabel: '% of the credit',
    current: { legSlX: 1.4, maxLoss: 20000, tp: 35 }, structureStop: 1.5, trades: 4, skipped: [],
    rows: [BEST, NO_RISKIER, CUR, ...fillers, SAFEST],
    neither: { n: 4, wins: 2, net: -13004, worst: -28689, avg: -3251, targets: 0, stopped: 0 },
    picks: { best: BEST, current: CUR, noRiskier: NO_RISKIER, safest: SAFEST },
    holdout: { ok: true, testFrom: '2026-11-11', firstTrades: 12, lastTrades: 5, pick: { legSlX: 1.5, maxLoss: 0, tp: 20, first: 20000, last: 1500 }, current: { legSlX: 1.4, maxLoss: 20000, tp: 35, first: 18000, last: 4000 }, hindsightBest: { legSlX: 1.5, maxLoss: 0, tp: 20, first: 20000, last: 1500 }, pickIsCurrent: false },
    effects: {
        current: { n: 4, net: 23406, stopsActed: 3, stopsDid: 36410, stopsSaved: 2, stopsCost: 1, targetFired: 1, targetDid: -1050, targetAdded: 0, targetCost: 1, vsNeither: 36410 },
        best: { n: 4, net: 31344, stopsActed: 3, stopsDid: 40000, stopsSaved: 3, stopsCost: 0, targetFired: 2, targetDid: 3000, targetAdded: 2, targetCost: 0, vsNeither: 44348 },
    },
    perTrade: [
        { id: 't1', entryAt: '2026-11-13T03:50:00Z', booked: -3249, neither: 7836, bestVsCurrent: 2000,
            current: side(-3739, 'SQUARE_OFF', { firstStop: { kind: 'LEG_SL', at: '2026-11-13T05:15:00Z' }, stopsDid: -11575 }),
            best: side(-1739, 'TP_STRUCT', { targetDid: 900 }) },
        { id: 't2', entryAt: '2026-11-06T03:50:00Z', booked: 11200, neither: -28689, bestVsCurrent: 0,
            current: side(10777, 'MAX_LOSS', { firstStop: { kind: 'MAX_LOSS', at: '2026-11-06T04:18:00Z' }, stopsDid: 39466 }),
            best: side(10777, 'MAX_LOSS', { firstStop: { kind: 'MAX_LOSS', at: '2026-11-06T04:18:00Z' }, stopsDid: 39466 }) },
    ],
    caveats: ['Each trade keeps its own strikes…'],
};
let calls = 0;
vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/combo-grid$/.test(url)) {
            calls++;
            return Promise.resolve({ data: calls === 1
                ? { status: 'running', done: 100, total: 900, limit: 30 }
                : { status: 'done', done: 900, total: 900, result: RESULT, limit: 30, closedTrades: 4, beyondLimit: 0, quarantinedExcluded: 0 } });
        }
        return Promise.resolve({ data: {} });
    });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import ComboGridPanel from './ComboReplay.jsx';

describe('comboReplayFormat', () => {
    it('says what a stop or a target did, and how a trade ended', () => {
        expect(didText(4240, 'saved')).toBe('saved ₹4,240');
        expect(didText(-1050, 'added')).toBe('cost ₹1,050');
        expect(didText(900, 'added')).toBe('added ₹900');
        expect(didText(0)).toBe('nothing');
        expect(didText(null)).toBe('—');
        expect(endedText({ reason: 'SQUARE_OFF', exitAt: '2026-11-13T09:40:00Z', firstStop: { kind: 'LEG_SL', at: '2026-11-13T05:15:00Z' } })).toBe('leg stop 10:45 → square-off 15:10');
        expect(endedText({ reason: 'TP_STRUCT', exitAt: '2026-11-03T07:26:00Z' })).toBe('profit target 12:56');
        expect(comboText('tp_pct_credit', { legSlX: 1.5, maxLoss: 0, tp: 20 })).toBe('leg 1.5× · rupee off · target 20%');
    });
    it('adds up what the stops and the target did over the trades', () => {
        const fx = sumEffects([{ s: 8828, x: 0, st: true, h: false }, { s: -5118, x: -1050, st: true, h: true }, { s: 0, x: 0, st: false, h: false }],
            { stops: (t) => t.s, target: (t) => t.x, stopped: (t) => t.st, hit: (t) => t.h });
        expect(fx).toMatchObject({ n: 3, stopsDid: 3710, stopsActed: 2, stopsSaved: 1, stopsCost: 1, targetDid: -1050, targetFired: 1 });
        expect(stopsSentence(fx)).toBe('the stops acted on 2 of 3 trades and saved ₹3,710 in all (saved on 1, cost on 1)');
        expect(targetSentence(fx)).toBe('the target fired on 1 and cost ₹1,050');
        expect(targetSentence({ ...fx, targetFired: 0 })).toBe('the target never fired, so it changed nothing');
        expect(targetSentence(fx, { set: false })).toBe('there is no profit target');
    });
});

describe('Backtest & update: a combination as deployment settings, carried to the builder', () => {
    it('sets the leg stop, the rupee stop and the varied target; turns off another target only if it is on', () => {
        expect(comboParams('tp_pct_credit', { legSlX: 1.5, maxLoss: 0, tp: 20 }, { tp_pct_credit: 35, tp_pct_max_profit: 50, tp_x_debit: 0 }))
            .toEqual({ leg_sl_x: 1.5, max_loss_rupees: 0, tp_pct_credit: 20, tp_pct_max_profit: 0 });
        expect(comboParams('tp_pct_credit', { legSlX: 1.3, maxLoss: 2000, tp: 0 }, {})).toEqual({ leg_sl_x: 1.3, max_loss_rupees: 2000, tp_pct_credit: 0 });
    });
    it('the link names the deployment, the combination, the replayed days and what the replay said; a bad link is dropped', () => {
        expect(istDay('2026-11-05T22:00:00Z')).toBe('2026-11-06');
        const url = tryLink('d1', RESULT, BEST, '★ Best net');
        expect(url).toMatch(/^\/multi-leg\?tab=backtest&edit=d1&try=/);
        const t = parseTry(new URLSearchParams(url.split('?')[1]).get('try'));
        expect(t).toEqual({ key: 'tp_pct_credit', combo: { legSlX: 1.5, maxLoss: 0, tp: 20 }, label: '★ Best net', from: '2026-11-06', source: 'archive',
            whatIf: { trades: 4, net: 31344, worst: -5527, currentNet: 23406, currentWorst: -4550 } });
        expect(tryText(t)).toBe('★ Best net — leg 1.5× · rupee off · target 20%: +₹31,344 on its last 4 trades replayed, +₹7,938 against the current +₹23,406 (worst trade -₹5,527; current -₹4,550)');
        expect(parseTry('{bad')).toBe(null);
        expect(parseTry(JSON.stringify({ key: 'trade_mode', combo: { legSlX: 1, maxLoss: 0, tp: 0 } }))).toBe(null);
        expect(parseTry(JSON.stringify({ key: 'tp_pct_credit', combo: { legSlX: -1, maxLoss: 0, tp: 0 } }))).toBe(null);
        expect(parseTry(JSON.stringify({ key: 'tp_pct_credit', combo: { legSlX: 1.4, maxLoss: 0, tp: 0 }, from: 'x', source: 'evil' }))).toMatchObject({ from: null, source: 'archive', label: 'From Results' });
    });
});

const renderPanel = (props) => render(<MemoryRouter><ComboGridPanel {...props} /></MemoryRouter>);

describe('ComboGridPanel', () => {
    it('asks for one deployment', () => {
        renderPanel({ deploymentId: 'all' });
        expect(screen.getByText(/Pick one deployment/)).toBeTruthy();
    });

    it('runs on request and shows the current and the best, the held-out check, the effects, the ranking and each trade', async () => {
        renderPanel({ deploymentId: 'd1' });
        fireEvent.click(screen.getByRole('button', { name: /every stop × target combination/ }));
        await waitFor(() => expect(screen.getByText(/Best on these trades:/)).toBeTruthy(), { timeout: 5000 });
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/leg 1\.5× · rupee off · target 20% → \+₹31,344, \+₹7,938 against the current leg 1\.4× · rupee ₹20,000 · target 35% \(\+₹23,406\)/);

        // the named settings, the current ringed and the best starred; neither for reference
        const named = screen.getByRole('table', { name: /Current and best stop and target settings/ });
        const labels = within(named).getAllByRole('row').map((r) => r.cells[0].textContent);
        expect(labels).toEqual(['Setting', 'Current', '★ Best net', 'Best without a worse worst trade', 'Smallest worst trade', 'Neither (no stops, no target)']);
        expect(within(named).getAllByRole('row')[1].className).toMatch(/ring-1/);
        // each named setting other than the current one: Backtest & update… → the builder, editing this deployment with it
        const namedRows = within(named).getAllByRole('row');
        expect(namedRows[1].textContent).toMatch(/running now$/);
        const tryBest = within(namedRows[2]).getByRole('link', { name: /Backtest and update with leg 1\.5× · rupee off · target 20%/ });
        const q = new URLSearchParams(tryBest.getAttribute('href').split('?')[1]);
        expect(q.get('edit')).toBe('d1');
        expect(parseTry(q.get('try'))).toMatchObject({ label: '★ Best net', combo: { legSlX: 1.5, maxLoss: 0, tp: 20 }, from: '2026-11-06' });
        expect(within(namedRows[5]).queryByRole('link')).toBeNull();

        // the held-out check says whether choosing this way held up
        expect(screen.getByText(/Held-out check\./).parentElement.textContent).toMatch(/On the last 5 trades .* it made \+₹1,500; the current settings made \+₹4,000\. Choosing this way would have cost ₹2,500: the early best did not hold up\./);

        // what the stops and the target did, current and best
        const fx = screen.getByText('What the stops and the target did').parentElement.textContent;
        expect(fx).toMatch(/Current \(leg 1\.4× · rupee ₹20,000 · target 35%\): the stops acted on 3 of 4 trades and saved ₹36,410 in all \(saved on 2, cost on 1\); the target fired on 1 and cost ₹1,050\./);
        expect(fx).toMatch(/Best \(leg 1\.5× · rupee off · target 20%\): .* the target fired on 2 and added ₹3,000\./);

        // ranked: the best first and starred, the current marked with its rank
        const ranked = screen.getByRole('table', { name: /Every stop and target combination/ });
        const rr = within(ranked).getAllByRole('row');
        expect(rr[1].textContent).toMatch(/★/);
        expect(rr[3].textContent).toMatch(/current/);
        expect(screen.getByText(/the current one is #3/)).toBeTruthy();
        expect(rr.length).toBe(1 + 15, 'top 15 until asked for all');
        expect(within(rr[2]).getByRole('link', { name: /Backtest and update/ }).textContent).toBe('backtest');
        // a combination the live engine refuses is listed, greyed, with no button
        const refused = rr.find((r) => /live refuses/.test(r.textContent));
        expect(refused.className).toMatch(/opacity-60/);
        expect(within(refused).queryByRole('link')).toBeNull();
        fireEvent.click(screen.getByLabelText(/show all 24/));
        expect(within(ranked).getAllByRole('row').length).toBe(1 + 24);

        // each trade: current vs best, how each ended, what the stops and the target did
        const per = screen.getByRole('table', { name: /Each trade under the current and the best settings/ });
        const t1 = within(per).getAllByRole('row')[2].textContent;
        expect(t1).toMatch(/leg stop 10:45 → square-off 15:10/);
        expect(t1).toMatch(/cost ₹11,575/);
        expect(t1).toMatch(/profit target 15:10.*added ₹900/);
        expect(within(per).getAllByRole('row')[3].textContent).toMatch(/same$/);
        expect(screen.getByText(/did better on 1,\s+worse on 0 and the same on 1 of 2 trades/)).toBeTruthy();
    });
});
