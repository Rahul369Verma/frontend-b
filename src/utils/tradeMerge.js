/**
 * Incremental trade-history helpers for the multileg Results tab.
 *
 * The tab loads the full history once, then polls only rows that exited (or
 * were quarantined) at/after the newest exit it already holds
 * (GET /api/multileg/trades?after=ISO). These merge that delta into the list.
 */

const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : -Infinity; };

/** ISO string of the latest `exitAt` in `rows`, or null when none has one. */
export function newestExitIso(rows) {
    let best = -Infinity;
    for (const r of rows || []) { const t = ms(r?.exitAt); if (t > best) best = t; }
    return best === -Infinity ? null : new Date(best).toISOString();
}

// Fields whose change means the row must be replaced. Trade rows are
// insert-only except for a quarantine stamp, so this is deliberately short.
const CHANGE_KEYS = ['exitAt', 'netPnl', 'grossPnl', 'charges', 'quarantined', 'quarantinedAt', 'quarantineReason'];

/**
 * Merge `incoming` into `prev` by `_id` (incoming wins), newest exit first.
 * Returns `prev` itself when nothing is new or changed, so React state does
 * not change and the day curves are not rebuilt on an empty poll — including
 * against an older backend that ignores `after` and resends recent rows.
 */
export function mergeTradesById(prev, incoming) {
    const base = Array.isArray(prev) ? prev : [];
    if (!Array.isArray(incoming) || incoming.length === 0) return base;
    const byId = new Map(base.map(r => [String(r?._id), r]));
    let changed = false;
    for (const r of incoming) {
        if (!r || r._id == null) continue;
        const id = String(r._id);
        const old = byId.get(id);
        if (!old || CHANGE_KEYS.some(k => String(old[k] ?? '') !== String(r[k] ?? ''))) {
            byId.set(id, r);
            changed = true;
        }
    }
    if (!changed) return base;
    return [...byId.values()].sort((a, b) => ms(b?.exitAt) - ms(a?.exitAt));
}
