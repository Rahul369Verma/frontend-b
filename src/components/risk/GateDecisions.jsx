/**
 * GateDecisions — the direction gate's latest verdicts, read from the journal
 * (direction_gate_decisions), so they survive a restart. The card used to read
 * the engine's memory and said "No signals since the engine started" after every
 * deploy, even with decisions on record.
 *
 * "Then" says what became of EVERY verdict, not only the blocks (server:
 * src/domain/risk/directionGateDecisions.js): an ALLOW or PROBE that traded is joined
 * to its trade and result, one that did not says why (its skip log, or the closed
 * entry window). That answers "the gate was enforcing — how did these trades get
 * through?": Allowed = the side was above the floor; Probe = let through on purpose.
 */
import React, { useCallback, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Chip, Spinner, Placeholder, DataTable } from '../viz/primitives';
import { istDateTime } from '../viz/tokens.js';
import { usePolling } from '../../hooks/usePolling.js';

const TONE = { ALLOW: 'good', PROBE: 'info', BLOCK: 'critical', THIN: 'muted', UNMEASURED: 'warning', OFF: 'muted' };
const MEANING = {
    ALLOW: 'Trusted enough — the trade went ahead.',
    BLOCK: 'Weak side — blocked (Enforce) or only recorded (Shadow).',
    PROBE: 'Weak side, but let through on purpose as a test trade so the side can earn confidence back.',
    THIN: 'Too few recent trades on this side to judge — the trade went ahead.',
    UNMEASURED: 'No fresh reading — the gate stayed out of the way.',
};
const OUTCOME = { GHOST: 'followed at real prices', GHOST_SLOT_BUSY: 'not followed (one already followed)', SKIPPED_LATER: 'a later check stopped it anyway', NOT_TRACKED: 'not followed' };
const THEN_TONE = { traded: 'text-fg-3', skipped: 'text-fg-4', blocked: 'text-fg-4', unknown: 'text-warning' };
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const idx = (s) => String(s || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '').replace(/^NIFTY50$/, 'NIFTY').replace(/^NIFTYBANK$/, 'BANKNIFTY');
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const BTN = 'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg';

export function GateDecisionsView({ data, limit = 8 }) {
    const [all, setAll] = useState(false);
    if (!data) return null;
    const rows = data.rows || [];
    const shown = all ? rows : rows.slice(0, limit);
    return (
        <div className="space-y-1.5" data-testid="gate-decisions">
            <h3 className="text-xs font-semibold text-fg-2">Latest gate decisions{data.total ? ` (${data.total} on record)` : ''}</h3>
            {data.counts && (
                <p className="text-2xs text-fg-4" data-testid="gate-decision-counts">
                    Of the {rows.length} shown: {data.counts.traded} became trades (Allowed, Probe or Thin — the gate let them through),
                    {' '}{data.counts.blocked} were blocked, {data.counts.skipped} were let through but stopped by a later check
                    {data.counts.unknown ? <>, <span className="text-warning">{data.counts.unknown} with no record of what happened</span></> : ''}.
                    {' '}In Enforce mode a trade still happens when its side is at or above the floor, or as a Probe (every few weak signals one goes through on purpose).
                </p>
            )}
            <DataTable dense rows={shown.map((d) => ({ ...d, _key: d.decisionId || d.at }))}
                empty="No decisions recorded yet — the gate records one on every entry signal while it is on."
                columns={[
                    { key: 'at', header: 'When (IST)', render: (d) => istDateTime(d.at) },
                    { key: 'strategy', header: 'Strategy', render: (d) => d.strategy || '—' },
                    { key: 'symbol', header: 'Index', render: (d) => `${idx(d.symbol) || '—'} ${d.side || ''}` },
                    { key: 'decision', header: 'Verdict', render: (d) => (
                        <Chip tone={TONE[d.decision] || 'neutral'} title={[MEANING[d.decision], d.reason ? `Engine: ${d.reason}` : null].filter(Boolean).join('\n')}>
                            {d.decision}{d.enforced ? ' · blocked' : d.decision === 'BLOCK' ? ' · shadow' : ''}
                        </Chip>) },
                    { key: 'confidence', header: 'Confidence', align: 'right', render: (d) => pct(d.confidence) },
                    { key: 'outcome', header: 'Then', render: (d) => (d.then
                        ? <span className={money(d.then.net) != null && d.then.net !== 0 ? (d.then.net < 0 ? 'text-danger' : 'text-success') : (THEN_TONE[d.then.kind] || 'text-fg-4')}
                            title={d.then.inferred ? 'Worked out from the decision time and the deployment\'s entry window (the engine\'s own note was not saved)' : undefined}>
                            {d.then.text}{d.then.inferred ? ' *' : ''}</span>
                        : (d.outcome ? OUTCOME[d.outcome] || d.outcome : '—')) },
                ]} />
            {rows.length > limit && <button type="button" className={BTN} onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
        </div>
    );
}

export default function GateDecisions() {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const load = useCallback(async () => {
        try { const r = await axios.get(`${API_URL}/analytics/direction-confidence/decisions`, { params: { limit: 50 } }); setData(r.data); setErr(null); }
        catch (e) { setErr(e?.response?.data?.error || e.message); }
    }, []);
    usePolling(load, 60000);
    return (
        <>
            {err && <Placeholder>Could not load gate decisions: {err}</Placeholder>}
            {!data && !err && <Spinner label="Loading gate decisions…" />}
            <GateDecisionsView data={data} />
        </>
    );
}
