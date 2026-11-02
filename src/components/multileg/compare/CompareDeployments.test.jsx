/**
 * Multi-Leg → Compare (2-Nov-2026): the selection from the address, quick picks, best/worst per
 * results row, the settings diff, and every gap said out loud (missing, cut, failed).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const OPTIONS = [
    { id: 'd1', name: 'straddle-nifty', template: 'short_straddle', templateName: 'Short Straddle', symbol: 'NSE:NIFTY50-INDEX', tradeMode: 'PAPER', status: 'ACTIVE', open: false, trades: 40, net: 9000, winRate: 70 },
    { id: 'd2', name: 'condor-bank', template: 'iron_condor', templateName: 'Iron Condor', symbol: 'NSE:NIFTYBANK-INDEX', tradeMode: 'LIVE', status: 'ACTIVE', open: true, trades: 25, net: 3000, winRate: 60 },
    { id: 'd3', name: 'old-one', template: 'short_strangle', templateName: 'Short Strangle', symbol: 'NSE:NIFTY50-INDEX', tradeMode: 'PAPER', status: 'DELETED', open: false, trades: 5, net: -800, winRate: 20 },
];
const DAILY1 = [{ day: '2026-10-01', net: 500, n: 1, equity: 500, drawdown: 0 }, { day: '2026-10-02', net: -200, n: 1, equity: 300, drawdown: -200 }];
const depRow = (id, name, results, config, extra = {}) => ({
    id, found: true, name, template: 'short_straddle', templateName: 'Short Straddle', legs: ['SELL CE ATM', 'SELL PE ATM'], intraday: true, symbol: 'NSE:NIFTY50-INDEX',
    tradeMode: 'PAPER', status: 'ACTIVE', lots: 1, entryMode: 'time', signalStrategy: null, createdAt: '2026-09-20T04:00:00Z', editedAt: null, edits: 0,
    position: null, results: { trades: 30, verdict: 'profitable', ...results }, behaviour: { holdMinutesMedian: 300 },
    breakdowns: { exitReasons: [{ key: 'SQUARE_OFF', n: 20, net: 4000, perTrade: 200, winRate: 70 }], entryHour: [], weekday: [{ key: 'Wed', n: 3, net: 10, perTrade: 3, winRate: 66 }, { key: 'Mon', n: 2, net: 5, perTrade: 2, winRate: 50 }] },
    daily: DAILY1, config, ...extra,
});
const COMPARE = {
    deployments: [
        depRow('d1', 'straddle-nifty', { net: 9000, perTrade: 300, winRate: 70 }, [
            { key: 'leg_sl_x', label: 'Leg stop (× entry premium)', group: 'exits', display: '1.4×', from: 'deployment', overridden: true, defaultDisplay: '1.5×' },
            { key: 'entry_time', label: 'Entry time', group: 'entry', display: '09:20', from: 'template', overridden: false },
        ]),
        depRow('d2', 'condor-bank', { net: 3000, perTrade: 120, winRate: 60 }, [
            { key: 'leg_sl_x', label: 'Leg stop (× entry premium)', group: 'exits', display: '1.5×', from: 'template', overridden: false },
            { key: 'entry_time', label: 'Entry time', group: 'entry', display: '09:20', from: 'template', overridden: false },
        ]),
        { id: 'gone', found: false, name: 'gone', results: null, daily: [], breakdowns: {}, config: [] },
    ],
    pairs: [{ a: 'd1', b: 'd2', overlapDays: 2, correlation: null, sameDirectionPct: 50, aWins: 1, bWins: 1, ties: 0, aNet: 300, bNet: 100 }],
    combined: { daily: DAILY1, net: 12000, maxDrawdown: -200, sumOfMemberDrawdowns: -400, drawdownRatio: 0.5, upDays: 1, downDays: 1 },
    distribution: { edges: [-1000, 0, 1000], byId: { d1: { counts: [1, 1] }, d2: { counts: [0, 2] } }, clippedAt: { low: -1000, high: 1000 } },
    minOverlap: 5, groups: [{ id: 'entry', label: 'Entry' }, { id: 'exits', label: 'Exits & stops' }], truncated: null, window: null, missing: ['gone'],
};
let compareCalls = [];
let failCompare = false;
vi.mock('axios', () => {
    const get = vi.fn((url, cfg = {}) => {
        if (/\/multileg\/compare\/options$/.test(url)) return Promise.resolve({ data: { deployments: OPTIONS } });
        if (/\/multileg\/compare$/.test(url)) {
            compareCalls.push(cfg.params);
            if (failCompare) return Promise.reject(Object.assign(new Error('boom'), { response: { data: { error: 'database unavailable' } } }));
            return Promise.resolve({ data: COMPARE });
        }
        return Promise.resolve({ data: {} });
    });
    const api = { get, defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import CompareDeployments from './CompareDeployments.jsx';

const at = (url) => render(<MemoryRouter initialEntries={[url]}><CompareDeployments /></MemoryRouter>);

describe('CompareDeployments', () => {
    beforeEach(() => { localStorage.clear(); compareCalls = []; failCompare = false; });

    it('with nothing chosen: the list opens and explains the tab; no comparison is fetched', async () => {
        at('/multi-leg?tab=compare');
        expect(await screen.findByText('Nothing chosen yet')).toBeTruthy();
        expect(await screen.findByRole('listbox', { name: 'Deployments' })).toBeTruthy();
        expect(compareCalls).toHaveLength(0);
    });

    it('a quick pick chooses the top by net and fetches them in that order', async () => {
        at('/multi-leg?tab=compare');
        fireEvent.click(await screen.findByRole('button', { name: 'Top 4 by net' }));
        await waitFor(() => expect(compareCalls.length).toBeGreaterThan(0));
        expect(compareCalls.at(-1).ids).toBe('d1,d2,d3');
    });

    it('reads the selection from the address, marks best and worst, and lists the one it could not find', async () => {
        at('/multi-leg?tab=compare&cmp=d1,d2,gone');
        const metrics = await screen.findByTestId('compare-metrics');
        expect(compareCalls[0].ids).toBe('d1,d2,gone');
        const netRow = within(metrics).getByText('Net P&L').closest('tr');
        expect(within(netRow).getByLabelText('best')).toBeTruthy();
        expect(within(netRow).getByLabelText('worst')).toBeTruthy();
        // the deployment that no longer exists is named, not silently dropped
        expect(screen.getByText(/Not shown: gone/)).toBeTruthy();
        // the cards: one per found deployment
        expect(within(screen.getByTestId('compare-cards')).getAllByRole('article')).toHaveLength(2);
    });

    it('settings: only the differences by default, the overridden value marked, all on request', async () => {
        at('/multi-leg?tab=compare&cmp=d1,d2');
        const table = await screen.findByTestId('compare-config');
        expect(within(table).getByText('Leg stop (× entry premium)')).toBeTruthy();
        expect(within(table).queryByText('Entry time')).toBeNull();
        expect(within(table).getByLabelText('differs from the default 1.5×')).toBeTruthy();
        expect(screen.getByText(/of 2 settings differ/)).toBeTruthy();
        fireEvent.click(screen.getByLabelText('only the differences'));
        expect(within(table).getByText('Entry time')).toBeTruthy();
    });

    it('breakdown by weekday keeps the week order', async () => {
        at('/multi-leg?tab=compare&cmp=d1,d2');
        await screen.findByTestId('compare-breakdown');
        fireEvent.click(screen.getByRole('button', { name: 'Weekday' }));
        const rows = within(screen.getByTestId('compare-breakdown')).getAllByRole('row').slice(1).map((r) => r.querySelector('th').textContent);
        expect(rows).toEqual(['Mon', 'Wed']);
    });

    it('a pair with too few shared days shows the day count, not a correlation', async () => {
        at('/multi-leg?tab=compare&cmp=d1,d2');
        const corr = await screen.findByTestId('compare-correlation');
        expect(within(corr).getAllByText('2d').length).toBe(2);
    });

    it('a failed comparison says why and offers to try again', async () => {
        failCompare = true;
        at('/multi-leg?tab=compare&cmp=d1,d2');
        expect(await screen.findByText(/could not be loaded: database unavailable/)).toBeTruthy();
        failCompare = false;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByTestId('compare-metrics')).toBeTruthy();
    });

    it('remembers the selection in this browser when the address has none', async () => {
        localStorage.setItem('ml.compare.ids', JSON.stringify(['d2']));
        at('/multi-leg?tab=compare');
        await waitFor(() => expect(compareCalls.length).toBeGreaterThan(0));
        expect(compareCalls[0].ids).toBe('d2');
    });
});

describe('OpenChip — a stored mark never reads as now', () => {
    const NOW = Date.parse('2026-11-02T06:00:00Z');
    it('a fresh mark shows just the mark', async () => {
        const { OpenChip } = await import('./CompareSections.jsx');
        render(<OpenChip pos={{ state: 'OPEN', since: '2026-11-02T04:00:00Z', mtmNet: 570, markedAt: '2026-11-02T05:55:00Z' }} now={NOW} />);
        expect(screen.getByText('open +₹570')).toBeTruthy();
    });
    it('an old mark says how old it is', async () => {
        const { OpenChip } = await import('./CompareSections.jsx');
        render(<OpenChip pos={{ state: 'OPEN', since: '2026-10-21T03:50:00Z', mtmNet: -1736, markedAt: '2026-10-21T05:39:27Z' }} now={NOW} />);
        const chip = screen.getByText(/open -₹1,736 · mark 12d old/);
        expect(chip.getAttribute('title')).toMatch(/not a current price/);
    });
    it('no mark at all says unmarked', async () => {
        const { OpenChip } = await import('./CompareSections.jsx');
        render(<OpenChip pos={{ state: 'ENTERING', since: null, mtmNet: null, markedAt: null }} now={NOW} />);
        expect(screen.getByText('open · unmarked')).toBeTruthy();
    });
});
