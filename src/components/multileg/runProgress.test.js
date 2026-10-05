import { describe, it, expect } from 'vitest';
import {
    parseNote, estimateStageSizes, sizesForRequest, runSteps, runSummary, pctText, shownOverall,
    recordSample, speedOf, stalledFor, etaOf, formatDuration, formatSpeed, finishLabel,
} from './runProgress.js';

const SIZES = { 1: 65000, 2: 14487, 3: 157500, 4: 24 };

const runningJob = (over = {}) => ({
    jobId: 'j1',
    status: 'running',
    progress: { stage: 2, pct: 1, note: 'signal search 87/14487' },
    checkpoint: { stage: 1, stages: [{ stage: 1, name: 'broad race', combos: 65044, kept: 44 }] },
    ...over,
});

describe('parseNote', () => {
    it('reads the label and the done/total counter', () => {
        expect(parseNote('signal search 87/14487')).toEqual({ label: 'signal search', done: 87, total: 14487 });
        expect(parseNote('structure refine 3/120')).toEqual({ label: 'structure refine', done: 3, total: 120 });
        expect(parseNote('fetching candles 1/2: NSE:NIFTY50-INDEX (long ranges load in 20-day chunks)')).toMatchObject({ label: 'fetching candles', done: 1, total: 2 });
    });

    it('returns null for notes without a counter', () => {
        expect(parseNote('resumed — stage 1 already complete (12 survivors)')).toBeNull();
        expect(parseNote('AI validating champion 3 (40 calls)')).toBeNull();
        expect(parseNote('fetched NSE:NIFTY50-INDEX: 12345 bars')).toBeNull();
        expect(parseNote(undefined)).toBeNull();
        expect(parseNote('broad race 0/0')).toBeNull();
    });

    it('never reports more done than total', () => {
        expect(parseNote('broad race 12/10')).toMatchObject({ done: 10, total: 10 });
    });
});

describe('estimateStageSizes', () => {
    const budget = { explore: 100, survivors1: 44, signalSamples: 439, survivors2: 45, sweepCap: 20000, gridDensity: 3, champions: 24 };

    it('gives clock-entry neutrals one variant each when entries are mixed', () => {
        const s = estimateStageSizes({ budget, symbols: 2, strategies: 26, directional: 12, neutral: 10, entryStyle: 'both' });
        expect(s[1]).toBe(2 * 12 * 26 * 101 + 2 * 10);
        expect(s[2]).toBe(44 * 439);
        expect(s[3]).toBe(45 * 3500);
        expect(s[4]).toBe(24);
    });

    it('races every template on signals in signal-only mode', () => {
        const s = estimateStageSizes({ budget, symbols: 1, strategies: 3, directional: 2, neutral: 1, entryStyle: 'signal-only' });
        expect(s[1]).toBe(1 * 3 * 3 * 101);
    });

    it('caps the structure grid at sweepCap', () => {
        expect(estimateStageSizes({ budget: { survivors2: 10, sweepCap: 50, gridDensity: 3 } })[3]).toBe(500);
    });

    it('derives sizes from a job request and the template list', () => {
        const templates = [{ outlook: 'bullish' }, { outlook: 'bearish-volatile' }, { outlook: 'neutral' }];
        const req = { symbols: ['A', 'B'], strategies: 5, templates: 'all', entry_style: 'both', budget: { explore: 1, champions: 4 } };
        expect(sizesForRequest(req, templates)[1]).toBe(2 * 2 * 5 * 2 + 2 * 1);
        expect(sizesForRequest({ ...req, templates: 'bull' }, templates)[1]).toBe(2 * 1 * 5 * 2);
        expect(sizesForRequest(null, templates, { champions: 7 })[4]).toBe(7);
    });
});

describe('runSteps', () => {
    it('weights the overall figure by backtests, using real counts where known', () => {
        const v = runSteps(runningJob(), SIZES);
        expect(v.steps.map(s => s.status)).toEqual(['done', 'running', 'waiting', 'waiting']);
        expect(v.steps[0]).toMatchObject({ done: 65044, total: 65044 });
        expect(v.steps[1]).toMatchObject({ done: 87, total: 14487 });
        expect(v.overall).toBeCloseTo((65044 + 87) / (65044 + 14487 + 157500 + 24), 6);
    });

    it('adds the sweep size to the refine counter in step 3', () => {
        const job = runningJob({
            progress: { stage: 3, pct: 50, note: 'structure refine 60/120' },
            checkpoint: { stage: 2, stages: [{ stage: 1, combos: 100 }, { stage: 2, combos: 50 }] },
        });
        const s3 = runSteps(job, SIZES, { totals: { '3|structure sweep': 9000 } }).steps[2];
        expect(s3).toMatchObject({ status: 'running', done: 9060, total: 9120 });
        expect(runSteps(job, SIZES).steps[2]).toMatchObject({ done: 157560, total: 157620 });
    });

    it('marks everything done and 100% when the run finished', () => {
        const v = runSteps({ status: 'done', progress: { stage: 4, pct: 100 }, result: { stages: [{ stage: 1, combos: 10 }] } }, SIZES);
        expect(v.steps.every(s => s.status === 'done')).toBe(true);
        expect(v.overall).toBe(1);
    });

    it('shows the current step as stopped when the run is not running', () => {
        expect(runSteps(runningJob({ status: 'paused' }), SIZES).steps[1].status).toBe('stopped');
    });

    it('uses the checkpoint cursor while a partial step is resuming', () => {
        const job = runningJob({
            progress: { stage: 2, pct: 100, note: 'auto-resuming from stage 2' },
            checkpoint: { stage: 2, phase: 'partial', cursor: 4000, stages: [{ stage: 1, combos: 65044 }] },
        });
        expect(runSteps(job, SIZES).steps[1]).toMatchObject({ done: 4000, total: 14487 });
    });

    it('falls back to the stage percentage when the note has no counter', () => {
        const job = runningJob({ progress: { stage: 4, pct: 50, note: 'AI validating champion 1 (3 calls)' } });
        expect(runSteps(job, SIZES).steps[3]).toMatchObject({ done: 12, total: 24 });
    });

    it('holds at 99% until the run is really done', () => {
        const job = runningJob({ progress: { stage: 4, pct: 100, note: 'champion full run 24/24' }, checkpoint: { stage: 3, stages: [{ stage: 1, combos: 10 }, { stage: 2, combos: 10 }, { stage: 3, combos: 10 }] } });
        expect(runSteps(job, SIZES).overall).toBe(0.99);
    });

    it('never shows the overall figure going backwards while running', () => {
        const late2 = runningJob({ progress: { stage: 2, note: 'signal search 14000/14487' } });
        const early3 = runningJob({
            progress: { stage: 3, note: 'structure sweep 10/400000' },
            checkpoint: { stage: 2, stages: [{ stage: 1, combos: 65044 }, { stage: 2, combos: 14487 }] },
        });
        const t1 = recordSample(null, late2, 1000, SIZES);
        const t2 = recordSample(t1, early3, 3500, SIZES);
        const actual = runSteps(early3, SIZES, t2).overall;
        expect(actual).toBeLessThan(t1.peak);
        expect(t2.peak).toBe(t1.peak);
        expect(shownOverall(runSteps(early3, SIZES, t2), early3, t2)).toBe(t1.peak);
        expect(shownOverall(runSteps(early3, SIZES, t2), { ...early3, status: 'paused' }, t2)).toBe(actual);
        expect(runSummary(early3, SIZES, t2)).toBe(`step 3 of 4 · ${pctText(t1.peak)}`);
    });

    it('summarises a run in one short phrase', () => {
        expect(runSummary(runningJob(), SIZES)).toBe('step 2 of 4 · 27%');
        expect(runSummary(runningJob({ progress: { stage: 0, note: 'fetching data' } }), SIZES)).toBe('loading market data');
    });
});

describe('speed and ETA', () => {
    const feed = (points) => points.reduce((track, [sec, done, note = 'signal search']) => recordSample(
        track, runningJob({ progress: { stage: 2, note: `${note} ${done}/14487` } }), sec * 1000), null);

    it('waits a minute and at least five finished tests before estimating', () => {
        expect(speedOf(feed([[0, 80], [10, 82]]))).toBeNull();
        expect(speedOf(feed([[0, 80], [40, 90]]))).toBeNull();
        expect(speedOf(feed([[0, 80], [70, 83]]))).toBeNull();
    });

    it('measures tests per second over the recent window', () => {
        expect(speedOf(feed([[0, 80], [40, 100], [80, 120]]))).toBeCloseTo(0.5, 6);
    });

    it('forgets samples older than ten minutes', () => {
        const track = feed([[0, 0], [300, 10], [900, 70]]);
        expect(track.samples[0]).toEqual([300 * 1000, 10]);
        expect(speedOf(track)).toBeCloseTo(60 / 600, 6);
    });

    it('starts over when the step or its counter changes', () => {
        expect(feed([[0, 80], [40, 100], [50, 3, 'broad race']]).samples).toEqual([[50000, 3]]);
        expect(feed([[0, 80], [40, 100], [50, 5]]).samples).toEqual([[50000, 5]]);
    });

    it('keeps sampling while idle so a stall slows the estimate', () => {
        expect(speedOf(feed([[0, 0], [30, 10], [60, 10], [90, 10]]))).toBeCloseTo(10 / 90, 6);
    });

    it('flags a stall only after five quiet minutes or five usual gaps', () => {
        const quiet = feed([[0, 0], [60, 10], [120, 10], [240, 10], [360, 10], [480, 10]]);
        expect(stalledFor(quiet, speedOf(quiet))).toBe(420000);
        const busy = feed([[0, 0], [60, 10], [120, 20]]);
        expect(stalledFor(busy, speedOf(busy))).toBe(0);
        expect(stalledFor(null, 1)).toBe(0);
    });

    it('does not record while loading data or when not running', () => {
        const loading = recordSample(null, runningJob({ progress: { stage: 0, note: 'fetching candles 1/2: X' } }), 1000);
        expect(loading.samples).toEqual([]);
        expect(recordSample(null, runningJob({ status: 'paused' }), 1000).samples).toEqual([]);
    });

    it('projects every remaining step at the current speed', () => {
        const eta = etaOf(runSteps(runningJob(), SIZES), 2);
        expect(eta.perStep[1]).toBe(0);
        expect(eta.perStep[2]).toBe((14487 - 87) / 2);
        expect(eta.perStep[3]).toBe(157500 / 2);
        expect(eta.total).toBe((14487 - 87 + 157500 + 24) / 2);
        expect(etaOf(runSteps(runningJob(), SIZES), null)).toBeNull();
    });
});

describe('formatting', () => {
    it('shows a decimal below 10% so a long step never reads as stuck at 0%', () => {
        expect(pctText(0)).toBe('0%');
        expect(pctText(0.0004)).toBe('<0.1%');
        expect(pctText(87 / 14487)).toBe('0.6%');
        expect(pctText(0.0996)).toBe('9.9%');
        expect(pctText(0.2747)).toBe('27%');
        expect(pctText(0.9999)).toBe('99%');
        expect(pctText(1)).toBe('100%');
    });

    it('rounds durations up, more coarsely as they grow', () => {
        expect(formatDuration(30)).toBe('<1 min');
        expect(formatDuration(7 * 60)).toBe('7 min');
        expect(formatDuration(23 * 60)).toBe('25 min');
        expect(formatDuration(56 * 60)).toBe('1 h');
        expect(formatDuration(95 * 60)).toBe('1 h 40 min');
        expect(formatDuration(7.4 * 3600)).toBe('8 h');
        expect(formatDuration(22.5 * 3600)).toBe('23 h');
        expect(formatDuration(23.2 * 3600)).toBe('1 d');
        expect(formatDuration(28 * 3600)).toBe('1 d 4 h');
        expect(formatDuration(48 * 3600)).toBe('2 d');
        expect(formatDuration(13.4 * 86400)).toBe('14 days');
        expect(formatDuration(NaN)).toBeNull();
    });

    it('picks a readable speed unit', () => {
        expect(formatSpeed(31.6)).toBe('32 tests/s');
        expect(formatSpeed(2.25)).toBe('2.3 tests/s');
        expect(formatSpeed(0.107)).toBe('6.4 tests/min');
        expect(formatSpeed(0.001)).toBe('3.6 tests/h');
        expect(formatSpeed(0)).toBeNull();
    });

    it('labels the finish time in IST relative to today', () => {
        const now = Date.parse('2026-09-26T13:00:00Z');
        expect(finishLabel(Date.parse('2026-09-26T17:10:00Z'), now)).toBe('22:40 today');
        expect(finishLabel(Date.parse('2026-09-26T17:11:00Z'), now)).toBe('22:45 today');
        expect(finishLabel(Date.parse('2026-09-26T19:00:00Z'), now)).toBe('00:30 tomorrow');
        expect(finishLabel(Date.parse('2026-09-29T05:00:00Z'), now)).toMatch(/^Tue 10:30$/);
        expect(finishLabel(Date.parse('2026-10-09T05:00:00Z'), now)).toMatch(/^9 Oct/);
    });
});
