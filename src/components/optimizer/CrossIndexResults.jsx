import React from 'react';
import { ChevronDown, ChevronRight, Trophy, AlertTriangle, TrendingUp } from 'lucide-react';
import useRemWidth from '../../hooks/useRemWidth';
import { API_ORIGIN } from '../../config/api.js';
import {
  nameOf, bestPerStrategy, verdictOf, bannerSentence, buildTestParams, buildSaveBodies, weakestOf, tradesPerDayOf, failWords, MULTI_OMIT_KEYS, winnerAt,
} from './crossIndex';
import DocLink from '../DocLink.jsx';

const TONE = {
  success: 'bg-emerald-500/15 border-emerald-500/40 text-success',
  danger: 'bg-red-500/15 border-red-500/40 text-danger',
  muted: 'bg-slate-700/60 border-line-2 text-fg-4',
};
const PF_HELP = 'PF = profit factor: gross wins ÷ gross losses on the held-out test window (above 1 = made money).';
const rupee = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const pf = (v) => (v == null ? '—' : Number(v) >= 1e9 ? '∞' : Number(v).toFixed(2));

function ParamChips({ params, noise }) {
  const entries = Object.entries(params || {}).filter(([k, v]) => !noise.has(k) && v !== undefined && v !== null && v !== '');
  if (!entries.length) return <span className="text-fg-5 text-2xs">No tunable params</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="text-3xs bg-slate-800 border border-line px-1.5 py-0.5 rounded">
          <span className="text-fg-4">{k}:</span> <span className="text-fg-2 font-mono">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</span>
        </span>
      ))}
    </div>
  );
}

// One verdict chip per index; it is also the "Test on <index>" button.
function VerdictChip({ row, symbol, onTest }) {
  const cell = row.perSymbol?.[symbol] || { status: 'not_run' };
  const v = verdictOf(cell);
  const tip = `${nameOf(symbol)}: ${v.label}${cell.failReason ? ` (${failWords(cell.failReason)})` : ''}`
    + (cell.fullPnL != null ? ` · full window ${rupee(cell.fullPnL)} over ${cell.fullTrades} trades` : '')
    + (cell.oosPF != null ? ` · test PF ${pf(cell.oosPF)}, ${cell.oosTrades} trades` : '') + ' — click to test on the Backtester';
  return (
    <button type="button" onClick={() => onTest(row, symbol)} title={tip} aria-label={`Test on ${nameOf(symbol)} — ${v.label}`}
      className={`text-3xs px-1.5 py-0.5 rounded border whitespace-nowrap ${TONE[v.tone]}`}>
      {nameOf(symbol)} {v.short}
    </button>
  );
}

function IndexCard({ row, symbol, onTest, onSave }) {
  const c = row.perSymbol?.[symbol] || { status: 'not_run' };
  const v = verdictOf(c);
  return (
    <div className={`p-2 rounded border ${TONE[v.tone]} space-y-1`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-xs">{nameOf(symbol)}</span>
        <span className="text-3xs">{v.label}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-2 text-3xs text-fg-3">
        <dt className="text-fg-5">Test P&L</dt><dd className="font-mono">{rupee(c.oosPnL)}</dd>
        <dt className="text-fg-5">Test win %</dt><dd>{c.oosWinRate != null ? `${Number(c.oosWinRate).toFixed(1)}%` : '—'}</dd>
        <dt className="text-fg-5" title={PF_HELP}>Test PF</dt><dd>{pf(c.oosPF)}</dd>
        <dt className="text-fg-5">Test trades</dt><dd>{c.oosTrades ?? '—'}</dd>
        <dt className="text-fg-5">Full window</dt><dd className="font-mono">{rupee(c.fullPnL)} · {c.fullTrades ?? 0}t</dd>
        <dt className="text-fg-5" title="Consistency 0–100: profitable months × how straight the equity line is (full window)">Consistency</dt><dd>{c.fullConsistency != null ? Math.round(c.fullConsistency) : '—'}{c.oosConsistency != null ? <span className="text-fg-5"> · test {Math.round(c.oosConsistency)}</span> : null}</dd>
        <dt className="text-fg-5">Min SL pts</dt><dd>{c.minSlPoints ?? '—'}</dd>
      </dl>
      {c.failReason && <p className="text-3xs text-fg-4">Why not: {failWords(c.failReason)}</p>}
      <div className="flex gap-1 pt-1">
        <button type="button" className="text-3xs bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded text-fg" onClick={() => onTest(row, symbol)}>Test</button>
        <button type="button" className="text-3xs bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded text-fg" onClick={() => onSave(row, [symbol])}>Save for {nameOf(symbol)}</button>
      </div>
    </div>
  );
}

function ByIndex({ result, noise, onTestParams }) {
  const indexes = result.indexes || [];
  const [ix, setIx] = React.useState(0);
  const cur = indexes[ix];
  const [strategy, setStrategy] = React.useState(cur?.best_strategy || cur?.strategies?.[0]?.strategy || '');
  const [cell, setCell] = React.useState({ loading: false, error: null, data: null });
  React.useEffect(() => { setStrategy(cur?.best_strategy || cur?.strategies?.[0]?.strategy || ''); }, [ix]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!cur || !strategy || !result.jobId) return undefined;
    let cancelled = false;
    setCell({ loading: true, error: null, data: null });
    fetch(`${API_ORIGIN}/api/engine/optimizer/jobs/${encodeURIComponent(result.jobId)}/cells/${encodeURIComponent(cur.symbol)}/${encodeURIComponent(strategy)}`)
      .then(async r => { const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`); return d; })
      .then(d => { if (!cancelled) setCell({ loading: false, error: null, data: d }); })
      .catch(e => { if (!cancelled) setCell({ loading: false, error: e.message, data: null }); });
    return () => { cancelled = true; };
  }, [ix, strategy, result.jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cur) return <p className="text-fg-5 text-sm">No per-index results.</p>;
  const st = cur.strategies.find(s => s.strategy === strategy);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Index" className="flex flex-wrap gap-1">
        {indexes.map((x, i) => (
          <button key={x.symbol} type="button" role="tab" aria-selected={i === ix} onClick={() => setIx(i)}
            className={`text-xs px-2 py-1 rounded border ${i === ix ? 'bg-primary/15 border-primary/50 text-primary-ink' : 'border-line text-fg-3'} ${x.eligible ? '' : 'opacity-60'}`}>
            {nameOf(x.symbol)}{x.eligible ? '' : ' (not judged)'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="byindex-strategy" className="text-xs text-fg-4">Strategy</label>
        <select id="byindex-strategy" value={strategy} onChange={e => setStrategy(e.target.value)} className="bg-slate-900 border border-line rounded p-1 text-fg text-xs">
          {cur.strategies.map(s => <option key={s.strategy} value={s.strategy}>{s.label} — {s.status === 'done' ? `${s.topCount} sets` : s.status.replace('_', ' ')}</option>)}
        </select>
        {cur.best_strategy && <span className="text-2xs text-fg-4"><Trophy className="inline w-3 h-3 text-warning" aria-hidden="true" /> best on {nameOf(cur.symbol)}: {cur.best_strategy_label}</span>}
        {st && <span className="text-2xs text-fg-5">{st.trials} settings tried</span>}
      </div>
      {cell.loading && <p className="text-2xs text-fg-5">Loading…</p>}
      {cell.error && <p className="text-2xs text-warning">{cell.error}</p>}
      {cell.data && (
        <div className="overflow-x-auto">
          {cell.data.rows.length === 0 ? <p className="text-2xs text-fg-5">No setting passed the filters on this index ({Object.entries(cell.data.failCounts || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${failWords(k) || k}`).join(', ') || 'no trades'}).</p> : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-fg-5 border-b border-line-0">
                  <th className="p-1.5">#</th><th className="p-1.5">Score</th><th className="p-1.5">Full P&L</th><th className="p-1.5">Win %</th><th className="p-1.5">Trades</th>
                  <th className="p-1.5">Max DD</th><th className="p-1.5" title={PF_HELP}>PF</th><th className="p-1.5 text-success">Test P&L</th><th className="p-1.5">Verdict</th><th className="p-1.5">Params</th><th className="p-1.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {cell.data.rows.map((r, i) => {
                  const m = r.full || r.metrics || {};
                  return (
                    <tr key={r.drawId ?? i} className="border-b border-line-0/60">
                      <td className="p-1.5 text-primary-ink font-bold">#{i + 1}</td>
                      <td className="p-1.5 font-mono text-warning">{r.robust ? (Number.isFinite(r.rankScoreDeflated) ? r.rankScoreDeflated.toFixed(2) : '—') : <span className="text-danger/70 text-2xs">overfit</span>}</td>
                      <td className="p-1.5 font-mono">{rupee(m.totalPnL)}</td>
                      <td className="p-1.5">{m.winRate}%</td>
                      <td className="p-1.5">{m.totalTrades}</td>
                      <td className="p-1.5 text-danger">{m.maxDrawdown}%</td>
                      <td className="p-1.5">{pf(m.profitFactor)}</td>
                      <td className={`p-1.5 font-mono ${(r.oos?.totalPnL ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>{r.oos ? rupee(r.oos.totalPnL) : '—'}</td>
                      <td className="p-1.5">{r.robust ? <span className={`text-3xs px-1 py-0.5 rounded border ${TONE.success}`}>Held up</span> : <span className={`text-3xs px-1 py-0.5 rounded border ${TONE.danger}`}>Overfit</span>}</td>
                      <td className="p-1.5 max-w-md"><ParamChips params={r.params} noise={noise} /></td>
                      <td className="p-1.5"><button type="button" className="text-2xs bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded text-fg" onClick={() => onTestParams(r, cur.symbol, strategy)}>Test</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Results of a multi-index run.
 * @param onTest(params, strategy)  navigates to the Backtester with these params
 * @param onSave(bodies) → Promise   one saved-strategy doc per body
 */
export default function CrossIndexResults({ result, onTest, onSave, onClear, noise = new Set() }) {
  const panelRef = React.useRef(null);
  const rem = useRemWidth(panelRef);
  const layout = rem == null || rem >= 64 ? 'wide' : rem >= 40 ? 'mid' : 'narrow';
  const n = result.nEligible || 0;
  const symbols = result.symbols || [];
  const eligible = symbols.filter(s => result.runConfig?.perSymbol?.[s]?.eligible);
  const [k, setK] = React.useState(result.kDefault || 2);
  const [tab, setTab] = React.useState('cross');
  const [open, setOpen] = React.useState(null);
  const [showNotHeld, setShowNotHeld] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState(null);
  const { held, notHeld } = React.useMemo(() => bestPerStrategy(result.aggregate, k), [result, k]);
  const sentence = bannerSentence(result, k);
  // Not simply held[0]: a signal combiner that failed its crown gates holds up but is never crowned.
  const winnerAtK = React.useMemo(() => winnerAt(result, k), [result, k]);

  const test = (row, symbol) => onTest(buildTestParams(result, row, symbol), row.strategy);
  const save = async (row, syms, onlyRobust = false) => {
    const bodies = buildSaveBodies(result, row, syms, { onlyRobust });
    if (!bodies.length) { setSaveMsg('Nothing to save — it did not hold up on any index.'); return; }
    try { await onSave(bodies); setSaveMsg(`Saved ${bodies.length} setting${bodies.length === 1 ? '' : 's'}: ${bodies.map(b => b.name).join(', ')}`); }
    catch (e) { setSaveMsg(`Save failed: ${e.message}`); }
  };
  const testCellRow = (r, symbol, strategy) => {
    const params = { ...(r.params || {}) };
    for (const key of MULTI_OMIT_KEYS) delete params[key];
    const shared = result.runConfig?.shared || {};
    onTest({ ...params, symbol, strategy, resolution: shared.resolution, start_date: shared.start_date, end_date: shared.end_date, capital: shared.capital,
      dataSource: shared.dataSource, backtest_mode: shared.backtest_mode, slippage_percent: shared.slippage_percent, brokerage_per_order: shared.brokerage_per_order,
      ...(result.runConfig?.perSymbol?.[symbol]?.lot_size ? { lot_size: result.runConfig.perSymbol[symbol].lot_size } : {}) }, strategy);
  };

  const rowView = (row, rank) => {
    const isOpen = open === `${row.strategy}:${row.drawId}`;
    const weak = weakestOf(row, eligible);
    const tpd = tradesPerDayOf(row, result);
    const toggle = () => setOpen(isOpen ? null : `${row.strategy}:${row.drawId}`);
    const expansion = (
      <div className="space-y-2">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
          {symbols.map(s => <IndexCard key={s} row={row} symbol={s} onTest={test} onSave={save} />)}
        </div>
        {layout !== 'wide' && (
          <p className="text-2xs text-fg-4">Weakest index: {weak ? `${nameOf(weak.symbol)} (test PF ${pf(weak.oosPF)})` : '—'} · Trades/day: {tpd != null ? tpd.toFixed(1) : '—'}</p>
        )}
        <div><span className="text-2xs text-fg-5">Settings (same on every index; min SL points vary by index):</span><ParamChips params={row.params} noise={noise} /></div>
        {row.others?.length > 0 && (
          <details className="text-2xs">
            <summary className="cursor-pointer text-fg-4">Other settings of this strategy ({row.others.length})</summary>
            <ul className="mt-1 space-y-1">
              {row.others.map(o => (
                <li key={o.drawId} className="flex flex-wrap items-center gap-1">
                  <span className="text-fg-5">held up on {o.robustCount}:</span>
                  {symbols.map(s => <VerdictChip key={s} row={o} symbol={s} onTest={test} />)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <details className="text-2xs">
          <summary className="cursor-pointer text-fg-4">Details (scores)</summary>
          <p className="text-fg-5 mt-1">K-th best per-index score (already discounted for the number of settings tried; higher is better): {Object.entries(row.kValues || {}).map(([kk, v]) => `at least ${kk}: ${v == null ? 'not held up' : v.toFixed(3)}`).join(' · ')}.</p>
        </details>
      </div>
    );
    if (layout === 'narrow') {
      return (
        <li key={`${row.strategy}:${row.drawId}`} className="p-3 rounded border border-line space-y-2">
          <button type="button" onClick={toggle} aria-expanded={isOpen} className="w-full text-left flex items-center gap-2">
            {isOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
            <span className="text-primary-ink font-bold">#{rank}</span>
            <span className="text-fg-2 font-medium">{row.label}</span>
            <span className="text-2xs text-fg-4 ml-auto">held up on {row.robustCount}/{n}</span>
          </button>
          <div className="flex flex-wrap gap-1">{symbols.map(s => <VerdictChip key={s} row={row} symbol={s} onTest={test} />)}</div>
          {isOpen && expansion}
        </li>
      );
    }
    const cols = layout === 'wide' ? 6 : 4;
    return (
      <React.Fragment key={`${row.strategy}:${row.drawId}`}>
        <tr className={`border-b border-line-0 ${isOpen ? 'bg-slate-800/60' : ''}`}>
          <td className="p-2">
            <button type="button" onClick={toggle} aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${row.label}`} className="text-fg-5">
              {isOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
            </button>
          </td>
          <td className="p-2 font-bold text-primary-ink">#{rank}</td>
          <td className="p-2 text-fg-2 font-medium">
            <span className="flex items-center gap-1.5">{winnerAtK && row.strategy === winnerAtK.strategy && row.drawId === winnerAtK.drawId && <Trophy className="w-3.5 h-3.5 text-warning" aria-hidden="true" />}{row.label}</span>
            <span className="text-3xs text-fg-5">held up on {row.robustCount} of {n}</span>
          </td>
          <td className="p-2"><div className="flex flex-wrap gap-1">{symbols.map(s => <VerdictChip key={s} row={row} symbol={s} onTest={test} />)}</div></td>
          {layout === 'wide' && <td className="p-2 text-xs">{weak ? <>{nameOf(weak.symbol)} <span className="text-fg-5" title={PF_HELP}>PF {pf(weak.oosPF)}</span></> : '—'}</td>}
          {layout === 'wide' && <td className="p-2 text-xs">{tpd != null ? tpd.toFixed(1) : '—'}</td>}
          <td className="p-2">
            <button type="button" className="text-2xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-fg whitespace-nowrap" onClick={() => save(row, symbols, true)}
              title="One saved setting per index where it held up (never the global defaults)">Save where it held up</button>
          </td>
        </tr>
        {isOpen && <tr className="bg-slate-900/40"><td colSpan={cols + 1} className="p-3">{expansion}</td></tr>}
      </React.Fragment>
    );
  };

  const list = (rows, startRank = 1) => (layout === 'narrow'
    ? <ul className="space-y-2">{rows.map((r, i) => rowView(r, startRank + i))}</ul>
    : (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="text-fg-4 border-b border-line text-xs">
              <th className="p-2 w-6"><span className="sr-only">Expand</span></th><th className="p-2">#</th><th className="p-2">Strategy</th>
              <th className="p-2">Holds up on <span className="text-fg-5 font-normal">(click to test)</span></th>
              {layout === 'wide' && <th className="p-2" title={PF_HELP}>Weakest index</th>}
              {layout === 'wide' && <th className="p-2">Trades/day</th>}
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>{rows.map((r, i) => rowView(r, startRank + i))}</tbody>
        </table>
      </div>
    ));

  const rc = result.runConfig?.shared || {};
  return (
    <div ref={panelRef} className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-success" aria-hidden="true" />Best settings across indexes<DocLink to="optimizer#results" /></h2>
          <p className="text-2xs text-fg-5 mt-1">
            {symbols.map(nameOf).join(', ')} · {rc.start_date} → {rc.end_date} · test window after {rc.oos_split_date} ({Math.round((rc.oos_fraction ?? 0.3) * 100)}%)
            {result.preset ? ` · ${result.preset}` : ''}{result.budget ? ` (${result.budget.d1}${result.budget.s2 ? ` + ${result.budget.d2} for the best ${result.budget.s2}` : ''} settings per index)` : ''} · seed {result.seed}
          </p>
          {Array.isArray(result.runConfig?.warnings) && result.runConfig.warnings.length > 0 && (
            <ul className="mt-1 text-2xs text-warning space-y-0.5" aria-label="Run warnings">
              {result.runConfig.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          {result.stopped && <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-warning">⏹ Stopped early</span>}
          {onClear && <button type="button" onClick={onClear} className="text-xs bg-slate-700 hover:bg-red-600/80 text-fg-2 px-3 py-1 rounded">Clear Results</button>}
        </div>
      </div>

      <div className={`p-4 rounded-lg border text-sm flex gap-2 ${winnerAtK ? 'bg-gradient-to-r from-amber-500/10 to-slate-900/0 border-amber-500/40 text-fg-2' : 'bg-yellow-500/10 border-yellow-500/40 text-warning'}`}>
        {winnerAtK ? <Trophy className="w-5 h-5 text-warning shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}
        <p>{sentence}</p>
      </div>
      {result.truncated?.length > 0 && <p className="text-2xs text-warning">Memory cap reached for {result.truncated.join(', ')}: only the first 20,000 settings that held up were kept for the cross-index view.</p>}
      {result.skipped_strategies?.length > 0 && <p className="text-2xs text-fg-5">Skipped (no tunable parameters): {result.skipped_strategies.join(', ')}</p>}
      {result.screened_out?.length > 0 && <p className="text-2xs text-fg-5">Screened out after the first round (kept, shown under their indexes): {result.screened_out.join(', ')}</p>}
      {saveMsg && <p className="text-2xs text-fg-3" role="status">{saveMsg}</p>}

      <div role="tablist" aria-label="Result view" className="flex gap-1">
        <button type="button" role="tab" aria-selected={tab === 'cross'} onClick={() => setTab('cross')}
          className={`text-sm px-3 py-1 rounded border ${tab === 'cross' ? 'bg-primary/15 border-primary/50 text-primary-ink' : 'border-line text-fg-3'}`}>Best across indexes</button>
        <button type="button" role="tab" aria-selected={tab === 'index'} onClick={() => setTab('index')}
          className={`text-sm px-3 py-1 rounded border ${tab === 'index' ? 'bg-primary/15 border-primary/50 text-primary-ink' : 'border-line text-fg-3'}`}>By index</button>
      </div>

      {tab === 'cross' ? (
        <div role="tabpanel" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="cross-k" className="text-xs text-fg-4">Must hold up on</label>
            <select id="cross-k" value={k} onChange={e => setK(Number(e.target.value))} className="bg-slate-900 border border-line rounded p-1 text-fg text-xs">
              {Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 2).map(kk => (
                <option key={kk} value={kk}>at least {kk} of {n}{kk === result.kDefault ? ' (recommended)' : ''}</option>
              ))}
            </select>
            <span className="text-2xs text-fg-5">indexes, with the same settings</span>
          </div>
          {n < 2 && <p className="text-2xs text-warning">Fewer than 2 indexes had data good enough to judge, so nothing can be compared across indexes — see "By index".</p>}
          {held.length > 0 ? list(held) : <p className="text-sm text-fg-4">No strategy held up on at least {k} of {n} indexes with the same settings.</p>}
          {notHeld.length > 0 && (
            <div className="border-t border-line pt-2">
              <button type="button" onClick={() => setShowNotHeld(v => !v)} aria-expanded={showNotHeld} className="text-xs text-fg-4 flex items-center gap-1">
                {showNotHeld ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                Did not hold up on {k} indexes ({notHeld.length})
              </button>
              {showNotHeld && <div className="mt-2 opacity-80">{list(notHeld, held.length + 1)}</div>}
            </div>
          )}
          {result.incomplete?.length > 0 && (
            <div className="p-2 rounded border border-line-2 text-2xs text-fg-4">
              <span className="font-medium text-fg-3">Incomplete</span> — not judged on every index (stopped or failed):{' '}
              {result.incomplete.map(x => `${x.strategy} (tested on ${x.testedCount} of ${x.nEligible})`).join(', ')}
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel"><ByIndex result={result} noise={noise} onTestParams={testCellRow} /></div>
      )}
    </div>
  );
}
