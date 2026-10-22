/** Pure helpers for the backtest direction-gate controls and panel (Fast Refresh: no components here). */

export const GATE_DEFAULTS = { mode: 'off', floor: 0.4, halfLife: 3, probeEvery: 3, minNeff: 3, learnBlocked: true };

/**
 * Backtest request fields for the gate. OFF sends nothing, so the request — and the
 * result — are identical to a run without the feature.
 */
export function gateParams(g) {
    if (!g || g.mode === 'off') return {};
    return {
        direction_gate_mode: g.mode,
        direction_gate_floor: Number(g.floor),
        direction_gate_half_life: Number(g.halfLife),
        direction_gate_probe_every: Number(g.probeEvery),
        direction_gate_min_neff: Number(g.minNeff),
        // enforce: a blocked signal's result counts toward its side, as live (default on)
        ...(g.mode === 'enforce' ? { direction_gate_learn_blocked: g.learnBlocked !== false } : {}),
    };
}

/** What became of a blocked backtest signal that was not (or could not be) followed. */
export function blockedOutcome(b) {
    if (!b || !b.ghost) return '—';
    if (b.ghost === 'followed') return 'followed';
    if (b.ghost === 'unmatched') return 'no gate-off trade at this candle';
    return 'not followed (no gate-off run)';
}

export const DECISION_TONE = { ALLOW: 'good', PROBE: 'info', BLOCK: 'critical', THIN: 'muted', NONE: 'muted', UNMEASURED: 'warning' };

export const pct0 = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 100)}%`);

/** A suggestion's settings ({floor, halfLifeSessions, probeEvery, minNeff}) → the controls' shape. */
export function settingsToGate(s, mode = 'enforce') {
    if (!s) return { mode: 'off' };
    return { mode, floor: s.floor, halfLife: s.halfLifeSessions, probeEvery: s.probeEvery, minNeff: s.minNeff };
}

/** "40% · 3 · 1 in 3 · 3" — one line per setting, the same order as the controls. */
export const settingsLine = (s) => (s ? `floor ${pct0(s.floor)} · half-life ${s.halfLifeSessions} · probe 1 in ${s.probeEvery} · min evidence ${s.minNeff}` : '—');

export const DIAG_LEVEL = { critical: 'critical', warning: 'warning', good: 'good', info: 'info' };
