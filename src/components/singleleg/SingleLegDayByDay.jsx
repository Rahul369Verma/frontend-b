/**
 * SingleLegDayByDay — the single-leg book's day-by-day curves on Live Portfolio:
 * one P&L-vs-time curve per IST day, every trade of that day listed under it with
 * "India VIX while held", and the India VIX toggle (DayEquityCurves owns it).
 *
 * The same builder StrategyDetail uses (utils/dayCurves.js), over the same trades
 * (GET /api/trades?withPath=1 — recorded paths, else rebuilt from the archived option
 * chain). Fetched only when this section is open (its Card folds), because rebuilding
 * paths reads the archive. Nothing is dropped silently: never-filled entries, unknown
 * recovery exits, unreadable rows and days cut by the window are counted beside it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Spinner } from '../viz/primitives';
import DayEquityCurves from '../viz/DayEquityCurves';
import { normalizeSingleLegTrade, buildDayCurves, istDayOf, singleLegVoidReason } from '../../utils/dayCurves';

/** The window's start (ms) — "All" is capped at 90 days here, and says so. */
const ALL_CAP_DAYS = 90;

function Coverage({ c }) {
    if (!c) return <p className="text-3xs text-fg-5">Trade paths: the server did not report path coverage, so each chart shows only what its trade stored.</p>;
    const reasons = Object.entries(c.reasons || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return (
        <p className="text-3xs text-fg-5">
            Trade paths: <span className="text-fg-3">{c.recorded ?? 0} recorded by the engine</span>
            {' · '}<span className="text-warning" title="Rebuilt from the 1-minute option-chain archive — approximate, pre-cost">{c.archive ?? 0} rebuilt from archived quotes</span>
            {' · '}{c.none ?? 0} none{reasons.length ? ` (${reasons.map(([r, n]) => `${r}: ${n}`).join(', ')})` : ''}
            {c.capped > 0 && <> · <span className="text-warning">{c.capped} not attempted (over the per-request rebuild cap)</span></>}
        </p>
    );
}

export default function SingleLegDayByDay({ days = 30, deploymentId = null }) {
    const capped = days === 'all';
    const span = capped ? ALL_CAP_DAYS : Number(days) || 30;
    const key = JSON.stringify([span, deploymentId]);
    const [res, setRes] = useState({ key: null, trades: null, coverage: null, err: null, fromMs: null });
    useEffect(() => {
        let dead = false;
        const fromMs = Date.now() - span * 86400e3;     // the window starts when it is asked for
        const params = { withPath: 1, limit: 2000, page: 1, from: new Date(fromMs).toISOString() };
        if (deploymentId) params.deploymentId = deploymentId;
        axios.get(`${API_URL}/trades`, { params, timeout: 120000 })
            .then((r) => { if (!dead) setRes({ key, fromMs, trades: r.data?.trades || r.data?.data || [], coverage: r.data?.pathCoverage || null, err: null, total: r.data?.total }); })
            .catch((e) => { if (!dead) setRes({ key, fromMs, trades: null, coverage: null, err: e?.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [key, span, deploymentId]);
    const fresh = res.key === key;
    const fromMs = res.fromMs;

    const curves = useMemo(() => {
        if (!fresh || !res.trades) return null;
        const norm = [];
        let unreadable = 0, entryFailed = 0, recoveryUnknown = 0, legacy = 0;
        for (const t of res.trades) {
            if (t.status !== 'CLOSED' && t.status !== 'OPEN') { legacy++; continue; }
            const why = singleLegVoidReason(t);
            if (why === 'entryFailed') { entryFailed++; continue; }
            if (why === 'recoveryUnknown') { recoveryUnknown++; continue; }
            const n = normalizeSingleLegTrade(t);
            if (n) norm.push(n); else unreadable++;
        }
        const b = buildDayCurves(norm);
        const first = fromMs != null ? istDayOf(fromMs) : null;
        const all = b?.days || [];
        const kept = first ? all.filter((d) => d.day >= first) : all;
        return {
            days: kept,
            excluded: { ...(b?.excluded || {}), unreadable, entryFailed, recoveryUnknown, partialDays: all.length - kept.length, legacy },
            grossFallback: b?.bookedBasis?.grossFallback || 0,
        };
    }, [fresh, res.trades, fromMs]);

    if (fresh && res.err) return <p className="text-xs text-danger" role="alert">Could not load the trades for the day curves: {res.err}</p>;
    if (!curves) return <Spinner label="Loading each trade's minute-by-minute path (recorded, or rebuilt from archived quotes)…" />;
    return (
        <div className="space-y-2">
            {capped && <p className="text-3xs text-warning">The “All” window is shown here for the last {ALL_CAP_DAYS} days only — each trade's path is rebuilt on request from the option-chain archive, which keeps 180 days.</p>}
            <Coverage c={res.coverage} />
            {res.total > res.trades.length && <p className="text-3xs text-warning">{res.total - res.trades.length} older trades in this window were not loaded (2,000-row limit).</p>}
            {curves.excluded.legacy > 0 && <p className="text-3xs text-fg-5">{curves.excluded.legacy} old-format row(s) (separate entry/exit rows) are not drawn as curves.</p>}
            {curves.grossFallback > 0 && (
                <p className="text-3xs text-warning">
                    {curves.grossFallback} trade{curves.grossFallback === 1 ? ' has' : 's have'} no charges recorded, so the P&amp;L before charges is used as the booked result.
                </p>
            )}
            <DayEquityCurves days={curves.days} excluded={curves.excluded} markBasis="pre-cost"
                emptyText="No closed trade with a booked P&L in this window." />
        </div>
    );
}
