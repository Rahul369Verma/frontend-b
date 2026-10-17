'use strict';
/**
 * strategyJson — one portable JSON for a set of Backtester settings.
 *
 * Exported from the Backtester (Copy / Download), copied from any Optimizer
 * result (an index card, a "By index" row, a leaderboard row — also in old runs),
 * and imported into the Backtester (paste or file). One format, so anything
 * copied anywhere loads the same way the Optimizer's "Test" button does.
 *
 *   {
 *     "format": "backtest-settings", "version": 1, "exportedAt": "…", "source": "optimizer",
 *     "label": "breakout_range on NIFTY — optimizer, held up",
 *     "strategy": "breakout_range", "symbol": "NSE:NIFTY50-INDEX", "resolution": "5",
 *     "settings": { …every setting, flat, exactly as the Backtester's form holds it… },
 *     "results": { …what it scored where it came from (informational, never imported) }
 *   }
 *
 * Import also accepts the shapes that already exist: the Optimizer's hand-off
 * ({ symbol, strategy, params: {…} }), a saved-strategy document
 * ({ strategyName, symbol, params }) and a bare flat settings object.
 */

export const STRATEGY_JSON_FORMAT = 'backtest-settings';
export const STRATEGY_JSON_VERSION = 1;

/** Strategy CLASS names (older payloads) → the Backtester's ids. */
export const STRATEGY_CLASS_TO_ID = Object.freeze({
    MultiTimeframeStrategy: 'mta_ema_crossover', VwapMomentumStrategy: 'vwap_momentum', BollingerBandStrategy: 'bb_reversion',
    InsideBarStrategy: 'inside_bar', FalseInsideBarStrategy: 'false_inside_bar', HybridInsideBarStrategy: 'hybrid_inside_bar',
    OrbStrategy: 'orb_breakout', SuperTrendStrategy: 'supertrend_adx', UniversalStrategy: 'universal',
    CandlestickPatternStrategy: 'candlestick_pattern', BreakoutRangeStrategy: 'breakout_range', PowerOfStocks5EmaStrategy: 'pos_5ema_scalp',
    VwapScalpStrategy: 'vwap_scalp', MomentumScalpStrategy: 'momentum_scalp', TrendLineStrategy: 'trend_line', RlStrategy: 'rl_agent',
    ApexConfluenceStrategy: 'apex_confluence', SmcOrderBlockStrategy: 'smc_ob', LiquiditySweepStrategy: 'liquidity_sweep',
    WyckoffSpringStrategy: 'wyckoff_spring', FibonacciPullbackStrategy: 'fib_golden_pocket', QuantumReversionStrategy: 'quantum_qho',
    VolumeSurgeStrategy: 'volume_surge', CouncilEnsembleStrategy: 'council_ensemble', Rsi2ReversionStrategy: 'rsi2_reversion',
    GapEdgeStrategy: 'gap_edge', IntradayMomentumStrategy: 'intraday_momentum', MomentumDivergenceStrategy: 'momentum_divergence',
    OpenDriveTrendStrategy: 'open_drive_trend', IchimokuKumoStrategy: 'ichimoku_kumo',
});

export const normalizeStrategyId = (s) => (s == null ? s : (STRATEGY_CLASS_TO_ID[s] || s));

// Database/bookkeeping fields that are not settings and must never be imported.
const META_KEYS = new Set(['_id', '__v', 'id', 'createdAt', 'updatedAt', 'savedAt', 'savedBy', 'name', 'description', 'backtest', 'optimizer', 'format', 'version', 'exportedAt', 'source', 'label', 'results', 'settings', 'params']);

function cleanSettings(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (k.startsWith('_') || META_KEYS.has(k) || v === undefined || typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}

/**
 * Build the portable JSON for a set of flat Backtester settings.
 * @param {object} flat     the settings, flat (as the Backtester holds them)
 * @param {{source?:string, label?:string|null, results?:object|null}} [opts]
 */
export function buildStrategyJson(flat, { source = 'backtest', label = null, results = null } = {}) {
    const settings = cleanSettings(flat);
    if (settings.strategy) settings.strategy = normalizeStrategyId(settings.strategy);
    return {
        format: STRATEGY_JSON_FORMAT, version: STRATEGY_JSON_VERSION, exportedAt: new Date().toISOString(), source,
        ...(label ? { label } : {}),
        strategy: settings.strategy ?? null, symbol: settings.symbol ?? null, resolution: settings.resolution ?? null,
        settings,
        ...(results ? { results } : {}),
    };
}

export const strategyJsonText = (obj) => JSON.stringify(obj, null, 2);

/**
 * Read pasted or uploaded JSON into flat settings for the Backtester.
 * @param {string} text
 * @param {{knownStrategies?:string[]|null}} [opts]
 * @returns {{ok:true, settings:object, meta:object, warnings:string[]} | {ok:false, error:string}}
 */
export function parseStrategyJson(text, { knownStrategies = null } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, error: 'Paste the strategy JSON (or choose a .json file) first.' };
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, error: `This is not valid JSON: ${e.message}` }; }
    if (Array.isArray(obj) && obj.length === 1 && obj[0] && typeof obj[0] === 'object') obj = obj[0];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'Expected one JSON object with the strategy settings.' };

    const warnings = [];
    let flat, meta = {};
    if (obj.format === STRATEGY_JSON_FORMAT) {
        if (Number(obj.version) > STRATEGY_JSON_VERSION) warnings.push(`Made by a newer version of the platform (format v${obj.version}) — settings it adds may be ignored.`);
        flat = { ...cleanSettings({ strategy: obj.strategy, symbol: obj.symbol, resolution: obj.resolution }), ...cleanSettings(obj.settings) };
        meta = { source: obj.source || null, label: obj.label || null, exportedAt: obj.exportedAt || null, results: obj.results || null };
    } else if (obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)) {
        // the Optimizer hand-off, or a saved-strategy document
        flat = { ...cleanSettings(obj), ...cleanSettings(obj.params) };
        meta = { source: obj.strategyName || obj.name ? 'saved strategy' : 'optimizer', label: obj.name || null };
    } else {
        flat = cleanSettings(obj);
        meta = { source: 'plain settings' };
    }
    if (!flat.strategy && obj.strategyName) flat.strategy = obj.strategyName;
    delete flat.strategyName;
    if (!flat.strategy) return { ok: false, error: 'No strategy in this JSON — it needs a "strategy" (e.g. "breakout_range").' };
    flat.strategy = normalizeStrategyId(flat.strategy);
    if (Array.isArray(knownStrategies) && knownStrategies.length && !knownStrategies.includes(flat.strategy)) {
        return { ok: false, error: `The Backtester does not know the strategy "${flat.strategy}".` };
    }
    if (!flat.symbol) warnings.push('No symbol in this JSON — the current symbol is kept.');
    if (Object.keys(flat).length <= 1) warnings.push('Only the strategy is set — every other setting keeps its current value.');
    return { ok: true, settings: flat, meta, warnings };
}

const same = (a, b) => (a === b) || (a != null && b != null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b)) || (a != null && b != null && String(a) === String(b) && typeof a !== 'object' && typeof b !== 'object');

/**
 * What loading changes: [{key, from, to, removed?}], strategy and symbol first.
 * Pass the RESULTING settings with `{ removed: true }` to also list settings that
 * disappear (the old strategy's parameters when the page rebuilds from scratch).
 */
export function diffSettings(current = {}, incoming = {}, { removed = false } = {}) {
    const out = [];
    for (const [k, v] of Object.entries(incoming)) if (!same(current[k], v)) out.push({ key: k, from: current[k], to: v });
    if (removed) for (const [k, v] of Object.entries(current)) if (!(k in incoming) && v !== undefined) out.push({ key: k, from: v, to: undefined, removed: true });
    const first = ['strategy', 'symbol', 'resolution', 'start_date', 'end_date'];
    return out.sort((a, b) => {
        const ia = first.indexOf(a.key), ib = first.indexOf(b.key);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.key.localeCompare(b.key);
    });
}

/** Copy text to the clipboard (falls back to a hidden textarea where the API is unavailable). */
export async function copyText(text) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext !== false) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) { /* fall back below */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch (_) { return false; }
}

/** Save an object as a .json file. */
export function downloadJson(obj, filename) {
    const blob = new Blob([strategyJsonText(obj)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "breakout_range-NIFTY50-2026-10-17.json" */
export function jsonFileName(j) {
    const sym = String(j.symbol || 'symbol').replace(/^(NSE|BSE|MCX):/, '').replace(/-INDEX$/, '').replace(/[^A-Za-z0-9]+/g, '-');
    return `${j.strategy || 'strategy'}-${sym}-${String(j.exportedAt || '').slice(0, 10) || 'settings'}.json`;
}
