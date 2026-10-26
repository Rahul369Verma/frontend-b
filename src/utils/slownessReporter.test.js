/**
 * The browser's half of "notify every slowness" (17-Oct-2026): frozen screens and
 * slow API answers are queued per PAGE and sent to the server, never its own call.
 */
import { describe, it, expect, vi } from 'vitest';
import { installSlownessReporter, routeKey, apiKey, describeFrame, chunkName, serverMsFrom } from './slownessReporter.js';

function fakeAxios() {
    const req = [], res = [];
    return {
        interceptors: { request: { use: (f) => req.push(f) }, response: { use: (ok, bad) => res.push([ok, bad]) } },
        post: vi.fn().mockResolvedValue({ data: { ok: true } }),
        _call: async (url, ms, clock, fail = false, headers = {}) => {
            const cfg = req.reduce((c, f) => f(c), { url });
            clock.t += ms;
            if (fail) { try { await res[0][1]({ config: cfg, response: { headers } }); } catch { /* rejected */ } } else res[0][0]({ config: cfg, headers });
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

    it('reads the server\'s own time (Server-Timing) so a slow network is told apart from a slow server', async () => {
        expect(serverMsFrom('app;dur=123.6')).toBe(124);
        expect(serverMsFrom('db;dur=9, app;desc="x";dur=40')).toBe(40);
        expect(serverMsFrom('db;dur=9')).toBeNull();
        expect(serverMsFrom(undefined)).toBeNull();
        const clock = { t: 0 };
        const ax = fakeAxios();
        const fetchImpl = vi.fn(async () => { clock.t += 8000; return { status: 200, headers: new Headers({ 'Server-Timing': 'app;dur=31' }) }; });
        const r = installSlownessReporter({ axios: ax, apiUrl: 'http://api/api', fetchImpl, getPath: () => '/multi-leg', now: () => clock.t, PerfObserver: null, every: 0 });
        await ax._call('http://api/api/multileg/status', 24000, clock, false, { 'server-timing': 'app;dur=12' });   // fast server, slow arrival
        await ax._call('http://api/api/multileg/trades', 9000, clock, true, { 'server-timing': 'app;dur=8800' });  // slow server, failed
        await ax._call('http://api/api/health', 7000, clock);                                                    // no header (an old server)
        await r.fetch('http://api/api/multileg/events');
        expect(r.queue.map((s) => [s.api, s.ms, s.serverMs])).toEqual([
            ['/api/multileg/status', 24000, 12], ['/api/multileg/trades', 9000, 8800], ['/api/health', 7000, undefined], ['/api/multileg/events', 8000, 31],
        ]);
        expect('serverMs' in r.queue[2]).toBe(false);
    });

    it('says WHAT froze the page where the browser can tell (long animation frames)', () => {
        let observe = null, observedType = null;
        class PO { constructor(cb) { observe = cb; } observe(o) { observedType = o.type; } }
        PO.supportedEntryTypes = ['longtask', 'long-animation-frame'];
        const r = installSlownessReporter({ axios: fakeAxios(), apiUrl: 'x', getPath: () => '/multi-leg', PerfObserver: PO, every: 0 });
        expect(observedType).toBe('long-animation-frame');
        observe({ getEntries: () => [{ duration: 506, startTime: 1000, styleAndLayoutStart: 1446,
            scripts: [
                { duration: 380, sourceURL: 'https://app/assets/MultiLeg-Ab12Cd34.js', sourceFunctionName: 'Xe', invoker: 'BUTTON.onclick', forcedStyleAndLayoutDuration: 0 },
                { duration: 40, sourceURL: 'https://app/assets/index-9f8e7d6c.js', sourceFunctionName: '', invoker: 'TimerHandler:setTimeout', forcedStyleAndLayoutDuration: 25 },
            ] }] });
        expect(r.queue[0]).toMatchObject({ type: 'longtask', route: '/multi-leg', ms: 506 });
        expect(r.queue[0].what).toBe('script 420 ms (MultiLeg.Xe via BUTTON.onclick 380 ms) · layout 60 ms (forced 25 ms)');
        expect(describeFrame({ duration: 600, scripts: [] })).toBe('no script attributed (rendering/browser work)');
        expect(chunkName('https://h/assets/DayEquityCurves-abcdef12.js?v=3')).toBe('DayEquityCurves');
        expect(chunkName('')).toBe(null);
    });
});
