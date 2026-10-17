'use strict';
/** Pure helpers for BlockedTrades (kept out of the component file for Fast Refresh). */
import { inr } from '../viz/tokens.js';

/** The verdict badge for the blocked list: a small sample is never judged. */
export function blockedVerdict(s) {
    const judged = s ? (s.blocked + s.wouldBlock - (s.undecided || 0)) : 0;
    if (!s || judged < 10) return { level: 'info', label: `Too few to judge (${judged} of 10 needed)` };
    return s.net > 0 ? { level: 'good', label: 'Blocking is helping' } : s.net < 0 ? { level: 'critical', label: 'Blocking is costing money' } : { level: 'info', label: 'No difference so far' };
}

/** One plain line: how many were blocked, and what blocking saved / cost. */
export function summaryLine(s, days) {
    if (!s) return '';
    const total = s.blocked + s.wouldBlock;
    if (!total) return `No trade was blocked in the last ${days} days.`;
    const parts = [];
    if (s.blocked) parts.push(`${s.blocked} blocked`);
    if (s.wouldBlock) parts.push(`${s.wouldBlock} would have been blocked (shadow)`);
    const money = s.saved || s.cost
        ? ` Blocking saved ${inr(s.saved)} and cost ${inr(s.cost)} — net ${inr(s.net, { sign: true })}${s.net < 0 ? ' (the gate lost money)' : s.net > 0 ? ' (the gate made money)' : ''}.`
        : '';
    const und = s.undecided ? ` ${s.undecided} not decided yet (still open or not followed).` : '';
    return `${parts.join(', ')} in the last ${days} days.${money}${und}`;
}
