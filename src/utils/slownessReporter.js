'use strict';
/**
 * slownessReporter — the browser's half of "a notification for every slowness"
 * (user, 17-Oct-2026). The server cannot see a page freeze or how long an answer
 * took to arrive over the network, so every open page reports:
 *
 *   longtask  the page's main thread was blocked ≥ 500 ms (a frozen screen)
 *   api       an API answer took ≥ 5 s end to end (network + server), axios or fetch
 *
 * Batched and sent every 30 s to POST /api/telemetry/slow, where the server's
 * slowness watch turns them into notifications (bell + Telegram), one per
 * page + cause. Never throws, never retries, never reports its own request.
 */
const LONGTASK_MS = 500;
const API_MS = 5000;
const FLUSH_MS = 30_000;
const MAX_QUEUE = 50;

/** /strategy/NSE:NIFTY → /strategy/:id — one key per PAGE, not per URL. */
export function routeKey(pathname) {
    const segs = String(pathname || '/').split('?')[0].split('/').filter(Boolean);
    if (!segs.length) return '/';
    return `/${segs[0]}${segs.length > 1 ? '/:id' : ''}`;
}

/** The API path without query or ids: /api/multileg/deployments/abc123/max-loss → /api/multileg/deployments/:id/max-loss */
export function apiKey(url) {
    try {
        const u = new URL(url, 'http://x');
        return u.pathname.split('/').map((s) => (/^[0-9a-f]{12,}$|^\d{3,}$/i.test(s) ? ':id' : s)).join('/').slice(0, 80);
    } catch { return String(url).split('?')[0].slice(0, 80); }
}

export function installSlownessReporter({ axios, apiUrl, fetchImpl = null, getPath = () => window.location.pathname, now = () => performance.now(), PerfObserver = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : null, every = FLUSH_MS } = {}) {
    const queue = [];
    const push = (s) => { if (queue.length < MAX_QUEUE) queue.push(s); };
    const isOwn = (url) => /\/telemetry\/slow/.test(String(url || ''));

    // 1. frozen screens
    try {
        if (PerfObserver) {
            new PerfObserver((list) => {
                for (const e of list.getEntries()) {
                    if (e.duration >= LONGTASK_MS) push({ type: 'longtask', route: routeKey(getPath()), ms: Math.round(e.duration) });
                }
            }).observe({ type: 'longtask', buffered: true });
        }
    } catch { /* long tasks not supported in this browser */ }

    // 2. slow answers through axios
    const noteApi = (url, t0) => {
        if (t0 == null || isOwn(url)) return;
        const ms = now() - t0;
        if (ms >= API_MS) push({ type: 'api', route: routeKey(getPath()), api: apiKey(url), ms: Math.round(ms) });
    };
    if (axios && axios.interceptors) {
        axios.interceptors.request.use((cfg) => { cfg.__slowT0 = now(); return cfg; });
        axios.interceptors.response.use(
            (r) => { noteApi(r.config && r.config.url, r.config && r.config.__slowT0); return r; },
            (e) => { if (e && e.config) noteApi(e.config.url, e.config.__slowT0); return Promise.reject(e); },
        );
    }

    // 3. …and through fetch (some pages use it directly)
    let wrappedFetch = null;
    if (fetchImpl) {
        wrappedFetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input && input.url;
            const t0 = now();
            try { return await fetchImpl(input, init); }
            finally { if (/\/api\//.test(String(url || ''))) noteApi(url, t0); }
        };
    }

    async function flush() {
        if (!queue.length || !axios) return 0;
        const samples = queue.splice(0, queue.length);
        try { await axios.post(`${apiUrl}/telemetry/slow`, { samples }); } catch { /* best-effort: never retry */ }
        return samples.length;
    }
    const timer = every ? setInterval(() => { flush(); }, every) : null;
    return { flush, queue, fetch: wrappedFetch, stop: () => timer && clearInterval(timer) };
}
