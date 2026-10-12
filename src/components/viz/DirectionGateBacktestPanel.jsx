/**
 * The LIVE engine's direction-confidence gate, tested in a backtest.
 *
 * Same maths as live (backend src/domain/risk/directionConfidence.js). The one honest
 * difference is what it learns from: here, only THIS backtest's own closed trades (one
 * strategy, one index); live learns from every single-leg trade on the account.
 *   Shadow  — every trade stamped with the verdict; nothing blocked; says what the
 *             would-be-blocked trades made.
 *   Enforce — weak-side signals skipped except probes, AND the same backtest re-run with
 *             the gate off, so the effect is measured side by side, month by month.
 */
import React, { useRef } from 'react';
import { Chip, StatusBadge, DataTable, Segmented } from './primitives';
import { inr, istDateTime, pnlTone } from './tokens.js';
import useRemWidth from '../../hooks/useRemWidth.js';
import { DECISION_TONE, DIAG_LEVEL, pct0, settingsLine, settingsToGate } from './directionGateFormat.js';

const numIn = 'w-16 bg-card-2 border border-line-2 rounded px-1.5 py-0.5 text-2xs text-fg tabular-nums';

export function DirectionGateControls({ value, onChange }) {
    const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
    return (
        <div className="rounded-lg border border-line/60 bg-card-2/30 px-3 py-2 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="dir-gate-controls">
            <span className="text-xs font-semibold text-fg-2" title="The live engine's CE/PE confidence gate, learning from this backtest's own trades">Direction confidence gate</span>
            <Segmented value={value.mode} onChange={(m) => onChange({ ...value, mode: m })}
                options={[
                    { v: 'off', label: 'Off', hint: 'Backtest exactly as before' },
                    { v: 'shadow', label: 'Shadow', hint: 'Decide + record on every trade, block nothing' },
                    { v: 'enforce', label: 'Enforce', hint: 'Skip weak-side signals (probes still trade) and compare with the gate off' },
                ]} />
            {value.mode !== 'off' && (
                <>
                    <label className="text-2xs text-fg-4 inline-flex items-center gap-1" title="Block a side when P(its mean R > 0) is below this">
                        floor <input aria-label="floor" type="number" step="0.05" min="0.05" max="0.5" value={value.floor} onChange={set('floor')} className={numIn} />
                    </label>
                    <label className="text-2xs text-fg-4 inline-flex items-center gap-1" title="A trade's weight halves every N sessions">
                        half-life <input aria-label="half-life" type="number" step="0.5" min="0.5" max="30" value={value.halfLife} onChange={set('halfLife')} className={numIn} />
                    </label>
                    <label className="text-2xs text-fg-4 inline-flex items-center gap-1" title="Let 1 in N weak-side signals through as a probe">
                        probe 1 in <input aria-label="probe every" type="number" step="1" min="1" max="20" value={value.probeEvery} onChange={set('probeEvery')} className={numIn} />
                    </label>
                    <label className="text-2xs text-fg-4 inline-flex items-center gap-1" title="Effective trades needed before the gate may block">
                        min evidence <input aria-label="min evidence" type="number" step="1" min="0" max="50" value={value.minNeff} onChange={set('minNeff')} className={numIn} />
                    </label>
                </>
            )}
        </div>
    );
}

function Compare({ c }) {
    const rows = [
        ['Trades', c.base.trades, c.gated.trades, v => v],
        ['Net P&L', c.base.net, c.gated.net, v => inr(v, { sign: true })],
        ['Win rate', c.base.winRate, c.gated.winRate, pct0],
        ['Profit factor', c.base.profitFactor, c.gated.profitFactor, v => (v == null ? '—' : v)],
        ['Max drawdown', c.base.maxDrawdown, c.gated.maxDrawdown, v => inr(v)],
        ['CE trades · net', c.base.CE, c.gated.CE, v => `${v.n} · ${inr(v.net, { sign: true })}`],
        ['PE trades · net', c.base.PE, c.gated.PE, v => `${v.n} · ${inr(v.net, { sign: true })}`],
    ];
    return (
        <DataTable dense rows={rows.map(([k, a, b, f]) => ({ _key: k, k, a: f(a), b: f(b) }))}
            columns={[{ key: 'k', header: '' }, { key: 'a', header: 'Gate off', align: 'right' }, { key: 'b', header: 'Gate enforced', align: 'right' }]} />
    );
}

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50';
const btnPrimary = `${btn} bg-primary text-on-primary`;
const btnQuiet = `${btn} border border-line-2 text-fg-3 hover:bg-card-2`;

/**
 * "Which settings should this strategy use?" — chosen on the first part of the period,
 * scored on the rest, checked against random skipping, and the pick re-run exactly.
 * OFF is a real answer: it is shown as plainly as USE.
 */
function GateSuggestion({ s, narrow, onApply }) {
    if (!s) return null;
    if (!s.ok) {
        return <p className="text-2xs text-fg-5" data-testid="dir-gate-suggestion">No suggestion: {s.reason}</p>;
    }
    const rec = s.recommendation || {};
    const pick = rec.pick;
    const use = rec.action === 'USE';
    const p = s.premise || {};
    return (
        <div className="rounded-lg border border-line/60 p-3 space-y-3" data-testid="dir-gate-suggestion">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-fg-2">Suggested settings for this strategy</p>
                <StatusBadge level={use ? 'good' : 'warning'}>{use ? 'Use the gate with these settings' : 'Turn the gate off for this strategy'}</StatusBadge>
            </div>
            <p className="text-xs text-fg-3">{rec.reason}.</p>
            {rec.caution && <p className="text-2xs text-warning">Caution: {rec.caution}.</p>}

            {pick && (
                <div className="text-2xs text-fg-4 space-y-0.5">
                    <p>Best on the training trades (before {s.split.testFrom}): <b className="text-fg-2">{settingsLine(pick)}</b></p>
                    <p>
                        training <span className={pnlTone(pick.trainDelta)}>{inr(pick.trainDelta, { sign: true })}</span>
                        {' · '}test (never used to choose) <span className={pnlTone(pick.testDelta)}>{inr(pick.testDelta, { sign: true })}</span>
                        {pick.nullP != null && <> · random skipping of the same {pick.testBlocks} test trades did as well {Math.round(pick.nullP * 100)}% of the time</>}
                    </p>
                    {s.exact && (
                        <p>Exact re-run of that pick: {s.exact.verdict}; on the test period alone{' '}
                            <span className={pnlTone(s.exact.testDelta)}>{inr(s.exact.testDelta, { sign: true })}</span>.</p>
                    )}
                </div>
            )}

            {onApply && (
                <div className="flex flex-wrap gap-2">
                    {use ? (
                        <button type="button" className={btnPrimary} onClick={() => onApply(settingsToGate(rec.settings, 'enforce'))}>Apply these settings</button>
                    ) : (
                        <>
                            <button type="button" className={btnPrimary} onClick={() => onApply({ mode: 'off' })}>Turn the gate off</button>
                            {rec.settings && <button type="button" className={btnQuiet} onClick={() => onApply(settingsToGate(rec.settings, 'enforce'))}
                                title="Loads the training pick into the controls with Enforce on. Re-run to see it — expect the test-period result above, not the training one.">Load the training pick anyway</button>}
                        </>
                    )}
                </div>
            )}

            {(s.diagnosis || []).length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-fg-2">What the backtest says about the gate</p>
                    <ul className="space-y-1.5">
                        {s.diagnosis.map((d, i) => (
                            <li key={`${d.key}-${i}`} className="flex gap-2 items-start">
                                <span className="mt-0.5 flex-shrink-0"><StatusBadge level={DIAG_LEVEL[d.level] || 'info'}>{d.key}</StatusBadge></span>
                                <span className="text-2xs text-fg-3 leading-snug">{d.text}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {p.rho != null && (
                <p className="text-2xs text-fg-5">
                    Premise test — does a side's confidence predict its next trade? ρ {p.rho}, p {p.p}, {p.n} trades: {p.verdict}.
                </p>
            )}

            {(s.top || []).length > 0 && (
                <div className="space-y-1">
                    <p className="text-2xs text-fg-4">Best {s.top.length} of {s.tested} settings, ranked on the training trades only ({s.split.trainTrades} train / {s.split.testTrades} test){s.current ? <> · yours: training {inr(s.current.trainDelta, { sign: true })}, test {inr(s.current.testDelta, { sign: true })}</> : null}</p>
                    {narrow ? (
                        <div className="space-y-1 max-h-64 overflow-auto">
                            {s.top.map((r, i) => (
                                <p key={i} className="text-2xs text-fg-4">{settingsLine(r)} — train {inr(r.trainDelta, { sign: true })} · test <span className={pnlTone(r.testDelta)}>{inr(r.testDelta, { sign: true })}</span></p>
                            ))}
                        </div>
                    ) : (
                        <DataTable dense maxHeight={260} rows={s.top.map((r, i) => ({ ...r, _key: i }))}
                            columns={[
                                { key: 'floor', header: 'Floor', align: 'right', render: r => pct0(r.floor) },
                                { key: 'halfLifeSessions', header: 'Half-life', align: 'right' },
                                { key: 'probeEvery', header: 'Probe 1 in', align: 'right' },
                                { key: 'minNeff', header: 'Min evidence', align: 'right' },
                                { key: 'blocks', header: 'Blocked train / test', align: 'right', render: r => `${r.trainBlocks} / ${r.testBlocks}` },
                                { key: 'trainDelta', header: 'Training Δ', align: 'right', render: r => inr(r.trainDelta, { sign: true }) },
                                { key: 'testDelta', header: 'Test Δ', align: 'right', render: r => <span className={pnlTone(r.testDelta)}>{inr(r.testDelta, { sign: true })}</span> },
                            ]} />
                    )}
                </div>
            )}
            <p className="text-3xs text-fg-5">Method: {s.method}. The ranking replays each setting over the gate-off trades; the pick is then re-run exactly.</p>
        </div>
    );
}

export default function DirectionGateBacktestPanel({ data, onApply }) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    if (!data) return null;
    const c = data.comparison;
    const s = data.settings || {};
    const counts = data.counts || {};
    return (
        <div ref={ref} className="space-y-3" data-testid="dir-gate-panel">
            <div className="flex flex-wrap items-center gap-2">
                <Chip tone={data.mode === 'enforce' ? 'warning' : 'info'}>{data.mode.toUpperCase()}</Chip>
                <span className="text-2xs text-fg-5">floor {pct0(s.floor)} · half-life {s.halfLifeSessions} sessions · probe 1 in {s.probeEvery} · min evidence {s.minNeff}</span>
            </div>
            <p className="text-2xs text-fg-4">
                {data.decisions} signals decided —{' '}
                {['ALLOW', 'THIN', 'PROBE', 'BLOCK'].map(k => <span key={k} className="mr-2"><Chip tone={DECISION_TONE[k]}>{k}</Chip> {counts[k] || 0}</span>)}
            </p>

            {data.mode === 'shadow' && data.shadow && (
                <div className="rounded-lg border border-line/60 p-3 space-y-1" data-testid="dir-gate-shadow">
                    <p className="text-xs text-fg-3">
                        {data.shadow.wouldBlock.n} trades would have been blocked; together they made{' '}
                        <b className={pnlTone(data.shadow.wouldBlock.net)}>{inr(data.shadow.wouldBlock.net, { sign: true })}</b>
                        {data.shadow.wouldBlock.n > 0 && <> → enforcing would have {data.shadow.savedIfEnforced >= 0 ? 'saved' : 'cost'} about <b>{inr(Math.abs(data.shadow.savedIfEnforced))}</b></>}.
                    </p>
                    <p className="text-3xs text-fg-5">{data.shadow.note} Switch to Enforce for the exact side-by-side.</p>
                </div>
            )}

            {data.mode === 'enforce' && c && (c.skipped ? (
                <StatusBadge level="warning">{c.skipped}</StatusBadge>
            ) : (
                <div className="space-y-2" data-testid="dir-gate-compare">
                    <StatusBadge level={c.delta.net > 0 ? 'good' : 'critical'}>{c.verdict}</StatusBadge>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Compare c={c} />
                        <DataTable dense maxHeight={260} rows={(c.months || []).map(m => ({ ...m, _key: m.month }))}
                            columns={[
                                { key: 'month', header: 'Month' },
                                { key: 'base', header: 'Gate off', align: 'right', render: r => inr(r.base, { sign: true }) },
                                { key: 'gated', header: 'Enforced', align: 'right', render: r => inr(r.gated, { sign: true }) },
                                { key: 'delta', header: 'Δ', align: 'right', render: r => <span className={pnlTone(r.delta)}>{inr(r.delta, { sign: true })}</span> },
                            ]} />
                    </div>
                </div>
            ))}

            {data.mode === 'enforce' && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-fg-2">Blocked signals ({data.blockedTotal}{data.blockedTotal > (data.blocked || []).length ? `, first ${(data.blocked || []).length} shown` : ''})</p>
                    {rem != null && rem < 48 ? (
                        <div className="space-y-1 max-h-64 overflow-auto">
                            {(data.blocked || []).map((b, i) => (
                                <p key={i} className="text-2xs text-fg-4">{istDateTime(b.at)} · {b.side} · CE {pct0(b.ce)} / PE {pct0(b.pe)}</p>
                            ))}
                        </div>
                    ) : (
                        <DataTable dense maxHeight={260} rows={(data.blocked || []).map((b, i) => ({ ...b, _key: `${b.at}-${i}` }))} empty="No signal was blocked"
                            columns={[
                                { key: 'at', header: 'Signal at', render: r => istDateTime(r.at) },
                                { key: 'side', header: 'Side' },
                                { key: 'ce', header: 'CE conf', align: 'right', render: r => pct0(r.ce) },
                                { key: 'pe', header: 'PE conf', align: 'right', render: r => pct0(r.pe) },
                                { key: 'reason', header: 'Why', render: r => <span className="whitespace-normal">{r.reason}</span> },
                            ]} />
                    )}
                </div>
            )}

            <GateSuggestion s={data.suggestion} narrow={rem != null && rem < 48} onApply={onApply} />

            <p className="text-3xs text-fg-5">
                Learns from {data.learnsFrom}. Every trade in the table below carries its verdict (dir_gate). Pure maths, no AI — the same functions the live engine runs.
            </p>
        </div>
    );
}
