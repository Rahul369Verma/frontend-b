import React, { useRef } from 'react';
import { Chip, DataTable, StatTile, StatRow } from '../viz/primitives';
import { inr, pnlTone } from '../viz/tokens';
import useRemWidth from '../../hooks/useRemWidth.js';
import { bucketsAddUp, BLOCK_WORDS, sourceLabel } from './combinerApi.js';

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

/** Expired-vote reasons, most common first, as "reason n". */
function expiredText(expired = {}) {
    const e = Object.entries(expired).sort((a, b) => b[1] - a[1]);
    if (!e.length) return '—';
    return e.map(([k, n]) => `${BLOCK_WORDS[k] || k} ${n}`).join(' · ');
}

/**
 * A Signal Combiner backtest's own report (result.strategyReport): where every member signal
 * went (each lands in exactly one bucket — the table says so per member), which voter sets
 * made the money, and how often members fire together.
 */
export default function CombinerReport({ report }) {
    const box = useRef(null);
    const rem = useRemWidth(box);
    const wide = rem == null || rem >= 70;
    if (!report) return null;
    const members = report.members || [];
    const allAddUp = members.every(bucketsAddUp);
    const decisions = Object.entries(report.decisions || {}).sort((a, b) => b[1] - a[1]);

    const memberCols = [
        { key: 'id', header: 'Member', render: m => <span className="text-fg-3">{m.id} <span className="text-fg-5">{m.role !== 'voter' ? `(${m.role})` : ''}</span></span> },
        { key: 'fired', header: 'Fired', align: 'right', render: m => <span title={`CE ${m.CE} · PE ${m.PE}`}>{m.fired}</span> },
        { key: 'used', header: 'In an entry', align: 'right', render: m => `${m.used} (${pct(m.used, m.fired)})` },
        { key: 'chosen', header: 'Set the stop', align: 'right' },
        ...(wide ? [
            { key: 'cleared', header: 'Cleared', align: 'right' },
            { key: 'replaced', header: 'Replaced', align: 'right' },
        ] : []),
        { key: 'expired', header: 'Expired unused — why', render: m => <span className="text-fg-5 whitespace-normal">{expiredText(m.expired)}</span> },
        { key: 'ok', header: '', render: m => (bucketsAddUp(m) ? <span className="text-success" title="every signal is in exactly one bucket">✓</span> : <span className="text-danger" title="buckets do not add up to fired">✕</span>) },
        ...(members.some(m => m.errors) ? [{ key: 'errors', header: 'Errors', align: 'right', render: m => (m.errors ? <span className="text-danger" title={m.firstError || ''}>{m.errors}</span> : '0') }] : []),
    ];
    const setCols = [
        { key: 'key', header: 'Voters', render: r => <span className="text-fg-3 whitespace-normal">{r.key}</span> },
        { key: 'trades', header: 'Trades', align: 'right' },
        { key: 'wins', header: 'Win %', align: 'right', render: r => pct(r.wins, r.trades) },
        { key: 'net', header: 'Net', align: 'right', render: r => <span className={pnlTone(r.net)}>{inr(r.net, { sign: true })}</span> },
    ];

    const co = report.coFire || { ids: [], same: [], opposite: [] };
    const firedOf = Object.fromEntries(members.map(m => [m.id, m.fired]));

    return (
        <div ref={box} className="space-y-4">
            <StatRow cols={4}>
                <StatTile label="Rule" value={report.rule} hint={`window ${report.settings?.vote_window_bars ?? '—'} bar(s)`} />
                <StatTile label="Entries signalled" value={report.entries} hint={`${report.trades} became trades`} />
                <StatTile label="Trades with a voter record" value={`${report.tradesWithSignalRecord}/${report.trades}`} />
                <StatTile label="Buckets add up" value={allAddUp ? 'yes' : 'NO'} tone={allAddUp ? 'positive' : 'negative'} hint="each member signal counted once" />
            </StatRow>

            {(report.warnings || []).map((w, i) => <p key={i} className="text-xs text-warning">⚠ {w}</p>)}

            <div>
                <h3 className="text-xs font-semibold text-fg-3 mb-1">Where every member signal went</h3>
                <DataTable dense columns={memberCols} rows={members.map(m => ({ ...m, _key: m.id }))} />
                <p className="text-3xs text-fg-5 mt-1">
                    “Cleared” = in the window when the combiner entered on the other side; “Replaced” = superseded by the same member's newer signal.
                    Members' own daily caps were {members.some(m => m.dailyCapDisabled) ? 'off (the combiner\'s cap governs)' : 'on'}.
                    {report.replayedBars ? ` ${report.replayedBars} bar(s) replayed.` : ''}
                    {report.tape ? ` Member signals precomputed for ${report.tape.bars} bars.` : ''}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                    {members.map(m => <Chip key={m.id} tone="muted" title={sourceLabel(m.source)}>{m.id} #{m.hash}</Chip>)}
                </div>
            </div>

            <div>
                <h3 className="text-xs font-semibold text-fg-3 mb-1">Decisions, bar by bar</h3>
                <div className="flex flex-wrap gap-1">
                    {decisions.map(([k, n]) => <Chip key={k} tone={k === 'ENTER' ? 'good' : 'neutral'} title={k}>{BLOCK_WORDS[k] || k}: {n}</Chip>)}
                </div>
            </div>

            <div className={`grid gap-4 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div>
                    <h3 className="text-xs font-semibold text-fg-3 mb-1">P&amp;L by voter set</h3>
                    <DataTable dense columns={setCols} rows={(report.voterSets || []).map(r => ({ ...r, _key: r.key }))} maxHeight="18rem" />
                </div>
                <div>
                    <h3 className="text-xs font-semibold text-fg-3 mb-1">P&amp;L by the member that set the stop</h3>
                    <DataTable dense columns={setCols.map(c => (c.key === 'key' ? { ...c, header: 'Member' } : c))} rows={(report.byChosen || []).map(r => ({ ...r, _key: r.key }))} maxHeight="18rem" />
                </div>
            </div>

            {co.ids.length > 1 && (
                <div>
                    <h3 className="text-xs font-semibold text-fg-3 mb-1">How often members fire together (within {co.windowBars} bar{co.windowBars === 1 ? '' : 's'})</h3>
                    <div className="overflow-x-auto">
                        <table className="text-xs">
                            <thead>
                                <tr className="text-fg-5">
                                    <th className="px-2 py-1 text-left font-medium">Of row's signals…</th>
                                    {co.ids.map(id => <th key={id} className="px-2 py-1 font-medium whitespace-nowrap">{id}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {co.ids.map((a, i) => (
                                    <tr key={a} className="border-t border-line/40">
                                        <td className="px-2 py-1 text-fg-3 whitespace-nowrap">{a}</td>
                                        {co.ids.map((b, j) => {
                                            if (i === j) return <td key={b} className="px-2 py-1 text-center text-fg-6">—</td>;
                                            const same = co.same[i]?.[j] || 0, opp = co.opposite[i]?.[j] || 0, n = firedOf[a] || 0;
                                            const share = n ? same / n : 0;
                                            return (
                                                <td key={b} className="px-2 py-1 text-center tabular-nums" title={`${same} same side, ${opp} opposite side, of ${n}`}
                                                    style={{ backgroundColor: share > 0 ? `color-mix(in srgb, var(--color-primary) ${Math.round(Math.min(1, share) * 45)}%, transparent)` : undefined }}>
                                                    {pct(same, n)}{opp ? <span className="text-danger"> /{pct(opp, n)}</span> : null}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-3xs text-fg-5 mt-1">Share of the row member's signals with the column member on the same side (red: the opposite side). Two members that nearly always fire together add little confirmation.{co.droppedVotes ? ` ${co.droppedVotes} votes beyond the reporting limit were not counted here.` : ''}</p>
                </div>
            )}
        </div>
    );
}
