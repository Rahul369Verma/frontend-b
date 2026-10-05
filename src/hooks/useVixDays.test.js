/**
 * The VIX data hook: what it asks the server for (chunked at the contract's
 * caps, intraday only for opened days), that one cache serves every mount, that
 * nothing is asked while disabled, and that a failure is reported, not eaten.
 * The fetcher is injected — no network, no broker.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useVixDays, { chunkDays } from './useVixDays.js';

/** n consecutive calendar dates ending 2026-10-01, as 'YYYY-MM-DD'. */
const dates = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, 1) - i * 86400e3).toISOString().slice(0, 10));

/** A fetcher answering every date it is asked for with a settled close. */
function okFetcher({ intradayBars = false } = {}) {
    return vi.fn(async ({ days, intraday }) => {
        const out = {};
        for (const d of [...days, ...intraday]) {
            out[d] = {
                day: d, prevClose: 13, close: 13.5, change: 0.5, changePct: 3.85, provisional: false, reason: null,
                intraday: intraday.includes(d) && intradayBars
                    ? { points: [{ ms: Date.parse(`${d}T09:16:00+05:30`), v: 13.2 }, { ms: Date.parse(`${d}T09:17:00+05:30`), v: 13.4 }], bars: 2 }
                    : null,
            };
        }
        return { resolution: '1', source: { daily: 'fyers', intraday: intraday.length ? 'fyers' : 'not requested' }, days: out, warnings: [] };
    });
}

describe('useVixDays', () => {
    it('asks nothing while disabled', () => {
        const fetcher = okFetcher();
        const { result } = renderHook(() => useVixDays(dates(3), { enabled: false, fetcher }));
        expect(fetcher).not.toHaveBeenCalled();
        expect(result.current.byDay).toEqual({});
        expect(result.current.loading).toBe(false);
    });

    it('chunks summaries at 400 days and intraday at 5 days, never asking an intraday day twice', async () => {
        const fetcher = okFetcher({ intradayBars: true });
        const all = dates(401);
        const opened = all.slice(0, 7);
        const { result } = renderHook(() => useVixDays(all, { expanded: opened, enabled: true, fetcher }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const calls = fetcher.mock.calls.map(([q]) => q);
        const summaryCalls = calls.filter((q) => q.days.length);
        const intraCalls = calls.filter((q) => q.intraday.length);
        // 401 - 7 opened = 394 summaries (one request); the 7 opened come with their summaries.
        expect(summaryCalls.map((q) => q.days.length)).toEqual([394]);
        expect(intraCalls.map((q) => q.intraday.length)).toEqual([5, 2]);
        expect(calls.every((q) => q.days.length <= 400 && q.intraday.length <= 5)).toBe(true);
        expect(Object.keys(result.current.byDay)).toHaveLength(401);
        expect(result.current.intraByDay[opened[0]].state).toBe('ready');
        expect(result.current.intraByDay[opened[0]].intraday.points).toHaveLength(2);
        expect(result.current.source).toEqual({ daily: 'fyers', intraday: 'fyers' });
    });

    it('opening a day loads its path without putting the summaries back into "loading"', async () => {
        const base = okFetcher({ intradayBars: true });
        let release;
        const gate = new Promise((r) => { release = r; });
        const fetcher = vi.fn(async (q) => { if (q.intraday.length) await gate; return base(q); });
        const keys = dates(3);
        const { result, rerender } = renderHook(({ exp }) => useVixDays(keys, { expanded: exp, enabled: true, fetcher }),
            { initialProps: { exp: [] } });
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender({ exp: [keys[0]] });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        expect(result.current.intraByDay[keys[0]].state).toBe('loading');
        expect(result.current.loading).toBe(false);
        expect(Object.keys(result.current.byDay)).toHaveLength(3);
        await act(async () => { release(); await gate; });
        await waitFor(() => expect(result.current.intraByDay[keys[0]].state).toBe('ready'));
    });

    it('a 401-day list with nothing opened is two summary requests: 400 + 1', async () => {
        const fetcher = okFetcher();
        const { result } = renderHook(() => useVixDays(dates(401), { enabled: true, fetcher }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetcher.mock.calls.map(([q]) => [q.days.length, q.intraday.length])).toEqual([[400, 0], [1, 0]]);
    });

    it('serves a second mount from the module cache (one fetcher → one cache)', async () => {
        const fetcher = okFetcher();
        const first = renderHook(() => useVixDays(dates(3), { enabled: true, fetcher }));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        first.unmount();
        const second = renderHook(() => useVixDays(dates(3), { enabled: true, fetcher }));
        expect(second.result.current.loading).toBe(false);
        expect(Object.keys(second.result.current.byDay)).toHaveLength(3);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('surfaces a failure with the server\'s reason; reload() asks again', async () => {
        const fetcher = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 503'),
                { response: { status: 503, data: { error: 'broker session not available in this process' } } }))
            .mockImplementation(okFetcher());
        const { result } = renderHook(() => useVixDays(dates(2), { enabled: true, fetcher }));
        await waitFor(() => expect(result.current.error).toBe('broker session not available in this process'));
        expect(result.current.errorDays).toBe(2);
        expect(result.current.loading).toBe(false);
        expect(result.current.byDay).toEqual({});
        act(() => result.current.reload());
        await waitFor(() => expect(Object.keys(result.current.byDay)).toHaveLength(2));
        expect(result.current.error).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('keeps absent values null, and labels a date the server left out instead of dropping it', async () => {
        const fetcher = vi.fn(async () => ({
            resolution: '1', source: { daily: 'fyers', intraday: 'not requested' }, warnings: ['one warning'],
            days: { '2026-09-27': { day: '2026-09-27', prevClose: 13.64, close: null, change: null, changePct: null, provisional: false, reason: 'no session (weekend/holiday)' } },
        }));
        const { result } = renderHook(() => useVixDays(['2026-09-27', '2026-09-28'], { enabled: true, fetcher }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.byDay['2026-09-27']).toMatchObject({ close: null, change: null, reason: 'no session (weekend/holiday)' });
        expect(result.current.byDay['2026-09-28']).toMatchObject({ close: null, change: null, reason: 'the server returned nothing for this date' });
        expect(result.current.warnings).toEqual(['one warning']);
    });
});

// ── finality, retries, and what a later reply may overwrite ──────────────────
/** A contract body for `days`, each day's fields from `fields(day)` over an all-null summary. */
const body = (days, fields, source = { daily: 'fyers', intraday: 'not requested' }) => ({
    resolution: '1', source, warnings: [],
    days: Object.fromEntries(days.map((d) => [d, {
        day: d, prevClose: null, close: null, change: null, changePct: null, provisional: false, intraday: null, reason: null, ...fields(d),
    }])),
});
const DOWN = 'broker session not available in this process';

describe('useVixDays — what is kept for good, and what is asked again', () => {
    afterEach(() => { vi.useRealTimers(); });
    /** Fake clock and timers at an IST instant; promises still run, so replies arrive inside flush(). */
    const at = (iso) => vi.useFakeTimers({ now: new Date(iso), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

    it("today after 15:30 is not kept for good: the timer asks again and picks up the official close", async () => {
        at('2026-10-01T15:30:20+05:30');
        const answers = [
            { prevClose: 13.49, close: 14.44, change: 0.95 },      // the running print just after 15:30
            { prevClose: 13.49, close: 14.46, change: 0.97 },      // the official close (measured: 14.46 vs 14.44)
        ];
        let k = 0;
        const fetcher = vi.fn(async ({ days }) => body(days, () => answers[Math.min(k++, 1)]));
        const { result } = renderHook(() => useVixDays(['2026-10-01'], { enabled: true, fetcher }));
        await flush();
        expect(result.current.byDay['2026-10-01']).toMatchObject({ close: 14.44, provisional: false });
        expect(result.current.retryableDays).toBe(0);              // complete, just not final
        await flush(59e3);
        expect(fetcher).toHaveBeenCalledTimes(1);
        await flush(2e3);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(result.current.byDay['2026-10-01'].close).toBe(14.46);
    });

    it('a 200 saying "broker session not available" is asked again on its own, backing off, until it settles', async () => {
        at('2026-10-02T07:30:00+05:30');
        let up = false;
        const fetcher = vi.fn(async ({ days }) => (up
            ? body(days, () => ({ prevClose: 13.64, close: 13.41, change: -0.23 }))
            : body(days, () => ({ reason: DOWN }), { daily: 'none', intraday: 'not requested' })));
        const { result } = renderHook(() => useVixDays(['2026-09-28', '2026-09-29'], { enabled: true, fetcher }));
        await flush();
        expect(result.current.error).toBeNull();                   // no HTTP error to hang a Retry on
        expect(result.current.retryableDays).toBe(2);
        expect(result.current.source.daily).toBe('none');
        await flush(61e3);
        expect(fetcher).toHaveBeenCalledTimes(2);                  // 60 s after the first answer
        await flush(61e3);
        expect(fetcher).toHaveBeenCalledTimes(2);                  // the second waits 2 min
        up = true;
        await flush(60e3);
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(result.current.byDay['2026-09-29'].close).toBe(13.41);
        expect(result.current.retryableDays).toBe(0);
        expect(result.current.source).toEqual({ daily: 'fyers', intraday: null });
        await flush(60 * 60e3);
        expect(fetcher).toHaveBeenCalledTimes(3);                  // settled: never asked again
    });

    it('a past close with no previous close (a hole upstream) is not kept for good: Retry asks again', async () => {
        const fetcher = vi.fn()
            .mockImplementationOnce(async ({ days }) => body(days, () => ({
                close: 12.16, reason: 'the latest earlier close (2026-09-15) is 10 days old, so a session is missing from the VIX history; it is not used as the previous close',
            })))
            .mockImplementation(async ({ days }) => body(days, () => ({ prevClose: 12.69, close: 12.16, change: -0.53 })));
        const { result } = renderHook(() => useVixDays(['2026-09-25'], { enabled: true, fetcher }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.byDay['2026-09-25'].change).toBeNull();
        expect(result.current.retryableDays).toBe(1);
        act(() => result.current.reload());
        await waitFor(() => expect(result.current.byDay['2026-09-25'].change).toBe(-0.53));
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('only a weekend settles without a close; a weekday "or no data" is asked again, and Retry re-asks both', async () => {
        at('2026-10-02T10:00:00+05:30');
        const fetcher = vi.fn(async ({ days }) => body(days, (d) => (d === '2026-09-27'
            ? { prevClose: 12.16, reason: 'no session (weekend/holiday)' }                       // a Sunday
            : { prevClose: 11.25, reason: 'no session (weekend/holiday) or no data' })));         // a Tuesday
        const { result } = renderHook(() => useVixDays(['2026-09-22', '2026-09-27'], { enabled: true, fetcher }));
        await flush();
        expect(result.current.retryableDays).toBe(1);
        await flush(61e3);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[1][0]).toEqual({ days: ['2026-09-22'], intraday: [] });
        // A weekend's previous close is the one settled value only asking again can correct.
        act(() => result.current.reload());
        await flush();
        expect(fetcher.mock.calls[2][0]).toEqual({ days: ['2026-09-22', '2026-09-27'], intraday: [] });
    });

    it('an intraday reply made while the broker is down keeps the settled close, and says why the line is missing', async () => {
        const fetcher = vi.fn(async ({ days, intraday }) => (intraday.length
            ? body(intraday, () => ({ reason: DOWN }), { daily: 'none', intraday: 'none' })
            : body(days, () => ({ prevClose: 13.64, close: 13.41, change: -0.23 }))));
        const keys = ['2026-09-28', '2026-09-29'];
        const { result, rerender } = renderHook(({ exp }) => useVixDays(keys, { expanded: exp, enabled: true, fetcher }),
            { initialProps: { exp: [] } });
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender({ exp: ['2026-09-29'] });
        await waitFor(() => expect(result.current.intraByDay['2026-09-29'].state).toBe('ready'));
        expect(result.current.byDay['2026-09-29']).toMatchObject({ close: 13.41, change: -0.23 });
        expect(result.current.intraByDay['2026-09-29']).toMatchObject({ intraday: null, reason: DOWN, settled: false });
        // Counted per day, so one reply made while the broker is down cannot relabel the page.
        expect(result.current.source.daily).toBe('fyers');
        expect(result.current.sourceDays).toEqual({ fyers: 2, none: 0 });
    });

    it('splits requests by calendar span as well as count (the server rejects >1100 days whole)', async () => {
        expect(chunkDays(['2026-01-01', '2029-01-05'], 400)).toEqual([['2026-01-01', '2029-01-05']]);   // exactly 1100
        expect(chunkDays(['2026-01-01', '2029-01-06'], 400)).toEqual([['2026-01-01'], ['2029-01-06']]);
        const fetcher = okFetcher();
        const { result } = renderHook(() => useVixDays(['2023-06-01', '2023-06-02', '2026-09-28', '2026-09-29'], { enabled: true, fetcher }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetcher.mock.calls.map(([q]) => q.days)).toEqual([['2023-06-01', '2023-06-02'], ['2026-09-28', '2026-09-29']]);
        expect(Object.keys(result.current.byDay)).toHaveLength(4);
    });
});
