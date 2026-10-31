/**
 * Data health (31-Oct-2026) — is everything recorded, intact, backed up, and will it fit?
 * GET /api/data/health: prioritised checks (critical → warning → info, each with what to do)
 * and the storage forecast per store, for the server disk and for the off-site bucket. The
 * critical and warning checks are also platform notifications (bell + Notifications page).
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api.js';
import { Card, Chip, DataTable } from './viz/primitives';

const size = (b) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(b < 10e6 ? 1 : 0)} MB`);
const days = (d) => (d == null ? '—' : d < 1 ? 'under a day' : `${Math.round(d)} days`);
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const TONE = { critical: 'critical', warning: 'warning', info: 'neutral' };
const INK = { critical: 'text-danger', warning: 'text-warning', info: 'text-fg-2' };

const COLUMNS = [
    { key: 'label', header: 'Store', render: (r) => <span className="text-fg-2">{r.label}{r.estimated && <Chip tone="muted" className="ml-1" title="Nothing recorded yet: the middle of the 25–200 MB a session estimate">estimate</Chip>}</span> },
    { key: 'now', header: 'Now', align: 'right', render: (r) => size(r.now) },
    { key: 'perDay', header: 'Per day', align: 'right', render: (r) => size(r.perDay) },
    { key: 'kept', header: 'Kept', align: 'right', render: (r) => (r.retentionDays ? `${r.retentionDays} d` : 'forever') },
    { key: 'in30', header: 'In 30 d', align: 'right', render: (r) => size(r.in30) },
    { key: 'in90', header: '90 d', align: 'right', render: (r) => size(r.in90) },
    { key: 'in365', header: '1 year', align: 'right', render: (r) => size(r.in365) },
];

export default function DataHealthPanel() {
    const [st, setSt] = useState({ data: null, err: null, loading: true });
    const fetchHealth = useCallback((refresh = false) => axios.get(`${API_URL}/data/health`, { params: refresh ? { refresh: 1 } : {}, timeout: 60000 })
        .then((r) => setSt({ data: r.data, err: null, loading: false }))
        .catch((e) => setSt((s) => ({ ...s, err: e.response?.data?.error || e.message, loading: false }))), []);
    useEffect(() => { fetchHealth(); }, [fetchHealth]);
    const refresh = () => { setSt((s) => ({ ...s, loading: true })); fetchHealth(true); };
    const d = st.data;
    const c = d?.counts || {};
    const f = d?.forecast;
    const counts = d && (
        <span className="inline-flex gap-1 flex-wrap" data-testid="health-counts">
            {c.critical > 0 && <Chip tone="critical">{c.critical} critical</Chip>}
            {c.warning > 0 && <Chip tone="warning">{c.warning} warning{c.warning > 1 ? 's' : ''}</Chip>}
            {!c.critical && !c.warning && <Chip tone="good">all clear</Chip>}
        </span>
    );
    return (
        <div id="data-health" className="mb-8" data-testid="data-health-panel">
            <Card variant="panel" title="Data health" docs="data-manager#data-health" summary={counts}
                right={<span className="inline-flex items-center gap-2">{counts}<button type="button" onClick={refresh} disabled={st.loading} className="text-xs px-3 py-1.5 rounded border border-line text-fg-3 disabled:opacity-40">{st.loading ? 'Checking…' : 'Check now'}</button></span>}>
                <p className="text-xs text-fg-4 mb-3">Is every recorder saving, is what it saved intact, did last night's backup reach the bucket, and how long until the disk or the bucket fills? Checked every 15 minutes; critical and warning items are also on the Notifications page.</p>
                {st.err && <p className="text-xs text-danger mb-2">Health check failed: {st.err}</p>}
                {d && (
                    <>
                        <ul className="space-y-2 mb-4" data-testid="health-checks">
                            {d.checks.map((k) => (
                                <li key={k.key} className="text-xs border-b border-line-0 pb-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Chip tone={TONE[k.priority]}>{k.priority}</Chip>
                                        <span className="text-fg-5">{k.area}</span>
                                        <span className={`font-semibold ${INK[k.priority]}`}>{k.title}</span>
                                    </div>
                                    <div className="text-fg-3 mt-0.5">{k.message}</div>
                                    {k.action && <div className="text-fg-4 mt-0.5">→ {k.action}</div>}
                                </li>
                            ))}
                        </ul>
                        {f && (
                            <>
                                <h3 className="text-xs font-semibold text-fg-2 mb-1">Storage forecast</h3>
                                <DataTable dense columns={COLUMNS} rows={f.stores.map((s) => ({ ...s, _key: s.coll }))} />
                                <div className="grid gap-3 md:grid-cols-3 text-xs mt-3" data-testid="health-capacity">
                                    <section>
                                        <h4 className="font-semibold text-fg-2">Server disk</h4>
                                        {f.disk ? <p className="text-fg-3">{f.disk.usedPct}% used · {size(f.disk.free)} free of {size(f.disk.total)} · grows {size(f.disk.perDay)}/day · 90% in {days(f.disk.daysTo90)}</p> : <p className="text-fg-5">Not reported by the database.</p>}
                                    </section>
                                    <section data-testid="health-bucket">
                                        <h4 className="font-semibold text-fg-2">Off-site bucket</h4>
                                        {f.bucket.estimated
                                            ? <p className="text-fg-3">about {size(f.bucket.now)} of the free {size(f.bucket.freeBytes)} · grows {size(f.bucket.perDay)}/day · full in {days(f.bucket.daysToFree)}</p>
                                            : <p className="text-fg-3">{size(f.bucket.now)} of its {size(f.bucket.budget)} budget (Oracle's free limit is {size(f.bucket.freeBytes)}) · grows {size(f.bucket.perDay)}/day · {f.bucket.daysToBudget != null ? `budget reached in ${days(f.bucket.daysToBudget)}` : 'stays under the budget at today\'s rates'}</p>}
                                        {!f.bucket.estimated && f.bucket.windows && (
                                            <p className="text-fg-4">Kept there: {f.bucket.windows.map((w) => `${w.label} — ${w.slots ? `newest ${w.slots} ${w.per === 'session' ? 'sessions' : 'days'} (up to ${size(w.cap)})` : 'every day'}`).join(' · ')}. Older days are on the server only.</p>
                                        )}
                                        {f.bucket.heldFiles > 0 && <p className="text-danger">{f.bucket.heldFiles} day file(s) held back by the budget.</p>}
                                        {f.bucket.estimated && <p className="text-fg-5">Estimated: the backup does not report its uploads yet.</p>}
                                    </section>
                                    <section>
                                        <h4 className="font-semibold text-fg-2">Backups</h4>
                                        {f.backups.version
                                            ? <p className="text-fg-3">v{f.backups.version} · last {when(f.backups.lastAt)} · last good {when(f.backups.lastOkAt)} · nightly {size(f.backups.nightlyBytes)} · {f.backups.uploadedFiles} day files in the bucket ({size(f.backups.uploadedBytes)}){f.backups.failedFiles ? ` · ${f.backups.failedFiles} waiting to retry` : ''}</p>
                                            : <p className="text-fg-3">No run on record — the installed backup does not report to the app.</p>}
                                    </section>
                                </div>
                                <p className="text-3xs text-fg-5 mt-2">Checked {when(d.at)} ({d.ms} ms). Per day = calendar day (the session stores grow on trading days only). The disk line counts backup copies kept on the server.</p>
                            </>
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}
