'use strict';
/**
 * slownessReporter — the browser's half of "a notification for every slowness"
 * (user, 17-Oct-2026). The server cannot see a page freeze or how long an answer
 * took to arrive over the network, so every open page reports:
 *
 *   longtask  the page's main thread was blocked ≥ 500 ms (a frozen screen) — and,
 *             where the browser has the Long Animation Frames API (Chrome 123+), WHAT
 *             blocked it: the script time and its biggest script (bundle chunk, function,
 *             what started it), plus the style/layout time. A bare "froze 506 ms" on
 *             21-Oct-2026 could not say whether it was a render, a chart or a layout.
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

/** "https://host/assets/MultiLeg-Ab12Cd34.js?v=1" → "MultiLeg" (the Vite chunk = the source file). */
export function chunkName(url) {
    const file = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
    if (!file) return null;
    return file.replace(/\.(m?js|jsx|tsx?)$/i, '').replace(/[-.][A-Za-z0-9_]{6,}$/, '') || file;
}

/**
 * One long animation frame → what blocked it, in under ~150 characters:
 * "script 420 ms (MultiLeg.Xe via BUTTON.onclick 380 ms) · layout 60 ms (forced 40 ms)".
 * Pure: takes a PerformanceLongAnimationFrameTiming-shaped object.
 */
export function describeFrame(e) {
    const scripts = Array.isArray(e && e.scripts) ? e.scripts : [];
    const scriptMs = Math.round(scripts.reduce((a, x) => a + (Number(x.duration) || 0), 0));
    const forced = Math.round(scripts.reduce((a, x) => a + (Number(x.forcedStyleAndLayoutDuration) || 0), 0));
    const end = (Number(e && e.startTime) || 0) + (Number(e && e.duration) || 0);
    const layoutMs = Number(e && e.styleAndLayoutStart) > 0 ? Math.max(0, Math.round(end - e.styleAndLayoutStart)) : null;
    const top = scripts.slice().sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
    const parts = [];
    if (top) {
        const where = [chunkName(top.sourceURL), top.sourceFunctionName].filter(Boolean).join('.') || 'unknown script';
        const via = top.invoker ? ` via ${String(top.invoker).slice(0, 40)}` : '';
        parts.push(`script ${scriptMs} ms (${where}${via} ${Math.round(Number(top.duration) || 0)} ms)`);
    } else {
        parts.push('no script attributed (rendering/browser work)');
    }
    if (layoutMs != null) parts.push(`layout ${layoutMs} ms${forced ? ` (forced ${forced} ms)` : ''}`);
    return parts.join(' · ');
}

export function installSlownessReporter({ axios, apiUrl, fetchImpl = null, getPath = () => window.location.pathname, now = () => performance.now(), PerfObserver = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : null, every = FLUSH_MS } = {}) {
    const queue = [];
    const push = (s) => { if (queue.length < MAX_QUEUE) queue.push(s); };
    const isOwn = (url) => /\/telemetry\/slow/.test(String(url || ''));

    // 1. frozen screens — attributed when the browser can say what blocked them
    try {
        const loaf = !!(PerfObserver && Array.isArray(PerfObserver.supportedEntryTypes) && PerfObserver.supportedEntryTypes.includes('long-animation-frame'));
        if (PerfObserver) {
            new PerfObserver((list) => {
                for (const e of list.getEntries()) {
                    if (e.duration < LONGTASK_MS) continue;
                    push({ type: 'longtask', route: routeKey(getPath()), ms: Math.round(e.duration), ...(loaf ? { what: describeFrame(e) } : {}) });
                }
            }).observe({ type: loaf ? 'long-animation-frame' : 'longtask', buffered: true });
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
