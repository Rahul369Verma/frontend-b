import { describe, it, expect } from 'vitest';
import { sortAggregate, bestPerStrategy, bannerSentence, buildTestParams, buildSaveBodies, defaultK, plannedBacktests, PRESETS, verdictOf, weakestOf } from './crossIndex';

const N = 'NSE:NIFTY50-INDEX', B = 'NSE:NIFTYBANK-INDEX', F = 'NSE:FINNIFTY-INDEX';
const cell = (status, extra = {}) => ({ status, oosPF: status === 'robust' ? 1.5 : 0.8, oosTrades: 20, minSlPoints: 7, ...extra });
const row = (strategy, drawId, kValues, robustCount, per) => ({ strategy, label: strategy.toUpperCase(), drawId, kValues, robustCount, params: { ema: drawId, min_sl_points: 99, symbols: [N], preset: 'quick' }, perSymbol: per });

const result = {
  type: 'multi_index_optimization_result', jobId: 'j', seed: 1, nEligible: 3, kDefault: 2, symbols: [N, B, F],
  runConfig: { shared: { start_date: '2025-06-16', end_date: '2026-02-19', resolution: '5', capital: 100000, dataSource: 'ARCHIVE_SPOT', backtest_mode: 'Simulated Premium', slippage_percent: 0.05, brokerage_per_order: 20 },
    perSymbol: { [N]: { lot_size: 75, eligible: true, days: { test: 50 } }, [B]: { lot_size: 30, eligible: true, days: { test: 50 } }, [F]: { lot_size: 65, eligible: true, days: { test: 50 } } } },
  excluded: [], indexes: [{ strategies: [{}, {}] }],
  aggregate: [
    row('a', 3, { 2: 0.5, 3: null }, 2, { [N]: cell('robust', { oosPF: 2.1 }), [B]: cell('robust', { oosPF: 1.2, minSlPoints: 22 }), [F]: cell('overfit') }),
    row('a', 1, { 2: 0.5, 3: null }, 2, { [N]: cell('robust'), [B]: cell('robust'), [F]: cell('failed_train') }),
    row('b', 2, { 2: 0.9, 3: 0.2 }, 3, { [N]: cell('robust'), [B]: cell('robust'), [F]: cell('robust') }),
    row('c', 4, { 2: null, 3: null }, 1, { [N]: cell('robust'), [B]: cell('overfit'), [F]: cell('no_trades') }),
  ],
  sharedWinner: { strategy: 'b', label: 'B', drawId: 2, k: 2, robustCount: 3, nEligible: 3, groupsCovered: 2, groupsTotal: 2, weakest: { symbol: F, oosPF: 1.1, oosTrades: 14 }, strongest: { symbol: N, oosPF: 1.9, oosTrades: 31 }, tradesPerDay: 0.6, trials: 230 },
};

describe('crossIndex helpers', () => {
  it('defaultK and the planned backtest count follow the server rules', () => {
    expect([1, 2, 3, 4, 5, 6].map(defaultK)).toEqual([1, 2, 2, 3, 4, 4]);
    expect(plannedBacktests(PRESETS.quick, 30, 6)).toBe((30 * 30 + 6 * 200) * 6);
    expect(plannedBacktests(PRESETS.quick, 3, 2)).toBe((30 * 3 + 3 * 200) * 2);
  });

  it('sorts by the k-th value, nulls last, then robust count, then (k+1)-th, then drawId', () => {
    expect(sortAggregate(result.aggregate, 2).map(r => r.drawId)).toEqual([2, 1, 3, 4]);
    expect(sortAggregate(result.aggregate, 3).map(r => r.drawId)).toEqual([2, 1, 3, 4]);
  });

  it('keeps one row per strategy and splits held-up from not (never dropping any)', () => {
    const { held, notHeld } = bestPerStrategy(result.aggregate, 2);
    expect(held.map(r => r.strategy)).toEqual(['b', 'a']);
    expect(held[1].others.map(r => r.drawId)).toEqual([3]);
    expect(notHeld.map(r => r.strategy)).toEqual(['c']);
    const at3 = bestPerStrategy(result.aggregate, 3);
    expect(at3.held.map(r => r.strategy)).toEqual(['b']);
    expect(at3.notHeld.map(r => r.strategy).sort()).toEqual(['a', 'c']);
  });

  it('banner names the winner, groups, weakest and strongest from result fields only', () => {
    const s = bannerSentence(result, 2);
    expect(s).toMatch(/^B held up out-of-sample on 3 of 3 indexes/);
    expect(s).toMatch(/2 of 2 market groups/);
    expect(s).toMatch(/Weakest: FINNIFTY \(test PF 1\.10, 14 trades\)/);
    expect(s).toMatch(/strongest: NIFTY \(test PF 1\.90, 31 trades\)/);
    expect(s).toMatch(/230 settings per index/);
  });

  it('banner says so plainly when nothing holds up', () => {
    const none = { ...result, sharedWinner: null, aggregate: [result.aggregate[3]] };
    expect(bannerSentence(none, 2)).toMatch(/^No strategy held up out-of-sample on at least 2 of 3 indexes/);
  });

  it('Test params: the row\'s params, this index\'s lot and min SL, run context, orchestration keys removed', () => {
    const p = buildTestParams(result, result.aggregate[0], B);
    expect(p.symbol).toBe(B);
    expect(p.lot_size).toBe(30);
    expect(p.min_sl_points).toBe(22);
    expect(p.strategy).toBe('a');
    expect(p.dataSource).toBe('ARCHIVE_SPOT');
    expect(p.start_date).toBe('2025-06-16');
    expect(p.symbols).toBeUndefined();
    expect(p.preset).toBeUndefined();
    // the exact recorded row wins when present
    const withRow = { ...result.aggregate[0], perSymbol: { ...result.aggregate[0].perSymbol, [N]: { ...cell('robust'), row: { params: { ema: 42 } } } } };
    expect(buildTestParams(result, withRow, N).ema).toBe(42);
  });

  it('Save bodies: one per index (only robust ones when asked), named per index — never global defaults', () => {
    const all = buildSaveBodies(result, result.aggregate[0], [N, B, F], { date: '2026-10-12' });
    expect(all.map(b => b.name)).toEqual(['opt-a-NIFTY-2026-10-12', 'opt-a-BANKNIFTY-2026-10-12', 'opt-a-FINNIFTY-2026-10-12']);
    const robust = buildSaveBodies(result, result.aggregate[0], [N, B, F], { onlyRobust: true, date: '2026-10-12' });
    expect(robust.map(b => b.symbol)).toEqual([N, B]);
    expect(robust[1].params.min_sl_points).toBe(22);
    expect(robust[1].params.symbol).toBeUndefined();
  });

  it('verdicts and the weakest index', () => {
    expect(verdictOf({ status: 'robust' }).label).toBe('Held up');
    expect(verdictOf({ status: 'whatever' }).label).toBe('Not run');
    expect(weakestOf(result.aggregate[0], [N, B, F]).symbol).toBe(B);
  });
});
