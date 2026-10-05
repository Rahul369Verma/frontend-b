/**
 * The opened day's chart with the India VIX overlay, actually drawn.
 *
 * jsdom has no layout, so ResponsiveContainer measures 0×0 and recharts draws
 * nothing — which would let the one real hazard here pass silently: with a
 * second YAxis present, a mark whose yAxisId matches no axis is DROPPED. This
 * file gives the chart a fixed size and counts what was drawn, on and off.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('recharts', async (importOriginal) => {
    const actual = await importOriginal();
    const Fixed = ({ children }) => React.cloneElement(children, { width: 600, height: 220 });
    return { ...actual, ResponsiveContainer: Fixed };
});

const { default: DayEquityCurves } = await import('./DayEquityCurves.jsx');

const IST = 5.5 * 3600e3;
const istMs = (day, hh, mm) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) - IST;
};

const DAY = '2026-09-28';
const dayCurve = {
    day: DAY, startMs: istMs(DAY, 9, 15), endMs: istMs(DAY, 15, 40), total: 1250,
    points: [
        { ms: istMs(DAY, 9, 15), pnl: 0 }, { ms: istMs(DAY, 10, 0), pnl: 0 }, { ms: istMs(DAY, 10, 30), pnl: -150 },
        { ms: istMs(DAY, 11, 30), pnl: 1250 }, { ms: istMs(DAY, 15, 40), pnl: 1250 },
    ],
    trades: [{ id: 't1', label: 'NIFTY 25000CE CALL', entryMs: istMs(DAY, 10, 0), exitMs: istMs(DAY, 11, 30), contribution: 1250, carriedIn: false, carriedOut: false, marked: true, pathSource: 'archive' }],
    markers: [{ ms: istMs(DAY, 10, 0), kind: 'entry', id: 't1', label: 'x' }, { ms: istMs(DAY, 11, 30), kind: 'exit', id: 't1', label: 'x' }],
    coverage: { trades: 1, marked: 1, bookedOnly: 0 },
};

const fetcher = () => vi.fn(async ({ days, intraday }) => {
    const out = {};
    for (const d of [...days, ...intraday]) {
        out[d] = {
            day: d, prevClose: 12.16, close: 13.64, change: 1.48, changePct: 12.17, provisional: false, reason: null,
            intraday: intraday.includes(d) ? {
                points: [{ ms: istMs(d, 9, 16), v: 13.2 }, { ms: istMs(d, 10, 0), v: 13.3 }, { ms: istMs(d, 11, 30), v: 13.65 }, { ms: istMs(d, 15, 30), v: 13.62 }],
                high: 13.65, low: 13.2, bars: 4,
            } : null,
        };
    }
    return { resolution: '1', source: { daily: 'fyers', intraday: 'fyers' }, days: out, warnings: [] };
});

/** Every P&L tick gets its horizontal grid line. On the default yAxisId the grid
 *  found no axis once the P&L axis was named, and drew only the top and bottom. */
function expectGridOnPnlTicks(panel) {
    const pnlTicks = [...panel.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')]
        .filter((t) => t.getAttribute('text-anchor') === 'end');
    const grid = panel.querySelectorAll('.recharts-cartesian-grid-horizontal line');
    expect(pnlTicks.length).toBeGreaterThan(2);
    expect(grid).toHaveLength(pnlTicks.length);
}

describe('DayEquityCurves — the VIX overlay is drawn on its own axis', () => {
    beforeEach(() => { try { localStorage.clear(); } catch { /* storage blocked */ } });

    it('OFF: one line, one Y axis, both trade markers', () => {
        render(<DayEquityCurves days={[dayCurve]} excluded={{}} vixFetcher={fetcher()} />);
        fireEvent.click(screen.getByRole('button', { name: /Mon 28 Sep 2026/ }));
        const panel = screen.getByRole('region', { name: 'P&L on Mon 28 Sep 2026' });
        expect(panel.querySelectorAll('.recharts-line')).toHaveLength(1);
        expect(panel.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
        expect(panel.querySelectorAll('.recharts-reference-dot')).toHaveLength(2);
        expectGridOnPnlTicks(panel);
    });

    it('ON: P&L and VIX lines, a right-hand VIX axis, the prev-close rule, and the markers still on the P&L axis', async () => {
        render(<DayEquityCurves days={[dayCurve]} excluded={{}} vixFetcher={fetcher()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        fireEvent.click(screen.getByRole('button', { name: /Mon 28 Sep 2026/ }));
        const panel = screen.getByRole('region', { name: 'P&L on Mon 28 Sep 2026' });
        await within(panel).findByText('India VIX (right axis)');
        await waitFor(() => expect(panel.querySelectorAll('.recharts-line')).toHaveLength(2));
        expect(panel.querySelectorAll('.recharts-yAxis')).toHaveLength(2);
        // One axis in rupees (left, end-anchored ticks), the other in VIX points
        // (right, start-anchored), its domain stretched to take in the 12.16 prev close.
        const yTicks = [...panel.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')];
        const left = yTicks.filter((t) => t.getAttribute('text-anchor') === 'end').map((t) => t.textContent);
        const right = yTicks.filter((t) => t.getAttribute('text-anchor') === 'start').map((t) => Number(t.textContent));
        expect(left.length).toBeGreaterThan(1);
        expect(left.every((t) => t.includes('₹'))).toBe(true);
        expect(right.length).toBeGreaterThan(1);
        expect(right.every((v) => Number.isFinite(v) && v > 11 && v < 15)).toBe(true);
        expect(Math.min(...right)).toBeLessThanOrEqual(12.16);
        expect(panel.querySelectorAll('.recharts-reference-dot')).toHaveLength(2);
        expect(within(panel).getByText('VIX prev close')).toBeTruthy();       // the rule's own label, in the SVG
        // Both curves have a drawn path; the P&L one is painted last (on top).
        const paths = [...panel.querySelectorAll('.recharts-line path.recharts-curve')];
        expect(paths).toHaveLength(2);
        expect(paths.every((p) => (p.getAttribute('d') || '').length > 10)).toBe(true);
        expect(paths[1].getAttribute('stroke-width')).toBe('2');
        expectGridOnPnlTicks(panel);
        // The dashed prev-close rule is a VIX mark too: painted before (under) the P&L line.
        const painted = [...panel.querySelectorAll('.recharts-reference-line-line, .recharts-line path.recharts-curve')];
        const prevRule = painted.findIndex((el) => el.getAttribute('stroke-dasharray') === '4 3');
        const pnlLine = painted.findIndex((el) => el.getAttribute('stroke-width') === '2');
        expect(prevRule).toBeGreaterThanOrEqual(0);
        expect(pnlLine).toBeGreaterThan(prevRule);

        // Hover: one tooltip reports both series at the same instant, VIX against its prev close.
        // recharts scales the pointer by rect.width / offsetWidth, which jsdom reports as 0/0.
        const wrapper = panel.querySelector('.recharts-wrapper');
        wrapper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 220, width: 600, height: 220, x: 0, y: 0 });
        Object.defineProperty(wrapper, 'offsetWidth', { configurable: true, value: 600 });
        Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 220 });
        fireEvent.mouseMove(wrapper, { clientX: 400, clientY: 100 });
        const tip = await waitFor(() => {
            const el = [...panel.querySelectorAll('div')].find((d) => /day P&L/.test(d.textContent) && /VIX \d/.test(d.textContent) && d.children.length >= 3);
            expect(el).toBeTruthy();
            return el;
        });
        expect(tip.textContent).toMatch(/VIX 13\.(65|62) \(\+1\.(49|46) vs prev close\)/);
    });
});
