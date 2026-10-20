/**
 * BlockedTrades — every trade the direction gate blocked (Enforce) or would have
 * blocked (Shadow), simple first.
 *
 * One line on top says whether blocking has helped. Each row: when, what, and in
 * plain words what happened ("would have made −₹893 (SL Hit)"). "Details" opens
 * the full picture: both sides' confidence, the contract, prices, how far it went
 * for/against, and the AI reviews (with WHY a review failed).
 * Backend: GET /api/analytics/direction-confidence/blocked (src/domain/risk/directionGateBlocked.js).
 */
import React, { useCallback, useState } from 'react';
import axios from 'axios';
import { Info } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { StatusBadge, Chip, Spinner, Placeholder, DataTable, Modal, Segmented } from '../viz/primitives';
import { inr, istDateTime, pnlTone } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import useRemWidth from '../../hooks/useRemWidth.js';
import DocLink from '../DocLink.jsx';
import { summaryLine, blockedVerdict } from './blockedFormat.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg';
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const effectTone = (e) => (e == null ? 'muted' : e > 0 ? 'good' : e < 0 ? 'critical' : 'neutral');
const STATE_LABEL = {
    followed: 'followed', following: 'being followed', not_followed: 'not followed', taken: 'taken (shadow)', taken_open: 'open (shadow)', not_taken: 'shadow',
};


function DetailModal({ row, onClose }) {
    if (!row) return null;
    const sides = row.sides || {};
    return (
        <Modal open onClose={onClose} width="max-w-2xl" docs="dashboard#direction-confidence"
            title={`${row.mode === 'enforce' ? 'Blocked' : 'Would have blocked'} — ${row.side || ''} ${row.strategy || ''} on ${row.index || ''}`}>
            <div className="space-y-3 text-xs text-fg-3">
                <p className="text-sm text-fg">{row.summary}</p>
                <div className="flex flex-wrap gap-2 items-center">
                    <StatusBadge level={effectTone(row.gateEffect) === 'good' ? 'good' : effectTone(row.gateEffect) === 'critical' ? 'critical' : 'info'}>{row.verdict}</StatusBadge>
                    <Chip tone={row.mode === 'enforce' ? 'critical' : 'muted'}>{row.mode === 'enforce' ? 'Enforce' : 'Shadow'}</Chip>
                    <span className="text-3xs text-fg-5">{istDateTime(row.at, { seconds: true })} IST</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <section className="rounded border border-line/60 p-2 space-y-1">
                        <h3 className="text-2xs uppercase tracking-wide text-fg-5">The decision</h3>
                        <p>{row.side} confidence <b>{pct(row.confidence)}</b>{row.floor != null ? <> — floor {pct(row.floor)}</> : null}</p>
                        {(sides.CE || sides.PE) && <p className="text-fg-4">At that moment: CE {pct(sides.CE?.confidence)} · PE {pct(sides.PE?.confidence)}</p>}
                        {row.reason && <p className="text-fg-4">Engine: {row.reason}</p>}
                        <p className="text-3xs text-fg-5">Strategy {row.strategy || '—'} · {row.spotSymbol || '—'}</p>
                    </section>
                    <section className="rounded border border-line/60 p-2 space-y-1">
                        <h3 className="text-2xs uppercase tracking-wide text-fg-5">{row.mode === 'enforce' ? 'What it would have done' : 'What the real trade did'}</h3>
                        <p>{row.contract || 'No contract recorded'}</p>
                        {row.entryPrice != null && <p>₹{row.entryPrice} → {row.exitPrice != null ? `₹${row.exitPrice}` : row.live ? `₹${row.live.lastLtp} (live)` : 'open'}{row.exitReason ? ` · ${row.exitReason}` : ''}</p>}
                        <p>Result: <b className={pnlTone(row.net ?? row.live?.unrealized)}>{row.net != null ? inr(row.net, { sign: true }) : row.live ? `${inr(row.live.unrealized, { sign: true })} so far` : '—'}</b></p>
                        {row.mae != null && <p className="text-fg-4">Worst point {inr(row.mae)} · best point {inr(row.mfe)}</p>}
                        {row.entryTime && <p className="text-3xs text-fg-5">{istDateTime(row.entryTime)} → {row.exitTime ? istDateTime(row.exitTime) : 'still open'}</p>}
                    </section>
                </div>
                {row.aiReviews && row.aiReviews.length > 0 && (
                    <section className="rounded border border-line/60 p-2 space-y-1">
                        <h3 className="text-2xs uppercase tracking-wide text-fg-5">AI reviews while it was followed</h3>
                        <ul className="space-y-1">
                            {row.aiReviews.map((r, i) => (
                                <li key={i} className="space-y-0.5">
                                    <span className="text-3xs text-fg-5">{r.at ? istDateTime(r.at) : '—'} · {r.model || 'AI'}</span>{' '}
                                    {r.failed
                                        ? <><StatusBadge level="critical">Failed</StatusBadge> <span className="text-fg-3">{r.reason}</span>{r.fix && <span className="block text-fg-4">How to fix: {r.fix}</span>}</>
                                        : <><StatusBadge level="info">{r.action}</StatusBadge> <span className="text-fg-4">{r.reason}</span></>}
                                </li>
                            ))}
                        </ul>
                        {row.aiReviews.some((r) => r.failed) && <p className="text-3xs text-fg-5">AI failures are also raised on the Notifications page (AI health), with a 6-hourly test.</p>}
                    </section>
                )}
                {row.caveats && row.caveats.length > 0 && <p className="text-3xs text-warning">Caveats: {row.caveats.join(' · ')}</p>}
                <p className="text-3xs text-fg-5">
                    {row.mode === 'enforce'
                        ? 'A blocked trade is followed at real prices with the same stop, target and exit rules — never an order, never in your P&L.'
                        : 'Shadow mode never blocks: the trade went ahead and this is its real result.'}
                </p>
            </div>
        </Modal>
    );
}

export function BlockedTradesView({ data, days, onDays, limit = 8 }) {
    const [detail, setDetail] = useState(null);
    const [all, setAll] = useState(false);
    const ref = React.useRef(null);
    const rem = useRemWidth(ref);
    const narrow = rem != null && rem < 48;
    if (!data) return null;
    const rows = data.rows || [];
    const shown = all ? rows : rows.slice(0, limit);
    const s = data.summary || {};
    return (
        <div ref={ref} className="space-y-2" data-testid="blocked-trades">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-xs font-semibold text-fg-2">Blocked trades ({rows.length}) <DocLink to="dashboard#direction-confidence" className="ml-1" /></h3>
                {onDays && <Segmented value={days} onChange={onDays} options={[{ v: 30, label: '30d' }, { v: 90, label: '90d' }, { v: 365, label: '1y' }]} />}
            </div>
            <div className="flex items-start gap-2 flex-wrap" data-testid="gate-verdict">
                <StatusBadge level={blockedVerdict(s).level} title="Is the gate helping? Judged only after 10 or more blocked trades — a handful can go either way by luck.">{blockedVerdict(s).label}</StatusBadge>
                <p className="text-2xs text-fg-4 min-w-0 flex-1" data-testid="blocked-summary">{summaryLine(s, days)}</p>
            </div>
            {rows.length > 0 && (narrow ? (
                <ul className="space-y-1.5">
                    {shown.map((r) => (
                        <li key={r.id} className="border border-line/60 rounded px-2 py-1.5 text-2xs text-fg-4 space-y-0.5">
                            <div className="flex justify-between gap-2">
                                <span className="text-fg-2">{istDateTime(r.at)} · {r.strategy || '—'} · {r.index} {r.side}</span>
                                <Chip tone={effectTone(r.gateEffect)}>{r.verdict}</Chip>
                            </div>
                            <div className={r.lost ? 'text-warning' : undefined}>{r.result}{r.inferred ? ' *' : ''}</div>
                            <button type="button" className={BTN} onClick={() => setDetail(r)}><Info className="w-3 h-3" aria-hidden="true" />Details</button>
                        </li>
                    ))}
                </ul>
            ) : (
                <DataTable dense rows={shown.map((r) => ({ ...r, _key: r.id }))}
                    columns={[
                        { key: 'at', header: 'When (IST)', render: (r) => istDateTime(r.at) },
                        { key: 'strategy', header: 'Strategy', render: (r) => r.strategy || '—' },
                        { key: 'index', header: 'Index', render: (r) => `${r.index || '—'} ${r.side || ''}` },
                        { key: 'mode', header: 'Gate', render: (r) => <Chip tone={r.mode === 'enforce' ? 'critical' : 'muted'} title={r.why}>{r.mode === 'enforce' ? 'Blocked' : 'Shadow'} · {pct(r.confidence)}</Chip> },
                        { key: 'result', header: 'What happened', render: (r) => <span className={r.lost ? 'text-warning' : 'text-fg-3'}>{r.result}{r.inferred ? ' *' : ''}</span> },
                        { key: 'verdict', header: 'Blocking…', render: (r) => <Chip tone={effectTone(r.gateEffect)}>{r.verdict}</Chip> },
                        { key: 'more', header: '', render: (r) => <button type="button" className={BTN} onClick={() => setDetail(r)} aria-label={`Details of the ${r.side} ${r.strategy || ''} block at ${istDateTime(r.at)}`}><Info className="w-3 h-3" aria-hidden="true" />Details</button> },
                    ]} />
            ))}
            {rows.length > limit && (
                <button type="button" className={BTN} onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
            )}
            {rows.some((r) => r.inferred) && (
                <p className="text-3xs text-fg-5">* The engine&apos;s note of what happened next was not saved for these (a write-order bug, fixed 20-Oct-2026); they were outside the deployment&apos;s entry window, worked out from their time.</p>
            )}
            <p className="text-3xs text-fg-5">
                Only blocks are listed here. Signals the gate let through in Enforce mode — <b>Allowed</b> (the side at or above the floor) and <b>Probe</b> (a weak side let through on purpose, one in every few) — are trades: see <b>Latest gate decisions</b> below and Trade History&apos;s Gate column.
            </p>
            <DetailModal row={detail} onClose={() => setDetail(null)} />
        </div>
    );
}

export default function BlockedTrades() {
    const [days, setDays] = useState(90);
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const load = useCallback(async () => {
        try { const r = await axios.get(`${API_URL}/analytics/direction-confidence/blocked`, { params: { days } }); setData(r.data); setErr(null); }
        catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, [days]);
    usePolling(load, 60000);
    return (
        <>
            {err && <Placeholder>Could not load the blocked trades: {err}</Placeholder>}
            {!data && !err && <Spinner label="Loading blocked trades…" />}
            <BlockedTradesView data={data} days={days} onDays={setDays} />
        </>
    );
}
