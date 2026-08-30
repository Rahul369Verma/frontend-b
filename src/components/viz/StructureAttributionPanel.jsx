import React from 'react';
import { Card, StatTile, StatRow, Waterfall, DataTable, StatusBadge, Placeholder, Meter } from './primitives';
import { inr, useChartTheme } from './tokens';

/**
 * Greek attribution for a MULTI-LEG structure backtest.
 *
 * The question this answers, which net P&L cannot:
 *
 *     Did this condor make money because the market stayed still (theta),
 *     or because implied vol fell (vega)?
 *
 * Those are different bets. A theta engine wants quiet range-bound tape and
 * should be entered on any low-realised-vol day. A vol harvester needs a HIGH
 * IV percentile at entry and is dangerous in already-cheap vol — the opposite
 * rule. Ranking the structure templates on net P&L alone cannot tell them apart.
 *
 * @param {object} data  logic/analytics/structureAttribution.js summarizeStructure()
 */
export default function StructureAttributionPanel({ data }) {
    const ct = useChartTheme();
    if (!data) return null;
    if (data.error) {
        return <Card title="Structure attribution"><Placeholder>Unavailable: {data.error}</Placeholder></Card>;
    }
    const t = data.totals;
    if (!t || !t.trades) {
        return <Card title="Structure attribution"><Placeholder>No trades to decompose.</Placeholder></Card>;
    }

    const steps = [];
    if (t.fullAttribution > 0) {
        steps.push({ label: 'Direction (delta)', value: t.deltaPnl });
        steps.push({ label: 'Convexity (gamma)', value: t.gammaPnl });
        steps.push({ label: 'Vol (vega)', value: t.vegaPnl });
        steps.push({ label: 'Decay (theta)', value: t.thetaPnl });
        if (Math.abs(t.residualPnl) > 0.01) steps.push({ label: 'Unexplained', value: t.residualPnl });
        if (Math.abs(t.unattributedPnl) > 0.01) steps.push({ label: 'Legs closed early', value: t.unattributedPnl });
    } else {
        steps.push({ label: 'Gross P&L', value: t.grossPnl });
    }
    steps.push({ label: 'Charges', value: -t.chargesRupees });

    const legRoleRows = Object.entries(data.byLegRole || {})
        .map(([role, v]) => ({ _key: role, role, ...v }))
        .sort((a, b) => a.grossPnl - b.grossPnl);

    const DRIVER_LABEL = {
        DECAY: 'Theta engine',
        VOLATILITY: 'Volatility bet',
        DIRECTIONAL: 'Directional bet',
        CONVEXITY: 'Convexity bet',
    };

    const driverTotal = Object.values(data.driverCounts || {}).reduce((a, b) => a + b, 0);

    return (
        <div className="space-y-4">
            <StatRow cols={4}>
                <StatTile label="What this really is"
                          value={DRIVER_LABEL[data.dominantDriver] || '—'}
                          hero
                          hint={driverTotal
                              ? `${data.driverCounts[data.dominantDriver] || 0} of ${driverTotal} trades`
                              : ''} />
                <StatTile label="Net P&L" value={inr(t.netPnl, { compact: true, sign: true })}
                          tone={t.netPnl >= 0 ? 'positive' : 'negative'}
                          hint={`${t.trades} structures`} />
                <StatTile label="Charges" value={inr(-t.chargesRupees, { compact: true })} tone="negative"
                          hint="scales with LEG COUNT, not trade count" />
                <StatTile label="Vega vs theta"
                          value={`${inr(t.vegaPnl, { compact: true, sign: true })} / ${inr(t.thetaPnl, { compact: true, sign: true })}`}
                          hint="the two engines a structure runs on" />
            </StatRow>

            <Card title="The verdict">
                <p className="text-sm text-fg-2 leading-relaxed">{data.verdict}</p>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Where the structure's money came from"
                      subtitle="Every leg repriced at entry and exit, summed.">
                    <Waterfall steps={steps} total={{ label: 'Net P&L', value: t.netPnl }} />
                </Card>

                <Card title="Which leg carried the risk"
                      subtitle='A "+₹2,000 net" can hide "the short leg lost ₹18k and the wings saved it".'>
                    <DataTable
                        columns={[
                            { key: 'role', header: 'Leg role', render: r => (
                                <span className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full"
                                          style={{ backgroundColor: r.role.startsWith('SELL') ? ct.categorical[1] : ct.categorical[0] }} />
                                    <span className="text-fg-2">{r.role}</span>
                                </span>
                            ) },
                            { key: 'legs', header: 'Legs', align: 'right' },
                            { key: 'grossPnl', header: 'Gross', align: 'right', render: r => (
                                <span style={{ color: r.grossPnl >= 0 ? ct.diverging.positive : ct.diverging.negative }}>
                                    {inr(r.grossPnl, { compact: true, sign: true })}
                                </span>
                            ) },
                            { key: 'deltaPnl', header: 'Delta', align: 'right', render: r => inr(r.deltaPnl, { compact: true, sign: true }) },
                            { key: 'vegaPnl', header: 'Vega', align: 'right', render: r => inr(r.vegaPnl, { compact: true, sign: true }) },
                            { key: 'thetaPnl', header: 'Theta', align: 'right', render: r => inr(r.thetaPnl, { compact: true, sign: true }) },
                        ]}
                        rows={legRoleRows}
                    />
                </Card>
            </div>

            {driverTotal > 0 && (
                <Card title="Driver mix across trades"
                      subtitle="A template that flips driver between trades is not a clean bet on either.">
                    <div className="space-y-2">
                        {Object.entries(data.driverCounts)
                            .sort((a, b) => b[1] - a[1])
                            .map(([drv, n]) => (
                                <Meter key={drv} value={n} max={driverTotal}
                                       label={`${DRIVER_LABEL[drv] || drv} — ${n} trades`} />
                            ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
