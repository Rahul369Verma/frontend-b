/**
 * buildCurves(body) — the Results day curves, built in a Web Worker so the page
 * never freezes while they are computed (0.3-0.7 s on prod's history, 18-Oct-2026).
 *
 * One worker, made on first use and kept. Where there is none (tests, an old
 * browser, a worker that fails to load or errors) the SAME function runs here —
 * the curves are identical either way (resultsCurves.curvesFromBody).
 */
import { curvesFromBody } from './resultsCurves.js';

let worker = null;          // null = not tried yet · false = unavailable
let seq = 0;
const waiting = new Map();  // id → { resolve, body }

const here = (body) => new Promise((resolve, reject) => {
    try { resolve(curvesFromBody(body)); } catch (e) { reject(e); }
});

function giveUp() {
    worker = false;
    for (const [, w] of waiting) here(w.body).then(w.resolve, w.reject);
    waiting.clear();
}

function getWorker() {
    if (worker !== null) return worker || null;
    if (typeof Worker === 'undefined') { worker = false; return null; }
    try {
        const w = new Worker(new URL('./resultsCurves.worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => {
            const { id, curves, error } = e.data || {};
            const p = waiting.get(id);
            if (!p) return;
            waiting.delete(id);
            if (error) here(p.body).then(p.resolve, p.reject);   // e.g. could not be cloned back: build it here
            else p.resolve(curves);
        };
        w.onerror = (e) => { e?.preventDefault?.(); try { w.terminate(); } catch { /* gone */ } giveUp(); };
        worker = w;
    } catch { worker = false; }
    return worker || null;
}

export function buildCurves(body) {
    const w = getWorker();
    if (!w) return here(body);
    return new Promise((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject, body });
        try { w.postMessage({ id, body }); } catch { waiting.delete(id); here(body).then(resolve, reject); }
    });
}
