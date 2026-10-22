/**
 * The Results page's one window: a preset (30 / 90 / all) or a date range / one day,
 * whole IST days by exit, `until` exclusive (user, 23-Oct-2026: round-trips with a date filter).
 */
import { describe, it, expect } from 'vitest';
import { istMidnightMs, istDate, stepTradingDay, presetWindow, rangeWindow, windowLabel, windowFromParams } from './resultsWindow.js';

describe('resultsWindow', () => {
    it('one day is [its IST midnight, the next IST midnight)', () => {
        const w = rangeWindow('2026-10-21');
        expect(new Date(w.since).toISOString()).toBe('2026-10-20T18:30:00.000Z');
        expect(new Date(w.until).toISOString()).toBe('2026-10-21T18:30:00.000Z');
        expect(w).toMatchObject({ days: 'range', from: '2026-10-21', to: '2026-10-21' });
    });
    it('a range is whole days, To inclusive; backwards dates are swapped; junk is no window', () => {
        const w = rangeWindow('2026-10-21', '2026-10-14');
        expect([w.from, w.to]).toEqual(['2026-10-14', '2026-10-21']);
        expect(w.until - w.since).toBe(8 * 864e5);
        expect(rangeWindow('21-10-2026')).toBeNull();
        expect(rangeWindow('')).toBeNull();
    });
    it('presets keep the old rule (the last N days from now); All has no bounds', () => {
        expect(presetWindow(30, 1e12)).toEqual({ days: 30, since: 1e12 - 30 * 864e5, until: null, from: null, to: null });
        expect(presetWindow('all')).toMatchObject({ since: null, until: null });
    });
    it('◀ ▶ step over weekends (Mon ← Fri, Fri → Mon)', () => {
        expect(stepTradingDay('2026-10-19', -1)).toBe('2026-10-16');   // Mon → previous Fri
        expect(stepTradingDay('2026-10-16', 1)).toBe('2026-10-19');
        expect(stepTradingDay('2026-10-21', -2)).toBe('2026-10-19');
        expect(stepTradingDay('bad', 1)).toBe('bad');
    });
    it('IST dates, labels and the URL form', () => {
        expect(istDate(Date.parse('2026-10-21T19:00:00Z'))).toBe('2026-10-22');   // 00:30 IST next day
        expect(istMidnightMs('2026-10-21')).toBe(Date.parse('2026-10-20T18:30:00Z'));
        expect(windowLabel(rangeWindow('2026-10-21'))).toBe('21 Oct 2026');
        expect(windowLabel(rangeWindow('2026-10-14', '2026-10-21'))).toBe('14 Oct – 21 Oct 2026');
        expect(windowLabel(rangeWindow('2025-12-29', '2026-01-02'))).toBe('29 Dec 2025 – 2 Jan 2026');
        expect(windowLabel(presetWindow(30))).toBe('the last 30 days');
        expect(windowLabel(presetWindow('all'))).toBe('all time');
        expect(windowFromParams(new URLSearchParams('from=2026-10-21'))).toMatchObject({ from: '2026-10-21', to: '2026-10-21' });
        expect(windowFromParams(new URLSearchParams('tab=results'))).toBeNull();
    });
});
