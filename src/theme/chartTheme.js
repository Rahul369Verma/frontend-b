'use strict';
/**
 * chartTheme.js — the React binding for the chart palette.
 *
 * The palette itself, and all the reasoning behind it, lives in
 * `chartPalette.js`. That file is deliberately React-free so
 * `scripts/validate-themes.mjs` can import it under plain `node` and gate chart
 * colours across all 12 themes; this file is the thin hook on top, and it
 * re-exports the pure surface so every existing
 * `import { … } from './chartTheme.js'` keeps working unchanged.
 *
 * WHY CHARTS NEED A HOOK AT ALL (the short version — the long one is in
 * chartPalette.js): every other surface in this app rethemes for free, because
 * Tailwind v4 emits var-based utilities and redefining `--color-*` repaints
 * 5,130 call sites. Recharts is the exception — it writes colours into SVG
 * *attributes* and into plain JS style objects, where an unresolved `var(--x)`
 * renders black or drops the mark. So charts need concrete hex at render time,
 * and they need to re-render when the theme changes.
 */
import { useMemo } from 'react';
import { useTheme } from './ThemeContext.jsx';
import { buildChartTheme, MIDNIGHT_CHART_THEME } from './chartPalette.js';

export { buildChartTheme, MIDNIGHT_CHART_THEME };

/**
 * useChartTheme() -> the role table for the ACTIVE theme.
 *
 * Re-renders the calling component on a theme or contrast change, because
 * `useTheme()` hands back a fresh context value and this memo is keyed on the
 * two fields that can move a colour. It is safe to call from anywhere a hook is
 * legal, including another hook (`useChartZoom` does) — outside a provider,
 * `useTheme()` degrades to the default theme rather than throwing, so a chart
 * mounted above the provider renders in midnight instead of white-screening.
 */
export function useChartTheme() {
    const { theme, prefs } = useTheme();
    const palette = useMemo(
        () => buildChartTheme(theme, prefs?.contrast),
        [theme, prefs?.contrast],
    );
    const type = useMemo(
        () => buildChartType(prefs?.fontScale, prefs?.textBoost),
        [prefs?.fontScale, prefs?.textBoost],
    );
    // Two memos, not one: colour moves with theme+contrast and type moves with
    // fontScale+textBoost. Folding them into a single memo would rebuild (and
    // blow the palette cache in chartPalette.js) every time the reader nudges a
    // slider that cannot change a single colour.
    return useMemo(() => ({ ...palette, type }), [palette, type]);
}

/**
 * The chart type scale, in PIXELS.
 *
 * WHY PIXELS, AND WHY A FUNCTION. Recharts writes `fontSize` into SVG
 * attributes and plain JS style objects, so it needs a number — it cannot take
 * the `rem` that makes the rest of the app scale, and a chart sized in raw px
 * is exactly the bug this whole pass exists to remove: 44% of the app's text
 * ignored the Text Size axis because px is absolute. So the axes are applied
 * here, arithmetically, at render time.
 *
 * The keys mirror the CSS token names deliberately (`--text-3xs` is 10px at a
 * 16px root; `type['3xs']` is 10 at scale 1). One mental model covers both
 * halves of the app, and a chart label sized `3xs` stays the same size as the
 * table cell beside it at every setting.
 *
 * Rounded to whole pixels because sub-pixel SVG text renders blurry in Chrome,
 * and floored at 6 so a reader who scales DOWN cannot make an axis unreadable.
 */
export function buildChartType(fontScale, textBoost) {
    const k = (Number(fontScale) || 1) * (Number(textBoost) || 1);
    const at = (base) => Math.max(6, Math.round(base * k));
    return {
        '5xs': at(8),
        '4xs': at(9),
        '3xs': at(10),
        '2xs': at(11),
        xs: at(12),
        sm: at(14),
    };
}

export default useChartTheme;
