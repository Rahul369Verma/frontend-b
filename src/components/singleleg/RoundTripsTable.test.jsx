/**
 * Single-leg round trips / Trade History: every row says what it is — the gate verdict
 * that let it through in Enforce mode, net vs "before charges", a void index-price row
 * struck through with its reason, an old ENTRY row with no P&L — and a row opens into
 * its path, India VIX and the no-stop replay.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const view = (o) => ({ kind: 'closed', mode: 'PAPER', entryMs: Date.parse('2026-10-19T07:55:14Z'), exitMs: Date.parse('2026-10-19T09:42:30Z'), holdMs: 6436000, net: -1798.21, basis: 'net', gross: -1731, charges: 67.21, optionType: 'PE', side: 'long', contract: 'NSE:FINNIFTY26OCT24950PE', strategy: 'breakout_range', gate: null, flags: [], void: false, ...o });
const ROWS = [
    { trade_id: '6ad5cce23b15eab2beb0a934', _id: '6ad5cce23b15eab2beb0a934', status: 'CLOSED', spotSymbol: 'NSE:FINNIFTY-INDEX', deploymentId: 'd1', quantity: 60, entryPrice: 201.3, exitPrice: 172.45, reason: 'SL Hit', maeRupees: -1560, mfeRupees: 165, entryTime: '2026-10-19T07:55:14Z', exitTime: '2026-10-19T09:42:30Z', tpPoints: 54,
        view: view({ gate: { decision: 'PROBE', mode: 'enforce', enforced: false, confidence: 0.329, floor: 0.4 } }) },
    { trade_id: '6ad5960c3b15eab2beafe7be', _id: '6ad5960c3b15eab2beafe7be', status: 'CLOSED', spotSymbol: 'NSE:MIDCPNIFTY-INDEX', deploymentId: 'd2', quantity: 120, entryPrice: 195.4, exitPrice: 153.45, reason: 'SL Hit (tick)',
        symbol: 'NSE:MIDCPNIFTY26OCT13675PE', type: 'PE', direction: 1, pnl: -5034, net_pnl: -5117.66, entryTime: '2026-10-19T04:01:16Z', exitTime: '2026-10-19T04:22:39Z', entry_vix: { intraday: 14.9, prevClose: 14.06 }, exit_vix: { intraday: null, prevClose: 14.06 },
        view: view({ net: -5117.66, contract: 'NSE:MIDCPNIFTY26OCT13675PE', strategy: 'inside_bar', gate: { decision: 'ALLOW', mode: 'enforce', confidence: 0.508, floor: 0.4 } }) },
    { trade_id: '696f2234a0d58f2aadd9916c', _id: '696f2234a0d58f2aadd9916c', action: 'EXIT', price: 13468.55, quantity: 35, reason: 'Circuit Breaker (Max Loss)',
        view: view({ kind: 'legacy-exit', mode: 'LIVE', net: -467034.75, basis: 'gross', gross: null, charges: null, void: true, contract: 'NSE:MIDCPNIFTY26JAN13475PE', strategy: null,
            flags: [{ code: 'legacy', label: 'old format', why: 'old' }, { code: 'price-is-index', label: 'index price, not premium', why: 'The exit price ₹13,468.55 is the index level' }] }) },
    { trade_id: '69afa4de56ab302d79c9bd06', _id: '69afa4de56ab302d79c9bd06', action: 'ENTRY', price: 562.8, quantity: 60, reason: 'RL Agent',
        view: view({ kind: 'legacy-entry', mode: 'SIMULATED-LIVE', net: null, basis: null, gross: null, charges: null, exitMs: null, holdMs: null, flags: [{ code: 'legacy', label: 'old format', why: 'old' }] }) },
];
const PAGE = { rows: ROWS, total: 4, matched: 4, page: 0, pageSize: 20, pages: 1, exitReasons: [{ reason: 'SL Hit', n: 1 }] };
const REPLAY = { ok: true, exitKind: 'stop', booked: { net: -5117.66, reason: 'SL Hit (tick)', at: '2026-10-19T04:22:39Z' }, atExit: { gross: -4650, at: '2026-10-19T04:21:40Z' },
    held: { kind: 'TIME_EXIT', gross: 4524, at: '2026-10-19T09:44:51Z', target: 262.22 }, exitEffect: -9174, afterExit: { marks: 282, best: 5370, worst: -9396, bestAt: '2026-10-19T09:41:26Z', wentPositive: true },
    timeExit: '15:15', timeExitSource: "the deployment's settings", marks: 300, path: [{ t: '2026-10-19T04:01:30Z', net: 0 }, { t: '2026-10-19T09:44:51Z', net: 4524 }], caveats: [] };

const get = vi.fn((u) => {
    const url = String(u || '');
    if (url.endsWith('/trades/page')) return Promise.resolve({ data: PAGE });
    if (url.includes('/journey')) return Promise.resolve({ data: { trade: { ...ROWS[1], path: [{ t: '2026-10-19T04:01:30Z', net: 0, ltp: 195.4 }, { t: '2026-10-19T04:21:40Z', net: -4650, ltp: 156.65 }] }, pathSource: 'recorded' } });
    if (url.includes('/stop-whatif')) return Promise.resolve({ data: REPLAY });
    if (url.includes('/market/vix-days')) return Promise.resolve({ data: { days: { '2026-10-19': { day: '2026-10-19', intraday: null, reason: 'no Fyers access token in memory' } }, warnings: [] } });
    return Promise.resolve({ data: {} });
});
vi.mock('axios', () => {
    const api = { get: (...a) => get(...a), post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import RoundTripsTable from './RoundTripsTable.jsx';

describe('RoundTripsTable', () => {
    beforeEach(() => get.mockClear());

    it('says how an Enforce-mode trade got through: Allowed above the floor, or a Probe', async () => {
        render(<RoundTripsTable history />);
        const probe = await screen.findByText('Probe · 33%');
        expect(probe.getAttribute('title')).toMatch(/let through on purpose/);
        expect(screen.getByText('Allowed · 51%').getAttribute('title')).toMatch(/at or above the 40% floor/);
        expect(get.mock.calls[0][1].params).toMatchObject({ status: 'all', sort: 'exit', dir: 'desc', page: 0 });
    });

    it('a void index-price row is struck through with its reason; an old ENTRY row has no P&L', async () => {
        render(<RoundTripsTable history />);
        const flag = await screen.findByText('index price, not premium');
        expect(flag.getAttribute('title')).toMatch(/index level/);
        const voidRow = flag.closest('tr');
        expect(within(voidRow).getByText('-₹4,67,035').className).toMatch(/line-through/);
        expect(within(voidRow).getByText('void')).toBeTruthy();
        const entryRow = screen.getByText('OLD · ENTRY').closest('tr');
        expect(within(entryRow).getByText('entry row')).toBeTruthy();
        expect(within(entryRow).getByText('SIMULATED-LIVE')).toBeTruthy();
    });

    it('opens a row into its path, says why VIX is missing, and replays it with no stop', async () => {
        render(<RoundTripsTable history />);
        fireEvent.click((await screen.findByText('Allowed · 51%')).closest('tr'));
        await screen.findByTestId('single-journey');
        expect(await screen.findByText(/India VIX not drawn: no Fyers access token in memory/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /What if the stop had not hit/ }));
        expect(await screen.findByText('The stop COST ₹9,174 against holding on.')).toBeTruthy();
        expect(screen.getByText(/came back into profit/)).toBeTruthy();
        expect(get.mock.calls.some(([u]) => u.endsWith('/trades/6ad5960c3b15eab2beafe7be/stop-whatif'))).toBe(true);
    });

    it('sends the filter bar, search and sort to the server', async () => {
        render(<RoundTripsTable filters={{ deploymentId: 'd1', days: 30 }} />);
        await screen.findByText('Probe · 33%');
        expect(get.mock.calls[0][1].params).toMatchObject({ status: 'closed', deploymentId: 'd1', days: 30 });
        fireEvent.click(screen.getByRole('button', { name: /^Net/ }));
        await screen.findByText('Probe · 33%');
        expect(get.mock.calls.at(-1)[1].params).toMatchObject({ sort: 'net', dir: 'desc' });
    });
});
