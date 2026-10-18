/**
 * The Results day curves are built in a Web Worker (the page froze 0.3-0.7 s on
 * prod's history, 18-Oct-2026). Wherever the worker is missing or fails, the same
 * function runs on the page — the curves must be identical on every path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { curvesFromBody, curvesOf, expandPathRow } from './resultsCurves.js';

const T0 = Date.parse('2026-10-16T03:50:00.000Z');   // 09:20 IST
const rows = [
    { _id: 'a', name: 'condor', deploymentId: 'd1', template: 'iron_condor', symbol: 'NSE:NIFTY50-INDEX', entryAt: new Date(T0).toISOString(), exitAt: new Date(T0 + 60 * 60_000).toISOString(), netPnl: 420, p: [[T0, 0], [T0 + 30 * 60_000, -150], [T0 + 60 * 60_000, 420]] },
    { _id: 'b', name: 'quarantined', deploymentId: 'd1', template: 'iron_condor', symbol: 'NSE:NIFTY50-INDEX', entryAt: new Date(T0).toISOString(), exitAt: new Date(T0 + 60_000).toISOString(), netPnl: 9, quarantined: true, p: [[T0, 9]] },
];
const expected = () => curvesOf(rows.map(expandPathRow));

async function load(FakeWorker) {
    vi.resetModules();
    if (FakeWorker) vi.stubGlobal('Worker', FakeWorker);
    return import('./curvesInWorker.js');
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('buildCurves', () => {
    it('text or parsed rows → the same curves the page always drew', () => {
        expect(curvesFromBody(JSON.stringify(rows))).toEqual(expected());
        expect(curvesFromBody(rows)).toEqual(expected());
        expect(expected().excluded.quarantined).toBe(1);
        expect(curvesFromBody('null').days).toEqual([]);
    });

    it('with no Worker (tests, old browsers) it builds them here', async () => {
        vi.stubGlobal('Worker', undefined);
        const { buildCurves } = await load();
        await expect(buildCurves(JSON.stringify(rows))).resolves.toEqual(expected());
    });

    it('in a worker: the text goes there, the curves come back', async () => {
        const posted = [];
        class W { constructor() { W.made = (W.made || 0) + 1; } postMessage(m) { posted.push(m); setTimeout(() => this.onmessage({ data: { id: m.id, curves: curvesFromBody(m.body) } }), 0); } }
        const { buildCurves } = await load(W);
        const text = JSON.stringify(rows);
        await expect(buildCurves(text)).resolves.toEqual(expected());
        await expect(buildCurves(text)).resolves.toEqual(expected());
        expect(posted.map((m) => typeof m.body)).toEqual(['string', 'string']);
        expect(W.made).toBe(1);   // one worker, kept
    });

    it('a worker that reports an error, or dies, never loses the curves', async () => {
        class Errs { postMessage(m) { setTimeout(() => this.onmessage({ data: { id: m.id, error: 'DataCloneError' } }), 0); } }
        let mod = await load(Errs);
        await expect(mod.buildCurves(rows)).resolves.toEqual(expected());

        class Dies { postMessage() { setTimeout(() => this.onerror({ preventDefault() {} }), 0); } terminate() {} }
        mod = await load(Dies);
        await expect(mod.buildCurves(rows)).resolves.toEqual(expected());

        class Throws { constructor() { throw new Error('blocked by policy'); } }
        mod = await load(Throws);
        await expect(mod.buildCurves(rows)).resolves.toEqual(expected());
    });
});
