/**
 * TelegramSettingsPanel — which notifications also go to Telegram, and how often
 * an open problem is repeated. Backed by GET/POST /api/notifications/settings.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Send } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Panel, Spinner, Placeholder, StatusBadge } from '../viz/primitives';
import { toast } from '../toastStore.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';
const LEVELS = [
    { v: 'critical', label: 'Urgent' },
    { v: 'warning', label: 'Warnings' },
    { v: 'info', label: 'Notices (e.g. a blocked trade)' },
];
const REMIND = [0, 1, 3, 6, 12, 24];
/** A settings answer in a known shape, whatever came back (an old server answers [] or {}). */
const r0 = (r) => {
    const d = r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
    return { ...d, telegram: !!d.telegram, telegramLevels: Array.isArray(d.telegramLevels) ? d.telegramLevels : [], reminderHours: Number(d.reminderHours) || 0, resolvedToTelegram: !!d.resolvedToTelegram, telegramConfigured: !!d.telegramConfigured };
};
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');

/**
 * The urgent-alerts chat (2-Nov-2026): whether TELEGRAM_ALERTS_CHAT_ID is set, whether the last
 * urgent alert got there, the ids of chats that added the bot (to set it), and a test that says
 * where the message actually went.
 */
function AlertsChat({ a, busy, onTest, result, onRefresh }) {
    const seen = Array.isArray(a.seenChats) ? a.seenChats : [];
    const failing = a.lastErrorAt && (!a.lastOkAt || a.lastOkAt < a.lastErrorAt);
    return (
        <div className="rounded border border-line p-2 space-y-1.5" data-testid="alerts-chat">
            <div className="text-fg-2 font-medium">🚨 Urgent alerts chat</div>
            <p className="text-3xs text-fg-5">A LIVE position that needs you — an exit or unwind that failed or is stuck, a LIVE entry failed or refused (e.g. funds), a broker stop rejected or missing, the broker logged out with LIVE on — is headed &quot;🚨 ACTION NEEDED&quot;, repeated every hour until acknowledged, and sent to its own chat.</p>
            {a.configured
                ? <p className="text-success">Set: urgent alerts go to chat <span className="font-mono">{a.chatId}</span>{a.lastOkAt ? ` · last delivered ${when(a.lastOkAt)}` : ' · none sent since the server started'}.</p>
                : <p className="text-warning">Not set{a.sameAsMain ? ' (TELEGRAM_ALERTS_CHAT_ID is the main chat)' : ''}: urgent alerts go to the main chat, among the routine messages.</p>}
            {failing && <p className="text-danger">The alerts chat refused the last urgent alert at {when(a.lastErrorAt)}: {a.lastError}. It was sent to the main chat instead.</p>}
            {a.migratedTo && <p className="text-warning">The group became a supergroup; its id is now <span className="font-mono">{a.migratedTo}</span>. Set TELEGRAM_ALERTS_CHAT_ID={a.migratedTo} on the server.</p>}
            {!a.configured && (
                <ol className="list-decimal pl-4 text-3xs text-fg-4 space-y-0.5">
                    <li>In Telegram, create a group (e.g. &quot;Trading alerts&quot;) and add this bot to it.</li>
                    <li>Refresh this panel: the group appears below with its id.</li>
                    <li>On the server, add <span className="font-mono">TELEGRAM_ALERTS_CHAT_ID=&lt;that id&gt;</span> to the production secrets file and recreate the container (a restart does not re-read env files).</li>
                    <li>Send a test below.</li>
                </ol>
            )}
            {seen.length > 0 && (
                <div className="text-3xs">
                    <div className="text-fg-5">Chats that added or wrote to the bot since the server started:</div>
                    <ul className="space-y-0.5">
                        {seen.map((c) => (
                            <li key={c.id} className="break-all">
                                {c.title || '(no title)'} <span className="text-fg-5">{c.type}{c.status ? ` · bot ${c.status}` : ''}</span> — <span className="font-mono text-fg-2">{c.id}</span>
                                {String(c.id) === String(a.chatId) ? <span className="text-success"> · in use</span> : null}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
                <button type="button" className={BTN} onClick={onTest} disabled={busy}><Send className="w-3 h-3" aria-hidden="true" />Test the alerts chat</button>
                <button type="button" className={BTN} onClick={onRefresh} disabled={busy}>Refresh</button>
                {result && <span className={result.chat === 'alerts' && result.ok ? 'text-success' : 'text-warning'}>{result.ok ? `Sent — to the ${result.chat} chat.` : 'Not sent.'}{result.error ? ` ${result.error}` : ''}</span>}
            </div>
        </div>
    );
}

export default function TelegramSettingsPanel() {
    const [s, setS] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [alertTest, setAlertTest] = useState(null);
    const load = useCallback(async () => {
        try {
            const d = r0(await axios.get(`${API_URL}/notifications/settings`));
            setS(d); setErr(null);
        }
        catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const save = async (patch) => {
        setBusy(true);
        try { const r = await axios.post(`${API_URL}/notifications/settings`, patch); setS((x) => ({ ...x, ...r0(r), telegramConfigured: x.telegramConfigured, env: x.env, alerts: x.alerts })); toast.success('Telegram settings saved'); }
        catch (e) { toast.error(e?.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };
    // awaited at the server: says whether it reached the alerts chat or fell back to the main one
    const testAlerts = async () => {
        setBusy(true);
        try {
            const r = await axios.post(`${API_URL}/notifications/test-telegram`, { chat: 'alerts' });
            const d = r && r.data && typeof r.data === 'object' ? r.data : {};
            setAlertTest({ ok: !!d.ok, chat: d.chat || 'main', error: d.error || null });
            if (d.alerts) setS((x) => ({ ...x, alerts: d.alerts }));
        } catch (e) { setAlertTest({ ok: false, chat: '', error: e?.response?.data?.error || e.message }); }
        finally { setBusy(false); }
    };
    const test = async () => {
        setBusy(true);
        try { await axios.post(`${API_URL}/notifications/test-telegram`); toast.success('Test message sent — check Telegram'); }
        catch (e) { toast.error(e?.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };

    return (
        <Panel icon={Send} title="Telegram" storageKey="fold:notifications|telegram"
            subtitle="Urgent problems and warnings are also sent to your Telegram chat"
            summary={s ? (s.telegram ? `On · ${s.telegramLevels.length} level${s.telegramLevels.length === 1 ? '' : 's'} · reminders ${s.reminderHours ? `every ${s.reminderHours} h` : 'off'}${s.alerts ? (s.alerts.configured ? ' · urgent alerts: own chat' : ' · urgent alerts: main chat') : ''}` : 'Off') : null}>
            {err && <Placeholder>Could not load Telegram settings: {err}</Placeholder>}
            {!s && !err && <Spinner label="Loading…" />}
            {s && (
                <div className="space-y-3 text-xs text-fg-3">
                    {!s.telegramConfigured && <StatusBadge level="warning">Telegram is not configured on the server (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)</StatusBadge>}
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!s.telegram} disabled={busy} onChange={(e) => save({ telegram: e.target.checked })} />
                        Send notifications to Telegram
                    </label>
                    <fieldset className="space-y-1" disabled={busy || !s.telegram}>
                        <legend className="text-2xs text-fg-5 mb-1">Which ones</legend>
                        {LEVELS.map((l) => (
                            <label key={l.v} className="flex items-center gap-2">
                                <input type="checkbox" checked={s.telegramLevels.includes(l.v)}
                                    onChange={(e) => save({ telegramLevels: e.target.checked ? [...new Set([...s.telegramLevels, l.v])] : s.telegramLevels.filter((x) => x !== l.v) })} />
                                {l.label}
                            </label>
                        ))}
                    </fieldset>
                    <label className="flex items-center gap-2" >
                        Repeat an open problem every
                        <select value={s.reminderHours} disabled={busy || !s.telegram} onChange={(e) => save({ reminderHours: Number(e.target.value) })}
                            className="bg-slate-800 border border-line rounded px-1 py-0.5 text-xs text-fg-2">
                            {REMIND.map((h) => <option key={h} value={h}>{h ? `${h} h` : 'never'}</option>)}
                        </select>
                        until it is acknowledged or fixed
                    </label>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!s.resolvedToTelegram} disabled={busy || !s.telegram} onChange={(e) => save({ resolvedToTelegram: e.target.checked })} />
                        Also send "✅ resolved" when a problem clears
                    </label>
                    {s.telegramConfigured && s.alerts && typeof s.alerts === 'object' && (
                        <AlertsChat a={s.alerts} busy={busy} onTest={testAlerts} result={alertTest} onRefresh={load} />
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                        <button type="button" className={BTN} onClick={test} disabled={busy || !s.telegramConfigured}><Send className="w-3 h-3" aria-hidden="true" />Send a test message</button>
                        <span className="text-3xs text-fg-5">
                            Messages are tagged [{String(s.env || 'dev').toUpperCase()}]. Dev and production share one chat, so dev starts with Telegram off.
                        </span>
                    </div>
                </div>
            )}
        </Panel>
    );
}
