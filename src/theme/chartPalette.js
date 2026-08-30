'use strict';
/**
 * chartPalette.js — the chart-side view of a theme. PURE. ZERO React, ZERO DOM.
 *
 * WHY IT IS SPLIT FROM chartTheme.js
 * This file used to be the top of chartTheme.js, which also exports the
 * `useChartTheme()` hook and therefore imports React and ThemeContext. That made
 * the whole chart palette unreachable from `node` — so the only automated check
 * on chart colour was a scratch script that RE-DERIVED this logic from ramp.js,
 * i.e. a second implementation validating itself. Splitting the pure half out
 * lets `scripts/validate-themes.mjs` gate the real `buildChartTheme` across all
 * 12 themes; `chartTheme.js` re-exports everything here, so no call site moved.
 *
 * Same rule as ramp.js / themes.js / prefs.js: one `import React` and the gate
 * dies. Keep it pure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * chartTheme — the chart-side view of the active theme.
 *
 * WHY THIS FILE EXISTS AT ALL
 * Every other surface in this app retheme for free: Tailwind v4 emits var-based
 * utilities, so redefining `--color-*` repaints 5,130 call sites with no JSX
 * edits. Charts are the one place that does NOT work. Recharts writes colours
 * into SVG *attributes* (`stroke`, `fill`) and interpolates them for animations,
 * and `contentStyle`/`tick` are plain JS objects — an unresolved `var(--x)`
 * either renders black or silently drops the mark. So charts need CONCRETE hex
 * strings, handed to them at render time, and they need to re-render when the
 * theme changes. That is this module's entire job.
 *
 * WHY buildPalette AND NOT getComputedStyle
 * The obvious implementation reads the applied CSS variables back off <html>.
 * It is worse in three ways that matter here:
 *   1. it is a layout-flushing read, once per token, per chart, per render;
 *   2. it is a frame LATE — the <style> write and the React re-render land in
 *      the same commit, so the first paint after a theme switch would read the
 *      OLD variables and every chart would lag one theme behind;
 *   3. it cannot run at all where there is no DOM (tests, a Node probe).
 * Recomputing from the theme DATA is cheap (memoised, cached per theme+contrast)
 * and is by construction the same value the stylesheet will carry, because both
 * go through `resolvePalette` — ramp, then pins, then the contrast axis.
 *
 * ROLES, NOT HUES
 * The returned object is a ROLE table. A chart asks for `grid`, `axis`,
 * `text.secondary`, `diverging.negative` or `mark.live` — never for "violet".
 * That is what makes 12 themes (including two that rotate blue out of the
 * palette entirely, and two high-contrast ones) work without a single chart
 * knowing they exist.
 *
 * The shape is deliberately the shape `components/viz/tokens.js` already
 * exported, so that file's validated palette rationale carries over unchanged
 * and its call sites move from a module constant to a hook without rewriting.
 */
import { contrastRatio, hexToOklch, oklchToHex, resolvePalette } from './ramp.js';
import { DEFAULT_THEME_ID, getTheme } from './themes.js';

// ─────────────────────────────────────────────────────────────────────────────
// Colour helpers
// ─────────────────────────────────────────────────────────────────────────────
// Small and local on purpose. ramp.js owns the OKLCH <-> sRGB maths; everything
// below is composition and parsing, which ramp.js has no business knowing about
// because its validator only ever deals in `#rrggbb`.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * `#rgb` / `#rrggbb` / `rgb(r, g, b)` -> `[r, g, b]` in 0..255.
 *
 * `rgb()` is accepted because `divergingRgba()` returns that form (it predates
 * this module and its callers assign it straight to a CSS property), and `ink()`
 * has to be able to measure the fill it is choosing ink for.
 */
function parseColor(input) {
    const s = String(input || '').trim();
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (fn) return [1, 2, 3].map((i) => clamp01(Number(fn[i]) / 255) * 255);
    let h = s.replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * Any resolved colour -> `#rrggbb`.
 *
 * MANDATORY before handing a colour to ramp.js. Its `relativeLuminance` (and so
 * `contrastRatio`) parses HEX ONLY — an `rgb(...)` string fails its regex and
 * comes back as luminance 0, i.e. measured as pure black. `divergingRgba()`
 * returns exactly that form, so `ink()` measuring its own fill without this
 * silently judged every heatmap cell to be black: correct by accident on the
 * dark themes, and on the light ones it flipped EVERY cell (including the
 * near-white low-magnitude ones) to pale ink.
 *
 * Only resolved colours can be normalised. A `color-mix()` string cannot be
 * measured without a layout engine, which is why `divergingFill()` (the
 * `color-mix` variant) must not be fed to `ink()` — use `divergingRgba()`.
 */
function asHex(color) {
    const s = String(color || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : toHex(parseColor(s));
}

/** Signed shortest arc between two hues, so amber -> red goes through orange. */
function shortArc(from, to) {
    return ((to - from + 540) % 360) - 180;
}

/**
 * Blend two colours in OKLCH at `t` (0 = a, 1 = b).
 *
 * OKLCH rather than sRGB because both callers care about a PERCEPTUAL midpoint:
 * `status.serious` must read as genuinely between warning and critical, and
 * `gridSoft` must be a visibly lighter-weight version of the same hairline
 * rather than a muddy average. An sRGB midpoint of amber and red is a brown.
 */
function mixOklch(a, b, t) {
    const A = hexToOklch(a);
    const B = hexToOklch(b);
    return oklchToHex(
        A.L + (B.L - A.L) * t,
        A.C + (B.C - A.C) * t,
        A.H + shortArc(A.H, B.H) * t,
    );
}

/** Same hue and chroma, lightness moved by `dL`. Used to sink a surface. */
function shiftL(hex, dL) {
    const { L, C, H } = hexToOklch(hex);
    return oklchToHex(clamp01(L + dL), C, H);
}

/**
 * The minimum contrast at which the theme's own ink is allowed to stay on a
 * data fill. Below it, `ink()` flips to the opposite extreme.
 *
 * 3.0 rather than 4.5 because this decision only ever applies to heatmap cells,
 * whose text is short tabular numerals over a fill the reader can also decode
 * from position and from the scale legend. Raising it to 4.5 would flip
 * midnight's mid-magnitude cells to black ink for no legibility gain — the
 * measured contrast of fg-2 on midnight's strongest cell is 3.9:1.
 */
const INK_FLIP_AT = 3.0;

// ─────────────────────────────────────────────────────────────────────────────
// The role table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache keyed on theme id + contrast level. Every chart on the page calls
 * `useChartTheme()` independently, and `resolvePalette` walks ~230 OKLCH
 * conversions; without this a theme switch on the Risk page would rebuild the
 * same palette a dozen times in one commit. Safe because `THEMES` is static
 * data and a palette is a pure function of (id, contrast).
 */
const CACHE = new Map();

/**
 * buildChartTheme(themeSpec, contrastLevel) -> role table
 *
 * Pure. Exported so a non-component module (and `viz/tokens.js`, which must
 * keep serving bare constants) can resolve a chart palette without a React
 * tree. `useChartTheme()` is the thin hook on top.
 */
export function buildChartTheme(themeSpec, contrastLevel = 'normal') {
    const spec = themeSpec && typeof themeSpec === 'object' && themeSpec.id
        ? themeSpec
        : getTheme(DEFAULT_THEME_ID);
    const mode = spec.mode === 'light' ? 'light' : 'dark';
    const level = typeof contrastLevel === 'string' ? contrastLevel : 'normal';
    const key = `${spec.id}|${level}`;

    const cached = CACHE.get(key);
    if (cached) return cached;

    const p = resolvePalette(spec, level);

    /**
     * Escape hatch: one accent family + shade straight off the ramp. Use a ROLE
     * below wherever one fits — a call site that reaches for `hue()` is saying
     * "this mark has no role yet", which is a thing to fix, not a pattern.
     */
    const hue = (family, shade) => p[`--color-${family}-${shade}`] || p['--color-fg-4'];

    // ── Surfaces ────────────────────────────────────────────────────────────
    const surface = p['--color-card'];
    // A well INSIDE the card (a meter track). Derived rather than read off the
    // ramp because shade 800 is the card role itself: on a light theme the card
    // is pure white, so `slate-800` is white too and a track cut from it would
    // be invisible. Stepping down from whatever `card` actually resolved to
    // works in both modes and survives a theme that pins its card.
    const surfaceSunk = shiftL(surface, mode === 'dark' ? -0.045 : -0.030);
    const background = p['--color-bg'];

    // ── Ink ─────────────────────────────────────────────────────────────────
    // The fg levels, not the neutral ramp: they are the purpose-built ink scale
    // AND they are what the `contrast` accessibility axis moves. Reading
    // `slate-100` here would give a chart text that ignores "Contrast: Max".
    const text = {
        primary: p['--color-fg-2'],
        secondary: p['--color-fg-4'],
        muted: p['--color-fg-5'],
    };

    // ── Chrome ──────────────────────────────────────────────────────────────
    const grid = p['--chart-grid'];
    // Minor graticule. Half-weight version of the same hairline, blended toward
    // the card it sits on. Two weights exist because a dense payoff chart with
    // strike rules, sigma bands and three curves needs its background grid to
    // recede, while a single equity line wants a grid you can actually read a
    // value off.
    const gridSoft = mixOklch(grid, surface, 0.5);
    const axis = p['--chart-axis'];
    const tooltip = {
        background: p['--chart-tooltip-bg'],
        border: p['--chart-tooltip-border'],
        text: p['--color-fg-2'],
    };

    // ── Series ──────────────────────────────────────────────────────────────
    // Three categorical slots and a diverging pair, straight from the theme's
    // chart anchors. See CHART_ANCHORS in ramp.js for why these are rotated
    // rather than regenerated, and viz/tokens.js for the CVD/contrast gates the
    // trio was measured against.
    const categorical = [p['--chart-1'], p['--chart-2'], p['--chart-3']];
    const diverging = {
        positive: p['--chart-pos'],
        negative: p['--chart-neg'],
        // NOT `--chart-neutral` (which is fg-5, an INK tone). The diverging
        // midpoint is a FILL, and the whole point of the ramp is that zero reads
        // as the card itself — an ink-bright midpoint would make every zero cell
        // glow. `card-2` is the card, one elevation step off, in every theme.
        neutral: p['--color-card-2'],
    };

    // ── Status ──────────────────────────────────────────────────────────────
    // From the theme's own semantic tokens, so a theme that pins its danger
    // colour is obeyed. `serious` has no token of its own and is defined as the
    // perceptual midpoint of warning and critical — which is exactly its
    // meaning, and guarantees it can never land outside that pair.
    const status = {
        good: p['--color-success'],
        warning: p['--color-warning'],
        serious: mixOklch(p['--color-warning'], p['--color-danger'], 0.5),
        critical: p['--color-danger'],
    };

    // ── Named marks ─────────────────────────────────────────────────────────
    // Annotation roles: overlays and reference marks that are NOT a series and
    // NOT a polarity, so neither `categorical` nor `diverging` is the honest
    // answer. Each is one accent family at one ink shade, which means the
    // eyecare themes rotate them out of the blue band and the high-contrast
    // themes brighten them without any chart being told.
    const mark = {
        /** "Right now": the spot cursor, the live curve, an open position, the hover crosshair, a drag selection. */
        live: hue('sky', 400),
        /** Value AT EXPIRY — the contract's terminal payoff, the one curve that is not a forecast. */
        terminal: hue('emerald', 400),
        /** A modelled future state (next session's open), i.e. neither now nor expiry. */
        projection: hue('purple', 400),
        /** A what-if the user is steering. Must be unmistakable against `live`, since the two are read side by side. */
        hypothetical: hue('fuchsia', 400),
        /** An expected-move / sigma REGION fill. */
        region: hue('violet', 500),
        /**
         * That region's boundary rules and their labels — exactly ONE ink step
         * lighter than the fill, which is the relationship the payoff chart was
         * drawn with (band #8b5cf6 = violet-500, rules #a78bfa = violet-400).
         * The rules render at strokeOpacity 0.5 but their labels do not, so
         * going two steps lighter would leave the labels floating brighter than
         * the σ band they annotate.
         */
        regionEdge: hue('violet', 400),
        /** A cumulative-P&L path whose SIGN is carried by its per-point dots, so the line itself must not be a polarity hue. */
        equity: hue('violet', 400),
    };

    // ── Derived accessors ───────────────────────────────────────────────────

    /** `rgba()` at an explicit alpha. Beats `${hex}1f`, which assumes 6-digit hex. */
    const alpha = (color, a) => {
        const [r, g, b] = parseColor(color);
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp01(a)})`;
    };

    /**
     * Legible ink for an arbitrary data fill.
     *
     * Needed because the diverging ramp composites a saturated pole over the
     * card: on a DARK theme that lands mid-dark and the theme's light ink is
     * right, but on a light theme it lands mid-dark too — while the theme's ink
     * is near-black. Measured on `daylight`: fg-2 on a full-magnitude negative
     * cell is 2.8:1, white is 5.4:1. Without this, every light theme ships an
     * unreadable stress heatmap.
     */
    const ink = (fill) => {
        // Normalise FIRST — see asHex(). Measuring the raw `rgb()` string that
        // divergingRgba() returns reads as black and inverts the decision.
        const f = asHex(fill);
        if (contrastRatio(f, text.primary) >= INK_FLIP_AT) return text.primary;
        return contrastRatio(f, p['--color-fg']) >= contrastRatio(f, p['--color-bg-2'])
            ? p['--color-fg']
            : p['--color-bg-2'];
    };

    /**
     * Stable categorical slot for a named entity — colour follows the entity,
     * never its rank, so filtering a list never repaints the survivors. Same
     * hash as `viz/tokens.js` `hueFor`, resolved against the ACTIVE theme.
     */
    const hueFor = (name, index) => {
        if (typeof index === 'number' && index >= 0 && index < categorical.length) return categorical[index];
        let h = 0;
        const s = String(name);
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return categorical[Math.abs(h) % categorical.length];
    };

    // Alpha ramp shared by both diverging helpers. Floored at 0.12 so a small
    // non-zero value is still visibly not-zero, and capped below 1 so the pole
    // never fully replaces the surface.
    const rampAlpha = (value, maxAbs) => 0.12 + 0.78 * Math.min(1, Math.abs(value) / maxAbs);

    /**
     * Blend a pole toward the surface by magnitude, as a `color-mix()` string.
     * Alpha-over-surface guarantees a monotone lightness ramp with the surface
     * itself as the neutral midpoint — no hand-picked steps to drift out of
     * order when the theme changes.
     */
    const divergingFill = (value, maxAbs) => {
        if (!maxAbs || !Number.isFinite(value)) return diverging.neutral;
        const a = rampAlpha(value, maxAbs);
        const pole = value >= 0 ? diverging.positive : diverging.negative;
        return `color-mix(in srgb, ${pole} ${(a * 100).toFixed(1)}%, ${surface})`;
    };

    /** The same ramp composited by hand — for engines without `color-mix()`. */
    const divergingRgba = (value, maxAbs) => {
        if (!maxAbs || !Number.isFinite(value) || value === 0) return diverging.neutral;
        const a = rampAlpha(value, maxAbs);
        const pole = parseColor(value >= 0 ? diverging.positive : diverging.negative);
        const base = parseColor(surface);
        const mix = pole.map((c, i) => Math.round(c * a + base[i] * (1 - a)));
        return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    };

    const built = Object.freeze({
        id: spec.id,
        mode,
        surface,
        surfaceSunk,
        background,
        text: Object.freeze(text),
        categorical: Object.freeze(categorical),
        diverging: Object.freeze(diverging),
        status: Object.freeze(status),
        grid,
        gridSoft,
        axis,
        tooltip: Object.freeze(tooltip),
        mark: Object.freeze(mark),
        hue,
        hueFor,
        alpha,
        ink,
        divergingFill,
        divergingRgba,
        /** Ready-made recharts `<Tooltip contentStyle>`; `extra` merges typography in. */
        tooltipStyle: (extra) => ({
            background: tooltip.background,
            border: `1px solid ${tooltip.border}`,
            color: tooltip.text,
            borderRadius: 6,
            ...extra,
        }),
    });

    CACHE.set(key, built);
    return built;
}

/** The default palette, for module scope and for a consumer with no provider. */
export const MIDNIGHT_CHART_THEME = buildChartTheme(getTheme(DEFAULT_THEME_ID), 'normal');
