/**
 * useTradeVix — India VIX (1-minute bars, via GET /api/market/vix-days) for the IST days
 * one trade covers, with the reason when there is none. Shared by the single-leg trade
 * journey and the multi-leg round-trip card, so both books show VIX the same way.
 *
 * At most `maxDays` days are fetched (the endpoint's intraday limit); `truncated` says so
 * when a held position spans more, instead of quietly drawing part of it.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchVixDays } from './useVixDays.js';
import { istDaysBetween } from '../components/singleleg/singleLegFormat.js';

export default function useTradeVix(entryMs, exitMs, { maxDays = 5 } = {}) {
    const days = useMemo(() => istDaysBetween(entryMs, exitMs ?? entryMs, maxDays), [entryMs, exitMs, maxDays]);
    const all = useMemo(() => istDaysBetween(entryMs, exitMs ?? entryMs, 400), [entryMs, exitMs]);
    const key = days.join(',');
    const [st, setSt] = useState({ key: null, points: null, reason: null });
    useEffect(() => {
        if (!key) return undefined;
        let dead = false;
        fetchVixDays({ days: key.split(','), intraday: key.split(',') })
            .then((body) => {
                if (dead) return;
                const pts = [];
                const reasons = [];
                for (const d of key.split(',')) {
                    const day = body?.days?.[d];
                    if (Array.isArray(day?.intraday)) pts.push(...day.intraday);
                    else if (day?.reason) reasons.push(day.reason);
                }
                const warn = Array.isArray(body?.warnings) && body.warnings.length ? body.warnings[0] : null;
                setSt({ key, points: pts.length ? pts : null, reason: pts.length ? null : (reasons[0] || warn || 'no 1-minute India VIX for these days') });
            })
            .catch((e) => { if (!dead) setSt({ key, points: null, reason: `India VIX request failed: ${e?.response?.data?.error || e.message}` }); });
        return () => { dead = true; };
    }, [key]);
    const truncated = all.length > days.length ? { shown: days.length, held: all.length } : null;
    return st.key === key ? { ...st, truncated } : { key, points: null, reason: null, loading: !!key, truncated };
}
