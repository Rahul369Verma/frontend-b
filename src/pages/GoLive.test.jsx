/**
 * Go-Live page: the verdict says "not ready" while a venue blocks; a drill shows its
 * exact order before anything is sent and sends only with confirm:true; the promote
 * dialog keeps the button disabled on a hard failure and, for evidence gaps, until
 * the exact phrase and a reason are typed — then posts the override and the canary.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import axios from 'axios';
import GoLive from './GoLive.jsx';
import { PromoteDialog } from '../components/golive/goLiveShared.jsx';
import { gateBadge } from '../components/golive/goLiveApi.js';

vi.mock('axios', () => {
    const api = { get: vi.fn(), post: vi.fn() };
    return { default: api, ...api };
});

const gate = (id, level, status, extra = {}) => ({ id, group: id.split('.')[0], title: id, level, status, have: `have ${id}`, need: 'n', fix: status === 'pass' ? null : `fix ${id}`, ...extra });
const summarize = (gates) => {
    const failing = (g) => g.status === 'fail' || (g.level === 'hard' && g.status === 'unknown');
    const hard = gates.filter((g) => g.level === 'hard' && failing(g));
    const soft = gates.filter((g) => g.level === 'soft' && failing(g));
    const warnings = gates.filter((g) => g.status === 'warn');
    return { ready: !hard.length && !soft.length, overridable: !hard.length && soft.length > 0, hard, soft, warnings, counts: { pass: gates.filter((g) => g.status === 'pass').length, hard: hard.length, soft: soft.length, warn: warnings.length, total: gates.length } };
};
const venue = (name, gates, raw = {}) => ({ venue: name, gates, summary: summarize(gates), raw: { env: 'production', availableInr: 50000, lastDrill: {}, ...raw } });

const STATUS = {
    venues: [
        venue('FYERS', [gate('venue.auth', 'hard', 'pass'), gate('venue.ipWhitelist', 'hard', 'unknown'), gate('drill.NSE-OPT', 'hard', 'fail', { have: 'never run' }), gate('drill.BSE-OPT', 'hard', 'fail'), gate('drill.MCX-FUT', 'hard', 'fail')]),
        venue('DELTA', [gate('venue.keys', 'hard', 'fail'), gate('drill.DELTA', 'hard', 'fail')], { env: 'testnet' }),
    ],
    liveTradesEver: 0,
    liveTradesBreakdown: { singleLegWithBrokerId: 0, multileg: 0, markedLiveWithoutBrokerId: 14 },
    engine: { running: true, halted: false },
    drillPlans: [
        { segment: 'NSE-OPT', venue: 'FYERS', instrument: 'ATM CE on NSE:NIFTY50-INDEX', order: 'BUY 1 lot of the ATM NIFTY50 call as an AFTER-MARKET order', then: 'cancel', ifFilled: 'sold back', env: 'production — this is your real Fyers account' },
        { segment: 'BSE-OPT', venue: 'FYERS', instrument: 'x', order: 'x', then: 'x', ifFilled: 'x', env: 'production' },
        { segment: 'MCX-FUT', venue: 'FYERS', instrument: 'x', order: 'x', then: 'x', ifFilled: 'x', env: 'production' },
        { segment: 'DELTA', venue: 'DELTA', instrument: 'DELTA:BTCUSD', order: 'POST-ONLY', then: 'x', ifFilled: 'x', env: 'testnet' },
    ],
    drillRunning: null,
};
const softGates = [gate('venue.auth', 'hard', 'pass'), gate('evidence.paperSample', 'soft', 'fail')];
const REPORT = {
    kind: 'single', id: 'd1', name: 'NIFTY orb', symbol: 'NSE:NIFTY50-INDEX', strategy: 'orb', mode: 'PAPER', venue: 'FYERS', segment: 'NSE-OPT',
    gates: softGates, summary: summarize(softGates), paper: { n: 12, days: 4, mean: 40, t: 1.1, total: 480 }, lots: 2,
    canaryDefaults: { trades: 10, lots: 1, lossCapInr: 5000 }, canary: null, isActive: true,
};

beforeEach(() => {
    axios.get.mockReset(); axios.post.mockReset();
    axios.get.mockImplementation((url) => {
        if (url.endsWith('/golive/status')) return Promise.resolve({ data: STATUS });
        if (url.endsWith('/golive/deployments')) return Promise.resolve({ data: { reports: [REPORT], failed: [{ kind: 'single', id: 'x', name: 'broken one', error: 'boom' }], total: 2 } });
        if (url.endsWith('/golive/drills')) return Promise.resolve({ data: { drills: [] } });
        if (url.endsWith('/golive/deployments/single/d1')) return Promise.resolve({ data: REPORT });
        return Promise.resolve({ data: {} });
    });
});

describe('gate badges', () => {
    it('an unknown hard gate reads as unproven (a failure), an unknown info gate as unknown', () => {
        expect(gateBadge({ level: 'hard', status: 'unknown' })).toEqual({ level: 'critical', text: 'unproven' });
        expect(gateBadge({ level: 'info', status: 'unknown' })).toEqual({ level: 'info', text: 'unknown' });
        expect(gateBadge({ level: 'soft', status: 'pass' }).level).toBe('good');
    });
});

describe('Go-Live page', () => {
    it('says not ready, shows zero real trades, and lists a deployment that could not be checked', async () => {
        render(<GoLive />);
        await waitFor(() => expect(screen.getByText('Not ready for real money')).toBeTruthy());
        expect(screen.getByText(/every fill so far was simulated · 14 older rows marked live have no broker order id/)).toBeTruthy();
        await waitFor(() => expect(screen.getByText('NIFTY orb')).toBeTruthy());
        expect(screen.getByText(/1 deployment\(s\) could not be checked: broken one \(boom\)/)).toBeTruthy();
        expect(screen.getByText(/12 trades over 4 days/)).toBeTruthy();
    });

    it('a drill shows the exact order first and sends only with confirm:true', async () => {
        axios.post.mockResolvedValue({ data: { ok: true, segment: 'NSE-OPT', steps: [{ step: 'place (cannot fill)', ok: true, ms: 120, detail: 'order 1' }] } });
        render(<GoLive />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Run drill' }).length).toBe(4));
        fireEvent.click(screen.getAllByRole('button', { name: 'Run drill' })[0]);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/AFTER-MARKET/)).toBeTruthy();
        expect(within(dialog).getByText(/your real Fyers account/)).toBeTruthy();
        expect(axios.post).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send the drill order' }));
        await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/golive\/drill$/), { segment: 'NSE-OPT', confirm: true }, expect.anything()));
        await waitFor(() => expect(screen.getByText('drill passed')).toBeTruthy());
    });
});

describe('PromoteDialog', () => {
    it('blocks on a hard failure — no override fields at all', async () => {
        const hard = [gate('venue.auth', 'hard', 'fail'), gate('evidence.backtest', 'soft', 'fail')];
        axios.get.mockResolvedValueOnce({ data: { ...REPORT, gates: hard, summary: summarize(hard) } });
        render(<PromoteDialog open kind="single" id="d1" name="NIFTY orb" onClose={() => {}} onDone={() => {}} />);
        await waitFor(() => expect(screen.getByText(/must pass first/)).toBeTruthy());
        expect(screen.getByRole('button', { name: /Promote to LIVE/ }).disabled).toBe(true);
        expect(screen.queryByLabelText(/Phrase/)).toBeNull();
    });

    it('evidence gaps need the exact phrase and a reason; then it posts the override and canary', async () => {
        const onDone = vi.fn();
        axios.post.mockResolvedValue({ data: { ok: true, canary: { trades: 5, lots: 1 } } });
        render(<PromoteDialog open kind="single" id="d1" name="NIFTY orb" onClose={() => {}} onDone={onDone} />);
        const btn = await screen.findByRole('button', { name: /Promote to LIVE/ });
        expect(btn.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/^Phrase/), { target: { value: 'i accept real losses' } });
        expect(btn.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'the backtest is long enough' } });
        expect(btn.disabled).toBe(false);
        fireEvent.change(screen.getByLabelText(/^Trades/), { target: { value: '5' } });
        fireEvent.click(btn);
        await waitFor(() => expect(onDone).toHaveBeenCalled());
        const [url, body] = axios.post.mock.calls[0];
        expect(url).toMatch(/\/golive\/deployments\/single\/d1\/promote$/);
        expect(body.override).toEqual({ phrase: 'i accept real losses', reason: 'the backtest is long enough' });
        expect(body.canary.trades).toBe('5');
    });
});

describe('the canary asks — you decide (23-Oct-2026)', () => {
    it('loss cap reached: still LIVE, nothing switched; Keep LIVE posts your answer only after you confirm', async () => {
        const live = { ...REPORT, id: 'm1', kind: 'multileg', name: 'nifty-atm-straddle (LIVE)', mode: 'LIVE',
            canary: { state: 'CAP_HIT', trades: 10, liveTrades: 3, livePnl: -5155.08, lossCapInr: 5000, lots: 1, originalLots: 1, reason: 'lost ₹5,155 in 3 live trade(s)' } };
        axios.get.mockImplementation((url) => {
            if (url.endsWith('/golive/status')) return Promise.resolve({ data: STATUS });
            if (url.endsWith('/golive/deployments')) return Promise.resolve({ data: { reports: [live], failed: [], total: 1 } });
            if (url.endsWith('/golive/drills')) return Promise.resolve({ data: { drills: [] } });
            return Promise.resolve({ data: {} });
        });
        axios.post.mockResolvedValue({ data: { ok: true } });
        const spy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        render(<GoLive />);
        const line = await screen.findByTestId('canary-line');
        expect(within(line).getByText('loss cap reached — your decision')).toBeTruthy();
        expect(within(line).getByText(/It is still LIVE — nothing was switched/)).toBeTruthy();
        fireEvent.click(within(line).getByRole('button', { name: 'Keep LIVE' }));
        await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        expect(axios.post).not.toHaveBeenCalled();
        fireEvent.click(within(line).getByRole('button', { name: 'Keep LIVE' }));
        await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/golive\/deployments\/multileg\/m1\/canary$/), { decision: 'keep' }));
        expect(within(line).getByRole('button', { name: 'Demote to PAPER' })).toBeTruthy();
        spy.mockRestore();
    });
});
