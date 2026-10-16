'use strict';
/**
 * strategyReviewPack — everything "Ask AI to Improve This Strategy" sends, and
 * the checks on what comes back.
 *
 *   buildEvidence(trades)      every breakdown the results page shows, plus a few
 *                              it does not (weekday, side, hold time, premium,
 *                              volume ratio, month), half-vs-half stability and
 *                              the trades themselves as compact CSV
 *   holdoutSplit(trades)       the last ~30% of trades, hidden from the AI so its
 *                              advice can be tested on data it never saw
 *   settingsCatalog(...)       every setting the AI may change, with meaning and
 *                              allowed values
 *   checkSuggestions(...)      drop / flag suggestions that are not settings, are
 *                              outside their allowed values, or have the wrong type
 *   compareRuns(...)           before vs after, on the hidden part, the seen part
 *                              and the whole period
 *
 * Pure functions — no React, no network — so each is unit-tested.
 */
import { ASSUMPTION_KEYS, GENERAL_SETTINGS, NO_EFFECT_IN_BACKTEST, STRATEGY_PARAM_HINTS, describeSpace, prettifyKey } from './settingGuide.js';

const IST_MS = 5.5 * 3600 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const r2 = (v) => Math.round(v * 100) / 100;

export const toMs = (t) => {
    if (t == null) return null;
    const ms = typeof t === 'number' ? t : Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
};
const ist = (ms) => new Date(ms + IST_MS);
export const istHour = (ms) => ist(ms).getUTCHours();
export const istDate = (ms) => ist(ms).toISOString().slice(0, 10);
const istTime = (ms) => ist(ms).toISOString().slice(11, 16);
export const pnlOf = (t) => {
    const v = Number(t?.net_pnl ?? t?.pnl);
    return Number.isFinite(v) ? v : 0;
};

/** Headline numbers for a set of trades (net P&L basis). */
export function summarize(trades) {
    const list = (trades || []).filter(t => toMs(t.entryTime) != null);
    const pnls = list.map(pnlOf);
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p <= 0);
    const net = pnls.reduce((a, b) => a + b, 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = -losses.reduce((a, b) => a + b, 0);
    let peak = 0, cum = 0, maxDd = 0, streak = 0, maxStreak = 0;
    for (const p of [...list].sort((a, b) => toMs(a.entryTime) - toMs(b.entryTime)).map(pnlOf)) {
        cum += p; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum);
        streak = p <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
    }
    return {
        trades: list.length,
        net: r2(net),
        win_pct: list.length ? Math.round((wins.length / list.length) * 1000) / 10 : null,
        avg: list.length ? r2(net / list.length) : null,
        avg_win: wins.length ? r2(grossWin / wins.length) : null,
        avg_loss: losses.length ? r2(-grossLoss / losses.length) : null,
        profit_factor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
        max_drawdown_rupees: r2(maxDd),
        max_losing_streak: maxStreak,
    };
}

/** Group trades → [{ bucket, trades, win_pct, net, avg }], in `order` when given. */
export function bucketRows(trades, keyFn, order = null) {
    const groups = new Map();
    for (const t of trades) {
        const k = keyFn(t);
        if (k == null) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
    }
    const keys = order ? order.filter(k => groups.has(k)) : [...groups.keys()].sort();
    return keys.map((k) => {
        const s = summarize(groups.get(k));
        return { bucket: k, trades: s.trades, win_pct: s.win_pct, net: s.net, avg: s.avg };
    });
}

const band = (v, edges, labels) => {
    if (v == null || !Number.isFinite(v)) return null;
    const i = edges.findIndex(e => v < e);
    return labels[i === -1 ? labels.length - 1 : i];
};

/**
 * Quartile bands of the trades' own values, so "entry premium" means something on
 * NIFTY (₹100s) and BANK NIFTY (₹1000s) alike. null when too few values to split.
 */
export function quantileBands(values, parts = 4) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (v.length < parts * 2) return null;
    const tidy = (x) => (x >= 100 ? Math.round(x / 10) * 10 : Math.round(x));
    const edges = [...new Set(Array.from({ length: parts - 1 }, (_, i) => tidy(v[Math.floor(((i + 1) * v.length) / parts)])))];
    const labels = [`<₹${edges[0]}`, ...edges.slice(1).map((e, i) => `₹${edges[i]}–${e}`), `₹${edges[edges.length - 1]}+`];
    return { edges, labels };
}

const exitFamily = (t) => String(t.reason || 'Unknown').replace(/\s*\(Intra\)\s*/i, '').trim() || 'Unknown';
const holdMin = (t) => {
    const a = toMs(t.entryTime), b = toMs(t.exitTime);
    return a != null && b != null && b >= a ? (b - a) / 60000 : null;
};
const volRatio = (t) => {
    const v = Number(t.volume), a = Number(t.avg_volume);
    return v > 0 && a > 0 ? v / a : null;
};

/** The trades as compact CSV (IST times) — only when there are few enough to fit a prompt. */
export function tradesCsv(trades, max = 200) {
    if (!trades.length || trades.length > max) return '';
    const rows = [...trades]
        .sort((a, b) => toMs(a.entryTime) - toMs(b.entryTime))
        .map((t) => {
            const ms = toMs(t.entryTime);
            const h = holdMin(t);
            const vr = volRatio(t);
            return [
                `${istDate(ms)} ${istTime(ms)}`, t.type || '',
                t.entryPrice != null ? Number(t.entryPrice).toFixed(2) : '',
                t.exitPrice != null ? Number(t.exitPrice).toFixed(2) : '',
                pnlOf(t).toFixed(0), exitFamily(t).replace(/,/g, ' '),
                h != null ? Math.round(h) : '', vr != null ? vr.toFixed(2) : '',
            ].join(',');
        });
    return ['entry_ist,side,prem_in,prem_out,net_pnl,exit,hold_min,vol_ratio', ...rows].join('\n');
}

/** Every breakdown + stability + CSV for a set of trades. */
export function buildEvidence(trades, { csvMax = 200 } = {}) {
    const list = (trades || []).filter(t => toMs(t.entryTime) != null)
        .sort((a, b) => toMs(a.entryTime) - toMs(b.entryTime));
    if (!list.length) return null;
    const half = Math.floor(list.length / 2);
    const fmtHalf = (part) => {
        const s = summarize(part);
        return `${s.trades} trades, ${s.win_pct}% win, net ₹${Math.round(s.net)}, avg ₹${Math.round(s.avg ?? 0)}`;
    };
    const breakdowns = {
        entry_hour: bucketRows(list, t => `${String(istHour(toMs(t.entryTime))).padStart(2, '0')}:00`),
        weekday: bucketRows(list, t => DOW[ist(toMs(t.entryTime)).getUTCDay()], DOW),
        side: bucketRows(list, t => t.type || null),
        exit_reason: bucketRows(list, exitFamily),
        hold_minutes: bucketRows(list, t => band(holdMin(t), [15, 30, 60], ['<15', '15-30', '30-60', '60+']), ['<15', '15-30', '30-60', '60+']),
        month: bucketRows(list, t => istDate(toMs(t.entryTime)).slice(0, 7)),
    };
    const prem = quantileBands(list.map(t => Number(t.entryPrice)));
    if (prem) breakdowns.entry_premium = bucketRows(list, t => band(Number(t.entryPrice), prem.edges, prem.labels), prem.labels);
    if (list.some(t => volRatio(t) != null)) {
        breakdowns.volume_ratio = bucketRows(list, t => band(volRatio(t), [1.5, 2, 3], ['<1.5x', '1.5-2x', '2-3x', '3x+']) ?? 'no volume', ['<1.5x', '1.5-2x', '2-3x', '3x+', 'no volume']);
    }
    return {
        period: { from: istDate(toMs(list[0].entryTime)), to: istDate(toMs(list[list.length - 1].entryTime)) },
        metrics: summarize(list),
        breakdowns,
        stability: half >= 5 ? { first_half: fmtHalf(list.slice(0, half)), second_half: fmtHalf(list.slice(half)) } : {},
        trades_csv: tradesCsv(list, csvMax),
    };
}

/** Hide the last `frac` of trades: { cutoffMs, cutoffDate, seen, hidden } — null if too few trades to split. */
export function holdoutSplit(trades, frac = 0.3, minTrades = 20) {
    const list = (trades || []).filter(t => toMs(t.entryTime) != null)
        .sort((a, b) => toMs(a.entryTime) - toMs(b.entryTime));
    if (list.length < minTrades) return null;
    const at = Math.floor(list.length * (1 - frac));
    // Cut on a day boundary so one day's trades never straddle the line.
    const day = istDate(toMs(list[at].entryTime));
    const cutoffMs = Date.parse(`${day}T00:00:00+05:30`);
    const seen = list.filter(t => toMs(t.entryTime) < cutoffMs);
    const hidden = list.filter(t => toMs(t.entryTime) >= cutoffMs);
    if (!seen.length || !hidden.length) return null;
    return { cutoffMs, cutoffDate: day, seen, hidden };
}

/** Compact attribution: the totals + the automatic findings. */
export function attributionSummary(att) {
    const o = att && !att.error ? att.overall : null;
    if (!o) return null;
    const pick = ['trades', 'netPnl', 'grossPnl', 'chargesRupees', 'slippageRupees', 'costDragRatio', 'deltaPnl', 'gammaPnl', 'vegaPnl', 'thetaPnl', 'residualPnl', 'avgBreakEvenPoints', 'targetBelowBreakEvenCount', 'targetKnownCount', 'winRate'];
    const overall = {};
    for (const k of pick) if (o[k] != null && Number.isFinite(Number(o[k]))) overall[k] = r2(Number(o[k]));
    const findings = (att.findings || []).map(f => ({ severity: f.severity, message: f.message, action: f.action })).filter(f => f.message);
    return { overall, findings };
}

/** Compact VIX bands + the chance test. */
export function vixSummary(vix) {
    const bands = vix?.breakdown?.bands || [];
    if (!bands.length) return null;
    return {
        bands: bands.filter(b => b.trades > 0).map(b => ({ bucket: `VIX ${b.band}`, trades: b.trades, win_pct: b.winRatePct, net: r2(b.netPnl ?? 0), avg: r2(b.avgPnlPerTrade ?? 0) })),
        p_rotation: vix.nullTest?.pRotation ?? null,
        p_shuffle: vix.nullTest?.pShuffle ?? null,
    };
}

/**
 * Every setting the AI may change: [{ key, label, group, current, type, allowed, default, what }].
 * `tunable` = the current values (assumptions removed); `tuning` = the backend's
 * { space, defaults } for this strategy (may be null — the guide still applies).
 */
export function settingsCatalog(tunable, tuning = null) {
    const space = tuning?.space || {};
    const defaults = tuning?.defaults || {};
    return Object.keys(tunable).filter(k => !ASSUMPTION_KEYS.includes(k) && !(k in NO_EFFECT_IN_BACKTEST)).sort().map((k) => {
        const g = GENERAL_SETTINGS[k];
        const sp = space[k];
        return {
            key: k,
            label: g?.label || prettifyKey(k),
            // Anything that is not a shared setting belongs to the strategy, even
            // when its sampler does not search it (range/time settings, buffers).
            group: g?.group || 'Strategy',
            current: tunable[k],
            type: sp?.type || g?.type || (typeof tunable[k] === 'boolean' ? 'bool' : typeof tunable[k] === 'number' ? 'float' : 'str'),
            allowed: describeSpace(sp) || g?.allowed || null,
            default: k in defaults ? defaults[k] : undefined,
            what: g?.what || STRATEGY_PARAM_HINTS[k] || null,
            _space: sp || null,
        };
    });
}

/** The assumptions the AI must treat as fixed, plus form settings this backtest does not apply. */
export function assumptionsOf(params) {
    const out = {};
    for (const k of ASSUMPTION_KEYS) if (params?.[k] != null && typeof params[k] !== 'object') out[k] = params[k];
    for (const [k, why] of Object.entries(NO_EFFECT_IN_BACKTEST)) if (params?.[k] != null) out[k] = `${params[k]} — no effect here: ${why}`;
    return out;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Check what came back. → [{ key, value, current, status, note }]
 *   status 'ok'       apply-able as is
 *   status 'warn'     apply-able but outside the optimizer's range (shown, unticked)
 *   status 'invalid'  not a setting / wrong type / not an allowed option — never applied
 */
export function checkSuggestions(suggested, catalog) {
    const byKey = Object.fromEntries((catalog || []).map(c => [c.key, c]));
    return Object.entries(suggested || {}).map(([key, raw]) => {
        const c = byKey[key];
        if (ASSUMPTION_KEYS.includes(key)) return { key, value: raw, current: undefined, status: 'invalid', note: 'a modelling assumption, not a strategy setting — ignored' };
        if (key in NO_EFFECT_IN_BACKTEST) return { key, value: raw, current: undefined, status: 'invalid', note: `has no effect in this backtest — ${NO_EFFECT_IN_BACKTEST[key]}` };
        if (!c) return { key, value: raw, current: undefined, status: 'invalid', note: 'not one of your settings — ignored' };
        const cur = c.current;
        let value = raw;
        if (typeof cur === 'number') {
            value = typeof raw === 'number' ? raw : parseFloat(raw);
            if (!Number.isFinite(value)) return { key, value: raw, current: cur, status: 'invalid', note: 'not a number' };
            if (c.type === 'int') value = Math.round(value);
        } else if (typeof cur === 'boolean') {
            value = raw === true || raw === 'true' || raw === 1;
        } else if (raw != null) {
            value = String(raw);
        }
        if (c.type === 'time' && !HHMM.test(String(value))) return { key, value, current: cur, status: 'invalid', note: 'not a time like 14:30' };
        const sp = c._space;
        if (sp?.type === 'enum' && !sp.options.includes(String(value))) return { key, value, current: cur, status: 'invalid', note: `must be one of ${sp.options.join(', ')}` };
        if (String(value) === String(cur)) return { key, value, current: cur, status: 'warn', note: 'same as now — no change' };
        if (sp && (sp.type === 'int' || sp.type === 'float') && (value < sp.min || value > sp.max)) {
            return { key, value, current: cur, status: 'warn', note: `outside the optimizer's range ${sp.min}–${sp.max} — untested territory` };
        }
        return { key, value, current: cur, status: 'ok', note: null };
    });
}

/** Before vs after: { hidden?, seen?, all } of { before, after } summaries. */
export function compareRuns(beforeTrades, afterTrades, cutoffMs = null) {
    const part = (list, pred) => summarize((list || []).filter(t => { const ms = toMs(t.entryTime); return ms != null && pred(ms); }));
    const out = { all: { before: summarize(beforeTrades || []), after: summarize(afterTrades || []) } };
    if (cutoffMs != null) {
        out.seen = { before: part(beforeTrades, ms => ms < cutoffMs), after: part(afterTrades, ms => ms < cutoffMs) };
        out.hidden = { before: part(beforeTrades, ms => ms >= cutoffMs), after: part(afterTrades, ms => ms >= cutoffMs) };
    }
    return out;
}
