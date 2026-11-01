/**
 * Live quote tape + exact replay (27-Oct-2026):
 *   TAPE           every live quote tick of the index chains, compressed per minute, kept
 *                  forever — GET /api/data/quote-tape/status
 *   DECISION LOG   the multileg engine's own loops: instants, quotes read (socket / REST), books
 *   PARITY         each night the whole multileg book is replayed exactly on the tape and every
 *                  deployment's trades compared with live — GET /api/multileg/replay-parity
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api.js';
import DocLink from './DocLink.jsx';

const mb = (b) => (b == null ? '—' : `${(b / 1e6).toFixed(1)} MB`);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const VERDICTS = [
    ['MATCH', 'text-success'], ['PRICE_ONLY', 'text-fg-3'], ['DIFFERS', 'text-warning'],
    ['MISSING_IN_REPLAY', 'text-danger'], ['EXTRA_IN_REPLAY', 'text-danger'],
];

export default function QuoteTapePanel() {
    const [st, setSt] = useState({ tape: null, parity: null, err: null, loading: true });
    const [running, setRunning] = useState(false);
    const [runMsg, setRunMsg] = useState(null);
    const fetchAll = useCallback(() => Promise.all([
        axios.get(`${API_URL}/data/quote-tape/status`, { timeout: 20000 }),
        axios.get(`${API_URL}/multileg/replay-parity`, { timeout: 20000 }),
    ]).then(([t, p]) => setSt({ tape: t.data, parity: p.data, err: null, loading: false }))
        .catch((e) => setSt((s) => ({ ...s, err: e.response?.data?.error || e.message, loading: false }))), []);
    useEffect(() => { fetchAll(); }, [fetchAll]);
    const load = () => { setSt((s) => ({ ...s, loading: true })); fetchAll(); };
    const runNow = async () => {
        setRunning(true); setRunMsg(null);
        try {
            const r = await axios.post(`${API_URL}/multileg/replay-parity/run`, {}, { timeout: 600000 });
            setRunMsg(`Checked ${r.data.results?.length || 0} deployment(s) over ${(r.data.sessions || []).join(', ') || 'no session'}${(r.data.notes || []).length ? ` — ${r.data.notes.join(' · ')}` : ''}`);
            fetchAll();
        } catch (e) { setRunMsg(`Check failed: ${e.response?.data?.error || e.message}`); }
        setRunning(false);
    };
    const rec = st.tape?.recorder;
    const log = st.tape?.loopLog;
    const parity = st.parity;
    return (
        <div className="bg-gray-800 p-6 rounded-xl border border-line shadow-lg mb-8" data-testid="quote-tape-panel">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    📼 Live quote tape <DocLink to="data-manager#quote-tape" />
                    {rec && (
                        <span className={`text-2xs px-2 py-0.5 rounded border font-semibold ${rec.recording ? 'border-green-600 text-success bg-green-900/25' : 'border-line-2 text-fg-4'}`}>
                            {rec.recording ? '● RECORDING' : 'NOT RECORDING'}
                        </span>
                    )}
                </h2>
                <button type="button" onClick={load} disabled={st.loading} className="text-xs px-3 py-1.5 rounded border border-line text-fg-3 disabled:opacity-40">Refresh</button>
            </div>
            <p className="text-xs text-fg-4 mb-3">Every live quote tick of the NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and SENSEX option chains, kept forever. Multi-Leg backtests on “Live quote tape” replay the live engine itself on it, and each night the whole book is replayed and checked against what live did.</p>
            {st.err && <p className="text-xs text-danger">Status failed: {st.err}</p>}
            {st.tape && (
                <div className="grid gap-4 md:grid-cols-2 text-xs">
                    <section>
                        <h3 className="font-semibold text-fg-2 mb-1">Tape</h3>
                        {rec && !rec.recording && <p className="text-fg-4 mb-1">{rec.reason || (rec.active ? 'starting…' : 'outside the recording window')}</p>}
                        {rec && <p className="text-fg-4 mb-1">{rec.window} · ATM ± {rec.strikes} strikes, two expiries, both rights · {num(rec.symbols)} symbols now</p>}
                        {rec?.metrics?.day && <p className="text-fg-3">Today: {num(rec.metrics.ticks)} ticks in {num(rec.metrics.chunks)} minute-chunks · {mb(rec.metrics.bytes)} compressed</p>}
                        {rec?.board?.slots > 0 && <p className="text-fg-4" data-testid="tape-board">Quote board: the latest tick of {num(rec.board.slots)} symbols, read by the multileg engine before it asks the broker{rec.board.full ? <span className="text-warning"> · board full: {num(rec.board.full)} symbol(s) priced through the broker</span> : ''}</p>}
                        {(st.tape.days || []).length > 0 ? (
                            <ul className="space-y-0.5 text-fg-3 mt-1">
                                {st.tape.days.map((d) => <li key={d._id}><span className="text-fg-2">{d._id}</span> · {num(d.ticks)} ticks · {mb(d.bytes)}{d.raw ? ` (${(d.raw / Math.max(1, d.bytes)).toFixed(1)}× compressed)` : ''}</li>)}
                            </ul>
                        ) : <p className="text-fg-5">Nothing recorded yet.</p>}
                        <p className="text-2xs text-fg-5 mt-1">
                            Stored {mb(st.tape.storage?.storageSizeBytes)} on disk · {num(st.tape.storage?.documents)} chunks
                            {rec?.metrics?.errors ? ` · ${rec.metrics.errors} error(s) (last: ${rec.metrics.lastError})` : ''}
                            {(st.tape.events || []).length ? ` · socket today: ${st.tape.events.length} event(s), last ${st.tape.events[0].kind} ${when(st.tape.events[0].at)}` : ''}
                        </p>
                        <h3 className="font-semibold text-fg-2 mt-3 mb-1">Decision log (the engine's own loops)</h3>
                        {log?.off ? <p className="text-warning">Off (MULTILEG_LOOP_LOG=false) — parity checks fall back to a 10 s grid.</p> : (
                            <p className="text-fg-3">{num(log?.documents)} minute(s) logged · {mb(log?.storageSizeBytes)} on disk · {num(log?.loops)} loops this run{log?.errors ? ` · ${log.errors} write error(s) (last: ${log.lastError})` : ''}</p>
                        )}
                    </section>
                    <section data-testid="replay-parity">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <h3 className="font-semibold text-fg-2">Live vs exact replay{parity?.day ? ` — ${parity.day}` : ''}</h3>
                            <button type="button" onClick={runNow} disabled={running} className="text-2xs px-2 py-1 rounded border border-line text-fg-3 disabled:opacity-40">{running ? 'Checking…' : 'Check today now'}</button>
                        </div>
                        {runMsg && <p className="text-2xs text-fg-4 mb-1">{runMsg}</p>}
                        {!parity?.day && <p className="text-fg-5">{parity?.note || 'No check has run yet.'}</p>}
                        {(parity?.rows || []).length > 0 && (
                            <ul className="space-y-1.5">
                                {parity.rows.map((r) => {
                                    const firstOff = (r.rows || []).find((x) => x.verdict !== 'MATCH' && x.verdict !== 'PRICE_ONLY');
                                    return (
                                        <li key={r.deploymentId} className="border-b border-line-0 pb-1">
                                            <div className="flex flex-wrap gap-x-2">
                                                <span className="text-fg-2">{r.name}</span>
                                                <span className="text-fg-5">{r.trade_mode}</span>
                                                {VERDICTS.filter(([v]) => r.counts?.[v]).map(([v, cls]) => <span key={v} className={cls}>{r.counts[v]} {v.replace(/_/g, ' ').toLowerCase()}</span>)}
                                                {!Object.keys(r.counts || {}).length && <span className="text-fg-5">no trades on either side</span>}
                                                {r.open && <span className={r.open.verdict === 'MATCH' ? 'text-success' : 'text-warning'}>open book: {r.open.verdict.replace(/_/g, ' ').toLowerCase()}</span>}
                                            </div>
                                            {firstOff && <div className="text-2xs text-warning">{firstOff.diffs.join(' · ')}</div>}
                                            {(r.notes || []).length > 0 && <div className="text-2xs text-fg-5">{r.notes.join(' · ')}</div>}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {parity?.rows?.[0]?.feed?.compared > 0 && (
                            <p className="text-2xs text-fg-5 mt-1">Tape vs the engine's own socket reads: {parity.rows[0].feed.agreePct}% identical over {num(parity.rows[0].feed.compared)} reads ({num(parity.rows[0].feed.differ)} different, {num(parity.rows[0].feed.missing)} not on the tape) · clock: {parity.rows[0].clock}</p>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
