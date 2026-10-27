/**
 * WhatIfGrid — the pieces the two Results grids share ("Which stops, on these trades" and
 * "Which target, on these trades"): the job's start / progress / failure line, the line that
 * counts what was left out, and the two-axis table of net P&L.
 */
import React from 'react';
import { Spinner } from '../viz/primitives';
import { signed, tone } from './stopReplayFormat.js';

const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50';

/** Idle → a button; running → progress; failed → the error and a retry. */
export function JobStatus({ st, job, start, label, hint }) {
    return (
        <>
            {st.status === 'idle' && (
                <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" className={BTN} onClick={start}>{label}</button>
                    <span className="text-fg-5">{hint}</span>
                </div>
            )}
            {['queued', 'loading', 'running'].includes(st.status) && (
                <Spinner size="xs" label={st.status === 'running' && job?.total ? `Replaying… ${job.done}/${job.total}` : st.status === 'loading' ? 'Loading recorded quotes…' : 'Waiting for another replay to finish…'} />
            )}
            {st.status === 'error' && <div className="text-danger">Failed: {st.error} <button type="button" className="ml-1 underline" onClick={start}>retry</button></div>}
            {st.status === 'failed' && <div className="text-danger">Replay failed: {job?.error}</div>}
        </>
    );
}

/** "22 trade(s) replayed; 4 older not included; 1 void fill excluded; …" — every omission counted. */
export function ReplayedLine({ res, job, perTrade }) {
    const holes = (perTrade || []).filter((t) => t.gaps?.length).length;
    return (
        <div>
            {res.trades} trade(s) replayed{job.beyondLimit > 0 ? `; ${job.beyondLimit} older trade(s) not included (limit ${job.limit})` : ''}
            {job.quarantinedExcluded > 0 ? `; ${job.quarantinedExcluded} void fill(s) excluded` : ''}
            {holes ? `; ${holes} ran through a hole in the recorded prices (⚠ below)` : ''}
            {res.skipped.length > 0 ? `; ${res.skipped.length} could not be replayed (${[...new Set(res.skipped.map((s) => s.why))].join('; ')})` : ''}.
        </div>
    );
}

/** Distinct values of one axis, ascending with "off" (0) last. */
const axisOf = (rows, key) => [...new Set(rows.map((r) => r[key]))].sort((a, b) => (a === 0) - (b === 0) || a - b);

/**
 * Net P&L for every (row, column) setting; the best cell starred, the current one ringed.
 * `sub(cell)` adds lines under the net (the worst trade, targets hit…).
 */
export function GridTable({ rows, rowKey, colKey, rowLabel, colLabel, corner, current, ariaLabel, sub }) {
    const rv = axisOf(rows, rowKey), cv = axisOf(rows, colKey);
    const cell = (r, c) => rows.find((x) => x[rowKey] === r && x[colKey] === c);
    const best = rows[0];   // the server sorts best net first
    return (
        <div className="overflow-x-auto">
            <table className="text-3xs font-mono" aria-label={ariaLabel}>
                <thead>
                    <tr className="text-fg-5">
                        <th className="text-left pr-3 font-normal">{corner}</th>
                        {cv.map((c) => <th key={c} className="text-right px-2 font-normal">{colLabel(c)}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rv.map((r) => (
                        <tr key={r} className="border-t border-line-0/60">
                            <td className="pr-3 text-fg-5">{rowLabel(r)}</td>
                            {cv.map((c) => {
                                const x = cell(r, c);
                                const isCur = current && r === current.row && c === current.col;
                                const isBest = x === best;
                                return (
                                    <td key={c} className={`text-right px-2 py-0.5 ${isCur ? 'ring-1 ring-primary rounded' : ''}`}
                                        title={x ? `${x.n} trades · ${x.wins} winners · worst ${signed(x.worst)} · avg ${signed(x.avg)}${isCur ? ' · CURRENT setting' : ''}` : ''}>
                                        <span className={`${tone(x?.net)} ${isBest ? 'font-bold' : ''}`}>{x ? signed(x.net) : '—'}</span>
                                        {isBest && <span className="text-warning" aria-label="best"> ★</span>}
                                        {sub && x && sub(x)}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
