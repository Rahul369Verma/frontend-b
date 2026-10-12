import React from 'react';
import { nameOf } from './crossIndex';

// Saved optimizer runs: open a finished one, resume a paused / stopped / crashed
// one from its checkpoint, delete any that isn't running. A crashed run says
// whether it will resume by itself when the server starts (and if not, why).
const STATUS = {
  done: { label: 'Done', cls: 'bg-emerald-500/15 border-emerald-500/40 text-success' },
  running: { label: 'Running', cls: 'bg-primary/15 border-primary/50 text-primary-ink' },
  paused: { label: 'Paused', cls: 'bg-amber-500/15 border-amber-500/40 text-warning' },
  stopped: { label: 'Stopped', cls: 'bg-amber-500/15 border-amber-500/40 text-warning' },
  interrupted: { label: 'Interrupted', cls: 'bg-amber-500/15 border-amber-500/40 text-warning' },
  error: { label: 'Error', cls: 'bg-red-500/15 border-red-500/40 text-danger' },
};

export default function RecentRuns({ runs, onOpen, onResume, onDelete, onClearFinished, onAttach, busyJobId = null }) {
  if (!runs) return null;
  const jobs = runs.jobs || [];
  const finished = jobs.filter(j => ['done', 'stopped', 'error'].includes(j.status)).length;
  return (
    <section aria-label="Recent runs" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg-3">Recent runs</h3>
        {finished > 0 && (
          <button type="button" onClick={onClearFinished} className="text-2xs text-fg-4 hover:text-danger hover:underline"
            title="Deletes finished runs (done, stopped, error). Paused and interrupted runs are kept so they can still resume.">
            Delete finished ({finished})
          </button>
        )}
      </div>
      {runs.warning && <p className="text-2xs text-warning">{runs.warning}</p>}
      {jobs.length === 0 ? <p className="text-2xs text-fg-5">No saved runs yet.</p> : (
        <ul className="divide-y divide-line-0 text-xs">
          {jobs.map(j => {
            const st = STATUS[j.status] || STATUS.error;
            const pct = j.drawsTotal ? Math.min(100, Math.round(100 * (j.drawsDone || 0) / j.drawsTotal)) : null;
            const busy = busyJobId === j.jobId;
            return (
              <li key={j.jobId} className="py-2 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className={`text-3xs px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                  <span className="text-fg-3">{(j.symbols || []).map(nameOf).join(', ')}</span>
                  <span className="text-fg-5">{(j.strategies || []).length} strateg{(j.strategies || []).length === 1 ? 'y' : 'ies'}{j.preset ? ` · ${j.preset}` : ''}</span>
                  <span className="text-fg-5">{j.startedAt ? new Date(j.startedAt).toLocaleString('en-IN') : ''}</span>
                  {pct != null && <span className="text-fg-4">{j.drawsDone?.toLocaleString('en-IN')} of {j.drawsTotal.toLocaleString('en-IN')} backtests ({pct}%)</span>}
                  {j.sharedWinner && <span className="text-fg-4">best: {j.sharedWinner.label || j.sharedWinner.strategy}</span>}
                  <span className="ml-auto flex gap-2">
                    {j.status === 'running' && <button type="button" onClick={() => onAttach(j.jobId)} className="text-2xs text-primary-ink hover:underline">Attach</button>}
                    {j.resumable && (
                      <button type="button" disabled={busy} onClick={() => onResume(j.jobId)} className="text-2xs text-primary-ink hover:underline disabled:opacity-50"
                        title="Continue from the last checkpoint — finished backtests are not redone">
                        {busy ? 'Resuming…' : j.status === 'stopped' ? 'Continue' : 'Resume'}
                      </button>
                    )}
                    {['done', 'stopped', 'paused'].includes(j.status) && <button type="button" onClick={() => onOpen(j.jobId)} className="text-2xs text-primary-ink hover:underline">Open</button>}
                    {j.status !== 'running' && (
                      <button type="button" onClick={() => onDelete(j.jobId)} className="text-2xs text-fg-4 hover:text-danger hover:underline"
                        aria-label={`Delete the run started ${j.startedAt ? new Date(j.startedAt).toLocaleString('en-IN') : ''}`}>Delete</button>
                    )}
                  </span>
                </div>
                {j.status === 'interrupted' && j.autoResume && (
                  <p className="text-2xs text-fg-5">
                    {j.autoResume.ok ? 'Stopped by a crash or restart — it resumes by itself when the server starts (or press Resume).' : `Won't resume by itself: ${j.autoResume.error}.`}
                  </p>
                )}
                {j.status === 'paused' && <p className="text-2xs text-fg-5">Paused by you — it waits for Resume (never restarted automatically).</p>}
                {j.error && j.status !== 'interrupted' && <p className="text-2xs text-fg-5">{j.error}</p>}
                {j.persistErrors > 0 && <p className="text-2xs text-warning">{j.persistErrors} checkpoint write(s) failed — a resume would redo those backtests.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
