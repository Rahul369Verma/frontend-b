import { describe, it, expect } from 'vitest';
import { DEFAULT_FILTERS, LIVE_CANDIDATES, passes, activeFilterCount, normaliseFilters, sortRows } from './scorecardFilters.js';

const r = (over = {}) => ({
    name: 'x', verdict: 'on-track', status: 'ACTIVE', trades: 20, net: 9000, perTrade: 450, winRate: 70, profitFactor: 2.1,
    maxDrawdown: -3000, costPct: 30, romPct: 0.4, tStat: 2.2, flags: [], consistency: { score: 62 }, readiness: { status: 'not-ready', passed: 6, total: 8 }, ...over,
});

describe('scorecard filters', () => {
    it('nothing set: every row passes', () => {
        expect(passes(r(), DEFAULT_FILTERS)).toBe(true);
        expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    });
    it('minimums and maximums, typed as text; a drawdown limit is a positive depth', () => {
        expect(passes(r(), { ...DEFAULT_FILTERS, minConsistency: '60' })).toBe(true);
        expect(passes(r(), { ...DEFAULT_FILTERS, minConsistency: '63' })).toBe(false);
        expect(passes(r(), { ...DEFAULT_FILTERS, maxDrawdown: '3000' })).toBe(true);
        expect(passes(r(), { ...DEFAULT_FILTERS, maxDrawdown: '2999' })).toBe(false);
        expect(passes(r(), { ...DEFAULT_FILTERS, maxCostPct: 29 })).toBe(false);
        expect(passes(r(), { ...DEFAULT_FILTERS, minRom: 'abc' })).toBe(true, 'a nonsense bound is ignored, not applied as 0');
    });
    it('a row without the figure a minimum asks for is hidden by it', () => {
        expect(passes(r({ romPct: null }), { ...DEFAULT_FILTERS, minRom: 0 })).toBe(false);
        expect(passes(r({ consistency: null }), { ...DEFAULT_FILTERS, minConsistency: 0 })).toBe(false);
        expect(passes(r({ trades: 0, maxDrawdown: 0 }), { ...DEFAULT_FILTERS, maxDrawdown: 5000 })).toBe(false, 'no trades: no drawdown to judge');
    });
    it('verdicts, live check and the switches', () => {
        expect(passes(r(), { ...DEFAULT_FILTERS, verdicts: ['drifting', 'bleeding'] })).toBe(false);
        expect(passes(r({ verdict: 'drifting' }), { ...DEFAULT_FILTERS, verdicts: ['drifting', 'bleeding'] })).toBe(true);
        expect(passes(r(), { ...DEFAULT_FILTERS, readiness: 'ready' })).toBe(false);
        expect(passes(r({ net: -1 }), { ...DEFAULT_FILTERS, profitable: true })).toBe(false);
        expect(passes(r({ flags: ['fading'] }), { ...DEFAULT_FILTERS, hideFading: true })).toBe(false);
        expect(passes(r({ status: 'PAUSED' }), { ...DEFAULT_FILTERS, activeOnly: true })).toBe(false);
        expect(activeFilterCount({ ...DEFAULT_FILTERS, verdicts: ['drifting'], readiness: 'ready', minPf: '1.5', profitable: true })).toBe(4);
    });
    it('the Live candidates preset: a sample, consistent, profitable after charges, not fading', () => {
        expect(passes(r(), LIVE_CANDIDATES)).toBe(true);
        expect(passes(r({ trades: 12 }), LIVE_CANDIDATES)).toBe(false);
        expect(passes(r({ consistency: { score: 40 } }), LIVE_CANDIDATES)).toBe(false);
        expect(passes(r({ costPct: 60 }), LIVE_CANDIDATES)).toBe(false);
    });
    it('a remembered value of an older shape still opens', () => {
        expect(normaliseFilters({ minPf: 2, gone: 1, verdicts: 'x' })).toEqual({ ...DEFAULT_FILTERS, minPf: 2 });
        expect(normaliseFilters(null)).toEqual(DEFAULT_FILTERS);
    });
    it('sorting: missing figures sink, whichever way it runs', () => {
        const rows = [r({ name: 'a', consistency: { score: 10 } }), r({ name: 'b', consistency: null }), r({ name: 'c', consistency: { score: 70 } })];
        expect(sortRows(rows, { k: 'consistency', dir: 'desc' }).map(x => x.name)).toEqual(['c', 'a', 'b']);
        expect(sortRows(rows, { k: 'consistency', dir: 'asc' }).map(x => x.name)).toEqual(['a', 'c', 'b']);
        const ready = [r({ name: 'n', readiness: { status: 'not-ready', passed: 7, total: 8 } }), r({ name: 'y', readiness: { status: 'ready', passed: 6, total: 8 } })];
        expect(sortRows(ready, { k: 'ready', dir: 'desc' }).map(x => x.name)).toEqual(['y', 'n'], 'ready outranks any count of passed checks');
    });
});
