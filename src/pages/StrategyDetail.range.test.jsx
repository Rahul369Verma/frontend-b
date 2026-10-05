/**
 * Single-leg results under a date range, and the docs that are not round trips.
 *
 *  - A range is cut at IST MIDNIGHT: the server filters on the exit instant, so a
 *    rolling "now − 7 days" cut dropped the oldest day's morning trades while its
 *    afternoon ones drew a curve that looked like the whole day.
 *  - A day BEFORE the range that appears only because a position was carried out
 *    of it is not drawn (it would look complete), and it is counted.
 *  - An entry that never filled and a recovery placeholder close are CLOSED with
 *    pnl 0 but were never real results: counted, not drawn as ₹0 trades.
 *  - A trade with no net_pnl shows its gross as gross, never "after charges".
 *
 * Fixtures are placed relative to the real clock (the page reads Date.now()).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { istDayStartMs, istDayOf } from '../utils/dayCurves';
import { istDayLabel } from '../components/viz/tokens';

const DAY = 86400e3;
const H = 3600e3;
// IST midnight of the first day of "Last 7 days", as the page must compute it.
const rangeFrom = () => istDayStartMs(Date.now() - 7 * DAY);
const FIRST = rangeFrom();
const BEFORE = FIRST - DAY;                                  // the IST day before the range
const iso = (ms) => new Date(ms).toISOString();

const base = {
    status: 'CLOSED', action: 'ENTRY', symbol: 'NSE:NIFTYBANK-INDEX', spotSymbol: 'NSE:NIFTYBANK-INDEX',
    quantity: 30, entryPrice: 100, exitPrice: 100,
};
const trades = [
    {   // carried out of the day before the range, exits on its first day
        ...base, _id: 'carry', tradingsymbol: 'NSE:BANKNIFTY26SEP54300PE', side: 'PUT', type: 'PE',
        entryTime: iso(BEFORE + 14 * H), exitTime: iso(FIRST + 10 * H),
        pnl: 900, gross_pnl: 900, net_pnl: 820, pathSource: null, pathReason: 'no archive for that day',
    },
    {   // no net_pnl: gross is the booked figure, with a rebuilt path
        ...base, _id: 'gross', tradingsymbol: 'NSE:BANKNIFTY26SEP54500CE', side: 'CALL', type: 'CE',
        entryTime: iso(FIRST + 11 * H), exitTime: iso(FIRST + 11 * H + 10 * 60e3),
        pnl: -258, gross_pnl: -258, net_pnl: null,
        pathSource: 'archive', maeRupees: -300, mfeRupees: 0,
        path: [
            { t: iso(FIRST + 11 * H + 60e3), net: -40, ltp: 98.7 },
            { t: iso(FIRST + 11 * H + 9 * 60e3), net: -96, ltp: 96.8 },
        ],
    },
    {   // a PAPER fair-entry that expired: never a position
        ...base, _id: 'aborted', tradingsymbol: 'NSE:BANKNIFTY26SEP54300PE', side: 'PUT', type: 'PE',
        entryTime: iso(FIRST + 12 * H), exitTime: iso(FIRST + 12 * H + 15 * 60e3),
        pnl: 0, entry_failed: true, pathSource: null, pathReason: 'entry never filled (the order was aborted, so no position was held)',
    },
    {   // recovery found it gone at the broker; exit unknown, pnl 0 is a placeholder
        ...base, _id: 'recov', tradingsymbol: 'NSE:BANKNIFTY26SEP54300PE', side: 'PUT', type: 'PE',
        entryTime: iso(FIRST + 13 * H), exitTime: iso(FIRST + 2 * DAY + 4 * H),
        pnl: 0, recovery_closed: true, failure_reason: 'absent at broker',
        pathSource: null, pathReason: 'closed by recovery (its exit time is when recovery ran, not a fill)',
    },
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

import axios from 'axios';
import StrategyDetail from './StrategyDetail.jsx';

const renderPage = () => render(
    <MemoryRouter initialEntries={['/strategy/NSE%3ANIFTYBANK-INDEX']}>
        <Routes><Route path="/strategy/:symbol" element={<StrategyDetail />} /></Routes>
    </MemoryRouter>,
);
const tradeCalls = () => axios.get.mock.calls.filter(([u]) => /\/trades$/.test(u));

describe('StrategyDetail — date range and non-round-trip docs', () => {
    beforeEach(() => { axios.get.mockClear(); });

    it('cuts "Last 7 days" at IST midnight and does not draw the partial day before it', async () => {
        renderPage();
        await waitFor(() => expect(tradeCalls().length).toBe(1));
        expect(tradeCalls()[0][1].params.from).toBeUndefined();    // All time: no cut

        fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
        await waitFor(() => expect(tradeCalls().length).toBe(2));
        const from = Date.parse(tradeCalls()[1][1].params.from);
        expect(from).toBe(rangeFrom());
        expect((from + 5.5 * H) % DAY).toBe(0);                     // 00:00 IST exactly

        fireEvent.click(screen.getByRole('tab', { name: /Day by day/ }));
        const line = (await screen.findByText(/Not in these curves/)).textContent;
        expect(line).toContain('1 earlier day(s) not drawn');
        expect(line).toContain('1 entry never filled');
        expect(line).toContain('1 closed by recovery with no known exit');
        // Only the range's own day is drawn — the day before it and the
        // recovery placeholder's exit day are not.
        const rows = screen.getAllByRole('button', { expanded: false });
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain(istDayLabel(istDayOf(FIRST)));
        expect(within(rows[0]).getByText('2 trades')).toBeTruthy();
        // The gross-fallback note says what the exit step is made of for those trades.
        expect(screen.getByText(/no net_pnl recorded/).textContent).toMatch(/fill slippage only/);
        // Single-leg marks are pre-cost: the legend says so.
        expect(screen.getByText(/Each day's running P&L/).textContent).toMatch(/charges plus fill slippage/);
    });

    it('a trade with no net_pnl shows its gross as gross in the path chart', async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('tab', { name: /Trades/ }));
        const btn = await screen.findByRole('button', { name: /Show P&L path for BANKNIFTY26SEP54500CE/ });
        fireEvent.click(btn);
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        expect(within(panel).getByText('Booked gross')).toBeTruthy();
        expect(within(panel).queryByText('Booked net')).toBeNull();
        expect(within(panel).getByText(/Exit step -₹162/).textContent).toMatch(/fill slippage only/);
        expect(within(panel).getByText('never in profit')).toBeTruthy();
    });
});
