/**
 * Editing a RUNNING deployment from the builder (23-Oct-2026): the request body, what blocks it,
 * and the words for each change. The server decides (backend logic/multileg/deploymentEdit.js);
 * these only shape what the builder sends and how the answer is shown.
 */

/** The builder's state → PATCH /multileg/deployments/:id body (size travels as `lots`). */
export function deploymentEditBody({ params = {}, entryMode = 'time', useSignalExit = false, signalParams = null, name = '' }) {
    const { lots, ...rest } = params || {};
    return {
        // the signal exit follows the checkbox — unticked clears it rather than keeping a loaded value
        params: { ...rest, use_signal_exit: entryMode === 'signal' && useSignalExit ? true : null },
        lots: Math.max(1, Math.round(Number(lots) || 1)),
        ...(entryMode === 'signal' ? { signal_params: signalParams ?? null } : {}),
        ...(String(name || '').trim() ? { name: String(name).trim() } : {}),
    };
}

/** Why the builder's current setup cannot be saved INTO the deployment being edited (or null). */
export function editBlocker(editing, { tplKey, symbol, entryMode, signalStrategy }) {
    if (!editing) return null;
    const diffs = [];
    if (tplKey !== editing.template) diffs.push('structure');
    if (symbol !== editing.symbol) diffs.push('symbol');
    if ((entryMode || 'time') !== (editing.entry_mode || 'time')) diffs.push('entry trigger');
    else if (entryMode === 'signal' && signalStrategy !== editing.signal_strategy) diffs.push('signal strategy');
    if (!diffs.length) return null;
    return `The ${diffs.join(', ')} ${diffs.length === 1 ? 'differs' : 'differ'} from the deployment's — that makes it a new strategy: save it and deploy it instead.`;
}

const val = (v) => (v == null ? 'default' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** "leg_sl_x: 1.4 → 1.3 — the open structure, at its next check" */
export function changeLine(c) {
    return `${c.key}: ${val(c.before)} → ${val(c.after)} — ${c.appliesTo}`;
}
