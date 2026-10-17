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

export default function TelegramSettingsPanel() {
    const [s, setS] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
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
        try { const r = await axios.post(`${API_URL}/notifications/settings`, patch); setS((x) => ({ ...x, ...r0(r), telegramConfigured: x.telegramConfigured, env: x.env })); toast.success('Telegram settings saved'); }
        catch (e) { toast.error(e?.response?.data?.error || e.message); }
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
            summary={s ? (s.telegram ? `On · ${s.telegramLevels.length} level${s.telegramLevels.length === 1 ? '' : 's'} · reminders ${s.reminderHours ? `every ${s.reminderHours} h` : 'off'}` : 'Off') : null}>
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
