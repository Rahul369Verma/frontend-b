/**
 * DirectionConfidencePanel — how much the recent book trusts each option side.
 *
 * CE = bullish buys, PE = bearish buys. Confidence is P(mean R > 0) from a decayed,
 * sceptical Bayesian estimate over recent closed trades (backend
 * src/domain/risk/directionConfidence.js — pure maths, no AI).
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
import { Compass } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Card, StatusBadge, Chip, Meter, Segmented, Spinner, DataTable, Placeholder } from '../viz/primitives';
import { inr, istDateTime, pnlTone } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useConfirm } from '../confirmContext.js';
import { toast } from '../toastStore.js';
import { sideState } from './directionState.js';
import DirectionGateHistory from './DirectionGateHistory.jsx';
import DocLink from '../DocLink.jsx';

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const pct0 = (v) => (n(v) == null ? '—' : `${Math.round(n(v) * 100)}%`);

const SIDES = [
    { key: 'CE', title: 'CE · bullish buys' },
    { key: 'PE', title: 'PE · bearish buys' },
];

const DECISION_TONE = { ALLOW: 'good', PROBE: 'info', BLOCK: 'critical', THIN: 'muted', UNMEASURED: 'warning', OFF: 'muted' };

// What each decision means, on hover — the chip alone is jargon.
const DECISION_MEANING = {
    ALLOW: 'ALLOW — this side is trusted enough (confidence at or above the floor); the trade goes ahead.',
    BLOCK: 'BLOCK — this side is weak (confidence below the floor). In Shadow it is only recorded; in Enforce (✕) the signal is rejected.',
    PROBE: 'PROBE — the side is weak, but every Nth weak signal is let through on purpose as a test trade, so the side can earn its confidence back.',
    THIN: 'THIN — too few recent trades on this side to judge, so the trade goes ahead.',
    UNMEASURED: 'UNMEASURED — the engine had no fresh confidence reading, so the gate stayed out of the way (fails open).',
    OFF: 'OFF — the gate is switched off; nothing was decided.',
};

// The scorecard verdict badge: its icon is part of the message, not decoration.
const VERDICT_HELP = 'Badge icon: ✓ = blocking would have made money · ✕ = blocking would have cost money · i = information only, not enough data to judge yet (needs 10+ blocked trades).';

function SideBlock({ meta, side, opts, credit }) {
    const st = sideState(side, opts);
    const conf = n(side?.confidence);
    const weak = st.label === 'WEAK';
    const probeEvery = opts?.probeEvery ?? 3;
    const left = weak && credit != null ? Math.max(1, Math.ceil((1 - credit) * probeEvery - 1e-9)) : null;
    return (
        <div className="bg-card-2/40 border border-line/60 rounded-lg p-3 space-y-2" data-testid={`side-${meta.key}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg-3">{meta.title}</span>
                <StatusBadge level={st.level}>{st.label}</StatusBadge>
            </div>
            <Meter value={conf ?? 0.5} max={1} label="Confidence (P mean R > 0)"
                tone={weak ? 'critical' : st.label === 'NEUTRAL' ? 'warning' : 'neutral'}
                caption={`floor ${pct0(opts?.floor)} · 50% = no edge either way`} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-fg-5">
                <span>Trades in window</span><span className="text-fg-3 tabular-nums text-right">{side?.n ?? 0} (eff {n(side?.nEff)?.toFixed(1) ?? '0.0'})</span>
                <span>Win rate (decayed)</span><span className="text-fg-3 tabular-nums text-right">{pct0(side?.winRate)}</span>
                <span>Avg R (decayed)</span><span className="text-fg-3 tabular-nums text-right">{n(side?.meanR) == null ? '—' : n(side.meanR).toFixed(2)}</span>
                <span>Net in window</span><span className={`tabular-nums text-right ${pnlTone(side?.netRs)}`}>{inr(side?.netRs, { sign: true })}</span>
            </div>
            {weak && (
                <p className="text-2xs text-fg-4">
                    Weak side: 1 in {probeEvery} signals goes through as a probe
                    {left != null ? ` — next probe in ${left} signal${left === 1 ? '' : 's'}` : ''}.
                </p>
            )}
        </div>
    );
}

export function DirectionConfidenceView({ data, onMode, onTrackBlocked, busy }) {
    if (!data) return null;
    const { sides, opts, mode, history, scorecard, live, excluded } = data;
    const sc = scorecard || {};
    const wb = sc.wouldBlock || { n: 0 };
    const en = sc.enforce || null;
    // value = book with the gate − book without it (shadow would-blocks + enforce ghosts/knock-ons)
    const verdictLevel = sc.judged != null
        ? (sc.judged >= 10 ? (sc.value > 0 ? 'good' : 'critical') : 'info')
        : (wb.n >= 10 ? (wb.net < 0 ? 'good' : 'critical') : 'info');
    const trackBlocked = opts?.trackBlocked !== false;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs text-fg-5 max-w-xl">
                    {mode === 'enforce' ? 'ENFORCING: weak-side signals are blocked except probes.'
                        : mode === 'off' ? 'Off: no decisions are made or recorded.'
                        : 'Shadow: every entry records what the gate would do; nothing is blocked.'}
                </p>
                <Segmented value={mode} onChange={onMode}
                    options={[
                        { v: 'off', label: 'Off', hint: 'No decisions' },
                        { v: 'shadow', label: 'Shadow', hint: 'Record decisions, never block (recommended)' },
                        { v: 'enforce', label: 'Enforce', hint: 'Block weak-side signals except probes' },
                    ]} />
            </div>
            {onTrackBlocked && (
                <label className="inline-flex items-center gap-2 text-2xs text-fg-4" title="Enforce mode: carry each blocked signal down the real entry path and follow it at real prices (never an order), so the history shows what it would have made">
                    <input type="checkbox" checked={trackBlocked} disabled={busy} onChange={(e) => onTrackBlocked(e.target.checked)} aria-label="Follow blocked trades as ghosts" />
                    Follow blocked trades as ghosts (enforce)
                </label>
            )}
            {busy && <Spinner label="Saving…" />}
            {live?.stale && <StatusBadge level="warning">Engine snapshot is stale or not running — decisions fail open</StatusBadge>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SIDES.map(s => <SideBlock key={s.key} meta={s} side={sides?.[s.key]} opts={opts} credit={live?.credit?.[s.key]} />)}
            </div>

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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                    <p className="text-2xs uppercase tracking-wide text-fg-5 mb-1">Confidence at each session close (IST) <DocLink to="dashboard#direction-confidence" /></p>
                    <DataTable dense rows={(history || []).slice().reverse().map(h => ({ ...h, _key: h.date }))} empty="No sessions yet"
                        columns={[
                            // measured at the 15:40 close; today's row is "so far" until then
                            { key: 'date', header: 'Session', render: r => (r.at
                                ? <span title={r.live ? 'Session still open — this is the reading so far, not the close' : 'Measured at the session close'}>{istDateTime(r.at)}{r.live ? ' (so far)' : ''}</span>
                                : `${r.date}, 15:40`) },
                            { key: 'CE', header: 'CE', align: 'right', render: r => `${pct0(r.CE)} (${r.ceN})` },
                            { key: 'PE', header: 'PE', align: 'right', render: r => `${pct0(r.PE)} (${r.peN})` },
                        ]} />
                </div>
                <div>
                    <p className="text-2xs uppercase tracking-wide text-fg-5 mb-1">Latest gate decisions (engine memory) <DocLink to="dashboard#direction-confidence" /></p>
                    <DataTable dense maxHeight={240} rows={(live?.recent || []).slice(0, 12).map((d, i) => ({ ...d, _key: `${d.at}-${i}` }))}
                        empty={live ? 'No signals since the engine started' : 'Engine not running'}
                        columns={[
                            { key: 'at', header: 'When (IST)', render: r => istDateTime(r.at) },
                            { key: 'side', header: 'Side' },
                            { key: 'strategy', header: 'Strategy', render: r => r.strategy || '—' },
                            { key: 'decision', header: 'Decision', render: r => <Chip tone={DECISION_TONE[r.decision] || 'neutral'} title={[DECISION_MEANING[r.decision], r.enforced ? '✕ = enforced: this signal was actually rejected.' : null, r.reason ? `Engine: ${r.reason}` : null].filter(Boolean).join('\n')}>{r.decision}{r.enforced ? ' ✕' : ''}</Chip> },
                        ]} />
                </div>
            </div>

            <p className="text-3xs text-fg-5">
                Pure maths, no AI: R = net P&L ÷ rupees risked, half-life {opts?.halfLifeSessions} sessions, sceptical prior worth {opts?.priorTrades} trades
                at 0, confidence = P(mean R &gt; 0). Old results fade, so a blocked side drifts back to 50% on its own; winning probes bring it back faster.
                {excluded?.count ? ` ${excluded.count} trade${excluded.count === 1 ? '' : 's'} excluded (${Object.entries(excluded.reasons || {}).map(([k, v]) => `${v} ${k}`).join(', ')}).` : ''}
            </p>
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

    const onTrackBlocked = async (trackBlocked) => {
        setBusy(true);
        try {
            await axios.post(`${API_URL}/analytics/direction-confidence/settings`, { trackBlocked });
            toast.success(trackBlocked ? 'Blocked trades will be followed as ghosts' : 'Ghost tracking off');
            await load();
        } catch (e) {
            toast.error(e?.response?.data?.error || e.message);
        } finally { setBusy(false); }
    };

    return (
        <Card docs="dashboard#direction-confidence" title={<span className="inline-flex items-center gap-2"><Compass className="w-4 h-4" aria-hidden="true" />Direction confidence — CE vs PE</span>}
            subtitle="How much recent trades trust each side; the gate's verdict is stamped on every entry">
            {err && <Placeholder>Could not load direction confidence: {err}</Placeholder>}
            {!data && !err && <Spinner label="Loading direction confidence…" />}
            <DirectionConfidenceView data={data} onMode={onMode} onTrackBlocked={onTrackBlocked} busy={busy} />
            <div className="mt-3"><DirectionGateHistory /></div>
        </Card>
    );
}
