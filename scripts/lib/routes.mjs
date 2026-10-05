'use strict';
/**
 * routes.mjs — the route list every UI auditor walks, DERIVED from the app's own
 * nav table instead of hand-maintained alongside it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Both auditors used to carry their own literal array. It had drifted: it listed
 * `/strategies` and `/data`, NEITHER OF WHICH IS A ROUTE. Those two loaded a
 * blank <main>, measured clean, and were reported as "0 findings" — an audit
 * pass on pages that do not exist. At the same time `/ai-manager`,
 * `/parity-audit`, `/data-manager` and `/strategy/:symbol` were never visited at
 * all, so four real pages went unaudited while the summary claimed full coverage.
 *
 * src/config/nav.js is already the single source of truth for the rail AND the
 * <Route> table (see the comment at the top of App.jsx — they were deliberately
 * collapsed into one array so a link can never point at a missing route). This
 * makes the auditors read the same array, so coverage cannot silently drift from
 * the app again.
 *
 * Parsed with a regex rather than imported: nav.js pulls in lucide-react icon
 * components, which a bare Node script cannot resolve. The parse is asserted —
 * finding zero paths throws instead of quietly auditing nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAV = path.resolve(HERE, '../../src/config/nav.js');

/** A concrete value for each dynamic segment, so `/strategy/:symbol` is loadable. */
const PARAM_SAMPLES = { symbol: 'NIFTY' };

/**
 * Routes that are real but are NOT pages, and would poison a cross-route
 * comparison. Excluded LOUDLY: the caller is handed this list so it can say what
 * it skipped rather than quietly shrinking its own coverage.
 */
export const NON_PAGE_ROUTES = {
    '/callback': 'OAuth redirect target — renders a transient splash, never a page a user reads',
};

export function readNavRoutes() {
    const src = fs.readFileSync(NAV, 'utf8');
    const paths = [...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    if (!paths.length) {
        throw new Error(`no routes parsed from ${NAV} — the nav shape changed; fix this parser `
            + `rather than letting the auditors fall back to a stale literal list`);
    }
    return [...new Set(paths)];
}

/**
 * @returns {{ routes: string[], skipped: Array<{route: string, why: string}>, raw: string[] }}
 *   `routes` are loadable page URLs with params substituted; `skipped` is every
 *   route deliberately left out, with the reason, for the caller to print.
 */
export function auditRoutes({ includeNonPages = false } = {}) {
    const raw = readNavRoutes();
    const routes = [];
    const skipped = [];
    for (const r of raw) {
        if (!includeNonPages && NON_PAGE_ROUTES[r]) {
            skipped.push({ route: r, why: NON_PAGE_ROUTES[r] });
            continue;
        }
        if (r.includes(':')) {
            const filled = r.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
                const v = PARAM_SAMPLES[name];
                if (!v) throw new Error(`no PARAM_SAMPLES entry for ":${name}" in route ${r}`);
                return v;
            });
            routes.push(filled);
            continue;
        }
        routes.push(r);
    }
    return { routes, skipped, raw };
}
