/**
 * ApplyStopDialog — put a rupee stop (Max loss ₹) on multi-leg deployments.
 *
 * Opened from Results → How trades travelled, with the level priced there. Each
 * chosen deployment gets params.max_loss_rupees through
 * POST /api/multileg/deployments/:id/max-loss; from the next check the live engine
 * closes the structure once its net mark reaches −that (logic/multileg/exitRules,
 * the same rule every backtest applies).
 *
 * Shown before anything changes: each deployment's mode (PAPER / LIVE), its current
 * rupee stop, and — for an OPEN structure — its net mark now, with a warning when it
 * is already past the level (it would close at the next check).
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Modal, StatusBadge } from '../viz/primitives';
import { toast } from '../toastStore.js';
import { rup } from './builderFormat';

const BTN = 'px-3 py-1.5 rounded text-xs border border-line-2 bg-card-2 text-fg-3 hover:text-fg disabled:opacity-40';

/** One deployment in the list: what it is, its rupee stop now, and its open structure's net mark. */
function DeploymentRow({ d, level, picked, onToggle, busy, result }) {
    const id = String(d._id);
    const cur = d.params?.max_loss_rupees;
    const openNet = d.position?.state === 'OPEN' ? Number(d.position?.lastMtmNetRupees) : null;
    const past = openNet != null && Number.isFinite(openNet) && openNet <= -level;
    return (
        <li className="flex items-start gap-2 py-1.5 border-t border-line/50">
            <input type="checkbox" checked={picked} onChange={() => onToggle(id)} aria-label={`Apply to ${d.name}`} className="mt-0.5" disabled={busy} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-fg-2 truncate">{d.name}</span>
                    <StatusBadge level={d.trade_mode === 'LIVE' ? 'bad' : 'info'}>{d.trade_mode || 'PAPER'}</StatusBadge>
                    {d.status && d.status !== 'ACTIVE' && <span className="text-3xs text-fg-5">{d.status.toLowerCase()}</span>}
                </div>
                <div className="text-3xs text-fg-5">
                    {d.symbol} · rupee stop now: {cur ? rup(cur) : 'off'}
                    {openNet != null && Number.isFinite(openNet) && <> · open structure at <span className={openNet < 0 ? 'text-danger' : 'text-success'}>{rup(openNet)}</span> net</>}
                </div>
                {past && picked && <div className="text-3xs text-warning">Already past −{rup(level)}: this structure closes at the next check.</div>}
                {result && <div className={`text-3xs ${result.ok ? 'text-success' : 'text-danger'}`}>{result.ok ? '✓ changed' : `✗ ${result.error}`}</div>}
            </div>
        </li>
    );
}

export default function ApplyStopDialog({ open, level, scopeIds = [], onClose, onApplied }) {
    const [deps, setDeps] = useState(null);
    const [err, setErr] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState(null);
    const [showOthers, setShowOthers] = useState(false);

    // Mounted only while open (the panel renders it on demand), so state starts fresh each time.
    useEffect(() => {
        if (!open) return undefined;
        let dead = false;
        axios.get(`${API_URL}/multileg/deployments`)
            .then((r) => {
                if (dead) return;
                const list = Array.isArray(r.data) ? r.data : (r.data?.deployments || []);
                setDeps(list);
                // the deployments whose trades priced this level start ticked
                setPicked(new Set(list.filter((d) => scopeIds.includes(String(d._id))).map((d) => String(d._id))));
            })
            .catch((e) => { if (!dead) setErr(e?.response?.data?.error || e.message); });
        return () => { dead = true; };
    }, [open, scopeIds]);

    const inScope = useMemo(() => (deps || []).filter((d) => scopeIds.includes(String(d._id))), [deps, scopeIds]);
    const others = useMemo(() => (deps || []).filter((d) => !scopeIds.includes(String(d._id))), [deps, scopeIds]);
    const chosen = (deps || []).filter((d) => picked.has(String(d._id)));
    const liveChosen = chosen.filter((d) => d.trade_mode === 'LIVE').length;
    const closeNow = chosen.filter((d) => d.position?.state === 'OPEN' && Number(d.position?.lastMtmNetRupees) <= -level);

    const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const apply = async (value) => {
        setBusy(true);
        const out = [];
        for (const d of chosen) {
            try {
                const r = await axios.post(`${API_URL}/multileg/deployments/${d._id}/max-loss`, { max_loss_rupees: value });
                out.push({ id: String(d._id), name: d.name, ok: true, closesAtNextCheck: r.data?.closesAtNextCheck });
            } catch (e) {
                out.push({ id: String(d._id), name: d.name, ok: false, error: e?.response?.data?.error || e.message });
            }
        }
        setBusy(false);
        setResults(out);
        const ok = out.filter((x) => x.ok).length;
        if (ok) toast.success(value == null ? `Rupee stop turned off on ${ok} deployment${ok === 1 ? '' : 's'}` : `Max loss ${rup(value)} set on ${ok} deployment${ok === 1 ? '' : 's'} — applies from the next check`);
        if (ok < out.length) toast.error(`${out.length - ok} could not be changed — see the list`);
        onApplied?.(out);
    };

    return (
        <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-xl" title={`Set a rupee stop of ${rup(level)}`} docs="multi-leg#results-tab"
            footer={(
                <>
                    <button type="button" className={BTN} onClick={onClose} disabled={busy}>{results ? 'Close' : 'Cancel'}</button>
                    <button type="button" className={BTN} onClick={() => apply(null)} disabled={busy || !chosen.length}
                        title="Remove the rupee stop from the ticked deployments">Turn off on {chosen.length}</button>
                    <button type="button" onClick={() => apply(level)} disabled={busy || !chosen.length || !(level > 0)}
                        className="px-3 py-1.5 rounded text-xs bg-primary text-on-primary hover:opacity-90 disabled:opacity-40">
                        {busy ? 'Saving…' : `Set ${rup(level)} on ${chosen.length} deployment${chosen.length === 1 ? '' : 's'}`}
                    </button>
                </>
            )}>
            <div className="space-y-2 text-xs text-fg-3">
                <p>
                    Each ticked deployment closes its whole structure once the structure&apos;s mark, <b>net of the estimated charges to close it</b>, reaches <b>−{rup(level)}</b>.
                    It applies from the next check — to new structures and to one that is open now. The live engine and every backtest use the same rule.
                </p>
                {err && <p className="text-danger" role="alert">Could not load deployments: {err}</p>}
                {!deps && !err && <p className="text-fg-5">Loading deployments…</p>}
                {deps && (
                    <>
                        <p className="text-2xs text-fg-5">Ticked: the deployments whose trades priced this level ({inScope.length}).</p>
                        <ul className="max-h-64 overflow-auto">{inScope.map((d) => <DeploymentRow key={d._id} d={d} level={level} picked={picked.has(String(d._id))} onToggle={toggle} busy={busy} result={results?.find((x) => x.id === String(d._id))} />)}</ul>
                        {others.length > 0 && (
                            <div>
                                <button type="button" className="text-2xs text-primary-ink hover:underline" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                                    {showOthers ? 'Hide' : 'Show'} the other {others.length} deployment{others.length === 1 ? '' : 's'}
                                </button>
                                {showOthers && <ul className="max-h-48 overflow-auto mt-1">{others.map((d) => <DeploymentRow key={d._id} d={d} level={level} picked={picked.has(String(d._id))} onToggle={toggle} busy={busy} result={results?.find((x) => x.id === String(d._id))} />)}</ul>}
                            </div>
                        )}
                        {liveChosen > 0 && <p className="text-2xs text-warning">{liveChosen} ticked deployment{liveChosen === 1 ? ' is' : 's are'} LIVE — real orders will close at this level.</p>}
                        {closeNow.length > 0 && <p className="text-2xs text-warning">{closeNow.length} open structure{closeNow.length === 1 ? ' is' : 's are'} already past −{rup(level)} and will close at the next check.</p>}
                    </>
                )}
            </div>
        </Modal>
    );
}
