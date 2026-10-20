/**
 * StopReplay — "what did the stops do on these trades?", on the recorded option chain.
 *
 *   TradeStopReplay  one round trip: its path, plus the replay with its stops and the replay
 *                    with NO stops drawn over it; did the stops save or cost money, and did
 *                    the trade come back after the first stop?
 *   StopGridPanel    one deployment: leg stop × rupee stop over its recent trades, which
 *                    trades the stops cut, and whether any of those went positive again.
 *
 * Data: GET /api/multileg/trades/:id/stop-whatif and /api/multileg/deployments/:id/stop-grid
 * (backend/logic/services/stopWhatIf.js). Both replay through the live engine's exit rules.
 * The replays mark short legs at the ask once a minute, so they are compared with EACH
 * OTHER — never with the booked number, which the engine marked at LTP every 10 s.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import TradePathChart from '../viz/TradePathChart';
import { istDateTime as tokIstDateTime } from '../viz/tokens';
import { rup, signed, tone, hhmm, reasonText, stopsText, recoveryText } from './stopReplayFormat.js';
import { Spinner } from '../viz/primitives';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50';

export function TradeStopReplay({ trade, istTime, istDateTime, istSpan }) {
    const id = trade?._id;
    // keyed by trade: another trade opened in the same row starts idle
    const [state, setSt] = useState({ id: null, status: 'idle' });
    const st = state.id === id ? state : { status: 'idle' };
    const run = () => {
        setSt({ id, status: 'loading' });
        axios.get(`${API_URL}/multileg/trades/${id}/stop-whatif`, { timeout: 90000 })
            .then((r) => setSt({ id, status: 'done', data: r.data }))
            .catch((e) => setSt({ id, status: 'error', error: e.response?.data?.error || e.message }));
    };
    const d = st.status === 'done' ? st.data : null;
    const overlays = useMemo(() => (d ? [
        d.noStops?.path?.length ? { key: 'noStops', name: 'replay · no stops', points: d.noStops.path, slot: 1, dashed: true } : null,
        d.configured?.path?.length ? { key: 'withStops', name: 'replay · its stops', points: d.configured.path, slot: 2, faint: true } : null,
    ].filter(Boolean) : undefined), [d]);
    const markers = useMemo(() => {
        if (!d) return undefined;
        const m = (d.configured?.legStops || []).map((s) => ({ t: s.at, text: `${s.leg} stopped` }));
        if (d.recovery && d.recovery.stopKind !== 'LEG_SL') m.push({ t: d.recovery.firstStopAt, text: reasonText(d.recovery.stopKind) });
        return m;
    }, [d]);

    return (
        <div>
            <TradePathChart trade={trade} istTime={istTime} istDateTime={istDateTime} istSpan={istSpan} overlays={overlays} markers={markers} />
            <div className="mt-1.5 text-3xs text-fg-4 space-y-1" data-testid="stop-replay">
                {st.status === 'idle' && id && (
                    <button type="button" className={BTN} onClick={run}
                        title="Replay this exact trade (its strikes, fills and size) on the recorded option chain, once with its stops and once with none">
                        Replay without stops
                    </button>
                )}
                {st.status === 'loading' && <Spinner size="xs" label="Replaying on the recorded option chain…" />}
                {st.status === 'error' && (
                    <div className="text-danger">Replay failed: {st.error} <button type="button" className="ml-1 underline" onClick={run}>retry</button></div>
                )}
                {d && <ReplaySummary d={d} />}
            </div>
        </div>
    );
}

function ReplaySummary({ d }) {
    if (d.configured?.net == null || d.noStops?.net == null) {
        return <div className="text-warning">Not enough recorded quotes to replay this trade{d.archive?.note ? ` (${d.archive.note})` : ''}.</div>;
    }
    const eff = d.stopEffect;
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>Booked <b className={tone(d.booked?.net)}>{signed(d.booked?.net)}</b> <span className="text-fg-5">({reasonText(d.booked?.reason)})</span></span>
                <span>Replay with its stops <b className={tone(d.configured.net)}>{signed(d.configured.net)}</b> <span className="text-fg-5">({reasonText(d.configured.reason)})</span></span>
                <span>Replay with no stops <b className={tone(d.noStops.net)}>{signed(d.noStops.net)}</b> <span className="text-fg-5">({reasonText(d.noStops.reason)})</span></span>
            </div>
            <div className={`font-semibold ${eff > 0 ? 'text-success' : eff < 0 ? 'text-danger' : 'text-fg-3'}`}>
                {eff > 0 ? `The stops SAVED ${rup(eff)} on this trade.` : eff < 0 ? `The stops COST ${rup(-eff)} on this trade.` : d.stopped ? 'The stops made no difference.' : 'No stop fired.'}
            </div>
            <div>{recoveryText(d)}</div>
            <div className="text-fg-5">
                Stops replayed: {stopsText(d.stops)} — {d.paramsSource}. {d.archive?.snapshots || 0} recorded minutes ({(d.archive?.days || []).join(', ')}).
                {d.archive?.fullChainMinutes > 0 && ` ${d.archive.fullChainMinutes} minute(s) had a strike outside the recorded window and were priced from the smile.`}
            </div>
            {(d.caveats || []).map((c, i) => <div key={i} className="text-fg-5">{c}</div>)}
        </div>
    );
}

// ── one deployment's grid ────────────────────────────────────────────────────
const legLabel = (x) => (x > 0 ? `${x}×` : 'off');
const lossLabel = (x) => (x > 0 ? rup(x) : 'off');

export function StopGridPanel({ deploymentId, limit = 30 }) {
    // keyed by deployment: switching the filter shows the new one idle
    const [state, setSt] = useState({ id: null, status: 'idle' });
    const st = state.id === deploymentId ? state : { status: 'idle' };
    const [showAll, setShowAll] = useState(false);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), [deploymentId]);

    const poll = (id) => {
        axios.get(`${API_URL}/multileg/deployments/${id}/stop-grid`, { params: { limit }, timeout: 60000 })
            .then((r) => {
                setSt({ id, status: r.data.status, job: r.data });
                if (r.data.status !== 'done' && r.data.status !== 'failed') timer.current = setTimeout(() => poll(id), 2000);
            })
            .catch((e) => setSt({ id, status: 'error', error: e.response?.data?.error || e.message }));
    };
    const start = () => { clearTimeout(timer.current); setSt({ id: deploymentId, status: 'queued' }); poll(deploymentId); };

    if (!deploymentId || deploymentId === 'all') {
        return <div className="text-3xs text-fg-5">Pick one deployment in the filter bar to replay its trades with other stops.</div>;
    }
    const job = st.job;
    const res = job?.result;
    return (
        <div className="space-y-2 text-3xs text-fg-4" data-testid="stop-grid">
            {st.status === 'idle' && (
                <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" className={BTN} onClick={start}>Replay its last {limit} trades with other stops</button>
                    <span className="text-fg-5">Each trade keeps its strikes, fills and size; only the stops change. Takes ~10–60 s.</span>
                </div>
            )}
            {['queued', 'loading', 'running'].includes(st.status) && (
                <Spinner size="xs" label={st.status === 'running' && job?.total ? `Replaying… ${job.done}/${job.total}` : st.status === 'loading' ? 'Loading recorded quotes…' : 'Waiting for another replay to finish…'} />
            )}
            {st.status === 'error' && <div className="text-danger">Failed: {st.error} <button type="button" className="ml-1 underline" onClick={start}>retry</button></div>}
            {st.status === 'failed' && <div className="text-danger">Replay failed: {job?.error}</div>}
            {res && <GridResult res={res} job={job} showAll={showAll} setShowAll={setShowAll} />}
        </div>
    );
}

function GridResult({ res, job, showAll, setShowAll }) {
    const legs = [...new Set(res.rows.map((r) => r.legSlX))].sort((a, b) => (a === 0) - (b === 0) || a - b);
    const losses = [...new Set(res.rows.map((r) => r.maxLoss))].sort((a, b) => (a === 0) - (b === 0) || a - b);
    const cell = (l, m) => res.rows.find((r) => r.legSlX === l && r.maxLoss === m);
    const best = res.rows[0];
    const cur = cell(res.current.legSlX, res.current.maxLoss);
    const stopped = res.perTrade.filter((t) => t.stopped);
    const cameBack = stopped.filter((t) => t.recovery?.wentPositiveAfterStop);
    const betterWithout = stopped.filter((t) => t.stopEffect != null && t.stopEffect < 0);
    const list = showAll ? res.perTrade : stopped;
    return (
        <div className="space-y-2">
            <div>
                {res.trades} trade(s) replayed{job.beyondLimit > 0 ? `; ${job.beyondLimit} older trade(s) not included (limit ${job.limit})` : ''}
                {job.quarantinedExcluded > 0 ? `; ${job.quarantinedExcluded} void fill(s) excluded` : ''}
                {res.skipped.length > 0 ? `; ${res.skipped.length} could not be replayed (${[...new Set(res.skipped.map((s) => s.why))].join('; ')})` : ''}.
            </div>
            <div>
                Best on these trades: <b>leg {legLabel(best.legSlX)} + rupee {lossLabel(best.maxLoss)}</b> → <b className={tone(best.net)}>{signed(best.net)}</b> (worst trade {signed(best.worst)}).
                {' '}Current <b>leg {legLabel(res.current.legSlX)} + rupee {lossLabel(res.current.maxLoss)}</b> → {cur ? <b className={tone(cur.net)}>{signed(cur.net)}</b> : 'not in the grid'}{cur ? ` (worst ${signed(cur.worst)})` : ''}.
                {' '}No stops at all → <b className={tone(res.noStops.net)}>{signed(res.noStops.net)}</b> (worst {signed(res.noStops.worst)}).
            </div>
            <div className="overflow-x-auto">
                <table className="text-3xs font-mono" aria-label="Net P&L by leg stop and rupee stop">
                    <thead>
                        <tr className="text-fg-5">
                            <th className="text-left pr-3 font-normal">leg stop ↓ · rupee stop →</th>
                            {losses.map((m) => <th key={m} className="text-right px-2 font-normal">{lossLabel(m)}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {legs.map((l) => (
                            <tr key={l} className="border-t border-line-0/60">
                                <td className="pr-3 text-fg-5">{legLabel(l)}</td>
                                {losses.map((m) => {
                                    const c = cell(l, m);
                                    const isCur = l === res.current.legSlX && m === res.current.maxLoss;
                                    const isBest = c === best;
                                    return (
                                        <td key={m} className={`text-right px-2 py-0.5 ${isCur ? 'ring-1 ring-primary rounded' : ''}`}
                                            title={c ? `${c.n} trades · ${c.wins} winners · worst ${signed(c.worst)} · avg ${signed(c.avg)}${isCur ? ' · CURRENT setting' : ''}` : ''}>
                                            <span className={`${tone(c?.net)} ${isBest ? 'font-bold' : ''}`}>{c ? signed(c.net) : '—'}</span>
                                            {isBest && <span className="text-warning" aria-label="best"> ★</span>}
                                            <div className="text-fg-5 text-4xs">worst {c ? signed(c.worst) : '—'}</div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div>
                With the current stops, {stopped.length} of {res.perTrade.length} trades were stopped;
                {' '}<b className={cameBack.length ? 'text-warning' : 'text-fg-3'}>{cameBack.length}</b> of those touched profit again after the stop when held with no stops,
                {' '}but only <b className={betterWithout.length ? 'text-warning' : 'text-fg-3'}>{betterWithout.length}</b> finished better without stops (touching profit is not keeping it).
                <label className="ml-3 inline-flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-sky-500" /> show every trade
                </label>
            </div>
            {list.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-3xs font-mono">
                        <thead>
                            <tr className="text-fg-5 text-left">
                                <th className="font-normal">Day</th><th className="text-right font-normal">Booked</th>
                                <th className="text-right font-normal">With stops</th><th className="text-right font-normal">No stops</th>
                                <th className="text-right font-normal">Stops did</th><th className="font-normal pl-2">After the first stop</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((t) => (
                                <tr key={t.id} className="border-t border-line-0/60">
                                    <td>{tokIstDateTime(t.entryAt)}</td>
                                    <td className={`text-right ${tone(t.booked)}`}>{signed(t.booked)}</td>
                                    <td className={`text-right ${tone(t.withStops)}`} title={reasonText(t.withStopsReason)}>{signed(t.withStops)}</td>
                                    <td className={`text-right ${tone(t.noStops)}`} title={reasonText(t.noStopsReason)}>{signed(t.noStops)}</td>
                                    <td className={`text-right ${tone(t.stopEffect)}`}>{t.stopEffect == null ? '—' : t.stopEffect > 0 ? `saved ${rup(t.stopEffect)}` : t.stopEffect < 0 ? `cost ${rup(-t.stopEffect)}` : 'nothing'}</td>
                                    <td className="pl-2">
                                        {!t.stopped ? <span className="text-fg-5">no stop fired</span>
                                            : t.recovery?.wentPositiveAfterStop
                                                ? <span className="text-warning">{reasonText(t.recovery.stopKind)} {hhmm(t.recovery.firstStopAt)} → came back to {signed(t.recovery.bestAfterStop)}</span>
                                                : <span className="text-fg-5">{reasonText(t.recovery?.stopKind)} {hhmm(t.recovery?.firstStopAt)} → never back above ₹0</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {(res.caveats || []).map((c, i) => <div key={i} className="text-fg-5">{c}</div>)}
        </div>
    );
}

export default TradeStopReplay;
