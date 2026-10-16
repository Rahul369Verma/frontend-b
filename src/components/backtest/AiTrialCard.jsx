/**
 * AiTrialCard — did the AI's advice actually help?
 *
 * After "Apply & re-test", the backtest is re-run with the AI's settings and this
 * card puts the two runs side by side. The row that matters is the HIDDEN period:
 * the trades the AI never saw. Better there is evidence; better only on the
 * period it saw is expected and proves little (it can always "fix" losses it was
 * shown). Without a hidden period the card says exactly that.
 */
import React from 'react';
import { Card, StatusBadge, DataTable } from '../viz/primitives';
import { inr, pnlTone } from '../viz/tokens';
import { compareRuns } from '../../utils/strategyReviewPack.js';

const MIN_HIDDEN_TRADES = 8;

function verdictOf(cmp) {
    if (!cmp.hidden) {
        return { level: 'info', text: 'In-sample only', note: 'The AI saw every one of these trades, so a better result here is expected and proves little. Ask again with "Hide the most recent 30%" ticked for an honest test.' };
    }
    const { before, after } = cmp.hidden;
    if (Math.max(before.trades, after.trades) < MIN_HIDDEN_TRADES) {
        return { level: 'info', text: 'Too few trades to judge', note: `The hidden period has under ${MIN_HIDDEN_TRADES} trades — the difference could be luck either way.` };
    }
    const d = after.net - before.net;
    // A big swing in HOW MANY trades happened usually means more changed than the
    // setting itself — e.g. which later trades the account could still afford.
    const swing = Math.abs(after.trades - before.trades) / Math.max(1, before.trades);
    const caveat = swing > 0.3
        ? ` Note: the hidden period went from ${before.trades} to ${after.trades} trades — part of this difference may come from which trades the account could afford or which days hit the daily-loss stop, not from the setting itself. Open the trades table to check.`
        : '';
    if (d > 0) {
        return { level: 'good', text: 'Better on data the AI never saw', note: `Hidden period ${inr(d, { dp: 0, sign: true })}. One period is encouraging, not proof — paper-trade it before going live.${caveat}` };
    }
    return { level: 'warning', text: 'Worse on data the AI never saw', note: `Hidden period ${inr(d, { dp: 0, sign: true })}. The advice fitted the past rather than the future — consider undoing it.${caveat}` };
}

export default function AiTrialCard({ trial, result, loading, onUndo, onDismiss }) {
    if (!trial) return null;
    const ready = !loading && result && result !== trial.beforeResult && Array.isArray(result.trades);
    const cmp = ready ? compareRuns(trial.beforeTrades, result.trades, trial.cutoffMs) : null;
    const verdict = cmp ? verdictOf(cmp) : null;

    const rows = cmp ? [
        cmp.hidden && { _key: 'hidden', label: `Hidden period (from ${trial.cutoffDate}) — never shown to the AI`, ...cmp.hidden },
        cmp.seen && { _key: 'seen', label: 'Period the AI saw', ...cmp.seen },
        { _key: 'all', label: 'Whole period', ...cmp.all },
    ].filter(Boolean) : [];

    const cell = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);
    return (
        <Card docs="backtest#ai-review" title="AI suggestion — before vs after"
            subtitle={`${trial.changes.length} setting${trial.changes.length === 1 ? '' : 's'} changed by ${trial.model || 'the AI'}: ${trial.changes.map(c => `${c.key} ${String(c.from)} → ${String(c.to)}`).join(' · ')}`}
            right={verdict ? <StatusBadge level={verdict.level}>{verdict.text}</StatusBadge> : null}>
            {!ready ? (
                <p className="text-xs text-fg-4">{loading ? 'Re-running the backtest with the suggested settings…' : 'Waiting for the re-test result…'}</p>
            ) : (
                <div className="space-y-3">
                    <DataTable dense rows={rows} columns={[
                        { key: 'label', header: 'Period', render: r => <span className={r._key === 'hidden' ? 'font-semibold text-fg-2' : ''}>{r.label}</span> },
                        { key: 'trades', header: 'Trades', align: 'right', render: r => `${r.before.trades} → ${r.after.trades}` },
                        { key: 'win', header: 'Win %', align: 'right', render: r => `${cell(r.before.win_pct, '%')} → ${cell(r.after.win_pct, '%')}` },
                        { key: 'net', header: 'Net P&L', align: 'right', render: r => <span>{inr(r.before.net, { dp: 0 })} → <span className={pnlTone(r.after.net)}>{inr(r.after.net, { dp: 0 })}</span></span> },
                        { key: 'diff', header: 'Change', align: 'right', render: r => { const d = r.after.net - r.before.net; return <span className={pnlTone(d)}>{inr(d, { dp: 0, sign: true })}</span>; } },
                    ]} />
                    <p className="text-2xs text-fg-4">{verdict.note}</p>
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button type="button" onClick={onUndo}
                            className="px-3 py-1.5 rounded text-xs border border-line-2 text-fg-3 hover:text-fg">
                            Undo — restore my previous settings
                        </button>
                        <button type="button" onClick={onDismiss}
                            className="px-3 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-fg-2">
                            Keep the new settings
                        </button>
                    </div>
                </div>
            )}
        </Card>
    );
}
