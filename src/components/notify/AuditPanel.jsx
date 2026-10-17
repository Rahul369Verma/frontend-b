/**
 * AuditPanel — the nightly audit, run by the server every weekday at 19:30 IST.
 *
 * Simple first: when it last ran, what it found (urgent / warnings), when it runs
 * next, and a Run now button. "Findings" lists every finding of the last run;
 * "Recent runs" the last two weeks. Each urgent/warning finding is also a
 * notification above, and clears when a later run no longer finds it.
 * Backend: GET /api/audit/status, POST /api/audit/run (logic/services/auditScheduler.js).
 */
import React, { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { ClipboardCheck, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Panel, StatusBadge, Spinner, Placeholder, DataTable } from '../viz/primitives';
import { istDateTime } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import { toast } from '../toastStore.js';
import { refreshNotifications } from '../../hooks/useNotificationSummary.js';
import { auditHeadline } from './notifyFormat.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';
const SEV = { critical: { level: 'critical', label: 'Urgent' }, warn: { level: 'warning', label: 'Warning' }, info: { level: 'info', label: 'Info' } };
const TRIGGER = { schedule: '19:30 schedule', manual: 'Run now' };

export default function AuditPanel({ id = 'nightly-audit' }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [running, setRunning] = useState(false);
    const [show, setShow] = useState(null);   // 'findings' | 'runs' | null
    const waitFor = useRef(null);
    const load = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/audit/status`);
            setData(r.data); setErr(null);
            const last = r.data.last;
            if (waitFor.current && !r.data.running && last && new Date(last.at).getTime() >= waitFor.current) {
                waitFor.current = null; setRunning(false);
                if (!last.ok) toast.error(`Audit failed: ${last.error}`);
                else toast.success(`Audit done — ${auditHeadline(last)}`);
                refreshNotifications();
            }
        } catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, []);
    usePolling(load, running ? 4000 : 60000);

    const runNow = async () => {
        try {
            waitFor.current = Date.now() - 2000;
            setRunning(true);
            await axios.post(`${API_URL}/audit/run`);
        } catch (e) { waitFor.current = null; setRunning(false); toast.error(e?.response?.data?.error || e.message); }
    };

    const last = data?.last;
    const findings = last?.findings || [];
    const state = !last ? { level: 'info', text: 'Not run yet' }
        : !last.ok ? { level: 'critical', text: 'Failed' }
        : last.counts?.critical ? { level: 'critical', text: 'Urgent findings' }
        : last.counts?.warn ? { level: 'warning', text: 'Warnings' }
        : { level: 'good', text: 'All reconcile' };
    const toggle = (k) => setShow((s) => (s === k ? null : k));

    return (
        <div id={id} className="scroll-mt-4">
            <Panel icon={ClipboardCheck} title="Nightly audit" storageKey="fold:notifications|audit"
                subtitle={`The server checks expiries, spreads, charges, open books, go-live and contracts every weekday at ${data?.at || '19:30'} IST`}
                summary={last ? `${state.text} · ${istDateTime(last.at)}` : 'Not run yet'}
                right={data?.enabled !== false && (
                    <button type="button" className={BTN} onClick={runNow} disabled={running || data?.running}>
                        {running || data?.running ? <Spinner size="xs" label="Running…" /> : <><Play className="w-3 h-3" aria-hidden="true" />Run now</>}
                    </button>
                )}>
                {err && <Placeholder>Could not load the audit: {err}</Placeholder>}
                {!data && !err && <Spinner label="Loading…" />}
                {data && data.enabled === false && <p className="text-xs text-fg-5">{data.note}</p>}
                {data && data.enabled !== false && (
                    <div className="space-y-2" data-testid="audit-panel">
                        <div className="flex items-start gap-2 flex-wrap">
                            <StatusBadge level={state.level}>{state.text}</StatusBadge>
                            <p className="text-xs text-fg-3 min-w-0 flex-1">
                                {!last ? 'The first run is this evening; Run now checks immediately.'
                                    : !last.ok ? `The last run failed: ${last.error}`
                                    : `${auditHeadline(last)}${last.broker ? '' : ' (broker checks skipped — not logged in at the time)'}.`}
                            </p>
                        </div>
                        <p className="text-3xs text-fg-5">
                            {last ? `Last run ${istDateTime(last.at)} (${TRIGGER[last.trigger] || last.trigger}, ${Math.round((last.durationMs || 0) / 1000)} s)` : 'Never run'}
                            {data.nextRunAt ? ` · next ${istDateTime(data.nextRunAt)}` : ''} · urgent findings and warnings are also raised as notifications above.
                        </p>
                        <div className="flex gap-1 flex-wrap">
                            {findings.length > 0 && (
                                <button type="button" className={BTN} onClick={() => toggle('findings')} aria-expanded={show === 'findings'}>
                                    {show === 'findings' ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                                    Findings ({findings.length})
                                </button>
                            )}
                            {(data.history || []).length > 0 && (
                                <button type="button" className={BTN} onClick={() => toggle('runs')} aria-expanded={show === 'runs'}>
                                    {show === 'runs' ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                                    Recent runs ({data.history.length})
                                </button>
                            )}
                        </div>
                        {show === 'findings' && (
                            <ul className="space-y-1" data-testid="audit-findings">
                                {findings.map((f, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs">
                                        <StatusBadge level={(SEV[f.severity] || SEV.info).level}>{(SEV[f.severity] || SEV.info).label}</StatusBadge>
                                        <span className="min-w-0"><span className="text-fg-5">{f.area} · </span><span className="text-fg-3">{f.message}</span></span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {show === 'runs' && (
                            <DataTable dense rows={data.history.map((h, i) => ({ ...h, _key: `${h.at}-${i}` }))}
                                columns={[
                                    { key: 'at', header: 'When (IST)', render: (h) => istDateTime(h.at) },
                                    { key: 'trigger', header: 'Why', render: (h) => TRIGGER[h.trigger] || h.trigger },
                                    { key: 'ok', header: 'Result', render: (h) => <StatusBadge level={h.ok ? 'good' : 'critical'}>{h.ok ? 'ran' : 'failed'}</StatusBadge> },
                                    { key: 'counts', header: 'Found', render: (h) => (h.ok ? auditHeadline(h) : h.error) },
                                ]} />
                        )}
                    </div>
                )}
            </Panel>
        </div>
    );
}
