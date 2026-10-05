import React, { useMemo, useRef, useState } from 'react';
import { Save, Trash2, ChevronDown, ChevronRight, Search, X, ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { Chip } from '../viz/primitives';
import { pnlTone } from '../viz/tokens';
import { fmt, num, pfText, pfValue, shortSym } from './builderFormat';
import useRemWidth from '../../hooks/useRemWidth';
import useLocalStorage from '../../hooks/useLocalStorage';

/**
 * Deploy tab → Saved strategies.
 *
 * Three layouts, chosen by the PANEL's width in rem (see useRemWidth), not the
 * window's: the sidebar, the page gutter and the Text Size control all change
 * how much room the table really has, and at a larger text size the same
 * window holds fewer columns.
 *   wide   — every column
 *   medium — drops Train net, full-window PF and Trades (still in Details)
 *   cards  — one card per strategy, metrics in a grid that reflows inside it
 * The breakpoints are where the measured gap between neighbouring numbers
 * stays comfortable (frontend/probe-deploy.mjs, 1x and 1.25x text).
 */
const WIDE_REM = 84;
const MEDIUM_REM = 62;
const CARD_PAIR_REM = 40;   // two cards side by side from here down to MEDIUM_REM

const money = (v) => (num(v) == null ? '—' : `₹${fmt(v)}`);
const pctText = (v, d = 2) => (num(v) == null ? '—' : `${fmt(v, d)}%`);

const SORTS = [
    { key: 'newest', label: 'Recently saved', dir: 'asc', get: (r) => r.i },
    { key: 'valNet', label: 'Val net', dir: 'desc', get: (r) => num(r.opt?.val?.netPnl) },
    { key: 'valPf', label: 'Val PF', dir: 'desc', get: (r) => pfValue(r.opt?.val) },
    { key: 'trainNet', label: 'Train net', dir: 'desc', get: (r) => num(r.opt?.train?.netPnl) },
    { key: 'fullNet', label: 'Full net', dir: 'desc', get: (r) => num(r.m.netPnl) },
    { key: 'pf', label: 'Full PF', dir: 'desc', get: (r) => pfValue(r.m) },
    { key: 'winRate', label: 'Win%', dir: 'desc', get: (r) => num(r.m.winRate) },
    { key: 'roi', label: 'ROI/margin', dir: 'desc', get: (r) => num(r.m.roiOnMarginPct) },
    { key: 'trades', label: 'Trades', dir: 'desc', get: (r) => num(r.m.n) },
    { key: 'name', label: 'Name', dir: 'asc', get: (r) => String(r.s.name || '').toLowerCase() },
];
const SORT_BY_KEY = Object.fromEntries(SORTS.map(s => [s.key, s]));
const validSort = (v) => !!(v && SORT_BY_KEY[v.key] && (v.dir === 'asc' || v.dir === 'desc'));

const GROUPS = {
    oos: { label: 'Out-of-sample', title: 'The validation window the optimizer never tuned on. Only Auto-optimize saves have one — a plain backtest save shows —' },
    train: { label: 'Train', title: 'The in-sample window the optimizer tuned on' },
    full: { label: 'Full window', title: 'The whole backtest window (what a plain backtest save records)' },
};

function Verdict({ opt }) {
    const r = opt?.robustness;
    if (!r || r.robust == null) return <span className="text-fg-5" title={opt ? 'Out-of-sample check inconclusive' : 'No out-of-sample check — not from Auto-optimize'}>—</span>;
    const title = `val/train ${r.ratio ?? '?'} — ${r.note || ''}`;
    return r.robust
        ? <Chip tone="good" title={title}>✓ Holds</Chip>
        : <Chip tone="critical" title={title}>⚠ Overfit</Chip>;
}

const COLUMNS = [
    { key: 'valNet', group: 'oos', label: 'Net', render: (r) => money(r.opt?.val?.netPnl), tone: (r) => pnlTone(r.opt?.val?.netPnl), strong: true },
    { key: 'valPf', group: 'oos', label: 'PF', render: (r) => (r.opt ? pfText(r.opt.val) : '—') },
    { key: 'verdict', group: 'oos', label: 'Verdict', render: (r) => <Verdict opt={r.opt} />, sortable: false, center: true },
    { key: 'trainNet', group: 'train', label: 'Net', render: (r) => money(r.opt?.train?.netPnl), tone: (r) => pnlTone(r.opt?.train?.netPnl), wideOnly: true },
    { key: 'fullNet', group: 'full', label: 'Net', render: (r) => money(r.m.netPnl), tone: (r) => pnlTone(r.m.netPnl), strong: true },
    { key: 'pf', group: 'full', label: 'PF', render: (r) => pfText(r.m), wideOnly: true },
    { key: 'winRate', group: 'full', label: 'Win%', render: (r) => pctText(r.m.winRate) },
    { key: 'roi', group: 'full', label: 'ROI/margin', render: (r) => pctText(r.m.roiOnMarginPct) },
    { key: 'trades', group: 'full', label: 'Trades', render: (r) => (num(r.m.n) == null ? '—' : fmt(r.m.n)), wideOnly: true },
];

const BTN = 'inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-md border text-2xs font-medium whitespace-nowrap transition-colors disabled:opacity-40';
const BTN_TONE = {
    neutral: 'border-line-2 bg-slate-800 text-fg-3 hover:bg-slate-700',
    open: 'border-amber-600 bg-amber-900/25 text-warning',
    load: 'border-sky-700/50 bg-sky-900/20 text-sky-300 hover:bg-sky-900/40',
    paper: 'border-emerald-700/50 bg-emerald-900/20 text-success hover:bg-emerald-900/40',
    live: 'border-red-700/60 bg-red-900/25 text-danger hover:bg-red-900/45 font-semibold',
    del: 'border-line bg-slate-800 text-fg-4 hover:text-danger',
};

function Meta({ r }) {
    const { opt } = r;
    return (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-fg-5 wrap-anywhere">
            <span>{r.tplName}</span>
            <span aria-hidden="true">·</span>
            <span className="text-fg-4">{r.sym}</span>
            <span aria-hidden="true">·</span>
            <span>{r.entry}</span>
            {opt?.rank != null && (
                <Chip tone="info" className="ml-0.5" title={`Saved from Auto-optimize job ${opt.jobId}${opt.from ? ` (${opt.from} → ${opt.to})` : ''}`}>Auto #{opt.rank}</Chip>
            )}
        </div>
    );
}

function Actions({ r, pending, onLoad, onDeploy, onDelete, className = '' }) {
    const { s } = r;
    const busy = !!pending[`deploy:${s._id}`];
    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
            <button type="button" onClick={() => onLoad(s)} className={`${BTN} ${BTN_TONE.load}`} title="Load into Backtest for inspection">Load</button>
            <button type="button" onClick={() => onDeploy(s, 'PAPER')} disabled={busy} className={`${BTN} ${BTN_TONE.paper}`} title="Deploy as PAPER (simulated fills at quotes)">▶ Paper</button>
            <button type="button" onClick={() => onDeploy(s, 'LIVE')} disabled={busy} className={`${BTN} ${BTN_TONE.live}`} title="Deploy LIVE — shows a risk preview + type-to-confirm before any real order">● LIVE</button>
            <button type="button" onClick={() => onDelete(s)} className={`${BTN} ${BTN_TONE.del} px-0 w-7`} aria-label={`Delete saved strategy ${s.name}`} title="Delete saved strategy">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}

function DetailsToggle({ open, name, onClick, withLabel = false }) {
    return (
        <button type="button" onClick={onClick} aria-expanded={open}
            aria-label={withLabel ? undefined : `${open ? 'Hide' : 'Show'} details for ${name}`}
            title="Backtest results + params saved with this strategy"
            className={`${BTN} ${open ? BTN_TONE.open : BTN_TONE.neutral} ${withLabel ? '' : 'px-0 w-7 shrink-0'}`}>
            {open ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            {withLabel && (open ? 'Hide details' : 'Details')}
        </button>
    );
}

function SortHeader({ sortKey, sort, onSort, className, rowSpan, children }) {
    if (!sortKey) return <th scope="col" rowSpan={rowSpan} className={className}>{children}</th>;
    const active = sort.key === sortKey;
    return (
        <th scope="col" rowSpan={rowSpan} className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <button type="button" onClick={() => onSort(sortKey)} title="Sort by this column"
                className={`inline-flex items-center gap-1 rounded hover:text-fg-2 ${active ? 'text-fg-2' : ''}`}>
                {children}
                {active && (sort.dir === 'asc'
                    ? <ArrowUpNarrowWide className="w-3 h-3" aria-hidden="true" />
                    : <ArrowDownWideNarrow className="w-3 h-3" aria-hidden="true" />)}
            </button>
        </th>
    );
}

function StrategyTable({ rows, wide, sort, onSort, openId, onToggle, renderDetails, actionProps }) {
    const cols = COLUMNS.filter(c => wide || !c.wideOnly);
    // group header spans, from the columns actually on screen; a rule opens each group
    const groups = [];
    const opensGroup = new Set();
    for (const c of cols) {
        const last = groups[groups.length - 1];
        if (last && last.key === c.group) last.span++;
        else { groups.push({ key: c.group, span: 1, first: c.key }); opensGroup.add(c.key); }
    }
    const totalCols = cols.length + 2;
    const divider = (key) => (opensGroup.has(key) ? 'border-l border-line-0' : '');
    const cellPad = 'px-3';
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs text-fg-3 border-collapse">
                <thead>
                    <tr className="text-3xs uppercase tracking-wide text-fg-5">
                        {/* A share, not "whatever is left": left to auto layout the name column
                            soaked up every spare rem and pushed the numbers away from the names. */}
                        <SortHeader sortKey="name" sort={sort} onSort={onSort} rowSpan={2}
                            className="w-[30%] pl-1 pr-4 pb-2 text-left align-bottom font-semibold normal-case text-2xs tracking-normal">
                            Strategy
                        </SortHeader>
                        {groups.map(g => (
                            <th key={g.key} scope="colgroup" colSpan={g.span} title={GROUPS[g.key].title}
                                className={`${cellPad} pt-1 pb-1 text-center font-semibold border-b border-line-0 ${divider(g.first)}`}>
                                {GROUPS[g.key].label}
                            </th>
                        ))}
                        <th scope="col" rowSpan={2} className="pl-3 pr-1 pb-2 text-right align-bottom font-semibold normal-case text-2xs tracking-normal">Actions</th>
                    </tr>
                    <tr className="text-2xs text-fg-5">
                        {cols.map(c => (
                            <SortHeader key={c.key} sortKey={c.sortable === false ? null : c.key} sort={sort} onSort={onSort}
                                className={`${cellPad} pt-1.5 pb-2 font-semibold whitespace-nowrap ${c.center ? 'text-center' : 'text-right'} ${divider(c.key)}`}>
                                {c.label}
                            </SortHeader>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => {
                        const isOpen = openId === r.s._id;
                        return (
                            <React.Fragment key={r.s._id}>
                                <tr className={`border-t border-line-0 hover:bg-slate-800/40 ${isOpen ? 'bg-slate-800/30' : ''}`}>
                                    <td className="pl-1 pr-4 py-2.5 align-middle min-w-[15rem]">
                                        <div className="flex items-start gap-2">
                                            <DetailsToggle open={isOpen} name={r.s.name} onClick={() => onToggle(isOpen ? null : r.s._id)} />
                                            <div className="min-w-0">
                                                <div className="font-semibold text-fg-2 break-words leading-snug">{r.s.name}</div>
                                                <Meta r={r} />
                                            </div>
                                        </div>
                                    </td>
                                    {cols.map(c => (
                                        <td key={c.key}
                                            className={`${cellPad} py-2.5 align-middle whitespace-nowrap tabular-nums ${c.center ? 'text-center' : 'text-right'} ${c.strong ? 'font-semibold' : ''} ${c.tone ? c.tone(r) : ''} ${divider(c.key)}`}>
                                            {c.render(r)}
                                        </td>
                                    ))}
                                    <td className="pl-3 pr-1 py-2 align-middle">
                                        <Actions r={r} {...actionProps} className="justify-end flex-nowrap" />
                                    </td>
                                </tr>
                                {isOpen && (
                                    <tr className="bg-slate-900/60">
                                        <td colSpan={totalCols} className="p-3">
                                            <div className="@container">{renderDetails(r.s)}</div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function Metric({ label, value, tone = '', title }) {
    return (
        <div className="min-w-0" title={title}>
            <dt className="text-3xs text-fg-5">{label}</dt>
            <dd className={`text-sm font-semibold tabular-nums truncate ${tone || 'text-fg-2'}`}>{value}</dd>
        </div>
    );
}

function StrategyCard({ r, open, onToggle, renderDetails, actionProps }) {
    const { s, m, opt } = r;
    return (
        <article className="@container rounded-lg border border-line bg-slate-900/30 p-3 flex flex-col gap-3 min-w-0">
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg-2 break-words leading-snug">{s.name}</h3>
                    <Meta r={r} />
                </div>
                <div className="shrink-0 pt-0.5"><Verdict opt={opt} /></div>
            </header>
            {opt ? (
                <dl className="grid grid-cols-2 @xs:grid-cols-4 gap-x-4 gap-y-2.5">
                    <Metric label="Val net" value={money(opt.val?.netPnl)} tone={pnlTone(opt.val?.netPnl)} title={GROUPS.oos.title} />
                    <Metric label="Val PF" value={pfText(opt.val)} />
                    <Metric label="Train net" value={money(opt.train?.netPnl)} tone={pnlTone(opt.train?.netPnl)} />
                    <Metric label="Full net" value={money(m.netPnl)} tone={pnlTone(m.netPnl)} />
                    <Metric label="Win%" value={pctText(m.winRate)} />
                    <Metric label="ROI/margin" value={pctText(m.roiOnMarginPct)} />
                    <Metric label="Full PF" value={pfText(m)} />
                    <Metric label="Trades" value={num(m.n) == null ? '—' : fmt(m.n)} />
                </dl>
            ) : s.backtest?.metrics ? (
                <>
                    <dl className="grid grid-cols-2 @xs:grid-cols-4 gap-x-4 gap-y-2.5">
                        <Metric label="Net" value={money(m.netPnl)} tone={pnlTone(m.netPnl)} />
                        <Metric label="Win%" value={pctText(m.winRate)} />
                        <Metric label="ROI/margin" value={pctText(m.roiOnMarginPct)} />
                        <Metric label="PF" value={pfText(m)} />
                    </dl>
                    <p className="text-3xs text-fg-5 -mt-1">Single backtest — no out-of-sample split.</p>
                </>
            ) : (
                <p className="text-2xs text-fg-5">No backtest snapshot saved with this strategy — Load it, run a backtest and re-save to attach results.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line-0">
                <DetailsToggle open={open} name={s.name} onClick={() => onToggle(open ? null : s._id)} withLabel />
                <Actions r={r} {...actionProps} />
            </div>
            {open && <div className="@container border-t border-line-0 pt-3">{renderDetails(s)}</div>}
        </article>
    );
}

export default function SavedStrategiesPanel({
    list, templates, deployLots, onDeployLots, pending,
    openId, onToggle, onLoad, onDeploy, onDelete, renderDetails,
}) {
    const ref = useRef(null);
    const rem = useRemWidth(ref);
    const layout = rem == null || rem >= WIDE_REM ? 'wide' : rem >= MEDIUM_REM ? 'medium' : 'cards';
    const [sort, setSort] = useLocalStorage('multileg:savedSort', { key: 'newest', dir: 'asc' }, { validate: validSort });
    const [query, setQuery] = useState('');

    const rows = useMemo(() => {
        const all = (list || []).map((s, i) => ({
            s, i,
            m: s.backtest?.metrics || {},
            opt: s.optimizer || null,
            tplName: templates.find(t => t.key === s.template)?.name || s.template,
            sym: shortSym(s.symbol),
            entry: s.entry_mode === 'signal' ? `signal: ${s.signal_strategy}${(s.params || {}).use_signal_exit ? ' +exit' : ''}` : 'time entry',
        }));
        const q = query.trim().toLowerCase();
        const shown = q ? all.filter(r => [r.s.name, r.tplName, r.sym, r.entry].some(t => String(t || '').toLowerCase().includes(q))) : all;
        const spec = SORT_BY_KEY[sort.key] || SORTS[0];
        const sign = sort.dir === 'asc' ? 1 : -1;
        // nulls (no such metric) always sink, whichever way the column is sorted
        return [...shown].sort((a, b) => {
            const x = spec.get(a), y = spec.get(b);
            if (x == null && y == null) return a.i - b.i;
            if (x == null) return 1;
            if (y == null) return -1;
            if (x === y) return a.i - b.i;
            return (typeof x === 'string' ? x.localeCompare(y) : (x < y ? -1 : 1)) * sign;
        });
    }, [list, templates, query, sort]);

    const onSort = (key) => setSort(prev => (prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: SORT_BY_KEY[key].dir }));
    const actionProps = { pending, onLoad, onDeploy, onDelete };
    const total = (list || []).length;

    return (
        <div ref={ref} className="bg-surface rounded-xl border border-line p-4 mb-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                <h2 className="text-sm font-semibold text-fg flex items-center gap-2 mr-auto">
                    <Save className="w-4 h-4 text-sky-400" aria-hidden="true" /> Saved strategies ({total})
                </h2>
                {total > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-2 grow min-w-0 max-w-full">
                        <label className="relative flex-1 basis-48 min-w-0 max-w-[24rem]">
                            <span className="sr-only">Filter saved strategies</span>
                            <Search className="w-3.5 h-3.5 text-fg-5 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                                placeholder="Filter strategies…" title="Matches name, structure, symbol or signal"
                                className="w-full h-8 bg-slate-800 border border-line rounded-md pl-7 pr-2 text-xs text-fg-2 placeholder:text-fg-5" />
                        </label>
                        <label className="flex items-center gap-1.5 text-2xs text-fg-4 min-w-0 max-w-full">
                            Sort
                            <select value={sort.key} onChange={e => setSort({ key: e.target.value, dir: SORT_BY_KEY[e.target.value].dir })}
                                className="h-8 min-w-0 max-w-full bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2">
                                {SORTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                            </select>
                        </label>
                        <button type="button" onClick={() => setSort(p => ({ ...p, dir: p.dir === 'asc' ? 'desc' : 'asc' }))}
                            className={`${BTN} ${BTN_TONE.neutral} h-8 w-8 px-0`}
                            aria-label={`Sort direction: ${sort.dir === 'asc' ? 'ascending' : 'descending'} — click to reverse`}
                            title={sort.dir === 'asc' ? 'Ascending — click to reverse' : 'Descending — click to reverse'}>
                            {sort.dir === 'asc' ? <ArrowUpNarrowWide className="w-3.5 h-3.5" aria-hidden="true" /> : <ArrowDownWideNarrow className="w-3.5 h-3.5" aria-hidden="true" />}
                        </button>
                        <label className="flex items-center gap-1.5 text-2xs text-fg-4">
                            Deploy lots
                            <input type="number" min={1} value={deployLots} onChange={e => onDeployLots(Math.max(1, Number(e.target.value) || 1))}
                                className="w-16 h-8 bg-slate-800 border border-line rounded-md px-2 text-xs text-fg-2" />
                        </label>
                    </div>
                )}
            </div>

            {total === 0 ? (
                <div className="text-xs text-fg-5 py-4 text-center">Nothing saved yet — run a backtest on the Backtest tab and hit Save.</div>
            ) : rows.length === 0 ? (
                <div className="text-xs text-fg-5 py-6 text-center">
                    No saved strategy matches “{query}”.{' '}
                    <button type="button" onClick={() => setQuery('')} className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                        <X className="w-3 h-3" aria-hidden="true" /> Clear filter
                    </button>
                </div>
            ) : (
                <>
                    {query.trim() && <div className="text-2xs text-fg-5 mb-2">Showing {rows.length} of {total}</div>}
                    {layout === 'cards' ? (
                        <div className={`grid gap-3 ${rem != null && rem >= CARD_PAIR_REM ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            {rows.map(r => (
                                <StrategyCard key={r.s._id} r={r} open={openId === r.s._id} onToggle={onToggle}
                                    renderDetails={renderDetails} actionProps={actionProps} />
                            ))}
                        </div>
                    ) : (
                        <StrategyTable rows={rows} wide={layout === 'wide'} sort={sort} onSort={onSort}
                            openId={openId} onToggle={onToggle} renderDetails={renderDetails} actionProps={actionProps} />
                    )}
                </>
            )}
        </div>
    );
}
