/**
 * ComboReplay — "which stops AND target, together, on these trades?" (user, 17-Nov-2026: "can we
 * have a combination section … which will tell the best SL and TP combined results with all the
 * details, marking current and the best for us"). The two grids above each change one thing; a
 * target changes which stop gets hit and a stop changes which trades can reach the target, so the
 * best of each is not the best of both.
 *
 * One deployment's recent trades replayed on the recorded option chain with every leg stop ×
 * rupee stop × profit target (the current value of each always in the grid). Shows:
 *   1. the settings worth naming — current, best net, best without a worse worst trade, smallest
 *      worst trade, and neither — side by side;
 *   2. the held-out check: chosen on the first 70% of the trades, measured on the rest;
 *   3. what the stops and the target each did in total, under the current and the best settings;
 *   4. every combination ranked, the current and the best marked;
 *   5. per trade, current vs best: how it ended, what the stops did, what the target did.
 * Each combination other than the current one has "Backtest & update…": the builder opens the
 * deployment for editing with it, backtests it next to the deployment's own settings, and saves it
 * only through the usual confirmation (MultiLeg.jsx; DeploymentEditPanel.jsx). A combination the
 * live engine would refuse (a naked short without its leg stop) is marked and has no button.
 *
 * Data: GET /api/multileg/deployments/:id/combo-grid (backend logic/services/stopWhatIf.js
 * comboGridJob → logic/multileg/tradeWhatIf.js comboGrid / comboPicks / comboHoldout /
 * settingEffects), through the same exit rules as the live engine.
 */
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useWhatIfJob from './useWhatIfJob.js';
import useRemWidth from '../../hooks/useRemWidth';
import { JobStatus, ReplayedLine } from './WhatIfGrid.jsx';
import { DayCell } from './StopReplay.jsx';
import { rup, signed, tone } from './stopReplayFormat.js';
import { tpLabel, tpWords } from './targetReplayFormat.js';
import { didText, endedText, legLabel, lossLabel, comboText, sameCombo, stopsSentence, targetSentence, tryLink } from './comboReplayFormat.js';
import { istDayLabel } from '../viz/tokens';

const TOP = 15;
const WIDE_REM = 72;   // the per-trade table needs about this much; narrower → one card per trade

export default function ComboGridPanel({ deploymentId, limit = 30 }) {
    const { st, job, res, start, recalc } = useWhatIfJob('combo-grid', deploymentId, limit);
    if (!deploymentId || deploymentId === 'all') {
        return <div className="text-3xs text-fg-5">Pick one deployment in the filter bar to replay its trades with every stop × target combination.</div>;
    }
    return (
        <div className="space-y-3 text-3xs text-fg-4" data-testid="combo-grid">
            <JobStatus st={st} job={job} start={start} recalc={recalc} label={`Replay its last ${limit} trades with every stop × target combination`}
                hint="Each trade keeps its strikes, fills and size; the leg stop, the rupee stop and the target change together. Several hundred combinations: a few minutes." />
            {res && <ComboResult res={res} job={job} />}
        </div>
    );
}

/** "Backtest & update…" for one combination (none for a setting the live engine refuses). */
function TryLink({ res, r, label, small = false }) {
    if (r.runnable === false) return <span className="text-fg-5" title="A naked short needs both a leg stop and a structure stop: the live engine refuses to run it this way">live refuses</span>;
    return (
        <Link to={tryLink(res.deploymentId, res, r, label)} className={`text-primary-ink hover:underline whitespace-nowrap ${small ? '' : 'font-semibold'}`}
            title="Open this deployment in the builder with these settings, backtest them next to its own settings, then save them after a confirmation" aria-label={`Backtest and update with ${comboText(res.key, r)}`}>
            {small ? 'backtest' : 'Backtest & update…'}
        </Link>
    );
}

/** The settings worth naming, deduplicated: one row per distinct combination, every label it earns. */
function namedRows(res) {
    const p = res.picks || {};
    const named = [
        ['current', 'Current', p.current],
        ['best', '★ Best net', p.best],
        ['noRiskier', 'Best without a worse worst trade', p.noRiskier],
        ['safest', 'Smallest worst trade', p.safest],
    ];
    const out = [];
    for (const [id, label, r] of named) {
        if (!r) continue;
        const same = out.find((o) => sameCombo(o.r, r));
        if (same) { same.labels.push(label); same.ids.push(id); } else out.push({ r, labels: [label], ids: [id] });
    }
    return out;
}

function ComboResult({ res, job }) {
    const { key } = res;
    const p = res.picks || {};
    const cur = p.current, best = p.best;
    const bestIsCurrent = sameCombo(best, cur);
    const rows = namedRows(res);
    return (
        <div className="space-y-3">
            <ReplayedLine res={res} job={job} perTrade={res.perTrade} />
            <div>
                {bestIsCurrent
                    ? <>The current settings (<b>{comboText(key, cur)}</b>) are already the best of {res.rows.length} combinations on these trades: <b className={tone(cur.net)}>{signed(cur.net)}</b>.</>
                    : <>Best on these trades: <b>{comboText(key, best)}</b> → <b className={tone(best?.net)}>{signed(best?.net)}</b>
                        {cur ? <>, <b className={tone(best.net - cur.net)}>{signed(best.net - cur.net)}</b> against the current <b>{comboText(key, cur)}</b> ({signed(cur.net)})</> : ''}.
                        {' '}That is in hindsight, on these {res.trades} trades. The check below shows whether choosing this way held up on later trades.</>}
            </div>
            <SettingsTable res={res} rows={rows} />
            <Holdout res={res} />
            <EffectsSummary res={res} bestIsCurrent={bestIsCurrent} />
            <Ranked res={res} />
            <PerTrade res={res} bestIsCurrent={bestIsCurrent} />
            {(res.caveats || []).map((c, i) => <div key={i} className="text-fg-5">{c}</div>)}
        </div>
    );
}

/** The named settings side by side, against the current one and against holding with neither. */
function SettingsTable({ res, rows }) {
    const { key } = res;
    const cur = res.picks?.current;
    const none = res.neither;
    return (
        <div className="overflow-x-auto">
            <table className="text-3xs font-mono" aria-label="Current and best stop and target settings">
                <thead>
                    <tr className="text-fg-5 text-left">
                        <th className="font-normal pr-3">Setting</th>
                        <th className="font-normal text-right px-2">Leg stop</th><th className="font-normal text-right px-2">Rupee stop</th>
                        <th className="font-normal text-right px-2">Target</th><th className="font-normal text-right px-2">Net</th>
                        <th className="font-normal text-right px-2">vs current</th><th className="font-normal text-right px-2">Worst trade</th>
                        <th className="font-normal text-right px-2">Winners</th><th className="font-normal text-right px-2">Stops acted</th>
                        <th className="font-normal text-right px-2">Target fired</th>
                        <th className="font-normal text-left pl-2">Try it</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ r, labels, ids }) => (
                        <tr key={labels.join()} className={`border-t border-line-0/60 ${ids.includes('current') ? 'ring-1 ring-primary' : ''}`}>
                            <td className={`pr-3 ${ids.includes('best') ? 'text-warning font-semibold' : 'text-fg-3'}`}>{labels.join(' · ')}</td>
                            <td className="text-right px-2">{legLabel(r.legSlX)}</td>
                            <td className="text-right px-2">{lossLabel(r.maxLoss)}</td>
                            <td className="text-right px-2">{tpLabel(key, r.tp)}</td>
                            <td className={`text-right px-2 ${tone(r.net)} ${ids.includes('best') ? 'font-bold' : ''}`}>{signed(r.net)}</td>
                            <td className={`text-right px-2 ${cur && !ids.includes('current') ? tone(r.net - cur.net) : 'text-fg-5'}`}>{cur && !ids.includes('current') ? signed(r.net - cur.net) : '—'}</td>
                            <td className={`text-right px-2 ${tone(r.worst)}`}>{signed(r.worst)}</td>
                            <td className="text-right px-2">{r.wins} of {r.n}</td>
                            <td className="text-right px-2">{r.stopped ?? '—'}</td>
                            <td className="text-right px-2">{r.targets}</td>
                            <td className="pl-2">{ids.includes('current') ? <span className="text-fg-5">running now</span> : <TryLink res={res} r={r} label={labels.join(' · ')} />}</td>
                        </tr>
                    ))}
                    {none && (
                        <tr className="border-t border-line-0/60 text-fg-5">
                            <td className="pr-3">Neither (no stops, no target)</td>
                            <td className="text-right px-2">off</td><td className="text-right px-2">off</td><td className="text-right px-2">off</td>
                            <td className={`text-right px-2 ${tone(none.net)}`}>{signed(none.net)}</td>
                            <td className={`text-right px-2 ${cur ? tone(none.net - cur.net) : ''}`}>{cur ? signed(none.net - cur.net) : '—'}</td>
                            <td className={`text-right px-2 ${tone(none.worst)}`}>{signed(none.worst)}</td>
                            <td className="text-right px-2">{none.wins} of {none.n}</td>
                            <td className="text-right px-2">0</td><td className="text-right px-2">0</td><td />
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

/** Chosen on the first 70% of the trades, measured on the rest — the fairer guide than the hindsight best. */
function Holdout({ res }) {
    const h = res.holdout;
    const { key } = res;
    if (!h) return null;
    if (!h.ok) return <div className="text-fg-5">Held-out check: not possible here ({h.why}).</div>;
    const diff = h.current ? h.pick.last - h.current.last : null;
    const from = istDayLabel(h.testFrom, { year: false });
    return (
        <div className="rounded border border-line-0 px-2 py-1.5">
            <b className="text-fg-3">Held-out check.</b>{' '}
            {h.pickIsCurrent
                ? <>Chosen on the first {h.firstTrades} trades alone, the best combination was the <b>current</b> one ({comboText(key, h.pick)}). On the last {h.lastTrades} trades (from {from}) it made <b className={tone(h.pick.last)}>{signed(h.pick.last)}</b>.</>
                : <>Chosen on the first {h.firstTrades} trades alone, the best was <b>{comboText(key, h.pick)}</b> ({signed(h.pick.first)} there).
                    {' '}On the last {h.lastTrades} trades (from {from}), which it never saw, it made <b className={tone(h.pick.last)}>{signed(h.pick.last)}</b>
                    {h.current ? <>; the current settings made <b className={tone(h.current.last)}>{signed(h.current.last)}</b></> : ''}.
                    {diff != null && <>{' '}<span className={diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : ''}>{diff > 0 ? `Choosing this way would have added ${rup(diff)}.` : diff < 0 ? `Choosing this way would have cost ${rup(-diff)}: the early best did not hold up.` : 'It made no difference.'}</span></>}</>}
            {h.hindsightBest && !sameCombo(h.hindsightBest, h.pick) && <span className="text-fg-5"> (The hindsight best, {comboText(key, h.hindsightBest)}, made {signed(h.hindsightBest.last)} on those last trades.)</span>}
        </div>
    );
}

/** What the stops and the target did in total, under the current settings and under the best. */
function EffectsSummary({ res, bestIsCurrent }) {
    const { key } = res;
    const e = res.effects || {};
    const line = (label, combo, fx) => fx && fx.n > 0 && (
        <li>
            <b className="text-fg-3">{label}</b> ({comboText(key, combo)}): {stopsSentence(fx)}; {targetSentence(fx, { set: combo.tp > 0 })}.
            {' '}Against holding every trade with neither: <b className={tone(fx.vsNeither)}>{signed(fx.vsNeither)}</b>.
        </li>
    );
    return (
        <div>
            <div className="text-fg-3 font-semibold">What the stops and the target did</div>
            <ul className="list-disc pl-4 space-y-0.5">
                {line('Current', res.picks?.current || res.current, e.current)}
                {!bestIsCurrent && line('Best', res.picks?.best, e.best)}
            </ul>
        </div>
    );
}

/** Every combination, best net first; the current and the best marked. */
function Ranked({ res }) {
    const [all, setAll] = useState(false);
    const { key } = res;
    const cur = res.picks?.current;
    const rank = cur ? res.rows.findIndex((r) => sameCombo(r, cur)) : -1;
    const shown = all ? res.rows : res.rows.slice(0, TOP);
    const curBelow = !all && rank >= TOP;
    const row = (r, i) => {
        const isCur = sameCombo(r, cur), isBest = sameCombo(r, res.picks?.best);   // the best the live engine runs
        return (
            <tr key={`${r.legSlX}|${r.maxLoss}|${r.tp}`} className={`border-t border-line-0/60 ${isCur ? 'ring-1 ring-primary' : ''} ${r.runnable === false ? 'opacity-60' : ''}`}>
                <td className="text-fg-5 pr-2">{i + 1}</td>
                <td className="text-right px-2">{legLabel(r.legSlX)}</td>
                <td className="text-right px-2">{lossLabel(r.maxLoss)}</td>
                <td className="text-right px-2">{tpLabel(key, r.tp)}</td>
                <td className={`text-right px-2 ${tone(r.net)} ${isBest ? 'font-bold' : ''}`}>{signed(r.net)}{isBest && <span className="text-warning" aria-label="best"> ★</span>}</td>
                <td className={`text-right px-2 ${tone(r.worst)}`}>{signed(r.worst)}</td>
                <td className="text-right px-2">{r.wins} of {r.n}</td>
                <td className="text-right px-2">{r.stopped ?? '—'}</td>
                <td className="text-right px-2">{r.targets}</td>
                <td className="pl-2">{isCur ? <span className="text-primary-ink">current</span> : <TryLink res={res} r={r} label={`#${i + 1} of every combination`} small />}</td>
            </tr>
        );
    };
    return (
        <div>
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-fg-3 font-semibold">Every combination, best net first</span>
                <span className="text-fg-5">{res.rows.length} combinations{cur ? `; the current one is #${rank + 1}` : ''}.</span>
                {res.rows.length > TOP && (
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} className="accent-sky-500" /> show all {res.rows.length}
                    </label>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="text-3xs font-mono" aria-label="Every stop and target combination, best net first">
                    <thead>
                        <tr className="text-fg-5 text-left">
                            <th className="font-normal pr-2">#</th>
                            <th className="font-normal text-right px-2">Leg stop</th><th className="font-normal text-right px-2">Rupee stop</th>
                            <th className="font-normal text-right px-2">Target ({res.keyLabel})</th><th className="font-normal text-right px-2">Net</th>
                            <th className="font-normal text-right px-2">Worst trade</th><th className="font-normal text-right px-2">Winners</th>
                            <th className="font-normal text-right px-2">Stops acted</th><th className="font-normal text-right px-2">Target fired</th><th />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r, i) => row(r, i))}
                        {curBelow && (
                            <>
                                <tr><td colSpan={10} className="text-fg-5 text-center">⋯</td></tr>
                                {row(res.rows[rank], rank)}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** One side (current or best) of a trade: its net, how it ended, and what its stops and target did. */
function SideCells({ s }) {
    if (!s) return <><td>—</td><td>—</td><td>—</td></>;
    return (
        <>
            <td className="text-right px-1 align-top">
                <div className={tone(s.net)}>{signed(s.net)}</div>
                <div className="text-fg-5 text-4xs whitespace-nowrap">{endedText(s)}</div>
            </td>
            <td className={`text-right px-1 align-top ${tone(s.stopsDid)}`}>{didText(s.stopsDid, 'saved')}</td>
            <td className={`text-right px-1 align-top ${tone(s.targetDid)}`}>{didText(s.targetDid, 'added')}</td>
        </>
    );
}

/** Per trade, current vs best: how each ended and what its stops and its target did. */
function PerTrade({ res, bestIsCurrent }) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const wide = rem == null || rem >= WIDE_REM;
    const { key } = res;
    const cur = res.picks?.current || res.current, best = res.picks?.best;
    if (!res.perTrade?.length) return null;
    return (
        <div ref={ref}>
            <div className="text-fg-3 font-semibold">Each trade: how the stops and the target did, current vs best</div>
            <div className="text-fg-5 mb-1">
                &quot;Stops did&quot; = the trade with those settings minus the same trade with every stop off; &quot;Target did&quot; = minus the same trade with the target off.
                {bestIsCurrent ? ' The best is the current setting, so the two sides are the same.' : ''}
            </div>
            {wide ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-3xs font-mono" aria-label="Each trade under the current and the best settings">
                        <thead>
                            <tr className="text-fg-5">
                                <th colSpan={3} />
                                <th colSpan={3} className="font-normal text-center border-b border-line-0">Current · {comboText(key, cur)}</th>
                                <th colSpan={3} className="font-normal text-center border-b border-line-0 text-warning">★ Best · {comboText(key, best)}</th>
                                <th />
                            </tr>
                            <tr className="text-fg-5 text-left">
                                <th className="font-normal">Day</th><th className="text-right font-normal px-1">Booked</th>
                                <th className="text-right font-normal px-1" title="Every stop and the target off">Neither</th>
                                <th className="text-right font-normal px-1">Net · ended</th><th className="text-right font-normal px-1">Stops did</th><th className="text-right font-normal px-1">Target did</th>
                                <th className="text-right font-normal px-1">Net · ended</th><th className="text-right font-normal px-1">Stops did</th><th className="text-right font-normal px-1">Target did</th>
                                <th className="text-right font-normal px-1">Best − current</th>
                            </tr>
                        </thead>
                        <tbody>
                            {res.perTrade.map((t) => (
                                <tr key={t.id} className="border-t border-line-0/60">
                                    <td className="align-top"><DayCell t={t} /></td>
                                    <td className={`text-right px-1 align-top ${tone(t.booked)}`}>{signed(t.booked)}</td>
                                    <td className={`text-right px-1 align-top ${tone(t.neither)}`}>{signed(t.neither)}</td>
                                    <SideCells s={t.current} />
                                    <SideCells s={t.best} />
                                    <td className={`text-right px-1 align-top ${tone(t.bestVsCurrent)}`}>{t.bestVsCurrent ? signed(t.bestVsCurrent) : 'same'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="space-y-1.5">
                    {res.perTrade.map((t) => (
                        <div key={t.id} className="rounded border border-line-0 px-2 py-1">
                            <div className="flex flex-wrap gap-x-3">
                                <DayCell t={t} />
                                <span>booked <b className={tone(t.booked)}>{signed(t.booked)}</b></span>
                                <span>neither <b className={tone(t.neither)}>{signed(t.neither)}</b></span>
                                <span>best − current <b className={tone(t.bestVsCurrent)}>{t.bestVsCurrent ? signed(t.bestVsCurrent) : 'same'}</b></span>
                            </div>
                            {[['Current', t.current], ['★ Best', t.best]].map(([label, s]) => s && (
                                <div key={label} className="flex flex-wrap gap-x-3">
                                    <span className="text-fg-3">{label}:</span>
                                    <span className={tone(s.net)}>{signed(s.net)}</span>
                                    <span className="text-fg-5">{endedText(s)}</span>
                                    <span>stops <span className={tone(s.stopsDid)}>{didText(s.stopsDid, 'saved')}</span></span>
                                    <span>target <span className={tone(s.targetDid)}>{didText(s.targetDid, 'added')}</span></span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
            {!bestIsCurrent && best && cur && (
                <div className="text-fg-5 mt-1">
                    The best ({tpWords(key, best.tp)}, leg {legLabel(best.legSlX)}, rupee {lossLabel(best.maxLoss)}) did better on {res.perTrade.filter((t) => t.bestVsCurrent > 0).length},
                    {' '}worse on {res.perTrade.filter((t) => t.bestVsCurrent < 0).length} and the same on {res.perTrade.filter((t) => !t.bestVsCurrent).length} of {res.perTrade.length} trades.
                </div>
            )}
        </div>
    );
}
