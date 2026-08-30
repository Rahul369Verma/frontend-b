import React, { useState, useMemo } from 'react';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Legend,
} from 'recharts';
import ZoomableChart from '../charts/ZoomableChart';
import { Help } from './builderUi';
import {
    num, fmt, rup, sgnNum, compact, shortDate, sdFor, SD_HORIZON_NOTE, tabCls,
} from './builderFormat';
import { useChartTheme } from '../../theme/chartTheme.js';

/**
 * ANALYSIS TABS — four readings of the SAME analysed structure.
 *
 *   Payoff     the curve, with the σ bands and the chain's open interest
 *   P&L table  spot × date grid, heat-mapped
 *   Greeks     per LEG, not just the book total
 *   Legs       what was actually priced, and off which quote
 *
 * They are tabs rather than four stacked cards because they answer the same
 * question ("what is this structure?") from different angles, and only one
 * angle is wanted at a time.
 */

const TABS = [
    { k: 'payoff', label: 'Payoff' },
    { k: 'pnl', label: 'P&L Table' },
    { k: 'greeks', label: 'Greeks' },
    { k: 'legs', label: 'Legs' },
];

function Empty({ children }) {
    return <div className="text-2xs text-fg-5 py-12 text-center">{children}</div>;
}

export default function AnalysisTabs({
    an, resp, chain, chartData, hasNow, hasWif, wif, spot, yDomain, xTicks, strikeMarks,
    lots, lotSize, loading, err, legCount, sdMode, onSdMode,
}) {
    const [tab, setTab] = useState('payoff');
    return (
        <div className="bg-surface rounded-xl border border-line p-4">
            <div className="flex items-center gap-1 border-b border-line-0 mb-2 flex-wrap">
                {TABS.map(t => (
                    <button key={t.k} onClick={() => setTab(t.k)} className={tabCls(tab === t.k)}
                        title={t.k === 'payoff' ? 'P&L against spot, at expiry and today'
                            : t.k === 'pnl' ? 'What the structure is worth at each spot on each date between now and expiry'
                                : t.k === 'greeks' ? 'Delta / gamma / vega / theta for every leg, with a book total'
                                    : 'The resolved legs — broker symbol, the quote each premium came from, intrinsic vs time value'}>
                        {t.label}
                    </button>
                ))}
                <span className="ml-auto text-3xs text-fg-6 pb-1">
                    {fmt(lots)} lot(s) × {fmt(lotSize)} · <span className="text-amber-400/80">GROSS</span>
                </span>
            </div>

            {tab === 'payoff' && (
                <PayoffPanel {...{
                    an, chain, chartData, hasNow, hasWif, wif, spot, yDomain, xTicks, strikeMarks,
                    lots, loading, err, legCount, sdMode, onSdMode,
                }} />
            )}
            {tab === 'pnl' && <PnlTablePanel pnlTable={resp?.pnlTable} an={an} loading={loading} />}
            {tab === 'greeks' && <GreeksPanel an={an} lotSize={lotSize} lots={lots} loading={loading} />}
            {tab === 'legs' && <LegsPanel an={an} resp={resp} loading={loading} />}
        </div>
    );
}

// ── PAYOFF ───────────────────────────────────────────────────────────────────
function PayoffPanel({
    an, chain, chartData, hasNow, hasWif, wif, spot, yDomain, xTicks, strikeMarks,
    lots, loading, err, legCount, sdMode, onSdMode,
}) {
    // Recharts writes these into SVG attributes and into plain style objects, so
    // none of them can be a var(). Roles, not hues: `mark.terminal` is the
    // expiry curve in every theme, including the two that rotate blue out of
    // the palette entirely.
    const ct = useChartTheme();
    const [showOi, setShowOi] = useState(true);

    // σ bands. Which horizon is active is a user toggle and is ALWAYS labelled —
    // the two differ by roughly the weekend, and an unlabelled band is how a
    // screen ends up disagreeing with a broker for an invisible reason.
    const sd = useMemo(() => sdFor(an, sdMode, spot), [an, sdMode, spot]);

    // OI overlay: each chain strike is dropped onto the NEAREST curve x, and
    // only if it lands within one grid step — a strike outside the plotted spot
    // window must not be smeared onto the edge point, which would draw a wall
    // of OI at a price the curve never reaches.
    const { data, maxOi } = useMemo(() => {
        const rows = Array.isArray(chain?.strikes) ? chain.strikes : [];
        if (!showOi || !chartData.length || !rows.length) return { data: chartData, maxOi: 0 };
        const out = chartData.map(p => ({ ...p }));
        const step = out.length > 1 ? (out[out.length - 1].spot - out[0].spot) / (out.length - 1) : 0;
        let m = 0;
        for (const r of rows) {
            const k = num(r?.strike);
            if (k == null) continue;
            let bi = -1, bd = Infinity;
            for (let i = 0; i < out.length; i++) {
                const d = Math.abs(out[i].spot - k);
                if (d < bd) { bd = d; bi = i; }
            }
            if (bi < 0 || (step > 0 && bd > step)) continue;
            const ce = num(r?.ce?.oi), pe = num(r?.pe?.oi);
            if (ce != null) { out[bi].ceOi = ce; if (ce > m) m = ce; }
            if (pe != null) { out[bi].peOi = pe; if (pe > m) m = pe; }
        }
        return { data: out, maxOi: m };
    }, [chartData, chain, showOi]);

    const oiOn = showOi && maxOi > 0;

    if (!chartData.length) {
        return (
            <Empty>
                {loading ? 'analysing…' : err ? 'no curve — fix the error above' : legCount ? 'waiting for the analysis…' : 'add a leg to see the payoff'}
            </Empty>
        );
    }

    return (
        <>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 text-3xs flex-wrap">
                    <span className="text-emerald-300">━ expiry</span>
                    {hasNow && <span className="text-sky-300">┅ now (T+0)</span>}
                    {hasWif && <span className="text-fuchsia-300">┅ what-if</span>}
                    {sd.levels.length > 0 && (
                        <span className="text-violet-300/70">▨ ±1σ/±2σ ({sd.horizon === 'calendar' ? 'calendar' : 'trading-time'})</span>
                    )}
                    {oiOn && <span><span className="text-rose-400">▮</span> call OI <span className="text-emerald-400">▮</span> put OI</span>}
                    <span className="text-sky-300 font-semibold">spot {fmt(spot)}</span>
                    {num(an?.ivUsed) != null && <span className="text-fg-5">IV {fmt(an.ivUsed, 2)}%</span>}
                </span>
                <span className="flex items-center gap-2 text-3xs flex-wrap">
                    <span className="text-fg-6">σ bands</span>
                    {['calendar', 'trading'].map(m => (
                        <button key={m} onClick={() => onSdMode(m)}
                            title={SD_HORIZON_NOTE[m]}
                            className={`px-1.5 py-0.5 rounded border ${sdMode === m
                                ? 'border-violet-600 bg-violet-950/40 text-violet-200'
                                : 'border-line bg-slate-800 text-fg-5 hover:text-fg-3'}`}>{m}</button>
                    ))}
                    <label className="flex items-center gap-1 text-fg-4 ml-1"
                        title="Draw the chain's open interest at each strike on a second axis on the right — where positions are stacked, behind the payoff.">
                        <input type="checkbox" checked={showOi} onChange={e => setShowOi(e.target.checked)} className="accent-rose-500" />
                        OI overlay
                    </label>
                </span>
            </div>

            <ZoomableChart data={data} height={340}>
                <ComposedChart margin={{ top: 10, right: oiOn ? 8 : 64, bottom: 2, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                    {/* σ shading: 2σ first so the denser 1σ band sits on top of it.
                        ifOverflow="hidden" CLIPS — extendDomain would let a 2σ
                        edge outside the plotted window stretch the x-axis and
                        flatten the curve. */}
                    {sd.levels.slice().sort((a, b) => num(b.sd) - num(a.sd)).map(b => (
                        num(b.down) > 0 && num(b.up) > 0 ? (
                            <ReferenceArea key={`sda${b.sd}`} x1={num(b.down)} x2={num(b.up)}
                                fill={ct.mark.region} fillOpacity={num(b.sd) === 1 ? 0.10 : 0.05}
                                stroke={ct.mark.region} strokeOpacity={0.18} ifOverflow="hidden" />
                        ) : null
                    ))}
                    {sd.levels.flatMap(b => ([
                        num(b.down) > 0 ? (
                            <ReferenceLine key={`sdd${b.sd}`} x={num(b.down)} stroke={ct.mark.regionEdge} strokeOpacity={0.5} strokeDasharray="2 4" ifOverflow="hidden"
                                label={{ value: `−${b.sd}σ`, fontSize: ct.type['5xs'], fill: ct.mark.regionEdge, position: 'insideTop' }} />
                        ) : null,
                        num(b.up) > 0 ? (
                            <ReferenceLine key={`sdu${b.sd}`} x={num(b.up)} stroke={ct.mark.regionEdge} strokeOpacity={0.5} strokeDasharray="2 4" ifOverflow="hidden"
                                label={{ value: `+${b.sd}σ`, fontSize: ct.type['5xs'], fill: ct.mark.regionEdge, position: 'insideTop' }} />
                        ) : null,
                    ]))}
                    <XAxis dataKey="spot" type="number" domain={['dataMin', 'dataMax']}
                        tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} ticks={xTicks} />
                    {/* Explicit domain + allowDataOverflow: an unbounded tail is CLIPPED,
                        not framed. See the yDomain comment in StrategyBuilder. */}
                    <YAxis tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} width={58} domain={yDomain} allowDataOverflow
                        tickFormatter={(v) => (Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${Math.round(v)}`)} />
                    {/* Secondary OI axis. Its top is 3× the biggest OI on screen so
                        the bars occupy the bottom third and stay CONTEXT — they are
                        not on the same scale as anything else on this chart. */}
                    {oiOn && (
                        <YAxis yAxisId="oi" orientation="right" width={44} domain={[0, Math.round(maxOi * 3)]}
                            tick={{ fontSize: ct.type['5xs'], fill: ct.text.muted }} tickFormatter={compact} allowDataOverflow />
                    )}
                    <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['2xs'] })}
                        cursor={{ stroke: ct.mark.live, strokeDasharray: '3 3' }}
                        formatter={(v, n) => (n === 'call OI' || n === 'put OI'
                            ? [fmt(v), n]
                            : [rup(v), n === 'now' ? 'P&L now' : n === 'whatif' ? 'P&L what-if' : 'P&L @ expiry'])}
                        labelFormatter={(l) => {
                            // Distance from the LIVE spot, in both points and
                            // percent. A payoff curve is read as "how far would
                            // the index have to move" — an absolute level alone
                            // makes you do that subtraction in your head at every
                            // hover, and the percentage is the half that tells you
                            // whether the move is plausible at all.
                            const at = num(l);
                            if (at == null || !(spot > 0)) return `spot ${fmt(l)}`;
                            const pts = at - spot;
                            const pct = (pts / spot) * 100;
                            if (Math.abs(pts) < 0.5) return `spot ${fmt(at)} · at the money`;
                            const dir = pts > 0 ? '+' : '−';
                            return `spot ${fmt(at)}  ·  ${dir}${fmt(Math.abs(pts), 0)} pts (${dir}${fmt(Math.abs(pct), 2)}%) from ${fmt(spot)}`;
                        }} />
                    <Legend wrapperStyle={{ fontSize: ct.type['4xs'] }} />
                    <ReferenceLine y={0} stroke={ct.axis} ifOverflow="extendDomain" />
                    {strikeMarks.map(k => (
                        <ReferenceLine key={`k${k}`} x={k} stroke={ct.grid} strokeDasharray="2 2" ifOverflow="extendDomain"
                            label={{ value: fmt(k), fontSize: ct.type['5xs'], fill: ct.text.muted, position: 'insideBottom' }} />
                    ))}
                    {(an?.breakevens || []).filter(b => num(b) > 0).map((b, i) => (
                        <ReferenceLine key={`be${i}`} x={b} stroke={ct.status.warning} strokeDasharray="4 3" ifOverflow="extendDomain"
                            label={{ value: `BE ${fmt(b)}`, fontSize: ct.type['5xs'], fill: ct.status.warning, position: 'insideTopRight' }} />
                    ))}
                    {spot > 0 && (
                        <ReferenceLine x={Math.round(spot)} stroke={ct.mark.live} strokeWidth={2} ifOverflow="extendDomain"
                            label={{ value: 'spot', fontSize: ct.type['4xs'], fill: ct.mark.live, position: 'top' }} />
                    )}
                    {hasWif && num(wif?.spot) > 0 && (
                        <ReferenceLine x={Math.round(wif.spot)} stroke={ct.mark.hypothetical} strokeDasharray="4 3" ifOverflow="extendDomain"
                            label={{ value: 'what-if', fontSize: ct.type['5xs'], fill: ct.mark.hypothetical, position: 'insideTopLeft' }} />
                    )}
                    {/* Bars before the lines so the payoff always draws on top. */}
                    {oiOn && <Bar yAxisId="oi" name="call OI" dataKey="ceOi" fill={ct.diverging.negative} fillOpacity={0.35} barSize={5} isAnimationActive={false} />}
                    {oiOn && <Bar yAxisId="oi" name="put OI" dataKey="peOi" fill={ct.diverging.positive} fillOpacity={0.35} barSize={5} isAnimationActive={false} />}
                    <Line type="monotone" name="expiry" dataKey="expiry" stroke={ct.mark.terminal} dot={false} strokeWidth={2} isAnimationActive={false} />
                    {hasNow && <Line type="monotone" name="now" dataKey="now" stroke={ct.mark.live} dot={false} strokeWidth={1.5} strokeDasharray="5 3" isAnimationActive={false} />}
                    {hasWif && <Line type="monotone" name="whatif" dataKey="whatif" stroke={ct.mark.hypothetical} dot={false} strokeWidth={1.5} strokeDasharray="2 3" isAnimationActive={false} />}
                </ComposedChart>
            </ZoomableChart>

            <div className="text-4xs text-fg-6 mt-1 space-y-0.5">
                <div>
                    The vertical scale is framed on the decision region (breakevens, ±1σ, finite extremes). A structure with an uncovered short keeps falling past the bottom of this frame — that tail is real, it is simply not drawn, which is why max loss reads UNBOUNDED rather than the deepest number on screen.
                    {!hasNow && <span className="text-fg-5"> No T+0 curve — IV could not be established for these legs.</span>}
                </div>
                {sd.levels.length > 0 && (
                    <div>
                        σ bands are on the <span className="text-violet-300">{sd.horizon === 'calendar' ? 'CALENDAR' : 'TRADING-TIME'}</span> horizon — {SD_HORIZON_NOTE[sd.horizon]}.
                        {sd.horizon !== sdMode && <span className="text-amber-400/80"> ({sdMode} was unavailable, so the other horizon is shown)</span>}
                        {' '}±1σ {fmt(sd.levels.find(b => num(b.sd) === 1)?.points)} pts. Charges are excluded — this whole panel is gross, {fmt(lots)} lot(s).
                    </div>
                )}
                {oiOn && (
                    <div>
                        Open interest is drawn on the right-hand axis at each strike from the chain above — contracts outstanding, not volume. It is chain data, NOT part of the payoff: the two axes share nothing but the spot scale.
                    </div>
                )}
            </div>
        </>
    );
}

// ── P&L TABLE ────────────────────────────────────────────────────────────────
function PnlTablePanel({ pnlTable, an, loading }) {
    const ct = useChartTheme();
    const t = pnlTable;
    const cells = useMemo(() => (Array.isArray(t?.cells) ? t.cells : []), [t]);
    const dates = Array.isArray(t?.dates) ? t.dates : [];
    const refSpot = num(t?.atSpot);   // the live spot the grid was built around
    const days = Array.isArray(t?.days) ? t.days : [];

    // One scale for the whole grid, so a cell's colour means the same thing in
    // every row and column.
    const maxAbs = useMemo(() => {
        let m = 0;
        for (const c of cells) for (const v of (c.pnl || [])) { const n = num(v); if (n != null && Math.abs(n) > m) m = Math.abs(n); }
        return m;
    }, [cells]);

    const atIdx = useMemo(() => {
        const s = num(t?.atSpot);
        if (s == null || !cells.length) return -1;
        let bi = -1, bd = Infinity;
        cells.forEach((c, i) => { const d = Math.abs((num(c.spot) ?? 0) - s); if (d < bd) { bd = d; bi = i; } });
        return bi;
    }, [cells, t]);

    if (!cells.length) {
        return <Empty>{loading ? 'analysing…' : 'No P&L table — it needs an implied volatility and a nearest expiry (supply an IV override above).'}</Empty>;
    }

    const heat = (v) => {
        const n = num(v);
        if (n == null || maxAbs <= 0) return undefined;
        const a = Math.min(0.55, 0.05 + (Math.abs(n) / maxAbs) * 0.5);
        // status.good / status.critical rather than the diverging pair: these
        // cells sit under `text-emerald-100` / `text-red-100` ink, so the fill
        // and the number have to agree on which side of zero they are.
        return { backgroundColor: ct.alpha(n >= 0 ? ct.status.good : ct.status.critical, a) };
    };

    return (
        <>
            <div className="overflow-x-auto rounded border border-line-0">
                <table className="w-full text-3xs font-mono">
                    <thead className="bg-slate-900">
                        <tr className="text-fg-5 text-4xs">
                            <th className="font-normal text-left px-2 py-1 sticky left-0 bg-slate-900">spot ＼ date</th>
                            {dates.map((d, i) => (
                                <th key={d + i} className="font-normal px-1.5 py-1 whitespace-nowrap">
                                    <div className="text-fg-3">{shortDate(d)}</div>
                                    <div className="text-fg-6">
                                        T+{fmt(days[i], 1)}
                                        {i === dates.length - 1 ? ' · expiry' : ''}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {cells.map((c, ri) => {
                            // The at-spot row is marked with cell borders rather than a ring
                            // on the <tr>: Tailwind's preflight collapses table borders, and a
                            // box-shadow ring on a collapsed row does not paint.
                            const atRow = ri === atIdx;
                            const edge = atRow ? 'border-y border-sky-400/60' : '';
                            return (
                                <tr key={c.spot}>
                                    <td className={`px-2 py-0.5 sticky left-0 whitespace-nowrap ${edge} ${atRow ? 'bg-slate-700/70 text-sky-200 font-semibold' : 'bg-slate-900 text-fg-4'}`}>
                                        {fmt(c.spot)}{atRow ? ' ◀ spot' : ''}
                                        {/* the move this row represents — the grid is
                                            read as "what if the index moves X%", so the
                                            level alone makes you subtract at every row */}
                                        {!atRow && refSpot > 0 && num(c.spot) != null && (
                                            <span className="text-fg-6 ml-1">
                                                {num(c.spot) > refSpot ? '+' : '−'}{fmt(Math.abs((num(c.spot) - refSpot) / refSpot) * 100, 1)}%
                                            </span>
                                        )}
                                    </td>
                                    {(c.pnl || []).map((v, ci) => {
                                        const n = num(v);
                                        return (
                                            <td key={ci} style={heat(v)}
                                                className={`px-1.5 py-0.5 text-right whitespace-nowrap ${edge} ${n == null ? 'text-fg-6' : n >= 0 ? 'text-emerald-100' : 'text-red-100'}`}
                                                title={`spot ${fmt(c.spot)} on ${dates[ci] || '—'} — ${rup(v)} gross`}>
                                                {rup(v)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="text-4xs text-fg-6 mt-1.5 space-y-0.5">
                <div>
                    Rupees, gross, for the whole structure. Rows span ±2σ of the move being priced; the highlighted row is today&apos;s spot ({fmt(t.atSpot)}).
                </div>
                <div>
                    Two adjacent columns reading almost the same across a weekend is EXPECTED, not a bug: options decay on trading time, so a Saturday and a Sunday age the position barely at all even though the calendar advances two days.
                </div>
                {num(an?.ivUsed) != null && <div>Every cell is re-priced at a flat {fmt(an.ivUsed, 2)}% IV — a real vol move would shift the whole grid.</div>}
            </div>
        </>
    );
}

// ── PER-LEG GREEKS ───────────────────────────────────────────────────────────
function GreeksPanel({ an, lotSize, lots, loading }) {
    // Both OFF by default = per single unit, exactly as a chain quotes them.
    // Ticking them multiplies through to what the POSITION actually carries.
    // Keeping them separate matters: ×lot size answers "per lot", ×lots answers
    // "for this order", and the two get confused constantly.
    const [byLotSize, setByLotSize] = useState(false);
    const [byLots, setByLots] = useState(false);
    const rows = useMemo(() => (Array.isArray(an?.perLeg) ? an.perLeg : []), [an]);
    const f = (byLotSize ? (num(lotSize) || 1) : 1) * (byLots ? (num(lots) || 1) : 1);

    const totals = useMemo(() => {
        const t = { delta: 0, gamma: 0, vega: 0, theta: 0, any: false };
        for (const l of rows) {
            const g = l?.greeks;
            if (!g) continue;
            t.any = true;
            t.delta += num(g.delta) || 0;
            t.gamma += num(g.gamma) || 0;
            t.vega += num(g.vega) || 0;
            t.theta += num(g.theta) || 0;
        }
        return t;
    }, [rows]);

    if (!rows.length) return <Empty>{loading ? 'analysing…' : 'no analysis yet'}</Empty>;

    // Per-unit greeks are tiny; scaled ones are not. Digits follow the scale so
    // a delta never renders as "0.00" or as "18.4372910".
    const dDelta = f === 1 ? 3 : 1;
    const dGamma = f === 1 ? 5 : 4;
    const missing = rows.filter(l => !l?.greeks).length;
    const scaleNote = f === 1 ? 'per unit' : `× ${fmt(f)} (${byLotSize ? `lot ${fmt(lotSize)}` : ''}${byLotSize && byLots ? ' × ' : ''}${byLots ? `${fmt(lots)} lots` : ''})`;

    return (
        <>
            <div className="flex items-center gap-3 flex-wrap mb-2 text-3xs">
                <label className="flex items-center gap-1 text-fg-4" title={`Multiply every greek by the lot size (${fmt(lotSize)} units per lot).`}>
                    <input type="checkbox" checked={byLotSize} onChange={e => setByLotSize(e.target.checked)} className="accent-sky-500" />
                    × lot size ({fmt(lotSize)})
                </label>
                <label className="flex items-center gap-1 text-fg-4" title={`Multiply every greek by the number of lots (${fmt(lots)}).`}>
                    <input type="checkbox" checked={byLots} onChange={e => setByLots(e.target.checked)} className="accent-sky-500" />
                    × lots ({fmt(lots)})
                </label>
                <span className="text-fg-6">showing <span className="text-fg-4">{scaleNote}</span></span>
                {missing > 0 && <span className="text-amber-400/80">{missing} leg(s) could not be priced for greeks</span>}
            </div>

            <div className="overflow-x-auto rounded border border-line-0">
                <table className="w-full text-3xs font-mono">
                    <thead className="bg-slate-900 text-fg-5 text-4xs">
                        <tr>
                            <th className="font-normal text-left px-2 py-1">leg</th>
                            <th className="font-normal px-1">strike</th>
                            <th className="font-normal px-1">IV %</th>
                            <th className="font-normal px-1" title="Days to this leg's expiry, on the trading-time clock the pricing used.">DTE</th>
                            <th className="font-normal px-1">delta<Help k="delta" /></th>
                            <th className="font-normal px-1">gamma<Help k="gamma" /></th>
                            <th className="font-normal px-1" title="Per IV point.">vega<Help k="vega" /></th>
                            <th className="font-normal px-1" title="Per calendar day.">theta<Help k="theta" /></th>
                            <th className="font-normal px-1" title="The part of the premium the market has already taken — it cannot decay away.">intrinsic /u</th>
                            <th className="font-normal px-1" title="The whole of what a seller is being paid to wait for — this is what decays.">time val /u</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((l, i) => {
                            const g = l?.greeks || null;
                            return (
                                <tr key={`${l.type}${l.strike}${i}`} className="border-t border-line-0/60">
                                    <td className="px-2 py-0.5 whitespace-nowrap">
                                        <span className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action}</span>
                                        {num(l.ratio) > 1 ? <span className="text-fg-4"> {fmt(l.ratio)}×</span> : null}
                                        <span className={l.type === 'CE' ? ' text-sky-300' : ' text-violet-300'}> {l.type}</span>
                                    </td>
                                    <td className="px-1 text-center text-fg-3">{fmt(l.strike)}</td>
                                    <td className="px-1 text-center text-fg-5">{num(l.iv) != null ? fmt(l.iv, 2) : '—'}</td>
                                    <td className="px-1 text-center text-fg-5">{num(l.dte) != null ? fmt(l.dte, 2) : '—'}</td>
                                    <td className={`px-1 text-right ${num(g?.delta) > 0 ? 'text-emerald-300' : num(g?.delta) < 0 ? 'text-red-300' : 'text-fg-5'}`}>
                                        {g ? sgnNum(num(g.delta) * f, dDelta) : '—'}
                                    </td>
                                    <td className="px-1 text-right text-fg-4">{g && num(g.gamma) != null ? sgnNum(num(g.gamma) * f, dGamma) : '—'}</td>
                                    <td className={`px-1 text-right ${num(g?.vega) > 0 ? 'text-emerald-300' : num(g?.vega) < 0 ? 'text-red-300' : 'text-fg-5'}`}>
                                        {g ? sgnNum(num(g.vega) * f, 2) : '—'}
                                    </td>
                                    <td className={`px-1 text-right ${num(g?.theta) > 0 ? 'text-emerald-300' : num(g?.theta) < 0 ? 'text-red-300' : 'text-fg-5'}`}>
                                        {g ? sgnNum(num(g.theta) * f, 2) : '—'}
                                    </td>
                                    <td className="px-1 text-right text-fg-4">{num(l.intrinsicUnit) != null ? fmt(l.intrinsicUnit, 2) : '—'}</td>
                                    <td className="px-1 text-right text-fg-4">{num(l.timeValueUnit) != null ? fmt(l.timeValueUnit, 2) : '—'}</td>
                                </tr>
                            );
                        })}
                        <tr className="border-t border-line bg-slate-800/40 font-semibold">
                            <td className="px-2 py-1 text-fg-2">TOTAL</td>
                            <td className="px-1" />
                            <td className="px-1" />
                            <td className="px-1" />
                            <td className={`px-1 text-right ${totals.delta > 0 ? 'text-emerald-300' : totals.delta < 0 ? 'text-red-300' : 'text-fg-3'}`}>
                                {totals.any ? sgnNum(totals.delta * f, dDelta) : '—'}
                            </td>
                            <td className="px-1 text-right text-fg-3">{totals.any ? sgnNum(totals.gamma * f, dGamma) : '—'}</td>
                            <td className={`px-1 text-right ${totals.vega > 0 ? 'text-emerald-300' : totals.vega < 0 ? 'text-red-300' : 'text-fg-3'}`}>
                                {totals.any ? sgnNum(totals.vega * f, 2) : '—'}
                            </td>
                            <td className={`px-1 text-right ${totals.theta > 0 ? 'text-emerald-300' : totals.theta < 0 ? 'text-red-300' : 'text-fg-3'}`}>
                                {totals.any ? sgnNum(totals.theta * f, 2) : '—'}
                            </td>
                            <td className="px-1 text-right text-fg-3">{num(an?.intrinsicUnit) != null ? sgnNum(an.intrinsicUnit, 2) : '—'}</td>
                            <td className="px-1 text-right text-fg-3">{num(an?.timeValueUnit) != null ? sgnNum(an.timeValueUnit, 2) : '—'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div className="text-4xs text-fg-6 mt-1.5 space-y-0.5">
                <div>
                    Each row is already signed by BUY/SELL and multiplied by that leg&apos;s ratio, so the TOTAL is the book — a sold call shows a NEGATIVE delta here even though a call&apos;s delta is positive.
                </div>
                <div>
                    Per-leg IV is backed out of that leg&apos;s own premium, so the smile is respected and the strikes will not all read the same number.
                    Intrinsic and time value are always per unit (they are premium, not greeks) and are signed by position on the TOTAL row.
                </div>
                <div>
                    With both boxes ticked these match the book Greeks card below, which is always reported for the full position in rupees.
                </div>
            </div>
        </>
    );
}

// ── RESOLVED LEGS ────────────────────────────────────────────────────────────
function LegsPanel({ an, resp, loading }) {
    // perLeg carries everything the priced leg had PLUS the intrinsic/time split,
    // so prefer it; resp.legs is the fallback when the analysis failed to run
    // its per-leg pass but the pricing still came back.
    const rows = Array.isArray(an?.perLeg) && an.perLeg.length ? an.perLeg
        : Array.isArray(resp?.legs) ? resp.legs : [];
    if (!rows.length) return <Empty>{loading ? 'analysing…' : 'no legs priced yet'}</Empty>;

    return (
        <>
            <div className="overflow-x-auto rounded border border-line-0">
                <table className="w-full text-3xs font-mono">
                    <thead className="bg-slate-900 text-fg-5 text-4xs">
                        <tr>
                            <th className="font-normal text-left px-2 py-1">broker symbol</th>
                            <th className="font-normal px-1">leg</th>
                            <th className="font-normal px-1">expiry</th>
                            <th className="font-normal px-1">premium</th>
                            <th className="font-normal px-1" title="Where that premium came from: the mid of a two-sided quote, the last traded price, or a price you pinned.">source</th>
                            <th className="font-normal px-1">bid / ask</th>
                            <th className="font-normal px-1">intrinsic /u</th>
                            <th className="font-normal px-1">time val /u</th>
                            <th className="font-normal px-1">IV %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((l, i) => (
                            <tr key={`${l.symbol || l.strike}-${i}`} className="border-t border-line-0/60">
                                <td className="px-2 py-0.5 text-fg-4 whitespace-nowrap">{l.symbol || '—'}</td>
                                <td className="px-1 text-center whitespace-nowrap">
                                    <span className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action}</span>
                                    {num(l.ratio) > 1 ? <span className="text-fg-4"> {fmt(l.ratio)}×</span> : null}
                                    <span className={l.type === 'CE' ? ' text-sky-300' : ' text-violet-300'}> {l.type}</span>
                                    <span className="text-fg-3"> {fmt(l.strike)}</span>
                                </td>
                                <td className="px-1 text-center text-fg-5">{l.expiry || '—'}</td>
                                <td className="px-1 text-right text-fg-2">{num(l.premium) != null ? `₹${fmt(l.premium, 2)}` : '—'}</td>
                                <td className={`px-1 text-center ${l.premiumSource === 'user' ? 'text-amber-400' : l.premiumSource === 'mid' ? 'text-emerald-400' : 'text-sky-400'}`}
                                    title={l.premiumSource === 'user' ? 'you pinned this price' : l.premiumSource === 'mid' ? 'mid of the live bid/ask' : 'last traded price — no two-sided quote'}>
                                    {l.premiumSource || '—'}
                                </td>
                                <td className="px-1 text-center text-fg-5">
                                    {num(l.bid) != null || num(l.ask) != null ? `${fmt(l.bid, 2)} / ${fmt(l.ask, 2)}` : '—'}
                                </td>
                                <td className="px-1 text-right text-fg-4">{num(l.intrinsicUnit) != null ? fmt(l.intrinsicUnit, 2) : '—'}</td>
                                <td className="px-1 text-right text-fg-4">{num(l.timeValueUnit) != null ? fmt(l.timeValueUnit, 2) : '—'}</td>
                                <td className="px-1 text-center text-fg-5">{num(l.iv) != null ? fmt(l.iv, 2) : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="text-4xs text-fg-6 mt-1.5">
                A <span className="text-emerald-400">mid</span> premium is the midpoint of a live two-sided quote; <span className="text-sky-400">ltp</span> means no two-sided quote existed and the last trade was used, which can be stale;
                <span className="text-amber-400"> user</span> means you pinned it and the market is being ignored for that leg.
                {num(an?.timeValueUnit) != null && (
                    <> Book split: intrinsic {sgnNum(an.intrinsicUnit, 2)}/u · time value {sgnNum(an.timeValueUnit, 2)}/u — both signed by position, so a net seller shows a positive time value (the decay works for you).</>
                )}
            </div>
        </>
    );
}
