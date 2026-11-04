/**
 * LotsDialog — set how many lots a multi-leg deployment trades (user, 4-Nov-2026: "make our
 * multileg deploy strategies multi lots and set how many lots we want for that strategy").
 *
 * Shows what the new size means BEFORE saving (GET /api/multileg/deployments/:id/size): units per
 * leg, the most lots one order can carry (the exchange freeze limit), margin against the account,
 * the go-live canary, and the ₹ limits — which are for the whole structure, so by default they
 * scale with the lots (N lots = N copies of the 1-lot strategy). Saves through the deployment
 * edit (PATCH, the engine's rule). Sizing a LIVE deployment up needs its name typed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Modal, Spinner } from '../viz/primitives';
import { inr } from '../viz/tokens';
import { API_URL } from '../../config/api.js';
import { unitsLine, freezeLine, marginLine, marginShort, sizeNotes, rupeeRows } from './lotsFormat.js';

const BTN = 'px-3 py-1.5 rounded border text-xs disabled:opacity-40';
const STEP = 'w-8 h-8 rounded border border-line-2 bg-card-2 text-fg-2 hover:text-fg disabled:opacity-40';

export default function LotsDialog({ dep, onClose, onSaved }) {
    const lots0 = Number(dep?.lots) || 1;
    const [text, setText] = useState(String(lots0));
    const [scale, setScale] = useState(true);
    const [confirm, setConfirm] = useState('');
    const [st, setSt] = useState({ info: null, err: null, busy: true });
    const [saving, setSaving] = useState(false);
    const [saveErr, setSaveErr] = useState(null);
    const want = Number(text);
    const valid = Number.isInteger(want) && want >= 1;
    const id = dep?._id;

    // what `want` lots means — asked when the number settles (no request per keystroke)
    useEffect(() => {
        if (!id || !valid) return undefined;
        let live = true;
        const t = setTimeout(() => {
            axios.get(`${API_URL}/multileg/deployments/${id}/size`, { params: { lots: want }, timeout: 20000 })
                .then((r) => { if (live) setSt({ info: r.data && typeof r.data === 'object' ? r.data : null, err: null, busy: false }); })
                .catch((e) => { if (live) setSt((s) => ({ ...s, err: e.response?.data?.error || e.message, busy: false })); });
        }, 350);
        return () => { live = false; clearTimeout(t); };
    }, [id, want, valid]);

    const s = st.info && st.info.want === want ? st.info : null;
    const max = s ? s.maxLots : (st.info ? st.info.maxLots : null);
    const rows = useMemo(() => rupeeRows(s, scale), [s, scale]);
    const changed = valid && want !== lots0;
    const needName = !!(s && s.confirmNeeded);
    const nameOk = !needName || confirm.trim() === String(dep?.name || '').trim();
    const canSave = changed && s && s.ok && nameOk && !saving;

    const save = async () => {
        setSaving(true); setSaveErr(null);
        try {
            const r = await axios.patch(`${API_URL}/multileg/deployments/${id}`, { lots: want, scaleRupees: scale, ...(needName ? { confirm } : {}) });
            onSaved?.(r.data, want);
        } catch (e) {
            const d = e.response?.data;
            setSaveErr(Array.isArray(d?.errors) && d.errors.length ? d.errors.join(' · ') : d?.error || e.message);
        } finally { setSaving(false); }
    };

    if (!dep) return null;
    return (
        <Modal open onClose={onClose} title={`Lots — ${dep.name}`} docs="multi-leg#deploy-lots" width="max-w-xl"
            footer={<>
                <button type="button" onClick={onClose} className={`${BTN} border-line-2 text-fg-3`}>Cancel</button>
                <button type="button" onClick={save} disabled={!canSave}
                    className={`${BTN} ${dep.trade_mode === 'LIVE' ? 'border-danger text-danger' : 'border-primary text-primary-ink'}`}>
                    {saving ? 'Saving…' : changed ? `Trade ${want} lot${want === 1 ? '' : 's'}` : 'No change'}
                </button>
            </>}>
            <div className="space-y-3 text-xs text-fg-3" data-testid="lots-dialog">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-fg-4">Lots per entry</span>
                    <button type="button" className={STEP} aria-label="One lot fewer" disabled={!valid || want <= 1} onClick={() => setText(String(Math.max(1, want - 1)))}>−</button>
                    <input type="number" min={1} max={max || 100} value={text} onChange={(e) => setText(e.target.value)} aria-label="Lots"
                        className="w-20 h-8 bg-slate-800 border border-line rounded-md px-2 text-sm text-fg text-center" />
                    <button type="button" className={STEP} aria-label="One lot more" disabled={!valid || (max != null && want >= max)} onClick={() => setText(String(want + 1))}>+</button>
                    <span className="text-fg-5">now {lots0} · {dep.trade_mode}</span>
                </div>
                {!valid && <p className="text-danger">Lots must be a whole number, 1 or more.</p>}
                {st.err && <p className="text-danger">Could not check this size: {st.err}</p>}
                {valid && !s && !st.err && <Spinner label="Checking this size…" />}
                {s && (
                    <>
                        {!s.ok && <p className="text-danger" role="alert">{s.reason}</p>}
                        <p>{unitsLine(s)}</p>
                        <p className="text-fg-4">{freezeLine(s)}</p>
                        <p className={marginShort(s) ? 'text-danger' : 'text-fg-4'}>{marginLine(s)}</p>
                        {rows.length > 0 && (
                            <div className="rounded border border-line p-2 space-y-1">
                                <label className="flex items-start gap-2">
                                    <input type="checkbox" className="mt-0.5" checked={scale} onChange={(e) => setScale(e.target.checked)} />
                                    <span>Scale the ₹ limits with the lots. They are for the whole structure, so scaling keeps the same loss per lot: {want} lot{want === 1 ? '' : 's'} = {want} copies of the 1-lot strategy.</span>
                                </label>
                                <table className="w-full text-2xs font-mono">
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr key={r.key}>
                                                <td className="text-fg-4 font-sans py-0.5">{r.label}</td>
                                                <td className="text-right">{inr(r.now)}</td>
                                                <td className="text-center text-fg-5">→</td>
                                                <td className={`text-right ${r.after !== r.now ? 'text-fg' : 'text-fg-4'}`}>{inr(r.after)}</td>
                                                <td className="text-right text-fg-5">{r.perLotAfter != null ? `${inr(r.perLotAfter)}/lot` : ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {!scale && changed && <p className="text-warning">Unscaled, the same ₹ amounts act at {Math.round((100 * lots0) / want)}% of today&apos;s loss per lot.</p>}
                            </div>
                        )}
                        {sizeNotes(s).map((t) => <p key={t} className="text-warning">{t}</p>)}
                        {needName && changed && (
                            <label className="block space-y-1">
                                <span className="text-danger">More lots on a LIVE deployment is more real money at stake. Type its name to confirm: <b className="font-mono">{dep.name}</b></span>
                                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the deployment name to confirm"
                                    className="w-full h-8 bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2" />
                            </label>
                        )}
                        <p className="text-3xs text-fg-5">Applies from the next entry. A PAPER twin keeps its own size; compare lots under LIVE vs PAPER twins.</p>
                    </>
                )}
                {saveErr && <p className="text-danger" role="alert">{saveErr}</p>}
            </div>
        </Modal>
    );
}
