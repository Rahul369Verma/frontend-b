// Pure helpers for the multi-index optimizer view. Everything here reads the
// server's `multi_index_optimization_result` (backend/logic/engine/optimizer/pooledRun.js)
// and never invents numbers: sentences and badges are built only from result fields.

export const INDEXES = [
  { symbol: 'NSE:NIFTY50-INDEX', name: 'NIFTY' },
  { symbol: 'NSE:NIFTYBANK-INDEX', name: 'BANKNIFTY' },
  { symbol: 'NSE:FINNIFTY-INDEX', name: 'FINNIFTY' },
  { symbol: 'NSE:MIDCPNIFTY-INDEX', name: 'MIDCPNIFTY' },
  { symbol: 'BSE:SENSEX-INDEX', name: 'SENSEX' },
  { symbol: 'BSE:BANKEX-INDEX', name: 'BANKEX' },
];
export const INDEX_SYMBOLS = INDEXES.map(i => i.symbol);
export const nameOf = (symbol) => INDEXES.find(i => i.symbol === symbol)?.name || String(symbol || '').replace(/^.*:/, '').replace('-INDEX', '');

// Mirrors the server presets (pooledRun.PRESETS) for the estimate shown before Start.
export const PRESETS = {
  quick: { d1: 30, s2: 6, d2: 200, label: 'Quick' },
  standard: { d1: 100, s2: 10, d2: 900, label: 'Standard' },
  thorough: { d1: 300, s2: 12, d2: 2000, label: 'Thorough' },
};
/** Backtests a budget implies: every strategy × index gets d1; the best s2 strategies get d2 more. */
export const plannedBacktests = (budget, nStrategies, nIndexes) =>
  (budget.d1 * nStrategies + Math.min(budget.s2, nStrategies) * budget.d2) * nIndexes;

// Default "must hold up on" count: max(2, ceil(2n/3)), never above n (server: singleLegRanking.defaultK).
export const defaultK = (n) => (n >= 1 ? Math.min(n, Math.max(2, Math.ceil((2 * n) / 3))) : 1);

const kv = (x) => (x == null || !Number.isFinite(Number(x)) ? -Infinity : Number(x));

/** Sort aggregate rows for "must hold up on at least K": k-th largest desc, robust count, (K+1)-th, drawId. */
export function sortAggregate(rows, k) {
  return [...(rows || [])].sort((a, b) =>
    (kv(b.kValues?.[k]) - kv(a.kValues?.[k])) ||
    ((b.robustCount || 0) - (a.robustCount || 0)) ||
    (kv(b.kValues?.[k + 1]) - kv(a.kValues?.[k + 1])) ||
    ((a.drawId || 0) - (b.drawId || 0)));
}

/** One row per strategy (its best at K), with how many other settings it has; split held-up vs not. */
export function bestPerStrategy(rows, k) {
  const sorted = sortAggregate(rows, k);
  const by = new Map();
  for (const r of sorted) {
    if (!by.has(r.strategy)) by.set(r.strategy, { ...r, others: [] });
    else by.get(r.strategy).others.push(r);
  }
  const all = [...by.values()];
  return { held: all.filter(r => r.kValues?.[k] != null), notHeld: all.filter(r => r.kValues?.[k] == null) };
}

const VERDICTS = {
  robust: { label: 'Held up', tone: 'success', short: '✓' },
  overfit: { label: 'Overfit', tone: 'danger', short: '⚠' },
  failed_train: { label: 'Failed train', tone: 'muted', short: '✗' },
  no_trades: { label: 'No trades', tone: 'muted', short: '0' },
  not_eligible: { label: 'Not judged', tone: 'muted', short: '–' },
  error: { label: 'Error', tone: 'danger', short: '!' },
  not_run: { label: 'Not run', tone: 'muted', short: '·' },
  screened_out: { label: 'Screened out', tone: 'muted', short: '…' },
};
export const verdictOf = (cell) => VERDICTS[cell?.status] || VERDICTS.not_run;

const FAIL_WORDS = { trades: 'too few trades', winRate: 'win rate below the filter', drawdown: 'drawdown above the filter', sharpe: 'Sharpe below the filter', loss: 'lost money in training', oos: 'failed the held-out test' };
export const failWords = (r) => FAIL_WORDS[r] || r || '';

const pf = (x) => (x == null ? '∞' : Number(x).toFixed(2));

/** The plain-English headline, built only from result fields. */
export function bannerSentence(result, k) {
  if (!result) return '';
  const n = result.nEligible || 0;
  const excluded = (result.excluded || []).map(e => `${nameOf(e.symbol)}: not judged — ${e.reason}`);
  const exTail = excluded.length ? ` ${excluded.join('. ')}.` : '';
  const strategies = (result.indexes?.[0]?.strategies || []).length;
  const w = result.sharedWinner;
  if (!w || (k != null && k !== w.k)) {
    const { held } = bestPerStrategy(result.aggregate, k ?? result.kDefault);
    if (held.length && k != null) {
      const top = held[0];
      return `${top.label} held up out-of-sample on ${top.robustCount} of ${n} indexes with the same settings (best at "at least ${k} of ${n}").${exTail}`;
    }
    return `No strategy held up out-of-sample on at least ${k ?? result.kDefault} of ${n} indexes with the same settings. See "By index" for single-index results.${exTail}`;
  }
  const groups = w.groupsTotal > 1 ? ` (${w.groupsCovered} of ${w.groupsTotal} market groups)` : '';
  const weak = w.weakest ? ` Weakest: ${nameOf(w.weakest.symbol)} (test PF ${pf(w.weakest.oosPF)}, ${w.weakest.oosTrades} trades)` : '';
  const strong = w.strongest && w.strongest.symbol !== w.weakest?.symbol ? `; strongest: ${nameOf(w.strongest.symbol)} (test PF ${pf(w.strongest.oosPF)}, ${w.strongest.oosTrades} trades)` : '';
  const tpd = w.tradesPerDay != null ? ` About ${w.tradesPerDay} trades a day.` : '';
  const picked = ` Picked from ${strategies} strateg${strategies === 1 ? 'y' : 'ies'} × ${w.trials} settings per index; the ranking already discounts for trying that many.`;
  return `${w.label} held up out-of-sample on ${w.robustCount} of ${n} indexes with enough data${groups}, same settings.${weak}${strong}.${tpd}${picked}${exTail}`;
}

// Keys that never travel from a result into a backtest (orchestration + run context set explicitly).
export const MULTI_OMIT_KEYS = ['symbols', 'preset', 'budget', 'seed', 'cross_index', 'minSlU', 'optimizer_workers', 'optimizer_block', 'jobId', 'strategies', 'iterations', 'stop_on_match', 'isOptimizer', 'DISABLE_RANDOMIZATION', 'signal'];

/** Backtest params for "Test on <index>" (contract: shared run context + the row's params + this index's lot and min SL). */
export function buildTestParams(result, row, symbol) {
  const shared = result?.runConfig?.shared || {};
  const ps = result?.runConfig?.perSymbol?.[symbol] || {};
  const cell = row?.perSymbol?.[symbol] || {};
  const src = cell.row?.params || row?.params || {};
  const params = { ...src };
  for (const k of MULTI_OMIT_KEYS) delete params[k];
  return {
    ...params,
    symbol,
    strategy: row.strategy,
    resolution: shared.resolution,
    start_date: shared.start_date,
    end_date: shared.end_date,
    capital: shared.capital,
    dataSource: shared.dataSource,
    backtest_mode: shared.backtest_mode,
    slippage_percent: shared.slippage_percent,
    brokerage_per_order: shared.brokerage_per_order,
    ...(ps.lot_size ? { lot_size: ps.lot_size } : {}),
    ...(cell.minSlPoints != null ? { min_sl_points: cell.minSlPoints } : {}),
  };
}

/** Saved-strategy bodies, one per index (only indexes where it held up when `onlyRobust`). Never global defaults. */
export function buildSaveBodies(result, row, symbols, { onlyRobust = false, date = new Date().toISOString().slice(0, 10) } = {}) {
  return (symbols || [])
    .filter(sym => !onlyRobust || row?.perSymbol?.[sym]?.status === 'robust')
    .map(sym => {
      const p = buildTestParams(result, row, sym);
      const strategyParams = { ...p };
      for (const k of ['symbol', 'strategy', 'start_date', 'end_date', 'capital']) delete strategyParams[k];
      return {
        name: `opt-${row.strategy}-${nameOf(sym)}-${date}`,
        strategyId: row.strategy,
        params: strategyParams,
        symbol: sym,
        start_date: p.start_date,
        end_date: p.end_date,
        capital: p.capital,
      };
    });
}

/** The weakest robust index of a row (lowest test PF), for the "Weakest index" column. */
export function weakestOf(row, symbols) {
  const robust = (symbols || []).filter(s => row?.perSymbol?.[s]?.status === 'robust')
    .map(s => ({ symbol: s, oosPF: row.perSymbol[s].oosPF, oosTrades: row.perSymbol[s].oosTrades }))
    .sort((a, b) => (a.oosPF ?? Infinity) - (b.oosPF ?? Infinity));
  return robust[0] || null;
}

/** Mean held-out trades per session over the row's robust indexes. */
export function tradesPerDayOf(row, result) {
  const per = result?.runConfig?.perSymbol || {};
  const vals = Object.entries(row?.perSymbol || {}).filter(([, v]) => v.status === 'robust')
    .map(([s, v]) => (v.oosTrades || 0) / Math.max(1, per[s]?.days?.test || 1));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
