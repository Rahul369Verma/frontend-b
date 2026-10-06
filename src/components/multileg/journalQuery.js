// Pure helpers for EngineJournal (kept out of the component file so Fast
// Refresh keeps working and the tests can import them directly).
export const PAGE = 50;

export function buildQuery({ deploymentId, type, q }, cursor) {
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (deploymentId) p.set('deploymentId', deploymentId);
    if (type) p.set('types', type);
    if (q) p.set('q', q);
    if (cursor) { p.set('before', cursor.before); p.set('beforeId', cursor.beforeId); }
    return p.toString();
}

/** Merge a fresh head page into the loaded rows. Overlap → prepend only the new
 *  rows (older pages stay loaded). No overlap → more arrived than one page
 *  holds, so the head REPLACES the list rather than leaving a silent gap. */
export function mergeHead(prev, head) {
    if (!prev.length) return { rows: head.events, reset: true };
    const ids = new Set(prev.map(r => r._id));
    const fresh = head.events.filter(e => !ids.has(e._id));
    if (fresh.length === head.events.length && head.hasMore) return { rows: head.events, reset: true };
    return { rows: fresh.length ? [...fresh, ...prev] : prev, reset: false };
}

export const JOURNAL_EMPTY = { rows: [], next: null, total: null };

/** rows + the older-page cursor + the filter's total change TOGETHER — one pure
 *  step, so a merge can never leave the cursor pointing at the wrong page. */
export function journalReducer(state, action) {
    switch (action.type) {
        case 'reset': return JOURNAL_EMPTY;
        case 'head': {
            const head = action.head || { events: [] };
            const total = head.total ?? state.total;
            if (action.reset) return { rows: head.events || [], next: head.next || null, total };
            const m = mergeHead(state.rows, { events: head.events || [], hasMore: head.hasMore });
            if (m.rows === state.rows && total === state.total) return state;
            return { rows: m.rows, next: m.reset ? (head.next || null) : state.next, total };
        }
        case 'older': {
            // requested from a cursor a poll has since replaced (the head jumped
            // more than a page): appending it would leave a silent gap
            const c = action.cursor, n = state.next;
            if (c && (!n || n.before !== c.before || n.beforeId !== c.beforeId)) return state;
            const ids = new Set(state.rows.map(r => r._id));
            return { ...state, rows: [...state.rows, ...((action.page && action.page.events) || []).filter(e => !ids.has(e._id))], next: (action.page && action.page.next) || null };
        }
        default: return state;
    }
}
