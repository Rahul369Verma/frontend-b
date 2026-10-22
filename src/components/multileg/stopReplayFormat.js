/**
 * Words and numbers for StopReplay.jsx (kept apart so the component file exports components only).
 */
import { inr, premium, istTime as tokIstTime } from '../viz/tokens';

export const rup = (v) => (v == null ? '—' : inr(v, { dp: 0 }));
export const signed = (v) => (v == null ? '—' : inr(v, { dp: 0, sign: true }));
export const tone = (v) => (v == null ? 'text-fg-5' : v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-fg-4');
export const hhmm = (v) => tokIstTime(v, { seconds: false });

// the exit reasons of backend/logic/multileg/exitRules.js (REASONS), plus the replay's own
const REASONS = {
    LEG_SL: 'leg stop', LEG_SL_FLATTEN: 'every short leg stopped', SL_STRUCT: 'structure stop', MAX_LOSS: 'rupee stop',
    TP_STRUCT: 'profit target', SIGNAL_REVERSE: 'signal reversed', SIGNAL_THESIS: 'signal thesis broke',
    SQUARE_OFF: 'square-off', EXPIRY_DAY: 'expiry-day close', DTE_EXIT: 'days-to-expiry exit',
    HOLD_CAP: 'hold cap', HOLD_CAP_EXPIRY: 'hold cap (expiry)', EXPIRY_SETTLED: 'settled at expiry',
    END_OF_DATA: 'end of recorded data', SQUARE_OFF_NO_SNAPSHOT: 'square-off (last recorded minute)',
};
export const reasonText = (r) => (r ? (REASONS[r] || String(r).toLowerCase().replace(/_/g, ' ')) : '—');

/** "leg stop 1.4× · structure stop 2× credit · rupee stop ₹3,000" (0 = off) */
export function stopsText(s) {
    if (!s) return '';
    const parts = [
        s.leg_sl_x > 0 ? `leg stop ${s.leg_sl_x}× entry` : 'leg stop off',
        s.sl_x_credit > 0 ? `structure stop ${s.sl_x_credit}× credit` : s.sl_pct_debit > 0 ? `structure stop ${s.sl_pct_debit}% of debit` : 'structure stop off',
        s.max_loss_rupees > 0 ? `rupee stop ${rup(s.max_loss_rupees)}` : 'rupee stop off',
    ];
    return parts.join(' · ');
}

const STOP_REASONS = new Set(['LEG_SL', 'LEG_SL_FLATTEN', 'SL_STRUCT', 'MAX_LOSS']);
/** Did a stop (not a target, square-off or signal) close it? */
export const isStopReason = (r) => STOP_REASONS.has(r);
const legName = (l) => `${l.action} ${l.type}${l.strike != null ? ` ${l.strike}` : ''}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Its stops (as opened): leg stop 1.4× entry · structure stop 2× credit · rupee stop ₹3,000" */
export function tradeStopsText(stops) {
    if (!stops || !stops.settings) return null;
    return `Its stops (${stops.source}): ${stopsText(stops.settings)}`;
}

/**
 * What fired, in order: each leg stop (its level, the quote that tripped it, the fill), then
 * the structure's own exit (the rule, when, the net mark it saw, what the fills then booked).
 * Trades closed before 22-Oct-2026 did not record the firing mark — said so, not guessed.
 */
export function firedLines(trade) {
    const out = [];
    const stops = trade && trade.stops;
    for (const l of (trade && trade.closedLegs) || []) {
        if (l.closeReason !== 'LEG_SL') continue;
        const level = stops && stops.legStops ? stops.legStops[l.symbol] : null;
        out.push(`${legName(l)}: leg stop${level != null ? ` at ${premium(level)}` : ''}${l.closedAt ? ` fired ${hhmm(l.closedAt)}` : ''}`
            + `${l.triggerQuote != null ? ` on a quote of ${premium(l.triggerQuote)}` : ''} — bought back at ${premium(l.exitPrice)}.`);
    }
    const t = trade && trade.exitTrigger;
    if (t && t.reason) {
        const level = t.reason === 'MAX_LOSS' && stops && stops.maxLossNetRupees != null ? ` (stop ${signed(stops.maxLossNetRupees)})` : '';
        const gap = t.net != null && trade.netPnl != null ? Math.round(trade.netPnl - t.net) : null;
        const fills = gap == null || gap === 0 ? '' : gap < 0 ? ` — the exit fills came in ${rup(-gap)} worse than that mark` : ` — the exit fills came in ${rup(gap)} better than that mark`;
        out.push(`${cap(reasonText(t.reason))} fired ${hhmm(t.at)} on a net mark of ${signed(t.net)}${level}; booked ${signed(trade.netPnl)}${fills}.`);
    } else if (trade && isStopReason(trade.exitReason)) {
        out.push(`Closed by the ${reasonText(trade.exitReason)}. This trade did not record the mark that fired it (recorded from 22-Oct-2026): `
            + 'marks are kept once a minute while the stop is checked every loop, so the chart\'s last point can sit short of the stop.');
    }
    return out;
}

/** The sentence that answers "would it have gone positive again?" */
export function recoveryText(d) {
    if (!d || d.noStops?.net == null) return null;
    if (!d.stopped) return 'No stop fired in the replay — the stops changed nothing on this trade.';
    const r = d.recovery;
    if (!r) return null;
    const after = r.bestAfterStop == null
        ? 'there were no recorded minutes after it'
        : r.wentPositiveAfterStop
            ? `held with no stops, it DID come back into profit — best ${signed(r.bestAfterStop)} after the stop`
            : `held with no stops, it never got back above ₹0 (best after the stop ${signed(r.bestAfterStop)})`;
    return `First stop: ${reasonText(r.stopKind)} at ${hhmm(r.firstStopAt)} IST — ${after}, and would have finished at ${signed(d.noStops.net)} (${reasonText(d.noStops.reason)}).`;
}
