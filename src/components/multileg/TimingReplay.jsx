/**
 * TimingReplay — "which entry time and which exit time, on these days?" (user, 19-Nov-2026: "can we also
 * have a section in which we can find best entry and exit time also to enter in this").
 *
 * One deployment's recent trading days replayed at every entry time × exit (square-off) time. Another entry
 * time is another trade: each day's structure is opened by the deployment's own rule at that time (other
 * strikes, other premiums), managed with its current stops and target, and squared off at each exit time.
 * Shows:
 *   1. the pairs worth naming — current, best net, best without a worse worst day, smallest worst day;
 *   2. the held-out check: chosen on the first 70% of the days, measured on the rest;
 *   3. the entry × exit table, every cell shaded by its net, the current ringed and the best starred;
 *   4. every pair ranked, with "Backtest & update…" (the builder opens the deployment with that entry and
 *      square-off, backtests it next to its own settings, and saves only through the usual confirmation);
 *   5. per day, current vs best: when it entered, which strikes, how it ended.
 * A pair the live engine refuses (min_minutes_to_square_off) is marked and never picked. A positional or
 * signal deployment has no time grid, and the panel says why.
 *
 * Data: GET /api/multileg/deployments/:id/timing-grid (backend logic/services/timingWhatIf.js →
 * logic/multileg/timingWhatIf.js), saved like the other grids (useWhatIfJob).
 */
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useWhatIfJob from './useWhatIfJob.js';
import useRemWidth from '../../hooks/useRemWidth';
import { JobStatus } from './WhatIfGrid.jsx';
import { DayCell } from './StopReplay.jsx';
import { rup, signed, tone } from './stopReplayFormat.js';
import { timingText, sameTiming, heatStyle, heatScale, dayText, noEntryLines, daysPricesLine, timingTryLink, betterWorseText } from './timingReplayFormat.js';
import { istDayLabel } from '../viz/tokens';

const TOP = 15;
const WIDE_REM = 64;

export default function TimingGridPanel({ deploymentId, limit = 30 }) {
    const { st, job, res, start, recalc } = useWhatIfJob('timing-grid', deploymentId, limit);
    if (!deploymentId || deploymentId === 'all') {
        return <div className="text-3xs text-fg-5">Pick one deployment in the filter bar to replay its days at every entry and exit time.</div>;
    }
    return (
        <div className="space-y-3 text-3xs text-fg-4" data-testid="timing-grid">
            <JobStatus st={st} job={job} start={start} recalc={recalc} label={`Replay its last ${limit} trading days at every entry × exit time`}
                hint="Each day, the structure its own rule opens at each entry time, with its current stops and target, squared off at each exit time. About 130 pairs: a few minutes." />
            {res && <TimingResult res={res} job={job} />}
        </div>
    );
}

/** "Backtest & update…" for one pair (none for a pair the live engine refuses). */
function TryLink({ res, r, label, small = false }) {
    if (r.refused) return <span className="text-fg-5" title={r.refused}>live refuses</span>;
    return (
        <Link to={timingTryLink(res.deploymentId, res, r, label)} className={`text-primary-ink hover:underline whitespace-nowrap ${small ? '' : 'font-semibold'}`}
            title="Open this deployment in the builder with this entry time and square-off, backtest it next to its own settings, then save it after a confirmation"
            aria-label={`Backtest and update with entry ${r.entry} and square-off ${r.exit}`}>
            {small ? 'backtest' : 'Backtest & update…'}
        </Link>
    );
}

function TimingResult({ res, job }) {
    if (res.applicable === false) {
        return <div className="text-fg-3" data-testid="timing-none">No entry and exit time grid for {res.name || 'this deployment'}: {res.why}.</div>;
    }
    const p = res.picks || {};
    const cur = p.current, best = p.best;
    const bestIsCurrent = sameTiming(best, cur);
    return (
        <div className="space-y-3">
            <DaysLine res={res} job={job} />
            <div>
                {bestIsCurrent
                    ? <>Its own times (<b>{timingText(cur)}</b>) are already the best of {res.rows.length} pairs on these days: <b className={tone(cur?.net)}>{signed(cur?.net)}</b>.</>
                    : <>Best on these days: entry <b>{best?.entry}</b>, square-off <b>{best?.exit}</b> → <b className={tone(best?.net)}>{signed(best?.net)}</b>
                        {cur ? <>, <b className={tone(best.net - cur.net)}>{signed(best.net - cur.net)}</b> against its own <b>{timingText(cur)}</b> ({signed(cur.net)})</> : ''}.
                        {' '}That is in hindsight, on these {res.trades} days. The check below shows whether choosing this way held up on later days.</>}
            </div>
            <NamedTable res={res} />
            <Holdout res={res} />
            <TimeMatrix res={res} />
            <NoEntry res={res} />
            <Ranked res={res} />
            <PerDay res={res} bestIsCurrent={bestIsCurrent} />
            {(res.caveats || []).map((c, i) => <div key={i} className="text-fg-5">{c}</div>)}
        </div>
    );
}

/** "19 trading days replayed; 11 older not included; 1 could not be replayed (…). 11 of 19 days on the quote tape…" */
function DaysLine({ res, job }) {
    const skipped = res.skipped || [];
    return (
        <div>
            {res.trades} trading day(s) replayed (the days it traded){job?.beyondLimit > 0 ? `; ${job.beyondLimit} older trade(s) not included (limit ${job.limit})` : ''}
            {job?.quarantinedExcluded > 0 ? `; ${job.quarantinedExcluded} void fill(s) excluded` : ''}
            {skipped.length > 0 ? `; ${skipped.length} day(s) could not be replayed (${[...new Set(skipped.map((s) => s.why))].join('; ')})` : ''}.
            {daysPricesLine(res.prices) && <> {daysPricesLine(res.prices)}</>}
        </div>
    );
}

/** The pairs worth naming, deduplicated: one row per distinct pair, every label it earns. */
function namedRows(res) {
    const p = res.picks || {};
    const out = [];
    for (const [id, label, r] of [['current', 'Its own times', p.current], ['best', '★ Best net', p.best], ['noRiskier', 'Best without a worse worst day', p.noRiskier], ['safest', 'Smallest worst day', p.safest]]) {
        if (!r) continue;
        const same = out.find((o) => sameTiming(o.r, r));
        if (same) { same.labels.push(label); same.ids.push(id); } else out.push({ r, labels: [label], ids: [id] });
    }
    return out;
}

function NamedTable({ res }) {
    const cur = res.picks?.current;
    return (
        <div className="overflow-x-auto">
            <table className="text-3xs font-mono" aria-label="Its own and the best entry and exit times">
                <thead>
                    <tr className="text-fg-5 text-left">
                        <th className="font-normal pr-3">Pair</th>
                        <th className="font-normal text-right px-2">Entry</th><th className="font-normal text-right px-2">Square-off</th>
                        <th className="font-normal text-right px-2">Net</th><th className="font-normal text-right px-2">vs own</th>
                        <th className="font-normal text-right px-2">Worst day</th><th className="font-normal text-right px-2">Winners</th>
                        <th className="font-normal text-right px-2">Stops acted</th><th className="font-normal text-right px-2">Target hit</th>
                        <th className="font-normal text-left pl-2">Try it</th>
                    </tr>
                </thead>
                <tbody>
                    {namedRows(res).map(({ r, labels, ids }) => (
                        <tr key={labels.join()} className={`border-t border-line-0/60 ${ids.includes('current') ? 'ring-1 ring-primary' : ''}`}>
                            <td className={`pr-3 ${ids.includes('best') ? 'text-warning font-semibold' : 'text-fg-3'}`}>{labels.join(' · ')}</td>
                            <td className="text-right px-2">{r.entry}</td>
                            <td className="text-right px-2">{r.exit}</td>
                            <td className={`text-right px-2 ${tone(r.net)} ${ids.includes('best') ? 'font-bold' : ''}`}>{signed(r.net)}</td>
                            <td className={`text-right px-2 ${cur && !ids.includes('current') ? tone(r.net - cur.net) : 'text-fg-5'}`}>{cur && !ids.includes('current') ? signed(r.net - cur.net) : '—'}</td>
                            <td className={`text-right px-2 ${tone(r.worst)}`}>{signed(r.worst)}</td>
                            <td className="text-right px-2">{r.wins} of {r.n}{r.noEntry ? <span className="text-fg-5" title={`No entry on ${r.noEntry} of ${r.days} days`}> ({r.noEntry} no entry)</span> : ''}</td>
                            <td className="text-right px-2">{r.stopped ?? '—'}</td>
                            <td className="text-right px-2">{r.targets}</td>
                            <td className="pl-2">{ids.includes('current') ? <span className="text-fg-5">running now</span> : <TryLink res={res} r={r} label={labels.join(' · ')} />}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Chosen on the first 70% of the days, measured on the rest — the fairer guide than the hindsight best. */
function Holdout({ res }) {
    const h = res.holdout;
    if (!h) return null;
    if (!h.ok) return <div className="text-fg-5">Held-out check: not possible here ({h.why.replace(/trade/g, 'day')}).</div>;
    const diff = h.current ? h.pick.last - h.current.last : null;
    const from = istDayLabel(h.testFrom, { year: false });
    return (
        <div className="rounded border border-line-0 px-2 py-1.5" data-testid="timing-holdout">
            <b className="text-fg-3">Held-out check.</b>{' '}
            {h.pickIsCurrent
                ? <>Chosen on the first {h.firstTrades} days alone, the best pair was its <b>own</b> ({timingText(h.pick)}). On the last {h.lastTrades} days (from {from}) it made <b className={tone(h.pick.last)}>{signed(h.pick.last)}</b>.</>
                : <>Chosen on the first {h.firstTrades} days alone, the best was <b>{timingText(h.pick)}</b> ({signed(h.pick.first)} there).
                    {' '}On the last {h.lastTrades} days (from {from}), which it never saw, it made <b className={tone(h.pick.last)}>{signed(h.pick.last)}</b>
                    {h.current ? <>; its own times made <b className={tone(h.current.last)}>{signed(h.current.last)}</b></> : ''}.
                    {diff != null && <>{' '}<span className={diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : ''}>{diff > 0 ? `Choosing this way would have added ${rup(diff)}.` : diff < 0 ? `Choosing this way would have cost ${rup(-diff)}: the early best did not hold up.` : 'It made no difference.'}</span></>}</>}
            {h.hindsightBest && !sameTiming(h.hindsightBest, h.pick) && <span className="text-fg-5"> (The hindsight best, {timingText(h.hindsightBest)}, made {signed(h.hindsightBest.last)} on those last days.)</span>}
        </div>
    );
}

/** Entry time (rows) × square-off time (columns): every pair's net, shaded; its own ringed, the best starred. */
function TimeMatrix({ res }) {
    const { entries = [], exits = [] } = res.axes || {};
    const cell = new Map(res.rows.map((r) => [`${r.entry}|${r.exit}`, r]));
    const cur = res.picks?.current, best = res.picks?.best;
    const scale = heatScale(res.rows);
    return (
        <div>
            <div className="text-fg-3 font-semibold">Every entry × square-off time</div>
            <div className="text-fg-5 mb-1">Net over the days, each cell shaded by its size (green a gain, red a loss). Rows are the entry time, columns the square-off. Hover a cell for its worst day and winners. A blank cell is an exit under {res.minHoldMin} min after the entry.</div>
            <div className="overflow-x-auto">
                <table className="text-3xs font-mono" aria-label="Net by entry time and square-off time">
                    <thead>
                        <tr className="text-fg-5">
                            <th className="text-left pr-2 font-normal">entry ↓ · exit →</th>
                            {exits.map((x) => <th key={x} className={`text-right px-1.5 font-normal ${x === res.current?.exit ? 'text-primary-ink' : ''}`}>{x}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((e) => (
                            <tr key={e} className="border-t border-line-0/40">
                                <td className={`pr-2 ${e === res.current?.entry ? 'text-primary-ink' : 'text-fg-5'}`}>{e}</td>
                                {exits.map((x) => {
                                    const r = cell.get(`${e}|${x}`);
                                    if (!r) return <td key={x} />;
                                    const isCur = sameTiming(r, cur), isBest = sameTiming(r, best);
                                    return (
                                        <td key={x} style={r.refused ? undefined : heatStyle(r.net, scale)}
                                            className={`text-right px-1.5 py-0.5 whitespace-nowrap ${isCur ? 'ring-1 ring-primary' : ''} ${r.refused ? 'text-fg-6 line-through' : ''}`}
                                            title={`${timingText(r)}: ${signed(r.net)} · worst day ${signed(r.worst)} · ${r.wins} of ${r.n} won${r.noEntry ? ` · no entry on ${r.noEntry}` : ''}${r.refused ? ` · ${r.refused}` : ''}${isCur ? ' · its own times' : ''}`}>
                                            <span className={`${r.refused ? '' : tone(r.net)} ${isBest ? 'font-bold' : ''}`}>{signed(r.net)}</span>
                                            {isBest && <span className="text-warning" aria-label="best"> ★</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {res.runwayMin > 0 && <div className="text-fg-5">Struck through: under {res.runwayMin} min from entry to square-off, which the live engine refuses (its min_minutes_to_square_off).</div>}
        </div>
    );
}

/** The entry times that could not open a structure on every day — counted, never silent. */
function NoEntry({ res }) {
    const lines = noEntryLines(res.noEntry);
    if (!lines.length) return null;
    return <div className="text-fg-5">No entry at some times (those days count as ₹0 in that row): {lines.join('; ')}.</div>;
}

/** Every pair, best net first; its own and the best marked. */
function Ranked({ res }) {
    const [all, setAll] = useState(false);
    const cur = res.picks?.current;
    const rank = cur ? res.rows.findIndex((r) => sameTiming(r, cur)) : -1;
    const shown = all ? res.rows : res.rows.slice(0, TOP);
    const curBelow = !all && rank >= TOP;
    const row = (r, i) => {
        const isCur = sameTiming(r, cur), isBest = sameTiming(r, res.picks?.best);
        return (
            <tr key={`${r.entry}|${r.exit}`} className={`border-t border-line-0/60 ${isCur ? 'ring-1 ring-primary' : ''} ${r.refused ? 'opacity-60' : ''}`}>
                <td className="text-fg-5 pr-2">{i + 1}</td>
                <td className="text-right px-2">{r.entry}</td>
                <td className="text-right px-2">{r.exit}</td>
                <td className={`text-right px-2 ${tone(r.net)} ${isBest ? 'font-bold' : ''}`}>{signed(r.net)}{isBest && <span className="text-warning" aria-label="best"> ★</span>}</td>
                <td className={`text-right px-2 ${tone(r.worst)}`}>{signed(r.worst)}</td>
                <td className="text-right px-2">{r.wins} of {r.n}</td>
                <td className="text-right px-2">{r.stopped ?? '—'}</td>
                <td className="text-right px-2">{r.targets}</td>
                <td className="pl-2">{isCur ? <span className="text-primary-ink">its own</span> : <TryLink res={res} r={r} label={`#${i + 1} of every entry and exit time`} small />}</td>
            </tr>
        );
    };
    return (
        <div>
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-fg-3 font-semibold">Every pair, best net first</span>
                <span className="text-fg-5">{res.rows.length} pairs{cur ? `; its own is #${rank + 1}` : ''}.</span>
                {res.rows.length > TOP && (
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} className="accent-sky-500" /> show all {res.rows.length}
                    </label>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="text-3xs font-mono" aria-label="Every entry and exit time, best net first">
                    <thead>
                        <tr className="text-fg-5 text-left">
                            <th className="font-normal pr-2">#</th>
                            <th className="font-normal text-right px-2">Entry</th><th className="font-normal text-right px-2">Square-off</th>
                            <th className="font-normal text-right px-2">Net</th><th className="font-normal text-right px-2">Worst day</th>
                            <th className="font-normal text-right px-2">Winners</th><th className="font-normal text-right px-2">Stops acted</th>
                            <th className="font-normal text-right px-2">Target hit</th><th />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r, i) => row(r, i))}
                        {curBelow && (
                            <>
                                <tr><td colSpan={9} className="text-fg-5 text-center">⋯</td></tr>
                                {row(res.rows[rank], rank)}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** One side of a day: its net, then when it entered, which strikes, how it ended. */
function Side({ s }) {
    if (!s) return <td>—</td>;
    return (
        <td className="text-right px-1 align-top">
            <div className={tone(s.net)}>{s.noEntry ? '—' : signed(s.net)}</div>
            <div className="text-fg-5 text-4xs whitespace-nowrap">{dayText(s)}</div>
        </td>
    );
}

/** Per day, its own times vs the best pair: when each entered, which strikes, how it ended. */
function PerDay({ res, bestIsCurrent }) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const wide = rem == null || rem >= WIDE_REM;
    const cur = res.picks?.current, best = res.picks?.best;
    if (!res.perTrade?.length) return null;
    return (
        <div ref={ref}>
            <div className="text-fg-3 font-semibold">Each day: its own times vs the best</div>
            <div className="text-fg-5 mb-1">
                Booked is what really happened. Each side is that day replayed: the structure its rule opened at that entry time, with its current stops and target.
                {bestIsCurrent ? ' The best is its own pair, so the two sides are the same.' : ''}
            </div>
            {wide ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-3xs font-mono" aria-label="Each day at its own entry and exit time and at the best">
                        <thead>
                            <tr className="text-fg-5 text-left">
                                <th className="font-normal">Day</th><th className="text-right font-normal px-1">Booked</th>
                                <th className="text-right font-normal px-1">Own · {timingText(cur)}</th>
                                <th className="text-right font-normal px-1 text-warning">★ Best · {timingText(best)}</th>
                                <th className="text-right font-normal px-1">Best − own</th>
                            </tr>
                        </thead>
                        <tbody>
                            {res.perTrade.map((t) => (
                                <tr key={t.id} className="border-t border-line-0/60">
                                    <td className="align-top"><DayCell t={t} /></td>
                                    <td className={`text-right px-1 align-top ${tone(t.booked)}`}>{signed(t.booked)}</td>
                                    <Side s={t.current} />
                                    <Side s={t.best} />
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
                                <span>best − own <b className={tone(t.bestVsCurrent)}>{t.bestVsCurrent ? signed(t.bestVsCurrent) : 'same'}</b></span>
                            </div>
                            {[['Own', t.current], ['★ Best', t.best]].map(([label, s]) => s && (
                                <div key={label} className="flex flex-wrap gap-x-3">
                                    <span className="text-fg-3">{label} {timingText(s)}:</span>
                                    <span className={tone(s.net)}>{s.noEntry ? '—' : signed(s.net)}</span>
                                    <span className="text-fg-5">{dayText(s)}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
            {!bestIsCurrent && best && cur && <div className="text-fg-5 mt-1">The best against its own times: {betterWorseText(res.perTrade)}.</div>}
        </div>
    );
}
