/**
 * Builds the Results day curves OFF the page's thread. For 534 trades / 138k marks
 * (prod, 18-Oct-2026) parsing + building took 0.3-0.7 s — the page froze while it
 * ran. See curvesInWorker.js.
 */
import { curvesFromBody } from './resultsCurves.js';

self.onmessage = (e) => {
    const { id, body } = e.data || {};
    try { self.postMessage({ id, curves: curvesFromBody(body) }); }
    catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};
