/**
 * The Deploy tab's three answers (27-Oct-2026): what the LIVE book needs against the account,
 * which strategy placed each broker order, and LIVE vs PAPER twins day by day.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { stateText, togetherLine, planLine } from './liveCapitalFormat.js';

const CAP = {
    at: '2026-10-27T03:55:00Z', funds: { total: 474648, available: 288621, utilized: 192725 },
    deployments: [
        { id: 'w', name: 'nifty-wide-tail (LIVE)', structure: 'Short Strangle', lots: 1, open: true, status: 'ACTIVE', legs: [{ symbol: 'x' }], margin: 130000, blockedAtEntry: 258656, note: '1 leg(s) already closed — counted: the legs still open' },
        { id: 's', name: 'nifty-atm-straddle (LIVE)', structure: 'Short Straddle', lots: 1, open: false, status: 'ACTIVE', enteredToday: false, entryTime: '09:20', legs: [{}, {}], margin: 260000, blockedAtEntry: null },
        { id: 'l', name: 'late-runway (LIVE)', structure: 'Short Straddle', lots: 1, open: false, status: 'ACTIVE', enteredToday: false, entryTime: '11:00', legs: [{}, {}], margin: null, blockedAtEntry: null, note: 'could not price it: no contract' },
    ],
    allTogether: { margin: 524000, source: 'broker', sumOfEach: null, missing: ['late-runway (LIVE)'] },
    stillToEnter: { plan: [{ id: 's', name: 'nifty-atm-straddle (LIVE)', entryTime: '09:20', margin: 260000, fits: true, availableBefore: 288621 }, { id: 'l', name: 'late-runway (LIVE)', entryTime: '11:00', margin: 300000, fits: false, availableBefore: 28621 }], margin: 560000, available: 288621, refused: ['late-runway (LIVE)'] },
    notes: ['Expiry day for nifty-wide-tail (LIVE): the exchange charges extra margin on short options expiring today, so these figures are higher than on other days.'],
};
const ORDERS = {
    at: '2026-10-27T03:58:30Z',
    rows: [
        { id: '1', time: '27-Oct-2026 09:20:08', symbol: 'NSE:NIFTY26OCT22550PE', side: 'SELL', type: 'LIMIT', qty: 65, filledQty: 65, limitPrice: 43.15, tradedPrice: 44.05, status: 'filled', tag: 'mlen86a4761422550PES', strategy: { id: 'w', name: 'nifty-wide-tail (LIVE)', engine: 'multileg', mode: 'LIVE' }, why: 'entry', matchedBy: 'tag' },
        { id: '2', time: '27-Oct-2026 09:20:10', symbol: 'NSE:NIFTY26OCT22650PE', side: 'SELL', type: 'LIMIT', qty: 65, filledQty: 0, status: 'rejected', message: 'RED:Margin Shortfall:INR 42,626.67', strategy: { id: 's', name: 'nifty-atm-straddle (LIVE)', engine: 'multileg', mode: 'LIVE' }, why: 'entry', matchedBy: 'tag' },
        { id: '3', time: '27-Oct-2026 09:20:24', symbol: 'NSE:NIFTY26OCT22550PE', side: 'BUY', type: 'SL-LIMIT', qty: 65, filledQty: 0, stopPrice: 132.15, limitPrice: 138.75, status: 'pending', strategy: { id: 'w', name: 'nifty-wide-tail (LIVE)', engine: 'multileg', mode: 'LIVE' }, why: 'safety stop at the broker', matchedBy: 'tag' },
        { id: '4', time: '27-Oct-2026 10:00:00', symbol: 'NSE:SBIN-EQ', side: 'BUY', type: 'MARKET', qty: 1, filledQty: 1, status: 'filled', strategy: null, why: 'not placed by this app (no tag the app writes)', matchedBy: null },
    ],
    byStrategy: { 'nifty-wide-tail (LIVE)': { orders: 2, filled: 1, pending: 1, rejected: 0 }, 'nifty-atm-straddle (LIVE)': { orders: 1, filled: 0, pending: 0, rejected: 1 }, 'not from this app': { orders: 1, filled: 1, pending: 0, rejected: 0 } },
};
vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/live-capital$/.test(url)) return Promise.resolve({ data: CAP });
        if (/broker\/orders$/.test(url)) return Promise.resolve({ data: ORDERS });
        return Promise.resolve({ data: {} });
    });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import LiveCapitalPanel from './LiveCapitalPanel.jsx';
import TwinsPanel from './TwinsPanel.jsx';
import BrokerOrdersPanel from '../BrokerOrdersPanel.jsx';

const openPanel = (title) => { const b = screen.getAllByRole('button').find((x) => x.getAttribute('aria-expanded') === 'false' && x.textContent.includes(title)); if (b) fireEvent.click(b); };

describe('liveCapitalFormat', () => {
    it('says it plainly', () => {
        expect(stateText(CAP.deployments[0])).toBe('open · 1 leg held');
        expect(stateText(CAP.deployments[1])).toBe('flat · enters 09:20');
        expect(stateText({ ...CAP.deployments[1], enteredToday: true })).toBe('flat · done for today');
        expect(togetherLine(CAP)).toBe('All 3 LIVE structures on at once need ₹5,24,000 of margin: ₹49,352 MORE than the ₹4,74,648 in the account.');
        expect(togetherLine({ ...CAP, allTogether: { margin: 237324 } })).toBe('All 3 LIVE structures on at once need ₹2,37,324 of margin: 50% of the ₹4,74,648 in the account.');
        expect(togetherLine({ deployments: [] })).toBe('No LIVE multi-leg deployment.');
        expect(planLine(CAP.stillToEnter.plan[1])).toBe('11:00 late-runway (LIVE) ₹3,00,000 — would be REFUSED (₹28,621 left)');
        expect(planLine({ ...CAP.stillToEnter.plan[0], fits: null })).toMatch(/cannot tell/);
    });
});

describe('LiveCapitalPanel', () => {
    it('the account, all LIVE together, each one, and the entry that cannot be funded', async () => {
        render(<LiveCapitalPanel />);
        openPanel('LIVE capital');
        await waitFor(() => expect(screen.getByTestId('live-capital')).toBeTruthy());
        const t = screen.getByTestId('live-capital').textContent;
        expect(t).toMatch(/total ₹4,74,648 · in use ₹1,92,725 · available ₹2,88,621/);
        expect(t).toMatch(/₹49,352 MORE than the ₹4,74,648 in the account/);
        expect(t).toMatch(/Not in that figure \(could not be priced\): late-runway \(LIVE\)/);
        expect(t).toMatch(/unavailable/);
        expect(t).toMatch(/would be REFUSED/);
        expect(t).toMatch(/The engine will refuse late-runway \(LIVE\) at entry \(no order is sent\)/);
        expect(t).toMatch(/Expiry day/);
        expect(t).toMatch(/PAPER books use no account margin/);
    });
});

describe('BrokerOrdersPanel', () => {
    it('each order with its strategy and purpose; a strategy chip filters; an order not from the app is named', async () => {
        render(<BrokerOrdersPanel />);
        openPanel('Broker orders today');
        await waitFor(() => expect(screen.getByTestId('broker-orders')).toBeTruthy());
        const t = screen.getByTestId('broker-orders').textContent;
        expect(t).toMatch(/safety stop at the broker/);
        expect(t).toMatch(/₹132.15 → ₹138.75/);
        expect(t).toMatch(/RED:Margin Shortfall/);
        expect(t).toMatch(/not from this app/);
        fireEvent.click(screen.getByRole('button', { name: /^nifty-wide-tail \(LIVE\): 2 · 1 pending/ }));
        const rows = screen.getByTestId('broker-orders').querySelectorAll('tbody tr');
        expect(rows.length).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: /^All \(4\)/ }));
        expect(screen.getByTestId('broker-orders').querySelectorAll('tbody tr').length).toBe(4);
    });
});

describe('TwinsPanel', () => {
    const DATA = { pairs: [{
        base: 'nifty-atm-straddle', symbol: 'NSE:NIFTY50-INDEX', linkedBy: 'name', sinceDay: '2026-10-21',
        live: { id: 'b', name: 'nifty-atm-straddle (LIVE)', lots: 1, openNet: null }, paper: { id: 'a', name: 'nifty-atm-straddle (PAPER)', lots: 1, openNet: -603 }, lotsDiffer: false,
        days: [{ day: '2026-10-27', live: { n: 1, net: -160, reasons: ['UNWIND'] }, paper: { n: 0, net: 0, reasons: [] }, diff: -160, why: ['LIVE entry failed: SELL NSE:NIFTY26OCT22650PE rejected: RED:Margin Shortfall'] }],
        total: { live: -160, paper: 0, diff: -160, liveTrades: 1, paperTrades: 0 },
    }] };
    it('each pair day by day, the difference, and why the LIVE book differed', () => {
        render(<TwinsPanel data={DATA} />);
        openPanel('LIVE vs PAPER twins');
        const t = screen.getByTestId('twins').textContent;
        expect(t).toMatch(/nifty-atm-straddle/);
        expect(t).toMatch(/paired by name/);
        expect(t).toMatch(/LIVE -₹160 \(1 trades\) · PAPER ₹0 \(0\) · difference -₹160/);
        expect(t).toMatch(/open now: LIVE — \/ PAPER -₹603/);
        expect(t).toMatch(/LIVE entry failed: SELL NSE:NIFTY26OCT22650PE rejected/);
        expect(t).toMatch(/no trade/);
    });
    it('no pair yet: says how to make one', () => {
        render(<TwinsPanel data={{ pairs: [] }} />);
        openPanel('LIVE vs PAPER twins');
        expect(screen.getByText(/No LIVE deployment has a PAPER twin yet/)).toBeTruthy();
    });
});
