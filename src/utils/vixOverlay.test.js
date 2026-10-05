import { describe, it, expect } from 'vitest';
import { mergeDayWithVix, vixAt, vixMoveOver, vixWhileHeld, pnlVsVix, toCsv, formatP, MIN_DAYS_FOR_ALPHA } from './vixOverlay.js';

/** An IST wall-clock instant as epoch ms, explicit +05:30 so no machine zone leaks in. */
const ist = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+05:30`);

/** A DayCurve with a known total: one closed, intraday trade. */
const known = (day, total) => ({ day, total, trades: [{ id: day, carriedIn: false, carriedOut: false, marked: true }] });
/** A day whose every trade was carried out unmarked: total is a placeholder. */
const unknownDay = (day) => ({ day, total: 0, trades: [{ id: day, carriedIn: false, carriedOut: true, marked: false }] });
/** A known total that is not the day's own P&L: one trade carried out unmarked beside a closed one. */
const missingDay = (day, total) => ({ day, total, trades: [
    { id: `${day}-a`, carriedIn: false, carriedOut: false, marked: true },
    { id: `${day}-b`, carriedIn: false, carriedOut: true, marked: false },
] });
/** The exit day of a position carried in from a day on which it was unmarked. */
const spanningDay = (day, total) => ({ day, total, trades: [{ id: day, carriedIn: true, carriedOut: false, marked: false, spansEarlierDays: true }] });
/** A VIX summary with only the fields the stats read. */
const vs = (change, extra = {}) => ({ prevClose: 13, close: change == null ? null : 13 + change, change, changePct: null, provisional: false, reason: null, ...extra });

describe('vixAt / mergeDayWithVix — step semantics, nothing before the first bar', () => {
    const V = [{ ms: 150, v: 13.5 }, { ms: 200, v: 13.6 }, { ms: 350, v: 13.4 }];

    it('vixAt is the last bar at or before ms, null before the first bar and for a bad instant', () => {
        expect(vixAt(V, 149)).toBeNull();
        expect(vixAt(V, 150)).toBe(13.5);
        expect(vixAt(V, 349)).toBe(13.6);
        expect(vixAt(V, 10_000)).toBe(13.4);
        expect(vixAt(V, null)).toBeNull();
        expect(vixAt([], 200)).toBeNull();
    });

    it('merges over the union of times: pnl steps, vix steps, vix null (never 0) before its first bar', () => {
        const P = [{ ms: 100, pnl: 0 }, { ms: 200, pnl: -50 }, { ms: 400, pnl: 30 }];
        expect(mergeDayWithVix(P, V)).toEqual([
            { ms: 100, pnl: 0, vix: null },
            { ms: 150, pnl: 0, vix: 13.5 },
            { ms: 200, pnl: -50, vix: 13.6 },
            { ms: 350, pnl: -50, vix: 13.4 },
            { ms: 400, pnl: 30, vix: 13.4 },
        ]);
    });

    it('a VIX bar before the first P&L point takes the first point\'s P&L; unsorted input is sorted', () => {
        const P = [{ ms: 300, pnl: 10 }, { ms: 100, pnl: 5 }];
        expect(mergeDayWithVix(P, [{ ms: 200, v: 12 }, { ms: 50, v: 11 }])).toEqual([
            { ms: 50, pnl: 5, vix: 11 },
            { ms: 100, pnl: 5, vix: 11 },
            { ms: 200, pnl: 5, vix: 12 },
            { ms: 300, pnl: 10, vix: 12 },
        ]);
    });

    it('a null/absent VIX value is skipped, not read as 0; no VIX at all leaves every row null', () => {
        const P = [{ ms: 100, pnl: 0 }, { ms: 200, pnl: 7 }];
        const rows = mergeDayWithVix(P, [{ ms: 120, v: null }, { ms: 150, v: undefined }, { ms: 180, v: 14 }]);
        expect(rows.map((r) => r.vix)).toEqual([null, 14, 14]);
        expect(mergeDayWithVix(P, null)).toEqual([{ ms: 100, pnl: 0, vix: null }, { ms: 200, pnl: 7, vix: null }]);
    });
});

describe('vixMoveOver / vixWhileHeld', () => {
    const D = '2026-09-28';
    const V = [
        { ms: ist(D, '09:16'), v: 13.2 },
        { ms: ist(D, '10:00'), v: 13.3 },
        { ms: ist(D, '11:30'), v: 13.65 },
        { ms: ist(D, '15:30'), v: 13.62 },
    ];
    const dayEnd = ist(D, '15:40');

    it('returns null when either end is unknown or the span is backwards; change is rounded to 2dp', () => {
        expect(vixMoveOver(V, ist(D, '09:15'), ist(D, '11:30'))).toBeNull();          // from is before the first bar
        expect(vixMoveOver(V, ist(D, '11:30'), ist(D, '10:00'))).toBeNull();
        expect(vixMoveOver(V, NaN, ist(D, '10:00'))).toBeNull();
        expect(vixMoveOver(V, ist(D, '10:00'), ist(D, '11:30'))).toEqual({ from: 13.3, to: 13.65, change: 0.35 });
    });

    it('a carried-in trade starts at the day\'s first bar; a carried-out or open one ends at the day end', () => {
        const carried = { entryMs: ist('2026-09-25', '14:00'), exitMs: ist('2026-09-29', '10:00') };
        expect(vixWhileHeld(carried, V, dayEnd)).toEqual({ move: { from: 13.2, to: 13.62, change: 0.42 }, reason: null, code: null });
        const open = { entryMs: ist(D, '10:05'), exitMs: null };
        expect(vixWhileHeld(open, V, dayEnd).move).toEqual({ from: 13.3, to: 13.62, change: 0.32 });
    });

    it('says why when it cannot: no bars, closed before the first bar, unreadable time', () => {
        expect(vixWhileHeld({ entryMs: ist(D, '10:00'), exitMs: ist(D, '11:00') }, [], dayEnd).code).toBe('noBars');
        const early = vixWhileHeld({ entryMs: ist(D, '09:15'), exitMs: ist(D, '09:15') + 30e3 }, V, dayEnd);
        expect(early.move).toBeNull();
        expect(early.code).toBe('beforeFirstBar');
        expect(early.reason).toMatch(/first 1-minute VIX bar/);
        expect(vixWhileHeld({ entryMs: null, exitMs: 1 }, V, dayEnd).code).toBe('badTime');
    });
});

describe('pnlVsVix — Pearson r with a deterministic rotation null', () => {
    const days5 = ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28'];

    it('perfect alignment over 5 days: r = 1 and p = minP = 1/5 — five days cannot reach p < 0.05', () => {
        // x = VIX change 1..5, y = P&L 100..500. Rotations of x by k = 1..4 give
        // r = 0, -0.5, -0.5, 0 (hand-computed), none reaching |1|.
        const days = days5.map((d, i) => known(d, (i + 1) * 100));
        const vix = Object.fromEntries(days5.map((d, i) => [d, vs(i + 1)]));
        const s = pnlVsVix(days, vix);
        expect(s.n).toBe(5);
        expect(s.r).toBe(1);
        expect(s.pRotation).toBeCloseTo(0.2, 12);
        expect(s.minP).toBeCloseTo(0.2, 12);
    });

    it('hand-computed fixture with a tie: r = 0.6, rotations -> 0.1, -0.9, -0.4, 0.6, so p = (1 + 2) / 5', () => {
        // x = [1,2,3,4,5] (dx = -2..2), y = [3,1,2,5,4]·100 (dy = 0,-2,-1,2,1)·100.
        // Σdx·dy = 6 of √(10·10) = 10 → r = 0.6. Rotated: Σ = 1, -9, -4, 6 → r_k = .1, -.9, -.4, .6.
        // |r_k| >= 0.6 at k=2 (0.9) and k=4 (the tie, 0.6) → 2 hits.
        const ys = [3, 1, 2, 5, 4];
        // Fed newest-first, as the page holds them: the stats must order chronologically.
        const days = days5.map((d, i) => known(d, ys[i] * 100)).reverse();
        const vix = Object.fromEntries(days5.map((d, i) => [d, vs(i + 1)]));
        const s = pnlVsVix(days, vix);
        expect(s.r).toBe(0.6);
        expect(s.pRotation).toBeCloseTo(3 / 5, 12);
        expect(s.minP).toBeCloseTo(1 / 5, 12);
        expect(s.up).toEqual({ n: 5, avgPnl: 300 });
        expect(s.down).toEqual({ n: 0, avgPnl: null });
    });

    it('fewer than 5 usable days -> r null with the reason; buckets still reported', () => {
        const days = days5.slice(0, 4).map((d, i) => known(d, i % 2 ? -100 : 200));
        const vix = { [days5[0]]: vs(0.5), [days5[1]]: vs(-0.25), [days5[2]]: vs(0), [days5[3]]: vs(-1) };
        const s = pnlVsVix(days, vix);
        expect(s.n).toBe(4);
        expect(s.r).toBeNull();
        expect(s.pRotation).toBeNull();
        expect(s.minP).toBeNull();
        expect(s.rReason).toBe('too few days (need 5)');
        expect(s.up).toEqual({ n: 1, avgPnl: 200 });
        expect(s.down).toEqual({ n: 2, avgPnl: -100 });
        expect(s.flat).toEqual({ n: 1 });
    });

    it('counts every excluded day by reason: unknown P&L, provisional, no VIX change, no summary at all', () => {
        const days = [
            ...days5.map((d, i) => known(d, (i + 1) * 100)),
            unknownDay('2026-09-29'),
            known('2026-09-30', 50),
            known('2026-10-01', 75),
            known('2026-10-02', -20),
        ];
        const vix = {
            ...Object.fromEntries(days5.map((d, i) => [d, vs(i + 1)])),
            '2026-09-29': vs(0.08),                                        // has VIX, but the P&L is unknown
            '2026-09-30': vs(null, { reason: 'Fyers returned no bars for this day' }),
            // 2026-10-01: no summary at all
            '2026-10-02': vs(0.4, { provisional: true }),
        };
        const s = pnlVsVix(days, vix);
        expect(s.n).toBe(5);
        expect(s.excluded).toEqual({ unknownPnl: 1, partialPnl: 0, provisional: 1, noVix: 2 });
    });

    it('a day whose total is not its own P&L is counted out as partial, not paired with one day of VIX', () => {
        const days = [
            ...days5.map((d, i) => known(d, (i + 1) * 100)),
            missingDay('2026-09-29', 500),     // a carried position's Tuesday move is not in the 500
            spanningDay('2026-09-30', -2400),  // the same position's Mon..Wed result, booked on Wednesday
        ];
        const vix = Object.fromEntries([...days5, '2026-09-29', '2026-09-30'].map((d, i) => [d, vs(i + 1)]));
        const s = pnlVsVix(days, vix);
        expect(s.n).toBe(5);
        expect(s.r).toBe(1);
        expect(s.excluded).toEqual({ unknownPnl: 0, partialPnl: 2, provisional: 0, noVix: 0 });
    });

    it('no variation in either series -> r null, never a NaN', () => {
        const days = days5.map((d) => known(d, 100));
        const vix = Object.fromEntries(days5.map((d, i) => [d, vs(i + 1)]));
        expect(pnlVsVix(days, vix).r).toBeNull();
        expect(pnlVsVix(days, vix).rReason).toMatch(/P&L was the same/);
        const flatVix = Object.fromEntries(days5.map((d) => [d, vs(0.3)]));
        expect(pnlVsVix(days5.map((d, i) => known(d, i)), flatVix).rReason).toMatch(/VIX change was the same/);
    });
});

describe('toCsv', () => {
    it('one row per day oldest first; absent values are EMPTY cells, never 0; notes are quoted when needed', () => {
        const days = [known('2026-09-29', -1234.5), unknownDay('2026-09-28'), known('2026-09-25', 0)];
        const vix = {
            '2026-09-29': { prevClose: 13.64, close: 13.41, change: -0.23, changePct: -1.69, provisional: false, reason: null },
            '2026-09-28': { prevClose: null, close: 13.64, change: null, changePct: null, provisional: false,
                reason: 'no previous session close within 20 days, see log' },
        };
        const lines = toCsv(days, vix).trimEnd().split('\n');
        expect(lines[0]).toBe('day,day P&L,trades,VIX prev close,VIX close,VIX change,VIX change %,provisional,note');
        expect(lines[1]).toBe('2026-09-25,0,1,,,,,,VIX not loaded');
        expect(lines[2]).toBe('2026-09-28,,1,,13.64,,,no,"day P&L unknown: every trade was still open at the close with no marks that day; no previous session close within 20 days, see log"');
        expect(lines[3]).toBe('2026-09-29,-1234.5,1,13.64,13.41,-0.23,-1.69,no,');
        expect(lines).toHaveLength(4);
    });

    it('a partial day keeps its total but the note says what it leaves out or takes in', () => {
        const vix = { '2026-09-29': vs(0.2), '2026-09-30': vs(-0.1) };
        const lines = toCsv([missingDay('2026-09-29', 500), spanningDay('2026-09-30', -2400)], vix).trimEnd().split('\n');
        expect(lines[1]).toBe('2026-09-29,500,2,13,13.2,0.2,,no,day P&L partial: 1 position(s) open at the close with no marks that day are not in it');
        expect(lines[2]).toBe("2026-09-30,-2400,1,13,12.9,-0.1,,no,day P&L partial: 1 position(s) carried in unmarked bring earlier days' moves into it");
    });
});

describe('formatP', () => {
    it('never prints a p on the wrong side of 0.05, nor a 0 this test cannot produce', () => {
        expect(formatP(1 / 21)).toBe('0.048');           // significant, and reads below 0.05
        expect(formatP(1 / 20)).toBe('0.05');            // exactly the threshold: not significant
        expect(formatP(1 / 6)).toBe('0.17');
        expect(formatP(1 / 250)).toBe('0.004');          // was "0.00"
        expect(formatP(1 / 400)).toBe('0.0025');
        expect(formatP(0.04995)).toBe('0.04995');         // two or three figures would round up to 0.05
        expect(formatP(0.0504)).toBe('0.05');            // rounds down but stays not-significant
        expect(formatP(1 / 1500)).toBe('< 0.001');
        expect(formatP(null)).toBe('—');
        expect(MIN_DAYS_FOR_ALPHA).toBe(21);
    });
});
