/** Pure helpers for DirectionConfidencePanel (kept out of the component file for Fast Refresh). */
import { inr } from '../viz/tokens.js';

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };

/** The state a side is in, as the gate sees it. */
export function sideState(side, opts) {
    if (!side) return { level: 'info', label: 'NO DATA' };
    const conf = n(side.confidence), nEff = n(side.nEff) ?? 0;
    if (nEff < (opts?.minNeff ?? 3)) return { level: 'info', label: 'THIN DATA' };
    if (conf < (opts?.floor ?? 0.4)) return { level: 'critical', label: 'WEAK' };
    if (conf >= 0.6) return { level: 'good', label: 'STRONG' };
    return { level: 'warning', label: 'NEUTRAL' };
}


const pct0 = (v) => (n(v) == null ? '—' : `${Math.round(n(v) * 100)}%`);

export const MODE_LINE = {
    enforce: 'Enforcing — signals on a weak side are blocked (1 in N still goes through as a probe).',
    shadow: 'Shadow — the gate only records what it would do; nothing is blocked.',
    off: 'Off — no decisions are made or recorded.',
};

/** What the gate does to this side right now, in one sentence. */
export function sideMeaning(st, { mode, probeEvery, left, floor }) {
    if (st.label === 'WEAK') {
        if (mode === 'enforce') return `Below the ${pct0(floor)} floor — these signals are blocked; 1 in ${probeEvery} goes through as a probe${left != null ? ` (next probe in ${left} signal${left === 1 ? '' : 's'})` : ''}.`;
        if (mode === 'shadow') return `Below the ${pct0(floor)} floor — Enforce would block these signals${left != null ? ` (next probe in ${left} signal${left === 1 ? '' : 's'})` : ''}; Shadow only records it.`;
        return `Below the ${pct0(floor)} floor — the gate is off, so nothing happens.`;
    }
    if (st.label === 'THIN DATA') return 'Too few recent trades on this side to judge — trades go ahead.';
    if (st.label === 'NO DATA') return 'No recent trades on this side — trades go ahead.';
    return 'Trusted enough — trades go ahead.';
}

/** One sentence: has blocking helped so far? */
export function gateVerdict(data) {
    const sc = data?.scorecard || {};
    const wb = sc.wouldBlock || { n: 0, net: 0 };
    const en = sc.enforce || null;
    const judged = sc.judged ?? wb.n;
    const enough = judged >= 10;
    const level = enough ? ((sc.value ?? (wb.net < 0 ? 1 : -1)) > 0 ? 'good' : 'critical') : 'info';
    let text;
    if (en && (en.ghosts > 0 || en.ghostsOpen > 0 || en.knockOn > 0)) {
        text = `So far the gate is ${sc.value >= 0 ? 'ahead' : 'behind'} by ${inr(Math.abs(sc.value ?? 0))} over the last ~4 weeks`;
    } else if (wb.n > 0) {
        text = `Blocking the ${wb.n} weak-side trade${wb.n === 1 ? '' : 's'} of the last ~4 weeks would have ${wb.savedIfEnforced >= 0 ? 'saved' : 'cost'} ${inr(Math.abs(wb.savedIfEnforced ?? 0))}`;
    } else {
        text = 'No weak-side trades in the last ~4 weeks yet';
    }
    return { level, text: `${text}${enough ? '.' : ' — too few blocked trades to judge yet (needs 10+).'}` };
}

