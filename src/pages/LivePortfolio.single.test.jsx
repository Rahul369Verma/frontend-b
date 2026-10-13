/**
 * Live Portfolio, single-leg view: the parts it gained alongside the multi-leg
 * redesign — open positions, the cost of trading (with coverage), breakdown
 * rows that open into deployments, a small-sample chip, and how trades travelled.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const row = (key, over = {}) => ({ key, trades: 3, net: 900, perTrade: 300, winRate: 67, best: 500, worst: -100, lastTradeAt: '2026-10-13T05:55:00Z', gross: 1200, charges: 300, chargesN: 3, costPct: 25, ...over });
const DATA = {
    summary: { trades: 3, netPnl: 900, perTrade: 300, winRate: 67, avgWin: 500, avgLoss: -100, profitFactor: 2, maxDrawdown: -100, tradingDays: 2, bestDay: 600, worstDay: 300,
        costs: { n: 10, covered: 3, gross: 1200, charges: 300, costPct: 25 } },
    daily: [{ date: '2026-10-13', net: 900, trades: 3, winRate: 67, equity: 900, drawdown: 0 }],
    breakdowns: [
        { label: 'Strategy', rows: [row('universal', { children: [row('d1', { deploymentId: 'd1', trades: 2 }), row('no deployment (symbol-config mode)', { deploymentId: null, trades: 1 })] })] },
        { label: 'Deployment', rows: [row('d1')] },
    ],
    excursions: { n: 1, missing: 2, giveBackMedianPct: 40, inProfitN: 1, deep: [], stopIf: [], targetIf: [], points: [[-200, 500, 300]] },
    open: { n: 1, mtm: -450, unmarked: 0, rows: [{ deploymentId: 'd1', strategyName: 'universal', symbol: 'NSE:BANKNIFTY26OCT55200CE', type: 'CE', entryTime: '2026-10-13T05:50:00Z', entryPrice: 100, ltp: 85, mtm: -450 }] },
    groups: {
        strategy: [{ key: 'universal', summary: { trades: 3, netPnl: 900, perTrade: 300, winRate: 67, profitFactor: 2, net7d: 900, net30d: 900 }, daily: [], symbols: ['NIFTYBANK'], exitReasons: [], deployments: ['d1'] }],
        deployment: [{ key: 'd1', meta: { name: 'uni_opti_bn', strategyName: 'universal', symbol: 'NSE:NIFTYBANK-INDEX', mode: 'PAPER', active: true }, summary: { trades: 2, netPnl: 600 }, daily: [] }],
    },
};

vi.mock('axios', () => {
    const get = vi.fn(() => Promise.resolve({ data: DATA }));
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import LivePortfolio from './LivePortfolio.jsx';
const renderPage = () => render(<MemoryRouter initialEntries={['/live-portfolio?view=single']}><LivePortfolio /></MemoryRouter>);

describe('LivePortfolio single-leg view', () => {
    beforeEach(() => localStorage.clear());

    it('shows what is open and the cost of trading, honest about coverage', async () => {
        renderPage();
        expect(await screen.findByText('1 position')).toBeInTheDocument();
        expect(screen.getByText((_, el) => el?.tagName === 'P' && /^Charges took 25% of gross profit on the 3 of 10 trades that recorded charges/.test(el.textContent))).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show list' }));
        expect(screen.getByRole('link', { name: 'uni_opti_bn' })).toBeInTheDocument();
    });

    it('labels a strategy with too few trades to judge', async () => {
        renderPage();
        expect(await screen.findByText('too few to judge (3/20)')).toBeInTheDocument();
    });

    it('opens a breakdown row into its deployments, labelled and linked', async () => {
        renderPage();
        const toggle = await screen.findByRole('button', { name: /universal.*2 deployments/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        const table = toggle.closest('table');
        expect(within(table).getByRole('link', { name: 'uni_opti_bn' })).toBeInTheDocument();
        expect(within(table).getByText('no deployment (symbol-config mode)')).toBeInTheDocument();
        expect(within(table).getAllByText('25%').length).toBeGreaterThan(0);
    });

    it('explains the trades without recorded marks in How trades travelled', async () => {
        renderPage();
        expect(await screen.findByText(/2 trades in this filter have no recorded worst\/best mark .* 7 Oct 2026/)).toBeInTheDocument();
        expect(screen.getByText(/before charges, about one a minute/)).toBeInTheDocument();
    });
});
