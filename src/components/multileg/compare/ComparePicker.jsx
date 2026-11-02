/**
 * ComparePicker — choose the deployments to compare: search every deployment (stopped and
 * deleted ones that traded included), quick picks, and the chosen ones as colour-coded chips
 * (the colour each one keeps in every table and chart of the tab).
 * Options: GET /api/multileg/compare/options (database, so it works with the engines off).
 */
import React, { useMemo, useState } from 'react';
import { Search, X, Plus, Trophy } from 'lucide-react';
import { ModeChip, Chip } from '../../viz/primitives';
import { inr, istDateTime } from '../../viz/tokens.js';

export const MAX_COMPARE = 6;
const BTN = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-line-2 bg-card-2 text-2xs text-fg-3 hover:text-fg disabled:opacity-40';
const shortSym = (s) => String(s || '—').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '');

export default function ComparePicker({ options = [], selected = [], colors = [], onChange }) {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(selected.length === 0);
    const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
    const full = selected.length >= MAX_COMPARE;
    const shown = useMemo(() => {
        const t = q.trim().toLowerCase();
        const list = t
            ? options.filter((o) => [o.name, o.templateName, o.template, o.symbol, o.tradeMode, o.status].some((x) => String(x || '').toLowerCase().includes(t)))
            : options;
        return list.slice(0, 80);
    }, [options, q]);
    const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : full ? selected : [...selected, id]);
    const first = byId.get(selected[0]);
    const pick = (list) => onChange(list.slice(0, MAX_COMPARE).map((o) => o.id));
    const quick = [
        { label: 'Top 4 by net', run: () => pick(options.filter((o) => o.trades > 0).sort((a, b) => b.net - a.net).slice(0, 4)) },
        { label: 'All LIVE', run: () => pick(options.filter((o) => o.tradeMode === 'LIVE' && o.status !== 'DELETED')), disabled: !options.some((o) => o.tradeMode === 'LIVE') },
        { label: 'Same structure as the first', run: () => pick([first, ...options.filter((o) => o.id !== first.id && o.template === first.template)]), disabled: !first },
        { label: 'Same index as the first', run: () => pick([first, ...options.filter((o) => o.id !== first.id && o.symbol === first.symbol)]), disabled: !first },
    ];

    return (
        <div className="space-y-2" data-testid="compare-picker">
            <div className="flex flex-wrap items-center gap-1.5">
                {selected.map((id, i) => {
                    const o = byId.get(id);
                    return (
                        <span key={id} className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-full border border-line-2 bg-card-2 text-2xs text-fg-2 max-w-full">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors[i] }} aria-hidden="true" />
                            <span className="truncate max-w-[16rem]" title={o ? `${o.name} · ${o.templateName || o.template} · ${shortSym(o.symbol)}` : id}>{o ? o.name : id}</span>
                            <button type="button" onClick={() => toggle(id)} className="p-0.5 rounded hover:text-danger" aria-label={`Remove ${o ? o.name : id} from the comparison`}><X className="w-3 h-3" aria-hidden="true" /></button>
                        </span>
                    );
                })}
                <button type="button" className={BTN} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                    <Plus className="w-3 h-3" aria-hidden="true" />{open ? 'Close the list' : selected.length ? 'Add or change' : 'Choose deployments'}
                </button>
                {selected.length > 0 && <button type="button" className={BTN} onClick={() => onChange([])}>Clear</button>}
                <span className="text-3xs text-fg-5">{selected.length}/{MAX_COMPARE} chosen</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-3xs text-fg-5 inline-flex items-center gap-1"><Trophy className="w-3 h-3" aria-hidden="true" />Quick picks:</span>
                {quick.map((x) => <button key={x.label} type="button" className={BTN} onClick={x.run} disabled={x.disabled}>{x.label}</button>)}
            </div>

            {open && (
                <div className="rounded-lg border border-line bg-surface p-2 space-y-2">
                    <label className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-line bg-slate-800 text-xs">
                        <Search className="w-3.5 h-3.5 text-fg-5" aria-hidden="true" />
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, structure, index, mode…"
                            aria-label="Search deployments" className="flex-1 min-w-0 bg-transparent text-fg-2 placeholder:text-fg-5 outline-none" />
                    </label>
                    <ul className="max-h-[18rem] overflow-y-auto divide-y divide-line-0" role="listbox" aria-multiselectable="true" aria-label="Deployments">
                        {shown.map((o) => {
                            const on = selected.includes(o.id);
                            const idx = selected.indexOf(o.id);
                            return (
                                <li key={o.id} role="option" aria-selected={on}>
                                    <button type="button" onClick={() => toggle(o.id)} disabled={!on && full}
                                        className={`w-full text-left flex items-center gap-2 px-1.5 py-1.5 text-2xs hover:bg-slate-800/60 disabled:opacity-40 ${on ? 'bg-primary/5' : ''}`}>
                                        <span className="w-3 h-3 rounded-sm border flex-shrink-0" style={on ? { background: colors[idx], borderColor: colors[idx] } : undefined} aria-hidden="true" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-fg-2">{o.name}</span>
                                            <span className="flex flex-wrap items-center gap-1 text-3xs text-fg-5">
                                                {o.templateName || o.template} · {shortSym(o.symbol)}
                                                {o.tradeMode && <ModeChip mode={o.tradeMode} />}
                                                {o.status !== 'ACTIVE' && <Chip tone={o.status === 'DELETED' ? 'warning' : 'muted'}>{o.status.toLowerCase()}</Chip>}
                                                {o.open && (o.openStale
                                                    ? <Chip tone="warning" title={o.openMarkedAt ? `Stored as open; last marked ${istDateTime(o.openMarkedAt)} — the engine is not managing it now` : 'Stored as open, never marked'}>open · old mark</Chip>
                                                    : <Chip tone="live">open</Chip>)}
                                            </span>
                                        </span>
                                        <span className="text-right flex-shrink-0 tabular-nums">
                                            <span className={`block font-semibold ${o.net > 0 ? 'text-success' : o.net < 0 ? 'text-danger' : 'text-fg-4'}`}>{o.trades ? inr(o.net, { dp: 0, sign: true }) : '—'}</span>
                                            <span className="block text-3xs text-fg-5">{o.trades} trade{o.trades === 1 ? '' : 's'}{o.winRate != null ? ` · ${o.winRate}% win` : ''}</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                        {!shown.length && <li className="text-2xs text-fg-5 p-2">No deployment matches “{q}”.</li>}
                    </ul>
                    {full && <p className="text-3xs text-warning">Up to {MAX_COMPARE} at a time, so every column stays readable. Remove one to add another.</p>}
                </div>
            )}
        </div>
    );
}
