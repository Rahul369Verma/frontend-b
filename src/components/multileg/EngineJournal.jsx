import React, { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { usePolling } from '../../hooks/usePolling.js';
import { PAGE, buildQuery, journalReducer, JOURNAL_EMPTY } from './journalQuery.js';

/**
 * Engine journal for the Deploy tab — pages the DURABLE multileg journal
 * (GET /api/multileg/events) instead of the engine's in-memory tail.
 *
 * Why: the old feed showed the last 60 rows of a 200-row ring. On 6-Oct-2026
 * two SENSEX zone deployments filled it every ~8 minutes (1,716 of 1,904 rows
 * by 13:20), so every other deployment's events were unreachable — including
 * why 11 NIFTY deployments stood down that morning. Now: filter by deployment
 * and type, page back as far as the journal goes, and a per-deployment count
 * so a flood is a visible NUMBER rather than a missing page.
 *
 * `focus` = { id, n } from the parent: set the deployment filter (n bumps so
 * the same deployment can be re-focused) and scroll the panel into view.
 */
const IST_TZ = 'Asia/Kolkata';
const istStr = (v, opts) => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    try { return d.toLocaleString('en-IN', { timeZone: IST_TZ, hour12: false, ...opts }); } catch { return '—'; }
};
const istDate = (v) => istStr(v, { day: '2-digit', month: 'short' });
const istTimeSec = (v) => istStr(v, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const istTime = (v) => istStr(v, { hour: '2-digit', minute: '2-digit' });
const nf = (n) => Number(n || 0).toLocaleString('en-IN');

const typeTone = (t) => (t === 'REPEATS' ? 'text-fg-5'
    : /FAIL|ERROR|SKIP|DECLINED|STOOD_ASIDE|BLOCKED|ORPHAN|STALE|UNVERIFIED/.test(t) ? 'text-danger'
        : /ENTRY|EXIT|SETTLED|LEG_SL/.test(t) ? 'text-success' : 'text-sky-300');

export default function EngineJournal({ deployments = [], repeats = {}, focus = null, active = true }) {
    const [filter, setFilter] = useState({ deploymentId: '', type: '', q: '' });
    const [qDraft, setQDraft] = useState('');
    const [page, dispatch] = useReducer(journalReducer, JOURNAL_EMPTY);   // { rows, next, total } — merged in ONE pure step
    const { rows, next, total } = page;
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const panelRef = useRef(null);
    const filterRef = useRef(filter);                 // latest filter, for in-flight staleness checks
    useEffect(() => { filterRef.current = filter; }, [filter]);   // declared BEFORE the loader effect below

    // every filter change goes through here (an event, not an effect): clear the
    // loaded pages so rows from the old filter never mix with the new one
    const changeFilter = (upd) => {
        setFilter(f => (typeof upd === 'function' ? upd(f) : upd));
        dispatch({ type: 'reset' });
        setLoading(true);
    };
    const setDep = (id) => changeFilter(f => ({ ...f, deploymentId: id }));

    // a deployment focused from elsewhere on the tab (React's "adjust state when
    // a prop changes" pattern — during render, not in an effect)
    const [focusSeen, setFocusSeen] = useState(focus);
    if (focus !== focusSeen) {
        setFocusSeen(focus);
        if (focus?.id && focus.id !== filter.deploymentId) {
            setFilter(f => ({ ...f, deploymentId: focus.id }));
            dispatch({ type: 'reset' });
            setLoading(true);
        }
    }
    // scroll only for a focus that ARRIVES while mounted — remounting the Deploy
    // tab with an old focus must not yank the page down to the journal
    const mountFocus = useRef(focus);
    useEffect(() => {
        if (focus?.id && focus !== mountFocus.current) panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, [focus]);

    // head page: loaded on filter change, merged on every poll
    const loadHead = useCallback((f, reset) => axios.get(`${API_URL}/multileg/events?${buildQuery(f)}`)
        .then(r => {
            if (filterRef.current !== f) return;              // filter changed while in flight
            setError(null);
            dispatch({ type: 'head', head: r.data || { events: [] }, reset });
        })
        .catch(e => { if (filterRef.current === f) setError(e?.response?.data?.error || e.message || 'journal unavailable'); }), []);
    const loadSummary = useCallback(() => axios.get(`${API_URL}/multileg/events/summary`).then(r => setSummary(r.data || null)).catch(() => {}), []);

    useEffect(() => {
        if (!active) return;
        // a superseded request must not clear `loading` for the new filter
        loadHead(filter, true).finally(() => { if (filterRef.current === filter) setLoading(false); });
    }, [filter, active, loadHead]);
    useEffect(() => { if (active) loadSummary(); }, [active, loadSummary]);
    usePolling(() => { loadHead(filterRef.current, false); loadSummary(); }, active ? 10000 : null, { immediate: false });

    const loadOlder = () => {
        if (!next || loading) return;
        const f = filter, cursor = next;
        setLoading(true);
        axios.get(`${API_URL}/multileg/events?${buildQuery(f, cursor)}`)
            // the reducer drops the page if a poll moved the cursor meanwhile
            .then(r => { if (filterRef.current === f) dispatch({ type: 'older', page: r.data || { events: [] }, cursor }); })
            .catch(e => { if (filterRef.current === f) setError(e?.response?.data?.error || e.message); })
            .finally(() => { if (filterRef.current === f) setLoading(false); });
    };

    // deployment options: today's writers by count, then every other deployment
    // (0 today) — a deployment with NO rows today is still selectable, so its
    // older history is one click away
    const depOptions = useMemo(() => {
        const out = [];
        const seen = new Set();
        for (const d of summary?.byDeployment || []) {
            const id = d.deploymentId || '';
            if (!id) continue;
            seen.add(id);
            out.push({ id, name: d.name || id, n: d.n });
        }
        for (const d of deployments) {
            const id = String(d._id);
            if (!seen.has(id)) { seen.add(id); out.push({ id, name: d.name || id, n: 0 }); }
        }
        // filtered to a deployment that no longer exists (clicked from an old
        // row): keep it selectable, or the select would claim "All deployments"
        if (filter.deploymentId && !seen.has(filter.deploymentId)) {
            const row = rows.find(r => r.deploymentId === filter.deploymentId);
            out.push({ id: filter.deploymentId, name: `${row?.name || filter.deploymentId} (deleted)`, n: 0 });
        }
        return out;
    }, [summary, deployments, filter.deploymentId, rows]);
    const typeOptions = summary?.byType || [];
    const flooder = summary?.byDeployment?.[0];
    const flooderShare = flooder && summary.total ? flooder.n / summary.total : 0;

    // collapsing right now (not yet booked as a REPEATS row) — visible as it happens
    const liveRepeats = useMemo(() => {
        const ids = filter.deploymentId ? [filter.deploymentId] : Object.keys(repeats || {});
        const nameOf = (id) => deployments.find(d => String(d._id) === id)?.name || id;
        return ids.filter(id => repeats?.[id]?.length).map(id => ({ id, name: nameOf(id), items: repeats[id] }));
    }, [repeats, filter.deploymentId, deployments]);

    return (
        <div ref={panelRef} className="bg-surface rounded-xl border border-line p-4 flex flex-col max-h-[40rem]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
                <div className="text-sm font-semibold text-fg">Engine events</div>
                <div className="text-3xs text-fg-5">
                    {total != null ? `${nf(rows.length)} of ${nf(total)} shown` : rows.length ? `${nf(rows.length)} shown` : ''}
                    {summary ? ` · ${nf(summary.total)} today` : ''}
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-2 mb-2 text-2xs">
                <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-3xs text-fg-5">Deployment</span>
                    <select value={filter.deploymentId} onChange={e => setDep(e.target.value)}
                        className="bg-slate-800 border border-line rounded p-1 text-fg-2 max-w-[18rem]">
                        <option value="">All deployments{summary ? ` — ${nf(summary.total)} today` : ''}</option>
                        {depOptions.map(o => <option key={o.id} value={o.id}>{o.name} — {nf(o.n)} today</option>)}
                    </select>
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-3xs text-fg-5">Type</span>
                    <select value={filter.type} onChange={e => changeFilter(f => ({ ...f, type: e.target.value }))}
                        className="bg-slate-800 border border-line rounded p-1 text-fg-2 max-w-[14rem]">
                        <option value="">All types</option>
                        {typeOptions.map(t => <option key={t.type} value={t.type}>{t.type} — {nf(t.n)} today</option>)}
                        <option value="SIGNAL_STATUS">SIGNAL_STATUS (ribbon history)</option>
                    </select>
                </label>
                <form className="flex flex-col gap-0.5" onSubmit={e => { e.preventDefault(); changeFilter(f => ({ ...f, q: qDraft.trim() })); }}>
                    <span className="text-3xs text-fg-5">Text</span>
                    <input value={qDraft} onChange={e => setQDraft(e.target.value)} placeholder="e.g. no quote, DTE"
                        aria-label="Search event text" className="bg-slate-800 border border-line rounded p-1 text-fg-2 w-36" />
                </form>
                {(filter.deploymentId || filter.type || filter.q) && (
                    <button type="button" onClick={() => { changeFilter({ deploymentId: '', type: '', q: '' }); setQDraft(''); }}
                        className="px-2 py-1 rounded border border-line-2 text-fg-4 hover:text-fg">Clear filters</button>
                )}
            </div>

            {!filter.deploymentId && flooderShare >= 0.5 && (
                <div className="text-3xs text-warning mb-1.5" role="status">
                    {flooder.name} wrote {Math.round(flooderShare * 100)}% of today's rows ({nf(flooder.n)} of {nf(summary.total)}).{' '}
                    <button type="button" className="underline hover:text-fg" onClick={() => setDep(flooder.deploymentId)}>Show only it</button>
                </div>
            )}
            {liveRepeats.length > 0 && (
                <div className="text-3xs text-fg-5 mb-1.5 space-y-0.5" title="Repeats of the same event shape are counted, not re-journaled; the count is booked as one REPEATS row every 15 min while it continues, or when it stops.">
                    {liveRepeats.map(r => (
                        <div key={r.id} className="break-words">
                            <span className="text-fg-4">collapsing now</span> · {r.name}: {r.items.map(i => `${i.type} ×${nf(i.n)} since ${istTime(i.since)}`).join(', ')}
                        </div>
                    ))}
                </div>
            )}

            {error && <div className="text-2xs text-danger mb-1">Journal unavailable: {error}</div>}
            {rows.length === 0 ? (
                <div className="text-xs text-fg-5">{loading ? 'Loading…' : filter.deploymentId || filter.type || filter.q ? 'No events match these filters.' : 'No events yet.'}</div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto text-2xs space-y-1">
                    {rows.map(e => (
                        <div key={e._id} className={`flex flex-wrap gap-x-2 border-b border-line-0/60 pb-1 ${e.type === 'REPEATS' ? 'opacity-75' : ''}`}>
                            <span className="text-fg-5 whitespace-nowrap" title={`${istStr(e.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })} IST`}>
                                {istDate(e.at)} {istTimeSec(e.at)}
                            </span>
                            <span className={`font-semibold whitespace-nowrap ${typeTone(e.type)}`}>{e.type}</span>
                            <span className="text-fg-4 min-w-0 break-words">
                                {e.name && !filter.deploymentId && e.deploymentId
                                    ? <button type="button" onClick={() => setDep(e.deploymentId)} className="text-fg-3 hover:text-fg hover:underline" title={`Show only ${e.name}`}>[{e.name}]</button>
                                    : e.name ? `[${e.name}]` : ''}{' '}
                                {e.message}
                            </span>
                        </div>
                    ))}
                    <div className="pt-1.5 pb-0.5 flex items-center gap-2">
                        {next ? (
                            <button type="button" onClick={loadOlder} disabled={loading}
                                className="px-2 py-1 rounded border border-line-2 text-fg-3 hover:text-fg disabled:opacity-50">
                                {loading ? 'Loading…' : `Load ${PAGE} older`}
                            </button>
                        ) : <span className="text-3xs text-fg-5">Start of the journal{total != null && rows.length >= total ? ` — all ${nf(total)} shown` : ''}.</span>}
                    </div>
                </div>
            )}
        </div>
    );
}
