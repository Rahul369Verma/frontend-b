/**
 * ExcursionsPanel — how trades travelled before they exited, from each trade's
 * recorded worst mark (MAE) and best mark (MFE). The question it answers is the
 * one stop-loss and take-profit settings depend on: "when a trade goes this far
 * against me, does it usually come back — and how much of a good run do I keep?"
 *
 * Data: `excursions` from GET /api/multileg/analytics (see
 * backend/logic/analytics/multilegAnalytics.js for the arithmetic and caveats).
 */
import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';
import { useChartTheme } from '../../theme/chartTheme.js';
import { pnlTone, rupeeTick } from '../viz/tokens';
import { fmt, rup } from './builderFormat';
import { rowsOf, stopEffect, suggestStop, splitByTime } from '../../utils/stopWhatIf.js';
import ApplyStopDialog from './ApplyStopDialog.jsx';

const signed = (v) => (v > 0 ? `+${rup(v)}` : rup(v));

/**
 * The dot under the pointer, in words. Recharts' default scatter tooltip drew its
 * lines in the SERIES colour, which a scatter does not have, so they came out black
 * on the dark tooltip — an apparently empty box (17-Oct-2026).
 */
export function DotTip({ active, payload, ct, basis }) {
    const p = active && payload && payload[0] && payload[0].payload;
    if (!p) return null;
    const style = { background: ct.tooltip.background, border: `1px solid ${ct.tooltip.border}`, color: ct.tooltip.text, fontSize: ct.type['3xs'] };
    return (
        <div className="rounded px-2 py-1.5 shadow-lg space-y-0.5 max-w-xs" style={style} role="tooltip" data-testid="excursion-tip">
            {p.label && <div className="font-semibold truncate">{p.label}</div>}
            {p.day && <div className="opacity-80">closed {p.day}</div>}
            <div>Worst point: <b style={{ color: ct.diverging.negative }}>{rup(p.mae)}</b></div>
            <div>Best point: <b style={{ color: ct.diverging.positive }}>{rup(p.mfe)}</b></div>
            <div>Finished: <b style={{ color: p.net > 0 ? ct.diverging.positive : p.net < 0 ? ct.diverging.negative : undefined }}>{signed(p.net)}</b>{basis === 'gross' ? ' gross' : ' net'}</div>
        </div>
    );
}

/**
 * A stop-loss priced on these trades: a suggestion that held up on the newest
 * trades, a level you can change, and — on the multi-leg book — a button that sets
 * it as the deployments' rupee stop (Max loss ₹), so it changes future trades.
 */
function StopLossPicker({ rows, level, setLevel, canApply, basis }) {
    const sug = useMemo(() => suggestStop(rows), [rows]);
    const { older, newer } = useMemo(() => splitByTime(rows), [rows]);
    const eff = useMemo(() => ({ all: stopEffect(rows, level), older: stopEffect(older, level), newer: stopEffect(newer, level) }), [rows, older, newer, level]);
    const scopeIds = useMemo(() => [...new Set(rows.map((r) => r.id).filter(Boolean))], [rows]);
    const [applyOpen, setApplyOpen] = useState(false);
    const T = Number(level);
    return (
        <div className="rounded-lg border border-line p-3 space-y-2" data-testid="stop-picker">
            <div className="text-xs font-semibold text-fg-2">Stop-loss from these trades</div>
            {sug.ok ? (
                <p className="text-xs text-fg-3" data-testid="stop-suggestion">
                    Suggested stop: <b className="text-fg">{rup(sug.level)}</b> per trade. Chosen on the older {sug.older.n} trades
                    (it would have changed their net by <b className={pnlTone(sug.older.netChange)}>{signed(sug.older.netChange)}</b>), then checked on the
                    newest {sug.newer.n} it never saw: <b className={pnlTone(sug.newer.netChange)}>{signed(sug.newer.netChange)}</b>.
                    {sug.level !== T && <button type="button" className="ml-2 text-primary-ink hover:underline" onClick={() => setLevel(sug.level)}>use it</button>}
                </p>
            ) : (
                <p className="text-xs text-fg-4" data-testid="stop-suggestion">No stop is suggested: {sug.reason}. You can still try a level below.</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
                <label className="text-2xs text-fg-4 inline-flex items-center gap-1.5">Stop at −₹
                    <input type="number" min="50" step="50" value={Number.isFinite(T) && T > 0 ? T : ''} aria-label="Stop level in rupees"
                        onChange={(e) => setLevel(e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value))))}
                        className="w-24 bg-slate-900 border border-line rounded px-2 py-1 text-fg tabular-nums" />
                </label>
                {canApply && (
                    <button type="button" disabled={!(T >= 50)} onClick={() => setApplyOpen(true)}
                        className="px-2.5 py-1 rounded text-2xs bg-primary text-on-primary hover:opacity-90 disabled:opacity-40">
                        Set this stop on deployments…
                    </button>
                )}
            </div>
            {T > 0 && (
                <p className="text-2xs text-fg-3" data-testid="stop-effect">
                    At −{rup(T)}: {eff.all.hit} of {eff.all.n} trades would have closed at the stop
                    {eff.all.hit > 0 && <> — {eff.all.recovered} of them had gone on to finish in profit</>}.
                    Net change <b className={pnlTone(eff.all.netChange)}>{signed(eff.all.netChange)}</b> on all
                    (older {eff.older.n}: <span className={pnlTone(eff.older.netChange)}>{signed(eff.older.netChange)}</span>,
                    newest {eff.newer.n}: <span className={pnlTone(eff.newer.netChange)}>{signed(eff.newer.netChange)}</span>).
                </p>
            )}
            <p className="text-3xs text-fg-5">
                Upper-bound estimates: every trade that touched the level is booked at exactly −that, while a real stop fills a little worse
                and marks are about a minute apart{basis === 'gross' ? ' (this book compares gross results)' : ''}.
                {canApply ? ' Setting it makes the live engine (and every backtest) close the whole structure when its net mark reaches the level.' : ''}
            </p>
            {canApply && applyOpen && (
                <ApplyStopDialog open={applyOpen} level={T} scopeIds={scopeIds} onClose={() => setApplyOpen(false)} />
            )}
        </div>
    );
}

/**
 * `basis` says what the marks and results are measured on, because the two
 * books differ: multileg marks are NET of estimated costs; single-leg marks are
 * PRE-COST, so each trade is compared with its GROSS P&L. `missingNote` lets a
 * book explain why trades lack marks (single-leg recorded none before the
 * path sampler shipped).
 */
export default function ExcursionsPanel({ excursions: x, basis = 'net', missingNote = '', canApplyStop = false }) {
    const ct = useChartTheme();
    const rows = useMemo(() => rowsOf(x?.points), [x]);
    const [level, setLevel] = useState(null);
    const suggested = useMemo(() => suggestStop(rows), [rows]);
    // the picker starts on the suggestion (or ₹2,000 when there is none); typing overrides it
    const shownLevel = level ?? (suggested.ok ? suggested.level : 2000);
    if (!x || !x.n) {
        return <div className="text-xs text-fg-5">No trade in this filter has a recorded worst/best mark yet.</div>;
    }
    const wins = [], losses = [];
    for (const r of rows) (r.net > 0 ? wins : losses).push(r);
    return (
        <div className="space-y-3">
            <p className="text-xs text-fg-3">
                {x.giveBackMedianPct != null && (
                    <>Trades that were ever in profit gave back a median <span className="font-semibold text-warning">{x.giveBackMedianPct}%</span> of their best point before they closed ({x.inProfitN} trades). </>
                )}
                Each dot below is one trade: how far it went against you (left) and how it finished (up = profit).
            </p>
            {x.missing > 0 && (
                <p className="text-2xs text-fg-5">{x.missing} trade{x.missing === 1 ? '' : 's'} in this filter have no recorded worst/best mark and are not in these figures{missingNote ? ` — ${missingNote}` : ''}.</p>
            )}
            {/* not ZoomableChart: it zooms by slicing ONE shared data array, and a
                scatter's two series each carry their own */}
            <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 14, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                    <XAxis type="number" dataKey="mae" name="Worst point" tickFormatter={rupeeTick}
                        tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }}
                        label={{ value: 'Worst point while open (₹)', position: 'insideBottom', offset: -2, fontSize: ct.type['5xs'], fill: ct.text.secondary }} />
                    <YAxis type="number" dataKey="net" name="Finished at" width={58} tickFormatter={rupeeTick}
                        tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} />
                    <ReferenceLine y={0} stroke={ct.axis} />
                    {Number(shownLevel) > 0 && (
                        <ReferenceLine x={-Number(shownLevel)} stroke={ct.diverging.negative} strokeDasharray="4 3"
                            label={{ value: `stop −${rup(shownLevel)}`, position: 'insideTopLeft', fontSize: ct.type['5xs'], fill: ct.text.secondary }} />
                    )}
                    <Tooltip content={<DotTip ct={ct} basis={basis} />} cursor={{ strokeDasharray: '3 3' }} />
                    {/* top: at the bottom it collides with the x-axis title */}
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                    <Scatter name="finished in profit" data={wins} fill={ct.diverging.positive} isAnimationActive={false} />
                    <Scatter name="finished at a loss" data={losses} fill={ct.diverging.negative} isAnimationActive={false} />
                </ScatterChart>
            </ResponsiveContainer>

            <StopLossPicker rows={rows} level={shownLevel} setLevel={setLevel} canApply={canApplyStop} basis={basis} />

            <div className="overflow-x-auto">
                <table className="w-full text-2xs text-fg-3">
                    <thead>
                        <tr className="text-fg-5 text-left">
                            <th className="py-1 pr-3 font-semibold" rowSpan={2}>Level</th>
                            <th className="px-2 text-center font-semibold border-l border-line-0" colSpan={3}>Went this far against you</th>
                            <th className="px-2 text-center font-semibold border-l border-line-0" colSpan={2}>Got this far in profit</th>
                        </tr>
                        <tr className="text-fg-5">
                            <th className="px-2 text-right font-semibold border-l border-line-0">Trades</th>
                            <th className="px-2 text-right font-semibold" title="Of the trades that touched the level, how many still closed in profit">Still finished in profit</th>
                            <th className="px-2 text-right font-semibold" title="A stop at exactly this level, alone: every trade that touched it exits there instead of where it closed">A stop here would have changed net by</th>
                            <th className="px-2 text-right font-semibold border-l border-line-0">Trades</th>
                            <th className="px-2 text-right font-semibold" title="A take-profit at exactly this level, alone: every trade that reached it exits there instead of where it closed">A target here would have changed net by</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(x.deep || []).map((d, i) => {
                            const s = x.stopIf?.[i], t = x.targetIf?.[i];
                            return (
                                <tr key={d.threshold} className="border-t border-line-0">
                                    <td className="py-1 pr-3 tabular-nums">₹{fmt(d.threshold)}</td>
                                    <td className="px-2 text-right tabular-nums border-l border-line-0">{d.touched}</td>
                                    <td className="px-2 text-right tabular-nums">{d.touched ? `${d.finishedPositive} (${d.recoveredPct}%)` : '—'}</td>
                                    <td className={`px-2 text-right tabular-nums font-semibold ${pnlTone(s?.netChange)}`}>{s?.hit ? signed(s.netChange) : '—'}</td>
                                    <td className="px-2 text-right tabular-nums border-l border-line-0">{t?.hit ?? '—'}</td>
                                    <td className={`px-2 text-right tabular-nums font-semibold ${pnlTone(t?.netChange)}`}>{t?.hit ? signed(t.netChange) : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="text-3xs text-fg-5 leading-relaxed">
                Estimates, read off each trade's recorded marks ({basis === 'gross'
                    ? 'before charges, about one a minute — so each trade is compared with its gross P&L, not its net'
                    : 'net of estimated costs, about one a minute'}). A move inside a minute can go
                deeper than the recorded worst point, and a real stop fills worse than its level — so the stop figures are on the generous
                side. A stop and a target are shown alone: which one a trade would have touched first depends on its path. Positive = the
                rule would have added to net; negative = it would have cost you.
            </p>
        </div>
    );
}
