import { signed } from './stopReplayFormat.js';

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

// ── Backtest the change next to the deployment's own settings (17-Nov-2026) ────────────────────

/** JSON with sorted keys — two settings objects that differ only in key order are the same. */
export function stableJson(v) {
    if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
    return JSON.stringify(v ?? null);
}

/** What a backtest ran over, apart from its settings: two runs compare only when this is the same. */
export const runKeyOf = ({ template, symbol, from, to, resolution, chainSource }) => [template, symbol, from, to, String(resolution), chainSource].join('|');

/** A deployment's entry trigger as backtest params (what the builder's entryParams would be after loading it). */
export function entryParamsOf(d) {
    if (!d || d.entry_mode !== 'signal' || !d.signal_strategy) return {};
    return { entry_mode: 'signal', signal_strategy: d.signal_strategy, ...((d.params || {}).use_signal_exit ? { use_signal_exit: true } : {}), ...(d.signal_params ? { signal_params: d.signal_params } : {}) };
}

const ROWS = [
    // [label, metric, better: 'up' | 'down' | null, kind]
    ['Net P&L', 'netPnl', 'up', 'rupees'],
    ['Trades', 'n', null, 'count'],
    ['Win rate', 'winRate', 'up', 'pct'],
    ['Avg loss', 'avgLoss', 'down', 'rupees'],
    ['Max drawdown', 'maxDrawdown', 'down', 'rupees'],
    ['Profit factor', 'profitFactor', 'up', 'ratio'],
];
const fin = (v) => (v === Infinity ? Infinity : Number.isFinite(Number(v)) ? Number(v) : null);
/**
 * The deployment's settings vs the builder's, metric by metric: { label, key, kind, base, next, diff, verdict }.
 * verdict 'better' | 'worse' | 'same' | null. A loss or drawdown is judged by its size, whatever its sign.
 */
export function compareRows(base, next) {
    return ROWS.map(([label, key, better, kind]) => {
        const b = fin(base?.[key]), n = fin(next?.[key]);
        const diff = b != null && n != null && Number.isFinite(b) && Number.isFinite(n) ? Math.round((n - b) * 100) / 100 : null;
        let verdict = null;
        if (better && b != null && n != null) {
            const bb = better === 'down' ? Math.abs(b) : b, nn = better === 'down' ? Math.abs(n) : n;
            verdict = nn === bb ? 'same' : (better === 'up' ? nn > bb : nn < bb) ? 'better' : 'worse';
        }
        return { label, key, kind, base: b, next: n, diff, verdict };
    });
}

const SOURCE_WORDS = { archive: 'real option quotes (archive)', tape: 'the quote tape (the live engine replayed)', broker: 'synthetic option prices (an upper bound)' };
export const sourceWords = (s) => SOURCE_WORDS[s] || s || '—';

/** One line for the confirmation: the two backtests' nets, or why there is no comparison. */
export function compareLine({ base, next, period, stale }) {
    if (!base || !next) return 'Not backtested next to the deployment’s own settings.';
    const d = (Number(next.netPnl) || 0) - (Number(base.netPnl) || 0);
    return `Backtest ${period.from} → ${period.to} on ${sourceWords(period.chainSource)}: the deployment's settings ${signed(base.netPnl)} over ${base.n} trades; these ${signed(next.netPnl)} over ${next.n} (${d === 0 ? 'the same' : signed(d)}).${stale ? ' The settings changed after it ran.' : ''}`;
}
