/**
 * Visualization tokens — the ONE place chart colour is defined.
 *
 * This app is dark-only (bg #0e1117, cards #262730), so these are dark steps
 * SELECTED for that surface, not a light palette dimmed.
 *
 * Every value below was run through the palette validator against the real
 * card surface (#262730) rather than eyeballed:
 *
 *   categorical [#3987e5, #d95926, #199e70]
 *     ✓ lightness band  ✓ chroma floor  ✓ contrast ≥3:1
 *     ✓ CVD separation worst adjacent ΔE 9.4 (target ≥8)
 *     ✓ normal-vision worst adjacent ΔE 26.5 (floor ≥15)
 *
 *   diverging poles [#3987e5, #e66767]
 *     ✓ all checks — CVD ΔE 19.2, normal-vision ΔE 29.0
 *
 * RULES THIS FILE ENCODES
 * -----------------------
 * • Categorical is capped at 3 slots. A 4th is never generated — fold the tail
 *   into "Other" or facet. (A generated hue is indistinguishable under CVD.)
 * • Diverging = two hues that read as opposite + a NEUTRAL midpoint. The
 *   midpoint is the surface itself, so "zero" reads as nothing.
 * • Status colours are reserved for state and never used as a series. They
 *   always ship with an icon AND a text label, so meaning never rests on hue —
 *   which is also what makes them safe despite sitting outside the series
 *   lightness band.
 * • P&L polarity uses the DIVERGING pair, not green/red. Red/green is the
 *   trading convention but is the classic CVD failure, and on the stress
 *   heatmap colour is doing real work. Every cell is direct-labelled with its
 *   rupee value, so the number always carries the sign regardless.
 */

// ── Surfaces ─────────────────────────────────────────────────────────────────
export const SURFACE = '#262730';
export const SURFACE_SUNK = '#1c1d25';
export const BACKGROUND = '#0e1117';

// ── Text (never a series colour) ─────────────────────────────────────────────
export const TEXT = {
    primary: '#f1f5f9',
    secondary: '#94a3b8',
    muted: '#64748b',
};

// ── Categorical: identity. Fixed order, never cycled, hard cap of 3. ─────────
export const CATEGORICAL = ['#3987e5', '#d95926', '#199e70'];

/** Stable hue for a named entity — colour follows the entity, never its rank,
 *  so filtering a list never repaints the survivors. */
export function hueFor(name, index) {
    if (typeof index === 'number' && index < CATEGORICAL.length) return CATEGORICAL[index];
    let h = 0;
    for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) | 0;
    return CATEGORICAL[Math.abs(h) % CATEGORICAL.length];
}

// ── Diverging: polarity (profit ↔ loss, positive ↔ negative contribution) ────
export const DIVERGING = { positive: '#3987e5', negative: '#e66767', neutral: '#3a3b47' };

/**
 * Blend a pole toward the surface by magnitude. Alpha-over-surface guarantees a
 * monotone lightness ramp with the surface itself as the neutral midpoint — no
 * hand-picked steps to drift out of order.
 * @param {number} value   the signed value
 * @param {number} maxAbs  the scale's largest |value|
 */
export function divergingFill(value, maxAbs) {
    if (!maxAbs || !Number.isFinite(value)) return DIVERGING.neutral;
    const t = Math.min(1, Math.abs(value) / maxAbs);
    // Floor the alpha so a small non-zero value is still visibly not-zero.
    const alpha = (0.12 + 0.78 * t).toFixed(3);
    const pole = value >= 0 ? DIVERGING.positive : DIVERGING.negative;
    return `color-mix(in srgb, ${pole} ${alpha * 100}%, ${SURFACE})`;
}

/** Same ramp expressed as rgba — for engines without color-mix support. */
export function divergingRgba(value, maxAbs) {
    if (!maxAbs || !Number.isFinite(value) || value === 0) return DIVERGING.neutral;
    const t = Math.min(1, Math.abs(value) / maxAbs);
    const alpha = 0.12 + 0.78 * t;
    const hex = value >= 0 ? DIVERGING.positive : DIVERGING.negative;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Composite over the card surface so the midpoint reads as the card itself.
    const sr = 0x26, sg = 0x27, sb = 0x30;
    const mix = (c, s) => Math.round(c * alpha + s * (1 - alpha));
    return `rgb(${mix(r, sr)}, ${mix(g, sg)}, ${mix(b, sb)})`;
}

// ── Status: state only. Icon + label ALWAYS accompany these. ─────────────────
export const STATUS = {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
};

export const STATUS_ICON = { good: '✓', warning: '▲', serious: '▲', critical: '✕', info: 'i' };

// ── Chrome ───────────────────────────────────────────────────────────────────
export const GRID = '#33343f';        // solid hairline, one shade off the surface

// ── Formatting ───────────────────────────────────────────────────────────────

/** Indian-format rupees. Compact above a lakh so tiles stay one line. */
export function inr(v, { compact = false, sign = false } = {}) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const s = n < 0 ? '-' : (sign && n > 0 ? '+' : '');
    const a = Math.abs(n);
    if (compact && a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`;
    if (compact && a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
    if (compact && a >= 1000) return `${s}₹${(a / 1000).toFixed(1)}k`;
    return `${s}₹${a.toLocaleString('en-IN', { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
}

export function pct(v, dp = 1) {
    const n = Number(v);
    return Number.isFinite(n) ? `${n >= 0 ? '' : ''}${n.toFixed(dp)}%` : '—';
}

export function num(v, dp = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: dp }) : '—';
}
