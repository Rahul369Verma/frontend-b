'use strict';
/**
 * Pure helpers shared by the single-leg round-trips table, the Dashboard's Trade
 * History and the trade journey panel. The server sends each row a `view`
 * (backend/logic/analytics/singleLegTradeQuery.js rowView): these only turn it into
 * words and tones — they never recompute a number.
 */
import { inr } from '../viz/tokens.js';

const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Elapsed hold, '—' when unknown. */
export function holdText(ms) {
    const x = fin(ms);
    if (x == null || x < 0) return '—';
    const m = Math.round(x / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The status chip: what kind of row this is. */
export function kindChip(kind) {
    switch (kind) {
        case 'open': return { label: 'OPEN', tone: 'live', title: 'Still open — its result is booked at exit' };
        case 'closed': return { label: 'CLOSED', tone: 'muted', title: 'A complete round trip' };
        case 'legacy-entry': return { label: 'OLD · ENTRY', tone: 'muted', title: 'Old format: this row is only the ENTRY of a trade; its exit is a separate row' };
        case 'legacy-exit': return { label: 'OLD · EXIT', tone: 'muted', title: 'Old format: this row is only the EXIT of a trade; its entry is a separate row' };
        default: return { label: 'OLD', tone: 'muted', title: 'Old format row' };
    }
}

/** A gate verdict chip. Allowed trades say WHY they were allowed in enforce mode. */
export function gateChip(g) {
    if (!g || !g.decision) return null;
    const pct = (v) => (fin(v) == null ? '?' : `${Math.round(v * 100)}%`);
    const conf = g.confidence != null ? ` · ${pct(g.confidence)}` : '';
    const mode = g.mode === 'enforce' ? 'enforce' : g.mode === 'shadow' ? 'shadow' : g.mode || '';
    const base = { mode };
    switch (g.decision) {
        case 'ALLOW': return { ...base, label: `Allowed${conf}`, tone: 'good', title: `Direction gate (${mode}): this side's confidence ${pct(g.confidence)} was at or above the ${pct(g.floor)} floor, so the trade went ahead.` };
        case 'PROBE': return { ...base, label: `Probe${conf}`, tone: 'info', title: `Direction gate (${mode}): this side was weak (${pct(g.confidence)} < ${pct(g.floor)}), but every few weak signals one is let through on purpose as a test trade, so the side can earn confidence back.` };
        case 'THIN': return { ...base, label: 'Thin data', tone: 'muted', title: `Direction gate (${mode}): too few recent trades on this side to judge, so it went ahead.` };
        case 'UNMEASURED': return { ...base, label: 'Unmeasured', tone: 'warning', title: `Direction gate (${mode}): no fresh confidence reading at the time, so the gate stayed out of the way.` };
        case 'BLOCK': return { ...base, label: g.enforced ? 'Blocked' : `Would block${conf}`, tone: g.enforced ? 'critical' : 'warning', title: g.enforced ? 'Blocked by the direction gate.' : `Shadow mode: the gate would have blocked this (confidence ${pct(g.confidence)} < ${pct(g.floor)}), but shadow never blocks.` };
        case 'OFF': return { ...base, label: 'Gate off', tone: 'muted', title: 'The direction gate was off.' };
        default: return { ...base, label: g.decision, tone: 'muted', title: g.reason || '' };
    }
}

/** The P&L cell: value, its basis, and whether it may be trusted. */
export function pnlCell(view) {
    const v = view || {};
    if (v.void) return { text: v.net == null ? '—' : inr(v.net), sub: 'void', tone: 'muted', strike: true, title: 'Not a real result — see the flag on this row.' };
    if (v.net == null) {
        if (v.kind === 'open') return { text: '—', sub: 'open', tone: 'muted', title: 'Still open — the result is booked at exit.' };
        if (v.kind === 'legacy-entry') return { text: '—', sub: 'entry row', tone: 'muted', title: 'An old-format ENTRY row has no result of its own; it is on the matching EXIT row.' };
        return { text: '—', sub: null, tone: 'muted', title: 'No P&L was recorded.' };
    }
    return {
        text: inr(v.net, { sign: true }),
        sub: v.basis === 'gross' ? 'before charges' : null,
        tone: v.net > 0 ? 'pos' : v.net < 0 ? 'neg' : 'flat',
        title: v.basis === 'gross' ? 'Charges were not recorded on this trade (they are, per trade, since 23 Sep 2026): this is its P&L before charges.' : 'Net P&L, after charges.',
    };
}

/** Flag → chip tone. */
export function flagTone(code) {
    if (code === 'price-is-index' || code === 'no-exit-time' || code === 'entry-failed') return 'critical';
    if (code === 'orphan' || code === 'recovery' || code === 'cleanup' || code === 'broker-sync' || code === 'day-change') return 'warning';
    return 'muted';
}

/** The short index name of a spot symbol (NSE:NIFTY50-INDEX → NIFTY). */
export function shortIndex(sym) {
    return String(sym || '').replace(/^(NSE|BSE|MCX):/, '').replace(/-INDEX$/, '').replace(/^NIFTY50$/, 'NIFTY').replace(/^NIFTYBANK$/, 'BANKNIFTY');
}

/** The contract without its exchange prefix. */
export function shortContract(sym) {
    return String(sym || '—').replace(/^(NSE|BSE|MCX):/, '');
}

/** The single-leg doc in the one shape <TradePathChart> takes for both books. */
export function toPathTrade(t, extra = {}) {
    const netRec = fin(t?.net_pnl);
    const gross = fin(t?.pnl);
    return {
        entryAt: t?.entryTime ?? null,
        exitAt: t?.exitTime ?? null,
        netPnl: netRec ?? gross,
        bookedBasis: netRec != null ? 'net' : gross != null ? 'gross' : null,
        maeRupees: t?.maeRupees ?? null,
        mfeRupees: t?.mfeRupees ?? null,
        path: Array.isArray(t?.path) ? t.path : null,
        pathSource: extra.pathSource ?? t?.pathSource ?? null,
        pathReason: extra.pathReason ?? t?.pathReason ?? null,
        symbol: t?.symbol ?? null,
    };
}

/** The IST trading days a hold covers (at most `max`), for the VIX request. */
export function istDaysBetween(fromMs, toMs, max = 5) {
    if (!Number.isFinite(fromMs)) return [];
    const end = Number.isFinite(toMs) && toMs >= fromMs ? toMs : fromMs;
    const IST = 5.5 * 3600e3;
    const days = [];
    for (let t = fromMs; days.length < max; t += 86400e3) {
        const d = new Date(t + IST).toISOString().slice(0, 10);
        if (!days.includes(d)) days.push(d);
        if (t > end) break;
    }
    const last = new Date(end + IST).toISOString().slice(0, 10);
    return days.filter((d) => d <= last).slice(0, max);
}

/** A deployment's lots (params.lots), 1 when unset. */
export const lotsOf = (d) => { const n = Number(d?.params?.lots); return Number.isInteger(n) && n > 0 ? n : 1; };
/** The per-LOT stop cap (max_single_trade_loss) for a per-TRADE rupee level. */
export const perLotFor = (level, d) => Math.max(50, Math.round(Number(level) / lotsOf(d)));
