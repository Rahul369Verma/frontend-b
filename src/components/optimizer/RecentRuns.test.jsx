import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RecentRuns from './RecentRuns';

const N = 'NSE:NIFTY50-INDEX', B = 'NSE:NIFTYBANK-INDEX';
const run = (o) => ({ jobId: o.jobId, status: o.status, symbols: [N, B], strategies: ['orb', 'st'], preset: 'quick', startedAt: '2026-10-12T04:00:00Z', drawsDone: 120, drawsTotal: 480, resumable: false, ...o });
const RUNS = { jobs: [
  run({ jobId: 'r', status: 'running' }),
  run({ jobId: 'p', status: 'paused', resumable: true }),
  run({ jobId: 'i', status: 'interrupted', resumable: true, autoResume: { ok: true } }),
  run({ jobId: 'g', status: 'interrupted', resumable: true, autoResume: { ok: false, error: 'auto-resume gave up after 3 restarts with no progress — resume it yourself' } }),
  run({ jobId: 's', status: 'stopped', resumable: true }),
  run({ jobId: 'd', status: 'done', drawsDone: 480, sharedWinner: { label: 'SuperTrend' } }),
] };

const rowOf = (jobId) => screen.getAllByRole('listitem')[RUNS.jobs.findIndex(j => j.jobId === jobId)];

describe('RecentRuns', () => {
  it('offers the right actions per status, and never Delete on a running run', () => {
    render(<RecentRuns runs={RUNS} onOpen={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClearFinished={vi.fn()} onAttach={vi.fn()} />);
    const names = (id) => within(rowOf(id)).getAllByRole('button').map(b => b.textContent);
    expect(names('r')).toEqual(['Attach']);
    expect(names('p')).toEqual(['Resume', 'Open', 'Delete']);
    expect(names('i')).toEqual(['Resume', 'Delete']);
    expect(names('s')).toEqual(['Continue', 'Open', 'Delete']);
    expect(names('d')).toEqual(['Open', 'Delete']);
    expect(within(rowOf('p')).getByText('120 of 480 backtests (25%)')).toBeTruthy();
  });

  it('says whether a crashed run resumes by itself, and why not', () => {
    render(<RecentRuns runs={RUNS} onOpen={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClearFinished={vi.fn()} onAttach={vi.fn()} />);
    expect(within(rowOf('i')).getByText(/resumes by itself when the server starts/)).toBeTruthy();
    expect(within(rowOf('g')).getByText(/Won't resume by itself: auto-resume gave up after 3 restarts/)).toBeTruthy();
    expect(within(rowOf('p')).getByText(/never restarted automatically/)).toBeTruthy();
  });

  it('wires Resume, Delete and Delete finished (counting only done/stopped/error)', () => {
    const onResume = vi.fn(), onDelete = vi.fn(), onClearFinished = vi.fn();
    render(<RecentRuns runs={RUNS} onOpen={vi.fn()} onResume={onResume} onDelete={onDelete} onClearFinished={onClearFinished} onAttach={vi.fn()} />);
    fireEvent.click(within(rowOf('p')).getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith('p');
    fireEvent.click(within(rowOf('d')).getByRole('button', { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith('d');
    fireEvent.click(screen.getByRole('button', { name: 'Delete finished (2)' }));
    expect(onClearFinished).toHaveBeenCalled();
  });
});
