/**
 * ApplySingleStopDialog — put a rupee stop on single-leg deployments, priced on their
 * own trades (Live Portfolio → Single-leg → How trades travelled).
 *
 * The single-leg book's rupee stop is `max_single_trade_loss`, the rule the live engine,
 * the backtests and the optimizer share (backend/src/domain/risk/singleLegRules.js
 * capStopToMaxLoss). It is PER LOT (the user's decision, 17-Oct-2026), while the level
 * priced on the trades is per TRADE — so each deployment gets level ÷ its lots, and the
 * list shows both before anything changes.
 *
 * It only TIGHTENS: at entry, a stop wider than the cap is pulled in to it; a strategy
 * stop that is already tighter is left alone, and an open position keeps its stop.
 * POST /api/deployments/:id/max-single-loss (null removes it).
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Modal, StatusBadge } from '../viz/primitives';
import { toast } from '../toastStore.js';
import { inr } from '../viz/tokens.js';
import { lotsOf, perLotFor } from './singleLegFormat.js';

const BTN = 'px-3 py-1.5 rounded text-xs border border-line-2 bg-card-2 text-fg-3 hover:text-fg disabled:opacity-40';
const rup = (v) => inr(v, { dp: 0 });

function Row({ d, level, picked, onToggle, busy, result }) {
    const id = String(d._id);
    const cur = d.params?.max_single_trade_loss;
    const lots = lotsOf(d);
    return (
        <li className="flex items-start gap-2 py-1.5 border-t border-line/50">
            <input type="checkbox" checked={picked} onChange={() => onToggle(id)} aria-label={`Apply to ${d.name}`} className="mt-0.5" disabled={busy} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-fg-2 truncate">{d.name || d.strategyName}</span>
                    <StatusBadge level={String(d.tradeMode).toUpperCase() === 'LIVE' ? 'bad' : 'info'}>{String(d.tradeMode || 'PAPER').toUpperCase()}</StatusBadge>
                    {d.isActive === false && <span className="text-3xs text-fg-5">stopped</span>}
                </div>
                <div className="text-3xs text-fg-5">
                    {d.symbol} · {lots} lot{lots === 1 ? '' : 's'} · cap now: {cur ? `${rup(cur)} per lot` : 'not set (global setting, else ₹2,000 per lot)'}
                    {' '}→ <b className="text-fg-3">{rup(perLotFor(level, d))} per lot</b>{lots > 1 ? ` (${rup(level)} ÷ ${lots} lots)` : ''}
                </div>
                {result && <div className={`text-3xs ${result.ok ? 'text-success' : 'text-danger'}`}>{result.ok ? '✓ changed' : `✗ ${result.error}`}</div>}
            </div>
        </li>
    );
}

export default function ApplySingleStopDialog({ open, level, scopeIds = [], onClose, onApplied }) {
    const [deps, setDeps] = useState(null);
    const [err, setErr] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState(null);
    const [showOthers, setShowOthers] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        let dead = false;
        axios.get(`${API_URL}/deployments`)
            .then((r) => {
                if (dead) return;
                const list = Array.isArray(r.data) ? r.data : [];
                setDeps(list);
                setPicked(new Set(list.filter((d) => scopeIds.includes(String(d._id))).map((d) => String(d._id))));
            })
            .catch((e) => { if (!dead) setErr(e?.response?.data?.error || e.message); });
        return () => { dead = true; };
    }, [open, scopeIds]);

    const inScope = useMemo(() => (deps || []).filter((d) => scopeIds.includes(String(d._id))), [deps, scopeIds]);
    const others = useMemo(() => (deps || []).filter((d) => !scopeIds.includes(String(d._id))), [deps, scopeIds]);
    const chosen = (deps || []).filter((d) => picked.has(String(d._id)));
    const liveChosen = chosen.filter((d) => String(d.tradeMode).toUpperCase() === 'LIVE').length;
    const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const apply = async (remove) => {
        setBusy(true);
        const out = [];
        for (const d of chosen) {
            try {
                await axios.post(`${API_URL}/deployments/${d._id}/max-single-loss`, { max_single_trade_loss: remove ? null : perLotFor(level, d) });
                out.push({ id: String(d._id), ok: true });
            } catch (e) {
                out.push({ id: String(d._id), ok: false, error: e?.response?.data?.error || e.message });
            }
        }
        setBusy(false);
        setResults(out);
        const ok = out.filter((x) => x.ok).length;
        if (ok) toast.success(remove ? `Stop cap removed on ${ok} deployment${ok === 1 ? '' : 's'}` : `Stop capped at ${rup(level)} per trade on ${ok} deployment${ok === 1 ? '' : 's'} — from the next entry`);
        if (ok < out.length) toast.error(`${out.length - ok} could not be changed — see the list`);
        onApplied?.(out);
    };

    return (
        <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-xl" title={`Cap the stop at ${rup(level)} per trade`} docs="live-portfolio#excursions"
            footer={(
                <>
                    <button type="button" className={BTN} onClick={onClose} disabled={busy}>{results ? 'Close' : 'Cancel'}</button>
                    <button type="button" className={BTN} onClick={() => apply(true)} disabled={busy || !chosen.length} title="Remove the per-deployment cap (the global setting, else ₹2,000 per lot, applies)">Remove on {chosen.length}</button>
                    <button type="button" onClick={() => apply(false)} disabled={busy || !chosen.length || !(level >= 50)}
                        className="px-3 py-1.5 rounded text-xs bg-primary text-on-primary hover:opacity-90 disabled:opacity-40">
                        {busy ? 'Saving…' : `Set on ${chosen.length} deployment${chosen.length === 1 ? '' : 's'}`}
                    </button>
                </>
            )}>
            <div className="space-y-2 text-xs text-fg-3">
                <p>
                    From each ticked deployment&apos;s <b>next entry</b>, a stop-loss that would risk more than this is pulled in so that the trade risks at most
                    about <b>{rup(level)}</b> (the cap is stored per lot, so it is this level divided by the deployment&apos;s lots).
                    A strategy stop that is already tighter is left alone, and an open position keeps the stop it has.
                    The live engine, the backtests and the optimizer apply the same rule.
                </p>
                {err && <p className="text-danger" role="alert">Could not load deployments: {err}</p>}
                {!deps && !err && <p className="text-fg-5">Loading deployments…</p>}
                {deps && (
                    <>
                        <p className="text-2xs text-fg-5">Ticked: the deployments whose trades priced this level ({inScope.length}).</p>
                        <ul className="max-h-64 overflow-auto">{inScope.map((d) => <Row key={d._id} d={d} level={level} picked={picked.has(String(d._id))} onToggle={toggle} busy={busy} result={results?.find((x) => x.id === String(d._id))} />)}</ul>
                        {others.length > 0 && (
                            <div>
                                <button type="button" className="text-2xs text-primary-ink hover:underline" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                                    {showOthers ? 'Hide' : 'Show'} the other {others.length} deployment{others.length === 1 ? '' : 's'}
                                </button>
                                {showOthers && <ul className="max-h-48 overflow-auto mt-1">{others.map((d) => <Row key={d._id} d={d} level={level} picked={picked.has(String(d._id))} onToggle={toggle} busy={busy} result={results?.find((x) => x.id === String(d._id))} />)}</ul>}
                            </div>
                        )}
                        {liveChosen > 0 && <p className="text-2xs text-warning">{liveChosen} ticked deployment{liveChosen === 1 ? ' is' : 's are'} LIVE — real orders will use this stop.</p>}
                    </>
                )}
            </div>
        </Modal>
    );
}
