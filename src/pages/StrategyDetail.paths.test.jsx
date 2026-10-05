/**
 * Single-leg results: every trade row opens its own P&L path, the page asks the
 * server for paths (opt-in withPath=1), says where they came from, and draws a
 * day-by-day curve over the same closed trades.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const at = (iso) => new Date(iso).toISOString();
const trades = [
    {
        _id: 'a1', status: 'CLOSED', action: 'ENTRY', tradingsymbol: 'NSE:BANKNIFTY26SEP54300PE', symbol: 'NSE:NIFTYBANK-INDEX',
        side: 'PUT', type: 'PE', direction: 1, quantity: 120, entryPrice: 136.2, exitPrice: 134.2,
        entryTime: at('2026-09-28T04:00:00Z'), exitTime: at('2026-09-28T04:10:00Z'),
        pnl: -240, gross_pnl: -240, net_pnl: -300,
        pathSource: 'archive', maeRupees: -420, mfeRupees: 120,
        path: [
            { t: at('2026-09-28T04:00:00Z'), net: 0, ltp: 136.2 },
            { t: at('2026-09-28T04:05:00Z'), net: -420, ltp: 132.7 },
            { t: at('2026-09-28T04:09:00Z'), net: -240, ltp: 134.2 },
        ],
    },
    {
        _id: 'a2', status: 'CLOSED', action: 'ENTRY', tradingsymbol: 'NSE:BANKNIFTY26SEP54500CE', symbol: 'NSE:NIFTYBANK-INDEX',
        side: 'CALL', type: 'CE', quantity: 120, entryPrice: 140, exitPrice: 145,
        entryTime: at('2026-09-25T05:00:00Z'), exitTime: at('2026-09-25T06:00:00Z'),
        pnl: 600, gross_pnl: 600, net_pnl: 500,
        pathSource: null, pathReason: 'no archive for that day',
    },
];
const pathCoverage = { recorded: 0, archive: 1, none: 1, capped: 0, reasons: { 'no archive for that day': 1 } };

vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/\/trades$/.test(url)) return Promise.resolve({ data: { trades, total: 2, pathCoverage } });
        if (/\/deployments$/.test(url)) return Promise.resolve({ data: [] });
        return Promise.resolve({ data: {} });
    });
    const api = {
        get, post: vi.fn(() => Promise.resolve({ data: {} })), put: vi.fn(() => Promise.resolve({ data: {} })),
        delete: vi.fn(() => Promise.resolve({ data: {} })), patch: vi.fn(() => Promise.resolve({ data: {} })),
        defaults: { headers: { common: {} }, withCredentials: true },
        interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import axios from 'axios';
import StrategyDetail from './StrategyDetail.jsx';

const renderPage = () => render(
    <MemoryRouter initialEntries={['/strategy/NSE%3ANIFTYBANK-INDEX']}>
        <Routes><Route path="/strategy/:symbol" element={<StrategyDetail />} /></Routes>
    </MemoryRouter>,
);

describe('StrategyDetail — per-trade paths and day-by-day curves', () => {
    beforeEach(() => { axios.get.mockClear(); });

    it('asks the trades endpoint for paths (withPath=1)', async () => {
        renderPage();
        await waitFor(() => expect(axios.get.mock.calls.some(([u]) => /\/trades$/.test(u))).toBe(true));
        const [, cfg] = axios.get.mock.calls.find(([u]) => /\/trades$/.test(u));
        expect(cfg.params.withPath).toBe(1);
    });

    it('each trade row expands to its own path chart, with the source and coverage stated', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('tab', { name: /Trades/ }));
        expect(screen.getByText(/Trade paths:/).textContent).toMatch(/1 rebuilt from archived quotes/);
        expect(screen.getByText(/Trade paths:/).textContent).toMatch(/no archive for that day: 1/);

        const t1 = screen.getByRole('button', { name: /Show P&L path for BANKNIFTY26SEP54300PE/ });
        expect(t1.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(t1);
        expect(t1.getAttribute('aria-expanded')).toBe('true');
        const panel = document.getElementById(t1.getAttribute('aria-controls'));
        expect(within(panel).getByText('rebuilt from archived quotes')).toBeTruthy();
        expect(within(panel).getByText(/Exit step -₹60/)).toBeTruthy();

        const t2 = screen.getByRole('button', { name: /Show P&L path for BANKNIFTY26SEP54500CE/ });
        fireEvent.click(t2);
        const panel2 = document.getElementById(t2.getAttribute('aria-controls'));
        expect(within(panel2).getByText('no archive for that day')).toBeTruthy();
    });

    it('the Day by day tab draws one row per IST day over the closed trades', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('tab', { name: /Day by day/ }));
        const mon = await screen.findByRole('button', { name: /Mon 28 Sep 2026/ });
        const fri = screen.getByRole('button', { name: /Fri 25 Sep 2026/ });
        // Day totals are the booked net (net_pnl), not the naive price move.
        expect(within(mon).getByText('-₹300')).toBeTruthy();
        expect(within(fri).getByText('+₹500')).toBeTruthy();
        expect(within(fri).getByText('booked only')).toBeTruthy();
    });
});
