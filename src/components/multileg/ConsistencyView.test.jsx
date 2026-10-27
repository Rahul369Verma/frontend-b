/**
 * Auto-optimize consistency on screen (27-Oct-2026): each result says whether it made money in
 * rising, falling AND sideways markets and in most months, the list can be ordered or filtered by
 * it with every hidden row counted, and an old run can be checked after the fact.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { verdictFor, orderRows, marketParts, monthText, mixText, monthLabel } from './consistencyFormat.js';

const v = (tier, extra = {}) => ({
    tier, consistent: tier === 0, label: tier === 0 ? 'consistent' : tier === 1 ? 'partly tested' : 'not consistent',
    why: tier === 2 ? ['loses in rising markets (8 trades, ₹-19,078)', '122% of the profit came from Mar 2026'] : tier === 1 ? ['too few trades in rising markets to judge (under 5)'] : [],
    markets: { rising: { n: 8, net: -19078 }, falling: { n: 5, net: 133146 }, sideways: { n: 11, net: 19851 } },
    bestMonth: { month: '2026-03', net: 162000 }, bestMonthShare: 1.22, months: { profitable: 4, active: 8 },
    ...extra,
});

let calls = 0;
vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/consistency-check$/.test(url)) { calls++; return Promise.resolve({ data: calls < 2 ? { status: 'running', note: 'replaying 3/45' } : { status: 'done' } }); }
        return Promise.resolve({ data: {} });
    });
    const post = vi.fn(() => Promise.resolve({ data: { status: 'loading' } }));
    const api = { get, post, defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import { ConsistencyBadge, MarketMix, ConsistencyCheckBar } from './ConsistencyView.jsx';

describe('consistencyFormat', () => {
    it('reads a verdict from the run, else from a later check, else none', () => {
        const run = { champions: [{ consistency: v(0) }, {}], consistencyCheck: { champions: [null, { consistency: v(2) }] } };
        expect(verdictFor(run, 'champions', 0).tier).toBe(0);
        expect(verdictFor(run, 'champions', 1).tier).toBe(2);
        expect(verdictFor({ champions: [{}] }, 'champions', 0)).toBe(null);
    });
    it('orders consistent first, or shows only them — counting what it hides, by why', () => {
        const rows = ['a', 'b', 'c', 'd'];
        const vs = [v(2), v(0), null, v(1)];
        const at = (i) => vs[i];
        expect(orderRows(rows, at, 'ranked').shown.map((x) => x.row)).toEqual(['a', 'b', 'c', 'd']);
        expect(orderRows(rows, at, 'consistent').shown.map((x) => x.row)).toEqual(['b', 'd', 'a', 'c']);
        const only = orderRows(rows, at, 'only');
        expect(only.shown.map((x) => x.row)).toEqual(['b']);
        expect(only.hidden).toBe(3);
        expect(only.hiddenWhy).toBe('1 not consistent, 1 partly tested, 1 not measured');
        expect(only.shown[0].i).toBe(1, 'keeps its rank number');
    });
    it('says it in words', () => {
        expect(marketParts(v(2)).map((p) => p.text)).toEqual(['rising -₹19,078 (8)', 'falling +₹1,33,146 (5)', 'sideways +₹19,851 (11)']);
        expect(monthText(v(2))).toBe('best month Mar 2026 = 122% of the profit · profitable months 4 of 8');
        expect(mixText('NSE:MIDCPNIFTY-INDEX', { mix: { rising: 50, falling: 33, sideways: 74 } })).toBe('MIDCPNIFTY: 50 rising · 33 falling · 74 sideways days');
        expect(monthLabel('2026-10')).toBe('Oct 2026');
    });
});

describe('ConsistencyView', () => {
    it('a badge: the verdict, its reasons and the split by market and month', () => {
        render(<ConsistencyBadge v={v(2)} />);
        const b = screen.getByTestId('consistency-badge').textContent;
        expect(b).toMatch(/✗ Not consistent/);
        expect(b).toMatch(/loses in rising markets/);
        expect(b).toMatch(/122% of the profit came from Mar 2026/);
        expect(b).toMatch(/falling \+₹1,33,146 \(5\)/);
        expect(b).toMatch(/profitable months 4 of 8/);
    });
    it('a consistent one says so plainly; a table cell says it in one mark', () => {
        render(<ConsistencyBadge v={v(0, { why: [] })} />);
        expect(screen.getByTestId('consistency-badge').textContent).toMatch(/✓ Consistent — profitable in rising, falling and sideways markets/);
        const { container } = render(<table><tbody><tr><td><ConsistencyBadge v={null} compact /></td></tr></tbody></table>);
        expect(container.textContent).toBe('—');
    });
    it('the range\'s market mix and the rule, so a one-sided range is visible', () => {
        render(<MarketMix markets={{ 'NSE:MIDCPNIFTY-INDEX': { mix: { rising: 50, falling: 33, sideways: 74 }, lookback: 20 } }} rules={{ minTradesPerMarket: 5, maxBestMonthShare: 0.5 }} />);
        const t = screen.getByTestId('market-mix').textContent;
        expect(t).toMatch(/previous 20 sessions/);
        expect(t).toMatch(/MIDCPNIFTY: 50 rising · 33 falling · 74 sideways days/);
        expect(t).toMatch(/at least 5 trades in each/);
        expect(t).toMatch(/more than 50% of its profit/);
    });
    it('checks an old run: starts, shows progress, then hands back for a reload', async () => {
        const onDone = vi.fn();
        render(<ConsistencyCheckBar jobId="mlopt_x" count={45} checked={null} onDone={onDone} />);
        fireEvent.click(screen.getByText('Check consistency of these 45 strategies'));
        await waitFor(() => expect(screen.getByText(/replaying 3\/45/)).toBeTruthy(), { timeout: 4000 });
        await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 6000 });
    });
});
