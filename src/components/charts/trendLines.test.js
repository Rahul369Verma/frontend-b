/**
 * trendLines — the parts that are provably right or wrong.
 *
 * Hit-testing geometry and persistence are pure functions, so they get real
 * tests. The canvas painting itself is verified by eye; what these lock down is
 * everything that could be silently wrong WITHOUT looking wrong: a line that
 * cannot be selected, a saved line that comes back mangled, or a drawing
 * leaking from one symbol onto another's chart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { distanceToSegment, loadLines, saveLines, isValidLine, storageKeyFor, TREND_LINE_STORAGE_KEY } from './trendLines.js';

describe('hit-testing geometry', () => {
    it('measures distance to the segment, not the infinite line', () => {
        // Point far off the END of a short segment must report the distance to
        // the endpoint. Using the infinite line would report ~0 and make empty
        // space select a line that is nowhere near the pointer.
        expect(distanceToSegment(100, 0, 0, 0, 10, 0)).toBe(90);
        expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);      // perpendicular
    });

    it('handles a degenerate zero-length segment without NaN', () => {
        // Two clicks in the same spot. Dividing by len2 here would be NaN, and
        // NaN <= 6 is false, so hit-testing would silently never match.
        const d = distanceToSegment(3, 4, 0, 0, 0, 0);
        expect(Number.isNaN(d)).toBe(false);
        expect(d).toBe(5);
    });

    it('measures a diagonal correctly', () => {
        expect(distanceToSegment(0, 10, 0, 0, 10, 10)).toBeCloseTo(Math.sqrt(50), 5);
    });
});

describe('validation', () => {
    it('accepts a line with two finite time+price points', () => {
        expect(isValidLine({ a: { time: 1, price: 2 }, b: { time: 3, price: 4 } })).toBe(true);
    });
    it('rejects a NULL coordinate — Number(null) is 0 and would validate', () => {
        // The trap: Number.isFinite(Number(null)) is true, so a null price would
        // pass and then paint a line at price 0, pinned to the chart floor,
        // asserting a level that never existed.
        expect(isValidLine({ a: { time: 1, price: null }, b: { time: 2, price: 3 } })).toBe(false);
        expect(isValidLine({ a: { time: null, price: 1 }, b: { time: 2, price: 3 } })).toBe(false);
        expect(isValidLine({ a: { time: 1, price: '' }, b: { time: 2, price: 3 } })).toBe(false);
        // ...but a genuine zero price is still a real coordinate.
        expect(isValidLine({ a: { time: 0, price: 0 }, b: { time: 2, price: 3 } })).toBe(true);
    });

    it('rejects anything missing a coordinate', () => {
        for (const bad of [
            null, {}, { a: { time: 1, price: 2 } },
            { a: { time: 1 }, b: { time: 2, price: 3 } },
            { a: { time: NaN, price: 1 }, b: { time: 2, price: 3 } },
            { a: { time: 1, price: null }, b: { time: 2, price: 3 } },
        ]) expect(isValidLine(bad)).toBe(false);
    });
});

describe('persistence', () => {
    const L = (id) => ({ id, a: { time: 1, price: 100 }, b: { time: 2, price: 110 } });
    beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

    it('round-trips a line', () => {
        saveLines('NSE:NIFTY50-INDEX', '5', [L('a')]);
        expect(loadLines('NSE:NIFTY50-INDEX', '5').map(l => l.id)).toEqual(['a']);
    });

    it('keeps symbols and resolutions apart — a 5m line is not a 1m line', () => {
        saveLines('NSE:NIFTY50-INDEX', '5', [L('five')]);
        saveLines('NSE:NIFTY50-INDEX', '1', [L('one')]);
        saveLines('NSE:NIFTYBANK-INDEX', '5', [L('bank')]);
        expect(loadLines('NSE:NIFTY50-INDEX', '5').map(l => l.id)).toEqual(['five']);
        expect(loadLines('NSE:NIFTY50-INDEX', '1').map(l => l.id)).toEqual(['one']);
        expect(loadLines('NSE:NIFTYBANK-INDEX', '5').map(l => l.id)).toEqual(['bank']);
    });

    it('clearing one chart leaves the others intact', () => {
        saveLines('A', '5', [L('a')]);
        saveLines('B', '5', [L('b')]);
        saveLines('A', '5', []);
        expect(loadLines('A', '5')).toEqual([]);
        expect(loadLines('B', '5').map(l => l.id)).toEqual(['b']);
    });

    it('drops corrupt rows instead of handing them to the renderer', () => {
        // A malformed point would project to NaN and paint an invisible or
        // wildly wrong line rather than failing loudly.
        localStorage.setItem(TREND_LINE_STORAGE_KEY, JSON.stringify({
            [storageKeyFor('A', '5')]: [L('good'), { a: { time: 1 }, b: null }, 'nonsense'],
        }));
        expect(loadLines('A', '5').map(l => l.id)).toEqual(['good']);
    });

    it('survives corrupt storage without throwing', () => {
        localStorage.setItem(TREND_LINE_STORAGE_KEY, '{not json');
        expect(loadLines('A', '5')).toEqual([]);
        expect(() => saveLines('A', '5', [L('a')])).not.toThrow();
    });
});
