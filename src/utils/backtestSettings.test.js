/**
 * One builder for "every setting this backtest uses" (user, 17-Oct-2026):
 *  - Copy JSON left out the times, the lot and most strategy settings, and could
 *    carry an older state;
 *  - the Optimizer said one NIFTY lot was 75 (its window's start-date lot).
 *
 * What must hold, so neither can come back:
 *  - the form, Run, Copy JSON, Deploy and Save Config all read effectiveSettings();
 *  - JSON exported = request Run sends;
 *  - the form has no fallback of its own (a `params.x || 5` the table does not know);
 *  - a lot handed anywhere is ONE lot today; sizing is `lots`.
 */
import { describe, it, expect } from 'vitest';
import { effectiveSettings, runSettings, toRunPayload } from './backtestSettings.js';
import { FORM_FALLBACKS } from './settingGuide.js';
import { withCurrentLot, lotText, sizesByLots, currentLot } from './lots.js';
import { buildStrategyJson, parseStrategyJson } from './strategyJson.js';
import { buildTestParams, buildSaveBodies, settingsForIndex } from '../components/optimizer/crossIndex.js';
import backtestSrc from '../pages/Backtest.jsx?raw';
import optimizerSrc from '../pages/Optimizer.jsx?raw';

const DEFAULTS = { mta_ema_crossover: { ema_short: 7, ema_long: 23, max_hold_candles: 6, use_volume_filter: true, trade_start_time: '09:30', trade_end_time: '15:00' } };
const FORM = { strategy: 'mta_ema_crossover', symbol: 'NSE:NIFTY50-INDEX', start_date: '2025-06-01', end_date: '2026-02-21', resolution: '5', capital: '50000', ema_short: 9, lot_size: 75 };

describe('effectiveSettings — what the form shows is what runs', () => {
    const eff = effectiveSettings(FORM, { strategyDefaults: DEFAULTS });

    it('layers: strategy defaults < what you set < the form fallbacks for what is still unset', () => {
        expect(eff.ema_short).toBe(9);                 // you set it
        expect(eff.ema_long).toBe(23);                 // strategy default (shown on the form, was missing from the JSON)
        expect(eff.max_hold_candles).toBe(6);
        expect(eff.trade_end_time).toBe('15:00');      // times always present
        expect(eff.sl_type).toBe('ATR');               // form fallback
        expect(eff.slippage_percent).toBe(0.05);
        expect(eff.backtest_mode).toBe('Simulated Premium');
        // an unset (undefined/null) value never hides a strategy default
        expect(effectiveSettings({ ...FORM, ema_long: undefined, max_hold_candles: null }, { strategyDefaults: DEFAULTS })).toMatchObject({ ema_long: 23, max_hold_candles: 6 });
    });

    it('the lot is ONE lot today and sizing is `lots` — a stale 75 never survives', () => {
        expect(eff.lot_size).toBe(65);
        expect(eff.lots).toBe(1);
        expect(effectiveSettings({ ...FORM, lots: '3' }).lots).toBe(3);
        // MCX keeps its own lot field untouched
        expect(effectiveSettings({ strategy: 'x', symbol: 'MCX:GOLD26DECFUT', lot_size: 100 }).lot_size).toBe(100);
    });

    it('Copy JSON exports exactly what Run sends, and importing it gives the same back', () => {
        const run = runSettings(FORM, { strategyDefaults: DEFAULTS });
        expect(run.capital).toBe(50000);               // numeric strings cast, as the request always was
        expect(run.resolution).toBe('5');              // resolution stays as typed
        const json = buildStrategyJson(run, { source: 'backtest' });
        expect(json.settings).toEqual(run);
        const back = parseStrategyJson(JSON.stringify(json));
        expect(back.settings).toEqual(run);
        // and an edit shows up at once — the builder reads the current state, nothing cached
        expect(runSettings({ ...FORM, trade_end_time: '14:10' }, { strategyDefaults: DEFAULTS }).trade_end_time).toBe('14:10');
    });

    it('toRunPayload keeps the old request rules', () => {
        expect(toRunPayload({ interval: '5', period: 'x', use_ensemble: true, model_file: 'm', ensemble_models: ['a'], atr_sl_mult: '1.4', start_date: '2025-01-01' }))
            .toEqual({ use_ensemble: true, ensemble_models: ['a'], atr_sl_mult: 1.4, start_date: '2025-01-01' });
    });
});

describe('the Backtest form has no fallback of its own', () => {
    it('every field with a fallback reads `shown` (the table), not `params.x || value`', () => {
        const own = [...backtestSrc.matchAll(/(?:value|checked)=\{params\.([a-z_0-9]+)\s*(?:\|\||\?\?)/g)].map((m) => m[1]);
        const unknown = own.filter((k) => FORM_FALLBACKS[k]);
        expect(unknown).toEqual([]);
        // left: the strategy picker, three empty-means-none inputs, and the combiner's members
        // (its fallback is the strategy default — the same layer `shown` puts under it)
        expect(own.sort()).toEqual(['ai_max_signals', 'futures_expiry', 'members', 'model_file', 'strategy']);
    });
    it('Run, Copy JSON, Deploy and Save Config all send the same builder', () => {
        expect(backtestSrc).toMatch(/<StrategyJsonControls params=\{sendable\}/);
        expect(backtestSrc).toMatch(/cleanParams = \{ \.\.\.\(overrideParams \? runSettings\(overrideParams, \{ strategyDefaults \}\) : sendable\)/);
        expect(backtestSrc).toMatch(/const cleanParams = sendable;/);                    // Deploy
        expect(backtestSrc).toMatch(/Object\.keys\(sendable\)\.forEach/);                // Save Config
        expect(backtestSrc).not.toMatch(/preparePayload\(/);
    });
    it('the ATR multipliers shown are the engine\'s (they read 1.8 / 3.5 while the engine ran 1.4 / 4.3)', () => {
        expect(FORM_FALLBACKS.atr_sl_mult.value).toBe(1.4);
        expect(FORM_FALLBACKS.atr_tp_mult.value).toBe(4.3);
        expect(FORM_FALLBACKS.max_single_trade_loss.value).toBe(2000);   // live's default — backtests apply it now too
    });
});

describe('lots — one lot today, a window is a timeline', () => {
    it('knows which symbols are sized lots × lot', () => {
        expect(sizesByLots('NSE:NIFTY50-INDEX')).toBe(true);
        expect(sizesByLots('MCX:GOLD26DECFUT')).toBe(false);
        expect(sizesByLots('DELTA:BTCUSD')).toBe(false);
        expect(currentLot('NSE:NIFTY50-INDEX')).toBe(65);
        expect(withCurrentLot({ symbol: 'NSE:NIFTY50-INDEX', lot_size: 75, lots: 0 })).toEqual({ symbol: 'NSE:NIFTY50-INDEX', lot_size: 65, lots: 1 });
    });
    it('says what a window crosses instead of printing its start-date lot', () => {
        expect(lotText(65, [{ from: '2026-01-01', to: '2026-03-31', size: 65 }])).toBe('65');
        expect(lotText(65, [{ from: '2025-06-01', to: '2025-12-30', size: 75 }, { from: '2025-12-31', to: '2026-02-21', size: 65 }]))
            .toBe('65 — window: 75 until 30 Dec 2025, then 65');
        expect(lotText(30, [{ size: 30, to: '2025-06-26' }, { size: 35, to: '2025-08-28' }, { size: 30, to: '2025-09-24' }])).toBe('30 — window crosses 2 lot changes (30, 35)');
    });
});

describe('Optimizer hand-offs — an old run that stored the start-date lot', () => {
    const N = 'NSE:NIFTY50-INDEX';
    const result = {
        runConfig: { shared: { start_date: '2025-06-01', end_date: '2026-02-21', resolution: '5', capital: 100000, dataSource: 'ARCHIVE_SPOT', backtest_mode: 'Simulated Premium' },
            perSymbol: { [N]: { lot_size: 75 } } },
    };
    const row = { strategy: 'breakout_range', params: { range_minutes: 30, symbols: [N] }, perSymbol: { [N]: { status: 'robust', minSlPoints: 17 } } };

    it('Test, Copy JSON and Save all hand over one lot today (65), never the stored 75', () => {
        expect(buildTestParams(result, row, N)).toMatchObject({ lot_size: 65, lots: 1, min_sl_points: 17, range_minutes: 30 });
        expect(settingsForIndex(result, row.params, N, 'breakout_range').lot_size).toBe(65);
        expect(buildSaveBodies(result, row, [N])[0].params.lot_size).toBe(65);
    });
    it('the single-index Test and the run request use the same rule', () => {
        expect(optimizerSrc).toMatch(/newBacktestParams: withCurrentLot\(newBacktestParams\)/);
        expect(optimizerSrc).toMatch(/lot_size: \(sizesByLots\(config\.symbol\) && currentLot\(config\.symbol\)\)/);
        expect(optimizerSrc).not.toMatch(/as of the start date/);
    });
});
