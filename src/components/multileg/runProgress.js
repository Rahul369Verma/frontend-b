import { useCallback, useRef, useState } from 'react';

export const RUN_STEPS = [
    { stage: 1, name: 'Broad race', hint: 'Every strategy × structure × symbol at default settings, plus a few random settings' },
    { stage: 2, name: 'Signal tuning', hint: 'Random signal settings for the best candidates' },
    { stage: 3, name: 'Structure tuning', hint: 'Strike, target and stop settings for the finalists' },
    { stage: 4, name: 'Final check', hint: 'The champions re-run on the whole period' },
];

const WINDOW_MS = 10 * 60 * 1000;
const WARMUP_MS = 60 * 1000;
const WARMUP_TESTS = 5;
const IDLE_SAMPLE_MS = 10 * 1000;
const STALL_MIN_MS = 5 * 60 * 1000;
const STORE_KEY = 'ml.runTrack';
const IST = 'Asia/Kolkata';

export function parseNote(note) {
    const m = typeof note === 'string' ? /^(.*?)\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(note) : null;
    if (!m) return null;
    const done = Number(m[2].replace(/,/g, ''));
    const total = Number(m[3].replace(/,/g, ''));
    if (!(total > 0) || !(done >= 0)) return null;
    return { label: m[1].trim(), done: Math.min(done, total), total };
}

export function estimateStageSizes({ budget = {}, symbols = 1, strategies = 12, directional = 0, neutral = 0, entryStyle = 'both' } = {}) {
    const sym = Math.max(1, Number(symbols) || 1);
    const signalOnly = entryStyle === 'signal-only';
    const signalPairings = sym * strategies * (signalOnly ? directional + neutral : directional);
    const clockPairings = signalOnly ? 0 : sym * neutral;
    const grid = budget.gridDensity >= 3 ? 3500 : budget.gridDensity === 2 ? 700 : 130;
    return {
        1: signalPairings * (1 + (Number(budget.explore) || 0)) + clockPairings,
        2: (Number(budget.survivors1) || 0) * (Number(budget.signalSamples) || 0),
        3: (Number(budget.survivors2) || 0) * Math.min(Number(budget.sweepCap ?? grid), grid),
        4: Number(budget.champions) || 3,
    };
}

export function sizesForRequest(req, templates = [], fallbackBudget = {}) {
    const request = req || {};
    const byOutlook = typeof request.templates === 'string' && request.templates !== 'all';
    const pool = byOutlook ? templates.filter(t => String(t.outlook).startsWith(request.templates)) : templates;
    const directional = pool.filter(t => /^bull|^bear/.test(String(t.outlook))).length;
    return estimateStageSizes({
        budget: { ...fallbackBudget, ...(request.budget || {}) },
        symbols: (request.symbols || []).length,
        strategies: Number(request.strategies) || 12,
        directional,
        neutral: pool.length - directional,
        entryStyle: request.entry_style,
    });
}

export function runSteps(job, sizes = {}, track = null) {
    const progress = job?.progress || {};
    const current = Number(progress.stage) || 0;
    const note = parseNote(progress.note);
    const allDone = job?.status === 'done';
    const live = job?.status === 'running';
    const finished = new Map();
    for (const s of [...(job?.checkpoint?.stages || []), ...(job?.result?.stages || [])]) {
        if (s?.stage) finished.set(Number(s.stage), s);
    }
    const steps = RUN_STEPS.map((step) => {
        const estimate = Math.max(0, Math.round(Number(sizes?.[step.stage]) || 0));
        const fin = finished.get(step.stage);
        if (allDone || fin || step.stage < current) {
            const total = Number(fin?.combos) || estimate;
            return { ...step, status: 'done', done: total, total, frac: 1 };
        }
        if (step.stage !== current) return { ...step, status: 'waiting', done: 0, total: estimate, frac: 0 };
        let done;
        let total;
        if (note && step.stage === 3 && /refine/i.test(note.label)) {
            const sweep = Number(track?.totals?.['3|structure sweep']) || estimate;
            done = sweep + note.done;
            total = sweep + note.total;
        } else if (note) {
            done = note.done;
            total = note.total;
        } else if (/resum/i.test(progress.note || '')) {
            const cp = job?.checkpoint;
            total = estimate;
            done = cp?.stage === step.stage && cp.phase === 'partial' ? Math.min(total, Number(cp.cursor) || 0) : 0;
        } else {
            total = estimate;
            done = Math.round(total * Math.min(100, Math.max(0, Number(progress.pct) || 0)) / 100);
        }
        return { ...step, status: live ? 'running' : 'stopped', done, total, frac: total ? done / total : 0 };
    });
    const total = steps.reduce((a, s) => a + s.total, 0);
    const done = steps.reduce((a, s) => a + s.done, 0);
    return { current, note, steps, done, total, overall: allDone ? 1 : total ? Math.min(0.99, done / total) : 0 };
}

export function shownOverall(view, job, track) {
    const peak = job?.status === 'running' && track?.jobId === job?.jobId ? Number(track.peak) || 0 : 0;
    return Math.max(view.overall, peak);
}

export function pctText(frac) {
    const p = Math.max(0, Math.min(100, (Number(frac) || 0) * 100));
    if (p > 0 && p < 0.1) return '<0.1%';
    if (p > 0 && p < 10) return `${(Math.floor(p * 10) / 10).toFixed(1)}%`;
    return `${Math.floor(p)}%`;
}

export function runSummary(job, sizes, track = null) {
    const view = runSteps(job, sizes, track);
    if (view.current === 0) return 'loading market data';
    return `step ${view.current} of 4 · ${pctText(shownOverall(view, job, track))}`;
}

export function recordSample(track, job, at, sizes = null) {
    const base = track && track.jobId === job?.jobId ? track : { jobId: job?.jobId, key: null, origin: null, samples: [], totals: {} };
    const note = parseNote(job?.progress?.note);
    const stage = Number(job?.progress?.stage) || 0;
    const running = job?.status === 'running';
    const peak = running && sizes ? Math.max(Number(base.peak) || 0, runSteps(job, sizes, base).overall) : Number(base.peak) || 0;
    if (!running || !note || stage === 0) return { ...base, peak, at };
    const key = `${stage}|${note.label}`;
    const sameSegment = base.key === key && base.samples.length && note.done >= base.samples[base.samples.length - 1][1];
    let samples = sameSegment ? base.samples : [];
    const origin = sameSegment && base.origin ? base.origin : [at, note.done];
    const last = samples[samples.length - 1];
    const changed = !last || note.done !== last[1];
    if (changed || at - last[0] >= IDLE_SAMPLE_MS) samples = [...samples, [at, note.done]];
    const fresh = samples.filter(([t]) => t >= at - WINDOW_MS);
    return {
        jobId: base.jobId, key, origin, peak,
        samples: fresh.length ? fresh : samples.slice(-1),
        totals: { ...base.totals, [key]: note.total },
        lastChangeAt: changed ? at : (base.lastChangeAt ?? at),
        at,
    };
}

export function stalledFor(track, speed) {
    if (!track?.lastChangeAt || !track.at) return 0;
    const idle = track.at - track.lastChangeAt;
    return idle > Math.max(STALL_MIN_MS, speed > 0 ? 5000 / speed : 0) ? idle : 0;
}

const rateBetween = (from, to, at) => {
    const ms = at - from[0];
    const tests = to[1] - from[1];
    return ms >= WARMUP_MS && tests >= WARMUP_TESTS ? tests / (ms / 1000) : null;
};

export function speedOf(track) {
    const samples = track?.samples || [];
    if (!samples.length || !track.at) return null;
    const last = samples[samples.length - 1];
    return rateBetween(samples[0], last, track.at) ?? (track.origin ? rateBetween(track.origin, last, track.at) : null);
}

export function etaOf(view, speed) {
    if (!(speed > 0) || !view.steps.some(s => s.status === 'running')) return null;
    const perStep = {};
    for (const s of view.steps) {
        perStep[s.stage] = s.status === 'running' ? Math.max(0, s.total - s.done) / speed
            : s.status === 'waiting' ? s.total / speed : 0;
    }
    return { perStep, total: Object.values(perStep).reduce((a, x) => a + x, 0) };
}

export function formatDuration(secs) {
    if (!Number.isFinite(secs) || secs < 0) return null;
    const mins = secs / 60;
    if (mins < 1) return '<1 min';
    if (mins < 10) return `${Math.ceil(mins)} min`;
    if (mins < 55) return `${Math.ceil(mins / 5) * 5} min`;
    const hours = mins / 60;
    if (hours < 3) {
        const tens = Math.ceil(mins / 10) * 10;
        const m = tens % 60;
        return m ? `${Math.floor(tens / 60)} h ${m} min` : `${tens / 60} h`;
    }
    if (hours < 23) return `${Math.ceil(hours)} h`;
    if (hours < 72) {
        const whole = Math.ceil(hours);
        const h = whole % 24;
        return h ? `${Math.floor(whole / 24)} d ${h} h` : `${whole / 24} d`;
    }
    return `${Math.ceil(hours / 24)} days`;
}

export function formatSpeed(perSec) {
    if (!(perSec > 0)) return null;
    const show = (n) => (n >= 10 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(1));
    if (perSec >= 1) return `${show(perSec)} tests/s`;
    if (perSec * 60 >= 1) return `${show(perSec * 60)} tests/min`;
    return `${show(perSec * 3600)} tests/h`;
}

const istDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: IST });

export function finishLabel(finishMs, nowMs) {
    const rounded = Math.ceil(finishMs / 300000) * 300000;
    const days = Math.round((Date.parse(istDay(rounded)) - Date.parse(istDay(nowMs))) / 864e5);
    const when = new Date(rounded);
    const time = when.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (days <= 0) return `${time} today`;
    if (days === 1) return `${time} tomorrow`;
    if (days < 7) return `${when.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short' })} ${time}`;
    return when.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
}

function readStoredTrack() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}

function storeTrack(track) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(track)); return true; } catch { return false; }
}

export function useRunTracker() {
    const latest = useRef(null);
    const [track, setTrack] = useState(null);
    const record = useCallback((job, sizes) => {
        if (!job?.jobId) return;
        const at = Date.now();
        let base = latest.current?.jobId === job.jobId ? latest.current : null;
        if (!base) {
            const saved = readStoredTrack();
            base = saved?.jobId === job.jobId && at - (saved.at || 0) < WINDOW_MS ? saved : null;
        }
        const next = recordSample(base, job, at, sizes);
        latest.current = next;
        storeTrack(next);
        setTrack(next);
    }, []);
    return [track, record];
}
