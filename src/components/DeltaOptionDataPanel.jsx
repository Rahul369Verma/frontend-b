/**
 * Delta option data (27-Oct-2026) — what Delta multileg research runs on, from
 * GET /api/data/delta-options/status:
 *   CONTRACT LIST  every option Delta has listed (expiries and strikes with listing times) —
 *                  backtests take their contracts from it as of each date; refreshed daily
 *   RECORDER       minute quotes (mark, bid/ask, IV, OI) Delta does not keep for past
 *                  contracts — production only; the source for real-quote checks later
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api.js';
import DocLink from './DocLink.jsx';

const mb = (b) => (b == null ? '—' : `${(b / 1e6).toFixed(1)} MB`);
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');

export default function DeltaOptionDataPanel() {
    const [st, setSt] = useState({ data: null, err: null, loading: true });
    const fetchStatus = useCallback(() => axios.get(`${API_URL}/data/delta-options/status`, { timeout: 20000 })
        .then((r) => setSt({ data: r.data, err: null, loading: false }))
        .catch((e) => setSt({ data: null, err: e.response?.data?.error || e.message, loading: false })), []);
    useEffect(() => { fetchStatus(); }, [fetchStatus]);
    const load = () => { setSt((s) => ({ ...s, loading: true })); fetchStatus(); };
    const d = st.data;
    const rec = d?.recorder;
    return (
        <div className="bg-gray-800 p-6 rounded-xl border border-line shadow-lg mb-8" data-testid="delta-option-data">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    🟣 Delta option data <DocLink to="data-manager#delta-options" />
                    {rec && (
                        <span className={`text-2xs px-2 py-0.5 rounded border font-semibold ${rec.running ? 'border-green-600 text-success bg-green-900/25' : 'border-line-2 text-fg-4'}`}>
                            {rec.running ? '● RECORDING' : 'NOT RECORDING'}
                        </span>
                    )}
                </h2>
                <button type="button" onClick={load} disabled={st.loading} className="text-xs px-3 py-1.5 rounded border border-line text-fg-3 disabled:opacity-40">Refresh</button>
            </div>
            <p className="text-xs text-fg-4 mb-3">BTC, ETH and XAUT options on Delta Exchange India — what the Multi-Leg backtests, Optimizer and Auto use for Delta.</p>
            {st.err && <p className="text-xs text-danger">Status failed: {st.err}</p>}
            {d && (
                <div className="grid gap-4 md:grid-cols-2 text-xs">
                    <section>
                        <h3 className="font-semibold text-fg-2 mb-1">Contract list (every option ever listed)</h3>
                        {d.evidence?.ok ? (
                            <>
                                <ul className="space-y-0.5 text-fg-3">
                                    {Object.entries(d.evidence.coverage || {}).map(([u, c]) => (
                                        <li key={u}><span className="text-fg-2">{u}</span> · {c.from} → {c.to} · {c.expiries} expiries · {c.strikes} strikes</li>
                                    ))}
                                </ul>
                                <p className="text-2xs text-fg-5 mt-1">Built {when(d.evidence.builtAt)} · updated daily at 18:05 IST · {d.evidence.ageHours} h old</p>
                            </>
                        ) : <p className="text-warning">{d.evidence?.error || 'not built yet'} </p>}
                    </section>
                    <section>
                        <h3 className="font-semibold text-fg-2 mb-1">Recorder (minute quotes Delta doesn't keep)</h3>
                        {rec && !rec.running && <p className="text-fg-4 mb-1">{rec.reason || 'not started'}</p>}
                        {rec && rec.running && <p className="text-fg-4 mb-1">Every {rec.intervalSec}s near the money (±{rec.bandPct}%, expiries ≤ {rec.nearDays} days) · whole chain every {rec.fullEveryMin} min</p>}
                        {(d.coverage || []).length > 0 ? (
                            <ul className="space-y-0.5 text-fg-3">
                                {d.coverage.map((c) => (
                                    <li key={c.underlying}><span className="text-fg-2">{c.underlying}</span> · {c.snapshots} snapshots ({c.fullSnapshots} whole-chain) · {when(c.firstAt)} → {when(c.lastAt)} · ~{c.avgContracts} contracts each</li>
                                ))}
                            </ul>
                        ) : <p className="text-fg-5">Nothing recorded yet.</p>}
                        <p className="text-2xs text-fg-5 mt-1">Stored {mb(d.storage?.storageSizeBytes)} on disk ({mb(d.storage?.dataSizeBytes)} raw) · kept {d.retentionDays} days{rec?.metrics?.failures ? ` · ${rec.metrics.failures} failed passes (last: ${rec.metrics.lastError})` : ''}</p>
                    </section>
                </div>
            )}
        </div>
    );
}
