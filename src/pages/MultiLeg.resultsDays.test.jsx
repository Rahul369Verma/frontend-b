/**
 * Multileg Results tab: a day-by-day curve over exactly the round-trips the
 * table lists, with quarantined trades left out AND counted, and the per-trade
 * path chart still opening from a round-trip row.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const iso = (s) => new Date(s).toISOString();
const base = {
    deploymentId: 'd1', name: 'IC nifty', template: 'iron_condor', symbol: 'NSE:NIFTY50-INDEX', trade_mode: 'PAPER',
    legs: [], closedLegs: [], exitReason: 'TP',
};
const trades = [
    {
        ...base, _id: 'm1', entryAt: iso('2026-09-28T04:00:00Z'), exitAt: iso('2026-09-28T08:00:00Z'),
        netPnl: 1200, grossPnl: 1300, charges: 100, maeRupees: -400, mfeRupees: 1500,
        path: [
            { t: iso('2026-09-28T04:00:00Z'), net: -60, gross: 0, spot: 25000 },
            { t: iso('2026-09-28T06:00:00Z'), net: 900, gross: 980, spot: 24980 },
            { t: iso('2026-09-28T07:59:00Z'), net: 1250, gross: 1330, spot: 24990 },
        ],
    },
    {
        ...base, _id: 'm2', entryAt: iso('2026-09-25T04:00:00Z'), exitAt: iso('2026-09-25T05:00:00Z'),
        netPnl: -500, grossPnl: -450, charges: 50,
    },
    {
        ...base, _id: 'm3', entryAt: iso('2026-09-24T04:00:00Z'), exitAt: iso('2026-09-24T05:00:00Z'),
        netPnl: 99999, grossPnl: 99999, charges: 0, quarantined: true, quarantineReason: 'fill never traded',
    },
];

vi.mock('axios', () => {
    const get = vi.fn((url) => Promise.resolve({ data: /\/multileg\/trades$/.test(url) ? trades : [] }));
    const empty = () => Promise.resolve({ data: [] });
    const api = {
        get, post: vi.fn(empty), put: vi.fn(empty), delete: vi.fn(empty), patch: vi.fn(empty),
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

describe('MultiLeg results — day by day', () => {
    it('draws one row per IST day over the listed round-trips and counts the quarantined one', async () => {
        render(<MemoryRouter initialEntries={['/multi-leg?tab=results']}><MultiLeg /></MemoryRouter>);
        const mon = await screen.findByRole('button', { name: /Mon 28 Sep 2026/ });
        expect(within(mon).getByText('+₹1,200')).toBeTruthy();
        expect(within(mon).getByText('marked 1/1')).toBeTruthy();
        const fri = screen.getByRole('button', { name: /Fri 25 Sep 2026/ });
        expect(within(fri).getByText('-₹500')).toBeTruthy();
        expect(within(fri).getByText('booked only')).toBeTruthy();
        // The quarantined trade is not a day of its own, and is counted.
        expect(screen.queryByRole('button', { name: /Thu 24 Sep 2026/ })).toBeNull();
        expect(screen.getByText(/Not in these curves/).textContent).toContain('1 quarantined');
    });

    it('a round-trip row still opens its path chart', async () => {
        render(<MemoryRouter initialEntries={['/multi-leg?tab=results']}><MultiLeg /></MemoryRouter>);
        await screen.findByRole('button', { name: /Mon 28 Sep 2026/ });
        const rows = screen.getAllByText('TP');
        fireEvent.click(rows[0].closest('tr'));
        expect(await screen.findByText(/net of estimated costs/)).toBeTruthy();
        expect(screen.getByText('gross (pre-cost)')).toBeTruthy();
    });
});
