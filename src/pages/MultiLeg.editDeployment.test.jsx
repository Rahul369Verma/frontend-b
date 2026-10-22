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
import { deploymentEditBody, editBlocker, changeLine } from '../components/multileg/deploymentEditFormat.js';

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
const PLAN = { ok: true, dryRun: true, open: false, changes: [{ key: 'max_loss_rupees', before: 3000, after: 3000, appliesTo: 'the next entry' }, { key: 'leg_sl_x', before: 1.4, after: 1.3, appliesTo: 'the next entry' }] };

vi.mock('axios', () => {
    const answer = (url) => {
        if (/\/multileg\/templates$/.test(url)) return [TEMPLATE];
        if (/\/multileg\/deployments$/.test(url)) return { deployments: [DEP], events: [] };
        return [];
    };
    const get = vi.fn((url) => Promise.resolve({ data: answer(url) }));
    const patch = vi.fn((url, body) => Promise.resolve({ data: body.dryRun ? PLAN : { ok: true, changes: PLAN.changes } }));
    const empty = () => Promise.resolve({ data: [] });
    const api = {
        get, patch, post: vi.fn(empty), put: vi.fn(empty), delete: vi.fn(empty),
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
    it('each change says what it was, what it becomes, and when it acts', () => {
        expect(changeLine({ key: 'leg_sl_x', before: 1.4, after: 1.3, appliesTo: 'the open structure, at its next check' })).toBe('leg_sl_x: 1.4 → 1.3 — the open structure, at its next check');
        expect(changeLine({ key: 'max_loss_rupees', before: null, after: 2500, appliesTo: 'x' })).toBe('max_loss_rupees: default → 2500 — x');
    });
});

describe('Edit a deployment from its card', () => {
    beforeEach(() => { axios.patch.mockClear(); });
    it('loads it into the builder, asks the server what would change, confirms, then saves', async () => {
        render(<MemoryRouter initialEntries={['/multi-leg?tab=deploy']}><MultiLeg /></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit nifty-atm-straddle' }, { timeout: 5000 }));
        const banner = await screen.findByTestId('editing-deployment');
        expect(banner.textContent).toMatch(/Editing deployment “nifty-atm-straddle” \(PAPER · flat\)/);
        fireEvent.click(within(banner).getByRole('button', { name: 'Save to deployment' }));
        // the dry run first — nothing is saved before the confirmation
        await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(1));
        const [url, dry] = axios.patch.mock.calls[0];
        expect(url).toMatch(/\/multileg\/deployments\/dep1$/);
        expect(dry.dryRun).toBe(true);
        expect(dry.lots).toBe(1);
        expect(dry.params.max_loss_rupees).toBe(3000);
        expect(dry.params.leg_sl_x).toBe(1.4);
        expect(await screen.findByText('leg_sl_x: 1.4 → 1.3 — the next entry')).toBeTruthy();
        const dialogSave = screen.getAllByRole('button', { name: 'Save to deployment' }).find((b) => !banner.contains(b));
        fireEvent.click(dialogSave);
        await waitFor(() => expect(axios.patch).toHaveBeenCalledTimes(2));
        expect(axios.patch.mock.calls[1][1].dryRun).toBeUndefined();
        await waitFor(() => expect(screen.queryByTestId('editing-deployment')).toBeNull());
    });
});
