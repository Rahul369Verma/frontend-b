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

/** "All 3 LIVE structures on at once need ₹6,24,000 — ₹1,49,352 more than the ₹4,74,648 total." */
export function togetherLine(cap) {
    const n = (cap.deployments || []).length;
    const a = cap.allTogether;
    if (!n) return 'No LIVE multi-leg deployment.';
    if (!a || a.margin == null) return `The broker could not price all ${n} LIVE structures together right now.`;
    const head = `All ${n} LIVE structure${n === 1 ? '' : 's'} on at once need ${rs(a.margin)} of margin`;
    if (!cap.funds) return `${head} (the account balance could not be read).`;
    const gap = a.margin - cap.funds.total;
    return gap > 0
        ? `${head}: ${rs(gap)} MORE than the ${rs(cap.funds.total)} in the account.`
        : `${head}: ${Math.round((100 * a.margin) / cap.funds.total)}% of the ${rs(cap.funds.total)} in the account.`;
}

/** Each still-to-enter deployment: "09:20 nifty-atm-straddle ₹2,60,000 — fits (₹2,88,621 available)". */
export function planLine(p) {
    const head = `${p.entryTime || '—'} ${p.name} ${rs(p.margin)}`;
    if (p.fits == null) return `${head} — cannot tell (margin or balance unavailable)`;
    return p.fits ? `${head} — fits (${rs(p.availableBefore)} available)` : `${head} — would be REFUSED (${rs(p.availableBefore)} left)`;
}
