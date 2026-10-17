'use strict';
/**
 * notifyFormat — how a platform notification reads (the bell, the Dashboard
 * strip and the Notifications page share it). Plain words first: a person
 * should know what is wrong and what to do without opening anything.
 */

export const SEVERITY = Object.freeze({
    critical: { label: 'Urgent', level: 'critical', tone: 'critical', order: 0 },
    warning: { label: 'Warning', level: 'warning', tone: 'warning', order: 1 },
    info: { label: 'Notice', level: 'info', tone: 'info', order: 2 },
});

export const CATEGORY = Object.freeze({
    ai: 'AI', broker: 'Broker', engine: 'Engine', data: 'Exchange data', system: 'Server',
    gate: 'Direction gate', audit: 'Nightly audit', risk: 'Risk', performance: 'Slowness',
});

export const sevOf = (s) => SEVERITY[s] || SEVERITY.warning;
export const catOf = (c) => CATEGORY[c] || (c ? c[0].toUpperCase() + c.slice(1) : 'Other');

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(v, nowMs = Date.now()) {
    if (!v) return '—';
    const s = Math.max(0, Math.round((nowMs - new Date(v).getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
}

/** One short line under the title: when it started, how often it was seen, whether Telegram heard. */
export function whenLine(n, nowMs = Date.now()) {
    const parts = [];
    if (n.status === 'open') {
        parts.push(`since ${timeAgo(n.firstAt, nowMs)}`);
        if ((n.count || 1) > 1) parts.push(`seen ${n.count}×`);
    } else if (n.status === 'resolved') {
        parts.push(`resolved ${timeAgo(n.resolvedAt, nowMs)}`);
    } else {
        parts.push(timeAgo(n.firstAt, nowMs));
    }
    if (n.telegramAt) parts.push('sent to Telegram');
    if (n.ackAt) parts.push('acknowledged');
    return parts.join(' · ');
}

/** The first sentence of a message (the strip has one line per item). */
export function firstSentence(t, max = 140) {
    const s = String(t || '');
    const m = /^(.+?[.!?])(\s|$)/.exec(s);
    const one = m ? m[1] : s;
    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** "2 warnings, no urgent findings" — one line for an audit run. */
export function auditHeadline(run) {
    const c = (run && run.counts) || {};
    const u = c.critical || 0, w = c.warn || 0;
    if (!u && !w) return 'Everything reconciles — nothing to fix';
    const parts = [];
    if (u) parts.push(`${u} urgent finding${u === 1 ? '' : 's'}`);
    if (w) parts.push(`${w} warning${w === 1 ? '' : 's'}`);
    return parts.join(', ');
}

/** The bell's badge: how many things need a person (urgent + warnings, unread). */
export function badgeOf(summary) {
    if (!summary) return { count: 0, level: null, label: 'Notifications' };
    const count = summary.unread || 0;
    const level = (summary.bySeverity?.critical || 0) > 0 ? 'critical' : count > 0 ? 'warning' : null;
    const label = count ? `Notifications — ${count} need${count === 1 ? 's' : ''} attention` : 'Notifications — all clear';
    return { count, level, label };
}

/**
 * Everything the platform watches today, in plain words — the "what can we be
 * told about" list on the Notifications page. Keep in step with the backend
 * (logic/services/healthMonitor.js standardChecks, aiHealthProbe.js, the gate
 * hook in engine/live/entry.js, scripts/nightlyAudit.js --notify).
 */
export const WATCHED = Object.freeze([
    { what: 'AI not answering', when: 'Every 6 h (sample prompt) and whenever a live AI review fails', severity: 'warning', note: 'Urgent if entry confirmation is set to fail closed (entries blocked).' },
    { what: 'Broker not logged in', when: 'During market hours', severity: 'critical', note: 'No orders, prices may stop.' },
    { what: 'Live price feed disconnected', when: 'During market hours, 2 checks in a row', severity: 'warning' },
    { what: 'Single-leg engine halted', when: 'Any time (e.g. the daily-loss stop)', severity: 'critical', note: 'Shows why and who halted it.' },
    { what: 'Multi-leg engine loop stopped', when: 'During market hours, no tick for 3 min', severity: 'critical', note: 'Open structures are not being managed.' },
    { what: 'Direction gate has no fresh reading', when: 'Enforce mode, market hours', severity: 'warning', note: 'It lets every signal through.' },
    { what: 'Direction gate blocked a trade', when: 'Each enforced block', severity: 'info', note: 'Platform only unless Notices are sent to Telegram.' },
    { what: 'Exchange contract data out of date / missing', when: 'Every 2 min', severity: 'warning', note: 'Fix: make instruments-calendar.' },
    { what: 'Server disk almost full', when: 'Below 10% free (urgent below 5%)', severity: 'warning' },
    { what: 'Database unreachable', when: 'Any time', severity: 'critical', note: 'Sent to Telegram directly (it cannot be stored), recorded once back.' },
    { what: 'AI health check not running', when: 'No check for 12 h', severity: 'warning' },
    { what: 'Telegram not configured', when: 'Any time', severity: 'info' },
    { what: 'Nightly audit findings', when: 'Every weekday at 19:30 IST (the server runs it)', severity: 'warning', note: 'Expiry/symbol drift, spreads, charges, open books, go-live gate, multi-leg contracts. Clears when a later run no longer finds it.' },
    { what: 'Nightly audit failed or did not run', when: 'A failed run, or no run an hour after 19:30 on a weekday', severity: 'warning' },
]);
