/**
 * Testing several alerts on history at once — the Alerts tab's contract:
 * tick alerts, start ONE batch replay with each alert's own settings, and read
 * the comparison (one row per alert, the luck warning, any row in full).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const ALERTS = [
    { _id: 'a1', name: 'PB drop', query: 'pb_change_5d_pct <= -10', universe: 'NIFTY500', minTurnoverCr: 2, sortBy: 'pb', sortDir: 'asc', times: ['08:45'], days: [1, 2, 3, 4, 5], live: 'auto', enabled: true, notifyTelegram: true, notifyOn: 'new', cooldownDays: 3 },
    { _id: 'a2', name: 'Volume spike', query: 'volume_ratio >= 3', universe: 'ALL', minTurnoverCr: 1, sortBy: null, sortDir: 'desc', times: ['20:30'], days: [1, 2, 3, 4, 5], live: 'auto', enabled: true, notifyTelegram: false, notifyOn: 'new', cooldownDays: 3 },
];
const horizon = (mean, t, verdict) => ({ n: 40, days: 30, meanExcessPct: mean, meanExcessByDayPct: mean, medianExcessPct: mean, beatBenchmarkPct: 55, meanRawPct: 1, winRawPct: 52, tStatByDay: t, verdict, byMonth: [{ month: '2026-08', n: 12, meanExcessPct: mean }], tradeCount: 40 });
const result = (mean, t, verdict) => ({ mode: 'stocks', from: '2025-09-01', to: '2026-09-25', sessions: 250, evaluableFrom: '2025-09-01', mostlyUnknownSessions: 0, newOnly: true, horizons: [5, 10], signals: 40, signalDays: 30, maxPerDay: 0, sortBy: null,
    byHorizon: { 5: horizon(mean / 2, t / 2, verdict), 10: horizon(mean, t, verdict) }, excluded: { incomplete: 0, noNextOpen: 0, corpAction: 0, noExitClose: 0, overDailyCap: 0 }, conventions: 'entry next open', maxHorizon: 10 });
const DONE = {
    id: 'rp_batch', kind: 'batch', status: 'done', threads: 2, timing: { totalMs: 12000, threads: 2 },
    params: { sessions: 250, horizons: [5, 10], items: ALERTS.map(a => ({ key: a._id, name: a.name })) },
    result: { mode: 'batch', items: [
        { key: 'a1', name: 'PB drop', result: result(-0.4, -2.3, 'LAGGED the universe') },
        { key: 'a2', name: 'Volume spike', result: result(0.9, 2.6, 'beat the universe in this window — re-test before trusting it') },
    ] },
};

const PRESETS = [
    { id: 'pb_drop', category: 'Book value', name: 'PB fell 10%', why: 'x', query: 'pb_change_5d_pct <= -10', universe: 'ALL', minTurnoverCr: 1, sortBy: 'pb_change_5d_pct', sortDir: 'asc', times: ['08:45'], evidence: { status: 'untested' } },
    { id: 'vol_spike', category: 'Price & volume', name: 'Volume spike', why: 'y', query: 'volume_ratio >= 3', universe: 'ALL', minTurnoverCr: 2, sortBy: 'volume_ratio', sortDir: 'desc', times: ['08:45'], evidence: { status: 'untested' } },
    { id: 'gap_up', category: 'Price & volume', name: 'Gap up', why: 'z', query: 'gap_pct >= 3', universe: 'NIFTY500', minTurnoverCr: 0, sortBy: 'gap_pct', sortDir: 'desc', times: ['08:45'], evidence: { status: 'untested' } },
];
const calls = { posts: [], gets: [] };
vi.mock('axios', () => {
    const route = (url, cfg) => {
        const path = url.replace(/^.*\/screener/, '');
        if (path === '/alerts') return { alerts: ALERTS };
        if (path === '/status') return { scanner: { limits: { maxBatch: 500, maxReplaySessions: 1500, replayThreads: 2 } }, coverage: { sessions: 500, lastSession: '2026-09-25' } };
        if (path === '/fields') return { fields: [] };
        if (path === '/presets') return { presets: PRESETS };
        if (path === '/universes') return { universes: [{ key: 'ALL', label: 'All stocks' }, { key: 'NIFTY500', label: 'NIFTY 500' }] };
        if (path === '/replay/rp_batch') {
            if (cfg?.params?.item) return { item: { ...DONE.result.items.find(x => x.key === cfg.params.item), result: { ...DONE.result.items.find(x => x.key === cfg.params.item).result, recentSignals: [] } } };
            return DONE;
        }
        return [];
    };
    const api = {
        get: vi.fn((url, cfg) => { calls.gets.push([url, cfg]); return Promise.resolve({ data: route(url, cfg) }); }),
        post: vi.fn((url, body) => { calls.posts.push([url, body]); return Promise.resolve({ data: url.endsWith('/replay/batch') ? { jobId: 'rp_batch', items: 2, notRunnable: 0 } : {} }); }),
        put: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })),
        defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import Alerts from './Alerts.jsx';

describe('Alerts tab — test several alerts on history', () => {
    beforeEach(() => { calls.posts.length = 0; calls.gets.length = 0; });

    it('replays the ticked alerts together with their own settings and shows one row each', async () => {
        render(<MemoryRouter initialEntries={['/alerts?tab=alerts']}><Alerts /></MemoryRouter>);
        const pb = await screen.findByRole('checkbox', { name: 'Include PB drop in the history test' });
        const button = screen.getByRole('button', { name: /Test on history/ });
        expect(button).toBeDisabled();
        fireEvent.click(pb);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include Volume spike in the history test' }));
        fireEvent.change(screen.getByLabelText('Sell after'), { target: { value: '5, 10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test 2 together' }));

        await waitFor(() => expect(calls.posts.some(([u]) => u.endsWith('/replay/batch'))).toBe(true));
        const [, body] = calls.posts.find(([u]) => u.endsWith('/replay/batch'));
        expect(body.horizons).toEqual([5, 10]);
        expect(body.sessions).toBe(250);
        expect(body.items).toEqual([{ key: 'a1', alertId: 'a1' }, { key: 'a2', alertId: 'a2' }]);   // the server looks up each alert's settings

        // The first poll returns the finished batch: strongest t first, and the luck warning.
        await screen.findByText('Alerts tested together', {}, { timeout: 4000 });
        await waitFor(() => expect(screen.getAllByRole('button', { name: /Volume spike|PB drop/ })).toHaveLength(2), { timeout: 4000 });
        const rows = screen.getAllByRole('button', { name: /Volume spike|PB drop/ });
        expect(rows[0].textContent).toContain('Volume spike');
        expect(screen.getByText(/clears \|t\| ≥ 2 by luck alone/)).toBeTruthy();

        // A row opens that alert's full single-replay view.
        fireEvent.click(rows[1]);
        await waitFor(() => expect(calls.gets.some(([u, cfg]) => u.endsWith('/replay/rp_batch') && cfg?.params?.item === 'a1')).toBe(true));
        expect(await screen.findByText(/Excluded:/)).toBeTruthy();
    });

    it('screener page: tick starting points in any category, test them together, results open under the card', async () => {
        render(<MemoryRouter initialEntries={['/alerts']}><Alerts /></MemoryRouter>);
        const go = () => screen.getByRole('button', { name: /Test ticked on history|Test \d+ together/ });
        await screen.findByRole('checkbox', { name: 'Test PB fell 10% on history' });
        expect(go()).toBeDisabled();
        expect(screen.getByText(/Tick/, { selector: 'p' })).toBeTruthy();   // the 1-2-3 how-to while nothing is ticked
        fireEvent.click(screen.getByRole('checkbox', { name: 'Test PB fell 10% on history' }));
        // Switch category: the tick is kept; "Tick all shown" adds this category's two.
        fireEvent.click(screen.getByRole('button', { name: /^Price & volume/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Tick all 2 shown' }));
        expect(screen.getByText('3 ticked')).toBeTruthy();
        // Remove one through its chip in the bar.
        fireEvent.click(screen.getByRole('button', { name: /Gap up remove/ }));
        expect(screen.getByText('2 ticked')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Sessions', { selector: '#sp-sessions' }), { target: { value: '300' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test 2 together' }));

        await waitFor(() => expect(calls.posts.some(([u]) => u.endsWith('/replay/batch'))).toBe(true));
        const [, body] = calls.posts.find(([u]) => u.endsWith('/replay/batch'));
        expect(body.items).toEqual([{ key: 'pb_drop', presetId: 'pb_drop' }, { key: 'vol_spike', presetId: 'vol_spike' }]);
        expect(body.sessions).toBe(300);
        expect(await screen.findByText('Starting points tested together')).toBeTruthy();
    });
});
