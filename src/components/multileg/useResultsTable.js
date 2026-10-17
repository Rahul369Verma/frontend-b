'use strict';
/**
 * useResultsTable — the Results tab's round-trips, fetched ON DEMAND.
 *
 * User, 17-Oct-2026: "trades?limit=2000 takes 21 s … why receive all the data at
 * once? Get the required data only, when an action asks for it." The tab used to
 * download every structure trade with its minute-by-minute path and filter / search
 * / sort / page it here. Now the server answers (backend
 * logic/analytics/multilegTradeQuery.js, proven row-for-row against the old code
 * by backend/scripts/resultsParity.js):
 *
 *   page      the 50 rows on screen + the counts the panel shows, for the current
 *             filter bar, search, exit reason, sort and page
 *   facets    the dropdowns (deployments with trade counts, structures, symbols)
 *   details   legs / path / spots — only for the rows a user OPENS (cached)
 *
 * The day-by-day curves fetch their own paths when scrolled to (ResultsDayCurves).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { pollInterval } from '../../hooks/usePolling.js';

const EMPTY_PAGE = Object.freeze({ rows: [], total: 0, matched: 0, page: 0, pages: 1, exitReasons: [] });
const EMPTY_FACETS = Object.freeze({ deployments: [], templates: [], symbols: [] });

/** Template keys whose DISPLAY name contains the search (the table searched names, not keys). */
export function templateKeysMatching(q, templates = [], keysInTrades = []) {
    const text = String(q || '').trim().toLowerCase();
    if (!text) return [];
    const nameOf = (k) => templates.find((t) => t.key === k)?.name || k || '';
    const keys = new Set([...templates.map((t) => t.key), ...keysInTrades]);
    return [...keys].filter((k) => k && nameOf(k).toLowerCase().includes(text));
}

/** The filter bar as query params (the same names the server reads). */
export const filterParams = (filter, since) => ({
    mode: filter.mode, deploymentId: filter.deploymentId, template: filter.template, symbol: filter.symbol,
    ...(since != null ? { since } : {}),
});

export default function useResultsTable({ active, filter, since, table, templates, pageSize = 50, pollMs = 60_000 }) {
    const [page, setPage] = useState(EMPTY_PAGE);
    const [facets, setFacets] = useState(EMPTY_FACETS);
    // `loading` is DERIVED: the answer for the current request is not in yet (no setState in an effect)
    const [doneKey, setDoneKey] = useState(null);
    const [nonce, setNonce] = useState(0);   // the Refresh button asks again for the same page
    const [details, setDetails] = useState(() => new Map());
    const [q, setQ] = useState(table.q);
    const reqRef = useRef(0);

    // typing in the search box asks once it pauses, not per keystroke
    useEffect(() => {
        const t = setTimeout(() => setQ(table.q), 300);
        return () => clearTimeout(t);
    }, [table.q]);

    const qTemplates = useMemo(() => templateKeysMatching(q, templates, facets.templates), [q, templates, facets.templates]);
    // The request is keyed on its VALUES: a re-render that rebuilds the same filter (the
    // structure list arriving, the dropdowns refreshing) must not ask for the page again.
    const paramsJson = JSON.stringify({
        ...filterParams(filter, since),
        q, qTemplates: qTemplates.join(','), reason: table.reason, sort: table.sort, dir: table.dir, page: table.page, pageSize,
    });
    const reqKey = `${paramsJson}#${nonce}`;
    const loading = !!active && doneKey !== reqKey;

    const loadPage = useCallback(() => {
        const id = ++reqRef.current;
        const key = reqKey;
        return axios.get(`${API_URL}/multileg/trades/page`, { params: JSON.parse(paramsJson), timeout: 30000 })
            .then((r) => { if (id === reqRef.current && r.data && Array.isArray(r.data.rows)) setPage(r.data); })
            .catch(() => {})
            .finally(() => { if (id === reqRef.current) setDoneKey(key); });
    }, [paramsJson, reqKey]);
    const loadFacets = useCallback(() => axios.get(`${API_URL}/multileg/trades/facets`, { timeout: 30000 })
        .then((r) => { if (r.data && Array.isArray(r.data.deployments)) setFacets(r.data); })
        .catch(() => {}), []);
    const latestPage = useRef(loadPage);
    useEffect(() => { latestPage.current = loadPage; }, [loadPage]);

    /** Refresh button: the dropdowns now, and the page asked again (the spinner shows until it is in). */
    const refresh = useCallback(() => { setNonce((n) => n + 1); return loadFacets(); }, [loadFacets]);

    // the page on screen: on entering the tab and whenever the filter, search, sort or page changes
    useEffect(() => { if (active) loadPage(); }, [active, loadPage]);
    // the dropdowns on entering the tab; both refreshed every minute while it is open
    useEffect(() => {
        if (!active) return undefined;
        loadFacets();
        const t = pollInterval(() => Promise.all([latestPage.current(), loadFacets()]), pollMs);
        return () => t?.();
    }, [active, pollMs, loadFacets]);

    /** Fetch legs/path for the given row ids that are not cached yet (one request). */
    const ensureDetails = useCallback((ids) => {
        const missing = [...new Set(ids.map(String))].filter((id) => id && !details.has(id)).slice(0, 60);
        if (!missing.length) return Promise.resolve();
        return axios.get(`${API_URL}/multileg/trades/details`, { params: { ids: missing.join(',') }, timeout: 30000 })
            .then((r) => {
                const rows = Array.isArray(r.data) ? r.data : [];
                setDetails((m) => { const n = new Map(m); for (const d of rows) n.set(String(d._id), d); return n; });
            })
            .catch(() => {});
    }, [details]);

    return { page, facets, loading, refresh, details, ensureDetails, qTemplates };
}
