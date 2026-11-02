import { describe, it, expect } from 'vitest';
import {
    METRICS, rankRow, scoreboard, configRows, curveRows, histogramRows, seriesColors, csvRowsOf, diversificationLine, holdText, shortDay, compactRup,
} from './compareFormat.js';

const dep = (id, results = {}, extra = {}) => ({ id, name: `dep ${id}`, results: { trades: 30, ...results }, behaviour: {}, daily: [], config: [], ...extra });
const cfg = (key, display, group = 'exits', extra = {}) => ({ key, label: key.replace(/_/g, ' '), group, display, ...extra });

describe('rankRow', () => {
    it('marks the best and worst by direction', () => {
        expect(rankRow([10, 30, 20], 'high')).toEqual({ best: new Set([1]), worst: new Set([0]) });
        expect(rankRow([10, 30, 20], 'low')).toEqual({ best: new Set([0]), worst: new Set([1]) });
    });
    it('ranks nothing when every value is equal, only one value exists, or the row is not ranked', () => {
        expect(rankRow([5, 5, 5], 'high').best.size).toBe(0);
        expect(rankRow([5, null, null], 'high').best.size).toBe(0);
        expect(rankRow([1, 2], null).best.size).toBe(0);
    });
    it('skips a missing value instead of reading it as zero', () => {
        const r = rankRow([-500, null, -100], 'high');
        expect([...r.best]).toEqual([2]);
        expect([...r.worst]).toEqual([0]);
    });
    it('marks every deployment tied for the best', () => {
        expect([...rankRow([3, 3, 1], 'high').best]).toEqual([0, 1]);
    });
});

describe('scoreboard', () => {
    it('counts the ranked rows each deployment leads', () => {
        const a = dep('a', { net: 1000, winRate: 40 });
        const b = dep('b', { net: 500, winRate: 60 });
        const { wins, ranked } = scoreboard([a, b]);
        expect(ranked).toBe(2);             // net and win rate are the only rows with two values
        expect(wins).toEqual([1, 1]);
    });
    it('every ranked metric has a formatter and a reader', () => {
        for (const m of METRICS) {
            expect(typeof m.get).toBe('function');
            expect(typeof m.fmt(null)).toBe('string');
        }
    });
});

describe('configRows', () => {
    const groups = [{ id: 'entry' }, { id: 'exits' }];
    it('one row per setting across all, flagged when they differ, in group order', () => {
        const a = dep('a', {}, { config: [cfg('leg_sl_x', '1.4×'), cfg('entry_time', '09:20', 'entry')] });
        const b = dep('b', {}, { config: [cfg('leg_sl_x', '1.4×'), cfg('entry_time', '10:00', 'entry'), cfg('max_loss_rupees', '₹3,000')] });
        const rows = configRows([a, b], groups);
        expect(rows.map((r) => r.key)).toEqual(['entry_time', 'leg_sl_x', 'max_loss_rupees']);
        expect(rows.find((r) => r.key === 'entry_time').differs).toBe(true);
        expect(rows.find((r) => r.key === 'leg_sl_x').differs).toBe(false);
        // set on one, absent on the other: a difference, and the absent cell is null (shown as —)
        const ml = rows.find((r) => r.key === 'max_loss_rupees');
        expect(ml.differs).toBe(true);
        expect(ml.cells[0]).toBeNull();
    });
});

describe('curveRows', () => {
    it('carries each equity forward over days it did not trade; daily net is empty there', () => {
        const a = dep('a', {}, { daily: [{ day: '2026-10-01', net: 100, equity: 100, drawdown: 0 }, { day: '2026-10-03', net: -50, equity: 50, drawdown: -50 }] });
        const b = dep('b', {}, { daily: [{ day: '2026-10-02', net: 200, equity: 200, drawdown: 0 }] });
        const rows = curveRows([a, b], { daily: [{ day: '2026-10-01', equity: 100, drawdown: 0 }, { day: '2026-10-02', equity: 300, drawdown: 0 }, { day: '2026-10-03', equity: 250, drawdown: -50 }] });
        expect(rows.map((r) => r.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
        expect(rows[1].eq_a).toBe(100);
        expect(rows[1].net_a).toBeNull();
        expect(rows[0].eq_b).toBeNull();     // before its first trade: no line, not a zero
        expect(rows[2].eq_b).toBe(200);
        expect(rows[2].eq_combined).toBe(250);
        expect(rows[0].label).toBe('1 Oct');
    });
});

describe('histogramRows', () => {
    it('one row per bucket, a count per deployment', () => {
        const rows = histogramRows({ edges: [-1000, 0, 1000], byId: { a: { counts: [2, 5] }, b: { counts: [1] } } }, [dep('a'), dep('b')]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ n_a: 2, n_b: 1 });
        expect(rows[1]).toMatchObject({ n_a: 5, n_b: 0 });
    });
    it('no edges, no rows', () => expect(histogramRows({ edges: [] }, [dep('a')])).toEqual([]));
});

describe('seriesColors', () => {
    it('six distinct colours from the theme, the three categorical slots first', () => {
        const ct = { mode: 'dark', categorical: ['#1', '#2', '#3'], hue: (f, s) => `${f}-${s}` };
        const c = seriesColors(ct, 6);
        expect(c).toEqual(['#1', '#2', '#3', 'purple-400', 'yellow-400', 'pink-400']);
        expect(new Set(c).size).toBe(6);
        expect(seriesColors({ ...ct, mode: 'light' }, 4)[3]).toBe('purple-600');
    });
    it('works without a theme', () => expect(seriesColors(null, 2)).toHaveLength(2));
});

describe('csv, sentences and formatters', () => {
    it('csv has a results row per metric and a row per setting, a column per deployment', () => {
        const a = dep('a', { net: 1200 }, { config: [cfg('leg_sl_x', '1.4×')] });
        const rows = csvRowsOf([a], []);
        expect(rows.find((r) => r.section === 'results: Net P&L')['dep a']).toBe(1200);
        expect(rows.find((r) => r.section === 'setting: leg sl x')['dep a']).toBe('1.4×');
    });
    it('diversification sentence by how far the combined drawdown sits below the sum', () => {
        expect(diversificationLine({ drawdownRatio: 0.95, maxDrawdown: -950, sumOfMemberDrawdowns: -1000 })).toMatch(/little diversification/);
        expect(diversificationLine({ drawdownRatio: 0.6, maxDrawdown: -600, sumOfMemberDrawdowns: -1000 })).toMatch(/Some diversification/);
        expect(diversificationLine({ drawdownRatio: 0.3, maxDrawdown: -300, sumOfMemberDrawdowns: -1000 })).toMatch(/did not coincide/);
        expect(diversificationLine({ drawdownRatio: null })).toBeNull();
    });
    it('hold, day and compact rupees', () => {
        expect(holdText(45)).toBe('45m');
        expect(holdText(135)).toBe('2h 15m');
        expect(holdText(2880)).toBe('2.0d');
        expect(holdText(null)).toBe('—');
        expect(shortDay('2026-11-02')).toBe('2 Nov');
        expect(compactRup(-125000)).toBe('-₹1.3L');
        expect(compactRup(2500)).toBe('₹2.5k');
        expect(compactRup(null)).toBe('—');
    });
});
