/**
 * ResultsDayCurves — "how each day went, minute by minute", loaded when it is
 * REACHED (it is the last section of the Results tab).
 *
 * The curves are the only part of the tab that needs every trade's recorded path,
 * so the paths are no longer downloaded with the page: this asks
 * GET /api/multileg/trades/paths (the filter bar's trades, marks as compact
 * [ms, net] pairs) once the section scrolls into view, and again when the filter
 * changes while it is shown. The curves are built exactly as before
 * (normalizeMultilegTrade → buildDayCurves, quarantined trades excluded and counted),
 * in a Web Worker — on prod's history that work froze the page for 0.3-0.7 s.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { buildCurves } from './curvesInWorker.js';
import { filterParams } from './useResultsTable.js';
import DayEquityCurves from '../viz/DayEquityCurves';

/** The server's own words from a failed answer (it arrives as text here). */
function errorText(e) {
    const d = e?.response?.data;
    if (typeof d === 'string') { try { return JSON.parse(d).error || e.message; } catch { return e.message; } }
    return d?.error || e?.message;
}

export default function ResultsDayCurves({ filter, since, until = null }) {
    const boxRef = useRef(null);
    const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
    const [curves, setCurves] = useState(null);
    const [error, setError] = useState(null);

    // load when the section comes near the screen (once seen, it stays loaded)
    useEffect(() => {
        if (seen || !boxRef.current) return undefined;
        const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '400px' });
        io.observe(boxRef.current);
        return () => io.disconnect();
    }, [seen]);

    const params = useMemo(() => filterParams(filter, since, until), [filter, since, until]);
    useEffect(() => {
        if (!seen) return undefined;
        let dead = false;
        // the TEXT goes to the worker: parsing it is part of the work kept off this thread
        axios.get(`${API_URL}/multileg/trades/paths`, { params, timeout: 120000, responseType: 'text', transformResponse: [(d) => d] })
            .then((r) => buildCurves(r.data))
            .then((c) => { if (!dead) { setCurves(c); setError(null); } })
            .catch((e) => { if (!dead) setError(errorText(e)); });
        return () => { dead = true; };
    }, [seen, params]);

    return (
        <div ref={boxRef} className="bg-surface rounded-xl border border-line p-4" data-testid="results-day-curves">
            {curves ? (
                <DayEquityCurves days={curves.days} excluded={curves.excluded} markBasis="net-of-estimated-costs"
                    emptyText="No booked round-trip in this filter to draw." />
            ) : (
                <div className="text-xs text-fg-5">{error ? `Could not load the day-by-day curves: ${error}` : seen ? 'Loading the day-by-day curves…' : 'Day-by-day curves load when you scroll here.'}</div>
            )}
        </div>
    );
}
