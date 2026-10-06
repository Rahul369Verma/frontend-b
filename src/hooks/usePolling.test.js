import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardedTick, pollInterval } from './usePolling.js';

// The 6-Oct-2026 /multi-leg "(pending)" pile-up: a 5 s poll whose request took
// minutes queued a new identical request every tick. The guard skips ticks while
// the previous one is in flight.

const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const flush = () => new Promise(r => setTimeout(r, 0));

describe('guardedTick', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('skips ticks while the previous promise is pending, resumes after it settles', async () => {
        const d = deferred();
        const cb = vi.fn(() => d.p);
        const tick = guardedTick(cb, 5000);
        tick(); tick(); tick();
        expect(cb).toHaveBeenCalledTimes(1);
        d.resolve();
        await flush();
        tick();
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('a rejected request also releases the guard', async () => {
        const d = deferred();
        const cb = vi.fn(() => d.p);
        const tick = guardedTick(cb, 5000);
        tick();
        d.reject(new Error('timeout'));
        await flush();
        tick();
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('callbacks that return undefined fire every tick (old behaviour)', () => {
        const cb = vi.fn(() => undefined);
        const tick = guardedTick(cb, 5000);
        tick(); tick(); tick();
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('a promise that never settles releases after max(60 s, 6 x interval)', () => {
        vi.useFakeTimers();
        const cb = vi.fn(() => new Promise(() => {}));
        const tick = guardedTick(cb, 5000);
        tick();
        vi.advanceTimersByTime(59000);
        tick();
        expect(cb).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2000);
        tick();
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('a throwing callback does not wedge the guard', () => {
        let n = 0;
        const tick = guardedTick(() => { n++; throw new Error('boom'); }, 5000);
        tick(); tick();
        expect(n).toBe(2);
    });
});

describe('pollInterval', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('does not stack requests when a response takes longer than the interval', async () => {
        vi.useFakeTimers();
        const d = deferred();
        const cb = vi.fn(() => d.p);
        const stop = pollInterval(cb, 5000);
        vi.advanceTimersByTime(5000 * 10);       // 10 ticks while the first request hangs
        expect(cb).toHaveBeenCalledTimes(1);
        d.resolve();
        await vi.runOnlyPendingTimersAsync();
        vi.advanceTimersByTime(5000);
        expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2);
        stop();
    });
});
