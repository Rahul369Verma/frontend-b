/**
 * TradeDetailsModal — everything about one trade, opened from Trade History's
 * "Details" button (GET /api/trades/:id/details).
 *
 * The directional-confidence gate comes first: the decision (accepted / would reject /
 * probe), CE AND PE confidence at the moment of entry, and how far this trade's side
 * was from the floor — the number that decided it. Whether those numbers were
 * RECORDED by the engine or RECONSTRUCTED afterwards (older trades) is always shown.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api.js';
import { Modal, Chip, ModeChip, Meter, Spinner, Placeholder, DataTable } from './viz/primitives';
import { inr, premium, istDateTime, istTime, pnlTone } from './viz/tokens.js';
import { pctOf, gateTone, marginText, verdictVsOutcome, flatten, holdText } from './tradeDetailsUtil.js';

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const num = (v, dp = 2) => (n(v) == null ? '—' : n(v).toFixed(dp));

function Row({ label, children }) {
    return (
        <>
            <span className="text-fg-5">{label}</span>
            <span className="text-fg-3 tabular-nums text-right break-words">{children}</span>
        </>
    );
}

function Section({ title, children, testId }) {
    return (
        <section className="border border-line/60 rounded-lg p-3 space-y-2" data-testid={testId}>
            <h3 className="text-xs font-semibold text-fg-2">{title}</h3>
            {children}
        </section>
    );
}

export function GateSection({ gate, trade }) {
    if (!gate) return null;
    const side = gate.side;
    const outcome = verdictVsOutcome(gate, trade);
    const floor = n(gate.floor);
    return (
        <Section title="Direction-confidence gate" testId="gate-section">
            <div className="flex flex-wrap items-center gap-2">
                <Chip tone={gateTone(gate)}>{gate.label}</Chip>
                {gate.mode && <Chip tone="muted" title="Gate mode when this trade was decided">mode: {gate.mode}</Chip>}
                <Chip tone={gate.source === 'recorded' ? 'good' : 'warning'}
                    title={gate.source === 'recorded' ? 'Numbers the engine saw and stored at entry' : 'Recomputed from trades that had closed before this entry — same maths'}>
                    {gate.source}
                </Chip>
            </div>
            {side && (
                <p className="text-xs text-fg-3">
                    This trade was <b>{side}</b> at <b>{pctOf(gate.confidence)}</b> confidence
                    {marginText(gate) ? <> — {marginText(gate)}</> : null}.
                </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {['CE', 'PE'].map(s => {
                    const x = gate.sides?.[s];
                    const c = n(x?.confidence);
                    return (
                        <div key={s} className={`rounded-md p-2 ${s === side ? 'bg-primary/10 border border-primary/30' : 'bg-card-2/40 border border-line/40'}`} data-testid={`gate-side-${s}`}>
                            <Meter value={c ?? 0.5} max={1} label={`${s} ${s === 'CE' ? '(bullish)' : '(bearish)'}${s === side ? ' · this trade' : ''}`}
                                tone={c != null && floor != null && c < floor ? 'critical' : c != null && c < 0.5 ? 'warning' : 'neutral'}
                                caption={x ? `${x.n ?? '—'} trades in window (eff ${num(x.nEff, 1)}) · win ${pctOf(x.winRate, 0)} · avg R ${num(x.meanR)}${x.recorded ? ' · recorded' : ''}` : 'no data'} />
                        </div>
                    );
                })}
            </div>
            {gate.reason && <p className="text-2xs text-fg-4">Reason: {gate.reason}</p>}
            <p className="text-2xs text-fg-5">
                Floor {pctOf(gate.settings?.floor, 0)} · probe 1 in {gate.settings?.probeEvery ?? '—'} weak signals · half-life {gate.settings?.halfLifeSessions ?? '—'} sessions
                {gate.decidedAt ? ` · decided ${istTime(gate.decidedAt)}` : ''}
                {gate.credit != null ? ` · probe credit after decision ${num(gate.credit, 2)}` : ''}
            </p>
            {outcome && <p className="text-2xs text-fg-3">{outcome}</p>}
            <p className="text-3xs text-fg-5">
                Signals the gate REJECTS while enforcing never become trades, so they are not in Trade History — they appear in the Live Activity Feed as SKIPPED.
            </p>
        </Section>
    );
}

export function TradeDetailsView({ data }) {
    const t = data?.trade;
    if (!t) return null;
    const pos = data.position || {};
    const net = n(t.net_pnl) ?? n(t.pnl);
    const gross = n(t.gross_pnl) ?? n(t.pnl);
    const charges = n(t.charges?.total) ?? (gross != null && n(t.net_pnl) != null ? gross - n(t.net_pnl) : null);
    const er = t.entry_risk || {}, xr = t.exit_risk || {};
    const reviews = (data.aiLogs || []).filter(l => l.phase === 'in_trade');
    const all = flatten(t);
    return (
        <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-fg">{t.symbol}</span>
                {t.type && <Chip tone={t.type === 'CE' ? 'info' : 'warning'}>{t.type}</Chip>}
                <Chip>{t.strategyName || t.strategy || '—'}</Chip>
                <ModeChip mode={t.isPaper === false ? 'LIVE' : 'PAPER'} />
                <Chip tone={t.status === 'OPEN' ? 'live' : 'muted'}>{t.status || 'legacy'}</Chip>
            </div>

            <GateSection gate={data.gate} trade={t} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Section title="Trade" testId="trade-section">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <Row label="Entry">{t.entryTime ? istDateTime(t.entryTime, { seconds: true }) : '—'}</Row>
                        <Row label="Exit">{t.exitTime ? istDateTime(t.exitTime, { seconds: true }) : '—'}</Row>
                        <Row label="Held">{holdText(t.entryTime, t.exitTime)}</Row>
                        <Row label="Qty / lots">{t.quantity ?? '—'}{pos.lots ? ` (${pos.lots} lot${pos.lots > 1 ? 's' : ''})` : ''}</Row>
                        <Row label="Entry price">{premium(t.entryPrice ?? t.price)}{n(pos.entryPrice) != null && n(pos.entryPrice) !== n(t.entryPrice) ? ` (fill ${premium(pos.entryPrice)})` : ''}</Row>
                        <Row label="Exit price">{premium(t.exitPrice)}</Row>
                        <Row label="Gross P&L"><span className={pnlTone(gross)}>{inr(gross, { sign: true })}</span></Row>
                        <Row label="Charges">{inr(charges)}</Row>
                        <Row label="Net P&L"><span className={`font-semibold ${pnlTone(net)}`}>{inr(net, { sign: true })}</span></Row>
                        <Row label="Exit reason">{t.reason || '—'}</Row>
                        <Row label="Deployment">{t.deploymentId || '—'}</Row>
                    </div>
                </Section>
                <Section title="Levels & greeks" testId="levels-section">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <Row label="SL / TP (premium pts)">{num(t.slPoints)} / {num(t.tpPoints)}</Row>
                        <Row label="Initial SL pts">{num(pos.initialSlPoints)}</Row>
                        <Row label="R:R planned">{n(t.slPoints) ? num(n(t.tpPoints) / n(t.slPoints)) : '—'}</Row>
                        <Row label="Index SL">{num(t.strategyIndexSl)}</Row>
                        <Row label="Spot entry → exit">{num(t.entry_spot)} → {num(t.exit_spot)}</Row>
                        <Row label="Strike / expiry">{er.strike ?? '—'} / {er.expiry ? String(er.expiry).slice(0, 10) : '—'}</Row>
                        <Row label="IV entry → exit">{pctOf(er.iv)} → {pctOf(xr.iv)}</Row>
                        <Row label="Delta entry → exit">{num(er.greeks?.delta, 3)} → {num(xr.greeks?.delta, 3)}</Row>
                        <Row label="Theta / vega (entry)">{num(er.greeks?.theta)} / {num(er.greeks?.vega)}</Row>
                        <Row label="India VIX at entry">{num(t.entry_vix?.intraday ?? t.entry_vix?.prevClose)}</Row>
                    </div>
                </Section>
            </div>

            <Section title={`AI in-flight reviews (${reviews.length})`} testId="ai-section">
                <DataTable dense maxHeight={200} rows={reviews.map((l, i) => ({ ...l, _key: `${l.timestamp}-${i}` }))} empty="No AI reviews for this trade"
                    columns={[
                        { key: 'timestamp', header: 'Time', render: r => istTime(r.timestamp) },
                        { key: 'action', header: 'Action', render: r => r.action || r.decision },
                        { key: 'confidence', header: 'Conf', align: 'right', render: r => (r.failure_type ? '—' : r.confidence ?? '—') },
                        { key: 'reasoning', header: 'Note', render: r => <span className="whitespace-normal">{r.failure_type ? `FAILED: ${String(r.failure_message || r.failure_type).slice(0, 90)}` : String(r.reasoning || '').slice(0, 160)}</span> },
                    ]} />
            </Section>

            <details className="border border-line/60 rounded-lg p-3" data-testid="all-fields">
                <summary className="text-xs font-semibold text-fg-2 cursor-pointer">All stored fields ({all.length})</summary>
                <div className="mt-2">
                    <DataTable dense maxHeight={320} rows={all.map((r, i) => ({ ...r, _key: `${r.key}-${i}` }))}
                        columns={[{ key: 'key', header: 'Field' }, { key: 'value', header: 'Value', render: r => <span className="whitespace-normal break-all">{r.value}</span> }]} />
                </div>
            </details>
        </div>
    );
}

export default function TradeDetailsModal({ tradeId, onClose }) {
    // Result keyed by the id it belongs to: switching trades shows a spinner without a
    // synchronous state reset inside the effect.
    const [res, setRes] = useState({ id: null, data: null, err: null });
    useEffect(() => {
        if (!tradeId) return undefined;
        let live = true;
        axios.get(`${API_URL}/trades/${tradeId}/details`)
            .then(r => { if (live) setRes({ id: tradeId, data: r.data, err: null }); })
            .catch(e => { if (live) setRes({ id: tradeId, data: null, err: e?.response?.data?.error || e.message }); });
        return () => { live = false; };
    }, [tradeId]);
    const data = res.id === tradeId ? res.data : null;
    const err = res.id === tradeId ? res.err : null;
    return (
        <Modal open={!!tradeId} onClose={onClose} title={`Trade ${String(tradeId || '').slice(-6).toUpperCase()} — details`} width="max-w-4xl">
            {err && <Placeholder>Could not load trade details: {err}</Placeholder>}
            {!data && !err && <Spinner label="Loading trade details…" />}
            {data && <TradeDetailsView data={data} />}
        </Modal>
    );
}
