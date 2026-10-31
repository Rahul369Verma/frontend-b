/**
 * BrokerOrdersPanel — today's Fyers order book with the STRATEGY that placed each order (user,
 * 27-Oct-2026: "connect each order with a strategy so we know which strategy put which order").
 * GET /api/broker/orders (backend logic/services/brokerOrders.js): matched by the order's tag
 * (src/domain/orders/orderTags.js), else by the order id the app recorded; an order the app did
 * not place is listed as such, never hidden. Asked on open and on Refresh — never polled.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ListOrdered, RefreshCw } from 'lucide-react';
import { API_URL } from '../config/api.js';
import { Panel, Spinner } from './viz/primitives';
import { istDayLabel } from './viz/tokens';

const TONE = { filled: 'text-success', rejected: 'text-danger', cancelled: 'text-fg-5', pending: 'text-warning', 'trigger pending': 'text-warning' };
const px = (v) => (v == null || v === 0 ? '—' : `₹${v}`);

export default function BrokerOrdersPanel({ className = 'mb-4' }) {
    const [st, setSt] = useState({ data: null, err: null, busy: true });
    const [who, setWho] = useState('all');
    // the answer sets the state (never a synchronous setState inside the effect); the first load starts busy
    const fetchIt = useCallback(() => axios.get(`${API_URL}/broker/orders`, { timeout: 30000 })
        .then((r) => setSt({ data: r.data, err: null, busy: false }))
        .catch((e) => setSt((s) => ({ ...s, err: e.response?.data?.error || e.message, busy: false }))), []);
    useEffect(() => { fetchIt(); }, [fetchIt]);
    const load = () => { setSt((s) => ({ ...s, busy: true })); fetchIt(); };
    // an answer without its rows (an older server, a proxy page) is no answer — never a crash
    const d = useMemo(() => (st.data && Array.isArray(st.data.rows) ? { byStrategy: {}, ...st.data } : null), [st.data]);
    const label = (r) => (r.strategy ? r.strategy.name : r.orphanTag ? 'a deleted deployment' : 'not from this app');
    const names = useMemo(() => (d ? Object.keys(d.byStrategy || {}) : []), [d]);
    const rows = d ? d.rows.filter((r) => who === 'all' || label(r) === who) : [];
    return (
        <Panel className={className} icon={ListOrdered} iconClassName="text-sky-400" title="Broker orders — which strategy placed each"
            storageKey="fold:multi-leg|broker-orders" docs="multi-leg#deploy-broker-orders"
            summary={d ? `${d.rows.length} order(s) at Fyers ${d.stale ? `from the last session (${istDayLabel(d.session, { year: false })})` : 'today'} · ${names.length} source(s)` : null}
            right={<button type="button" onClick={load} disabled={st.busy} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${st.busy ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh</button>}>
            {!d && st.busy && <Spinner label="Reading the broker's order book…" />}
            {st.err && <p className="text-xs text-danger">Could not read it: {st.err}</p>}
            {d && (
                <div className="space-y-2 text-xs" data-testid="broker-orders">
                    {d.stale && (
                        <div className="text-warning">
                            This is the order book of the last session, {istDayLabel(d.session)}: Fyers keeps it until the next session starts. Today&apos;s orders appear from the market open.
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setWho('all')} aria-pressed={who === 'all'} className={`px-2 py-0.5 rounded border text-2xs ${who === 'all' ? 'border-primary text-primary-ink' : 'border-line text-fg-4'}`}>All ({d.rows.length})</button>
                        {names.map((n) => {
                            const s = d.byStrategy[n];
                            return (
                                <button key={n} type="button" onClick={() => setWho(n)} aria-pressed={who === n}
                                    className={`px-2 py-0.5 rounded border text-2xs ${who === n ? 'border-primary text-primary-ink' : 'border-line text-fg-4'}`}
                                    title={`${s.filled} filled · ${s.pending} pending · ${s.rejected} rejected`}>
                                    {n}: {s.orders}{s.pending ? ` · ${s.pending} pending` : ''}{s.rejected ? ` · ${s.rejected} rejected` : ''}
                                </button>
                            );
                        })}
                    </div>
                    {d.rows.length === 0 ? <p className="text-fg-5">No orders at the broker today.</p> : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-2xs font-mono">
                                <thead><tr className="text-fg-5 text-left">
                                    <th className="font-normal py-1" title="Fyers gives the time of the order's LAST change: a cancelled stop shows when it was cancelled. When the app placed it is shown under it.">Last change</th><th className="font-normal">Strategy</th><th className="font-normal">For</th>
                                    <th className="font-normal">Order</th><th className="font-normal text-right">Qty</th><th className="font-normal text-right">Price / trigger</th>
                                    <th className="font-normal text-right">Filled at</th><th className="font-normal pl-2">Status</th>
                                </tr></thead>
                                <tbody>
                                    {rows.map((r) => (
                                        <tr key={r.id} className="border-t border-line-0 align-top">
                                            <td className="py-1 text-fg-5 whitespace-nowrap">
                                                {r.day && d.today && r.day !== d.today ? `${istDayLabel(r.day, { year: false })} ` : ''}{String(r.time || '').slice(-8)}
                                                {r.placedAt && r.at && Math.abs(Date.parse(r.at) - Date.parse(r.placedAt)) >= 60e3 && (
                                                    <span className="block text-4xs">placed {new Date(r.placedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</span>
                                                )}
                                            </td>
                                            <td className={r.strategy ? 'text-fg-2' : 'text-warning'} title={r.matchedBy ? `matched by ${r.matchedBy}${r.tag ? ` · tag ${r.tag}` : ''}` : r.tag ? `tag ${r.tag}` : 'no tag'}>
                                                {label(r)}{r.strategy && r.strategy.mode ? <span className={r.strategy.mode === 'LIVE' ? 'text-danger' : 'text-fg-5'}> · {r.strategy.mode}</span> : null}
                                            </td>
                                            <td className="text-fg-4">{r.why || '—'}</td>
                                            <td>{r.side} {r.symbol.replace(/^(NSE|BSE):/, '')} <span className="text-fg-5">{r.type}</span></td>
                                            <td className="text-right">{r.filledQty != null && r.filledQty !== r.qty ? `${r.filledQty}/` : ''}{r.qty}</td>
                                            <td className="text-right">{r.stopPrice ? `${px(r.stopPrice)} → ${px(r.limitPrice)}` : px(r.limitPrice)}</td>
                                            <td className="text-right">{px(r.tradedPrice)}</td>
                                            <td className={`pl-2 ${TONE[r.status] || 'text-fg-4'}`}>{r.status}{r.message ? <span className="block text-fg-5 font-sans">{r.message}</span> : null}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="text-3xs text-fg-5">
                        Each order the app places carries a tag at Fyers (e.g. <span className="font-mono">mlen86a4761422550PES</span> = multi-leg <b>en</b>try by the deployment whose id ends <span className="font-mono">86a47614</span>, SELL 22550 PE).
                        Orders from before tags were written are matched by the order id the app recorded. &quot;Not from this app&quot; = placed by hand or by another tool.
                        Read {new Date(d.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })} IST{d.cached ? ' (cached)' : ''}.
                    </p>
                </div>
            )}
        </Panel>
    );
}
