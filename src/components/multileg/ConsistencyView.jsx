/**
 * ConsistencyView — does an Auto-optimize result make money in rising, falling AND sideways
 * markets, and in most months, or did one market or one month carry it? (user, 27-Oct-2026:
 * "these strategies are not consistent because this year was in down trend — I want consistent
 * strategies in the list"). Verdicts come from the run itself (consistency on) or from a later
 * "Check consistency" (POST /api/multileg/optimize/:jobId/consistency-check).
 */
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Spinner } from '../viz/primitives';
import { TIER, marketParts, monthText, mixText } from './consistencyFormat.js';

/** The verdict as a badge with its reasons; `compact` = the badge alone (tables). */
export function ConsistencyBadge({ v, compact = false }) {
    if (!v) return compact ? <span className="text-fg-5" title="Not measured: a run from before the consistency check. Use Check consistency above.">—</span> : null;
    const t = TIER[v.tier] || TIER[2];
    if (compact) return <span className={t.cls.split(' ')[0]} title={[v.label, ...(v.why || [])].join(' · ')}>{t.text.slice(0, 1)}</span>;
    return (
        <div className={`text-2xs mb-2 px-2 py-1 rounded border ${t.cls}`} data-testid="consistency-badge">
            <div className="font-semibold">{t.text}{v.tier === 0 ? ' — profitable in rising, falling and sideways markets' : ''}</div>
            {(v.why || []).map((w, i) => <div key={i}>{w}</div>)}
            <div className="mt-0.5 text-fg-4">
                {marketParts(v).map((p) => (
                    <span key={p.key} className="mr-2"><span className={p.n ? (p.net >= 0 ? 'text-success' : 'text-danger') : 'text-fg-5'}>{p.arrow}</span> {p.text}</span>
                ))}
            </div>
            {monthText(v) && <div className="text-fg-5">{monthText(v)}</div>}
        </div>
    );
}

/** The market mix of the run's range, per symbol — a range with few rising days cannot test a strategy there. */
export function MarketMix({ markets, rules }) {
    const entries = Object.entries(markets || {});
    if (!entries.length) return null;
    return (
        <div className="text-2xs text-fg-4" data-testid="market-mix">
            Market in this range (each day by the index&apos;s move over the previous {entries[0][1].lookback || 20} sessions):{' '}
            {entries.map(([s, m]) => mixText(s, m)).join(' · ')}.
            {rules ? ` A strategy is consistent when it is profitable in each market (at least ${rules.minTradesPerMarket} trades in each) and no single month carries more than ${Math.round(100 * rules.maxBestMonthShare)}% of its profit.` : ''}
        </div>
    );
}

/** "Check consistency" for a run made before the check: re-measures its listed strategies, polled. */
export function ConsistencyCheckBar({ jobId, count, checked, onDone }) {
    const [st, setSt] = useState({ status: 'idle' });
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), [jobId]);
    const poll = () => {
        axios.get(`${API_URL}/multileg/optimize/${jobId}/consistency-check`, { timeout: 20000 })
            .then((r) => {
                setSt(r.data);
                if (r.data.status === 'done') onDone?.();
                else if (['loading', 'running'].includes(r.data.status)) timer.current = setTimeout(poll, 2000);
            })
            .catch((e) => setSt({ status: 'failed', error: e.response?.data?.error || e.message }));
    };
    const start = () => {
        setSt({ status: 'loading', note: 'starting' });
        axios.post(`${API_URL}/multileg/optimize/${jobId}/consistency-check`, {}, { timeout: 20000 })
            .then(() => { timer.current = setTimeout(poll, 1500); })
            .catch((e) => setSt({ status: 'failed', error: e.response?.data?.error || e.message }));
    };
    const busy = ['loading', 'running'].includes(st.status);
    return (
        <div className="flex flex-wrap items-center gap-2 text-2xs" data-testid="consistency-check">
            <button type="button" onClick={start} disabled={busy}
                className="px-2 py-1 rounded border border-sky-700/50 bg-sky-900/20 text-sky-300 hover:bg-sky-900/40 disabled:opacity-50">
                {checked ? 'Check consistency again' : `Check consistency of these ${count} strategies`}
            </button>
            {!busy && st.status !== 'failed' && (
                <span className="text-fg-5">
                    {checked ? `Checked ${new Date(checked).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST.` : 'This run is from before the consistency check.'}
                    {' '}Replays each one over the run&apos;s range, split by rising / falling / sideways market and by month. Takes about a minute.
                </span>
            )}
            {busy && <Spinner size="xs" label={st.note || 'Checking…'} />}
            {st.status === 'failed' && <span className="text-danger">Check failed: {st.error}</span>}
        </div>
    );
}
