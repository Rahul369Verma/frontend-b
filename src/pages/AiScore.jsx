'use strict';
/**
 * AI Score — does the AI layer earn its place?
 *
 * The platform pays latency and API spend on a verdict for every signal and
 * gates real-money entries on the answer. This page is the first thing that
 * ever checks whether that helps.
 *
 * THE DESIGN RULE HERE IS RESTRAINT. It would be easy to print a big
 * "CONFIRM vs REJECT" number; it would also be a lie, because a REJECT never
 * traded and has no P&L. So the unobservable comparison is shown as explicitly
 * unobservable, the observational one is labelled confounded, and the only
 * clean A/B (reviews applied vs refused) is called what it is. A dashboard that
 * flatters the feature it measures is worse than no dashboard.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Brain, RefreshCw, AlertTriangle } from 'lucide-react';
import { API_URL } from '../config/api.js';
import {
    PageHeader, Card, StatRow, StatTile, DataTable, Segmented, Chip,
    Spinner, EmptyState, Placeholder,
} from '../components/viz/primitives';
import { useChartTheme } from '../components/viz/tokens';
import {
    ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from 'recharts';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const inr = (v) => (n(v) == null ? '—' : `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`);
const toneOf = (v) => ((n(v) ?? 0) > 0 ? 'positive' : (n(v) ?? 0) < 0 ? 'negative' : 'neutral');

const RANGES = [{ label: '30d', value: 30 }, { label: '90d', value: 90 }, { label: '180d', value: 180 }, { label: '1y', value: 365 }];

/** One arm of a comparison, with its n always visible — a mean without its n is not a result. */
function Arm({ title, arm, hint }) {
    if (!arm) return null;
    return (
        <StatTile
            label={title}
            value={inr(arm.expectancy)}
            tone={toneOf(arm.expectancy)}
            hint={`${arm.n} trades · ${inr(arm.total)} total${arm.winRate != null ? ` · ${arm.winRate}% won` : ''}${hint ? ` · ${hint}` : ''}`}
        />
    );
}

/** A significance line that refuses to overstate what a t-statistic means here. */
function TestLine({ test, what }) {
    if (!test) {
        return <div className="text-2xs text-fg-5">Too few trades on one side to test {what} — no statistic is shown rather than a meaningless one.</div>;
    }
    return (
        <div className="text-2xs text-fg-5 flex flex-wrap items-center gap-2">
            <Chip tone={test.significantAt5pct ? 'warning' : 'neutral'}>
                t = {test.t} · df {test.df} · {test.significantAt5pct ? 'clears the rough 5% line' : 'NOT significant'}
            </Chip>
            <span>{test.note}</span>
        </div>
    );
}

export default function AiScore() {
    const ct = useChartTheme();
    const [days, setDays] = useState(180);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async (d) => {
        setLoading(true); setError(null);
        try {
            const res = await axios.get(`${API_URL}/ai/score`, { params: { days: d } });
            setData(res.data);
        } catch (e) { setError(e?.response?.data?.error || e.message); setData(null); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(days); }, [days, load]);

    const calBars = useMemo(
        () => (data?.calibration?.buckets || []).map(b => ({ name: b.range, expectancy: b.expectancy ?? 0, n: b.n })),
        [data],
    );

    const modelRows = useMemo(
        () => (data?.byModel || []).map(m => ({ ...m, key: m.label })),
        [data],
    );

    return (
        <div className="space-y-4">
            <PageHeader
                icon={Brain}
                title="AI Score"
                subtitle="Verdict → outcome. What the AI gate has actually done to the book."
                actions={
                    <div className="flex items-center gap-2">
                        <Segmented options={RANGES} value={days} onChange={setDays} />
                        <button type="button" onClick={() => load(days)} className="p-1.5 rounded border border-line text-fg-4 hover:text-fg-2" aria-label="Refresh">
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                        </button>
                    </div>
                }
            />

            {loading && !data && <Spinner label="Joining verdicts to outcomes…" />}
            {error && <EmptyState icon={AlertTriangle} title="Could not score">{error}</EmptyState>}

            {data && (
                <>
                    {/* ── the headline, with its control ──────────────────────── */}
                    <Card
                        title="Is the gate adding anything?"
                        subtitle="AI-confirmed trades against trades taken with the gate switched off. Both populations traded, so both have real outcomes."
                        right={<Chip tone="warning">observational, not randomised</Chip>}
                    >
                        <StatRow cols={2}>
                            <Arm title="AI confirmed" arm={data.confirmedVsNoAi?.confirmed} />
                            <Arm title="No AI gate" arm={data.confirmedVsNoAi?.noAi} />
                        </StatRow>
                        <div className="mt-2 space-y-1">
                            <TestLine test={data.confirmedVsNoAi?.test} what="the gap" />
                            <div className="text-2xs text-fg-5">{data.confirmedVsNoAi?.note}</div>
                        </div>
                    </Card>

                    {/* ── calibration: the sharpest test available ────────────── */}
                    <Card
                        title="Is confidence informative?"
                        subtitle="If the score carries signal, expectancy should rise with it. Flat or falling means it is noise and should not gate anything."
                        right={
                            <Chip tone={
                                data.calibration?.correlation == null ? 'neutral'
                                    : data.calibration.correlation > 0.1 ? 'positive'
                                        : data.calibration.correlation < -0.1 ? 'critical' : 'warning'
                            }>
                                correlation {data.calibration?.correlation ?? '—'}
                            </Chip>
                        }
                    >
                        {calBars.length ? (
                            <>
                                <ResponsiveContainer width="100%" height={180}>
                                    <ComposedChart data={calBars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                        <XAxis dataKey="name" tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} />
                                        <YAxis width={56} tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} tickFormatter={(v) => `₹${Math.round(v)}`} />
                                        <Tooltip
                                            contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })}
                                            formatter={(v, k, p) => [k === 'expectancy' ? `${inr(v)} over ${p.payload.n} trades` : v, 'expectancy']}
                                        />
                                        <ReferenceLine y={0} stroke={ct.axis} />
                                        <Bar dataKey="expectancy" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                                            {calBars.map((b, i) => (
                                                <Cell key={i} fill={b.expectancy >= 0 ? ct.diverging.positive : ct.diverging.negative} />
                                            ))}
                                        </Bar>
                                    </ComposedChart>
                                </ResponsiveContainer>
                                <div className="mt-2 text-2xs text-fg-4">{data.calibration.verdict}</div>
                                <div className="mt-2"><TestLine test={data.calibration?.highVsLow?.test} what="high vs low confidence" /></div>
                            </>
                        ) : <Placeholder>No confirmed trades carry a confidence score in this window.</Placeholder>}
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-2">
                        {/* ── the one clean A/B ──────────────────────────────── */}
                        <Card
                            title="In-flight reviews"
                            subtitle="Reviews the engine applied vs. ones it ran and refused. Both groups traded — this is the closest thing here to a controlled comparison."
                        >
                            <StatRow cols={3}>
                                <Arm title="Applied" arm={data.reviews?.applied} />
                                <Arm title="Refused" arm={data.reviews?.refused} />
                                <Arm title="No review" arm={data.reviews?.none} />
                            </StatRow>
                            <div className="mt-2"><TestLine test={data.reviews?.test} what="applied vs refused" /></div>
                            {data.reviews?.applied?.n === 0 && data.reviews?.refused?.n > 0 && (
                                <div className="mt-2 text-2xs text-warning">
                                    Every review in this window was refused by the engine — the review loop is running and
                                    changing nothing. Worth checking why before paying for more of them.
                                </div>
                            )}
                        </Card>

                        {/* ── rejects: counted, never scored ─────────────────── */}
                        <Card title="Rejects" subtitle="Counted, deliberately not scored.">
                            <StatRow cols={3}>
                                <StatTile label="REJECT" value={data.rejects?.n ?? 0} hint="no order placed" />
                                <StatTile label="SKIPPED" value={data.rejects?.skipped ?? 0} hint="gate not reached" />
                                <StatTile label="Errors" value={data.rejects?.errors ?? 0} tone={data.rejects?.errors ? 'negative' : 'neutral'} hint="failed calls" />
                            </StatRow>
                            <div className="mt-2 rounded border border-line bg-surface-2 p-2 space-y-1">
                                <div className="text-2xs font-semibold text-fg-3">Expectancy: {String(data.rejects?.counterfactual || '—')}</div>
                                <div className="text-2xs text-fg-5">{data.rejects?.why}</div>
                                <div className="text-2xs text-fg-5">{data.rejects?.howToGetIt}</div>
                            </div>
                        </Card>
                    </div>

                    {/* ── per model ──────────────────────────────────────────── */}
                    <Card title="By model" subtitle="Same question, split by which model answered. Small n on the tail — read the counts.">
                        <DataTable
                            columns={[
                                { key: 'label', header: 'Model' },
                                { key: 'n', header: 'Trades', align: 'right' },
                                { key: 'expectancy', header: 'Expectancy', align: 'right', render: (r) => <span className={toneOf(r.expectancy) === 'negative' ? 'text-negative' : toneOf(r.expectancy) === 'positive' ? 'text-positive' : ''}>{inr(r.expectancy)}</span> },
                                { key: 'total', header: 'Total', align: 'right', render: (r) => inr(r.total) },
                                { key: 'winRate', header: 'Won', align: 'right', render: (r) => (r.winRate == null ? '—' : `${r.winRate}%`) },
                                { key: 'worst', header: 'Worst', align: 'right', render: (r) => inr(r.worst) },
                            ]}
                            rows={modelRows}
                            empty="No confirmed trades in this window."
                            dense
                        />
                    </Card>

                    {/* ── coverage: what this report could not see ───────────── */}
                    <Card title="Coverage" subtitle="What this report could not join, and why. Nothing is dropped silently.">
                        <StatRow cols={4}>
                            <StatTile label="Closed trades" value={data.coverage?.closedTrades ?? 0} />
                            <StatTile label="With a verdict" value={data.coverage?.withAVerdict ?? 0} />
                            <StatTile label="Without a verdict" value={data.coverage?.withoutAVerdict ?? 0} hint="gate was off — NOT rejects" />
                            <StatTile label="Unjoinable logs" value={data.coverage?.logsUnjoinable ?? 0} hint="no job_id, no trade_id" />
                        </StatRow>
                        <div className="mt-2 text-2xs text-fg-5">
                            {data.coverage?.withoutAVerdictWhy} · Window {data.window?.trades} trades / {data.window?.logs} verdicts.
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}
