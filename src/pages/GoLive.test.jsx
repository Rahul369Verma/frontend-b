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

describe('PromoteDialog — clone as LIVE (11-Nov-2026)', () => {
    it('says what it makes and what stays, then posts clone:true with the copy\'s lots', async () => {
        const onDone = vi.fn();
        const ok = [gate('venue.auth', 'hard', 'pass')];
        axios.get.mockResolvedValueOnce({ data: { ...REPORT, kind: 'multileg', id: 'm9', name: 'fifth (PAPER)', gates: ok, summary: summarize(ok) } });
        axios.post.mockResolvedValue({ data: { ok: true, clone: true, deployment: { name: 'fifth (LIVE)' }, canary: { trades: 10, lots: 1 } } });
        render(<PromoteDialog open clone kind="multileg" id="m9" name="fifth (PAPER)" onClose={() => {}} onDone={onDone} />);
        const btn = await screen.findByRole('button', { name: /Clone as LIVE \(real money\)/ });
        expect(screen.getByText(/Clone as LIVE — fifth \(PAPER\)/)).toBeTruthy();
        expect(screen.getByText(/keeps running on paper, unchanged/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText(/Lots for the LIVE copy/), { target: { value: '0' } });
        expect(btn.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/Lots for the LIVE copy/), { target: { value: '1' } });
        expect(btn.disabled).toBe(false);
        fireEvent.click(btn);
        await waitFor(() => expect(onDone).toHaveBeenCalled());
        const [url, body] = axios.post.mock.calls[0];
        expect(url).toMatch(/\/golive\/deployments\/multileg\/m9\/promote$/);
        expect(body.clone).toBe(true);
        expect(body.lots).toBe(1);
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

describe('automatic broker drills (17-Nov-2026)', () => {
    const AUTO = {
        enabled: true, off: null, refreshDays: 7, attemptsPerDay: 2,
        plan: [{ segment: 'MCX-FUT', from: '09:05', until: '22:30' }, { segment: 'NSE-OPT', from: '09:40', until: '15:00' }, { segment: 'BSE-OPT', from: '09:45', until: '15:00' }, { segment: 'DELTA', from: '09:50', until: '23:00' }],
        segments: {
            'NSE-OPT': { state: { action: 'passed', note: 'passed at 09:40 IST' }, last: { at: '2026-11-17T04:10:00Z', ok: true } },
            'BSE-OPT': { state: { action: 'retry-later', note: 'retries after 10:15 IST' }, last: { at: '2026-11-17T04:15:00Z', ok: false, step: 'cancel' } },
            'MCX-FUT': { state: null, last: null },
            DELTA: { state: { action: 'not-configured', note: 'no Delta API keys' }, last: null },
        },
        issues: [
            { segment: 'BSE-OPT', name: 'BSE options', error: 'not confirmed cancelled (status 6)', step: 'cancel', count: 2, firstAt: '2026-11-16T04:15:00Z', lastAt: '2026-11-17T04:15:00Z', recorded: true, triggers: ['auto'] },
            { segment: 'MCX-FUT', name: 'MCX futures', error: 'no price for MCX:GOLDM26DECFUT', step: 'pick instrument + quote', count: 1, firstAt: '2026-11-17T03:35:00Z', lastAt: '2026-11-17T03:35:00Z', recorded: false, triggers: ['auto'] },
        ],
    };
    const withAuto = (auto) => axios.get.mockImplementation((url) => {
        if (url.endsWith('/golive/status')) return Promise.resolve({ data: { ...STATUS, autoDrill: auto } });
        if (url.endsWith('/golive/deployments')) return Promise.resolve({ data: { reports: [], failed: [], total: 0 } });
        return Promise.resolve({ data: {} });
    });

    it('says when drills run by themselves and what each segment is doing', async () => {
        withAuto(AUTO);
        render(<GoLive />);
        await waitFor(() => expect(screen.getByText(/Run automatically every trading day while the exchange is open, when a drill failed or its pass is over 7 days old \(NSE options from 09:40, BSE options from 09:45, MCX futures from 09:05 IST\)/)).toBeTruthy());
        expect(screen.getByText(/Automatic: passed at 09:40 IST · last automatic drill .*: passed/)).toBeTruthy();
        expect(screen.getByText(/Automatic: retries after 10:15 IST · last automatic drill .*: failed at cancel/)).toBeTruthy();
        expect(screen.getByText(/Automatic: no Delta API keys/)).toBeTruthy();
    });

    it('lists the drill issues to fix — count, failing step, error — and marks one that is not on the gate', async () => {
        withAuto(AUTO);
        render(<GoLive />);
        await waitFor(() => expect(screen.getByText('Drill issues')).toBeTruthy());
        expect(screen.getByText('not confirmed cancelled (status 6)')).toBeTruthy();
        expect(screen.getByText('2×')).toBeTruthy();
        expect(screen.getByText(/failed at “cancel”/)).toBeTruthy();
        expect(screen.getByText('no price for MCX:GOLDM26DECFUT')).toBeTruthy();
        expect(screen.getAllByText('not on the gate').length).toBe(1);
    });

    it('a server that does not trade says the automatic drills are off, and why', async () => {
        withAuto({ ...AUTO, enabled: false, off: 'off on this server: its engines are off (trading role, DISABLE_TRADING_ENGINES=true)', issues: [] });
        render(<GoLive />);
        await waitFor(() => expect(screen.getAllByText(/Automatic drills: off on this server: its engines are off/).length).toBe(2));
        expect(screen.getByText('None in the last 30 days.')).toBeTruthy();
        expect(screen.queryByText(/^Automatic: /)).toBeNull();
    });
});
