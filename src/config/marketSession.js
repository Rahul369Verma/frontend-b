'use strict';
/**
 * marketSession (frontend mirror) — the shape of a trading day, for the UI.
 *
 * THE AUTHORITY IS THE BACKEND. `backend/logic/marketSession.js` owns these
 * values and is env-overridable there; this file exists only because the browser
 * cannot import server code. Keep the two tables identical.
 *
 * DRIFT IS DETECTABLE, NOT SILENT: `GET /api/market-session` returns the values
 * the server is actually running with, and `assertMatchesServer()` below logs a
 * loud console warning if this mirror disagrees. A UI that quietly projects a
 * different bell from the engine is how a card ends up promising a close that
 * never happens — which is exactly what it did before this existed.
 *
 * THE DAY, AS OF 3 AUGUST 2026 (SEBI closing-auction framework):
 *   DERIVATIVES  09:15 → 15:40   index/stock futures & options. Every position
 *                                this platform holds lives here, so this is the
 *                                window for anything about managing risk.
 *   INDEX        09:15 → 15:30   the index tape (continuous to 15:15, then an
 *                                indicative index through the auction).
 *   CASH         09:15 → 15:15   continuous; auction to 15:35 sets the official
 *                                close, which is no longer the last trade.
 */

export const SEGMENTS = { DERIVATIVES: 'DERIVATIVES', INDEX: 'INDEX', CASH: 'CASH' };

export const SESSION_TABLE = {
    NSE: {
        // expiryInstant = when a contract SETTLES (15:30); close = the last instant
        // it can be TRADED (15:40). Mirrors the backend's separation of the two.
        DERIVATIVES: { open: '09:15', close: '15:40', expiryInstant: '15:30' },
        INDEX: { open: '09:15', close: '15:30' },
        CASH: { open: '09:15', close: '15:15', auctionEnd: '15:35' },
    },
    BSE: {
        DERIVATIVES: { open: '09:15', close: '15:40', expiryInstant: '15:30' },
        INDEX: { open: '09:15', close: '15:30' },
        CASH: { open: '09:15', close: '15:15', auctionEnd: '15:35' },
    },
    // 23:55 is the WINTER bound, matching the backend table exactly; the seasonal
    // evening cap (23:30) is applied server-side, not here. A mirror that "helpfully"
    // pre-applies it just reports itself as drifted every day.
    MCX: {
        DERIVATIVES: { open: '09:00', close: '23:55', expiryInstant: '23:55' },
        INDEX: { open: '09:00', close: '23:55' },
        CASH: { open: '09:00', close: '23:55' },
    },
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const toMin = (hhmm) => { const m = HHMM.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function exchangeOf(symbol) {
    const s = String(symbol || '').toUpperCase();
    const m = /^(NSE|BSE|MCX)\s*:/.exec(s);
    if (m) return m[1];
    if (s.includes('SENSEX') || s.includes('BANKEX')) return 'BSE';
    return 'NSE';
}

/** …CE/…PE/…FUT → DERIVATIVES; …-INDEX → INDEX; else CASH. */
export function segmentFor(symbol) {
    const s = String(symbol || '').toUpperCase();
    if (/(CE|PE)$/.test(s) || /FUT\w*$/.test(s)) return SEGMENTS.DERIVATIVES;
    if (s.includes('-INDEX')) return SEGMENTS.INDEX;
    return SEGMENTS.CASH;
}

/** @returns {{exchange,segment,open,close,openMin,closeMin,minutes,auctionEnd}} */
export function sessionFor(symbolOrOpts, segmentHint = null) {
    let exchange, segment;
    if (symbolOrOpts && typeof symbolOrOpts === 'object') {
        exchange = String(symbolOrOpts.exchange || 'NSE').toUpperCase();
        segment = String(symbolOrOpts.segment || SEGMENTS.DERIVATIVES).toUpperCase();
    } else {
        exchange = exchangeOf(symbolOrOpts);
        segment = String(segmentHint || segmentFor(symbolOrOpts)).toUpperCase();
    }
    const byEx = SESSION_TABLE[exchange] || SESSION_TABLE.NSE;
    const s = byEx[segment] || byEx[SEGMENTS.DERIVATIVES];
    const openMin = toMin(s.open), closeMin = toMin(s.close);
    return { exchange, segment, open: s.open, close: s.close, openMin, closeMin, minutes: closeMin - openMin, auctionEnd: s.auctionEnd || null };
}

/** The outer bound for anything about MANAGING risk — always the derivatives close. */
export function riskCloseMin(exchange = 'NSE') { return sessionFor({ exchange, segment: SEGMENTS.DERIVATIVES }).closeMin; }
export function riskOpenMin(exchange = 'NSE') { return sessionFor({ exchange, segment: SEGMENTS.DERIVATIVES }).openMin; }

/**
 * Compare this mirror against the server's real config. Call once at start-up.
 * Warns and returns the differences; never throws — a UI must not fail to render
 * because a clock constant drifted.
 */
export async function assertMatchesServer(fetchJson) {
    try {
        const server = await fetchJson();
        const diffs = [];
        for (const ex of Object.keys(SESSION_TABLE)) {
            for (const seg of Object.keys(SESSION_TABLE[ex])) {
                const mine = SESSION_TABLE[ex][seg], theirs = server?.table?.[ex]?.[seg];
                if (!theirs) continue;
                if (mine.open !== theirs.open || mine.close !== theirs.close) {
                    diffs.push(`${ex}.${seg}: UI ${mine.open}-${mine.close} vs server ${theirs.open}-${theirs.close}`);
                }
            }
        }
        if (diffs.length) console.warn('[marketSession] UI mirror disagrees with the server:\n  ' + diffs.join('\n  '));
        return diffs;
    } catch { return []; }
}
