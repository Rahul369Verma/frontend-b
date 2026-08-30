'use strict';
/**
 * themes.js — the 12 theme specs. PURE DATA. No imports, no functions beyond a
 * two-line lookup, no React, no DOM.
 *
 * THE EXTENSIBILITY CONTRACT
 * Adding a theme is appending ONE object to THEMES. No CSS file is touched, no
 * component is edited, nothing switches on an id. `ramp.js` turns the numbers
 * below into ~230 CSS custom properties; `cssVars.js` prints them under
 * `:root[data-theme="<id>"]`; `ThemePanel.jsx` renders the swatch by reading
 * this array. That is the entire cost of a new theme.
 *
 * A theme is deliberately a very small vocabulary:
 *
 *   mode      'dark' | 'light'  — picks which lightness ROLE table to start from
 *   neutral   { h, c }          — the grey axis; low c reads as "tinted grey"
 *   primary   { h, hex?, l?, c? } — the brand accent; `hex` pins it byte-exact
 *   accent    { chromaScale, hueShift, hueClamp } — global accent transforms
 *   L         { neutral, accent, fg, line } — SPARSE lightness overrides
 *   tokens    { … }             — exact hex pins, applied last, win everything
 *
 * WHY `L` OVERRIDES EXIST RATHER THAN A SECOND RAMP TABLE
 * Every theme in the same mode shares the role table in ramp.js §2a/§2b/§2c.
 * When a theme genuinely needs a different lightness — OLED black needs its page
 * at 0.09, Nord needs its darks lifted to 0.255 — it states only the steps it
 * changes. That keeps the diff between two themes readable, and it means a fix
 * to the shared table propagates to all 12.
 *
 * WHY `L.line` IS A SEPARATE BLOCK FROM `L.neutral`
 * The three token families are NON-OVERLAPPING: `L.neutral` is surfaces and
 * fills, `L.line` is borders, `L.fg` is text. They used to share three variables
 * — neutral 700/600/500 were both the raised fill and the main border — which
 * meant a theme that wanted a stronger border had no way to ask for one except
 * by moving the fill that ink is read on. `hc-light` did exactly that and put
 * near-black ink on an L 0.450 chip (2.71:1, and 1.28:1 at its own recommended
 * 'max'); `hc-dark` was the mirror image. Three themes below now state their
 * borders directly in `L.line` and leave their fills on the shared table, and
 * the other nine inherit both from ramp.js as before.
 *
 * WHY `tokens` EXISTS
 * `midnight` must be pixel-identical to the UI shipping today, and today's
 * stylesheet contains four literal hexes that no generated ramp will reproduce
 * by luck: #ff4b4b, #0e1117, #262730, #41434d. Pinning them is honest — it says
 * "this exact byte is the requirement" — and it is strictly better than bending
 * the shared ramp until it happens to emit them, which would drag the other
 * eleven themes along with it.
 */

/** The id used whenever storage is empty, corrupt, or names a theme that is gone. */
export const DEFAULT_THEME_ID = 'midnight';

/**
 * Group metadata, in panel order. `label` heads the section, `description` is
 * the one-line explanation under it — the panel renders both, so a new group is
 * also a data-only change.
 */
export const THEME_GROUPS = [
    {
        id: 'dark',
        label: 'Dark',
        description: 'Low-light surfaces with a saturated accent. The house style — cards sit above the page, borders stay quiet.',
    },
    {
        id: 'light',
        label: 'Light',
        description: 'Bright surfaces for daylight, projectors and screen shares. Same roles, inverted lightness.',
    },
    {
        id: 'eyecare',
        label: 'Eye Comfort',
        description: 'Short-wavelength hues are rotated out of the palette itself, so charts stay separable instead of going muddy behind a screen filter.',
    },
    {
        id: 'contrast',
        label: 'High Contrast',
        description: 'Pinned ink, pinned surfaces and heavy borders for low vision. Pair with the Contrast axis set to More or Max.',
    },
];

export const THEMES = [
    // ── dark ────────────────────────────────────────────────────────────────
    {
        id: 'midnight',
        name: 'Midnight Slate',
        group: 'dark',
        mode: 'dark',
        description: 'The default. Cool slate surfaces, red accent.',
        // h/c chosen so the neutral ramp reproduces Tailwind slate byte-for-byte
        // (see NEUTRAL_C_ENVELOPE / NEUTRAL_H_DRIFT in ramp.js) — 260 `bg-slate-800`
        // and 371 `border-slate-700` call sites must not move by one unit.
        neutral: { h: 265, c: 0.042 },
        primary: { h: 25, hex: '#ff4b4b' },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        // No `L` overrides at all any more. This theme used to pin neutral 700
        // back to Tailwind's 0.372 because the shared dark table had lifted it to
        // 0.410 for the BORDER role; borders moved to their own `LINE_L` table, so
        // the shared fill ramp is Tailwind slate verbatim and this override became
        // a no-op. Removing it is the check that the split actually landed: if the
        // fidelity gate still says `--color-slate-700` is #314158 with nothing
        // declared here, the fill ramp is Tailwind's.
        L: {},
        // The four literal hexes in today's index.css, plus the three legacy
        // status colours from its `@theme` block. Pinned, not derived.
        tokens: {
            bg: '#0e1117',
            background: '#0e1117',
            card: '#262730',
            surface: '#262730',
            line: '#41434d',
            // The divider every other theme SOLVES against its card (LINE_0_RATIO)
            // is pinned here instead, to Tailwind's slate-800. That is the exact
            // byte the 81 `border-{neutral}-800` call sites render today, and spec
            // §3 freezes this theme's output — so where the other eleven themes
            // gain a faint-but-visible rule, `midnight` keeps the invisible one it
            // ships. A theme cannot be both pixel-identical and improved.
            'line-0': '#1d293d',
            secondary: '#31333f',
            success: '#09ab3b',
            danger: '#ff2b2b',
            warning: '#ffbd45',
        },
        /**
         * The one gate this theme cannot clear, declared rather than hidden.
         *
         * `--color-line` (#41434d) on `--color-card` (#262730) measures 1.51:1
         * against a 1.60:1 visibility floor. Both hexes are pinned above because
         * they are literally the two values in today's stylesheet
         * (`.bg-surface { border: 1px solid #41434d }` on `--surface-color`), and
         * spec §3 requires this theme to stay pixel-identical to the shipping UI.
         * The two requirements are in direct conflict for this single pair: the
         * border needs L 0.398 to clear the floor and the shipping hex is L 0.385.
         *
         * So this is a DEFECT WE INHERITED, held at its current value on purpose,
         * not a defect we introduced — every other theme clears the floor, and the
         * same border measures 1.93:1 against the page, which is the adjacency it
         * is drawn on for the 64 `.bg-surface` cards. The `contrast` axis lifts it
         * to 2.08:1 at 'more'.
         *
         * The floor below is a ratchet: the validator still fails if this pair
         * ever drops under 1.50, and it also fails if the pair starts passing
         * outright, so the exemption cannot quietly outlive its reason.
         */
        contrastExemptions: [
            {
                group: 'border/surface',
                id: 'line on card',
                floor: 1.50,
                why: 'both hexes are pinned to the shipping stylesheet (#41434d on #262730) by the pixel-identity requirement in spec §3; clearing 1.60 needs L 0.398 vs the shipped 0.385',
            },
        ],
    },
    {
        id: 'carbon',
        name: 'Carbon Black',
        group: 'dark',
        mode: 'dark',
        description: 'True-black OLED surfaces, emerald accent. Cheapest theme to display on an OLED panel.',
        neutral: { h: 0, c: 0.000 },
        primary: { h: 165 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        // OLED: the page goes to near-black so unlit pixels stay unlit. Card and
        // sunken move with it or the elevation collapses into a single black.
        L: { neutral: { 950: 0.040, 900: 0.090, 800: 0.145 } },
        tokens: {},
    },
    {
        id: 'abyss',
        name: 'Deep Ocean',
        group: 'dark',
        mode: 'dark',
        description: 'Saturated blue-grey surfaces with a sky accent.',
        neutral: { h: 232, c: 0.050 },
        primary: { h: 225 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        L: {},
        tokens: {},
    },
    {
        id: 'nord',
        name: 'Nord Frost',
        group: 'dark',
        mode: 'dark',
        description: 'Lifted polar-night greys, cyan accent. Softer than a true dark theme.',
        neutral: { h: 250, c: 0.028 },
        primary: { h: 205 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        L: {
            neutral: {
                // Lifted darks are the whole point of the scheme. 950 has to come
                // up with them — leaving it at the shared 0.129 would put a hole
                // in the middle of a palette whose floor is 0.255.
                950: 0.200, 900: 0.255, 800: 0.315,
            },
            // Borders have to come up with the surfaces, or the shared 0.410 line
            // lands 0.10 from a 0.315 card and disappears (1.3:1). These are the
            // exact three values that used to live in `neutral` above — they were
            // always border numbers, and stating them here is what lets the FILLS
            // stay on the shared table where the ink can read them. Measured: ink
            // on `bg-slate-700` improves 3.24 -> 4.90 for fg-4 by that move alone.
            line: { 1: 0.470, 2: 0.560, 3: 0.660 },
            // A lifted surface costs ink headroom, and this theme has to pay for
            // its own lift rather than making the other five dark themes carry it.
            // Measured against this card (L 0.314): 4.5:1 needs L >= 0.680 and
            // 3.0:1 needs L >= 0.576, both ~0.03 above the shared table.
            fg: { 4: 0.765, 5: 0.695, 6: 0.595 },
            // Same story for the accent TINT band. The shared table cuts tints at
            // L 0.190-0.320 for a card at 0.279; against a card at 0.314 the
            // deepest tint drifts 0.125 away, which stops reading as a wash over
            // the card and starts reading as a solid chip sitting on it.
            accent: { 950: 0.215, 900: 0.270, 800: 0.335 },
        },
        tokens: {},
    },
    {
        id: 'evergreen',
        name: 'Evergreen',
        group: 'dark',
        mode: 'dark',
        description: 'Green-tinted surfaces with a green accent. Low-chroma, restful.',
        neutral: { h: 158, c: 0.030 },
        primary: { h: 150 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        L: {},
        tokens: {},
    },

    // ── light ───────────────────────────────────────────────────────────────
    {
        id: 'daylight',
        name: 'Daylight',
        group: 'light',
        mode: 'light',
        description: 'Clean white cards on a barely-cool page, red accent.',
        neutral: { h: 250, c: 0.012 },
        primary: { h: 25 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        L: {},
        tokens: {},
    },
    {
        id: 'paper',
        name: 'Paper',
        group: 'light',
        mode: 'light',
        description: 'Warm off-white, orange accent. Reads like printed stock rather than a screen.',
        neutral: { h: 80, c: 0.014 },
        primary: { h: 30 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        // Pulled off pure white: a warm neutral at L 1.000 is just white, and the
        // whole character of the theme lives in the 1-4% below it.
        L: { neutral: { 950: 0.938, 900: 0.958, 800: 0.990 } },
        tokens: {},
    },
    {
        id: 'solarized',
        name: 'Solarized Light',
        group: 'light',
        mode: 'light',
        description: 'The classic base3/base2 pairing, amber accent.',
        neutral: { h: 92, c: 0.030 },
        primary: { h: 45 },
        accent: { chromaScale: 1, hueShift: 0, hueClamp: null },
        // Solarized is defined BY its surfaces: base3 #fdf6e3 (L .972) as the page
        // and base2 #eee8d5 (L .925) as the recessed tone. Anything whiter stops
        // being Solarized.
        //
        // The 700/600 border overrides this used to carry (0.900 / 0.820) are gone:
        // they were chosen to sit inside Solarized's own base01..base1 range, but
        // against a base2 well at L 0.925 they measured 1.23:1 and 1.40:1 — an
        // invisible rule. The shared LINE_L.light 0.760/0.690 is warm-tinted by
        // this theme's own neutral h/c, so it stays in character while being a
        // border you can actually see. (Those numbers live in `LINE_L` now rather
        // than in the fill ramp — same rendered border, and the fills are free to
        // sit up near the card where ink can be read on them.)
        L: { neutral: { 950: 0.925, 900: 0.968, 800: 0.988 } },
        tokens: {},
    },

    // ── eye comfort ─────────────────────────────────────────────────────────
    {
        id: 'sepia',
        name: 'Sepia Reader',
        group: 'eyecare',
        mode: 'light',
        description: 'Warm paper with blue rotated out of the palette. Best paired with the Reading Mode axis.',
        neutral: { h: 68, c: 0.038 },
        primary: { h: 40 },
        accent: {
            chromaScale: 0.82,
            hueShift: 0,
            // Partial suppression: cool hues move three-quarters of the way to
            // warm, which keeps a blue series distinguishable from an orange one
            // while removing most of the short-wavelength emission.
            hueClamp: { band: [185, 305], target: 60, strength: 0.75, chromaCap: 0.150 },
        },
        // A sepia reader with a pure-white card is not a sepia reader. Dropping
        // the surfaces 2-8% is what lets the 0.038 warm chroma actually show.
        //
        // This theme's 950 (L 0.918) is the deepest sunken surface in the whole
        // set, which makes it the binding case for BOTH the light ink table
        // (fg-5 <= 0.512) and the light border table (line <= 0.775). Its old
        // 700/600 overrides (0.895 / 0.815) measured 1.18:1 and 1.54:1 against it
        // and are dropped in favour of the shared LINE_L.light 0.760/0.690.
        L: { neutral: { 950: 0.918, 900: 0.950, 800: 0.980 } },
        tokens: {},
        /** Hint the panel surfaces as "recommended with this theme". Advisory only. */
        recommends: { readingMode: true, fontScale: 1.15, blueLight: 10 },
    },
    {
        id: 'nightshift',
        name: 'Night Shift',
        group: 'eyecare',
        mode: 'dark',
        description: 'Warm dark surfaces, blue fully rotated out. For the last hour of the session.',
        neutral: { h: 45, c: 0.030 },
        primary: { h: 55 },
        accent: {
            chromaScale: 0.75,
            hueShift: 0,
            // Full suppression: every hue in the band collapses onto 60 (amber).
            // A chart series inside the band therefore lands 20 degrees from the
            // orange series, at identical lightness — indistinguishable. That is
            // handled by separateByLightness() in ramp.js, which pushes collapsed
            // series apart in lightness; it is NOT something the anchors provide
            // on their own (they are iso-lightness by construction, so hue is all
            // they have). The validator's `chart` group gates the result.
            hueClamp: { band: [185, 305], target: 60, strength: 1.0, chromaCap: 0.130 },
        },
        L: {},
        tokens: {},
        /**
         * 30, not the 45 this used to recommend.
         *
         * The warm overlay is a `mix-blend-mode: multiply` layer, so it is a real
         * per-channel multiplication of everything underneath — measured at
         * a = 0.45 the factors are R 1.000 / G 0.924 / B 0.838. It genuinely warms
         * rather than dims, which is why it looks harmless, but it still costs
         * luminance on every green and blue channel, and WCAG luminance is 0.7152
         * green. On this theme that pushed `--color-fg-5` to 4.40:1 — under the
         * 4.5 AA gate, on the app's single largest ink bucket (538 call sites).
         * The overlay is a live DOM layer, so the palette validator cannot see it;
         * this number is the gate. At 30 the same ink measures 4.54:1.
         */
        recommends: { blueLight: 30, reduceMotion: false },
    },

    // ── high contrast ───────────────────────────────────────────────────────
    {
        id: 'hc-dark',
        name: 'High Contrast Dark',
        group: 'contrast',
        mode: 'dark',
        description: 'Pure-white ink on near-black, borders lifted past 0.55 so every boundary is visible.',
        // Almost no tint: a colour cast costs contrast, and contrast is the point.
        neutral: { h: 265, c: 0.010 },
        primary: { h: 55 },
        accent: { chromaScale: 1.05, hueShift: 0, hueClamp: null },
        L: {
            neutral: {
                950: 0.020, 900: 0.060, 800: 0.110,
                // 700/600/500 are NOT declared here any more, and that is the fix
                // for this theme's worst defect. They used to read
                // 0.560/0.680/0.790 — border numbers, lifted past 0.55 to make
                // every boundary visible — and the same three variables are the
                // raised FILL band. So `bg-slate-600` was a near-white chip under
                // pure-white ink: fg on it measured 2.87:1, fg on `bg-slate-500`
                // 1.93:1, and four of the five inks failed 4.5 on `bg-slate-700`.
                // The border requirement now lives in `line` below, where it
                // belongs, and the fills fall back to the shared dark table
                // (0.372/0.446/0.554) — dark chips under white ink, 5.7:1 at the
                // worst real pair.
                400: 0.860, 300: 0.910, 200: 0.950, 100: 0.975, 50: 0.990,
            },
            // Borders above 0.55 — the requirement that separates a high-contrast
            // theme from a merely dark one, stated once and applied to borders
            // only. Level 0 opts out of the shared 1.40:1 solver: on a theme whose
            // entire promise is that every boundary is visible, even the subtlest
            // divider should read (0.410 measures ~2.2:1 on this card).
            line: { 0: 0.410, 1: 0.560, 2: 0.680, 3: 0.790 },
            // Ink pinned to white and compressed hard: the whole band sits above
            // 0.76 so even the faintest level is far past AA on a 0.11 card.
            // Compressed, but EVENLY: the first cut bunched the top of the band
            // (0.025 / 0.030 between the first three levels), which is under the
            // ~0.04 of OKLab lightness where a step stops being perceptible — six
            // levels that look like four. Respread to an even 0.045-0.050 without
            // moving either end, so the hierarchy is real at no cost in contrast.
            fg: { 1: 1.000, 2: 0.955, 3: 0.910, 4: 0.860, 5: 0.810, 6: 0.760 },
            // Tints go darker and ink goes brighter, widening the accent-on-tint
            // ratio that gate 3 measures. The ink half is stated as an OVERRIDE
            // rather than inherited, so it has to stay ahead of the shared table:
            // when ACCENT_L's dark ink band moved up to 0.765/0.828 this override
            // would otherwise have started DIMMING the high-contrast theme below
            // the default one, which is the opposite of what it is here to do.
            // 0.800/0.860/0.910/0.950 keeps 0.060/0.050/0.040 of separation —
            // the same steps the shared band uses — while staying above it.
            accent: { 950: 0.140, 900: 0.190, 800: 0.250, 400: 0.800, 300: 0.860, 200: 0.910, 100: 0.950 },
        },
        tokens: {},
        recommends: { contrast: 'max', focusRing: 'strong', underlineLinks: true },
    },
    {
        id: 'hc-light',
        name: 'High Contrast Light',
        group: 'contrast',
        mode: 'light',
        description: 'Near-black ink on pure white, borders at 0.45 so they read as real rules.',
        neutral: { h: 265, c: 0.006 },
        primary: { h: 250 },
        accent: { chromaScale: 1.05, hueShift: 0, hueClamp: null },
        L: {
            neutral: {
                // The card is pure white; the page is a whisper off it and the
                // sunken tone further still, because a card that equals the page
                // is not a card — it has no elevation, only a border, and the
                // structural gate says so. 0.985 is ~2 sRGB units below white:
                // enough to separate the planes, far too little to read as grey.
                950: 0.950, 900: 0.985, 800: 1.000,
                // 700/600/500 are gone from here for the same reason as hc-dark,
                // and this was the worse half of the pair. They read
                // 0.450/0.360/0.280 — dark greys, chosen so a border would read as
                // a real rule on a white page — and the same three variables fill
                // 129 `bg-{neutral}-{700,600,500}` sites. Every ink in this theme
                // is near-black, so those fills put near-black on dark grey:
                // 2.71:1 at 'normal' and 1.28:1 at the 'max' THIS THEME ITSELF
                // RECOMMENDS below, i.e. the accessibility control made the
                // accessibility theme unreadable. Fills now inherit the shared
                // light table (0.925/0.855/0.760), which is light-on-light in the
                // right direction: the worst real ink-on-fill pair measures 4.6:1.
                400: 0.240, 300: 0.200, 200: 0.170, 100: 0.140, 50: 0.120,
            },
            // The rules the description promises, now applied to borders only.
            // These are the exact three lightnesses that used to sit in `neutral`,
            // so every border in this theme renders byte-identically; only the
            // fills moved. Level 0 is declared for the same reason as hc-dark.
            line: { 0: 0.740, 1: 0.450, 2: 0.360, 3: 0.280 },
            // Same reasoning as hc-dark, mirrored: the declared 0.040 steps at the
            // top of the band quantise to ~0.037 once they land on 8-bit hex, so
            // they are widened to 0.045 to keep every level a visible step.
            fg: { 1: 0.120, 2: 0.165, 3: 0.210, 4: 0.268, 5: 0.328, 6: 0.405 },
            accent: { 950: 0.965, 900: 0.930, 800: 0.880, 700: 0.400, 600: 0.450, 500: 0.500, 400: 0.400, 300: 0.340, 200: 0.280, 100: 0.220, 50: 0.180 },
        },
        tokens: {},
        recommends: { contrast: 'max', focusRing: 'strong', underlineLinks: true },
    },
];

/**
 * PRESETS — a theme plus a bundle of accessibility prefs, applied in one click.
 *
 * These exist because the axes in prefs.js are individually useful but jointly
 * intimidating: eleven controls is a configuration screen, three buttons is a
 * choice. `prefs` here is a PARTIAL delta — anything it omits keeps whatever the
 * user already had, so a preset never silently resets a setting the user chose
 * on purpose.
 */
export const PRESETS = [
    {
        id: 'reading-comfort',
        name: 'Reading Comfort',
        description: 'Warm paper, larger type, generous line height and spacing. For long sessions on documentation and trade logs.',
        theme: 'sepia',
        prefs: { fontScale: 1.25, readingMode: true, density: 'comfortable' },
    },
    {
        id: 'night-owl',
        name: 'Night Owl',
        description: 'Warm dark palette with blue rotated out, plus a 30% warm overlay. For after-hours work.',
        theme: 'nightshift',
        // 30 rather than 45, and it must stay in step with `nightshift.recommends`
        // above — the overlay multiplies G by 0.924 and B by 0.838 at a = 0.45,
        // which drops fg-5 (538 call sites) to 4.40:1, under AA. See that comment.
        prefs: { blueLight: 30, fontScale: 1.05 },
    },
    {
        id: 'max-access',
        name: 'Maximum Access',
        description: 'Highest contrast, largest type, underlined links, motion off. Built for low vision and vestibular sensitivity.',
        theme: 'hc-dark',
        prefs: { fontScale: 1.4, contrast: 'max', underlineLinks: true, reduceMotion: true },
    },
];

/**
 * getTheme(id) — never returns undefined. A stored id can outlive the theme it
 * named (renamed, removed, or written by a newer build), and the provider must
 * still render something, so an unknown id resolves to the default rather than
 * crashing the tree.
 */
export function getTheme(id) {
    return THEMES.find((t) => t.id === id)
        || THEMES.find((t) => t.id === DEFAULT_THEME_ID)
        || THEMES[0];
}

/** Presets are looked up the same way; unknown id -> null (nothing to apply). */
export function getPreset(id) {
    return PRESETS.find((p) => p.id === id) || null;
}
