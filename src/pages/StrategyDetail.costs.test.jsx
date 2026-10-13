/**
 * Per-deployment results: the cost of trading (honest about how many trades
 * recorded charges), worst/best point columns, and paging instead of a
 * silent 200-row cap.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const at = (iso) => new Date(iso).toISOString();
const mk = (i, over = {}) => ({
    _id: `t${i}`, status: 'CLOSED', action: 'ENTRY', tradingsymbol: 'NSE:BANKNIFTY26OCT55200CE', symbol: 'NSE:NIFTYBANK-INDEX',
    type: 'CE', quantity: 30, entryPrice: 100, exitPrice: 110,
    entryTime: at(`2026-10-0${1 + (i % 8)}T05:00:00Z`), exitTime: at(`2026-10-0${1 + (i % 8)}T05:10:00Z`),
    pnl: 300, gross_pnl: 300, net_pnl: 211, ...over,
});
const trades = [
    mk(0, { charges: { total: 89, gross_pnl: 300 }, maeRupees: -420, mfeRupees: 650 }),
    ...Array.from({ length: 59 }, (_, i) => mk(i + 1)),        // older rows: no charges, no marks
];

vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/\/trades$/.test(url)) return Promise.resolve({ data: { trades, total: trades.length, pathCoverage: null } });
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

import StrategyDetail from './StrategyDetail.jsx';

const renderPage = () => render(
    <MemoryRouter initialEntries={['/strategy/NSE%3ANIFTYBANK-INDEX']}>
        <Routes><Route path="/strategy/:symbol" element={<StrategyDetail />} /></Routes>
    </MemoryRouter>,
);

describe('StrategyDetail — costs, worst/best, paging', () => {
    it('states the cost of trading over the trades that recorded charges, and says how many did', async () => {
        renderPage();
        const line = await screen.findByText((_, el) => el?.tagName === 'P' && /^Charges took 30% of gross profit on the 1 of 60 trades/.test(el.textContent));
        expect(line).toBeInTheDocument();
    });

    it('shows worst/best and charges where recorded, — where not, and pages the rest', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('tab', { name: /Trades/ }));
        const table = screen.getByRole('table');
        fireEvent.click(within(table).getByRole('button', { name: /Worst/ }));        // sort by MAE: recorded first
        const first = within(table).getAllByRole('row')[1];
        expect(within(first).getByText('-₹420')).toBeInTheDocument();
        expect(within(first).getByText('₹650')).toBeInTheDocument();
        expect(within(first).getByText('₹89')).toBeInTheDocument();
        expect(screen.getByText('Showing 1–50 of 60 trades')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
        expect(screen.getByText('Showing 51–60 of 60 trades')).toBeInTheDocument();
    });
});
