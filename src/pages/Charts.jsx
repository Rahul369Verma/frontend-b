'use strict';
/**
 * Charts — price, with our own trades drawn on it.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 * Until now this platform could tell you a trade made ₹15 and lost ₹91 to
 * charges, but never SHOW you where it happened. Every question a trader
 * actually asks after a bad day — was the entry chasing a move already spent,
 * did the stop sit inside the noise, was the structure ever really threatened —
 * is a question about a picture, and there was no picture anywhere in the app.
 *
 * ── THE TWO AXES ────────────────────────────────────────────────────────────
 * Every position here is an OPTION but every strategy thinks in SPOT, so a
 * trade has two truths and they cannot share one price scale:
 *
 *   Underlying   the index. Where the signal fired, where a structure's strikes
 *                and break-evens sit, where entry and exit spot landed.
 *   Premium      the option itself. Where the fills actually happened and where
 *                a premium stop and target sit.
 *
 * The Levels switch picks which one you are looking at, and the API returns
 * only the levels that belong to it — a ₹530 premium stop is never drawn on a
 * 57,000 index scale, because that is not a small error, it is off-screen.
 *
 * Click any trade to zoom to it; click "open the option" on a single-leg trade
 * to jump to its own premium chart with its fills on it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { CandlestickChart, RefreshCw, Crosshair, ExternalLink, PenLine, Trash2, Keyboard, Lock, Unlock } from 'lucide-react';
import {
    Card, StatTile, StatRow, DataTable, Placeholder, EmptyState, PageHeader, Segmented, Chip, Spinner, StatusBadge,
} from '../components/viz/primitives';
import { inr, useChartTheme } from '../components/viz/tokens';
import PriceChart from '../components/charts/PriceChart';
import { API_URL } from '../config/api.js';
import { loadLines, saveLines } from '../components/charts/trendLines';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const int = (v) => (n(v) == null ? '—' : Math.round(n(v)).toLocaleString('en-IN'));
const round2 = (v) => (n(v) == null ? '—' : Math.round(n(v) * 100) / 100);
const RESOLUTIONS = [
    { v: '1', label: '1m' }, { v: '5', label: '5m' }, { v: '15', label: '15m' },
    { v: '60', label: '1h' }, { v: 'D', label: '1D' },
];
const MODES = [
    { v: 'underlying', label: 'Underlying', hint: 'Index points — entry/exit spot, strikes, break-evens' },
    { v: 'premium', label: 'Option premium', hint: 'Option points — the actual fills, premium stop and target' },
];
const RANGES = [{ v: 5, label: '5d' }, { v: 15, label: '15d' }, { v: 30, label: '30d' }, { v: 90, label: '90d' }];

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const istStamp = (v) => {
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
};

/**
 * The levels this trade was managed against, in words.
 *
 * A line on a chart says "the stop was here"; it does not say whether the stop
 * was a premium stop or an index stop, nor whether the record came from the
 * trade itself or was recovered from the position doc afterwards. On a page
 * whose job is post-mortem, that provenance is part of the answer — so it is
 * stated rather than implied, and a trade with no recoverable levels says so
 * instead of just drawing fewer lines.
 */
function LevelsLine({ levels, side, entryPremium }) {
    const L = levels || {};
    const has = ['slPoints', 'tpPoints', 'aiSpotSl', 'aiSpotTp', 'strategyIndexSl'].some(k => n(L[k]) != null);
    if (!has) {
        return <div className="text-2xs text-fg-5">No stop/target on record — this trade predates the engine persisting its own levels.</div>;
    }
    const long = Number(side) === -1 ? -1 : 1;
    const prem = n(entryPremium);
    const at = (pts, sign) => (prem != null && n(pts) != null ? ` → ${round2(prem + sign * long * n(pts))}` : '');
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-4">
            {n(L.slPoints) != null && <span>SL <b className="text-negative">{round2(L.slPoints)}pt</b><span className="text-fg-5">{at(L.slPoints, -1)}</span></span>}
            {n(L.tpPoints) != null && <span>TP <b className="text-positive">{round2(L.tpPoints)}pt</b><span className="text-fg-5">{at(L.tpPoints, +1)}</span></span>}
            {n(L.strategyIndexSl) != null && <span>index SL <b className="text-fg-2">{int(L.strategyIndexSl)}</b></span>}
            {n(L.aiSpotSl) != null && <span>AI SL <b className="text-fg-2">{int(L.aiSpotSl)}</b></span>}
            {n(L.aiSpotTp) != null && <span>AI TP <b className="text-fg-2">{int(L.aiSpotTp)}</b></span>}
            {long === -1 && <Chip tone="warning">short — stop is above entry</Chip>}
            {L.source === 'position-doc' && <span className="text-fg-5" title="Recovered from the position document; the trade doc itself did not record them.">recovered</span>}
        </div>
    );
}

/**
 * What a structure actually did, leg by leg.
 *
 * A strangle that closes INSIDE its break-evens and still loses money looks like
 * a contradiction until you see two things stated together: break-evens are an
 * EXPIRY payoff, and an intraday square-off happens while the options still
 * carry time value. So this panel names the leg that moved and, when the exit
 * really was inside the break-evens on a losing trade, says why that is not the
 * paradox it appears to be.
 */
function MultilegDetail({ sel }) {
    const legs = sel.legs || [];
    const be = Array.isArray(sel.breakevens) && sel.breakevens.length === 2 ? sel.breakevens : null;
    const exitSpot = n(sel.exitSpot);
    const net = n(sel.net) ?? 0;
    const insideBe = be && exitSpot != null && exitSpot > Math.min(...be) && exitSpot < Math.max(...be);

    // Per-unit P&L of one leg: a SOLD leg profits when premium falls.
    const legPnl = (l) => {
        const a = n(l.entryPrice), b = n(l.exitPrice);
        if (a == null || b == null) return null;
        return String(l.action).toUpperCase() === 'SELL' ? a - b : b - a;
    };
    const scored = legs.map(l => ({ ...l, pnl: legPnl(l) })).filter(l => l.pnl != null);
    const worst = scored.length ? scored.reduce((w, l) => (l.pnl < w.pnl ? l : w)) : null;

    return (
        <div className="text-2xs text-fg-4 space-y-1.5">
            <div>
                credit <b className="text-fg-2">{inr((n(sel.credit) ?? 0) * 1)}</b>/unit · {sel.lots || 1} lot(s)
                {sel.zone?.ok ? ' · strikes from the zone finder' : ''}
                {be ? <> · break-even <b className="text-fg-2">{int(Math.min(...be))}</b>–<b className="text-fg-2">{int(Math.max(...be))}</b> at expiry</> : null}
            </div>

            <div className="flex flex-wrap gap-1">
                {legs.map((l, i) => {
                    const p = legPnl(l);
                    const sold = String(l.action).toUpperCase() === 'SELL';
                    return (
                        <Chip key={i} tone={p == null ? 'neutral' : p > 0 ? 'positive' : 'critical'}
                            title={`${sold ? 'Sold' : 'Bought'} the ${l.strike} ${l.type}${n(l.entryPrice) != null ? ` at ${l.entryPrice}` : ''}${n(l.exitPrice) != null ? `, closed at ${l.exitPrice}` : ''}`}>
                            {sold ? 'SOLD' : 'BOUGHT'} {l.type} {l.strike}
                            {n(l.entryPrice) != null && n(l.exitPrice) != null && <> · {l.entryPrice}→{l.exitPrice}</>}
                        </Chip>
                    );
                })}
            </div>

            {worst && worst.pnl < 0 && (
                <div className="text-fg-5">
                    The damage came from the {String(worst.action).toUpperCase() === 'SELL' ? 'short' : 'long'} {worst.strike} {worst.type}:
                    {' '}<b className="text-negative">{round2(worst.pnl)}</b> per unit as its premium went {worst.entryPrice} → {worst.exitPrice}.
                </div>
            )}

            {insideBe && net < 0 && (
                // The single most confusing thing a structure chart can show.
                <div className="rounded border border-warning/40 bg-warning/10 p-1.5 text-fg-3">
                    Closed at <b>{int(exitSpot)}</b> — inside the break-evens, yet a loss. Those levels are the
                    payoff <b>at expiry</b>; this was squared off intraday, while the options still carried time
                    value. Finishing between them says nothing about an intraday mark.
                </div>
            )}
        </div>
    );
}

export default function Charts() {
    const ct = useChartTheme();
    const [symbol, setSymbol] = useState('NSE:NIFTY50-INDEX');
    const [resolution, setResolution] = useState('5');
    const [days, setDays] = useState(5);
    const [mode, setMode] = useState('underlying');
    const [nonce, setNonce] = useState(0);
    // The window is anchored to a clock read taken ONCE (and again on Refresh).
    // Calling Date.now() inside a memo makes the memo impure — it would recompute
    // on any render and could hand the effect a new range every frame.
    const [asOf, setAsOf] = useState(() => Date.now());
    const [universe, setUniverse] = useState(null);
    const [selected, setSelected] = useState(null);   // trade id

    // ── TREND LINES ─────────────────────────────────────────────────────────
    // Per (symbol, resolution): a line drawn on 5m NIFTY means nothing on 1m
    // BANKNIFTY, and showing it there would assert a level that was never drawn.
    //
    // DERIVED, NOT SYNCED. The obvious shape — an effect that setStates the
    // stored lines whenever the symbol changes — is a cascading render and the
    // lint rule rightly rejects it. Instead the stored set is memoised per key
    // and a single override holds this session's edits; when the key changes the
    // override stops matching and the newly-loaded set takes over on the SAME
    // render, with no extra pass and no frame showing the previous symbol's lines.
    const [drawMode, setDrawMode] = useState(false);
    // Free zoom by default: being able to pull back and see the bars small,
    // with space around them, is a normal thing to want — especially at 1D
    // where a short range is only a handful of candles.
    const [lockToData, setLockToData] = useState(false);
    const drawKey = `${symbol}::${resolution}`;
    const storedLines = useMemo(() => loadLines(symbol, resolution), [symbol, resolution]);
    const [edited, setEdited] = useState(null);      // { key, lines }
    const lines = edited?.key === drawKey ? edited.lines : storedLines;
    const commitLines = useCallback((next) => {
        setEdited({ key: drawKey, lines: next });
        saveLines(symbol, resolution, next);
    }, [drawKey, symbol, resolution]);
    const [hover, setHover] = useState(null);

    // Both requests carry the key they answer, so "still loading" is derived and
    // last symbol's trades never sit under this symbol's heading for a frame.
    const [res, setRes] = useState({ key: null, candles: null, overlays: null, err: null });

    const from = useMemo(() => iso(asOf - days * 86400e3), [asOf, days]);
    const to = useMemo(() => iso(asOf), [asOf]);
    const reqKey = useMemo(() => JSON.stringify([symbol, resolution, from, to, mode, nonce]), [symbol, resolution, from, to, mode, nonce]);

    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/chart/symbols`).then(r => { if (!dead) setUniverse(r.data); }).catch(() => { /* picker degrades to the current symbol */ });
        return () => { dead = true; };
    }, []);

    useEffect(() => {
        let dead = false;
        const params = { symbol, resolution, from, to };
        Promise.allSettled([
            axios.get(`${API_URL}/chart/candles`, { params }),
            axios.get(`${API_URL}/chart/overlays`, { params: { symbol, from, to, mode } }),
        ]).then(([c, o]) => {
            if (dead) return;
            setRes({
                key: reqKey,
                candles: c.status === 'fulfilled' ? c.value.data : null,
                overlays: o.status === 'fulfilled' ? o.value.data : null,
                err: c.status === 'rejected' ? (c.reason?.response?.data?.error || c.reason.message) : null,
                // The 422 body carries WHY each source came up empty (expired
                // contract, wrong strike, archive gap). Losing it leaves the user
                // with "no data" and nothing to act on.
                errDetail: c.status === 'rejected' ? (c.reason?.response?.data || null) : null,
            });
        });
        return () => { dead = true; };
    }, [reqKey, symbol, resolution, from, to, mode]);

    const fresh = res.key === reqKey;
    const loading = !fresh;
    const candleData = fresh ? res.candles : null;
    const overlays = fresh ? res.overlays : null;
    const err = fresh ? res.err : null;
    const errDetail = fresh ? res.errDetail : null;
    const candles = useMemo(() => candleData?.candles || [], [candleData]);
    const trades = useMemo(() => overlays?.trades || [], [overlays]);

    // Selecting a trade dims the rest: showing every level of every trade at once
    // is a wall of lines nobody can read.
    // ── WHICH LEVELS TO DRAW ────────────────────────────────────────────────
    // Hiding every level until a trade is clicked keeps an index chart with 100+
    // trades readable — 200 overlapping lines are worse than none. But on a
    // chart with one or two trades it hid the entry, exit, stop and target,
    // i.e. the whole reason to open the page, and the panel just read
    // "0 levels · select a trade". So: few trades → draw them; many → require a
    // selection, and say which rule is in force rather than looking broken.
    const AUTO_LEVEL_LIMIT = 3;
    const shown = useMemo(() => {
        if (!overlays) return { markers: [], priceLines: [], auto: false };
        const all = overlays.markers || [];
        const lines = overlays.priceLines || [];
        if (selected) {
            return {
                markers: all.filter(m => m.tradeId === selected),
                priceLines: lines.filter(l => l.tradeId === selected),
                auto: false,
            };
        }
        const tradeCount = (overlays.trades || []).length;
        if (tradeCount > 0 && tradeCount <= AUTO_LEVEL_LIMIT) return { markers: all, priceLines: lines, auto: true };
        return { markers: all, priceLines: [], auto: false };
    }, [overlays, selected]);

    const sel = useMemo(() => trades.find(t => t.id === selected) || null, [trades, selected]);
    const fitKey = useMemo(() => {
        if (!sel?.entryAt) return null;
        const a = Math.floor(Date.parse(sel.entryAt) / 1000);
        const b = sel.exitAt ? Math.floor(Date.parse(sel.exitAt) / 1000) : a + 3600;
        return Number.isFinite(a) && Number.isFinite(b) ? { from: a, to: b } : null;
    }, [sel]);

    const openTheOption = useCallback(() => {
        if (!sel?.symbol) return;
        setSymbol(sel.symbol); setMode('premium'); setSelected(null);
    }, [sel]);

    const symbolOptions = useMemo(() => {
        if (!universe) return [{ value: symbol, label: symbol, kind: 'index' }];
        return [...(universe.indices || []), ...(universe.equities || []), ...(universe.commodities || []), ...(universe.traded || [])];
    }, [universe, symbol]);

    const wins = trades.filter(t => (n(t.net) ?? 0) > 0).length;
    const netAll = trades.reduce((a, t) => a + (n(t.net) ?? 0), 0);
    const isIndex = /-INDEX$/i.test(symbol);

    const tradeCols = useMemo(() => [
        {
            key: 'label', header: 'Trade', render: (t) => (
                <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Chip tone={t.kind === 'multileg' ? 'info' : 'neutral'}>{t.kind === 'multileg' ? 'ML' : '1L'}</Chip>
                    <span className="truncate max-w-[13rem]" title={t.label}>{t.label}</span>
                    {t.open && <StatusBadge level="warning">open</StatusBadge>}
                </span>
            ),
        },
        { key: 'entryAt', header: 'Entry', render: (t) => <span className="text-fg-5">{istStamp(t.entryAt)}</span> },
        { key: 'net', header: 'Net', align: 'right', render: (t) => <span style={{ color: (n(t.net) ?? 0) > 0 ? ct.diverging.positive : (n(t.net) ?? 0) < 0 ? ct.diverging.negative : undefined }} className="tabular-nums">{inr(t.net)}</span> },
        { key: 'reason', header: 'Exit', render: (t) => <span className="text-fg-6 truncate max-w-[9rem] inline-block align-middle" title={t.reason || ''}>{t.reason || (t.open ? 'still open' : '—')}</span> },
    ], [ct]);
    const tradeRows = useMemo(() => trades.map((t, i) => ({ ...t, _key: `${t.id}-${i}` })), [trades]);

    const pathRows = useMemo(() => (sel?.path || []).map(p => ({
        t: new Date(p.t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
        net: n(p.net), spot: n(p.spot),
    })), [sel]);

    return (
        <div className="p-6 space-y-4">
            <PageHeader
                icon={CandlestickChart}
                title="Charts"
                subtitle="Any index, equity or traded option — with this desk's own entries, exits, stops, targets, strikes and break-evens drawn on the price."
                badges={candleData?.meta ? <Chip tone="muted" title={`${candleData.meta.count} bars${candleData.meta.dropped ? `, ${candleData.meta.dropped} malformed dropped` : ''}`}>{candleData.meta.count} bars</Chip> : null}
                actions={(
                    <>
                        <Segmented options={RESOLUTIONS.map(r => ({ v: r.v, label: r.label }))} value={resolution} onChange={(v) => { setResolution(v); setDrawMode(false); }} />
                        <Segmented options={RANGES.map(r => ({ v: r.v, label: r.label }))} value={days} onChange={setDays} />
                        <button type="button" onClick={() => { setAsOf(Date.now()); setNonce(x => x + 1); }} title="Refetch"
                            className="px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-4 hover:text-fg inline-flex items-center gap-1">
                            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> Refresh
                        </button>
                    </>
                )}
            />

            <div className="flex flex-wrap items-end gap-3 text-xs">
                <label className="text-fg-5">Symbol
                    <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setSelected(null); setDrawMode(false); }}
                        className="block mt-0.5 bg-card-2 border border-line rounded p-1.5 text-fg-2 min-w-[16rem]">
                        {['index', 'equity', 'commodity', 'option'].map(kind => {
                            const group = symbolOptions.filter(o => o.kind === kind);
                            if (!group.length) return null;
                            const GROUP_LABEL = {
                                index: 'Indices',
                                equity: 'Equities',
                                // Named as futures so it is obvious these are dated
                                // contracts, not spot commodities — the option label
                                // carries the contract the chart will actually fetch.
                                commodity: 'MCX futures (near-month contract)',
                                option: 'Options we have traded (60d)',
                            };
                            return (
                                <optgroup key={kind} label={GROUP_LABEL[kind]}>
                                    {group.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </optgroup>
                            );
                        })}
                    </select>
                </label>
                <div>
                    <div className="text-3xs text-fg-5 mb-0.5">Levels</div>
                    <Segmented options={MODES} value={mode} onChange={(v) => { setMode(v); setSelected(null); setDrawMode(false); }} />
                </div>
                <div className="flex items-end gap-1.5 pb-0.5">
                    <button
                        type="button"
                        onClick={() => setDrawMode(v => !v)}
                        aria-pressed={drawMode}
                        title="Draw a trend line (D). Click once to start, again to finish."
                        className={`px-2 py-1 rounded border text-2xs inline-flex items-center gap-1 ${drawMode ? 'border-primary bg-primary/15 text-primary' : 'border-line text-fg-4 hover:text-fg-2'}`}
                    >
                        <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
                        Trend line
                    </button>
                    <button
                        type="button"
                        onClick={() => setLockToData(v => !v)}
                        aria-pressed={lockToData}
                        title={lockToData
                            ? 'Locked: zooming out stops at the first and last bar.'
                            : 'Free: you can zoom out past the data (empty space around the candles).'}
                        className={`px-2 py-1 rounded border text-2xs inline-flex items-center gap-1 ${lockToData ? 'border-primary bg-primary/15 text-primary' : 'border-line text-fg-4 hover:text-fg-2'}`}
                    >
                        {lockToData ? <Lock className="w-3.5 h-3.5" aria-hidden="true" /> : <Unlock className="w-3.5 h-3.5" aria-hidden="true" />}
                        {lockToData ? 'Locked to data' : 'Free zoom'}
                    </button>
                    {lines.length > 0 && (
                        <button
                            type="button"
                            onClick={() => commitLines([])}
                            title={`Remove all ${lines.length} line(s) on ${symbol.replace(/^(NSE|BSE):/, '')} ${resolution}`}
                            className="px-2 py-1 rounded border border-line text-2xs text-fg-4 hover:text-negative inline-flex items-center gap-1"
                        >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            Clear {lines.length}
                        </button>
                    )}
                </div>
                {selected && (
                    // Clearing the selection also un-zooms (PriceChart falls back
                    // to fitContent when there is no fitKey), so the label should
                    // say both — "show all trades" alone left people manually
                    // dragging the time scale to get their view back.
                    <button type="button" onClick={() => setSelected(null)} className="text-2xs text-primary hover:underline pb-1.5">
                        show all trades &amp; reset zoom
                    </button>
                )}
                {hover?.candle && (
                    <span className="text-2xs text-fg-5 pb-1.5 inline-flex items-center gap-1 tabular-nums">
                        <Crosshair className="w-3 h-3" aria-hidden="true" />
                        O {int(hover.candle.open)} H {int(hover.candle.high)} L {int(hover.candle.low)} C {int(hover.candle.close)}
                    </span>
                )}
            </div>

            {/* mode ↔ symbol mismatch is a real trap: say it rather than draw nothing */}
            {mode === 'premium' && isIndex && (
                <div className="text-2xs text-amber-300/90 border border-amber-700/40 bg-amber-950/20 rounded p-2">
                    ⚠ You are charting an <b>index</b> with option-premium levels selected. An index has no premium, so no stops or targets will appear.
                    Pick a traded option from the Symbol list, or click a single-leg trade below and choose “open the option”.
                </div>
            )}

            {err ? (
                <Card title="No price data"><EmptyState icon={CandlestickChart} title={String(err)}>
                    <div className="space-y-2 text-left">
                        <div>
                            {/* The single most common cause, and the one the old copy never named:
                                the broker drops history for EXPIRED contracts entirely. */}
                            {errDetail?.broker
                                ? <>Broker: {String(errDetail.broker)}</>
                                : <>The broker returned nothing for this symbol, range and resolution.</>}
                        </div>
                        {errDetail?.archive && typeof errDetail.archive === 'object' && (
                            <div>
                                Chain archive: {errDetail.archive.why || (errDetail.archive.ok ? 'available' : 'no premium history for this contract in range')}
                                {Array.isArray(errDetail.archive.excludedDays) && errDetail.archive.excludedDays.length > 0 && (
                                    <ul className="mt-1 ml-3 list-disc text-3xs text-fg-6">
                                        {errDetail.archive.excludedDays.slice(0, 4).map((d) => (
                                            <li key={d.day}>{d.day} — {d.why}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                        {typeof errDetail?.archive === 'string' && <div>Chain archive: {errDetail.archive}</div>}
                        <div className="text-3xs text-fg-6">
                            The option-chain archive only covers the ATM±10 strikes recorded in production since 2026-08-05.
                            Widen the date range to include the contract&apos;s own trading week, or try a coarser interval.
                        </div>
                    </div>
                </EmptyState></Card>
            ) : loading && !candles.length ? (
                <Card><div className="py-8"><Spinner label="Fetching candles and overlaying trades…" /></div></Card>
            ) : !candles.length ? (
                <Card><EmptyState icon={CandlestickChart} title="No candles in this window.">Widen the range or pick another interval.</EmptyState></Card>
            ) : (
                <>
                    <Card
                        title={`${symbol.replace(/^(NSE|BSE):/, '')} · ${RESOLUTIONS.find(r => r.v === resolution)?.label || resolution}`}
                        subtitle={overlays?.note}
                        right={
                            <span className="flex items-center gap-2">
                                {candleData?.meta?.source === 'archive' && (
                                    <Chip tone="info" title={`Rebuilt from the option-chain archive: ${candleData.meta.attributionNote}`}>
                                        from chain archive
                                    </Chip>
                                )}
                                <span>{shown.markers.length} marker(s) · {shown.priceLines.length} level(s){selected ? ' · one trade' : ''}</span>
                            </span>
                        }
                    >
                        <PriceChart
                            candles={candles}
                            markers={shown.markers}
                            priceLines={shown.priceLines}
                            showVolume={!!candleData?.meta?.hasVolume}
                            height={520}
                            fitKey={fitKey}
                            onHover={setHover}
                            lockToData={lockToData}
                            drawMode={drawMode}
                            lines={lines}
                            onLinesChange={commitLines}
                            onDrawModeChange={setDrawMode}
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xs text-fg-6">
                            <span className="inline-flex items-center gap-1">
                                <Keyboard className="w-3 h-3" aria-hidden="true" />
                                click the chart first, then:
                            </span>
                            <span><b className="text-fg-4">+ / −</b> zoom</span>
                            <span><b className="text-fg-4">← →</b> pan (hold shift for a bigger step)</span>
                            <span><b className="text-fg-4">F</b> fit all</span>
                            <span><b className="text-fg-4">D</b> trend-line tool</span>
                            <span><b className="text-fg-4">Del</b> remove selected</span>
                            <span><b className="text-fg-4">Esc</b> cancel</span>
                            {drawMode && <span className="text-warning">drawing — click once to start, again to finish (pan/zoom paused)</span>}
                        </div>
                        {!candleData?.meta?.hasVolume && (
                            <div className="text-3xs text-fg-6 mt-1">Volume pane hidden — this series reports none (index feeds usually do not).</div>
                        )}
                        {candleData?.meta?.source === 'archive' && (
                            // Archive candles are NOT broker candles: they are ~1/min
                            // samples of the chain, and on older rows the contract is
                            // inferred rather than recorded. Both facts change how much
                            // weight a reader should put on the picture, so both are said.
                            <div className="mt-1 space-y-0.5 text-3xs text-fg-6">
                                <div>
                                    Prices are <b>option premium</b> rebuilt from the chain archive
                                    {candleData.meta.contract ? ` · ${candleData.meta.contract.strike} ${candleData.meta.contract.side} exp ${candleData.meta.contract.expiry}` : ''}
                                    {' · '}~{candleData.meta.samplesPerBar} sample(s) per bar
                                    {candleData.meta.daysUsed?.length ? ` · ${candleData.meta.daysUsed.length} session(s)` : ''}
                                </div>
                                {candleData.meta.degenerate && <div className="text-warning">{candleData.meta.note}</div>}
                                {candleData.meta.attribution === 'inferred-window' && (
                                    <div className="text-warning">
                                        Contract attribution is INFERRED (these snapshots predate the archiver recording expiry).
                                        {candleData.meta.excludedDays?.length ? ` ${candleData.meta.excludedDays.length} day(s) at this strike were excluded as a different contract.` : ''}
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                    <StatRow cols={4}>
                        <StatTile label="Trades on this chart" value={int(trades.length)} hint={`${wins} winner(s) · ${trades.length - wins} loser(s)`} />
                        <StatTile label="Net over the window" value={inr(netAll)} tone={netAll > 0 ? 'positive' : netAll < 0 ? 'negative' : 'neutral'} hint="Sum of what is drawn, not the whole book" />
                        {/* The range buttons are the FETCH window, not a zoom: the
                            chart cannot show history that was never requested, which
                            is why zooming out stops where it does. Say so here rather
                            than letting it read as missing data. */}
                        {/* The range buttons are the FETCH window, not a zoom: the
                            chart cannot show history that was never requested, which
                            is why zooming out stops where it does. A coarse interval
                            on a short range is the trap — 1D over 5d is five candles,
                            which looks broken rather than simply sparse. */}
                        <StatTile
                            label="Bars"
                            value={int(candleData?.meta?.count)}
                            tone={(candleData?.meta?.count ?? 99) < 20 ? 'warning' : 'neutral'}
                            hint={
                                (candleData?.meta?.count ?? 99) < 20
                                    ? `only ${candleData?.meta?.count} at ${RESOLUTIONS.find(r => r.v === resolution)?.label || resolution} over ${days}d — pick a longer range or a finer interval`
                                    : `${from} → ${to} · ${days}d requested — use the range buttons for more history`
                            }
                        />
                        <StatTile
                            label="Levels drawn"
                            value={int(shown.priceLines.length)}
                            hint={selected ? 'the selected trade only'
                                : shown.auto ? 'entry, exit, stop and target'
                                    : `${trades.length} trades here — click one to see its levels`}
                        />
                    </StatRow>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <Card title="Trades in this window" subtitle="Click a row to zoom the chart to that trade and show only its levels.">
                            {trades.length === 0 ? (
                                <EmptyState title="Nothing traded here">
                                    No trade of ours falls in this window on this symbol. Pick a wider range, or a symbol you have actually traded.
                                </EmptyState>
                            ) : (
                                <DataTable
                                    columns={tradeCols} rows={tradeRows} dense maxHeight={330}
                                    selectedKey={tradeRows.find(r => r.id === selected)?._key ?? null}
                                    onRowClick={(r) => setSelected(cur => (cur === r.id ? null : r.id))}
                                />
                            )}
                        </Card>

                        <Card title={sel ? sel.label : 'Trade detail'} subtitle={sel ? 'What the chart is showing you' : 'Select a trade on the left.'}>
                            {!sel ? (
                                <Placeholder>Nothing selected.</Placeholder>
                            ) : (
                                <div className="space-y-3">
                                    <StatRow cols={3}>
                                        <StatTile label="Net" value={inr(sel.net)} tone={(n(sel.net) ?? 0) > 0 ? 'positive' : (n(sel.net) ?? 0) < 0 ? 'negative' : 'neutral'} hint={sel.reason || (sel.open ? 'still open' : '')} />
                                        <StatTile label="Entry spot" value={int(sel.entrySpot)} hint={istStamp(sel.entryAt)} />
                                        <StatTile label="Exit spot" value={int(sel.exitSpot)} hint={sel.exitAt ? istStamp(sel.exitAt) : 'open'} />
                                    </StatRow>
                                    {sel.kind === 'single' && (
                                        <div className="space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-3 text-2xs text-fg-4">
                                                <span>fills <b className="text-fg-2">{sel.entryPremium ?? '—'}</b> → <b className="text-fg-2">{sel.exitPremium ?? '—'}</b> premium</span>
                                                <button type="button" onClick={openTheOption} className="text-primary hover:underline inline-flex items-center gap-1">
                                                    open the option <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                                </button>
                                            </div>
                                            <LevelsLine levels={sel.levels} side={sel.side} entryPremium={sel.entryPremium} />
                                        </div>
                                    )}
                                    {sel.kind === 'multileg' && <MultilegDetail sel={sel} />}
                                    {pathRows.length > 2 ? (
                                        <div>
                                            <div className="text-2xs text-fg-5 mb-1">
                                                Mark-to-market through the hold{sel.maeRupees != null ? ` · worst ${inr(sel.maeRupees)} · best ${inr(sel.mfeRupees)}` : ''}
                                            </div>
                                            <ResponsiveContainer width="100%" height={140}>
                                                <LineChart data={pathRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                                    <XAxis dataKey="t" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} minTickGap={28} />
                                                    <YAxis width={50} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={(v) => `₹${Math.round(v)}`} />
                                                    <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })} formatter={(v, k) => [k === 'spot' ? int(v) : inr(v), k]} />
                                                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                                                    <Line type="monotone" dataKey="net" stroke={ct.mark.equity} dot={false} strokeWidth={2} isAnimationActive={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="text-3xs text-fg-6">
                                            No stored MTM path for this trade — the engine began persisting one only recently, so older trades show entry and exit alone.
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
}
