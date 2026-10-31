/**
 * DeploymentStructurePanel — the structure of the ONE deployment picked in Results, the way the
 * backtest shows a structure (user, 23-Oct-2026: "show the structure when only one strategy is
 * selected — like the backtest, how it looks after deploy, with its stop-loss if there is any").
 *
 * GET /api/multileg/deployments/:id/structure (backend logic/multileg/structureView.js):
 *   OPEN       the structure as it stands — its own entry prices and credit, marked now;
 *   otherwise  as it would enter NOW at the live spot, legs resolved by the engine itself.
 * Each stop and the target are drawn where the engine fires them (exitRules), with the index
 * level at which each would fire TODAY. Asked once per pick (and on Refresh) — never polled.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { API_URL } from '../../config/api.js';
import { useChartTheme } from '../../theme/chartTheme.js';
import { Panel, Spinner } from '../viz/primitives';
import { inr, istDateTime, pnlTone, rupeeTick } from '../viz/tokens';
import { stopsText } from './stopReplayFormat.js';
import { levelWhere, sourceLine } from './structureFormat.js';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const signed = (v) => (v == null ? '—' : inr(v, { sign: true, dp: 0 }));

export function StructureView({ d, onRefresh, loading }) {
    const ct = useChartTheme();
    const lineColor = (k) => (k === 'target' ? ct.diverging.positive : ct.status.critical);
    const target = Number(d.settings?.tp_pct_credit) > 0 ? `target ${d.settings?.tp_pct_credit}% of credit` : null;
    return (
        <div className="space-y-3" data-testid="deployment-structure">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-fg-3">{sourceLine(d, istDateTime)}</p>
                <button type="button" onClick={onRefresh} className="px-2 py-1 rounded border border-line bg-slate-800 text-2xs text-fg-3 hover:text-fg inline-flex items-center gap-1">
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
                </button>
            </div>
            {d.note && <p className="text-2xs text-warning">{d.note}</p>}

            <div className="overflow-x-auto">
                <table className="w-full text-xs text-fg-3">
                    <thead><tr className="text-fg-5 text-left">
                        <th className="font-normal py-1">Leg</th><th className="font-normal">Strike</th><th className="font-normal">Expiry</th>
                        <th className="font-normal text-right">{d.source === 'open' ? 'Entry' : 'Premium now'}</th>
                        {d.source === 'open' && <th className="font-normal text-right">Now</th>}
                        <th className="font-normal text-right">IV</th>
                        <th className="font-normal text-right">Leg stop</th>
                        <th className="font-normal text-right">…fires today at index</th>
                    </tr></thead>
                    <tbody>
                        {d.legs.map((l) => (
                            <tr key={l.symbol} className="border-t border-line-0">
                                <td className={`py-1 ${l.action === 'BUY' ? 'text-success' : 'text-danger'}`}>{l.action}{l.ratio > 1 ? ` ${l.ratio}×` : ''} {l.type}</td>
                                <td>{fmt(l.strike)}</td>
                                <td className="text-fg-5">{l.expiry}</td>
                                <td className="text-right tabular-nums">₹{l.entryPremium ?? '—'}</td>
                                {d.source === 'open' && <td className="text-right tabular-nums">{l.nowPremium == null ? <span className="text-warning">no quote</span> : `₹${l.nowPremium}`}</td>}
                                <td className="text-right tabular-nums text-fg-5">{l.ivPct == null ? '—' : `${l.ivPct}%`}</td>
                                <td className="text-right tabular-nums">{l.stopPremium == null ? <span className="text-fg-5">{l.action === 'SELL' ? 'off' : '—'}</span> : `₹${l.stopPremium}`}</td>
                                <td className="text-right tabular-nums text-fg-4">{l.stopSpotToday == null ? '—' : `${l.type === 'CE' ? '≥' : '≤'} ${fmt(l.stopSpotToday)}`}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap gap-2 text-2xs">
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-line">net {d.creditPerUnit >= 0 ? 'credit' : 'debit'} ₹{fmt(Math.abs(d.creditPerUnit))}/unit · {inr(Math.abs(d.creditRupees))}</span>
                <span className="px-2 py-0.5 rounded bg-emerald-900/30 border border-emerald-700/50 text-success">max profit {d.maxProfit == null ? 'unbounded' : inr(d.maxProfit)}</span>
                <span className="px-2 py-0.5 rounded bg-red-900/30 border border-red-700/50 text-danger">max loss {d.unbounded ? 'UNBOUNDED' : inr(Math.abs(d.maxLoss))}</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-line">breakevens {d.breakevens.length ? d.breakevens.map(fmt).join(' / ') : '—'}</span>
                {d.source === 'open' && <span className={`px-2 py-0.5 rounded bg-slate-800 border border-line ${pnlTone(d.markNow)}`}>mark now {signed(d.markNow)} (before costs)</span>}
                {d.source === 'open' && d.marginEst != null && <span className="px-2 py-0.5 rounded bg-slate-800 border border-line">margin {d.marginBasis === 'heuristic' ? '~' : ''}{inr(d.marginEst)}</span>}
            </div>

            <div className="text-2xs text-fg-3 space-y-0.5" data-testid="structure-stops">
                <div>Its stops: {stopsText(d.settings)}{target ? ` · ${target}` : ''}.</div>
                {d.lines.length === 0 && <div className="text-warning">No structure stop, rupee stop or target is set: only the leg stops (if any) and the time exits close it.</div>}
                {d.lines.map((l) => (
                    <div key={l.kind}>
                        <span className={l.kind === 'target' ? 'text-success' : 'text-danger'}>{l.label}</span>: {signed(l.rupees)}
                        {l.grossRupees !== l.rupees && <span className="text-fg-5"> (≈ {signed(l.grossRupees)} before the {inr(d.roundTripCosts)} round-trip costs)</span>}
                        {' '}— {levelWhere(l, fmt)}
                    </div>
                ))}
            </div>

            <ZoomableChart data={d.curve} height={300} title={`Structure — ${d.structureName || d.template || 'payoff'}`}>
                    <ComposedChart margin={{ top: 8, right: 12, bottom: 2, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                        <XAxis dataKey="spot" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: ct.text.secondary, fontSize: ct.type['5xs'] }} tickFormatter={fmt} />
                        <YAxis width={58} tick={{ fill: ct.text.secondary, fontSize: ct.type['5xs'] }} tickFormatter={rupeeTick} />
                        <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })} labelFormatter={(v) => `Index ${fmt(v)}`} formatter={(v, n) => [signed(v), n]} />
                        <Legend wrapperStyle={{ fontSize: ct.type['5xs'] }} />
                        <ReferenceLine y={0} stroke={ct.axis} />
                        <ReferenceLine x={d.spot} stroke={ct.mark.live} strokeDasharray="4 4" label={{ value: 'spot now', fill: ct.mark.live, fontSize: ct.type['5xs'], position: 'top' }} />
                        {d.lines.map((l) => (
                            <ReferenceLine key={l.kind} y={l.grossRupees} stroke={lineColor(l.kind)} strokeDasharray={l.kind === 'rupeeStop' ? '6 3' : undefined}
                                ifOverflow="extendDomain" label={{ value: `${l.label} ${signed(l.rupees)}`, fill: lineColor(l.kind), fontSize: ct.type['5xs'], position: 'insideBottomLeft' }} />
                        ))}
                        <Line type="monotone" name="at expiry" dataKey="expiry" stroke={ct.mark.terminal} dot={false} strokeWidth={2} isAnimationActive={false} />
                        <Line type="monotone" name="today" dataKey="today" stroke={ct.mark.live} dot={false} strokeWidth={1.5} strokeDasharray="5 3" isAnimationActive={false} />
                    </ComposedChart>
            </ZoomableChart>
            <p className="text-3xs text-fg-5">
                ₹ for {d.lots} lot{d.lots === 1 ? '' : 's'} × {d.lotSize}, against the {d.source === 'open' ? 'entry' : 'current'} premiums, before costs.
                &quot;Today&quot; prices each leg at its own implied volatility with today&apos;s time to expiry; the stops fire on the live mark, so where a line crosses
                the today curve is the index level that would trigger it now (later, time decay moves those levels). Levels are the engine&apos;s own (exit rules).
            </p>
        </div>
    );
}

/** The panel: fetched for the deployment picked in the Results filter. */
export default function DeploymentStructurePanel({ deploymentId }) {
    // The answer carries the request it answers, so "loading" is DERIVED (no setState in the effect)
    const [nonce, setNonce] = useState(0);
    const reqKey = `${deploymentId}#${nonce}`;
    const [st, setSt] = useState({ key: null, id: null, data: null, err: null });
    useEffect(() => {
        if (!deploymentId || deploymentId === 'all') return undefined;
        let dead = false;
        axios.get(`${API_URL}/multileg/deployments/${encodeURIComponent(deploymentId)}/structure`, { timeout: 30000 })
            .then((r) => { if (!dead) setSt({ key: reqKey, id: deploymentId, data: r.data, err: null }); })
            .catch((e) => { if (!dead) setSt({ key: reqKey, id: deploymentId, data: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [deploymentId, reqKey]);
    const refresh = useCallback(() => setNonce((n) => n + 1), []);
    if (!deploymentId || deploymentId === 'all') return null;
    // a Refresh keeps the last picture of THIS deployment on screen while the new one comes
    const sameDep = st.id === deploymentId;
    const cur = { data: sameDep ? st.data : null, err: st.key === reqKey ? st.err : null, loading: st.key !== reqKey };
    const load = refresh;
    return (
        <Panel title={cur.data ? `Structure — ${cur.data.structureName || cur.data.template}` : 'Structure'} subtitle="How this deployment's structure looks, with its stops — open now, or as it would enter at the live spot"
            docs="multi-leg#results-structure" storageKey="fold:results|structure">
            {cur.err ? (
                <p className="text-xs text-danger">Could not draw the structure: {cur.err}. <button type="button" className="underline" onClick={load}>retry</button></p>
            ) : !cur.data ? <Spinner label="Resolving its legs at the live spot…" />
                : cur.data.ok === false ? <p className="text-xs text-warning">Could not draw the structure: {cur.data.reason}.</p>
                    : <StructureView d={cur.data} loading={cur.loading} onRefresh={load} />}
        </Panel>
    );
}
