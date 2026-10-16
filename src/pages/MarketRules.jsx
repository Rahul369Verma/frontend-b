'use strict';
/**
 * Market Rules — the lots, ticks, sessions, holidays and MCX margins the platform
 * trades by, and how each is known.
 *
 * Exchange rules change by circular. The backend (logic/services/referenceData)
 * reads NSE, Fyers, Upstox and Zerodha twice a day, reconciles every fact across
 * them, applies only what is safe, and lists SEBI / NSE circulars that can change
 * a rule. This page is where a human sees what it decided and why.
 *
 * Nothing is hidden: a fact held because sources disagree, a source that failed,
 * a source serving stale content, and every place the code's own constants
 * disagree with the market are all shown, with counts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ScrollText, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { API_URL } from '../config/api.js';
import {
    PageHeader, Card, StatRow, StatTile, DataTable, Tabs, Chip, StatusBadge,
    Spinner, EmptyState, Placeholder,
} from '../components/viz/primitives';
import DocLink from '../components/DocLink.jsx';
import { istDateTime } from '../components/viz/tokens';
import { STATUS_META, formatValue, describeKey } from '../components/marketRules/format.js';
import { toast } from '../components/toastStore.js';

const BASE = `${API_URL}/reference`;
const errText = (e) => e?.response?.data?.error || e?.message || 'request failed';

function StatusOf({ status }) {
    const m = STATUS_META[status] || { level: 'info', label: status || '—', hint: '' };
    return <StatusBadge level={m.level} title={m.hint}>{m.label}</StatusBadge>;
}

const FAMILIES = [
    { id: 'all', label: 'All' }, { id: 'margin', label: 'MCX margin' }, { id: 'lot', label: 'Lots' },
    { id: 'tick', label: 'Ticks' }, { id: 'session', label: 'Sessions' }, { id: 'holiday', label: 'Holidays' },
];
const STATUS_FILTERS = [
    { id: 'all', label: 'Any status' }, { id: 'conflict,suspicious', label: 'Held' }, { id: 'stale', label: 'Stale' },
    { id: 'single-source', label: 'One source' }, { id: 'confirmed,authoritative', label: 'Confirmed' },
];

function ago(at) {
    const t = at ? new Date(at).getTime() : NaN;
    if (!Number.isFinite(t)) return '—';
    const h = (Date.now() - t) / 3600e3;
    return h < 1 ? `${Math.max(0, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

function FactsTab() {
    const [family, setFamily] = useState('all');
    const [status, setStatus] = useState('all');
    const [q, setQ] = useState('');
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let alive = true;
        const t = setTimeout(async () => {
            setLoading(true);
            try {
                const params = { limit: 1000 };
                if (family !== 'all') params.family = family;
                if (status !== 'all') params.status = status;
                if (q.trim()) params.q = q.trim();
                const r = await axios.get(`${BASE}/facts`, { params });
                if (alive) { setData(r.data); setError(null); }
            } catch (e) { if (alive) setError(errText(e)); }
            finally { if (alive) setLoading(false); }
        }, q ? 250 : 0);
        return () => { alive = false; clearTimeout(t); };
    }, [family, status, q]);

    const rows = useMemo(() => (data?.facts || []).map(f => ({ ...f, _key: f.key })), [data]);
    const columns = [
        { key: 'what', header: 'What', render: (f) => <span className="text-fg-2" title={f.key}>{f.family} · {describeKey(f.key)}</span> },
        { key: 'value', header: 'Value', align: 'right', render: (f) => <span className="font-medium text-fg">{formatValue(f.family, f.value)}</span> },
        { key: 'status', header: 'Status', render: (f) => <StatusOf status={f.status} /> },
        {
            key: 'sources', header: 'Sources (this sync)',
            render: (f) => (
                <span className="inline-flex flex-wrap gap-1">
                    {(f.sources || []).map((s, i) => <Chip key={i} tone="muted" title={s.observedAt ? `observed ${s.observedAt}` : undefined}>{s.source} {formatValue(f.family, s.value)}</Chip>)}
                    {f.proposed != null && !Array.isArray(f.proposed) && <Chip tone="warning" title="Held value — not applied">proposed {formatValue(f.family, f.proposed)}</Chip>}
                </span>
            ),
        },
        { key: 'from', header: 'In force from', render: (f) => f.effectiveFrom || '—' },
        { key: 'checked', header: 'Last checked', render: (f) => (f.lastChecked ? ago(f.lastChecked) : '—') },
    ];

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Tabs tabs={FAMILIES} value={family} onChange={setFamily} size="sm" ariaLabel="Fact family" />
                <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"
                    className="bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {STATUS_FILTERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — e.g. GOLD, NIFTY, 2026-11"
                    aria-label="Search facts"
                    className="bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                {loading && <Spinner showLabel={false} />}
            </div>
            {error && <div className="text-xs text-danger">{error}</div>}
            {data?.total != null && (
                <div className="text-2xs text-fg-5">
                    Showing {data.shown} of {data.total}{data.shown < data.total ? ' — narrow the filter to see the rest' : ''}.
                </div>
            )}
            <DataTable columns={columns} rows={rows} dense maxHeight="60vh" empty={data ? 'No facts match this filter.' : 'Loading…'} />
        </div>
    );
}

function ChangesTab() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        axios.get(`${BASE}/changes`, { params: { limit: 300 } })
            .then(r => setRows(r.data.changes || []))
            .catch(e => setError(errText(e)));
    }, []);
    const KIND = { changed: 'info', conflict: 'critical', suspicious: 'warning', resolved: 'good' };
    const columns = [
        { key: 'at', header: 'When', render: (c) => istDateTime(c.at) },
        { key: 'kind', header: 'Kind', render: (c) => <StatusBadge level={KIND[c.kind] || 'info'}>{c.kind}</StatusBadge> },
        { key: 'what', header: 'What', render: (c) => <span title={c.key}>{c.family} · {describeKey(c.key)}</span> },
        {
            key: 'change', header: 'From → to',
            render: (c) => <span className="tabular-nums">{formatValue(c.family, c.from)} → {Array.isArray(c.to) ? c.to.map(x => `${x.source} ${formatValue(c.family, x.value)}`).join(' vs ') : formatValue(c.family, c.to)}</span>,
        },
        { key: 'eff', header: 'In force from', render: (c) => c.effectiveFrom || '—' },
        { key: 'reason', header: 'Why', render: (c) => <span className="text-fg-4 whitespace-normal">{c.reason}</span> },
    ];
    if (error) return <div className="text-xs text-danger">{error}</div>;
    if (!rows) return <Spinner />;
    return <DataTable columns={columns} rows={rows.map((c, i) => ({ ...c, _key: c._id || i }))} dense maxHeight="60vh"
        empty="No value has changed since the first sync — every fact still has its first reading." />;
}

function NoticesTab({ onReviewed }) {
    const [level, setLevel] = useState('alert');
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const load = useCallback(() => {
        axios.get(`${BASE}/notices`, { params: { level: level === 'all' ? undefined : level, limit: 300 } })
            .then(r => { setRows(r.data.notices || []); setError(null); })
            .catch(e => setError(errText(e)));
    }, [level]);
    useEffect(() => { load(); }, [load]);

    const review = async (n, reviewed) => {
        try {
            await axios.post(`${BASE}/notices/${n._id}/review`, { reviewed });
            setRows(rs => rs.map(x => (x._id === n._id ? { ...x, reviewed } : x)));
            onReviewed?.();
        } catch (e) { toast.error(errText(e)); }
    };

    return (
        <div className="space-y-3">
            <Tabs size="sm" ariaLabel="Notice level" value={level} onChange={setLevel} tabs={[
                { id: 'alert', label: 'Can change a rule', hint: 'Lots, margins, expiry, sessions, holidays, taxes and charges' },
                { id: 'related', label: 'Derivatives news' },
                { id: 'all', label: 'All' },
            ]} />
            {error && <div className="text-xs text-danger">{error}</div>}
            {!rows ? <Spinner /> : !rows.length ? <Placeholder>No circulars at this level yet.</Placeholder> : (
                <ul className="space-y-2">
                    {rows.map(n => (
                        <li key={n._id} className={`rounded border border-line/60 p-2 ${n.reviewed ? 'opacity-70' : ''}`}>
                            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-5">
                                <Chip tone={n.level === 'alert' ? 'warning' : 'neutral'}>{n.level === 'alert' ? 'rule' : 'news'}</Chip>
                                <Chip tone="muted">{String(n.source).toUpperCase()}</Chip>
                                <span>{n.date || '—'}</span>
                                {(n.matched || []).slice(0, 4).map(m => <Chip key={m} tone="muted">{m}</Chip>)}
                                {n.reviewed && <StatusBadge level="good">reviewed</StatusBadge>}
                            </div>
                            <div className="mt-1 text-xs text-fg-2 flex items-start gap-2">
                                <span className="flex-1 min-w-0">{n.title}</span>
                                {n.url && (
                                    <a href={n.url} target="_blank" rel="noreferrer noopener" className="text-primary-ink inline-flex items-center gap-1 flex-shrink-0" aria-label={`Open: ${n.title}`}>
                                        open <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                    </a>
                                )}
                                <button type="button" onClick={() => review(n, !n.reviewed)}
                                    className="flex-shrink-0 px-2 py-0.5 rounded border border-line text-2xs text-fg-4 hover:text-fg-2">
                                    {n.reviewed ? 'Undo' : 'Mark reviewed'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function RunsTab() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        axios.get(`${BASE}/runs`, { params: { limit: 60 } })
            .then(r => setRows(r.data.runs || []))
            .catch(e => setError(errText(e)));
    }, []);
    const columns = [
        { key: 'at', header: 'Started', render: (r) => istDateTime(r.startedAt) },
        { key: 'trigger', header: 'Trigger', render: (r) => <Chip tone="muted">{r.trigger}</Chip> },
        {
            key: 'sources', header: 'Sources', render: (r) => {
                const ok = (r.sources || []).filter(s => s.ok).length, all = (r.sources || []).length;
                return <StatusBadge level={ok === all ? 'good' : 'warning'} title={(r.sources || []).filter(s => !s.ok).map(s => `${s.source}: ${s.error}`).join('\n')}>{ok}/{all} ok</StatusBadge>;
            },
        },
        { key: 'facts', header: 'Facts', align: 'right', render: (r) => r.counts?.facts ?? '—' },
        { key: 'changed', header: 'Changed', align: 'right', render: (r) => r.counts?.applied ?? '—' },
        { key: 'held', header: 'Held', align: 'right', render: (r) => (r.counts ? (r.counts.conflicts || 0) + (r.counts.suspicious || 0) : '—') },
        { key: 'drift', header: 'Code ≠ market', align: 'right', render: (r) => (r.drift || []).length },
        { key: 'notices', header: 'New circulars', align: 'right', render: (r) => r.counts?.notices ?? '—' },
        { key: 'err', header: 'Error', render: (r) => (r.error ? <span className="text-danger">{r.error}</span> : '') },
    ];
    if (error) return <div className="text-xs text-danger">{error}</div>;
    if (!rows) return <Spinner />;
    return <DataTable columns={columns} rows={rows.map(r => ({ ...r, _key: r.runId }))} dense maxHeight="60vh" empty="No sync has run yet." />;
}

export default function MarketRules() {
    const [st, setSt] = useState(null);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState('facts');
    const [starting, setStarting] = useState(false);
    const [epoch, setEpoch] = useState(0);   // bumps after a sync so the tabs reload
    const wasRunning = useRef(false);

    const loadStatus = useCallback(async () => {
        try { const r = await axios.get(`${BASE}/status`); setSt(r.data); setError(null); return r.data; }
        catch (e) { setError(errText(e)); return null; }
    }, []);
    useEffect(() => { loadStatus(); }, [loadStatus]);

    // While a sync runs, poll its status; when it finishes, reload everything once.
    useEffect(() => {
        if (!st?.running) {
            if (wasRunning.current) { wasRunning.current = false; setEpoch(e => e + 1); }
            return undefined;
        }
        wasRunning.current = true;
        const t = setInterval(loadStatus, 3000);
        return () => clearInterval(t);
    }, [st?.running, loadStatus]);

    const syncNow = async (refreshCalendar) => {
        setStarting(true);
        try {
            await axios.post(`${BASE}/sync`, { refreshCalendar });
            toast.success(refreshCalendar ? 'Sync started (with contract calendar — a few minutes)' : 'Sync started');
            await loadStatus();
        } catch (e) { toast.error(errText(e)); await loadStatus(); }
        finally { setStarting(false); }
    };

    const last = st?.lastRun;
    const sources = last?.sources || [];
    const drift = last?.drift || [];
    const totals = useMemo(() => {
        const t = { total: 0, good: 0, held: 0, stale: 0, single: 0 };
        for (const f of Object.values(st?.families || {})) {
            t.total += f.total;
            t.good += (f.byStatus.confirmed || 0) + (f.byStatus.authoritative || 0);
            t.held += (f.byStatus.conflict || 0) + (f.byStatus.suspicious || 0);
            t.stale += f.byStatus.stale || 0;
            t.single += f.byStatus['single-source'] || 0;
        }
        return t;
    }, [st?.families]);
    const failed = sources.filter(s => !s.ok);
    const warnings = sources.flatMap(s => (s.warnings || []).map(w => ({ source: s.source, w })));

    return (
        <div className="p-6 space-y-4">
            <PageHeader foldAll docs="market-rules#overview"
                icon={ScrollText}
                title="Market Rules"
                subtitle="Lots, ticks, sessions, holidays and MCX margins, checked against NSE, Fyers, Upstox and Zerodha twice a day. A value is applied only when sources agree, the exchange says so, or it is the only source — anything else is held and shown here."
                actions={
                    <>
                        <button type="button" disabled={starting || st?.running} onClick={() => syncNow(false)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-medium disabled:opacity-50">
                            <RefreshCw className={`w-3.5 h-3.5 ${st?.running ? 'animate-spin' : ''}`} aria-hidden="true" />
                            {st?.running ? 'Syncing…' : 'Sync now'}
                        </button>
                        <button type="button" disabled={starting || st?.running} onClick={() => syncNow(true)}
                            title="Also rebuild the recent tail of the exchange contract calendar (expiries, lots, strike steps) from bhavcopies — a few minutes"
                            className="px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:text-fg disabled:opacity-50">
                            + contract calendar
                        </button>
                    </>
                }
            />

            {error && <EmptyState icon={AlertTriangle} title="Could not load market rules">{error}</EmptyState>}
            {!st && !error && <Spinner label="Loading…" />}
            {st?.dbDown && <EmptyState icon={AlertTriangle} title="Database not connected">Market rules are stored in MongoDB; the engine keeps using its last facts file ({st.engineFile?.facts ?? 0} facts).</EmptyState>}

            {st && !st.dbDown && (
                <>
                    <StatRow cols={5}>
                        <StatTile label="Last sync" value={last ? ago(last.startedAt) : 'never'}
                            hint={last ? `${istDateTime(last.startedAt)} · ${last.trigger}` : 'Runs at 07:45 and 18:45 IST, and 2 min after a restart'} />
                        <StatTile label="Facts" value={totals.total}
                            hint={`${totals.good} confirmed · ${totals.single} one source${totals.stale ? ` · ${totals.stale} stale` : ''}`} />
                        <StatTile label="Held" value={totals.held} tone={totals.held ? 'negative' : 'neutral'}
                            hint={totals.held ? 'sources disagree or a jump needs review' : 'no conflicts'} />
                        <StatTile label="Code ≠ market" value={drift.length} tone={drift.length ? 'negative' : 'neutral'}
                            hint={drift.length ? 'static settings disagree with confirmed facts' : 'constants agree with the market'} />
                        <StatTile label="Rule circulars to review" value={st.unreviewedAlerts ?? 0}
                            tone={st.unreviewedAlerts ? 'negative' : 'neutral'} hint="SEBI / NSE / charges pages" />
                    </StatRow>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card docs="market-rules#sources" title="Sources" subtitle={last ? `As of the last sync (${istDateTime(last.startedAt)}). MCX's and BSE's own sites refuse scripted access, so their rules come from broker feeds.` : 'No sync yet.'}
                            right={failed.length ? <StatusBadge level="critical">{failed.length} failed</StatusBadge> : last ? <StatusBadge level="good">all answered</StatusBadge> : null}>
                            {sources.length ? (
                                <DataTable dense rows={sources.map(s => ({ ...s, _key: s.source }))} columns={[
                                    { key: 'source', header: 'Source' },
                                    { key: 'ok', header: 'Status', render: (s) => (s.ok ? <StatusBadge level={s.warnings?.length ? 'warning' : 'good'}>{s.warnings?.length ? 'stale content' : 'ok'}</StatusBadge> : <StatusBadge level="critical" title={s.error}>failed</StatusBadge>) },
                                    { key: 'observations', header: 'Readings', align: 'right' },
                                    { key: 'notices', header: 'Circulars', align: 'right' },
                                    { key: 'ms', header: 'Time', align: 'right', render: (s) => (s.ms != null ? `${(s.ms / 1000).toFixed(1)} s` : '—') },
                                ]} />
                            ) : <Placeholder>Press Sync now, or wait for the 07:45 / 18:45 IST run.</Placeholder>}
                            {(failed.length > 0 || warnings.length > 0) && (
                                <ul className="mt-2 space-y-1 text-2xs">
                                    {failed.map(s => <li key={s.source} className="text-danger">{s.source}: {s.error}</li>)}
                                    {warnings.map((x, i) => <li key={i} className="text-warning">{x.source}: {x.w}</li>)}
                                </ul>
                            )}
                        </Card>

                        <Card docs="market-rules#drift" title="Where the code disagrees with the market"
                            subtitle="Static settings (INSTRUMENT_CONFIG lots, session constants, holiday lists) against confirmed facts. Holidays and MCX margins are already applied at run time from the synced facts; a lot here needs a code change.">
                            {drift.length ? (
                                <ul className="space-y-1.5">
                                    {drift.map((d, i) => (
                                        <li key={i} className="text-xs">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <StatusBadge level={d.kind === 'lot' ? 'critical' : 'warning'}>{d.kind}</StatusBadge>
                                                <span className="text-fg-2 font-medium">{d.what}</span>
                                                <span className="text-fg-4">code <b className="text-fg-2">{String(d.static)}</b> · market <b className="text-fg-2">{String(d.actual)}</b></span>
                                                <StatusOf status={d.status} />
                                            </div>
                                            {d.note && <div className="text-2xs text-fg-5 mt-0.5">{d.note}</div>}
                                        </li>
                                    ))}
                                </ul>
                            ) : <Placeholder>{last ? 'None — every lot, session and weekday holiday in the code matches the confirmed market value.' : 'Checked on every sync.'}</Placeholder>}
                        </Card>
                    </div>

                    <Card>
                        <div className="pt-3">
                            <div className="flex items-center gap-2">
                                <Tabs className="flex-1" value={tab} onChange={setTab} ariaLabel="Market rules sections" tabs={[
                                    { id: 'facts', label: 'Facts' },
                                    { id: 'changes', label: 'Changes' },
                                    { id: 'notices', label: 'Circulars', badge: st.unreviewedAlerts ? <Chip tone="warning">{st.unreviewedAlerts}</Chip> : null },
                                    { id: 'runs', label: 'Sync history' },
                                ]} />
                                <DocLink to="market-rules#tabs" label="About these tabs" />
                            </div>
                        </div>
                        <div className="pt-3" key={epoch}>
                            {tab === 'facts' && <FactsTab />}
                            {tab === 'changes' && <ChangesTab />}
                            {tab === 'notices' && <NoticesTab onReviewed={loadStatus} />}
                            {tab === 'runs' && <RunsTab />}
                        </div>
                    </Card>

                    <div className="text-2xs text-fg-5">
                        Schedule: {(st.schedule || []).map(s => `${s.label} (${s.what})`).join(' · ')}.
                        The engine reads {st.engineFile?.facts ?? 0} facts from its local file{st.engineFile?.generatedAt ? `, written ${istDateTime(st.engineFile.generatedAt)}` : ' (not written yet — the static values in the code apply)'}.
                    </div>
                </>
            )}
        </div>
    );
}
