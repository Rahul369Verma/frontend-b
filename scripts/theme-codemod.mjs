#!/usr/bin/env node
/**
 * theme-codemod.mjs — one-shot, re-runnable rewrite of hardcoded neutral *text*
 * and *border* colours to the semantic `--color-fg*` / `--color-line*` role
 * tokens (THEME_SPEC section 5).
 *
 * WHY a codemod at all, when Tailwind v4 emits var-based utilities?
 * ---------------------------------------------------------------------------
 * Redefining `--color-slate-800` retheme every `bg-slate-800` call site for
 * free, so backgrounds/rings need NO source edits (rules 3 + 4 below).
 * Foreground colour is the one axis that cannot be handled that way: on a light
 * theme `text-white` must become near-black, but `bg-white` must stay white —
 * the same `--color-white` var would have to be two different colours. Same for
 * the neutral text ramp: `text-slate-400` is "muted body text" (must darken on
 * light) while `bg-slate-400` would be a light fill (must not). So text is
 * lifted onto its own 6-level role ramp (`fg` … `fg-6`) here.
 *
 * WHY borders moved too (rule 5, added after the role-separation landing)
 * ---------------------------------------------------------------------------
 * The neutral shade ramp used to be overloaded THREE ways: shade 700 was at once
 * "raised fill", "main border" and — via the contrast axis — a thing that had to
 * move in two opposite directions at once. A border wants to move AWAY from its
 * surface as contrast rises; a fill wants to stay legible under ink, i.e. to
 * relax TOWARD the card. One number cannot do both, and the compromise value was
 * what put the high-contrast light theme's ink at 1.28:1 on its own raised fill.
 *
 * The engine therefore split the tables: `NEUTRAL_L` is now fills/surfaces only
 * and a separate `LINE_L` owns borders, exposed as `--color-line-0|line|line-2|
 * line-3`. That split is only real once the CALL SITES follow it. A surviving
 * `border-slate-700` now paints itself with a FILL colour: it stops responding
 * to the contrast axis in the border direction and actively gets fainter at
 * 'more'/'max', because fills relax toward the card. So rule 5 is not a tidy-up,
 * it is the other half of the engine change, and until it runs the 547 neutral
 * border sites are strictly worse off than before the split.
 *
 * After rule 5, `bg-{neutral}-N` is the ONLY remaining consumer of the neutral
 * shade ramp — which is exactly the invariant the split depends on. (Two
 * documented hand-review strays remain by design: `to-slate-900` and
 * `accent-slate-500`, one site each, both on the spec's hand-review list.)
 *
 * WHY an AST codemod instead of sed?
 * ---------------------------------------------------------------------------
 * Two requirements make a blind global replace wrong:
 *   1. `text-white` must survive where it sits on a saturated accent fill
 *      (`bg-primary`, `bg-emerald-600`, …) — that pairing is already correct in
 *      every theme, light or dark. Deciding that needs the surrounding class
 *      expression as context, not a token (see contextFor).
 *   2. The tokens must never be touched inside prose, comments, doc strings or
 *      unrelated string data. JSX text like `Don't` also breaks naive quote
 *      scanning outright.
 * So we parse each file with @babel/parser (jsx plugin), locate the string /
 * template-literal spans that are genuinely class lists, and splice edits by
 * exact source offset. Everything outside those spans is untouchable, which is
 * what makes the diff reviewable.
 *
 * @babel/parser ships with @vitejs/plugin-react, so this needs no new dep.
 *
 * Measured on this codebase, text pass: 302 `text-white` -> 267 rewritten, 33
 * kept on-accent, 2 left inside a commented-out JSX block; 1516 neutral text
 * classes + 1 placeholder rewritten; 1784 edits over 25 files. The spec's
 * headline split was ~262/~40 from a line-based count — the extra 5 rewrites are
 * the arm-aware refinement documented on contextFor, which correctly stops an
 * inactive tab arm's `hover:text-white` from being vetoed by the ACTIVE arm's
 * `bg-primary`.
 *
 * Border pass: 81 `border-{n}-800` -> border-line-0, 391 `-700` -> border-line,
 * 66 `-600` -> border-line-2, 9 `-500` -> border-line-3, 2 `divide-{n}-700` ->
 * divide-line; 549 edits over 22 files. Neutral `bg-` count is unchanged at 640
 * by construction — rule 5 never matches a `bg-` prop.
 *
 * The two `divide-{n}-800` sites the shade table would claim are deliberately
 * already `divide-line` and are NOT reverted: a row rule painted in the card's
 * own shade is a 1.00:1 no-op, and the default theme pins `line-0` to that same
 * card hex for pixel fidelity, so `divide-line-0` would stay invisible there.
 * They carry a comment saying so; rule 5 is a mechanical default, not a veto on
 * a measured hand-pick.
 *
 * Usage:
 *   node scripts/theme-codemod.mjs [path ...]        # rewrite in place
 *   node scripts/theme-codemod.mjs --dry-run         # report only, no writes
 *   node scripts/theme-codemod.mjs --list-preserved  # every kept on-accent text-white
 *   node scripts/theme-codemod.mjs --list-fallback   # literals adopted by the heuristic
 *   node scripts/theme-codemod.mjs --list-unseen     # candidates left untouched
 *
 * Default target is `src/`. Exit code is 0 on success, 1 if any file failed to
 * parse (so it is safe to gate a build on). Re-running is a no-op.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const FRONTEND_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ------------------------------------------------------------------ config */

/**
 * Paths another agent / another layer owns. `src/theme` and `src/config` are the
 * theming system's own source of truth: they legitimately contain token names as
 * DATA (ramp tables, theme specs, strings) and rewriting those would corrupt the
 * generator. `index.css` holds the `@theme` declarations and is hand-migrated.
 * Listed as path prefixes relative to the frontend root.
 */
const EXCLUDED_PREFIXES = [
    'src/theme',
    'src/config',
    'src/index.css',
    'scripts',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.git',
];

/**
 * ── CLASSES THIS SCRIPT MUST NEVER "HELPFULLY" REWRITE ──────────────────────
 *
 * None of the rules below touch these today, and none of them should ever be
 * extended to. Recorded here because each one LOOKS like a mode-blind literal
 * that a future pass would be tempted to tokenise, and each one is correct:
 *
 *  · `bg-black/{60,70,80}` (8 modal scrims). A scrim is a dark veil in BOTH
 *    modes by universal convention (Material 3 uses neutral-0 in light and dark
 *    alike), and on a light theme it is the ONLY thing separating a `bg-card`
 *    dialog (L 1.000) from the page behind it (L 0.968). Rewriting these to
 *    `bg-bg-2/80` would leave every modal in the app floating with no elevation
 *    on the five light themes.
 *  · `text-white` where the same ternary ARM carries `bg-primary` or a saturated
 *    `bg-{hue}-{400..950}` (32 sites). These sit on a fill that does not invert,
 *    so `--color-white` is the right token — see rule 1.
 *  · `text-black` on `bg-{amber,green}-500` (6 sites). Measured: black scores
 *    4.79-5.47 there and white 3.84-4.38, i.e. these are the mirror image of the
 *    on-accent whites above, and `--color-black` is pinned for exactly this.
 *  · `after:bg-white` + `after:border-gray-300` on the 6 peer-toggle knobs. The
 *    pair is complementary by design: on dark the white face carries the
 *    contrast (7.5-10.4:1), on light the grey ring does (4.4-6.3:1). Repainting
 *    the face to `bg-fg` measures WORSE — 1.86:1 on hc-light.
 */

/**
 * Extension -> @babel/parser plugins. `.js` carries JSX in this codebase, so it
 * gets the jsx plugin too; TS entries are here so the script keeps working if
 * the app is ever migrated, without silently failing to parse.
 */
const PLUGINS_BY_EXT = {
    '.js': ['jsx'],
    '.jsx': ['jsx'],
    '.mjs': ['jsx'],
    '.ts': ['typescript'],
    '.tsx': ['typescript', 'jsx'],
};

/** Class-list builders whose string arguments are class lists by construction. */
const CLASS_HELPERS = new Set(['clsx', 'classNames', 'classnames', 'cx', 'cn', 'twMerge', 'twJoin']);

/**
 * JSX attributes that carry human text, URLs or identifiers — never class lists.
 *
 * WHY: the fallback heuristic (see looksLikeClassList) has to accept a
 * single-token string, because the app really does pass bare classes as props
 * (`<ResultCard color="text-white" />`, `valueCls = 'text-white'`). That makes a
 * value like `placeholder="text-white"` indistinguishable by shape alone, so the
 * attribute NAME is the tiebreak. Denylist rather than allowlist so an unknown
 * custom class prop is still handled; anything skipped here shows up under
 * --list-unseen for review.
 */
const NON_CLASS_ATTRS = new Set([
    'placeholder', 'title', 'alt', 'aria-label', 'aria-description', 'aria-placeholder',
    'href', 'src', 'srcSet', 'download', 'id', 'htmlFor', 'name', 'key', 'type', 'role',
    'target', 'rel', 'content', 'lang', 'dir', 'pattern', 'autoComplete', 'inputMode',
    'value', 'defaultValue', 'label',
]);

/** The 17 Tailwind accent hues. Neutrals are deliberately NOT in this list. */
const ACCENT_HUES = [
    'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
    'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

/** Neutral families that all alias onto the same role ramp (spec 2a). */
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

/**
 * Spec 2b — shade -> foreground role. A shade's MEANING is its role, and the
 * role is what survives the light/dark flip; the numeric ordering does not.
 * 600 and 700 collapse because both are "faintest label" in practice (700 has
 * 7 call sites, all of them hint text).
 */
const FG_BY_SHADE = {
    '50': 'fg',
    '100': 'fg',
    '200': 'fg-2',
    '300': 'fg-3',
    '400': 'fg-4',
    '500': 'fg-5',
    '600': 'fg-6',
    '700': 'fg-6',
};

/**
 * Text-ish utilities that take a colour and therefore ride the fg ramp.
 * `placeholder-` is included because a placeholder is text (spec 5.2 calls out
 * `placeholder-slate-600 -> placeholder-fg-6`). `bg-`, `ring-`, `from-`, `to-`,
 * `accent-` are deliberately absent: those are surface roles and the
 * `--color-*` var remap already retheme them (rules 3 + 4), so touching them
 * here would be a regression. `border-`/`divide-` used to be in that same
 * "leave it alone" bucket and are now rule 5's job — see the header.
 */
const TEXT_PROPS = ['text', 'placeholder', 'caret', 'decoration'];

/**
 * Spec 2a/2d — shade -> border role, the line half of the split ramp. The four
 * shades here are the four that carry a border in this codebase, and each maps
 * to the `--color-line*` step that was tuned against the SAME adjacent surface:
 *
 *   800 -> line-0   hairline / divider, sits on the card it separates (81)
 *   700 -> line     the workhorse card + input border (391)
 *   600 -> line-2   stronger border, hover + focus rings (66)
 *   500 -> line-3   strongest, scrollbar thumbs and emphasis rules (9)
 *
 * Shades 400/300/50 are absent on purpose. Their 7 `border-gray-300` sites are
 * the peer-toggle knob rings on the spec's hand-review list, where the grey ring
 * is what carries the contrast on LIGHT themes against a white knob face —
 * repainting them to a line token measures worse (see the never-rewrite block).
 */
const LINE_BY_SHADE = {
    '800': 'line-0',
    '700': 'line',
    '600': 'line-2',
    '500': 'line-3',
};

/**
 * Border-ish utilities that take a colour and therefore ride the line ramp.
 * `divide-` shares the table rather than getting its own: a divider IS a border
 * by role (Tailwind implements it as a one-sided border on the children), and
 * the two `divide-{n}-800` + two `divide-{n}-700` sites in the app separate
 * exactly the surfaces `line-0` / `line` were tuned against. `ring-` and
 * `outline-` are excluded — the focusRing accessibility axis owns those and
 * drives them from `--color-primary`, not from the neutral line ramp.
 */
const BORDER_PROPS = ['border', 'divide'];

/**
 * Rule 6 subject — the px type scale.
 *
 * WHY THIS RULE EXISTS. The fontScale accessibility axis is a relative root
 * font-size, so it moves anything sized in rem and CANNOT move a px value. The
 * app had 668 `text-[Npx]` classes — 44% of all its text sizing — which meant
 * the Text Size control did nothing at all to nearly half the UI. The Multi-Leg
 * trade tables were the reported symptom: 10px at every slider position.
 *
 * The four sub-xs steps are declared in index.css's "Micro type scale" block and
 * listed in TEXT_SCALE in src/theme/cssVars.js. Their rem values are exact at a
 * 16px root, so this rule changes NOTHING at scale 1.0 — it is a units fix, not
 * a restyle. Named tokens rather than arbitrary `text-[0.625rem]` values because
 * textBoost multiplies the `--text-*` family, and an arbitrary rem value would
 * follow root scaling while silently ignoring the boost.
 *
 * The ladder carries Tailwind's own steps too, so a stray `text-[14px]` lands on
 * `text-sm` instead of falling off the end. Anything not an exact hit is mapped
 * to the nearest step and REPORTED — a silent round is how a design decision
 * disappears into a diff.
 */
const TYPE_BY_PX = {
    8: '5xs', 9: '4xs', 10: '3xs', 11: '2xs', 12: 'xs', 14: 'sm', 16: 'base',
    18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl',
    72: '7xl', 96: '8xl', 128: '9xl',
};
const TYPE_PX_STEPS = Object.keys(TYPE_BY_PX).map(Number).sort((a, b) => a - b);

/* ----------------------------------------------------------------- regexes */

/*
 * Token boundaries, used by every pattern below:
 *   (?<![\w-])  — the token must start a class token. A variant prefix ends in
 *                 ':' (`hover:`, `group-hover:`, `disabled:hover:`, `sm:`,
 *                 `[&>*]:`) which is not [\w-], so EVERY prefix is preserved
 *                 automatically: we only ever rewrite the utility tail.
 *   (?![\w-])   — the token must end. An opacity modifier starts with '/'
 *                 (`text-slate-400/70`) which is not [\w-], so the modifier
 *                 falls outside the match and is preserved verbatim.
 */
const B_OPEN = '(?<![\\w-])';
const B_CLOSE = '(?![\\w-])';

/** Rule 1 subject. */
const RE_TEXT_WHITE = new RegExp(`${B_OPEN}text-white${B_CLOSE}`, 'g');

/**
 * Rule 1 guard: does this className carry a saturated accent FILL? If so the
 * white text sits on the accent, not on the surface, and stays white in all 12
 * themes (the 700/600/500 accent band is mid-tone in both modes by design —
 * spec 2c). `bg-primary` is the brand fill; 400..900 and 950 are the saturated
 * shades. Non-global on purpose: a /g regex carries lastIndex between .test()
 * calls and would silently alternate true/false.
 */
const RE_ON_ACCENT = new RegExp(
    `${B_OPEN}bg-primary${B_CLOSE}`
    + `|${B_OPEN}bg-(?:${ACCENT_HUES.join('|')})-(?:[4-9]00|950)${B_CLOSE}`,
);

/**
 * Rule 2 subject. Shades are listed longest-first so `500` is preferred over
 * `50` without relying on backtracking, and 800/900/950 are simply absent —
 * those shades never carry text in this codebase and are surface roles.
 */
const RE_NEUTRAL_TEXT = new RegExp(
    `${B_OPEN}(${TEXT_PROPS.join('|')})-(${NEUTRALS.join('|')})-(700|600|500|400|300|200|100|50)${B_CLOSE}`,
    'g',
);

/**
 * Rule 5 subject — the border half of the neutral ramp. Same token boundaries as
 * rule 2, so `hover:border-slate-600` keeps its prefix and `border-slate-700/50`
 * keeps its opacity modifier; only the utility tail is ever spliced.
 *
 * NB the leading `border-` is anchored, so a side-specific colour class
 * (`border-t-slate-700`) cannot match by accident. There are zero such sites
 * today; if any appear they will surface under `--list-unseen` rather than being
 * silently half-rewritten.
 */
const RE_NEUTRAL_BORDER = new RegExp(
    `${B_OPEN}(${BORDER_PROPS.join('|')})-(${NEUTRALS.join('|')})-(800|700|600|500)${B_CLOSE}`,
    'g',
);

/**
 * Rule 6 — `text-[<n>px]`. The trailing `]` is its own hard boundary, so no
 * B_CLOSE is needed; a decimal is allowed because `text-[10.5px]` is legal
 * Tailwind even though the app has none today.
 */
const RE_PX_TEXT = new RegExp(`${B_OPEN}text-\\[(\\d+(?:\\.\\d+)?)px\\]`, 'g');

/**
 * Union of rules 1, 2 and 5, used only by the `--list-unseen` safety report to
 * find candidate tokens the scope rules never looked at.
 */
const RE_CANDIDATE = new RegExp(
    `${RE_TEXT_WHITE.source}|${RE_NEUTRAL_TEXT.source}|${RE_NEUTRAL_BORDER.source}`,
    'g',
);

/**
 * Fallback-scope heuristic support: bare (dash-free) Tailwind utilities. A class
 * list may legitimately contain these, but English prose is full of dash-free
 * words, so requiring every token to be either hyphenated/prefixed or a member
 * of this set is what separates `'flex items-center text-slate-400'` from
 * `'the text-slate-400 class is muted'`.
 */
const BARE_UTILITIES = new Set([
    'flex', 'grid', 'block', 'inline', 'hidden', 'table', 'contents', 'flow-root',
    'relative', 'absolute', 'fixed', 'sticky', 'static', 'isolate',
    'italic', 'underline', 'overline', 'truncate', 'uppercase', 'lowercase',
    'capitalize', 'antialiased', 'invisible', 'visible', 'collapse',
    'transition', 'transform', 'container', 'group', 'peer', 'resize',
    'appearance-none', 'sr-only', 'shadow', 'border', 'rounded', 'ring',
    // NB: 'sepia' here is Tailwind's CSS filter utility, NOT the theme of the same
    // name. Noted because the spec §6.6 audit greps for theme ids appearing
    // outside themes.js and this is the one string in the repo that trips it.
    'outline', 'blur', 'grayscale', 'invert', 'sepia',
]);

/** Shape of a single class token, prefixes and arbitrary values included. */
const RE_CLASS_TOKEN = /^(?:[-a-z0-9]+:|\[[^\]]*\]:)*-?[a-z][a-z0-9]*(?:[-/][a-zA-Z0-9._%+*~,='#()[\]&>-]*)*$/;

/* ------------------------------------------------------------------- utils */

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const LIST_PRESERVED = argv.includes('--list-preserved');
const LIST_FALLBACK = argv.includes('--list-fallback');
const LIST_UNSEEN = argv.includes('--list-unseen');
const targets = argv.filter((a) => !a.startsWith('--'));

/** Counter bag helper — keeps the reporting code out of the rule logic. */
function bump(bag, key, n = 1) {
    bag[key] = (bag[key] || 0) + n;
}

/** A counter key that represents an actual source edit (not a kept token). */
const isRewriteKey = (key) => /^r\d+ /.test(key) && !key.includes('kept');

const sumRewrites = (counts) => Object.entries(counts)
    .filter(([k]) => isRewriteKey(k))
    .reduce((a, [, v]) => a + v, 0);

function isExcluded(absPath) {
    const rel = relative(FRONTEND_ROOT, absPath).split(sep).join('/');
    return EXCLUDED_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`));
}

function collectFiles(absPath, out = []) {
    if (isExcluded(absPath)) return out;
    if (!existsSync(absPath)) {
        console.error(`theme-codemod: no such path: ${absPath}`);
        process.exit(1);
    }
    const st = statSync(absPath);
    if (st.isDirectory()) {
        for (const entry of readdirSync(absPath).sort()) collectFiles(join(absPath, entry), out);
        return out;
    }
    const dot = absPath.lastIndexOf('.');
    if (dot > -1 && PLUGINS_BY_EXT[absPath.slice(dot)]) out.push(absPath);
    return out;
}

const pluginsFor = (absPath) => PLUGINS_BY_EXT[absPath.slice(absPath.lastIndexOf('.'))] || ['jsx'];

/* -------------------------------------------------------------- ast helpers */

/**
 * AST keys that are bookkeeping, never child nodes. `extra` carries a literal's
 * raw source; the rest is position data and the attached comment lists. Never
 * descending into these is the structural guarantee that no comment — line,
 * block or JSDoc — can ever be rewritten.
 */
const SKIP_KEYS = new Set([
    'extra', 'loc', 'range', 'comments', 'leadingComments', 'trailingComments', 'innerComments',
]);

/**
 * Minimal generic AST walk. @babel/traverse is a heavier dep that is not
 * guaranteed hoisted, and we need nothing it provides beyond "visit every node":
 * scope, bindings and path manipulation are irrelevant because every edit is a
 * byte-range splice, not a node replacement.
 */
function walk(node, visit, parent = null) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const child of node) walk(child, visit, parent);
        return;
    }
    if (typeof node.type !== 'string') return;
    visit(node, parent);
    for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        walk(node[key], visit, node);
    }
}

/** Unwrap `className={expr}` down to `expr`; leave `className="str"` as-is. */
function unwrapAttrValue(value) {
    if (!value) return null;
    if (value.type === 'JSXExpressionContainer') return value.expression;
    return value;
}

function calleeName(callee) {
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier') return callee.property.name;
    return null;
}

/**
 * Does this literal look like a Tailwind class list on its own merits?
 *
 * WHY this exists: a chunk of the app keeps class lists in module constants
 * (`export const btnCls = 'text-[10px] … hover:text-white'`,
 * `const btn = 'border-slate-700 … text-slate-400'`) and applies them via
 * `className={btnCls}`. Those strings are never syntactically inside a
 * className attribute, so scope-by-attribute alone would leave them behind and
 * they would render white-on-white on every light theme. The test is
 * deliberately strict — every whitespace-separated token must have the shape of
 * a utility AND be either prefixed/hyphenated or a known bare utility — so a
 * sentence that merely mentions a class name does not qualify.
 */
function looksLikeClassList(text) {
    // Gate 1 — it must actually contain something this codemod would rewrite.
    // WHY first: without it, any single hyphenated lowercase string qualifies
    // ('en-IN', 'lucide-react', 'kill-all'), which needlessly widens the blast
    // radius. Requiring a candidate token means a false positive here can only
    // ever be a string that genuinely contains `text-white` / `text-slate-400`.
    RE_TEXT_WHITE.lastIndex = 0;
    RE_NEUTRAL_TEXT.lastIndex = 0;
    RE_NEUTRAL_BORDER.lastIndex = 0;
    if (!RE_TEXT_WHITE.test(text) && !RE_NEUTRAL_TEXT.test(text) && !RE_NEUTRAL_BORDER.test(text)) return false;

    // Gate 2 — and every token must have the shape of a utility.
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => {
        if (!RE_CLASS_TOKEN.test(tok)) return false;
        if (tok.includes('-') || tok.includes(':') || tok.includes('/') || tok.includes('[')) return true;
        return BARE_UTILITIES.has(tok);
    });
}

/**
 * Node types through which a class list is commonly *composed* rather than
 * written whole: `cond ? 'a' : 'b'`, `base + extra`, `flag && 'x'`, a helper's
 * `return`, an arrow body, a `const cls = …`. When a class string is found
 * outside any className attribute we climb these to recover the widest
 * expression that still only builds one class list — that expression is the
 * rule-1 context, so `on ? 'bg-blue-600 text-white' : 'text-slate-400'` inside a
 * helper is judged on both arms exactly as it would be inline on the element.
 */
const CONTEXT_CLIMB = new Set([
    'ConditionalExpression',
    'LogicalExpression',
    'BinaryExpression',
    'TemplateLiteral',
    'ParenthesizedExpression',
    'ReturnStatement',
    'ArrowFunctionExpression',
    'VariableDeclarator',
]);

/**
 * The set of classes that land on the element AT THE SAME TIME as the token at
 * [tokenStart, tokenEnd) — i.e. rule 1's real question, "what background is this
 * white text actually sitting on?"
 *
 * WHY not just the whole className expression: the dominant pattern in this app
 * is a two-arm tab/button toggle —
 *   `${active ? 'bg-primary/20 text-primary' : 'text-slate-400 hover:text-white'}`
 * The `hover:text-white` is in the INACTIVE arm and has no fill behind it, so it
 * must invert on light themes. Judging it against the whole expression would let
 * the *other* arm's `bg-primary` veto the rewrite and leave 7 nav/tab controls
 * rendering white-on-white in all six light themes.
 *
 * So conditionals are resolved by branch:
 *   - token inside one branch  -> only that branch counts (plus everything
 *                                 unconditional around it)
 *   - token outside the whole conditional -> BOTH branches count, because either
 *     may be the one supplying the fill and we must not strip a legitimately
 *     on-accent white. This is the `text-white ${ce ? 'bg-green-600' : 'bg-red-600'}`
 *     shape, where the white belongs to whichever arm is live.
 */
function contextFor(root, tokenStart, tokenEnd) {
    const parts = [];
    const holdsToken = (n) => n && typeof n.start === 'number' && tokenStart >= n.start && tokenEnd <= n.end;

    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        if (typeof node.type !== 'string') return;

        if (node.type === 'ConditionalExpression') {
            if (holdsToken(node.consequent)) return visit(node.consequent);
            if (holdsToken(node.alternate)) return visit(node.alternate);
            visit(node.consequent);
            visit(node.alternate);
            return;
        }
        if (node.type === 'LogicalExpression') {
            // `flag && 'classes'` / `x || 'classes'` — same branch logic; the
            // test side carries identifiers, not classes, so it is inert.
            if (holdsToken(node.right)) return visit(node.right);
            if (holdsToken(node.left)) return visit(node.left);
            visit(node.left);
            visit(node.right);
            return;
        }
        if (node.type === 'StringLiteral') {
            parts.push(node.value);
            return;
        }
        if (node.type === 'TemplateElement') {
            parts.push(node.value.raw);
            return;
        }
        for (const key of Object.keys(node)) {
            if (SKIP_KEYS.has(key)) continue;
            visit(node[key]);
        }
    };

    visit(root);
    return parts.join(' ');
}

/** Widest still-class-list-only ancestor of `node`, per CONTEXT_CLIMB. */
function expandContext(node, parentOf) {
    let current = node;
    for (;;) {
        const parent = parentOf.get(current);
        if (!parent || !CONTEXT_CLIMB.has(parent.type)) return current;
        // A block-bodied function is a real function, not a class expression:
        // climbing into it would drag in unrelated class strings and could make
        // an unrelated `bg-blue-600` elsewhere in the body veto a rule-1 rewrite.
        if (parent.body?.type === 'BlockStatement') return current;
        if (typeof parent.start !== 'number' || typeof parent.end !== 'number') return current;
        current = parent;
    }
}

/* ---------------------------------------------------------------- the rules */

/**
 * Rewrite one class-list text span. `context` is the source text of the WHOLE
 * enclosing className expression (both ternary arms, every interpolation),
 * because rule 1 asks whether "the same className string" carries an accent
 * fill — a question no single template chunk can answer on its own.
 */
function applyRules(raw, context, counts, sink, where) {
    const onAccent = RE_ON_ACCENT.test(context);

    // Rule 1 — text-white is either on-surface ink (must invert on light
    // themes) or on-accent ink (must stay white everywhere).
    let out = raw.replace(RE_TEXT_WHITE, (match) => {
        if (onAccent) {
            bump(counts, 'r1 text-white kept (on-accent)');
            sink.preserved.push(`${where}  ${context.replace(/\s+/g, ' ').slice(0, 130)}`);
            return match;
        }
        bump(counts, 'r1 text-white -> text-fg');
        return 'text-fg';
    });

    // Rule 2 — neutral text ramp -> fg role ramp, for all five neutral
    // families (slate is 96% of usage; gray/zinc/neutral/stone alias onto the
    // identical table so a mixed-family file stays visually consistent).
    out = out.replace(RE_NEUTRAL_TEXT, (match, prop, hue, shade) => {
        const role = FG_BY_SHADE[shade];
        const replacement = `${prop}-${role}`;
        bump(counts, `r2 ${prop}-{n}-${shade} -> ${replacement}`);
        return replacement;
    });

    // Rule 5 — neutral border ramp -> line role ramp. Unconditional: unlike
    // rule 1 there is no context question to ask, because a border is a border
    // whatever it is drawn around. `bg-` is untouched by construction (it is not
    // in BORDER_PROPS), which is what leaves the neutral shade ramp with exactly
    // one consumer.
    out = out.replace(RE_NEUTRAL_BORDER, (match, prop, hue, shade) => {
        const role = LINE_BY_SHADE[shade];
        const replacement = `${prop}-${role}`;
        bump(counts, `r5 ${prop}-{n}-${shade} -> ${replacement}`);
        return replacement;
    });

    // Rule 6 — px type scale -> rem type tokens. See TYPE_BY_PX for the why.
    // Purely a units change: every mapping below renders identically at a 16px
    // root, and only starts differing once the reader moves the Text Size axis,
    // which is the entire point.
    out = out.replace(RE_PX_TEXT, (match, pxRaw) => {
        const px = Number(pxRaw);
        let step = TYPE_PX_STEPS[0];
        for (const candidate of TYPE_PX_STEPS) {
            if (Math.abs(candidate - px) < Math.abs(step - px)) step = candidate;
        }
        const replacement = `text-${TYPE_BY_PX[step]}`;
        // An inexact hit is a judgement, so it is logged under its own key and
        // shows up in the per-rule totals rather than blending into the bulk.
        bump(counts, step === px
            ? `r6 text-[${px}px] -> ${replacement}`
            : `r6 text-[${px}px] -> ${replacement} (ROUNDED from ${px}px to ${step}px)`);
        return replacement;
    });

    // Rules 3 and 4 are intentionally no-ops: every accent colour class
    // (text-red-300, bg-emerald-900, border-blue-500 …) and every neutral
    // bg-/ring-/from-/to-/accent- class is rethemed purely by redefining its
    // `--color-*` var, so the source must not change.

    return out;
}

/* ------------------------------------------------------------ per-file pass */

function processFile(absPath) {
    const code = readFileSync(absPath, 'utf8');
    const counts = {};
    const sink = { preserved: [], fallback: [], unseen: [] };

    let ast;
    try {
        ast = parse(code, {
            sourceType: 'unambiguous',
            allowReturnOutsideFunction: true,
            errorRecovery: false,
            plugins: pluginsFor(absPath),
        });
    } catch (err) {
        return { error: err.message, counts, sink, changed: false, code };
    }

    /*
     * Pass 1 — class-scope roots. A "root" is a node whose whole subtree is
     * class-list territory: a className attribute value, or one argument of a
     * class-list builder. Its source text doubles as the rule-1 context.
     */
    const roots = [];
    const parentOf = new Map();
    walk(ast, (node, parent) => {
        parentOf.set(node, parent);
        if (node.type === 'JSXAttribute' && node.name?.type === 'JSXIdentifier' && node.name.name === 'className') {
            const value = unwrapAttrValue(node.value);
            if (value && typeof value.start === 'number') roots.push(value);
        } else if (node.type === 'CallExpression' && CLASS_HELPERS.has(calleeName(node.callee))) {
            for (const arg of node.arguments || []) {
                if (arg && typeof arg.start === 'number') roots.push(arg);
            }
        }
    });

    const inSomeRoot = (node) => roots.some((r) => node.start >= r.start && node.end <= r.end);

    /*
     * Pass 2 — fallback roots: standalone literals that ARE class lists (module
     * constants, helper return values). Skipped if already inside a root so the
     * whole-attribute context always wins for rule 1.
     */
    walk(ast, (node) => {
        if (node.type !== 'StringLiteral' && node.type !== 'TemplateLiteral') return;
        if (typeof node.start !== 'number') return;
        if (inSomeRoot(node)) return;
        const parent = parentOf.get(node);
        if (parent?.type === 'JSXAttribute' && NON_CLASS_ATTRS.has(parent.name?.name)) return;
        const text = node.type === 'StringLiteral'
            ? node.value
            : node.quasis.map((q) => q.value.raw).join(' ');
        if (!looksLikeClassList(text)) return;
        roots.push(expandContext(node, parentOf));
        sink.fallback.push(`${relative(FRONTEND_ROOT, absPath)}:${node.loc.start.line}  ${text.slice(0, 110)}`);
    });

    /*
     * Largest root first: a literal nested in several roots (clsx inside a
     * className, say) takes the OUTERMOST one as its rule-1 context, which is
     * the full set of classes that will actually land on the element.
     */
    roots.sort((a, b) => (b.end - b.start) - (a.end - a.start));

    /*
     * Collect the editable byte spans. Only the INNER text of a literal is
     * editable, never its quotes, so escapes and the `${` boundaries of a
     * template literal cannot be disturbed:
     *   StringLiteral   -> [start+1, end-1)
     *   TemplateElement -> [start, end)  (babel spans exactly the raw chunk)
     * Keyed by span so the same literal is never edited twice.
     */
    const spans = new Map();
    for (const root of roots) {
        walk(root, (node) => {
            let start = null;
            let end = null;
            if (node.type === 'StringLiteral') {
                start = node.start + 1;
                end = node.end - 1;
            } else if (node.type === 'TemplateElement') {
                start = node.start;
                end = node.end;
            }
            if (start === null || end <= start) return;
            const key = `${start}:${end}`;
            if (!spans.has(key)) {
                spans.set(key, {
                    start,
                    end,
                    root,
                    where: `${relative(FRONTEND_ROOT, absPath)}:${node.loc.start.line}`,
                });
            }
        });
    }

    const edits = [];
    for (const { start, end, root, where } of spans.values()) {
        const raw = code.slice(start, end);
        // Context is resolved per span so a two-arm ternary is judged arm by arm.
        const next = applyRules(raw, contextFor(root, start, end), counts, sink, where);
        if (next !== raw) edits.push({ start, end, next });
    }

    /*
     * Safety report: every candidate token in the file that fell OUTSIDE all
     * collected spans. These are the occurrences the codemod deliberately did
     * not touch — prose, comments, and any class string the scope rules did not
     * recognise. A reviewer must read this list, because a genuine class string
     * showing up here is the one way this codemod can silently under-apply.
     */
    RE_CANDIDATE.lastIndex = 0;
    for (let m = RE_CANDIDATE.exec(code); m; m = RE_CANDIDATE.exec(code)) {
        const at = m.index;
        const covered = [...spans.values()].some((s) => at >= s.start && at + m[0].length <= s.end);
        if (covered) continue;
        const line = code.slice(0, at).split('\n').length;
        sink.unseen.push(`${relative(FRONTEND_ROOT, absPath)}:${line}  ${m[0]}  |  ${code.split('\n')[line - 1].trim().slice(0, 100)}`);
    }

    if (edits.length === 0) return { counts, sink, changed: false, code };

    // Splice back-to-front so earlier offsets stay valid.
    edits.sort((a, b) => b.start - a.start);
    let out = code;
    for (const e of edits) out = out.slice(0, e.start) + e.next + out.slice(e.end);

    return { counts, sink, changed: out !== code, code: out };
}

/* -------------------------------------------------------------------- main */

function main() {
    const roots = targets.length > 0
        ? targets.map((t) => resolve(t))
        : [resolve(FRONTEND_ROOT, 'src')];

    const files = [];
    for (const r of roots) collectFiles(r, files);

    const total = {};
    const allPreserved = [];
    const allFallback = [];
    const allUnseen = [];
    let changedFiles = 0;
    let failed = 0;

    console.log(`theme-codemod: ${files.length} file(s)${DRY_RUN ? '  [DRY RUN — nothing written]' : ''}\n`);

    for (const file of files) {
        const rel = relative(FRONTEND_ROOT, file);
        const result = processFile(file);

        if (result.error) {
            failed += 1;
            console.log(`  !! ${rel}\n     parse failed: ${result.error}`);
            continue;
        }

        allPreserved.push(...result.sink.preserved);
        allFallback.push(...result.sink.fallback);
        allUnseen.push(...result.sink.unseen);
        for (const [k, v] of Object.entries(result.counts)) bump(total, k, v);

        // A file with only preserved (kept) text-white is counted but not written.
        const rewrites = sumRewrites(result.counts);
        if (rewrites === 0) continue;

        changedFiles += 1;
        const detail = Object.entries(result.counts)
            .filter(([k]) => isRewriteKey(k))
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k.replace(/^r\d /, '')} x${v}`)
            .join(', ');
        console.log(`  ${String(rewrites).padStart(4)}  ${rel}`);
        console.log(`        ${detail}`);
        if (!DRY_RUN && result.changed) writeFileSync(file, result.code, 'utf8');
    }

    console.log(`\n${'-'.repeat(72)}`);
    console.log('GRAND TOTAL BY RULE');
    for (const [k, v] of Object.entries(total).sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);
    console.log(`  ${'-'.repeat(60)}`);
    console.log(`  ${String(sumRewrites(total)).padStart(5)}  total rewrites across ${changedFiles} file(s)`);
    console.log(`  ${String(allUnseen.length).padStart(5)}  candidate tokens left untouched (outside every class-list span)`);
    console.log('        (rules 3 + 4 are no-ops by design: accent classes and neutral');
    console.log('         bg-/ring-/from-/to- classes retheme via --color-* vars)');

    if (LIST_FALLBACK && allFallback.length) {
        console.log(`\nliterals brought in by the class-list heuristic (${allFallback.length}):`);
        for (const line of allFallback) console.log(`  ${line}`);
    }
    if (LIST_PRESERVED && allPreserved.length) {
        console.log(`\non-accent text-white kept (${allPreserved.length} sites):`);
        for (const line of allPreserved) console.log(`  ${line}`);
    }
    if (LIST_UNSEEN && allUnseen.length) {
        console.log(`\ncandidate tokens OUTSIDE every class-list span — review these (${allUnseen.length}):`);
        for (const line of allUnseen) console.log(`  ${line}`);
    }

    process.exit(failed > 0 ? 1 : 0);
}

main();
