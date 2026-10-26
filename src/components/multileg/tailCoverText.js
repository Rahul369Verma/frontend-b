/**
 * The deploy preview's word on an UNBOUNDED payoff (a naked short), from POST /multileg/preview
 * `stops` (backend exitRules.tailCover). Until 23-Oct-2026 the LIVE confirm said "UNDEFINED tail
 * risk … unless leg-SL / structure-SL are set" from the payoff alone — with both stops set. The
 * payoff of a naked short has no floor; the stops are what bound it, so say whether they do and
 * where each one fires.
 * @returns {{ tone: 'danger'|'warning', text: string } | null}  null = the payoff is bounded
 */
import { fmt } from './builderFormat';

const rupees = (v) => `${v < 0 ? '−' : ''}₹${fmt(Math.abs(v))}`;

export function tailCoverText(data) {
    if (!data || !data.unbounded) return null;
    const s = data.stops;
    if (!s) return { tone: 'danger', text: '⚠ UNDEFINED tail risk — this structure can lose without limit unless leg-SL / structure-SL are set.' };
    if (!s.capsTail) {
        const missing = [];
        if (!(s.settings?.leg_sl_x > 1)) missing.push('a leg stop (leg_sl_x > 1)');
        if (!(s.settings?.sl_x_credit > 1)) missing.push('a structure stop (sl_x_credit > 1)');
        return { tone: 'danger', text: `⚠ UNDEFINED tail risk — a naked short needs BOTH stops, and this one is missing ${missing.join(' and ')}. The engine will refuse to enter it.` };
    }
    const parts = [];
    if (s.legStops?.length) parts.push(`each short leg is bought back at ${s.settings.leg_sl_x}× its entry (${s.legStops.map((l) => `${l.strike} ${l.type} at ₹${fmt(l.stopAt, 1)}`).join(' · ')})`);
    if (s.structureStopRupees != null) parts.push(`the whole structure closes at ${rupees(s.structureStopRupees)} (sl_x_credit ${s.settings.sl_x_credit})`);
    if (s.maxLossRupees != null) parts.push(`or at ${rupees(s.maxLossRupees)} net (rupee stop)`);
    return {
        tone: 'warning',
        text: `No maximum loss on paper — it is a naked short, so its stops are what bound it: ${parts.join('; ')}. A gap through a stop fills worse than its level.`,
    };
}
