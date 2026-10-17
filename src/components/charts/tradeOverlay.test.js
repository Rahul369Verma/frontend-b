/**
 * The trade layer on the price chart (user, 17-Oct-2026: "it is not possible to
 * read charts like this" — 87 trades drew 168 overlapping sentences).
 *
 * What must hold for the chart to stay readable at any density:
 *   • a trade is ONE object (entry + exit joined by tradeId), never two loose labels;
 *   • a 10:18 fill sits between the 10:15 and 10:20 bars, and a 15:29 exit never
 *     slides into the next morning across the overnight gap;
 *   • marks that would overlap become one numbered bubble; marks that do not stay apart;
 *   • the pointer finds a single mark, or the bubble with every trade in it.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildTradeShapes, barSeconds, fractionalIndex, clusterMarks, createTradeOverlayPrimitive } from './tradeOverlay.js';

const OVERLAYS = {
    trades: [
        { id: 'a1', kind: 'single', label: 'breakout_range · CE', net: 1250, reason: 'Target hit', entryAt: '2026-10-16T04:00:00Z', exitAt: '2026-10-16T04:30:00Z' },
        { id: 'b2', kind: 'single', label: 'universal · PE', net: -893, reason: 'SL Hit', entryAt: '2026-10-16T05:00:00Z', exitAt: '2026-10-16T05:20:00Z' },
        { id: 'm3', kind: 'multileg', label: 'Iron fly NIFTY (OPEN)', net: null, open: true, entryAt: '2026-10-16T06:00:00Z' },
        { id: 'nomarks', kind: 'single', label: 'x · CE', net: 10 },
    ],
    markers: [
        { tradeId: 'a1', kind: 'entry', time: 1000, price: 24000, shape: 'arrowUp', position: 'belowBar' },
        { tradeId: 'a1', kind: 'exit', time: 2800, price: 24050, shape: 'circle' },
        { tradeId: 'b2', kind: 'entry', time: 4600, price: 24100, shape: 'arrowDown' },
        { tradeId: 'b2', kind: 'exit', time: 5800, price: 24060 },
        { tradeId: 'm3', kind: 'entry', time: 8200, shape: 'square', position: 'aboveBar' },
        { tradeId: '', kind: 'entry', time: 1 },                // no trade — ignored
        { tradeId: 'a1', kind: 'entry', time: 'not-a-time' },   // unusable time — ignored, first entry kept
    ],
};

describe('buildTradeShapes', () => {
    const shapes = buildTradeShapes(OVERLAYS);
    const by = Object.fromEntries(shapes.map((s) => [s.id, s]));

    it('joins entry and exit into one round trip per trade', () => {
        expect(by.a1.entry).toEqual({ t: 1000, p: 24000, anchor: 'belowBar', shape: 'arrowUp' });
        expect(by.a1.exit).toMatchObject({ t: 2800, p: 24050 });
        expect(by.a1).toMatchObject({ won: true, strategy: 'breakout_range', side: 'CE', reason: 'Target hit' });
    });
    it('reads the side and the result: PE loser, open structure with no price', () => {
        expect(by.b2).toMatchObject({ side: 'PE', won: false, net: -893 });
        expect(by.m3).toMatchObject({ side: 'structure', open: true, won: null, strategy: 'Iron fly NIFTY', exit: null });
        expect(by.m3.entry.p).toBeNull();
    });
    it('drops trades with nothing to draw, and markers with no trade', () => {
        expect(by.nomarks).toBeUndefined();
        expect(shapes.map((s) => s.id).sort()).toEqual(['a1', 'b2', 'm3']);
        expect(buildTradeShapes(null)).toEqual([]);
    });
});

describe('placement between bars', () => {
    // two 5-minute sessions with an overnight gap between 1200 and 90000
    const times = [0, 300, 600, 900, 1200, 90000, 90300, 90600];

    it('takes the typical bar, not the overnight gap', () => {
        expect(barSeconds(times)).toBe(300);
        expect(barSeconds([5])).toBe(60);
    });
    it('a fill inside a bar sits proportionally between bars', () => {
        expect(fractionalIndex(times, 300)).toBe(1);
        expect(fractionalIndex(times, 480)).toBeCloseTo(1.6);
    });
    it('a late exit stays on its own session, never sliding into the next morning', () => {
        const li = fractionalIndex(times, 1490);         // 290 s after the session's last bar
        expect(li).toBeGreaterThan(4);
        expect(li).toBeLessThan(5);                      // NOT index 5 (next session)
        expect(fractionalIndex(times, 50000)).toBeLessThan(5);
    });
    it('outside the loaded bars → nothing to draw (no marks pinned to the edge)', () => {
        expect(fractionalIndex(times, -1000)).toBeNull();
        expect(fractionalIndex(times, 90600 + 900)).toBeNull();
        expect(fractionalIndex(times, -100)).toBe(0);    // within one bar of the start
        expect(fractionalIndex([], 10)).toBeNull();
    });
});

describe('clusterMarks', () => {
    it('merges marks that would overlap and keeps the rest apart', () => {
        const cl = clusterMarks([{ x: 100, y: 50, id: 1 }, { x: 104, y: 52, id: 2 }, { x: 108, y: 49, id: 3 }, { x: 160, y: 50, id: 4 }, { x: 100, y: 200, id: 5 }]);
        const sizes = cl.map((c) => c.items.map((m) => m.id).sort());
        expect(sizes).toContainEqual([1, 2, 3]);
        expect(sizes).toContainEqual([4]);
        expect(sizes).toContainEqual([5]);               // same x, far apart in price → separate
        expect(cl).toHaveLength(3);
    });
});

/** A canvas that records nothing — enough for draw() to run. */
function fakeCtx() {
    const noop = () => {};
    return new Proxy({ measureText: () => ({ width: 40 }) }, {
        get: (o, k) => (k in o ? o[k] : noop),
        set: () => true,
    });
}

function paint(prim, state) {
    // like lightweight-charts 5.2.1: a FRACTIONAL logical index projects to 0
    const chart = { timeScale: () => ({ logicalToCoordinate: (li) => (Number.isInteger(li) ? li * 20 : 0) }) };
    const series = { priceToCoordinate: (p) => 1000 - (p - 24000) * 2 };
    prim.attached({ chart, series, requestUpdate: vi.fn() });
    const target = { useMediaCoordinateSpace: (fn) => fn({ context: fakeCtx(), mediaSize: { width: 800, height: 400 } }) };
    prim.paneViews()[0].renderer().draw(target);
    return state;
}

describe('the drawn layer answers "what is under the pointer"', () => {
    const times = Array.from({ length: 40 }, (_, i) => i * 300);
    const base = { times, barSec: 300, barsByIndex: times.map((t) => ({ time: t, high: 24010, low: 23990 })), hoverIds: new Set(), connectors: true, colors: {} };
    const shape = (id, entryT, exitT, p = 24000, side = 'CE') => ({ id, side, won: true, entry: { t: entryT, p, shape: 'arrowUp' }, exit: { t: exitT, p: p + 5, shape: 'circle' } });

    it('a lone mark is a trade; two overlapping trades are one bubble that lists both', () => {
        const shapes = [shape('solo', 0, 3000), shape('x', 6000, 9000, 24100), shape('y', 6000, 9300, 24101)];
        const prim = createTradeOverlayPrimitive(() => ({ ...base, shapes, selectedId: null }));
        paint(prim);
        // 'solo' entry at index 0 → x 0, y 1000
        expect(prim.hitTest(1, 1001)).toEqual({ type: 'trade', tradeId: 'solo', kind: 'entry' });
        // 'x' and 'y' entries at index 20 → x 400, y ≈ 800
        const hit = prim.hitTest(400, 799);
        expect(hit.type).toBe('cluster');
        expect(hit.tradeIds.sort()).toEqual(['x', 'y']);
        expect(hit.tFrom).toBe(6000);
        expect(hit.sameBar).toBe(true);                  // both entered on bar 20: zoom can never split them
        expect(prim.hitTest(700, 50)).toBeNull();
    });

    it('the selected trade is never folded into a bubble', () => {
        const shapes = [shape('x', 6000, 9000, 24100), shape('y', 6000, 9300, 24101)];
        const prim = createTradeOverlayPrimitive(() => ({ ...base, shapes, selectedId: 'x', labelFor: () => ({ entry: 'BUY CE 24100', exit: '₹1,250' }) }));
        paint(prim);
        const hit = prim.hitTest(400, 800);
        expect(hit).toMatchObject({ type: 'trade' });
        expect(['x', 'y']).toContain(hit.tradeId);
    });

    it('a fill BETWEEN bars lands between them, not on the left edge (the library answers 0 for a fraction)', () => {
        const shapes = [shape('mid', 6150, 9000, 24000)];          // half-way through bar 20 → x 410
        const prim = createTradeOverlayPrimitive(() => ({ ...base, shapes, selectedId: null }));
        paint(prim);
        expect(prim.hitTest(410, 1000)).toEqual({ type: 'trade', tradeId: 'mid', kind: 'entry' });
        expect(prim.hitTest(0, 1000)).toBeNull();
    });

    it('detached → nothing is hit', () => {
        const prim = createTradeOverlayPrimitive(() => ({ ...base, shapes: [shape('solo', 0, 3000)] }));
        paint(prim);
        prim.detached();
        expect(prim.hitTest(0, 1000)).toBeNull();
    });
});
