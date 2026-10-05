'use strict';
/**
 * Stock Alerts — a screener over every NSE stock, saved screens that run on a
 * schedule, and a replay that says whether a screen would have caught anything.
 *
 * THE DESIGN RULE HERE IS ACCOUNTING. Every result says what it is based on
 * (which close, which PE file, live or not) and where every stock went:
 * outside the universe, below the liquidity floor, not matched, or UNKNOWN
 * because a field the query needs was missing. "2 matches" with no denominator
 * is how a screen that silently evaluated nothing looks like a quiet market.
 *
 * Null is never zero on this page: a loss-maker has no PE, and it renders "—",
 * not "0.0". (The shared pct()/num() coerce null to 0, so this file keeps its
 * own formatters.)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import {
    BellRing, Play, Save, History, Trash2, Pencil, Database, Search, FlaskConical, RefreshCw,
    AlertTriangle, Upload, BookOpen, X, Square,
} from 'lucide-react';
import { API_URL } from '../config/api.js';
import {
    PageHeader, Card, StatRow, StatTile, DataTable, Tabs, Segmented, Chip, Spinner, EmptyState, Modal, Placeholder, Legend,
} from '../components/viz/primitives';
import { useChartTheme, istDateTime } from '../components/viz/tokens';
import QueryInput from '../components/screener/QueryInput.jsx';
import { useConfirm } from '../components/confirmContext.js';
import { toast } from '../components/toastStore.js';
import {
    ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from 'recharts';

const API = `${API_URL}/screener`;

// ── null-safe formatting ─────────────────────────────────────────────────
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, dp = 2) => (isNum(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: dp }) : '—');
const fmtPct = (v, dp = 2) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(dp)}%` : '—');
const signTone = (v) => (!isNum(v) || v === 0 ? 'text-fg-4' : v > 0 ? 'text-success' : 'text-danger');
const errText = (e) => e?.response?.data?.error || e?.message || String(e);

/**
 * One formatter for every catalog field, driven by its unit and whether it is a
 * CHANGE (`signed`). Level percentages — delivery %, where the close sits in the
 * day's range, a percentile — are plain numbers: the first version painted
 * "close_in_range_pct +83.20%" green, which reads as an 83% gain.
 */
function fmtUnit(meta, v, dp = 2) {
    if (!isNum(v)) return '—';
    const u = meta?.unit || '';
    const n = `${meta?.signed && v > 0 ? '+' : ''}${v.toLocaleString('en-IN', { maximumFractionDigits: dp })}`;
    if (u === '%') return `${n}%`;
    if (u === 'pp') return `${n} pp`;
    if (u === '×') return `${n}×`;
    if (u === 'σ') return `${n}σ`;
    if (u === '₹ cr') return `₹${n} cr`;
    if (u === '₹') return `₹${n}`;
    return n;
}
function FieldValue({ meta, v }) {
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'string') return v;
    const t = fmtUnit(meta, v);
    return meta?.signed ? <span className={signTone(v)}>{t}</span> : t;
}

const EVIDENCE_TONE = { beat: 'good', lagged: 'warning', unconfirmed: 'info', none: 'neutral', untested: 'muted' };
const EVIDENCE_LABEL = { beat: 'beat · both years', lagged: 'lagged · both years', unconfirmed: '1 year only', none: 'no reliable edge', untested: 'not testable yet' };
const BASIS_OPTS = [{ v: 'auto', label: 'Auto', hint: 'Live prices while the market is open, last close otherwise' }, { v: 'off', label: 'EOD' }, { v: 'on', label: 'Live' }];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LABEL_FIELD = { symbol: 'Symbol', name: 'Name', close: 'Close', change_pct: 'Chg %', turnover_cr: 'Turnover ₹cr', industry: 'Industry', series: 'Series', is_fno: 'F&O', corp_action_sessions_ago: 'Split/bonus' };

/**
 * One STABLE api object for the page. It is an effect dependency all the way
 * down; a fresh object per render turned the page's load effect into a fetch
 * loop (measured: 655 /symbol requests in 15 s from one open modal).
 */
const API_CLIENT = Object.freeze({
    get: async (p, params) => (await axios.get(`${API}${p}`, { params })).data,
    post: async (p, body, cfg) => (await axios.post(`${API}${p}`, body, cfg)).data,
    put: async (p, body) => (await axios.put(`${API}${p}`, body)).data,
    del: async (p) => (await axios.delete(`${API}${p}`)).data,
});
const useApi = () => API_CLIENT;

// ── field reference ──────────────────────────────────────────────────────
function FieldReference({ fields, onPick }) {
    const [q, setQ] = useState('');
    const groups = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const out = new Map();
        for (const f of fields) {
            if (needle && !f.name.includes(needle) && !f.description.toLowerCase().includes(needle)) continue;
            if (!out.has(f.group)) out.set(f.group, []);
            out.get(f.group).push(f);
        }
        return [...out];
    }, [fields, q]);
    return (
        <div className="space-y-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter fields — e.g. pe, delivery, 52w"
                aria-label="Filter fields"
                className="w-full bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            <div className="max-h-80 overflow-auto space-y-3 pr-1">
                {groups.map(([g, fs]) => (
                    <div key={g}>
                        <div className="text-3xs uppercase tracking-wide text-fg-5 mb-1">{g}</div>
                        <ul className="space-y-0.5">
                            {fs.map(f => (
                                <li key={f.name}>
                                    <button type="button" onClick={() => onPick(f.name)} title="Insert into the query"
                                        className="w-full text-left rounded px-1.5 py-1 hover:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                        <span className="font-mono text-2xs text-primary-ink">{f.name}</span>
                                        <span className="text-3xs text-fg-5 ml-1.5">{f.type !== 'number' ? `(${f.type}) ` : f.unit ? `(${f.unit}) ` : ''}{f.description}{f.absent === 'none' ? ' · empty = no such event (a comparison is simply false)' : ''}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
                {!groups.length && <p className="text-2xs text-fg-5">No field matches “{q}”.</p>}
            </div>
            <div className="text-3xs text-fg-5 leading-relaxed">
                Operators: <span className="font-mono">&lt; &lt;= &gt; &gt;= = !=</span> · <span className="font-mono">AND OR NOT</span> · <span className="font-mono">( )</span> ·
                <span className="font-mono"> + - * /</span> · <span className="font-mono">abs() min() max()</span> · <span className="font-mono">x BETWEEN a AND b</span> ·
                <span className="font-mono"> symbol IN ('TCS','INFY')</span> · <span className="font-mono">industry CONTAINS 'bank'</span> · <span className="font-mono">pb IS NULL</span>.
                All <span className="font-mono">*_pct</span> fields are already in percent (−15 means −15%).
            </div>
        </div>
    );
}

// ── the accounting line — where every stock went ─────────────────────────
function Accounting({ r }) {
    if (!r) return null;
    const ex = r.universe?.excluded || {};
    const missing = Object.entries(r.missingByField || {}).sort((a, b) => b[1] - a[1]);
    return (
        <div className="text-2xs text-fg-4 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span><b className="text-fg-2">{r.universe?.label}</b>{r.universe?.minTurnoverCr ? ` · ≥ ₹${r.universe.minTurnoverCr} cr/day` : ''}:</span>
                <span>{fmt(r.counts?.evaluated, 0)} evaluated</span>
                {ex.outOfUniverse ? <span className="text-fg-5">({fmt(ex.outOfUniverse, 0)} outside universe</span> : null}
                {ex.belowTurnover ? <span className="text-fg-5">{ex.outOfUniverse ? '· ' : '('}{fmt(ex.belowTurnover, 0)} below turnover floor</span> : null}
                {ex.turnoverUnknown ? <span className="text-fg-5">· {fmt(ex.turnoverUnknown, 0)} turnover unknown</span> : null}
                {(ex.outOfUniverse || ex.belowTurnover || ex.turnoverUnknown) ? <span className="text-fg-5">)</span> : null}
                <span>→ <b className="text-fg-2">{fmt(r.counts?.matched, 0)} matched</b></span>
                <span>· {fmt(r.counts?.notMatched, 0)} not matched</span>
                <span className={r.counts?.unknown ? 'text-warning' : ''}>· {fmt(r.counts?.unknown, 0)} unknown</span>
            </div>
            {missing.length > 0 && (
                <div className="text-fg-5">
                    Unknown = a field the query needs was missing, so the stock is neither matched nor rejected: {missing.slice(0, 6).map(([f, n]) => <span key={f} className="mr-2"><span className="font-mono">{f}</span> {fmt(n, 0)}</span>)}
                </div>
            )}
            {r.table && (
                <div className="text-fg-5">
                    Built {fmt(r.table.rowsBuilt, 0)} of {fmt(r.table.symbols, 0)} symbols ({fmt(r.table.noBarOnAsOf, 0)} had no bar on the as-of session — suspended, delisted or untraded{r.table.liveMissing ? `; ${fmt(r.table.liveMissing, 0)} had no live quote` : ''}).
                    {' '}{fmt(r.table.corporateActions, 0)} split/bonus events back-adjusted{r.table.corporateActionsByBasis?.nse ? ` (${fmt(r.table.corporateActionsByBasis.nse, 0)} from NSE's feed)` : ''} · PE for {fmt(r.table.withPe, 0)} stocks (NSE omits loss-makers) · book value for {fmt(r.table.withBookValue, 0)}{r.table.withOfficialBookValue ? ` (${fmt(r.table.withOfficialBookValue, 0)} from NSE filings)` : ''}
                    {r.table.withHoldings != null ? ` · shareholding for ${fmt(r.table.withHoldings, 0)} (breakdown ${fmt(r.table.withHoldingBreakdown, 0)}) · results for ${fmt(r.table.withResults, 0)} · insider trades polled for ${fmt(r.table.withInsiderCoverage, 0)}` : ''}.
                </div>
            )}
        </div>
    );
}

function BasisLine({ b }) {
    if (!b) return null;
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-4">
                <Chip tone={b.kind === 'LIVE' ? 'live' : 'neutral'}>{b.kind === 'LIVE' ? `LIVE ${b.liveAt ? istDateTime(b.liveAt) : ''}` : `EOD close ${b.eodDate}`}</Chip>
                <span>PE file {b.newestPeFile || '—'}</span>
                {b.peFileQuality?.setAside?.length > 0 && (
                    <Chip tone="muted" title={`Set aside (changed too many stocks' EPS at once): ${b.peFileQuality.setAside.map(f => `${f.fileDate} ${f.sharePct}%`).join(', ')}${b.peFileQuality.rebased?.length ? ` · re-based: ${b.peFileQuality.rebased.map(f => f.fileDate).join(', ')}` : ''}`}>
                        {b.peFileQuality.setAside.length} bad PE file{b.peFileQuality.setAside.length === 1 ? '' : 's'} set aside
                    </Chip>
                )}
                {b.window && <span>· history {b.window.first} → {b.window.last} ({fmt(b.window.sessions, 0)} sessions)</span>}
            </div>
            {(b.notes || []).map((n, i) => <div key={i} className="text-2xs text-warning flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />{n}</div>)}
        </div>
    );
}

// ── results table ────────────────────────────────────────────────────────
function resultColumns(r, fieldsByName) {
    const seen = new Set();
    const cols = [];
    const add = (key, def) => { if (!seen.has(key)) { seen.add(key); cols.push(def); } };
    add('symbol', {
        key: 'symbol', header: 'Stock', render: (x) => (
            <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-fg-2">{x.symbol}</span>
                    {x.is_fno && <Chip tone="info" title="Has stock futures & options">F&O</Chip>}
                    {x.series === 'BE' && <Chip tone="warning" title="Trade-for-trade segment: no intraday squaring off">BE</Chip>}
                    {isNum(x.corp_action_sessions_ago) && x.corp_action_sessions_ago <= 20 && <Chip tone="muted" title={`Split/bonus ${x.corp_action_sessions_ago} sessions ago — earlier prices are adjusted`}>adj.</Chip>}
                </div>
                <div className="text-3xs text-fg-5 truncate max-w-[14rem]">{x.name || ''}</div>
            </div>
        ),
    });
    add('close', { key: 'close', header: 'Close', align: 'right', render: (x) => `₹${fmt(x.close)}` });
    add('change_pct', { key: 'change_pct', header: 'Chg %', align: 'right', render: (x) => <span className={signTone(x.change_pct)}>{fmtPct(x.change_pct)}</span> });
    for (const f of [...(r.fields || []), r.sortBy]) {
        if (!f || ['symbol', 'name', 'series', 'is_fno', 'corp_action_sessions_ago'].includes(f)) continue;
        const meta = fieldsByName.get(f);
        add(f, {
            key: f, header: <span className="font-mono" title={meta?.description}>{f}</span>, align: meta?.type === 'string' ? undefined : 'right',
            render: (x) => <FieldValue meta={meta} v={x[f]} />,
        });
    }
    add('turnover_cr', { key: 'turnover_cr', header: 'Turnover ₹cr', align: 'right', render: (x) => fmt(x.turnover_cr, 1) });
    return cols;
}

// ── one stock: drill-down with price, PE and EPS on separate charts ───────
function SeriesChart({ title, data, dataKey, color, format, step = false, height = 140 }) {
    const ct = useChartTheme();
    const has = data.some(d => isNum(d[dataKey]));
    return (
        <figure>
            <figcaption className="text-2xs text-fg-3 mb-1">{title}</figcaption>
            {has ? (
                <ResponsiveContainer width="100%" height={height}>
                    <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke={ct.gridSoft} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} minTickGap={48} tickFormatter={(d) => String(d).slice(5)} stroke={ct.axis} />
                        <YAxis width={52} tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} domain={['auto', 'auto']} tickFormatter={format} stroke={ct.axis} />
                        <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })} formatter={(v) => [format(v), title]} labelFormatter={(d) => d} cursor={{ stroke: ct.axis, strokeWidth: 1 }} />
                        <Line type={step ? 'stepAfter' : 'linear'} dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: ct.surface }} />
                    </LineChart>
                </ResponsiveContainer>
            ) : <Placeholder>No {title.toLowerCase()} for this stock.</Placeholder>}
        </figure>
    );
}

const CA_BASIS = { eps: 'from NSE EPS ratio', band: 'price moved past its band', ratio: 'exact split ratio', nse: "NSE's corporate-action feed", 'nse-demerger': 'demerger — ex-date price ratio' };
const pctCell = (v, dp = 2) => (isNum(v) ? `${fmt(v, dp)}%` : '—');

/** One stock's filings and disclosures, newest first — what the tiles above are computed from. */
function StockActivity({ act }) {
    const section = (title, rows, columns, emptyText) => (
        <details className="rounded border border-line/60 bg-surface-2 px-3 py-2" open={rows.length > 0 && rows.length <= 6}>
            <summary className="cursor-pointer text-2xs text-fg-3 font-medium">{title} <span className="text-fg-5 font-normal">({rows.length})</span></summary>
            <div className="mt-2">
                {rows.length ? <DataTable dense maxHeight={240} columns={columns} rows={rows.map((r, i) => ({ ...r, _key: `${title}-${i}` }))} /> : <div className="text-3xs text-fg-5">{emptyText}</div>}
            </div>
        </details>
    );
    return (
        <div className="space-y-2">
            {section('Shareholding filings', act.holdings || [], [
                { key: 'asOn', header: 'As of' }, { key: 'broadcast', header: 'Published' },
                { key: 'promoter', header: 'Promoter', align: 'right', render: (x) => pctCell(x.promoter) },
                { key: 'fii', header: 'FII', align: 'right', render: (x) => pctCell(x.fii) }, { key: 'dii', header: 'DII', align: 'right', render: (x) => pctCell(x.dii) },
                { key: 'mf', header: 'MF', align: 'right', render: (x) => pctCell(x.mf) }, { key: 'retail', header: 'Retail', align: 'right', render: (x) => pctCell(x.retail) },
                { key: 'pledgePct', header: 'Pledged', align: 'right', render: (x) => pctCell(x.pledgePct, 1) },
                { key: 'holders', header: 'Shareholders', align: 'right', render: (x) => (x.breakdown ? fmt(x.holders, 0) : <span className="text-fg-5" title="Only promoter/public % until the filing's XBRL is downloaded">pending</span>) },
            ], 'No shareholding filing stored for this stock yet.')}
            {section('Quarterly results', act.results || [], [
                { key: 'periodEnd', header: 'Quarter' }, { key: 'known', header: 'Published' },
                { key: 'basis', header: 'Basis', render: (x) => (x.basis === 'C' ? 'consolidated' : 'standalone') },
                { key: 'revenueCr', header: 'Revenue ₹cr', align: 'right', render: (x) => fmt(x.revenueCr, 1) },
                { key: 'profitCr', header: 'Profit ₹cr', align: 'right', render: (x) => <span className={signTone(x.profitCr)}>{fmt(x.profitCr, 1)}</span> },
                { key: 'eps', header: 'EPS ₹', align: 'right', render: (x) => fmt(x.eps) },
                { key: 'bvps', header: 'Book value ₹', align: 'right', render: (x) => fmt(x.bvps) },
            ], 'No results filing stored for this stock yet.')}
            {section('Promoter & 5%+ holder trades (SAST)', act.sast || [], [
                { key: 'date', header: 'Disclosed' }, { key: 'acquirer', header: 'Who', render: (x) => <span className="whitespace-normal">{x.acquirer || '—'}</span> },
                { key: 'promoter', header: 'Promoter', render: (x) => (x.promoter === true ? 'yes' : x.promoter === false ? 'no' : '—') },
                { key: 'side', header: 'Side', render: (x) => <Chip tone={x.side === 'BUY' ? 'good' : x.side === 'SELL' ? 'critical' : 'muted'}>{x.side}</Chip> },
                { key: 'mode', header: 'How' },
                { key: 'pct', header: '% of shares', align: 'right', render: (x) => (isNum(x.pctAcq) ? `+${fmt(x.pctAcq, 3)}%` : isNum(x.pctSale) ? `−${fmt(x.pctSale, 3)}%` : '—') },
                { key: 'pctAfter', header: 'Holds after', align: 'right', render: (x) => pctCell(x.pctAfter) },
            ], 'No SAST disclosure stored in this window.')}
            {section('Insider trades (open market & pledges)', act.insider || [], [
                { key: 'date', header: 'Disclosed' }, { key: 'person', header: 'Who', render: (x) => <span className="whitespace-normal">{x.person || '—'}</span> }, { key: 'category', header: 'Role' },
                { key: 'side', header: 'Side', render: (x) => <Chip tone={x.side === 'BUY' ? 'good' : x.side === 'SELL' ? 'critical' : 'warning'}>{x.side}</Chip> },
                { key: 'valueRs', header: 'Value ₹cr', align: 'right', render: (x) => (isNum(x.valueRs) ? fmt(x.valueRs / 1e7, 2) : '—') },
                { key: 'shares', header: 'Shares', align: 'right', render: (x) => fmt(x.shares, 0) },
            ], act.insiderPolled ? `None disclosed (last checked ${act.insiderPolled}).` : 'Not polled for this stock — insider trades are fetched one stock at a time, for F&O + NIFTY 500 stocks.')}
            {section('Board meetings', act.meetings || [], [
                { key: 'date', header: 'Meeting' }, { key: 'known', header: 'Announced', render: (x) => x.known || '—' },
                { key: 'purposes', header: 'Purpose', render: (x) => (x.purposes || []).join(' + ') },
                { key: 'desc', header: 'Detail', render: (x) => <span className="text-fg-5 whitespace-normal line-clamp-2" title={x.desc}>{x.desc}</span> },
            ], 'No board meeting stored in this window.')}
            {section('Corporate actions', act.actions || [], [
                { key: 'date', header: 'Ex-date' }, { key: 'subject', header: 'Action', render: (x) => <span className="whitespace-normal">{x.subject}</span> },
                { key: 'dividendRs', header: 'Dividend ₹', align: 'right', render: (x) => fmt(x.dividendRs) },
                { key: 'factor', header: 'Price factor', align: 'right', render: (x) => (isNum(x.factor) ? `×${fmt(x.factor, 4)}` : '—') },
            ], 'No corporate action stored in this window.')}
        </div>
    );
}

function StockModal({ symbol, onClose, api }) {
    const ct = useChartTheme();
    // Keyed by symbol at the call site, so a new stock mounts fresh state.
    const [d, setD] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
        if (!symbol) return undefined;
        let dead = false;
        api.get(`/symbol/${encodeURIComponent(symbol)}`).then(x => { if (!dead) setD(x); }).catch(e => { if (!dead) setErr(errText(e)); });
        return () => { dead = true; };
    }, [symbol, api]);
    const row = d?.row;
    const series = useMemo(() => {
        const s = row?._series;
        if (!s) return [];
        return s.dates.map((date, i) => ({ date, close: s.close[i], pe: s.pe[i], eps: s.eps[i], delivPct: s.delivPct[i] }));
    }, [row]);
    const tiles = row ? [
        ['Close', `₹${fmt(row.close)}`, fmtPct(row.change_pct)], ['PE (now)', fmt(row.pe), `NSE file: ${fmt(row.pe_nse)}`],
        ['PE 1y percentile', isNum(row.pe_pctile_1y) ? `${fmt(row.pe_pctile_1y, 1)}%` : '—', `median ${fmt(row.pe_median_1y)}`],
        ['EPS (TTM)', `₹${fmt(row.eps_ttm, 2)}`, row.eps_change_pct == null ? 'no change in window' : `last change ${fmtPct(row.eps_change_pct)} · ${row.sessions_since_eps_change} sessions ago`],
        ['Volume ratio', isNum(row.volume_ratio) ? `${fmt(row.volume_ratio)}×` : '—', `delivery ${isNum(row.deliv_pct) ? `${fmt(row.deliv_pct)}%` : '—'}`],
        ['52w range', `${fmt(row.low_52w)} – ${fmt(row.high_52w)}`, `${fmtPct(row.pct_from_52w_high)} from high`],
        ['PB', fmt(row.pb), row.book_value ? `BV ₹${fmt(row.book_value)} · ${row.book_value_source === 'nse' ? 'NSE filing' : 'your import'} · ${row.book_value_age_days}d old` : 'no balance sheet stored yet'],
        ['Return z', isNum(row.return_z) ? `${fmt(row.return_z)}σ` : '—', `normal daily move ±${isNum(row.volatility_20d_pct) ? fmt(row.volatility_20d_pct) : '—'}%`],
        ['Delivery 5d', isNum(row.deliv_pct_5d) ? `${fmt(row.deliv_pct_5d, 1)}%` : '—', `vs 20d before: ${isNum(row.deliv_pct_5d_jump) ? `${row.deliv_pct_5d_jump > 0 ? '+' : ''}${fmt(row.deliv_pct_5d_jump, 1)} pp` : '—'}`],
        ['Rel. strength', isNum(row.rs_rank_60d) ? `${fmt(row.rs_rank_60d, 0)} / 100` : '—', `1y rank ${isNum(row.rs_rank_250d) ? fmt(row.rs_rank_250d, 0) : '—'} · 20d ${isNum(row.rs_rank_20d) ? fmt(row.rs_rank_20d, 0) : '—'}`],
        ['Vs sector PE', isNum(row.pe_vs_sector_pct) ? fmtPct(row.pe_vs_sector_pct, 1) : '—', row.sector_index ? `${row.sector_index} PE ${fmt(row.sector_pe)}` : 'sector not mapped'],
        ...(row.is_fno ? [['Futures OI', isNum(row.fut_oi_change_pct) ? fmtPct(row.fut_oi_change_pct, 1) : '—', `${row.oi_buildup || '—'} · PCR ${fmt(row.opt_pcr_oi)}${row.in_fo_ban ? ' · IN F&O BAN' : ''}`]] : []),
        ['Bulk/block deals', isNum(row.deal_net_cr) ? `₹${fmt(row.deal_net_cr)} cr net` : '—', row.deal_top_buyer ? `top buyer ${row.deal_top_buyer}` : (isNum(row.deal_net_cr) ? 'none today' : 'not collected for this day')],
    ] : [];
    const ppChg = (v) => (isNum(v) ? `${v > 0 ? '+' : ''}${fmt(v)} pp` : '—');
    const ownTiles = row ? [
        ['Promoters', isNum(row.promoter_pct) ? `${fmt(row.promoter_pct)}%` : '—', row.holding_as_on ? `${ppChg(row.promoter_pct_change)} vs previous filing · as of ${row.holding_as_on}` : 'no shareholding filing stored'],
        ['FII / DII / MF', isNum(row.fii_pct) ? `${fmt(row.fii_pct, 1)} / ${fmt(row.dii_pct, 1)} / ${fmt(row.mf_pct, 1)}%` : '—', isNum(row.fii_pct) ? `FII ${ppChg(row.fii_pct_change)} · DII ${ppChg(row.dii_pct_change)}` : (row.promoter_pct != null ? 'breakdown not downloaded yet' : '—')],
        ['Promoter pledge', isNum(row.promoter_pledge_pct) ? `${fmt(row.promoter_pledge_pct, 1)}% of holding` : '—', isNum(row.promoter_pledge_change) ? `${ppChg(row.promoter_pledge_change)} vs previous filing` : 'retail ' + (isNum(row.retail_pct) ? `${fmt(row.retail_pct, 1)}%` : '—')],
        ['Promoter trades (30d)', isNum(row.promoter_buy_pct_30d) ? `+${fmt(row.promoter_buy_pct_30d, 3)}% / −${fmt(row.promoter_sell_pct_30d, 3)}%` : '—', isNum(row.promoter_buy_days_ago) ? `last open-market buy ${row.promoter_buy_days_ago}d ago` : (isNum(row.promoter_buy_pct_30d) ? 'no promoter buying disclosed' : 'SAST not collected for this window')],
        ['Insider trades (30d)', isNum(row.insider_net_cr_30d) ? `₹${fmt(row.insider_net_cr_30d)} cr net` : '—', isNum(row.insider_net_cr_30d) ? `buy ₹${fmt(row.insider_buy_cr_30d)} cr · sell ₹${fmt(row.insider_sell_cr_30d)} cr · ${row.insider_buyers_30d} buyer(s)` : 'not polled for this stock (F&O + NIFTY 500 only)'],
        ['Next event', isNum(row.days_to_results) ? `results in ${row.days_to_results}d` : isNum(row.days_to_board_meeting) ? `meeting in ${row.days_to_board_meeting}d` : '—', row.next_meeting_purpose ? `board: ${row.next_meeting_purpose}` : (isNum(row.days_since_results) ? `last results ${row.days_since_results}d ago · price since ${fmtPct(row.price_since_results_pct)}` : 'none announced')],
        ['Ex-date', isNum(row.days_to_ex_date) ? `in ${row.days_to_ex_date}d` : '—', row.next_ex_action || (row.last_ex_action ? `last: ${row.last_ex_action} (${row.days_since_ex_date}d ago)` : 'none known')],
        ['Dividend yield', isNum(row.dividend_yield_ttm_pct) ? `${fmt(row.dividend_yield_ttm_pct)}%` : '—', isNum(row.dividend_ttm_rs) ? `₹${fmt(row.dividend_ttm_rs)} / share in 12 months` : 'history not collected'],
        ['Market cap', isNum(row.market_cap_cr) ? `₹${fmt(row.market_cap_cr, 0)} cr` : '—', `${isNum(row.mcap_rank) ? `rank ${row.mcap_rank} (${row.size_bucket})` : 'rank —'}${row.amfi_category ? ` · AMFI ${row.amfi_category}` : ''}${row.near_foreign_limit ? ' · near foreign limit' : ''}`],
        ['Latest quarter', row.results_quarter ? `₹${fmt(row.profit_cr_q, 1)} cr profit` : '—', row.results_quarter ? `${row.results_quarter} · profit ${fmtPct(row.profit_growth_yoy_pct, 1)} YoY · revenue ${fmtPct(row.revenue_growth_yoy_pct, 1)}${row.turnaround ? ' · turnaround' : ''}` : 'no results filing stored'],
        ['ROE / margin', isNum(row.roe_pct) ? `${fmt(row.roe_pct, 1)}%` : '—', `net margin ${isNum(row.net_margin_pct) ? `${fmt(row.net_margin_pct, 1)}%` : '—'}${isNum(row.net_margin_change_yoy_pp) ? ` (${ppChg(row.net_margin_change_yoy_pp)} YoY)` : ''}`],
        ['Sector FPI flow', isNum(row.sector_fpi_net_3m_cr) ? `₹${fmt(row.sector_fpi_net_3m_cr, 0)} cr / 3m` : '—', row.sector_fpi_name ? `${row.sector_fpi_name} · ${isNum(row.sector_fpi_net_3m_pct_auc) ? fmtPct(row.sector_fpi_net_3m_pct_auc) : '—'} of FPI holdings` : 'sector not mapped'],
    ] : [];
    const act = row?._activity || null;
    return (
        <Modal open={!!symbol} onClose={onClose} title={`${symbol}${row?.name ? ` — ${row.name}` : ''}`} width="max-w-4xl">
            {err && <EmptyState icon={AlertTriangle} title="Could not load">{err}</EmptyState>}
            {!d && !err && <Spinner label="Building this stock's history…" />}
            {row && (
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2 text-2xs text-fg-4">
                        {row.industry && <Chip>{row.industry}</Chip>}
                        {row.is_fno && <Chip tone="info">F&O</Chip>}
                        <Chip tone="muted">{d.basis?.kind === 'LIVE' ? 'live' : `EOD ${d.basis?.eodDate}`}</Chip>
                        <span>{fmt(row.history_days, 0)} sessions of history</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {tiles.map(([l, v, h]) => (
                            <div key={l} className="rounded border border-line/60 bg-surface-2 px-2.5 py-2">
                                <div className="text-3xs text-fg-5">{l}</div>
                                <div className="text-sm font-semibold text-fg-2 tabular-nums">{v}</div>
                                <div className="text-3xs text-fg-5 truncate" title={h}>{h}</div>
                            </div>
                        ))}
                    </div>
                    <div>
                        <div className="text-2xs text-fg-3 font-medium mb-1.5">Ownership, disclosures &amp; results <span className="text-fg-5 font-normal">— NSE filings, NSDL, AMFI · as known on {d.basis?.knownBy || d.basis?.asOfDate || d.basis?.eodDate}</span></div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {ownTiles.map(([l, v, h]) => (
                                <div key={l} className="rounded border border-line/60 bg-surface-2 px-2.5 py-2">
                                    <div className="text-3xs text-fg-5">{l}</div>
                                    <div className="text-sm font-semibold text-fg-2 tabular-nums">{v}</div>
                                    <div className="text-3xs text-fg-5 truncate" title={h}>{h}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <SeriesChart title="Close (split-adjusted, ₹)" data={series} dataKey="close" color={ct.categorical[0]} format={(v) => (isNum(v) ? `₹${fmt(v, 0)}` : '—')} />
                        <SeriesChart title="PE at each close" data={series} dataKey="pe" color={ct.categorical[0]} format={(v) => fmt(v, 1)} />
                        <SeriesChart title="Trailing EPS (₹) — steps are results updates" data={series} dataKey="eps" color={ct.categorical[0]} format={(v) => fmt(v, 2)} step />
                        <SeriesChart title="Delivery %" data={series} dataKey="delivPct" color={ct.categorical[0]} format={(v) => (isNum(v) ? `${fmt(v, 0)}%` : '—')} />
                    </div>
                    <details className="rounded border border-line/60 bg-surface-2 px-3 py-2 text-2xs text-fg-4">
                        <summary className="cursor-pointer text-fg-3 font-medium">What these numbers mean</summary>
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                            <li><b>PE (now) vs NSE file</b>: NSE computes PE on the <i>previous</i> day's close; this recomputes it at today's price (NSE PE × today's close ÷ yesterday's close).</li>
                            <li><b>PE 1y percentile</b>: where today's PE sits in its own last year — 0% = cheapest of the year, 100% = most expensive. The PE chart starts only when the company was profitable (NSE publishes no PE for loss-makers).</li>
                            <li><b>EPS last change</b>: how much trailing earnings moved at the last results update, and how many sessions ago. The EPS chart's steps are those updates.</li>
                            <li><b>Volume ratio</b>: today's volume ÷ its 20-day average. <b>Delivery</b>: the share of traded shares actually taken home — a volume spike on LOW delivery is mostly intraday churn, not investors buying.</li>
                            <li><b>Return z</b>: today's move in units of the stock's own normal daily move — 3σ is rare for that stock, whatever the % looks like.</li>
                            <li><b>Rel. strength</b>: rank of the stock's 3-month return among all ~2,500 stocks (100 = strongest). <b>Vs sector PE</b>: negative = cheaper than its NSE sector index.</li>
                            <li><b>Futures OI</b> (F&O stocks): change in open interest today and what it implies with the price move — long buildup / short buildup / short covering / long unwinding.</li>
                            <li><b>Promoters / FII / DII / MF</b>: from the company's latest shareholding filing, used from the day NSE published it; changes are against the previous filing. <b>Pledge</b> is the share of the promoters' own holding that is pledged.</li>
                            <li><b>Promoter trades</b> (SAST): open-market buying or selling by the promoter group as % of all shares; a trade the whole group discloses counts once. <b>Insider trades</b>: open-market deals by promoters, directors and key managers in ₹ — polled one stock at a time for F&amp;O + NIFTY 500 stocks.</li>
                            <li><b>Next event</b>: board meetings count from the moment the company announced them. <b>Ex-date</b>: NSE gives no announcement date for corporate actions, so history treats one as known 7 days before its ex-date.</li>
                            <li><b>Latest quarter / ROE</b>: from the company's quarterly results filing (consolidated when it files one); growth is against the same quarter a year earlier on the same basis. <b>Market cap</b> rank is computed across all stocks on the day; the AMFI category is its official six-monthly list.</li>
                        </ul>
                    </details>
                    {row._series?.corporateActions?.length > 0 && (
                        <div className="text-2xs text-fg-4">
                            Split/bonus adjustments: {row._series.corporateActions.map(a => <span key={a.date} className="mr-3">{a.date} ×{a.factor} <span className="text-fg-5">({CA_BASIS[a.basis] || a.basis})</span></span>)}
                        </div>
                    )}
                    {act && <StockActivity act={act} />}
                </div>
            )}
        </Modal>
    );
}

// ── replay ───────────────────────────────────────────────────────────────
function MonthBars({ months }) {
    const ct = useChartTheme();
    const data = months.map(m => ({ ...m, v: m.meanExcessPct ?? 0 }));
    return (
        <ResponsiveContainer width="100%" height={170}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={ct.gridSoft} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} stroke={ct.axis} />
                <YAxis width={58} tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} stroke={ct.axis} />
                <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })} cursor={{ fill: ct.gridSoft }}
                    formatter={(v, k, p) => [`${fmtPct(p.payload.meanExcessPct)} over ${p.payload.n} signals`, 'mean excess']} />
                <ReferenceLine y={0} stroke={ct.axis} />
                <Bar dataKey="v" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                    {data.map((m, i) => <Cell key={i} fill={m.v >= 0 ? ct.diverging.positive : ct.diverging.negative} />)}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

/**
 * "If I had taken every signal": equal ₹ per trade, round-trip cost deducted,
 * entry next open, exit after the chosen horizon. Pure arithmetic over the
 * replay's trade records, so changing stake / cost / direction is instant.
 */
function simulate(trades, { stake, costPct, direction }) {
    const sgn = direction === 'short' ? -1 : 1;
    const t = trades.map(([d, x, r, b]) => ({ d, x, net: sgn * r - costPct, bnet: sgn * b - costPct }));
    if (!t.length) return null;
    const total = t.reduce((a, v) => a + (stake * v.net) / 100, 0);
    const bench = t.reduce((a, v) => a + (stake * v.bnet) / 100, 0);
    // Capital actually needed = most positions open at once × stake.
    const ev = [];
    for (const v of t) { ev.push([v.d, 1]); ev.push([v.x, -1]); }
    ev.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : q[1] - p[1] > 0 ? 1 : -1));   // same date: exit (-1) before entry
    let open = 0, peak = 0;
    for (const [, k] of ev) { open += k; if (open > peak) peak = open; }
    // Realised P&L by exit date → curve + drawdown.
    const byExit = new Map();
    for (const v of t) { const e = byExit.get(v.x) || { p: 0, b: 0 }; e.p += (stake * v.net) / 100; e.b += (stake * v.bnet) / 100; byExit.set(v.x, e); }
    let cum = 0, cumB = 0, hi = 0, dd = 0;
    const curve = [...byExit.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1)).map(([date, e]) => {
        cum += e.p; cumB += e.b; hi = Math.max(hi, cum); dd = Math.max(dd, hi - cum);
        return { date, pnl: Math.round(cum), bench: Math.round(cumB) };
    });
    const first = t.reduce((m, v) => (v.d < m ? v.d : m), t[0].d);
    const last = t.reduce((m, v) => (v.x > m ? v.x : m), t[0].x);
    const years = Math.max((Date.parse(last) - Date.parse(first)) / (365.25 * 86400000), 1 / 12);
    const capital = peak * stake;
    return {
        n: t.length, wins: t.filter(v => v.net > 0).length, avgNet: t.reduce((a, v) => a + v.net, 0) / t.length,
        total, bench, capital, peak, maxDD: dd, first, last,
        onCapitalPct: capital ? (total / capital) * 100 : null, perYearPct: capital ? ((total / capital) * 100) / years : null,
        curve: curve.length > 160 ? curve.filter((_, i) => i % Math.ceil(curve.length / 160) === 0 || i === curve.length - 1) : curve,
    };
}

function TradeSim({ b, mode, horizon }) {
    const ct = useChartTheme();
    const [stake, setStake] = useState(50000);
    const [costPct, setCostPct] = useState(0.5);
    const [direction, setDirection] = useState('long');
    const sim = useMemo(() => simulate(b.trades || [], { stake: Number(stake) || 0, costPct: Number(costPct) || 0, direction }), [b.trades, stake, costPct, direction]);
    const benchLabel = mode === 'market' ? 'NIFTY on an average day' : 'the average stock, same days';
    const inp = 'bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2';
    return (
        <div className="rounded border border-line/60 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
                <div className="text-xs font-medium text-fg-2 mr-2">If you had taken every signal — {horizon}-session hold</div>
                <label className="text-3xs text-fg-5 flex flex-col gap-1">₹ per trade<input type="number" min="1000" step="5000" value={stake} onChange={(e) => setStake(e.target.value)} className={`${inp} w-28`} /></label>
                <label className="text-3xs text-fg-5 flex flex-col gap-1" title="Round trip. Delivery trades pay STT 0.1% on buy AND sell, stamp duty 0.015%, exchange + SEBI ≈0.006%, GST on charges, a DP charge (~₹16 per stock sold — 0.16% of a ₹10,000 trade) and brokerage, plus slippage buying at the open. ~0.35-0.6% for ₹25k-1L trades in liquid stocks; more for small trades or illiquid stocks.">Costs % round trip
                    <input type="number" min="0" step="0.05" value={costPct} onChange={(e) => setCostPct(e.target.value)} className={`${inp} w-20`} />
                </label>
                <div className="flex flex-col gap-1 text-3xs text-fg-5" title="Short: selling first. Overnight shorts in the cash market are not allowed for retail in India — this is only realistic through stock futures or puts, i.e. F&O stocks.">Direction
                    <Segmented options={[{ v: 'long', label: 'Buy' }, { v: 'short', label: 'Short (F&O only)' }]} value={direction} onChange={setDirection} />
                </div>
            </div>
            {!sim ? <Placeholder>No completed trades at this horizon yet.</Placeholder> : (
                <>
                    <StatRow cols={4}>
                        <StatTile label="Net profit (all trades)" value={`₹${fmt(Math.round(sim.total), 0)}`} tone={sim.total > 0 ? 'positive' : sim.total < 0 ? 'negative' : 'neutral'}
                            hint={`${sim.n} trades · vs ₹${fmt(Math.round(sim.bench), 0)} for ${benchLabel}`} />
                        <StatTile label="Average trade after costs" value={fmtPct(sim.avgNet)} tone={sim.avgNet > 0 ? 'positive' : sim.avgNet < 0 ? 'negative' : 'neutral'}
                            hint={`${fmt((sim.wins / sim.n) * 100, 0)}% of trades made money`} />
                        <StatTile label="Capital needed" value={`₹${fmt(Math.round(sim.capital), 0)}`} hint={`up to ${sim.peak} positions open at once`} />
                        <StatTile label="Return on that capital" value={isNum(sim.onCapitalPct) ? fmtPct(sim.onCapitalPct, 1) : '—'} tone={sim.total > 0 ? 'positive' : 'negative'}
                            hint={`≈ ${isNum(sim.perYearPct) ? fmtPct(sim.perYearPct, 1) : '—'} a year · worst dip ₹${fmt(Math.round(sim.maxDD), 0)}`} />
                    </StatRow>
                    <figure>
                        <figcaption className="text-2xs text-fg-3 mb-1">Cumulative profit after costs, by exit date (₹)</figcaption>
                        <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={sim.curve} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                                <CartesianGrid stroke={ct.gridSoft} vertical={false} />
                                <XAxis dataKey="date" tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} minTickGap={48} tickFormatter={(d) => String(d).slice(2, 7)} stroke={ct.axis} />
                                <YAxis width={64} tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} tickFormatter={(v) => `₹${fmt(v / 1000, 0)}k`} stroke={ct.axis} />
                                <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['3xs'] })} formatter={(v, k) => [`₹${fmt(v, 0)}`, k === 'pnl' ? 'this alert' : benchLabel]} cursor={{ stroke: ct.axis, strokeWidth: 1 }} />
                                <ReferenceLine y={0} stroke={ct.axis} />
                                <Line type="linear" dataKey="pnl" stroke={ct.categorical[0]} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: ct.surface }} />
                                <Line type="linear" dataKey="bench" stroke={ct.categorical[1]} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: ct.surface }} />
                            </LineChart>
                        </ResponsiveContainer>
                        <Legend items={[{ label: 'this alert', color: ct.categorical[0] }, { label: benchLabel, color: ct.categorical[1] }]} />
                    </figure>
                    <div className="text-3xs text-fg-5">
                        Hypothetical, on past data: fills at the next day's opening price, no taxes, no position limits beyond the one above. Short-term gains are taxed (20% STCG). A strategy that only beats the market by a fraction of a percent per trade can be wiped out by costs — change the cost box and watch the total.
                        {b.tradesTruncated ? ` (${b.tradesTruncated} older trades not shown.)` : ''}
                    </div>
                </>
            )}
        </div>
    );
}

function HowToRead({ mode }) {
    return (
        <details className="rounded border border-line/60 bg-surface-2 px-3 py-2 text-2xs text-fg-4">
            <summary className="cursor-pointer text-fg-3 font-medium">How to read this</summary>
            <ul className="list-disc pl-5 mt-2 space-y-1">
                <li><b>Signal</b> = a stock that newly matched the screen after a day's close (what the alert would have messaged you). We pretend you bought at the <b>next day's open</b> and sold at the close N sessions later — the "Sell after" values (5 / 10 / 20 unless you change them). Returns include dividends and follow splits and bonuses (the holder's total return).</li>
                <li><b>Raw return</b> = what that trade actually did. <b>Excess</b> = raw return minus what {mode === 'market' ? "NIFTY did on an average day in this window" : 'the average stock in the same universe did over exactly the same days'}. Excess strips out the market: if everything rose 3%, a signal that rose 3% has an excess of 0 — the alert added nothing.</li>
                <li><b>Mean excess / signal</b> = the average excess over all signals. <b>/ day</b> = first average the signals that fired on the same day, then average the days — so one crowded day (40 signals in a crash rebound) cannot dominate. When the two disagree in sign, trust the per-day one.</li>
                <li><b>t</b> = how sure we can be that the per-day average is not luck. Roughly: below 2 → could easily be chance; above 2 → probably real in this window. Test 20 screens and one will show t≈2 by luck alone, so re-test on new data.</li>
                <li><b>Beat the universe</b> = share of signals with positive excess. An edge usually lives in the <i>size</i> of wins, not the hit rate — 45% winners can still be profitable.</li>
                <li><b>By month</b>: a real effect shows up in most months; one great month carrying the year is a warning sign.</li>
            </ul>
        </details>
    );
}

function ReplayResult({ job }) {
    const [h, setH] = useState(null);
    const r = job?.result;
    const horizons = r ? r.horizons : [];
    const hz = h ?? (horizons.includes(10) ? 10 : horizons[0]);
    if (!job) return null;
    if (job.status === 'running') {
        const p = job.progress || {};
        const pctDone = p.total ? Math.round((p.done / p.total) * 100) : 0;
        return (
            <div className="space-y-2" aria-live="polite">
                <Spinner label={`Replaying… ${p.done || 0} / ${p.total || '?'} sessions${job.threads > 1 ? ` on ${job.threads} threads` : ''}`} />
                <div className="h-1.5 rounded bg-card-2 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pctDone}%` }} /></div>
            </div>
        );
    }
    if (job.status === 'error') return <EmptyState icon={AlertTriangle} title="Replay failed">{job.error}</EmptyState>;
    const b = r.byHorizon[hz];
    const verdictTone = /^(beat|NIFTY did better)/.test(b.verdict) ? 'good' : /^(LAGGED|NIFTY did WORSE)/.test(b.verdict) ? 'warning' : 'neutral';
    const ex = r.excluded || {};
    const market = r.mode === 'market';
    const lateStart = r.evaluableFrom && r.evaluableFrom > r.from;
    return (
        <div className="space-y-3">
            {market && <div className="text-2xs text-fg-3"><Chip tone="info">market condition</Chip> This query reads only market-wide fields, so it is tested on <b>NIFTY 50</b>: bought at the next open each time the condition turned true, compared with NIFTY's average {hz}-session return over the whole window ({fmtPct(b.unconditionalPct)}). True on {fmt(r.conditionTrueSessions, 0)} of {fmt(r.sessions, 0)} sessions.</div>}
            {lateStart && (
                <div className="text-2xs text-warning flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />
                    This screen could only really be tested from <b>{r.evaluableFrom}</b>, not {r.from}: before that most stocks were UNKNOWN for it ({fmt(r.mostlyUnknownSessions, 0)} sessions) — e.g. 52-week and 200-day fields need ~200 sessions of history before each signal day. The numbers below rest on the shorter window. A longer backfill (Data tab) fixes it.
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <Segmented options={horizons.map(x => ({ v: x, label: `${x} sessions` }))} value={hz} onChange={setH} />
                <Chip tone={verdictTone}>{b.verdict}</Chip>
                {r.maxPerDay ? <Chip tone="muted">top {r.maxPerDay}/day by {r.sortBy || '—'}</Chip> : null}
            </div>
            <StatRow cols={4}>
                <div title="Average of (signal's return − benchmark's return over the same days). Positive = the alert picked better-than-average stocks."><StatTile label="Mean excess / signal" value={fmtPct(b.meanExcessPct)} tone={b.meanExcessPct > 0 ? 'positive' : b.meanExcessPct < 0 ? 'negative' : 'neutral'} hint={`median ${fmtPct(b.medianExcessPct)} · raw ${fmtPct(b.meanRawPct)}`} /></div>
                <div title="Signals averaged within each day first, then across days. The t-statistic tests this number."><StatTile label="Mean excess / day" value={fmtPct(b.meanExcessByDayPct)} tone={b.meanExcessByDayPct > 0 ? 'positive' : b.meanExcessByDayPct < 0 ? 'negative' : 'neutral'} hint={`t = ${fmt(b.tStatByDay)} over ${fmt(b.days, 0)} days`} /></div>
                <div title="Share of signals whose excess was positive, and share whose raw return was positive."><StatTile label="Beat the benchmark" value={isNum(b.beatBenchmarkPct) ? `${fmt(b.beatBenchmarkPct, 1)}%` : '—'} hint={`${isNum(b.winRawPct) ? fmt(b.winRawPct, 0) : '—'}% made money before costs`} /></div>
                <div title="Signals with a completed window at this horizon / all new matches / distinct days."><StatTile label="Signals" value={fmt(b.n, 0)} hint={`${fmt(r.signals, 0)} new matches · ${fmt(r.signalDays, 0)} days`} /></div>
            </StatRow>
            {isNum(b.meanExcessPct) && isNum(b.meanExcessByDayPct) && Math.sign(b.meanExcessPct) !== Math.sign(b.meanExcessByDayPct) && (
                <div className="text-2xs text-warning">The per-signal and per-day means disagree in sign: a few crowded days carry the pooled number. Trust the per-day one — it is what the t-statistic tests.</div>
            )}
            <HowToRead mode={r.mode} />
            {b.byMonth?.length > 0 && (
                <figure>
                    <figcaption className="text-2xs text-fg-3 mb-1">Mean excess by month of signal — one good month can carry a year</figcaption>
                    <MonthBars months={b.byMonth} />
                </figure>
            )}
            <TradeSim b={b} mode={r.mode} horizon={hz} />
            <div className="text-3xs text-fg-5">
                {r.from} → {r.to} · {r.conventions}{job.timing?.totalMs ? ` · computed in ${fmt(job.timing.totalMs / 1000, 0)} s${job.timing.threads > 1 ? ` on ${job.timing.threads} threads` : ''}` : ''}. Excluded: {fmt(ex.incomplete, 0)} windows still open (signal too recent), {fmt(ex.corpAction || 0, 0)} crossed a split/bonus, {fmt(ex.noNextOpen, 0)} no next open, {fmt(ex.noExitClose, 0)} no exit close{ex.overDailyCap ? `, ${fmt(ex.overDailyCap, 0)} over the daily cap` : ''}{ex.unknownCondition ? `, ${fmt(ex.unknownCondition, 0)} sessions the condition could not be evaluated` : ''}.
            </div>
            {r.recentSignals?.length > 0 && (
                <details>
                    <summary className="text-2xs text-fg-4 cursor-pointer">Most recent signals ({r.recentSignals.length}) — the newest are still inside their holding window</summary>
                    <DataTable dense maxHeight={260}
                        columns={[{ key: 'date', header: 'Signal date' }, { key: 'symbol', header: 'Stock' },
                            ...horizons.map(x => ({ key: `h${x}`, header: `+${x} excess`, align: 'right', render: (sg) => (sg.fwd[x] == null && sg.due && sg.due[x] ? <span className="text-fg-5">due in {sg.due[x]} session{sg.due[x] === 1 ? '' : 's'}</span> : <span className={signTone(sg.fwd[x])}>{fmtPct(sg.fwd[x])}</span>) }))]}
                        rows={r.recentSignals.map((sg, i) => ({ ...sg, _key: `${sg.date}-${sg.symbol}-${i}` }))} />
                </details>
            )}
        </div>
    );
}

// ── screener tab ─────────────────────────────────────────────────────────
function ScreenerTab({ api, fields, presets, universes, draft, setDraft, onSaveAlert, limits }) {
    const maxReplay = limits?.maxReplaySessions || 450;
    const [res, setRes] = useState(null);
    const [qErr, setQErr] = useState(null);
    const [running, setRunning] = useState(false);
    const [picked, setPicked] = useState(null);
    const [replay, setReplay] = useState(null);
    const [replaySessions, setReplaySessions] = useState(200);
    const [maxPerDay, setMaxPerDay] = useState(0);
    // "Sell after N sessions" — up to 6 holding periods, 1-120 sessions each.
    const [horizonsText, setHorizonsText] = useState('5, 10, 20');
    const horizons = useMemo(() => [...new Set(horizonsText.split(/[\s,]+/).map(Number).filter(h => Number.isInteger(h) && h >= 1 && h <= 120))].sort((a, b) => a - b).slice(0, 6), [horizonsText]);
    const presetCats = useMemo(() => ['All', ...[...new Set(presets.map(p => p.category).filter(Boolean))]], [presets]);
    const [presetCat, setPresetCat] = useState('All');
    const [showRef, setShowRef] = useState(false);
    const taRef = useRef(null);
    const fieldsByName = useMemo(() => new Map(fields.map(f => [f.name, f])), [fields]);
    const numericFields = useMemo(() => fields.filter(f => f.type === 'number'), [fields]);
    const preset = presets.find(p => p.id === draft.presetId) || null;

    const set = (patch) => setDraft(d => ({ ...d, ...patch }));
    const insert = (name) => {
        const ta = taRef.current;
        const q = draft.query || '';
        const at = ta ? ta.selectionStart : q.length;
        const pre = q.slice(0, at), post = q.slice(at);
        const needsSpace = pre && !/[\s(]$/.test(pre);
        set({ query: `${pre}${needsSpace ? ' ' : ''}${name} ${post}`.replace(/\s+$/, ' '), presetId: null });
        setTimeout(() => ta && ta.focus(), 0);
    };

    const run = async () => {
        setRunning(true); setQErr(null);
        try {
            const r = await api.post('/scan', { query: draft.query, universe: draft.universe, minTurnoverCr: Number(draft.minTurnoverCr) || 0, sortBy: draft.sortBy || null, sortDir: draft.sortDir, limit: 200, live: draft.live });
            if (!r || !Array.isArray(r.rows)) throw new Error('The screener API answered with something unexpected.');
            setRes(r);
        } catch (e) {
            const d = e?.response?.data;
            if (d?.kind === 'query') setQErr(d); else toast.error(errText(e));
        } finally { setRunning(false); }
    };

    const startReplay = async () => {
        setQErr(null);
        try {
            const r = await api.post('/replay', { query: draft.query, universe: draft.universe, minTurnoverCr: Number(draft.minTurnoverCr) || 0, sessions: replaySessions, maxPerDay, horizons: horizons.length ? horizons : [5, 10, 20], sortBy: draft.sortBy || null, sortDir: draft.sortDir });
            setReplay({ id: r.jobId, status: 'running', progress: {} });
        } catch (e) {
            const d = e?.response?.data;
            if (d?.kind === 'query') setQErr(d);
            else if (d?.jobId) { toast.warning(d.error); setReplay({ id: d.jobId, status: 'running', progress: {} }); }
            else toast.error(errText(e));
        }
    };
    useEffect(() => {
        if (!replay || replay.status !== 'running') return undefined;
        const id = setInterval(async () => {
            try { const j = await api.get(`/replay/${replay.id}`); setReplay(j); } catch (e) { setReplay({ status: 'error', error: errText(e) }); }
        }, 1200);
        return () => clearInterval(id);
    }, [replay, api]);

    const cols = useMemo(() => (res ? resultColumns(res, fieldsByName) : []), [res, fieldsByName]);
    const rows = useMemo(() => (Array.isArray(res?.rows) ? res.rows.map(r => ({ ...r, _key: r.symbol })) : []), [res]);

    return (
        <div className="space-y-4">
            <Card title="Starting points" subtitle="Ideas, not edges — each carries what a replay over stored history actually measured. Click one to load it into the editor.">
                <div className="flex flex-wrap gap-1 mb-3" role="group" aria-label="Starting-point categories">
                    {presetCats.map(c => {
                        const on = presetCat === c;
                        const n = c === 'All' ? presets.length : presets.filter(p => p.category === c).length;
                        return (
                            <button key={c} type="button" onClick={() => setPresetCat(c)} aria-pressed={on}
                                className={`px-2 py-1 rounded border text-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-primary/40 bg-primary/15 text-primary-ink' : 'border-line-2 bg-card-2 text-fg-5 hover:text-fg-3'}`}>
                                {c} <span className="tabular-nums opacity-70">{n}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {presets.filter(p => presetCat === 'All' || p.category === presetCat).map(p => (
                        <button key={p.id} type="button"
                            onClick={() => { setDraft(d => ({ ...d, query: p.query, universe: p.universe, minTurnoverCr: p.minTurnoverCr, sortBy: p.sortBy, sortDir: p.sortDir, presetId: p.id, name: p.name, times: p.times })); setQErr(null); }}
                            className={`text-left rounded border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${draft.presetId === p.id ? 'border-primary bg-primary/10' : 'border-line hover:bg-card-2'}`}>
                            <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-medium text-fg-2">{p.name}</span>
                                <Chip tone={EVIDENCE_TONE[p.evidence?.status] || 'muted'}>{EVIDENCE_LABEL[p.evidence?.status] || 'untested'}</Chip>
                            </div>
                            <div className="text-3xs text-fg-5 mt-1 line-clamp-2">{p.why}</div>
                        </button>
                    ))}
                </div>
                {preset && (
                    <div className="mt-3 rounded border border-line bg-surface-2 p-2.5 text-2xs space-y-1">
                        <div className="text-fg-3"><b>Replay evidence:</b> {preset.evidence?.text}</div>
                        {preset.evidence?.from && <div className="text-fg-5">Window {preset.evidence.from} → {preset.evidence.to}, measured {preset.evidence.measuredOn}. Re-test after each results season.</div>}
                    </div>
                )}
            </Card>

            <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
                <Card title="Query" subtitle="A condition over catalog fields, evaluated against every stock in the universe.">
                    <div className="space-y-3">
                        <QueryInput inputRef={taRef} value={draft.query} fields={fields} invalid={!!qErr}
                            onChange={(q) => { set({ query: q, presetId: null }); setQErr(null); }}
                            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } }}
                            placeholder="e.g. debt_equity < 0.5 AND cagr_3y_pct > 10 AND roce_pct > 15 — type to see matching fields"
                            className={`w-full font-mono text-xs bg-surface-2 border rounded px-2.5 py-2 text-fg-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${qErr ? 'border-danger' : 'border-line'}`} />
                        {qErr && (
                            <div role="alert" className="text-2xs text-danger">
                                {qErr.error}{qErr.hint ? <span className="text-fg-4"> — {qErr.hint}</span> : null}
                                {isNum(qErr.pos) && draft.query ? <div className="font-mono text-fg-5 mt-0.5 whitespace-pre overflow-x-auto">{draft.query}{'\n'}{' '.repeat(Math.min(qErr.pos, draft.query.length))}^</div> : null}
                            </div>
                        )}
                        <div className="flex flex-wrap items-end gap-3">
                            <label className="text-3xs text-fg-5 flex flex-col gap-1">Universe
                                <select value={draft.universe} onChange={(e) => set({ universe: e.target.value })} className="bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2">
                                    {universes.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                                </select>
                            </label>
                            <label className="text-3xs text-fg-5 flex flex-col gap-1" title="20-session average traded value. Illiquid stocks make the noisiest 'sudden' moves.">Min turnover ₹cr/day
                                <input type="number" min="0" step="0.5" value={draft.minTurnoverCr} onChange={(e) => set({ minTurnoverCr: e.target.value })} className="w-24 bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2" />
                            </label>
                            <label className="text-3xs text-fg-5 flex flex-col gap-1">Sort by
                                <select value={draft.sortBy || ''} onChange={(e) => set({ sortBy: e.target.value || null })} className="bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2 max-w-[12rem]">
                                    <option value="">first numeric field in the query</option>
                                    {numericFields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                                </select>
                            </label>
                            <Segmented options={[{ v: 'desc', label: 'High → low' }, { v: 'asc', label: 'Low → high' }]} value={draft.sortDir} onChange={(v) => set({ sortDir: v })} />
                            <div className="flex flex-col gap-1 text-3xs text-fg-5">Prices<Segmented options={BASIS_OPTS} value={draft.live} onChange={(v) => set({ live: v })} /></div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={run} disabled={running || !draft.query.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-medium disabled:opacity-50">
                                {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Search className="w-3.5 h-3.5" aria-hidden="true" />} Run scan
                            </button>
                            <button type="button" onClick={() => onSaveAlert(draft)} disabled={!draft.query.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50">
                                <Save className="w-3.5 h-3.5" aria-hidden="true" /> Save as alert
                            </button>
                            <span className="inline-flex items-center gap-1.5 ml-auto">
                                <label className="text-3xs text-fg-5" htmlFor="replay-sessions">Replay sessions</label>
                                <input id="replay-sessions" type="number" min="20" max={maxReplay} value={replaySessions} onChange={(e) => setReplaySessions(Math.min(maxReplay, Number(e.target.value) || 200))}
                                    title={`Up to ${maxReplay} sessions (≈${Math.round(maxReplay / 250)} years) — as far back as the stored history allows. A longer backfill on the Data tab adds history.${limits?.replayThreads > 1 ? ` Runs on up to ${limits.replayThreads} CPU threads.` : ''}`}
                                    className="w-20 bg-surface-2 border border-line rounded px-1.5 py-1 text-xs text-fg-2" />
                                <label className="text-3xs text-fg-5" htmlFor="replay-horizons" title="Sessions to hold after each signal before selling — up to 6 values between 1 and 120, e.g. 3, 10, 40">Sell after</label>
                                <input id="replay-horizons" value={horizonsText} onChange={(e) => setHorizonsText(e.target.value)} aria-invalid={!horizons.length}
                                    className={`w-24 bg-surface-2 border rounded px-1.5 py-1 text-xs text-fg-2 ${horizons.length ? 'border-line' : 'border-danger'}`} placeholder="5, 10, 20" />
                                <label className="text-3xs text-fg-5" htmlFor="replay-cap" title="If you can only act on a few signals a day: keep the top N by the sort field. 0 = take every signal.">Max/day</label>
                                <input id="replay-cap" type="number" min="0" max="50" value={maxPerDay} onChange={(e) => setMaxPerDay(Math.max(0, Number(e.target.value) || 0))} className="w-14 bg-surface-2 border border-line rounded px-1.5 py-1 text-xs text-fg-2" />
                                <button type="button" onClick={startReplay} disabled={!draft.query.trim() || replay?.status === 'running'}
                                    title="Replay this screen over stored history: entry next open, excess vs the universe"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50">
                                    <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" /> Test on history
                                </button>
                            </span>
                        </div>
                        <div className="text-3xs text-fg-5">Ctrl/⌘ + Enter runs. Numbers are NSE's own files (bhavcopy + daily PE); nothing is scraped.</div>
                    </div>
                </Card>
                <Card title="Fields" subtitle="Click to insert." right={
                    <button type="button" className="xl:hidden text-2xs text-fg-4 underline" onClick={() => setShowRef(v => !v)}>{showRef ? 'hide' : 'show'}</button>
                }>
                    <div className={`${showRef ? '' : 'hidden'} xl:block`}><FieldReference fields={fields} onPick={insert} /></div>
                </Card>
            </div>

            {replay && (
                <Card title="Would this have caught anything?" subtitle="New matches only (what an alert notifies), replayed over stored history."
                    right={<button type="button" onClick={() => setReplay(null)} aria-label="Close replay" className="text-fg-5 hover:text-fg p-1"><X className="w-4 h-4" aria-hidden="true" /></button>}>
                    <ReplayResult job={replay} />
                </Card>
            )}

            {res && res.marketOnly && (
                <Card title="Market condition" subtitle="This query reads only market-wide fields (NIFTY, FII/DII, VIX…), so every stock shares the same values — it is a yes/no condition, not a stock list. Saved as an alert, it messages you when the condition turns true.">
                    <div className="space-y-3">
                        <BasisLine b={res.basis} />
                        <div className="flex flex-wrap items-center gap-3">
                            <span className={`text-2xl font-bold ${res.market.match === true ? 'text-success' : res.market.match === false ? 'text-fg-3' : 'text-warning'}`}>
                                {res.market.match === true ? 'TRUE' : res.market.match === false ? 'FALSE' : 'UNKNOWN'}
                            </span>
                            {res.market.match === null && <span className="text-2xs text-warning">missing: {(res.market.missing || []).join(', ')}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(res.market.values).map(([k, v]) => (
                                <div key={k} className="rounded border border-line/60 bg-surface-2 px-2.5 py-1.5">
                                    <div className="text-3xs text-fg-5 font-mono">{k}</div>
                                    <div className="text-sm font-semibold text-fg-2 tabular-nums"><FieldValue meta={fieldsByName.get(k)} v={v} /></div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            )}
            {res && !res.marketOnly && (
                <Card title={`${fmt(res.totalMatched, 0)} match${res.totalMatched === 1 ? '' : 'es'}`}
                    subtitle={res.totalMatched > res.shown ? `showing the first ${res.shown}, sorted by ${res.sortBy}` : `sorted by ${res.sortBy} (${res.sortDir === 'asc' ? 'low → high' : 'high → low'}) · ${res.tookMs} ms`}>
                    <div className="space-y-3">
                        <BasisLine b={res.basis} />
                        <Accounting r={res} />
                        <DataTable columns={cols} rows={rows} dense maxHeight={560} onRowClick={(r) => setPicked(r.symbol)}
                            empty={res.counts?.unknown ? 'No stock matched — and some could not be evaluated (see "unknown" above).' : 'No stock matched.'} />
                    </div>
                </Card>
            )}
            {picked && <StockModal key={picked} symbol={picked} onClose={() => setPicked(null)} api={api} />}
        </div>
    );
}

// ── alerts tab ───────────────────────────────────────────────────────────
const blankAlert = (d = {}) => ({
    name: d.name || '', description: '', query: d.query || '', presetId: d.presetId || null, universe: d.universe || 'ALL',
    minTurnoverCr: Number(d.minTurnoverCr) || 1, sortBy: d.sortBy || null, sortDir: d.sortDir || 'desc', limit: 25,
    times: d.times && d.times.length ? d.times : ['08:45', '20:30'], days: [1, 2, 3, 4, 5], live: d.live || 'auto',
    enabled: true, notifyTelegram: true, notifyOn: 'new', cooldownDays: 3,
});

function AlertEditor({ open, initial, universes, onClose, onSaved, api, fields = [] }) {
    // Keyed by the alert at the call site, so opening another alert mounts fresh state.
    const [a, setA] = useState(initial);
    const [timesText, setTimesText] = useState((initial?.times || []).join(', '));
    const [err, setErr] = useState(null);
    const [saving, setSaving] = useState(false);
    if (!open || !a) return null;
    const set = (p) => setA(x => ({ ...x, ...p }));
    const save = async () => {
        setSaving(true); setErr(null);
        const body = {
            name: a.name, description: a.description || '', query: a.query, presetId: a.presetId || null, universe: a.universe,
            minTurnoverCr: Number(a.minTurnoverCr) || 0, sortBy: a.sortBy || null, sortDir: a.sortDir, limit: Number(a.limit) || 25,
            times: timesText.split(/[\s,]+/).filter(Boolean), days: a.days, live: a.live, enabled: a.enabled,
            notifyTelegram: a.notifyTelegram, notifyOn: a.notifyOn, cooldownDays: Number(a.cooldownDays) || 0,
        };
        try {
            const r = a._id ? await api.put(`/alerts/${a._id}`, body) : await api.post('/alerts', body);
            toast.success(a._id ? 'Alert updated' : 'Alert created');
            onSaved(r.alert);
        } catch (e) {
            const d = e?.response?.data;
            setErr(d?.issues ? d.issues.join(' · ') : d?.kind === 'query' ? `${d.error}${d.hint ? ` — ${d.hint}` : ''}` : errText(e));
        } finally { setSaving(false); }
    };
    const input = 'bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2 w-full';
    return (
        <Modal open={open} onClose={onClose} title={a._id ? 'Edit alert' : 'New alert'} width="max-w-2xl"
            footer={<>
                <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border border-line text-xs text-fg-3">Cancel</button>
                <button type="button" onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </>}>
            <div className="space-y-3 text-3xs text-fg-5">
                <label className="flex flex-col gap-1">Name<input className={input} value={a.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} /></label>
                <div className="flex flex-col gap-1"><label htmlFor="alert-query">Query</label><QueryInput id="alert-query" ariaLabel="Alert query" className={`${input} font-mono w-full`} value={a.query} fields={fields} onChange={(q) => set({ query: q, presetId: null })} /></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <label className="flex flex-col gap-1">Universe
                        <select className={input} value={a.universe} onChange={(e) => set({ universe: e.target.value })}>{universes.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}</select>
                    </label>
                    <label className="flex flex-col gap-1">Min turnover ₹cr<input type="number" min="0" step="0.5" className={input} value={a.minTurnoverCr} onChange={(e) => set({ minTurnoverCr: e.target.value })} /></label>
                    <label className="flex flex-col gap-1" title="Comma-separated IST times, e.g. 08:45, 20:30">Run at (IST)<input className={`${input} font-mono`} value={timesText} onChange={(e) => setTimesText(e.target.value)} /></label>
                    <label className="flex flex-col gap-1" title="Don't re-notify a stock within this many days (stops a stock flickering around a threshold)">Cooldown days<input type="number" min="0" max="60" className={input} value={a.cooldownDays} onChange={(e) => set({ cooldownDays: e.target.value })} /></label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Days">
                    <span className="mr-1">Days</span>
                    {DAY_NAMES.map((n, i) => {
                        const on = a.days.includes(i);
                        return <button key={n} type="button" aria-pressed={on} onClick={() => set({ days: on ? a.days.filter(x => x !== i) : [...a.days, i].sort() })}
                            className={`px-2 py-0.5 rounded border text-2xs ${on ? 'border-primary bg-primary/10 text-primary-ink' : 'border-line text-fg-4'}`}>{n}</button>;
                    })}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-col gap-1">Prices<Segmented options={BASIS_OPTS} value={a.live} onChange={(v) => set({ live: v })} /></div>
                    <div className="flex flex-col gap-1">Notify on<Segmented options={[{ v: 'new', label: 'New matches' }, { v: 'every', label: 'Every run' }]} value={a.notifyOn} onChange={(v) => set({ notifyOn: v })} /></div>
                    <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3"><input type="checkbox" checked={a.notifyTelegram} onChange={(e) => set({ notifyTelegram: e.target.checked })} /> Telegram</label>
                    <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3"><input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled</label>
                </div>
                <div className="text-fg-5">NSE's evening files land at different times (the ingest retries 18:15–22:15 IST), so an evening alert is best at 20:30 or later. A morning run (before 09:15) uses last night's close with the morning PE file — EPS from results filed after the close, before any session has traded on it.</div>
                {err && <div role="alert" className="text-2xs text-danger">{err}</div>}
            </div>
        </Modal>
    );
}

function RunHistory({ alert, onClose, api, fieldsByName }) {
    const [runs, setRuns] = useState(null);   // keyed by alert id at the call site
    const [open, setOpen] = useState(null);
    useEffect(() => {
        if (!alert) return;
        api.get(`/alerts/${alert._id}/runs`).then(r => setRuns(Array.isArray(r?.runs) ? r.runs : [])).catch(e => toast.error(errText(e)));
    }, [alert, api]);
    return (
        <Modal open={!!alert} onClose={onClose} title={`History — ${alert?.name || ''}`} width="max-w-4xl">
            {!runs && <Spinner />}
            {runs && !runs.length && <Placeholder>No runs yet.</Placeholder>}
            {runs && runs.length > 0 && (
                <ul className="space-y-2">
                    {runs.map(r => (
                        <li key={r._id} className="rounded border border-line/60 p-2.5">
                            <button type="button" onClick={() => setOpen(open === r._id ? null : r._id)} className="w-full text-left flex flex-wrap items-center gap-2 text-2xs">
                                <span className="text-fg-2 font-medium">{istDateTime(r.at)}</span>
                                <Chip tone={r.status === 'ok' ? 'neutral' : 'critical'}>{r.status}</Chip>
                                <Chip tone="muted">{r.trigger}</Chip>
                                {r.basis?.kind && <Chip tone={r.basis.kind === 'LIVE' ? 'live' : 'neutral'}>{r.basis.kind === 'LIVE' ? 'live' : `EOD ${r.basis.eodDate}`}</Chip>}
                                <span className="text-fg-4">{fmt(r.counts?.matched, 0)} matched · <b className="text-fg-2">{(r.newSymbols || []).length} new</b>{r.firstRun ? ' (baseline)' : ''} · {(r.droppedSymbols || []).length} dropped{(r.suppressedByCooldown || []).length ? ` · ${r.suppressedByCooldown.length} held by cooldown` : ''} · {fmt(r.counts?.unknown, 0)} unknown</span>
                                <span className="text-fg-5 ml-auto">{r.notified?.telegram ? 'sent to Telegram' : r.notified?.reason || r.notified?.error || ''}</span>
                            </button>
                            {r.error && <div className="text-2xs text-danger mt-1">{r.error}</div>}
                            {(r.newSymbols || []).length > 0 && <div className="text-2xs text-fg-3 mt-1">New: {r.newSymbols.join(', ')}</div>}
                            {open === r._id && r.rows?.length > 0 && (
                                <div className="mt-2">
                                    <DataTable dense maxHeight={300} rows={r.rows.map(x => ({ ...x, _key: x.symbol }))}
                                        columns={Object.keys(r.rows[0]).filter(k => !['name', 'series', 'industry', 'is_fno', 'corp_action_sessions_ago'].includes(k)).map(k => ({
                                            key: k, header: LABEL_FIELD[k] || <span className="font-mono">{k}</span>, align: k === 'symbol' ? undefined : 'right',
                                            render: (x) => (x[k] == null ? '—' : <FieldValue meta={fieldsByName?.get(k)} v={x[k]} />),
                                        }))} />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}

function AlertsTab({ api, universes, editing, setEditing, onChanged, fields = [] }) {
    const fieldsByName = useMemo(() => new Map(fields.map(f => [f.name, f])), [fields]);
    const confirm = useConfirm();
    const [alerts, setAlerts] = useState(null);
    const [busy, setBusy] = useState({});
    const [history, setHistory] = useState(null);
    const load = useCallback(async () => {
        try { const r = await api.get('/alerts'); setAlerts(Array.isArray(r?.alerts) ? r.alerts : []); } catch (e) { toast.error(errText(e)); setAlerts([]); }
        onChanged?.();   // the tab badge and header read /status; refresh it now, not on the next 30 s poll
    }, [api, onChanged]);
    useEffect(() => { load(); }, [load]);

    const runNow = async (a) => {
        setBusy(b => ({ ...b, [a._id]: true }));
        try {
            const { run } = await api.post(`/alerts/${a._id}/run`);
            if (run.status === 'ok') toast.success(`${a.name}: ${run.counts?.matched ?? 0} matched, ${run.newSymbols?.length ?? 0} new${run.notified?.telegram ? ' — sent to Telegram' : ''}`);
            else toast.error(`${a.name}: ${run.error}`);
            load();
        } catch (e) { toast.error(errText(e)); } finally { setBusy(b => ({ ...b, [a._id]: false })); }
    };
    const toggle = async (a) => {
        try { await api.put(`/alerts/${a._id}`, { enabled: !a.enabled }); load(); } catch (e) { toast.error(errText(e)); }
    };
    const remove = async (a) => {
        const ok = await confirm({ title: `Delete “${a.name}”?`, body: 'Its run history is deleted with it.', confirmLabel: 'Delete alert', danger: true });
        if (!ok) return;
        try { await api.del(`/alerts/${a._id}`); toast.success('Alert deleted'); load(); } catch (e) { toast.error(errText(e)); }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-2xs text-fg-5 max-w-2xl">Each alert runs its screen at the listed IST times and sends Telegram only for stocks that <b>newly</b> match since its last run (or every run, if you choose). Every run is recorded with what it was based on and what it could not evaluate.</p>
                <button type="button" onClick={() => setEditing(blankAlert())} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-medium"><BellRing className="w-3.5 h-3.5" aria-hidden="true" /> New alert</button>
            </div>
            {!alerts && <Spinner />}
            {alerts && !alerts.length && <EmptyState icon={BellRing} title="No alerts yet">Build a screen on the Screener tab (or pick a starting point) and use “Save as alert”.</EmptyState>}
            {alerts && alerts.length > 0 && (
                <div className="grid gap-3 lg:grid-cols-2">
                    {alerts.map(a => (
                        <Card key={a._id} title={<span className="flex items-center gap-2">{a.name}{!a.enabled && <Chip tone="muted">paused</Chip>}</span>}
                            subtitle={a.lastRunAt ? `Last run ${istDateTime(a.lastRunAt)} · ${a.lastStatus === 'ok' ? `${a.lastMatchCount ?? 0} matched, ${a.lastNewCount ?? 0} new` : a.lastStatus}` : 'Never run'}
                            right={
                                <label className="inline-flex items-center gap-1.5 text-2xs text-fg-4 cursor-pointer">
                                    <input type="checkbox" checked={a.enabled} onChange={() => toggle(a)} aria-label={`Enable ${a.name}`} /> on
                                </label>
                            }>
                            <div className="space-y-2">
                                <code className="block font-mono text-2xs text-fg-3 bg-surface-2 rounded px-2 py-1.5 break-words">{a.query}</code>
                                <div className="flex flex-wrap gap-1.5">
                                    <Chip>{(universes.find(u => u.key === a.universe) || {}).label || a.universe}</Chip>
                                    {a.minTurnoverCr ? <Chip tone="muted">≥ ₹{a.minTurnoverCr} cr</Chip> : null}
                                    {a.times.map(t => <Chip key={t} tone="info">{t}</Chip>)}
                                    <Chip tone="muted">{a.days.length === 5 && a.days.every(d => d >= 1 && d <= 5) ? 'Mon–Fri' : a.days.map(d => DAY_NAMES[d]).join(' ')}</Chip>
                                    <Chip tone="muted">{a.live === 'auto' ? 'live when open' : a.live === 'on' ? 'live' : 'EOD'}</Chip>
                                    <Chip tone="muted">{a.notifyTelegram ? (a.notifyOn === 'new' ? `Telegram on new · ${a.cooldownDays}d cooldown` : 'Telegram every run') : 'no Telegram'}</Chip>
                                </div>
                                {a.lastStatus === 'error' && <div className="text-2xs text-danger">{a.lastError}</div>}
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <button type="button" onClick={() => runNow(a)} disabled={busy[a._id]} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-line text-2xs text-fg-3 hover:bg-card-2 disabled:opacity-50">
                                        {busy[a._id] ? <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Play className="w-3 h-3" aria-hidden="true" />} Run now
                                    </button>
                                    <button type="button" onClick={() => setHistory(a)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-line text-2xs text-fg-3 hover:bg-card-2"><History className="w-3 h-3" aria-hidden="true" /> History</button>
                                    <button type="button" onClick={() => setEditing({ ...blankAlert(), ...a })} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-line text-2xs text-fg-3 hover:bg-card-2"><Pencil className="w-3 h-3" aria-hidden="true" /> Edit</button>
                                    <button type="button" onClick={() => remove(a)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-line text-2xs text-danger hover:bg-danger/10 ml-auto"><Trash2 className="w-3 h-3" aria-hidden="true" /> Delete</button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
            {editing && <AlertEditor key={editing._id || `new-${editing.query}`} open initial={editing} universes={universes} api={api} fields={fields} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
            {history && <RunHistory key={history._id} alert={history} onClose={() => setHistory(null)} api={api} fieldsByName={fieldsByName} />}
        </div>
    );
}

// ── data tab ─────────────────────────────────────────────────────────────
const JOURNAL_TONE = { ok: 'neutral', missing: 'muted', 'holiday-copy': 'muted', blocked: 'critical', error: 'critical', unparseable: 'warning', partial: 'warning' };

/**
 * Ownership, disclosures and filings: what each dataset gives, how much is
 * stored, and which dates it covers. Coverage matters more than counts here —
 * a trailing-30-day field reads 0 only inside a covered window, UNKNOWN outside.
 */
function ReferenceData({ api, s, busy, act }) {
    const R = s.reference || {};
    const job = R.job || {};
    const ev = R.events || {};
    const iv = R.intervals || {};
    const aux = s.aux || {};
    const hb = (R.holdings && R.holdings.breakdown) || {};
    const fp = (R.financials && R.financials.parsed) || {};
    const span = (k) => (Array.isArray(iv[k]) && iv[k].length ? iv[k].map(([a, b]) => `${a} → ${b}`).join(', ') : '—');
    const auxSpan = (k) => (aux[k] && aux[k].first ? `${aux[k].first} → ${aux[k].last}` : '—');
    const queued = (st) => `${fmt(st.ok || 0, 0)} done · ${fmt(st.pending || 0, 0)} queued${st.failed ? ` · ${fmt(st.failed, 0)} failed` : ''}`;
    const rows = [
        { k: 'sast', label: 'Promoter & 5% holder trades (SAST)', gives: 'promoter_buy_pct_30d, holder5_buy_pct_30d, …', stored: `${fmt(ev.sast?.rows, 0)} trades · ${fmt(ev.sast?.symbols, 0)} stocks`, range: span('sast'), refresh: 'nightly, last 10 days' },
        { k: 'pit', label: 'Insider trades', gives: 'insider_net_cr_30d, insider_buyers_30d, pledge events', stored: `${fmt(ev.pit?.rows, 0)} trades · ${fmt(R.insider?.symbolsPolled, 0)} of ${fmt(R.insider?.prioritySymbols, 0)} stocks polled`, range: R.insider?.oldestPoll ? `last polls ${R.insider.oldestPoll} → ${R.insider.newestPoll}` : '—', refresh: 'one stock per request: ~110 a night, in rotation (F&O + NIFTY 500)' },
        { k: 'bm', label: 'Board meetings', gives: 'days_to_results, meeting_fund_raising, …', stored: `${fmt(ev.bm?.rows, 0)} meetings`, range: span('bm'), refresh: 'nightly, incl. the next 45 days' },
        { k: 'ca', label: 'Corporate actions', gives: 'ex-dates, dividends, exact split/bonus factors', stored: `${fmt(ev.ca?.rows, 0)} actions`, range: span('ca'), refresh: 'nightly, incl. the next 60 days' },
        { k: 'shp', label: 'Shareholding filings', gives: 'promoter / FII / DII / MF / retail %, pledges, shareholders', stored: `${fmt(R.holdings?.filings, 0)} filings · ${fmt(R.holdings?.companies, 0)} companies · breakdown ${queued(hb)}`, range: span('shp'), refresh: 'nightly list; breakdown XBRL F&O + NIFTY 500 first' },
        { k: 'results', label: 'Quarterly results filings', gives: 'revenue / profit growth, margins, ROE, book value', stored: `${fmt(R.financials?.filings, 0)} filings · ${fmt(R.financials?.companies, 0)} companies · parsed ${queued(fp)}`, range: R.financials?.firstPeriod ? `quarters from ${R.financials.firstPeriod}; latest filed ${R.financials.lastKnown}` : '—', refresh: 'nightly list (Mar-2025 quarter on); XBRL priority first' },
        { k: 'fpi', label: 'NSDL FPI daily flows', gives: 'fpi_net_cr, fpi_net_20d_cr, …', stored: `${fmt(aux.fpi?.days, 0)} days`, range: auxSpan('fpi'), refresh: 'nightly; archived at source' },
        { k: 'fpisector', label: 'NSDL sector flows (fortnightly)', gives: 'sector_fpi_net_cr, sector_fpi_net_3m_pct_auc', stored: `${fmt(aux.fpisector?.days, 0)} reports`, range: auxSpan('fpisector'), refresh: 'fortnightly; archived since 2012' },
        { k: 'redflag', label: 'NSDL foreign-limit red flags', gives: 'near_foreign_limit, foreign_headroom_pp', stored: `${fmt(aux.redflag?.days, 0)} days`, range: auxSpan('redflag'), refresh: "today's list only — history from the day collection began" },
        { k: 'film', label: 'NSDL share counts & limits', gives: 'fpi_limit_pct; shares when no filing is stored', stored: R.film ? `${fmt(R.film.companies, 0)} companies` : '—', range: R.film?.date || '—', refresh: 'nightly snapshot' },
        { k: 'amfi', label: 'AMFI size categories', gives: 'amfi_category, amfi_rank', stored: R.amfi ? `${fmt(R.amfi.companies, 0)} companies` : '—', range: R.amfi ? `list to ${R.amfi.halfYearEnd} (used from ${R.amfi.knownFrom})` : '—', refresh: 'January & July; only the newest list is online' },
    ];
    return (
        <Card title="Ownership, disclosures & filings" subtitle="Who owns and trades each stock, what the company announced, what it reported — from NSE's disclosure APIs and filing archive, NSDL and AMFI. Every value is used only from the date it was published, so history replays cannot see ahead.">
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!!busy || job.running} title="24 months of disclosures, filings lists, NSDL history and AMFI, then the first batch of XBRL filings and insider-trade polls (F&O + NIFTY 500). About 1-2 hours; the nightly run keeps it current."
                        onClick={() => act('refbackfill', () => api.post('/ingest/reference', { months: 24 }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><Database className="w-3.5 h-3.5" aria-hidden="true" /> Backfill reference data (2 years)</button>
                    <button type="button" disabled={!!busy || job.running} onClick={() => act('refdaily', () => api.post('/ingest/reference/daily'))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh now</button>
                    <button type="button" disabled={!!busy || job.running || !((hb.pending || 0) + (fp.pending || 0))} title="Download the next 400 queued shareholding and 400 results XBRL filings"
                        onClick={() => act('reffilings', () => api.post('/ingest/reference/filings', { budget: 400 }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><Upload className="w-3.5 h-3.5 rotate-180" aria-hidden="true" /> Download more filings</button>
                    {job.running && <button type="button" onClick={() => act('refabort', () => api.post('/ingest/reference/abort'))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-danger"><Square className="w-3.5 h-3.5" aria-hidden="true" /> Stop</button>}
                </div>
                {job.running && (
                    <div aria-live="polite" className="space-y-1">
                        <Spinner label={`${job.kind}: ${job.step || '…'}${job.total ? ` — ${fmt(job.done, 0)}/${fmt(job.total, 0)}` : ''}${job.current ? ` · ${job.current}` : ''}`} />
                        {job.total > 0 && <div className="h-1.5 rounded bg-card-2 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round((job.done / job.total) * 100)}%` }} /></div>}
                    </div>
                )}
                {!job.running && job.finishedAt && (
                    <div className="text-2xs text-fg-4">Last {job.kind} run finished {istDateTime(job.finishedAt)}{job.error ? <span className="text-danger"> — {job.error}</span> : null}</div>
                )}
                <DataTable dense
                    columns={[
                        { key: 'label', header: 'Dataset' }, { key: 'gives', header: 'Gives you', render: (x) => <span className="text-fg-5 whitespace-normal font-mono text-3xs">{x.gives}</span> },
                        { key: 'stored', header: 'Stored', render: (x) => <span className="whitespace-normal">{x.stored}</span> },
                        { key: 'range', header: 'Covered', render: (x) => <span className="whitespace-normal">{x.range}</span> },
                        { key: 'refresh', header: 'Refresh', render: (x) => <span className="text-fg-5 whitespace-normal">{x.refresh}</span> },
                    ]}
                    rows={rows.map(x => ({ ...x, _key: x.k }))} />
                <div className="text-3xs text-fg-5">
                    Not available anywhere free and machine-readable: historical bulk/block deals (NSE's archive API answers 503) and a daily per-stock FII % (quarterly filings are the finest grain). Insider trades exist only per stock, so the rest of the market is not polled.
                </div>
            </div>
        </Card>
    );
}

function DataTab({ api, status, reload }) {
    const confirm = useConfirm();
    const [csv, setCsv] = useState('');
    const [asOf, setAsOf] = useState('');
    const [imp, setImp] = useState(null);
    const [busy, setBusy] = useState(null);
    const fileRef = useRef(null);
    const act = async (what, fn) => {
        setBusy(what);
        try { await fn(); } catch (e) { toast.error(errText(e)); } finally { setBusy(null); reload(); }
    };
    const s = status;
    if (!s) return <Spinner />;
    const cov = s.coverage || {};
    const ing = s.ingest || {};
    const doImport = () => act('import', async () => {
        const r = await api.post(`/fundamentals/import${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`, csv, { headers: { 'Content-Type': 'text/csv' } });
        setImp(r);
        toast.success(`Imported ${r.imported} stocks (${r.withBookValue ?? 0} with book value)`);
    });
    return (
        <div className="space-y-4">
            <StatRow cols={4}>
                <StatTile label="Sessions stored" value={fmt(cov.sessions, 0)} hint={cov.firstSession ? `${cov.firstSession} → ${cov.lastSession}` : 'none yet'} tone={cov.sessions >= 250 ? 'neutral' : 'warning'} />
                <StatTile label="PE files" value={fmt(cov.peFiles, 0)} hint={`latest ${cov.lastPeFile || '—'}`} />
                <StatTile label="Universe" value={fmt(s.universe?.equities, 0)} hint={s.universe ? `${fmt(s.universe.fno, 0)} F&O · ${Object.keys(s.universe.indices || {}).length} index lists` : 'not loaded'} />
                <StatTile label="Stored" value={`${fmt(cov.storedMb, 1)} MB`} hint={`compute: ${s.scanner?.computeIn || '—'} · free ${fmt(s.scanner?.memory?.freeMb, 0)} MB (needs ${fmt(s.scanner?.memory?.needMb, 0)})`} tone={s.scanner?.memory && !s.scanner.memory.ok ? 'warning' : 'neutral'} />
            </StatRow>
            {s.scanner?.memory && !s.scanner.memory.ok && (
                <div className="text-2xs text-warning flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />Only {s.scanner.memory.freeMb} MB is free and a scan needs about {s.scanner.memory.needMb} MB, so scans are refused rather than risk swapping the box the trading engine runs on. Free memory, or lower SCREENER_MIN_FREE_MB / SCREENER_SESSIONS knowingly.</div>
            )}
            {cov.sessions < 200 && (
                <div className="text-2xs text-warning">Fewer than 200 sessions stored: 52-week, SMA-200 and 1-year PE fields are UNKNOWN for every stock until a backfill completes.</div>
            )}

            <Card title="Supplementary NSE data" subtitle="What the broker (Fyers) does not provide: its market-data API is quotes, depth, candles and the option chain only — no fundamentals, no FII/DII, no deals. These come from NSE's own end-of-day files, fetched with the bhavcopy.">
                <DataTable dense
                    columns={[
                        { key: 'label', header: 'Dataset' }, { key: 'fields', header: 'Gives you', render: (x) => <span className="text-fg-5 whitespace-normal">{x.fields}</span> },
                        { key: 'days', header: 'Days stored', align: 'right', render: (x) => fmt(x.days, 0) },
                        { key: 'range', header: 'Range', render: (x) => (x.first ? `${x.first} → ${x.last}` : '—') },
                        { key: 'hist', header: 'History at source', render: (x) => <span className="text-fg-5 whitespace-normal">{x.hist}</span> },
                    ]}
                    rows={[
                        { k: 'idx', label: 'Index closes', fields: 'NIFTY / sector P/E, P/B, dividend yield, India VIX, market trend', hist: 'archived (2+ years)' },
                        { k: 'part', label: 'FII / DII / Pro / Client positions', fields: 'FII long % in index & stock futures, their daily change, retail positioning', hist: 'archived (2+ years)' },
                        { k: 'fo', label: 'F&O bhavcopy', fields: 'futures OI & change, OI buildup, basis, stock PCR, NIFTY PCR', hist: 'archived (2+ years), ~1 MB/day' },
                        { k: 'ban', label: 'F&O ban list', fields: 'in_fo_ban', hist: 'archived' },
                        { k: 'deals', label: 'Bulk & block deals', fields: 'net deal buying, institution buying, top buyer', hist: 'latest day only — collected from the day this started' },
                        { k: 'fiidii', label: 'FII / DII cash flows', fields: 'FII & DII net buying (₹ cr), 5-day sums', hist: 'latest day only — collected from the day this started' },
                    ].map(x => ({ ...x, ...((s.aux || {})[x.k] || {}), _key: x.k }))} />
                <div className="text-3xs text-fg-5 mt-2">
                    Price bands (circuit limits): {s.priceBands ? `${fmt(s.priceBands.count, 0)} stocks, list of ${s.priceBands.date}` : 'not fetched yet'}.
                </div>
            </Card>

            <ReferenceData api={api} s={s} busy={busy} act={act} />

            <Card title="NSE ingest" subtitle="Bhavcopy (OHLC + delivery) and the daily PE file, fetched from NSE's archive at 07:05–09:05 and 18:15–22:15 IST on weekdays. Idempotent — stored days are skipped.">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={!!busy || ing.running} onClick={() => act('recent', () => api.post('/ingest/recent', { days: 7 }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${busy === 'recent' ? 'animate-spin' : ''}`} aria-hidden="true" /> Fetch last 7 days</button>
                        <button type="button" disabled={!!busy || ing.running} onClick={() => act('backfill', () => api.post('/ingest/backfill', { sessions: 260 }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><Database className="w-3.5 h-3.5" aria-hidden="true" /> Backfill a year (~5-10 min)</button>
                        <button type="button" disabled={!!busy || ing.running} title="~520 sessions: gives every 52-week / 200-day screen a full year to be tested on, plus an earlier year to check results out of sample. Downloads ~550 MB of F&O files (~1.1 MB a day) — only small per-stock aggregates are stored."
                            onClick={() => act('backfill', () => api.post('/ingest/backfill', { sessions: 520 }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><Database className="w-3.5 h-3.5" aria-hidden="true" /> Backfill 2 years (~15-25 min)</button>
                        <button type="button" disabled={!!busy || ing.running}
                            title="~1,600 sessions, back to early 2020: 'Test on history' over up to 6 years, and the 3- and 5-year return fields (cagr_3y_pct, change_5y_pct…). NSE's corporate actions are fetched over the same span to adjust old prices for splits and bonuses. NSE's PE files start in mid-2024 and results filings in 2025, so older sessions carry prices, volume and delivery only — PE, PB and filing screens stay limited to recent years. About 1-2 hours; ~150 MB more in the database. Stored days are skipped, so it only fetches what is missing."
                            onClick={() => act('backfill', () => api.post('/ingest/backfill', { sessions: 1600 }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><Database className="w-3.5 h-3.5" aria-hidden="true" /> Backfill 6 years (~1-2 h)</button>
                        <button type="button" disabled={!!busy} onClick={() => act('universe', () => api.post('/ingest/universe'))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-fg-3 hover:bg-card-2 disabled:opacity-50"><BookOpen className="w-3.5 h-3.5" aria-hidden="true" /> Refresh stock lists</button>
                        {ing.running && <button type="button" onClick={() => act('abort', () => api.post('/ingest/abort'))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-danger"><Square className="w-3.5 h-3.5" aria-hidden="true" /> Stop</button>}
                    </div>
                    {ing.running && (
                        <div aria-live="polite" className="space-y-1">
                            <Spinner label={`${ing.kind}: ${ing.done}/${ing.total} dates${ing.current ? ` — ${ing.current}` : ''}`} />
                            <div className="h-1.5 rounded bg-card-2 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${ing.total ? Math.round((ing.done / ing.total) * 100) : 0}%` }} /></div>
                        </div>
                    )}
                    {!ing.running && ing.finishedAt && (
                        <div className="text-2xs text-fg-4">Last {ing.kind} finished {istDateTime(ing.finishedAt)}{ing.summary ? ` — bhavcopy ${JSON.stringify(ing.summary.bhav)}, PE ${JSON.stringify(ing.summary.pe)}` : ''}{ing.error ? <span className="text-danger"> — {ing.error}</span> : null}</div>
                    )}
                    {s.universe?.errors?.length > 0 && <div className="text-2xs text-warning">Stock lists: {s.universe.errors.join('; ')}</div>}
                    <details>
                        <summary className="text-2xs text-fg-4 cursor-pointer">Fetch journal — every attempt, including holidays and misses ({(s.journal || []).length})</summary>
                        <DataTable dense maxHeight={300}
                            columns={[{ key: 'at', header: 'When', render: (e) => istDateTime(e.at) }, { key: 'kind', header: 'File' }, { key: 'date', header: 'For date' },
                                { key: 'status', header: 'Outcome', render: (e) => <Chip tone={JOURNAL_TONE[e.status] || 'neutral'}>{e.status}</Chip> }, { key: 'detail', header: 'Detail', render: (e) => <span className="text-fg-5 whitespace-normal">{e.detail}</span> }]}
                            rows={(s.journal || []).map((e, i) => ({ ...e, _key: `${e.at}-${i}` }))} />
                    </details>
                </div>
            </Card>

            <Card title="Your own fundamentals (optional CSV)" subtitle="Book value now comes from each company's NSE results filing (balance sheet). A CSV import fills gaps — stocks with no stored filing — and every other numeric column becomes a queryable f_… field. Symbol column: SYMBOL / NSE Code; book value: Book Value / BVPS.">
                <div className="space-y-3">
                    <div className="text-2xs text-fg-4">
                        {s.fundamentals?.stocks ? <>Stored: {fmt(s.fundamentals.stocks, 0)} stocks, {fmt(s.fundamentals.withBookValue, 0)} with book value (as of {s.fundamentals.bookValueOldest ? String(s.fundamentals.bookValueOldest).slice(0, 10) : '—'} → {s.fundamentals.bookValueNewest ? String(s.fundamentals.bookValueNewest).slice(0, 10) : '—'}). NSE-filed book values take precedence.</> : 'Nothing imported — PB uses NSE results filings only.'}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-2xs text-fg-4" aria-label="Choose CSV file"
                            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
                        <label className="text-3xs text-fg-5 flex flex-col gap-1">Book value as of<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="bg-surface-2 border border-line rounded px-2 py-1 text-xs text-fg-2" /></label>
                        <button type="button" disabled={!csv.trim() || !!busy} onClick={doImport} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-medium disabled:opacity-50"><Upload className="w-3.5 h-3.5" aria-hidden="true" /> Import</button>
                        {s.fundamentals?.stocks > 0 && (
                            <button type="button" disabled={!!busy} onClick={async () => { if (await confirm({ title: 'Delete all imported fundamentals?', body: 'PB and every f_… field become unknown.', confirmLabel: 'Delete fundamentals', danger: true })) act('clear', () => api.del('/fundamentals')); }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-line text-xs text-danger ml-auto"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Clear</button>
                        )}
                    </div>
                    <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} spellCheck={false} aria-label="CSV contents"
                        placeholder={'…or paste it here:\nSymbol,Book Value,ROCE %\nINFY,225,40.1'}
                        className="w-full font-mono text-2xs bg-surface-2 border border-line rounded px-2 py-1.5 text-fg-3" />
                    {imp && (
                        <div className="text-2xs space-y-1">
                            <div className="text-fg-3">Imported {imp.imported} · with book value {imp.withBookValue ?? 0}{imp.fields?.length ? ` · new fields: ${imp.fields.map(f => f.name).join(', ')}` : ''}</div>
                            {(imp.issues || []).map((i, k) => <div key={k} className="text-warning">{i}</div>)}
                        </div>
                    )}
                </div>
            </Card>

            {s.scanner?.eod?.peFileQuality && (s.scanner.eod.peFileQuality.setAside?.length > 0 || s.scanner.eod.peFileQuality.rebased?.length > 0) && (
                <Card title="PE files the quality gate acted on" subtitle="Files that changed more than 30% of stocks' EPS at once. Set aside = ignored (EPS held at the last good file); re-based = the change held for 5 files and was accepted without counting as results.">
                    <DataTable dense
                        columns={[{ key: 'fileDate', header: 'File date' }, { key: 'what', header: 'Action', render: (f) => <Chip tone={f.what === 'set aside' ? 'warning' : 'info'}>{f.what}</Chip> }, { key: 'sharePct', header: "Stocks' EPS changed", align: 'right', render: (f) => `${fmt(f.sharePct, 1)}%` }]}
                        rows={[...(s.scanner.eod.peFileQuality.setAside || []).map(f => ({ ...f, what: 'set aside' })), ...(s.scanner.eod.peFileQuality.rebased || []).map(f => ({ ...f, what: 're-based' }))].sort((a, b) => (a.fileDate < b.fileDate ? 1 : -1)).map(f => ({ ...f, _key: f.fileDate }))} />
                </Card>
            )}

            <Card title="How the numbers are made" subtitle="Facts about NSE's files this screener corrects for.">
                <ul className="list-disc pl-5 space-y-1 text-2xs text-fg-4">{(s.facts || []).map((f, i) => <li key={i}>{f}</li>)}</ul>
            </Card>
        </div>
    );
}

// ── page ─────────────────────────────────────────────────────────────────
export default function Alerts() {
    const api = useApi();
    const [params, setParams] = useSearchParams();
    const tab = ['screener', 'alerts', 'data'].includes(params.get('tab')) ? params.get('tab') : 'screener';
    const setTab = (t) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
    const [fields, setFields] = useState([]);
    const [presets, setPresets] = useState([]);
    const [universes, setUniverses] = useState([{ key: 'ALL', label: 'All stocks' }]);
    const [status, setStatus] = useState(null);
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState(() => {
        try { const s = JSON.parse(localStorage.getItem('alerts:draft') || 'null'); if (s && typeof s.query === 'string') return s; } catch { /* private mode */ }
        return { query: 'volume_ratio >= 3 AND deliv_pct_jump >= 15 AND change_pct > 0', universe: 'ALL', minTurnoverCr: 2, sortBy: 'volume_ratio', sortDir: 'desc', live: 'auto', presetId: 'volume_delivery_spike' };
    });
    useEffect(() => { try { localStorage.setItem('alerts:draft', JSON.stringify(draft)); } catch { /* private mode: forget */ } }, [draft]);

    const loadStatus = useCallback(async () => {
        try {
            const st = await api.get('/status');
            setStatus(st && typeof st === 'object' && !Array.isArray(st) ? st : { error: 'The screener API answered with something unexpected — is the backend on a version with /api/screener?' });
        } catch (e) { setStatus(s => s || { error: errText(e) }); }
    }, [api]);
    useEffect(() => {
        // Every read is shape-checked: a proxy error page or an older backend answers
        // 200 with something else, and one `.map` on undefined blanks the whole page.
        const list = (v) => (Array.isArray(v) ? v : []);
        api.get('/fields').then(r => setFields(list(r?.fields))).catch(() => {});
        api.get('/presets').then(r => setPresets(list(r?.presets))).catch(() => {});
        api.get('/universes').then(r => { const u = list(r?.universes); if (u.length) setUniverses(u); }).catch(() => {});
        loadStatus();
    }, [api, loadStatus]);
    // Poll faster while an ingest is running so its progress is live.
    useEffect(() => {
        const ms = status?.ingest?.running || status?.reference?.job?.running ? 2000 : 30000;
        const id = setInterval(loadStatus, ms);
        return () => clearInterval(id);
    }, [status?.ingest?.running, status?.reference?.job?.running, loadStatus]);

    const cov = status?.coverage;
    const noData = cov && cov.sessions === 0;
    return (
        <div className="p-6 space-y-6">
            <PageHeader icon={BellRing} title="Stock Alerts"
                subtitle="Screen every NSE stock on NSE's own daily files, save screens as scheduled alerts, and get a Telegram message when a stock newly matches."
                badges={cov ? <>
                    <Chip tone={cov.sessions >= 250 ? 'neutral' : 'warning'}>{cov.lastSession ? `EOD ${cov.lastSession}` : 'no data'}</Chip>
                    <Chip tone="muted">PE file {cov.lastPeFile || '—'}</Chip>
                    <Chip tone={status?.scanner?.marketOpen ? 'live' : 'muted'}>{status?.scanner?.marketOpen ? 'market open' : 'market closed'}</Chip>
                </> : null}
            />
            {noData && (
                <EmptyState icon={Database} title="No NSE data yet"
                    action={<button type="button" onClick={() => setTab('data')} className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-medium">Go to Data</button>}>
                    The server backfills a year automatically ~90 s after it starts (about 5-8 minutes). You can also start it from the Data tab.
                </EmptyState>
            )}
            {status?.error && <EmptyState icon={AlertTriangle} title="Screener API unreachable">{status.error}</EmptyState>}
            <Tabs value={tab} onChange={setTab} ariaLabel="Stock alerts sections"
                tabs={[{ id: 'screener', label: 'Screener', icon: Search }, { id: 'alerts', label: 'Alerts', icon: BellRing, badge: status?.alerts ? <Chip tone="muted">{status.alerts}</Chip> : null }, { id: 'data', label: 'Data', icon: Database }]} />
            {tab === 'screener' && (
                <ScreenerTab api={api} fields={fields} presets={presets} universes={universes} draft={draft} setDraft={setDraft} limits={status?.scanner?.limits}
                    onSaveAlert={(d) => { setEditing(blankAlert(d)); setTab('alerts'); }} />
            )}
            {tab === 'alerts' && <AlertsTab api={api} universes={universes} editing={editing} setEditing={setEditing} onChanged={loadStatus} fields={fields} />}
            {tab === 'data' && <DataTab api={api} status={status} reload={loadStatus} />}
        </div>
    );
}
