/**
 * StopLossSweepPanel — "which stop-loss loses least?" for a single-leg backtest
 * (user, 23-Oct-2026: "suggest a stoploss with minimum loss in net").
 *
 * The stop swept is the per-lot cap `max_single_trade_loss` — the same rule the live
 * engine applies (it tightens each trade's stop so one lot risks at most ₹X). The
 * server re-runs the SAME backtest once per level (exact runs: a tighter stop also
 * changes which later signals can be taken) — backend src/domain/risk/stopLossSweep.js.
 *
 * Two answers, shown apart: the level with the lowest loss (best net) over the whole
 * period — hindsight — and the level chosen on the first ~70% of trades, checked on
 * the rest against the current level. The table shows the price of each: a looser stop
 * can win on net and still lose more on its worst trade.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { DataTable, Spinner, StatusBadge } from './primitives';
import { inr, pnlTone } from './tokens.js';

const NO_CAP = 1e9;
/** What the form takes for "no cap": a level no single lot's stop reaches. */
export const NO_CAP_FORM_VALUE = 100000;
const levelText = (r) => (r.noCap || r.level >= NO_CAP ? 'no cap (strategy stop)' : `${inr(r.level)} / lot`);
const signed = (v) => (v == null ? '—' : inr(v, { sign: true }));

export function SweepResult({ s, onApply }) {
    if (!s.ok) return <p className="text-xs text-fg-4" data-testid="stop-sweep-result">No sweep: {s.reason}.</p>;
    const low = s.lowestLoss;
    const h = s.holdout;
    const cur = s.rows.find((r) => r.current);
    const lowIsCurrent = cur && low.level === cur.level;
    const applyBtn = (level) => onApply && (
        <button type="button" className="ml-2 px-2 py-0.5 rounded border border-primary text-2xs text-primary-ink hover:bg-primary/10"
            onClick={() => onApply(level >= NO_CAP ? NO_CAP_FORM_VALUE : level)}>
            Use {level >= NO_CAP ? 'no cap' : `${inr(level)} / lot`}
        </button>
    );
    return (
        <div className="space-y-3" data-testid="stop-sweep-result">
            <p className="text-xs text-fg-3">
                {lowIsCurrent ? (
                    <>Your current stop, <b className="text-fg">{levelText(low)}</b>, already loses least over this period: net{' '}
                        <b className={pnlTone(low.net)}>{signed(low.net)}</b> (worst trade {signed(low.worst)}, max drawdown {signed(low.maxDrawdown)}).</>
                ) : (
                    <>Lowest loss (best net) over the whole period: <b className="text-fg">{levelText(low)}</b> → net{' '}
                        <b className={pnlTone(low.net)}>{signed(low.net)}</b>, <span className={pnlTone(low.vsCurrent)}>{signed(low.vsCurrent)}</span> vs your
                        current {inr(s.current)} / lot. Its worst trade {signed(low.worst)}, max drawdown {signed(low.maxDrawdown)}
                        {cur ? <> (current: {signed(cur.worst)}, {signed(cur.maxDrawdown)})</> : null}.
                        {applyBtn(low.level)}</>
                )}
            </p>
            {h && (
                <p className="text-xs text-fg-3" data-testid="stop-sweep-holdout">
                    <StatusBadge level={h.held ? 'good' : 'warning'}>{h.held ? 'held up' : 'did not hold up'}</StatusBadge>{' '}
                    Chosen on the first {s.split.trainTrades} trades only (before {s.split.testFrom}): <b className="text-fg">{levelText(h)}</b>.
                    {' '}On the {s.split.testTrades} later trades it never saw it made <b className={pnlTone(h.test)}>{signed(h.test)}</b>
                    {h.currentTest != null && <> vs <b>{signed(h.currentTest)}</b> with your current stop ({h.testVsCurrent === 0 ? 'the same level' : signed(h.testVsCurrent)})</>}.
                    {h.held ? ' A level that wins on trades it was not chosen on is more than a fit to the past.' : ' The whole-period best is hindsight; treat it as a hypothesis.'}
                    {!h.held || h.level === s.current ? null : applyBtn(h.level)}
                </p>
            )}
            <DataTable dense maxHeight={340} rows={s.rows.map((r) => ({ ...r, _key: String(r.level) }))}
                columns={[
                    { key: 'level', header: 'Stop per lot', render: (r) => (
                        <span className={r.current ? 'font-semibold text-fg' : ''}>
                            {levelText(r)}{r.current ? ' · current' : ''}{r.level === low.level ? ' ★' : ''}{h && r.level === h.level ? ' ✓' : ''}
                        </span>) },
                    { key: 'trades', header: 'Trades', align: 'right' },
                    { key: 'stopExits', header: <span title="Trades that exited on their stop-loss">Stopped</span>, align: 'right' },
                    { key: 'capped', header: <span title="Trades whose stop this cap tightened">Capped</span>, align: 'right' },
                    { key: 'net', header: 'Net', align: 'right', render: (r) => <span className={pnlTone(r.net)}>{signed(r.net)}</span> },
                    { key: 'vs', header: 'vs current', align: 'right', render: (r) => (cur ? <span className={pnlTone(r.net - cur.net)}>{r.current ? '—' : signed(Math.round((r.net - cur.net) * 100) / 100)}</span> : '—') },
                    { key: 'worst', header: 'Worst trade', align: 'right', render: (r) => signed(r.worst) },
                    { key: 'maxDrawdown', header: 'Max drawdown', align: 'right', render: (r) => signed(r.maxDrawdown) },
                    ...(s.split ? [
                        { key: 'train', header: `First ${s.split.trainTrades}`, align: 'right', render: (r) => <span className={pnlTone(r.train)}>{signed(r.train)}</span> },
                        { key: 'test', header: `Last ${s.split.testTrades}`, align: 'right', render: (r) => <span className={pnlTone(r.test)}>{signed(r.test)}</span> },
                    ] : []),
                ]} />
            <p className="text-3xs text-fg-5">
                ★ lowest loss over the whole period · ✓ chosen on the first part, checked on the rest. {s.method}.
                {(s.notes || []).map((n, i) => <span key={i}> {n}</span>)}
            </p>
        </div>
    );
}

/**
 * @param {{runParams: Object|null, onApply?: (perLot:number) => void}} props
 *   runParams: the exact request of the backtest on screen — the sweep re-runs THAT
 */
export default function StopLossSweepPanel({ runParams, onApply }) {
    const [st, setSt] = useState({ status: 'idle', key: null });
    const key = runParams ? JSON.stringify(runParams) : null;
    const cur = st.key === key ? st : { status: 'idle' };
    const run = async () => {
        if (!runParams) return;
        setSt({ status: 'running', key });
        try {
            const r = await axios.post(`${API_URL}/engine/backtest/run`, { ...runParams, stop_sweep: true, stop_sweep_only: true });
            if (r.data && r.data.error) setSt({ status: 'error', key, error: r.data.error });
            else setSt({ status: 'done', key, sweep: r.data.stopSweep });
        } catch (e) {
            setSt({ status: 'error', key, error: e?.response?.data?.error || e.message });
        }
    };
    // the result on screen can outlive the page's memory of its request (it is kept when you navigate away)
    if (!runParams) return <p className="text-xs text-fg-5">Run the backtest again to sweep its stop-loss — the settings of the run on screen are not known here.</p>;
    return (
        <div className="space-y-2" data-testid="stop-sweep">
            {cur.status === 'idle' && (
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={run} className="px-3 py-1.5 rounded text-xs font-medium bg-primary text-on-primary hover:opacity-90">
                        Find the stop-loss that loses least
                    </button>
                    <span className="text-2xs text-fg-5">Re-runs this backtest once per stop level (₹500–₹7,500 per lot, and no cap) — only the stop changes. Usually 10–60 s.</span>
                </div>
            )}
            {cur.status === 'running' && <Spinner label="Re-running the backtest at each stop level…" />}
            {cur.status === 'error' && (
                <p className="text-xs text-danger">Sweep failed: {cur.error} <button type="button" className="underline ml-1" onClick={run}>retry</button></p>
            )}
            {cur.status === 'done' && cur.sweep && <SweepResult s={cur.sweep} onApply={onApply} />}
        </div>
    );
}
