/**
 * DirectionConfidencePanel — how much the recent book trusts each option side.
 *
 * CE = bullish buys, PE = bearish buys. Confidence is P(mean R > 0) from a decayed,
 * sceptical Bayesian estimate over recent closed trades (backend
 * src/domain/risk/directionConfidence.js — pure maths, no AI).
 *
 * SIMPLE FIRST (user, 16-Oct-2026). The top says, in words, what the gate is doing
 * to each side right now, whether blocking has helped, and which trades it
 * blocked — each with a Details button. The maths (scorecard, session history,
 * day-by-day value, ghost table) sits behind "Show details".
 *
 * ── WHY THE DEFAULT IS SHADOW ───────────────────────────────────────────────
 * Before this was built, a side's recent confidence did NOT predict its next trade
 * on three datasets, and every blocking setting lowered one-year backtest profit.
 * So the engine records what it WOULD do on every entry and this card scores it
 * against the real outcomes. Switch to Enforce only when the scorecard says blocking
 * would have helped over a meaningful number of trades.
 */
import React, { useCallback, useState } from 'react';
import axios from 'axios';
import { Compass, ChevronDown, ChevronRight } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Card, StatusBadge, Meter, Segmented, Spinner, DataTable, Placeholder } from '../viz/primitives';
import { inr, istDateTime, pnlTone } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useConfirm } from '../confirmContext.js';
import { toast } from '../toastStore.js';
import { sideState, sideMeaning, gateVerdict, MODE_LINE } from './directionState.js';
import DirectionGateHistory from './DirectionGateHistory.jsx';
import BlockedTrades from './BlockedTrades.jsx';
import GateDecisions from './GateDecisions.jsx';
import DocLink from '../DocLink.jsx';

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const pct0 = (v) => (n(v) == null ? '—' : `${Math.round(n(v) * 100)}%`);
const BTN = 'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg';

const SIDES = [
    { key: 'CE', title: 'CE · bullish buys' },
    { key: 'PE', title: 'PE · bearish buys' },
];

// The scorecard verdict badge: its icon is part of the message, not decoration.
const VERDICT_HELP = 'Badge icon: ✓ = blocking would have made money · ✕ = blocking would have cost money · i = information only, not enough data to judge yet (needs 10+ blocked trades).';



function SideTile({ meta, side, opts, credit, mode }) {
    const [open, setOpen] = useState(false);
    const st = sideState(side, opts);
    const conf = n(side?.confidence);
    const weak = st.label === 'WEAK';
    const probeEvery = opts?.probeEvery ?? 3;
    const left = weak && credit != null ? Math.max(1, Math.ceil((1 - credit) * probeEvery - 1e-9)) : null;
    return (
        <div className="bg-card-2/40 border border-line/60 rounded-lg p-3 space-y-1.5" data-testid={`side-${meta.key}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg-3">{meta.title}</span>
                <StatusBadge level={st.level}>{st.label}</StatusBadge>
            </div>
            <p className="text-2xl font-semibold tabular-nums text-fg">{pct0(conf)} <span className="text-2xs font-normal text-fg-5">confidence</span></p>
            <p className="text-2xs text-fg-4">{sideMeaning(st, { mode, probeEvery, left, floor: opts?.floor })}</p>
            <button type="button" className={BTN} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                {open ? 'Hide numbers' : 'Numbers'}
            </button>
            {open && (
                <div className="space-y-2 pt-1">
                    <Meter value={conf ?? 0.5} max={1} label="Confidence (P mean R > 0)"
                        tone={weak ? 'critical' : st.label === 'NEUTRAL' ? 'warning' : 'neutral'}
                        caption={`floor ${pct0(opts?.floor)} · 50% = no edge either way`} />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-fg-5">
                        <span>Trades in window</span><span className="text-fg-3 tabular-nums text-right">{side?.n ?? 0} (eff {n(side?.nEff)?.toFixed(1) ?? '0.0'})</span>
                        <span>Win rate (decayed)</span><span className="text-fg-3 tabular-nums text-right">{pct0(side?.winRate)}</span>
                        <span>Avg R (decayed)</span><span className="text-fg-3 tabular-nums text-right">{n(side?.meanR) == null ? '—' : n(side.meanR).toFixed(2)}</span>
                        <span>Net in window</span><span className={`tabular-nums text-right ${pnlTone(side?.netRs)}`}>{inr(side?.netRs, { sign: true })}</span>
                        {side?.ghosts?.n > 0 && <>
                            <span title="Signals the gate blocked, followed at real prices (no order); their results count like taken trades">…of which blocked trades</span>
                            <span className="text-fg-3 tabular-nums text-right">{side.ghosts.n} · <span className={pnlTone(side.ghosts.net)}>{inr(side.ghosts.net, { sign: true })}</span></span>
                        </>}
                    </div>
                </div>
            )}
        </div>
    );
}


/** The probe count after a restart — restored from the decision journal, or why not. */
function probeRestoreLine(r, probeEvery = 3) {
    if (!r) return null;
    if (r.status === 'restored') {
        const parts = Object.entries(r.sides || {}).map(([k, v]) => `${k} ${Math.round(v.credit * probeEvery)} of ${probeEvery}`);
        return `Probe count restored from the decision journal after the last restart${parts.length ? ` (${parts.join(', ')})` : ' (no earlier decisions)'}.`;
    }
    if (r.status === 'failed') return `Probe count NOT restored after the last restart (${r.reason}) — it started from zero; the engine retries every minute.`;
    if (r.status === 'skipped') return `Probe count not restored: ${r.reason}.`;
    return null;
}

function Details({ data }) {
    const { opts, history, scorecard, live, excluded, mode, ghostEvidence } = data;
    const sc = scorecard || {};
    const wb = sc.wouldBlock || { n: 0 };
    const en = sc.enforce || null;
    const verdictLevel = sc.judged != null
        ? (sc.judged >= 10 ? (sc.value > 0 ? 'good' : 'critical') : 'info')
        : (wb.n >= 10 ? (wb.net < 0 ? 'good' : 'critical') : 'info');
    const trackBlocked = opts?.trackBlocked !== false;
    return (
        <div className="space-y-3">
            <div className="border border-line/60 rounded-lg p-3 space-y-1.5" data-testid="scorecard">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-fg-3">Scorecard, last ~4 weeks — would blocking have helped?</span>
                    <StatusBadge level={verdictLevel} title={VERDICT_HELP}>{sc.verdict || '—'}</StatusBadge>
                </div>
                <p className="text-2xs text-fg-4">
                    {wb.n} trade{wb.n === 1 ? '' : 's'} the gate would have blocked, net{' '}
                    <span className={pnlTone(wb.net)}>{inr(wb.net, { sign: true })}</span>
                    {wb.n > 0 && <> → enforcing would have {wb.savedIfEnforced >= 0 ? 'saved' : 'cost'}{' '}
                        <span className={pnlTone(wb.savedIfEnforced)}>{inr(Math.abs(wb.savedIfEnforced ?? 0))}</span></>}.
                    {' '}Probes: {sc.decisions?.PROBE?.n ?? 0} (net {inr(sc.decisions?.PROBE?.net ?? 0, { sign: true })}).
                    {sc.unrecorded?.n ? ` ${sc.unrecorded.n} trade${sc.unrecorded.n === 1 ? '' : 's'} have no recorded verdict (before this feature, or gate off).` : ''}
                </p>
                {en && (en.ghosts > 0 || en.ghostsOpen > 0 || en.knockOn > 0 || mode === 'enforce') && (
                    <p className="text-2xs text-fg-4" data-testid="scorecard-enforce">
                        Enforce: {en.ghosts} blocked trade{en.ghosts === 1 ? '' : 's'} followed as ghosts would have made{' '}
                        <span className={pnlTone(en.ghostNet)}>{inr(en.ghostNet, { sign: true })}</span>
                        {en.ghostsOpen ? ` (+${en.ghostsOpen} still open)` : ''}; {en.knockOn} knock-on trade{en.knockOn === 1 ? '' : 's'} made{' '}
                        <span className={pnlTone(en.knockOnNet)}>{inr(en.knockOnNet, { sign: true })}</span>.
                        {' '}Gate value <span className={pnlTone(sc.value)}>{inr(sc.value, { sign: true })}</span>.
                        {!trackBlocked && ' Ghost tracking is OFF — new blocks are dropped unscored.'}
                    </p>
                )}
            </div>
            <div>
                <p className="text-2xs uppercase tracking-wide text-fg-5 mb-1">Confidence at each session close (IST) <DocLink to="dashboard#direction-confidence" /></p>
                <DataTable dense rows={(history || []).slice().reverse().map(h => ({ ...h, _key: h.date }))} empty="No sessions yet"
                    columns={[
                        { key: 'date', header: 'Session', render: r => (r.at
                            ? <span title={r.live ? 'Session still open — this is the reading so far, not the close' : 'Measured at the session close'}>{istDateTime(r.at)}{r.live ? ' (so far)' : ''}</span>
                            : `${r.date}, 15:40`) },
                        { key: 'CE', header: 'CE', align: 'right', render: r => `${pct0(r.CE)} (${r.ceN})` },
                        { key: 'PE', header: 'PE', align: 'right', render: r => `${pct0(r.PE)} (${r.peN})` },
                    ]} />
            </div>
            {live?.stale && <StatusBadge level="warning">Engine snapshot is stale or not running — decisions fail open</StatusBadge>}
            {probeRestoreLine(live?.creditRestore, opts?.probeEvery) && <p className="text-2xs text-fg-4" data-testid="probe-restore">{probeRestoreLine(live?.creditRestore, opts?.probeEvery)}</p>}
            {ghostEvidence?.closed > 0 && (
                <p className="text-2xs text-fg-4" data-testid="ghost-evidence">
                    {ghostEvidence.learned > 0
                        ? `${ghostEvidence.learned} closed blocked trade${ghostEvidence.learned === 1 ? '' : 's'} (followed at real prices, no order) count toward confidence alongside the real trades.`
                        : `${ghostEvidence.closed} closed blocked trade${ghostEvidence.closed === 1 ? '' : 's'} are NOT counted — confidence learns from taken trades only.`}
                </p>
            )}
            <p className="text-3xs text-fg-5">
                Pure maths, no AI: R = net P&L ÷ rupees risked, half-life {opts?.halfLifeSessions} sessions, sceptical prior worth {opts?.priorTrades} trades
                at 0, confidence = P(mean R &gt; 0). Old results fade, so a blocked side drifts back to 50% on its own; winning probes{opts?.learnFromBlocked !== false ? ' and winning blocked trades' : ''} bring it back faster.
                {excluded?.count ? ` ${excluded.count} trade${excluded.count === 1 ? '' : 's'} excluded (${Object.entries(excluded.reasons || {}).map(([k, v]) => `${v} ${k}`).join(', ')}).` : ''}
            </p>
        </div>
    );
}

export function DirectionConfidenceView({ data, onMode, onTrackBlocked, onLearnBlocked, busy, blocked = null, decisions = null, history = null }) {
    const [details, setDetails] = useState(false);
    if (!data) return null;
    const { sides, opts, mode, live } = data;
    const trackBlocked = opts?.trackBlocked !== false;
    const learnBlocked = opts?.learnFromBlocked !== false;
    const v = gateVerdict(data);
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-fg-3 max-w-xl">{MODE_LINE[mode] || MODE_LINE.shadow}</p>
                <Segmented value={mode} onChange={onMode}
                    options={[
                        { v: 'off', label: 'Off', hint: 'No decisions' },
                        { v: 'shadow', label: 'Shadow', hint: 'Record decisions, never block (recommended)' },
                        { v: 'enforce', label: 'Enforce', hint: 'Block weak-side signals except probes' },
                    ]} />
            </div>
            {onTrackBlocked && mode === 'enforce' && (
                <label className="inline-flex items-center gap-2 text-2xs text-fg-4" title="Carry each blocked signal down the real entry path and follow it at real prices (never an order), so you can see what it would have made">
                    <input type="checkbox" checked={trackBlocked} disabled={busy} onChange={(e) => onTrackBlocked(e.target.checked)} aria-label="Follow blocked trades as ghosts" />
                    Follow blocked trades at real prices (to see what they would have made)
                </label>
            )}
            {onLearnBlocked && mode === 'enforce' && (
                <label className="inline-flex items-center gap-2 text-2xs text-fg-4"
                    title={trackBlocked ? 'A blocked trade, once closed, counts toward its side\'s confidence exactly like a taken trade — so a blocked side can earn its way back (or stay shut) on what its signals really did, not only on 1 probe in N' : 'Needs "Follow blocked trades" — without it there is no result to learn from'}>
                    <input type="checkbox" checked={learnBlocked && trackBlocked} disabled={busy || !trackBlocked} onChange={(e) => onLearnBlocked(e.target.checked)} aria-label="Blocked trades count toward confidence" />
                    Blocked trades count toward confidence (their results at real prices)
                </label>
            )}
            {busy && <Spinner label="Saving…" />}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SIDES.map(s => <SideTile key={s.key} meta={s} side={sides?.[s.key]} opts={opts} credit={live?.credit?.[s.key]} mode={mode} />)}
            </div>

            {/* ONE answer to "is it helping?": the blocked list carries it when shown; this line is the fallback */}
            {!blocked && (
                <div className="flex items-start gap-2" data-testid="gate-verdict">
                    <StatusBadge level={v.level} title={VERDICT_HELP}>Is it helping?</StatusBadge>
                    <p className="text-2xs text-fg-3">{v.text}</p>
                </div>
            )}

            {blocked}
            {decisions}

            <button type="button" className={BTN} onClick={() => setDetails((d) => !d)} aria-expanded={details}>
                {details ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                {details ? 'Hide details' : 'Show details — scorecard, session history, day-by-day value'}
            </button>
            {details && (
                <div className="space-y-3 border-t border-line/60 pt-3">
                    <Details data={data} />
                    {history}
                </div>
            )}
        </div>
    );
}

export default function DirectionConfidencePanel() {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const confirm = useConfirm();

    const load = useCallback(async () => {
        try {
            const r = await axios.get(`${API_URL}/analytics/direction-confidence`);
            setData(r.data); setErr(null);
        } catch (e) {
            setErr(e?.response?.data?.error || e.message);
        }
    }, []);
    usePolling(load, 60000);

    const onMode = async (mode) => {
        if (!data || mode === data.mode) return;
        if (mode === 'enforce') {
            const ok = await confirm({
                title: 'Enforce direction blocking?',
                body: 'Weak-side signals will be REJECTED (1 in N still goes through as a probe). The one-year replay found every blocking setting lowered profit; enforce only if the shadow scorecard says blocking would have helped over 10+ trades.',
                confirmLabel: 'Enforce',
                danger: true,
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            await axios.post(`${API_URL}/analytics/direction-confidence/settings`, { mode });
            toast.success(`Direction gate: ${mode}`);
            await load();
        } catch (e) {
            toast.error(e?.response?.data?.error || e.message);
        } finally { setBusy(false); }
    };

    const onLearnBlocked = async (learnFromBlocked) => {
        setBusy(true);
        try {
            await axios.post(`${API_URL}/analytics/direction-confidence/settings`, { learnFromBlocked });
            toast.success(learnFromBlocked ? 'Blocked trades now count toward confidence' : 'Confidence learns from taken trades only');
            await load();
        } catch (e) {
            toast.error(e?.response?.data?.error || e.message);
        } finally { setBusy(false); }
    };

    const onTrackBlocked = async (trackBlocked) => {
        setBusy(true);
        try {
            await axios.post(`${API_URL}/analytics/direction-confidence/settings`, { trackBlocked });
            toast.success(trackBlocked ? 'Blocked trades will be followed at real prices' : 'Blocked trades will not be followed');
            await load();
        } catch (e) {
            toast.error(e?.response?.data?.error || e.message);
        } finally { setBusy(false); }
    };

    return (
        <div id="direction-confidence" className="scroll-mt-4">
            <Card docs="dashboard#direction-confidence" icon={Compass} title="Direction confidence — CE vs PE"
                subtitle="How much recent trades trust each side, and which trades the gate blocked">
                {err && <Placeholder>Could not load direction confidence: {err}</Placeholder>}
                {!data && !err && <Spinner label="Loading direction confidence…" />}
                <DirectionConfidenceView data={data} onMode={onMode} onTrackBlocked={onTrackBlocked} onLearnBlocked={onLearnBlocked} busy={busy}
                    blocked={<BlockedTrades />} decisions={<GateDecisions />} history={<DirectionGateHistory />} />
            </Card>
        </div>
    );
}
