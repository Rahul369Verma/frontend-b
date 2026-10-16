'use strict';
/**
 * settingGuide — what each Backtest setting does and what it may be set to, in
 * words an AI (or a person) can act on. Strategy-specific ranges come from the
 * backend (/api/strategies/:id/tuning-space, the optimizer's own sampler); this
 * file covers the settings every strategy shares and gives the common strategy
 * settings a one-line meaning.
 *
 * ASSUMPTION_KEYS are modelling assumptions, not decisions: lowering slippage or
 * raising capital "improves" a backtest without improving the strategy, so they
 * are sent to the AI as fixed context and never offered as changes.
 */

export const ASSUMPTION_KEYS = [
    'capital', 'lot_size', 'lots', 'slippage_percent', 'brokerage_per_order', 'resolution',
    'backtest_mode', 'dataSource', 'trade_mode', 'sim_iv_source', 'vix_source',
];

const TIME = 'time HH:MM (IST), 09:15–15:30';

/**
 * Settings the form shows with a fallback when the value was never set — the
 * same fallbacks the Backtest form displays, so the AI is told what the run
 * actually used. `when` limits a fallback to the mode that shows the field.
 */
export const FORM_FALLBACKS = {
    trade_start_time: { value: '09:30' },
    trade_end_time: { value: '15:00' },
    max_daily_loss: { value: 2000 },
    max_single_trade_loss: { value: 2000 },
    sl_type: { value: 'ATR' },
    sl_tp_type: { value: 'SPOT_ATR' },
    atr_period: { value: 14 },
    atr_sl_mult: { value: 1.8 },
    atr_tp_mult: { value: 3.5 },
    use_dynamic_sl: { value: false },
    use_trailing_sl: { value: false },
    trailing_sl_mult: { value: 1.5 },
    strike_selection: { value: 'ATM' },
    swing_lookback: { value: 10, when: p => (p.sl_tp_type || 'SPOT_ATR') === 'SPOT_SWING' },
    rr_ratio: { value: 2.0, when: p => (p.sl_tp_type || 'SPOT_ATR') === 'SPOT_SWING' },
    fixed_sl_points: { value: 40, when: p => (p.sl_type || 'ATR') === 'FIXED' },
    fixed_tp_points: { value: 100, when: p => (p.sl_type || 'ATR') === 'FIXED' },
};

/**
 * Settings on the form that a single-strategy backtest does NOT apply — offering
 * them to the AI would produce advice a re-test cannot show. Sent as context.
 */
export const NO_EFFECT_IN_BACKTEST = {
    max_trades_per_day: 'single-strategy backtests do not cap entries per day (only "Run together" and the live engine do)',
};

/** params + the form's fallbacks for anything never set (what the run really used). */
export function withFormFallbacks(params) {
    const out = { ...(params || {}) };
    for (const [k, f] of Object.entries(FORM_FALLBACKS)) {
        if ((out[k] === undefined || out[k] === null || out[k] === '') && (!f.when || f.when(out))) out[k] = f.value;
    }
    return out;
}

/** Shared settings: label, group, type, allowed, what. */
export const GENERAL_SETTINGS = {
    trade_start_time: { label: 'Trade Start Time', group: 'Timing', type: 'time', allowed: TIME, what: 'No new trades open before this time.' },
    trade_end_time: { label: 'Trade End Time', group: 'Timing', type: 'time', allowed: TIME, what: 'No new trades open after this time. Open trades are still managed and squared off before the close.' },
    max_trades_per_day: { label: 'Max Trades / Day', group: 'Risk & sizing', type: 'int', allowed: 'int 1–20', what: 'Cap on new entries per day.' },
    max_daily_loss: { label: 'Max Daily Loss (₹)', group: 'Risk & sizing', type: 'float', allowed: 'rupees > 0 (keep ≤ 3–5% of capital)', what: 'Stop opening trades for the day once the day has lost this much.' },
    max_single_trade_loss: { label: 'Max Single Loss (₹)', group: 'Risk & sizing', type: 'float', allowed: 'rupees > 0', what: 'Skip a trade whose worst case (stop distance × quantity) is larger than this.' },
    sl_type: { label: 'Stop-Loss Type', group: 'Exits', type: 'enum', allowed: 'one of ATR, FIXED, STRATEGY, INDEX_LEVEL', what: 'How the stop is set: from volatility (ATR), a fixed number of points, the strategy\'s own level, or a manual index level.' },
    sl_tp_type: { label: 'SL/TP Reference Chart', group: 'Exits', type: 'enum', allowed: 'one of SPOT_ATR, SPOT_SWING', what: 'Stops/targets measured on the index chart from ATR, or from recent swing highs/lows.' },
    swing_lookback: { label: 'Swing Lookback', group: 'Exits', type: 'int', allowed: 'int 3–30 (only with SPOT_SWING)', what: 'How many candles back to look for the swing high/low.' },
    rr_ratio: { label: 'Risk : Reward', group: 'Exits', type: 'float', allowed: 'float 1–5', what: 'Target distance as a multiple of stop distance.' },
    atr_period: { label: 'ATR Period', group: 'Exits', type: 'int', allowed: 'int 5–30', what: 'Candles used to measure volatility (ATR) for stops and targets.' },
    atr_sl_mult: { label: 'ATR SL Mult', group: 'Exits', type: 'float', allowed: 'float 0.5–3', what: 'Stop distance = this × ATR.' },
    atr_tp_mult: { label: 'ATR TP Mult', group: 'Exits', type: 'float', allowed: 'float 1–5', what: 'Target distance = this × ATR.' },
    fixed_sl_points: { label: 'Fixed SL (pts)', group: 'Exits', type: 'float', allowed: 'index points > 0 (only with FIXED)', what: 'Stop distance in index points.' },
    fixed_tp_points: { label: 'Fixed TP (pts)', group: 'Exits', type: 'float', allowed: 'index points > 0 (only with FIXED)', what: 'Target distance in index points.' },
    use_dynamic_sl: { label: 'Smart Volatility SL', group: 'Exits', type: 'bool', allowed: 'true / false', what: 'Use the ATR-based stop even when another stop type is chosen.' },
    min_sl_points: { label: 'Minimum SL Points', group: 'Exits', type: 'float', allowed: 'index points ≥ 0', what: 'Reject trades whose stop is tighter than this — too-tight stops get hit by noise.' },
    use_trailing_sl: { label: 'Trailing SL / Break-even', group: 'Exits', type: 'bool', allowed: 'true / false', what: 'Once in profit, move the stop to entry and then trail it.' },
    trailing_sl_mult: { label: 'Trailing Mult', group: 'Exits', type: 'float', allowed: 'float 0.5–3', what: 'How far behind the price the trailing stop follows (× ATR). Smaller = tighter.' },
    max_hold_candles: { label: 'Max Hold Candles', group: 'Exits', type: 'int', allowed: 'int 1–60', what: 'Close the trade after this many candles if neither stop nor target was hit.' },
    strike_selection: { label: 'Strike Selection', group: 'Instrument', type: 'enum', allowed: 'one of ATM, ITM_1, ITM_2, OTM_1', what: 'Which option to buy: ATM (delta ~0.5), in-the-money (moves more, costs more) or out-of-the-money (cheaper, riskier).' },
    adverse_exit_enabled: { label: 'Adverse Spot Move Stop', group: 'Protective filters', type: 'bool', allowed: 'true / false', what: 'Close if the index moves too far against the trade.' },
    adverse_atr_mult: { label: 'Adverse Move (× ATR)', group: 'Protective filters', type: 'float', allowed: 'float 0.5–5', what: 'How far against the trade (× ATR) before the adverse stop fires.' },
    enable_daily_profit_lock: { label: 'Daily Profit Lock', group: 'Protective filters', type: 'bool', allowed: 'true / false', what: 'Stop opening trades after the day\'s gain reaches a target.' },
    daily_profit_lock_pct: { label: 'Lock After Gain (%)', group: 'Protective filters', type: 'float', allowed: 'percent of capital, e.g. 0.5 = 0.5%', what: 'The day\'s gain (as % of capital) that locks trading.' },
    enable_daily_loss_filter: { label: 'Daily Loss Filter', group: 'Protective filters', type: 'bool', allowed: 'true / false', what: 'After several losing trades in a day, block lower-quality entries.' },
    max_daily_losses: { label: 'Max Losses Before Block', group: 'Protective filters', type: 'int', allowed: 'int 1–3', what: 'Losing trades in a day before entries are filtered (1–2) or blocked (3).' },
    use_vix_filter: { label: 'India VIX Filter', group: 'Market filters', type: 'bool', allowed: 'true / false', what: 'Only trade when the previous close of India VIX is inside [vix_min, vix_max].' },
    vix_min: { label: 'VIX Min', group: 'Market filters', type: 'float', allowed: 'float 0–40 (0 = no floor)', what: 'Lowest India VIX at which to trade.' },
    vix_max: { label: 'VIX Max', group: 'Market filters', type: 'float', allowed: 'float 0–60 (0 = no ceiling)', what: 'Highest India VIX at which to trade.' },
};

/** One-line meanings for strategy settings that many strategies share. */
export const STRATEGY_PARAM_HINTS = {
    use_trend_filter: 'Only trade in the EMA trend\'s direction (fast EMA above slow = calls only).',
    ema_short: 'Fast EMA length for the trend filter.',
    ema_long: 'Slow EMA length for the trend filter.',
    use_adx_filter: 'Only trade when ADX shows a trend strong enough.',
    adx_period: 'ADX length.',
    adx_threshold: 'Minimum ADX to allow a trade (higher = only strong trends).',
    use_rsi_filter: 'Skip buying calls when RSI is overbought / puts when oversold.',
    rsi_period: 'RSI length.',
    rsi_overbought: 'RSI above this counts as overbought.',
    rsi_oversold: 'RSI below this counts as oversold.',
    use_volume_filter: 'Only trade when volume is above its recent average × the multiplier.',
    volume_multiplier: 'How much above average volume must be.',
    spike_filter: 'Skip a breakout made by one huge candle that already retraced (a spike).',
    spike_max_retrace: 'How much of a spike candle may retrace before it is rejected (0–1).',
    spike_atr_mult: 'A candle larger than this × ATR counts as a spike.',
    confirm_hold_bars: 'Candles the breakout must hold before entering (0 = enter at once).',
    breakout_mode: 'ORB = break of the opening range; DYNAMIC = break of a rolling high/low channel.',
    orb_duration_min: 'Minutes after the open that form the opening range (ORB mode).',
    dynamic_lookback: 'Candles in the rolling high/low channel (DYNAMIC mode).',
    breakout_buffer_pct: 'Price must clear the level by this % to count as a breakout.',
    breakout_buffer_pts: 'Price must clear the level by this many points.',
    range_start_time: 'Start of the reference range (IST).',
    range_end_time: 'End of the reference range (IST).',
    orb_start_time: 'Time the opening range starts (IST).',
};

/** "spike_atr_mult" → "Spike Atr Mult" (the form's own labels). */
export function prettifyKey(key) {
    return String(key).split('_').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** A backend space entry → the "allowed" words shown to the AI. */
export function describeSpace(space) {
    if (!space) return null;
    if (space.type === 'bool') return 'true / false';
    if (space.type === 'enum') return `one of ${space.options.join(', ')}`;
    if (space.type === 'int' || space.type === 'float') return `${space.type} ${space.min}–${space.max} (the optimizer's range)`;
    return null;
}
