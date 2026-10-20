/**
 * RoundTripsTable — single-leg trades, one server page at a time
 * (GET /api/trades/page, backend/logic/analytics/singleLegTradeQuery.js).
 *
 * Two homes, one component:
 *   Live Portfolio → Single-leg → Round trips   closed trades of the filter bar (a clicked deployment card)
 *   Dashboard → Trade History                  every row: open, closed and the old two-row format
 *
 * Every row says what it is: mode, the direction-gate verdict (why an enforce-mode trade
 * was allowed — Allowed above the floor, or a Probe), net after charges or "before charges"
 * when none were recorded, worst/best point, and each exceptional state as a flag with its
 * reason (never filled, closed by recovery, orphan close, index price recorded as premium…).
 * A row opens into its minute-by-minute path with India VIX and the no-stop replay
 * (SingleTradeJourney). Wide panels get a table, narrow ones (in REM, so Text Size moves
 * the switch) get cards.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Chip, ModeChip, Spinner } from '../viz/primitives';
import { inr, istDateTime, istTime, premium } from '../viz/tokens.js';
import useRemWidth from '../../hooks/useRemWidth.js';
import SingleTradeJourney from './SingleTradeJourney.jsx';
import { holdText, kindChip, gateChip, pnlCell, flagTone, shortIndex, shortContract } from './singleLegFormat.js';

const BTN = 'px-2 py-0.5 rounded border border-line bg-slate-800 text-3xs text-fg-3 hover:text-fg disabled:opacity-40';
const INPUT = 'h-8 bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2 placeholder:text-fg-5';
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const TONE = { pos: 'text-success', neg: 'text-danger', flat: 'text-fg-4', muted: 'text-fg-5' };
const money = (v) => (fin(v) == null ? '—' : inr(v, { dp: 0 }));
// premium(null) would print ₹0.00 (Number(null) is 0): absent stays a dash
const prem = (v, sym) => (fin(v) == null ? '—' : premium(v, sym));

const STATUS_OPTS = [
    { v: 'all', label: 'All rows' }, { v: 'closed', label: 'Closed' }, { v: 'open', label: 'Open' }, { v: 'legacy', label: 'Old format' },
];

/** Debounced copy of a value (the search box asks the server once typing pauses). */
function useDebounced(v, ms = 300) {
    const [d, setD] = useState(v);
    useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
    return d;
}

function TimeCell({ r }) {
    const v = r.view || {};
    const en = v.entryMs != null ? istDateTime(v.entryMs) : '—';
    const sameDay = v.entryMs != null && v.exitMs != null && new Date(v.entryMs + 19800e3).toISOString().slice(0, 10) === new Date(v.exitMs + 19800e3).toISOString().slice(0, 10);
    const ex = v.exitMs != null ? (sameDay ? istTime(v.exitMs, { seconds: false }) : istDateTime(v.exitMs)) : v.kind === 'open' ? 'open' : '—';
    return (
        <span className="whitespace-nowrap" title={`Entry ${v.entryMs != null ? istDateTime(v.entryMs, { seconds: true }) : '—'} → exit ${v.exitMs != null ? istDateTime(v.exitMs, { seconds: true }) : '—'} IST`}>
            {en} → {ex}
            <span className="block text-4xs text-fg-5">{v.holdMs != null ? `held ${holdText(v.holdMs)}` : v.kind === 'open' ? 'still open' : ''}</span>
        </span>
    );
}

function Flags({ flags }) {
    if (!flags || !flags.length) return null;
    return (
        <span className="inline-flex flex-wrap gap-1">
            {flags.filter((f) => f.code !== 'no-charges' && f.code !== 'no-deployment').map((f) => <Chip key={f.code} tone={flagTone(f.code)} title={f.why}>{f.label}</Chip>)}
        </span>
    );
}

function GateCell({ view }) {
    const g = gateChip(view?.gate);
    if (!g) return <span className="text-fg-5" title="No direction-gate verdict on this trade (before 2-Oct-2026, gate off, or an old-format row)">—</span>;
    return <Chip tone={g.tone} title={g.title}>{g.label}</Chip>;
}

function PnlCell({ view }) {
    const p = pnlCell(view);
    return (
        <span className={`tabular-nums font-semibold whitespace-nowrap ${TONE[p.tone] || ''} ${p.strike ? 'line-through opacity-60' : ''}`} title={p.title}>
            {p.text}
            {p.sub && <span className="block text-4xs font-normal text-fg-5 no-underline">{p.sub}</span>}
        </span>
    );
}

export default function RoundTripsTable({ filters = {}, history = false, depLabel = (id) => id, onDetails, refreshKey = 0, emptyText = 'No trades match.' }) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const cards = rem != null && rem < 60;
    const [q, setQ] = useState('');
    const dq = useDebounced(q);
    const [reason, setReason] = useState('all');
    const [status, setStatus] = useState(history ? 'all' : 'closed');
    const [sort, setSort] = useState({ k: 'exit', dir: 'desc' });
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(history ? 20 : 50);
    const [nonce, setNonce] = useState(0);
    const [open, setOpen] = useState(() => new Set());

    // the request is keyed on its VALUES — an object-identity key fires it again on every render
    const { status: fStatus, deploymentId: fDep, strategy: fStrategy, spot: fSpot, mode: fMode, days: fDays } = filters;
    const params = useMemo(() => {
        const p = { status: history ? status : (fStatus || 'closed'), page, pageSize, sort: sort.k, dir: sort.dir };
        const f = { deploymentId: fDep, strategy: fStrategy, spot: fSpot, mode: fMode };
        for (const k of Object.keys(f)) if (f[k] && f[k] !== 'all') p[k] = f[k];
        if (fDays && fDays !== 'all') p.days = fDays;
        if (dq.trim()) p.q = dq.trim();
        if (reason !== 'all') p.reason = reason;
        return p;
    }, [history, status, fStatus, fDep, fStrategy, fSpot, fMode, fDays, page, pageSize, sort, dq, reason]);
    const key = JSON.stringify([params, nonce, refreshKey]);
    const [res, setRes] = useState({ key: null, data: null, err: null });
    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/trades/page`, { params, timeout: 30000 })
            .then((r) => { if (!dead) setRes({ key, data: r.data, err: null }); })
            .catch((e) => { if (!dead) setRes({ key, data: null, err: e?.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [key, params]);
    const fresh = res.key === key;
    const data = res.data;                 // the last answer stays on screen while the next loads
    const rows = data?.rows || [];
    const matched = data?.matched ?? 0;
    const pages = data?.pages ?? 1;

    // a new filter starts on page 1 with every row closed
    const filterSig = JSON.stringify([fDep, fStrategy, fSpot, fDays, fMode, status, dq, reason]);
    const [lastSig, setLastSig] = useState(filterSig);
    if (lastSig !== filterSig) { setLastSig(filterSig); setPage(0); setOpen(new Set()); }

    const sortBy = (k) => { setSort((s) => (s.k === k ? { k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { k, dir: 'desc' })); setPage(0); };
    const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const th = (k, label, { right = false, title } = {}) => (
        <th className={`py-1 px-1.5 font-semibold ${right ? 'text-right' : 'text-left'}`} title={title} aria-sort={sort.k === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <button type="button" onClick={() => sortBy(k)} className={`hover:text-fg-2 ${sort.k === k ? 'text-fg-2' : ''}`}>{label}{sort.k === k ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}</button>
        </th>
    );
    const who = (r) => {
        const s = r.view?.strategy || '—';
        return r.deploymentId ? depLabel(String(r.deploymentId), s) : s;
    };

    return (
        <div ref={ref} className="space-y-2" data-testid={history ? 'trade-history' : 'round-trips'}>
            <div className="flex flex-wrap items-center gap-2">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trades"
                    placeholder="Search contract, index, strategy, reason or trade id…" className={`${INPUT} w-72 max-w-full min-w-0`} />
                {history && (
                    <label className="flex items-center gap-1 text-2xs text-fg-4">Rows
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
                            {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                    </label>
                )}
                <label className="flex items-center gap-1 text-2xs text-fg-4 min-w-0 max-w-full">Exit reason
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${INPUT} min-w-0 w-full max-w-[14rem]`}>
                        <option value="all">All</option>
                        {(data?.exitReasons || []).map((x) => <option key={x.reason} value={x.reason}>{x.reason} ({x.n})</option>)}
                    </select>
                </label>
                <label className="flex items-center gap-1 text-2xs text-fg-4">Show
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className={INPUT}>
                        {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                <span className="text-2xs text-fg-5">
                    {data ? (matched === data.total ? `${matched} trade${matched === 1 ? '' : 's'}` : `${matched} of ${data.total} match`) : ''} · click a column to sort
                </span>
                <div className="ml-auto flex items-center gap-1">
                    <button type="button" className={BTN} disabled={!rows.length || rows.every((r) => open.has(r.trade_id))}
                        onClick={() => setOpen(new Set(rows.map((r) => r.trade_id)))} title="Open the path, India VIX and details of every trade on this page">Expand rows</button>
                    <button type="button" className={BTN} disabled={!open.size} onClick={() => setOpen(new Set())}>Collapse rows</button>
                    <button type="button" className={`${BTN} inline-flex items-center gap-1`} onClick={() => setNonce((x) => x + 1)} title="Refresh">
                        <RefreshCw className={`w-3 h-3 ${!fresh ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> Refresh
                    </button>
                </div>
            </div>

            {res.err && fresh && <div className="text-xs text-danger" role="alert">Could not load trades: {res.err}</div>}
            {!data && !res.err && <Spinner label="Loading trades…" />}

            {data && rows.length === 0 && <div className="text-2xs text-fg-5 py-3 text-center">{matched === 0 && data.total > 0 ? 'No trade matches the search / exit-reason filter.' : emptyText}</div>}

            {data && rows.length > 0 && !cards && (
                <div className="overflow-x-auto">
                    <table className="w-full text-2xs text-fg-3">
                        <thead><tr className="text-fg-5 text-left border-b border-line-0">
                            <th className="w-4" aria-label="Open" />
                            <th className="py-1 px-1.5 font-semibold">Trade</th>
                            {th('exit', 'Entry → Exit (IST)')}
                            {th('strategy', 'Deployment / strategy')}
                            <th className="py-1 px-1.5 font-semibold">Contract</th>
                            <th className="py-1 px-1.5 font-semibold">Mode</th>
                            <th className="py-1 px-1.5 font-semibold" title="The direction gate's verdict when this trade was entered — Allowed (side above the floor), Probe (a weak side let through on purpose as a test), Thin, Unmeasured, or Would block (shadow mode)">Gate</th>
                            {th('qty', 'Qty', { right: true })}
                            <th className="py-1 px-1.5 font-semibold text-right">Premium in → out</th>
                            {th('gross', 'Gross', { right: true, title: 'Before charges' })}
                            {th('chg', 'Chg', { right: true, title: 'Charges recorded on the trade (since 23 Sep 2026)' })}
                            {th('net', 'Net', { right: true, title: 'After charges where they were recorded; otherwise the P&L before charges, labelled so' })}
                            {th('mae', 'Worst', { right: true, title: 'Worst mark while open (pre-cost); recorded since 7 Oct 2026' })}
                            {th('mfe', 'Best', { right: true, title: 'Best mark while open (pre-cost)' })}
                            <th className="py-1 px-1.5 font-semibold">Exit reason</th>
                        </tr></thead>
                        <tbody>
                            {rows.map((r) => {
                                const id = r.trade_id;
                                const isOpen = open.has(id);
                                const v = r.view || {};
                                const k = kindChip(v.kind);
                                return (
                                    <React.Fragment key={id}>
                                        <tr className={`border-t border-line-0 hover:bg-slate-800/40 cursor-pointer align-top ${v.void ? 'opacity-60' : ''}`} onClick={() => toggle(id)}>
                                            <td className="text-fg-5 py-1">{isOpen ? '▲' : '▾'}</td>
                                            <td className="py-1 px-1.5">
                                                <span className="font-mono text-3xs text-fg-4" title={`Trade id ${id}`}>{id.slice(-6).toUpperCase()}</span>
                                                {(history || v.kind !== 'closed') && <span className="block"><Chip tone={k.tone} title={k.title}>{k.label}</Chip></span>}
                                            </td>
                                            <td className="py-1 px-1.5"><TimeCell r={r} /></td>
                                            <td className="py-1 px-1.5 max-w-[13rem]"><span className="block truncate" title={who(r)}>{who(r)}</span>
                                                {!r.deploymentId && v.kind !== 'legacy-entry' && v.kind !== 'legacy-exit' && v.kind !== 'legacy' && <span className="block text-4xs text-fg-5" title="Traded before deployments existed">symbol-config mode</span>}</td>
                                            <td className="py-1 px-1.5 whitespace-nowrap" title={shortContract(v.contract)}>
                                                {shortIndex(r.spotSymbol) || shortContract(v.contract)} <span className={v.optionType === 'CE' ? 'text-info' : 'text-warning'}>{v.optionType || ''}</span>
                                                <span className="block text-4xs text-fg-5">{v.side === 'short' ? 'sold' : 'bought'} · {shortContract(v.contract)}</span>
                                            </td>
                                            <td className="py-1 px-1.5">{v.mode ? (v.mode === 'LIVE' || v.mode === 'PAPER' ? <ModeChip mode={v.mode} /> : <Chip title="Recorded mode of an old-format row">{v.mode}</Chip>) : <span className="text-fg-5">—</span>}</td>
                                            <td className="py-1 px-1.5"><GateCell view={v} /></td>
                                            <td className="py-1 px-1.5 text-right tabular-nums">{r.quantity ?? '—'}</td>
                                            <td className="py-1 px-1.5 text-right tabular-nums whitespace-nowrap">
                                                {prem(r.entryPrice ?? (v.kind === 'legacy-entry' ? r.price : null), v.contract)} → {r.exitPrice != null ? prem(r.exitPrice, v.contract) : v.kind === 'legacy-exit' ? prem(r.price, v.contract) : '—'}
                                            </td>
                                            <td className={`py-1 px-1.5 text-right tabular-nums ${v.void ? 'line-through' : ''}`}>{money(v.gross)}</td>
                                            <td className="py-1 px-1.5 text-right tabular-nums text-fg-5" title={v.charges == null && v.kind === 'closed' ? 'No charges recorded on this trade (recorded per trade since 23 Sep 2026)' : undefined}>{money(v.charges)}</td>
                                            <td className="py-1 px-1.5 text-right"><PnlCell view={v} /></td>
                                            <td className={`py-1 px-1.5 text-right tabular-nums ${fin(r.maeRupees) < 0 ? 'text-danger' : 'text-fg-5'}`} title={fin(r.maeRupees) == null && v.kind === 'closed' ? 'No path was recorded (the engine records one since 7 Oct 2026) — open the row to rebuild it from archived quotes' : undefined}>{money(r.maeRupees)}</td>
                                            <td className={`py-1 px-1.5 text-right tabular-nums ${fin(r.mfeRupees) > 0 ? 'text-success' : 'text-fg-5'}`}>{money(r.mfeRupees)}</td>
                                            <td className="py-1 px-1.5 max-w-[14rem]"><span className="block text-fg-4 truncate" title={r.reason || ''}>{r.reason || '—'}</span><Flags flags={v.flags} /></td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="bg-slate-900/60"><td colSpan={15} className="p-2"><SingleTradeJourney trade={r} onDetails={onDetails} /></td></tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {data && rows.length > 0 && cards && (
                <ul className="space-y-2">
                    {rows.map((r) => {
                        const id = r.trade_id;
                        const isOpen = open.has(id);
                        const v = r.view || {};
                        const k = kindChip(v.kind);
                        return (
                            <li key={id} className={`border border-line/60 rounded-lg p-2 text-2xs text-fg-4 ${v.void ? 'opacity-70' : ''}`}>
                                <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className="w-full text-left space-y-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="min-w-0">
                                            <span className="font-semibold text-fg-2">{shortIndex(r.spotSymbol) || shortContract(v.contract)} {v.optionType || ''}</span>
                                            <span className="text-fg-5"> · {who(r)}</span>
                                        </span>
                                        <PnlCell view={v} />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1">
                                        <span className="font-mono text-3xs">{id.slice(-6).toUpperCase()}</span>
                                        <Chip tone={k.tone} title={k.title}>{k.label}</Chip>
                                        {v.mode && (v.mode === 'LIVE' || v.mode === 'PAPER' ? <ModeChip mode={v.mode} /> : <Chip title="Recorded mode of an old-format row">{v.mode}</Chip>)}
                                        <GateCell view={v} />
                                        <Flags flags={v.flags} />
                                    </div>
                                    <div><TimeCell r={r} /></div>
                                    <div className="flex flex-wrap gap-x-3">
                                        <span>{shortContract(v.contract)} × {r.quantity ?? '—'}</span>
                                        <span>gross {money(v.gross)} · chg {money(v.charges)}</span>
                                        <span>worst {money(r.maeRupees)} · best {money(r.mfeRupees)}</span>
                                        <span className="text-fg-3">{r.reason || '—'}</span>
                                    </div>
                                </button>
                                {isOpen && <div className="mt-2 border-t border-line-0 pt-2"><SingleTradeJourney trade={r} onDetails={onDetails} /></div>}
                            </li>
                        );
                    })}
                </ul>
            )}

            {data && pages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fg-4">
                    <span>Showing {page * (data.pageSize || pageSize) + 1}–{Math.min((page + 1) * (data.pageSize || pageSize), matched)} of {matched}</span>
                    <div className="flex items-center gap-1">
                        <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className={BTN}>‹ Prev</button>
                        <span className="px-1">Page {page + 1} of {pages}</span>
                        <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} className={BTN}>Next ›</button>
                    </div>
                </div>
            )}
        </div>
    );
}
