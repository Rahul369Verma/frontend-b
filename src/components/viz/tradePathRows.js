/**
 * Overlay paths (e.g. a replay with no stops) merged into TradePathChart's rows.
 *
 * Each overlay point gets its own row at its own instant (the x axis is categorical, so
 * rows must be in time order). Lines skip the gaps (connectNulls); the tooltip, which
 * reads one row, gets every series' LATEST value at or before that instant: each replay only up
 * to its own exit, the recorded mark only while the trade was open, never after either one.
 *
 * @param rows       the chart's rows (recorded marks + the booked exit point), each { ms, … }
 * @param points     [{ ms, key, v }] overlay values, already parsed
 * @param keys       overlay keys, in draw order
 * @param lastMarkMs the last recorded mark's instant
 * @param label      ms → axis label
 */
export function mergeOverlayRows({ rows, points, keys, lastMarkMs, label }) {
    if (!points.length) return rows;
    const out = [
        ...rows,
        ...points.map((p) => ({ ms: p.ms, net: null, gross: null, spot: null, ltp: null, booked: null, label: label(p.ms), [`ov_${p.key}`]: p.v })),
    ];
    // a booked exit point sorts after a mark at the same instant
    out.sort((a, b) => a.ms - b.ms || (a.isExit ? 1 : 0) - (b.isExit ? 1 : 0));
    const held = {};
    // each overlay is held only up to its own last point (its exit): a replay that closed at 10:18 has
    // no value at 11:47 — carried on, its tooltip read the 10:17 mark for the rest of the day
    const endMs = {};
    for (const p of points) endMs[p.key] = Math.max(endMs[p.key] ?? -Infinity, p.ms);
    let netHeld = null;
    for (const r of out) {
        if (r.net != null) netHeld = r.net;
        r.netHeld = lastMarkMs != null && r.ms <= lastMarkMs ? netHeld : null;
        for (const k of keys) {
            if (r[`ov_${k}`] != null) held[k] = r[`ov_${k}`];
            r[`ovHeld_${k}`] = endMs[k] != null && r.ms <= endMs[k] ? (held[k] ?? null) : null;
        }
    }
    return out;
}
