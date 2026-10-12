/**
 * ExcursionsPanel — how trades travelled before they exited, from each trade's
 * recorded worst mark (MAE) and best mark (MFE). The question it answers is the
 * one stop-loss and take-profit settings depend on: "when a trade goes this far
 * against me, does it usually come back — and how much of a good run do I keep?"
 *
 * Data: `excursions` from GET /api/multileg/analytics (see
 * backend/logic/analytics/multilegAnalytics.js for the arithmetic and caveats).
 */
import React from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';
import { useChartTheme } from '../../theme/chartTheme.js';
import { pnlTone, rupeeTick } from '../viz/tokens';
import { fmt, rup } from './builderFormat';

const signed = (v) => (v > 0 ? `+${rup(v)}` : rup(v));

export default function ExcursionsPanel({ excursions: x }) {
    const ct = useChartTheme();
    if (!x || !x.n) {
        return <div className="text-xs text-fg-5">No trade in this filter has a recorded worst/best mark yet.</div>;
    }
    const wins = [], losses = [];
    for (const [mae, mfe, net] of x.points || []) (net > 0 ? wins : losses).push({ mae, mfe, net });
    const tip = ct.tooltipStyle({ fontSize: ct.type['3xs'] });
    return (
        <div className="space-y-3">
            <p className="text-xs text-fg-3">
                {x.giveBackMedianPct != null && (
                    <>Trades that were ever in profit gave back a median <span className="font-semibold text-warning">{x.giveBackMedianPct}%</span> of their best point before they closed ({x.inProfitN} trades). </>
                )}
                Each dot below is one trade: how far it went against you (left) and how it finished (up = profit).
            </p>
            {x.missing > 0 && (
                <p className="text-2xs text-fg-5">{x.missing} trade{x.missing === 1 ? '' : 's'} in this filter have no recorded worst/best mark and are not in these figures.</p>
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
                    <Tooltip contentStyle={tip} cursor={{ strokeDasharray: '3 3' }}
                        formatter={(v, n) => [rup(v), n]} />
                    {/* top: at the bottom it collides with the x-axis title */}
                    <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                    <Scatter name="finished in profit" data={wins} fill={ct.diverging.positive} isAnimationActive={false} />
                    <Scatter name="finished at a loss" data={losses} fill={ct.diverging.negative} isAnimationActive={false} />
                </ScatterChart>
            </ResponsiveContainer>

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
                Estimates, read off each trade's recorded marks (net of estimated costs, about one a minute). A move inside a minute can go
                deeper than the recorded worst point, and a real stop fills worse than its level — so the stop figures are on the generous
                side. A stop and a target are shown alone: which one a trade would have touched first depends on its path. Positive = the
                rule would have added to net; negative = it would have cost you.
            </p>
        </div>
    );
}
