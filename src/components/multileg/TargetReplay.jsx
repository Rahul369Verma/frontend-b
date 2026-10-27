/**
 * TargetReplay — "which profit target, on these trades?" (user, 27-Oct-2026: "can we also build
 * it for the best take profit"). The twin of StopGridPanel: one deployment's recent trades
 * replayed on the recorded option chain with other profit targets × rupee stops, every other
 * setting (its leg stop, structure stop and time exits) as it is now; then, per trade, what the
 * current target did and how close the trade came to it.
 *
 * Data: GET /api/multileg/deployments/:id/target-grid (backend logic/services/stopWhatIf.js
 * targetGridJob → logic/multileg/tradeWhatIf.js targetGrid / targetWhatIf), through the same
 * exit rules as the live engine.
 */
import React from 'react';
import useWhatIfJob from './useWhatIfJob.js';
import { JobStatus, ReplayedLine, GridTable } from './WhatIfGrid.jsx';
import { DayCell } from './StopReplay.jsx';
import { rup, signed, tone, hhmm, reasonText } from './stopReplayFormat.js';
import { tpLabel, tpWords, bestText, reachSummary } from './targetReplayFormat.js';
import { istDayLabel } from '../viz/tokens';

const lossLabel = (x) => (x > 0 ? rup(x) : 'off');

export default function TargetGridPanel({ deploymentId, limit = 30 }) {
    const { st, job, res, start } = useWhatIfJob('target-grid', deploymentId, limit);
    if (!deploymentId || deploymentId === 'all') {
        return <div className="text-3xs text-fg-5">Pick one deployment in the filter bar to replay its trades with other profit targets.</div>;
    }
    return (
        <div className="space-y-2 text-3xs text-fg-4" data-testid="target-grid">
            <JobStatus st={st} job={job} start={start} label={`Replay its last ${limit} trades with other profit targets`}
                hint="Each trade keeps its strikes, fills, size and stops; only the target and the rupee stop change. Takes ~10–60 s." />
            {res && <TargetResult res={res} job={job} />}
        </div>
    );
}

function TargetResult({ res, job }) {
    const { key } = res;
    const cell = (tp, m) => res.rows.find((r) => r.tp === tp && r.maxLoss === m);
    const best = res.rows[0];
    const cur = cell(res.current.tp, res.current.maxLoss);
    const none = cell(0, res.current.maxLoss);
    const reach = reachSummary(res.perTrade);
    const thin = best && best.tp > 0 && best.targets <= 2 && none && best.net !== none.net;
    return (
        <div className="space-y-2">
            <ReplayedLine res={res} job={job} perTrade={res.perTrade} />
            <div>
                Best net on these trades: <b>target {tpWords(key, best.tp)} + rupee {lossLabel(best.maxLoss)}</b> → <b className={tone(best.net)}>{signed(best.net)}</b>
                {' '}(worst trade {signed(best.worst)}; the target fired on {best.targets} of {best.n}).
                {' '}Current <b>{tpWords(key, res.current.tp)} + rupee {lossLabel(res.current.maxLoss)}</b> → {cur ? <><b className={tone(cur.net)}>{signed(cur.net)}</b> (fired on {cur.targets})</> : 'not in the grid'}.
                {none && res.current.tp > 0 && <>{' '}No target (rupee stop as now) → <b className={tone(none.net)}>{signed(none.net)}</b>.</>}
            </div>
            {cur && res.current.tp > 0 && cur.targets === 0 && (
                <div className="text-warning">The current target never fired on these trades, so it changes nothing here: they all closed by their stops or time exits.</div>
            )}
            {thin && (
                <div className="text-warning">The best target fired on only {best.targets} trade(s): its {signed(best.net - none.net)} over no target rests on {best.targets === 1 ? 'that one trade' : 'those trades'} alone.</div>
            )}
            <GridTable rows={res.rows} rowKey="tp" colKey="maxLoss" rowLabel={(v) => tpLabel(key, v)} colLabel={lossLabel}
                corner={`target (${res.keyLabel}) ↓ · rupee stop →`} current={{ row: res.current.tp, col: res.current.maxLoss }}
                ariaLabel="Net P&L by profit target and rupee stop"
                sub={(c) => (
                    <>
                        <div className="text-fg-5 text-4xs">worst {signed(c.worst)}</div>
                        <div className="text-fg-5 text-4xs">{c.targets ? `target ×${c.targets}` : 'never fired'}</div>
                    </>
                )} />
            {reach.n > 0 && (
                <div>
                    How far the trades got: each one&apos;s best point before costs was a median <b>{bestText(key, reach.median)}</b>, the highest
                    {' '}<b>{bestText(key, reach.top)}</b>{reach.topDay ? ` (${istDayLabel(reach.topDay, { year: false })})` : ''}.
                    {' '}A target fires on a trade only if it is at or below that trade&apos;s best point. With the current one, {reach.hit} of {res.perTrade.length} reached it.
                    {' '}A low target takes small wins early and gives up the rest; a high one never fires.
                </div>
            )}
            {res.perTrade.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-3xs font-mono">
                        <thead>
                            <tr className="text-fg-5 text-left">
                                <th className="font-normal">Day</th><th className="text-right font-normal">Booked</th>
                                <th className="text-right font-normal">With target</th><th className="text-right font-normal">No target</th>
                                <th className="text-right font-normal">Target did</th>
                                <th className="text-right font-normal">Best point (before costs)</th>
                                <th className="text-right font-normal">Target level</th>
                                <th className="font-normal pl-2">After the target</th>
                            </tr>
                        </thead>
                        <tbody>
                            {res.perTrade.map((t) => (
                                <tr key={t.id} className="border-t border-line-0/60">
                                    <td><DayCell t={t} /></td>
                                    <td className={`text-right ${tone(t.booked)}`}>{signed(t.booked)}</td>
                                    <td className={`text-right ${tone(t.withTarget)}`} title={reasonText(t.withTargetReason)}>{signed(t.withTarget)}</td>
                                    <td className={`text-right ${tone(t.noTarget)}`} title={reasonText(t.noTargetReason)}>{signed(t.noTarget)}</td>
                                    <td className={`text-right ${tone(t.targetEffect)}`}>{t.targetEffect == null ? '—' : t.targetEffect > 0 ? `added ${rup(t.targetEffect)}` : t.targetEffect < 0 ? `cost ${rup(-t.targetEffect)}` : 'nothing'}</td>
                                    <td className="text-right">{signed(t.bestGross)} <span className="text-fg-5">· {bestText(key, t.bestInTargetUnit)}</span></td>
                                    <td className="text-right text-fg-5">{t.targetRupees == null ? 'none' : `+${rup(t.targetRupees)}`}</td>
                                    <td className="pl-2">
                                        {!t.hit ? <span className="text-fg-5">{t.targetRupees == null ? '—' : 'not reached'}</span>
                                            : t.afterTarget?.wentHigher
                                                ? <span className="text-warning">took it {hhmm(t.afterTarget.at)} → held, it went to {signed(t.afterTarget.bestAfter)} and ended {signed(t.afterTarget.ended)}</span>
                                                : <span className="text-fg-5">took it {hhmm(t.afterTarget?.at)} → never higher after</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {(res.caveats || []).map((c, i) => <div key={i} className="text-fg-5">{c}</div>)}
        </div>
    );
}
