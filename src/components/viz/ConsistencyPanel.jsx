import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { StatTile, StatRow } from './primitives';
import { inr } from './tokens';
import { useChartTheme } from '../../theme/chartTheme.js';
import { consistencyVerdict } from './consistencyFormat.js';

const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 100)}%`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodLabel = (key, unit) => {
    if (!key) return '—';
    if (unit === 'month') { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; }
    return `wk ${key.slice(5)}`;
};

/**
 * Does the strategy make money THROUGHOUT the range? (backend src/domain/research/consistency.js)
 * Score 0–100 = profitable-period rate (idle periods do not count) × straightness of the equity
 * line (R², 0 when it falls). The month bars show where the profit actually came from.
 */
export default function ConsistencyPanel({ data, compact = false }) {
    const ct = useChartTheme();
    if (!data) return <p className="text-xs text-fg-5">No trades — nothing to measure.</p>;
    const unit = data.bucket === 'week' ? 'week' : 'month';
    const word = unit === 'month' ? 'months' : 'weeks';
    const active = data.profitable + data.losing;
    const bars = (data.buckets || []).map(b => ({ ...b, label: periodLabel(b.key, unit) }));
    const tone = data.score >= 60 ? 'positive' : data.score < 15 ? 'negative' : 'neutral';
    return (
        <div className="space-y-4">
            <StatRow cols={compact ? 2 : 4}>
                <StatTile label="Consistency" value={data.score == null ? '—' : Math.round(data.score)} tone={tone} hint={consistencyVerdict(data.score)} />
                <StatTile label={`Profitable ${word}`} value={`${data.profitable} of ${active}`}
                    hint={`${data.losing} losing${data.idle ? ` · ${data.idle} with no trades (not counted)` : ''}`} />
                <StatTile label="Equity line straightness" value={data.r2 == null ? '—' : data.r2.toFixed(2)} hint="R², 1 = a straight rising line" />
                <StatTile label={`Profit from the best fifth of ${word}`} value={data.top20Share == null ? '—' : pct(data.top20Share)}
                    hint={data.top20Share != null && data.top20Share > 1 ? 'more than all of it: the other periods lost money' : 'lower is more even'} />
            </StatRow>
            {!compact && (
                <p className="text-xs text-fg-4">
                    Worst {unit}: <span className="text-danger">{data.worstPeriod ? `${periodLabel(data.worstPeriod.key, unit)} ${inr(data.worstPeriod.net, { sign: true })}` : '—'}</span>
                    {' · '}best {unit}: <span className="text-success">{data.bestPeriod ? `${periodLabel(data.bestPeriod.key, unit)} ${inr(data.bestPeriod.net, { sign: true })}` : '—'}</span>
                    {' · '}longest stretch below a previous high: {data.longestUnderwaterDays} trading days.
                </p>
            )}
            {!compact && bars.length > 1 && (
                <div style={{ height: '12rem' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={bars} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} interval="preserveStartEnd" minTickGap={8} />
                            <YAxis width={56} tick={{ fontSize: ct.type['5xs'], fill: ct.text.secondary }} tickFormatter={v => inr(v, { compact: true })} />
                            <ReferenceLine y={0} stroke={ct.axis} />
                            <Tooltip contentStyle={ct.tooltipStyle ? ct.tooltipStyle({ fontSize: ct.type['3xs'] }) : undefined}
                                formatter={(v, n, p) => [`${inr(v, { sign: true })} · ${p.payload.trades} trade${p.payload.trades === 1 ? '' : 's'}`, 'Net']} />
                            <Bar dataKey="net" isAnimationActive={false}>
                                {bars.map((b, i) => <Cell key={i} fill={b.trades === 0 ? ct.gridSoft : b.net >= 0 ? ct.diverging.positive : ct.diverging.negative} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
            {!compact && (
                <p className="text-3xs text-fg-5">
                    Consistency = {pct(data.smoothedRate)} (profitable {word}, smoothed so a short run can't claim 100%) × {data.r2 == null ? '—' : data.r2.toFixed(2)} (straightness; 0 if the line falls).
                    A {unit} with no trades counts neither way, so trading only on strong signals is not punished. Sharpe does not see any of this: a strategy that is flat for a year and jumps at the end can have a fine Sharpe.
                </p>
            )}
        </div>
    );
}
