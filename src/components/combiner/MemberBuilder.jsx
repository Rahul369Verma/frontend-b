import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Chip, Spinner } from '../viz/primitives';
import DocLink from '../DocLink.jsx';
import {
    getCombinerMembers, resolveCombinerMembers, getDeployments, getOptimizerJobs, getCombinerCandidates,
    parseMembers, sourceLabel,
} from './combinerApi.js';

/**
 * The members of a Signal Combiner: which strategies vote, with which frozen parameters
 * (code defaults, a preset, a deployment's params or an optimizer row), in which role and
 * with what weight. Every edit is resolved by the backend into the exact parameter sets that
 * will run; only a clean resolve is written back to the form, and errors are shown, never
 * swallowed. Also writes the data the members need (use_15m_filter / use_1h_filter).
 */
export default function MemberBuilder({ value, resolution = '5', onChange }) {
    const [catalog, setCatalog] = useState(null);
    const [catalogError, setCatalogError] = useState(null);
    const [rows, setRows] = useState(() => parseMembers(value));
    const [resolved, setResolved] = useState(null);
    const [resolving, setResolving] = useState(false);
    const [deployments, setDeployments] = useState(null);
    const [jobs, setJobs] = useState(null);
    const [jobId, setJobId] = useState('');
    const [candidates, setCandidates] = useState(null);
    const [addStrategy, setAddStrategy] = useState('');
    const lastSent = useRef(null);
    const onChangeRef = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
        let alive = true;
        getCombinerMembers().then(c => { if (alive) setCatalog(c); }).catch(e => { if (alive) setCatalogError(e.message); });
        return () => { alive = false; };
    }, []);

    // Re-resolve after every edit (debounced); write back only a clean result.
    useEffect(() => {
        if (!rows.length) { setResolved({ ok: false, members: [], errors: [{ index: null, error: 'Add at least one member.' }] }); return undefined; }
        const t = setTimeout(async () => {
            setResolving(true);
            try {
                const r = await resolveCombinerMembers({ members: rows, resolution });
                setResolved(r);
                if (r.ok) {
                    const json = JSON.stringify(r.members);
                    if (json !== lastSent.current) {
                        lastSent.current = json;
                        onChangeRef.current?.(json, r.dataNeeds);
                    }
                }
            } catch (e) {
                setResolved({ ok: false, members: [], errors: [{ index: null, error: e.response?.data?.error || e.message }] });
            } finally { setResolving(false); }
        }, 400);
        return () => clearTimeout(t);
    }, [rows, resolution]);

    const eligible = catalog?.eligible || [];
    const presetsOf = (id) => (eligible.find(e => e.id === id)?.presets || []);
    const errorsAt = (i) => (resolved?.errors || []).filter(e => e.index === i);
    const resolvedAt = (i) => {
        if (!resolved?.ok) return null;
        return resolved.members[i] || null;
    };

    const update = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const remove = (i) => setRows(rs => rs.filter((_, k) => k !== i));
    const setSource = (i, v) => {
        // A new source means new parameters: drop the frozen ones so the backend resolves afresh.
        if (v === 'defaults') update(i, { source: { kind: 'defaults' }, params: undefined });
        else if (v.startsWith('preset:')) update(i, { source: { kind: 'preset', ref: v.slice(7) }, params: undefined });
        else if (v === 'deployment') {
            update(i, { source: { kind: 'deployment', ref: null }, params: undefined });
            if (!deployments) getDeployments().then(setDeployments).catch(() => setDeployments([]));
        }
    };
    const sourceValue = (r) => {
        const k = r.source?.kind;
        if (!k || k === 'defaults') return 'defaults';
        if (k === 'preset') return `preset:${r.source.ref}`;
        return k;
    };

    const loadJobs = () => { if (!jobs) getOptimizerJobs().then(j => setJobs(Array.isArray(j) ? j : (j.jobs || []))).catch(() => setJobs([])); };
    useEffect(() => {
        if (!jobId) { setCandidates(null); return; }
        let alive = true;
        getCombinerCandidates(jobId).then(c => { if (alive) setCandidates(c); }).catch(e => { if (alive) setCandidates({ candidates: [], skipped: [], error: e.message }); });
        return () => { alive = false; };
    }, [jobId]);

    const memberDeployments = useMemo(() => (deployments || []), [deployments]);

    if (catalogError) return <p className="text-xs text-danger">Member list unavailable: {catalogError}</p>;
    if (!catalog) return <Spinner label="Loading member strategies…" />;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-fg-4">Members <span className="text-fg-5">({rows.length})</span> <DocLink to="signal-combiner#members" /></span>
                <span className="text-3xs text-fg-5">{resolving ? 'checking…' : resolved?.ok ? '✓ applied' : resolved ? 'not applied — fix the errors below' : ''}</span>
            </div>

            {rows.map((r, i) => {
                const rm = resolvedAt(i);
                const errs = errorsAt(i);
                return (
                    <div key={i} className="rounded-lg border border-line bg-card-2/40 p-2 space-y-2">
                        <div className="flex flex-wrap items-end gap-2">
                            <label className="flex flex-col gap-0.5 min-w-[10rem] flex-1">
                                <span className="text-3xs text-fg-5">Strategy</span>
                                <select className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.strategy}
                                    onChange={e => update(i, { strategy: e.target.value, source: { kind: 'defaults' }, params: undefined, id: undefined })}>
                                    {!eligible.some(x => x.id === r.strategy) && <option value={r.strategy}>{r.strategy} (not eligible)</option>}
                                    {eligible.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                                </select>
                            </label>
                            <label className="flex flex-col gap-0.5 min-w-[10rem] flex-1">
                                <span className="text-3xs text-fg-5">Parameters from</span>
                                {r.source?.kind === 'optimizer' || r.source?.kind === 'custom' ? (
                                    <span className="text-xs text-fg-3 py-1.5">{sourceLabel(r.source)}</span>
                                ) : (
                                    <select className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={sourceValue(r)} onChange={e => setSource(i, e.target.value)}>
                                        <option value="defaults">Code defaults</option>
                                        {presetsOf(r.strategy).map(p => <option key={p.id} value={`preset:${p.id}`}>Preset: {p.label}{p.evidence ? ` (${p.evidence})` : ''}</option>)}
                                        <option value="deployment">A deployment's params…</option>
                                    </select>
                                )}
                            </label>
                            <label className="flex flex-col gap-0.5 w-[7rem]">
                                <span className="text-3xs text-fg-5">Role</span>
                                <select className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.role || 'voter'} onChange={e => update(i, { role: e.target.value })}>
                                    {(catalog.roles || []).map(x => <option key={x.id} value={x.id} title={x.description}>{x.id}</option>)}
                                </select>
                            </label>
                            <label className="flex flex-col gap-0.5 w-[5rem]">
                                <span className="text-3xs text-fg-5">Weight</span>
                                <input type="number" step="0.25" min="0" className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg"
                                    value={r.weight ?? 1} onChange={e => update(i, { weight: e.target.value === '' ? '' : Number(e.target.value) })} />
                            </label>
                            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${r.strategy}`}
                                className="p-1.5 rounded border border-line text-fg-5 hover:text-danger hover:border-danger/40">
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                        </div>
                        {r.source?.kind === 'deployment' && (
                            <select className="w-full bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={r.source.ref || ''}
                                onChange={e => update(i, { source: { kind: 'deployment', ref: e.target.value }, params: undefined })}>
                                <option value="">{deployments ? 'Pick a deployment of this strategy…' : 'Loading deployments…'}</option>
                                {memberDeployments.filter(d => d.strategyName === r.strategy).map(d => (
                                    <option key={d._id} value={d._id}>{d.name} · {d.symbol}{d.isActive ? '' : ' (inactive)'}</option>
                                ))}
                            </select>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-3xs text-fg-5">
                            {rm && <Chip tone="muted" title="The id this member votes under">{rm.id}</Chip>}
                            {rm && <Chip tone="muted" title="Fingerprint of the exact parameters that will run">#{rm.hash}</Chip>}
                            {rm && <span>{sourceLabel(rm.source)}</span>}
                            {errs.map((e, k) => <span key={k} className="text-danger">✕ {e.error}</span>)}
                        </div>
                    </div>
                );
            })}

            <div className="flex flex-wrap items-end gap-2">
                <select aria-label="Strategy to add" className="bg-slate-900 border border-line rounded p-1.5 text-xs text-fg flex-1 min-w-[10rem]" value={addStrategy} onChange={e => setAddStrategy(e.target.value)}>
                    <option value="">Add a member…</option>
                    {eligible.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <button type="button" disabled={!addStrategy} onClick={() => { setRows(rs => [...rs, { strategy: addStrategy, role: 'voter', weight: 1, source: { kind: 'defaults' } }]); setAddStrategy(''); }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50">
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add
                </button>
            </div>

            <details className="rounded border border-line/60 p-2" onToggle={e => { if (e.currentTarget.open) loadJobs(); }}>
                <summary className="text-xs text-fg-4 cursor-pointer">Add from a saved optimizer run (settings that held up out-of-sample)</summary>
                <div className="mt-2 space-y-2">
                    <select aria-label="Optimizer run" className="w-full bg-slate-900 border border-line rounded p-1.5 text-xs text-fg" value={jobId} onChange={e => setJobId(e.target.value)}>
                        <option value="">{jobs ? 'Pick a run…' : 'Loading runs…'}</option>
                        {(jobs || []).map(j => <option key={j.jobId} value={j.jobId}>{String(j.startedAt || '').slice(0, 10)} · {(j.symbols || []).map(s => s.replace(/^.*:/, '').replace('-INDEX', '')).join(', ')} · {(j.strategies || []).length} strategies · {j.status}</option>)}
                    </select>
                    {candidates && (
                        <div className="space-y-1 max-h-[16rem] overflow-auto">
                            {candidates.error && <p className="text-xs text-danger">{candidates.error}</p>}
                            {(candidates.candidates || []).length === 0 && !candidates.error && <p className="text-xs text-fg-5">No setting in this run held up out-of-sample.</p>}
                            {(candidates.candidates || []).map(c => (
                                <div key={`${c.symbol}:${c.strategy}:${c.drawId}`} className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-line/40 py-1">
                                    <span className="text-fg-3">{c.label} <span className="text-fg-5">· {c.symbol.replace(/^.*:/, '').replace('-INDEX', '')} · draw {c.drawId}</span></span>
                                    <span className="text-fg-5 tabular-nums">score {c.rankScoreDeflated.toFixed(2)}{c.oos ? ` · held-out ${c.oos.trades} trades` : ''}</span>
                                    <button type="button" className="px-2 py-0.5 rounded border border-line text-fg-3 hover:bg-card-2"
                                        onClick={() => setRows(rs => [...rs, { ...c.ref, role: 'voter', weight: 1 }])}>Add</button>
                                </div>
                            ))}
                            {(candidates.skipped || []).length > 0 && (
                                <p className="text-3xs text-fg-5">{candidates.skipped.length} cell(s) not offered: {candidates.skipped.slice(0, 6).map(s => `${s.strategy} (${s.reason})`).join('; ')}{candidates.skipped.length > 6 ? '…' : ''}</p>
                            )}
                        </div>
                    )}
                </div>
            </details>

            {resolved && !resolved.ok && (resolved.errors || []).filter(e => e.index == null).map((e, k) => (
                <p key={k} className="text-xs text-danger">✕ {e.error}</p>
            ))}
            {resolved?.ok && resolved.dataNeeds && (
                <p className="text-3xs text-fg-5">Data requested for the members: 15m trend {resolved.dataNeeds.use_15m_filter ? 'on' : 'off'}, 60m trend {resolved.dataNeeds.use_1h_filter ? 'on' : 'off'}.</p>
            )}
            {(catalog.excluded || []).length > 0 && (
                <p className="text-3xs text-fg-5">Not available as members: {catalog.excluded.map(x => `${x.label || x.id} — ${x.reason}`).join('; ')}.</p>
            )}
        </div>
    );
}
