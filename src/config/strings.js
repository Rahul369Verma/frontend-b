'use strict';
/**
 * strings.js — the UI string catalog. PURE DATA plus four tiny pure functions.
 * No React, no DOM, no dependencies (a Node script can import it directly).
 *
 * ── WHERE NEW UI TEXT GOES ──────────────────────────────────────────────────
 * HERE. Add the string to `STRINGS` under a dotted path that reads like the
 * place it appears (`sidebar.logout`, `theme.presetsTitle`) and call
 * `t('sidebar.logout')` from the component. That is the whole workflow — there
 * is no registry to update, no locale file to keep in sync, no build step.
 *
 * ── WHY A CATALOG AT ALL, GIVEN THERE IS ONE LANGUAGE ───────────────────────
 * Three reasons, none of them "someday i18n":
 *   1. Chrome text is currently spread over ~24k LOC of JSX, so nobody can
 *      answer "what does this app call that thing?" without grepping. One file
 *      makes wording reviewable and keeps it consistent (Session vs session,
 *      Multi-Leg vs Multileg).
 *   2. `nav.js` can then be pure structure — a nav entry carries a KEY, not a
 *      sentence — which is what lets a page be added in one object.
 *   3. A missing key must never be able to blank a label in a live trading UI.
 *      `t()` therefore falls back to the key itself: you see `sidebar.logout`
 *      rendered in place, which is ugly, obvious, greppable and harmless. It
 *      cannot throw and it cannot render `undefined`.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ────────────────────────────────────────
 * The 12 theme names/descriptions (`src/theme/themes.js`) and the 11
 * accessibility axis labels/descriptions (`src/theme/prefs.js`) live with their
 * data, because those modules ARE the source of truth for them: the whole point
 * of the extensibility contract is that appending one object to `THEMES` or
 * `PREF_SCHEMA` lights up in the panel with no other file edited. Copying those
 * labels here would create two owners for one string and guarantee drift.
 *
 * They are still overridable without touching the data: ThemePanel resolves
 * every such label through `tOr(key, dataLabel)`, so adding
 *   theme.axis.fontScale.label     / theme.axis.fontScale.description
 *   theme.axis.density.option.cozy / theme.axis.density.optionHint.cozy
 *   theme.theme.midnight.name      / theme.theme.midnight.description
 *   theme.group.dark.label         / theme.group.dark.description
 *   theme.preset.night-owl.name    / theme.preset.night-owl.description
 *
 * (The select-option label and its hint live under DIFFERENT parents — `option.`
 * and `optionHint.` — because a key whose value is a string cannot also have
 * children, and `…option.cozy.description` would be an unreachable path.)
 * to this catalog wins over the data if you ever need to reword one string
 * without editing the theme definition. Absent (the normal case) the data wins.
 *
 * Interpolation is `{name}` placeholders, filled from the optional second
 * argument: `t('sidebar.session', { time: '3h 20m' })`.
 */

export const STRINGS = {
    app: {
        name: 'AlgoBot',
        tagline: 'Algorithmic trading dashboard',
    },

    /**
     * Nav labels. The keys here are what `src/config/nav.js` points at via
     * `labelKey`, so a renamed page is a one-line change in exactly one file.
     */
    nav: {
        dashboard: 'Dashboard',
        livePortfolio: 'Live Portfolio',
        charts: 'Charts',
        backtest: 'Backtest',
        optimizer: 'Optimizer',
        multiLeg: 'Multi-Leg',
        risk: 'Portfolio Risk',
        tickStrategies: 'Tick Strategies',
        tickResults: 'Tick Results',
        aiManager: 'AI Manager',
        aiScore: 'AI Score',
        parityAudit: 'Parity Audit',
        dataManager: 'Data Manager',
        settings: 'Settings',
        // Reachable pages that are deliberately not in the rail.
        strategyDetail: 'Strategy Detail',
        callback: 'Broker Callback',
    },

    sidebar: {
        collapse: 'Collapse sidebar',
        expand: 'Expand sidebar',
        appearance: 'Appearance',
        appearanceTitle: 'Appearance — theme, text size, contrast',
        systemOnline: 'System Online',
        // `{time}` is a humanised remaining-time string ("3d 4h", "45m").
        session: 'Session: {time}',
        sessionActive: 'Session active',
        logout: 'Log out',
        logoutTitle: 'Log out — clears session cookie',
        logoutConfirm: 'Log out of the dashboard?',
    },

    auth: {
        checking: 'Checking session…',
    },

    settings: {
        title: 'Settings',
        tabs: {
            api: 'API Configuration',
            cookies: 'AI Web Cookies',
            notifications: 'Notifications',
        },
    },

    /**
     * The appearance panel's own chrome. Everything here is text the panel
     * writes itself; anything describing a specific theme or axis comes from
     * the theme data (see the header note).
     */
    theme: {
        title: 'Appearance',
        subtitle: 'Palette and accessibility. Every change applies immediately and is remembered on this device.',
        close: 'Close appearance panel',

        presetsTitle: 'Quick setups',
        presetsHint: 'One click sets a theme plus the settings that go with it. Anything a setup has no opinion about keeps your value.',

        themesTitle: 'Theme',
        themesHint: 'Each preview is rendered from that theme\'s real palette — page, card, text, brand and three chart colours.',
        themeActive: 'Active theme',
        themeSelect: 'Use the {name} theme',

        recommendsTitle: 'Recommended with {name}',
        recommendsHint: 'This theme was designed alongside these settings.',
        recommendsApply: 'Apply recommended',

        // Axis section headings. Which axis lands in which section is decided in
        // ThemePanel.jsx (AXIS_SECTIONS); an axis no section claims falls into
        // `sectionMore` automatically, so a new axis is never invisible.
        sectionText: 'Text & Reading',
        sectionTextHint: 'Size, typeface and measure. Text size is a true zoom — spacing grows with it, so nothing overlaps.',
        sectionComfort: 'Eye Comfort',
        sectionComfortHint: 'Warmth, contrast and edge definition, on top of whatever the theme already does.',
        sectionMotion: 'Motion & Focus',
        sectionMotionHint: 'Animation, link marking and how loud the keyboard focus ring is.',
        sectionMore: 'More',
        sectionMoreHint: 'Settings added since this panel was last organised.',

        resetTitle: 'Reset',
        reset: 'Reset to defaults',
        resetHint: 'Puts every setting on this page back to its shipped value. Your theme choice is kept.',
        resetDone: 'Everything is already at its default.',

        // Shared control furniture.
        on: 'On',
        off: 'Off',
        defaultBadge: 'Default',

        /**
         * Shown when `prefs.js` grows an axis whose `type` this panel has no
         * control for yet. It is deliberately a visible, wordy admission rather
         * than a silently skipped row: an accessibility setting that exists in
         * the data but cannot be reached from the UI is the exact failure this
         * whole data-driven arrangement is meant to prevent.
         */
        axisUnsupported: 'this build has no control for a "{type}" setting yet',
    },
};

/**
 * lookup('a.b.c') -> the string, or `undefined`.
 *
 * Returns undefined for a path that resolves to an object or a non-string, not
 * just for a missing one: `t('theme')` must not render `[object Object]`.
 * Walking with a plain property read is safe here because the catalog is a
 * literal in this file — but the `hasOwnProperty` guard is still worth it, since
 * a path like `nav.toString` would otherwise resolve to a function.
 */
export function lookup(key) {
    if (typeof key !== 'string' || !key) return undefined;
    let node = STRINGS;
    for (const part of key.split('.')) {
        if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, part)) {
            return undefined;
        }
        node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
}

/** True when the catalog actually carries `key`. */
export function hasString(key) {
    return lookup(key) !== undefined;
}

/**
 * `{name}` substitution. Unknown placeholders are LEFT IN PLACE rather than
 * blanked, so a caller that forgot an argument sees `Session: {time}` and can
 * fix it, instead of shipping `Session: ` to a trader.
 */
export function interpolate(text, vars) {
    if (!vars || typeof vars !== 'object') return text;
    return String(text).replace(/\{(\w+)\}/g, (whole, name) => (
        Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null
            ? String(vars[name])
            : whole
    ));
}

/**
 * t('nav.dashboard') -> 'Dashboard'
 * t('nav.nope')      -> 'nav.nope'        (visible, greppable, never a crash)
 * t('sidebar.session', { time: '3h 20m' }) -> 'Session: 3h 20m'
 */
export function t(key, vars) {
    const hit = lookup(key);
    return interpolate(hit === undefined ? String(key) : hit, vars);
}

/**
 * tOr(key, fallback) — the catalog if it has the key, otherwise `fallback`.
 *
 * This is the hook that keeps theme/axis labels in their data modules while
 * still allowing an override from this file (see the header note). It is NOT a
 * general-purpose default: use `t()` for text this catalog owns.
 */
export function tOr(key, fallback, vars) {
    const hit = lookup(key);
    const text = hit === undefined ? (fallback == null ? String(key) : String(fallback)) : hit;
    return interpolate(text, vars);
}

export default STRINGS;
