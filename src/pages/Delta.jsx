/**
 * Delta Exchange India — the venue at a glance: is the contract list current,
 * is the feed streaming, which trading environment the keys point at, what the
 * account holds, and every listed contract (search + option chains).
 *
 * Nothing here places an order: Delta trades come only from deployments (the
 * live engine), exactly like Fyers ones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Bitcoin, RefreshCw, AlertTriangle } from 'lucide-react';
import { API_URL } from '../config/api.js';
import { PageHeader, Card, StatRow, StatTile, DataTable, Chip, StatusBadge, Spinner, EmptyState, Placeholder } from '../components/viz/primitives';
import { inr } from '../components/viz/tokens';
import DeltaInstrumentPicker from '../components/delta/DeltaInstrumentPicker';
import { KIND_LABEL, deltaPrice, feePct, expiryIst, rupeesPerPoint } from '../components/delta/deltaFormat.js';
import { toast } from '../components/toastStore.js';

const BASE = `${API_URL}/delta`;
const errText = (e) => e?.response?.data?.error || e?.message || 'request failed';

function ContractCard({ symbol }) {
    const [loaded, setLoaded] = useState(null);
    useEffect(() => {
        if (!symbol) return undefined;
        let alive = true;
        axios.get(`${BASE}/instrument/${encodeURIComponent(symbol)}`)
            .then((r) => { if (alive) setLoaded({ symbol, data: r.data, error: null }); })
            .catch((e) => { if (alive) setLoaded({ symbol, data: null, error: errText(e) }); });
        return () => { alive = false; };
    }, [symbol]);
    const cur = loaded && loaded.symbol === symbol ? loaded : null;
    if (!symbol) return <Placeholder>Pick a contract to see its specification and live price.</Placeholder>;
    if (!cur) return <Spinner label="Loading contract…" />;
    if (cur.error) return <div className="text-xs text-danger">{cur.error}</div>;
    const i = cur.data.instrument;
    const t = cur.data.ticker || {};
    const q = t.quotes || {};
    const rows = [
        ['Kind', KIND_LABEL[i.kind] || i.kind],
        ['Contract', `${i.contractValue} ${i.contractUnit}`],
        ['P&L per point per contract', inr(rupeesPerPoint(i), { dp: 3 })],
        ['Tick', deltaPrice(i.tickSize, i.currency)],
        ['Fees (maker / taker)', `${feePct(i.makerRate)} / ${feePct(i.takerRate)} + 18% GST`],
        ...(i.premiumFeeCap != null ? [['Option fee cap', `${(i.premiumFeeCap * 100).toFixed(1)}% of premium`]] : []),
        ...(i.maxLeverage > 1 ? [['Max leverage', `${i.maxLeverage}x (initial margin ${i.initialMarginPct}%)`]] : []),
        ...(i.strike != null ? [['Strike', deltaPrice(i.strike, i.currency)]] : []),
        ...(i.settlementTime ? [['Settles', expiryIst(i.settlementTime)]] : []),
        ...(i.fundingIntervalSec ? [['Funding', `every ${i.fundingIntervalSec / 3600} h`]] : []),
        ['Last / mark', `${deltaPrice(t.close, i.currency)} / ${deltaPrice(t.mark_price, i.currency)}`],
        ['Bid / ask', `${deltaPrice(q.best_bid, i.currency)} / ${deltaPrice(q.best_ask, i.currency)}${cur.data.spreadBps != null ? ` (half-spread ${cur.data.spreadBps} bp)` : ''}`],
        ...(t.funding_rate != null ? [['Funding rate now', `${Number(t.funding_rate).toFixed(4)}% per interval`]] : []),
        ['Status', i.tradingStatus || '—'],
    ];
    return (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line/40 py-1">
                    <dt className="text-fg-5">{k}</dt><dd className="text-fg-2 text-right tabular-nums">{v}</dd>
                </div>
            ))}
            {cur.data.tickerError && <div className="text-2xs text-warning sm:col-span-2">Live ticker unavailable: {cur.data.tickerError}</div>}
        </dl>
    );
}

function OptionChain() {
    const [underlying, setUnderlying] = useState('BTC');
    const [expiry, setExpiry] = useState('');
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        let alive = true;
        axios.get(`${BASE}/option-chain`, { params: { underlying, expiry: expiry || undefined } })
            .then((r) => { if (alive) { setData(r.data); setError(null); } })
            .catch((e) => { if (alive) setError(errText(e)); });
        return () => { alive = false; };
    }, [underlying, expiry]);
    const rows = (data?.chain || []).map((r) => ({ ...r, _key: r.strike }));
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
                <label htmlFor="delta-chain-underlying" className="text-xs text-fg-4">Underlying
                    <select id="delta-chain-underlying" className="ml-1 bg-slate-900 border border-line rounded px-2 py-1 text-fg text-xs" value={underlying} onChange={(e) => { setUnderlying(e.target.value); setExpiry(''); }}>
                        {['BTC', 'ETH', 'XAUT'].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                </label>
                <label htmlFor="delta-chain-expiry" className="text-xs text-fg-4">Expiry
                    <select id="delta-chain-expiry" className="ml-1 bg-slate-900 border border-line rounded px-2 py-1 text-fg text-xs" value={data?.expiry ? data.expiry.slice(0, 10) : ''} onChange={(e) => setExpiry(e.target.value)}>
                        {(data?.expiries || []).map((e) => <option key={e} value={e.slice(0, 10)}>{expiryIst(e)}</option>)}
                    </select>
                </label>
                <span className="text-2xs text-fg-5">{rows.length} strikes listed for this expiry</span>
            </div>
            {error && <div className="text-xs text-danger">{error}</div>}
            <DataTable dense maxHeight="22rem" rows={rows} empty="No options listed for this expiry." columns={[
                { key: 'call', header: 'Call', render: (r) => (r.call ? <span className="font-mono">{r.call.deltaSymbol}</span> : '—') },
                { key: 'strike', header: 'Strike', align: 'right', render: (r) => <span className="font-semibold text-fg">{r.strike}</span> },
                { key: 'put', header: 'Put', render: (r) => (r.put ? <span className="font-mono">{r.put.deltaSymbol}</span> : '—') },
            ]} />
        </div>
    );
}

export default function Delta() {
    const [st, setSt] = useState(null);
    const [acct, setAcct] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [picked, setPicked] = useState('DELTA:BTCUSD');

    const load = useCallback(async () => {
        try {
            const [s, a] = await Promise.all([axios.get(`${BASE}/status`), axios.get(`${BASE}/account`).catch(() => ({ data: null }))]);
            setSt(s.data); setAcct(a.data); setError(null);
        } catch (e) { setError(errText(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const refresh = async () => {
        setBusy(true);
        try { const r = await axios.post(`${BASE}/refresh`); toast.success(`Contract list refreshed: ${r.data.count} contracts`); await load(); }
        catch (e) { toast.error(errText(e)); }
        finally { setBusy(false); }
    };

    const reg = st?.registry;
    const venue = st?.venue;
    const trading = st?.trading;
    const positions = acct?.positions || [];

    return (
        <div className="p-6 space-y-4">
            <PageHeader foldAll docs="delta#overview" icon={Bitcoin} title="Delta Exchange"
                subtitle="Crypto and tokenised-asset derivatives (BTC, ETH, XAUT gold, tokenised US stocks…) on Delta Exchange India — 24×7. Prices are in USD; P&L is in rupees at Delta India's fixed ₹85 per USD."
                actions={(
                    <button type="button" onClick={refresh} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:text-fg disabled:opacity-50">
                        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh contract list
                    </button>
                )} />

            {error && <EmptyState icon={AlertTriangle} title="Could not load Delta status">{error}</EmptyState>}
            {!st && !error && <Spinner label="Loading…" />}

            {st && (
                <>
                    <StatRow cols={4}>
                        <StatTile label="Listed contracts" value={reg?.total ?? 0}
                            hint={reg ? Object.entries(reg.byKind || {}).map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(' · ') : ''} />
                        <StatTile label="Contract list age" value={reg?.ageMinutes != null ? `${reg.ageMinutes} min` : 'never fetched'}
                            tone={reg?.stale ? 'negative' : 'neutral'} hint="refreshed hourly; daily options list at 17:30 IST" />
                        <StatTile label="Feed" value={venue?.feed?.connected ? 'streaming' : 'idle'}
                            hint={venue ? `${venue.feed.symbols} of ${venue.feed.cap} symbols · ${venue.feed.reconnects} reconnects${venue.feed.refusedSubscriptions ? ` · ${venue.feed.refusedSubscriptions} over the cap` : ''}` : ''} />
                        <StatTile label="Trading" value={trading?.credentials ? trading.env : 'no API keys'}
                            tone={trading?.credentials && trading.env === 'production' ? 'positive' : 'neutral'}
                            hint={trading?.credentials ? `order socket ${venue?.trading?.orderSocket ? 'connected' : 'not connected'}` : 'PAPER deployments still work on live prices'} />
                    </StatRow>
                    {venue?.lastError && <div className="text-2xs text-warning">Last feed/broker error: {venue.lastError}</div>}

                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card docs="delta#contract" title="Contract" subtitle="Search every listed Delta contract — perpetuals, options, move options, INR spot.">
                            <DeltaInstrumentPicker id="delta-page-picker" value={picked} onChange={(s) => setPicked(s)} />
                            <div className="mt-3"><ContractCard symbol={picked} /></div>
                        </Card>
                        <Card docs="delta#option-chain" title="Option chain" subtitle="Listed strikes for one expiry (Delta settles BTC/ETH options at 17:30 IST, XAUT at 21:30 IST).">
                            <OptionChain />
                        </Card>
                    </div>

                    <Card docs="delta#account" title="Account" subtitle={acct?.configured ? `Delta ${acct.env} — wallet and open positions` : 'Not connected'}
                        right={acct?.configured ? <Chip tone={acct.env === 'production' ? 'live' : 'paper'}>{String(acct.env).toUpperCase()}</Chip> : null}>
                        {!acct?.configured ? (
                            <div className="text-xs text-fg-4 space-y-1">
                                <p>To trade LIVE on Delta, set these on the backend and restart it:</p>
                                <pre className="bg-surface-2 rounded p-2 text-2xs overflow-auto">{'DELTA_API_KEY=…\nDELTA_API_SECRET=…\nDELTA_TRADING_ENV=testnet   # production only when you mean real money'}</pre>
                                <p className="text-fg-5">Create the key on Delta Exchange India with trading permission and whitelist the server's IP. Backtests, the optimizer, charts and PAPER deployments need no key.</p>
                            </div>
                        ) : (
                            <>
                                <StatRow cols={2}>
                                    <StatTile label="Wallet" value={inr(acct.funds?.total_balance, { dp: 0 })} hint="all balances at ₹85/USD" />
                                    <StatTile label="Available" value={inr(acct.funds?.available_balance, { dp: 0 })} hint={acct.funds?.error ? `error: ${acct.funds.error}` : 'not blocked as margin'} />
                                </StatRow>
                                <div className="mt-3">
                                    <DataTable dense rows={positions.map((p) => ({ ...p, _key: p.symbol }))} empty="No open Delta positions." columns={[
                                        { key: 'symbol', header: 'Contract', render: (p) => <span className="font-mono">{String(p.symbol).replace(/^DELTA:/, '')}</span> },
                                        { key: 'side', header: 'Side', render: (p) => <StatusBadge level={p.side === 1 ? 'good' : 'warning'}>{p.side === 1 ? 'long' : 'short'}</StatusBadge> },
                                        { key: 'contracts', header: 'Contracts', align: 'right', render: (p) => Math.abs(p._contracts) },
                                        { key: 'avg', header: 'Entry', align: 'right', render: (p) => deltaPrice(p.avgPrice) },
                                        { key: 'liq', header: 'Liquidation', align: 'right', render: (p) => deltaPrice(p.liquidationPrice) },
                                        { key: 'upl', header: 'Unrealised', align: 'right', render: (p) => (p.unrealizedQuote != null ? inr(p.unrealizedQuote * 85, { dp: 0 }) : '—') },
                                    ]} />
                                </div>
                            </>
                        )}
                    </Card>
                    <p className="text-2xs text-fg-5">{st.money?.note} Delta derivatives are crypto-asset (VDA) instruments: FIU-registered, not SEBI-regulated, and their tax treatment is unsettled — check with a CA before trading real money.</p>
                </>
            )}
        </div>
    );
}
