/**
 * VersionHistory — every saved version of a strategy or deployment, what each one changed, and
 * going back to one (user, 27-Oct-2026: "if we are updating a strategy we can see the history of
 * its updates and can go back to a previous version").
 *
 * Data: GET /api/versions/:kind/:id, POST /api/versions/:kind/:id/:version/restore (backend
 * controllers/strategyVersionsController.js). A restore is shown as a dry run first (exactly what
 * it would change, or why it is refused), then confirmed (a LIVE deployment by typing its name).
 * It never rewrites history: the restored settings become a new version, which can be undone too.
 *
 * DeletedStrategies lists deleted saved strategies (their last state is kept) and re-creates one.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { History, RotateCcw } from 'lucide-react';
import { API_URL } from '../config/api.js';
import { Modal, Spinner } from './viz/primitives';
import { istDateTime } from './viz/tokens';
import { useConfirm } from './confirmContext.js';
import { toast } from './toastStore.js';
import { changeLine, KIND_TEXT } from './versionFormat.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-line bg-slate-800 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';

export default function VersionHistory({ kind, id, name, live = false, open, onClose, onRestored }) {
    const [data, setData] = useState({ id: null, body: null, err: null });
    const [nonce, setNonce] = useState(0);
    const [plan, setPlan] = useState(null);        // { version, changes, errors, via, recreate }
    const [busy, setBusy] = useState(false);
    const confirm = useConfirm();
    const reload = useCallback(() => setNonce((n) => n + 1), []);

    useEffect(() => {
        if (!open || !id) return undefined;
        let dead = false;
        axios.get(`${API_URL}/versions/${kind}/${id}`, { timeout: 20000 })
            .then((r) => { if (!dead) setData({ id, body: r.data, err: null }); })
            .catch((e) => { if (!dead) setData({ id, body: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [open, kind, id, nonce]);

    const body = data.id === id ? data.body : null;
    const err = data.id === id ? data.err : null;
    const text = KIND_TEXT[kind] || KIND_TEXT['multileg-strategy'];

    const preview = async (version) => {
        setBusy(true);
        try {
            const r = await axios.post(`${API_URL}/versions/${kind}/${id}/${version}/restore`, { dryRun: true }, { validateStatus: (s) => s < 500 });
            setPlan({ version, changes: r.data.changes || [], errors: r.data.errors || (r.data.error ? [r.data.error] : []), via: r.data.via || null, recreate: !!r.data.recreate });
        } catch (e) {
            setPlan({ version, changes: [], errors: [e.response?.data?.error || e.message] });
        } finally { setBusy(false); }
    };

    const restore = async () => {
        if (!plan) return;
        const ok = await confirm({
            title: plan.recreate ? `Re-create “${name}” from version ${plan.version}?` : `Restore version ${plan.version} of “${name}”?`,
            body: `${plan.changes.length} change(s): ${plan.changes.slice(0, 6).map(changeLine).join('; ')}${plan.changes.length > 6 ? '; …' : ''}.${live ? ' This deployment trades LIVE.' : ''}`,
            confirmLabel: plan.recreate ? 'Re-create' : 'Restore',
            danger: live,
            requireText: live ? name : undefined,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const r = await axios.post(`${API_URL}/versions/${kind}/${id}/${plan.version}/restore`, {}, { validateStatus: (s) => s < 500 });
            if (r.data.ok) {
                toast.success(plan.recreate ? `Re-created “${name}”` : `Restored version ${plan.version} of “${name}” (${(r.data.changes || []).length} change(s))`);
                setPlan(null);
                reload();
                onRestored?.();
            } else {
                setPlan({ ...plan, errors: r.data.errors || [r.data.error || 'refused'] });
            }
        } catch (e) {
            toast.error(e.response?.data?.error || e.message);
        } finally { setBusy(false); }
    };

    const versions = body?.versions || [];
    return (
        <Modal open={open} onClose={onClose} width="max-w-2xl" docs="multi-leg#history"
            title={<span className="inline-flex items-center gap-1.5"><History className="w-4 h-4" aria-hidden="true" /> History of “{name}”</span>}>
            {!body && !err && <Spinner label="Loading its versions…" />}
            {err && <p className="text-xs text-danger">Could not load the history: {err}</p>}
            {body && (
                <div className="space-y-3 text-xs" data-testid="version-history">
                    <p className="text-fg-4">
                        Every saved change to this {text.what} is a version. Restoring one writes its settings as a NEW version, so a restore can be undone too.
                        {' '}{text.restoreNote}
                    </p>
                    {!body.exists && <p className="text-warning">This {text.what} was deleted. Its last state is kept: re-create it from the newest version.</p>}
                    {body.driftedSinceNewest && <p className="text-warning">Its stored settings differ from the newest version: they were changed outside the app since. The next change records them first.</p>}
                    {body.note && <p className="text-fg-5">{body.note}</p>}

                    {plan && (
                        <div className="rounded border border-line p-2 space-y-1 bg-slate-900/40" data-testid="restore-plan">
                            <div className="font-semibold text-fg-2">{plan.recreate ? 'Re-create' : 'Restore'} version {plan.version}{plan.via ? <span className="font-normal text-fg-5"> · via {plan.via}</span> : null}</div>
                            {plan.errors.length > 0
                                ? plan.errors.map((e, i) => <div key={i} className="text-danger">Refused: {e}</div>)
                                : plan.changes.length === 0
                                    ? <div className="text-fg-4">It already has these settings: nothing would change.</div>
                                    : (
                                        <ul className="list-disc pl-4 text-fg-3">
                                            {plan.changes.map((c) => <li key={c.key}>{changeLine(c)}{c.appliesTo ? <span className="text-fg-5"> ({c.appliesTo})</span> : null}</li>)}
                                        </ul>
                                    )}
                            <div className="flex gap-2 pt-1">
                                <button type="button" className={`${BTN} border-primary/50 text-primary-ink`} disabled={busy || plan.errors.length > 0 || plan.changes.length === 0} onClick={restore}>
                                    <RotateCcw className="w-3 h-3" aria-hidden="true" /> {plan.recreate ? 'Re-create' : `Restore version ${plan.version}`}
                                </button>
                                <button type="button" className={BTN} onClick={() => setPlan(null)}>Cancel</button>
                            </div>
                        </div>
                    )}

                    {versions.length > 0 && (
                        <ol className="space-y-2" aria-label="Versions, newest first">
                            {versions.map((v) => {
                                const isCurrent = body.currentVersion === v.version;
                                return (
                                    <li key={v.version} className="rounded border border-line-0 p-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono font-semibold text-fg-2">v{v.version}</span>
                                            <span className="text-fg-4">{istDateTime(v.at)}</span>
                                            <span className="text-fg-5">· {v.source}</span>
                                            {isCurrent && <span className="px-1.5 rounded bg-primary/15 border border-primary/40 text-primary-ink text-3xs">current</span>}
                                            {!isCurrent && (
                                                <button type="button" className={`${BTN} ml-auto`} disabled={busy} onClick={() => preview(v.version)}
                                                    aria-label={`${body.exists ? 'Restore' : 'Re-create from'} version ${v.version}`}>
                                                    <RotateCcw className="w-3 h-3" aria-hidden="true" /> {body.exists ? 'Restore…' : 'Re-create…'}
                                                </button>
                                            )}
                                        </div>
                                        {v.changes && v.changes.length > 0 && (
                                            <ul className="mt-1 pl-4 list-disc text-fg-3">
                                                {v.changes.map((c) => <li key={c.key}>{changeLine(c)}</li>)}
                                            </ul>
                                        )}
                                        {(!v.changes || v.changes.length === 0) && v.version === versions[versions.length - 1].version && (
                                            <div className="mt-1 text-fg-5">the first recorded state</div>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    )}

                    {body.earlierEdits && body.earlierEdits.length > 0 && (
                        <div className="space-y-1">
                            <div className="text-fg-4 font-semibold">Earlier edits (a log from before versions were kept; it records the changes only, so these cannot be restored)</div>
                            <ul className="pl-4 list-disc text-fg-4">
                                {body.earlierEdits.slice().reverse().map((e, i) => (
                                    <li key={i}>{istDateTime(e.at)}: {(e.changes || []).map(changeLine).join('; ')}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}

/** Deleted saved strategies (kind 'multileg-strategy' | 'single-strategy'): their history, and re-create one. */
export function DeletedStrategies({ kind, open, onClose, onRestored }) {
    const [state, setState] = useState({ list: null, err: null });
    const [pick, setPick] = useState(null);
    useEffect(() => {
        if (!open) return undefined;
        let dead = false;
        axios.get(`${API_URL}/versions/deleted/${kind}`, { timeout: 20000 })
            .then((r) => { if (!dead) setState({ list: r.data.deleted || [], err: null }); })
            .catch((e) => { if (!dead) setState({ list: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [open, kind, pick]);
    return (
        <>
            <Modal open={open && !pick} onClose={onClose} title="Deleted strategies" width="max-w-lg" docs="multi-leg#history">
                {!state.list && !state.err && <Spinner label="Loading…" />}
                {state.err && <p className="text-xs text-danger">{state.err}</p>}
                {state.list && state.list.length === 0 && <p className="text-xs text-fg-5">No deleted strategy with a recorded history. (Deletions are kept from 27-Oct-2026.)</p>}
                {state.list && state.list.length > 0 && (
                    <ul className="space-y-1 text-xs" data-testid="deleted-strategies">
                        {state.list.map((g) => (
                            <li key={g.refId} className="flex items-center gap-2">
                                <span className="text-fg-2">{g.name || g.refId}</span>
                                <span className="text-fg-5">deleted {istDateTime(g.at)}</span>
                                <button type="button" className={`${BTN} ml-auto`} onClick={() => setPick(g)}><History className="w-3 h-3" aria-hidden="true" /> History</button>
                            </li>
                        ))}
                    </ul>
                )}
            </Modal>
            {pick && (
                <VersionHistory kind={kind} id={pick.refId} name={pick.name || pick.refId} open
                    onClose={() => setPick(null)} onRestored={() => { setPick(null); onRestored?.(); }} />
            )}
        </>
    );
}
