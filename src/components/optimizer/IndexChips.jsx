import React from 'react';
import { INDEXES } from './crossIndex';

// Six index chips. One chip selected = today's single-index page; two or more =
// a multi-index run (settings that hold up across indexes). Each chip can carry
// its data-check badge; a chip that can't be used says why instead of silently
// ignoring the click.
export default function IndexChips({ selected = [], onChange, badges = {}, disabledReasons = {} }) {
  const set = new Set(selected);
  const toggle = (sym) => {
    if (disabledReasons[sym]) return;
    const next = set.has(sym) ? selected.filter(s => s !== sym) : [...selected, sym];
    onChange(INDEXES.map(i => i.symbol).filter(s => next.includes(s)));
  };
  const usable = INDEXES.map(i => i.symbol).filter(s => !disabledReasons[s]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="block text-sm font-medium text-fg-4" id="optimizer-indexes-label">Indexes</span>
        <span className="text-2xs text-fg-5" aria-live="polite">{selected.length} of {INDEXES.length} selected</span>
      </div>
      <div role="group" aria-labelledby="optimizer-indexes-label" className="flex flex-wrap gap-1.5">
        {INDEXES.map(({ symbol, name }) => {
          const on = set.has(symbol);
          const reason = disabledReasons[symbol];
          const badge = badges[symbol];
          return (
            <button key={symbol} type="button" aria-pressed={on} aria-disabled={reason ? true : undefined}
              title={reason || badge?.title || ''}
              onClick={() => toggle(symbol)}
              className={`text-xs px-2 py-1 rounded border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                reason ? 'opacity-50 cursor-not-allowed border-line-2 text-fg-5'
                  : on ? 'bg-primary/15 border-primary/50 text-primary-ink' : 'bg-slate-900 border-line text-fg-3 hover:border-line-3'}`}>
              <span className="font-medium">{name}</span>
              {badge && <span className={`ml-1 text-3xs ${badge.ok ? 'text-success' : 'text-warning'}`}>{badge.text}</span>}
              {reason && <span className="sr-only"> — unavailable: {reason}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 mt-1">
        <button type="button" className="text-2xs text-primary-ink hover:underline" onClick={() => onChange(usable)}>All</button>
        <button type="button" className="text-2xs text-fg-4 hover:underline" onClick={() => onChange(selected.slice(0, 1))}>Just one</button>
      </div>
      <p className="text-2xs text-fg-5 mt-1">
        {selected.length > 1
          ? 'Finds settings that hold up on several indexes at once — the strongest guard against a lucky fit.'
          : 'Pick two or more to search for settings that work across indexes.'}
      </p>
    </div>
  );
}
