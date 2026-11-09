import React, { useCallback, useEffect, useId, useState } from 'react';
import axios from 'axios';
import { Key, LogIn, Plus, Pencil, Trash2, CheckCircle, AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, Chip, Modal } from '../viz/primitives';
import { API_URL } from '../../config/api.js';
import { useConfirm } from '../confirmContext.js';
import DocLink from '../DocLink.jsx';
import { FIELDS, serverAddress, sessionLine } from './brokerAccountsModel.js';
import { istDateTime } from '../viz/tokens';

/**
 * Settings → Broker accounts. The ONLY place Fyers credentials are entered: they are saved in
 * the database (secrets sealed on the server with BROKER_CREDS_KEY), never read from env.
 * Several accounts can be saved; one is active and the whole platform (data feed + orders) uses
 * it. The server refuses to switch or delete the active account while a LIVE position is open.
 *
 * Secrets never come back from the server: an edit shows "saved" and an empty field keeps it.
 */

const EMPTY = Object.fromEntries(FIELDS.map((f) => [f.key, '']));
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-primary hover:bg-red-600 text-on-primary`;
const btnPlain = `${btn} bg-slate-700 hover:bg-slate-600 text-fg`;
const btnDanger = `${btn} bg-red-500/10 hover:bg-red-500/20 text-danger border border-red-500/20`;

function AccountForm({ open, mode, initial, saved, errors, busy, onCancel, onSave }) {
    // mounted fresh for each opening (keyed by the caller), so `initial` is read once
    const [values, setValues] = useState(initial);
    const uid = useId();
    const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));
    return (
        <Modal open={open} onClose={onCancel} title={mode === 'add' ? 'Add a Fyers account' : 'Edit Fyers account'} docs="settings#fyers" width="max-w-xl"
            footer={(
                <>
                    <button type="button" className={btnPlain} onClick={onCancel} disabled={busy}>Cancel</button>
                    <button type="button" className={btnPrimary} onClick={() => onSave(values)} disabled={busy}>
                        {busy ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle className="w-4 h-4" aria-hidden="true" />}
                        {mode === 'add' ? 'Save account' : 'Save changes'}
                    </button>
                </>
            )}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(values); }} autoComplete="off">
                {FIELDS.map((f) => {
                    const id = `${uid}-${f.key}`;
                    // secrets and the (masked) client id are not sent back: empty keeps the saved value
                    const keepHint = mode === 'edit' && ((f.secret && saved?.[f.key]) || f.key === 'clientId');
                    return (
                        <div key={f.key}>
                            <label htmlFor={id} className="block text-sm font-medium text-fg-4 mb-1">{f.label}</label>
                            <input id={id} name={`broker-${f.key}`} value={values[f.key]} onChange={set(f.key)}
                                type={f.secret ? 'password' : 'text'} inputMode={f.inputMode}
                                // new-password: never let the browser fill the site password into a PIN
                                autoComplete={f.secret ? 'new-password' : 'off'} spellCheck={false}
                                placeholder={keepHint ? 'saved — leave empty to keep' : ''}
                                aria-invalid={!!errors?.[f.key]} aria-describedby={`${id}-help`}
                                className={`w-full bg-slate-800 text-fg border rounded px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary ${errors?.[f.key] ? 'border-danger' : 'border-line-2'}`} />
                            <p id={`${id}-help`} className={`text-xs mt-1 ${errors?.[f.key] ? 'text-danger' : 'text-fg-5'}`}>{errors?.[f.key] || f.help}</p>
                            {f.key === 'redirectUrl' && <p className="text-xs text-fg-4 mt-0.5">This server: <span className="font-mono break-all">{serverAddress()}</span></p>}
                        </div>
                    );
                })}
                <p className="text-xs text-fg-5">The secret key, PIN and TOTP key are encrypted on the server and are never shown again.</p>
            </form>
        </Modal>
    );
}

export default function BrokerAccounts({ onMessage }) {
    const confirm = useConfirm();
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [form, setForm] = useState(null);   // { mode, id, initial, saved, errors }

    const load = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/broker-accounts`);
            setData(r.data);
            setLoadError(null);
        } catch (e) {
            setLoadError(e.response?.data?.error || e.message);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const say = (type, text) => onMessage?.({ type, text });

    const act = async (key, request, done) => {
        setBusy(key);
        try {
            const r = await request();
            if (r.data?.accounts) setData((d) => ({ ...(d || {}), accounts: r.data.accounts, session: r.data.session || d?.session }));
            done?.(r.data);
            load();
            return true;
        } catch (e) {
            const d = e.response?.data || {};
            if (d.accounts) setData((x) => ({ ...(x || {}), accounts: d.accounts, session: d.session || x?.session }));
            if (d.fields) setForm((f) => (f ? { ...f, errors: d.fields } : f));
            say('error', d.error || e.message);
            return false;
        } finally {
            setBusy(null);
        }
    };

    const loginResult = (session, label) => (session?.authenticated
        ? say('success', `"${label}" is logged in.`)
        : say('error', `"${label}" is saved but did not log in — the card says why.`));

    const save = (values) => {
        if (form.mode === 'add') {
            return act('save', () => axios.post(`${API_URL}/broker-accounts`, values), (d) => {
                setForm(null);
                if (d.becameActive) loginResult(d.session, d.account.label);
                else say('success', `"${d.account.label}" saved. Make it active to use it.`);
            });
        }
        // an edit sends only what changed; an empty secret keeps the saved one
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== form.initial[k] && !(v === '' && FIELDS.find((f) => f.key === k)?.secret)));
        if (!Object.keys(changed).length) { setForm(null); return Promise.resolve(); }
        return act('save', () => axios.put(`${API_URL}/broker-accounts/${form.id}`, changed), (d) => {
            setForm(null);
            if (d.loginChanged) loginResult(d.session, d.account.label);
            else say('success', `"${d.account.label}" saved.`);
        });
    };

    const activate = async (a) => {
        if (!await confirm({ title: 'Switch the Fyers account', body: `Make "${a.label}" the active account? The data feed and every order move to it. The current account's session stops being used.`, confirmLabel: 'Make active' })) return;
        act(`${a.id}:activate`, () => axios.post(`${API_URL}/broker-accounts/${a.id}/activate`), (d) => loginResult(d.session, a.label));
    };
    const login = (a) => act(`${a.id}:login`, () => axios.post(`${API_URL}/broker-accounts/${a.id}/login`), (d) => loginResult(d.session, a.label));
    const browserLogin = async () => {
        try {
            const r = await axios.get(`${API_URL}/auth/fyers/url`);
            window.location.href = r.data.url;
        } catch (e) {
            say('error', e.response?.data?.error || 'Could not get the Fyers login page.');
        }
    };
    const remove = async (a) => {
        const body = a.active
            ? `Delete "${a.label}"? It is the ACTIVE account: the platform will have no Fyers session until another account is made active.`
            : `Delete "${a.label}" and its saved token?`;
        if (!await confirm({ title: 'Delete Fyers account', body, danger: true, confirmLabel: 'Delete account' })) return;
        act(`${a.id}:delete`, () => axios.delete(`${API_URL}/broker-accounts/${a.id}`), () => say('success', `"${a.label}" deleted.`));
    };

    const accounts = data?.accounts || [];
    const liveOpen = data?.liveOpen?.total || 0;
    const keyOk = data?.key ? data.key.ok : true;

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-bold text-fg flex items-center gap-2">
                <div className="w-2 h-8 bg-blue-500 rounded-full" />
                Fyers broker accounts
                <DocLink to="settings#fyers" />
            </h2>
            <p className="text-sm text-fg-4">
                Fyers logins are set up here only — never in env files. Save one or more accounts; the <strong>active</strong> one is what the whole platform uses for prices and orders.
            </p>

            {!keyOk && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 text-danger border border-red-500/20 text-sm flex gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span>{data.key.message} Accounts cannot be saved or logged in until the server has it.</span>
                </div>
            )}
            {loadError && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 text-danger border border-red-500/20 text-sm">Could not load the accounts: {loadError}</div>
            )}
            {liveOpen > 0 && (
                <p className="text-xs text-warning">{liveOpen} LIVE position{liveOpen === 1 ? ' is' : 's are'} open on Fyers — the active account cannot be switched or deleted until {liveOpen === 1 ? 'it closes' : 'they close'}.</p>
            )}

            {data && !accounts.length && (
                <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-fg-3">
                    No Fyers account yet. The platform has no prices or orders until you add one.
                </div>
            )}

            <ul className="space-y-3" aria-label="Fyers accounts">
                {accounts.map((a) => {
                    const s = sessionLine(a, data?.session);
                    const b = (k) => busy === `${a.id}:${k}`;
                    return (
                        <li key={a.id} className={`p-4 rounded-lg border ${a.active ? 'border-primary/40 bg-slate-900/60' : 'border-line bg-slate-900/30'}`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-fg font-semibold">{a.label}</span>
                                {a.active ? <Chip tone="live">Active</Chip> : <Chip tone="muted">Saved</Chip>}
                                <Chip tone={s.tone}>{s.text}</Chip>
                            </div>
                            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                                <dt className="text-fg-5">Client ID</dt><dd className="font-mono text-fg-3">{a.clientId}</dd>
                                <dt className="text-fg-5">App ID</dt><dd className="font-mono text-fg-3 break-all">{a.appId}</dd>
                                <dt className="text-fg-5">Redirect URL</dt><dd className="font-mono text-fg-3 break-all">{a.redirectUrl}</dd>
                                <dt className="text-fg-5">Last login</dt>
                                <dd className={a.lastLoginOk === false ? 'text-danger' : 'text-fg-3'}>
                                    {a.lastLoginAt ? `${istDateTime(a.lastLoginAt)} — ${a.lastLoginOk ? 'worked' : `failed: ${a.lastLoginError || 'see the server log'}`}` : 'never'}
                                </dd>
                            </dl>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {a.active ? (
                                    <>
                                        <button type="button" className={btnPrimary} onClick={() => login(a)} disabled={!!busy || !keyOk}
                                            title="Log in now with the saved PIN and TOTP key (10–15 s)">
                                            <RefreshCw className={`w-4 h-4 ${b('login') ? 'animate-spin' : ''}`} aria-hidden="true" />Log in now
                                        </button>
                                        <button type="button" className={btnPlain} onClick={browserLogin} disabled={!!busy || !keyOk}
                                            title="Log in on the Fyers website instead (needs the redirect URL to point at this server)">
                                            <ExternalLink className="w-4 h-4" aria-hidden="true" />Browser login
                                        </button>
                                    </>
                                ) : (
                                    <button type="button" className={btnPrimary} onClick={() => activate(a)} disabled={!!busy || !keyOk || liveOpen > 0}
                                        title={liveOpen > 0 ? 'Close the open LIVE positions first' : 'Use this account for prices and orders'}>
                                        <LogIn className={`w-4 h-4 ${b('activate') ? 'animate-pulse' : ''}`} aria-hidden="true" />Make active
                                    </button>
                                )}
                                <button type="button" className={btnPlain} disabled={!!busy || !keyOk}
                                    onClick={() => setForm({ mode: 'edit', id: a.id, initial: { ...EMPTY, label: a.label, appId: a.appId, redirectUrl: a.redirectUrl, clientId: '' }, saved: a.saved, errors: null })}>
                                    <Pencil className="w-4 h-4" aria-hidden="true" />Edit
                                </button>
                                <button type="button" className={btnDanger} onClick={() => remove(a)} disabled={!!busy || (a.active && liveOpen > 0)}
                                    title={a.active && liveOpen > 0 ? 'Close the open LIVE positions first' : undefined}>
                                    <Trash2 className="w-4 h-4" aria-hidden="true" />Delete
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>

            <button type="button" className={btnPrimary} disabled={!!busy || !keyOk}
                onClick={() => setForm({ mode: 'add', id: null, initial: { ...EMPTY, redirectUrl: serverAddress() }, saved: null, errors: null })}>
                <Plus className="w-4 h-4" aria-hidden="true" />Add Fyers account
            </button>

            <Card title="How to add a Fyers account" icon={Key} defaultOpen={!accounts.length} storageKey="settings-broker-steps" docs="settings#fyers">
                <ol className="list-decimal pl-5 space-y-2 text-sm text-fg-3">
                    <li><strong>Create an API app.</strong> Log in to the Fyers API dashboard (<span className="font-mono">myapi.fyers.in</span>) with the account → Create app. Set its redirect URL to this server: <span className="font-mono break-all">{serverAddress()}</span>. Copy the <strong>App ID</strong> and <strong>Secret key</strong>.</li>
                    <li><strong>Turn on External 2FA TOTP</strong> in the Fyers account's security settings. Fyers shows a QR code and a text key: copy the <strong>text key</strong> (that is the TOTP key), and add it to your authenticator app too.</li>
                    <li><strong>Whitelist this server's IP</strong> on the Fyers app (for production: <span className="font-mono">140.245.27.120</span>). Fyers refuses orders from any other address.</li>
                    <li><strong>Add it here:</strong> Add Fyers account → fill every field → Save account. The first account becomes active and logs in straight away; the card shows whether the login worked and, if not, which step failed.</li>
                    <li><strong>To switch accounts</strong>, close all LIVE positions, then press <em>Make active</em> on the other account. Prices and orders move to it within seconds.</li>
                    <li><strong>One server per Fyers account.</strong> Two servers (prod, dev, the optimizer box) logged in with the same account keep logging each other out. Give each server its own account.</li>
                </ol>
            </Card>

            {form && (
                <AccountForm key={`${form.mode}:${form.id || 'new'}`} open mode={form.mode} initial={form.initial} saved={form.saved} errors={form.errors} busy={busy === 'save'}
                    onCancel={() => setForm(null)} onSave={save} />
            )}
        </div>
    );
}
