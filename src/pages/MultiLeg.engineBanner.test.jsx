/**
 * The Deploy tab's engine banner tells three states apart (31-Oct-2026: on dev, with the
 * engines switched off by DISABLE_TRADING_ENGINES, "Resume engine" did nothing — it only
 * lifts a halt, and the engine was never started):
 *   off by configuration → a quiet status line, no Resume button
 *   halted               → red, Resume engine
 *   enabled but not running → red, a restart is needed, no Resume button
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let status = {};
const post = vi.fn(() => Promise.resolve({ data: { ok: true, changed: false, message: 'engine was not halted' } }));
vi.mock('axios', () => {
    const get = vi.fn((url) => Promise.resolve({ data: /\/multileg\/status$/.test(url) ? status : /deployments|strategies|templates/.test(url) ? [] : {} }));
    const empty = () => Promise.resolve({ data: [] });
    const api = {
        get, post: (...a) => post(...a), put: vi.fn(empty), delete: vi.fn(empty), patch: vi.fn(empty),
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
import MultiLeg from './MultiLeg.jsx';

const renderDeploy = () => render(<MemoryRouter initialEntries={['/multi-leg?tab=deploy']}><MultiLeg /></MemoryRouter>);

describe('Multi-leg engine banner', () => {
    beforeEach(() => { post.mockClear(); });

    it('engines off by configuration: says so, names the setting, offers no Resume', async () => {
        status = { started: false, enabled: false, disabledBy: 'DISABLE_TRADING_ENGINES=true', halted: false, deployments: 0 };
        renderDeploy();
        const b = await screen.findByTestId('engine-health', {}, { timeout: 5000 });
        expect(b.textContent).toMatch(/Trading engines are switched off on this server \(DISABLE_TRADING_ENGINES=true\)/);
        expect(b.textContent).toMatch(/change that setting and restart/);
        expect(b.getAttribute('role')).toBe('status');
        expect(screen.queryByRole('button', { name: /Resume engine/ })).toBeNull();
    });

    it('halted: red, with Resume; a resume that changed nothing is not reported as a success', async () => {
        status = { started: true, enabled: true, halted: true, deployments: 0 };
        renderDeploy();
        const btn = await screen.findByRole('button', { name: /Resume engine/ }, { timeout: 5000 });
        fireEvent.click(btn);
        await waitFor(() => expect(post).toHaveBeenCalled());
        expect(post.mock.calls[0][0]).toMatch(/\/engine\/resume$/);
        expect(await screen.findByText('engine was not halted')).toBeTruthy();
    });

    it('enabled but not running: red, a restart is needed, no Resume', async () => {
        status = { started: false, enabled: true, halted: false, deployments: 0 };
        renderDeploy();
        const b = await screen.findByTestId('engine-health', {}, { timeout: 5000 });
        expect(b.textContent).toMatch(/ENGINE NOT RUNNING/);
        expect(b.textContent).toMatch(/needs a server restart/);
        expect(screen.queryByRole('button', { name: /Resume engine/ })).toBeNull();
    });
});
