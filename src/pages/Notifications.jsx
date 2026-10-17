/**
 * Notifications — everything on the platform that needs a person.
 *
 * Simple first: "Needs attention" lists what is wrong right now, most urgent
 * first, one sentence each, with Details / Open / Acknowledge buttons. Below it:
 * recent notices (e.g. a trade the direction gate blocked), the AI health check,
 * the Telegram switches, the history, and the list of what is watched.
 * Backend: logic/services/notifications.js (+ healthMonitor, aiHealthProbe).
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { Bell, CheckCheck, History, ListChecks, Inbox } from 'lucide-react';
import { API_URL } from '../config/api.js';
import { PageHeader, Panel, Spinner, Placeholder, StatusBadge, Segmented, DataTable } from '../components/viz/primitives';
import { usePolling } from '../hooks/usePolling.js';
import { toast } from '../components/toastStore.js';
import NotificationItem from '../components/notify/NotificationItem.jsx';
import AiHealthPanel from '../components/notify/AiHealthPanel.jsx';
import TelegramSettingsPanel from '../components/notify/TelegramSettingsPanel.jsx';
import AuditPanel from '../components/notify/AuditPanel.jsx';
import { WATCHED, sevOf } from '../components/notify/notifyFormat.js';
import { refreshNotifications } from '../hooks/useNotificationSummary.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';

function useList(status, days = 30) {
    const [rows, setRows] = useState(null);
    const [err, setErr] = useState(null);
    const load = useCallback(async () => {
        try { const r = await axios.get(`${API_URL}/notifications`, { params: { status, days, limit: 200 } }); setRows(r.data.rows || []); setErr(null); }
        catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, [status, days]);
    usePolling(load, 30000);
    return { rows, err, reload: load };
}

export default function Notifications() {
    const location = useLocation();
    const open = useList('open');
    const events = useList('events', 7);
    const [histFilter, setHistFilter] = useState('resolved');
    const history = useList(histFilter === 'resolved' ? 'resolved' : 'events', 30);

    // /notifications#ai-health → scroll to that panel
    useEffect(() => {
        if (!location.hash) return;
        const t = setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
        return () => clearTimeout(t);
    }, [location.hash]);

    const ack = async (n) => {
        try {
            await axios.post(`${API_URL}/notifications/${n._id}/ack`);
            await Promise.all([open.reload(), events.reload()]);
            refreshNotifications();
        } catch (e) { toast.error(e?.response?.data?.error || e.message); }
    };
    const ackAll = async () => {
        try {
            const r = await axios.post(`${API_URL}/notifications/ack-all`);
            toast.success(`Acknowledged ${r.data.acknowledged}`);
            await Promise.all([open.reload(), events.reload()]);
            refreshNotifications();
        } catch (e) { toast.error(e?.response?.data?.error || e.message); }
    };

    const openRows = open.rows || [];
    const unreadEvents = (events.rows || []).filter((e) => !e.ackAt);
    const urgent = openRows.filter((n) => n.severity === 'critical').length;
    const needsYou = openRows.filter((n) => !n.ackAt).length + unreadEvents.filter((e) => e.severity !== 'info').length;

    return (
        <div className="p-4 sm:p-6 space-y-4 max-w-6xl">
            <PageHeader foldAll icon={Bell} title="Notifications" docs="notifications"
                subtitle="Everything on the platform that needs you — what is wrong, why, and how to fix it. Urgent problems and warnings also go to Telegram."
                badges={openRows.length ? <StatusBadge level={urgent ? 'critical' : 'warning'}>{openRows.length} open</StatusBadge> : <StatusBadge level="good">All clear</StatusBadge>}
                actions={needsYou > 0 && <button type="button" className={BTN} onClick={ackAll}><CheckCheck className="w-3 h-3" aria-hidden="true" />Acknowledge all</button>} />

            <Panel icon={Inbox} title="Needs attention" storageKey="fold:notifications|open"
                subtitle="Problems that are true right now. Each one clears by itself when the problem is fixed."
                summary={openRows.length ? `${openRows.length} open${urgent ? ` · ${urgent} urgent` : ''}` : 'All clear'}>
                {open.err && <Placeholder>Could not load notifications: {open.err}</Placeholder>}
                {!open.rows && !open.err && <Spinner label="Loading…" />}
                {open.rows && (openRows.length === 0
                    ? <p className="text-sm text-success">All clear — nothing needs you right now.</p>
                    : <ul className="space-y-2">{openRows.map((n) => <NotificationItem key={n._id} n={n} onAck={ack} />)}</ul>)}
            </Panel>

            <Panel icon={Bell} title="Recent notices" storageKey="fold:notifications|events"
                subtitle="One-off events from the last 7 days — for example a trade the direction gate blocked."
                summary={events.rows ? `${unreadEvents.length} unread of ${events.rows.length}` : null}>
                {events.err && <Placeholder>Could not load notices: {events.err}</Placeholder>}
                {!events.rows && !events.err && <Spinner label="Loading…" />}
                {events.rows && (events.rows.length === 0
                    ? <p className="text-xs text-fg-5">No notices in the last 7 days.</p>
                    : <ul className="space-y-2">{events.rows.slice(0, 50).map((n) => <NotificationItem key={n._id} n={n} onAck={ack} compact />)}</ul>)}
            </Panel>

            <AiHealthPanel />
            <AuditPanel />
            <TelegramSettingsPanel />

            <Panel icon={History} title="History" storageKey="fold:notifications|history" defaultOpen={false}
                subtitle="Problems that cleared, and older notices — the last 30 days"
                right={<Segmented value={histFilter} onChange={setHistFilter} options={[{ v: 'resolved', label: 'Resolved' }, { v: 'events', label: 'Notices' }]} />}>
                {history.err && <Placeholder>Could not load history: {history.err}</Placeholder>}
                {!history.rows && !history.err && <Spinner label="Loading…" />}
                {history.rows && (history.rows.length === 0
                    ? <p className="text-xs text-fg-5">Nothing in the last 30 days.</p>
                    : <ul className="space-y-2">{history.rows.map((n) => <NotificationItem key={n._id} n={n} compact />)}</ul>)}
            </Panel>

            <Panel icon={ListChecks} title="What the platform watches" storageKey="fold:notifications|watched" defaultOpen={false}
                subtitle="Every condition that raises a notification today">
                <DataTable dense rows={WATCHED.map((w, i) => ({ ...w, _key: i }))}
                    columns={[
                        { key: 'what', header: 'Problem', render: (w) => <span className="text-fg-2">{w.what}</span> },
                        { key: 'severity', header: 'Level', render: (w) => <StatusBadge level={sevOf(w.severity).level}>{sevOf(w.severity).label}</StatusBadge> },
                        { key: 'when', header: 'Checked', render: (w) => w.when },
                        { key: 'note', header: 'Note', render: (w) => w.note || '—' },
                    ]} />
            </Panel>
        </div>
    );
}
