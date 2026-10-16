/**
 * RegimePanel — "is today a day for this structure?" for the multileg book.
 *
 * Pure maths, no AI (backend src/domain/regime/regime.js). What the research allowed:
 * HOW MUCH the market moves after the entry time is modestly predictable (morning range,
 * yesterday's range, 5d vs 20d realised vol); WHICH WAY it moves is not. So the panel
 * reads quiet / normal / wild, matches each structure's measured one-year profile to it,
 * and recommends FULL / HALF / STAND ASIDE — in SHADOW: recorded on every entry, never
 * acted on, and scored here so you can see whether acting would have helped.
 */
import React, { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { Compass, RefreshCw } from 'lucide-react';
import { API_URL } from '../../config/api.js';
import { Card, Chip, Meter, Segmented, Spinner, Placeholder, StatusBadge, DataTable } from '../viz/primitives';
import { inr, istDateTime, pnlTone } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';
import useRemWidth from '../../hooks/useRemWidth.js';
import { toast } from '../toastStore.js';
import { pct0, tierTone, actionTone, ACTION_LABEL, shortSym, bookWarning } from './regimeFormat.js';

function SymbolRead({ s }) {
    const rd = s.read || {};
    return (
        <div className="rounded-lg border border-line/60 bg-card-2/40 p-3 space-y-2" data-testid={`read-${shortSym(s.symbol)}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg-2">{shortSym(s.symbol)}</span>
                <Chip tone={tierTone(rd)}>{rd.unmeasured ? 'NO READ' : rd.label}</Chip>
            </div>
            {rd.unmeasured ? (
                <p className="text-2xs text-fg-5">{rd.unmeasured}</p>
            ) : (
                <>
                    <Meter value={rd.probs?.quiet ?? 0} max={1} label="P(quiet afternoon)" />
                    <Meter value={rd.probs?.wild ?? 0} max={1} label="P(wild afternoon)" tone={rd.tier === 'high' ? 'critical' : 'neutral'}
                        caption={`slot ${rd.slot} · ${rd.n} past days in this tier · base rate 33%`} />
                    <p className="text-3xs text-fg-5">
                        morning range {pct0(rd.components?.morningRangePct)} · yesterday {pct0(rd.components?.prevRangePct)} · 5d/20d vol {pct0(rd.components?.rvRatioPct)} (percentiles vs its year)
                    </p>
                </>
            )}
            {s.lean && s.lean.z != null && (
                <p className="text-3xs text-fg-5" title={s.lean.note}>
                    Direction lean: <b>{s.lean.lean}</b> (20d z {s.lean.z}) — <span className="text-warning">not reliable, display only</span>
                </p>
            )}
            {s.event && <StatusBadge level="warning">Event day: {s.event.label}</StatusBadge>}
        </div>
    );
}

function FitCards({ rows }) {
    return (
        <div className="space-y-2">
            {rows.map(r => (
                <div key={r.id} className="rounded-lg border border-line/60 p-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-fg-2">{r.name}</span>
                        <Chip tone="muted">{r.kind === 'deployment' ? 'deployed' : 'saved'}</Chip>
                        <Chip tone={actionTone(r.fit?.action)} title={r.fit?.reason}>{ACTION_LABEL[r.fit?.action] || r.fit?.action}</Chip>
                    </div>
                    <p className="text-2xs text-fg-4">{shortSym(r.symbol)} · {r.template} · {r.exposure ? `${r.exposure.direction} / ${r.exposure.vol}` : '—'}</p>
                    <p className="text-2xs text-fg-3">{r.needs || 'no profile yet'}</p>
                    {r.fp && <p className="text-3xs text-fg-5">1y avg {inr(r.fp.mean, { sign: true })}/lot · quiet {inr(r.fp.byTier?.quiet?.mean)} · normal {inr(r.fp.byTier?.normal?.mean)} · wild {inr(r.fp.byTier?.wild?.mean)}</p>}
                </div>
            ))}
        </div>
    );
}

export function RegimeView({ data, onMode, onRebuild, busy, narrow }) {
    const [scope, setScope] = useState('deployment');
    if (!data) return null;
    const rows = (data.rows || []).filter(r => scope === 'all' || r.kind === scope);
    const warn = bookWarning(data.book, data.symbols);
    const cal = data.scorecard?.calibration || {};
    const ver = data.scorecard?.verdicts || {};
    const job = data.job || {};
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs text-fg-5 max-w-2xl">
                    {data.mode === 'off' ? 'Off: no reads are made or recorded.'
                        : 'Shadow: every multileg entry records this read and verdict; nothing is resized or blocked. Enforcement unlocks only once the scorecard below shows it helps.'}
                </p>
                <div className="flex items-center gap-2">
                    <Segmented value={data.mode} onChange={onMode} options={[{ v: 'off', label: 'Off' }, { v: 'shadow', label: 'Shadow' }]} />
                    <button type="button" onClick={onRebuild} disabled={job.running || busy}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50"
                        title="Replay every active deployment and saved strategy over the last year (takes a few minutes)">
                        <RefreshCw className={`w-3.5 h-3.5 ${job.running ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {job.running ? `Rebuilding… ${job.progress?.done ?? 0}/${job.progress?.total ?? '?'}` : 'Rebuild profiles'}
                    </button>
                </div>
            </div>
            <p className="text-3xs text-fg-5">
                Profiles built {data.profiles?.builtAt ? istDateTime(data.profiles.builtAt) : 'never'} · {data.profiles?.fingerprints ?? 0} structures · calibrated: {(data.profiles?.calibrated || []).map(shortSym).join(', ') || 'none'}
                {job.error ? ` · last rebuild failed: ${job.error}` : ''}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {(data.symbols || []).map(s => <SymbolRead key={s.symbol} s={s} />)}
            </div>

            {Object.keys(data.book || {}).length > 0 && (
                <div className="rounded-lg border border-line/60 p-3 space-y-1" data-testid="book">
                    <div className="text-xs font-semibold text-fg-2">Open book exposure</div>
                    {Object.entries(data.book).map(([m, b]) => (
                        <p key={m} className="text-2xs text-fg-4">
                            {m}: {b.structures} structure{b.structures === 1 ? '' : 's'} · Δ {inr(b.delta, { sign: true })}/pt · vega {inr(b.vega, { sign: true })}/IV-pt · θ {inr(b.theta, { sign: true })}/day · {b.shortVol} short-vol / {b.longVol} long-vol
                        </p>
                    ))}
                    {warn && <StatusBadge level="warning">{warn}</StatusBadge>}
                </div>
            )}

            <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-fg-2">Structure fit for today</span>
                    <Segmented value={scope} onChange={setScope} options={[{ v: 'deployment', label: 'Deployed' }, { v: 'strategy', label: 'Saved' }, { v: 'all', label: 'All' }]} />
                </div>
                {narrow ? <FitCards rows={rows} /> : (
                    <DataTable dense maxHeight={420} rows={rows.map(r => ({ ...r, _key: r.id }))} empty="No structures — deploy or save one, then rebuild profiles"
                        columns={[
                            { key: 'name', header: 'Structure', render: r => <span className="whitespace-normal"><span className="text-fg-2">{r.name}</span> <Chip tone="muted">{r.kind === 'deployment' ? 'deployed' : 'saved'}</Chip></span> },
                            { key: 'symbol', header: 'Index', render: r => shortSym(r.symbol) },
                            { key: 'exposure', header: 'Exposure', render: r => (r.exposure ? `${r.exposure.direction} · ${r.exposure.vol}` : '—') },
                            { key: 'needs', header: 'What it needs (1y replay)', render: r => <span className="whitespace-normal text-fg-3">{r.needs || 'no profile yet'}</span> },
                            { key: 'fp', header: 'Avg ₹/lot quiet · normal · wild', align: 'right', render: r => (r.fp ? `${inr(r.fp.byTier?.quiet?.mean)} · ${inr(r.fp.byTier?.normal?.mean)} · ${inr(r.fp.byTier?.wild?.mean)}` : '—') },
                            { key: 'fit', header: 'Today (shadow)', render: r => <span title={r.fit?.reason}><Chip tone={actionTone(r.fit?.action)}>{ACTION_LABEL[r.fit?.action] || r.fit?.action}</Chip>{r.fit?.expected != null ? <span className={`ml-1 text-3xs ${pnlTone(r.fit.expected)}`}>{inr(r.fit.expected, { sign: true })}</span> : null}</span> },
                        ]} />
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="scorecard">
                <div className="rounded-lg border border-line/60 p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-fg-2">Is the read right? (daily 11:00 read vs the afternoon)</span>
                        <Chip tone={cal.scored >= 20 ? ((cal.wildAfterWildRead || 0) > 0.4 ? 'good' : 'critical') : 'muted'}>{cal.verdict || '—'}</Chip>
                    </div>
                    <p className="text-2xs text-fg-4">
                        {cal.scored ?? 0} scored ({cal.pending ?? 0} pending). After a wild-leaning read the afternoon was wild <b>{pct0(cal.wildAfterWildRead)}</b> of the time (base 33%);
                        after a quiet-leaning read it was quiet <b>{pct0(cal.quietAfterQuietRead)}</b>. Brier {cal.brier ?? '—'} (no-skill ≈ {cal.brierNoSkill}).
                    </p>
                </div>
                <div className="rounded-lg border border-line/60 p-3 space-y-1">
                    <span className="text-xs font-semibold text-fg-2">Would acting on it have helped? (real trades)</span>
                    <p className="text-2xs text-fg-4">
                        {Object.entries(ver.byAction || {}).map(([a, v]) => `${ACTION_LABEL[a] || a}: ${v.n} trades, ${inr(v.net, { sign: true })}`).join(' · ') || 'No recorded verdicts yet — they start with the first multileg entry after deploy.'}
                    </p>
                    <p className="text-2xs text-fg-3">
                        Half-size on HALF trades would have changed P&L by <span className={pnlTone(ver.halfSizeEffect)}>{inr(ver.halfSizeEffect, { sign: true })}</span>;
                        standing aside on STAND ASIDE trades by <span className={pnlTone(ver.standAsideEffect)}>{inr(ver.standAsideEffect, { sign: true })}</span>.
                        {ver.unrecorded ? ` ${ver.unrecorded} trades have no recorded verdict.` : ''}
                    </p>
                </div>
            </div>

            <p className="text-3xs text-fg-5">{data.method} Replay profiles use synthetic option prices (one IV per day): read the ordering of quiet/normal/wild, not the ₹ level.</p>
        </div>
    );
}

export default function RegimePanel() {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const load = useCallback(async () => {
        try { const r = await axios.get(`${API_URL}/multileg/regime`); setData(r.data); setErr(null); }
        catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, []);
    usePolling(load, data?.job?.running ? 5000 : 60000);
    const onMode = async (mode) => {
        if (!data || mode === data.mode) return;
        setBusy(true);
        try { await axios.post(`${API_URL}/multileg/regime/settings`, { mode }); toast.success(`Regime read: ${mode}`); await load(); }
        catch (e) { toast.error(e?.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };
    const onRebuild = async () => {
        setBusy(true);
        try { await axios.post(`${API_URL}/multileg/regime/rebuild`); toast.info('Rebuilding regime profiles — a few minutes'); await load(); }
        catch (e) { toast.error(e?.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };
    return (
        <div ref={ref} className="mb-4">
            <Card docs="multi-leg#deploy-regime" title={<span className="inline-flex items-center gap-2"><Compass className="w-4 h-4" aria-hidden="true" />Market regime & structure fit</span>}
                subtitle="Pure maths, shadow mode — what kind of afternoon is likely, and which structures suit it">
                {err && <Placeholder>Could not load the regime read: {err}</Placeholder>}
                {!data && !err && <Spinner label="Loading regime read…" />}
                <RegimeView data={data} onMode={onMode} onRebuild={onRebuild} busy={busy} narrow={rem != null && rem < 70} />
            </Card>
        </div>
    );
}
