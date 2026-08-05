import React, { useState } from 'react';
import {
    SURFACE, SURFACE_SUNK, TEXT, GRID, CATEGORICAL, DIVERGING, STATUS, STATUS_ICON,
    divergingRgba, inr,
} from './tokens';

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
 */

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ title, subtitle, right, children, className = '' }) {
    return (
        <div className={`bg-surface border border-slate-700/60 rounded-lg ${className}`}>
            {(title || right) && (
                <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
                    <div className="min-w-0">
                        {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
                        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
                    </div>
                    {right && <div className="flex-shrink-0 text-xs text-slate-400">{right}</div>}
                </div>
            )}
            <div className="px-4 pb-4">{children}</div>
        </div>
    );
}

// ── Status badge — icon + label, never colour alone ──────────────────────────

export function StatusBadge({ level = 'info', children, title }) {
    const color = STATUS[level] || TEXT.secondary;
    return (
        <span
            title={title}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap"
            style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}55` }}
        >
            <span aria-hidden="true">{STATUS_ICON[level] || STATUS_ICON.info}</span>
            <span>{children}</span>
        </span>
    );
}

// ── Stat tile — the right form for a single current value ────────────────────

export function StatTile({ label, value, hint, tone = 'neutral', badge, hero = false }) {
    // Tone tints the VALUE text only. The sign is in the number itself, so the
    // colour is reinforcement, never the sole carrier.
    const toneColor = tone === 'positive' ? DIVERGING.positive
        : tone === 'negative' ? DIVERGING.negative
        : TEXT.primary;
    return (
        <div className="bg-surface border border-slate-700/60 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-slate-500 truncate">{label}</span>
                {badge}
            </div>
            <span
                className={`font-semibold tabular-nums truncate ${hero ? 'text-3xl' : 'text-xl'}`}
                style={{ color: toneColor }}
                title={String(value)}
            >
                {value}
            </span>
            {hint && <span className="text-[11px] text-slate-500 truncate" title={hint}>{hint}</span>}
        </div>
    );
}

export function StatRow({ children, cols = 4 }) {
    const gridCols = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }[cols] || 'md:grid-cols-4';
    return <div className={`grid grid-cols-2 ${gridCols} gap-3`}>{children}</div>;
}

// ── Meter — one ratio against a limit (not a 2-slice pie) ────────────────────

export function Meter({ value, max = 1, label, caption, tone = 'neutral' }) {
    const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const fill = tone === 'critical' ? STATUS.critical
        : tone === 'warning' ? STATUS.warning
        : CATEGORICAL[0];
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-slate-400">{label}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-100">
                    {(t * 100).toFixed(0)}%
                </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: SURFACE_SUNK }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${t * 100}%`, backgroundColor: fill }} />
            </div>
            {caption && <p className="text-[11px] text-slate-500">{caption}</p>}
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
    const [hover, setHover] = useState(null);
    if (!data.length) return <p className="text-xs text-slate-500 py-4 text-center">{emptyText}</p>;

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
                        <span className="text-[11px] text-slate-300 truncate flex-shrink-0"
                              style={{ width: labelWidth }} title={d.label}>
                            {d.label}
                        </span>
                        <div className="relative flex-1 h-full min-w-0">
                            {/* zero rule — solid hairline, one shade off the surface */}
                            <div className="absolute inset-y-0 left-1/2 w-px" style={{ backgroundColor: GRID }} />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-3"
                                style={{
                                    left: positive ? '50%' : `${50 - w}%`,
                                    width: `${w}%`,
                                    backgroundColor: positive ? DIVERGING.positive : DIVERGING.negative,
                                    // 4px rounded data-end, square against the baseline
                                    borderRadius: positive ? '0 4px 4px 0' : '4px 0 0 4px',
                                    opacity: hover === null || hover === i ? 1 : 0.45,
                                }}
                            />
                            {hover === i && d.hint && (
                                <div className="absolute z-20 left-1/2 -translate-x-1/2 -top-1 -translate-y-full px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none border border-slate-600"
                                     style={{ backgroundColor: BACKGROUND_TOOLTIP }}>
                                    {d.hint}
                                </div>
                            )}
                        </div>
                        <span className="text-[11px] tabular-nums text-slate-400 flex-shrink-0 text-right"
                              style={{ width: valueWidth }}>
                            {format(v)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

const BACKGROUND_TOOLTIP = '#111318';

// ── Waterfall — how components sum to a total ────────────────────────────────

/**
 * @param {Array} steps [{ label, value }] contributions
 * @param {object} total { label, value }
 */
export function Waterfall({ steps = [], total, format = (v) => inr(v, { compact: true, sign: true }) }) {
    const [hover, setHover] = useState(null);
    if (!steps.length) return <p className="text-xs text-slate-500 py-4 text-center">No attribution available</p>;

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
                const color = positive ? DIVERGING.positive : DIVERGING.negative;
                return (
                    <div key={b.label + i}
                         className={`flex items-center gap-2 ${b.isTotal ? 'mt-2 pt-2 border-t border-slate-700' : ''}`}
                         style={{ height: 24 }}
                         onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                        <span className={`text-[11px] truncate flex-shrink-0 ${b.isTotal ? 'font-semibold text-slate-100' : 'text-slate-300'}`}
                              style={{ width: LABEL_W }} title={b.label}>
                            {b.label}
                        </span>
                        <div className="relative flex-1 h-full min-w-0">
                            <div className="absolute inset-y-0 w-px" style={{ left: `${x(0)}%`, backgroundColor: GRID }} />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-3.5 rounded-[3px]"
                                style={{
                                    left: `${left}%`, width: `${width}%`,
                                    backgroundColor: color,
                                    opacity: b.isTotal ? 1 : (hover === null || hover === i ? 0.9 : 0.4),
                                    // 2px surface ring keeps adjacent fills from merging
                                    boxShadow: `0 0 0 2px ${SURFACE}`,
                                }}
                            />
                        </div>
                        <span className={`text-[11px] tabular-nums flex-shrink-0 text-right ${b.isTotal ? 'font-semibold text-slate-100' : 'text-slate-400'}`}
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
                {colTitle && <div className="text-[11px] text-slate-500 mb-1 text-center">{colTitle}</div>}
                <table className="border-separate" style={{ borderSpacing: 2 }}>
                    <thead>
                        <tr>
                            <th className="text-[10px] text-slate-500 font-normal px-1 text-right whitespace-nowrap">
                                {rowTitle}
                            </th>
                            {cols.map(c => (
                                <th key={c} className="text-[10px] text-slate-400 font-normal px-1 whitespace-nowrap">
                                    {colLabel(c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r}>
                                <td className="text-[10px] text-slate-400 pr-2 text-right whitespace-nowrap tabular-nums">
                                    {rowLabel(r)}
                                </td>
                                {cols.map(c => {
                                    const v = valueAt(r, c);
                                    const key = `${r}|${c}`;
                                    const isHover = hover === key;
                                    return (
                                        <td key={key} className="relative p-0">
                                            <div
                                                className="px-2 py-1.5 rounded text-[11px] tabular-nums text-center whitespace-nowrap cursor-default transition-shadow"
                                                style={{
                                                    backgroundColor: divergingRgba(v, maxAbs),
                                                    color: TEXT.primary,
                                                    minWidth: 62,
                                                    boxShadow: isHover ? `0 0 0 2px ${CATEGORICAL[0]}` : 'none',
                                                }}
                                                onMouseEnter={() => setHover(key)}
                                                onMouseLeave={() => setHover(null)}
                                            >
                                                {/* Every cell is direct-labelled: colour carries magnitude,
                                                    the number carries it too, so CVD never loses the reading. */}
                                                {Number.isFinite(v) ? format(v) : '—'}
                                            </div>
                                            {isHover && cellHint && (
                                                <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none border border-slate-600"
                                                     style={{ backgroundColor: BACKGROUND_TOOLTIP }}>
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
                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
                    <span>{format(-maxAbs)}</span>
                    <div className="flex-1 h-2 rounded" style={{
                        background: `linear-gradient(to right, ${DIVERGING.negative}, ${SURFACE}, ${DIVERGING.positive})`,
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

export function DataTable({ columns, rows, empty = 'No rows', dense = false, maxHeight }) {
    if (!rows || !rows.length) return <p className="text-xs text-slate-500 py-4 text-center">{empty}</p>;
    return (
        <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
            <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ backgroundColor: SURFACE }}>
                    <tr className="text-left text-slate-500">
                        {columns.map(c => (
                            <th key={c.key}
                                className={`font-medium ${dense ? 'py-1' : 'py-1.5'} px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}
                                style={{ borderBottom: `1px solid ${GRID}` }}>
                                {c.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={r._key || i} className="hover:bg-slate-800/40">
                            {columns.map(c => (
                                <td key={c.key}
                                    className={`${dense ? 'py-1' : 'py-1.5'} px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                                    style={{ borderBottom: `1px solid ${GRID}55` }}>
                                    {c.render ? c.render(r) : r[c.key]}
                                </td>
                            ))}
                        </tr>
                    ))}
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
                <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: it.color }} />
                    {it.label}
                </span>
            ))}
        </div>
    );
}

// ── Stacked share bar — part-to-whole for a small number of parts ────────────

export function ShareBar({ parts = [], format = (v) => inr(v, { compact: true }) }) {
    const total = parts.reduce((a, p) => a + Math.abs(Number(p.value) || 0), 0);
    if (!(total > 0)) return <p className="text-xs text-slate-500">Nothing on the book</p>;
    return (
        <div className="space-y-2">
            <div className="flex h-3 rounded overflow-hidden" style={{ gap: 2 }}>
                {parts.map((p, i) => (
                    <div key={p.label}
                         title={`${p.label}: ${format(p.value)}`}
                         style={{
                             width: `${(Math.abs(p.value) / total) * 100}%`,
                             backgroundColor: p.color || CATEGORICAL[i % CATEGORICAL.length],
                         }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {parts.map((p, i) => (
                    <span key={p.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color || CATEGORICAL[i % CATEGORICAL.length] }} />
                        {p.label}
                        <span className="tabular-nums text-slate-300">{format(p.value)}</span>
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
            <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
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
                        <p className="text-xs text-slate-200 leading-snug">{f.message}</p>
                        {f.action && <p className="text-[11px] text-slate-500 mt-0.5">→ {f.action}</p>}
                    </div>
                </li>
            ))}
        </ul>
    );
}

// ── Empty / loading ──────────────────────────────────────────────────────────

export function Placeholder({ children }) {
    return <div className="text-center text-xs text-slate-500 py-8">{children}</div>;
}
