import React from 'react';
import { Square } from 'lucide-react';
import { nameOf } from './crossIndex';

const STEPS = [
  { key: 'loading', label: 'Loading data' },
  { key: 'screening', label: 'Screening' },
  { key: 'refining', label: 'Fine-tuning the best' },
  { key: 'finalizing', label: 'Finalizing' },
];
const CELL_TONE = {
  queued: 'bg-slate-800 text-fg-5',
  running: 'bg-primary/20 text-primary-ink',
  done: 'bg-emerald-500/15 text-success',
};

// Live view of a multi-index run: which step, overall progress + ETA, and a
// strategy × index grid of how far each cell is (with its best robust score so far).
export default function ProgressGrid({ progress = {}, cells = null, symbols = [], strategies = [], labelFor = (s) => s, etaLabel, onStop, stopping, onPause, pausing, resumedFrom, kDefault }) {
  const pct = Math.round(((progress.current || 0) / (progress.total || 1)) * 100);
  const stepIdx = Math.max(0, STEPS.findIndex(s => s.key === progress.step));
  const stepText = {
    loading: progress.symbol ? `Loading data — ${nameOf(progress.symbol)} (${progress.symbolIndex || 1} of ${progress.totalSymbols || symbols.length})` : 'Loading data',
    screening: `Screening ${strategies.length} strateg${strategies.length === 1 ? 'y' : 'ies'} on ${symbols.length} indexes`,
    refining: 'Fine-tuning the strategies that did best',
    finalizing: 'Finalizing — ranking across indexes',
  }[progress.step] || 'Starting…';
  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-2xs" aria-label="Run steps">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === stepIdx ? 'step' : undefined}
            className={`px-2 py-0.5 rounded-full border ${i < stepIdx ? 'border-line-2 text-fg-4' : i === stepIdx ? 'border-primary/50 bg-primary/15 text-primary-ink' : 'border-line text-fg-5'}`}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
      <div>
        <p className="text-lg font-bold text-fg">{stepText}</p>
        <div className="mt-2 h-2 rounded bg-slate-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Overall progress">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-2xs text-fg-4">
          <span>{pct}% · {progress.current || 0} of {progress.total || 0} backtests</span>
          {etaLabel && <span className="text-warning">⏳ {etaLabel}</span>}
          {progress.cellsTotal ? <span>{progress.cellsDone || 0} of {progress.cellsTotal} strategy × index cells finished</span> : null}
        </div>
        {(progress.current || 0) >= 20 && progress.tradesSeen === 0 && (
          <p className="mt-1 text-sm text-warning" role="status">⚠ {progress.current} backtests and not one trade yet — check the capital (can it afford one lot?) and the dates.</p>
        )}
        {progress.robustSoFar != null && (
          <p className="mt-1 text-sm text-success">So far: {progress.robustSoFar} strateg{progress.robustSoFar === 1 ? 'y holds' : 'ies hold'} up on at least {kDefault ?? 2} indexes</p>
        )}
      </div>

      {cells && strategies.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-2xs border-collapse">
            <caption className="sr-only">Progress per strategy and index</caption>
            <thead>
              <tr>
                <th className="text-left pr-3 py-1 text-fg-5 font-normal">Strategy</th>
                {symbols.map(s => <th key={s} className="px-1.5 py-1 text-fg-5 font-normal">{nameOf(s)}</th>)}
              </tr>
            </thead>
            <tbody>
              {strategies.map(st => (
                <tr key={st}>
                  <th scope="row" className="text-left pr-3 py-0.5 text-fg-3 font-normal whitespace-nowrap">{labelFor(st)}</th>
                  {symbols.map(sym => {
                    const c = cells[`${sym}::${st}`];
                    const status = c ? c.status : 'queued';
                    const text = c && c.planned ? `${c.done}/${c.planned}` : '—';
                    return (
                      <td key={sym} className="px-0.5 py-0.5">
                        <span className={`block min-w-[3.5rem] text-center rounded px-1 py-0.5 ${CELL_TONE[status] || CELL_TONE.queued}`}
                          title={`${labelFor(st)} on ${nameOf(sym)}: ${status}${c && c.robustBest != null ? ` · best robust score ${c.robustBest}` : ''}`}>
                          {text}{c && c.robustBest != null ? ' ✓' : ''}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-3xs text-fg-5 mt-1">✓ = at least one setting already holds up out-of-sample on that index.</p>
        </div>
      )}

      {resumedFrom > 0 && <p className="text-2xs text-fg-4">♻️ Resumed from a checkpoint — {resumedFrom} backtests were already done and are not redone.</p>}
      <div>
        <div className="flex flex-wrap gap-2">
          {onPause && (
            <button type="button" onClick={onPause} disabled={pausing || stopping}
              className="bg-slate-700 hover:bg-slate-600 text-fg font-semibold py-2 px-5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {pausing ? 'Pausing — saving checkpoint…' : 'Pause'}
            </button>
          )}
          <button type="button" onClick={onStop} disabled={stopping || pausing}
            className="bg-red-600/90 hover:bg-red-600 text-white font-semibold py-2 px-5 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            <Square className="w-4 h-4" aria-hidden="true" />
            {stopping ? 'Stopping — collecting results…' : 'Stop & keep finished results'}
          </button>
        </div>
        <p className="text-2xs text-fg-5 mt-1">Pause saves a checkpoint and continues later from exactly here (also after a crash or restart). Stop ranks what's finished now; it can still be continued from Recent runs.</p>
      </div>
    </div>
  );
}
