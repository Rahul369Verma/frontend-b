/**
 * AiHealthPanel — is the AI that reviews our trades answering?
 *
 * Every 6 hours the server sends one sample review prompt per AI model the
 * deployments use (GET /api/ai/health). Simple first: one line per model —
 * working or not, why, since when. "Test now" sends the sample immediately;
 * "Details" shows every recent check.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Bot, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Panel, StatusBadge, Spinner, Placeholder, DataTable } from '../viz/primitives';
import { istDateTime } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import { toast } from '../toastStore.js';
import { timeAgo } from './notifyFormat.js';
import { refreshNotifications } from '../../hooks/useNotificationSummary.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';
const modelName = (m) => String(m || '').replace(/^claude-web\//, '').replace(/^gemini-web\//, '') + (/^(claude|gemini)-web\//.test(m || '') ? ' (web session)' : '');

function ModelRow({ m }) {
    const [open, setOpen] = useState(false);
    const last = m.last;
    const state = !last ? { level: 'info', text: 'Not checked yet' } : last.ok ? { level: 'good', text: 'Working' } : { level: 'critical', text: 'Not answering' };
    const names = (m.deployments || []).map((d) => d.name).filter(Boolean);
    return (
        <li className="rounded-lg border border-line/60 bg-card-2/30 px-3 py-2" data-testid={`ai-model-${m.model}`}>
            <div className="flex items-start gap-2 flex-wrap">
                <StatusBadge level={state.level}>{state.text}</StatusBadge>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{modelName(m.model)}</p>
                    <p className="text-xs text-fg-4">
                        {!last ? 'The first check runs a few minutes after the server starts.'
                            : last.ok ? `Answered the sample prompt in ${Math.round((last.latencyMs || 0) / 1000)} s.`
                            : last.reason}
                    </p>
                    <p className="text-3xs text-fg-5 mt-0.5">
                        {last ? `Checked ${timeAgo(last.at)}` : ''}{m.lastOkAt ? ` · last good answer ${istDateTime(m.lastOkAt)}` : last && !last.ok ? ' · no good answer on record' : ''}
                        {names.length ? ` · used by ${names.length} deployment${names.length === 1 ? '' : 's'}` : ''}
                        {m.failClosed ? ' · entries BLOCKED while it fails' : ''}
                    </p>
                </div>
                <button type="button" className={BTN} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                    {open ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                    {open ? 'Hide details' : 'Details'}
                </button>
            </div>
            {open && (
                <div className="mt-2 border-t border-line-0 pt-2 space-y-1.5">
                    {last && !last.ok && last.fix && <p className="text-xs text-fg-3"><span className="font-semibold">How to fix: </span>{last.fix}</p>}
                    {names.length > 0 && <p className="text-2xs text-fg-4">Used by: {names.join(', ')} ({[...new Set((m.deployments || []).flatMap((d) => d.features || []))].join(', ')})</p>}
                    {last && last.detail && <p className="text-3xs text-fg-5 break-all">Raw: {last.detail}</p>}
                </div>
            )}
        </li>
    );
}

export default function AiHealthPanel({ id = 'ai-health' }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [testing, setTesting] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const waitFor = useRef(null);
    const load = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/ai/health`);
            setData(r.data); setErr(null);
            if (waitFor.current && !r.data.running && r.data.lastRunAt && new Date(r.data.lastRunAt).getTime() > waitFor.current) {
                waitFor.current = null;
                setTesting(false);
                const bad = (r.data.latest || []).filter((m) => m.last && !m.last.ok).length;
                if (bad) toast.error(`AI check: ${bad} model${bad === 1 ? '' : 's'} not answering — see the reason below`);
                else toast.success('AI check: every model answered');
                refreshNotifications();
            }
        } catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, []);
    usePolling(load, testing ? 5000 : 60000);
    useEffect(() => {
        if (!testing) return undefined;
        const t = setTimeout(() => { if (waitFor.current) { waitFor.current = null; setTesting(false); toast.info('The AI check is still running — results will appear here.'); } }, 4 * 60e3);
        return () => clearTimeout(t);
    }, [testing]);

    const runNow = async () => {
        try {
            waitFor.current = Date.now() - 1000;
            setTesting(true);
            await axios.post(`${API_URL}/ai/health/run`);
            toast.info('Sending the sample prompt — about a minute (failures retry, so up to ~3 minutes).');
        } catch (e) {
            waitFor.current = null; setTesting(false);
            toast.error(e?.response?.data?.error || e.message);
        }
    };

    const bad = (data?.latest || []).filter((m) => m.last && !m.last.ok).length;
    return (
        <div id={id} className="scroll-mt-4">
            <Panel icon={Bot} title="AI health" storageKey="fold:notifications|ai-health"
                subtitle={`A sample review prompt every ${data?.intervalHours || 6} hours, per AI model your deployments use`}
                summary={data ? (data.inUse ? (bad ? `${bad} of ${data.inUse} not answering` : `${data.inUse} model${data.inUse === 1 ? '' : 's'} working`) : 'No deployment uses AI') : null}
                right={data?.enabled !== false && (
                    <button type="button" className={BTN} onClick={runNow} disabled={testing || data?.running}>
                        {testing || data?.running ? <Spinner size="xs" label="Testing…" /> : <><Play className="w-3 h-3" aria-hidden="true" />Test now</>}
                    </button>
                )}>
                {err && <Placeholder>Could not load AI health: {err}</Placeholder>}
                {!data && !err && <Spinner label="Loading AI health…" />}
                {data && data.enabled === false && <p className="text-xs text-fg-5">{data.note}</p>}
                {data && data.enabled !== false && (
                    <div className="space-y-2">
                        {!data.inUse ? (
                            <p className="text-xs text-fg-5">No active deployment has AI review or AI entry confirmation switched on, so there is nothing to check.</p>
                        ) : (
                            <ul className="space-y-2">{(data.latest || []).map((m) => <ModelRow key={m.model} m={m} />)}</ul>
                        )}
                        <p className="text-3xs text-fg-5">
                            {data.lastRunAt ? `Last check ${istDateTime(data.lastRunAt)}` : 'Not checked yet'}
                            {data.nextRunAt ? ` · next ${istDateTime(data.nextRunAt)}` : ''}
                            {' · '}a failure is also raised as a notification and sent to Telegram; a live review that fails raises it at once.
                        </p>
                        {(data.history || []).length > 0 && (
                            <div>
                                <button type="button" className={BTN} onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
                                    {showHistory ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                                    {showHistory ? 'Hide recent checks' : `Recent checks (${data.history.length})`}
                                </button>
                                {showHistory && (
                                    <div className="mt-2">
                                        <DataTable dense maxHeight={260} rows={data.history.map((h, i) => ({ ...h, _key: `${h.at}-${i}` }))}
                                            columns={[
                                                { key: 'at', header: 'When (IST)', render: (h) => istDateTime(h.at) },
                                                { key: 'model', header: 'Model', render: (h) => modelName(h.model) },
                                                { key: 'trigger', header: 'Why run', render: (h) => ({ boot: 'server start', schedule: 'every 6 h', manual: 'Test now' }[h.trigger] || h.trigger || '—') },
                                                { key: 'ok', header: 'Result', render: (h) => <StatusBadge level={h.ok ? 'good' : 'critical'}>{h.ok ? 'answered' : 'failed'}</StatusBadge> },
                                                { key: 'reason', header: 'Reason', render: (h) => (h.ok ? `${Math.round((h.latencyMs || 0) / 1000)} s` : h.reason || '—') },
                                            ]} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Panel>
        </div>
    );
}
