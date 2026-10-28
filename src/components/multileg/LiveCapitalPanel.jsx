/**
 * LiveCapitalPanel — the margin every LIVE multi-leg deployment needs, alone and all together,
 * against the Fyers account (user, 27-Oct-2026: "show the actually required balance for all the
 * LIVE strategies combined in the Deploy section"). Every figure is the broker's margin
 * calculator (GET /api/multileg/live-capital, backend logic/multileg/liveCapital.js). Asked when
 * the tab opens and on Refresh — never polled: each answer costs broker requests.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { RefreshCw, Wallet, ChevronUp, ChevronDown } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Panel, Spinner } from '../viz/primitives';
import { rs, stateText, togetherLine, planLine } from './liveCapitalFormat.js';

export default function LiveCapitalPanel() {
    const [st, setSt] = useState({ data: null, err: null, busy: true });
    // the answer sets the state (never a synchronous setState inside the effect); the first load starts busy
    const fetchIt = useCallback((refresh) => axios.get(`${API_URL}/multileg/live-capital`, { params: refresh ? { refresh: 1 } : {}, timeout: 45000 })
        .then((r) => setSt({ data: r.data, err: null, busy: false }))
        .catch((e) => setSt((s) => ({ ...s, err: e.response?.data?.error || e.message, busy: false }))), []);
    useEffect(() => { fetchIt(false); }, [fetchIt]);
    const load = (refresh) => { setSt((s) => ({ ...s, busy: true })); fetchIt(refresh); };
    // an answer without its fields (an older server, a proxy page) is no answer — never a crash
    const d = st.data && Array.isArray(st.data.deployments) ? st.data : null;
    const short = d && d.allTogether && d.allTogether.margin != null && d.funds && d.allTogether.margin > d.funds.total;
    // MARGIN PRIORITY (POST /api/multileg/live-priority): the rows arrive in priority order; ▲/▼ swaps two
    const [saving, setSaving] = useState(null);
    const move = (i, dir) => {
        const ids = d.deployments.map((r) => r.id);
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        setSaving({ err: null, busy: true });
        axios.post(`${API_URL}/multileg/live-priority`, { order: ids }, { timeout: 20000 })
            .then(() => { setSaving(null); load(true); })
            .catch((e) => setSaving({ err: e.response?.data?.error || e.message, busy: false }));
    };
    return (
        <Panel className="mb-4" icon={Wallet} iconClassName={short ? 'text-danger' : 'text-sky-400'} title="LIVE capital — what your LIVE strategies need"
            storageKey="fold:multi-leg|live-capital" docs="multi-leg#deploy-live-capital"
            summary={d ? togetherLine(d) : null}
            right={<button type="button" onClick={() => load(true)} disabled={st.busy} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${st.busy ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh</button>}>
            {!d && st.busy && <Spinner label="Asking the broker's margin calculator…" />}
            {st.err && <p className="text-xs text-danger">Could not read it: {st.err}</p>}
            {d && (
                <div className="space-y-2 text-xs text-fg-3" data-testid="live-capital">
                    <div>
                        Account (Fyers): {d.funds ? <>total <b>{rs(d.funds.total)}</b> · in use {rs(d.funds.utilized)} · available <b>{rs(d.funds.available)}</b></> : <span className="text-warning">balance could not be read</span>}
                    </div>
                    <div className={short ? 'text-danger font-semibold' : 'text-fg-2'}>{togetherLine(d)}</div>
                    {d.allTogether && d.allTogether.sumOfEach != null && d.allTogether.margin != null && d.allTogether.sumOfEach !== d.allTogether.margin && (
                        <div className="text-fg-5">Each one alone adds up to {rs(d.allTogether.sumOfEach)}.</div>
                    )}
                    {d.allTogether && d.allTogether.missing && d.allTogether.missing.length > 0 && (
                        <div className="text-warning">Not in that figure (could not be priced): {d.allTogether.missing.join(', ')}.</div>
                    )}
                    {d.deployments.length > 1 && (
                        <div className="text-fg-4">
                            <b>Margin priority:</b> LIVE deployments claim margin in this order. At the same entry time the first enters first; and a lower one
                            only uses margin that the higher ones still due today do not need, otherwise it <i>waits</i> until they have entered or their window has closed.
                            {saving?.err && <span className="text-danger"> Could not save the order: {saving.err}</span>}
                        </div>
                    )}
                    {d.deployments.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-2xs">
                                <thead><tr className="text-fg-5 text-left">
                                    <th className="font-normal py-1">Priority</th><th className="font-normal">LIVE deployment</th><th className="font-normal">Now</th>
                                    <th className="font-normal text-right">Margin now (broker)</th><th className="font-normal text-right">Blocked at entry</th><th className="font-normal pl-2">Note</th>
                                </tr></thead>
                                <tbody>
                                    {d.deployments.map((r, i) => (
                                        <tr key={r.id} className="border-t border-line-0">
                                            <td className="py-1 whitespace-nowrap">
                                                <span className="font-semibold text-fg-2 tabular-nums" title={r.prioritySet ? 'set by you' : 'not set: after the numbered ones, oldest first'}>#{r.priority ?? i + 1}</span>
                                                <button type="button" onClick={() => move(i, -1)} disabled={i === 0 || saving?.busy} aria-label={`Move ${r.name} up in priority`} className="ml-1 text-fg-4 hover:text-fg disabled:opacity-30"><ChevronUp className="w-3 h-3 inline" aria-hidden="true" /></button>
                                                <button type="button" onClick={() => move(i, 1)} disabled={i === d.deployments.length - 1 || saving?.busy} aria-label={`Move ${r.name} down in priority`} className="text-fg-4 hover:text-fg disabled:opacity-30"><ChevronDown className="w-3 h-3 inline" aria-hidden="true" /></button>
                                            </td>
                                            <td className="py-1 text-fg-2">{r.name} <span className="text-fg-5">· {r.structure} · {r.lots} lot{r.lots === 1 ? '' : 's'}</span></td>
                                            <td className="text-fg-4">{stateText(r)}</td>
                                            <td className="text-right tabular-nums">{r.margin == null ? <span className="text-warning">unavailable</span> : rs(r.margin)}</td>
                                            <td className="text-right tabular-nums text-fg-5">{r.blockedAtEntry == null ? '—' : rs(r.blockedAtEntry)}</td>
                                            <td className="pl-2 text-fg-5">{r.note || ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {d.stillToEnter && d.stillToEnter.plan.length > 0 && (
                        <div>
                            <div className="text-fg-4">Still to enter today, in priority order, against the {rs(d.stillToEnter.available)} available now{d.stillToEnter.margin != null ? ` (they need ${rs(d.stillToEnter.margin)})` : ''}:</div>
                            <ul className="pl-4 list-disc">
                                {d.stillToEnter.plan.map((p) => <li key={p.id} className={p.fits === false ? 'text-danger' : 'text-fg-3'}>{planLine(p)}</li>)}
                            </ul>
                            {d.stillToEnter.refused.length > 0 && (
                                <div className="text-danger">The engine will refuse {d.stillToEnter.refused.join(', ')} at entry (no order is sent) unless funds are added or another LIVE structure is closed first.</div>
                            )}
                        </div>
                    )}
                    {(d.notes || []).map((n, i) => <div key={i} className="text-fg-5">{n}</div>)}
                    <div className="text-3xs text-fg-5">As of {new Date(d.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST{d.cached ? ' (cached)' : ''} · PAPER books use no account margin and are not counted.</div>
                </div>
            )}
        </Panel>
    );
}
