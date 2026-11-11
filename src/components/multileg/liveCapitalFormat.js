/**
 * Words for LiveCapitalPanel.jsx and TwinsPanel.jsx (backend logic/multileg/liveCapital.js,
 * logic/multileg/twins.js).
 */
import { inr } from '../viz/tokens';

export const rs = (v) => (v == null ? '—' : inr(v, { dp: 0 }));
export const signedRs = (v) => (v == null ? '—' : inr(v, { dp: 0, sign: true }));

/** What a LIVE deployment is doing now, in words. */
export function stateText(d) {
    if (d.open) return `open · ${d.legs.length} leg${d.legs.length === 1 ? '' : 's'} held`;
    if (d.status !== 'ACTIVE') return 'stopped';
    if (d.enteredToday) return 'flat · done for today';
    return `flat · enters ${d.entryTime || 'at its trigger'}`;
}

/**
 * "All 3 LIVE structures on at once need ₹6,14,000 at the broker (₹5,24,000 of margin + ₹90,000 held
 * for safety stops): ₹1,39,352 MORE than the ₹4,74,648 in the account." Without the stops' figure
 * (an older server, or stops off) it is the margin alone.
 */
export function togetherLine(cap) {
    const n = (cap.deployments || []).length;
    const a = cap.allTogether;
    if (!n) return 'No LIVE multi-leg deployment.';
    if (!a || a.margin == null) return `The broker could not price all ${n} LIVE structures together right now.`;
    const withStops = a.total != null && a.stopHold > 0;
    const need = withStops ? a.total : a.margin;
    const head = `All ${n} LIVE structure${n === 1 ? '' : 's'} on at once need ${withStops ? `${rs(need)} at the broker (${rs(a.margin)} of margin + ${rs(a.stopHold)} held for safety stops)` : `${rs(need)} of margin`}`;
    if (!cap.funds) return `${head} (the account balance could not be read).`;
    const gap = need - cap.funds.total;
    return gap > 0
        ? `${head}: ${rs(gap)} MORE than the ${rs(cap.funds.total)} in the account.`
        : `${head}: ${Math.round((100 * need) / cap.funds.total)}% of the ${rs(cap.funds.total)} in the account.`;
}

/** Each still-to-enter deployment: "09:20 nifty-atm-straddle ₹3,00,990 (₹2,60,000 margin + ₹40,990 stops) — fits (₹3,30,000 available)". */
export function planLine(p) {
    const parts = p.stopHold > 0 && p.marginOnly != null ? ` (${rs(p.marginOnly)} margin + ${rs(p.stopHold)} stops)` : '';
    const head = `${p.entryTime || '—'} ${p.name} ${rs(p.margin)}${parts}`;
    if (p.fits == null) return `${head} — cannot tell (margin or balance unavailable)`;
    return p.fits ? `${head} — fits (${rs(p.availableBefore)} available)` : `${head} — would be REFUSED (${rs(p.availableBefore)} left)`;
}
