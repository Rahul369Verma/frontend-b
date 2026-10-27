/**
 * Words for VersionHistory.jsx — a strategy's / deployment's versions (backend
 * logic/services/strategyVersions.js, /api/versions).
 */

/** A setting's value in a change line: unset → "not set", objects as short JSON. */
export function valueText(v) {
    if (v === null || v === undefined) return 'not set';
    if (v === '(changed)') return '(changed)';
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (typeof v === 'object') {
        const s = JSON.stringify(v);
        return s.length > 60 ? `${s.slice(0, 57)}…` : s;
    }
    return String(v);
}

/** "params.leg_sl_x" → "leg_sl_x" (the params are what one edits; other fields keep their name). */
export const keyText = (k) => String(k).replace(/^params\./, '');

/** "leg_sl_x: 1.4 → 1.5" */
export function changeLine(c) {
    if (c.before === '(changed)' || c.after === '(changed)') return `${keyText(c.key)}: changed`;
    return `${keyText(c.key)}: ${valueText(c.before)} → ${valueText(c.after)}`;
}

/** The kinds the dialog can show, and what "restore" means for each. */
export const KIND_TEXT = {
    'multileg-strategy': { what: 'saved strategy', restoreNote: 'Puts back its structure, settings, entry trigger and the backtest saved with it. Its name stays. Deployments made from it are not changed.' },
    'single-strategy': { what: 'saved strategy', restoreNote: 'Puts back its strategy and settings. Its name stays. Deployments made from it are not changed.' },
    'multileg-deployment': { what: 'deployment', restoreNote: 'Puts back its settings and size through the same rules as Edit: exit settings act on an open structure at its next check, the rest from the next entry. Its name and trading mode stay.' },
    'single-deployment': { what: 'deployment', restoreNote: 'Puts back its settings. Its name, on/off and PAPER/LIVE stay.' },
};
