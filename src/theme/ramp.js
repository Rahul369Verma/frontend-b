'use strict';
/**
 * ramp.js — the role-ramp generator. Pure functions, ZERO React, ZERO DOM.
 *
 * WHY THIS FILE EXISTS
 * The app has 5,130 hardcoded Tailwind colour-class occurrences and no `dark:`
 * variants. Tailwind v4 emits var-based utilities (`.bg-slate-800{background-
 * color:var(--color-slate-800)}`), so redefining `--color-*` retheme every one
 * of those call sites — variants and `/opacity` modifiers included — with zero
 * JSX edits. This module's only job is to produce that variable map.
 *
 * WHY IT MUST STAY React-FREE
 * `scripts/validate-themes.mjs` imports it directly under plain Node to run the
 * WCAG contrast gate over all 12 themes. One `import React` and the gate dies.
 *
 * THE CENTRAL IDEA: SHADE NUMBER == ROLE, NOT LIGHTNESS
 * The measured audit shows neutral usage is strictly stratified by role:
 * `bg-slate-900` is *the page*, `bg-slate-800` is *a card*, `border-slate-700`
 * is *the border*. So a shade's meaning is its ROLE, and the role is preserved
 * across light/dark — only the lightness flips. That is why the ramps below are
 * explicit 11-entry tables rather than a mathematical gradient: in BOTH modes
 * shade 800 ("card") is lighter than shade 900 ("page"), which is precisely
 * what produces elevation. A monotonic ramp would flatten every card.
 *
 * WHY OKLCH
 * Perceptual lightness is the axis every gate in this system cares about
 * (contrast, elevation, ink hierarchy), and in OKLab the achromatic axis obeys
 * Y = L**3 exactly — so a lightness table IS a luminance table, and the WCAG
 * gate becomes predictable instead of empirical. Hue and chroma then move
 * independently without dragging lightness with them (which is exactly what
 * HSL cannot do).
 */

// ─────────────────────────────────────────────────────────────────────────────
// OKLab <-> sRGB
// ─────────────────────────────────────────────────────────────────────────────
// Björn Ottosson's matrices, verbatim. Kept inline rather than pulled from a
// colour library because this module is imported by a bare Node script and by
// the browser bundle; a dependency would have to satisfy both.

const OKLAB_TO_LMS_ = [
    [1, 0.3963377774, 0.2158037573],
    [1, -0.1055613458, -0.0638541728],
    [1, -0.0894841775, -1.2914855480],
];

const LMS_TO_LINEAR = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010],
];

const LINEAR_TO_LMS = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
];

const LMS_TO_OKLAB = [
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
];

/** sRGB transfer function (linear -> encoded). */
function gammaEncode(x) {
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** sRGB transfer function (encoded -> linear). */
function gammaDecode(x) {
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function oklabToLinear(L, a, b) {
    const lms_ = OKLAB_TO_LMS_.map((r) => r[0] * L + r[1] * a + r[2] * b);
    const lms = lms_.map((v) => v * v * v);
    return LMS_TO_LINEAR.map((r) => r[0] * lms[0] + r[1] * lms[1] + r[2] * lms[2]);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Is this linear-RGB triple inside the sRGB cube? A hair of tolerance so a
 * value that is out only by float noise is not needlessly desaturated.
 */
function inGamut(rgb) {
    const eps = 1e-4;
    return rgb.every((v) => v >= -eps && v <= 1 + eps);
}

/**
 * OKLCH -> `#rrggbb`.
 *
 * GRACEFUL OUT-OF-GAMUT HANDLING: the ramp tables ask for combinations sRGB
 * cannot hit (e.g. fuchsia at C 0.30 and L 0.32). Naively clipping each channel
 * shifts BOTH hue and lightness, which is the one thing the whole design leans
 * on. Instead we hold L and H fixed and walk chroma down until the colour fits.
 * That is the standard "chroma reduction" gamut map: the result is the most
 * saturated colour with the requested lightness and hue, so contrast gates
 * computed from L stay honest.
 *
 * 96% per step over 48 steps reaches C≈0.04 of the request, which is far past
 * the sRGB boundary for every hue, so the loop always terminates in-gamut.
 */
export function oklchToHex(L, C, H) {
    const lc = clamp(Number(L) || 0, 0, 1);
    const hr = (Number(H) || 0) * Math.PI / 180;
    let c = Math.max(0, Number(C) || 0);
    let rgb = oklabToLinear(lc, c * Math.cos(hr), c * Math.sin(hr));
    for (let i = 0; i < 48 && !inGamut(rgb); i++) {
        c *= 0.96;
        rgb = oklabToLinear(lc, c * Math.cos(hr), c * Math.sin(hr));
    }
    const hex = rgb
        .map((v) => Math.round(clamp(gammaEncode(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0'))
        .join('');
    return `#${hex}`;
}

/** `#rgb` / `#rrggbb` -> `{ L, C, H }`. Needed to re-derive pinned hexes. */
export function hexToOklch(hex) {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return { L: 0, C: 0, H: 0 };
    const [r, g, b] = [0, 2, 4].map((i) => gammaDecode(parseInt(s.slice(i, i + 2), 16) / 255));
    const lms = LINEAR_TO_LMS.map((row) => row[0] * r + row[1] * g + row[2] * b);
    const lms_ = lms.map((v) => Math.cbrt(v));
    const [L, A, B] = LMS_TO_OKLAB.map((row) => row[0] * lms_[0] + row[1] * lms_[1] + row[2] * lms_[2]);
    let H = Math.atan2(B, A) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L, C: Math.hypot(A, B), H };
}

/** WCAG 2.1 relative luminance of a hex colour. */
export function relativeLuminance(hex) {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return 0;
    const [r, g, b] = [0, 2, 4].map((i) => gammaDecode(parseInt(s.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two hex colours (always >= 1). */
export function contrastRatio(hexA, hexB) {
    const a = relativeLuminance(hexA);
    const b = relativeLuminance(hexB);
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
}

// ─────────────────────────────────────────────────────────────────────────────
// Piecewise-linear interpolation over lightness
// ─────────────────────────────────────────────────────────────────────────────
// Every chroma/hue curve below is keyed on LIGHTNESS, not on shade index. That
// is deliberate: the light-mode tables re-order the roles (shade 100 is the
// DARKEST ink, shade 950 the palest tint), so a shade-indexed chroma table
// would hand a pale tint the chroma of a saturated mid-tone. Keying on the
// lightness actually produced makes one curve correct in both modes, and makes
// per-theme lightness overrides automatically pick up sane chroma.

/** knots must be sorted ascending by x. */
function pwl(knots, x) {
    if (x <= knots[0][0]) return knots[0][1];
    const last = knots[knots.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < knots.length; i++) {
        const [x1, y1] = knots[i];
        if (x <= x1) {
            const [x0, y0] = knots[i - 1];
            const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
            return y0 + (y1 - y0) * t;
        }
    }
    return last[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Shade set + role tables (spec §2a / §2b / §2c — transcribed exactly)
// ─────────────────────────────────────────────────────────────────────────────

/** Dark -> light within a Tailwind ramp. Ordered light-to-dark for readability. */
export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * §2a — neutral ramp lightness by shade. SURFACES AND FILLS ONLY.
 *
 * The DARK column is EXACTLY Tailwind's slate ramp lightness, which is what
 * makes the default `midnight` theme pixel-identical to the UI shipping today.
 * Roles: 950 sunken · 900 page · 800 card · 700 raised fill · 600 deeper fill ·
 * 500 deepest fill · 400..50 stray text.
 *
 * WHY 700/600/500 NO LONGER SAY "BORDER".
 * They used to carry two contradictory roles at once: `bg-slate-700` is a RAISED
 * FILL that ink is read on (129 sites) and `border-slate-700` was THE border
 * (373+ sites). One variable, two jobs pulling in opposite directions — a border
 * wants to be as far from the surface as it can get, a fill wants to be as close
 * to the surface as it can get so the ink on it stays readable. Every theme that
 * tuned these shades for the border role therefore broke them as fills, and the
 * high-contrast pair broke worst: ink on `bg-slate-700` measured 2.71:1 on
 * `hc-light` and 1.28:1 at hc-light's own recommended 'max' setting.
 *
 * Borders now live in their own four-entry table (LINE_L below, overridable per
 * theme via `L.line`), so this table is free to be what its call sites need: a
 * fill sequence that stays NEAR the card. That is why the dark row is back to
 * Tailwind's own 0.372 (the 0.410 that used to sit here existed purely to drag
 * the border off the card, and LINE_L carries that job now), and why the light
 * row moved from mid-grey 0.760/0.690/0.620 up to 0.925/0.855/0.760 — a fill on
 * a white card has to be light, or near-black ink lands on a near-black chip.
 */
export const NEUTRAL_L = {
    // DARK is Tailwind slate verbatim, all eleven steps. 482 `bg-slate-{900,800}`
    // call sites and the fidelity gate depend on 950/900/800; 700 is back on
    // Tailwind's value now that it is a fill and nothing else, which also retires
    // the `L.neutral: { 700 }` override `midnight` used to need.
    dark: { 950: 0.129, 900: 0.208, 800: 0.279, 700: 0.372, 600: 0.446, 500: 0.554, 400: 0.704, 300: 0.869, 200: 0.929, 100: 0.968, 50: 0.984 },
    // LIGHT mirrors the roles: 800 is the card (white or near it) and the three
    // fill steps sit just BELOW it, 0.075 apart, so a raised fill reads as a tint
    // of the card rather than a grey block on it. Measured on the shipped ink
    // table, the worst real ink-on-fill pair (fg-5 on shade 700) goes from 2.72:1
    // at the old 0.760 to 4.71:1 here.
    light: { 950: 0.985, 900: 0.968, 800: 1.000, 700: 0.925, 600: 0.855, 500: 0.760, 400: 0.560, 300: 0.440, 200: 0.340, 100: 0.260, 50: 0.180 },
};

/**
 * BORDER LIGHTNESS — the four `--color-line-*` tokens, tuned INDEPENDENTLY of the
 * fill ramp above. A theme overrides any subset via `L.line: { 0, 1, 2, 3 }`.
 *
 * Keys are the token suffix, not a Tailwind shade: 0 is `--color-line-0`,
 * 1 is `--color-line`, 2/3 are `--color-line-2` / `--color-line-3`. The
 * defaults for 1/2/3 are exactly the lightnesses the border tokens rendered at
 * before borders were split off the neutral ramp, so no theme's existing rules
 * move by a single unit; only their FILLS changed.
 *
 * Level 0 is deliberately absent: it is SOLVED per theme against that theme's
 * own card (see LINE_0_RATIO) rather than declared, because "barely visible" is
 * a ratio, not a lightness — the same L that reads as a hairline on a white card
 * is invisible on an OLED one.
 *
 * DARK 1 sits at 0.410 rather than Tailwind's 0.372 because at 0.372 a border is
 * 1.42:1 from a 0.279 card, under the 1.6:1 visibility floor — a defect Tailwind
 * ships and we inherited. LIGHT 1/2/3 are the old light neutral fill values,
 * which were always border numbers wearing a fill's name.
 */
export const LINE_L = {
    dark: { 1: 0.410, 2: 0.446, 3: 0.554 },
    light: { 1: 0.760, 2: 0.690, 3: 0.620 },
};

/**
 * `--color-line-0` — the SUBTLEST border, expressed as a contrast ratio against
 * the theme's own card rather than as a lightness.
 *
 * WHY IT EXISTS. 81 `border-{neutral}-800` call sites drew NO BORDER AT ALL:
 * shade 800 IS the card token, so on 11 of the 12 themes the border hex and the
 * card hex were byte-identical and the pair measured exactly 1.0000:1. Those
 * sites want a whisper of separation — a divider inside a card, a table rule —
 * which is a role below `--color-line`, not a second name for it.
 *
 * 1.40 is the middle of the band where a 1px rule is present but not structural:
 * under ~1.25 it disappears on a cheap panel, over ~1.5 it starts competing with
 * `--color-line` (1.6+) and the card stops having one obvious outline.
 * `midnight` pins the token instead, to the exact hex those 81 sites render
 * today, because spec §3 freezes its output.
 */
export const LINE_0_RATIO = 1.40;

/**
 * §2c — accent ramp lightness by shade.
 *
 * Note the deliberate reversal inside the ink band (400 -> 100): on dark, a
 * LOWER shade number means brighter/more prominent; on light, prominence means
 * DARKER, so 100 is the darkest. Shades 700/600/500 stay saturated mid-tones in
 * both modes — solid buttons and strong borders need no inversion, and
 * inverting them would turn every primary button inside out.
 */
export const ACCENT_L = {
    dark: { 950: 0.190, 900: 0.250, 800: 0.320, 700: 0.400, 600: 0.472, 500: 0.545, 400: 0.765, 300: 0.828, 200: 0.880, 100: 0.930, 50: 0.970 },
    light: { 950: 0.968, 900: 0.940, 800: 0.900, 700: 0.405, 600: 0.475, 500: 0.545, 400: 0.420, 300: 0.362, 200: 0.310, 100: 0.262, 50: 0.225 },
};

/**
 * WHY THE SOLID BAND (700/600/500) MOVED DOWN FROM THE FIRST CUT.
 *
 * `--color-white` is the shipped ink on a saturated accent fill: the audit found
 * 40 `text-white` occurrences on `bg-primary` / `bg-{hue}-{400..950}` and the
 * codemod is instructed to leave every one of them white (flipping
 * `--color-white` would erase the label on the other 265). So the gate is
 * "white on this fill clears 4.5:1", and that is a hard ceiling on the fill's
 * lightness, measured per hue:
 *
 *   red .597 · orange .579 · amber .574 · yellow .568 · lime .560 · green .552
 *   emerald .555 · teal .556 · cyan .557 · sky .560 · blue .577 · indigo .585
 *   violet .596 · purple .602 · fuchsia .603 · pink .601 · rose .597
 *
 * The binding hue is green at L 0.552 (the green-yellow arc carries the most
 * WCAG luminance per unit of OKLab lightness, because 0.7152 of the luminance
 * formula is the green channel). At the first cut's 0.590 the whole
 * orange->indigo arc failed — 124 of the 233 original gate breaches, i.e. every
 * `bg-emerald-500` button in the app had a 3.84:1 label.
 *
 * 0.545 clears the binding hue with margin in BOTH modes (the ceiling is
 * hue-driven, not mode-driven, which is why the two rows now agree). 700 and 600
 * follow it down so the three solid steps keep ~0.07 of visible separation
 * instead of bunching — `bg-red-500` and `bg-red-600` have to stay tellable
 * apart, they are 216 call sites between them.
 *
 * WHY DARK 400 WENT UP (0.680 -> 0.720). Shade 400 is the accent INK band (378
 * `text-{hue}-400` occurrences) and it is read on a card. On `nord`, whose card
 * is lifted to L 0.314, the low-luminance hues landed at 3.94-4.49:1. 0.720 is
 * what fuchsia — the worst of the 17 — needs there, and it stays 0.070 clear of
 * shade 300 so the ink band keeps its steps.
 */

/**
 * WHY THE INK BAND THEN MOVED AGAIN, IN BOTH MODES — dark 400/300
 * 0.720/0.790 -> 0.765/0.828, light 400..50 0.500/0.440/0.380/0.320/0.280 ->
 * 0.420/0.362/0.310/0.262/0.225.
 *
 * "Read on a card" was only half the job. The other half is the status pill this
 * UI builds out of a WASH of the solid band — `bg-{hue}-500/{10,20,30}` under
 * `text-{hue}-{300,400}`, 33 shipped call sites — and a wash is not a card: it
 * drags the backdrop the ink is measured against a third of the way toward the
 * ink itself. §2c left shade 400 only 0.08-0.09 of lightness clear of shade 500,
 * so ten per cent of wash cost the pair its 4.5:1 and thirty per cent put it at
 * 3.28:1 on the warm light themes and 3.97:1 on the lifted-surface dark one —
 * real AA failures, on both sides of the mode split, that no ink-on-surface
 * check can see.
 *
 * BOTH MODES HAD TO MOVE AND ONLY THE INK COULD. Raising the solid instead is
 * shut off by the ceiling above: `text-white` on `bg-{hue}-500` is 40 call sites
 * and green already clears 4.5 by 0.17. Lowering it helps in dark mode and HURTS
 * in light mode (a lighter card means the wash gets darker as the solid drops,
 * closing on dark ink rather than opening away from it), so there is no single
 * move on the solid band that fixes both halves. The ink is the only lever the
 * two modes share, and it moves in opposite directions in each — brighter on
 * dark, darker on light — which is exactly the §2c inversion, applied harder.
 *
 * THE NUMBERS ARE THE SMALLEST THAT CLEAR THE WORST SHIPPED CELL, measured over
 * 17 hues x 2 backdrops x 12 themes x 3 contrast levels including the warm
 * overlays the eyecare presets ship: `accent-400 on bg-500/30` goes 3.28 -> 4.68,
 * `/20` 3.75 -> 5.13, `/10` 4.29 -> 5.49, and `accent-300 on bg-500/30`
 * 4.30 -> 5.80. Nothing else in the accent matrix regresses, because every other
 * wash cell in the app sits on the TINT band (800/900/950), where moving the ink
 * away from the solid moves it away from the tint too.
 *
 * THE TWO HIGH-CONTRAST THEMES ARE THE EVIDENCE THIS BELONGED IN THE TABLE.
 * They were the only two of the twelve that passed these cells, and the reason
 * is that both already override the ink band in precisely this direction (400 at
 * 0.740 on the dark one and 0.400 on the light one — see the `L.accent` blocks in
 * themes.js). Two themes independently correcting the shared table by hand is the
 * shape of a defect in the shared table, not of two special themes.
 *
 * WHAT IT COSTS. Dark 200/100/50 do NOT move: 300 at 0.828 still leaves them
 * 0.052/0.050/0.040 of separation, so the top of the dark band — and with it
 * most of what the default theme renders — is untouched. The light band shifts
 * whole, keeping its 0.058/0.052/0.048/0.037 steps, so light-mode accent text
 * gets darker without the band flattening. The one deliberate consequence is
 * that `text-{hue}-400` is now a clearly lighter tone on dark and a clearly
 * darker one on light than the Tailwind shade it inherited its name from; the
 * name is a slot in this ramp, not a promise about Tailwind's value.
 */

/**
 * §2b — the six foreground levels that replace every neutral *text* class.
 * Keyed 1..6, where 1 is `--color-fg` (and absorbs the 262 on-surface
 * `text-white` occurrences the codemod rewrites).
 */
export const FG_L = {
    dark: { 1: 1.000, 2: 0.929, 3: 0.869, 4: 0.756, 5: 0.665, 6: 0.565 },
    light: { 1: 0.200, 2: 0.270, 3: 0.340, 4: 0.450, 5: 0.505, 6: 0.598 },
};

/**
 * WHY fg-4/fg-5/fg-6 ARE BRIGHTER (dark) AND DARKER (light) THAN THE FIRST CUT.
 *
 * The first cut transcribed Tailwind's slate ramp into the ink band: dark fg-4
 * 0.704 / fg-5 0.554 / fg-6 0.446, i.e. exactly `text-slate-{400,500,600}`. That
 * is faithful, and it is also a faithful reproduction of a REAL ACCESSIBILITY
 * FAILURE that ships in this app today — measured on the default theme,
 * `text-slate-500` on `bg-slate-800` is 3.11:1 and `text-slate-600` is 1.96:1,
 * against gates of 4.5 and 3.0. Those are 507 and 126 call sites of genuinely
 * hard-to-read text, not a rounding argument.
 *
 * The numbers below are the minimum that clears every surface in every theme,
 * measured rather than chosen:
 *   dark  — binding surface is `card` (L 0.279 on the un-lifted dark themes):
 *           4.5:1 needs L >= 0.649, 3.0:1 needs L >= 0.549. Shipped 0.665/0.565.
 *   light — binding surface is `bg-2` on `sepia` (L 0.918, the deepest sunken
 *           tone in the set): 4.5:1 needs L <= 0.512, 3.0:1 needs L <= 0.609.
 *           Shipped 0.505/0.598.
 * `nord` lifts its surfaces past the shared table and therefore declares its own
 * fg overrides in themes.js, next to the neutral overrides that caused the need.
 *
 * WHY DARK fg-4 IS 0.756 AND NOT 0.735. The binding backdrop for fg-4 is not a
 * surface at all — it is the RAISED FILL, `bg-{neutral}-700`, which 14 call sites
 * put fg-4 on and which spec §3 freezes at Tailwind's slate-700 (L 0.372) for the
 * default theme. The fill cannot move, so the ink has to: 4.5:1 needs L 0.742
 * bare and 0.756 seen through the 30% warm overlay the eyecare dark theme
 * recommends, because that multiply is applied to ink and fill alike and does not
 * cancel out of a ratio. 0.756 is the first value that clears every dark theme at every
 * contrast level with and without the filter (worst 4.59), and it is the number
 * the validator's own ledger carried as the remedy before the debt was paid.
 *
 * The six levels keep >= 0.06 of OKLab lightness between neighbours (dark:
 * .071/.060/.113/.091/.100), so the ink hierarchy is still six visible steps and
 * not a compressed mush — that separation is the constraint that stopped the
 * band being flattened toward the surface to buy contrast cheaply.
 */

/** `gray|zinc|neutral|stone` are aliased onto the same table as `slate`. */
export const NEUTRAL_ALIASES = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

// ─────────────────────────────────────────────────────────────────────────────
// Hue anchors + per-hue peak chroma
// ─────────────────────────────────────────────────────────────────────────────

/** §2c hue anchors for the 17 Tailwind hue families, in ramp order. */
export const HUE_NAMES = [
    'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
    'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

export const HUES = {
    red: 25, orange: 55, amber: 75, yellow: 95, lime: 125, green: 150,
    emerald: 165, teal: 180, cyan: 200, sky: 225, blue: 260, indigo: 275,
    violet: 295, purple: 305, fuchsia: 330, pink: 350, rose: 15,
};

/**
 * Peak chroma per hue family — the chroma each family reaches at its most
 * saturated step. Transcribed from Tailwind v4's own shade-500 chroma, because
 * those values already encode the sRGB gamut boundary per hue (cyan/teal simply
 * cannot go where fuchsia goes, and a flat peak would either wash the warms out
 * or clip the cools). Order matches HUE_NAMES.
 */
export const HUE_PEAK_C = {
    red: 0.237, orange: 0.213, amber: 0.188, yellow: 0.184, lime: 0.233,
    green: 0.219, emerald: 0.170, teal: 0.140, cyan: 0.143, sky: 0.169,
    blue: 0.214, indigo: 0.233, violet: 0.250, purple: 0.265, fuchsia: 0.295,
    pink: 0.241, rose: 0.246,
};

/**
 * ACCENT CHROMA ENVELOPE — chroma multiplier as a function of lightness.
 *
 * Derived by regressing Tailwind v4's own red and blue ramps: for each shade we
 * took (L, chroma / chroma@500) and fitted these knots. Peak sits at L≈0.58
 * (slightly above 1.0, because Tailwind's 600 step is more saturated than its
 * 500 step) and tapers to nothing at both ends — pale tints must be nearly
 * neutral or they read as a colour cast, and near-black tints run out of gamut.
 *
 * Fit quality against Tailwind red (requested -> actual ratio):
 *   L .258 -> .396/.388 · .444 -> .767/.747 · .577 -> 1.046/1.034
 *   L .637 -> 1.003/1.000 · .704 -> .808/.806 · .808 -> .486/.481
 *   L .885 -> .260/.262 · .971 -> .054/.055
 */
export const ACCENT_C_ENVELOPE = [
    [0.00, 0.00], [0.15, 0.20], [0.26, 0.40], [0.38, 0.63], [0.45, 0.78],
    [0.51, 0.95], [0.58, 1.05], [0.64, 1.00], [0.71, 0.79], [0.81, 0.48],
    [0.885, 0.26], [0.935, 0.14], [0.97, 0.055], [1.00, 0.00],
];

/**
 * NEUTRAL CHROMA ENVELOPE — multiplier on the theme's `neutral.c`.
 *
 * Knots are Tailwind slate's own (L, chroma/0.042) pairs, so `midnight` at
 * h 265 / c 0.042 reproduces slate. Chroma is held ~full from black up to
 * L≈0.70 and then collapses, because a tinted near-white surface reads as
 * "dirty" long before a tinted near-black does.
 *
 * The 950 and 900 knots are nudged 1-3% (0.970 / 0.960 rather than 1.000) —
 * that is a ROUNDING fix, not a design change: it lands the two darkest steps
 * exactly on Tailwind's #020617 and #0f172a instead of one blue-channel unit
 * above them.
 */
export const NEUTRAL_C_ENVELOPE = [
    [0.000, 0.970], [0.129, 0.970], [0.208, 0.960], [0.279, 0.976], [0.372, 1.048],
    [0.446, 1.024], [0.554, 1.095], [0.704, 0.952], [0.869, 0.524], [0.929, 0.310],
    [0.968, 0.167], [0.984, 0.071], [1.000, 0.000],
];

/**
 * NEUTRAL HUE DRIFT — degrees added to the theme's `neutral.h`, by lightness.
 *
 * Tailwind's greys are not a single hue: slate drifts from 265.8 at shade 900
 * to 247.9 at shade 100. Reproducing that drift is what takes `midnight`'s
 * neutral ramp from "4/255 off" to byte-exact on 9 of 11 steps (and 1/255 on
 * the other two). It is perceptually irrelevant at the pale end where chroma is
 * already near zero, but it is free, and byte-exactness is the requirement.
 */
export const NEUTRAL_H_DRIFT = [
    [0.000, -0.3], [0.129, -0.3], [0.208, 0.8], [0.279, -5.0], [0.372, -7.7],
    [0.446, -7.7], [0.554, -7.6], [0.704, -8.2], [0.869, -12.1], [0.929, -9.5],
    [0.968, -17.1], [1.000, -17.1],
];

/**
 * Chart series colours — three categorical slots plus a diverging pair.
 *
 * These are NOT freely generated. The values are the OKLCH of the trio already
 * validated in `src/components/viz/tokens.js` (#3987e5 / #d95926 / #199e70),
 * which passed a CVD-separation gate (worst adjacent deltaE 9.4) and a 3:1
 * contrast gate against the real card surface. Note they are iso-lightness by
 * construction — that is what makes them separable for a dichromat, for whom
 * hue distance partly collapses but lightness distance does not.
 *
 * Regenerating them from the accent envelope would raise chroma past the ceiling
 * that gate was measured at, so we rotate/scale these anchors with the theme
 * instead of re-deriving them.
 *
 * ISO-LIGHTNESS IS A TRADE, NOT A FREE WIN. Because all three sit at the same L,
 * hue is the ONLY thing separating them — which is fine until a theme rotates
 * hues (the eyecare `hueClamp` does exactly that, and collapsed two series onto
 * 20 degrees apart). `separateByLightness` below is what restores separation in
 * that case, by giving up iso-lightness precisely where hue can no longer pay
 * for it. P&L polarity uses the DIVERGING pair rather than
 * green/red on purpose: red/green is the trading convention and the classic CVD
 * failure, and every P&L cell in this app is direct-labelled with its rupee
 * value anyway, so the sign never rests on hue.
 */
export const CHART_ANCHORS = {
    dark: {
        series: [{ l: 0.622, c: 0.161, h: 255 }, { l: 0.622, c: 0.173, h: 40 }, { l: 0.621, c: 0.128, h: 163 }],
        pos: { l: 0.622, c: 0.161, h: 255 },
        neg: { l: 0.669, c: 0.159, h: 22 },
    },
    light: {
        series: [{ l: 0.520, c: 0.170, h: 255 }, { l: 0.520, c: 0.180, h: 40 }, { l: 0.520, c: 0.135, h: 163 }],
        pos: { l: 0.520, c: 0.170, h: 255 },
        neg: { l: 0.545, c: 0.180, h: 22 },
    },
};

/** Hue families the semantic status tokens are cut from. */
export const STATUS_HUES = { success: 150, danger: 25, warning: 75, info: 225 };

/**
 * Two hues closer than this (degrees) are not reliably tellable apart as two
 * series — especially not by a dichromat, for whom the hue circle partly folds.
 */
const CHART_MIN_HUE_SEPARATION = 25;

/** How far apart to push two collapsed series in OKLab lightness. */
const CHART_L_SEPARATION = 0.12;

/**
 * separateByLightness — the eyecare themes' chart rescue.
 *
 * THE BUG THIS FIXES. `hueClamp` rotates every hue inside [185, 305] onto a warm
 * target, which is the entire point of the eye-comfort themes. But the chart
 * anchors are ISO-LIGHTNESS by construction (all three sit at L 0.622 on dark),
 * so they separate PURELY by hue — and on `nightshift` the blue series (H 255)
 * lands on 60 while the orange series is already at 40. Twenty degrees apart at
 * equal lightness is one series wearing two names. Measured before this fix:
 * chromatic+lightness distance 0.045 on nightshift and 0.054 on sepia, against a
 * 0.10 floor. Charts on both themes were unreadable, which is precisely the
 * outcome the palette-level clamp was chosen to avoid — the comment on hueClamp
 * claimed "chart series inside the band separate by lightness", and they did not,
 * because nothing was making them.
 *
 * THE FIX. When two series end up within CHART_MIN_HUE_SEPARATION of each other
 * and have no lightness gap to fall back on, push the later one away in
 * lightness. The direction is mode-aware — brighter on dark, darker on light —
 * so a separated series moves AWAY from the background rather than toward it,
 * and gains contrast instead of spending it. Series that are already distinct in
 * hue are left exactly where they were, so the eleven unaffected palettes do not
 * move by a single unit.
 */
function separateByLightness(anchors, mode) {
    const dir = mode === 'dark' ? 1 : -1;
    const out = anchors.map((a) => ({ ...a }));
    for (let i = 1; i < out.length; i++) {
        for (let j = 0; j < i; j++) {
            const dh = Math.abs(hueDelta(out[j].h, out[i].h));
            const dl = Math.abs(out[i].l - out[j].l);
            if (dh < CHART_MIN_HUE_SEPARATION && dl < CHART_L_SEPARATION) {
                // Bounded so a third collapsed series cannot walk off into white
                // or black, where it would lose chroma and stop being a colour.
                out[i].l = clamp(out[j].l + dir * CHART_L_SEPARATION, 0.16, 0.90);
            }
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hue maths
// ─────────────────────────────────────────────────────────────────────────────

const normHue = (h) => ((Number(h) || 0) % 360 + 360) % 360;

/** Signed shortest arc from `from` to `to`, in (-180, 180]. */
export function hueDelta(from, to) {
    return ((normHue(to) - normHue(from) + 540) % 360) - 180;
}

/**
 * Is `h` inside `[lo, hi]`? Bands that wrap through 0 (e.g. [340, 20]) are
 * supported — lo > hi means "wraps".
 */
export function inHueBand(h, band) {
    if (!Array.isArray(band) || band.length !== 2) return false;
    const x = normHue(h);
    const lo = normHue(band[0]);
    const hi = normHue(band[1]);
    return lo <= hi ? x >= lo && x <= hi : x >= lo || x <= hi;
}

/**
 * hueClamp — blue-light suppression at the PALETTE level.
 *
 * Returns a mapper `(hue) => hue`. Hues inside `band` are rotated toward
 * `target` by `strength` (0 = untouched, 1 = fully collapsed onto `target`);
 * hues outside `band` are returned unchanged. The rotation always takes the
 * SHORTER way around the hue circle, so a hue at 300 travelling to 60 goes
 * 300 -> 360 -> 60 (+120) rather than the 240 long way through green, which
 * would parade the whole spectrum on its way out of the blue band.
 *
 * WHY PALETTE-LEVEL AND NOT A SCREEN FILTER
 * A screen filter multiplies everything, which destroys chart legibility and
 * makes surfaces muddy. Rotating the hue anchors keeps every colour distinct
 * and full-contrast — it just removes short-wavelength emission. The `blueLight`
 * pref is the *additional* screen-filter axis for people who want both.
 *
 *   hueClamp({ band: [185, 305], target: 60, strength: 1.0 })(260) === 60
 *   hueClamp({ band: [185, 305], target: 60, strength: 0 })(260)   === 260
 *   hueClamp()(260) === 260
 */
export function hueClamp(spec) {
    // Destructuring in the signature would throw on an explicit `null`, and
    // `themes.js` says `hueClamp: null` for the nine themes that do not suppress.
    const { band, target, strength = 1 } = spec && typeof spec === 'object' ? spec : {};
    if (!Array.isArray(band) || band.length !== 2 || !Number.isFinite(Number(target))) {
        return (h) => normHue(h);
    }
    const s = clamp(Number(strength) || 0, 0, 1);
    return (h) => (inHueBand(h, band) ? normHue(normHue(h) + hueDelta(h, target) * s) : normHue(h));
}

/**
 * Peak chroma at an arbitrary hue, interpolated circularly between the 17
 * anchors. Needed because a theme's `primary.h` (or a rotated chart hue) is not
 * necessarily one of the anchors, and handing it red's peak chroma at cyan's
 * hue would ask for a colour sRGB does not have.
 */
export function peakChromaAt(hue) {
    const h = normHue(hue);
    // Build the circular anchor list once per call — 17 entries, negligible.
    const pts = HUE_NAMES.map((n) => [HUES[n], HUE_PEAK_C[n]]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < pts.length; i++) {
        const [h0, c0] = pts[i];
        const [h1, c1] = pts[(i + 1) % pts.length];
        const span = i === pts.length - 1 ? 360 - h0 + h1 : h1 - h0;
        const off = i === pts.length - 1 && h < h0 ? h + 360 - h0 : h - h0;
        if (off >= 0 && off <= span) return c0 + (c1 - c0) * (span === 0 ? 0 : off / span);
    }
    return pts[0][1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme spec normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill a (possibly sparse) theme object out to everything buildPalette needs.
 * Kept tolerant on purpose: `themes.js` is pure data authored by hand, and a
 * theme missing `accent` should render, not throw.
 */
function readTheme(t) {
    const spec = t && typeof t === 'object' ? t : {};
    const mode = spec.mode === 'light' ? 'light' : 'dark';
    const accent = spec.accent || {};
    return {
        id: String(spec.id || 'unknown'),
        mode,
        neutral: { h: Number(spec.neutral?.h) || 0, c: Math.max(0, Number(spec.neutral?.c) || 0) },
        primary: {
            h: Number(spec.primary?.h ?? 25),
            c: spec.primary?.c,
            l: spec.primary?.l,
            hex: spec.primary?.hex,
        },
        chromaScale: Number.isFinite(Number(accent.chromaScale)) ? Number(accent.chromaScale) : 1,
        hueShift: Number(accent.hueShift) || 0,
        clampSpec: accent.hueClamp || null,
        L: {
            neutral: { ...NEUTRAL_L[mode], ...(spec.L?.neutral || {}) },
            accent: { ...ACCENT_L[mode], ...(spec.L?.accent || {}) },
            fg: { ...FG_L[mode], ...(spec.L?.fg || {}) },
            // `line` is the ONLY one of the four that is legitimately sparse at
            // level 0: LINE_L declares 1/2/3 and leaves 0 to be solved against the
            // theme's own card. A theme may still pin 0 here to opt out of the
            // solver — the high-contrast pair does, because "subtlest" on a theme
            // whose whole promise is visible boundaries is not 1.40:1.
            line: { ...LINE_L[mode], ...(spec.L?.line || {}) },
        },
        tokens: spec.tokens || {},
    };
}

/** `primary` -> `--color-primary`; `--chart-1` passes through untouched. */
function varName(key) {
    const k = String(key);
    return k.startsWith('--') ? k : `--color-${k}`;
}

/**
 * `card-2` — the second card tone, derived as one step off `card`.
 *
 * IT RECESSES IN BOTH MODES, and that is a deliberate correction. The first cut
 * of this function raised the tone on dark (L + 0.045) and lowered it on light
 * (L - 0.030), on the "elevation = lighter" reading. Two things are wrong with
 * that:
 *
 *  1. THE ROLE IS INSET, NOT RAISED. `card-2` names a nested panel, a table
 *     header strip, a well inside a card. `bg-slate-700` already provides the
 *     RAISED fill (§2a gives shade 700 that role explicitly), so the second card
 *     tone is the other direction by elimination. Light mode was already
 *     recessing; the dark branch was the odd one out, and a token that means
 *     "inset" in one mode and "raised" in the other is not a role.
 *
 *  2. IT INVERTED THE ACCESSIBILITY GRADIENT. Going lighter on dark made `card-2`
 *     the BRIGHTEST surface in the theme, so it became the binding constraint for
 *     all six ink levels and all three borders — measured, it demanded fg-5 at
 *     L 0.728 on `nord`, which would have collapsed fg-3/fg-4/fg-5 into a
 *     0.14-wide band. Recessing means a nested panel gains ink contrast instead
 *     of spending it, which is what lets the ink table keep six distinguishable
 *     steps.
 *
 * The step is small on purpose — ~0.035 of OKLab lightness is about the smallest
 * difference that survives a cheap monitor, and anything larger starts competing
 * with the page/card distinction itself. It is also floored: on an OLED theme
 * whose card already sits at L 0.145 there is very little room below, so the
 * step shrinks rather than clipping to black and losing the tone entirely.
 */
function stepSurface(hex, mode) {
    const { L, C, H } = hexToOklch(hex);
    // Never go below L 0.02 on dark (that is black, and black is `--color-black`);
    // never above 0.995 on light. Whatever room is left, take up to 0.035 of it.
    const target = mode === 'dark'
        ? Math.max(0.020, L - Math.min(0.035, Math.max(0, L - 0.020)))
        : Math.min(0.995, L - 0.035);
    return oklchToHex(clamp(target, 0, 1), C, H);
}

/**
 * solveLine0 — the subtlest border, found by measurement instead of declaration.
 *
 * WHY A SOLVER AND NOT A NUMBER. The target is a CONTRAST RATIO against the card
 * (LINE_0_RATIO), and the lightness that produces it is wildly theme-dependent:
 * WCAG luminance is roughly L**3, so near black a ratio costs a large lightness
 * step and near white a small one. Measured across the set, 1.40:1 needs
 * L +0.145 on the OLED card (L 0.145) but only L -0.112 on a white one. A single
 * declared offset would be a hairline on one theme and a rule on another; a
 * single declared lightness would be invisible on half of them. Solving keeps the
 * PERCEIVED weight constant, which is what the role actually means.
 *
 * Bisection rather than the analytic L**3 inverse because the cut is not
 * achromatic — it carries the theme's neutral chroma and hue drift, and it is
 * gamut-mapped on the way to hex, both of which move luminance by more than the
 * tolerance. 24 halvings resolve L to ~6e-8, i.e. far past 8-bit hex.
 *
 * `dir` is implicit in the bracket: away from the card means toward white on a
 * dark theme and toward black on a light one, and the ratio rises monotonically
 * along that path, which is what makes bisection valid here.
 */
function solveLine0(cardHex, mode, cut) {
    const cardL = hexToOklch(cardHex).L;
    let near = cardL;                       // ratio 1.00 by construction
    let far = mode === 'dark' ? 1 : 0;      // the far end of the achromatic axis
    for (let i = 0; i < 24; i++) {
        const mid = (near + far) / 2;
        if (contrastRatio(cut(mid), cardHex) < LINE_0_RATIO) near = mid;
        else far = mid;
    }
    return cut((near + far) / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// buildPalette
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildPalette(themeSpec) -> { '--color-slate-800': '#1d293d', ... }
 *
 * A flat map of CSS custom-property name -> hex string. Everything: the 17
 * accent families x 11 shades, the neutral ramp x 11 aliased across
 * slate/gray/zinc/neutral/stone, white/black, the 6 fg levels, and every
 * semantic + chart token in spec §2d.
 *
 * `themeSpec.tokens` is applied LAST and wins, so a theme can pin an exact hex
 * where byte-fidelity matters (that is how `midnight` keeps #ff4b4b, #0e1117,
 * #262730 and #41434d — the four colours that are literally in the shipping
 * stylesheet today).
 */
export function buildPalette(themeSpec) {
    const T = readTheme(themeSpec);
    const out = {};
    const clampHue = hueClamp(T.clampSpec);
    const chromaCap = Number(T.clampSpec?.chromaCap);

    /** Full accent pipeline for one hue: shift -> clamp -> cap. */
    const accentHue = (h0) => clampHue(normHue(h0 + T.hueShift));
    const accentChroma = (h0, hueOut, requested) => {
        let c = requested * T.chromaScale;
        // The cap applies only to hues that WERE in the suppression band — the
        // point is to stop a rotated blue arriving as a screaming orange, not
        // to desaturate the whole palette (chromaScale already does that).
        if (Number.isFinite(chromaCap) && inHueBand(h0 + T.hueShift, T.clampSpec?.band)) {
            c = Math.min(c, chromaCap);
        }
        return Math.max(0, Math.min(c, peakChromaAt(hueOut) * 1.15));
    };

    // ── Neutral ramp (+ aliases) ────────────────────────────────────────────
    // One cut function for every achromatic token in the theme — the fill ramp,
    // the six ink levels and the four border levels all go through it, so a
    // border is guaranteed to be the same grey FAMILY as the surface it sits on
    // even though its lightness now comes from a different table.
    const neutralAt = (L) => oklchToHex(
        L,
        T.neutral.c * pwl(NEUTRAL_C_ENVELOPE, L),
        T.neutral.h + pwl(NEUTRAL_H_DRIFT, L),
    );

    const neutralHex = {};
    for (const shade of SHADES) neutralHex[shade] = neutralAt(T.L.neutral[shade]);
    for (const family of NEUTRAL_ALIASES) {
        for (const shade of SHADES) out[`--color-${family}-${shade}`] = neutralHex[shade];
    }

    // ── 17 accent families x 11 shades ──────────────────────────────────────
    for (const family of HUE_NAMES) {
        const base = HUES[family];
        const h = accentHue(base);
        const peak = HUE_PEAK_C[family];
        for (const shade of SHADES) {
            const L = T.L.accent[shade];
            const c = accentChroma(base, h, peak * pwl(ACCENT_C_ENVELOPE, L));
            out[`--color-${family}-${shade}`] = oklchToHex(L, c, h);
        }
    }

    // ── white / black ───────────────────────────────────────────────────────
    // NOT inverted, in any theme. 40 of the 305 `text-white` occurrences sit on
    // a saturated accent background and must stay white on a light theme too;
    // the codemod rewrites the other 262 to `text-fg`, which IS mode-aware. Flip
    // `--color-white` and every one of those 40 labels vanishes into its button.
    out['--color-white'] = '#ffffff';
    out['--color-black'] = '#000000';

    // ── Foreground levels ───────────────────────────────────────────────────
    const fgHex = {};
    for (const lvl of [1, 2, 3, 4, 5, 6]) {
        fgHex[lvl] = neutralAt(T.L.fg[lvl]);
        out[lvl === 1 ? '--color-fg' : `--color-fg-${lvl}`] = fgHex[lvl];
    }

    // ── Semantic surfaces / lines (§2d) ─────────────────────────────────────
    // The role table in §2a is the whole mapping: 900 page, 950 sunken,
    // 800 card, 700 raised fill + main border, 600/500 stronger borders.
    out['--color-bg'] = neutralHex[900];
    out['--color-bg-2'] = neutralHex[950];
    out['--color-card'] = neutralHex[800];
    // `card-2` is a SECOND CARD TONE (a nested panel, a table header strip), NOT
    // shade 700. Mapping it onto 700 was the obvious reading of §2a and it is
    // wrong: 700 is the border/raised-fill role, so on a high-contrast theme it
    // sits at L 0.56 and every fg level fails 4.5:1 against it. It is an INSET
    // tone and recesses in both modes — see stepSurface for why that direction
    // matters to every ink gate. Re-derived after the pins below so a theme that
    // pins `card` gets a matching second tone rather than one cut from the
    // unpinned ramp.
    out['--color-card-2'] = stepSurface(out['--color-card'], T.mode);
    // Borders read their lightness from `L.line`, NOT from the fill ramp. The two
    // families used to be the same three variables, which meant a theme could not
    // make its borders stronger without making its fills darker (light mode) or
    // lighter (dark mode) by exactly as much — and ink is read on fills, so every
    // border decision was silently an ink decision. See LINE_L.
    out['--color-line'] = neutralAt(T.L.line[1]);
    out['--color-line-2'] = neutralAt(T.L.line[2]);
    out['--color-line-3'] = neutralAt(T.L.line[3]);
    // line-0 is solved against the card rather than declared — see LINE_0_RATIO.
    // Re-solved after the pins below so a theme that pins `card` gets a divider
    // measured off the card it actually renders.
    out['--color-line-0'] = Number.isFinite(Number(T.L.line[0]))
        ? neutralAt(Number(T.L.line[0]))
        : solveLine0(out['--color-card'], T.mode, neutralAt);

    // Legacy aliases from the pre-theming `@theme` block. 67 `bg-surface` and
    // 4 `bg-background` call sites depend on these names existing.
    out['--color-background'] = out['--color-bg'];
    out['--color-surface'] = out['--color-card'];

    // ── Primary ─────────────────────────────────────────────────────────────
    // A theme may pin an exact hex (midnight: #ff4b4b). Otherwise the primary is
    // cut at the "solid bg" role lightness of the current mode.
    let primary;
    if (typeof T.primary.hex === 'string' && T.primary.hex) {
        primary = T.primary.hex.toLowerCase();
    } else {
        const ph = accentHue(T.primary.h);
        const pl = Number.isFinite(Number(T.primary.l)) ? Number(T.primary.l) : T.L.accent[T.mode === 'dark' ? 500 : 600];
        const pc = Number.isFinite(Number(T.primary.c))
            ? Number(T.primary.c) * T.chromaScale
            : accentChroma(T.primary.h, ph, peakChromaAt(ph) * pwl(ACCENT_C_ENVELOPE, pl));
        primary = oklchToHex(pl, pc, ph);
    }
    out['--color-primary'] = primary;

    // on-primary: the ink that sits ON the primary fill.
    //
    // CHOSEN BY MEASUREMENT, WITH WHITE PREFERRED. White is the convention for a
    // solid brand button and it is what ships today, so it wins whenever it
    // actually clears AA. It is only displaced when it does not — and on the
    // default theme it does not: `midnight` pins #ff4b4b (frozen by spec §3), and
    // white on #ff4b4b is 3.30:1. That is a real, currently-shipping failure on
    // the app's most prominent control, and since the fill cannot move, the ink
    // has to. The dark alternative measures 6.36:1 there.
    //
    // The earlier rule — "dark ink only once the fill passes L 0.72" — could not
    // express this: it is a lightness threshold, and #ff4b4b sits at L 0.671 while
    // carrying the luminance of a much lighter colour (a saturated red is nearly
    // all red channel, and WCAG weights that channel 0.2126). Only a contrast
    // measurement sees that.
    //
    // The dark ink is a near-black cut from the theme's own neutral rather than
    // pure #000, so it reads as part of the palette instead of a hole in it.
    const darkInk = oklchToHex(0.145, T.neutral.c * 0.6, T.neutral.h);
    const whiteOn = contrastRatio(primary, '#ffffff');
    out['--color-on-primary'] = whiteOn >= 4.5 || whiteOn >= contrastRatio(primary, darkInk)
        ? '#ffffff'
        : darkInk;

    // primary-ink: the primary hue re-cut at the accent INK role, for TEXT that
    // sits on a primary WASH rather than on the solid fill.
    //
    // THE BUG THIS FIXES. `text-primary` on `bg-primary/{10..30}` is a common
    // pairing in this UI, and it is the one place `--color-primary` is asked to be
    // both the background and the ink. `--color-primary` is cut at the SOLID band
    // (L 0.545 on dark), and a 10-30% wash of it over a dark card lands within
    // 0.1-0.2 of that same lightness — measured, `text-primary` on the wash was
    // 2.04:1 on nord, 2.19 on abyss, 2.12 on nightshift and 2.25 on evergreen.
    // Not a contrast failure of the theme so much as a role collision: no single
    // lightness can be a fill and the ink on that fill.
    //
    // So the ink is cut where ink is cut — shade 300 on dark (the "accent text,
    // brighter" role) and shade 700 on light (where prominence means darker) —
    // through the theme's OWN accent table, so the high-contrast pair's widened
    // ink band applies here too. Hue comes from the primary that actually
    // shipped: when a theme pins an exact hex (`midnight`'s #ff4b4b measures
    // H 29.2, not its declared 25) the ink is read back off the pin, or the label
    // would be a different red from its own background.
    const primaryHue = typeof T.primary.hex === 'string' && T.primary.hex
        ? hexToOklch(primary).H
        : accentHue(T.primary.h);
    const inkL = T.L.accent[T.mode === 'dark' ? 300 : 700];
    out['--color-primary-ink'] = oklchToHex(
        inkL,
        accentChroma(T.primary.h, primaryHue, peakChromaAt(primaryHue) * pwl(ACCENT_C_ENVELOPE, inkL)),
        primaryHue,
    );

    // ── Status + secondary ──────────────────────────────────────────────────
    // Cut at the "solid bg" role for the mode so they read as fills AND as text.
    const statusL = T.L.accent[T.mode === 'dark' ? 500 : 600];
    for (const [name, baseHue] of Object.entries(STATUS_HUES)) {
        const h = accentHue(baseHue);
        const c = accentChroma(baseHue, h, peakChromaAt(h) * pwl(ACCENT_C_ENVELOPE, statusL));
        out[`--color-${name}`] = oklchToHex(statusL, c, h);
    }
    // `secondary` is a neutral chip/fill, not a hue — the raised-fill role.
    out['--color-secondary'] = neutralHex[700];

    // ── Chart tokens (§2d) ──────────────────────────────────────────────────
    // Emitted twice: `--chart-*` is the canonical name `chartTheme.js` reads,
    // `--color-chart-*` exists so `bg-chart-1` can be generated as a utility if
    // index.css declares it. Extra unused custom properties cost nothing; a
    // MISSING one breaks a chart, so we err on the side of both.
    const anchors = CHART_ANCHORS[T.mode];
    // Resolve the hue FIRST (shift + clamp), then separate, then cut. The order
    // matters: separation has to react to the hues that actually came out of the
    // clamp, not to the anchors' original ones.
    const resolved = (a) => ({ ...a, h0: a.h, h: accentHue(a.h) });
    const cutChart = (a) => oklchToHex(a.l, accentChroma(a.h0, a.h, a.c), a.h);

    // The three categorical slots separate among themselves…
    separateByLightness(anchors.series.map(resolved), T.mode).forEach((a, i) => {
        const hex = cutChart(a);
        out[`--chart-${i + 1}`] = hex;
        out[`--color-chart-${i + 1}`] = hex;
    });
    // …and the polarity pair separates as its own group. It is never read against
    // the categorical slots (a P&L chart shows one or the other), and folding it
    // into the same group would push it around for no reason.
    const [posA, negA] = separateByLightness([anchors.pos, anchors.neg].map(resolved), T.mode);
    const pos = cutChart(posA);
    const neg = cutChart(negA);
    out['--chart-pos'] = pos;
    out['--color-chart-pos'] = pos;
    out['--chart-neg'] = neg;
    out['--color-chart-neg'] = neg;
    out['--chart-neutral'] = fgHex[5];
    out['--color-chart-neutral'] = fgHex[5];
    out['--chart-axis'] = fgHex[5];
    // Tooltips sit ABOVE a card, so they take the page tone rather than the card
    // tone — which is also exactly the `#0f172a` the recharts `contentStyle`
    // props hardcode today, so midnight's tooltips do not move.
    out['--chart-tooltip-bg'] = neutralHex[900];
    // Gridlines and the tooltip outline ARE borders, so they take the border
    // token rather than raw shade 700 — assigned again after the pins below, so
    // a theme that pins `line` gets gridlines that match its own border instead
    // of ones cut from the unpinned ramp.
    out['--chart-grid'] = out['--color-line'];
    out['--chart-tooltip-border'] = out['--color-line'];

    // ── Per-theme exact pins win ────────────────────────────────────────────
    for (const [key, value] of Object.entries(T.tokens)) {
        if (typeof value === 'string' && value) out[varName(key)] = value.toLowerCase();
    }

    // Re-derive the second card tone off the FINAL card, so `midnight`'s pinned
    // #262730 gets a #262730-coloured nested panel rather than a slate one.
    if (!('--color-card-2' in T.tokens) && !('card-2' in T.tokens)) {
        out['--color-card-2'] = stepSurface(out['--color-card'], T.mode);
    }
    // …and the divider, for the same reason: it is defined as a RATIO against the
    // card, so a theme that pins `card` must have it re-solved against that pin or
    // the ratio is measured off a surface the theme does not render.
    const pinnedLine0 = '--color-line-0' in T.tokens || 'line-0' in T.tokens;
    if (!pinnedLine0 && !Number.isFinite(Number(T.L.line[0]))) {
        out['--color-line-0'] = solveLine0(out['--color-card'], T.mode, neutralAt);
    }
    // Same for the legacy aliases: a theme that pins `bg` but not `background`
    // still means both, and 67 `bg-surface` / 4 `bg-background` call sites are
    // reading the alias rather than the new name.
    const pinned = (k) => `--color-${k}` in T.tokens || k in T.tokens;
    if (!pinned('background')) out['--color-background'] = out['--color-bg'];
    if (!pinned('surface')) out['--color-surface'] = out['--color-card'];
    // …and the two chart tokens that ARE borders, for the same reason: `midnight`
    // pins `line` to #41434d, so its gridlines should be #41434d too rather than
    // the #314158 the ramp would otherwise hand them.
    if (!('--chart-grid' in T.tokens) && !('chart-grid' in T.tokens)) out['--chart-grid'] = out['--color-line'];
    if (!('--chart-tooltip-border' in T.tokens) && !('chart-tooltip-border' in T.tokens)) {
        out['--chart-tooltip-border'] = out['--color-line'];
    }

    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The contrast accessibility axis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How far each level pulls. `more` is the "I squint at this at 3pm" setting;
 * `max` is for low vision and deliberately flattens most of the ink hierarchy
 * (0.65 of the way to the extreme) while still keeping fg-6 distinguishable
 * from fg — a hierarchy nobody can read is not a hierarchy.
 *
 * `border` is an ABSOLUTE lightness step, not a fraction, because borders start
 * bunched close to the surface and a fractional pull would barely move them.
 *
 * `fill` is the opposite on both counts: a FRACTION, and of the distance to the
 * card rather than to an extreme, because a fill has somewhere it must not go
 * past. 0.40 at 'max' rather than a rounder 0.50 is set by the two themes whose
 * card is closest to the fill band — `nord` (lifted card L 0.314) and `sepia`
 * (warm card L 0.981), both leaving the fill only 0.058 of lightness to give.
 * Half of that is 0.028, under the ~0.035 where a surface step stops being
 * visible at all, and a raised fill you cannot see is not a raised fill. 0.40
 * leaves both at exactly 0.035, and costs the ink it was bought for almost
 * nothing: the worst real ink-on-fill pair still measures 7.40:1 at 'max'.
 *
 * The `more` numbers are not taste. They are the smallest pull that clears the
 * whole gate matrix — {fg…fg-6} x {bg, card, card-2} at AA, plus borders at
 * 1.6:1 — across all 12 themes. Measured residuals as the pull is lowered:
 *   fg .35 / border .10 -> 3 fails (nord fg-5/card-2 4.23, daylight+paper line/bg)
 *   fg .38 / border .12 -> 1 fail  (nord fg-5/card-2 4.45)
 *   fg .40 / border .12 -> 0 fails   <- shipped
 * So `contrast: 'more'` is the setting that makes EVERY theme WCAG-AA clean,
 * which is a much more useful promise than a round number.
 */
const CONTRAST_STEPS = {
    normal: { fg: 0, border: 0, fill: 0 },
    more: { fg: 0.40, border: 0.12, fill: 0.30 },
    max: { fg: 0.65, border: 0.20, fill: 0.40 },
};

/** Tokens whose lightness is pulled toward the ink extreme. */
const FG_TOKENS = ['--color-fg', '--color-fg-2', '--color-fg-3', '--color-fg-4', '--color-fg-5', '--color-fg-6'];

/**
 * Border tokens — pulled AWAY from the surface, which is what makes a boundary
 * more visible. All four line levels and nothing else.
 *
 * THE NEUTRAL ALIASES USED TO BE IN HERE AND THAT WAS THE BUG. `--color-slate-700`
 * and friends are FILLS (`bg-slate-700`, 129 sites), and pulling a fill away from
 * the surface pulls it TOWARD the ink that is read on it. Every notch of
 * "more contrast" therefore destroyed the ink-on-fill contrast it was asked to
 * improve: on `hc-light`, ink on `bg-slate-700` went 2.71 -> 1.67 -> 1.28 as the
 * user turned the axis up, and hc-light's own one-click preset asks for 'max'.
 * The fills now move the other way, under `fill` below.
 */
const BORDER_TOKENS = ['--color-line-0', '--color-line', '--color-line-2', '--color-line-3'];

/**
 * Fill tokens — the neutral raised-fill band plus the neutral chip.
 *
 * These RELAX TOWARD THE CARD as contrast rises, which is the opposite of what a
 * border does and the correct direction for a surface: a fill's whole job is to
 * carry ink, so when the reader asks for contrast the fill's job is to get out of
 * the ink's way. Anchoring on the card rather than on the mode's extreme is what
 * keeps the elevation step alive — pulling toward pure black at 'max' would put a
 * dark theme's raised fill BELOW its own card and invert the elevation the fill
 * exists to express. Measured across 12 themes x 3 levels x 3 fill shades: zero
 * crossings, and the tightest surviving gap is 0.035 of OKLab lightness, which is
 * where the 0.40 pull in CONTRAST_STEPS comes from.
 */
const FILL_TOKENS = [
    ...NEUTRAL_ALIASES.flatMap((f) => [`--color-${f}-700`, `--color-${f}-600`, `--color-${f}-500`]),
    '--color-secondary',
];

/**
 * applyContrast(palette, level[, mode]) -> new palette
 *
 * Non-mutating. Works on the finished hex map rather than on the ramp tables,
 * which means it also lifts a theme's PINNED colours — a pin is a fidelity
 * decision for the default look, not a licence to ignore an accessibility
 * request.
 *
 * `mode` is inferred from `--color-bg` when omitted, so callers never have to
 * thread it through. Direction matters: "toward the extreme" means brighter on
 * a dark theme and darker on a light one, for BOTH ink and borders.
 */
export function applyContrast(palette, level, mode) {
    const step = CONTRAST_STEPS[level] || CONTRAST_STEPS.normal;
    if (!palette || (step.fg === 0 && step.border === 0 && step.fill === 0)) return { ...palette };

    const m = mode === 'dark' || mode === 'light'
        ? mode
        : (hexToOklch(palette['--color-bg'] || '#000000').L > 0.5 ? 'light' : 'dark');
    const inkExtreme = m === 'dark' ? 1.0 : 0.08;
    const dir = m === 'dark' ? 1 : -1;

    const out = { ...palette };

    for (const key of FG_TOKENS) {
        const hex = out[key];
        if (!hex) continue;
        const { L, C, H } = hexToOklch(hex);
        const nl = clamp(L + (inkExtreme - L) * step.fg, 0, 1);
        // Chroma has to come down as ink approaches white/black or it goes out
        // of gamut and the gamut mapper silently eats the lift we just applied.
        out[key] = oklchToHex(nl, C * pwl(NEUTRAL_C_ENVELOPE, nl) / Math.max(0.001, pwl(NEUTRAL_C_ENVELOPE, L)), H);
    }

    for (const key of BORDER_TOKENS) {
        const hex = out[key];
        if (!hex) continue;
        const { L, C, H } = hexToOklch(hex);
        out[key] = oklchToHex(clamp(L + dir * step.border, 0, 1), C, H);
    }

    // Fills relax toward the card. Fractional rather than an absolute step, and
    // anchored on the card rather than on the mode's extreme, so a fill can
    // approach the surface it sits on but never cross it — see FILL_TOKENS.
    const cardL = hexToOklch(out['--color-card'] || out['--color-bg'] || '#000000').L;
    for (const key of FILL_TOKENS) {
        const hex = out[key];
        if (!hex) continue;
        const { L, C, H } = hexToOklch(hex);
        out[key] = oklchToHex(clamp(L + (cardL - L) * step.fill, 0, 1), C, H);
    }

    return out;
}

/**
 * Convenience: the finished, contrast-adjusted palette for a theme + contrast
 * level. `cssVars.js` and the validator both go through here so they can never
 * disagree about the order of operations (ramp -> pins -> contrast).
 */
export function resolvePalette(themeSpec, contrastLevel = 'normal') {
    const mode = themeSpec?.mode === 'light' ? 'light' : 'dark';
    return applyContrast(buildPalette(themeSpec), contrastLevel, mode);
}
