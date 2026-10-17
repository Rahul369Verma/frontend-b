/**
 * The browser's half of "notify every slowness" (17-Oct-2026): frozen screens and
 * slow API answers are queued per PAGE and sent to the server, never its own call.
 */
import { describe, it, expect, vi } from 'vitest';
import { installSlownessReporter, routeKey, apiKey } from './slownessReporter.js';

function fakeAxios() {
    const req = [], res = [];
    return {
        interceptors: { request: { use: (f) => req.push(f) }, response: { use: (ok, bad) => res.push([ok, bad]) } },
        post: vi.fn().mockResolvedValue({ data: { ok: true } }),
        _call: async (url, ms, clock, fail = false) => {
            const cfg = req.reduce((c, f) => f(c), { url });
            clock.t += ms;
            if (fail) { try { await res[0][1]({ config: cfg }); } catch { /* rejected */ } } else res[0][0]({ config: cfg });
        },
    };
}

describe('slownessReporter', () => {
    it('keys a page, not a URL, and an API path without ids', () => {
        expect(routeKey('/strategy/NSE:NIFTY50-INDEX')).toBe('/strategy/:id');
        expect(routeKey('/charts')).toBe('/charts');
        expect(apiKey('http://localhost:5000/api/multileg/deployments/6a5c9c8e6d55d9ed64577359/max-loss?x=1')).toBe('/api/multileg/deployments/:id/max-loss');
    });

    it('queues slow answers (axios and fetch) and frozen screens, then sends them in one batch', async () => {
        const clock = { t: 0 };
        const ax = fakeAxios();
        let observe = null;
        class PO { constructor(cb) { observe = cb; } observe() {} }
        const fetchImpl = vi.fn(async () => { clock.t += 6000; return { status: 200 }; });
        const r = installSlownessReporter({ axios: ax, apiUrl: 'http://api/api', fetchImpl, getPath: () => '/multi-leg', now: () => clock.t, PerfObserver: PO, every: 0 });
        await ax._call('http://api/api/multileg/trades', 7000, clock);           // slow
        await ax._call('http://api/api/health', 40, clock);                      // fast
        await ax._call('http://api/api/multileg/analytics', 9000, clock, true);  // slow AND failed — still reported
        await r.fetch('http://api/api/engine/optimizer/jobs');                   // slow fetch
        observe({ getEntries: () => [{ duration: 900 }, { duration: 80 }] });
        expect(r.queue.map((s) => `${s.type}:${s.api || ''}:${s.ms}`)).toEqual([
            'api:/api/multileg/trades:7000', 'api:/api/multileg/analytics:9000', 'api:/api/engine/optimizer/jobs:6000', 'longtask::900',
        ]);
        expect(await r.flush()).toBe(4);
        expect(ax.post).toHaveBeenCalledWith('http://api/api/telemetry/slow', { samples: expect.any(Array) });
        expect(r.queue).toHaveLength(0);
        await ax._call('http://api/api/telemetry/slow', 9000, clock);           // its own report is never reported
        expect(r.queue).toHaveLength(0);
    });
});
