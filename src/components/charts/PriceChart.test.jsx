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
import { render } from '@testing-library/react';
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
