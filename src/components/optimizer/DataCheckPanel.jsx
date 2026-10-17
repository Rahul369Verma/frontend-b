import React from 'react';
import { API_ORIGIN } from '../../config/api.js';
import { nameOf } from './crossIndex';
import { lotText, currentLot } from '../../utils/lots.js';
import DocLink from '../DocLink.jsx';

// Before Start: is each index's data good enough to judge a strategy on?
// Ineligible indexes still run but don't count toward "held up on K of N".
export default function DataCheckPanel({ symbols, dataSource, start, end, oosFraction, onResult }) {
  const [state, setState] = React.useState({ loading: false, error: null, data: null });
  const key = `${symbols.join(',')}|${dataSource}|${start}|${end}|${oosFraction}`;
  React.useEffect(() => {
    if (!symbols.length || !start || !end) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const q = new URLSearchParams({ symbols: symbols.join(','), dataSource, start, end, oos_fraction: String(oosFraction ?? 0.3) });
        const r = await fetch(`${API_ORIGIN}/api/engine/optimizer/data-check?${q}`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        setState({ loading: false, error: null, data: d });
        onResult?.(d);
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message, data: null });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const { loading, error, data } = state;
  const rows = data ? symbols.map(s => [s, data.symbols?.[s]]).filter(([, v]) => v) : [];
  const excluded = rows.filter(([, v]) => !v.eligible);
  return (
    <section className="p-3 bg-slate-800 rounded-lg border border-line space-y-2" aria-label="Data check">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg-3">Data check <DocLink to="optimizer#data-check" /></h3>
        {loading && <span className="text-2xs text-fg-5">checking…</span>}
      </div>
      {error && <p className="text-2xs text-danger">Data check failed: {error}</p>}
      {data && (
        <>
          <p className="text-2xs text-fg-4">
            Test window starts after <span className="text-fg-2">{data.oosSplitDate}</span> (same date for every index).
            {excluded.length > 0 && <span className="text-warning"> {excluded.length} index{excluded.length === 1 ? '' : 'es'} excluded from the count.</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-2xs">
              <thead>
                <tr className="text-fg-5 text-left">
                  <th className="py-1 pr-2">Index</th><th className="py-1 pr-2">Days</th><th className="py-1 pr-2">Range</th>
                  <th className="py-1 pr-2">Complete</th><th className="py-1 pr-2">Flat bars</th><th className="py-1 pr-2">Lot</th><th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([sym, v]) => (
                  <tr key={sym} className={v.eligible ? 'text-fg-3' : 'text-fg-5'}>
                    <td className="py-1 pr-2 font-medium">{nameOf(sym)}</td>
                    <td className="py-1 pr-2">{v.days ?? '—'}{v.trainSessions != null && <span className="text-fg-5"> ({v.trainSessions}+{v.oosSessions})</span>}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{v.firstDate ? `${v.firstDate} → ${v.lastDate}` : '—'}</td>
                    <td className="py-1 pr-2">{v.completeDayPct != null ? `${v.completeDayPct}%` : '—'}</td>
                    <td className="py-1 pr-2">{v.flatBarPct != null ? `${v.flatBarPct}%` : '—'}</td>
                    <td className="py-1 pr-2" title="One lot today; each trade uses the lot listed on its own day">{lotText(currentLot(sym) ?? v.lotSize, v.lotWindow)}</td>
                    <td className="py-1">
                      {v.eligible ? <span className="text-success">✓ counts</span> : <span className="text-warning">Excluded from the count</span>}
                      {v.reasons?.length > 0 && <span className="block text-fg-5">{v.reasons.join('; ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
