import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import ResultsAnalytics from './ResultsAnalytics.jsx';

vi.mock('axios');

const DTE = 'Days to expiry at entry';
const ANALYTICS = {
    summary: { trades: 3, netPnl: 900, perTrade: 300, winRate: 67, tradingDays: 1, grossPnl: 2000, charges: 1100, avgMargin: 400000 },
    daily: [{ date: '2026-10-07', net: 900, trades: 3, winRate: 67, equity: 900, drawdown: 0 }],
    breakdowns: [
        { label: 'Deployment', rows: [{ key: 'alpha (PAPER)', trades: 2, wins: 1, net: 600, perTrade: 300, winRate: 50, deploymentId: 'a1' }] },
        { label: DTE, rows: [{ key: '3 · 4-7 DTE', trades: 3, wins: 2, net: 900, perTrade: 300, winRate: 67, strategies: 2 }] },
    ],
};
const CHILDREN = [
    { key: 'alpha (PAPER)', deploymentId: 'a1', template: 'iron_condor', symbol: 'NSE:NIFTY50-INDEX', trades: 2, net: 600, perTrade: 300, winRate: 50 },
    { key: 'beta (PAPER)', deploymentId: 'b2', template: 'iron_condor', symbol: 'NSE:NIFTYBANK-INDEX', trades: 1, net: 300, perTrade: 300, winRate: 100 },
];
const TEMPLATES = [{ key: 'iron_condor', name: 'Iron Condor' }];

function mockApi() {
    axios.get.mockImplementation((url, cfg) => Promise.resolve({
        data: cfg?.params?.drill ? { label: cfg.params.drill, key: cfg.params.key, children: CHILDREN } : ANALYTICS,
    }));
}
const renderIt = (props = {}) => render(<MemoryRouter><ResultsAnalytics templates={TEMPLATES} {...props} /></MemoryRouter>);

describe('ResultsAnalytics drill-down', () => {
    beforeEach(() => { vi.clearAllMocks(); mockApi(); });

    it('opens a bucket to show its strategies, each linking to its own results', async () => {
        renderIt();
        fireEvent.click(await screen.findByRole('button', { name: DTE }));
        const toggle = screen.getByRole('button', { name: /4-7 DTE/ });
        expect(toggle).toHaveTextContent('2 strategies');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);
        const alpha = await screen.findByRole('link', { name: 'alpha (PAPER)' });
        expect(alpha).toHaveAttribute('href', '/multi-leg?tab=results&deployment=a1');
        expect(screen.getByRole('link', { name: 'beta (PAPER)' })).toHaveAttribute('href', '/multi-leg?tab=results&deployment=b2');
        expect(screen.getAllByText(/Iron Condor · NIFTY50/).length).toBe(1);
        expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/multileg/analytics'),
            { params: expect.objectContaining({ drill: DTE, key: '3 · 4-7 DTE' }) });

        fireEvent.click(toggle);
        expect(screen.queryByRole('link', { name: 'alpha (PAPER)' })).not.toBeInTheDocument();
    });

    it('Deployment rows link straight to that deployment', async () => {
        renderIt();
        fireEvent.click(await screen.findByRole('button', { name: 'Deployment' }));
        expect(screen.getByRole('link', { name: 'alpha (PAPER)' })).toHaveAttribute('href', '/multi-leg?tab=results&deployment=a1');
    });

    it('a page-supplied window replaces the panel toggle and reaches every request', async () => {
        renderIt({ days: 30 });
        await screen.findByRole('button', { name: DTE });
        expect(screen.queryByRole('button', { name: '30d' })).not.toBeInTheDocument();
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/multileg/analytics'), { params: expect.objectContaining({ days: 30 }) });
        fireEvent.click(screen.getByRole('button', { name: DTE }));
        fireEvent.click(screen.getByRole('button', { name: /4-7 DTE/ }));
        await screen.findByRole('link', { name: 'alpha (PAPER)' });
        expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/multileg/analytics'),
            { params: expect.objectContaining({ days: 30, drill: DTE }) });
    });

    it('leads with five headline figures and the cost of trading; the rest on request', async () => {
        renderIt();
        const line = await screen.findByText((_, el) => el?.tagName === 'P' && /^Charges took 55% of gross profit/.test(el.textContent));
        expect(line).toHaveTextContent('₹1,100 of ₹2,000');
        expect(screen.getByText('Profit factor')).toBeInTheDocument();
        expect(screen.queryByText('Avg margin')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /More figures/ }));
        expect(screen.getByText('Avg margin')).toBeInTheDocument();
    });

    it('without a page window the panel keeps its own 30d/90d/All toggle', async () => {
        renderIt();
        expect(await screen.findByRole('button', { name: '30d' })).toBeInTheDocument();
    });

    it('inside one deployment there is nothing to split — no expander', async () => {
        renderIt({ deploymentId: 'a1' });
        fireEvent.click(await screen.findByRole('button', { name: DTE }));
        expect(screen.queryByRole('button', { name: /4-7 DTE/ })).not.toBeInTheDocument();
        expect(screen.getByText('3 · 4-7 DTE')).toBeInTheDocument();
    });
});
