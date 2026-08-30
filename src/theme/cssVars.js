'use strict';
/**
 * cssVars.js — theme spec + prefs -> CSS text. React-free, DOM-free.
 *
 * WHY A STRING AND NOT `element.style.setProperty`
 * Setting ~230 custom properties one at a time on <html> is 230 style
 * recalculations, and inline properties cannot express the `[data-motion]`,
 * `[data-contrast]` and `:focus-visible` rules at all. Emitting one stylesheet
 * and swapping its `textContent` is a single atomic restyle, and it lets the
 * validator diff the exact bytes the browser will see.
 *
 * ── THE CASCADE CONTRACT (the load-bearing detail) ──────────────────────────
 * Every rule here is written under `:root[data-theme="<id>"]` or
 * `:root[data-theme]`, specificity (0,1,1). Tailwind writes its tokens on bare
 * `:root`, specificity (0,1,0). Higher specificity wins REGARDLESS of source
 * order, so this stylesheet does not care whether it is injected before or after
 * Tailwind's — which matters because Vite orders CSS differently in dev and in
 * production. A bare `:root` here would work in dev and break in the build.
 *
 * ── DIVISION OF LABOUR WITH index.css ───────────────────────────────────────
 * `index.css` owns the BUILD-TIME half: the `@theme static` declarations (a
 * Tailwind v4 utility only exists if its token is declared at build time), the
 * dark defaults that paint the first frame, and the pure-CSS axes that never
 * vary per theme (`data-reading`, `data-motion`, `data-underline`, `data-focus`).
 * This file owns the RUNTIME half: the per-theme token VALUES, and the axes that
 * change values rather than rules (contrast, density, textBoost, blueLight).
 *
 * Where an axis has a static rule in index.css, the block below is emitted ONLY
 * when that axis is actually engaged, and states the same declarations. It is
 * deliberately redundant rather than absent: this stylesheet is injected into
 * <head> at runtime, so it is the last word on equal specificity, and an axis
 * that is on must not depend on a build-time file staying in its current shape.
 * In the default state these blocks are not emitted at all.
 */

import {
    HUE_NAMES,
    NEUTRAL_ALIASES,
    SHADES,
    resolvePalette,
} from './ramp.js';
import { coercePrefs, prefOption } from './prefs.js';
import { getTheme, THEMES } from './themes.js';

/** The single <style> element ThemeProvider maintains. Exported so nothing guesses. */
export const STYLE_ELEMENT_ID = 'algobot-theme-vars';

/**
 * Tailwind v4's default type scale, in rem. Transcribed from the built CSS
 * rather than the docs. The matching `--text-*--line-height` tokens are RATIOS
 * (`calc(1.25 / .875)`), so scaling only the size scales the line box with it —
 * which is why textBoost never has to touch line-height.
 */
const TEXT_SCALE = {
    // The four sub-xs steps are OURS, not Tailwind's — see the "Micro type scale"
    // block in index.css. They exist because 668 call sites were sized in px and
    // so were immune to the fontScale axis. They MUST be listed here too: this map
    // is what textBoost enumerates, and a token missing from it would follow the
    // root font-size but silently ignore the boost, which is the exact half-working
    // failure mode this whole exercise has already hit twice.
    '5xs': 0.5, '4xs': 0.5625, '3xs': 0.625, '2xs': 0.6875,
    xs: 0.75, sm: 0.875, base: 1, lg: 1.125, xl: 1.25, '2xl': 1.5, '3xl': 1.875,
    '4xl': 2.25, '5xl': 3, '6xl': 3.75, '7xl': 4.5, '8xl': 6, '9xl': 8,
};

/** Tailwind's `--spacing` root. Every `p-4` / `w-64` is a multiple of this. */
const SPACING_BASE = 0.25;

/**
 * The fontScale axis is applied as a PERCENTAGE of the inherited root font size,
 * never as an absolute pixel value.
 *
 * WHY THIS IS THE WHOLE POINT OF THE AXIS. `font-size: calc(16px * v)` REPLACES
 * the reader's browser font-size preference instead of scaling it. Somebody who
 * has already set their browser default to 20px — i.e. exactly the person this
 * control exists for — got 16px at scale 1, and nudging "Text size" one notch UP
 * to 1.05 gave them 16.8px, still SMALLER than what they had before they touched
 * anything. The axis was an accessibility regression against its own users.
 *
 * A percentage on `:root` resolves against the initial font size (the browser
 * preference), so `100%` is "whatever the reader chose" and `125%` is a quarter
 * more of it. It does NOT compound with rem: `rem` is defined against the root's
 * COMPUTED size, which this declaration produces once — 20px browser default at
 * scale 1.25 gives a 25px root, and `--spacing: .25rem` is 6.25px, scaled exactly
 * once. (An absolute `px` value would be the thing that cannot compose, because
 * it discards the reader's preference rather than multiplying it.)
 *
 * Exported so the three writers that have to agree — this file's fallback rule,
 * ThemeProvider's inline style via rootFontSize(), and the boot script in
 * index.html — share one constant instead of three copies of a number.
 */
export const ROOT_FONT_BASIS = '100%';

/**
 * The warm tint the blueLight overlay multiplies by. Multiply keeps red intact,
 * pulls green down a little and blue down a lot — i.e. it removes short-
 * wavelength emission rather than just dimming, which is the point.
 */
const WARM_OVERLAY_COLOR = '#ffd4a3';

/** z-index for that overlay: above every modal the app has, below nothing. */
export const WARM_OVERLAY_Z = 2147483000;

/** Ids are authored in themes.js, but never trust a string that reaches a selector. */
const safeId = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * …and never trust a string that reaches a COMMENT either.
 *
 * A theme's display name is interpolated into the `/* … *\/` header above its
 * token block. CSS comments do not nest and have no escape sequence, so a name
 * containing the two characters that close one ends the comment early — and the
 * remainder of the name then parses as a selector, swallowing the `:root[data-
 * theme]` rule that follows it. The whole theme, all 283 declarations, silently
 * disappears and the app renders on index.css's dark defaults.
 *
 * The sequence is simply removed rather than escaped, because there is no escape:
 * a comment can only be ended, so the only safe name is one that cannot end it.
 */
const safeComment = (s) => String(s == null ? '' : s).replace(/\*\//g, '');

/** Trim float noise: 0.30000000000000004 -> 0.3 */
const n = (v) => Number(Number(v).toFixed(4));

/**
 * Emission order for the token block. Purely cosmetic — but a deterministic
 * order means two builds of the same theme produce byte-identical CSS, which is
 * what makes "did the palette change?" a diff instead of an investigation.
 */
const SEMANTIC_ORDER = [
    '--color-bg', '--color-bg-2', '--color-card', '--color-card-2',
    '--color-line-0', '--color-line', '--color-line-2', '--color-line-3',
    '--color-fg', '--color-fg-2', '--color-fg-3', '--color-fg-4', '--color-fg-5', '--color-fg-6',
    '--color-primary', '--color-primary-ink', '--color-on-primary', '--color-secondary',
    '--color-success', '--color-danger', '--color-warning', '--color-info',
    '--color-background', '--color-surface',
    '--color-white', '--color-black',
    '--chart-1', '--chart-2', '--chart-3', '--chart-pos', '--chart-neg', '--chart-neutral',
    '--chart-grid', '--chart-axis', '--chart-tooltip-bg', '--chart-tooltip-border',
    '--color-chart-1', '--color-chart-2', '--color-chart-3',
    '--color-chart-pos', '--color-chart-neg', '--color-chart-neutral',
];

function orderedKeys(palette) {
    const seen = new Set();
    const keys = [];
    const push = (k) => {
        if (k in palette && !seen.has(k)) { seen.add(k); keys.push(k); }
    };
    SEMANTIC_ORDER.forEach(push);
    for (const family of NEUTRAL_ALIASES) for (const s of SHADES) push(`--color-${family}-${s}`);
    for (const family of HUE_NAMES) for (const s of SHADES) push(`--color-${family}-${s}`);
    Object.keys(palette).sort().forEach(push);
    return keys;
}

/**
 * The per-theme token block: `:root[data-theme="<id>"] { … }`.
 *
 * `contrastLevel` folds into the VALUES rather than into a separate rule,
 * because there is no CSS operation that can compress a colour toward white —
 * the compression happens in ramp.js and lands here as a different hex.
 */
export function buildThemeVarsCss(themeSpec, contrastLevel = 'normal') {
    const theme = themeSpec || getTheme(undefined);
    const id = safeId(theme.id);
    const palette = resolvePalette(theme, contrastLevel);
    const lines = orderedKeys(palette).map((k) => `    ${k}: ${palette[k]};`);
    return [
        `/* ${safeComment(theme.name) || id} — ${theme.mode} */`,
        `:root[data-theme="${id}"] {`,
        // `color-scheme` is not decoration: it is what makes native scrollbars,
        // form controls, autofill and the canvas behind the page match the
        // theme. Without it a light theme keeps a dark scrollbar gutter.
        `    color-scheme: ${theme.mode === 'light' ? 'light' : 'dark'};`,
        ...lines,
        '}',
    ].join('\n');
}

/**
 * The prefs half. Scoped `:root[data-theme]` (not bare `:root`) for the same
 * specificity reason as the token block — `--spacing` and `--text-*` are
 * Tailwind tokens declared on `:root`, so a bare `:root` here would be a
 * coin-flip decided by stylesheet order.
 */
export function buildPrefsCss(rawPrefs) {
    const prefs = coercePrefs(rawPrefs);
    const out = [];

    const fontOpt = prefOption('font', prefs.font);
    const densityOpt = prefOption('density', prefs.density);
    const radiusOpt = prefOption('radius', prefs.radius);

    const root = [];
    if (fontOpt?.stack) root.push(`    --ui-font-family: ${fontOpt.stack};`);
    root.push(`    --ui-font-scale: ${n(prefs.fontScale)};`);
    root.push(`    --ui-radius-scale: ${n(radiusOpt?.scale ?? 1)};`);
    root.push(`    --ui-blue-light: ${n(prefs.blueLight / 100)};`);
    root.push(`    --ui-blue-light-color: ${WARM_OVERLAY_COLOR};`);

    // `--spacing` belongs to Tailwind, so it is overridden only when the density
    // axis actually differs. Writing `calc(.25rem * 1)` would be numerically
    // identical but would permanently pin the token, and a future change to
    // Tailwind's own base would then silently stop reaching this app.
    const densityScale = n(densityOpt?.scale ?? 1);
    if (densityScale !== 1) {
        root.push(`    --spacing: calc(${SPACING_BASE}rem * ${densityScale});`);
    }

    // fontScale is applied as html{font-size}, which scales type AND the
    // rem-based layout together — real zoom, not just bigger text. It is a
    // PERCENTAGE of the reader's own browser default, not an absolute pixel size;
    // see ROOT_FONT_BASIS for why that distinction is the axis working or not.
    //
    // ThemeProvider ALSO writes this as an inline style, and inline wins. That
    // is intentional and is the contract index.css documents: the boot script in
    // index.html sets the inline value before first paint (zero flash), and the
    // provider keeps it in sync afterwards, so there is exactly one owner at
    // runtime. This rule is the no-JS / stale-inline fallback.
    //
    // At scale 1 NOTHING is emitted, and the provider removes the inline value —
    // `calc(100% * 1)` would be numerically inert but would still pin the
    // property, and leaving it undeclared is the honest way to say "untouched".
    if (n(prefs.fontScale) !== 1) {
        root.push(`    font-size: calc(${ROOT_FONT_BASIS} * ${n(prefs.fontScale)});`);
    }

    out.push('/* appearance axes */', ':root[data-theme] {', ...root, '}');

    // ── textBoost: type without reflow ──────────────────────────────────────
    // Only emitted when engaged. Overriding all 13 tokens with `calc(x * 1)`
    // would be inert but would also permanently pin them, so a future change to
    // Tailwind's scale would silently stop reaching this app.
    if (prefs.textBoost !== 1) {
        const b = n(prefs.textBoost);
        out.push(
            '/* textBoost — scales the type ramp only; --spacing untouched, so nothing reflows */',
            ':root[data-theme] {',
            ...Object.entries(TEXT_SCALE).map(([k, v]) => `    --text-${k}: calc(${v}rem * ${b});`),
            '}',
        );
    }

    // ── readingMode ─────────────────────────────────────────────────────────
    if (prefs.readingMode) {
        out.push(
            '/* readingMode */',
            ':root[data-reading]:not([data-reading="false"]) body {',
            '    line-height: 1.75;',
            '    letter-spacing: 0.01em;',
            '}',
            // The body rule above is INHERITED and loses to Tailwind's text-size
            // utilities, which declare line-height DIRECTLY
            // (`.text-sm{line-height:var(--tw-leading,var(--text-sm--line-height))}`).
            // Setting the variable those utilities already read is the half that
            // actually reaches the app; see index.css for the measurements.
            // Written as ONE selector line so it survives any join separator.
            ':root[data-reading]:not([data-reading="false"]) :where(p, li, dd, dt, td, th, span, div, label, h1, h2, h3, h4, h5, h6) {',
            '    --tw-leading: 1.75;',
            '    line-height: 1.75;',
            '}',
            // Measure cap on PROSE only. Tables, grids and flex rows are
            // deliberately excluded: a max-width on a table cell is how you turn
            // a readable option chain into a column of wrapped fragments.
            ':root[data-reading]:not([data-reading="false"]) p,',
            ':root[data-reading]:not([data-reading="false"]) blockquote,',
            ':root[data-reading]:not([data-reading="false"]) [data-prose] {',
            '    max-width: var(--ui-measure, 78ch);',
            '}',
        );
    }

    // ── reduceMotion ────────────────────────────────────────────────────────
    if (prefs.reduceMotion) {
        out.push(
            '/* reduceMotion */',
            ':root[data-motion="reduce"] *,',
            ':root[data-motion="reduce"] *::before,',
            ':root[data-motion="reduce"] *::after {',
            '    transition: none !important;',
            '    animation: none !important;',
            '    scroll-behavior: auto !important;',
            '}',
        );
    }

    // ── underlineLinks (WCAG 1.4.1) ─────────────────────────────────────────
    if (prefs.underlineLinks) {
        out.push(
            '/* underlineLinks */',
            ':root[data-underline]:not([data-underline="false"]) a {',
            '    text-decoration: underline;',
            '    text-underline-offset: 0.15em;',
            '}',
        );
    }

    // ── focusRing ───────────────────────────────────────────────────────────
    // "subtle" emits nothing on purpose — it is the stock browser ring, and a
    // 2px rule without !important would lose to the `focus:outline-none` that
    // index.css and plenty of JSX already carry, producing NO ring at all.
    // "strong" needs !important for exactly that reason.
    if (prefs.focusRing === 'strong') {
        out.push(
            '/* focusRing: strong */',
            ':root[data-focus="strong"] :focus-visible {',
            '    outline: 3px solid var(--color-primary) !important;',
            '    outline-offset: 2px !important;',
            '    box-shadow: 0 0 0 5px color-mix(in oklab, var(--color-primary) 35%, transparent) !important;',
            '}',
        );
    }

    // ── contrast ────────────────────────────────────────────────────────────
    // The heavy lifting is already done: the token block above carries the
    // compressed fg/border hexes. What is left are the things a colour value
    // cannot express — placeholder dimming (an opacity, not a colour) and the
    // "colour alone" link affordance.
    if (prefs.contrast === 'more' || prefs.contrast === 'max') {
        out.push(
            `/* contrast: ${prefs.contrast} */`,
            `:root[data-contrast="${prefs.contrast}"] ::placeholder {`,
            '    color: var(--color-fg-5);',
            '    opacity: 1;',
            '}',
        );
    }
    if (prefs.contrast === 'max') {
        out.push(
            ':root[data-contrast="max"] input,',
            ':root[data-contrast="max"] select,',
            ':root[data-contrast="max"] textarea {',
            '    border-color: var(--color-line-3);',
            '}',
            ':root[data-contrast="max"] a {',
            '    text-decoration: underline;',
            '}',
        );
    }

    return out.join('\n');
}

/**
 * buildThemeCss(themeSpec, prefs) — everything the injected <style> needs for
 * ONE theme + prefs combination. This is what ThemeProvider writes.
 *
 * Only the ACTIVE theme's tokens are emitted. Shipping all 12 blocks would be
 * ~12x the CSS for eleven blocks whose selector cannot match.
 */
export function buildThemeCss(themeSpec, prefs) {
    const p = coercePrefs(prefs);
    const theme = themeSpec || getTheme(undefined);
    return [
        `/* ${STYLE_ELEMENT_ID} — generated by src/theme/cssVars.js. Do not edit by hand. */`,
        buildThemeVarsCss(theme, p.contrast),
        buildPrefsCss(p),
        '',
    ].join('\n\n');
}

/**
 * Every theme in one sheet, for `scripts/validate-themes.mjs` and for anything
 * that wants to eyeball all 12 at once. Uses default prefs unless told otherwise
 * so the output is a property of the THEMES data alone.
 */
export function buildAllThemesCss(prefs) {
    const p = coercePrefs(prefs);
    return [
        '/* All AlgoBot themes — generated by src/theme/cssVars.js */',
        ...THEMES.map((t) => buildThemeVarsCss(t, p.contrast)),
        buildPrefsCss(p),
        '',
    ].join('\n\n');
}

/**
 * The `<html>` attribute set for a theme + prefs. Lives here rather than in the
 * provider so the provider and the zero-flash boot script cannot drift: both
 * derive the attributes from the same function of the same stored state.
 *
 * WHY TOGGLES ARE WRITTEN AS "true"/"false" RATHER THAN ADDED/REMOVED
 * index.css matches them as `[attr]:not([attr="false"])`, which handles both
 * conventions — but `data-motion` is the exception that forces the choice: its
 * `@media (prefers-reduced-motion)` fallback is scoped to
 * `:root:not([data-motion])`, i.e. "no explicit choice stored". Always writing
 * the attribute is what lets someone whose OS asks for reduced motion turn the
 * app's animations back ON. An absent attribute would make that pref inert.
 */
export function themeDataAttributes(themeSpec, prefs) {
    const p = coercePrefs(prefs);
    const theme = themeSpec || getTheme(undefined);
    return {
        'data-theme': safeId(theme.id),
        'data-theme-mode': theme.mode === 'light' ? 'light' : 'dark',
        'data-theme-group': safeId(theme.group || 'dark'),
        'data-contrast': p.contrast,
        'data-reading': p.readingMode ? 'true' : 'false',
        'data-motion': p.reduceMotion ? 'reduce' : 'allow',
        'data-underline': p.underlineLinks ? 'true' : 'false',
        'data-focus': p.focusRing,
    };
}

/**
 * paintHints(themeSpec, prefs) -> { bg, fg } — the two colours that decide what
 * the screen looks like BEFORE React exists.
 *
 * WHY THIS IS NEEDED AT ALL. The zero-flash boot script in index.html sets
 * `data-theme` before first paint, but the rules that attribute selects are
 * injected by ThemeProvider, which cannot run until the bundle has parsed. So
 * between the first paint and hydration the page is painted by index.css's
 * static defaults — which are the DARK ones. A returning user on `paper` or
 * `hc-light` therefore got exactly the dark->light flash the boot script exists
 * to prevent; it was only ever invisible because the default theme is dark.
 *
 * The fix is to persist these two resolved values alongside the theme id so the
 * boot script can apply them as inline custom properties with no palette maths
 * and no imports. `--color-background` and `--color-fg` are sufficient because
 * they are exactly what `body` reads; everything else is behind an empty
 * `<div id="root">` at that point.
 *
 * Kept HERE rather than in the provider so the persisted values can never be cut
 * from a different palette than the stylesheet — both come from resolvePalette()
 * with the same contrast level.
 */
export function paintHints(themeSpec, prefs) {
    const p = coercePrefs(prefs);
    const palette = resolvePalette(themeSpec || getTheme(undefined), p.contrast);
    return {
        bg: palette['--color-background'] || palette['--color-bg'] || null,
        fg: palette['--color-fg'] || null,
    };
}

/** The inline custom properties the boot script writes, so both sides name them once. */
export const PAINT_HINT_VARS = { bg: '--color-background', fg: '--color-fg' };

/**
 * The `html { font-size }` value the fontScale axis asks for, as a PERCENTAGE —
 * or `null` at scale 1, meaning "do not declare it at all, leave the reader's
 * browser default alone".
 *
 * A percentage rather than a pixel length is the fix, not a formatting choice: a
 * pixel value discards the reader's browser font-size preference, so a reader on
 * a 20px default was scaled DOWN by the control that promised to scale them up.
 * See ROOT_FONT_BASIS.
 *
 * index.css designates the INLINE style as the single runtime owner of this
 * property (the boot script sets it before first paint, ThemeProvider keeps it
 * in sync), so the provider needs the same arithmetic this file's fallback rule
 * uses. Returning it from here keeps the two in step.
 */
export function rootFontSize(prefs) {
    const scale = n(coercePrefs(prefs).fontScale);
    return scale === 1 ? null : `${n(scale * 100)}%`;
}

/**
 * Inline style for the warm overlay div. Kept here (not in the component) so the
 * z-index and blend mode are declared once next to the CSS that documents them.
 *
 * `mix-blend-mode: multiply` over a fixed, inset-0, pointer-events-none layer is
 * the only way to warm EVERYTHING — including canvas, SVG charts and images —
 * without touching any of their colours. The z-index is one below INT32_MAX so
 * it sits above every modal but stays below a browser-injected extension layer.
 */
export function warmOverlayStyle(prefs) {
    const p = coercePrefs(prefs);
    return {
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: WARM_OVERLAY_Z,
        mixBlendMode: 'multiply',
        backgroundColor: WARM_OVERLAY_COLOR,
        opacity: n(p.blueLight / 100),
    };
}
