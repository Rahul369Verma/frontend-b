import React, { useState } from 'react';
import { runSteps, shownOverall, speedOf, stalledFor, etaOf, formatDuration, formatSpeed, finishLabel, pctText } from './runProgress.js';
import { istDateTime } from '../viz/tokens.js';

const DETAILS_KEY = 'ml.runDetails';
const count = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');

function readDetailsOpen() {
    try { return localStorage.getItem(DETAILS_KEY) === '1'; } catch { return false; }
}

function storeDetailsOpen(open) {
    try { localStorage.setItem(DETAILS_KEY, open ? '1' : '0'); return true; } catch { return false; }
}

function StepMarker({ status, n }) {
    if (status === 'done') {
        return <span aria-hidden="true" className="w-4 h-4 shrink-0 rounded-full bg-emerald-900/40 border border-emerald-700 text-success text-3xs flex items-center justify-center">✓</span>;
    }
    const tone = status === 'running' ? 'border-amber-500 text-warning animate-pulse'
        : status === 'stopped' ? 'border-line-3 text-fg-3' : 'border-line-2 text-fg-5';
    return <span aria-hidden="true" className={`w-4 h-4 shrink-0 rounded-full border text-3xs flex items-center justify-center ${tone}`}>{n}</span>;
}

function headline(job, view, eta, idleMs) {
    const status = job?.status;
    if (status === 'done') return 'Finished';
    if (status === 'paused') return 'Paused';
    if (status === 'cancelled') return 'Cancelled';
    if (status !== 'running') return 'Stopped';
    if (view.current === 0) return 'Loading market data…';
    if (idleMs) return `No progress for ${formatDuration(idleMs / 1000)} · still working`;
    if (!eta) return 'Estimating time left…';
    return eta.total < 60 ? 'less than a minute left' : `about ${formatDuration(eta.total)} left`;
}

function stepDetail(step, eta, idleMs) {
    const pct = pctText(step.frac);
    const secs = eta?.perStep[step.stage];
    if (step.status === 'done') return 'done';
    if (step.status === 'stopped') return `stopped at ${pct}`;
    if (step.status === 'running') {
        if (idleMs) return `${pct} · no progress`;
        return eta ? `${pct} · ${formatDuration(secs)} left` : `${pct} · estimating…`;
    }
    if (!eta) return 'waiting';
    return secs < 60 ? '<1 min' : `~${formatDuration(secs)}`;
}

export default function AutoRunProgress({ job, track, sizes }) {
    const [showDetails, setShowDetails] = useState(readDetailsOpen);
    const ownTrack = track && track.jobId === job?.jobId ? track : null;
    const view = runSteps(job, sizes, ownTrack);
    const running = job?.status === 'running';
    const speed = running ? speedOf(ownTrack) : null;
    const idleMs = running && view.current > 0 ? stalledFor(ownTrack, speed) : 0;
    const eta = running && view.current > 0 && !idleMs ? etaOf(view, speed) : null;
    const overall = shownOverall(view, job, ownTrack);
    const step = view.steps.find(s => s.stage === view.current);

    let subline = step ? `Step ${step.stage} of 4 · ${step.name}` : '';
    if (running && view.current === 0) {
        subline = view.note ? `Getting ready · symbol ${view.note.done} of ${view.note.total}` : 'Getting ready';
    }
    if (eta && ownTrack) subline += ` · done around ${finishLabel(ownTrack.at + eta.total * 1000, ownTrack.at)}`;
    if (job?.status === 'done' && job.finishedAt) subline = `Finished ${istDateTime(job.finishedAt)}`;
    const basis = speed
        ? `Estimated from the current speed (${formatSpeed(speed)}). Later steps can run faster or slower and are re-estimated when they start.`
        : undefined;
    const toggleDetails = () => {
        storeDetailsOpen(!showDetails);
        setShowDetails(!showDetails);
    };

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold text-fg tabular-nums">{pctText(overall)}<span className="ml-1 text-2xs font-normal text-fg-5">done</span></span>
                <span className={`text-right ${idleMs ? 'text-warning' : running ? 'text-fg-2' : 'text-fg-4'}`} title={basis}>{headline(job, view, eta, idleMs)}</span>
            </div>
            <div className="h-2 mt-1 bg-slate-800 rounded overflow-hidden" role="progressbar" aria-label="Overall progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(overall * 100)}>
                <div className={`h-full transition-all ${idleMs ? 'bg-amber-300/60' : 'bg-amber-500/70'}`} style={{ width: `${Math.max(1, overall * 100)}%` }} />
            </div>
            {subline && <div className="mt-1 text-2xs text-fg-5" title={basis}>{subline}</div>}

            <ol className="mt-3 space-y-1.5">
                {view.steps.map(s => (
                    <li key={s.stage} className="flex items-center gap-2" title={`${s.hint} · ≈ ${count(s.total)} backtests`}>
                        <StepMarker status={s.status} n={s.stage} />
                        <span className={s.status === 'running' ? 'text-fg font-medium' : s.status === 'done' ? 'text-fg-3' : 'text-fg-5'}>{s.name}</span>
                        <span className={`ml-auto text-2xs tabular-nums ${s.status === 'running' ? 'text-warning' : 'text-fg-5'}`}>{stepDetail(s, eta, idleMs)}</span>
                    </li>
                ))}
            </ol>

            <button type="button" onClick={toggleDetails} aria-expanded={showDetails}
                className="mt-2 text-2xs text-sky-400 hover:text-sky-300">
                {showDetails ? '▾ Hide details' : '▸ Details'}
            </button>
            {showDetails && (
                <div className="mt-1 space-y-0.5 text-2xs text-fg-5">
                    <div>Right now: <span className="text-fg-4">{job?.progress?.note || '—'}</span></div>
                    <div>Backtests: {count(view.done)} of ≈ {count(view.total)}</div>
                    {speed && <div>Speed: {formatSpeed(speed)} · time left assumes this speed for every remaining step and is re-timed when each step starts</div>}
                    {job?.workers ? <div>CPU cores: {job.workers}</div> : null}
                    {job?.startedAt && <div>Started: {istDateTime(job.startedAt)}{job.resumedAt ? ` · resumed ${istDateTime(job.resumedAt)}` : ''}</div>}
                </div>
            )}
        </div>
    );
}
