/** Pure helpers for DirectionGateHistory (Fast Refresh: no components here). */
import { inr, istTime } from '../viz/tokens.js';

export const RANGE_OPTIONS = [
    { v: 30, label: '30d', hint: 'Last 30 days' },
    { v: 90, label: '90d', hint: 'Last 90 days' },
    { v: 180, label: '180d', hint: 'Last 180 days' },
    { v: 365, label: '1y', hint: 'Last year' },
];

/** good = the gate has made money over ≥10 judged trades; critical = it has cost money; else info. */
export function verdictLevel(s) {
    if (!s || !(s.judgedTrades >= 10)) return 'info';
    return s.value > 0 ? 'good' : s.value < 0 ? 'critical' : 'info';
}

export const decidedCount = (r) => Object.values((r && r.decisions) || {}).reduce((a, b) => a + b, 0);

export const modeLabel = (modes) => (modes && modes.length ? modes.join(' + ') : '—');

export const nNet = (a) => (a && a.n ? `${a.n} · ${inr(a.net, { sign: true })}` : '—');

export const notFollowedTitle = (r) => Object.entries((r && r.notFollowedReasons) || {}).map(([k, v]) => `${v} × ${k}`).join('\n');

/**
 * A ghost's AI management in one chip: reviews + exit consults + scale-outs, newest last.
 * null when the AI never touched it.
 */
export function ghostAiSummary(g) {
    const reviews = (g && g.inflightReviews) || [];
    const consults = (g && g.exitConsults) || [];
    const partials = (g && g.partialExits) || [];
    const n = reviews.length + consults.length;
    if (!n && !partials.length) return null;
    const hhmm = (ts) => (ts ? istTime(ts, { seconds: false }) : '—');
    const lines = [
        ...reviews.map(r => `${hhmm(r.ts)} review ${r.action}${r.confidence != null ? ` ${r.confidence}%` : ''}${r.applied === false ? ' (refused)' : ''}`),
        ...consults.map(c => `${hhmm(c.ts)} exit consult (${c.kind || '?'}) → ${c.outcome}${c.note ? `: ${c.note}` : ''}`),
        ...partials.map(x => `${hhmm(x.ts)} scaled out ${x.lots} lot(s) @ ₹${x.exitPrice}`),
    ];
    const last = reviews.length ? reviews[reviews.length - 1].action : consults.length ? consults[consults.length - 1].outcome : 'scale-out';
    // "ERROR" alone read like a verdict; say it FAILED and why (the AI never answered)
    if (last === 'ERROR') {
        const why = aiFailureShort(reviews[reviews.length - 1].reasoning);
        return { label: `${n} AI · failed`, title: `AI review failed — ${why}\n\n${lines.join('\n')}`, failed: true, why };
    }
    return { label: `${n || partials.length} AI · ${last}`, title: lines.join('\n') };
}

/**
 * A short, plain reason for a failed AI call (mirrors the server's
 * notificationRules.classifyAiFailure for the common cases).
 */
export function aiFailureShort(text) {
    const t = String(text || '');
    if (/just a moment|cloudflare/i.test(t)) return 'Claude.ai blocked the request (Cloudflare check, HTTP 403)';
    if (/account_session_invalid|session.{0,20}(invalid|expired)|401/i.test(t)) return 'the AI session key is missing or expired';
    if (/429|rate.?limit|quota/i.test(t)) return 'the AI provider is rate-limiting';
    if (/ECONNREFUSED|ENOTFOUND|python engine/i.test(t)) return 'the AI engine could not be reached';
    if (/timeout|timed out|Poll budget/i.test(t)) return 'the AI did not answer in time';
    const short = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return short || 'no reason given';
}

