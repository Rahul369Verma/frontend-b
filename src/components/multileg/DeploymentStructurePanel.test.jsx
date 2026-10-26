/**
 * The structure of the ONE deployment picked in Results — legs, risk, its stops with the index
 * level each fires at today, the payoff chart (user, 23-Oct-2026).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ThemeProvider from '../../theme/ThemeContext.jsx';
import { sourceLine, levelWhere } from './structureFormat.js';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import DeploymentStructurePanel from './DeploymentStructurePanel.jsx';

const VIEW = {
    ok: true, deploymentId: 'd1', name: 'nifty-core (PAPER)', template: 'short_straddle', structureName: 'Short Straddle', symbol: 'NSE:NIFTY50-INDEX',
    tradeMode: 'PAPER', source: 'entry-now', state: 'IDLE', spot: 24100, lotSize: 65, lots: 1, mult: 65,
    creditPerUnit: 240, creditRupees: 15600, maxProfit: 15600, maxLoss: null, unbounded: true, breakevens: [23860, 24340],
    markNow: 0, roundTripCosts: 122, settings: { leg_sl_x: 1.4, sl_x_credit: 1.5, sl_pct_debit: 0, max_loss_rupees: 3000, tp_pct_credit: 30 },
    legs: [
        { symbol: 'CE', action: 'SELL', type: 'CE', strike: 24100, ratio: 1, expiry: '2026-10-27', entryPremium: 125, nowPremium: 125, ivPct: 11.2, stopPremium: 175, stopSpotToday: 24190 },
        { symbol: 'PE', action: 'SELL', type: 'PE', strike: 24100, ratio: 1, expiry: '2026-10-27', entryPremium: 115, nowPremium: 115, ivPct: 11.9, stopPremium: 161, stopSpotToday: 24010 },
    ],
    lines: [
        { kind: 'structureStop', rupees: -7800, grossRupees: -7800, label: 'structure stop (1.5× credit)', todayBelow: 23766, todayAbove: 24393 },
        { kind: 'rupeeStop', rupees: -3000, grossRupees: -2878, label: 'rupee stop −₹3,000 net', todayBelow: 23893, todayAbove: 24265 },
        { kind: 'target', rupees: 4680, grossRupees: 4680, label: 'target', todayBelow: null, todayAbove: null },
    ],
    curve: [{ spot: 23500, expiry: -23400, today: -22000 }, { spot: 24100, expiry: 15600, today: 0 }, { spot: 24700, expiry: -23400, today: -22000 }],
    note: null, contractNotes: [],
};

describe('structure wording', () => {
    it('says whether it is open or how it would enter now', () => {
        const fmt = () => '22 Oct 11:00';
        expect(sourceLine(VIEW, fmt)).toBe('Short Straddle on NIFTY50 · 1 lot × 65 · PAPER — not open. If it entered now, at index 24,100, these are its legs.');
        expect(sourceLine({ ...VIEW, source: 'open', entryAt: 'x', entrySpot: 24050 }, fmt)).toMatch(/OPEN since 22 Oct 11:00 \(entered at index 24,050\); index now 24,100\./);
    });
    it('says where a level fires today — or that time, not a move, reaches it', () => {
        expect(levelWhere(VIEW.lines[0], (v) => v.toLocaleString('en-IN'))).toBe('today it fires at index ≤ 23,766 or index ≥ 24,393');
        expect(levelWhere(VIEW.lines[2])).toMatch(/reached as the premium decays with time/);
        expect(levelWhere({ kind: 'structureStop', todayBelow: null, todayAbove: null })).toMatch(/no index move within the chart/);
    });
});

describe('DeploymentStructurePanel', () => {
    beforeEach(() => { axios.get.mockReset(); });
    it('nothing when no single deployment is picked', () => {
        const { container } = render(<ThemeProvider><DeploymentStructurePanel deploymentId="all" /></ThemeProvider>);
        expect(container.innerHTML).toBe('');
        expect(axios.get).not.toHaveBeenCalled();
    });
    it('fetches the picked deployment once and shows its legs, leg stops and every stop line', async () => {
        axios.get.mockResolvedValue({ data: VIEW });
        render(<ThemeProvider><DeploymentStructurePanel deploymentId="d1" /></ThemeProvider>);
        await waitFor(() => expect(screen.getByTestId('deployment-structure')).toBeTruthy());
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/multileg/deployments/d1/structure'), expect.any(Object));
        const t = screen.getByTestId('deployment-structure').textContent;
        expect(t).toMatch(/₹175/); expect(t).toMatch(/≥ 24,190/); expect(t).toMatch(/≤ 24,010/);
        const stops = screen.getByTestId('structure-stops').textContent;
        expect(stops).toMatch(/Its stops: leg stop 1.4× entry · structure stop 1.5× credit · rupee stop ₹3,000 · target 30% of credit\./);
        expect(stops).toMatch(/structure stop \(1.5× credit\): -₹7,800 — today it fires at index ≤ 23,766 or index ≥ 24,393/);
        expect(stops).toMatch(/rupee stop −₹3,000 net: -₹3,000 \(≈ -₹2,878 before the ₹122 round-trip costs\)/);
        expect(t).toMatch(/max loss UNBOUNDED/);
        fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
        expect(axios.get).toHaveBeenCalledTimes(2);
    });
    it('says why when it cannot be drawn', async () => {
        axios.get.mockRejectedValue({ response: { data: { error: 'no live spot for the index' } } });
        render(<ThemeProvider><DeploymentStructurePanel deploymentId="d2" /></ThemeProvider>);
        await waitFor(() => expect(screen.getByText(/Could not draw the structure: no live spot for the index/)).toBeTruthy());
    });
});
