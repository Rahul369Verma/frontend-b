/**
 * Editing a RUNNING multileg deployment (23-Oct-2026): Edit on its card loads its own settings
 * into the builder; "Save to deployment" asks the server what would change (a dry run), shows
 * every change and when it acts, and only then saves. The server decides what may change
 * (backend logic/multileg/deploymentEdit.js); the page never saves without the confirmation.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deploymentEditBody, editBlocker, changeLine, compareRows, stableJson, compareLine } from '../components/multileg/deploymentEditFormat.js';

const TEMPLATE = {
    key: 'short_straddle', name: 'Short Straddle', outlook: 'neutral', style: 'credit', intraday: true,
    legs: [{ type: 'CE', action: 'SELL', offset: 0, ratio: 1, expiry: 'NEAR' }, { type: 'PE', action: 'SELL', offset: 0, ratio: 1, expiry: 'NEAR' }],
    defaults: { entry_time: '09:20', square_off: '15:10', tp_pct_credit: 35, sl_x_credit: 1.5, leg_sl_x: 1.4 },
};
const DEP = {
    _id: 'dep1', name: 'nifty-atm-straddle', template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', entry_mode: 'time',
    trade_mode: 'PAPER', status: 'ACTIVE', lots: 1, params: { entry_time: '09:20', square_off: '15:10', leg_sl_x: 1.4, sl_x_credit: 1.5, max_loss_rupees: 3000 },
    position: { state: 'IDLE', legs: [], closedLegs: [] }, daily: {}, totals: {},
};
// 18-Nov-2026: a STOPPED deployment, read from the database where no engine runs (dev) — the real
// nifty-atm-straddle (LIVE) as dev holds it: 2 lots, leg 1.4×, rupee ₹20,000, target 35%
const STOPPED = {
    _id: '6ad54e26321a45ac642d5012', name: 'nifty-atm-straddle (LIVE)', template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', entry_mode: 'time',
    trade_mode: 'PAPER', status: 'STOPPED', lots: 2,
    params: { entry_time: '09:20', square_off: '15:10', tp_pct_credit: 35, sl_x_credit: 1.5, leg_sl_x: 1.4, max_loss_rupees: 20000, lots: 2 },
    position: { state: 'IDLE', legs: [] },
};
const PLAN = { ok: true, dryRun: true, open: false, changes: [{ key: 'max_loss_rupees', before: 3000, after: 3000, appliesTo: 'the next entry' }, { key: 'leg_sl_x', before: 1.4, after: 1.3, appliesTo: 'the next entry' }] };

vi.mock('axios', () => {
    const answer = (url) => {
        if (/\/multileg\/templates$/.test(url)) return [TEMPLATE];
        if (/\/multileg\/deployments$/.test(url)) return { deployments: [DEP], events: [] };
        if (/\/multileg\/deployments\/dep1$/.test(url)) return { deployment: DEP, source: 'engine' };
        if (/\/multileg\/deployments\/6ad54e26321a45ac642d5012$/.test(url)) return { deployment: STOPPED, source: 'database' };
        return [];
    };
    const get = vi.fn((url) => {
        // a deleted deployment: the one-deployment read answers 404
        if (/\/multileg\/deployments\/6af000000000000000000000$/.test(url)) return Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: { error: 'deployment not found' } } }));
        // a backend older than the page: no one-deployment route, Express's own 404 page
        if (globalThis.__oldBackend && /\/multileg\/deployments\/[^/]+$/.test(url)) return Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: '<pre>Cannot GET</pre>' } }));
        return Promise.resolve({ data: answer(url) });
    });
    const patch = vi.fn((url, body) => Promise.resolve({ data: body.dryRun ? PLAN : { ok: true, changes: PLAN.changes } }));
    const empty = () => Promise.resolve({ data: [] });
    // a backtest: the deployment's own settings (leg 1.4×) make less than the combination from Results (leg 1.5×)
    const post = vi.fn((url, body) => {
        if (/\/multileg\/backtest$/.test(url)) {
            const mine = body.params.leg_sl_x === 1.4;
            return Promise.resolve({ data: { chainSource: body.chain_source, trades: [], metrics: mine
                ? { n: 20, winRate: 55, netPnl: 12000, avgWin: 2000, avgLoss: -1500, maxDrawdown: 6000, profitFactor: 1.4 }
                : { n: 20, winRate: 60, netPnl: 15500, avgWin: 2100, avgLoss: -1200, maxDrawdown: 4500, profitFactor: 1.8 } } });
        }
        return empty();
    });
    const api = {
        get, patch, post, put: vi.fn(empty), delete: vi.fn(empty),
        defaults: { headers: { common: {} }, withCredentials: true },
        interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
vi.mock('socket.io-client', () => ({
    io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: false }),
    default: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: false }),
}));

import axios from 'axios';
import MultiLeg from './MultiLeg.jsx';

describe('the request and the words', () => {
    it('size travels as lots; the signal exit follows the checkbox; signal settings only for a signal deployment', () => {
        const b = deploymentEditBody({ params: { leg_sl_x: 1.3, lots: 2, use_signal_exit: true }, entryMode: 'time', name: ' x ' });
        expect(b).toEqual({ params: { leg_sl_x: 1.3, use_signal_exit: null }, lots: 2, name: 'x' });
        expect(deploymentEditBody({ params: {}, entryMode: 'signal', useSignalExit: true, signalParams: { p: 1 } }))
            .toEqual({ params: { use_signal_exit: true }, lots: 1, signal_params: { p: 1 } });
    });
    it('a different structure, symbol or trigger is a new strategy, not an edit', () => {
        const e = { template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', entry_mode: 'time' };
        expect(editBlocker(e, { tplKey: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', entryMode: 'time' })).toBe(null);
        expect(editBlocker(e, { tplKey: 'iron_condor', symbol: 'NSE:NIFTYBANK-INDEX', entryMode: 'time' })).toMatch(/^The structure, symbol differ from the deployment's/);
        expect(editBlocker(null, {})).toBe(null);
    });
    it('the two backtests side by side: a loss or a drawdown is better when smaller; settings compare whatever their key order', () => {
        const rows = compareRows({ netPnl: 12000, n: 20, winRate: 55, avgLoss: -1500, maxDrawdown: 6000, profitFactor: 1.4 }, { netPnl: 15500, n: 20, winRate: 60, avgLoss: -1200, maxDrawdown: 4500, profitFactor: Infinity });
        expect(rows.map((r) => [r.label, r.diff, r.verdict])).toEqual([
            ['Net P&L', 3500, 'better'], ['Trades', 0, null], ['Win rate', 5, 'better'], ['Avg loss', 300, 'better'], ['Max drawdown', -1500, 'better'], ['Profit factor', null, 'better'],
        ]);
        expect(stableJson({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(stableJson({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 }));
        expect(compareLine({ base: { netPnl: 12000, n: 20 }, next: { netPnl: 15500, n: 20 }, period: { from: '2026-11-06', to: '2026-11-17', chainSource: 'archive' } }))
            .toBe("Backtest 2026-11-06 → 2026-11-17 on real option quotes (archive): the deployment's settings +₹12,000 over 20 trades; these +₹15,500 over 20 (+₹3,500).");
        expect(compareLine({})).toMatch(/^Not backtested next to/);
    });
    it('each change says what it was, what it becomes, and when it acts', () => {
        expect(changeLine({ key: 'leg_sl_x', before: 1.4, after: 1.3, appliesTo: 'the open structure, at its next check' })).toBe('leg_sl_x: 1.4 → 1.3 — the open structure, at its next check');
        expect(changeLine({ key: 'max_loss_rupees', before: null, after: 2500, appliesTo: 'x' })).toBe('max_loss_rupees: default → 2500 — x');
    });
});

describe('Edit a deployment from its card', () => {
    beforeEach(() => { axios.patch.mockClear(); axios.post.mockClear(); });
    const saves = () => axios.patch.mock.calls.filter(([, b]) => !b.dryRun);
    it('loads it into the builder, asks the server what would change, confirms, then saves', async () => {
        render(<MemoryRouter initialEntries={['/multi-leg?tab=deploy']}><MultiLeg /></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit nifty-atm-straddle' }, { timeout: 5000 }));
        const banner = await screen.findByTestId('editing-deployment');
        expect(banner.textContent).toMatch(/Editing deployment “nifty-atm-straddle” \(PAPER · flat\)/);
        // while editing, the server's dry run is shown as the settings change — nothing saved
        await waitFor(() => expect(within(banner).getByTestId('edit-changes').textContent).toMatch(/^Changes from the deployment \(2\).*leg_sl_x: 1\.4 → 1\.3 — the next entry/));
        expect(saves()).toHaveLength(0);
        fireEvent.click(within(banner).getByRole('button', { name: 'Save to deployment' }));
        // a dry run of exactly what would be saved — nothing is saved before the confirmation
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save to deployment' }).length).toBe(2));
        const [url, dry] = axios.patch.mock.calls.at(-1);
        expect(url).toMatch(/\/multileg\/deployments\/dep1$/);
        expect(dry.dryRun).toBe(true);
        expect(dry.lots).toBe(1);
        expect(dry.params.max_loss_rupees).toBe(3000);
        expect(dry.params.leg_sl_x).toBe(1.4);
        expect(saves()).toHaveLength(0);
        expect(screen.getByTestId('confirm-compare').textContent).toBe('Not backtested next to the deployment’s own settings.');
        const dialogSave = screen.getAllByRole('button', { name: 'Save to deployment' }).find((b) => !banner.contains(b));
        fireEvent.click(dialogSave);
        await waitFor(() => expect(saves()).toHaveLength(1));
        await waitFor(() => expect(screen.queryByTestId('editing-deployment')).toBeNull());
    });
});

describe('Backtest & update… from Results (a stop and target combination)', () => {
    beforeEach(() => { axios.patch.mockClear(); axios.post.mockClear(); });
    const TRY = JSON.stringify({ key: 'tp_pct_credit', combo: { legSlX: 1.5, maxLoss: 0, tp: 20 }, label: '★ Best net', from: '2026-11-06', source: 'archive',
        whatIf: { trades: 17, net: 31344, worst: -5527, currentNet: 23406, currentWorst: -4550 } });
    const link = `/multi-leg?${new URLSearchParams({ tab: 'backtest', edit: 'dep1', try: TRY })}`;
    const backtests = () => axios.post.mock.calls.filter(([u]) => /\/multileg\/backtest$/.test(u)).map(([, b]) => b);

    it('opens the deployment with the combination, backtests it next to its own settings, shows every change, and saves only on confirm', async () => {
        render(<MemoryRouter initialEntries={[link]}><MultiLeg /></MemoryRouter>);
        const banner = await screen.findByTestId('editing-deployment', {}, { timeout: 5000 });
        expect(within(banner).getByTestId('edit-source').textContent).toMatch(/★ Best net — leg 1\.5× · rupee off · target 20%: \+₹31,344 on its last 17 trades replayed, \+₹7,938 against the current \+₹23,406/);
        // its own settings first, then the combination: the same days (from the replayed trades) and the same real quotes
        await waitFor(() => expect(backtests()).toHaveLength(2), { timeout: 5000 });
        const [mine, these] = backtests();
        for (const b of [mine, these]) {
            expect(b).toMatchObject({ template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', from: '2026-11-06', chain_source: 'archive' });
            expect(b.params).toMatchObject({ entry_time: '09:20', square_off: '15:10', sl_x_credit: 1.5, lots: 1 });
        }
        expect(mine.params).toMatchObject({ leg_sl_x: 1.4, max_loss_rupees: 3000, tp_pct_credit: 35 });
        expect(these.params).toMatchObject({ leg_sl_x: 1.5, max_loss_rupees: 0, tp_pct_credit: 20 });
        const cmp = await within(banner).findByTestId('edit-compare');
        const rows = within(cmp).getAllByRole('row').map((r) => r.textContent);
        expect(rows[1]).toBe('Net P&L₹12,000₹15,500+₹3,500');
        expect(cmp.textContent).toMatch(/These settings made ₹3,500 more than the deployment's\./);
        expect(cmp.textContent).not.toMatch(/changed after this backtest ran/);
        // the dry run lists the changes; nothing is saved until the confirmation
        await waitFor(() => expect(within(banner).getByTestId('edit-changes').textContent).toMatch(/Changes from the deployment \(2\)/));
        const live = axios.patch.mock.calls.at(-1)[1];
        expect(live).toMatchObject({ dryRun: true, lots: 1, params: { leg_sl_x: 1.5, max_loss_rupees: 0, tp_pct_credit: 20 } });
        expect(axios.patch.mock.calls.filter(([, b]) => !b.dryRun)).toHaveLength(0);
        fireEvent.click(within(banner).getByRole('button', { name: 'Save to deployment' }));
        expect((await screen.findByTestId('confirm-compare')).textContent).toMatch(/the deployment's settings \+₹12,000 over 20 trades; these \+₹15,500 over 20 \(\+₹3,500\)\./);
        fireEvent.click(screen.getAllByRole('button', { name: 'Save to deployment' }).find((b) => !banner.contains(b)));
        await waitFor(() => expect(axios.patch.mock.calls.filter(([, b]) => !b.dryRun)).toHaveLength(1));
        expect(axios.patch.mock.calls.find(([, b]) => !b.dryRun)[1].params).toMatchObject({ leg_sl_x: 1.5, max_loss_rupees: 0, tp_pct_credit: 20 });
    });

    it('a change after the backtest says the comparison is out of date', async () => {
        render(<MemoryRouter initialEntries={[link]}><MultiLeg /></MemoryRouter>);
        const banner = await screen.findByTestId('editing-deployment', {}, { timeout: 5000 });
        await within(banner).findByTestId('edit-compare', {}, { timeout: 5000 });
        const input = screen.getByLabelText('leg_sl_x');
        expect(input.value).toBe('1.5');
        fireEvent.change(input, { target: { value: '1.6' } });
        await waitFor(() => expect(within(banner).getByTestId('edit-compare').textContent).toMatch(/The settings changed after this backtest ran/));
    });
});

describe('Backtest & update… on a STOPPED deployment (18-Nov-2026: "we should be able to update and backtest")', () => {
    beforeEach(() => { axios.patch.mockClear(); axios.post.mockClear(); });
    const TRY = JSON.stringify({ key: 'tp_pct_credit', combo: { legSlX: 1.5, maxLoss: 20000, tp: 20 }, label: '★ Best net', from: '2026-10-23', source: 'archive',
        whatIf: { trades: 18, net: 36062, worst: -5527, currentNet: 15738, currentWorst: -7668 } });
    const linkTo = (id) => `/multi-leg?${new URLSearchParams({ tab: 'backtest', edit: id, try: TRY })}`;
    const backtests = () => axios.post.mock.calls.filter(([u]) => /\/multileg\/backtest$/.test(u)).map(([, b]) => b);

    it('opens it from the database with ALL its settings, backtests both, says it is stopped, and can still save', async () => {
        render(<MemoryRouter initialEntries={[linkTo('6ad54e26321a45ac642d5012')]}><MultiLeg /></MemoryRouter>);
        const banner = await screen.findByTestId('editing-deployment', {}, { timeout: 5000 });
        expect(banner.textContent).toMatch(/Editing deployment “nifty-atm-straddle \(LIVE\)” \(PAPER · stopped · flat\)/);
        expect(within(banner).getByTestId('editing-stopped').textContent).toMatch(/You can still backtest and save changes: they act once you start it again/);
        expect(axios.get.mock.calls.some(([u]) => /\/multileg\/deployments\/6ad54e26321a45ac642d5012$/.test(u))).toBe(true);
        await waitFor(() => expect(backtests()).toHaveLength(2), { timeout: 5000 });
        const [mine, these] = backtests();
        // every setting the deployment runs, its size included — then only the combination's three differ
        const own = { entry_time: '09:20', square_off: '15:10', tp_pct_credit: 35, sl_x_credit: 1.5, leg_sl_x: 1.4, max_loss_rupees: 20000, lots: 2 };
        expect(mine).toMatchObject({ template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', from: '2026-10-23', chain_source: 'archive' });
        expect(mine.params).toEqual({ ...TEMPLATE.defaults, ...own });
        expect(these.params).toEqual({ ...TEMPLATE.defaults, ...own, leg_sl_x: 1.5, tp_pct_credit: 20 });
        expect([these.template, these.symbol, these.from, these.to, these.resolution, these.chain_source]).toEqual([mine.template, mine.symbol, mine.from, mine.to, mine.resolution, mine.chain_source]);
        // the dry run goes to this deployment; saving needs the confirmation
        await waitFor(() => expect(axios.patch.mock.calls.length).toBeGreaterThan(0));
        const [url, dry] = axios.patch.mock.calls.at(-1);
        expect(url).toMatch(/\/multileg\/deployments\/6ad54e26321a45ac642d5012$/);
        expect(dry).toMatchObject({ dryRun: true, lots: 2, params: { leg_sl_x: 1.5, tp_pct_credit: 20, max_loss_rupees: 20000, sl_x_credit: 1.5, square_off: '15:10' } });
        fireEvent.click(within(banner).getByRole('button', { name: 'Save to deployment' }));
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save to deployment' }).length).toBe(2));
        expect(screen.getByText(/It is stopped: nothing acts until you start it again\./)).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: 'Save to deployment' }).find((b) => !banner.contains(b)));
        await waitFor(() => expect(axios.patch.mock.calls.filter(([, b]) => !b.dryRun)).toHaveLength(1));
    });

    it('a deleted deployment says so, instead of "not running any more"', async () => {
        render(<MemoryRouter initialEntries={[linkTo('6af000000000000000000000')]}><MultiLeg /></MemoryRouter>);
        expect(await screen.findByText(/Deployment 6af000000000000000000000 has been deleted, so there are no settings to backtest or update/, {}, { timeout: 5000 })).toBeTruthy();
        expect(screen.queryByTestId('editing-deployment')).toBeNull();
        expect(axios.post.mock.calls.filter(([u]) => /\/multileg\/backtest$/.test(u))).toHaveLength(0);
    });

    it('a backend older than the page: falls back to what its engine lists, and says when that is not enough', async () => {
        globalThis.__oldBackend = true;
        try {
            const { unmount } = render(<MemoryRouter initialEntries={[`/multi-leg?${new URLSearchParams({ tab: 'backtest', edit: 'dep1', try: TRY })}`]}><MultiLeg /></MemoryRouter>);
            const banner = await screen.findByTestId('editing-deployment', {}, { timeout: 5000 });
            expect(banner.textContent).toMatch(/Editing deployment “nifty-atm-straddle” \(PAPER · flat\)/);
            unmount();
            render(<MemoryRouter initialEntries={[linkTo('6ad54e26321a45ac642d5012')]}><MultiLeg /></MemoryRouter>);
            expect(await screen.findByText(/is not loaded on this server, and this server's backend is too old to read a stopped deployment from the database\. Update the backend/, {}, { timeout: 5000 })).toBeTruthy();
        } finally { delete globalThis.__oldBackend; }
    });
});
