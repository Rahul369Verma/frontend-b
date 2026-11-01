/**
 * Merging the Multi-Leg live stream into the Deploy tab's deployments (31-Oct-2026).
 *
 * Three sources write the same list: the stream's MARKS (every second: an open structure's mark
 * from live prices — backend exits.js _watch), the stream's BOOK (a deployment's state each time
 * the engine saves it), and the slow safety-net POLL. Their marks can arrive out of order, so a
 * mark is taken only when it is NEWER than the one shown (lastMtmAt) — a book or a poll carrying
 * the loop's older mark never pulls a fresher streamed one back. Everything else in a book or a
 * poll (state, legs, totals, errors) replaces what was there. A mark belongs to ONE structure
 * (its entryAt): never carried onto the next structure the same deployment opens. PURE.
 */
const MARK_FIELDS = ['lastMtm', 'lastMtmRupees', 'lastMtmChargesEst', 'lastMtmNetRupees', 'lastSpot', 'lastMtmAt', 'liveLtps', 'markSrc'];
const t = (iso) => (iso ? Date.parse(iso) : NaN);
const fresher = (a, b) => Number.isFinite(t(a)) && !(t(b) >= t(a));   // a is newer than b (or b has none)
const sameStructure = (a, b) => !a || !b || String(a) === String(b);   // entryAt: unknown on either side → no opinion

/** A `multileg_marks` payload → the list with each OPEN structure's newer mark applied. */
export function applyMarks(deployments, marks) {
    if (!Array.isArray(deployments) || !marks || !marks.length) return deployments;
    const by = new Map(marks.map((m) => [String(m.id), m]));
    let changed = false;
    const out = deployments.map((d) => {
        const m = by.get(String(d._id));
        const pos = d.position;
        if (!m || !pos || pos.state !== 'OPEN' || !sameStructure(m.entryAt, pos.entryAt) || !fresher(m.at, pos.lastMtmAt)) return d;
        changed = true;
        return {
            ...d,
            position: {
                ...pos, lastMtm: m.mtm, lastMtmRupees: m.grossRupees,
                lastMtmChargesEst: m.chargesEst ?? pos.lastMtmChargesEst, lastMtmNetRupees: m.netRupees ?? pos.lastMtmNetRupees,
                lastSpot: m.spot ?? pos.lastSpot, lastMtmAt: m.at, liveLtps: m.ltps || null, markSrc: m.src || null,
            },
        };
    });
    return changed ? out : deployments;
}

/** `next` (a book or a poll) over `prev`, keeping an OPEN structure's fresher streamed mark. */
function keepFresherMark(next, prev) {
    const np = next && next.position, op = prev && prev.position;
    if (!np || !op || np.state !== 'OPEN' || op.state !== 'OPEN' || String(op.entryAt) !== String(np.entryAt) || !fresher(op.lastMtmAt, np.lastMtmAt)) return next;
    const keep = {};
    for (const f of MARK_FIELDS) if (op[f] !== undefined) keep[f] = op[f];
    return { ...next, position: { ...np, ...keep } };
}

/** A `multileg_book` payload → the list with each deployment replaced (or added), fresher marks kept. */
export function applyBook(deployments, incoming) {
    if (!incoming || !incoming.length) return deployments;
    const out = (deployments || []).slice();
    for (const inc of incoming) {
        const i = out.findIndex((d) => String(d._id) === String(inc._id));
        if (i < 0) out.push(inc);
        else out[i] = keepFresherMark(inc, out[i]);
    }
    return out;
}

/** A poll's full list (authoritative for which deployments exist) over the shown one, fresher marks kept. */
export function applyPoll(prevList, nextList) {
    const prev = new Map((prevList || []).map((d) => [String(d._id), d]));
    return (nextList || []).map((d) => keepFresherMark(d, prev.get(String(d._id))));
}

/** Deployments whose structure closed or opened between two lists (the trades table and the day's story move then). */
export function stateChanged(prevList, nextList) {
    const prev = new Map((prevList || []).map((d) => [String(d._id), d.position && d.position.state]));
    return (nextList || []).some((d) => prev.has(String(d._id)) && prev.get(String(d._id)) !== (d.position && d.position.state));
}
