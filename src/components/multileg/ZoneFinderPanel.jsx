'use strict';
/**
 * ZoneFinderPanel — "where should this structure sit?" answered from the option
 * market's own distribution, on the live chain.
 *
 * Calls GET /api/multileg/zone (the same zoneFinder.pickLegs the live engine and
 * the backtester use), draws the implied expiry density with the chosen short
 * strikes, break-evens and the OI levels, shows the scorecard (expected P&L at
 * three tilts, POP, 5% tail, credit, charges, coverage) and the plain-language
 * rationale, and can hand the picked legs to the builder in one click.
 *
 * Two things the panel is careful about:
 *   • OI walls / max pain are drawn GREY and labelled "context": on the archive
 *     they held no more often than any strike at the same distance. The panel
 *     never suggests placing a strike on them.
 *   • The AI review is ADVISORY (shadow). Its verdict is shown with its reasons;
 *     nothing here acts on it. See docs/ZONE_FINDER.md.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Target, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { Card, StatTile, StatRow, DataTable, EmptyState, Segmented, Chip, Spinner } from '../viz/primitives';
import { inr, useChartTheme } from '../viz/tokens';
import ZoomableChart from '../charts/ZoomableChart';
import { API_URL } from '../../config/api.js';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const pct = (v, d = 0) => (n(v) == null ? '—' : `${(n(v) * 100).toFixed(d)}%`);
const TEMPLATE_OPTS = [
    { v: 'zone_strangle', label: 'Strangle', hint: 'two shorts, undefined tail — leg stop is the risk control' },
    { v: 'zone_iron_condor', label: 'Iron condor', hint: 'two shorts + wings zone_wing_steps beyond — bounded tail, lower margin' },
];
const OBJ_OPTS = [
    { v: 'ratio', label: 'EV ÷ tail', hint: 'expected P&L per rupee of 5% tail (default; positive at every entry time tested, smallest tails)' },
    { v: 'ev', label: 'Max EV', hint: 'highest expected P&L — leans towards the money, wider tails' },
    { v: 'pop', label: 'Max POP', hint: 'highest probability of profit — far out, small credit' },
];

export default function ZoneFinderPanel({ symbol, lots = 1, currentLegs = [], onUseLegs }) {
    const ct = useChartTheme();
    const [template, setTemplate] = useState('zone_strangle');
    const [objective, setObjective] = useState('ratio');
    const [rho, setRho] = useState(0.85);
    const [minDelta, setMinDelta] = useState(0.08);
    const [maxDelta, setMaxDelta] = useState(0.45);
    const [wingSteps, setWingSteps] = useState(10);
    const [entryTime, setEntryTime] = useState('11:00');
    const [squareOff, setSquareOff] = useState('15:10');
    const [nonce, setNonce] = useState(0);
    const [res, setRes] = useState({ key: null, data: null, err: null });
    const [ai, setAi] = useState({ busy: false, out: null });
    const [mine, setMine] = useState({ busy: false, out: null });

    const reqKey = useMemo(() => JSON.stringify([symbol, template, objective, rho, minDelta, maxDelta, wingSteps, entryTime, squareOff, lots, nonce]),
        [symbol, template, objective, rho, minDelta, maxDelta, wingSteps, entryTime, squareOff, lots, nonce]);
    useEffect(() => {
        if (!symbol) return undefined;
        let dead = false;
        const params = { symbol, template, zone_objective: objective, zone_rho: rho, zone_min_delta: minDelta, zone_max_delta: maxDelta, entry_time: entryTime, square_off: squareOff, lots };
        if (template === 'zone_iron_condor') params.zone_wing_steps = wingSteps;
        axios.get(`${API_URL}/multileg/zone`, { params })
            .then((r) => { if (!dead) setRes({ key: reqKey, data: r.data, err: null }); })
            .catch((e) => { if (!dead) setRes({ key: reqKey, data: null, err: e?.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [reqKey, symbol, template, objective, rho, minDelta, maxDelta, wingSteps, entryTime, squareOff, lots]);

    const fresh = res.key === reqKey;
    const loading = !fresh;
    const data = fresh ? res.data : null;
    const err = fresh ? res.err : null;
    const pick = data?.pick || null;
    const density = data?.density || null;

    const applyLegs = useCallback((legs) => {
        if (!onUseLegs || !Array.isArray(legs)) return;
        onUseLegs(legs.map((l) => ({ type: l.type, action: l.action, strike: l.strike, ratio: l.ratio || 1 })), data?.expiry || null);
    }, [onUseLegs, data]);
    const applyCandidate = useCallback((c) => {
        // rebuild the template's legs around a candidate's shorts (wings keep their distance)
        if (!pick?.ok) return;
        const legs = pick.legs.map((l) => {
            const shortK = l.type === 'CE' ? c.ce : c.pe;
            if (shortK == null) return l;
            if (l.action === 'SELL') return { ...l, strike: shortK };
            const own = pick.shorts[l.type]?.strike;
            return { ...l, strike: shortK + (l.strike - own) };
        });
        applyLegs(legs);
    }, [pick, applyLegs]);

    const askAi = useCallback(() => {
        if (!pick?.ok) return;
        setAi({ busy: true, out: null });
        axios.post(`${API_URL}/multileg/zone/review`, { symbol, template, pick })
            .then((r) => setAi({ busy: false, out: r.data }))
            .catch((e) => setAi({ busy: false, out: { verdict: 'unavailable', reason: e?.response?.data?.error || e.message } }));
    }, [pick, symbol, template]);
    const scoreMine = useCallback(() => {
        const legs = (currentLegs || []).filter((l) => n(l.strike) > 0).map((l) => ({ type: l.type, action: l.action, strike: n(l.strike), ratio: n(l.ratio) || 1, premium: n(l.premium) || undefined }));
        if (!legs.length) return;
        setMine({ busy: true, out: null });
        axios.post(`${API_URL}/multileg/zone/evaluate`, { symbol, legs, lots, rho, entry_time: entryTime, square_off: squareOff })
            .then((r) => setMine({ busy: false, out: r.data }))
            .catch((e) => setMine({ busy: false, out: { ok: false, reason: e?.response?.data?.error || e.message } }));
    }, [currentLegs, symbol, lots, rho, entryTime, squareOff]);

    // chart rows: density over strike; shaded once, reference lines for the levels
    const curve = useMemo(() => (density?.curve || []).map((p) => ({ k: p.k, f: p.f })), [density]);
    const levels = pick?.market?.levels || null;
    const bes = pick?.stats?.breakevens || [];
    const tip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    const candidateCols = useMemo(() => [
        { key: 'pe', header: 'PE', render: (r) => <span className="text-fg-3">{r.pe ?? '—'}{r.deltas?.pe != null ? <span className="text-fg-6"> Δ{r.deltas.pe}</span> : null}</span> },
        { key: 'ce', header: 'CE', render: (r) => <span className="text-fg-3">{r.ce ?? '—'}{r.deltas?.ce != null ? <span className="text-fg-6"> Δ{r.deltas.ce}</span> : null}</span> },
        { key: 'credit', header: 'Credit', align: 'right', render: (r) => inr(r.credit) },
        { key: 'ev', header: 'EV', align: 'right', render: (r) => <span style={{ color: r.ev > 0 ? ct.diverging.positive : ct.diverging.negative }}>{inr(r.ev)}</span> },
        { key: 'pop', header: 'POP', align: 'right', render: (r) => pct(r.pop) },
        { key: 'cvar5', header: '5% tail', align: 'right', render: (r) => inr(r.cvar5) },
        { key: 'score', header: 'Score', align: 'right', render: (r) => <span className="text-fg-4">{r.score}</span> },
        { key: 'use', header: '', render: (r) => <button type="button" onClick={() => applyCandidate(r)} className="text-2xs text-primary hover:underline">use</button> },
    ], [ct, applyCandidate]);
    const candidateRows = useMemo(() => (pick?.candidates || []).map((c, i) => ({ ...c, _key: `${c.pe}-${c.ce}-${i}` })), [pick]);

    return (
        <Card
            title={<span className="inline-flex items-center gap-2"><Target className="w-4 h-4 text-primary" aria-hidden="true" />Zone finder — strikes from the market's distribution</span>}
            subtitle="The smile across strikes IS the market's forecast. The finder reprices every candidate pair at the planned exit, sold at bid with real charges, and picks by expected P&L per rupee of tail. It declines when nothing clears zero."
            right={(
                <div className="flex items-center gap-2">
                    {data && <Chip tone={data.stale ? 'warning' : 'neutral'} title={`chain source: ${data.source}`}>{data.source}</Chip>}
                    {data?.preview && <Chip tone="info" title={`Market closed — previewing the next session's ${entryTime} entry on the latest chain`}>preview {new Date(data.entryAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Chip>}
                    <button type="button" onClick={() => setNonce((x) => x + 1)} className="px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-4 hover:text-fg inline-flex items-center gap-1" title="Re-run on the latest chain">
                        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> Refresh
                    </button>
                </div>
            )}
        >
            {/* controls */}
            <div className="flex flex-wrap items-end gap-3 text-xs mb-3">
                <div><div className="text-3xs text-fg-5 mb-0.5">Structure</div><Segmented options={TEMPLATE_OPTS} value={template} onChange={setTemplate} /></div>
                <div><div className="text-3xs text-fg-5 mb-0.5">Choose by</div><Segmented options={OBJ_OPTS} value={objective} onChange={setObjective} /></div>
                <label className="text-fg-5" title="realised/implied tilt of the horizon distribution. 0.85 reproduced realised P&L and win rate on the archive; 1.0 = take the market at its word">tilt ρ
                    <input type="number" step="0.05" min="0.4" max="1.5" value={rho} onChange={(e) => setRho(Number(e.target.value) || 0.85)} className="block w-20 mt-0.5 bg-card-2 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="short strikes must have |delta| inside this band">Δ min
                    <input type="number" step="0.01" min="0.02" max="0.5" value={minDelta} onChange={(e) => setMinDelta(Number(e.target.value) || 0.08)} className="block w-16 mt-0.5 bg-card-2 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5">Δ max
                    <input type="number" step="0.01" min="0.05" max="0.6" value={maxDelta} onChange={(e) => setMaxDelta(Number(e.target.value) || 0.45)} className="block w-16 mt-0.5 bg-card-2 border border-line rounded p-1 text-fg-2" />
                </label>
                {template === 'zone_iron_condor' && (
                    <label className="text-fg-5" title="wings this many strike steps beyond each short">wing steps
                        <input type="number" step="1" min="1" max="30" value={wingSteps} onChange={(e) => setWingSteps(Number(e.target.value) || 10)} className="block w-16 mt-0.5 bg-card-2 border border-line rounded p-1 text-fg-2" />
                    </label>
                )}
                <label className="text-fg-5" title="the entry the horizon is measured from">entry
                    <input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value || '11:00')} className="block mt-0.5 bg-card-2 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="planned exit — every candidate is repriced at this time">exit
                    <input type="time" value={squareOff} onChange={(e) => setSquareOff(e.target.value || '15:10')} className="block mt-0.5 bg-card-2 border border-line rounded p-1 text-fg-2" />
                </label>
            </div>

            {err ? (
                <EmptyState title="Zone finder unavailable">{String(err)}</EmptyState>
            ) : loading && !data ? (
                <div className="py-6"><Spinner label="Reading the chain and scoring every strike pair…" /></div>
            ) : !pick ? (
                <EmptyState title="No result">The server returned no pick.</EmptyState>
            ) : (
                <div className="space-y-3">
                    {/* market line */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-4">
                        <span>spot <b className="text-fg-2 tabular-nums">{pick.market?.spot}</b></span>
                        <span>forward <b className="text-fg-2 tabular-nums">{pick.market?.forward}</b> <span className="text-fg-6">(basis {pick.market?.basisPts > 0 ? '+' : ''}{pick.market?.basisPts})</span></span>
                        <span>ATM IV <b className="text-fg-2 tabular-nums">{pick.market?.atmIvPct}%</b> <span className="text-fg-6">skew {pick.market?.skew}</span></span>
                        <span>expected move to exit <b className="text-fg-2 tabular-nums">±{pick.market?.emExitPts}</b>, to expiry <b className="text-fg-2 tabular-nums">±{pick.market?.emExpiryPts}</b></span>
                        <span>expiry <b className="text-fg-2">{data.expiry}</b> · {pick.market?.dteTrading} sessions · horizon {pick.market?.horizonSessions} sessions</span>
                        <span className="text-fg-6">{data.chainStrikes} strikes · {pick.market?.smilePoints} in the smile fit</span>
                    </div>

                    {pick.ok ? (
                        <>
                            {/* density + levels */}
                            {curve.length > 10 && (
                                <div>
                                    <div className="text-2xs text-fg-5 mb-1">Market-implied density of the close at expiry. Coloured lines: the chosen shorts. Dotted: break-evens. Grey: OI walls and max pain, drawn for context only.</div>
                                    <ZoomableChart data={curve} height={200}>
                                        <ComposedChart margin={{ top: 8, right: 12, bottom: 2, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                            <XAxis dataKey="k" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={(v) => Math.round(v)} />
                                            <YAxis hide />
                                            <Tooltip contentStyle={tip} formatter={(v) => [Number(v).toExponential(2), 'density']} labelFormatter={(l) => `strike ${Math.round(l)}`} />
                                            <Area type="monotone" dataKey="f" stroke={ct.mark.equity} fill={ct.mark.equity} fillOpacity={0.15} dot={false} isAnimationActive={false} />
                                            {pick.market?.forward && <ReferenceLine x={pick.market.forward} stroke={ct.axis} strokeDasharray="4 4" label={{ value: 'fwd', fontSize: 9, fill: ct.text.secondary, position: 'top' }} />}
                                            {pick.shorts?.PE && <ReferenceLine x={pick.shorts.PE.strike} stroke={ct.categorical[1]} strokeWidth={2} label={{ value: `${pick.shorts.PE.strike} PE`, fontSize: 9, fill: ct.categorical[1], position: 'insideTopLeft' }} />}
                                            {pick.shorts?.CE && <ReferenceLine x={pick.shorts.CE.strike} stroke={ct.categorical[0]} strokeWidth={2} label={{ value: `${pick.shorts.CE.strike} CE`, fontSize: 9, fill: ct.categorical[0], position: 'insideTopRight' }} />}
                                            {bes.map((b) => <ReferenceLine key={`be${b}`} x={b} stroke={ct.status.warning} strokeDasharray="2 3" label={{ value: 'BE', fontSize: 8, fill: ct.status.warning, position: 'bottom' }} />)}
                                            {levels?.ceWall && <ReferenceLine x={levels.ceWall.strike} stroke={ct.text.secondary} strokeOpacity={0.5} strokeDasharray="1 3" label={{ value: 'OI wall', fontSize: 8, fill: ct.text.secondary, position: 'top' }} />}
                                            {levels?.peWall && <ReferenceLine x={levels.peWall.strike} stroke={ct.text.secondary} strokeOpacity={0.5} strokeDasharray="1 3" label={{ value: 'OI wall', fontSize: 8, fill: ct.text.secondary, position: 'top' }} />}
                                            {levels?.maxPain && <ReferenceLine x={levels.maxPain} stroke={ct.text.secondary} strokeOpacity={0.35} label={{ value: 'max pain', fontSize: 8, fill: ct.text.secondary, position: 'bottom' }} />}
                                        </ComposedChart>
                                    </ZoomableChart>
                                </div>
                            )}

                            {/* scorecard */}
                            <StatRow cols={4}>
                                <StatTile label={`Expected P&L (ρ ${pick.stats.rho})`} hero value={inr(pick.stats.ev)} tone={pick.stats.ev > 0 ? 'positive' : 'negative'}
                                    hint={`risk-neutral ${inr(pick.stats.evAt?.rn)} · conservative ${inr(pick.stats.evAt?.conservative)} · after ${inr(pick.stats.chargesEst)} charges`} />
                                <StatTile label="Probability of profit" value={pct(pick.stats.pop, 1)} hint={`at exit; risk-neutral ${pct(pick.stats.popAt?.rn, 0)}`} />
                                <StatTile label="Worst 5% of outcomes" value={inr(pick.stats.cvar5)} tone="negative" hint={pick.stats.unbounded ? 'tail UNBOUNDED — the leg stop is the control' : `max loss ${inr((pick.stats.maxLossUnit || 0) * pick.stats.lotSize * pick.stats.lots)}`} />
                                <StatTile label="Credit" value={inr(pick.stats.creditRupees)} hint={`${pick.stats.creditUnit}/unit · ${pick.stats.lots} lot(s) of ${pick.stats.lotSize}`} />
                            </StatRow>
                            <StatRow cols={4}>
                                <StatTile label="Short PE" value={pick.shorts.PE ? String(pick.shorts.PE.strike) : '—'} hint={pick.shorts.PE ? `Δ ${Math.abs(pick.shorts.PE.delta).toFixed(2)} · ${pick.shorts.PE.sigmasAway}σ below · IV ${pick.shorts.PE.iv}% · bid ${pick.shorts.PE.bid}` : ''} />
                                <StatTile label="Short CE" value={pick.shorts.CE ? String(pick.shorts.CE.strike) : '—'} hint={pick.shorts.CE ? `Δ ${Math.abs(pick.shorts.CE.delta).toFixed(2)} · ${pick.shorts.CE.sigmasAway}σ above · IV ${pick.shorts.CE.iv}% · bid ${pick.shorts.CE.bid}` : ''} />
                                <StatTile label="Break-evens" value={bes.length ? bes.map((b) => Math.round(b)).join(' / ') : '—'} hint={pick.stats.beHalfWidthPct != null ? `half-width ${pick.stats.beHalfWidthPct}% of spot` : ''} />
                                <StatTile label="Expiry density inside BEs" value={pct(pick.stats.expiryCoverage, 0)} hint={`${pick.rejected} candidate(s) rejected · ${pick.candidates?.length || 0} ranked`} />
                            </StatRow>

                            {/* rationale */}
                            <ul className="text-2xs text-fg-4 space-y-1 list-disc pl-4">
                                {(pick.rationale || []).map((r, i) => <li key={i}>{r}</li>)}
                            </ul>

                            {/* actions */}
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={() => applyLegs(pick.legs)} className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-semibold inline-flex items-center gap-1.5" title="Load these legs into the builder">
                                    <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Use these strikes
                                </button>
                                {currentLegs?.length > 0 && (
                                    <button type="button" onClick={scoreMine} disabled={mine.busy} className="px-3 py-1.5 rounded border border-line-2 bg-card-2 text-xs text-fg-3 hover:text-fg disabled:opacity-50" title="Score the legs currently in the builder with the same model">
                                        {mine.busy ? 'Scoring…' : 'Score my legs'}
                                    </button>
                                )}
                                <button type="button" onClick={askAi} disabled={ai.busy} className="px-3 py-1.5 rounded border border-line-2 bg-card-2 text-xs text-fg-3 hover:text-fg disabled:opacity-50 inline-flex items-center gap-1.5" title="Advisory only: an AI reviewer checks event risk, directional tilt and data quality. It cannot change the arithmetic.">
                                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> {ai.busy ? 'Asking…' : 'Ask AI (advisory)'}
                                </button>
                            </div>
                            {mine.out && (
                                <div className="text-2xs text-fg-4 border border-line-0 rounded p-2">
                                    {mine.out.ok
                                        ? <>Your legs at ρ {mine.out.rho}: expected P&L <b style={{ color: mine.out.ev > 0 ? ct.diverging.positive : ct.diverging.negative }}>{inr(mine.out.ev)}</b>, POP {pct(mine.out.pop, 1)}, worst 5% {inr(mine.out.cvar5)}, charges {inr(mine.out.charges)}.</>
                                        : <>Could not score your legs: {mine.out.reason}</>}
                                </div>
                            )}
                            {ai.out && (
                                <div className="text-2xs border border-line-0 rounded p-2 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Chip tone={ai.out.verdict === 'agree' ? 'good' : ai.out.verdict === 'skip' ? 'critical' : ai.out.verdict === 'adjust' ? 'warning' : 'muted'}>AI: {ai.out.verdict}</Chip>
                                        {ai.out.confidence != null && <span className="text-fg-5">confidence {Math.round(ai.out.confidence * 100)}%</span>}
                                        {ai.out.model && <span className="text-fg-6">{ai.out.model} · {ai.out.latencyMs ?? ai.out.latency_ms} ms</span>}
                                        <span className="text-fg-6">advisory — the entry does not act on this</span>
                                    </div>
                                    {ai.out.reason && <div className="text-fg-5">{ai.out.reason}</div>}
                                    {(ai.out.reasons || []).map((r, i) => <div key={i} className="text-fg-4">• {r}</div>)}
                                    {(ai.out.eventRisks || ai.out.event_risks || []).map((r, i) => <div key={`e${i}`} className="text-warning">⚠ {r}</div>)}
                                </div>
                            )}

                            {/* candidates */}
                            {candidateRows.length > 1 && (
                                <div>
                                    <div className="text-2xs text-fg-5 mb-1">Top candidates by the chosen objective — click <span className="text-primary">use</span> to take one instead.</div>
                                    <DataTable columns={candidateCols} rows={candidateRows} dense />
                                </div>
                            )}
                            <div className="text-3xs text-fg-6">{levels?.noteworthy}</div>
                        </>
                    ) : (
                        <EmptyState icon={Target} title="The finder declined to place a zone">
                            {pick.reason}. {pick.params?.zone_objective ? `Objective ${pick.params.zone_objective}, tilt ${pick.params.zone_rho}.` : ''} A declined day is the model working: the premium on offer does not pay for the tail it carries.
                        </EmptyState>
                    )}
                </div>
            )}
        </Card>
    );
}
