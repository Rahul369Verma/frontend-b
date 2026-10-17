/**
 * The chart's own text must follow the app's Text-size axis.
 *
 * ── WHY THIS NEEDS A TEST ───────────────────────────────────────────────────
 * lightweight-charts draws its price axis, time axis, crosshair labels and price
 * line labels into a CANVAS. Canvas text is sized in absolute pixels and cannot
 * see `rem`, so the Text-size preference — which scales every other glyph in the
 * app — left this chart's numbers frozen at the library's 12px default. Setting
 * 1.4x produced bigger tables next to a chart whose axis was unchanged.
 *
 * Nothing else can catch that: it is not a lint error, not a type error, and the
 * render smoke test passes because the component mounts fine. Only asserting the
 * options handed to createChart does.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import ThemeProvider from '../../theme/ThemeContext.jsx';

// Capture what PriceChart actually configures the chart with.
const captured = { options: [] };
vi.mock('lightweight-charts', () => {
    const series = {
        setData: vi.fn(), createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn(), applyOptions: vi.fn(),
        // v5 plugin API — PriceChart attaches its trend-line primitive here.
        attachPrimitive: vi.fn(), detachPrimitive: vi.fn(),
        priceToCoordinate: vi.fn(() => 100), coordinateToPrice: vi.fn(() => 24000),
    };
    const chart = {
        addSeries: vi.fn(() => series),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        timeScale: vi.fn(() => ({
            fitContent: vi.fn(), setVisibleRange: vi.fn(),
            getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })), setVisibleLogicalRange: vi.fn(),
            timeToCoordinate: vi.fn(() => 50),
        })),
        applyOptions: vi.fn(), subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(), remove: vi.fn(),
        subscribeClick: vi.fn(), unsubscribeClick: vi.fn(),
    };
    return {
        createChart: vi.fn((el, opts) => { captured.options.push(opts); return chart; }),
        createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
        CandlestickSeries: 'Candlestick', HistogramSeries: 'Histogram',
        CrosshairMode: { Normal: 0 }, ColorType: { Solid: 'solid' },
        LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    };
});

import PriceChart from './PriceChart.jsx';
import { STORAGE_KEY, STORAGE_VERSION } from '../../theme/prefs.js';

const CANDLES = [
    { time: 1787716800, open: 100, high: 110, low: 95, close: 105, volume: 10 },
    { time: 1787717100, open: 105, high: 112, low: 101, close: 108, volume: 12 },
];

/**
 * Render at a given Text-size setting and return the chart's layout options.
 * Writes the SAME persisted shape ThemeProvider reads (version + prefs under
 * the real STORAGE_KEY) — a hand-invented key would make every assertion below
 * pass against the default and prove nothing.
 */
function layoutAt(fontScale) {
    captured.options = [];
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, prefs: { fontScale } }));
    } catch { /* a private window has no storage; the default path still matters */ }
    render(<ThemeProvider><PriceChart candles={CANDLES} /></ThemeProvider>);
    return captured.options[0]?.layout || null;
}

describe('PriceChart canvas text', () => {
    beforeEach(() => { captured.options = []; try { localStorage.clear(); } catch { /* ignore */ } });

    it('sets an explicit fontSize instead of leaving the library default', () => {
        const layout = layoutAt(1);
        expect(layout).toBeTruthy();
        expect(typeof layout.fontSize).toBe('number');
        // 12 is the library default AND `xs` at scale 1 — so a reader who has
        // never touched the setting sees exactly what they saw before.
        expect(layout.fontSize).toBe(12);
    });

    it('sets a font family so the Typeface axis reaches the canvas too', () => {
        const layout = layoutAt(1);
        // jsdom may resolve an empty computed family; the contract is that the
        // key is present and never a hard-coded face.
        expect('fontFamily' in layout).toBe(true);
    });

    it('SCALES with the Text-size axis — the bug this file exists for', () => {
        const base = layoutAt(1).fontSize;
        const big = layoutAt(1.4).fontSize;
        expect(base).toBe(12);
        expect(big).toBe(17);                     // round(12 * 1.4)
        expect(big).toBeGreaterThan(base);
    });

    it('scales DOWN too, but never below the readable floor', () => {
        expect(layoutAt(0.5).fontSize).toBeGreaterThanOrEqual(6);
    });

    it('leaves the time scale FREE by default — zooming out past the data is allowed', () => {
        // Pinning both edges stops the chart drifting into blank space, but it
        // also removes the ability to zoom out: with five daily candles they get
        // stretched across the whole pane with no way to shrink them. Whitespace
        // around the data is a legitimate thing to want, so free is the default.
        const opts = (layoutAt(1), captured.options[0]);
        expect(opts.timeScale.fixLeftEdge).toBe(false);
        expect(opts.timeScale.fixRightEdge).toBe(false);
    });

    it('pins both edges when the caller asks to lock', () => {
        captured.options = [];
        render(<ThemeProvider><PriceChart candles={CANDLES} lockToData /></ThemeProvider>);
        const ts = captured.options[0].timeScale;
        expect(ts.fixLeftEdge).toBe(true);
        expect(ts.fixRightEdge).toBe(true);
    });

    it('leaves the price scale to auto-width rather than pinning it', () => {
        // The library sizes this scale to its widest label. A hard floor would
        // pad a two-digit option-premium axis with dead space for no gain.
        const opts = (layoutAt(1.4), captured.options[0]);
        expect(opts.rightPriceScale.minimumWidth).toBeUndefined();
    });
});

// ── the trade layer: hover a mark → tooltip + linked highlight; click → focus ──
// (user, 17-Oct-2026: 168 overlapping marker texts made the chart unreadable;
// the words moved into a tooltip, so the tooltip has to actually appear.)
describe('PriceChart trade marks', () => {
    const SHAPES = [{
        id: 'a1', kind: 'single', side: 'CE', won: true, net: 1250, label: 'breakout_range · CE',
        entry: { t: CANDLES[0].time, p: 105, shape: 'arrowUp' }, exit: { t: CANDLES[1].time, p: 108, shape: 'circle' },
    }];

    async function mountWithTrades(props = {}) {
        const lw = await import('lightweight-charts');
        const chart = lw.createChart.mock.results.at(-1)?.value || lw.createChart();
        const before = { attach: 0, move: chart.subscribeCrosshairMove.mock.calls.length, click: chart.subscribeClick.mock.calls.length };
        const series = chart.addSeries();
        before.attach = series.attachPrimitive.mock.calls.length;
        const onTradeHover = vi.fn(), onTradeClick = vi.fn();
        render(
            <ThemeProvider>
                <PriceChart candles={CANDLES} trades={SHAPES} onTradeHover={onTradeHover} onTradeClick={onTradeClick}
                    renderTradeTip={(hit) => (hit?.type === 'trade' ? `trade ${hit.tradeId}` : null)} {...props} />
            </ThemeProvider>,
        );
        // the trade primitive is the second one PriceChart attaches (trend lines first)
        const prims = series.attachPrimitive.mock.calls.slice(before.attach).map((c) => c[0]);
        const tradePrim = prims.find((p) => typeof p.hitTest === 'function');
        // paint one frame with a deterministic projection: bar i → x 100 + 50i, price p → y 500 − p
        const fakeChart = { timeScale: () => ({ logicalToCoordinate: (li) => (Number.isInteger(li) ? 100 + li * 50 : 0) }) };
        tradePrim.attached({ chart: fakeChart, series: { priceToCoordinate: (p) => 500 - p }, requestUpdate: () => {} });
        tradePrim.paneViews()[0].renderer().draw({
            useMediaCoordinateSpace: (fn) => fn({
                context: new Proxy({ measureText: () => ({ width: 30 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true }),
                mediaSize: { width: 600, height: 300 },
            }),
        });
        const move = chart.subscribeCrosshairMove.mock.calls.slice(before.move).map((c) => c[0]);
        const click = chart.subscribeClick.mock.calls.slice(before.click).map((c) => c[0]);
        return { move, click, onTradeHover, onTradeClick };
    }

    it('hovering an entry mark shows the tooltip and reports the trade', async () => {
        const { move, onTradeHover } = await mountWithTrades();
        act(() => { move.forEach((fn) => fn({ point: { x: 101, y: 396 }, time: CANDLES[0].time + 19800, seriesData: new Map() })); });
        expect(screen.getByTestId('trade-tip').textContent).toBe('trade a1');
        expect(onTradeHover).toHaveBeenLastCalledWith(['a1']);
        act(() => { move.forEach((fn) => fn({ point: { x: 400, y: 20 }, seriesData: new Map() })); });
        expect(screen.queryByTestId('trade-tip')).toBeNull();
        expect(onTradeHover).toHaveBeenLastCalledWith(null);
    });

    it('clicking a mark focuses that trade', async () => {
        const { click, onTradeClick } = await mountWithTrades();
        click.forEach((fn) => fn({ point: { x: 150, y: 392 }, time: CANDLES[1].time + 19800 }));
        expect(onTradeClick).toHaveBeenCalledWith('a1');
    });
});

// ── a rebuilt chart must not come back empty (17-Oct-2026: "Free zoom" → blank chart) ──
describe('PriceChart rebuilds and the zoom lock', () => {
    it('toggling the lock is an option change, not a new chart', async () => {
        const lw = await import('lightweight-charts');
        const { rerender } = render(<ThemeProvider><PriceChart candles={CANDLES} /></ThemeProvider>);
        const created = lw.createChart.mock.calls.length;
        const chart = lw.createChart.mock.results.at(-1).value;
        chart.applyOptions.mockClear();
        rerender(<ThemeProvider><PriceChart candles={CANDLES} lockToData /></ThemeProvider>);
        expect(lw.createChart.mock.calls.length).toBe(created);
        expect(chart.applyOptions).toHaveBeenCalledWith({ timeScale: { fixLeftEdge: true, fixRightEdge: true } });
    });

    it('when the chart IS rebuilt (height, volume pane, theme), the candles go back on it', async () => {
        const lw = await import('lightweight-charts');
        const { rerender } = render(<ThemeProvider><PriceChart candles={CANDLES} height={400} /></ThemeProvider>);
        const series = lw.createChart.mock.results.at(-1).value.addSeries();
        series.setData.mockClear();
        const created = lw.createChart.mock.calls.length;
        rerender(<ThemeProvider><PriceChart candles={CANDLES} height={500} /></ThemeProvider>);
        expect(lw.createChart.mock.calls.length).toBe(created + 1);
        expect(series.setData).toHaveBeenCalled();
        expect(series.setData.mock.calls.at(-1)[0]).toHaveLength(CANDLES.length);
    });
});
