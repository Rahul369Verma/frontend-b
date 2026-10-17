/**
 * Charts — trades drawn so a busy chart stays readable (user, 17-Oct-2026).
 *
 *  - Filters apply to the chart AND the table: the same trades, always.
 *  - A trade with no mark on these candles is still listed, and counted in words
 *    (an open structure entered weeks ago, a trade with no recorded time).
 *  - Hovering a table row lights the trade up on the chart; clicking a mark on
 *    the chart focuses it in the table.
 *  - The words moved off the canvas into the tooltip, so the tooltip must say
 *    what the trade was, the net and why it closed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ThemeProvider from '../theme/ThemeContext.jsx';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

// The real chart is a canvas; this stand-in records what the page hands it.
const chartProps = { current: null };
vi.mock('../components/charts/PriceChart', () => ({
    default: (props) => { chartProps.current = props; return <div data-testid="chart-stub" />; },
}));

import axios from 'axios';
import Charts from './Charts.jsx';

const T0 = 1791776700;            // 12-Oct-2026 09:15 IST, in UTC seconds
const candles = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * 300, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
const iso = (s) => new Date(s * 1000).toISOString();
const overlays = {
    trades: [
        { id: 'a1', kind: 'single', label: 'breakout_range · CE', side: 1, net: 1250, reason: 'Target hit', entryAt: iso(T0 + 600), exitAt: iso(T0 + 1800), entrySpot: 23001, exitSpot: 23040 },
        { id: 'b2', kind: 'single', label: 'universal · PE', side: 1, net: -893, reason: 'SL Hit', entryAt: iso(T0 + 3000), exitAt: iso(T0 + 3600), entrySpot: 23050, exitSpot: 23070 },
        { id: 'm3', kind: 'multileg', label: 'old-strangle (OPEN)', open: true, net: -320, entryAt: iso(T0 - 20 * 86400) },
    ],
    markers: [
        { tradeId: 'a1', kind: 'entry', time: T0 + 600, price: 23001, shape: 'arrowUp' },
        { tradeId: 'a1', kind: 'exit', time: T0 + 1800, price: 23040, shape: 'circle' },
        { tradeId: 'b2', kind: 'entry', time: T0 + 3000, price: 23050, shape: 'arrowDown' },
        { tradeId: 'b2', kind: 'exit', time: T0 + 3600, price: 23070, shape: 'circle' },
        { tradeId: 'm3', kind: 'entry', time: T0 - 20 * 86400, price: 22000, shape: 'square' },   // weeks before these candles
    ],
    priceLines: [],
};

async function renderPage() {
    axios.get.mockImplementation((url) => {
        if (/\/chart\/symbols/.test(url)) return Promise.resolve({ data: [] });
        if (/\/chart\/candles/.test(url)) return Promise.resolve({ data: { candles, meta: {} } });
        if (/\/chart\/overlays/.test(url)) return Promise.resolve({ data: overlays });
        return Promise.resolve({ data: {} });
    });
    render(<ThemeProvider><MemoryRouter initialEntries={['/charts']}><Charts /></MemoryRouter></ThemeProvider>);
    await screen.findByTestId('chart-stub');
    await vi.waitFor(() => expect(chartProps.current?.trades?.length).toBe(3));
}

describe('Charts — trades on the chart', () => {
    beforeEach(() => { chartProps.current = null; try { localStorage.clear(); } catch { /* ignore */ } });

    it('draws marks with no library text, lists every trade, and counts the one with no mark here', async () => {
        await renderPage();
        expect(chartProps.current.markers).toEqual([]);               // no on-canvas sentences
        expect(chartProps.current.trades.map((s) => s.id).sort()).toEqual(['a1', 'b2', 'm3']);
        expect(screen.getByText(/3 trades · 1 with no mark in this window/)).toBeTruthy();
        expect(screen.getByText('old-strangle (OPEN)')).toBeTruthy();  // still in the table
        expect(screen.getByTestId('chart-legend').textContent).toMatch(/CE entry.*PE entry.*several trades/);
    });

    it('a filter narrows the chart and the table together (an open position under water is not a "loser" yet)', async () => {
        await renderPage();
        fireEvent.click(within(screen.getByTestId('trade-filters')).getByRole('button', { name: 'Losers' }));
        expect(chartProps.current.trades.map((s) => s.id)).toEqual(['b2']);
        expect(screen.getByText(/Trades in this window \(1 of 3 — filtered\)/)).toBeTruthy();
        expect(screen.queryByText('breakout_range · CE')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /show all 3/ }));
        expect(chartProps.current.trades).toHaveLength(3);
    });

    it('a remembered strategy this symbol never traded falls back to all', async () => {
        localStorage.setItem('charts:tradeFilter', JSON.stringify({ outcome: 'all', kind: 'all', strategy: 'gone_strategy', connectors: true }));
        await renderPage();
        expect(chartProps.current.trades).toHaveLength(3);
        expect(screen.getByRole('combobox', { name: 'Strategy' }).value).toBe('all');
    });

    it('row hover lights the trade on the chart; a click on its mark focuses it', async () => {
        await renderPage();
        fireEvent.mouseEnter(screen.getByText('universal · PE').closest('tr'));
        // the hover travels through a small store (not page state), so the chart may
        // re-render a tick after the event rather than inside it
        await vi.waitFor(() => expect(chartProps.current.hoverTradeIds).toEqual(['b2']));
        act(() => { chartProps.current.onTradeClick('a1'); });
        expect(chartProps.current.selectedTradeId).toBe('a1');
        act(() => { chartProps.current.onTradeClick('a1'); });          // again → back to all
        expect(chartProps.current.selectedTradeId).toBeNull();
    });

    it('a bubble of trades on one bar lists them to pick from', async () => {
        await renderPage();
        act(() => { chartProps.current.onClusterPick(['a1', 'b2']); });
        const picker = screen.getByTestId('trade-picker');
        expect(picker.textContent).toMatch(/2 trades sit on the same bar/);
        fireEvent.click(within(picker).getByRole('button', { name: /universal · PE/ }));
        expect(chartProps.current.selectedTradeId).toBe('b2');
        expect(screen.queryByTestId('trade-picker')).toBeNull();
    });

    it('the tooltip says what it was, in and out, the net and why it closed', async () => {
        await renderPage();
        const { container } = render(<div>{chartProps.current.renderTradeTip({ type: 'trade', tradeId: 'b2', kind: 'entry' })}</div>);
        expect(container.textContent).toMatch(/universal · PE/);
        expect(container.textContent).toMatch(/In .*@ 23,050/);
        expect(container.textContent).toMatch(/−?₹\s?893|-₹893/);
        expect(container.textContent).toMatch(/SL Hit/);
        const cl = render(<div>{chartProps.current.renderTradeTip({ type: 'cluster', tradeIds: ['a1', 'b2'] })}</div>);
        expect(cl.container.textContent).toMatch(/2 trades here — click to zoom in/);
        const same = render(<div>{chartProps.current.renderTradeTip({ type: 'cluster', tradeIds: ['a1', 'b2'], sameBar: true })}</div>);
        expect(same.container.textContent).toMatch(/2 trades here — click to pick one/);
        const L = chartProps.current.tradeLabelFor({ id: 'a1' });
        expect(L.entry).toBe('BUY CE 23,001');
        expect(L.exit).toMatch(/1,250 · Target hit/);
    });
});
