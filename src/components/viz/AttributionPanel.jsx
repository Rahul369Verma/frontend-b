import React, { useMemo, useState } from 'react';
import {
    Card, StatTile, StatRow, Waterfall, DivergingBars, DataTable,
    Findings, StatusBadge, Placeholder,
} from './primitives';
import { inr, num, DIVERGING } from './tokens';

/**
 * P&L attribution + transaction-cost analysis.
 *
 * Shared by the live Risk page (realised trades) and the Backtest page
 * (simulated trades) — the backend produces the same
 * `logic/analytics/attribution.js` summarize() shape for both, so one panel
 * renders either. That is deliberate: seeing the SAME decomposition before and
 * after deployment is the whole point, and two panels would drift.
 *
 * @param {object} data     attribution.summarize() output
 * @param {string} context  'live' | 'backtest' — only changes wording
 */
export default function AttributionPanel({ data, context = 'live' }) {
    const [tab, setTab] = useState('strategy');
    const o = data && !data.error ? data.overall : null;

    // Waterfall: the market factors, then the frictions, summing to net.
    // NOTE: every hook must run before any early return — React requires the
    // same hook order on every render.
    const steps = useMemo(() => {
        if (!o) return [];
        const s = [];
        if (o.fullAttribution > 0) {
            s.push({ label: 'Direction (delta)', value: o.deltaPnl });
            s.push({ label: 'Convexity (gamma)', value: o.gammaPnl });
            s.push({ label: 'Vol (vega)', value: o.vegaPnl });
            s.push({ label: 'Decay (theta)', value: o.thetaPnl });
            if (Math.abs(o.residualPnl) > 0.01) s.push({ label: 'Unexplained', value: o.residualPnl });
        } else {
            s.push({ label: 'Gross P&L', value: o.grossPnl });
        }
        if (o.slippageRupees) s.push({ label: 'Slippage', value: -o.slippageRupees });
        s.push({ label: 'Charges', value: -o.chargesRupees });
        return s;
    }, [o]);

    if (!data) return null;
    if (data.error) {
        return <Card title="P&L attribution"><Placeholder>Attribution unavailable: {data.error}</Placeholder></Card>;
    }
    if (!o || !o.trades) {
        return <Card title="P&L attribution"><Placeholder>No closed trades in this window.</Placeholder></Card>;
    }

    const attributionCoverage = o.trades > 0 ? o.fullAttribution / o.trades : 0;

    const strategyRows = Object.entries(data.byStrategy || {})
        .map(([name, s]) => ({ _key: name, name, ...s }))
        .sort((a, b) => a.netPnl - b.netPnl);

    const hourRows = Object.entries(data.byHour || {})
        .map(([h, s]) => ({ _key: h, hour: h, ...s }))
        .sort((a, b) => a.hour.localeCompare(b.hour));

    const verdictRows = Object.entries(data.byVerdict || {})
        .map(([v, s]) => ({ _key: v, verdict: v, ...s }))
        .sort((a, b) => b.trades - a.trades);

    const underlyingRows = Object.entries(data.byUnderlying || {})
        .map(([u, s]) => ({ _key: u, underlying: u, ...s }))
        .sort((a, b) => a.netPnl - b.netPnl);

    return (
        <div className="space-y-4">
            <StatRow cols={5}>
                <StatTile label="Net P&L" value={inr(o.netPnl, { compact: true, sign: true })}
                          tone={o.netPnl >= 0 ? 'positive' : 'negative'}
                          hint={`${o.trades} trades · ${(o.winRate * 100).toFixed(0)}% win rate`} />
                <StatTile label="Gross P&L" value={inr(o.grossPnl, { compact: true, sign: true })}
                          tone={o.grossPnl >= 0 ? 'positive' : 'negative'}
                          hint="before charges & slippage" />
                <StatTile label="Charges" value={inr(-o.chargesRupees, { compact: true })}
                          tone="negative" hint="round-trip, paise-exact" />
                <StatTile label="Slippage" value={inr(-o.slippageRupees, { compact: true })}
                          tone={o.slippageRupees > 0 ? 'negative' : 'neutral'}
                          hint="decision price vs fill" />
                <StatTile
                    label="Cost drag"
                    value={o.costDragRatio == null ? '—' : `${(o.costDragRatio * 100).toFixed(0)}%`}
                    tone={o.costDragRatio > 0.4 ? 'negative' : 'neutral'}
                    hint="of gross edge consumed by frictions"
                    badge={o.grossPositiveNetNegative
                        ? <StatusBadge level="critical" title="Gross is positive but net is negative">Edge lost</StatusBadge>
                        : (o.costDragRatio > 0.4 ? <StatusBadge level="warning">High</StatusBadge> : null)}
                />
            </StatRow>

            {/* The most actionable output — ranked plain-language findings. */}
            <Card title="What the numbers say"
                  subtitle={context === 'backtest'
                      ? 'Found before deployment, not after — a take-profit below break-even books "wins" that are net losses.'
                      : 'Ranked by how much money the issue is costing.'}>
                <Findings findings={data.findings} />
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card
                    title="Where the money came from"
                    subtitle="Gross P&L split into the market factors that produced it, then the frictions taken out."
                    right={o.fullAttribution < o.trades
                        ? <StatusBadge level="warning" title="Trades without entry/exit risk snapshots can only be cost-analysed">
                            {`${Math.round(attributionCoverage * 100)}% decomposed`}
                          </StatusBadge>
                        : <StatusBadge level="good">Fully decomposed</StatusBadge>}
                >
                    <Waterfall steps={steps} total={{ label: 'Net P&L', value: o.netPnl }} />
                    {o.fullAttribution === 0 && (
                        <p className="text-[11px] text-slate-500 mt-3 leading-snug">
                            No greek decomposition available for this window — these trades pre-date the
                            entry/exit risk snapshots, so only the cost analysis is shown. Trades closed
                            from now on will decompose fully.
                        </p>
                    )}
                </Card>

                <Card title="Break-even reality check"
                      subtitle="The premium move each trade needed just to pay its own costs.">
                    <StatRow cols={2}>
                        <StatTile label="Avg break-even" value={`${num(o.avgBreakEvenPoints)} pts`}
                                  hint="per unit, round-trip charges" />
                        <StatTile
                            label="TP below break-even"
                            value={o.targetKnownCount ? `${o.targetBelowBreakEvenCount} / ${o.targetKnownCount}` : '—'}
                            tone={o.targetBelowBreakEvenCount > 0 ? 'negative' : 'neutral'}
                            hint="trades that could not profit by construction"
                            badge={o.targetBelowBreakEvenCount > 0
                                ? <StatusBadge level="critical">Structural</StatusBadge> : null}
                        />
                    </StatRow>
                    <div className="mt-4">
                        <p className="text-[11px] text-slate-500 mb-2">Net P&L by underlying</p>
                        <DivergingBars
                            data={underlyingRows.map(r => ({
                                label: r.underlying.replace(/^[A-Z]+:|-INDEX$/g, ''),
                                value: r.netPnl,
                                hint: `${r.trades} trades · ${(r.winRate * 100).toFixed(0)}% win · charges ${inr(r.chargesRupees, { compact: true })}`,
                            }))}
                        />
                    </div>
                </Card>
            </div>

            <Card
                title="Breakdown"
                right={
                    <div className="flex gap-1">
                        {[['strategy', 'By strategy'], ['hour', 'By hour'], ['verdict', 'By verdict']].map(([k, lbl]) => (
                            <button key={k} onClick={() => setTab(k)}
                                    className={`px-2 py-1 rounded text-[11px] transition ${
                                        tab === k ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
                                {lbl}
                            </button>
                        ))}
                    </div>
                }
            >
                {tab === 'strategy' && (
                    <DataTable
                        maxHeight={380}
                        columns={[
                            { key: 'name', header: 'Strategy' },
                            { key: 'trades', header: 'Trades', align: 'right' },
                            { key: 'winRate', header: 'Win %', align: 'right', render: r => `${(r.winRate * 100).toFixed(0)}%` },
                            { key: 'grossPnl', header: 'Gross', align: 'right', render: r => <Signed v={r.grossPnl} /> },
                            { key: 'chargesRupees', header: 'Charges', align: 'right', render: r => inr(-r.chargesRupees, { compact: true }) },
                            { key: 'netPnl', header: 'Net', align: 'right', render: r => <Signed v={r.netPnl} /> },
                            { key: 'deltaPnl', header: 'Delta', align: 'right', render: r => <Signed v={r.deltaPnl} muted /> },
                            { key: 'vegaPnl', header: 'Vega', align: 'right', render: r => <Signed v={r.vegaPnl} muted /> },
                            { key: 'thetaPnl', header: 'Theta', align: 'right', render: r => <Signed v={r.thetaPnl} muted /> },
                            {
                                key: 'flag', header: '', render: r => r.grossPositiveNetNegative
                                    ? <StatusBadge level="warning" title="The signal works; the cost structure does not">Priced out</StatusBadge>
                                    : null,
                            },
                        ]}
                        rows={strategyRows}
                    />
                )}
                {tab === 'hour' && (
                    <>
                        <p className="text-[11px] text-slate-500 mb-2">
                            Net P&L by entry hour. A reliably negative window is a zero-effort improvement — stop trading it.
                        </p>
                        <DivergingBars
                            data={hourRows.map(r => ({
                                label: `${r.hour}:00`,
                                value: r.netPnl,
                                hint: `${r.trades} trades · ${(r.winRate * 100).toFixed(0)}% win`,
                            }))}
                        />
                    </>
                )}
                {tab === 'verdict' && (
                    <DataTable
                        columns={[
                            { key: 'verdict', header: 'What decided the trade', render: r => <VerdictLabel v={r.verdict} /> },
                            { key: 'trades', header: 'Trades', align: 'right' },
                            { key: 'netPnl', header: 'Net', align: 'right', render: r => <Signed v={r.netPnl} /> },
                            { key: 'avgNetPnl', header: 'Avg', align: 'right', render: r => <Signed v={r.avgNetPnl} /> },
                        ]}
                        rows={verdictRows}
                    />
                )}
            </Card>
        </div>
    );
}

function Signed({ v, muted = false }) {
    const n = Number(v) || 0;
    if (muted) {
        return <span style={{ color: n >= 0 ? `${DIVERGING.positive}cc` : `${DIVERGING.negative}cc` }}>
            {inr(n, { compact: true, sign: true })}
        </span>;
    }
    return <span style={{ color: n >= 0 ? DIVERGING.positive : DIVERGING.negative }}>
        {inr(n, { compact: true, sign: true })}
    </span>;
}

const VERDICT_TEXT = {
    EDGE_EATEN_BY_COSTS: 'Right, but costs took it',
    RIGHT_DIRECTION_WRONG_CONTRACT: 'Right direction, wrong contract',
    WRONG_DIRECTION: 'Wrong direction',
    HELD_TOO_LONG: 'Held too long (decay)',
    IV_CRUSH: 'IV crush',
    HIGH_FRICTION: 'High friction',
    CLEAN_WIN: 'Clean win',
    CLEAN_LOSS: 'Clean loss',
};

function VerdictLabel({ v }) {
    return <span className="text-slate-300">{VERDICT_TEXT[v] || v}</span>;
}
