import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AutoRunProgress from './AutoRunProgress.jsx';

const SIZES = { 1: 65000, 2: 14487, 3: 157500, 4: 24 };
const job = (over = {}) => ({
    jobId: 'j1',
    status: 'running',
    workers: 11,
    startedAt: '2026-09-24T20:55:00Z',
    progress: { stage: 2, pct: 1, note: 'signal search 87/14487' },
    checkpoint: { stage: 1, stages: [{ stage: 1, combos: 65044 }] },
    ...over,
});
const track = { jobId: 'j1', key: '2|signal search', origin: [0, 27], samples: [[0, 27], [60000, 57], [120000, 87]], totals: {}, at: Date.parse('2026-09-26T13:00:00Z') };
track.samples = track.samples.map(([t, d]) => [track.at - 120000 + t, d]);
track.origin = track.samples[0];

describe('AutoRunProgress', () => {
    beforeEach(() => localStorage.clear());

    it('leads with one overall figure, the time left and the finish time', () => {
        render(<AutoRunProgress job={job()} track={track} sizes={SIZES} />);
        expect(screen.getByText('27%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toHaveAttribute('aria-valuenow', '27');
        expect(screen.getByText(/^about .+ left$/)).toBeInTheDocument();
        expect(screen.getByText(/Step 2 of 4 · Signal tuning · done around/)).toBeInTheDocument();
    });

    it('lists the four steps with their state', () => {
        render(<AutoRunProgress job={job()} track={track} sizes={SIZES} />);
        const steps = within(screen.getByRole('list'));
        for (const name of ['Broad race', 'Signal tuning', 'Structure tuning', 'Final check']) expect(steps.getByText(name)).toBeInTheDocument();
        expect(steps.getByText('done')).toBeInTheDocument();
        expect(steps.getByText('0.6% · 8 h left')).toBeInTheDocument();
        expect(steps.getByText('~4 days')).toBeInTheDocument();
        expect(steps.getByText('<1 min')).toBeInTheDocument();
    });

    it('keeps the raw counters behind Details', () => {
        render(<AutoRunProgress job={job()} track={track} sizes={SIZES} />);
        expect(screen.queryByText('signal search 87/14487')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Details/ }));
        expect(screen.getByText('signal search 87/14487')).toBeInTheDocument();
        expect(screen.getByText(/^Speed: 30 tests\/min · time left assumes this speed/)).toBeInTheDocument();
        expect(screen.getByText('CPU cores: 11')).toBeInTheDocument();
    });

    it('says it is estimating until it has measured the speed', () => {
        render(<AutoRunProgress job={job()} track={null} sizes={SIZES} />);
        expect(screen.getByText('Estimating time left…')).toBeInTheDocument();
        expect(screen.getAllByText('waiting')).toHaveLength(2);
    });

    it('shows a stopped run without a countdown', () => {
        render(<AutoRunProgress job={job({ status: 'paused' })} track={track} sizes={SIZES} />);
        expect(screen.getByText('Paused')).toBeInTheDocument();
        expect(screen.getByText('stopped at 0.6%')).toBeInTheDocument();
        expect(screen.queryByText(/left$/)).toBeNull();
    });

    it('warns when nothing has finished for a while instead of counting down', () => {
        const quiet = { ...track, samples: [[track.at - 480000, 27], [track.at - 420000, 87], [track.at - 10000, 87]], origin: [track.at - 480000, 27], lastChangeAt: track.at - 420000 };
        render(<AutoRunProgress job={job()} track={quiet} sizes={SIZES} />);
        expect(screen.getByText('No progress for 7 min · still working')).toBeInTheDocument();
        expect(screen.getByText('0.6% · no progress')).toBeInTheDocument();
        expect(screen.queryByText(/done around/)).toBeNull();
    });

    it('never lets the headline drop below the best figure it already showed', () => {
        render(<AutoRunProgress job={job()} track={{ ...track, peak: 0.3 }} sizes={SIZES} />);
        expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('shows when a finished run ended', () => {
        render(<AutoRunProgress job={job({ status: 'done', finishedAt: '2026-09-26T16:10:00Z', result: { stages: [] } })} track={null} sizes={SIZES} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
        expect(screen.getByText('Finished')).toBeInTheDocument();
        expect(screen.getByText(/^Finished 26 Sept? 2026/)).toBeInTheDocument();
    });

    it('remembers whether Details was left open', () => {
        const { unmount } = render(<AutoRunProgress job={job()} track={track} sizes={SIZES} />);
        fireEvent.click(screen.getByRole('button', { name: /Details/ }));
        unmount();
        render(<AutoRunProgress job={job()} track={track} sizes={SIZES} />);
        expect(screen.getByText('signal search 87/14487')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Hide details/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows loading while market data is fetched', () => {
        render(<AutoRunProgress job={job({ progress: { stage: 0, note: 'fetching candles 1/2: NSE:NIFTY50-INDEX' }, checkpoint: null })} track={null} sizes={SIZES} />);
        expect(screen.getByText('Loading market data…')).toBeInTheDocument();
        expect(screen.getByText('Getting ready · symbol 1 of 2')).toBeInTheDocument();
    });
});
