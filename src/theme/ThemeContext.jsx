import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME_ID, getPreset, getTheme, PRESETS, THEME_GROUPS, THEMES } from './themes.js';
import { coercePrefs, defaultPrefs, PREF_SCHEMA, STORAGE_KEY, STORAGE_VERSION } from './prefs.js';
import {
    buildThemeCss,
    PAINT_HINT_VARS,
    paintHints,
    rootFontSize,
    STYLE_ELEMENT_ID,
    themeDataAttributes,
    warmOverlayStyle,
} from './cssVars.js';

/**
 * ThemeContext — owns the appearance state and is the ONLY thing that touches
 * <html> or <head> on its behalf.
 *
 * WHAT IT ACTUALLY DOES, IN ORDER
 *   1. resolves { themeId, prefs } from localStorage, or seeds it from the OS on
 *      a genuine first visit
 *   2. maintains exactly ONE <style id="algobot-theme-vars"> in <head> and
 *      rewrites its textContent when the state changes
 *   3. writes the eight data-* attributes on <html> that the static CSS in
 *      index.css keys off
 *   4. keeps html{font-size} (inline) in sync with the fontScale axis
 *   5. persists, and renders the warm overlay
 *
 * WHY ONE <style> AND textContent RATHER THAN 230 setProperty CALLS
 * A single textContent write is one atomic restyle. Per-property writes are one
 * recalc each, and inline properties cannot express `[data-motion="reduce"] *`
 * or `:focus-visible` at all. The element is created once and reused forever —
 * never removed, not even on unmount, because React StrictMode mounts, unmounts
 * and remounts in development and a cleanup that removed it would flash the
 * whole app back to index.css's dark defaults on every hot reload.
 *
 * WHY EVERY STORAGE ACCESS IS WRAPPED
 * `localStorage` throws outright in some private-browsing and blocked-cookie
 * configurations — not returns null, throws — and this state decides whether the
 * app is legible. It is also the codebase convention (see Optimizer.jsx,
 * CollapsibleCard.jsx). Same reasoning for `document`/`head`/`matchMedia`: this
 * provider must degrade to "renders the default theme" rather than take the tree
 * down with it.
 *
 * ZERO-FLASH HANDOFF
 * The inline script in index.html has already set data-theme and the inline
 * font-size before first paint, reading the same STORAGE_KEY. This provider
 * re-derives the full state and corrects anything the boot script could not know
 * cheaply. The stored payload therefore carries `mode` at the top level as well
 * as inside the theme — that is the one field the boot script needs and cannot
 * compute without importing themes.js.
 */
const ThemeCtx = createContext(null);

/**
 * The style element MUST be written before the browser paints, not after.
 *
 * `useEffect` is passive: React flushes it after the commit has already been
 * painted. That is fine for the default theme, whose values index.css already
 * carries — and wrong for the other eleven, which would paint one frame in the
 * dark defaults and then snap. `useLayoutEffect` runs synchronously after the
 * DOM mutation and before paint, which is precisely the guarantee this needs,
 * and it applies on every theme SWITCH as well as on mount.
 *
 * The `document` check is the standard isomorphic guard: `useLayoutEffect` warns
 * (loudly, in every render) under `react-dom/server`, where there is no paint to
 * be early for. Resolved once at module load, so hook ORDER is still constant —
 * which is the actual rules-of-hooks requirement.
 */
const useBeforePaintEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * The theme a first-time visitor gets when their OS asks for light.
 *
 * Derived from the DATA rather than named, because "no theme id may appear
 * outside themes.js except `midnight` as the documented default" is a hard rule
 * — and because a new light theme inserted at the top of the group should become
 * this automatically.
 */
function firstThemeOfMode(mode) {
    return (THEMES.find((t) => t.mode === mode) || getTheme(DEFAULT_THEME_ID)).id;
}

/** matchMedia, but it can never throw or be missing. */
function prefersMedia(query) {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia(query).matches;
    } catch {
        return false;
    }
}

/** Stored state, or null when there is nothing usable to read. */
function readStored() {
    let raw = null;
    try {
        raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null; /* blocked or unavailable */
    }
    if (!raw) return null;
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null; /* corrupt payload — treat as absent, seeding will replace it */
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return {
        themeId: typeof parsed.theme === 'string' && parsed.theme ? parsed.theme : DEFAULT_THEME_ID,
        prefs: coercePrefs(parsed.prefs),
    };
}

/**
 * First-visit seed. Honoured ONCE: the very next render persists the result, so
 * a later change to the OS setting never silently overwrites a deliberate
 * choice. `prefers-reduced-motion` is seeded because someone who has asked their
 * OS for less motion has already told us; `prefers-color-scheme` picks the
 * light group rather than a light *contrast* level, since mode is the only thing
 * the media query actually knows.
 */
function seedState() {
    const prefs = defaultPrefs();
    if (prefersMedia('(prefers-reduced-motion: reduce)')) prefs.reduceMotion = true;
    const themeId = prefersMedia('(prefers-color-scheme: light)')
        ? firstThemeOfMode('light')
        : DEFAULT_THEME_ID;
    return { themeId, prefs };
}

function persist(themeId, mode, prefs, paint) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: STORAGE_VERSION,
            theme: themeId,
            // Top-level `mode` exists purely for the boot script in index.html:
            // it must set data-theme-mode before first paint and cannot import
            // themes.js to look the mode up from the id.
            mode,
            // …and `paint` is the same idea taken one step further: the resolved
            // page/ink colours, so the boot script can paint the correct
            // background before the bundle has even parsed. See paintHints().
            paint,
            prefs,
        }));
    } catch {
        /* quota, private mode, or storage disabled — the UI still works, it just
           forgets. Never surface this: the user did not ask to save anything. */
    }
}

/** Idempotent. Returns null when there is no document to attach to. */
function ensureStyleElement() {
    try {
        if (typeof document === 'undefined' || !document.head) return null;
        let el = document.getElementById(STYLE_ELEMENT_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ELEMENT_ID;
            el.setAttribute('data-generated-by', 'src/theme/cssVars.js');
            document.head.appendChild(el);
        }
        return el;
    } catch {
        return null;
    }
}

export function ThemeProvider({ children }) {
    // Resolved once, during the first render. Reading storage here rather than in
    // an effect means the very first committed DOM already carries the right
    // theme, so there is no second paint to flash.
    const [state, setState] = useState(() => readStored() || seedState());

    const theme = useMemo(() => getTheme(state.themeId), [state.themeId]);
    const prefs = useMemo(() => coercePrefs(state.prefs), [state.prefs]);

    // The generated stylesheet. Memoised because building it walks ~210 OKLCH
    // conversions, and an unrelated re-render of a consumer must not pay for that.
    const css = useMemo(() => buildThemeCss(theme, prefs), [theme, prefs]);

    // ── Apply: one <style>, eight attributes, one inline font-size ───────────
    // Runs BEFORE paint — see useBeforePaintEffect above.
    useBeforePaintEffect(() => {
        const el = ensureStyleElement();
        if (el && el.textContent !== css) el.textContent = css;

        let root = null;
        try {
            root = typeof document !== 'undefined' ? document.documentElement : null;
        } catch {
            root = null;
        }
        if (!root) return;

        try {
            const attrs = themeDataAttributes(theme, prefs);
            for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value);

            // index.css names the inline style the single runtime owner of the
            // root font-size (the boot script writes it pre-paint). Keeping it
            // here means the CSS fallback and the inline value never disagree.
            //
            // At scale 1 the property is REMOVED rather than set to 16px: the
            // reader's own browser font-size setting must survive an axis that
            // is not being used. That also cleans up after the boot script,
            // which writes the value unconditionally.
            const px = rootFontSize(prefs);
            if (px) root.style.fontSize = px;
            else root.style.removeProperty('font-size');
            root.style.setProperty('--ui-font-scale', String(prefs.fontScale));

            // Hand the pre-paint hints back. The boot script writes these two as
            // INLINE custom properties, which outrank `:root[data-theme]` — so
            // leaving them would freeze the page background at whatever the last
            // session used and make every theme switch look half-applied. They
            // are dropped here, in the same before-paint pass that installed the
            // real stylesheet, so the value never lapses even for one frame.
            for (const name of Object.values(PAINT_HINT_VARS)) root.style.removeProperty(name);

            // Mobile browser chrome. Read back from the cascade instead of
            // recomputing the palette, so it is whatever actually won — pins,
            // contrast compression and all.
            const meta = document.getElementById('theme-color-meta');
            if (meta && typeof window !== 'undefined' && window.getComputedStyle) {
                const bg = window.getComputedStyle(root).getPropertyValue('--color-bg').trim();
                if (bg) meta.setAttribute('content', bg);
            }
        } catch {
            /* a hostile or partial DOM (tests, extensions, SSR shims) must not
               take the app down over a cosmetic attribute */
        }
    }, [css, theme, prefs]);

    // ── Persist ─────────────────────────────────────────────────────────────
    // Separate effect so a storage failure cannot abort the apply pass above,
    // and so the first render's seed is written immediately — which is what makes
    // the OS seeding genuinely first-visit-only.
    useEffect(() => {
        persist(theme.id, theme.mode === 'light' ? 'light' : 'dark', prefs, paintHints(theme, prefs));
    }, [theme, prefs]);

    // ── Actions ─────────────────────────────────────────────────────────────
    const setTheme = useCallback((id) => {
        // Resolve through getTheme so an unknown id lands on the default instead
        // of storing a string nothing can render.
        setState((s) => ({ ...s, themeId: getTheme(id).id }));
    }, []);

    const setPref = useCallback((key, value) => {
        // Coerce on WRITE as well as on read: a slider that hands back a string,
        // or a caller passing a value the axis no longer offers, must not be able
        // to put the app into a state the CSS builder cannot express.
        setState((s) => ({ ...s, prefs: coercePrefs({ ...coercePrefs(s.prefs), [key]: value }) }));
    }, []);

    const resetPrefs = useCallback(() => {
        // Prefs only — the theme is a separate choice and resetting appearance
        // settings should not also throw away the palette the user picked.
        setState((s) => ({ ...s, prefs: defaultPrefs() }));
    }, []);

    const applyPreset = useCallback((presetId) => {
        const preset = getPreset(presetId);
        if (!preset) return;
        setState((s) => ({
            themeId: preset.theme ? getTheme(preset.theme).id : s.themeId,
            // A preset's `prefs` is a PARTIAL delta on purpose: it must not
            // silently reset an axis the user tuned and the preset has no opinion
            // about.
            prefs: coercePrefs({ ...coercePrefs(s.prefs), ...(preset.prefs || {}) }),
        }));
    }, []);

    const value = useMemo(() => ({
        themeId: theme.id,
        theme,
        mode: theme.mode === 'light' ? 'light' : 'dark',
        setTheme,
        prefs,
        setPref,
        resetPrefs,
        applyPreset,
        themes: THEMES,
        groups: THEME_GROUPS,
        presets: PRESETS,
        schema: PREF_SCHEMA,
    }), [theme, prefs, setTheme, setPref, resetPrefs, applyPreset]);

    return (
        <ThemeCtx.Provider value={value}>
            {children}
            {/*
              The blue-light overlay. `mix-blend-mode: multiply` over a fixed,
              inset-0, pointer-events-none layer is the only way to warm
              EVERYTHING — canvas, SVG charts, images — without touching a single
              colour value. Mounted only when the axis is engaged: a permanently
              present blend layer forces a compositing layer for nothing.
            */}
            {prefs.blueLight > 0 ? (
                <div aria-hidden="true" data-algobot-warm-overlay="" style={warmOverlayStyle(prefs)} />
            ) : null}
        </ThemeCtx.Provider>
    );
}

/**
 * The fallback returned when a consumer renders outside the provider.
 *
 * It does NOT throw. This is a live trading dashboard: a theme control mounted
 * one level above its provider must degrade to "the default palette, controls
 * inert" rather than white-screen the positions table. The warning names the
 * fix, and the setters are no-ops so nothing appears to work while silently
 * doing nothing to storage.
 */
let warnedNoProvider = false;
function fallbackValue() {
    if (!warnedNoProvider) {
        warnedNoProvider = true;
        console.warn('[theme] useTheme() called outside <ThemeProvider>. Rendering defaults; appearance controls are inert.');
    }
    const theme = getTheme(DEFAULT_THEME_ID);
    const noop = () => {};
    return {
        themeId: theme.id,
        theme,
        mode: theme.mode === 'light' ? 'light' : 'dark',
        setTheme: noop,
        prefs: defaultPrefs(),
        setPref: noop,
        resetPrefs: noop,
        applyPreset: noop,
        themes: THEMES,
        groups: THEME_GROUPS,
        presets: PRESETS,
        schema: PREF_SCHEMA,
    };
}

/**
 * useTheme() -> { themeId, theme, mode, setTheme, prefs, setPref, resetPrefs,
 *                 applyPreset, themes, groups, presets, schema }
 *
 * `themes` / `groups` / `presets` / `schema` are handed through deliberately:
 * ThemePanel renders entirely from them, so it never imports themes.js or
 * prefs.js and never names a theme id or a pref key.
 *
 * The disable below is for `react-refresh/only-export-components` — the hook has
 * to ship alongside the context object it reads, and splitting it into a third
 * module would buy nothing but an import cycle. Fast Refresh still handles the
 * provider itself.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
    return useContext(ThemeCtx) || fallbackValue();
}

export default ThemeProvider;
