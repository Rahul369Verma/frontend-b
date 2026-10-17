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

// The server answers the Results tab ON DEMAND (backend logic/analytics/multilegTradeQuery):
// a table page without paths, the dropdowns, an opened row's detail, and the curves' paths.
const TABLE_KEYS = ['_id', 'deploymentId', 'name', 'template', 'symbol', 'trade_mode', 'entryAt', 'exitAt', 'exitReason', 'grossPnl', 'charges', 'netPnl', 'quarantined', 'quarantineReason', 'maeRupees', 'mfeRupees'];
const pick = (t, keys) => Object.fromEntries(keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
function answer(url, params = {}) {
    if (/\/multileg\/trades\/page$/.test(url)) return { rows: trades.map((t) => pick(t, TABLE_KEYS)), total: 3, matched: 3, page: 0, pages: 1, exitReasons: ['TP'] };
    if (/\/multileg\/trades\/facets$/.test(url)) return { deployments: [{ id: 'd1', name: 'IC nifty', n: 3 }], templates: ['iron_condor'], symbols: ['NSE:NIFTY50-INDEX'] };
    if (/\/multileg\/trades\/details$/.test(url)) return trades.filter((t) => String(params.ids || '').split(',').includes(t._id));
    if (/\/multileg\/trades\/paths$/.test(url)) return trades.map(({ path, legs, closedLegs, ...t }) => ({ ...t, p: path ? path.map((m) => [Date.parse(m.t), m.net]) : undefined }));
    return [];
}
vi.mock('axios', () => {
    const get = vi.fn((url, cfg) => Promise.resolve({ data: answer(url, cfg && cfg.params) }));
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

import axios from 'axios';
import MultiLeg from './MultiLeg.jsx';

// The day curves load when their section scrolls into view. The shared test setup's
// observer never fires; these tests scroll to it (the observer reports it visible),
// except the one that checks nothing is fetched before then.
const NEVER = globalThis.IntersectionObserver;
class Visible { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ isIntersecting: true, target: el }]); } unobserve() {} disconnect() {} takeRecords() { return []; } }
globalThis.IntersectionObserver = Visible;

describe('MultiLeg results — day by day', () => {
    it('draws one row per IST day over the listed round-trips and counts the quarantined one', async () => {
        render(<MemoryRouter initialEntries={['/multi-leg?tab=results']}><MultiLeg /></MemoryRouter>);
        const mon = await screen.findByRole('button', { name: /Mon 28 Sep 2026/ }, { timeout: 5000 });
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
        await screen.findByRole('button', { name: /Mon 28 Sep 2026/ }, { timeout: 5000 });
        // a table CELL reading TP — the Exit-reason filter's <option>TP</option> is not a row
        const cell = screen.getAllByText('TP').find(el => el.tagName === 'TD');
        const detailsBefore = axios.get.mock.calls.filter(([u]) => /\/trades\/details$/.test(u)).length;
        fireEvent.click(cell.closest('tr'));
        expect(await screen.findByText(/net of estimated costs/)).toBeTruthy();
        expect(screen.getByText('gross (pre-cost)')).toBeTruthy();
        // the row's legs/path were fetched when it was OPENED, for that row only
        const details = axios.get.mock.calls.filter(([u]) => /\/trades\/details$/.test(u));
        expect(details.length).toBe(detailsBefore + 1);
        expect(details.at(-1)[1].params.ids).toBe('m1');
    });

    it('the curves\' paths are not fetched until that section is reached', async () => {
        axios.get.mockClear();
        globalThis.IntersectionObserver = NEVER;
        try {
            render(<MemoryRouter initialEntries={['/multi-leg?tab=results']}><MultiLeg /></MemoryRouter>);
            expect(await screen.findByText(/Structure round-trips \(3\)/)).toBeTruthy();
            expect(screen.getByTestId('results-day-curves').textContent).toMatch(/load when you scroll here/);
            expect(axios.get.mock.calls.some(([u]) => /\/trades\/paths$/.test(u))).toBe(false);
        } finally { globalThis.IntersectionObserver = Visible; }
    });

    it('never downloads the whole history: a page without paths, the dropdowns, and the paths for the curves only', async () => {
        axios.get.mockClear();
        render(<MemoryRouter initialEntries={['/multi-leg?tab=results']}><MultiLeg /></MemoryRouter>);
        await screen.findByRole('button', { name: /Mon 28 Sep 2026/ }, { timeout: 5000 });
        const urls = axios.get.mock.calls.map(([u, c]) => `${u.replace(/^.*\/api/, '')} ${JSON.stringify((c && c.params) || {})}`);
        expect(urls.some((u) => /\/multileg\/trades \{.*"limit":2000/.test(u))).toBe(false);
        const page = axios.get.mock.calls.find(([u]) => /\/trades\/page$/.test(u));
        expect(page[1].params).toMatchObject({ mode: 'all', deploymentId: 'all', sort: 'exit', dir: 'desc', page: 0, pageSize: 50 });
        expect(urls.some((u) => /\/multileg\/trades\/facets/.test(u))).toBe(true);
        expect(screen.getByText(/Structure round-trips \(3\)/)).toBeTruthy();
    });
});
