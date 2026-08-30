'use strict';
/**
 * validate-themes.mjs — verification gate 3 of the theming contract (spec §6.3).
 *
 * WHY THIS SCRIPT EXISTS
 * The theme system generates ~230 CSS custom properties per theme from a handful
 * of OKLCH lightness tables, and there are 12 themes. Nobody can eyeball whether
 * `text-amber-100` is still readable on `bg-amber-900` in "Night Shift" after
 * someone nudges one number in ACCENT_L. That is a machine's job. This script is
 * the machine: it imports the SAME modules the browser bundle imports, builds
 * every palette, and measures WCAG 2.1 contrast on the actual emitted hexes.
 *
 * WHY IT IMPORTS THE REAL MODULES RATHER THAN RE-DERIVING
 * A validator that reimplements the ramp validates the reimplementation. Every
 * number below comes out of `src/theme/ramp.js` via `resolvePalette()`, which is
 * the exact entry point `cssVars.js` uses — so the order of operations
 * (ramp -> per-theme hex pins -> contrast axis) can never diverge between what
 * ships and what is measured. This is why ramp.js / themes.js / prefs.js are
 * required to stay React-free plain ESM: `node` has to be able to load them.
 *
 * WHY THE INSTRUMENT IS SELF-TESTED FIRST
 * A contrast validator that is quietly wrong is worse than no validator, because
 * it launders bad colour as verified. So before touching a theme we assert known
 * WCAG values (black on white is exactly 21:1; #767676 on white is the canonical
 * 4.54:1 AA boundary grey). If those fail we abort with exit 2 and report NOTHING
 * about the themes — a broken ruler must not produce measurements.
 *
 * WHAT IT DOES NOT DO
 * It does not edit the ramp tables. Its output is evidence, and tuning the tables
 * is a separate, deliberate step.
 *
 * Usage:
 *   node scripts/validate-themes.mjs            # matrices + failure list
 *   node scripts/validate-themes.mjs --verbose  # every individual check
 *   node scripts/validate-themes.mjs --json     # machine-readable result
 *   node scripts/validate-themes.mjs --scan     # every derived gate scope, with its call sites
 *
 * Exit codes: 0 all gates pass · 1 one or more gates fail · 2 instrument broken.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolvePalette,
    contrastRatio,
    relativeLuminance,
    hexToOklch,
    inHueBand,
    HUE_NAMES,
    HUES,
    SHADES,
    NEUTRAL_ALIASES,
} from '../src/theme/ramp.js';
import { THEMES, PRESETS, DEFAULT_THEME_ID } from '../src/theme/themes.js';
import { PREF_SCHEMA, PREF_BY_KEY, defaultPrefs } from '../src/theme/prefs.js';
import { buildChartTheme } from '../src/theme/chartPalette.js';
// The blue-light overlay is a live DOM layer, so its colour, blend mode and
// opacity are read out of the module that SHIPS it rather than copied here —
// same rule as the ramp: a validator that restates a constant validates the
// restatement. `warmOverlayStyle` is the exact object ThemeProvider renders.
import { warmOverlayStyle, buildPrefsCss } from '../src/theme/cssVars.js';

// ─────────────────────────────────────────────────────────────────────────────
// Gates (spec §6.3, verbatim)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WCAG 2.1 AA for normal-size text is 4.5:1; 3.0:1 is the large-text/UI-component
 * threshold. `fg-6` gets 3.0 because its role is disabled labels and 7-occurrence
 * stray text, never body copy. Borders get 1.6:1 — well under any WCAG number on
 * purpose: 1.4.11 exempts purely decorative boundaries, but a border you cannot
 * see at all makes a card stop being a card, and 1.6 is about where a 1px rule
 * becomes reliably visible on a cheap panel.
 */
const GATE = {
    ink: 4.5,
    inkFaint: 3.0,
    accentInk: 4.5,
    onAccent: 4.5,
    border: 1.6,
    /**
     * `--color-line-0` is the DIVIDER role — a rule inside a card, a table row
     * separator — and it is specified as a ratio rather than a lightness
     * (ramp.js LINE_0_RATIO = 1.40). It gets its own floor because the 1.60 above
     * is the wrong instrument for it: at 1.60 it would stop being the subtlest of
     * the four line levels and start competing with `--color-line`, which is the
     * one border that outlines the card. 1.25 is the bottom of the band the ramp
     * targets (1.40 solved, less 0.15 of headroom for hex quantisation and for a
     * theme whose card sits somewhere the solver cannot hit exactly).
     */
    divider: 1.25,
    /** Ink on an alpha wash is still body text, so it answers to the same 4.5. */
    wash: 4.5,
};

/** Surfaces text and borders actually land on (spec §2d). */
const SURFACES = [
    { token: '--color-bg', label: 'bg' },
    { token: '--color-bg-2', label: 'bg-2' },
    { token: '--color-card', label: 'card' },
    { token: '--color-card-2', label: 'card-2' },
];

/** The six ink levels and the gate each one answers to. */
const INKS = [
    { token: '--color-fg', label: 'fg', gate: GATE.ink },
    { token: '--color-fg-2', label: 'fg-2', gate: GATE.ink },
    { token: '--color-fg-3', label: 'fg-3', gate: GATE.ink },
    { token: '--color-fg-4', label: 'fg-4', gate: GATE.ink },
    { token: '--color-fg-5', label: 'fg-5', gate: GATE.ink },
    { token: '--color-fg-6', label: 'fg-6', gate: GATE.inkFaint },
];

const BORDERS = [
    { token: '--color-line', label: 'line' },
    { token: '--color-line-2', label: 'line-2' },
    { token: '--color-line-3', label: 'line-3' },
];

/**
 * All four line levels, including the divider `--color-line-0`, which is NOT in
 * the matrix above on purpose: it is specified at ~1.25-1.5:1 and the matrix
 * gates at 1.60, so putting it there would fail eleven of the twelve themes on a
 * token that is behaving exactly as designed. It is gated below instead, against
 * the card it is solved against, at GATE.divider. This list is what the
 * structural assertions sweep.
 */
const LINE_TOKENS = [
    { token: '--color-line-0', label: 'line-0' },
    ...BORDERS,
];

/**
 * THE NEUTRAL RAISED-FILL BAND — surfaces that ink lands on and that nothing
 * above this line ever measured.
 *
 * WHY THIS EXISTS. `SURFACES` covers bg / bg-2 / card / card-2, which is where
 * text sits when it sits on the page. It is not where all of it sits: the deeper
 * shades of the neutral ramp are BACKGROUNDS too (`bg-slate-700` on a button, a
 * chip, a table header), and the scan below finds hundreds of className strings
 * putting `text-fg-*` directly on one — the run prints the live count rather
 * than repeating one here. Because those shades were absent from `SURFACES`,
 * the entire ink-on-fill region was unmeasured — and that is precisely where the
 * two critical defects of the 5-lens review lived: on the high-contrast light
 * theme, ink on `bg-slate-700` measured 2.71:1, and 1.28:1 at the 'max' contrast
 * level that theme's own preset recommends. Every gate in this file was green
 * while a theme built for low vision rendered grey on grey.
 *
 * These are declared separately from `SURFACES` rather than appended to it
 * because a fill is not a page: the border matrix has no business measuring
 * `line-2` against `bg-slate-500`, and the accent tint band is not a wash over a
 * chip. Only the ink matrix crosses this set.
 *
 * `slate` stands for all five neutral aliases — ramp.js emits `gray|zinc|neutral|
 * stone` from the same table, and `alias fidelity` below asserts that rather
 * than assuming it.
 *
 * WHICH shades are in the band is DERIVED from the source tree, not listed here.
 * See the call-site scan immediately below for why.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The call-site scan — which of these combinations the app actually PAINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY THE SCOPE IS SCANNED AND NOT WRITTEN DOWN.
 *
 * Three of the gates in this file are scoped by "which combinations ship": which
 * (ink, neutral fill) pairs exist, which (accent ink, accent wash) cells exist,
 * and which `bg-primary/N` alphas exist. Those used to be hand-written lists,
 * with the counts recorded in a comment — and that is exactly how this file went
 * quietly wrong. The ledger at the end of the run carried seven `wash/accent`
 * entries excusing `bg-{hue}-700/{40,50,60}` under accent ink, with site counts
 * (22, 1, 2, 1, 2, 3, 2) frozen at the moment they were typed. A later codemod
 * moved sixty of those tokens from shade 700 to shade 800, and the whole class of
 * defect ceased to exist — but the ledger could not tell, so it kept lowering
 * eight real gates to floors as low as 2.50 for a defect that had been REPAIRED.
 * A lowered gate that cannot notice its own debt being repaid is not a record of
 * debt; it is a hole, and the next real failure to land in that cell would have
 * passed straight through it.
 *
 * The same staleness cuts the other way and did: `bg-{hue}-500/{10,20,30}` under
 * `text-{hue}-{300,400}` is 33 shipped call sites, and because no hand-written
 * list mentioned shade 500 the region was never measured at all. It fails.
 *
 * So the scope is DERIVED, on every run, from the tree as it is. If a codemod
 * repays a debt the entry goes stale and the run says so; if a new className
 * lands on a combination nobody measured, it is measured the next time this
 * script runs. The one thing this must never do is silently find nothing —
 * a scan that reads zero files would disable every gate it scopes, so its own
 * output is a known-answer test in the instrument self-test block below, and a
 * scan that comes back empty aborts the run with exit 2 like any broken ruler.
 *
 * WHAT COUNTS AS A "PAINT CONTEXT". Tailwind classes only mean anything relative
 * to the other classes on the SAME element, so the unit is one class string. This
 * is not parsed — a parser would need to be right about JSX text, regex literals
 * and apostrophes to stay in sync, and being wrong would silently DROP pairs.
 * Instead the source is SPLIT on characters that cannot occur inside a class
 * string (quotes, backticks, braces, angle brackets, parens, commas, semicolons,
 * equals, newline). Splitting cannot desynchronise: a quote inside JSX prose just
 * splits prose. Template literals get one extra step — each `${...}` is scanned
 * recursively AS ITS OWN SOURCE (so the two arms of an embedded ternary stay two
 * separate renders) and is then erased from the parent before the parent is split
 * (so `bg-x ${flag} text-y` still reads as one element's classes).
 */
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SCAN_SOURCE_EXT = /\.(?:jsx?|tsx?)$/;
const CONTEXT_DELIMITERS = /['"`\n{}<>();,=]/;

/** Every source file under `src/`, in a stable order so two runs agree. */
function sourceFiles(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sourceFiles(p, out);
        else if (SCAN_SOURCE_EXT.test(e.name)) out.push(p);
    }
    return out;
}

/** Balanced `${ … }` spans, so a template can be decomposed rather than guessed at. */
function interpolationSpans(src) {
    const out = [];
    for (let i = 0; i < src.length - 1; i++) {
        if (src[i] !== '$' || src[i + 1] !== '{') continue;
        let depth = 0;
        for (let j = i + 1; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') {
                depth--;
                if (depth === 0) { out.push({ start: i, end: j, body: src.slice(i + 2, j) }); i = j; break; }
            }
        }
    }
    return out;
}

/**
 * Source text -> the class strings inside it, with a line number each.
 *
 * `depth` bounds the interpolation recursion; six is far past anything real and
 * stops a pathological template from running away.
 *
 * WHY THE OFFSET MAPPING IS CARRIED. Erasing `${…}` from the parent also erases
 * any newlines inside it, so counting lines in the SHORTENED text puts the
 * report's `file:line` several lines early — and the whole point of naming a
 * call site in a ledger entry is that the next person can open it. `origAt[i]`
 * is the offset in the untouched source that `stripped[i]` came from, and `nl`
 * is a prefix count of newlines, so every fragment reports the line it is really
 * on. (Verified against DeploymentsPanel.jsx:601/618, which sit inside 20-line
 * template literals and were the two that drifted.)
 */
function paintContexts(src, baseLine = 1, depth = 0, out = []) {
    if (depth > 6) return out;
    const nl = new Int32Array(src.length + 1);
    for (let i = 0; i < src.length; i++) nl[i + 1] = nl[i] + (src[i] === '\n' ? 1 : 0);

    const spans = interpolationSpans(src);
    let stripped = '';
    const origAt = [];
    let at = 0;
    for (const s of spans) {
        // `+ 2` steps past the `${` so the nested source's first line is right.
        paintContexts(s.body, baseLine + nl[s.start + 2], depth + 1, out);
        for (let i = at; i < s.start; i++) { stripped += src[i]; origAt.push(i); }
        stripped += ' ';
        origAt.push(s.start);
        at = s.end + 1;
    }
    for (let i = at; i < src.length; i++) { stripped += src[i]; origAt.push(i); }

    let start = 0;
    const emit = (from, to) => {
        if (to <= from) return;
        const frag = stripped.slice(from, to);
        if (frag.includes('-')) out.push({ text: frag, line: baseLine + nl[origAt[from]] });
    };
    for (let i = 0; i < stripped.length; i++) {
        if (!CONTEXT_DELIMITERS.test(stripped[i])) continue;
        emit(start, i);
        start = i + 1;
    }
    emit(start, stripped.length);
    return out;
}

/**
 * One class string -> the (ink, surface) pairs it renders.
 *
 * VARIANT MODEL. A prefix (`hover:`, `disabled:`, `md:`, `group-hover:`) makes a
 * class conditional on a state, so a fill only ever meets the ink that is live in
 * the SAME state: the ink whose prefix matches exactly, or failing that the
 * unprefixed one. Without this, `disabled:bg-slate-700 disabled:text-fg-5
 * text-white` reports white ink on a dark fill that white never touches — a
 * fabricated pair, which is the same disease as a stale count.
 *
 * INACTIVE CONTROLS. WCAG 1.4.3 exempts "an inactive user interface component"
 * from the contrast minimum, which is why `fg-5` on a raised fill is gated at 3.0
 * rather than 4.5. That exemption is DETECTED, not asserted: a context carrying
 * `disabled:` or `cursor-not-allowed` is an inactive control. If someone reuses
 * that pairing on a live button, the flag flips and the floor goes back to 4.5.
 */
function pairsInContext(text) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;

    const inactive = words.some((w) => w === 'cursor-not-allowed' || w.startsWith('disabled:'));
    const neutralFills = [];
    const accentFills = [];
    const primaryFills = [];
    const fgInks = [];
    const accentInks = [];
    const primaryInks = [];

    for (const raw of words) {
        const i = raw.lastIndexOf(':');
        const key = i < 0 ? '' : raw.slice(0, i);
        const w = i < 0 ? raw : raw.slice(i + 1);
        let m;
        if ((m = /^bg-([a-z]+)-(\d{2,3})(?:\/(\d{1,3}))?$/.exec(w))) {
            const hit = { key, family: m[1], shade: Number(m[2]), alpha: m[3] ? Number(m[3]) : null };
            if (HUE_NAMES.includes(hit.family)) accentFills.push(hit);
            else if (NEUTRAL_ALIASES.includes(hit.family)) neutralFills.push(hit);
        } else if ((m = /^bg-primary(?:\/(\d{1,3}))?$/.exec(w))) {
            primaryFills.push({ key, alpha: m[1] ? Number(m[1]) : null });
        } else if ((m = /^text-([a-z]+)-(\d{2,3})$/.exec(w))) {
            if (HUE_NAMES.includes(m[1])) accentInks.push({ key, family: m[1], shade: Number(m[2]) });
        } else if ((m = /^text-(fg(?:-\d)?)$/.exec(w))) {
            fgInks.push({ key, label: m[1] });
        } else if (/^text-primary(?:-ink)?$/.test(w)) {
            primaryInks.push({ key });
        }
    }

    // The ink live in the fill's own state: exact prefix match, else unprefixed.
    const live = (inks, key, pred) => {
        const exact = inks.filter((x) => x.key === key && (!pred || pred(x)));
        return exact.length ? exact : inks.filter((x) => x.key === '' && (!pred || pred(x)));
    };

    const fill = [];
    const wash = [];
    const primary = [];
    // An OPAQUE neutral background is a fill; an alpha-modified one is a wash over
    // whatever is behind it, which this scan cannot know, so it is left alone.
    for (const f of neutralFills) {
        if (f.alpha !== null) continue;
        for (const ink of live(fgInks, f.key)) fill.push(`${ink.label}|${f.shade}`);
    }
    // An accent wash is only meaningful under its OWN family's ink — a red badge
    // reads red text. A cross-family pairing is a different question and is not
    // what the wash matrix measures.
    for (const f of accentFills) {
        if (f.alpha === null) continue;
        for (const ink of live(accentInks, f.key, (x) => x.family === f.family)) wash.push(`${ink.shade}|${f.shade}|${f.alpha}`);
    }
    for (const f of primaryFills) {
        if (f.alpha === null) continue;
        for (const _ of live(primaryInks, f.key)) primary.push(String(f.alpha));
    }
    return { fill, wash, primary, inactive };
}

/**
 * The scanner applied to a literal snippet, flattened to a sorted list of pair
 * keys. This exists so the SCANNER can be given known-answer tests in the same
 * block as the ruler — see SELF_TESTS. It runs the real pipeline
 * (paintContexts -> pairsInContext), so a fixture cannot pass while the scan of
 * the tree does something else.
 */
function scanFixture(snippet) {
    const found = new Set();
    for (const ctx of paintContexts(snippet)) {
        const p = pairsInContext(ctx.text);
        if (!p) continue;
        for (const k of p.fill) found.add(`fill:${k}`);
        for (const k of p.wash) found.add(`wash:${k}`);
        for (const k of p.primary) found.add(`primary:${k}`);
    }
    return [...found].sort();
}

/** Walk `src/`, bucket every pair by kind, and remember where each one came from. */
function scanCallSites() {
    const files = sourceFiles(SRC_ROOT);
    const fill = new Map();     // `${inkLabel}|${shade}`      -> { active: [where], inactive: [where] }
    const wash = new Map();     // `${inkShade}|${fill}|${a}`  -> [where]
    const primary = new Map();  // `${alpha}`                  -> [where]
    let contexts = 0;

    const push = (map, key, where) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(where);
    };

    for (const file of files) {
        let src;
        try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const rel = `src/${path.relative(SRC_ROOT, file)}`;
        for (const ctx of paintContexts(src)) {
            const p = pairsInContext(ctx.text);
            if (!p) continue;
            contexts++;
            const where = `${rel}:${ctx.line}`;
            for (const key of p.fill) {
                if (!fill.has(key)) fill.set(key, { active: [], inactive: [] });
                (p.inactive ? fill.get(key).inactive : fill.get(key).active).push(where);
            }
            for (const key of p.wash) push(wash, key, where);
            for (const key of p.primary) push(primary, key, where);
        }
    }
    return { files, contexts, fill, wash, primary };
}

const SITES = scanCallSites();

/** `fg-4|700` -> the ink row it belongs to, or null for an ink this file does not gate. */
const inkForKey = (key) => INKS.find((i) => i.label === key.split('|')[0]) || null;

/**
 * The raised-fill band, derived. Every neutral shade the app puts a `--color-fg-*`
 * token on, darkest first.
 *
 * Shades 900 and 800 land here as well as in `SURFACES`, and that is not
 * redundant: `--color-bg` and `--color-slate-900` are the SAME hex on eleven of
 * the twelve themes and DIFFERENT on the twelfth, because the default theme pins
 * its page and card to the legacy stylesheet's `#0e1117` / `#262730` while the
 * neutral ramp keeps Tailwind's `#0f172a` / `#1d293d`. 102 `bg-{neutral}-900`
 * call sites render against the second pair, not the first, so measuring only the
 * semantic token would be measuring a colour those call sites do not paint.
 */
const FILLS = [...new Set([...SITES.fill.keys()].filter(inkForKey).map((k) => Number(k.split('|')[1])))]
    .sort((a, b) => b - a)
    .map((shade) => ({ token: `--color-slate-${shade}`, label: `fill-${shade}`, shade }));

/**
 * WHICH INK LEVELS EACH FILL IS GATED FOR — scope from the scan, floors from the
 * two numbers the rest of this file already uses.
 *
 * A pair is gated at its ink's own floor (4.5 for body copy, 3.0 for `fg-6`),
 * dropped to 3.0 when EVERY site that paints it is an inactive control. Nothing
 * is gated that the app does not paint: a cell with no call sites is still
 * measured, still printed with a `·`, and still bound by the contrast-axis
 * ratchet, but asserting a floor on it would be asserting something the ramp's
 * own role tables contradict. In dark mode `NEUTRAL_L[500]` is 0.554 and `FG_L[6]`
 * is 0.565 — the deepest fill and the faintest ink are DECLARED to share a
 * lightness, because they are declared never to meet. A gate no palette can pass
 * teaches a reader to ignore the report.
 */
const FILL_INK_GATE = {};
for (const [key, hits] of SITES.fill) {
    const ink = inkForKey(key);
    if (!ink) continue;
    const shade = Number(key.split('|')[1]);
    if (!FILL_INK_GATE[shade]) FILL_INK_GATE[shade] = {};
    FILL_INK_GATE[shade][ink.label] = hits.active.length ? ink.gate : Math.min(ink.gate, GATE.inkFaint);
}

/**
 * ALPHA WASHES — `bg-primary/20`, `bg-emerald-500/20`.
 *
 * Tailwind v4 emits these as `color-mix(in oklab, var(--color-X) N%, transparent)`,
 * which over an opaque backdrop composites to `a*X + (1-a)*backdrop` per channel
 * in sRGB. Nothing here measured them before, and a wash is not a colour the
 * palette contains — it is a colour the BROWSER makes at paint time out of two
 * tokens and a number in a className. That is why the review found accent ink
 * sitting on its own wash at 2.0:1 with every gate in this file green.
 *
 * Both sets are the scan's, so every cell measured is a cell that ships and every
 * cell that ships is measured. There is no ungated half of this block any more:
 * the previous hand-written set gated eight cells with a combined ZERO call sites
 * while fifty-one real ones went unmeasured.
 */
const PRIMARY_WASH_ALPHAS = [...SITES.primary.keys()].map(Number).sort((a, b) => a - b);

const ACCENT_WASH_CELLS = [...SITES.wash.entries()]
    .map(([key, where]) => {
        const [ink, fill, alpha] = key.split('|').map(Number);
        return { key, ink, fill, alpha, sites: where };
    })
    .sort((a, b) => a.fill - b.fill || a.alpha - b.alpha || a.ink - b.ink);

/** The distinct fill shades and alphas present, for the report's grid. */
const ACCENT_WASH_FILLS = [...new Set(ACCENT_WASH_CELLS.map((c) => c.fill))].sort((a, b) => a - b);

/**
 * The two backdrops a wash is painted over. Every wash check measures BOTH and
 * gates the worse of the two, naming it in the note. Which one binds is not
 * predictable from the mode — it depends on whether the ink sits above or below
 * the composite — so picking one a priori would silently drop half the coverage.
 */
const WASH_BACKDROPS = [
    { token: '--color-card', label: 'card' },
    { token: '--color-bg', label: 'page' },
];

/**
 * Accent shade bands, by ROLE (spec §2c). The audit is what makes these the right
 * three groups: `text-HUE-{100..400}` is 903 occurrences of ink, `bg-HUE-{900,950}`
 * is 189 occurrences of tint, `bg-HUE-{500,600,700}` is 293 occurrences of solid
 * fill. Nothing else in the accent ramp is load-bearing.
 */
const INK_SHADES = [100, 200, 300, 400];
const TINT_SHADES = [900, 950];
const SOLID_SHADES = [500, 600, 700];

/**
 * Contrast-axis levels are read out of the prefs SCHEMA rather than hardcoded, so
 * adding a fourth level to `prefs.js` automatically extends this gate instead of
 * silently escaping it. Falls back to ['normal'] so a prefs.js that has not
 * declared the axis yet produces a degraded run rather than a crash.
 */
const CONTRAST_LEVELS = (PREF_BY_KEY.contrast?.options || []).map((o) => o.value);
if (!CONTRAST_LEVELS.length) CONTRAST_LEVELS.push('normal');
/** The level the gate is evaluated at: whatever a user gets before touching anything. */
const BASE_CONTRAST = CONTRAST_LEVELS.includes(PREF_BY_KEY.contrast?.default)
    ? PREF_BY_KEY.contrast.default
    : CONTRAST_LEVELS[0];

/**
 * Tolerances. All three exist because the palette is quantised to 8-bit hex on
 * the way out of the ramp, so a value can move by up to ~1/255 per channel for
 * reasons that have nothing to do with the design.
 *
 *  RATIO_EPS  a contrast ratio may wobble at the second decimal from rounding
 *             alone; the monotonicity assertion must not fire on that.
 *  CHROMA_EPS same, expressed in OKLCH chroma, for the eyecare chroma cap.
 *  HUE_TOL    hue is the LEAST stable measurement at low chroma (it is an
 *             arctangent of two small numbers), so the blue-band assertion insets
 *             the band by 3 degrees and ignores anything under CHROMA_FLOOR. A
 *             genuine unsuppressed blue sits 70+ degrees inside the band, so the
 *             inset costs the check nothing.
 */
const RATIO_EPS = 0.02;
const CHROMA_EPS = 0.004;
const HUE_TOL = 3;
const CHROMA_FLOOR = 0.02;

// ─────────────────────────────────────────────────────────────────────────────
// Instrument self-test
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known-answer tests for the colour maths, from the WCAG 2.1 definition itself.
 * #767676 is the reference case: it is the lightest pure grey that still clears
 * 4.5:1 on white, and every accessibility tool in existence reports 4.54 for it.
 * If we report something else, our ramp numbers are fiction.
 */
const SELF_TESTS = [
    ['relativeLuminance(#ffffff) === 1', () => relativeLuminance('#ffffff'), 1, 1e-9],
    ['relativeLuminance(#000000) === 0', () => relativeLuminance('#000000'), 0, 1e-9],
    ['relativeLuminance(#767676) === 0.1811', () => relativeLuminance('#767676'), 0.1811, 5e-4],
    ['black on white === 21:1', () => contrastRatio('#000000', '#ffffff'), 21, 1e-6],
    ['white on black === 21:1 (symmetric)', () => contrastRatio('#ffffff', '#000000'), 21, 1e-6],
    ['white on white === 1:1', () => contrastRatio('#ffffff', '#ffffff'), 1, 1e-9],
    ['#767676 on white === 4.54:1 (AA boundary grey)', () => contrastRatio('#767676', '#ffffff'), 4.54, 5e-3],
    ['#777777 on white just FAILS AA', () => contrastRatio('#777777', '#ffffff'), 4.48, 1e-2],
    ['3-digit hex parses like 6-digit', () => contrastRatio('#fff', '#000000'), 21, 1e-6],
    // The other two canonical boundary greys on white: #595959 is the AAA (7:1)
    // edge and #808080 the 3.95:1 mid-grey. Three independent points on the
    // gamma+luminance curve, not one, so a transfer-function error cannot hide.
    ['#595959 on white === 7.00:1 (AAA boundary grey)', () => contrastRatio('#595959', '#ffffff'), 7.005, 5e-3],
    ['#808080 on white === 3.95:1', () => contrastRatio('#808080', '#ffffff'), 3.949, 5e-3],
    ['contrast is order-independent', () => contrastRatio('#0f172a', '#62748e') - contrastRatio('#62748e', '#0f172a'), 0, 1e-12],
    ['oklch->hex->oklch preserves L', () => hexToOklch('#1d293d').L, 0.279, 2e-3],
    ['oklch->hex->oklch preserves H', () => hexToOklch('#1d293d').H, 260.0, 1.0],
    // The two composites below are colours the browser makes and the palette
    // never holds, so they get the same known-answer treatment as the ruler
    // itself. A wrong wash or a wrong overlay gain would launder a real failure
    // as a pass just as effectively as a wrong luminance curve.
    ['wash: alpha 0 returns the backdrop exactly', () => contrastRatio(washOver('#ffffff', '#0e1117', 0), '#0e1117'), 1, 1e-12],
    ['wash: alpha 1 returns the source exactly', () => contrastRatio(washOver('#ff4b4b', '#0e1117', 1), '#ff4b4b'), 1, 1e-12],
    ['wash: 50% white over black === #808080', () => relativeLuminance(washOver('#ffffff', '#000000', 0.5)), 0.2159, 5e-4],
    ['overlay: blend mode is still multiply', () => (warmOverlayStyle({ blueLight: 45 }).mixBlendMode === 'multiply' ? 1 : 0), 1, 0],
    ['overlay: gain at 0% is identity (R)', () => warmGain(0)[0], 1, 1e-12],
    ['overlay: gain at 0% is identity (B)', () => warmGain(0)[2], 1, 1e-12],
    ['overlay: R gain at 45% === 1.000', () => warmGain(45)[0], 1.0, 1e-9],
    ['overlay: G gain at 45% === 0.9241', () => warmGain(45)[1], 0.9241, 5e-4],
    ['overlay: B gain at 45% === 0.8376', () => warmGain(45)[2], 0.8376, 5e-4],
    // The load-bearing one. A multiply applied to BOTH the ink and the surface
    // looks like it should cancel out of a ratio, and it does not — the gain is
    // applied to non-linear sRGB, so the two sides move by different amounts once
    // the transfer function is undone. White on the default page goes 18.90 ->
    // 16.53 under a 45% warm filter (ink #ffffff -> #ffecd6, page #0e1117 ->
    // #0e1013). If this ever measures 0, the overlay pass has become a no-op and
    // every combination check below is theatre.
    ['overlay: multiplying both sides still moves the ratio',
        () => contrastRatio(warmApply('#ffffff', warmGain(45)), warmApply('#0e1117', warmGain(45)))
            - contrastRatio('#ffffff', '#0e1117'), -2.366, 5e-3],

    // ── the call-site scan is part of the instrument ────────────────────────
    //
    // Three gate SCOPES are derived from that scan, so a scan that silently
    // returns nothing does not fail — it DISABLES those gates and reports a
    // clean run over an unmeasured palette. That is a worse outcome than a bad
    // ruler, because it looks like success. The floors below are far under the
    // real numbers (45 files, ~4,000 contexts) and exist only to separate
    // "found the tree" from "found nothing", so a normal refactor never trips
    // them and a broken path always does.
    ['scan: read the source tree', () => (SITES.files.length >= 20 ? 1 : 0), 1, 0],
    ['scan: found class strings', () => (SITES.contexts >= 200 ? 1 : 0), 1, 0],
    ['scan: found ink on neutral fills', () => (FILLS.length >= 2 ? 1 : 0), 1, 0],
    ['scan: found accent washes', () => (ACCENT_WASH_CELLS.length >= 10 ? 1 : 0), 1, 0],
    ['scan: found primary washes', () => (PRIMARY_WASH_ALPHAS.length >= 1 ? 1 : 0), 1, 0],

    // Known-answer tests for the SCANNER, on the same principle as the ones for
    // the ruler: the three behaviours below are the ones whose failure mode is a
    // wrong SCOPE rather than a crash, and a wrong scope is invisible in the
    // output. Each fixture is a shape that really occurs in this codebase.
    //
    //  1. the variant model, both directions. The disabled-button shape (this
    //     fixture is TickStrategies.jsx:455 with its on-accent ink swapped for an
    //     fg level) must pair the grey fill ONLY with the ink that is live while
    //     the button is disabled — a variant-blind scan also reports `fg-2` on a
    //     dark grey chip that `fg-2` never touches, and would gate a fabricated
    //     pair. The second fixture pins the other half of the same rule: a
    //     `hover:` fill and an UNPREFIXED ink is a real pairing, so a model that
    //     demanded an exact prefix match would silently drop it;
    //  2. interpolation recursion — a ternary inside a template is two renders,
    //     and its arms must not be merged into one context that pairs the fill of
    //     one arm with the ink of the other;
    //  3. interpolation erasure — the SAME syntax with the ternary in the middle
    //     of one element's classes must NOT split that element in two.
    ['scan: a variant-gated fill pairs only with its own state\'s ink',
        () => scanFixture('bg-amber-500 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-fg-5 text-fg-2').join(','),
        'fill:fg-5|700', 0],
    ['scan: an unprefixed ink still pairs with a variant fill',
        () => scanFixture('rounded text-fg-3 hover:bg-slate-600').join(','), 'fill:fg-3|600', 0],
    ['scan: an inactive control is detected, not assumed',
        () => (pairsInContext('bg-slate-700 text-fg-5 cursor-not-allowed').inactive ? 1 : 0), 1, 0],
    ['scan: ternary arms inside a template stay separate renders',
        () => scanFixture('`px-2 ${on ? \'bg-red-500/20 text-red-300\' : \'bg-card text-fg-4\'}`').join(','),
        'wash:300|500|20', 0],
    ['scan: an interpolation does not split one element\'s classes',
        () => scanFixture('`bg-slate-600 ${bold ? \'font-bold\' : \'\'} text-fg-2`').join(','), 'fill:fg-2|600', 0],
];

function runSelfTests() {
    const rows = [];
    let bad = 0;
    for (const [label, fn, expected, tol] of SELF_TESTS) {
        let actual;
        let err = null;
        try {
            actual = fn();
        } catch (e) {
            err = e;
        }
        // Two kinds of known answer. A number is compared inside a tolerance
        // (everything about the colour maths quantises); the scanner's answers
        // are SETS of pairs, which have no tolerance — the scope is either the
        // one the fixture describes or it is wrong — so those are compared as
        // exact strings.
        const ok = err === null && (typeof expected === 'string'
            ? actual === expected
            : (Number.isFinite(actual) && Math.abs(actual - expected) <= tol));
        if (!ok) bad++;
        rows.push({ label, expected, actual, tol, ok, err, text: typeof expected === 'string' });
    }
    return { rows, bad };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const padE = (s, n) => (String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length));
const padS = (s, n) => (String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s));
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—');
const f3 = (n) => (Number.isFinite(n) ? n.toFixed(3) : '—');
const lightness = (hex) => hexToOklch(hex).L;
const chroma = (hex) => hexToOklch(hex).C;

/**
 * A ratio cell, fixed width so columns line up. Four states, because a matrix
 * that renders three different kinds of green as one green is how a report ends
 * up laundering debt:
 *
 *   ✓  passed its real gate
 *   ✗  failed
 *   ·  MEASURED BUT NOT GATED — a cell with no call site behind it; see
 *      FILL_INK_GATE. Not being asked a question is not the same as answering one.
 *   !  passed only a LOWERED gate — a declared exemption or a ledger entry is
 *      holding it up, and the block at the end of the run says which.
 */
const cell = (c) => padS(f2(c.ratio), 6)
    + (c.ungated ? ' ·' : (c.exempt || c.debt) ? ' !' : c.pass ? ' ✓' : ' ✗');

// ─────────────────────────────────────────────────────────────────────────────
// sRGB compositing — the two colours the browser makes that the palette does not
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both of the maths below produce colours that EXIST ON SCREEN but appear in no
 * palette, which is exactly why three of the review's thirteen defects lived
 * here. They are modelled in 8-bit sRGB rather than in OKLab because that is
 * where the compositor does the arithmetic: an alpha blend over an opaque
 * backdrop and a `multiply` blend are both defined per channel on the encoded
 * values, before any colour-space conversion the ramp cares about.
 */

const rgb = (hex) => {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const hex = (channels) => '#' + channels
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');

/**
 * `bg-primary/20` over an opaque backdrop.
 *
 * Tailwind v4 emits `color-mix(in oklab, var(--color-primary) 20%, transparent)`.
 * Mixing with `transparent` in any space yields the same colour at 20% alpha
 * (transparent contributes no colour, only alpha), and painting that over an
 * opaque backdrop is the standard source-over composite — `a*src + (1-a)*dst`
 * per channel. So the wash is a plain sRGB lerp, and `alpha = 0` must return the
 * backdrop untouched, which the self-test asserts.
 */
function washOver(fgHex, backdropHex, alpha) {
    const f = rgb(fgHex);
    const b = rgb(backdropHex);
    return hex(f.map((v, i) => alpha * v + (1 - alpha) * b[i]));
}

/**
 * The blue-light overlay, as a POST-COMPOSITE PASS over the finished screen.
 *
 * It is a fixed, inset-0, pointer-events-none div with `mix-blend-mode: multiply`
 * and `opacity: blueLight/100`, so every pixel underneath it — ink, surface,
 * border, chart, image — is multiplied by the same constant. An opacity-`a`
 * multiply of a source colour `Cs` over a destination `Cd` resolves to
 * `Cd * ((1-a) + a*Cs)`: a per-channel gain that depends only on `a` and the
 * overlay colour. At a = 0.45 against #ffd4a3 that is R 1.000 / G 0.924 /
 * B 0.838 — red untouched, blue cut by a sixth.
 *
 * Why this has to be modelled rather than ignored: the gain is applied to the INK
 * and the SURFACE alike, and because it is multiplicative on non-linear sRGB it
 * does NOT cancel out of a contrast ratio. It compressed one theme's fg-5 from
 * 4.54:1 to 4.40:1 at the 45% its own preset used to recommend — a real AA
 * failure that no palette-level check could see, because the failing colour was
 * never in the palette.
 *
 * The colour, the blend mode and the opacity all come from `warmOverlayStyle`,
 * the function ThemeProvider actually renders the div from.
 */
function warmGain(blueLightPct) {
    const style = warmOverlayStyle({ blueLight: blueLightPct });
    const a = Number(style.opacity) || 0;
    return rgb(style.backgroundColor).map((c) => (1 - a) + a * (c / 255));
}

/** Multiply one hex by a gain triple. */
function warmApply(hexIn, gain) {
    return hex(rgb(hexIn).map((v, i) => v * gain[i]));
}

/**
 * The whole palette seen through the overlay. Only `#rrggbb` values are touched;
 * a palette also carries numbers and `rgb()` strings from the chart layer, and
 * those are left alone rather than mangled.
 */
function warmPalette(palette, blueLightPct) {
    if (!blueLightPct) return palette;
    const gain = warmGain(blueLightPct);
    const out = {};
    for (const [k, v] of Object.entries(palette)) {
        out[k] = (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) ? warmApply(v, gain) : v;
    }
    return out;
}

/** Every check is this shape, so printing, gating and JSON all read one struct. */
function check(group, id, ratio, gate, extra = {}) {
    return { group, id, ratio, gate, pass: ratio >= gate, ...extra };
}

/** A boolean structural assertion, expressed in the same shape as a ratio check. */
function assertion(group, id, pass, detail) {
    return { group, id, ratio: null, gate: null, pass: !!pass, detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// The check matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ink that ACTUALLY lands on a saturated accent fill in this codebase.
 *
 * `--color-white` is deliberately never inverted by any theme (ramp.js says so in
 * as many words), and the audit found 40 `text-white` occurrences sitting on
 * `bg-primary` / `bg-{hue}-{400..950}` which the codemod is instructed to LEAVE
 * ALONE. So white is the shipped on-accent ink for all 17 accent families. The one
 * fill with a dedicated ink token is `--color-primary`, whose partner is
 * `--color-on-primary`.
 *
 * We gate the shipped pairing rather than the best-possible pairing on purpose: a
 * gate that silently swaps in near-black ink would report a button as accessible
 * that renders white-on-amber in the browser. Where the shipped ink fails we
 * attach the ratio the alternative ink would have achieved, so the fix path
 * (darken the fill vs. flip the ink) is visible in the failure line itself.
 */
function onAccentInk(palette) {
    return palette['--color-white'] || '#ffffff';
}

/** Best achievable ratio on this fill with either ink extreme, for the hint. */
function bestInkNote(fillHex, shippedInk) {
    const white = contrastRatio(fillHex, '#ffffff');
    const black = contrastRatio(fillHex, '#000000');
    const best = Math.max(white, black);
    const which = black > white ? 'black' : 'white';
    const shipped = contrastRatio(fillHex, shippedInk);
    if (best - shipped < 0.05) return `no ink reaches the gate on this fill (ceiling ${f2(best)} with ${which})`;
    return `${which} ink would give ${f2(best)}`;
}

/**
 * Does this theme PIN a token, rather than letting the ramp derive it?
 *
 * WHY THE DISTINCTION IS LOAD-BEARING, AND WHY IT IS NOT AN ESCAPE HATCH.
 * `--color-line-0` is the one token in the system whose value is expressed as a
 * RATIO instead of a lightness: ramp.js solves it against each theme's own card
 * at LINE_0_RATIO, because "barely visible" is a relationship, not a colour. A
 * gate at GATE.divider is therefore a check on the SOLVER — did it hit the ratio
 * it promised? Where a theme pins the token instead, the solver never ran, and
 * holding it to the solver's promise is a category error: the number is an input
 * the theme author wrote down, not an output anything derived.
 *
 * The reason a pin exists at all is spec §3, which freezes the default theme's
 * rendered output to the bytes shipping today — and the byte those 81
 * `border-{neutral}-800` call sites render today is a rule you can barely see.
 * A theme cannot be both pixel-identical and improved. Pinning is how that
 * conflict is declared in the DATA, where an exemption belongs.
 *
 * What stops it becoming a way to dodge the gate: a pinned divider is still held
 * to both structural assertions below — it may not be byte-identical to any
 * surface (which is the exact defect this whole token was introduced to fix), and
 * it must still sit BELOW `--color-line` and ABOVE the surface on the presence
 * ladder. And it is reported, loudly, in its own block: a pin buys silence from
 * one ratio gate, never from the report.
 */
function isPinned(theme, token) {
    const tokens = theme?.tokens || {};
    return token in tokens || `--color-${token}` in tokens;
}

/**
 * collectChecks(palette, theme) -> flat array of checks.
 *
 * Order is deterministic and independent of the palette values, which is what lets
 * the contrast-axis monotonicity test zip three runs together index by index.
 */
function collectChecks(palette, theme) {
    const out = [];

    // ── ink on surface ──────────────────────────────────────────────────────
    for (const ink of INKS) {
        for (const surf of SURFACES) {
            out.push(check(
                'ink/surface',
                `${ink.label} on ${surf.label}`,
                contrastRatio(palette[ink.token], palette[surf.token]),
                ink.gate,
            ));
        }
    }

    // ── ink on the neutral raised-fill band ─────────────────────────────────
    // The region SURFACES does not cover. Scope and floors are FILL_INK_GATE's;
    // an undefined entry means "measured, printed, ratcheted, not gated", which
    // is carried as gate 0 so the cell can never fail while still being a real
    // number in the JSON and in the monotonicity zip.
    for (const ink of INKS) {
        for (const fill of FILLS) {
            const gate = FILL_INK_GATE[fill.shade]?.[ink.label];
            out.push(check(
                'ink/fill',
                `${ink.label} on ${fill.label}`,
                contrastRatio(palette[ink.token], palette[fill.token]),
                gate ?? 0,
                gate === undefined ? { ungated: true } : {},
            ));
        }
    }

    // ── the divider, against the card it is solved against ──────────────────
    // `--color-line-0` is the token that replaced 81 `border-{neutral}-800` call
    // sites which drew NO BORDER AT ALL — shade 800 IS the card token, so on
    // eleven of the twelve themes the two hexes were byte-identical and the pair
    // measured exactly 1.0000:1. It gets the divider floor rather than the border
    // floor because it is designed to be the subtlest of the four line levels;
    // see GATE.divider. A theme that PINS the token is handled by the structural
    // assertions instead — see `isPinned`, which is where that distinction is
    // argued.
    {
        const pinned = isPinned(theme, 'line-0');
        out.push(check(
            'divider',
            'line-0 on card',
            contrastRatio(palette['--color-line-0'], palette['--color-card']),
            pinned ? 0 : GATE.divider,
            pinned
                ? { ungated: true, pinned: `the theme pins --color-line-0; the ramp did not solve it, so ${f2(GATE.divider)} is not a promise anything made about this value` }
                : {},
        ));
    }

    // ── ink on an alpha wash ────────────────────────────────────────────────
    // One check per wash step, measured over BOTH backdrops and gated on the
    // worse of the two. `--color-primary-ink` is the token that exists precisely
    // because `--color-primary` could not do this job: the primary hue re-cut at
    // the ink role. `collectStructure` asserts it still beats the token it
    // replaced, so this gate and that assertion together say "the fix works AND
    // it is still the fix".
    const worstOverBackdrops = (inkHex, washHex, alpha) => {
        let worst = { ratio: Infinity, label: '' };
        for (const bd of WASH_BACKDROPS) {
            const composited = washOver(washHex, palette[bd.token], alpha / 100);
            const ratio = contrastRatio(inkHex, composited);
            if (ratio < worst.ratio) worst = { ratio, label: bd.label, composited };
        }
        return worst;
    };

    for (const alpha of PRIMARY_WASH_ALPHAS) {
        const w = worstOverBackdrops(palette['--color-primary-ink'], palette['--color-primary'], alpha);
        out.push(check(
            'wash/primary',
            `primary-ink on bg-primary/${alpha}`,
            w.ratio,
            GATE.wash,
            { note: `over ${w.label} (${w.composited})` },
        ));
    }

    // The accent band, one check per SHIPPED cell, collapsed to the WORST hue.
    // 17 hues x 2 backdrops is 34 numbers behind each cell, which is a data dump
    // rather than a report; the worst hue is the number the gate turns on, and it
    // is named in the note, so a single-hue regression still fails its own cell.
    // Every cell here has at least one call site by construction — the set comes
    // from the scan — so unlike the fill matrix there is no ungated half.
    for (const cell of ACCENT_WASH_CELLS) {
        let worst = { ratio: Infinity, family: '', label: '' };
        for (const family of HUE_NAMES) {
            const w = worstOverBackdrops(
                palette[`--color-${family}-${cell.ink}`],
                palette[`--color-${family}-${cell.fill}`],
                cell.alpha,
            );
            if (w.ratio < worst.ratio) worst = { ...w, family };
        }
        out.push(check(
            'wash/accent',
            `accent-${cell.ink} on bg-${cell.fill}/${cell.alpha}`,
            worst.ratio,
            GATE.wash,
            { note: `worst hue ${worst.family} over ${worst.label} · ${cell.sites.length} call site(s), e.g. ${cell.sites[0]}` },
        ));
    }

    // ── borders vs the surfaces they separate ───────────────────────────────
    for (const b of BORDERS) {
        for (const surf of SURFACES) {
            out.push(check(
                'border/surface',
                `${b.label} on ${surf.label}`,
                contrastRatio(palette[b.token], palette[surf.token]),
                GATE.border,
            ));
        }
    }

    // ── accent ink band ─────────────────────────────────────────────────────
    // Ink on its own tint (the `bg-emerald-900` + `text-emerald-300` badge that
    // appears all over this UI), and the same ink on a plain card (which is how
    // most of the 903 `text-HUE-*` occurrences are actually used).
    const ink = onAccentInk(palette);
    for (const family of HUE_NAMES) {
        for (const inkShade of INK_SHADES) {
            const inkHex = palette[`--color-${family}-${inkShade}`];
            for (const tintShade of TINT_SHADES) {
                out.push(check(
                    'accent-ink/tint',
                    `text-${family}-${inkShade} on bg-${family}-${tintShade}`,
                    contrastRatio(inkHex, palette[`--color-${family}-${tintShade}`]),
                    GATE.accentInk,
                ));
            }
            out.push(check(
                'accent-ink/card',
                `text-${family}-${inkShade} on card`,
                contrastRatio(inkHex, palette['--color-card']),
                GATE.accentInk,
            ));
        }

        // ── solid band as a button background ───────────────────────────────
        for (const solidShade of SOLID_SHADES) {
            const fill = palette[`--color-${family}-${solidShade}`];
            const ratio = contrastRatio(fill, ink);
            out.push(check(
                'solid/on-accent',
                `on-accent text on bg-${family}-${solidShade}`,
                ratio,
                GATE.onAccent,
                ratio >= GATE.onAccent ? {} : { note: bestInkNote(fill, ink) },
            ));
        }
    }

    // The real shipped button: --color-primary carrying --color-on-primary.
    {
        const fill = palette['--color-primary'];
        const pInk = palette['--color-on-primary'];
        const ratio = contrastRatio(fill, pInk);
        out.push(check(
            'solid/on-accent',
            'on-primary text on bg-primary',
            ratio,
            GATE.onAccent,
            ratio >= GATE.onAccent ? {} : { note: bestInkNote(fill, pInk) },
        ));
    }

    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural assertions (things a contrast ratio cannot catch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A contrast ratio is direction-blind: 5:1 says nothing about WHICH of the two
 * colours is lighter. That means an accidentally inverted ramp — light-mode tints
 * darker than the card, or a card darker than the page — passes every gate above
 * while looking completely wrong. These assertions are the direction check.
 */
function collectStructure(palette) {
    const out = [];

    // ── a border may never BE a surface ─────────────────────────────────────
    //
    // This is the assertion that catches the whole class of "the border is
    // invisible because it is the background". It happened for real: 81
    // `border-{neutral}-800` call sites resolved to `--color-slate-800`, which on
    // eleven of the twelve themes is the identical hex to `--color-card`, so the
    // pair measured exactly 1.0000:1 and the app drew borders that did not exist.
    //
    // It is asserted STRUCTURALLY, on byte equality, rather than left to the
    // ratio floors, for two reasons. A ratio gate answers "is this border visible
    // enough", which is a judgement with a number in it; byte equality answers
    // "is this a border at all", which is not. And a 1.0000:1 pair is a
    // completely different bug from a 1.4:1 pair — one is a typo in the token
    // graph, the other is a tuning decision — so they deserve different lines in
    // the report.
    for (const b of LINE_TOKENS) {
        const collisions = SURFACES
            .filter((s) => String(palette[b.token] || '').toLowerCase() === String(palette[s.token] || '').toLowerCase())
            .map((s) => s.label);
        out.push(assertion(
            'structure',
            `${b.label} is not one of the surfaces`,
            collisions.length === 0,
            collisions.length === 0
                ? `${palette[b.token]} distinct from all ${SURFACES.length} surfaces`
                : `${palette[b.token]} is byte-identical to ${collisions.join(', ')} — this border does not exist`,
        ));
    }

    // ── the four line levels are a ladder of presence ───────────────────────
    //
    // line-0 < line < line-2 < line-3, measured against the card. This is what
    // makes the four levels four levels: they exist so a divider inside a card,
    // the card's own outline and an emphasised rule can be told apart. Ordering
    // is also the only gate a PINNED divider is still held to on the ratio side,
    // and it is the honest one — the pinned value must still be subtler than
    // `--color-line` and still not be the card.
    //
    // The strict `> 1.0` on the first rung is deliberate: 1.0 exactly is the
    // byte-identity failure above, so this catches "different hex, same
    // luminance" — a divider that is a different colour from the card and still
    // completely invisible, which no equality check can see.
    {
        const cardHex = palette['--color-card'];
        const rungs = LINE_TOKENS.map((b) => ({ label: b.label, r: contrastRatio(palette[b.token], cardHex) }));
        const breaks = [];
        if (!(rungs[0].r > 1.0)) breaks.push(`${rungs[0].label} is ${f2(rungs[0].r)} from the card — invisible`);
        for (let i = 1; i < rungs.length; i++) {
            if (rungs[i].r < rungs[i - 1].r - RATIO_EPS) {
                breaks.push(`${rungs[i].label} (${f2(rungs[i].r)}) is fainter than ${rungs[i - 1].label} (${f2(rungs[i - 1].r)})`);
            }
        }
        out.push(assertion(
            'structure',
            'line levels ascend: line-0 < line < line-2 < line-3',
            breaks.length === 0,
            breaks.length === 0
                ? `vs card: ${rungs.map((x) => `${x.label} ${f2(x.r)}`).join(' · ')}`
                : breaks.join('; '),
        ));
    }

    // ── primary-ink must still be an improvement on primary ─────────────────
    //
    // `--color-primary-ink` exists for exactly one reason: `--color-primary` is a
    // FILL colour, and using it as ink on its own wash measured 2.0-2.8:1 across
    // the themes. The wash gate above proves the replacement clears 4.5; this
    // proves it is still a replacement. Without it, aliasing primary-ink back to
    // primary would fail one gate in a way that reads like a tuning regression
    // rather than like the token having been deleted.
    {
        let margin = Infinity;
        let worstInk = NaN;
        let worstFill = NaN;
        let at = 0;
        for (const alpha of PRIMARY_WASH_ALPHAS) {
            for (const bd of WASH_BACKDROPS) {
                const composited = washOver(palette['--color-primary'], palette[bd.token], alpha / 100);
                const rInk = contrastRatio(palette['--color-primary-ink'], composited);
                const rFill = contrastRatio(palette['--color-primary'], composited);
                if (rInk - rFill < margin) { margin = rInk - rFill; worstInk = rInk; worstFill = rFill; at = alpha; }
            }
        }
        out.push(assertion(
            'structure',
            'primary-ink beats primary on its own wash',
            margin > RATIO_EPS,
            `worst margin at /${at}: primary-ink ${f2(worstInk)} vs primary ${f2(worstFill)} (+${f2(margin)})`,
        ));
    }

    // ── the neutral aliases really are aliases ──────────────────────────────
    //
    // FILLS measures `slate` only, on the strength of ramp.js emitting
    // `gray|zinc|neutral|stone` from the same table. That is an assumption the
    // ink-on-fill gate rests its whole coverage on, so it is asserted rather than
    // believed: if one alias ever drifts, the fill gate is measuring a colour the
    // 36 `bg-gray-*` / `bg-zinc-*` call sites do not render.
    {
        const drift = [];
        for (const family of NEUTRAL_ALIASES) {
            if (family === 'slate') continue;
            for (const f of FILLS) {
                const a = palette[`--color-slate-${f.shade}`];
                const b = palette[`--color-${family}-${f.shade}`];
                if (String(a).toLowerCase() !== String(b).toLowerCase()) drift.push(`${family}-${f.shade} ${b} != ${a}`);
            }
        }
        out.push(assertion(
            'structure',
            'neutral aliases share the fill ramp',
            drift.length === 0,
            drift.length === 0
                ? `${NEUTRAL_ALIASES.length - 1} aliases byte-identical to slate on all ${FILLS.length} fill shades`
                : drift.join('; '),
        ));
    }


    // ── elevation: a card must read as sitting ABOVE the page ───────────────
    // In BOTH modes, per spec §2a: shade 800 (card) is lighter than shade 900
    // (page). That is the whole reason the neutral ramp is a role table and not a
    // monotonic gradient, so it is worth asserting rather than assuming.
    const bgL = lightness(palette['--color-bg']);
    const cardL = lightness(palette['--color-card']);
    out.push(assertion(
        'structure',
        'card lighter than page (elevation)',
        cardL > bgL,
        `card L ${f3(cardL)} vs page L ${f3(bgL)} (delta ${f3(cardL - bgL)})`,
    ));

    // card-2 must still be a distinguishable second tone, or nested panels vanish.
    const card2L = lightness(palette['--color-card-2']);
    out.push(assertion(
        'structure',
        'card-2 distinguishable from card',
        Math.abs(card2L - cardL) >= 0.015,
        `card-2 L ${f3(card2L)} vs card L ${f3(cardL)} (delta ${f3(Math.abs(card2L - cardL))})`,
    ));

    // ── tint band orientation ───────────────────────────────────────────────
    //
    // A tint background (`bg-emerald-900` behind `text-emerald-300`) is a WASH of
    // the accent over the surface, so it must sit at the SURFACE end of the ramp,
    // not the ink end. That is the inversion this catches: paste the dark-mode
    // accent table into a light theme and every tint lands at L 0.25 on a white
    // card — every ratio in `accent-ink/tint` still passes (contrast is
    // direction-blind) while the badge renders as black-on-black.
    //
    // NOTE ON THE FORMULATION. The obvious phrasing — "tint lighter than card in
    // light mode, darker in dark mode" — is not usable as a gate: four of the five
    // light themes put `card` at L 1.000 (pure white), and nothing can be lighter
    // than white, so the assertion would be unsatisfiable by construction and
    // would fail 34/34 tints on every light theme while telling us nothing. The
    // real invariant is SIDEDNESS relative to the ink, which is mode-symmetric and
    // catches the actual inversion. The magnitude of the offset is then gated
    // separately below.
    const total = HUE_NAMES.length * TINT_SHADES.length;
    const fgL = lightness(palette['--color-fg']);
    const inverted = [];
    const wash = [];
    for (const family of HUE_NAMES) {
        for (const shade of TINT_SHADES) {
            const tl = lightness(palette[`--color-${family}-${shade}`]);
            if (Math.abs(tl - cardL) >= Math.abs(tl - fgL)) inverted.push({ id: `${family}-${shade}`, l: tl });
            wash.push({ id: `${family}-${shade}`, l: tl, off: Math.abs(tl - cardL) });
        }
    }
    inverted.sort((a, b) => Math.abs(b.l - cardL) - Math.abs(a.l - cardL));
    out.push(assertion(
        'structure',
        'tint band on the surface side, not the ink side',
        inverted.length === 0,
        inverted.length === 0
            ? `all ${total} tints nearer card (L ${f3(cardL)}) than fg (L ${f3(fgL)})`
            : `${inverted.length}/${total} tints nearer the INK than the card — worst bg-${inverted[0].id} at L ${f3(inverted[0].l)}`,
    ));

    // ── tint band is a wash, not a solid ────────────────────────────────────
    // A tint far enough off the card has stopped being a wash and started being a
    // chip: it reads as a raised solid block rather than a coloured region of the
    // card. This is what happens when a theme overrides its neutral surface
    // lightness (OLED black, lifted Nord greys, high contrast) without touching
    // the accent tint table.
    //
    // PROVENANCE OF THE 0.12: this tolerance is the validator's, NOT the spec's —
    // §6.3 gates contrast only. It is derived from the shared tables the spec does
    // define: in the default dark theme, card sits at L 0.279 and the deepest tint
    // (shade 950) at L 0.190, so the DESIGNED worst-case offset is 0.089. 0.12 is
    // that reference plus ~35% headroom, which is loose enough that a theme
    // adjusting its surfaces by a few percent stays clean and tight enough that a
    // theme which moves its surfaces without moving its tints gets flagged.
    wash.sort((a, b) => b.off - a.off);
    const worstWash = wash[0];
    out.push(assertion(
        'structure',
        'tint band reads as a wash over the card',
        worstWash.off <= 0.12,
        `worst offset ${f3(worstWash.off)} — bg-${worstWash.id} at L ${f3(worstWash.l)},`
        + ` ${worstWash.l > cardL ? 'LIGHTER' : 'darker'} than card L ${f3(cardL)}`,
    ));

    return out;
}

/**
 * Charts, measured through the REAL chart palette.
 *
 * Charts are the one surface the `--color-*` remap does not cover: recharts
 * writes colour into SVG attributes, so `chartPalette.js` hands it concrete hex.
 * That palette is derived from the same ramp, but through its own role mapping
 * (categorical slots, a diverging pair, heatmap ink), and nothing above measures
 * it — a theme could pass every gate on this page and still render an
 * unreadable chart. Gating the real `buildChartTheme` is only possible because
 * that module is React-free; if it ever grows an `import React`, this dies.
 *
 * WHAT IS ASSERTED, AND WHY THESE FOUR
 *  1. SERIES vs BACKGROUND >= 3:1. A chart line is a non-text UI component, so
 *     WCAG 1.4.11's 3:1 is the right threshold, not 4.5.
 *  2. SERIES vs EACH OTHER: separable by LIGHTNESS, not merely by hue. This is
 *     the CVD gate. For a dichromat, hue distance partly collapses while
 *     lightness distance does not — two series that differ only in hue become
 *     one series. The anchors are iso-lightness by construction, so the honest
 *     form of this check is on CHROMA+HUE distance in OKLab (deltaE-ish), which
 *     is what actually separates them once lightness is equal.
 *  3. HEATMAP INK >= 3:1 on its own fill, swept across the full magnitude range.
 *     `ink()` picks light or dark text per cell; a bug there (it once measured
 *     an `rgb()` string as black) silently pales every low-magnitude cell.
 *  4. GRID and AXIS must be visible on the chart background, and the tooltip
 *     must be legible on itself.
 */
function collectChart(theme, contrastLevel) {
    const out = [];
    let ct;
    try {
        ct = buildChartTheme(theme, contrastLevel);
    } catch (e) {
        return [assertion('chart', 'chart palette builds', false, e.message)];
    }

    const bg = ct.background || ct.surface;

    // 1 — every categorical slot and the diverging pair, against the chart ground.
    const marks = [
        ...ct.categorical.map((hex, i) => [`categorical[${i}]`, hex]),
        ['diverging.positive', ct.diverging.positive],
        ['diverging.negative', ct.diverging.negative],
    ];
    for (const [label, hex] of marks) {
        out.push(check('chart', `${label} on chart background`, contrastRatio(hex, bg), 3.0));
    }

    // 2 — series must differ by more than hue alone.
    // Measured in OKLab a*/b* (the chromatic plane) plus lightness: the anchors
    // are iso-lightness by construction, so they separate purely by hue — and
    // the eyecare themes rotate whole regions of hue onto one target. A
    // dichromat folds one axis of the chromatic plane, so hue alone is not a
    // guarantee; real distance is.
    const separation = (h1, h2) => {
        const a = hexToOklch(h1);
        const b = hexToOklch(h2);
        const [ax, ay] = [a.C * Math.cos(a.H * Math.PI / 180), a.C * Math.sin(a.H * Math.PI / 180)];
        const [bx, by] = [b.C * Math.cos(b.H * Math.PI / 180), b.C * Math.sin(b.H * Math.PI / 180)];
        return Math.hypot(ax - bx, ay - by) + Math.abs(a.L - b.L);
    };
    for (let i = 1; i < ct.categorical.length; i++) {
        const dist = separation(ct.categorical[i - 1], ct.categorical[i]);
        out.push(assertion(
            'chart',
            `categorical ${i - 1} vs ${i} separable`,
            dist >= 0.10,
            `OKLab chromatic+lightness distance ${f3(dist)} (floor 0.100)`,
        ));
    }
    // The polarity pair carries MORE meaning than a categorical slot — it is the
    // sign of a rupee figure — so it gets the same floor and its own line.
    {
        const dist = separation(ct.diverging.positive, ct.diverging.negative);
        out.push(assertion(
            'chart',
            'diverging positive vs negative separable',
            dist >= 0.10,
            `OKLab chromatic+lightness distance ${f3(dist)} (floor 0.100)`,
        ));
    }

    // 3 — heatmap ink across the magnitude range, both polarities.
    if (typeof ct.ink === 'function' && typeof ct.divergingFill === 'function') {
        let worst = { r: Infinity };
        for (const sign of [1, -1]) {
            for (const mag of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
                let fill;
                try {
                    fill = typeof ct.divergingRgba === 'function' ? ct.divergingRgba(sign * mag) : ct.divergingFill(sign * mag);
                } catch { continue; }
                const inkHex = ct.ink(fill);
                const r = contrastRatio(inkHex, fill);
                if (Number.isFinite(r) && r < worst.r) worst = { r, mag: sign * mag, fill, inkHex };
            }
        }
        if (Number.isFinite(worst.r)) {
            out.push(check('chart', 'heatmap ink on its own cell (worst magnitude)', worst.r, 3.0, {
                note: `at magnitude ${worst.mag}, ink ${worst.inkHex} on ${worst.fill}`,
            }));
        }
    }

    // 4 — structural chart furniture.
    out.push(check('chart', 'grid on chart background', contrastRatio(ct.grid, bg), 1.2));
    out.push(check('chart', 'axis on chart background', contrastRatio(ct.axis, bg), 3.0));
    if (ct.tooltip) {
        out.push(check('chart', 'tooltip text on tooltip background',
            contrastRatio(ct.tooltip.text || ct.text.primary, ct.tooltip.background), 4.5));
        out.push(check('chart', 'tooltip border on tooltip background',
            contrastRatio(ct.tooltip.border, ct.tooltip.background), 1.2));
    }

    return out;
}

/**
 * Declared exemptions — the escape hatch for a gate that conflicts with a HARDER
 * requirement, kept honest.
 *
 * There is exactly one situation this exists for: spec §3 freezes the default
 * theme's palette to the hexes in today's stylesheet, and one of those pairs
 * (#41434d on #262730) measures below the border floor. Pixel-identity and the
 * floor cannot both hold, and pixel-identity is the stronger requirement, so the
 * shortfall is recorded instead of being quietly designed away.
 *
 * THE RULES THAT KEEP THIS FROM BECOMING A DUMPING GROUND
 *  • It lives in the theme DATA (themes.js), not here. This script never names a
 *    theme, which is what spec §6.6 requires — an exemption is a fact about a
 *    palette, so it belongs next to the pin that causes it.
 *  • It LOWERS a gate to a declared floor; it never removes one. The pair is
 *    still measured and still fails if it degrades further.
 *  • A stale exemption is a FAILURE. If the pair starts clearing the real gate,
 *    or names a check that does not exist, the run goes red and says so — an
 *    exemption cannot outlive its reason or survive a rename.
 *  • Every exempted check is printed with its justification, so a reader of the
 *    output sees the debt rather than a clean bill of health.
 */
function applyExemptions(theme, checks) {
    const declared = (Array.isArray(theme.contrastExemptions) ? theme.contrastExemptions : [])
        .filter((e) => e && typeof e === 'object');
    if (!declared.length) return { checks, notes: [] };

    const matched = new Set();
    const applied = checks.map((c) => {
        const ex = declared.find((e) => e.group === c.group && e.id === c.id);
        if (!ex) return c;
        matched.add(ex);
        if (c.pass) return { ...c, staleExemption: ex };
        const floor = Number(ex.floor);
        if (!Number.isFinite(floor)) return c;
        return { ...c, gate: floor, realGate: c.gate, pass: c.ratio >= floor, exempt: ex };
    });

    const notes = [];
    for (const ex of declared) {
        const hit = applied.find((c) => c.group === ex.group && c.id === ex.id);
        if (!hit) {
            notes.push(assertion('exemption', `declared exemption "${ex.group} / ${ex.id}" matches a real check`, false,
                'no such check — the id was renamed or the exemption is a typo'));
            continue;
        }
        if (hit.staleExemption) {
            notes.push(assertion('exemption', `exemption "${ex.id}" is still needed`, false,
                `the pair now measures ${f2(hit.ratio)} and clears its real gate — delete the exemption`));
            continue;
        }
        notes.push(assertion('exemption', `exemption "${ex.id}" holds its declared floor`, hit.pass,
            `${f2(hit.ratio)} vs floor ${f2(Number(ex.floor))} — ${ex.why || 'no justification given'}`));
    }
    return { checks: applied, notes };
}

/**
 * SHARED-TABLE DEBT — the same mechanism as a theme's `contrastExemptions`, for
 * shortfalls that are NOT a fact about one theme.
 *
 * WHY THIS IS SEPARATE FROM THE PER-THEME LEDGER ABOVE. That one is right when a
 * theme's own data causes the shortfall: a pinned hex, a lifted surface. These
 * are the other kind — the value comes out of a table in ramp.js that every
 * theme in a mode shares (FG_L, ACCENT_L), so the SAME pair misses by the SAME
 * amount on five or six themes at once. Copying one entry into six themes'
 * `contrastExemptions` would be six copies of one fact, would go stale in six
 * places, and would imply six independent decisions where there is one.
 *
 * THE RULES, WHICH ARE THE SAME RULES
 *  • It lowers a gate to a declared floor; it never removes one. Every pair is
 *    still measured, and still fails the moment it degrades past the floor.
 *  • It names NO theme — that is spec §6.6, and it is also the point: the debt
 *    belongs to a shared table, so it is described by the table and the mode.
 *  • Stale is a FAILURE, evaluated across the WHOLE run rather than per theme
 *    (these pairs pass on some themes and fail on others by construction, so a
 *    per-theme staleness test would fire on every theme that is already fine).
 *    If no theme needs an entry any more, the run goes red and says delete it.
 *  • Its EVIDENCE is looked up, never typed. An entry says how many call sites
 *    paint the combination it excuses, and that number comes from the scan on
 *    every run. This rule is here because breaking it is what went wrong: seven
 *    entries carried counts frozen at the moment they were written, a codemod
 *    repaid the debt, and eight gates stayed lowered over an empty region. A
 *    ledger that cannot notice its own debt being repaid is a hole.
 *  • Every entry carries the OWNER and the REMEDY, because a debt without a fix
 *    path is just a lowered gate wearing a comment.
 *  • It is printed in its own block, loudly, on every run.
 */
/**
 * How many call sites still stand behind a ledger entry — LOOKED UP, never typed.
 *
 * This is the lesson of the seven entries that used to live below. Each carried a
 * hardcoded count (22, 1, 2, 1, 2, 3, 2) written the day it was measured, and each
 * excused a `bg-{hue}-700/{40,50,60}` cell under accent ink. A codemod then moved
 * sixty of those tokens onto shade 800 and the defect stopped existing — but the
 * numbers in the ledger could not move, so eight gates stayed lowered (one to
 * 2.50) guarding nothing. The count is now a function of the tree, so an entry
 * whose call sites have gone reports zero, its check disappears from the matrix,
 * and the audit below turns the run red demanding the entry's deletion.
 */
function debtSites(group, id) {
    let hits = null;
    let m;
    if (group === 'ink/fill' && (m = /^(fg(?:-\d)?) on fill-(\d+)$/.exec(id))) {
        const e = SITES.fill.get(`${m[1]}|${m[2]}`);
        if (e) hits = [...e.active, ...e.inactive];
    } else if (group === 'wash/accent' && (m = /^accent-(\d+) on bg-(\d+)\/(\d+)$/.exec(id))) {
        hits = SITES.wash.get(`${m[1]}|${m[2]}|${m[3]}`) || null;
    } else if (group === 'wash/primary' && (m = /^primary-ink on bg-primary\/(\d+)$/.exec(id))) {
        hits = SITES.primary.get(m[1]) || null;
    }
    return { n: hits ? hits.length : 0, example: hits && hits.length ? hits[0] : '(no call site in src/)' };
}

/** One entry, with its call-site evidence spliced in from the scan. */
function debt({ group, id, mode, floor, cause, remedy, owner }) {
    const { n, example } = debtSites(group, id);
    return {
        group,
        id,
        mode,
        floor,
        sites: n,
        example,
        why: `${cause} — ${n} call site(s), e.g. ${example}`,
        remedy,
        owner,
    };
}

/**
 * EMPTY, AND THAT IS THE POINT — every entry that used to live here has been PAID
 * by a change to the table that caused it, not by a lowered gate. Recorded so the
 * next person can see what the mechanism is for and what it cost to clear it:
 *
 *  • `fg-4 on fill-700` (dark, 14 call sites). FG_L.dark[4] 0.735 -> 0.756, the
 *    number this entry itself carried as its remedy. Worst dark-theme reading
 *    goes 4.23 -> 4.59 WITH the 30% warm overlay `nightshift` recommends, and
 *    the ink band keeps 0.113/0.091 of separation to fg-3/fg-5.
 *  • the four `bg-{hue}-500/{10,20,30}` wash cells (33 call sites). ACCENT_L's
 *    ink band was moved away from the solid band it is washed over, in both
 *    modes — dark 400/300 0.720/0.790 -> 0.765/0.828, light 400..50
 *    0.500/0.440/0.380/0.320/0.280 -> 0.420/0.362/0.310/0.262/0.225. Worst cell
 *    goes 3.28 -> 4.68. The two high-contrast themes already shipped overrides in
 *    exactly this direction (shade 400 at 0.740 dark / 0.400 light), which is
 *    both why they were the only two themes that passed these cells and the
 *    evidence that the shared table, not the call sites, was the thing that was
 *    wrong.
 *
 * `debt()` and `debtSites()` below stay wired up on purpose. They are the
 * mechanism, not the debt: the audit that turns a stale entry red is only
 * trustworthy if adding one still works, and that is what mutation test 7
 * exercises.
 */
const SHARED_DEBT = [];

/**
 * Lower the gate on any check a ledger entry names. Returns new check objects.
 *
 * `mode` narrows an entry to the half of the set that shares the table: these
 * shortfalls come from FG_L.dark / ACCENT_L.light, so an entry scoped to one mode
 * leaves the OTHER mode under the full gate. Without that narrowing a dark-mode
 * debt would quietly cover a light theme that regressed onto the same pair, which
 * is the failure mode a shared ledger has and a per-theme one does not.
 */
function applySharedDebt(checks, mode) {
    if (!SHARED_DEBT.length) return checks;
    return checks.map((c) => {
        if (c.pass) return c;
        const d = SHARED_DEBT.find((e) => e.group === c.group && e.id === c.id && (!e.mode || e.mode === mode));
        if (!d || !Number.isFinite(Number(d.floor))) return c;
        const floor = Number(d.floor);
        return { ...c, gate: floor, realGate: c.gate, pass: c.ratio >= floor, debt: d };
    });
}

/**
 * Whole-run audit of the ledger. THREE questions, and an entry has to answer all
 * three or the run goes red:
 *
 *   1. does it still name a real check?  A renamed id, or a cell that has left
 *      the scanned scope entirely, means the entry is guarding nothing.
 *   2. is any run still short of the real gate?  If every theme now clears 4.5,
 *      the debt has been PAID and the entry must go.
 *   3. is anything still painting it?  This is the one that was missing, and its
 *      absence is what let seven entries excuse a defect that no longer existed.
 *      The count comes from the scan, so it answers itself.
 *
 * (2) and (3) are different questions and both are needed. A cell can still
 * measure badly with zero call sites (a latent shortfall nobody is exposed to —
 * do not spend a lowered gate on it), and a cell can have hundreds of call sites
 * and now measure fine (the palette was fixed — take the gate back). Only the
 * intersection is real debt.
 *
 * Emitted as assertions so they count toward the exit code like any other gate.
 */
function auditSharedDebt(results) {
    const out = [];
    for (const d of SHARED_DEBT) {
        let named = 0;
        let used = 0;
        let worst = Infinity;
        for (const r of results) {
            for (const c of r.checks) {
                if (c.group !== d.group || c.id !== d.id) continue;
                named++;
                if (c.debt === d) { used++; worst = Math.min(worst, c.ratio); }
            }
        }
        if (!named) {
            out.push(assertion('debt', `ledger entry "${d.group} / ${d.id}" matches a real check`, false,
                `no such check — the id was renamed, or the scan no longer finds this combination anywhere in src/`
                + ` (${d.sites} call site(s)); either way the entry is guarding nothing and must be deleted`));
            continue;
        }
        out.push(assertion('debt', `ledger entry "${d.id}" still has call sites`, d.sites > 0,
            d.sites > 0
                ? `${d.sites} in src/, e.g. ${d.example}`
                : 'NOTHING in src/ paints this any more — the debt was repaid by a codemod; delete the entry'));
        out.push(assertion('debt', `ledger entry "${d.id}" is still needed`, used > 0,
            used > 0
                ? `${used} of ${named} runs need it; worst ${f2(worst)} vs floor ${f2(Number(d.floor))} — ${d.remedy}`
                : `all ${named} runs now clear the real gate — delete the entry`));
    }
    return out;
}

/**
 * THE TWO HALVES OF A PURE-CSS AXIS HAVE TO SAY THE SAME THING.
 *
 * The pure-CSS accessibility axes (readingMode, reduceMotion, underlineLinks,
 * focusRing) are declared TWICE on purpose: statically in `src/index.css`, so
 * they are already in effect on the first paint the boot script sets the
 * attributes for, and again in the injected runtime block, so an axis the reader
 * engages does not depend on the build-time file's shape. Redundancy is the
 * design. Redundancy that has DRIFTED is a bug wearing the design's clothes: the
 * static half renders one way before the provider mounts and the runtime half
 * renders another way after, and nothing in the app ever shows both.
 *
 * That is not hypothetical — it is what this check was written for. The static
 * `readingMode` rule carried the `--tw-leading` half (the only half that reaches
 * a Tailwind text-size utility) while the runtime one carried only the inert
 * `body` rule, so the axis was dead for every reader who changed it after load.
 * Two smaller cases sat next to it: the static `underlineLinks` rule was missing
 * `text-underline-offset` and the static `focusRing: strong` rule was missing its
 * halo, i.e. both were SUBSETS of what the runtime emits.
 *
 * WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. Every `:root[data-*]` rule
 * index.css declares must be emitted by `buildPrefsCss` with byte-identical
 * declarations. The reverse is NOT asserted: the runtime is allowed to declare
 * MORE (the prose measure cap is runtime-only, because it depends on a token the
 * static file does not own). So the relation is "static is a faithful subset",
 * which is exactly what a pre-paint fallback is.
 *
 * The runtime side is built by walking PREF_SCHEMA — every toggle turned on and
 * every select set to each of its options — rather than by naming the four axes.
 * A new axis appended to the schema is therefore covered the moment it exists,
 * which is the same extensibility contract §6.6 asks of everything else here.
 */
const INDEX_CSS = path.resolve(SRC_ROOT, 'index.css');

/** `selector -> declarations`, comments and whitespace normalised away. */
function axisRules(cssText) {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    const out = new Map();
    const re = /(:root\[data-[a-z-]+[^{}]*)\{([^}]*)\}/g;
    const src = strip(cssText);
    let m;
    while ((m = re.exec(src))) out.set(strip(m[1]), strip(m[2]));
    return out;
}

/** Every axis rule the runtime block can emit, over the whole schema. */
function runtimeAxisRules() {
    const variants = [defaultPrefs()];
    for (const p of PREF_SCHEMA) {
        if (p.type === 'toggle') variants.push({ ...defaultPrefs(), [p.key]: true });
        else if (p.type === 'select') for (const o of p.options || []) variants.push({ ...defaultPrefs(), [p.key]: o.value });
    }
    const merged = new Map();
    for (const v of variants) for (const [sel, decl] of axisRules(buildPrefsCss(v))) merged.set(sel, decl);
    return merged;
}

/**
 * THE FIRST FRAME HAS TO MATCH THE SECOND ONE.
 *
 * index.css's `@theme static` block declares every semantic token with the
 * DEFAULT theme's value, and says so in as many words: those hexes are what
 * paints the page between the boot script setting `data-theme` and
 * ThemeProvider injecting the runtime <style>. They are not a convention and not
 * documentation — they are a rendered frame. A token here that disagrees with
 * `resolvePalette(DEFAULT_THEME)` makes the page visibly change colour one frame
 * in, which is precisely the flash the boot script exists to prevent.
 *
 * WHY THIS IS A GATE AND NOT A COMMENT. The block is hand-maintained hex and the
 * palette is generated, so any ramp tune silently desynchronises them — and the
 * failure is invisible in every place anyone looks: the build succeeds, the
 * runtime block is correct, and the defect lasts one frame on a cold load. When
 * FG_L and ACCENT_L moved in this session, `--color-fg-4` and
 * `--color-primary-ink` went stale exactly that way. The block's own header
 * documents a one-liner for reading the right value out of the ramp; this turns
 * that instruction into something that fails when it is not followed.
 *
 * Only `#rrggbb` declarations are compared. `--ui-*`, `--chart-*` and anything
 * the palette does not carry are skipped, and their absence is reported rather
 * than passed over.
 */
function auditStaticDefaults() {
    const out = [];
    let css = '';
    try {
        css = fs.readFileSync(INDEX_CSS, 'utf8');
    } catch {
        return [assertion('mirror', '@theme static block is readable', false, `cannot read ${INDEX_CSS}`)];
    }
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = bare.indexOf('@theme static');
    if (start < 0) {
        return [assertion('mirror', 'index.css declares an @theme static block', false,
            'no `@theme static` block — Tailwind generates no semantic utilities at all without it')];
    }
    // Balanced-brace slice, so a nested block cannot truncate the scope.
    let depth = 0;
    let end = bare.length;
    for (let i = bare.indexOf('{', start); i < bare.length; i++) {
        if (bare[i] === '{') depth++;
        else if (bare[i] === '}' && --depth === 0) { end = i; break; }
    }
    const block = bare.slice(start, end);
    const want = resolvePalette(THEMES.find((t) => t.id === DEFAULT_THEME_ID));
    const re = /(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
    const mismatched = [];
    const unknown = [];
    let n = 0;
    let m;
    while ((m = re.exec(block))) {
        n++;
        const token = m[1];
        const declared = m[2].toLowerCase();
        const resolved = String(want[token] || '').toLowerCase();
        if (!resolved) unknown.push(token);
        else if (resolved !== declared) mismatched.push(`${token} ${declared} != ${resolved}`);
    }
    // A scope that reads nothing would pass over an empty set — same rule as the
    // call-site scan and the axis mirror above.
    out.push(assertion('mirror', '@theme static declares the default palette', n >= 20,
        `${n} #rrggbb token(s) read from the @theme block`));
    out.push(assertion('mirror', 'first-frame defaults === resolved default theme', mismatched.length === 0,
        mismatched.length === 0
            ? `all ${n - unknown.length} comparable token(s) identical — no colour shift between the static frame and the injected one`
            : `${mismatched.length} stale: ${mismatched.join(' · ')}`));
    out.push(assertion('mirror', 'every static default exists in the palette', unknown.length === 0,
        unknown.length === 0 ? `0 tokens declared that the ramp does not emit` : `not emitted by the ramp: ${unknown.join(', ')}`));
    return out;
}

function auditAxisMirror() {
    const out = [];
    let staticCss = '';
    try {
        staticCss = fs.readFileSync(INDEX_CSS, 'utf8');
    } catch {
        return [assertion('mirror', 'index.css is readable', false, `cannot read ${INDEX_CSS} — the static half of every axis is unverified`)];
    }
    const staticRules = axisRules(staticCss);
    const runtime = runtimeAxisRules();
    // A scope that reads nothing would report a clean run over an empty set —
    // the same failure mode the call-site scan guards against.
    out.push(assertion('mirror', 'index.css declares axis rules at all', staticRules.size > 0,
        `${staticRules.size} :root[data-*] rule(s) in src/index.css vs ${runtime.size} the runtime block can emit`));
    for (const [sel, decl] of staticRules) {
        const mirrored = runtime.get(sel);
        const short = sel.replace(/:not\(\[data-[a-z-]+="false"\]\)/g, '').replace(/\s+/g, ' ').slice(0, 46);
        out.push(assertion('mirror', `static/runtime agree on ${short}`, mirrored === decl,
            mirrored === undefined
                ? 'the runtime block emits NO rule for this selector — the axis is static-only and stops working the moment the provider re-renders it'
                : mirrored === decl
                    ? `${decl.split(';').filter((d) => d.trim()).length} declaration(s), identical`
                    : `static "${decl}" vs runtime "${mirrored}"`));
    }
    return out;
}

/**
 * Blue-light suppression, measured on the OUTPUT rather than on the spec.
 *
 * The eyecare themes claim to remove short-wavelength emission at the palette
 * level. The only honest way to check that is to read the hue back out of the
 * emitted hexes — a `hueClamp` that is configured but never wired into the accent
 * pipeline would still look correct if we only re-ran the spec's own arithmetic.
 *
 * Two assertions, both derived from the theme DATA so a new eyecare theme is
 * covered automatically:
 *   • `strength >= 1` promises FULL collapse, so no meaningfully-chromatic token
 *     may land inside the band at all.
 *   • `chromaCap` applies to hues that ORIGINATED inside the band (the point is
 *     to stop a rotated blue arriving as a screaming amber), so we re-derive the
 *     origin set from HUES + hueShift and check the cap only there.
 */
function collectSuppression(palette, theme) {
    const spec = theme.accent?.hueClamp || null;
    if (!spec || !Array.isArray(spec.band)) return [];

    const out = [];
    const band = spec.band;
    const strength = Number(spec.strength ?? 1);
    const cap = Number(spec.chromaCap);
    const shift = Number(theme.accent?.hueShift) || 0;
    const inset = [band[0] + HUE_TOL, band[1] - HUE_TOL];

    if (strength >= 1) {
        // Sweep the ENTIRE resolved palette, not just the 17 families: the status
        // tokens, the primary and the chart series all go through the same accent
        // pipeline, and a chart line is exactly where an unsuppressed blue would
        // hurt most.
        const inband = [];
        for (const [key, hex] of Object.entries(palette)) {
            if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
            const { C, H } = hexToOklch(hex);
            if (C < CHROMA_FLOOR) continue;
            if (inHueBand(H, inset)) inband.push({ key, H, C });
        }
        inband.sort((a, b) => b.C - a.C);
        out.push(assertion(
            'suppression',
            `no hue inside [${band[0]}, ${band[1]}] (strength ${strength})`,
            inband.length === 0,
            inband.length === 0
                ? `all chromatic tokens (C >= ${CHROMA_FLOOR}) outside the band, +/-${HUE_TOL}deg tolerance`
                : `${inband.length} token(s) inside — worst ${inband[0].key} at H ${f2(inband[0].H)} C ${f3(inband[0].C)}`,
        ));
    }

    if (Number.isFinite(cap)) {
        const originInBand = HUE_NAMES.filter((f) => inHueBand(HUES[f] + shift, band));
        const over = [];
        for (const family of originInBand) {
            for (const shade of SHADES) {
                const hex = palette[`--color-${family}-${shade}`];
                if (!hex) continue;
                const c = chroma(hex);
                if (c > cap + CHROMA_EPS) over.push({ id: `${family}-${shade}`, c });
            }
        }
        over.sort((a, b) => b.c - a.c);
        out.push(assertion(
            'suppression',
            `chroma capped at ${cap} for rotated hues`,
            over.length === 0,
            over.length === 0
                ? `${originInBand.length} rotated famil(ies) all at or under C ${cap}`
                : `${over.length} shade(s) over cap — worst ${over[0].id} at C ${f3(over[0].c)}`,
        ));
    }

    return out;
}

/**
 * The contrast axis must be a RATCHET.
 *
 * `applyContrast` pulls ink toward the extreme and lifts borders off their
 * surface, and it does so on the finished hex map — including a theme's pinned
 * colours. It also has to renormalise chroma on the way (or the gamut mapper eats
 * the lift), and that is precisely the kind of correction that can accidentally
 * cost more luminance than the lift gains. So: every single check, at every
 * level, must be >= the level below it. A "more contrast" setting that lowers any
 * ratio anywhere is a bug, not a trade-off.
 */
function collectMonotonicity(theme, byLevel) {
    const out = [];
    const order = CONTRAST_LEVELS.filter((l) => byLevel[l]);
    for (let i = 1; i < order.length; i++) {
        const prev = order[i - 1];
        const cur = order[i];
        const a = byLevel[prev];
        const b = byLevel[cur];
        const regressions = [];
        // Zipping by index is only valid because collectChecks is deterministic.
        // Assert it rather than trust it: a silent misalignment here would compare
        // unrelated pairs and report a clean ratchet on a broken one.
        if (a.length !== b.length) {
            out.push(assertion('contrast-axis', `contrast '${cur}' check set matches '${prev}'`, false,
                `VALIDATOR BUG: ${a.length} vs ${b.length} checks`));
            continue;
        }
        for (let k = 0; k < a.length; k++) {
            if (a[k].id !== b[k].id) {
                regressions.push({ id: `VALIDATOR BUG: id mismatch at ${k} (${a[k].id} vs ${b[k].id})`, from: NaN, to: NaN, drop: Infinity });
                break;
            }
            if (a[k].ratio === null || b[k].ratio === null) continue;
            const drop = a[k].ratio - b[k].ratio;
            if (drop > RATIO_EPS) regressions.push({ id: b[k].id, from: a[k].ratio, to: b[k].ratio, drop });
        }
        regressions.sort((x, y) => y.drop - x.drop);
        out.push(assertion(
            'contrast-axis',
            `contrast '${cur}' never worse than '${prev}'`,
            regressions.length === 0,
            regressions.length === 0
                ? `${a.length} checks, none regressed (tolerance ${RATIO_EPS})`
                : `${regressions.length} regressed — worst "${regressions[0].id}" ${f2(regressions[0].from)} -> ${f2(regressions[0].to)}`,
        ));
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default-theme fidelity spot-checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spec §3 promises the default theme is "pixel-identical to the current UI". That
 * is a checkable claim: four literal hexes live in today's `index.css` and the
 * three darkest slate steps are what 482 `bg-slate-{900,800}` / `border-slate-700`
 * call sites render today. Keyed off DEFAULT_THEME_ID rather than a literal id, so
 * this section follows the default if it ever moves.
 */
const FIDELITY = [
    ['--color-primary', '#ff4b4b', 'index.css --primary-color'],
    ['--color-bg', '#0e1117', 'index.css body background'],
    ['--color-card', '#262730', 'index.css --surface-color'],
    ['--color-line', '#41434d', 'index.css input/.bg-surface border'],
    ['--color-slate-950', '#020617', 'Tailwind v4 slate-950'],
    ['--color-slate-900', '#0f172a', 'Tailwind v4 slate-900'],
    ['--color-slate-800', '#1d293d', 'Tailwind v4 slate-800'],
    ['--color-slate-700', '#314158', 'Tailwind v4 slate-700'],
    ['--color-white', '#ffffff', 'never inverted (40 on-accent labels)'],
];

function collectFidelity(palette) {
    return FIDELITY.map(([token, expected, why]) => assertion(
        'fidelity',
        `${token} === ${expected}`,
        String(palette[token] || '').toLowerCase() === expected,
        `got ${palette[token] || '(missing)'} — ${why}`,
    ));
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-theme run
// ─────────────────────────────────────────────────────────────────────────────

function runTheme(theme) {
    const byLevel = {};
    for (const level of CONTRAST_LEVELS) {
        byLevel[level] = collectChecks(resolvePalette(theme, level), theme);
    }
    const palette = resolvePalette(theme, BASE_CONTRAST);

    // Exemptions are applied ONLY to the reported base-level checks. `byLevel`
    // keeps its raw ratios so the contrast ratchet below still compares real
    // measurements — a lowered gate must not be able to hide a regression.
    const { checks: base, notes: exemptionNotes } = applyExemptions(theme, byLevel[BASE_CONTRAST]);

    const checks = [
        ...applySharedDebt(base, theme.mode),
        ...exemptionNotes,
        ...collectStructure(palette),
        ...collectChart(theme, BASE_CONTRAST),
        ...collectSuppression(palette, theme),
        ...collectMonotonicity(theme, byLevel),
        ...(theme.id === DEFAULT_THEME_ID ? collectFidelity(palette) : []),
    ];

    // How many of the base-level failures the accessibility axis rescues. ramp.js
    // claims `more` clears the whole matrix; this is that claim, measured.
    const rescue = {};
    for (const level of CONTRAST_LEVELS) {
        rescue[level] = applySharedDebt(applyExemptions(theme, byLevel[level]).checks, theme.mode).filter((c) => !c.pass).length;
    }

    return {
        label: theme.id,
        kind: 'theme',
        theme,
        palette,
        byLevel,
        checks,
        rescue,
        failed: checks.filter((c) => !c.pass),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommended and preset combinations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A theme is not shipped alone. It is shipped with `recommends` (the settings the
 * panel offers next to it) and inside `PRESETS` (theme + prefs, one click), and
 * both of those bundles can pick a combination the theme on its own never
 * produces. The review found exactly that: a preset recommending a 45% warm
 * overlay on a theme whose fg-5 clears AA at 4.54:1 — under the overlay it
 * measures 4.40:1, so the ONE-CLICK CONFIGURATION SHIPPED A FAILURE while the
 * theme it names was clean.
 *
 * So every bundle is re-run through the whole matrix, with the two prefs that
 * change colour applied in the order the browser applies them:
 *   contrast  -> folds into the palette (ramp.js applyContrast)
 *   blueLight -> multiplies the finished screen, AFTER everything else
 * The other nine axes are typography and motion and cannot move a ratio.
 *
 * `prefs` here is a partial delta over the schema defaults, exactly as
 * ThemeProvider treats it, so a preset that says nothing about contrast is
 * measured at whatever a fresh user would have.
 */
function runVariant(theme, label, rawPrefs) {
    const prefs = { ...defaultPrefs(), ...(rawPrefs || {}) };
    const level = CONTRAST_LEVELS.includes(prefs.contrast) ? prefs.contrast : BASE_CONTRAST;
    const blueLight = Number(prefs.blueLight) || 0;
    const palette = warmPalette(resolvePalette(theme, level), blueLight);

    const { checks: base, notes } = applyExemptions(theme, collectChecks(palette, theme));
    const checks = [...applySharedDebt(base, theme.mode), ...notes, ...collectStructure(palette)];

    return {
        label,
        kind: 'variant',
        theme,
        palette,
        prefs,
        detail: `${theme.id} · contrast ${level} · warm filter ${blueLight}%`,
        checks,
        failed: checks.filter((c) => !c.pass),
    };
}

/**
 * Every bundle the app can hand a user in one gesture: the three PRESETS, plus
 * each theme's own `recommends` where it actually changes a colour. Derived from
 * the DATA, so a fourth preset or a new `recommends` block is covered the day it
 * lands, with no edit here.
 */
function collectVariants() {
    const out = [];
    for (const p of PRESETS) {
        const theme = THEMES.find((t) => t.id === p.theme);
        if (!theme) {
            out.push({
                label: `preset:${p.id}`,
                kind: 'variant',
                theme: { id: p.theme, mode: '?' },
                checks: [assertion('preset', `preset "${p.id}" names a real theme`, false, `no theme "${p.theme}"`)],
                detail: 'unresolvable',
            });
            continue;
        }
        out.push(runVariant(theme, `preset:${p.id}`, p.prefs));
    }
    for (const theme of THEMES) {
        const rec = theme.recommends;
        if (!rec) continue;
        // Only the two colour-bearing axes make a distinct run; a `recommends`
        // that only asks for a bigger font is already covered by the theme's own.
        const movesColour = (Number(rec.blueLight) || 0) > 0
            || (rec.contrast && rec.contrast !== BASE_CONTRAST);
        if (!movesColour) continue;
        out.push(runVariant(theme, `${theme.id}:recommends`, rec));
    }
    for (const v of out) v.failed = (v.checks || []).filter((c) => !c.pass);
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Printing
// ─────────────────────────────────────────────────────────────────────────────

const log = (s = '') => process.stdout.write(s + '\n');
const rule = (ch = '─', n = 96) => log(ch.repeat(n));

function printSelfTests(res) {
    log();
    log('INSTRUMENT SELF-TEST (known WCAG values + the scan\'s own scope — a wrong ruler invalidates everything below)');
    rule();
    for (const r of res.rows) {
        const show = (v) => (r.text ? String(v) : f3(v));
        log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${padE(r.label, 58)} expected ${padS(show(r.expected), 8)}  got ${padS(r.err ? 'threw' : show(r.actual), 8)}`);
        if (r.err) log(`        ${r.err.message}`);
    }
    log(`  ${res.bad === 0 ? 'instrument OK' : `INSTRUMENT BROKEN (${res.bad} failing)`}`);
}

/**
 * A labelled grid of ratio cells: rows x columns. `cols` defaults to the four
 * page surfaces; the ink matrix is printed a second time against the raised-fill
 * band, which is the region that used to be invisible to this report.
 */
function printMatrix(title, rows, checks, group, cols = SURFACES) {
    const groups = Array.isArray(group) ? group : [group];
    log();
    log(`  ${padE(title, 26)}${padE('gate', 7)}${cols.map((s) => padS(s.label, 9)).join('')}`);
    for (const row of rows) {
        const line = cols.map((s) => {
            const c = checks.find((x) => groups.includes(x.group) && x.id === `${row.label} on ${s.label}`);
            return padS(c ? cell(c) : '—', 9);
        }).join('');
        log(`    ${padE(row.label, 24)}${padE(f2(row.gate ?? GATE.border), 7)}${line}`);
    }
}

/**
 * The wash block: ink on a colour the palette does not contain.
 *
 * One sub-table per fill shade, alphas across. The shape of the failure has to
 * stay legible — a wash gets harder to read as alpha rises, and seeing
 * 4.42 / 3.47 / 2.68 / 2.06 march along a row says "this is the wash getting
 * heavier", where four scattered failures in a list say nothing. The grid is
 * SPARSE now that the cell set is scanned rather than swept (the app paints
 * `bg-{hue}-900` at nine different alphas and `bg-{hue}-600` at exactly one), so
 * each shade gets only the columns it actually ships and `—` never appears.
 */
function printWashMatrix(checks) {
    const hits = checks.filter((c) => c.group === 'wash/primary' || c.group === 'wash/accent');
    if (!hits.length) return;
    log();
    log(`  ${padE('ink on an alpha wash', 26)}${padE('gate', 7)}(alphas differ per fill — only shipped cells are shown)`);
    for (const fill of ACCENT_WASH_FILLS) {
        const cells = ACCENT_WASH_CELLS.filter((c) => c.fill === fill);
        const alphas = [...new Set(cells.map((c) => c.alpha))].sort((a, b) => a - b);
        const inkShades = [...new Set(cells.map((c) => c.ink))].sort((a, b) => a - b);
        log(`    ${padE(`— on bg-{hue}-${fill} at —`, 24)}${padE('', 7)}${alphas.map((a) => padS(`/${a}`, 9)).join('')}`);
        for (const inkShade of inkShades) {
            const line = alphas.map((a) => {
                const c = hits.find((x) => x.id === `accent-${inkShade} on bg-${fill}/${a}`);
                return padS(c ? cell(c) : '·', 9);
            }).join('');
            log(`    ${padE(`accent-${inkShade} on bg-${fill}`, 24)}${padE(f2(GATE.wash), 7)}${line}`);
        }
    }
    const prim = PRIMARY_WASH_ALPHAS.map((a) => {
        const c = hits.find((x) => x.id === `primary-ink on bg-primary/${a}`);
        return padS(c ? `/${a}${cell(c)}` : '—', 11);
    }).join('');
    log(`    ${padE('primary-ink on primary', 24)}${padE(f2(GATE.wash), 7)}${prim}`);
}

/**
 * The accent block is 255 checks per theme — far too many to print in full. Each
 * row collapses one hue family to the WORST ratio in each role band, which is the
 * number the gate actually turns on. Individual failures are listed verbatim in
 * the failure section, and `--verbose` prints every check.
 */
function printAccentMatrix(checks) {
    const worst = (group, pred) => {
        const hits = checks.filter((c) => c.group === group && pred(c.id));
        if (!hits.length) return null;
        return hits.reduce((m, c) => (c.ratio < m.ratio ? c : m), hits[0]);
    };
    log();
    log(`  ${padE('accent (worst in band)', 26)}${padE('gate', 7)}${['ink/900', 'ink/950', 'ink/card', 'solid'].map((h) => padS(h, 9)).join('')}`);
    for (const family of HUE_NAMES) {
        const cells = [
            worst('accent-ink/tint', (id) => id.startsWith(`text-${family}-`) && id.endsWith('-900')),
            worst('accent-ink/tint', (id) => id.startsWith(`text-${family}-`) && id.endsWith('-950')),
            worst('accent-ink/card', (id) => id.startsWith(`text-${family}-`)),
            worst('solid/on-accent', (id) => id.includes(`bg-${family}-`)),
        ].map((c) => padS(c ? cell(c) : '—', 9)).join('');
        log(`    ${padE(family, 24)}${padE(f2(GATE.accentInk), 7)}${cells}`);
    }
}

function printStructure(checks) {
    const groups = ['chart', 'structure', 'suppression', 'contrast-axis', 'fidelity', 'exemption', 'debt', 'preset'];
    const rows = checks.filter((c) => groups.includes(c.group) && c.ratio === null);
    if (!rows.length) return;
    log();
    log(`  ${padE('structural assertions', 26)}`);
    for (const r of rows) {
        log(`    ${r.pass ? 'PASS' : 'FAIL'}  ${padE(r.id, 46)} ${r.detail || ''}`);
    }
}

function printTheme(result, verbose) {
    const { theme, checks, rescue, failed } = result;
    log();
    rule('━');
    log(`  ${theme.id}  ·  ${theme.name}  ·  ${theme.mode}  ·  group ${theme.group}`);
    rule('━');

    printMatrix('ink on surface', INKS, checks, 'ink/surface');
    printMatrix('ink on raised fill', INKS, checks, 'ink/fill', FILLS);
    // line-0 shares this table but not its floor: it only ever appears in the
    // `card` column, because that is the one surface the ramp solves it against.
    printMatrix(
        'border on surface',
        LINE_TOKENS.map((b) => ({ ...b, gate: b.label === 'line-0' ? GATE.divider : GATE.border })),
        checks,
        ['border/surface', 'divider'],
    );
    printWashMatrix(checks);
    printAccentMatrix(checks);
    printStructure(checks);

    if (verbose) {
        log();
        log('    all checks:');
        for (const c of checks) {
            const measured = c.ratio === null ? (c.detail || '') : `${f2(c.ratio)} vs gate ${f2(c.gate)}`;
            log(`      ${c.pass ? 'PASS' : 'FAIL'}  ${padE(c.group, 18)}${padE(c.id, 46)} ${measured}`);
        }
    }

    log();
    log(`  result: ${checks.length - failed.length}/${checks.length} pass`
        + `   |   base failures by contrast axis: ${CONTRAST_LEVELS.map((l) => `${l} ${rescue[l]}`).join(' · ')}`);
    if (failed.length) {
        log(`  FAILING GROUPS: ${[...new Set(failed.map((c) => c.group))].join(', ')}`);
    }
}

/**
 * What the scan found, and therefore what this run is scoped to measure.
 *
 * Printed on EVERY run, not behind a flag, because it is the answer to the first
 * question a reader of a green report should ask: green over what? The gate
 * scopes are derived, so "0 FAIL" means nothing without the size of the set it
 * was evaluated over — and a scope that silently shrank is precisely the failure
 * that let the old hand-written ledger excuse a defect for a codemod's worth of
 * time. `--scan` expands it to every derived cell with its call sites.
 */
function printScanProvenance(detail) {
    log();
    rule('━');
    log('  CALL-SITE SCAN — the gate scopes below are derived from the tree, not written down');
    rule('━');
    log(`  read ${SITES.files.length} source files under ${path.relative(process.cwd(), SRC_ROOT) || 'src'}`
        + ` · ${SITES.contexts} class strings carrying a colour utility`);
    log(`  derived scope: ${FILLS.length} neutral fill shade(s) · `
        + `${Object.values(FILL_INK_GATE).reduce((a, o) => a + Object.keys(o).length, 0)} gated (ink, fill) pair(s) · `
        + `${ACCENT_WASH_CELLS.length} accent wash cell(s) · ${PRIMARY_WASH_ALPHAS.length} primary wash alpha(s)`);

    log();
    log(`  ${padE('ink on neutral fill', 26)}${FILLS.map((f) => padS(f.label, 14)).join('')}`);
    for (const ink of INKS) {
        const cells = FILLS.map((f) => {
            const e = SITES.fill.get(`${ink.label}|${f.shade}`);
            if (!e) return padS('·', 14);
            const gate = FILL_INK_GATE[f.shade]?.[ink.label];
            return padS(`${e.active.length + e.inactive.length}${e.active.length ? '' : '*'} @${f2(gate)}`, 14);
        }).join('');
        log(`    ${padE(ink.label, 24)}${cells}`);
    }
    log(`    ${padE('', 24)}sites @gate · ` + '`*` = every site is an inactive control, so WCAG 1.4.3 lowers the floor to '
        + `${f2(GATE.inkFaint)} · \`·\` = no call site, measured but not gated`);

    if (!detail) {
        log();
        log(`  ${ACCENT_WASH_CELLS.length} accent wash cells and their call sites: re-run with --scan`);
        return;
    }
    log();
    log('  accent wash cells (ink shade · fill shade · alpha · sites · first site)');
    for (const c of [...ACCENT_WASH_CELLS].sort((a, b) => b.sites.length - a.sites.length)) {
        log(`    ${padE(`accent-${c.ink} on bg-${c.fill}/${c.alpha}`, 30)}${padS(c.sites.length, 5)}   ${c.sites[0]}`);
    }
    log();
    log('  primary wash alphas');
    for (const a of PRIMARY_WASH_ALPHAS) {
        const hits = SITES.primary.get(String(a)) || [];
        log(`    ${padE(`primary-ink on bg-primary/${a}`, 30)}${padS(hits.length, 5)}   ${hits[0] || ''}`);
    }
}

function printSummary(results) {
    log();
    rule('━');
    log('  SUMMARY');
    rule('━');
    // Column width is DERIVED, not 14. A hardcoded width plus a `padE` that never
    // truncates means the first row whose label is 14 characters or longer runs
    // into the mode column and garbles the table — and the reader that garbling
    // hits hardest is whoever just added the thing with the long name, i.e. the
    // one person who most needs the report to be legible. Preset rows
    // ('preset:reading-comfort') make that the normal case rather than a corner.
    const w = Math.max(14, ...results.map((r) => r.label.length)) + 2;
    log(`  ${padE('theme', w)}${padE('mode', 7)}${padS('checks', 8)}${padS('pass', 7)}${padS('fail', 7)}   worst failing group(s)`);
    for (const r of results) {
        const groups = [...new Set(r.failed.map((c) => c.group))];
        log(`  ${padE(r.label, w)}${padE(r.theme.mode, 7)}${padS(r.checks.length, 8)}${padS(r.checks.length - r.failed.length, 7)}${padS(r.failed.length, 7)}   ${groups.join(', ') || '—'}`);
    }
    const total = results.reduce((a, r) => a + r.checks.length, 0);
    const bad = results.reduce((a, r) => a + r.failed.length, 0);
    log();
    log(`  ${results.length} runs · ${total} checks · ${total - bad} pass · ${bad} FAIL`);
    log('  legend: ✓ passed · ✗ failed · · measured but not gated · ! passed a LOWERED gate (see the blocks below)');

    // Failure counts per group, so the report leads with where the debt is.
    const perGroup = {};
    for (const r of results) for (const c of r.failed) perGroup[c.group] = (perGroup[c.group] || 0) + 1;
    if (bad) {
        log();
        log('  failures by group:');
        for (const [g, n] of Object.entries(perGroup).sort((a, b) => b[1] - a[1])) {
            log(`    ${padE(g, 20)}${padS(n, 6)}`);
        }
    }
}

/**
 * Group order for the failure listing. `collectChecks` emits accent checks
 * interleaved per hue family (ink/tint, ink/card, solid, next family…), so a
 * naive "print a header when the group changes" pass alternates headers dozens of
 * times and makes the list unreadable. Failures are bucketed by group instead.
 */
const GROUP_ORDER = [
    'ink/surface', 'ink/fill', 'border/surface', 'divider',
    'wash/primary', 'wash/accent', 'accent-ink/tint', 'accent-ink/card',
    'solid/on-accent', 'chart', 'structure', 'suppression', 'contrast-axis', 'fidelity',
    'exemption', 'debt', 'preset',
];

/**
 * Exemptions are debt, so the summary states them out loud even on a clean run.
 * A green gate that is green because something was excused should never look the
 * same as a green gate that is green because everything passed.
 */
function printExemptions(results) {
    const rows = [];
    for (const r of results) {
        for (const c of r.checks) {
            if (c.exempt) rows.push({ theme: r.label, c });
        }
    }
    if (!rows.length) return;
    log();
    rule('━');
    log(`  DECLARED EXEMPTIONS (${rows.length}) — measured, gated at a floor, and still owed`);
    rule('━');
    for (const { theme, c } of rows) {
        log(`  ${theme} · ${c.group} · ${c.id}`);
        log(`    measures ${f2(c.ratio)} · floor ${f2(c.gate)} · real gate ${f2(c.realGate)}`);
        log(`    why: ${c.exempt.why}`);
    }
}

/**
 * The shared-table ledger, collapsed to one block per ENTRY rather than one line
 * per theme — the whole point of the mechanism is that these are one decision
 * affecting many themes, and printing it six times would restate the opposite.
 */
function printSharedDebt(results) {
    if (!SHARED_DEBT.length) return;
    log();
    rule('━');
    log(`  SHARED-TABLE DEBT (${SHARED_DEBT.length}) — one shortfall in a table every theme in a mode reads`);
    rule('━');
    for (const d of SHARED_DEBT) {
        const hits = [];
        for (const r of results) for (const c of r.checks) if (c.debt === d) hits.push({ label: r.label, c });
        const worst = hits.reduce((m, h) => (h.c.ratio < m ? h.c.ratio : m), Infinity);
        log(`  ${d.group} · ${d.id}`);
        log(`    floor ${f2(Number(d.floor))} · real gate ${f2(hits[0]?.c.realGate)} · worst measured ${f2(worst)}`);
        log(`    affects ${hits.length}: ${hits.map((h) => h.label).join(', ') || '—'}`);
        log(`    why: ${d.why}`);
        log(`    fix: ${d.remedy}  [owner: ${d.owner}]`);
    }
}

/**
 * Tokens a theme PINNED, where the pin costs a gate.
 *
 * Printed for the same reason exemptions are: a value that is not being asked a
 * question must never look like a value that answered one. This block is the
 * whole price of the pinned/solved distinction, stated on every run.
 */
function printPinned(results) {
    const rows = [];
    for (const r of results) for (const c of r.checks) if (c.pinned) rows.push({ label: r.label, c });
    if (!rows.length) return;
    log();
    rule('━');
    log(`  PINNED TOKENS (${rows.length}) — measured, printed, and deliberately not gated on a ratio`);
    rule('━');
    for (const { label, c } of rows) {
        log(`  ${label} · ${c.group} · ${c.id}`);
        log(`    measures ${f2(c.ratio)} · the solved target is ${f2(GATE.divider)}+`);
        log(`    why: ${c.pinned}`);
    }
}

/**
 * The one-click bundles, and the ledger audit that spans them.
 *
 * These get their own block rather than being folded into the theme table
 * because the question they answer is different: the theme table asks "is this
 * palette sound", this asks "is the configuration we RECOMMEND sound". A preset
 * can fail on a theme that passes — that is the entire defect class it exists to
 * catch — so the two counts must not be added together silently.
 */
function printVariants(variants, ledger) {
    if (!variants.length && !ledger.length) return;
    log();
    rule('━');
    log('  SHIPPED COMBINATIONS (presets + per-theme recommendations, through the full matrix)');
    rule('━');
    const w = Math.max(14, ...variants.map((v) => v.label.length)) + 2;
    for (const v of variants) {
        const n = v.checks.length;
        log(`  ${padE(v.label, w)}${padE(v.detail || '', 46)}${padS(n - v.failed.length, 6)}/${padE(n, 6)}${v.failed.length ? `FAIL ${[...new Set(v.failed.map((c) => c.group))].join(', ')}` : 'pass'}`);
    }
    for (const c of ledger) {
        log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${padE(c.id, 56)} ${c.detail || ''}`);
    }
}

function printFailures(results) {
    const total = results.reduce((a, r) => a + r.failed.length, 0);
    if (!total) return;
    log();
    rule('━');
    log(`  FAILURES (${total}) — every gate breach, verbatim`);
    rule('━');
    for (const r of results) {
        if (!r.failed.length) continue;
        log();
        log(`  ${r.label}${r.detail ? `   (${r.detail})` : ''}`);
        const seen = [...new Set(r.failed.map((c) => c.group))]
            .sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
        for (const group of seen) {
            log(`    [${group}]`);
            for (const c of r.failed.filter((x) => x.group === group)) {
                if (c.ratio === null) {
                    log(`      FAIL  ${padE(c.id, 48)} ${c.detail || ''}`);
                } else {
                    log(`      FAIL  ${padE(c.id, 48)} ${f2(c.ratio)} < ${f2(c.gate)}${c.note ? `   (${c.note})` : ''}`);
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
    const argv = process.argv.slice(2);
    const verbose = argv.includes('--verbose') || argv.includes('-v');
    const asJson = argv.includes('--json');
    const scanDetail = argv.includes('--scan') || verbose;

    const self = runSelfTests();
    if (!asJson) printSelfTests(self);
    if (self.bad > 0) {
        // Exit 2, not 1: "the ruler is broken" is a categorically different result
        // from "the themes are wrong", and CI should not conflate them.
        log();
        log('ABORTING: the contrast instrument itself is wrong. No theme results reported.');
        process.exit(2);
    }

    if (THEMES.length !== 12 && !asJson) {
        log();
        log(`  NOTE: spec §3 defines 12 themes, THEMES has ${THEMES.length}. Validating what is there.`);
    }

    const themeResults = THEMES.map(runTheme);
    // The bundles a user can pick in one gesture. Run AFTER the themes so a
    // preset failure reads as "this combination", not as "this theme".
    const variantResults = collectVariants();
    // The ledger is audited across every run, themes and variants together —
    // an entry is only stale if NOTHING needed it.
    const all = [...themeResults, ...variantResults];
    const ledger = [...auditSharedDebt(all), ...auditAxisMirror(), ...auditStaticDefaults()];
    const results = all;

    if (asJson) {
        const payload = {
            themes: results.map((r) => ({
                id: r.label,
                kind: r.kind,
                mode: r.theme.mode,
                checks: r.checks.length,
                failed: r.failed.map((c) => ({ group: c.group, id: c.id, ratio: c.ratio, gate: c.gate, detail: c.detail, note: c.note })),
                rescue: r.rescue,
            })),
            ledger: ledger.map((c) => ({ id: c.id, pass: c.pass, detail: c.detail })),
            // The scope every number above was measured over. A consumer that
            // trusts `failed: []` without this is trusting a set it cannot see.
            scan: {
                files: SITES.files.length,
                contexts: SITES.contexts,
                fills: FILLS.map((f) => f.shade),
                fillInkGate: FILL_INK_GATE,
                accentWashCells: ACCENT_WASH_CELLS.map((c) => ({ ink: c.ink, fill: c.fill, alpha: c.alpha, sites: c.sites.length, example: c.sites[0] })),
                primaryWashAlphas: PRIMARY_WASH_ALPHAS,
            },
        };
        log(JSON.stringify(payload, null, 2));
    } else {
        for (const r of themeResults) printTheme(r, verbose);
        printScanProvenance(scanDetail);
        printSummary(results);
        printVariants(variantResults, ledger);
        printPinned(results);
        printExemptions(results);
        printSharedDebt(results);
        printFailures(results);
    }

    const bad = results.reduce((a, r) => a + r.failed.length, 0) + ledger.filter((c) => !c.pass).length;
    if (!asJson) {
        log();
        log(bad === 0 ? 'GATE 3: PASS' : `GATE 3: FAIL (${bad} checks)`);
    }
    process.exit(bad === 0 ? 0 : 1);
}

main();
