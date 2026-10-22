/**
 * SingleTradeJourney — one single-leg trade, opened from a round-trips row: what it
 * did minute by minute, what India VIX did while it was held, and what would have
 * happened had its stop (or other exit) not fired.
 *
 *   path      GET /api/trades/:id/journey — the engine's recorded marks (since 7-Oct-2026),
 *             else rebuilt from the 1-minute option-chain archive, else the reason why not
 *   VIX       GET /api/market/vix-days for the days it was held (1-minute bars, via Fyers)
 *   replay    GET /api/trades/:id/stop-whatif — the same contract held to its target or the
 *             time exit (backend/src/domain/analysis/singleLegNoStopReplay.js), drawn dashed
 *
 * Every piece that cannot be shown says why, in place — never an empty frame.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import TradePathChart from '../viz/TradePathChart';
import { Chip, Spinner } from '../viz/primitives';
import { inr, istDateTime, istTime, premium } from '../viz/tokens.js';
import useTradeVix from '../../hooks/useTradeVix.js';
import { vixMoveOver } from '../../utils/vixOverlay.js';
import { toPathTrade, gateChip, flagTone, shortContract } from './singleLegFormat.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50';
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const signed = (v) => inr(v, { sign: true, dp: 0 });
const tone = (v) => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-fg-3');
// premium(null) would print ₹0.00 (Number(null) is 0): absent stays a dash
const prem = (v, sym) => (fin(v) == null ? '—' : premium(v, sym));

function ReplaySummary({ d }) {
    if (!d.ok) return <div className="text-warning">Cannot replay this trade: {d.reason}.</div>;
    const eff = d.exitEffect;
    const exitWord = d.exitKind === 'stop' ? 'stop' : d.exitKind === 'target' ? 'target exit' : d.exitKind === 'time' ? 'time exit' : 'exit';
    const heldWhy = d.held.kind === 'TARGET' ? `its target (₹${d.held.target}) at ${istTime(d.held.at)}` : `the ${d.timeExit} time exit (last quote ${istTime(d.held.at)})`;
    return (
        <div className="space-y-1" data-testid="single-replay">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>Replay at its real exit ({istTime(d.atExit.at)}) <b className={tone(d.atExit.gross)}>{signed(d.atExit.gross)}</b></span>
                <span>Replay with no {exitWord} — held to {heldWhy} <b className={tone(d.held.gross)}>{signed(d.held.gross)}</b></span>
                {d.booked?.net != null && <span className="text-fg-5">Booked {signed(d.booked.net)} net ({d.booked.reason || '—'})</span>}
            </div>
            <div className={`font-semibold ${tone(eff)}`}>
                {eff > 0 ? `The ${exitWord} SAVED ${inr(eff, { dp: 0 })} against holding on.` : eff < 0 ? `The ${exitWord} COST ${inr(-eff, { dp: 0 })} against holding on.` : `Holding on would have ended the same.`}
            </div>
            <div>
                {d.afterExit.marks === 0 ? 'No quote between the real exit and where the replay closed.'
                    : d.afterExit.wentPositive
                        ? <>After the real exit it came back into profit — best <b className="text-success">{signed(d.afterExit.best)}</b> at {istTime(d.afterExit.bestAt)}; worst {signed(d.afterExit.worst)}.</>
                        : <>After the real exit it never got back above ₹0 — best {signed(d.afterExit.best)}, worst <b className="text-danger">{signed(d.afterExit.worst)}</b>.</>}
            </div>
            <div className="text-fg-5">
                Time exit {d.timeExit} — from {d.timeExitSource}. {d.marks} recorded minutes. Before charges.
            </div>
            {(d.caveats || []).map((c, i) => <div key={i} className="text-fg-5">{c}</div>)}
        </div>
    );
}

/** The trade's facts the chart does not show: gate, levels, VIX, flags. */
function Facts({ t, view, vixMove }) {
    const g = gateChip(view?.gate || (t.dir_gate ? { ...t.dir_gate } : null));
    const sl = fin(t.slPoints), tp = fin(t.tpPoints);
    const ev = t.entry_vix || {}, xv = t.exit_vix || {};
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 text-3xs text-fg-4" data-testid="trade-facts">
            <div><span className="text-fg-5">Contract </span>{shortContract(t.tradingsymbol || t.symbol)} · {t.type || '—'} · {Number(t.direction) === -1 ? 'sold' : 'bought'} {t.quantity ?? '—'}</div>
            <div><span className="text-fg-5">Entry → exit </span>{prem(t.entryPrice, t.symbol)} → {prem(t.exitPrice, t.symbol)}</div>
            <div><span className="text-fg-5">Stop / target </span>{sl != null ? `${sl.toFixed(1)} pts` : '—'} / {tp != null ? `${tp.toFixed(1)} pts` : '—'}
                {fin(t.strategyIndexSl) != null && <span title="Stop on the index level, not the premium"> · index stop {fin(t.strategyIndexSl).toFixed(0)}</span>}</div>
            <div><span className="text-fg-5">Spot </span>{fin(t.entry_spot) != null ? fin(t.entry_spot).toFixed(0) : '—'} → {fin(t.exit_spot) != null ? fin(t.exit_spot).toFixed(0) : '—'}</div>
            <div title="India VIX recorded by the engine at entry and exit (intraday reading, else the previous close)">
                <span className="text-fg-5">India VIX (recorded) </span>
                {fin(ev.intraday ?? ev.prevClose) != null ? fin(ev.intraday ?? ev.prevClose).toFixed(2) : '—'} → {fin(xv.intraday ?? xv.prevClose) != null ? fin(xv.intraday ?? xv.prevClose).toFixed(2) : '—'}
                {ev.intraday == null && ev.prevClose != null ? ' (prev close at entry)' : ''}{xv.intraday == null && xv.prevClose != null ? ' (prev close at exit)' : ''}
            </div>
            <div><span className="text-fg-5">India VIX while held </span>
                {vixMove ? <>{vixMove.from.toFixed(2)} → {vixMove.to.toFixed(2)} (<b className="text-fg-3">{vixMove.change > 0 ? '+' : ''}{vixMove.change.toFixed(2)}</b>)</> : '—'}</div>
            <div className="flex items-center gap-1 flex-wrap"><span className="text-fg-5">Gate </span>{g ? <Chip tone={g.tone} title={g.title}>{g.label}</Chip> : <span title="No direction-gate verdict was recorded on this trade (the gate journal started 2-Oct-2026, or the gate was off)">—</span>}</div>
            <div><span className="text-fg-5">AI </span>{t.ai_decision ? `${t.ai_decision}${t.ai_confidence != null ? ` (${t.ai_confidence})` : ''}` : 'not consulted'}</div>
            {t.fill_model && <div><span className="text-fg-5">Fill </span>{t.fill_model}</div>}
            {t.charges && typeof t.charges === 'object' && fin(t.charges.total) != null && (
                <div title={`Brokerage ₹${t.charges.brokerage ?? '—'} · STT ₹${t.charges.stt ?? '—'} · exchange ₹${t.charges.exchange_charges ?? '—'} · GST ₹${t.charges.gst ?? '—'} · stamp ₹${t.charges.stamp_duty ?? '—'} · SEBI ₹${t.charges.sebi ?? '—'}`}>
                    <span className="text-fg-5">Charges </span>{inr(t.charges.total)}</div>
            )}
        </div>
    );
}

export default function SingleTradeJourney({ trade: row, onDetails }) {
    const id = row?._id ? String(row._id) : row?.trade_id ? String(row.trade_id) : null;
    const [j, setJ] = useState({ id: null, data: null, err: null });
    useEffect(() => {
        if (!id) return undefined;
        let dead = false;
        axios.get(`${API_URL}/trades/${id}/journey`, { timeout: 60000 })
            .then((r) => { if (!dead) setJ({ id, data: r.data, err: null }); })
            .catch((e) => { if (!dead) setJ({ id, data: null, err: e?.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [id]);
    const [rp, setRp] = useState({ id: null, status: 'idle' });
    const replay = rp.id === id ? rp : { status: 'idle' };
    const runReplay = () => {
        setRp({ id, status: 'loading' });
        axios.get(`${API_URL}/trades/${id}/stop-whatif`, { timeout: 90000 })
            .then((r) => setRp({ id, status: 'done', data: r.data }))
            .catch((e) => setRp({ id, status: 'error', error: e?.response?.data?.error || e.message }));
    };

    const data = j.id === id ? j.data : null;
    const err = j.id === id ? j.err : null;
    const t = data?.trade || row || {};
    const entryMs = t.entryTime ? new Date(t.entryTime).getTime() : null;
    const exitMs = t.exitTime ? new Date(t.exitTime).getTime() : null;
    const vix = useTradeVix(entryMs, exitMs);
    const vixMove = useMemo(() => (vix.points && entryMs != null ? vixMoveOver(vix.points, entryMs, exitMs ?? entryMs) : null), [vix.points, entryMs, exitMs]);
    const pathTrade = useMemo(() => (data ? toPathTrade(data.trade, { pathSource: data.pathSource, pathReason: data.pathReason }) : null), [data]);
    const d = replay.status === 'done' ? replay.data : null;
    const overlays = useMemo(() => (d?.ok && d.path?.length ? [{ key: 'held', name: 'replay · held on', points: d.path, slot: 1, dashed: true }] : undefined), [d]);
    const markers = useMemo(() => (d?.ok ? [{ t: d.booked?.at, text: 'real exit' }] : undefined), [d]);
    const flags = row?.view?.flags || [];

    return (
        <div className="space-y-2" data-testid="single-journey">
            {flags.length > 0 && (
                <ul className="space-y-0.5">
                    {flags.map((f) => (
                        <li key={f.code} className="text-3xs text-fg-4 flex items-start gap-1.5"><Chip tone={flagTone(f.code)}>{f.label}</Chip><span>{f.why}</span></li>
                    ))}
                </ul>
            )}
            <Facts t={t} view={row?.view} vixMove={vixMove} />
            {err && <div className="text-3xs text-danger">Could not load this trade&apos;s path: {err}</div>}
            {!data && !err && <Spinner size="xs" label="Loading the trade's minute-by-minute path…" />}
            {pathTrade && <TradePathChart trade={pathTrade} overlays={overlays} markers={markers} vix={vix.points} />}
            {pathTrade && !vix.points && (
                <div className="text-4xs text-fg-5">{vix.loading ? 'Loading India VIX…' : `India VIX not drawn: ${vix.reason || 'not available'}.`}</div>
            )}
            <div className="text-3xs text-fg-4 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                    {t.status === 'CLOSED' && replay.status === 'idle' && (
                        <button type="button" className={BTN} onClick={runReplay}
                            title="Hold this exact contract on the recorded option chain past its real exit — to its own target, else the time exit — and compare">
                            What if the stop had not hit? (hold to target / time exit)
                        </button>
                    )}
                    {onDetails && <button type="button" className={BTN} onClick={() => onDetails(id)}>All details (AI reviews, every stored field)</button>}
                </div>
                {replay.status === 'loading' && <Spinner size="xs" label="Replaying on the recorded option chain…" />}
                {replay.status === 'error' && <div className="text-danger">Replay failed: {replay.error} <button type="button" className="ml-1 underline" onClick={runReplay}>retry</button></div>}
                {d && <ReplaySummary d={d} />}
            </div>
            {t.exitTime && (
                <div className="text-4xs text-fg-5">Entered {istDateTime(t.entryTime, { seconds: true })} · exited {istDateTime(t.exitTime, { seconds: true })} IST · {t.reason || 'no exit reason recorded'}</div>
            )}
        </div>
    );
}
