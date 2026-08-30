import React, { useMemo } from 'react';
import { num, fmt, sgnNum, shortSym } from './builderFormat';

/**
 * CHAIN LADDER — the strike picker, in three readings of the same rows.
 *
 * LTP    bid/ask, half-spread and the traded price      (what it costs)
 * OI     open interest with proportional bars, change, volume   (where the sellers are)
 * GREEKS gamma / vega / theta per side                  (what it will do)
 *
 * Three things are deliberately CONSTANT across all three modes:
 *   • the strike column stays in the middle,
 *   • the IV column stays immediately beside it on both sides,
 *   • delta is shown on BOTH sides in EVERY mode — it is the single most-read
 *     number on a chain (it doubles as the market's own odds that the strike
 *     expires in the money), so hiding it behind a tab would be wrong.
 * Only the outer columns change, which keeps the eye anchored when switching.
 */

// Columns OUTSIDE the delta/price/IV core, listed outermost-first for the CALL
// side. The put side renders the same list reversed, so the table is a mirror
// image about the strike column — the layout every options platform uses.
// OI APPEARS IN EVERY VIEW. It was originally confined to the 'OI' view, which
// meant the default (LTP) ladder had no bars at all — and the bars are the whole
// reason to look at a chain rather than a price list: they show at a glance
// where sellers are stacked. Every platform keeps OI beside the price for that
// reason. The dedicated OI view still adds change and volume alongside it.
// The OI column carries a real width share in all three: a proportional bar
// squeezed into an auto-sized numeric column is unreadable, which defeats it.
const OI_COL = { key: 'oi', label: 'OI', w: 'w-[15%]' };
const VIEW_COLS = {
    ltp: [{ key: 'bidask', label: 'bid/ask' }, { key: 'sp', label: '½sp' }, OI_COL],
    oi: [{ ...OI_COL, w: 'w-[19%]' }, { key: 'oichg', label: 'chg' }, { key: 'vol', label: 'vol' }],
    greeks: [{ key: 'gamma', label: 'γ' }, { key: 'vega', label: 'vega' }, OI_COL],
};
const VIEW_LABEL = { ltp: 'LTP', oi: 'OI', greeks: 'Greeks' };

/**
 * One OI cell: the figure sitting on top of a proportional bar.
 *
 * Calls grow right-to-left and puts left-to-right, so both bars grow AWAY from
 * the strike column and the pair reads as one mirrored histogram.
 *
 * Two clamps, both deliberate:
 *   • a 4% floor, so a small-but-real figure still draws a visible sliver — a
 *     bar that vanishes reads as "no data", which is a different statement;
 *   • a 100% ceiling plus overflow-hidden, so the largest bar fills its own
 *     cell exactly and can never bleed into the strike column.
 */
function OiCell({ value, side, max }) {
    const n = num(value);
    const w = (n != null && n > 0 && max > 0) ? Math.min(100, Math.max(4, (n / max) * 100)) : 0;
    const call = side === 'CE';
    return (
        <td className="p-0">
            <div className="relative h-4 overflow-hidden">
                {w > 0 && (
                    <div
                        className={`absolute top-0 bottom-0 ${call
                            ? 'right-0 bg-rose-500/25 border-r-2 border-rose-500/70'
                            : 'left-0 bg-emerald-500/25 border-l-2 border-emerald-500/70'}`}
                        style={{ width: `${w}%` }}
                    />
                )}
                <span className={`relative z-10 block px-1 leading-4 ${call ? 'text-right' : 'text-left'} ${n > 0 ? 'text-fg-2' : 'text-fg-6'}`}>
                    {fmt(n)}
                </span>
            </div>
        </td>
    );
}

/** OI change — a small signed figure. Green = contracts added, red = unwound. */
function ChgCell({ value }) {
    const n = num(value);
    return (
        <td className={`text-center text-4xs ${n == null || n === 0 ? 'text-fg-6' : n > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`}
        </td>
    );
}

export default function ChainLadder({
    chain, chainLoading, chainErr, symbol, legs = [], view, onView,
    activeLegId, hasActiveLeg, onClearActive, pickAction, onPickAction,
    count, onCount, onPick, atmRowRef,
}) {
    const cols = VIEW_COLS[view] || VIEW_COLS.ltp;
    const perSide = cols.length + 3;              // extras + delta + price + IV

    // Bars are scaled to the largest OI VISIBLE in the ladder (not to some
    // all-time maximum), so widening the ±count re-scales every bar together
    // and the tallest row is always full-width.
    const maxOi = useMemo(() => {
        let m = 0;
        for (const r of chain?.strikes || []) {
            const c = num(r?.ce?.oi), p = num(r?.pe?.oi);
            if (c != null && c > m) m = c;
            if (p != null && p > m) m = p;
        }
        return m;
    }, [chain]);

    const extraCell = (key, side, d, k) => {
        switch (key) {
            case 'bidask':
                return (
                    <td key={key} className="text-center text-4xs text-fg-5">
                        {num(d.bid) != null || num(d.ask) != null ? `${fmt(d.bid, 2)}/${fmt(d.ask, 2)}` : '—'}
                    </td>
                );
            case 'sp':
                return (
                    <td key={key} className={`text-center ${num(d.halfSpreadPct) > 2 ? 'text-red-400' : 'text-fg-6'}`}>
                        {num(d.halfSpreadPct) != null ? `${fmt(d.halfSpreadPct, 1)}%` : '—'}
                    </td>
                );
            case 'oi':
                return <OiCell key={key} value={d.oi} side={side} max={maxOi} />;
            case 'oichg':
                return <ChgCell key={key} value={d.oiChg} />;
            case 'vol':
                return <td key={key} className="text-center text-fg-5">{fmt(d.vol)}</td>;
            case 'gamma':
                return <td key={key} className="text-center text-fg-5">{num(d.gamma) != null ? fmt(d.gamma, 4) : '—'}</td>;
            case 'vega':
                return <td key={key} className="text-center text-fg-5">{num(d.vega) != null ? fmt(d.vega, 2) : '—'}</td>;
            case 'theta':
                return <td key={key} className="text-center text-fg-5">{num(d.theta) != null ? fmt(d.theta, 2) : '—'}</td>;
            default:
                return <td key={`${key}-${k}`} />;
        }
    };

    // Delta doubles as the market's own probability that the strike finishes in
    // the money — worth saying out loud in the tooltip, since that is the whole
    // reason "sell the 0.2 delta" is a sentence.
    const deltaCell = (d, side) => {
        const dv = num(d.delta);
        return (
            <td className={`text-center ${dv == null ? 'text-fg-6' : side === 'CE' ? 'text-sky-300/80' : 'text-violet-300/80'}`}
                title={dv == null ? 'delta not available for this strike' : `delta ${dv} — the market is pricing roughly a ${Math.round(Math.abs(dv) * 100)}% chance this strike finishes in the money`}>
                {dv == null ? '—' : sgnNum(dv, 2)}
            </td>
        );
    };

    return (
        <div className="bg-surface rounded-xl border border-line p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <span className="text-sm font-semibold text-fg">Chain — {shortSym(symbol)} {chain?.expiry || ''}</span>
                <div className="flex items-center gap-1.5 text-3xs">
                    <span className="text-fg-5">click a cell to</span>
                    {hasActiveLeg ? (
                        <>
                            <span className="px-1.5 py-0.5 rounded border border-primary/50 bg-primary/15 text-primary-ink">retarget selected leg</span>
                            <button onClick={onClearActive} className="text-fg-5 hover:text-fg-3">×</button>
                        </>
                    ) : (
                        <>
                            <span className="text-fg-5">add</span>
                            {['BUY', 'SELL'].map(a => (
                                <button key={a} onClick={() => onPickAction(a)}
                                    className={`px-1.5 py-0.5 rounded border ${pickAction === a
                                        ? (a === 'BUY' ? 'border-emerald-600 bg-emerald-950/40 text-emerald-300' : 'border-red-600 bg-red-950/40 text-red-300')
                                        : 'border-line bg-slate-800 text-fg-5'}`}>{a}</button>
                            ))}
                        </>
                    )}
                    <select value={count} onChange={e => onCount(num(e.target.value) || 12)}
                        className="bg-slate-800 border border-line rounded px-1 py-0.5 text-fg-3 ml-1" title="Strikes each side of ATM">
                        {[6, 12, 20, 30].map(c => <option key={c} value={c}>±{c}</option>)}
                    </select>
                </div>
            </div>

            {/* VIEW TOGGLE — the same rows, three readings. */}
            <div className="flex items-center gap-1 mb-1.5 text-3xs">
                <span className="text-fg-6 mr-1">view</span>
                {Object.keys(VIEW_COLS).map(v => (
                    <button key={v} onClick={() => onView(v)}
                        title={v === 'ltp' ? 'Prices: bid/ask, half-spread and the traded price'
                            : v === 'oi' ? 'Open interest with proportional bars, change and volume — where positions are stacked'
                                : 'Per-strike greeks: gamma, vega and theta'}
                        className={`px-2 py-0.5 rounded border ${view === v
                            ? 'border-primary/60 bg-primary/15 text-primary-ink'
                            : 'border-line bg-slate-800 text-fg-5 hover:text-fg-3'}`}>
                        {VIEW_LABEL[v]}
                    </button>
                ))}
                <span className="text-fg-6 ml-1">· strike, IV and delta stay put in every view</span>
            </div>

            {!chain ? (
                <div className="text-2xs text-fg-5 py-10 text-center">{chainLoading ? 'loading chain…' : chainErr ? 'chain unavailable — type strikes into the legs by hand' : 'no chain'}</div>
            ) : (
                <>
                    <div className="max-h-[26rem] overflow-y-auto overflow-x-auto rounded border border-line-0">
                        <table className="w-full min-w-[34rem] text-3xs font-mono">
                            <thead className="sticky top-0 bg-slate-900 z-10">
                                <tr className="text-fg-5">
                                    <th className="py-1 font-normal text-sky-400/80" colSpan={perSide}>CALLS</th>
                                    <th className="py-1 font-normal">strike</th>
                                    <th className="py-1 font-normal text-violet-400/80" colSpan={perSide}>PUTS</th>
                                </tr>
                                <tr className="text-fg-6 text-4xs border-b border-line-0">
                                    {cols.map(c => <th key={`c-${c.key}`} className={`font-normal ${c.w || ''}`}>{c.label}</th>)}
                                    <th className="font-normal">Δ</th>
                                    <th className="font-normal text-right pr-1">LTP</th>
                                    <th className="font-normal">IV</th>
                                    <th className="font-normal"> </th>
                                    <th className="font-normal">IV</th>
                                    <th className="font-normal text-left pl-1">LTP</th>
                                    <th className="font-normal">Δ</th>
                                    {[...cols].reverse().map(c => <th key={`p-${c.key}`} className={`font-normal ${c.w || ''}`}>{c.label}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {(chain.strikes || []).map(row => {
                                    const k = row.strike;
                                    const isAtm = k === chain.atm;
                                    const isPain = num(chain.maxPain) != null && k === chain.maxPain;
                                    const ceWall = num(chain.ceWall?.strike) === k;
                                    const peWall = num(chain.peWall?.strike) === k;
                                    const legHere = (t) => legs.find(l => num(l.strike) === k && l.type === t);
                                    const ce = row.ce || {}, pe = row.pe || {};
                                    /*
                                     * A selected leg used to be marked with `ring-1 ring-emerald-600/70`
                                     * — a single semi-transparent pixel around a cell that already sits on
                                     * a tinted background. In a 40-row ladder of near-identical numbers
                                     * that is close to invisible, and worse on the light themes, where a
                                     * 70%-opacity mid ring over a pale tint has almost no contrast.
                                     *
                                     * A selected leg is the single most important thing on this table, so
                                     * it now carries FOUR redundant cues instead of one: a solid 2px ring,
                                     * a filled tint, bold high-contrast ink, and a B/S badge that also
                                     * states the ratio. Colour is never the only channel — the badge still
                                     * reads correctly in greyscale and under colour-vision deficiency,
                                     * which the old red/green-only ring did not.
                                     *
                                     * The ACTIVE leg (the one a click will retarget) gets a further
                                     * primary-coloured outline. That state was passed into this component
                                     * and never drawn, so while retargeting there was no way to tell which
                                     * of several legs was about to move.
                                     */
                                    const legStyle = (t) => {
                                        const lg = legHere(t);
                                        if (!lg) return { cls: '', badge: null };
                                        const buy = lg.action === 'BUY';
                                        const active = activeLegId && lg.id === activeLegId;
                                        const ratio = num(lg.ratio);
                                        return {
                                            cls: [
                                                'ring-2 font-bold text-fg',
                                                buy ? 'ring-emerald-500 bg-emerald-500/25' : 'ring-rose-500 bg-rose-500/25',
                                                // outline sits OUTSIDE the ring, so both read at once
                                                active ? 'outline-2 outline-offset-1 outline-primary' : '',
                                            ].join(' '),
                                            badge: (
                                                <span
                                                    /* Ink-on-TINT, not ink-on-solid. A solid `bg-{hue}-500`
                                                       with `text-bg` measured 2.83:1 on nord and failed AA on
                                                       7 of the 12 themes — the mid accent band is simply too
                                                       close in lightness to either ink. The 900-tint + 100-ink
                                                       pair is one the ramp explicitly gates, and it measures
                                                       12.1–16.1:1 across every theme. The 500 ring keeps the
                                                       badge crisp against the cell's own tint. */
                                                    className={`inline-flex items-center rounded-xs px-1 text-5xs font-black leading-none ring-1 ${
                                                        buy ? 'bg-emerald-900 text-emerald-100 ring-emerald-500'
                                                            : 'bg-rose-900 text-rose-100 ring-rose-500'}`}
                                                    title={`${lg.action} ${lg.type} ${fmt(k)}${ratio > 1 ? ` ×${ratio}` : ''}${active ? ' — active leg' : ''}`}
                                                >
                                                    {buy ? 'B' : 'S'}{ratio > 1 ? `×${ratio}` : ''}
                                                </span>
                                            ),
                                        };
                                    };
                                    const priceBtn = (d, t) => {
                                        const { cls, badge } = legStyle(t);
                                        return (
                                        <td className="p-0.5">
                                            <button onClick={() => onPick(k, t)}
                                                title={`${d.symbol || ''}\nbid ${fmt(d.bid, 2)} / ask ${fmt(d.ask, 2)} · mid ${fmt(d.mid, 2)} · OI ${fmt(d.oi)} · OI chg ${fmt(d.oiChg)} · vol ${fmt(d.vol)}`}
                                                className={`w-full flex items-center gap-1 ${t === 'CE' ? 'justify-end flex-row-reverse' : 'justify-end'} px-1 py-0.5 rounded ${cls || (t === 'CE'
                                                    ? 'bg-sky-950/30 hover:bg-sky-900/50 text-sky-200'
                                                    : 'bg-violet-950/30 hover:bg-violet-900/50 text-violet-200')}`}>
                                                {badge}
                                                <span>{num(d.ltp) != null ? fmt(d.ltp, 2) : num(d.mid) != null ? fmt(d.mid, 2) : '—'}</span>
                                            </button>
                                        </td>
                                        );
                                    };
                                    const ivCell = (d) => (
                                        <td className="text-center text-fg-5">{num(d.iv) != null ? fmt(d.iv, 1) : '—'}</td>
                                    );
                                    return (
                                        <tr key={k} ref={isAtm ? atmRowRef : null}
                                            className={`border-b border-line-0/60 ${
                                                // A strike carrying any leg is tinted across the whole row,
                                                // so it can be found while scrolling without reading cells.
                                                (legHere('CE') || legHere('PE')) ? 'bg-primary/10'
                                                    : isAtm ? 'bg-slate-700/40' : 'hover:bg-slate-800/40'}`}>
                                            {cols.map(c => extraCell(c.key, 'CE', ce, k))}
                                            {deltaCell(ce, 'CE')}
                                            {priceBtn(ce, 'CE')}
                                            {ivCell(ce)}
                                            <td className={`text-center px-1 ${isAtm ? 'text-fg font-bold' : 'text-fg-3'}`}>
                                                {fmt(k)}
                                                <div className="text-5xs leading-none text-fg-5">
                                                    {/* How far this strike sits from spot. The API already
                                                        returns distancePct and it was going unused — "is
                                                        this 1% or 4% away" is the question that decides
                                                        whether a strike is worth selling, and reading it
                                                        off the strike number means subtracting every row. */}
                                                    {!isAtm && num(row.distancePct) != null
                                                        ? <span>{row.distancePct > 0 ? '+' : '−'}{fmt(Math.abs(row.distancePct), 1)}%</span>
                                                        : null}
                                                    {isAtm ? <span className="text-primary">ATM</span> : null}
                                                    {isPain ? <span className="text-amber-400"> ⊙MP</span> : null}
                                                    {ceWall ? <span className="text-sky-400"> ▲CE</span> : null}
                                                    {peWall ? <span className="text-violet-400"> ▼PE</span> : null}
                                                </div>
                                            </td>
                                            {ivCell(pe)}
                                            {priceBtn(pe, 'PE')}
                                            {deltaCell(pe, 'PE')}
                                            {[...cols].reverse().map(c => extraCell(c.key, 'PE', pe, k))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="text-4xs text-fg-6 mt-1.5 flex flex-wrap gap-x-3">
                        <span><span className="text-primary">ATM</span> at-the-money</span>
                        {num(chain.maxPain) != null && <span><span className="text-amber-400">⊙MP</span> max pain {fmt(chain.maxPain)}</span>}
                        {chain.ceWall && <span><span className="text-sky-400">▲CE</span> call wall {fmt(chain.ceWall.strike)} ({fmt(chain.ceWall.oi)} OI)</span>}
                        {chain.peWall && <span><span className="text-violet-400">▼PE</span> put wall {fmt(chain.peWall.strike)} ({fmt(chain.peWall.oi)} OI)</span>}
                        {/* the bars are in every view now; `chg` is only in the OI view */}
                        <span><span className="text-rose-400">▬</span> call OI · <span className="text-emerald-400">▬</span> put OI — both scaled to the biggest OI on screen ({fmt(maxOi)})</span>
                        {view === 'oi' && <span>chg = contracts added (+) or unwound (−) since the session opened</span>}
                        <span><span className="inline-flex items-center rounded-xs px-1 text-5xs font-black leading-none ring-1 bg-emerald-900 text-emerald-100 ring-emerald-500">B</span> bought leg · <span className="inline-flex items-center rounded-xs px-1 text-5xs font-black leading-none ring-1 bg-rose-900 text-rose-100 ring-rose-500">S</span> sold leg — ×n is the ratio; the row is tinted and the active leg is outlined</span>
                        <span>Δ ≈ the market&apos;s odds the strike expires in the money</span>
                        <span>ring = a leg sits here (green buy / red sell)</span>
                        <span className="text-fg-6">
                            source: {chain.source === 'archive' ? 'archived snapshot'
                                : chain.source === 'broker' ? 'live broker chain' : 'none'}
                            {chain.brokerFallback ? ' (broker fallback)' : ''}
                        </span>
                        {activeLegId ? <span className="text-primary/70">a click retargets the selected leg</span> : null}
                    </div>
                </>
            )}
        </div>
    );
}
