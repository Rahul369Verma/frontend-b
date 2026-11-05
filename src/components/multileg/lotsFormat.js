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

/** The go-live canary: what it trades until you lift its cap (nothing when you are skipping it). */
export function canaryLine(s, skip = false) {
    const c = s && s.canary;
    if (skip || !c || !c.capped || s.mode !== 'LIVE' || !(s.want > c.lots)) return null;
    const liftable = c.liftable ?? (c.state === 'ACTIVE' || c.state === 'PASS_PENDING');
    return `Its go-live canary is ${c.state}: it trades ${c.lots} lot${c.lots === 1 ? '' : 's'} until ${c.trades || 10} live trades pass and you lift the size cap on the Go-Live page (${c.liveTrades} so far)${liftable ? ', or until you skip the canary below' : ''}. Then ${s.want}.`
        + (Array.isArray(s.rupee) && s.rupee.length ? ` Until then its ₹ limits act at ${c.lots}/${s.want} of the figures below, so each lot keeps the same stop.` : '');
}

/**
 * "Skip the canary" in the Lots dialog (6-Nov-2026: "how can I skip the canary and make it 2 lots
 * now … it should show the check to skip canary while making changes to lots"). Shown only when
 * the canary would hold this size back. Ticking it lifts the size cap — your explicit decision,
 * POST /api/golive/deployments/multileg/:id/canary { decision:'lift', early } — never automatic.
 * @returns {null | { blocked }|{ early, label, warn }}
 */
export function skipCanary(s) {
    const c = s && s.canary;
    if (!c || !c.capped || s.mode !== 'LIVE' || !Number.isInteger(s.want) || !(s.want > c.lots)) return null;
    const liftable = c.liftable ?? (c.state === 'ACTIVE' || c.state === 'PASS_PENDING');
    const cap = Number(c.lossCapInr) > 0 ? inr(Number(c.lossCapInr)) : null;
    if (!liftable) return { blocked: `Its canary is waiting at its${cap ? ` ${cap}` : ''} loss cap: answer that on the Go-Live page (keep LIVE or demote) before you skip it.` };
    const early = c.state === 'ACTIVE';
    const done = Number(c.liveTrades) || 0, of = Number(c.trades) || 10;
    const net = Number.isFinite(Number(c.livePnl)) && c.livePnl != null ? `, net ${inr(Number(c.livePnl), { sign: true })}` : '';
    const lotsW = `${s.want} lot${s.want === 1 ? '' : 's'}`;
    return {
        early,
        label: early
            ? `Skip the rest of the go-live canary: trade ${lotsW} from the next entry (${done} of ${of} live trades done${net}).`
            : `Lift the canary's size cap: trade ${lotsW} from the next entry (it passed: ${done} live trades${net}).`,
        warn: `Real money: ${s.want}× the canary's ${c.lots}-lot size. The canary stops watching it${cap ? `, so it no longer asks you at its ${cap} loss cap` : ''}, and its ₹ limits act in full at ${lotsW}. A structure open now keeps its size.`,
    };
}

/** Everything else worth knowing before saving. */
export function sizeNotes(s, { skip = false } = {}) {
    if (!s) return [];
    const out = [];
    if (s.sizeMode === 'risk') out.push('It sizes by risk (size mode "risk"): each entry takes its lots from risk_per_trade, up to max_lots, so this number is not used while that is set.');
    if (s.open && Number.isInteger(s.want) && s.want !== s.lots) out.push(`A structure is open now at ${s.openLots || s.lots} lot${(s.openLots || s.lots) === 1 ? '' : 's'}: it keeps that size. The new size applies from the next entry.`);
    const c = canaryLine(s, skip);
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

const CANARY_CAPPED = new Set(['ACTIVE', 'CAP_HIT', 'PASS_PENDING', 'DEMOTE_PENDING']);
const lotsWord = (n) => `${n} lot${n === 1 ? '' : 's'}`;

/**
 * A deployment card's size, said in full (5-Nov-2026: "I deployed 2 lots and it bought 1"):
 * the lots it is SET to, what the go-live canary lets it trade until you lift the cap, and the
 * size of a structure open now when that differs. Never just the set number when it trades fewer.
 * @returns {{ text, title, capped, lots, trades }}
 */
export function cardLots(d) {
    const set = Math.max(1, Number(d && d.lots) || 1);
    const c = d && d.golive && d.golive.canary;
    const cl = c && Number(c.lots) > 0 ? Number(c.lots) : null;
    const capped = !!(d && d.trade_mode === 'LIVE' && c && CANARY_CAPPED.has(c.state) && cl != null && set > cl);
    const pos = d && d.position;
    const openLots = pos && pos.state && pos.state !== 'IDLE' && Number(pos.lots) > 0 ? Number(pos.lots) : null;
    const trades = capped ? cl : set;
    const bits = [];
    if (capped) bits.push(`trading ${trades} (canary ${Number(c.liveTrades) || 0}/${Number(c.trades) || 10})`);
    if (openLots != null && openLots !== trades) bits.push(`open: ${lotsWord(openLots)}`);
    const title = [
        `Set to ${lotsWord(set)}.`,
        capped ? `Its go-live canary is ${c.state}: every entry trades ${lotsWord(cl)} until ${Number(c.trades) || 10} live trades pass (${Number(c.liveTrades) || 0} so far) and you lift the size cap on the Go-Live page (or skip the canary in this Lots dialog). Its ₹ limits act at ${cl}/${set} meanwhile.` : null,
        openLots != null ? `The structure open now holds ${lotsWord(openLots)}.` : null,
        'Click to change the size: units per leg, the most one order can carry, margin, and its ₹ limits.',
    ].filter(Boolean).join(' ');
    return { text: `${lotsWord(set)}${bits.length ? ` · ${bits.join(' · ')}` : ''}`, title, capped, lots: set, trades };
}

/** A booked trade's size: "2", or "1 of 2" when the go-live canary held it below the set lots. */
export function tradeLots(t) {
    const lots = Number(t && t.lots);
    if (!(lots > 0)) return { text: '—', title: 'Lots not recorded on this trade', lots: null };
    const set = Number(t.configuredLots);
    if (t.canaryCapped && set > lots) return { text: `${lots} of ${set}`, title: `${lotsWord(lots)} traded of the ${set} set: the go-live canary capped it`, lots };
    return { text: String(lots), title: `${lotsWord(lots)}${Number(t.lotSize) > 0 ? ` of ${t.lotSize} (${lots * Number(t.lotSize)} units a leg)` : ''}`, lots };
}
