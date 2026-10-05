/** Pure helpers for DirectionConfidencePanel (kept out of the component file for Fast Refresh). */

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

