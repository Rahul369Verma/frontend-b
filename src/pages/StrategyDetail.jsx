import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, ReferenceLine, Cell, LabelList,
} from 'recharts';
import {
    RefreshCw, Activity, TrendingUp, TrendingDown,
    Calendar as CalendarIcon, Clock, BarChart3, Table as TableIcon,
    CalendarDays, ChevronRight,
} from 'lucide-react';
import { useChartTheme } from '../theme/chartTheme.js';
import PnlCalendar from '../components/charts/PnlCalendar.jsx';
import { StatRow, StatTile, Tabs, PageHeader, Chip, ModeChip } from '../components/viz/primitives';
import { ROUTES, strategyDetailHref } from '../config/routes.js';
import { riskOpenMin, riskCloseMin } from '../config/marketSession.js';
import { API_URL } from '../config/api.js';
import { inr, istDateTime, rupeeTick } from '../components/viz/tokens';
import TradePathChart from '../components/viz/TradePathChart';
import DayEquityCurves from '../components/viz/DayEquityCurves';
import {
    normalizeSingleLegTrade, buildDayCurves, istDayStartMs, istDayOf, singleLegVoidReason,
} from '../utils/dayCurves';

// Upper bound on trades pulled in one shot. Per-symbol closed-trade counts are
// in the low hundreds today (busiest underlying ~180), so this covers them with
// wide headroom. If a symbol ever exceeds this, the UI surfaces a "showing N of
// TOTAL" banner (see `truncated` below) rather than silently computing KPIs on a
// partial set.
const PAGE_SIZE = 2000;

// ── Date helpers (IST) ────────────────────────────────────────────────────
// All times in the system are UTC; market analytics belong in IST (Asia/Kolkata).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const toIst = (utc) => new Date(new Date(utc).getTime() + IST_OFFSET_MS);
const istDayKey = (utc) => toIst(utc).toISOString().slice(0, 10); // "YYYY-MM-DD" in IST
/** Whole rupees, via the app's single rupee formatter (was a private copy). */
const fmtINR = (n) => inr(n, { dp: 0 });
const fmtPct = (n) => (n == null || !Number.isFinite(Number(n))) ? '—' : `${Number(n).toFixed(1)}%`;
const fmtNum = (n, d = 2) => (n == null || !Number.isFinite(Number(n))) ? '—' : Number(n).toFixed(d);

// Net P&L — prefers post-charges field when present, else gross.
// IMPORTANT: skip null/undefined explicitly. `Number(null) === 0` is finite,
// so a naive `Number(c); isFinite(v) → return` loop would return 0 on the
// first iteration whenever `net_pnl: null` is present (which is what the live
// engine writes today). That would mask the real `pnl` field and zero out
// every recent trade — see the KPI strip / Equity Curve regression where only
// trades MISSING the net_pnl field (older docs) rendered correctly.
const tradePnl = (t) => {
    if (t == null) return 0;
    const candidates = [t.net_pnl, t.pnl, t.gross_pnl];
    for (const c of candidates) {
        if (c == null) continue;       // null / undefined → fall through
        const v = Number(c);
        if (Number.isFinite(v)) return v;
    }
    return 0;
};

/**
 * The BOOKED result for the path chart — net_pnl ?? pnl (gross_pnl last, as the
 * day curves do) — AND which of them it is. Unlike tradePnl above (which the KPI
 * strip has always used) an absent value stays null here: the chart says "no
 * booked result" rather than drawing ₹0. The basis matters: pnl/gross_pnl are
 * BEFORE charges, so the chart must not call them a net "after charges".
 */
const bookedOf = (t) => {
    const read = (c) => {
        if (c == null || c === '') return null;
        const v = Number(c);
        return Number.isFinite(v) ? v : null;
    };
    const net = read(t?.net_pnl);
    if (net != null) return { value: net, basis: 'net' };
    const gross = read(t?.pnl) ?? read(t?.gross_pnl);
    if (gross != null) return { value: gross, basis: 'gross' };
    return { value: null, basis: null };
};

/** A trade_history doc in the one shape <TradePathChart> takes for both books. */
const toPathTrade = (t) => {
    const booked = bookedOf(t);
    return {
        entryAt: t.entryTime ?? null,
        exitAt: t.exitTime ?? null,
        netPnl: booked.value,
        bookedBasis: booked.basis,     // 'net' | 'gross' (no net_pnl recorded) | null
        maeRupees: t.maeRupees ?? null,
        mfeRupees: t.mfeRupees ?? null,
        path: Array.isArray(t.path) ? t.path : null,
        pathSource: t.pathSource ?? null,
        pathReason: t.pathReason ?? null,
    };
};

const DATE_RANGES = [
    { key: '7d',  label: 'Last 7 days',  days: 7 },
    { key: '30d', label: 'Last 30 days', days: 30 },
    { key: '90d', label: 'Last 90 days', days: 90 },
    { key: 'all', label: 'All time',     days: null },
];

const TAB_KEYS = [
    { key: 'equity',   label: 'Equity Curve',  icon: TrendingUp },
    { key: 'days',     label: 'Day by day',    icon: CalendarDays },
    { key: 'calendar', label: 'Calendar',      icon: CalendarIcon },
    { key: 'table',    label: 'Trades',        icon: TableIcon },
    { key: 'dist',     label: 'P&L · Hours',   icon: BarChart3 },
];

export default function StrategyDetail() {
    const { symbol: rawSymbol } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const symbol = decodeURIComponent(rawSymbol || '');

    // ── Deployment context (from the Results button on a deployment card) ──
    // When the user clicks "📊 Results" on a specific deployment we carry its
    // id / strategy / label in the query string so this page can scope to it.
    // All optional — opening /strategy/:symbol with no query still works
    // exactly like before (symbol-level analytics).
    const deploymentId = searchParams.get('deploymentId') || null;
    const qpStrategyName = searchParams.get('strategyName') || null;
    const qpLabel = searchParams.get('label') || null;

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [trades, setTrades] = useState([]);
    // { shown, total } — set when the server reports more matching trades than
    // we pulled, so we can warn that KPIs/charts reflect a partial set.
    const [truncated, setTruncated] = useState(null);
    // How many closed trades came back with a recorded path, a path rebuilt from
    // the option-chain archive, or none (and why). Null when the server did not
    // report it.
    const [pathCoverage, setPathCoverage] = useState(null);
    // The IST-midnight instant the loaded trades were cut at (null = all time),
    // so the day view can tell a whole day from one the range only grazes.
    const [rangeFromMs, setRangeFromMs] = useState(null);
    const [strategyMeta, setStrategyMeta] = useState(null); // { strategyName, tradeMode, isActive } from /api/engine/dashboard
    const [rangeKey, setRangeKey] = useState('all'); // default to All-time so historical trades show
    const [activeTab, setActiveTab] = useState('equity');
    // Scope of which trades to show. Three levels, narrowest last:
    //   'symbol'     — every trade on the underlying (always has data; default)
    //   'strategy'   — symbol + strategyName (works for historical trades too,
    //                  as long as strategyName was recorded — many legacy
    //                  option-symbol rows say 'Unknown')
    //   'deployment' — exact deploymentId (ONLY trades placed after deployment
    //                  tracking began — historical trades have no deploymentId)
    // Arriving WITH a deploymentId defaults to 'deployment' — the whole point
    // of clicking a specific deployment (e.g. breakout_range @5m vs @1m on the
    // same underlying) is seeing THAT deployment's P&L, not everything on the
    // symbol mixed together. Without an id, default to 'symbol' as before.
    const [scope, setScope] = useState(deploymentId ? 'deployment' : 'symbol');

    // ── All deployments (for the switcher dropdown + details card) ─────────
    // One fetch of /api/deployments powers: (a) a dropdown to jump between any
    // deployed strategy's results without going back to the dashboard, and
    // (b) the details card for the currently-scoped deployment.
    const [allDeployments, setAllDeployments] = useState([]);
    useEffect(() => {
        let cancelled = false;
        axios.get(`${API_URL}/deployments`)
            .then(res => {
                if (cancelled) return;
                const rows = Array.isArray(res.data) ? res.data : (res.data?.deployments || []);
                setAllDeployments(rows);
            })
            .catch(() => { /* dropdown simply doesn't render — page still works */ });
        return () => { cancelled = true; };
    }, []);
    const currentDeployment = useMemo(
        () => allDeployments.find(d => String(d._id) === String(deploymentId)) || null,
        [allDeployments, deploymentId]
    );
    // Switch to another deployment: same navigation contract as the
    // DeploymentsPanel Results button, so the page re-scopes cleanly (the
    // target may live on a DIFFERENT underlying — the route symbol comes
    // from the selected deployment, not the current page).
    const switchDeployment = useCallback((id) => {
        const d = allDeployments.find(x => String(x._id) === String(id));
        if (!d) return;
        setScope('deployment');
        navigate(strategyDetailHref({ symbol: d.symbol, deploymentId: d._id, strategyName: d.strategyName, label: d.name }));
    }, [allDeployments, navigate]);
    // The strategy name we scope by — query param wins (it reflects the exact
    // deployment the user clicked), else the symbol's current config.
    const scopeStrategyName = qpStrategyName || strategyMeta?.strategyName || null;

    // ── Pull the strategy config for this symbol so we can show name + mode ─
    const fetchConfig = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/engine/dashboard`);
            const cfg = res.data?.config?.activeParams?.[symbol] || null;
            setStrategyMeta(cfg);
            return cfg;
        } catch {
            return null;
        }
    }, [symbol]);

    // ── Pull trades for the selected scope + window ──
    // 'symbol' (default): ALL trades for the underlying. 'strategy': also
    // narrow by strategyName. 'deployment': narrow by exact deploymentId.
    const fetchTrades = useCallback(async (cfg) => {
        setLoading(true);
        setError(null);
        try {
            const rangeDef = DATE_RANGES.find(r => r.key === rangeKey);
            // withPath=1: attach each closed trade's P&L path (recorded, or
            // rebuilt from the option-chain archive) for the per-trade and
            // day-by-day charts. Opt-in so other callers pay nothing.
            const params = { symbol, limit: PAGE_SIZE, page: 1, withPath: 1 };
            const stratName = qpStrategyName || cfg?.strategyName || null;
            if (scope === 'deployment' && deploymentId) {
                params.deploymentId = deploymentId;
            } else if (scope === 'strategy' && stratName) {
                params.strategyName = stratName;
            }
            // Cut at IST MIDNIGHT, not at "now − N days": the server filters on
            // the exit instant, so a rolling cut (12:00 IST a week ago) drops that
            // day's morning trades while its afternoon ones still draw a curve
            // and a total that look like the whole day.
            let fromMs = null;
            if (rangeDef?.days) {
                fromMs = istDayStartMs(Date.now() - rangeDef.days * 24 * 3600 * 1000);
                params.from = new Date(fromMs).toISOString();
            }
            const res = await axios.get(`${API_URL}/trades`, { params });
            const all = Array.isArray(res.data?.trades) ? res.data.trades : [];
            setTrades(all);
            setRangeFromMs(fromMs);
            setPathCoverage(res.data?.pathCoverage && typeof res.data.pathCoverage === 'object' ? res.data.pathCoverage : null);
            const total = Number(res.data?.total);
            setTruncated(Number.isFinite(total) && total > all.length ? { shown: all.length, total } : null);
        } catch (e) {
            setError(e.message || 'Failed to load trades');
            setTrades([]);
            setTruncated(null);
            setPathCoverage(null);
        } finally {
            setLoading(false);
        }
    }, [symbol, rangeKey, scope, deploymentId, qpStrategyName]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const cfg = await fetchConfig();
            if (!cancelled) await fetchTrades(cfg);
        })();
        return () => { cancelled = true; };
    }, [fetchConfig, fetchTrades]);

    // ── Derived data ────────────────────────────────────────────────────────
    // Closed trades carry realised P&L (EXIT documents with status=CLOSED).
    // Anything still OPEN is the currently-live position(s).
    const { closed, openPos } = useMemo(() => {
        const closed = [];
        const openPos = [];
        for (const t of trades) {
            const status = String(t.status || '').toUpperCase();
            const action = String(t.action || '').toUpperCase();
            // CRITICAL: the engine writes ONE doc per trade. On ENTRY it's
            // {action:'ENTRY', status:'OPEN'}; on EXIT only `status` flips to
            // 'CLOSED' — `action` STAYS 'ENTRY'. So we must classify by
            // STATUS, not action. (The old `action === 'ENTRY' → open` check
            // misfiled every closed trade as open, blanking all the charts.)
            if (status === 'CLOSED') {
                closed.push(t);
            } else if (status === 'OPEN') {
                openPos.push(t);
            } else {
                // Legacy docs without a status field: infer from exit data.
                const hasExit = t.exitTime != null || t.exitPrice != null
                    || action === 'EXIT' || action === 'SELL';
                (hasExit ? closed : openPos).push(t);
            }
        }
        // Engine writes a single doc that is updated on EXIT; the same _id can appear
        // as ENTRY then CLOSED. After the EXIT update, status flips to CLOSED — so
        // both buckets ideally don't overlap. But on edge cases (system restart) we
        // dedupe by _id.
        const seen = new Set();
        const dedupedClosed = [];
        for (const t of closed) {
            const key = String(t._id || t.trade_id || `${t.symbol}-${t.entryTime}`);
            if (seen.has(key)) continue;
            seen.add(key);
            dedupedClosed.push(t);
        }
        // Sort ascending by exit time for equity/calendar plots.
        dedupedClosed.sort((a, b) => new Date(a.exitTime || a.timestamp).getTime() - new Date(b.exitTime || b.timestamp).getTime());
        return { closed: dedupedClosed, openPos };
    }, [trades]);

    const kpis = useMemo(() => {
        if (closed.length === 0) {
            return { total: 0, count: 0, wins: 0, losses: 0, winRate: 0, profitFactor: null, best: 0, worst: 0, avgWin: 0, avgLoss: 0, bestDay: null, worstDay: null };
        }
        let total = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0, best = -Infinity, worst = Infinity;
        const byDay = new Map();
        for (const t of closed) {
            const pnl = tradePnl(t);
            total += pnl;
            best = Math.max(best, pnl);
            worst = Math.min(worst, pnl);
            if (pnl > 0)   { wins++;   grossWin += pnl; }
            else if (pnl < 0) { losses++; grossLoss += Math.abs(pnl); }
            const day = istDayKey(t.exitTime || t.timestamp);
            byDay.set(day, (byDay.get(day) || 0) + pnl);
        }
        const winRate = (wins / (wins + losses || 1)) * 100;
        const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null; // null = no losing trades
        let bestDay = null, worstDay = null;
        let bestDayPnl = -Infinity, worstDayPnl = Infinity;
        for (const [day, pnl] of byDay) {
            if (pnl > bestDayPnl)  { bestDayPnl  = pnl; bestDay  = { day, pnl }; }
            if (pnl < worstDayPnl) { worstDayPnl = pnl; worstDay = { day, pnl }; }
        }
        return {
            total, count: closed.length, wins, losses, winRate, profitFactor,
            best, worst,
            avgWin:  wins   > 0 ? grossWin  / wins   : 0,
            avgLoss: losses > 0 ? grossLoss / losses : 0,
            bestDay, worstDay,
        };
    }, [closed]);

    const equitySeries = useMemo(() => {
        let cum = 0;
        return closed.map((t, i) => {
            cum += tradePnl(t);
            return {
                idx: i + 1,
                date: new Date(t.exitTime || t.timestamp).toISOString(),
                pnl:  Number(tradePnl(t).toFixed(2)),
                cum:  Number(cum.toFixed(2)),
            };
        });
    }, [closed]);

    // `[{ date, net }]` — the shape <PnlCalendar> takes, and the same shape both
    // analytics endpoints return, so the calendar has ONE input contract app-wide.
    const dailyPnl = useMemo(() => {
        const m = new Map();
        for (const t of closed) {
            const day = istDayKey(t.exitTime || t.timestamp);
            m.set(day, (m.get(day) || 0) + tradePnl(t));
        }
        return [...m.entries()].map(([date, net]) => ({ date, net }));
    }, [closed]);

    // The calendar takes a day COUNT, not this page's range key: it is shared with
    // the multileg panel and the portfolio page, neither of which has DATE_RANGES.
    const calendarDays = DATE_RANGES.find(r => r.key === rangeKey)?.days ?? null;

    // One P&L-vs-time curve per IST day. Open positions go in too so the "still
    // open" count is SHOWN beside the curves instead of silently missing; a doc
    // the normaliser cannot read is counted the same way, and so is a CLOSED doc
    // that was never a position (entry never filled) or whose exit is unknown
    // (recovery placeholder) — each would otherwise be a fake ₹0 trade on a day.
    const dayCurves = useMemo(() => {
        const norm = [];
        let unreadable = 0, entryFailed = 0, recoveryUnknown = 0;
        for (const t of [...closed, ...openPos]) {
            const why = singleLegVoidReason(t);
            if (why === 'entryFailed') { entryFailed++; continue; }
            if (why === 'recoveryUnknown') { recoveryUnknown++; continue; }
            const n = normalizeSingleLegTrade(t);
            if (n) norm.push(n); else unreadable++;
        }
        const res = buildDayCurves(norm);
        // A position carried out of a day BEFORE the date range brings that day
        // in with only itself: its other trades exited before the cut and were
        // never loaded. Such a day would read as complete, so it is not drawn —
        // and it is counted.
        let days = res?.days || [];
        let partialDays = 0;
        const firstDay = rangeFromMs != null ? istDayOf(rangeFromMs) : null;
        if (firstDay) {
            const kept = days.filter((d) => d.day >= firstDay);
            partialDays = days.length - kept.length;
            days = kept;
        }
        const grossFallback = res?.bookedBasis?.grossFallback;
        return {
            days,
            excluded: { ...(res?.excluded || {}), unreadable, entryFailed, recoveryUnknown, partialDays },
            grossFallback: typeof grossFallback === 'number' ? grossFallback : 0,
        };
    }, [closed, openPos, rangeFromMs]);

    const pnlHistogram = useMemo(() => buildHistogram(closed.map(tradePnl)), [closed]);

    const hourHeatmap = useMemo(() => buildHourHeatmap(closed), [closed]);

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-[94rem] mx-auto">
            {/* Header — back link is a real route (the results hub), not history */}
            <PageHeader
                className="mb-6"
                backTo={ROUTES.livePortfolio}
                backLabel="All results"
                icon={Activity}
                title={symbol}
                badges={(
                    <>
                        {(qpLabel || qpStrategyName || strategyMeta?.strategyName) && (
                            <span className="text-sm text-fg-4 font-normal">{qpLabel || qpStrategyName || strategyMeta?.strategyName}</span>
                        )}
                        {deploymentId && (
                            <Chip tone="info" title={`Deployment ${deploymentId}`}>deployment {String(deploymentId).slice(-6).toUpperCase()}</Chip>
                        )}
                        <ModeChip mode={strategyMeta?.tradeMode === 'PAPER_TRADE' ? 'PAPER' : strategyMeta?.tradeMode} />
                        {strategyMeta?.isActive === false && <Chip tone="muted" title="Deployment is switched off">INACTIVE</Chip>}
                    </>
                )}
                subtitle={loading ? 'Loading trades…' : `${closed.length} closed trades · ${openPos.length} open`}
                actions={(
                    <>
                    {/* Deployment switcher — every deployment in the DB, so the
                        SAME strategy at different resolutions (5m vs 1m) can be
                        compared per-deployment without going back to the
                        dashboard. Value = the deployment's unique DB id. */}
                    {allDeployments.length > 0 && (
                        <select
                            value={deploymentId || ''}
                            onChange={(e) => e.target.value && switchDeployment(e.target.value)}
                            className="bg-slate-800 border border-line rounded text-xs text-fg-2 px-2 py-1.5 max-w-[21.25rem]"
                            title="Jump to another deployment's results"
                        >
                            <option value="">— select deployment —</option>
                            {allDeployments.map(d => (
                                <option key={d._id} value={d._id}>
                                    {(d.name || `${d.symbol} · ${d.strategyName}`)}
                                    {` · ${d.params?.resolution || '?'}m · ${d.tradeMode || 'PAPER'}${d.isActive ? '' : ' · off'}`}
                                </option>
                            ))}
                        </select>
                    )}
                    {/* Scope toggle — narrowest scope last. 'deployment' is only
                        offered when we arrived from a specific deployment card
                        (deploymentId in the query). Historical trades have no
                        deploymentId, so that filter only covers trades placed
                        since deployment tracking began — hence 'symbol' default. */}
                    <div className="flex bg-slate-800 rounded border border-line overflow-hidden text-xs">
                        <button
                            onClick={() => setScope('symbol')}
                            className={`px-3 py-1.5 ${scope === 'symbol' ? 'bg-primary/20 text-primary-ink' : 'text-fg-4 hover:text-fg'}`}
                            title="Every trade on this underlying"
                        >
                            All on symbol
                        </button>
                        <button
                            onClick={() => setScope('strategy')}
                            disabled={!scopeStrategyName || scopeStrategyName === 'Unknown'}
                            className={`px-3 py-1.5 ${scope === 'strategy' ? 'bg-primary/20 text-primary-ink' : 'text-fg-4 hover:text-fg'} disabled:opacity-40 disabled:cursor-not-allowed`}
                            title={scopeStrategyName ? `Only ${scopeStrategyName} trades on this symbol` : 'No strategy name on these trades'}
                        >
                            This strategy
                        </button>
                        {deploymentId && (
                            <button
                                onClick={() => setScope('deployment')}
                                className={`px-3 py-1.5 ${scope === 'deployment' ? 'bg-primary/20 text-primary-ink' : 'text-fg-4 hover:text-fg'}`}
                                title="Only trades tagged with this exact deployment (since deployment tracking began)"
                            >
                                This deployment
                            </button>
                        )}
                    </div>
                    <div className="flex bg-slate-800 rounded border border-line overflow-hidden">
                        {DATE_RANGES.map(r => (
                            <button
                                key={r.key}
                                onClick={() => setRangeKey(r.key)}
                                className={`px-3 py-1.5 text-xs ${rangeKey === r.key ? 'bg-primary/20 text-primary-ink' : 'text-fg-4 hover:text-fg'}`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => fetchConfig().then((cfg) => fetchTrades(cfg))}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded border border-line text-fg-3"
                        title="Refresh"
                        disabled={loading}
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    </>
                )}
            />

            {error && (
                <div className="mb-4 p-3 bg-red-900/20 border border-red-700/50 rounded text-danger text-sm">
                    {error}
                </div>
            )}

            {/* Deployment details — WHICH deployment these results belong to.
                Shown whenever the page is scoped to a deployment, so 5m vs 1m
                runs of the same strategy are unambiguous at a glance. */}
            {scope === 'deployment' && currentDeployment && (
                <div className="mb-4 p-3 bg-violet-900/15 border border-violet-700/40 rounded flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-3">
                    <span className="text-violet-300 font-semibold">{currentDeployment.name || currentDeployment.strategyName}</span>
                    <span>id <span className="font-mono text-fg-4" title={String(currentDeployment._id)}>{String(currentDeployment._id).slice(-8)}</span></span>
                    <span>strategy <span className="text-fg">{currentDeployment.strategyName}</span></span>
                    <span>resolution <span className="text-fg">{currentDeployment.params?.resolution || '?'}m</span></span>
                    <span>mode <span className={currentDeployment.tradeMode === 'LIVE' ? 'text-danger' : 'text-blue-300'}>{currentDeployment.tradeMode || 'PAPER'}</span></span>
                    <span>{currentDeployment.isActive ? <span className="text-success">active</span> : <span className="text-fg-5">inactive</span>}</span>
                    {currentDeployment.params?.lots != null && <span>lots <span className="text-fg">{currentDeployment.params.lots}</span></span>}
                    {currentDeployment.params?.sl_points != null && <span>SL <span className="text-fg">{currentDeployment.params.sl_points}</span></span>}
                    {currentDeployment.params?.tp_points != null && <span>TP <span className="text-fg">{currentDeployment.params.tp_points}</span></span>}
                    {currentDeployment.createdAt && <span>deployed <span className="text-fg-4">{new Date(currentDeployment.createdAt).toLocaleDateString('en-IN')}</span></span>}
                    {currentDeployment.updatedAt && <span>updated <span className="text-fg-4">{new Date(currentDeployment.updatedAt).toLocaleDateString('en-IN')}</span></span>}
                </div>
            )}

            {truncated && (
                <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded text-warning text-xs">
                    Showing the newest {truncated.shown.toLocaleString()} of {truncated.total.toLocaleString()} matching trades.
                    KPIs and charts reflect this subset — narrow the date range for a complete view of an older window.
                </div>
            )}

            {/* KPI strip */}
            <KpiStrip kpis={kpis} openCount={openPos.length} />

            {/* Tabs */}
            <Tabs className="mb-4" ariaLabel="Result views"
                tabs={TAB_KEYS.map((t) => ({ id: t.key, label: t.label, icon: t.icon }))}
                value={activeTab} onChange={setActiveTab} />

            {/* Tab content */}
            <div className="bg-surface rounded-xl border border-line p-6 min-h-[400px]">
                {closed.length === 0 && !loading ? (
                    <div className="text-center text-fg-5 py-12">
                        <div>
                            No closed trades found for {symbol}
                            {scope === 'strategy' && scopeStrategyName ? ` under strategy "${scopeStrategyName}"` : ''}
                            {scope === 'deployment' ? ' for this deployment' : ''}
                            {' '}in the selected window.
                        </div>
                        {scope === 'deployment' && (
                            <div className="text-xs text-fg-5 mt-1">
                                Historical trades placed before deployment tracking began aren't tagged with a deployment id.
                            </div>
                        )}
                        {scope !== 'symbol' && (
                            <button
                                onClick={() => setScope('symbol')}
                                className="mt-3 text-xs text-primary-ink hover:underline"
                            >
                                Show all trades on this symbol →
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {activeTab === 'equity'   && <EquityCurveView data={equitySeries} />}
                        {activeTab === 'days'     && (
                            <>
                                <PathCoverageLine coverage={pathCoverage} />
                                {dayCurves.grossFallback > 0 && (
                                    <p className="text-3xs text-warning -mt-2 mb-3">
                                        {dayCurves.grossFallback} trade{dayCurves.grossFallback === 1 ? ' has' : 's have'} no net_pnl recorded, so
                                        {dayCurves.grossFallback === 1 ? ' its' : ' their'} gross pnl (before charges) is used as the booked result;
                                        at {dayCurves.grossFallback === 1 ? 'its' : 'their'} exit the step from the last mark is fill slippage only, with no charges in it.
                                    </p>
                                )}
                                <DayEquityCurves days={dayCurves.days} excluded={dayCurves.excluded} markBasis="pre-cost"
                                    emptyText="No closed trade with a booked P&L in this window." />
                            </>
                        )}
                        {activeTab === 'calendar' && <PnlCalendar daily={dailyPnl} rangeDays={calendarDays} />}
                        {activeTab === 'table'    && <TradesTable trades={[...closed].reverse()} openPos={openPos} pathCoverage={pathCoverage} />}
                        {activeTab === 'dist'     && <DistributionView histogram={pnlHistogram} hourMap={hourHeatmap} kpis={kpis} />}
                    </>
                )}
            </div>
        </div>
    );
}

// ── KPI strip ──────────────────────────────────────────────────────────────
function KpiStrip({ kpis, openCount }) {
    const tone = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral');
    const pf = kpis.profitFactor;
    return (
        <div className="mb-5">
            <StatRow cols={8}>
                <StatTile label="Total P&L" value={fmtINR(kpis.total)} tone={tone(kpis.total)} hero />
                <StatTile label="Trades" value={String(kpis.count)} hint={`${openCount} open`} />
                <StatTile label="Win rate" value={fmtPct(kpis.winRate)} hint={`${kpis.wins}W · ${kpis.losses}L`} />
                <StatTile label="Profit factor" value={pf == null ? '∞' : fmtNum(pf)}
                    tone={pf == null ? 'neutral' : pf >= 1 ? 'positive' : 'negative'}
                    hint={pf == null ? 'no losses' : 'gross win ÷ gross loss'} />
                <StatTile label="Best trade" value={fmtINR(kpis.best)} tone="positive" />
                <StatTile label="Worst trade" value={fmtINR(kpis.worst)} tone="negative" />
                <StatTile label="Best day" value={kpis.bestDay ? fmtINR(kpis.bestDay.pnl) : '—'} hint={kpis.bestDay?.day || ''} tone="positive" />
                <StatTile label="Worst day" value={kpis.worstDay ? fmtINR(kpis.worstDay.pnl) : '—'} hint={kpis.worstDay?.day || ''} tone="negative" />
            </StatRow>
        </div>
    );
}

// ── Equity Curve View ──────────────────────────────────────────────────────
function EquityCurveView({ data }) {
    // Recharts axis/grid/tooltip colours are SVG attributes and plain style
    // objects — they cannot be var(), so they are resolved per theme here.
    const ct = useChartTheme();
    if (!data.length) return <div className="text-fg-5">No data.</div>;
    return (
        <div>
            <h2 className="text-base font-semibold text-fg-2 mb-3">Cumulative P&L</h2>
            <ResponsiveContainer width="100%" height={420}>
                <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" />
                    <XAxis
                        dataKey="idx"
                        stroke={ct.axis}
                        tick={{ fontSize: ct.type['2xs'], fill: ct.text.secondary }}
                        label={{ value: 'Trade #', position: 'insideBottom', offset: -5, fill: ct.text.secondary, fontSize: ct.type['2xs'] }}
                    />
                    <YAxis
                        stroke={ct.axis}
                        tick={{ fontSize: ct.type['2xs'], fill: ct.text.secondary }}
                        tickFormatter={rupeeTick}
                    />
                    <Tooltip
                        contentStyle={ct.tooltipStyle({ fontSize: ct.type['xs'] })}
                        formatter={(v, name) => [fmtINR(v), name === 'cum' ? 'Cumulative' : 'Trade P&L']}
                        labelFormatter={(idx) => `Trade #${idx} · ${istDateTime(data[idx - 1]?.date)}`}
                    />
                    <ReferenceLine y={0} stroke={ct.axis} strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="cum" stroke={ct.categorical[0]} strokeWidth={2} dot={false} name="cum" />
                </LineChart>
            </ResponsiveContainer>
            <div className="text-xs text-fg-5 mt-2">
                Each point = one trade exit. Line = cumulative realised P&L. The 0-line is the break-even threshold.
            </div>
        </div>
    );
}

// ── Trades Table ──────────────────────────────────────────────────────────
/**
 * Sort affordance for a column header.
 *
 * Declared at module scope, NOT inside TradesTable. A component defined during
 * render is a brand-new component type on every render, so React unmounts and
 * remounts it rather than updating it — it cannot hold state, and it throws away
 * its DOM each time the parent re-renders (which this table does on every sort,
 * filter and poll).
 */
function SortIcon({ col, sortBy, sortDir }) {
    if (sortBy !== col) return null;
    return <span className="text-fg-5 ml-1" aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>;
}

/**
 * A sortable column header.
 *
 * The click target is a real <button> inside the <th>, not an onClick on the
 * <th> itself: a bare onClick on a non-interactive element is unreachable by
 * keyboard and announces nothing. `aria-sort` on the <th> is what a screen
 * reader actually reads to say which column is sorted and which way.
 */
function SortableTh({ col, sortBy, sortDir, onSort, className = '', children }) {
    const active = sortBy === col;
    return (
        <th
            className={className}
            aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            scope="col"
        >
            <button
                type="button"
                onClick={() => onSort(col)}
                className="inline-flex items-center hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xs"
            >
                {children}
                <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
            </button>
        </th>
    );
}

/**
 * One line saying where the trades' P&L paths came from.
 *
 * Paths are recorded only by engines deployed after 28-Sep; everything older is
 * either rebuilt from the 1-minute option-chain archive or has none. The split is
 * stated, with the commonest reasons for "none", so an empty chart is never read
 * as "this trade did nothing".
 */
function PathCoverageLine({ coverage }) {
    if (!coverage) {
        return (
            <p className="text-3xs text-fg-5 mb-3">
                Trade paths: the server did not report path coverage, so each chart shows only what its trade stored.
            </p>
        );
    }
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-IN') : '—');
    const reasons = coverage.reasons && typeof coverage.reasons === 'object' ? Object.entries(coverage.reasons) : [];
    const ranked = reasons.filter(([, c]) => typeof c === 'number' && c > 0).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 3);
    const rest = ranked.length - top.length;
    const capped = typeof coverage.capped === 'number' && coverage.capped > 0 ? coverage.capped : 0;
    return (
        <p className="text-3xs text-fg-5 mb-3">
            Trade paths: <span className="text-fg-3">{n(coverage.recorded)} recorded</span>
            {' · '}<span className="text-warning" title="Reconstructed from the 1-minute option-chain archive — approximate, pre-cost">{n(coverage.archive)} rebuilt from archived quotes</span>
            {' · '}<span className="text-fg-4">{n(coverage.none)} none</span>
            {top.length > 0 && (
                <> ({top.map(([r, c]) => `${r}: ${c}`).join(', ')}{rest > 0 ? `, +${rest} other reason${rest === 1 ? '' : 's'}` : ''})</>
            )}
            {capped > 0 && <>{' · '}<span className="text-warning">{n(capped)} not attempted (over the per-request rebuild cap)</span></>}
        </p>
    );
}

function TradesTable({ trades, openPos, pathCoverage }) {
    const [filter, setFilter] = useState('all'); // all | wins | losses
    const [sortBy, setSortBy] = useState('exitTime');
    const [sortDir, setSortDir] = useState('desc');
    // Rows whose P&L path is expanded, keyed like the <tr>s.
    const [openRows, setOpenRows] = useState(() => new Set());
    const toggleRow = useCallback((key) => {
        setOpenRows((s) => {
            const n = new Set(s);
            if (n.has(key)) n.delete(key); else n.add(key);
            return n;
        });
    }, []);

    const filtered = useMemo(() => {
        let rows = trades;
        if (filter === 'wins')   rows = rows.filter(t => tradePnl(t) > 0);
        if (filter === 'losses') rows = rows.filter(t => tradePnl(t) < 0);
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const getVal = (t) => {
                if (sortBy === 'pnl')      return tradePnl(t);
                if (sortBy === 'exitTime') return new Date(t.exitTime || t.timestamp).getTime();
                if (sortBy === 'entryTime') return new Date(t.entryTime || t.timestamp).getTime();
                return 0;
            };
            return (getVal(a) - getVal(b)) * dir;
        });
    }, [trades, filter, sortBy, sortDir]);

    const toggleSort = (col) => {
        if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(col); setSortDir('desc'); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold text-fg-2">Trades</h2>
                <div className="flex bg-slate-800 rounded border border-line overflow-hidden text-xs">
                    {['all', 'wins', 'losses'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 capitalize ${filter === f ? 'bg-primary/20 text-primary-ink' : 'text-fg-4 hover:text-fg'}`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>
            <PathCoverageLine coverage={pathCoverage} />
            {openPos.length > 0 && (
                <div className="mb-3 p-3 bg-blue-900/20 border border-blue-700/40 rounded">
                    <div className="text-xs text-blue-300 font-semibold mb-1">{openPos.length} open position(s):</div>
                    {openPos.map((p, i) => (
                        <div key={i} className="text-xs text-fg-3">
                            {p.tradingsymbol || p.symbol} · {p.type || p.side} · qty {p.quantity} · entry ₹{fmtNum(p.entryPrice ?? p.price)} · since {new Date(p.entryTime || p.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </div>
                    ))}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-line text-fg-4 text-2xs uppercase">
                            <th className="px-1 py-2 w-6" scope="col"><span className="sr-only">P&amp;L path</span></th>
                            <SortableTh col="entryTime" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="px-2 py-2 text-left">Entry</SortableTh>
                            <SortableTh col="exitTime" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="px-2 py-2 text-left">Exit</SortableTh>
                            <th className="px-2 py-2 text-left">Contract</th>
                            <th className="px-2 py-2 text-left">Side</th>
                            <th className="px-2 py-2 text-right">Qty</th>
                            <th className="px-2 py-2 text-right">In</th>
                            <th className="px-2 py-2 text-right">Out</th>
                            <SortableTh col="pnl" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="px-2 py-2 text-right">P&L</SortableTh>
                            <th className="px-2 py-2 text-left">Reason</th>
                            <th className="px-2 py-2 text-left">AI</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.slice(0, 200).map((t, i) => {
                            const pnl = tradePnl(t);
                            const pnlCls = pnl > 0 ? 'text-success' : pnl < 0 ? 'text-danger' : 'text-fg-3';
                            const rowKey = String(t._id || t.trade_id || i);
                            const isOpen = openRows.has(rowKey);
                            const panelId = `trade-path-${rowKey}`;
                            const what = `${shortSymbol(t.tradingsymbol || t.symbol)} ${shortTime(t.entryTime || t.timestamp)}`;
                            const src = t.pathSource === 'recorded' ? 'recorded path'
                                : t.pathSource === 'archive' ? 'path rebuilt from archived quotes'
                                : Array.isArray(t.path) && t.path.length ? 'path' : 'no path stored';
                            return (
                                <React.Fragment key={rowKey}>
                                <tr className="border-b border-line-0 hover:bg-slate-800/40">
                                    <td className="px-1 py-1.5">
                                        <button type="button" onClick={() => toggleRow(rowKey)}
                                            aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined}
                                            aria-label={`${isOpen ? 'Hide' : 'Show'} P&L path for ${what}`}
                                            title={`${isOpen ? 'Hide' : 'Show'} P&L while open (${src})`}
                                            className="p-0.5 rounded text-fg-5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                            <ChevronRight className={`w-3.5 h-3.5 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                                        </button>
                                    </td>
                                    <td className="px-2 py-1.5 text-fg-3">{shortTime(t.entryTime || t.timestamp)}</td>
                                    <td className="px-2 py-1.5 text-fg-3">{shortTime(t.exitTime || t.timestamp)}</td>
                                    <td className="px-2 py-1.5 text-fg-3 font-mono">{shortSymbol(t.tradingsymbol || t.symbol)}</td>
                                    <td className="px-2 py-1.5">
                                        <span className={`px-1.5 py-0.5 rounded text-3xs ${(t.type || t.side) === 'CE' || (t.side === 'CALL') ? 'bg-emerald-900/40 text-success' : 'bg-red-900/40 text-danger'}`}>
                                            {t.type || t.side}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-fg-4">{t.quantity ?? '—'}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-4">{fmtNum(t.entryPrice ?? t.price)}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-4">{fmtNum(t.exitPrice)}</td>
                                    <td className={`px-2 py-1.5 text-right font-bold ${pnlCls}`}>{fmtINR(pnl)}</td>
                                    <td className="px-2 py-1.5 text-fg-4 max-w-[11.25rem] truncate" title={t.reason}>{t.reason || '—'}</td>
                                    <td className="px-2 py-1.5 text-fg-4">
                                        {t.ai_decision ? (
                                            <span title={t.ai_reasoning || ''} className="text-3xs">
                                                {t.ai_decision} {t.ai_confidence ? `${Math.round(t.ai_confidence)}%` : ''}
                                            </span>
                                        ) : '—'}
                                    </td>
                                </tr>
                                {isOpen && (
                                    <tr id={panelId} className="border-b border-line-0 bg-slate-900/40">
                                        <td colSpan={11} className="px-2 py-2">
                                            <TradePathChart trade={toPathTrade(t)} />
                                        </td>
                                    </tr>
                                )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
                {filtered.length > 200 && (
                    <div className="text-center text-fg-5 text-xs py-3">
                        Showing first 200 of {filtered.length} trades.
                    </div>
                )}
            </div>
        </div>
    );
}

// ── P&L Distribution + Hour Heatmap ───────────────────────────────────────
function buildHistogram(pnls) {
    if (!pnls.length) return [];
    // Bins symmetric around zero, width chosen from the range.
    const max = Math.max(...pnls.map(Math.abs));
    if (max === 0) {
        return [{ bin: '₹0', count: pnls.length, isPositive: false, range: 'all trades = ₹0', lo: 0, hi: 0 }];
    }
    // Adaptive bin count — 13 bins on a 5-trade dataset spreads things too
    // thin and makes two close-magnitude losses (which legitimately share
    // a bin) look like "only one loss". Always odd so 0 sits in a center bin.
    let nBins;
    if      (pnls.length <= 5)  nBins = 5;
    else if (pnls.length <= 12) nBins = 7;
    else if (pnls.length <= 25) nBins = 9;
    else if (pnls.length <= 50) nBins = 11;
    else                        nBins = 13;
    const half = Math.floor(nBins / 2);
    const binWidth = max / half;
    const buckets = new Array(nBins).fill(0);
    for (const p of pnls) {
        let i = Math.floor(p / binWidth) + half;
        if (i < 0) i = 0;
        if (i >= nBins) i = nBins - 1;
        buckets[i]++;
    }
    return buckets.map((count, i) => {
        const lo     = (i - half) * binWidth;
        const hi     = (i - half + 1) * binWidth;
        const center = (lo + hi) / 2;
        return {
            // X-axis label is the bin RANGE (not the center) so users don't
            // misread "-₹1,276" as "the loss was exactly -₹1,276".
            bin: `${fmtINR(lo)}…${fmtINR(hi)}`,
            count,
            isPositive: center > 0,
            center, lo, hi,
            range: `${fmtINR(lo)} → ${fmtINR(hi)}`,
        };
    });
}

/** minutes-of-day → 'HH:MM', so the heatmap caption states the window it actually drew. */
const hhmmOf = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function buildHourHeatmap(closed) {
    // 5-min buckets across the NSE session × weekday, DERIVED from the session
    // config. It was a hard-coded 75 slots (09:15-15:30); since 3-Aug-2026 the
    // derivatives session runs to 15:40, so every trade entered at or after 15:30
    // fell past the last bucket and was SILENTLY DISCARDED by the `continue`
    // below — a row vanishing out of an analytics grid with nothing said.
    const slotStartMin = riskOpenMin('NSE');
    const SLOTS = Math.ceil((riskCloseMin('NSE') - slotStartMin) / 5);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    // grid[day][slot] = { count, pnl }
    const grid = days.map(() => Array.from({ length: SLOTS }, () => ({ count: 0, pnl: 0 })));
    const outside = [];   // never dropped silently — see below
    for (const t of closed) {
        const ts = new Date(t.entryTime || t.timestamp);
        const ist = toIst(ts);
        const dow = ist.getUTCDay(); // 0=Sun, 1=Mon, ...
        if (dow < 1 || dow > 5) continue;
        const dayIdx = dow - 1;
        const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        const slot = Math.floor((mins - slotStartMin) / 5);
        // Anything still outside the session (a bad timestamp, a pre-open fill) is
        // COUNTED and reported, never dropped on the floor.
        if (slot < 0 || slot >= SLOTS) { outside.push({ at: t.entryTime || t.timestamp, pnl: tradePnl(t) }); continue; }
        grid[dayIdx][slot].count++;
        grid[dayIdx][slot].pnl += tradePnl(t);
    }
    return { grid, days, slotStartMin, outside };
}

function hourCellColor(cell) {
    if (cell.count === 0) return 'bg-slate-800/60 border-line-0';
    if (cell.pnl > 0) {
        if (cell.pnl > 5000) return 'bg-emerald-500 border-emerald-400';
        if (cell.pnl > 1500) return 'bg-emerald-600/80 border-emerald-500';
        if (cell.pnl > 500)  return 'bg-emerald-700/60 border-emerald-600';
        return 'bg-emerald-900/40 border-emerald-800';
    }
    if (cell.pnl < 0) {
        if (cell.pnl < -5000) return 'bg-red-500 border-red-400';
        if (cell.pnl < -1500) return 'bg-red-600/80 border-red-500';
        if (cell.pnl < -500)  return 'bg-red-700/60 border-red-600';
        return 'bg-red-900/40 border-red-800';
    }
    return 'bg-slate-700 border-line-2';
}

function DistributionView({ histogram, hourMap, kpis }) {
    const ct = useChartTheme();
    return (
        <div className="space-y-8">
            {/* P&L Distribution */}
            <div>
                <h2 className="text-base font-semibold text-fg-2 mb-3">Trade P&L Distribution</h2>
                <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={histogram} margin={{ top: 24, right: 20, bottom: 30, left: 10 }}>
                        <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" />
                        {/* Each tick is now a RANGE (e.g. "-₹1,392…-₹1,160"), not a single
                            point — so users don't read the center as "the exact loss". */}
                        <XAxis
                            dataKey="bin"
                            stroke={ct.axis}
                            tick={{ fontSize: ct.type['3xs'], fill: ct.text.secondary }}
                            angle={-30}
                            textAnchor="end"
                            interval={0}
                        />
                        <YAxis stroke={ct.axis} tick={{ fontSize: ct.type['2xs'], fill: ct.text.secondary }} allowDecimals={false} />
                        <Tooltip
                            cursor={{ fill: ct.alpha(ct.text.secondary, 0.08) }}
                            contentStyle={ct.tooltipStyle({ fontSize: ct.type['xs'] })}
                            formatter={(v, _name, ctx) => [
                                `${v} trade${v === 1 ? '' : 's'}`,
                                ctx?.payload?.range || 'range',
                            ]}
                            labelFormatter={() => ''}
                        />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                            {/* Show the count above every non-empty bar so the
                                "two losses in one bin" case is immediately legible
                                (instead of a single bar that looks like one trade). */}
                            <LabelList
                                dataKey="count"
                                position="top"
                                fill={ct.text.primary}
                                fontSize={11}
                                formatter={(v) => (v > 0 ? v : '')}
                            />
                            {histogram.map((b, i) => (
                                <Cell key={i} fill={b.isPositive ? ct.diverging.positive : ct.diverging.negative} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
                <div className="text-3xs text-fg-5 mt-1">
                    Each bar = a P&L <span className="text-fg-4">range</span>, not a single trade. A bar of height N means N trades fell into that range — hover for the exact bracket.
                </div>
                <div className="mt-3">
                    <StatRow cols={4}>
                        <StatTile label="Avg win" value={fmtINR(kpis.avgWin)} tone="positive" />
                        <StatTile label="Avg loss" value={fmtINR(-kpis.avgLoss)} tone="negative" />
                        <StatTile label="Win rate" value={fmtPct(kpis.winRate)} />
                        <StatTile label="Profit factor" value={kpis.profitFactor == null ? '∞' : fmtNum(kpis.profitFactor)}
                            tone={kpis.profitFactor == null ? 'neutral' : kpis.profitFactor >= 1 ? 'positive' : 'negative'} />
                    </StatRow>
                </div>
            </div>

            {/* Hour-of-day Heatmap */}
            <div>
                <h2 className="text-base font-semibold text-fg-2 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Hour-of-Day Performance
                </h2>
                <div className="overflow-x-auto">
                    <div className="inline-block min-w-full">
                        {/* Time axis */}
                        <div className="flex gap-px ml-12 mb-1 text-4xs text-fg-5">
                            {Array.from({ length: hourMap.grid[0]?.length || 0 }).map((_, slot) => {
                                const m = hourMap.slotStartMin + slot * 5;
                                const showLabel = slot % 12 === 0;
                                return (
                                    <div key={slot} className="w-3 text-center">
                                        {showLabel ? `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` : ''}
                                    </div>
                                );
                            })}
                        </div>
                        {hourMap.days.map((day, di) => (
                            <div key={day} className="flex items-center gap-px mb-px">
                                <div className="w-10 text-3xs text-fg-5 text-right pr-2">{day}</div>
                                {hourMap.grid[di].map((cell, slot) => {
                                    const m = hourMap.slotStartMin + slot * 5;
                                    const timeStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                                    return (
                                        <div
                                            key={slot}
                                            className={`w-3 h-4 rounded-sm border ${hourCellColor(cell)}`}
                                            title={`${day} ${timeStr} · ${cell.count} trade(s) · ${fmtINR(cell.pnl)}`}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="text-3xs text-fg-5 mt-2">
                    5-minute buckets across the NSE session ({hhmmOf(hourMap.slotStartMin)} → {hhmmOf(hourMap.slotStartMin + (hourMap.grid[0]?.length || 0) * 5)} IST).
                    Cell colour = net P&L for entries in that bucket across all selected days.
                </div>
                {/* Anything outside the grid is NAMED, not dropped. The grid used to
                    end at 15:30 and silently discard every later entry. */}
                {hourMap.outside?.length > 0 && (
                    <div className="text-3xs text-warning/80 mt-1">
                        ⚠ {hourMap.outside.length} trade(s) entered outside the session window and are not in this grid
                        ({fmtINR(hourMap.outside.reduce((a, o) => a + (o.pnl || 0), 0))} net) — check their timestamps.
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Small helpers ─────────────────────────────────────────────────────────
function shortTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function shortSymbol(s) {
    if (!s) return '—';
    return String(s).replace(/^[A-Z]+:/, '');
}
