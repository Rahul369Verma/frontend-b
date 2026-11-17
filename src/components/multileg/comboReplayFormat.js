/**
 * Words and numbers for the what-if tables: what the stops and the profit target each did on a
 * trade, how a replayed trade ended, and one combination of settings said in a line. Shared by
 * ComboReplay.jsx (stops and target together) and the two single grids (StopReplay.jsx,
 * TargetReplay.jsx), so the three sections say the same thing the same way.
 */
import { rup, signed, hhmm, reasonText } from './stopReplayFormat.js';
import { tpLabel } from './targetReplayFormat.js';

/** "saved ₹4,240" / "cost ₹1,050" / "nothing" / "—" — a stop's work (`verb` 'saved') or a target's ('added'). */
export function didText(v, verb = 'saved') {
    if (v == null) return '—';
    if (v > 0) return `${verb} ${rup(v)}`;
    if (v < 0) return `cost ${rup(-v)}`;
    return 'nothing';
}

/**
 * How a replayed trade ended: "square-off 15:10", or with an earlier leg stop
 * "leg stop 11:20 → square-off 15:10". `side` = { reason, exitAt, firstStop }.
 */
export function endedText(side) {
    if (!side || !side.reason) return '—';
    const end = `${reasonText(side.reason)}${side.exitAt ? ` ${hhmm(side.exitAt)}` : ''}`;
    const fs = side.firstStop;
    if (fs && fs.kind === 'LEG_SL' && !/^LEG_SL/.test(side.reason) && fs.at) return `leg stop ${hhmm(fs.at)} → ${end}`;
    return end;
}

export const legLabel = (x) => (x > 0 ? `${x}×` : 'off');
export const lossLabel = (x) => (x > 0 ? rup(x) : 'off');

/** "leg 1.5× · rupee off · target 20%" */
export function comboText(key, r) {
    if (!r) return '—';
    return `leg ${legLabel(r.legSlX)} · rupee ${lossLabel(r.maxLoss)} · target ${tpLabel(key, r.tp)}`;
}

/** Same three settings? */
export const sameCombo = (a, b) => !!a && !!b && a.legSlX === b.legSlX && a.maxLoss === b.maxLoss && a.tp === b.tp;

/**
 * Over many trades: what the stops and the target did in total (a per-trade table's rows).
 * `stops(t)` / `target(t)` read a trade's ₹ effect; `stopped(t)` / `hit(t)` whether each acted.
 */
export function sumEffects(rows, { stops, target, stopped, hit }) {
    const xs = rows || [];
    const tot = (f) => xs.reduce((a, t) => a + (f(t) ?? 0), 0);
    return {
        n: xs.length,
        stopsDid: tot(stops), stopsActed: xs.filter(stopped).length,
        stopsSaved: xs.filter((t) => stops(t) > 0).length, stopsCost: xs.filter((t) => stops(t) < 0).length,
        targetDid: tot(target), targetFired: xs.filter(hit).length,
        targetAdded: xs.filter((t) => target(t) > 0).length, targetCost: xs.filter((t) => target(t) < 0).length,
    };
}

/** "the stops acted on 14 of 17 trades and saved ₹31,000 in all (saved on 9, cost on 5)" */
export function stopsSentence(fx) {
    if (!fx || !fx.n) return '';
    if (!fx.stopsActed) return `no stop fired on any of the ${fx.n} trades`;
    const how = fx.stopsDid > 0 ? `saved ${rup(fx.stopsDid)} in all` : fx.stopsDid < 0 ? `cost ${rup(-fx.stopsDid)} in all` : 'made no difference in all';
    return `the stops acted on ${fx.stopsActed} of ${fx.n} trades and ${how} (saved on ${fx.stopsSaved}, cost on ${fx.stopsCost})`;
}

/** "the target fired on 1 and cost ₹1,050" */
export function targetSentence(fx, { set = true } = {}) {
    if (!fx || !fx.n) return '';
    if (!set) return 'there is no profit target';
    if (!fx.targetFired) return 'the target never fired, so it changed nothing';
    const how = fx.targetDid > 0 ? `added ${rup(fx.targetDid)}` : fx.targetDid < 0 ? `cost ${rup(-fx.targetDid)}` : 'made no difference';
    return `the target fired on ${fx.targetFired} and ${how}`;
}

// ── "Backtest & update…" (user, 17-Nov-2026: "provide the backtest with these button and then we can update
// it from backtest which will show the changes while updating it and we can confirm") ─────────────────────

/** The profit-target settings. The combination grid varies one of them and turns the others off. */
export const TARGET_KEYS = ['tp_pct_credit', 'tp_pct_max_profit', 'tp_x_debit'];
const SOURCES = ['archive', 'tape', 'broker'];

/**
 * One combination as deployment settings: the leg stop, the rupee stop and the target the grid varied
 * (0 = off). A target of another kind that the deployment has ON is turned off, as the replay had it
 * (the server's comboOverride); one already off is left out, so it is not shown as a change.
 * `effective` = the deployment's settings over its template's defaults.
 */
export function comboParams(key, combo, effective = {}) {
    const out = { leg_sl_x: Number(combo?.legSlX) || 0, max_loss_rupees: Number(combo?.maxLoss) || 0, [key]: Number(combo?.tp) || 0 };
    for (const k of TARGET_KEYS) if (k !== key && Number(effective?.[k]) > 0) out[k] = 0;
    return out;
}

/** The trading day (IST) of an instant, as YYYY-MM-DD — a backtest's "from". */
export function istDay(at) {
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? new Date(ms + 330 * 60000).toISOString().slice(0, 10) : null;
}

/**
 * The builder link for one combination: the deployment opened for editing with it, backtested next to the
 * deployment's own settings over the days the replay covered, on the same recorded quotes.
 */
export function tryLink(deploymentId, res, combo, label) {
    const cur = res?.picks?.current || null;
    const days = (res?.perTrade || []).map((t) => istDay(t.entryAt)).filter(Boolean).sort();
    const info = {
        key: res.key, combo: { legSlX: combo.legSlX, maxLoss: combo.maxLoss, tp: combo.tp }, label,
        from: days[0] || null, source: 'archive',
        whatIf: { trades: res.trades, net: combo.net, worst: combo.worst, currentNet: cur ? cur.net : null, currentWorst: cur ? cur.worst : null },
    };
    const q = new URLSearchParams({ tab: 'backtest', edit: String(deploymentId), try: JSON.stringify(info) });
    return `/multi-leg?${q.toString()}`;
}

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** The link's `try`, checked — anything malformed is dropped rather than half-applied. */
export function parseTry(s) {
    if (!s) return null;
    let o;
    try { o = JSON.parse(s); } catch (_) { return null; }
    if (!o || typeof o !== 'object' || !TARGET_KEYS.includes(o.key) || !o.combo) return null;
    const combo = { legSlX: num(o.combo.legSlX), maxLoss: num(o.combo.maxLoss), tp: num(o.combo.tp) };
    if (Object.values(combo).some((v) => v == null || v < 0)) return null;
    const w = o.whatIf && typeof o.whatIf === 'object' ? o.whatIf : {};
    return {
        key: o.key, combo,
        label: typeof o.label === 'string' ? o.label.slice(0, 80) : 'From Results',
        from: /^\d{4}-\d{2}-\d{2}$/.test(String(o.from || '')) ? o.from : null,
        source: SOURCES.includes(o.source) ? o.source : 'archive',
        whatIf: { trades: num(w.trades), net: num(w.net), worst: num(w.worst), currentNet: num(w.currentNet), currentWorst: num(w.currentWorst) },
    };
}

/** "★ Best net — leg 1.5× · rupee off · target 20%: +₹31,344 on its last 17 trades replayed, +₹7,938 against the current +₹23,406" */
export function tryText(t) {
    if (!t) return '';
    const w = t.whatIf || {};
    let s = `${t.label} — ${comboText(t.key, t.combo)}`;
    if (w.net != null) {
        s += `: ${signed(w.net)} on its last ${w.trades ?? '?'} trades replayed`;
        if (w.currentNet != null && w.currentNet !== w.net) s += `, ${signed(w.net - w.currentNet)} against the current ${signed(w.currentNet)}`;
        if (w.worst != null) s += ` (worst trade ${signed(w.worst)}${w.currentWorst != null ? `; current ${signed(w.currentWorst)}` : ''})`;
    }
    return s;
}
