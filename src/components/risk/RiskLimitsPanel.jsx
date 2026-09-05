'use strict';
/**
 * RiskLimitsPanel — turn on the protection that already exists.
 *
 * Every portfolio-greek control in `riskEngine.js` is implemented and tested,
 * defaults to null, and was settable ONLY through LIVE_RISK_* env — meaning a
 * container restart per adjustment and no way to see the current values from
 * the dashboard at all. So the controls that actually bound an options book
 * shipped switched off and invisible.
 *
 * ── THE DESIGN POINT ────────────────────────────────────────────────────────
 * A blank number box invites a guessed limit, and a guessed delta cap is worse
 * than none: it either never fires or it blocks the whole morning. So every
 * control shows what the book is carrying RIGHT NOW next to its input, and the
 * suggestion button proposes a multiple of that observed value rather than a
 * round number someone invented. The engine's own comment says do not guess —
 * this is what makes that possible.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ShieldCheck, Save, RotateCcw } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Card, StatusBadge, Chip, Spinner, Placeholder } from '../viz/primitives';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const fmt = (v) => (n(v) == null ? '—' : Math.round(n(v)).toLocaleString('en-IN'));

/** Which live book number each control should be sized against. */
const OBSERVED = {
    maxNetDeltaRupeesPer1Pct: (b) => Math.abs(n(b?.netDeltaRupeesPer1Pct) ?? n(b?.deltaRupeesPer1Pct) ?? 0),
    maxSameDirectionRiskPer1Pct: (b) => Math.abs(n(b?.sameDirectionRiskPer1Pct) ?? 0),
    maxDeltaPerUnderlyingPer1Pct: (b) => Math.abs(n(b?.maxUnderlyingDeltaPer1Pct) ?? 0),
    maxNetVega: (b) => Math.abs(n(b?.netVega) ?? 0),
    maxGrossVega: (b) => Math.abs(n(b?.grossVega) ?? 0),
    maxThetaBurnPerDay: (b) => Math.abs(n(b?.thetaPerDay) ?? n(b?.theta) ?? 0),
    maxPremiumAtRisk: (b) => Math.abs(n(b?.premiumAtRisk) ?? 0),
    maxPremiumAtRiskPerUnderlying: (b) => Math.abs(n(b?.maxPremiumAtRiskPerUnderlying) ?? 0),
};

const GROUPS = [
    { title: 'Directional risk', hint: 'The caps a position counter cannot express. Nine correlated long-CE bets look diversified to a count and are not.',
      keys: ['maxNetDeltaRupeesPer1Pct', 'maxSameDirectionRiskPer1Pct', 'maxDeltaPerUnderlyingPer1Pct'] },
    { title: 'Volatility & decay', hint: 'What a vol shock or a quiet week actually costs the book.',
      keys: ['maxNetVega', 'maxGrossVega', 'maxThetaBurnPerDay'] },
    { title: 'Capital at risk', hint: 'Premium that could go to zero.',
      keys: ['maxPremiumAtRisk', 'maxPremiumAtRiskPerUnderlying', 'maxExposureRupees'] },
    { title: 'Market conditions', hint: 'Refuse to enter into a bad book or a violent tape.',
      keys: ['maxSpreadPct', 'maxRealizedVolPctPerMin'] },
    { title: 'Counts & rate', hint: 'Necessary, never sufficient — these are runaway guards, not risk limits.',
      keys: ['maxOpenPositions', 'maxOpenPerSymbol', 'maxTradesPerMinute', 'maxEntriesPerSymbolPerMin'] },
];

export default function RiskLimitsPanel() {
    const [data, setData] = useState(null);
    const [draft, setDraft] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/risk/limits`);
            setData(res.data);
            setDraft({ ...(res.data.effective || {}) });
            setMsg(null);
        } catch (e) { setMsg({ tone: 'critical', text: e?.response?.data?.error || e.message }); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const dirty = useMemo(() => {
        if (!data) return false;
        return Object.keys(draft).some(k => String(draft[k] ?? '') !== String(data.effective?.[k] ?? ''));
    }, [draft, data]);

    const save = async () => {
        setSaving(true);
        try {
            // '' / null means OFF — sent explicitly so a cleared box disables the
            // control rather than silently leaving the old value in place.
            const limits = {};
            for (const [k, v] of Object.entries(draft)) limits[k] = (v === '' || v == null) ? null : Number(v);
            const res = await axios.put(`${API_URL}/risk/limits`, { limits });
            setMsg({ tone: res.data.appliedToRunningEngine ? 'positive' : 'warning', text: res.data.note });
            await load();
        } catch (e) { setMsg({ tone: 'critical', text: e?.response?.data?.error || e.message }); }
        finally { setSaving(false); }
    };

    if (loading && !data) return <Card><Spinner label="Reading risk controls…" /></Card>;
    if (!data) return <Card><Placeholder>{msg?.text || 'Could not read risk limits.'}</Placeholder></Card>;

    const book = data.book || {};
    const greekKeys = GROUPS.slice(0, 3).flatMap(g => g.keys);
    const greekOn = greekKeys.filter(k => data.effective?.[k] != null).length;

    return (
        <Card
            title="Portfolio risk controls"
            subtitle={data.precedence}
            right={
                <div className="flex items-center gap-2">
                    <StatusBadge level={greekOn ? 'success' : 'warning'}>
                        {greekOn ? `${greekOn}/${greekKeys.length} greek controls armed` : 'no greek control armed'}
                    </StatusBadge>
                    <button type="button" onClick={load} disabled={saving}
                        className="p-1.5 rounded border border-line text-fg-4 hover:text-fg-2 disabled:opacity-40" aria-label="Reload limits">
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={save} disabled={!dirty || saving}
                        className="px-2.5 py-1.5 rounded bg-primary text-white text-2xs inline-flex items-center gap-1.5 disabled:opacity-40">
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                        {saving ? 'Saving…' : 'Apply'}
                    </button>
                </div>
            }
        >
            {greekOn === 0 && (
                <div className="mb-3 rounded border border-warning/40 bg-warning/10 p-2.5 text-2xs text-fg-3 flex gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                    <span>
                        Every portfolio-greek control is implemented and tested, and all of them are OFF.
                        The engine is running on <b>count caps only</b> — which cannot tell nine correlated
                        long-CE bets from nine independent ones. Size these from the live column, don&apos;t guess.
                    </span>
                </div>
            )}
            {msg && (
                <div className={`mb-3 text-2xs rounded border p-2 ${msg.tone === 'critical' ? 'border-negative/40 bg-negative/10 text-negative'
                    : msg.tone === 'positive' ? 'border-positive/40 bg-positive/10 text-positive' : 'border-warning/40 bg-warning/10 text-fg-3'}`}>
                    {msg.text}
                </div>
            )}

            <div className="space-y-4">
                {GROUPS.map(g => (
                    <div key={g.title}>
                        <div className="text-2xs font-semibold text-fg-2">{g.title}</div>
                        <div className="text-3xs text-fg-5 mb-1.5">{g.hint}</div>
                        <div className="space-y-1">
                            {g.keys.filter(k => k in (data.effective || {})).map(k => {
                                const obs = OBSERVED[k] ? OBSERVED[k](book) : null;
                                const isOff = draft[k] == null || draft[k] === '';
                                return (
                                    <div key={k} className="grid grid-cols-12 gap-2 items-center">
                                        <div className="col-span-5 min-w-0">
                                            <div className="text-2xs text-fg-3 truncate">{k}</div>
                                            <div className="text-3xs text-fg-6 truncate" title={data.controls?.[k]}>{data.controls?.[k]}</div>
                                        </div>
                                        <div className="col-span-3 text-3xs text-fg-5">
                                            {obs != null && obs > 0
                                                ? <>book now <b className="text-fg-3">{fmt(obs)}</b></>
                                                : <span className="text-fg-6">no live reading</span>}
                                        </div>
                                        <div className="col-span-2">
                                            <input
                                                type="number" min="0" inputMode="decimal"
                                                value={draft[k] ?? ''}
                                                placeholder="off"
                                                onChange={(e) => setDraft(d => ({ ...d, [k]: e.target.value === '' ? null : e.target.value }))}
                                                aria-label={k}
                                                className="w-full px-1.5 py-1 rounded border border-line bg-surface-2 text-2xs text-fg-2"
                                            />
                                        </div>
                                        <div className="col-span-2 flex items-center gap-1">
                                            {obs != null && obs > 0 && (
                                                // 2× the observed book: loose enough not to block normal
                                                // trading, tight enough to catch a doubling of exposure.
                                                <button type="button"
                                                    onClick={() => setDraft(d => ({ ...d, [k]: Math.ceil((obs * 2) / 100) * 100 }))}
                                                    title="Suggest 2× the current book reading"
                                                    className="text-3xs text-primary hover:underline">2× book</button>
                                            )}
                                            {isOff && <Chip tone="neutral">off</Chip>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-3 text-3xs text-fg-6">
                Blank = OFF. {data.appliesTo} Changes apply immediately, without a restart.
            </div>
        </Card>
    );
}
