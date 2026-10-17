'use strict';
/**
 * backtestSettings — the ONE builder for "every setting this backtest uses".
 *
 * User, 17-Oct-2026: Copy JSON left out the times, the lot and most of the
 * strategy's settings, and could carry an older state. The cause: the form showed
 * three layers — what you set, the strategy's defaults, and its own fallbacks for
 * anything unset — but Run, Copy JSON and Deploy each sent only the first layer
 * (Deploy added the second), and the engine filled the gaps with ITS defaults,
 * some of which were not what the form showed.
 *
 * Now Run, Copy JSON / Download, Deploy and Ask AI all send effectiveSettings():
 *   strategy defaults (code < saved, as /engine/defaults returns them)
 *   < what you set (anything not undefined/null)
 *   < the form's fallbacks for what is still unset (settingGuide FORM_FALLBACKS)
 *   + one lot today for a lot-sized symbol (utils/lots.js).
 * The form reads the same object, so the screen, the run and the export agree.
 */
import { withFormFallbacks } from './settingGuide.js';
import { withCurrentLot } from './lots.js';
import { INSTRUMENT_CONFIG } from '../constants';

const isSet = (v) => v !== undefined && v !== null;

/**
 * @param params            the form's state (what you set)
 * @param strategyDefaults  { [strategyId]: defaults } from /engine/defaults (code < saved)
 */
export function effectiveSettings(params, { strategyDefaults = null, instrumentConfig = INSTRUMENT_CONFIG } = {}) {
    const p = params || {};
    const strat = (strategyDefaults && p.strategy && strategyDefaults[p.strategy]) || {};
    const merged = { ...strat };
    for (const [k, v] of Object.entries(p)) if (isSet(v)) merged[k] = v;
    return withCurrentLot(withFormFallbacks(merged), instrumentConfig);
}

/** Request shape for /engine/backtest/run: legacy keys dropped, numeric strings → numbers (resolution stays as typed). */
export function toRunPayload(settings) {
    const clean = { ...(settings || {}) };
    delete clean.interval;
    delete clean.period;
    // With an ensemble only ensemble_models matters.
    if (clean.use_ensemble) delete clean.model_file;
    for (const key of Object.keys(clean)) {
        if (key === 'resolution') continue;
        const val = clean[key];
        if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) clean[key] = Number(val);
    }
    return clean;
}

/** What Run sends and what Copy JSON exports — the same object, by construction. */
export const runSettings = (params, ctx) => toRunPayload(effectiveSettings(params, ctx));
