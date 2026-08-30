import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, ShieldAlert, Layers, Activity, PieChart, Gauge } from 'lucide-react';
import {
    Card, StatTile, StatRow, Meter, DivergingBars, Heatmap, DataTable,
    Legend, ShareBar, StatusBadge, Placeholder,
} from '../components/viz/primitives';
import AttributionPanel from '../components/viz/AttributionPanel';
import { inr, num, useChartTheme } from '../components/viz/tokens';
import { pollInterval } from '../hooks/usePolling.js';
import { API_URL } from '../config/api.js';


/**
 * Portfolio Risk — the whole-account view.
 *
 * Everything the trading loop cannot tell you on its own:
 *   Live Book   what am I actually exposed to, right now, across BOTH engines
 *   Stress      what kills me today
 *   Attribution where the money went, and where it is leaking
 *   Portfolio   how many bets do I really run (vs how many strategies)
 *
 * All of it is read-only. Nothing on this page can place, modify or cancel an
 * order.
 */
export default function Risk() {
    const ct = useChartTheme();
    const [tab, setTab] = useState('book');
    const [greeks, setGreeks] = useState(null);
    const [stress, setStress] = useState(null);
    const [scenarios, setScenarios] = useState(null);
    const [margin, setMargin] = useState(null);
    const [attribution, setAttribution] = useState(null);
    const [factors, setFactors] = useState(null);
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [lastAt, setLastAt] = useState(null);

    // Live book + stress refresh together (they read the same positions).
    const loadLive = useCallback(async () => {
        try {
            const [g, s, sc, m] = await Promise.all([
                axios.get(`${API_URL}/risk/greeks`),
                axios.get(`${API_URL}/risk/stress`),
                axios.get(`${API_URL}/risk/scenarios`),
                axios.get(`${API_URL}/risk/margin`),
            ]);
            setGreeks(g.data); setStress(s.data); setScenarios(sc.data); setMargin(m.data);
            setLastAt(new Date());
            setErr(null);
        } catch (e) {
            setErr(e?.response?.data?.error || e.message);
        }
    }, []);

    // Historical analytics refresh only when asked (they scan trade_history).
    const loadHistory = useCallback(async () => {
        setLoading(true);
        try {
            const [a, f] = await Promise.all([
                axios.get(`${API_URL}/risk/attribution`, { params: { days } }),
                axios.get(`${API_URL}/risk/factors`, { params: { days } }),
            ]);
            setAttribution(a.data); setFactors(f.data);
            setErr(null);
        } catch (e) {
            setErr(e?.response?.data?.error || e.message);
        } finally { setLoading(false); }
    }, [days]);

    useEffect(() => { loadLive(); }, [loadLive]);
    useEffect(() => { loadHistory(); }, [loadHistory]);

    useEffect(() => {
        if (!autoRefresh) return;
        const id = pollInterval(loadLive, 15000);
        return () => id?.();
    }, [autoRefresh, loadLive]);

    const tabs = [
        { key: 'book', label: 'Live Book', icon: Gauge },
        { key: 'stress', label: 'Stress', icon: ShieldAlert },
        { key: 'attribution', label: 'Attribution', icon: Activity },
        { key: 'portfolio', label: 'Portfolio', icon: PieChart },
    ];

    return (
        <div className="p-6 space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-fg">Portfolio Risk</h1>
                    <p className="text-xs text-fg-5 mt-0.5">
                        Whole-account view across the single-leg and multi-leg engines. Read-only.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {['attribution', 'portfolio'].includes(tab) && (
                        <select value={days} onChange={e => setDays(Number(e.target.value))}
                                className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-fg-3">
                            {[7, 14, 30, 60, 90, 180].map(d => <option key={d} value={d}>Last {d} days</option>)}
                        </select>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-fg-4 cursor-pointer">
                        {/* accent-fg-5, not accent-slate-500: `accent-color` is the tick's own
                            fill, so it needs to stay dark enough for the browser's white
                            checkmark. neutral-500 lands at L 0.70 on the light themes (2.7:1);
                            fg-5 holds ~L 0.53 in both modes (>=5:1) and is neutral-500's dark
                            value, so midnight's grey checkbox is unchanged. Deliberately
                            neutral rather than `accent-primary` — this is a minor auto-refresh
                            toggle and the design keeps it unobtrusive. */}
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
                               className="accent-fg-5" />
                        Auto 15s
                    </label>
                    <button onClick={() => { loadLive(); loadHistory(); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface border border-line text-xs text-fg-3 hover:bg-slate-800">
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </header>

            {/* Same tint/edge/ink recipe as StatusBadge, so the error banner
                follows the theme's danger token instead of a fixed red that
                disappears against a light surface. */}
            {err && (
                <div className="px-3 py-2 rounded text-xs"
                     style={{
                         backgroundColor: ct.alpha(ct.status.critical, 0.12),
                         border: `1px solid ${ct.alpha(ct.status.critical, 0.33)}`,
                         color: ct.status.critical,
                     }}>
                    {err}
                </div>
            )}

            <nav className="flex gap-1 border-b border-line">
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition ${
                                tab === t.key
                                    ? 'border-primary text-fg'
                                    : 'border-transparent text-fg-5 hover:text-fg-3'}`}>
                        <t.icon className="w-4 h-4" />
                        {t.label}
                    </button>
                ))}
                {lastAt && <span className="ml-auto self-center text-2xs text-fg-6">
                    updated {lastAt.toLocaleTimeString('en-IN')}
                </span>}
            </nav>

            {tab === 'book' && <LiveBook greeks={greeks} margin={margin} />}
            {tab === 'stress' && <Stress stress={stress} scenarios={scenarios} greeks={greeks} />}
            {tab === 'attribution' && <AttributionPanel data={attribution} context="live" />}
            {tab === 'portfolio' && <Portfolio factors={factors} />}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Live Book                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

function LiveBook({ greeks, margin }) {
    const ct = useChartTheme();
    if (!greeks) return <Placeholder>Loading book…</Placeholder>;
    if (!greeks.ok) return <Placeholder>Book unavailable: {greeks.reason}</Placeholder>;

    const b = greeks.book;
    const c = greeks.concentration || {};
    const empty = !b || !b.count;

    const underlyingRows = Object.entries(greeks.byUnderlying || {})
        .map(([sym, u]) => ({ _key: sym, sym, ...u }))
        .sort((a, b2) => Math.abs(b2.deltaRupeesPer1Pct) - Math.abs(a.deltaRupeesPer1Pct));

    const sources = Object.entries(greeks.bySource || {});

    return (
        <div className="space-y-4">
            {/* The five numbers that describe an options book. */}
            <StatRow cols={5}>
                <StatTile
                    label="Net delta"
                    value={inr(b?.betaWeightedDelta, { compact: true, sign: true })}
                    tone={(b?.betaWeightedDelta || 0) >= 0 ? 'positive' : 'negative'}
                    hint="₹ per 1% move · NIFTY-equivalent"
                    hero
                />
                <StatTile label="Net vega" value={inr(b?.vega, { compact: true, sign: true })}
                          tone={(b?.vega || 0) >= 0 ? 'positive' : 'negative'}
                          hint="₹ per 1 IV point" />
                <StatTile label="Theta" value={inr(b?.theta, { compact: true, sign: true })}
                          tone={(b?.theta || 0) >= 0 ? 'positive' : 'negative'}
                          hint="₹ per calendar day" />
                <StatTile label="Premium at risk" value={inr(b?.premiumAtRisk, { compact: true })}
                          hint="max loss on long legs" />
                <StatTile
                    label={margin?.basis === 'span' ? 'Margin (broker SPAN)' : 'Margin (estimate)'}
                    value={inr(margin?.requiredRupees ?? margin?.hedgeRecognisedTotalRupees, { compact: true })}
                    hint={margin?.hedgeBenefitRupees > 0
                        ? `${inr(margin.hedgeBenefitRupees, { compact: true })} saved by hedge recognition`
                        : 'no hedge offsets on the book'}
                    badge={margin?.basis === 'span'
                        ? <StatusBadge level="good" title="Real SPAN from the broker">Exact</StatusBadge>
                        : <StatusBadge level="warning" title="Broker margin API unavailable — approximation">Est.</StatusBadge>}
                />
            </StatRow>

            {empty && <Card><Placeholder>No open positions. Risk numbers are zero.</Placeholder></Card>}

            {!empty && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* The correlated-stack detector — the reason this page exists. */}
                        <Card title="Directional concentration"
                              subtitle="Are these separate bets, or one bet in many costumes?">
                            <Meter
                                value={c.directionalConcentration || 0}
                                label={`${c.dominantSide === 'FLAT' ? 'Balanced' : `${c.dominantSide}-dominant`}`}
                                tone={c.directionalConcentration > 0.85 ? 'critical'
                                    : c.directionalConcentration > 0.6 ? 'warning' : 'neutral'}
                                caption={c.directionalConcentration > 0.85
                                    ? 'Nearly all directional risk points the same way. One adverse move hits every position at once — strategy diversification is not risk diversification.'
                                    : 'Share of gross directional risk pointing one way.'}
                            />
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-2xs text-fg-5">Long side</p>
                                    <p className="text-sm tabular-nums" style={{ color: ct.diverging.positive }}>
                                        {inr(c.longRiskRupeesPer1Pct, { compact: true })}<span className="text-fg-5 text-2xs">/1%</span>
                                    </p>
                                </div>
                                <div>
                                    <p className="text-2xs text-fg-5">Short side</p>
                                    <p className="text-sm tabular-nums" style={{ color: ct.diverging.negative }}>
                                        {inr(c.shortRiskRupeesPer1Pct, { compact: true })}<span className="text-fg-5 text-2xs">/1%</span>
                                    </p>
                                </div>
                            </div>
                            <div className="mt-3">
                                <Meter value={c.underlyingHerfindahl || 0} label="Underlying concentration"
                                       tone={c.underlyingHerfindahl > 0.7 ? 'warning' : 'neutral'}
                                       caption="1.0 = every rupee of risk in one index." />
                            </div>
                        </Card>

                        {/* Proof the multileg book is actually being counted. */}
                        <Card title="Which engine holds the risk"
                              subtitle="Both books priced by one aggregator, one set of conventions."
                              right={greeks.providers?.length
                                  ? <StatusBadge level="good">{greeks.providers.length} provider(s)</StatusBadge>
                                  : <StatusBadge level="warning" title="No external leg provider registered">single-leg only</StatusBadge>}>
                            <ShareBar
                                parts={sources.map(([name, s], i) => ({
                                    label: name, value: Math.abs(s.deltaRupeesPer1Pct), color: ct.categorical[i],
                                }))}
                                format={(v) => `${inr(v, { compact: true })}/1%`}
                            />
                            <div className="mt-3">
                                <DataTable
                                    dense
                                    columns={[
                                        { key: 'src', header: 'Source' },
                                        { key: 'count', header: 'Legs', align: 'right' },
                                        { key: 'd', header: '₹/1%', align: 'right', render: r => inr(r.deltaRupeesPer1Pct, { compact: true, sign: true }) },
                                        { key: 'v', header: 'Vega', align: 'right', render: r => inr(r.vega, { compact: true, sign: true }) },
                                        { key: 't', header: 'Theta', align: 'right', render: r => inr(r.theta, { compact: true, sign: true }) },
                                    ]}
                                    rows={sources.map(([name, s]) => ({ _key: name, src: name, ...s }))}
                                />
                            </div>
                        </Card>

                        <Card title="Exposure by underlying"
                              subtitle="₹ P&L per 1% move — comparable across indices.">
                            <DivergingBars
                                data={underlyingRows.map(r => ({
                                    label: r.sym.replace(/^[A-Z]+:|-INDEX$/g, ''),
                                    value: r.deltaRupeesPer1Pct,
                                    hint: `${r.count} legs · vega ${inr(r.vega, { compact: true })} · theta ${inr(r.theta, { compact: true })}`,
                                }))}
                                format={(v) => `${inr(v, { compact: true, sign: true })}`}
                            />
                        </Card>
                    </div>

                    {greeks.warnings?.length > 0 && (
                        <Card title="Book warnings"
                              subtitle="A leg that cannot be priced is still on the book — these mean the numbers above may understate risk.">
                            <ul className="space-y-1">
                                {greeks.warnings.map((w, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs">
                                        <StatusBadge level="warning">Unpriced</StatusBadge>
                                        <span className="text-fg-3">{w.symbol}</span>
                                        <span className="text-fg-5">{w.reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}

                    <Card title="Open legs" subtitle={`${greeks.legs?.length || 0} contracts across both engines`}>
                        <DataTable
                            maxHeight={460}
                            columns={[
                                { key: 'symbol', header: 'Contract', render: r => (
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                              style={{ backgroundColor: r.source === 'multileg' ? ct.categorical[1] : ct.categorical[0] }} />
                                        <span className="text-fg-2">{r.symbol}</span>
                                    </span>
                                ) },
                                { key: 'source', header: 'Engine', render: r => (
                                    <span className="text-fg-5">{r.structure || r.source}</span>
                                ) },
                                { key: 'strategyName', header: 'Strategy', render: r => <span className="text-fg-4">{r.strategyName || '—'}</span> },
                                { key: 'side', header: 'Side', render: r => (
                                    <span style={{ color: r.side === 1 ? ct.diverging.positive : ct.diverging.negative }}>
                                        {r.side === 1 ? 'LONG' : 'SHORT'}
                                    </span>
                                ) },
                                { key: 'quantity', header: 'Qty', align: 'right' },
                                { key: 'premium', header: 'Premium', align: 'right', render: r => `₹${num(r.premium)}` },
                                { key: 'iv', header: 'IV', align: 'right', render: r => (
                                    <span title={`solved from ${r.ivSource}`}>{num(r.iv, 1)}%</span>
                                ) },
                                { key: 'daysToExpiry', header: 'DTE', align: 'right', render: r => num(r.daysToExpiry, 1) },
                                { key: 'delta', header: 'Δ ₹/pt', align: 'right', render: r => num(r.delta, 1) },
                                { key: 'deltaRupeesPer1Pct', header: '₹/1%', align: 'right', render: r => inr(r.deltaRupeesPer1Pct, { compact: true, sign: true }) },
                                { key: 'vega', header: 'Vega', align: 'right', render: r => num(r.vega, 0) },
                                { key: 'theta', header: 'Theta', align: 'right', render: r => num(r.theta, 0) },
                                { key: 'stale', header: '', render: r => r.stalePremium
                                    ? <StatusBadge level="warning" title="No live quote — marked at entry price">stale</StatusBadge> : null },
                            ]}
                            rows={(greeks.legs || []).map((l, i) => ({ _key: l.symbol + i, ...l }))}
                        />
                        <Legend items={[
                            { label: 'single-leg engine', color: ct.categorical[0] },
                            { label: 'multi-leg engine', color: ct.categorical[1] },
                        ]} />
                    </Card>
                </>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Stress                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

function Stress({ stress, scenarios, greeks }) {
    const ct = useChartTheme();
    if (!stress) return <Placeholder>Loading stress grid…</Placeholder>;
    if (!stress.legCount) return <Card><Placeholder>No open positions to stress.</Placeholder></Card>;

    const spotShocks = stress.grid?.spotShocksPct || [];
    const ivShocks = stress.grid?.ivShocksPct || [];
    const cellAt = (s, v) => {
        const c = stress.cells.find(x => x.spotShockPct === s && x.ivShockPct === v);
        return c ? c.pnl : null;
    };

    const worst = stress.worst;
    const premiumAtRisk = greeks?.book?.premiumAtRisk || 0;

    return (
        <div className="space-y-4">
            <StatRow cols={4}>
                <StatTile label="Worst case in grid" value={inr(worst?.pnl, { compact: true })}
                          tone="negative" hero
                          hint={worst ? `spot ${worst.spotShockPct > 0 ? '+' : ''}${worst.spotShockPct}%, IV ${worst.ivShockPct > 0 ? '+' : ''}${worst.ivShockPct}%, +${worst.hoursForward}h` : ''} />
                <StatTile label="Best case in grid" value={inr(stress.best?.pnl, { compact: true, sign: true })}
                          tone="positive"
                          hint={stress.best ? `spot ${stress.best.spotShockPct > 0 ? '+' : ''}${stress.best.spotShockPct}%` : ''} />
                <StatTile label="Worst named scenario" value={inr(scenarios?.worst?.pnl, { compact: true })}
                          tone="negative" hint={scenarios?.worst?.label} />
                <StatTile label="Premium at risk" value={inr(premiumAtRisk, { compact: true })}
                          hint="floor for a long-only book" />
            </StatRow>

            <Card
                title="Shock grid — full repricing"
                subtitle="Every leg repriced with Black-Scholes under each shock, not a greek approximation: convexity is exactly what hurts in a tail."
                right={<span className="text-2xs text-fg-5">+{stress.grid?.hoursForward}h decay applied</span>}
            >
                <Heatmap
                    rows={spotShocks}
                    cols={ivShocks}
                    valueAt={cellAt}
                    rowLabel={(s) => `${s > 0 ? '+' : ''}${s}%`}
                    colLabel={(v) => `IV ${v > 0 ? '+' : ''}${v}%`}
                    rowTitle="spot"
                    colTitle="implied volatility shock (relative)"
                    cellHint={(r, c, v) => `Spot ${r > 0 ? '+' : ''}${r}%, IV ${c > 0 ? '+' : ''}${c}% → ${inr(v, { sign: true })}`}
                />
            </Card>

            <Card title="Named scenarios"
                  subtitle="Worst first. The rows anyone reads are the top three.">
                <DataTable
                    columns={[
                        { key: 'label', header: 'Scenario' },
                        { key: 'shock', header: 'Shock', render: r => (
                            <span className="text-fg-5">
                                {r.shock.spotShockPct > 0 ? '+' : ''}{r.shock.spotShockPct}% spot ·
                                {' '}{r.shock.ivShockPct > 0 ? '+' : ''}{r.shock.ivShockPct}% IV
                                {r.shock.hoursForward ? ` · +${r.shock.hoursForward}h` : ''}
                            </span>
                        ) },
                        { key: 'pnl', header: 'P&L', align: 'right', render: r => (
                            <span style={{ color: r.pnl >= 0 ? ct.diverging.positive : ct.diverging.negative }}>
                                {inr(r.pnl, { compact: true, sign: true })}
                            </span>
                        ) },
                        { key: 'by', header: 'Worst underlying', align: 'right', render: r => {
                            const e = Object.entries(r.byUnderlying || {}).sort((a, b) => a[1] - b[1])[0];
                            return e ? <span className="text-fg-5">{e[0].replace(/^[A-Z]+:|-INDEX$/g, '')} {inr(e[1], { compact: true })}</span> : '—';
                        } },
                    ]}
                    rows={(scenarios?.scenarios || []).map((s, i) => ({ _key: s.name + i, ...s }))}
                />
                <p className="text-2xs text-fg-5 mt-3 leading-snug">
                    These magnitudes are templates for the <em>kinds</em> of day an index book must survive,
                    not measurements from your archive. Calibrate them to your own worst days with
                    <code className="mx-1 px-1 rounded bg-slate-800">deriveScenariosFromHistory()</code>
                    before treating the numbers as precise.
                </p>
            </Card>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Portfolio — how many bets do you really run                                */
/* ══════════════════════════════════════════════════════════════════════════ */

function Portfolio({ factors }) {
    const ct = useChartTheme();
    if (!factors) return <Placeholder>Loading portfolio model…</Placeholder>;
    const cl = factors.clusters;
    if (!cl || !cl.strategyCount) {
        return <Card><Placeholder>Not enough trading history to model correlations. Needs ~10 active days per strategy.</Placeholder></Card>;
    }

    const corr = factors.correlations;
    const names = corr?.strategies || [];
    const showMatrix = names.length >= 2 && names.length <= 14;

    return (
        <div className="space-y-4">
            <StatRow cols={4}>
                <StatTile label="Strategies traded" value={cl.strategyCount} hero />
                <StatTile label="Independent bets" value={cl.clusterCount} hero
                          tone={cl.clusterCount < cl.strategyCount ? 'negative' : 'positive'}
                          hint={`at r ≥ ${cl.threshold}`} />
                <StatTile label="Redundant strategies" value={cl.redundantCount}
                          tone={cl.redundantCount > 0 ? 'negative' : 'neutral'}
                          hint="same bet, extra size — no extra edge"
                          badge={cl.redundantCount > 0 ? <StatusBadge level="warning">Duplication</StatusBadge> : null} />
                <StatTile label="Window" value={`${factors.window?.days || 0} days`}
                          hint={factors.window?.from ? `${factors.window.from} → ${factors.window.to}` : ''} />
            </StatRow>

            <Card title="The headline">
                <p className="text-sm text-fg-2">{cl.verdict}</p>
                <p className="text-2xs text-fg-5 mt-1.5 leading-snug">
                    Two strategies with different names and different indicators are the SAME bet if their daily
                    P&L moves together. Running both doubles position size without doubling edge — the same expected
                    return for √2 more risk.
                </p>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Clusters — what to keep, what to drop"
                      subtitle="Within each cluster, the member with the best risk-adjusted return is the keeper.">
                    <div className="space-y-3">
                        {cl.clusters.map(c => (
                            <div key={c.clusterId} className="rounded border border-line/60 p-2.5">
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <span className="text-xs text-fg-4">
                                        Bet #{c.clusterId} · {c.size} {c.size === 1 ? 'strategy' : 'strategies'}
                                    </span>
                                    <span className="text-xs tabular-nums"
                                          style={{ color: c.clusterTotalNetPnl >= 0 ? ct.diverging.positive : ct.diverging.negative }}>
                                        {inr(c.clusterTotalNetPnl, { compact: true, sign: true })}
                                    </span>
                                </div>
                                <DataTable
                                    dense
                                    columns={[
                                        { key: 'strategy', header: '', render: r => (
                                            <span className={r.strategy === c.keep ? 'text-fg' : 'text-fg-5'}>
                                                {r.strategy}
                                            </span>
                                        ) },
                                        { key: 'sharpe', header: 'Sharpe', align: 'right', render: r => num(r.sharpe) },
                                        { key: 'totalNetPnl', header: 'Net', align: 'right', render: r => inr(r.totalNetPnl, { compact: true, sign: true }) },
                                        { key: 'activeDays', header: 'Days', align: 'right' },
                                        { key: 'verdict', header: '', render: r => r.strategy === c.keep
                                            ? <StatusBadge level="good">Keep</StatusBadge>
                                            : <StatusBadge level="warning">Redundant</StatusBadge> },
                                    ]}
                                    rows={c.members.map(m => ({ _key: m.strategy, ...m }))}
                                />
                            </div>
                        ))}
                    </div>
                </Card>

                <div className="space-y-4">
                    <Card title="Capital allocation"
                          subtitle={factors.allocation?.method}>
                        <DivergingBars
                            data={(factors.allocation?.allocations || []).map(a => ({
                                label: a.representative || `Bet #${a.clusterId}`,
                                value: a.weight,
                                hint: `daily σ ${inr(a.dailyStdev)} · represents ${a.members} strategies`,
                            }))}
                            format={(v) => `${(v * 100).toFixed(0)}%`}
                        />
                        <p className="text-2xs text-fg-5 mt-2 leading-snug">
                            {factors.allocation?.note}
                        </p>
                    </Card>

                    {corr?.redundantPairs?.length > 0 && (
                        <Card title="Most duplicated pairs" subtitle="r ≥ 0.7 on daily net P&L">
                            <DataTable
                                dense
                                columns={[
                                    { key: 'a', header: 'Strategy A' },
                                    { key: 'b', header: 'Strategy B' },
                                    { key: 'correlation', header: 'r', align: 'right', render: r => num(r.correlation) },
                                ]}
                                rows={corr.redundantPairs.slice(0, 10).map((p, i) => ({ _key: i, ...p }))}
                            />
                        </Card>
                    )}
                </div>
            </div>

            {showMatrix && (
                <Card title="Correlation matrix" subtitle="Daily net P&L. Blue = moves together, red = moves opposite.">
                    <Heatmap
                        rows={names}
                        cols={names}
                        valueAt={(r, c) => corr.matrix?.[r]?.[c]}
                        rowLabel={(s) => s.length > 18 ? `${s.slice(0, 17)}…` : s}
                        colLabel={(s) => s.length > 10 ? `${s.slice(0, 9)}…` : s}
                        format={(v) => Number.isFinite(v) ? v.toFixed(2) : '—'}
                        cellHint={(r, c, v) => `${r} ↔ ${c}: r = ${Number.isFinite(v) ? v.toFixed(3) : 'n/a'}`}
                        scaleCaption="moves opposite ← → moves together"
                    />
                </Card>
            )}

            <Card title="What each strategy is actually betting on"
                  subtitle="Per-trade net P&L regressed on market factors. Needs ≥20 fully-decomposed trades.">
                <DataTable
                    columns={[
                        { key: 'name', header: 'Strategy' },
                        { key: 'trades', header: 'Trades', align: 'right', render: r => r.ok ? r.trades : '—' },
                        { key: 'r2', header: 'R²', align: 'right', render: r => r.ok ? num(r.r2) : '—' },
                        { key: 'dominantFactor', header: 'Driver', render: r => r.ok
                            ? <span className="text-fg-2">{r.dominantFactor}</span>
                            : <span className="text-fg-6">{r.reason}</span> },
                        { key: 'interpretation', header: 'Reading', render: r => (
                            <span className="text-fg-4 whitespace-normal">{r.ok ? r.interpretation : ''}</span>
                        ) },
                    ]}
                    rows={Object.entries(factors.factorLoadings?.byStrategy || {})
                        .map(([name, v]) => ({ _key: name, name, ...v }))
                        .sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0))}
                    empty="No strategy has enough fully-decomposed trades yet. Attribution needs entry/exit risk snapshots, written from this deploy onward."
                />
            </Card>
        </div>
    );
}
