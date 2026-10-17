'use strict';
/**
 * The Results tab's day-by-day curves from GET /api/multileg/trades/paths rows —
 * the same rule the page has always used (normalizeMultilegTrade → buildDayCurves,
 * quarantined trades excluded and counted). See ResultsDayCurves.jsx.
 */
import { normalizeMultilegTrade, buildDayCurves } from '../../utils/dayCurves';

/** One /paths row → the trade shape normalizeMultilegTrade reads (path as {ms, net}). */
export function expandPathRow(r) {
    const { p, ...rest } = r || {};
    return { ...rest, path: Array.isArray(p) ? p.map(([ms, net]) => ({ ms, net })) : p ?? undefined };
}

/** The curves over the given trades — the same rule the page has always used. */
export function curvesOf(rows) {
    const norm = [];
    let quarantined = 0, unreadable = 0;
    for (const t of rows) {
        if (t.quarantined) { quarantined++; continue; }
        const n = normalizeMultilegTrade(t);
        if (n) norm.push(n); else unreadable++;
    }
    const res = buildDayCurves(norm);
    return { days: res?.days || [], excluded: { ...(res?.excluded || {}), quarantined, unreadable } };
}
