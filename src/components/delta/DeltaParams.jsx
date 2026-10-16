/**
 * Delta Exchange settings for a backtest, optimizer run or deployment — and the
 * contract's own facts beside them, so a size can be read in rupees before it is
 * traded: ₹ per point per contract (contract value × the fixed ₹85), tick, fees,
 * the exchange's maximum leverage, and the margin one entry would block.
 *
 * Fields (all become params): delta_leverage, delta_mode (DIRECT | OPTIONS),
 * strike_selection, delta_option_min_hours, delta_option_iv (backtest only),
 * delta_slippage_ticks.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Chip } from '../viz/primitives';
import { inr } from '../viz/tokens';
import { KIND_LABEL, deltaPrice, feePct, rupeesPerPoint, DELTA_USD_INR } from './deltaFormat.js';

const field = 'w-full bg-slate-900 border border-line rounded p-1.5 text-fg text-sm';

export default function DeltaParams({ symbol, params, onChange, showBacktestFields = true, idPrefix = 'delta' }) {
    const [loaded, setLoaded] = useState(null);   // { symbol, info, error } — keyed so a stale answer never shows
    useEffect(() => {
        if (!symbol) return undefined;
        let alive = true;
        axios.get(`${API_URL}/delta/instrument/${encodeURIComponent(symbol)}`)
            .then((r) => { if (alive) setLoaded({ symbol, info: r.data, error: null }); })
            .catch((e) => { if (alive) setLoaded({ symbol, info: null, error: e?.response?.data?.error || e.message }); });
        return () => { alive = false; };
    }, [symbol]);
    const current = loaded && loaded.symbol === symbol ? loaded : null;
    const info = current ? current.info : null;
    const error = current ? current.error : null;

    const inst = info && info.instrument;
    const set = (k, v) => onChange?.({ ...params, [k]: v });
    const lots = Math.max(1, parseInt(params.lots, 10) || 1);
    const lev = Math.min(Number(params.delta_leverage) || 10, (inst && inst.maxLeverage) || 1);
    const last = info && info.ticker ? Number(info.ticker.close || info.ticker.mark_price) : null;
    const ppp = rupeesPerPoint(inst);
    const notionalInr = inst && last ? last * lots * inst.contractValue * inst.fx : null;
    const marginInr = notionalInr != null ? (inst.kind === 'spot' || inst.isOption ? notionalInr : notionalInr / lev) : null;
    const mode = String(params.delta_mode || 'DIRECT').toUpperCase();

    return (
        <div className="rounded border border-line/60 p-3 space-y-3">
            {error && <div className="text-xs text-danger">{error}</div>}
            {inst && (
                <div className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-4">
                    <Chip tone="info">{KIND_LABEL[inst.kind] || inst.kind}</Chip>
                    <Chip tone="muted">{inst.currency === 'INR' ? 'priced in ₹' : 'priced in USD'}</Chip>
                    <span>1 contract = {inst.contractValue} {inst.contractUnit}</span>
                    <span>· {inr(ppp, { dp: 3 })} per point per contract</span>
                    <span>· tick {deltaPrice(inst.tickSize, inst.currency)}</span>
                    <span>· fees maker {feePct(inst.makerRate)} / taker {feePct(inst.takerRate)} + 18% GST</span>
                    {inst.maxLeverage > 1 && <span>· max {inst.maxLeverage}x</span>}
                    {last != null && <span>· last {deltaPrice(last, inst.currency)}</span>}
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(!inst || (inst.kind !== 'spot' && !inst.isOption)) && (
                    <label className="text-xs text-fg-4" htmlFor={`${idPrefix}-lev`}>Leverage (set at the exchange)
                        <input id={`${idPrefix}-lev`} type="number" min="1" max={(inst && inst.maxLeverage) || 200} step="1" className={field}
                            value={params.delta_leverage ?? 10} onChange={(e) => set('delta_leverage', e.target.value === '' ? '' : Number(e.target.value))} />
                    </label>
                )}
                {inst && inst.kind === 'perpetual' && (
                    <label className="text-xs text-fg-4" htmlFor={`${idPrefix}-mode`}>Trade
                        <select id={`${idPrefix}-mode`} className={field} value={mode} onChange={(e) => set('delta_mode', e.target.value)}>
                            <option value="DIRECT">The contract itself (long / short)</option>
                            <option value="OPTIONS">Listed {inst.underlying} options (buy call / put)</option>
                        </select>
                    </label>
                )}
                {mode === 'OPTIONS' && (
                    <>
                        <label className="text-xs text-fg-4" htmlFor={`${idPrefix}-strike`}>Strike
                            <select id={`${idPrefix}-strike`} className={field} value={params.strike_selection || 'ATM'} onChange={(e) => set('strike_selection', e.target.value)}>
                                {['ITM_2', 'ITM_1', 'ATM', 'OTM_1', 'OTM_2', 'OTM_3'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                            </select>
                        </label>
                        <label className="text-xs text-fg-4" htmlFor={`${idPrefix}-minh`}>Skip expiries closer than (hours)
                            <input id={`${idPrefix}-minh`} type="number" min="0" step="1" className={field}
                                value={params.delta_option_min_hours ?? 6} onChange={(e) => set('delta_option_min_hours', e.target.value === '' ? '' : Number(e.target.value))} />
                        </label>
                        {showBacktestFields && (
                            <label className="text-xs text-fg-4" htmlFor={`${idPrefix}-iv`}>Backtest IV (blank = trailing 7-day realised)
                                <input id={`${idPrefix}-iv`} type="number" min="0" step="0.01" placeholder="e.g. 0.45" className={field}
                                    value={params.delta_option_iv ?? ''} onChange={(e) => set('delta_option_iv', e.target.value === '' ? undefined : Number(e.target.value))} />
                            </label>
                        )}
                    </>
                )}
                {showBacktestFields && (
                    <label className="text-xs text-fg-4" htmlFor={`${idPrefix}-slip`}>Slippage (ticks per side, min = measured spread)
                        <input id={`${idPrefix}-slip`} type="number" min="0" step="1" className={field}
                            value={params.delta_slippage_ticks ?? 1} onChange={(e) => set('delta_slippage_ticks', e.target.value === '' ? undefined : Number(e.target.value))} />
                    </label>
                )}
            </div>
            {inst && marginInr != null && mode !== 'OPTIONS' && (
                <div className="text-2xs text-fg-5">
                    {lots} contract{lots === 1 ? '' : 's'} ≈ {inr(notionalInr, { dp: 0 })} notional → blocks {inr(marginInr, { dp: 0 })}
                    {inst.kind === 'spot' ? ' (spot is paid in full)' : ` at ${lev}x`}. P&L per {inst.currency === 'INR' ? '₹1' : '$1'} price move per contract: {inr(ppp, { dp: 3 })}
                    {inst.currency === 'USD' ? ` (Delta India settles USD at a fixed ₹${DELTA_USD_INR})` : ''}.
                </div>
            )}
            <div className="text-3xs text-fg-5">Delta trades 24×7: positions are held overnight unless holding is switched off. India VIX filters do not apply to Delta contracts.</div>
        </div>
    );
}
