/**
 * lotsFormat — the sentences of the Lots dialog (4-Nov-2026, "make our multileg deploy strategies
 * multi lots"). Pure: the answer of GET /api/multileg/deployments/:id/size in, plain text out.
 */
import { inr } from '../viz/tokens';

const n0 = (v) => Number(v).toLocaleString('en-IN');
const dayLabel = (iso) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : String(iso || '');
};
const under = (s) => String(s?.symbol || '').replace(/^[A-Z]+:/, '').replace(/50-INDEX$|-INDEX$/, '') || 'this index';

export const RUPEE_LABEL = Object.freeze({
    max_loss_rupees: 'Rupee stop (whole structure)',
    max_loss_per_day: 'Daily loss cap',
    max_entry_vega_rupees: 'Max vega at entry',
});

/** "3 lots × 65 = 195 units in each leg's order" (the 2× leg doubled). */
export function unitsLine(s) {
    if (!s || !s.lotSize || !Number.isInteger(s.want)) return null;
    const one = s.want * s.lotSize;
    const ratio = Number(s.maxRatio) || 1;
    return `${s.want} lot${s.want === 1 ? '' : 's'} × ${s.lotSize} = ${n0(one)} units in each leg's order${ratio > 1 ? ` (${n0(one * ratio)} in the ${ratio}× leg)` : ''}.`;
}

/** Why the most is what it is. */
export function freezeLine(s) {
    if (!s || !s.freeze) return null;
    if (!s.freeze.known) return `At most ${s.maxLotsAbsolute || 100} lots. ${s.freeze.note || 'No freeze limit is known for this index.'}`;
    return `At most ${s.maxLots} lot${s.maxLots === 1 ? '' : 's'}: the exchange accepts at most ${n0(s.freeze.qty)} units of ${under(s)} options in one order (as of ${dayLabel(s.freeze.asOf)}), and orders are not split.`;
}

/** Margin for the new size against the account. */
export function marginLine(s) {
    if (!s) return null;
    if (!s.margin) return 'Margin: not priced right now. The broker\'s margin check still runs at every entry.';
    const head = `Margin ≈ ${inr(s.margin.total)} for ${s.want} lot${s.want === 1 ? '' : 's'} (${inr(s.margin.perLot)} per lot).`;
    if (s.mode !== 'LIVE') return `${head} A PAPER book uses no account margin.`;
    if (!s.account || !Number.isFinite(Number(s.account.available))) return `${head} The account balance could not be read.`;
    const gap = s.margin.total - s.account.available;
    return gap > 0
        ? `${head} That is ${inr(gap)} MORE than the ${inr(s.account.available)} available now: the entry would be refused for funds.`
        : `${head} ${inr(s.account.available)} is available now (other LIVE deployments' entries also draw on it).`;
}

/** Does the new size need the account's attention? */
export const marginShort = (s) => !!(s && s.mode === 'LIVE' && s.margin && s.account && s.margin.total > s.account.available);

/** The go-live canary: what it trades until you lift its cap. */
export function canaryLine(s) {
    const c = s && s.canary;
    if (!c || !c.capped || s.mode !== 'LIVE' || !(s.want > c.lots)) return null;
    return `Its go-live canary is ${c.state}: it trades ${c.lots} lot${c.lots === 1 ? '' : 's'} until ${c.trades || 10} live trades pass and you lift the size cap on the Go-Live page (${c.liveTrades} so far). Then ${s.want}.`;
}

/** Everything else worth knowing before saving. */
export function sizeNotes(s) {
    if (!s) return [];
    const out = [];
    if (s.sizeMode === 'risk') out.push('It sizes by risk (size mode "risk"): each entry takes its lots from risk_per_trade, up to max_lots, so this number is not used while that is set.');
    if (s.open && Number.isInteger(s.want) && s.want !== s.lots) out.push(`A structure is open now at ${s.openLots || s.lots} lot${(s.openLots || s.lots) === 1 ? '' : 's'}: it keeps that size. The new size applies from the next entry.`);
    const c = canaryLine(s);
    if (c) out.push(c);
    return out;
}

/** The ₹ settings, now and at the new size (scaled when the box is ticked). */
export function rupeeRows(s, scale) {
    if (!s || !Array.isArray(s.rupee)) return [];
    return s.rupee.map((r) => ({
        key: r.key, label: RUPEE_LABEL[r.key] || r.key, now: r.now,
        after: scale && r.scaled != null ? r.scaled : r.now,
        perLotAfter: Number.isInteger(s.want) && s.want > 0 ? Math.round((scale && r.scaled != null ? r.scaled : r.now) / s.want) : null,
    }));
}
