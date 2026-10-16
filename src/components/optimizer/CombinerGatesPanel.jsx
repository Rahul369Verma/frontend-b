import React from 'react';
import { StatusBadge, DataTable } from '../viz/primitives';
import DocLink from '../DocLink.jsx';

const nameOf = (s) => String(s || '').replace(/^.*:/, '').replace('-INDEX', '');
const score = (v) => (v == null || !Number.isFinite(Number(v)) ? '−∞ (not robust)' : Number(v).toFixed(3));

/**
 * A signal combiner's crown gates on one index (backend pooledRun.runCombinerGates):
 * (1) it must beat each of its members run alone, (2) random selection from the same members at
 * its trade count must not do as well (p ≤ 0.05). A combiner that fails stays listed but is never
 * crowned — this panel says which gate failed and by how much.
 */
export function CombinerGates({ gates, symbol = null }) {
    if (!gates) return null;
    const n = gates.null || {};
    return (
        <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
                <StatusBadge level={gates.pass ? 'good' : 'warning'}>{gates.pass ? 'Crownable' : 'Not crowned'}</StatusBadge>
                {symbol && <span className="text-fg-4">{nameOf(symbol)}</span>}
                <span className="text-fg-4">{gates.verdict}</span>
                <DocLink to="signal-combiner#gates" />
            </div>
            {gates.drawId != null && (
                <p className="text-fg-5">
                    Best robust setting: draw {gates.drawId}, {gates.trades} trades, held-out score {score(gates.combinerScore)} (after its selection haircut).
                    {gates.bestMember ? ` Best member alone: ${gates.bestMember} (${gates.beatsBestMemberBy != null && Number.isFinite(gates.beatsBestMemberBy) ? `${gates.beatsBestMemberBy >= 0 ? 'beaten by' : 'ahead by'} ${Math.abs(gates.beatsBestMemberBy).toFixed(3)}` : 'no robust member'}).` : ''}
                </p>
            )}
            {(gates.members || []).length > 0 && (
                <DataTable dense columns={[
                    { key: 'label', header: 'Member alone' },
                    { key: 'trades', header: 'Trades', align: 'right' },
                    { key: 'deflatedNoTrials', header: 'Held-out score', align: 'right', render: m => (m.error ? <span className="text-danger">{m.error}</span> : score(m.deflatedNoTrials)) },
                    { key: 'oosPnL', header: 'Held-out P&L', align: 'right', render: m => (m.oosPnL == null ? '—' : Math.round(m.oosPnL).toLocaleString('en-IN')) },
                ]} rows={gates.members.map((m, i) => ({ ...m, _key: `${i}` }))} />
            )}
            {n.runs > 0 && (
                <p className="text-fg-5">
                    Chance: {n.runs} runs picking the same members' signals at random (p accept {n.pAccept}, aiming at {n.targetTrades} trades, got {n.tradesRange ? n.tradesRange.join('–') : '—'});
                    {' '}{n.atLeastAsGood} scored at least as well → p = {n.pValue}.
                </p>
            )}
        </div>
    );
}

/** Multi-index runs: the combiner's gates on every index, and whether it could be crowned. */
export default function CombinerCrownPanel({ result }) {
    const rows = (result?.indexes || []).map(ix => ({ symbol: ix.symbol, s: (ix.strategies || []).find(x => x.strategy === 'signal_combiner') })).filter(r => r.s);
    if (!rows.length) return null;
    const cc = result.combinerCrown;
    return (
        <div className="bg-surface border border-line/60 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-fg">Signal combiner — crown gates</h3>
            {cc && <p className="text-xs text-fg-4">Passed on {cc.gatePasses} of the eligible indexes; needs {cc.k}. {cc.blocked ? 'It cannot take the shared crown in this run.' : 'It may take the shared crown.'}</p>}
            {rows.map(r => (r.s.combinerGates
                ? <CombinerGates key={r.symbol} gates={r.s.combinerGates} symbol={r.symbol} />
                : <p key={r.symbol} className="text-xs text-fg-5">{nameOf(r.symbol)}: no gates (status {r.s.status}).</p>))}
        </div>
    );
}
