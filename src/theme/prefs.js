'use strict';
/**
 * prefs.js — the accessibility axes. PURE DATA plus three tiny pure functions.
 * No React, no DOM, no imports (a Node script validates against it directly).
 *
 * THE EXTENSIBILITY CONTRACT
 * Adding an axis is appending ONE object to PREF_SCHEMA. `ThemePanel.jsx` renders
 * the control purely from `type` — it never names a key — and `cssVars.js` reads
 * the value out of the resolved prefs object. So a new axis costs one entry here
 * plus (if it needs new CSS) one branch in cssVars. The panel is untouched.
 *
 * WHY EVERY AXIS IS DECLARED RATHER THAN CODED
 * Eleven booleans/ranges scattered through components is eleven places to forget
 * a default, eleven ways for stored state to drift out of range, and a panel
 * that has to be edited every time. Declaring the axis makes the default, the
 * legal range and the storage coercion a single source of truth — which is what
 * makes `coercePrefs` able to be genuinely forward-compatible instead of
 * best-effort.
 *
 * SHAPE OF AN ENTRY
 *   key          the property name inside the stored `prefs` object
 *   label        control label in the panel
 *   description  one line of WHY, shown under the control
 *   type         'range' | 'select' | 'toggle'  — the panel switches on this
 *   default      value used on first visit and whenever storage is unusable
 *   min/max/step 'range' only
 *   unit         'range' only, for the value readout ('x', '%')
 *   options      'select' only: [{ value, label, ...payload }]
 *   apply        HUMAN-READABLE note on how cssVars/ThemeContext realises it.
 *                A string, not a function — this module must stay pure data so
 *                it can be imported, serialised and diffed without a runtime.
 *
 * Select payload fields (`scale`, `stack`) are read by cssVars.js. Keeping the
 * numbers next to the label means "comfortable" can never mean 1.15 in one file
 * and 1.2 in another.
 */

/** Single localStorage key for the whole appearance state. */
export const STORAGE_KEY = 'algobot:appearance';

/** Bumped only if the stored SHAPE changes; unknown/missing keys already coerce. */
export const STORAGE_VERSION = 1;

export const PREF_SCHEMA = [
    {
        key: 'fontScale',
        label: 'Text size',
        description: 'True zoom, applied on top of the text size your browser is already set to. The layout is rem-based, so this scales type AND spacing together — nothing overlaps, lines just get shorter.',
        type: 'range',
        default: 1,
        min: 0.85,
        max: 1.6,
        step: 0.05,
        unit: 'x',
        // RELATIVE, not `calc(16px * v)`. A percentage multiplies the reader's
        // browser font-size preference; an absolute length replaces it, so a
        // reader on a 20px default was scaled DOWN by the control that promised to
        // scale them up. This string is the fourth copy of that decision — the
        // other three are cssVars.js (the fallback rule and rootFontSize()) and
        // the boot script in index.html — so it has to move with them.
        apply: 'html { font-size: calc(100% * v) }',
    },
    {
        key: 'textBoost',
        label: 'Text weight in layout',
        description: 'Grows type WITHOUT moving the layout — bigger words in the same boxes. Use it when the text size above starts costing you table columns.',
        type: 'range',
        default: 1,
        min: 1,
        max: 1.5,
        step: 0.05,
        unit: 'x',
        apply: 'multiplies the --text-* tokens only; --spacing untouched',
    },
    {
        key: 'density',
        label: 'Density',
        description: 'Every padding, gap and width in the app is a multiple of --spacing, so one number retunes the whole grid.',
        type: 'select',
        default: 'cozy',
        options: [
            { value: 'compact', label: 'Compact', scale: 0.875, description: 'More rows on screen' },
            { value: 'cozy', label: 'Cozy', scale: 1, description: 'Default' },
            { value: 'comfortable', label: 'Comfortable', scale: 1.15, description: 'Easier tap targets' },
            { value: 'spacious', label: 'Spacious', scale: 1.3, description: 'Maximum breathing room' },
        ],
        apply: '--spacing: calc(0.25rem * option.scale)',
    },
    {
        key: 'blueLight',
        label: 'Warm filter',
        description: 'A multiply-blended warm overlay over everything, on top of whatever the theme already does. Independent of the eye-comfort themes, which remove blue from the palette itself.',
        type: 'range',
        default: 0,
        min: 0,
        max: 90,
        step: 5,
        unit: '%',
        apply: 'fixed overlay div, mix-blend-mode:multiply, pointer-events:none, z-index 2147483000, opacity v/100',
    },
    {
        key: 'contrast',
        label: 'Contrast',
        description: 'Compresses the six ink levels toward white (or black) and lifts every border off its surface. Max deliberately flattens some of the hierarchy — a hierarchy you cannot read is not a hierarchy.',
        type: 'select',
        default: 'normal',
        options: [
            { value: 'normal', label: 'Normal', description: 'Theme as designed' },
            { value: 'more', label: 'More', description: 'Clears WCAG AA on every ink level' },
            { value: 'max', label: 'Max', description: 'Built for low vision' },
        ],
        apply: 'data-contrast attr + applyContrast() rebuilds the fg/border vars',
    },
    {
        key: 'readingMode',
        label: 'Reading mode',
        description: 'Opens up line height and letter spacing and caps prose width. For documentation, help panels and long trade logs — not for tables.',
        type: 'toggle',
        default: false,
        apply: 'data-reading="on" -> line-height 1.75, letter-spacing .01em, prose max-width',
    },
    {
        key: 'font',
        label: 'Typeface',
        description: 'Legible picks Verdana/Tahoma — wide apertures and unambiguous digits, which matters when a column of numbers is the whole screen.',
        type: 'select',
        default: 'system',
        options: [
            {
                value: 'system',
                label: 'System',
                description: 'As shipped',
                // "Source Sans Pro" stays first: it is what body uses today, so
                // the default theme + default font is byte-identical to shipping.
                stack: '"Source Sans Pro", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            },
            {
                value: 'serif',
                label: 'Serif',
                description: 'Slower, calmer reading',
                stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
            },
            {
                value: 'mono',
                label: 'Monospace',
                description: 'Digits line up everywhere',
                stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            },
            {
                value: 'legible',
                label: 'Legible',
                description: 'Verdana / Tahoma',
                stack: 'Verdana, Tahoma, "DejaVu Sans", "Segoe UI", sans-serif',
            },
        ],
        apply: '--ui-font-family: option.stack',
    },
    {
        key: 'radius',
        label: 'Corners',
        description: 'Scales every --radius-* token. Sharp is not only cosmetic — hard corners give a clearer edge cue when contrast is low.',
        type: 'select',
        default: 'default',
        options: [
            { value: 'sharp', label: 'Sharp', scale: 0, description: 'Square corners' },
            { value: 'default', label: 'Default', scale: 1, description: 'As designed' },
            { value: 'round', label: 'Round', scale: 1.6, description: 'Softer' },
        ],
        apply: '--ui-radius-scale + --radius-* overrides',
    },
    {
        key: 'reduceMotion',
        label: 'Reduce motion',
        description: 'Kills transitions and animations. Seeded from prefers-reduced-motion on first visit, then it is yours.',
        type: 'toggle',
        default: false,
        apply: 'data-motion="reduce" -> transition/animation duration ~0 !important',
    },
    {
        key: 'underlineLinks',
        label: 'Underline links',
        description: 'Never rely on colour alone to mark a link (WCAG 1.4.1).',
        type: 'toggle',
        default: false,
        apply: 'data-underline="on" -> a { text-decoration: underline }',
    },
    {
        key: 'focusRing',
        label: 'Focus ring',
        description: 'Strong gives a thick, offset, double-layer ring that survives any background — the difference between usable and unusable on a keyboard.',
        type: 'select',
        default: 'subtle',
        options: [
            { value: 'subtle', label: 'Subtle', description: '2px, tight' },
            { value: 'strong', label: 'Strong', description: '3px + halo' },
        ],
        apply: 'data-focus attr -> :focus-visible outline rules',
    },
];

/** Fast lookup, built once. */
export const PREF_BY_KEY = PREF_SCHEMA.reduce((acc, p) => {
    acc[p.key] = p;
    return acc;
}, {});

export const PREF_KEYS = PREF_SCHEMA.map((p) => p.key);

/** A fresh object every call — callers mutate their copy freely. */
export function defaultPrefs() {
    const out = {};
    for (const p of PREF_SCHEMA) out[p.key] = p.default;
    return out;
}

/**
 * The resolved option object for a select axis, or null.
 * `cssVars.js` goes through here so the numeric payload (`scale`, `stack`) is
 * only ever read from the schema — never re-typed at the point of use.
 */
export function prefOption(key, value) {
    const p = PREF_BY_KEY[key];
    if (!p || p.type !== 'select') return null;
    return p.options.find((o) => o.value === value) || p.options.find((o) => o.value === p.default) || null;
}

/** Snap to the axis grid and kill binary-float noise (1.0500000000000003 -> 1.05). */
function snap(n, min, step) {
    const steps = Math.round((n - min) / step);
    return Number((min + steps * step).toFixed(4));
}

/**
 * coercePrefs(raw) -> a complete, in-range prefs object.
 *
 * FORWARD-COMPATIBLE BY CONSTRUCTION. It iterates the SCHEMA, not the input:
 *   • a key the schema no longer knows is dropped (an old build's axis)
 *   • a key the input is missing takes the schema default (a new build's axis)
 *   • a range out of bounds clamps and snaps to `step`
 *   • a select naming a removed option falls back to the default
 *   • a toggle accepts true/'true'/1/'1'/'on' and anything else is false
 *
 * That means a user who downgrades, upgrades, or hand-edits localStorage gets a
 * working UI rather than a blank screen — which matters because this state
 * controls whether the app is legible at all.
 */
export function coercePrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const p of PREF_SCHEMA) {
        const v = src[p.key];
        if (p.type === 'range') {
            const n = Number(v);
            if (!Number.isFinite(n)) { out[p.key] = p.default; continue; }
            out[p.key] = snap(Math.min(p.max, Math.max(p.min, n)), p.min, p.step);
        } else if (p.type === 'select') {
            out[p.key] = p.options.some((o) => o.value === v) ? v : p.default;
        } else if (p.type === 'toggle') {
            out[p.key] = v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
        } else {
            out[p.key] = p.default;
        }
    }
    return out;
}

/**
 * True when `prefs` is the shipped default in every axis — the panel uses it to
 * enable/disable its Reset button without hardcoding what "default" means.
 */
export function isDefaultPrefs(prefs) {
    const p = coercePrefs(prefs);
    return PREF_SCHEMA.every((s) => p[s.key] === s.default);
}
