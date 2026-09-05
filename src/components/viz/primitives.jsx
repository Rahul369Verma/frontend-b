import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { STATUS_ICON, inr, useChartTheme } from './tokens';

/**
 * Chart + dashboard primitives.
 *
 * Deliberately plain SVG/HTML rather than a chart library: every form here is
 * simple enough that a library would add weight without adding correctness,
 * and hand-built marks let us hold the specs the palette work assumes —
 * hairline grid, 2px gaps between fills, direct labels, a table view behind
 * every chart.
 *
 * Shared rules applied throughout:
 *   • a legend is present whenever ≥2 series are on screen (1 series = the
 *     title names it)
 *   • direct labels are SELECTIVE — never a number on every point in a dense
 *     series — but heatmap cells ARE all labelled, because there colour is
 *     doing real work and the number is the CVD fallback
 *   • grid/axis rules are solid hairlines, one shade off the surface
 *   • every chart has a hover layer
 *
 * WHY EVERY MARK-DRAWING PRIMITIVE CALLS useChartTheme()
 * These forms are inline `style` and SVG attributes, not Tailwind classes, so
 * they get none of the free retheming the rest of the app gets from redefining
 * `--color-*`. The hook hands back the ACTIVE theme's role table and re-renders
 * the primitive when the theme changes, which is the only way a hand-built mark
 * follows a theme switch. Primitives that draw no marks (Card, StatRow, Legend,
 * Findings, Placeholder) deliberately do NOT call it — they are pure Tailwind
 * and would only pay for a subscription they cannot use.
 */

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ title, subtitle, right, children, className = '' }) {
    return (
        <div className={`bg-surface border border-line/60 rounded-lg ${className}`}>
            {(title || right) && (
                <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
                    <div className="min-w-0">
                        {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
                        {subtitle && <p className="text-xs text-fg-5 mt-0.5">{subtitle}</p>}
                    </div>
                    {right && <div className="flex-shrink-0 text-xs text-fg-4">{right}</div>}
                </div>
            )}
            <div className="px-4 pb-4">{children}</div>
        </div>
    );
}

// ── Status badge — icon + label, never colour alone ──────────────────────────

export function StatusBadge({ level = 'info', children, title }) {
    const ct = useChartTheme();
    const color = ct.status[level] || ct.text.secondary;
    // alpha() rather than `${color}1f` — an 8-digit-hex suffix silently produces
    // garbage the moment a token is not exactly 6 hex digits.
    const tint = ct.alpha(color, 0.12);
    const edge = ct.alpha(color, 0.33);
    return (
        <span
            title={title}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium whitespace-nowrap"
            style={{ color, backgroundColor: tint, border: `1px solid ${edge}` }}
        >
            <span aria-hidden="true">{STATUS_ICON[level] || STATUS_ICON.info}</span>
            <span>{children}</span>
        </span>
    );
}

// ── Stat tile — the right form for a single current value ────────────────────

export function StatTile({ label, value, hint, tone = 'neutral', badge, hero = false }) {
    const ct = useChartTheme();
    // Tone tints the VALUE text only. The sign is in the number itself, so the
    // colour is reinforcement, never the sole carrier.
    const toneColor = tone === 'positive' ? ct.diverging.positive
        : tone === 'negative' ? ct.diverging.negative
        : ct.text.primary;
    return (
        <div className="bg-surface border border-line/60 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-2xs uppercase tracking-wide text-fg-5 truncate">{label}</span>
                {badge}
            </div>
            <span
                className={`font-semibold tabular-nums truncate ${hero ? 'text-3xl' : 'text-xl'}`}
                style={{ color: toneColor }}
                title={String(value)}
            >
                {value}
            </span>
            {hint && <span className="text-2xs text-fg-5 truncate" title={hint}>{hint}</span>}
        </div>
    );
}

export function StatRow({ children, cols = 4 }) {
    const gridCols = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6', 8: 'md:grid-cols-4 xl:grid-cols-8' }[cols] || 'md:grid-cols-4';
    return <div className={`grid grid-cols-2 ${gridCols} gap-3`}>{children}</div>;
}

// ── Meter — one ratio against a limit (not a 2-slice pie) ────────────────────

export function Meter({ value, max = 1, label, caption, tone = 'neutral' }) {
    const ct = useChartTheme();
    const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const fill = tone === 'critical' ? ct.status.critical
        : tone === 'warning' ? ct.status.warning
        : ct.categorical[0];
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-fg-4">{label}</span>
                <span className="text-sm font-semibold tabular-nums text-fg">
                    {(t * 100).toFixed(0)}%
                </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: ct.surfaceSunk }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${t * 100}%`, backgroundColor: fill }} />
            </div>
            {caption && <p className="text-2xs text-fg-5">{caption}</p>}
        </div>
    );
}

// ── Diverging bars — signed magnitude by category ────────────────────────────

/**
 * Horizontal bars centred on zero. Correct form for "which of these helped and
 * which hurt, and by how much".
 * @param {Array} data [{ label, value, hint }]
 */
export function DivergingBars({
    data = [], format = (v) => inr(v, { compact: true, sign: true }),
    height = 22, emptyText = 'No data', labelWidth = 116, valueWidth = 74,
}) {
    const ct = useChartTheme();
    const [hover, setHover] = useState(null);
    if (!data.length) return <p className="text-xs text-fg-5 py-4 text-center">{emptyText}</p>;

    const maxAbs = Math.max(...data.map(d => Math.abs(Number(d.value) || 0)), 1);

    // Three real columns — label | track | value — NOT absolute overlays.
    // The first cut floated the label and value over the plot area with a
    // percentage max-width; a percentage resolved against a shrink-to-fit
    // absolute parent collapses to near-zero, which truncated every label to
    // "Dire…" / "NIF…" and let long bars run underneath the value text.
    return (
        <div className="space-y-1">
            {data.map((d, i) => {
                const v = Number(d.value) || 0;
                const w = (Math.abs(v) / maxAbs) * 50;   // half-width each side of centre
                const positive = v >= 0;
                return (
                    <div
                        key={d.label + i}
                        className="flex items-center gap-2"
                        style={{ height }}
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover(null)}
                    >
                        <span className="text-2xs text-fg-3 truncate flex-shrink-0"
                              style={{ width: labelWidth }} title={d.label}>
                            {d.label}
                        </span>
                        <div className="relative flex-1 h-full min-w-0">
                            {/* zero rule — solid hairline, one shade off the surface */}
                            <div className="absolute inset-y-0 left-1/2 w-px" style={{ backgroundColor: ct.grid }} />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-3"
                                style={{
                                    left: positive ? '50%' : `${50 - w}%`,
                                    width: `${w}%`,
                                    backgroundColor: positive ? ct.diverging.positive : ct.diverging.negative,
                                    // 4px rounded data-end, square against the baseline
                                    borderRadius: positive ? '0 4px 4px 0' : '4px 0 0 4px',
                                    opacity: hover === null || hover === i ? 1 : 0.45,
                                }}
                            />
                            {hover === i && d.hint && (
                                <div className="absolute z-20 left-1/2 -translate-x-1/2 -top-1 -translate-y-full px-2 py-1 rounded text-2xs whitespace-nowrap pointer-events-none border border-line-2"
                                     style={{ backgroundColor: ct.tooltip.background, color: ct.tooltip.text }}>
                                    {d.hint}
                                </div>
                            )}
                        </div>
                        <span className="text-2xs tabular-nums text-fg-4 flex-shrink-0 text-right"
                              style={{ width: valueWidth }}>
                            {format(v)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// ── Waterfall — how components sum to a total ────────────────────────────────

/**
 * @param {Array} steps [{ label, value }] contributions
 * @param {object} total { label, value }
 */
export function Waterfall({ steps = [], total, format = (v) => inr(v, { compact: true, sign: true }) }) {
    const ct = useChartTheme();
    const [hover, setHover] = useState(null);
    if (!steps.length) return <p className="text-xs text-fg-5 py-4 text-center">No attribution available</p>;

    // Running cumulative positions.
    let run = 0;
    const bars = steps.map(s => {
        const v = Number(s.value) || 0;
        const from = run;
        run += v;
        return { ...s, value: v, from, to: run };
    });
    const totalValue = total ? Number(total.value) || 0 : run;

    const lo = Math.min(0, ...bars.map(b => Math.min(b.from, b.to)), totalValue);
    const hi = Math.max(0, ...bars.map(b => Math.max(b.from, b.to)), totalValue);
    const span = (hi - lo) || 1;
    const x = (v) => ((v - lo) / span) * 100;

    const rows = [...bars, { label: total?.label || 'Net', value: totalValue, from: 0, to: totalValue, isTotal: true }];

    // Same three-column layout as DivergingBars, for the same reason: overlaid
    // labels with percentage widths collapse and the bars run under the values.
    const LABEL_W = 132, VALUE_W = 78;

    return (
        <div className="space-y-1">
            {rows.map((b, i) => {
                const left = x(Math.min(b.from, b.to));
                const width = Math.max(0.6, Math.abs(x(b.to) - x(b.from)));
                const positive = b.value >= 0;
                const color = positive ? ct.diverging.positive : ct.diverging.negative;
                return (
                    <div key={b.label + i}
                         className={`flex items-center gap-2 ${b.isTotal ? 'mt-2 pt-2 border-t border-line' : ''}`}
                         style={{ height: 24 }}
                         onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                        <span className={`text-2xs truncate flex-shrink-0 ${b.isTotal ? 'font-semibold text-fg' : 'text-fg-3'}`}
                              style={{ width: LABEL_W }} title={b.label}>
                            {b.label}
                        </span>
                        <div className="relative flex-1 h-full min-w-0">
                            <div className="absolute inset-y-0 w-px" style={{ left: `${x(0)}%`, backgroundColor: ct.grid }} />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-3.5 rounded-[3px]"
                                style={{
                                    left: `${left}%`, width: `${width}%`,
                                    backgroundColor: color,
                                    opacity: b.isTotal ? 1 : (hover === null || hover === i ? 0.9 : 0.4),
                                    // 2px surface ring keeps adjacent fills from merging
                                    boxShadow: `0 0 0 2px ${ct.surface}`,
                                }}
                            />
                        </div>
                        <span className={`text-2xs tabular-nums flex-shrink-0 text-right ${b.isTotal ? 'font-semibold text-fg' : 'text-fg-4'}`}
                              style={{ width: VALUE_W }}>
                            {format(b.value)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// ── Heatmap — magnitude over a grid, diverging by sign ───────────────────────

/**
 * @param {Array} rows      row keys (e.g. spot shocks)
 * @param {Array} cols      column keys (e.g. IV shocks)
 * @param {Function} valueAt (row, col) => number|null
 */
export function Heatmap({
    rows, cols, valueAt, rowLabel = String, colLabel = String,
    rowTitle = '', colTitle = '', format = (v) => inr(v, { compact: true, sign: true }),
    cellHint, scaleCaption = 'loss ← → profit',
}) {
    const ct = useChartTheme();
    const [hover, setHover] = useState(null);
    const values = [];
    rows.forEach(r => cols.forEach(c => {
        const v = valueAt(r, c);
        if (Number.isFinite(v)) values.push(v);
    }));
    const maxAbs = Math.max(...values.map(Math.abs), 1);

    return (
        <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
                {colTitle && <div className="text-2xs text-fg-5 mb-1 text-center">{colTitle}</div>}
                <table className="border-separate" style={{ borderSpacing: 2 }}>
                    <thead>
                        <tr>
                            <th className="text-3xs text-fg-5 font-normal px-1 text-right whitespace-nowrap">
                                {rowTitle}
                            </th>
                            {cols.map(c => (
                                <th key={c} className="text-3xs text-fg-4 font-normal px-1 whitespace-nowrap">
                                    {colLabel(c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r}>
                                <td className="text-3xs text-fg-4 pr-2 text-right whitespace-nowrap tabular-nums">
                                    {rowLabel(r)}
                                </td>
                                {cols.map(c => {
                                    const v = valueAt(r, c);
                                    const key = `${r}|${c}`;
                                    const isHover = hover === key;
                                    // The fill is a composite of a pole over the card, so on a
                                    // LIGHT theme a full-magnitude cell lands mid-dark while the
                                    // theme's ink is near-black. ink() measures the fill it was
                                    // just handed and flips when the theme's own ink stops
                                    // clearing 3:1 on it.
                                    const fill = ct.divergingRgba(v, maxAbs);
                                    return (
                                        <td key={key} className="relative p-0">
                                            <div
                                                className="px-2 py-1.5 rounded text-2xs tabular-nums text-center whitespace-nowrap cursor-default transition-shadow"
                                                style={{
                                                    backgroundColor: fill,
                                                    color: ct.ink(fill),
                                                    minWidth: 62,
                                                    boxShadow: isHover ? `0 0 0 2px ${ct.categorical[0]}` : 'none',
                                                }}
                                                onMouseEnter={() => setHover(key)}
                                                onMouseLeave={() => setHover(null)}
                                            >
                                                {/* Every cell is direct-labelled: colour carries magnitude,
                                                    the number carries it too, so CVD never loses the reading. */}
                                                {Number.isFinite(v) ? format(v) : '—'}
                                            </div>
                                            {isHover && cellHint && (
                                                <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 rounded text-2xs whitespace-nowrap pointer-events-none border border-line-2"
                                                     style={{ backgroundColor: ct.tooltip.background, color: ct.tooltip.text }}>
                                                    {cellHint(r, c, v)}
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {/* Scale legend — required whenever colour encodes magnitude. */}
                <div className="flex items-center gap-2 mt-2 text-3xs text-fg-5">
                    <span>{format(-maxAbs)}</span>
                    <div className="flex-1 h-2 rounded" style={{
                        background: `linear-gradient(to right, ${ct.diverging.negative}, ${ct.surface}, ${ct.diverging.positive})`,
                        maxWidth: 220,
                    }} />
                    <span>{format(maxAbs)}</span>
                    <span className="ml-1 whitespace-nowrap">{scaleCaption}</span>
                </div>
            </div>
        </div>
    );
}

// ── Table — always available behind every chart ──────────────────────────────

export function DataTable({ columns, rows, empty = 'No rows', dense = false, maxHeight, zebra = true, onRowClick = null, selectedKey = null }) {
    const ct = useChartTheme();
    if (!rows || !rows.length) return <p className="text-xs text-fg-5 py-4 text-center">{empty}</p>;
    return (
        <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
            <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ backgroundColor: ct.surface }}>
                    <tr className="text-left text-fg-5">
                        {columns.map(c => (
                            <th key={c.key}
                                className={`font-medium ${dense ? 'py-1' : 'py-1.5'} px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}
                                style={{ borderBottom: `1px solid ${ct.grid}` }}>
                                {c.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => {
                        const isSel = selectedKey != null && (r._key ?? i) === selectedKey;
                        return (
                        // A clickable row is a real button semantically: it gets a
                        // pointer, a keyboard path and a pressed state, because a
                        // bare onClick on a <tr> is unreachable without a mouse.
                        <tr key={r._key || i}
                            onClick={onRowClick ? () => onRowClick(r) : undefined}
                            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r); } } : undefined}
                            tabIndex={onRowClick ? 0 : undefined}
                            role={onRowClick ? 'button' : undefined}
                            aria-pressed={onRowClick ? isSel : undefined}
                            className={`${zebra && i % 2 === 1 ? 'bg-card-2/40' : ''} hover:bg-card-2/80 transition-colors ${onRowClick ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary' : ''} ${isSel ? 'bg-primary/10' : ''}`}>
                            {columns.map(c => (
                                <td key={c.key}
                                    className={`${dense ? 'py-1' : 'py-1.5'} px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                                    style={{ borderBottom: `1px solid ${ct.gridSoft}` }}>
                                    {c.render ? c.render(r) : r[c.key]}
                                </td>
                            ))}
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Legend — present whenever ≥2 series share a chart ────────────────────────

export function Legend({ items }) {
    if (!items || items.length < 2) return null;
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            {items.map(it => (
                <span key={it.label} className="inline-flex items-center gap-1.5 text-2xs text-fg-4">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: it.color }} />
                    {it.label}
                </span>
            ))}
        </div>
    );
}

// ── Stacked share bar — part-to-whole for a small number of parts ────────────

export function ShareBar({ parts = [], format = (v) => inr(v, { compact: true }) }) {
    const ct = useChartTheme();
    const total = parts.reduce((a, p) => a + Math.abs(Number(p.value) || 0), 0);
    if (!(total > 0)) return <p className="text-xs text-fg-5">Nothing on the book</p>;
    return (
        <div className="space-y-2">
            <div className="flex h-3 rounded overflow-hidden" style={{ gap: 2 }}>
                {parts.map((p, i) => (
                    <div key={p.label}
                         title={`${p.label}: ${format(p.value)}`}
                         style={{
                             width: `${(Math.abs(p.value) / total) * 100}%`,
                             backgroundColor: p.color || ct.categorical[i % ct.categorical.length],
                         }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {parts.map((p, i) => (
                    <span key={p.label} className="inline-flex items-center gap-1.5 text-2xs text-fg-4">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color || ct.categorical[i % ct.categorical.length] }} />
                        {p.label}
                        <span className="tabular-nums text-fg-3">{format(p.value)}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// ── Findings list — ranked, actionable, icon + label ─────────────────────────

export function Findings({ findings = [], emptyText = 'No issues detected in this window.' }) {
    if (!findings.length) {
        return (
            <div className="flex items-center gap-2 text-xs text-fg-4 py-2">
                <StatusBadge level="good">Clean</StatusBadge>
                <span>{emptyText}</span>
            </div>
        );
    }
    const level = (s) => (s === 'critical' ? 'critical' : s === 'warning' ? 'warning' : 'info');
    return (
        <ul className="space-y-2">
            {findings.map((f, i) => (
                <li key={f.code + i} className="flex gap-2.5 items-start">
                    <span className="mt-0.5 flex-shrink-0">
                        <StatusBadge level={level(f.severity)}>
                            {f.severity === 'critical' ? 'Critical' : f.severity === 'warning' ? 'Warning' : 'Note'}
                        </StatusBadge>
                    </span>
                    <div className="min-w-0">
                        <p className="text-xs text-fg-2 leading-snug">{f.message}</p>
                        {f.action && <p className="text-2xs text-fg-5 mt-0.5">→ {f.action}</p>}
                    </div>
                </li>
            ))}
        </ul>
    );
}


// ═════════════════════════════════════════════════════════════════════════════
// PAGE-LEVEL KIT — header, tabs, segmented control, chips, loading, empty,
// modal. Every page used to build these itself: 3 h1 sizes, 2 root paddings, 7
// tab bars (none keyboard-navigable), 5 spinner idioms, 6 modal scrims at 3
// opacities. One implementation each, all on the token layer, so a theme or
// an accessibility axis changes them everywhere at once.
// ═════════════════════════════════════════════════════════════════════════════

// ── Page header ──────────────────────────────────────────────────────────────

/**
 * The top of every page. ONE title scale (text-xl), one subtitle role, badges
 * inline with the title, actions on the right, an optional back link that is a
 * real <Link> (history-based `navigate(-1)` can leave the app entirely).
 *
 * `icon` is a lucide component. It is re-bound to a capitalised local because
 * this repo's ESLint has no jsx-uses-vars: a destructured `icon: Icon` param is
 * invisible to no-unused-vars, and renaming it `_Icon` to silence the rule is
 * exactly what produced two `ReferenceError: Icon is not defined` crashes.
 */
export function PageHeader({ icon, title, subtitle, badges, actions, backTo, backLabel = 'Back', className = '' }) {
    const Icon = icon;
    return (
        <header className={`flex items-start justify-between flex-wrap gap-3 ${className}`}>
            <div className="min-w-0 flex items-start gap-3">
                {backTo && (
                    <Link to={backTo} title={backLabel} aria-label={backLabel}
                        className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-md border border-line-2 bg-card-2 text-fg-4 hover:text-fg flex-shrink-0">
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                    </Link>
                )}
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-fg flex items-center gap-2 flex-wrap leading-tight">
                        {Icon && <Icon className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />}
                        <span className="truncate">{title}</span>
                        {badges}
                    </h1>
                    {subtitle && <p className="text-xs text-fg-5 mt-1 max-w-3xl">{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </header>
    );
}

// ── Tabs — a real tablist ────────────────────────────────────────────────────

/**
 * @param tabs   [{ id, label, icon?, hint?, badge? }]
 * @param value  the active id
 * Arrow keys move between tabs (roving tabindex), Home/End jump to the ends —
 * the WAI-ARIA tabs pattern. None of the seven hand-rolled bars this replaces
 * could be operated from the keyboard.
 */
export function Tabs({ tabs = [], value, onChange, size = 'md', ariaLabel = 'Sections', className = '' }) {
    const pad = size === 'sm' ? 'px-2.5 py-1 text-2xs' : 'px-3.5 py-2 text-xs';
    const onKey = (e, i) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 };
        if (!(e.key in keys) || !tabs.length) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + keys[e.key] + tabs.length) % tabs.length;
        onChange?.(tabs[next].id);
        const el = e.currentTarget.parentElement?.querySelectorAll('[role="tab"]')?.[next];
        if (el) el.focus();
    };
    return (
        <div role="tablist" aria-label={ariaLabel} className={`flex flex-wrap gap-1 border-b border-line-0 ${className}`}>
            {tabs.map((t, i) => {
                const Icon = t.icon;
                const on = t.id === value;
                return (
                    <button key={t.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} title={t.hint}
                        onClick={() => onChange?.(t.id)} onKeyDown={(e) => onKey(e, i)}
                        className={`${pad} -mb-px inline-flex items-center gap-1.5 rounded-t border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on
                            ? 'border-primary text-primary-ink bg-primary/10'
                            : 'border-transparent text-fg-5 hover:text-fg-3 hover:bg-card-2'}`}>
                        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                        {t.label}
                        {t.badge}
                    </button>
                );
            })}
        </div>
    );
}

// ── Segmented control — one of N, always visible ─────────────────────────────

/**
 * @param options [{ v, label, icon?, hint? }]
 * `aria-pressed` carries the state for assistive tech; the tint only echoes it.
 */
export function Segmented({ options = [], value, onChange, size = 'sm', className = '' }) {
    const pad = size === 'sm' ? 'px-2.5 py-1 text-2xs' : 'px-3 py-1.5 text-xs';
    return (
        <div className={`inline-flex rounded-md border border-line-2 overflow-hidden ${className}`} role="group">
            {options.map((o) => {
                const Icon = o.icon;
                const on = value === o.v;
                return (
                    <button key={String(o.v)} type="button" onClick={() => onChange?.(o.v)} aria-pressed={on} title={o.hint}
                        className={`${pad} inline-flex items-center gap-1.5 border-r border-line-2 last:border-r-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${on
                            ? 'bg-primary/15 text-primary-ink'
                            : 'bg-card-2 text-fg-5 hover:text-fg-3'}`}>
                        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

// ── Chip — a small categorical token (symbol, mode, timeframe) ───────────────

const CHIP_TONES = {
    neutral: 'bg-card-2 text-fg-4 border-line-0',
    muted: 'bg-card-2 text-fg-5 border-line-0',
    live: 'bg-primary/15 text-primary-ink border-primary/30',
    paper: 'bg-card-2 text-fg-3 border-line',
    good: 'bg-success/10 text-success border-success/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
    critical: 'bg-danger/10 text-danger border-danger/30',
    info: 'bg-info/15 text-info border-info/30',
};
/** Unlike StatusBadge (which carries an icon and means "a state"), a Chip is a
 *  label: what symbol, which mode, which timeframe. */
export function Chip({ children, tone = 'neutral', title, className = '' }) {
    return (
        <span title={title} className={`inline-flex items-center px-1.5 py-px rounded border text-3xs font-medium whitespace-nowrap ${CHIP_TONES[tone] || CHIP_TONES.neutral} ${className}`}>
            {children}
        </span>
    );
}
/** LIVE / PAPER as a chip, the one place the mapping lives. */
export function ModeChip({ mode, title }) {
    const m = String(mode || '').toUpperCase();
    if (!m) return null;
    return <Chip tone={m === 'LIVE' ? 'live' : 'paper'} title={title || (m === 'LIVE' ? 'Real orders at the broker' : 'Simulated fills')}>{m}</Chip>;
}

// ── Loading ──────────────────────────────────────────────────────────────────

const SPINNER_SIZE = { xs: 'w-3 h-3', sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
/** The app's one spinner. `role="status"` so the wait is announced; the label is
 *  visible by default because a bare ring says nothing about what is loading. */
export function Spinner({ size = 'sm', label = 'Loading…', showLabel = true, className = '' }) {
    return (
        <span role="status" aria-live="polite" className={`inline-flex items-center gap-2 text-xs text-fg-5 ${className}`}>
            <Loader2 className={`${SPINNER_SIZE[size] || SPINNER_SIZE.sm} animate-spin motion-reduce:animate-none flex-shrink-0`} aria-hidden="true" />
            {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
        </span>
    );
}

const SKELETON_WIDTHS = ['w-11/12', 'w-4/5', 'w-full', 'w-2/3', 'w-5/6', 'w-3/4'];
/** Text-shaped placeholder rows. Deterministic widths (no Math.random in
 *  render), pulse honours the reduce-motion axis. */
export function Skeleton({ lines = 3, className = '' }) {
    return (
        <div className={`space-y-2 ${className}`} aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => (
                <div key={i} className={`h-3 rounded bg-card-2 animate-pulse motion-reduce:animate-none ${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}`} />
            ))}
        </div>
    );
}
/** Tile-shaped placeholders in the same grid StatRow uses, so a KPI strip keeps
 *  its height while it loads and the page does not jump when the numbers land. */
export function SkeletonTiles({ count = 4, cols = 4 }) {
    return (
        <StatRow cols={cols}>
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="bg-surface border border-line/60 rounded-lg px-4 py-3 flex flex-col gap-2" aria-hidden="true">
                    <div className="h-2.5 w-1/2 rounded bg-card-2 animate-pulse motion-reduce:animate-none" />
                    <div className="h-6 w-2/3 rounded bg-card-2 animate-pulse motion-reduce:animate-none" />
                    <div className="h-2 w-3/4 rounded bg-card-2 animate-pulse motion-reduce:animate-none" />
                </div>
            ))}
        </StatRow>
    );
}

// ── Empty state — what is missing, and what to do about it ───────────────────

export function EmptyState({ icon, title, children, action, className = '' }) {
    const Icon = icon;
    return (
        <div className={`flex flex-col items-center justify-center text-center gap-2 py-10 px-4 ${className}`}>
            {Icon && <Icon className="w-7 h-7 text-fg-6" aria-hidden="true" />}
            {title && <p className="text-sm font-medium text-fg-3">{title}</p>}
            {children && <p className="text-xs text-fg-5 max-w-md">{children}</p>}
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}

// ── Modal ────────────────────────────────────────────────────────────────────

/**
 * One scrim (black/60), one z-index, Escape closes, click-outside closes, the
 * dialog is labelled. Replaces six overlays at three opacities where only one
 * wired the Escape key.
 */
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
            <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
                className={`w-full ${width} bg-surface border border-line rounded-lg shadow-2xl max-h-[90vh] flex flex-col`}>
                {(title || onClose) && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line-0">
                        <h2 className="text-sm font-semibold text-fg">{title}</h2>
                        {onClose && (
                            <button type="button" onClick={onClose} aria-label="Close" className="text-fg-5 hover:text-fg p-1 rounded">
                                <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                        )}
                    </div>
                )}
                <div className="px-4 py-3 overflow-auto">{children}</div>
                {footer && <div className="px-4 py-3 border-t border-line-0 flex items-center justify-end gap-2">{footer}</div>}
            </div>
        </div>
    );
}

// ── Empty / loading ──────────────────────────────────────────────────────────

export function Placeholder({ children }) {
    return <div className="text-center text-xs text-fg-5 py-8">{children}</div>;
}
