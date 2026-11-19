/**
 * The builder's "Editing deployment" banner, the parts that show a change before it is saved
 * (user, 17-Nov-2026: "provide the backtest with these button and then we can update it from
 * backtest which will show the changes while updating it and we can confirm"):
 *   EditSource       where the settings came from (a combination picked in Results) and what the
 *                    replay of the deployment's own trades said about it;
 *   EditChanges      the server's dry run of the builder's settings, kept current as you change
 *                    them: every change, when it acts, and anything that would refuse the save;
 *   BacktestCompare  the deployment's own settings and the builder's, backtested over the same
 *                    days on the same prices, side by side.
 * Saving still goes through "Save to deployment" → the confirmation (MultiLeg.jsx saveToDeployment).
 */
import React from 'react';
import { changeLine, compareRows, sourceWords } from './deploymentEditFormat.js';
import { tryText, trySection } from './comboReplayFormat.js';
import { rup, signed } from './stopReplayFormat.js';


export function EditSource({ source }) {
    if (!source) return null;
    return (
        <div className="text-fg-3" data-testid="edit-source">
            <b>From Results → {trySection(source)}:</b> {tryText(source)}. That replay is in hindsight on those {source.kind === 'timing' ? 'days' : 'trades'}; the backtest below checks the settings on every day.
        </div>
    );
}

/** The dry run of what "Save to deployment" would change — refreshed as the settings change. */
export function EditChanges({ plan, checking }) {
    if (!plan && !checking) return null;
    const changes = plan?.changes || [];
    const errors = plan?.errors || [];
    return (
        <div data-testid="edit-changes">
            <div className="font-semibold text-fg-3">
                Changes from the deployment{plan && !checking ? ` (${changes.length})` : ''}{checking ? ' — checking…' : ''}
            </div>
            {plan && (
                <>
                    {changes.length
                        ? <ul className="list-disc pl-4 font-mono text-3xs">{changes.map((c) => <li key={c.key}>{changeLine(c)}</li>)}</ul>
                        : !errors.length && <div className="text-fg-5">None yet: the builder holds the deployment&apos;s own settings.</div>}
                    {errors.map((e, i) => <div key={i} className="text-danger">Would not save: {e}</div>)}
                    {(plan.notes || []).map((n, i) => <div key={`n${i}`} className="text-fg-5">{n}</div>)}
                </>
            )}
        </div>
    );
}

const cell = (kind, v) => {
    if (v == null) return '—';
    if (v === Infinity) return '∞';
    if (kind === 'rupees') return rup(v);
    if (kind === 'pct') return `${v}%`;
    return String(v);
};
const diffCell = (kind, d) => {
    if (d == null) return '—';
    if (d === 0) return 'same';
    if (kind === 'rupees') return signed(d);
    if (kind === 'pct') return `${d > 0 ? '+' : '−'}${Math.abs(d)} pts`;
    return `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
};
const VERDICT_TONE = { better: 'text-success', worse: 'text-danger', same: 'text-fg-5' };

/**
 * The two backtests side by side. `base` = the deployment's settings' metrics, `next` = the builder's
 * (the result shown); `period` = { from, to, chainSource }. `stale` = the builder changed since `next` ran.
 */
export function BacktestCompare({ base, next, period, stale, onRunBase, baseState }) {
    const running = baseState === 'running';
    if (!base) {
        return (
            <div className="space-y-1">
                {baseState && baseState !== 'running' && <div className="text-danger">The deployment&apos;s own settings: {baseState}</div>}
                <button type="button" onClick={onRunBase} disabled={running || !onRunBase}
                    className="px-2 py-1 border border-line rounded text-2xs text-fg-3 hover:text-fg disabled:opacity-40">
                    {running ? 'Backtesting the deployment’s own settings…' : `Backtest the deployment’s own settings over ${period.from} → ${period.to}, to compare`}
                </button>
            </div>
        );
    }
    if (!next) return <div className="text-fg-5">The deployment&apos;s own settings over {period.from} → {period.to}: {signed(base.netPnl)} on {base.n} trades. Run the backtest to set these settings next to them.</div>;
    const rows = compareRows(base, next);
    const net = rows[0];
    return (
        <div data-testid="edit-compare">
            <div className="font-semibold text-fg-3">Backtest: the deployment&apos;s settings vs these</div>
            <div className="text-fg-5">{period.from} → {period.to} · {sourceWords(period.chainSource)} · the same days, prices and entries; only the settings differ.</div>
            <table className="text-3xs font-mono mt-0.5" aria-label="The deployment's settings and these settings, backtested">
                <thead>
                    <tr className="text-fg-5"><th className="font-normal text-left pr-2" /><th className="font-normal text-right px-1">Deployment</th><th className="font-normal text-right px-1">These</th><th className="font-normal text-right pl-1">Change</th></tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.key} className="border-t border-line-0/60">
                            <td className="pr-2 text-fg-4">{r.label}</td>
                            <td className="text-right px-1">{cell(r.kind, r.base)}</td>
                            <td className="text-right px-1">{cell(r.kind, r.next)}</td>
                            <td className={`text-right pl-1 ${VERDICT_TONE[r.verdict] || ''}`}>{diffCell(r.kind, r.diff)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {net.diff != null && (
                <div className={net.diff > 0 ? 'text-success' : net.diff < 0 ? 'text-danger' : 'text-fg-4'}>
                    {net.diff > 0 ? `These settings made ${rup(net.diff)} more than the deployment's.` : net.diff < 0 ? `These settings made ${rup(-net.diff)} less than the deployment's.` : 'Both made the same.'}
                </div>
            )}
            {stale && <div className="text-warning">The settings changed after this backtest ran: run it again before saving.</div>}
        </div>
    );
}
