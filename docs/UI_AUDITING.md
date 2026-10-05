# Finding UI defects a human can see

Three bugs shipped past a review that fixed 800+ issues:

1. a lock icon sitting on top of the words "Enter dashboard password"
2. `/tick-results` and `/ai-score` rendering flush against the top-left edge while
   every other route inset by 24px
3. `/multi-leg` landing you 1,371px down the page instead of at the top

None of them were caught, and the reason is the same each time: **the method
could not see the defect class.** Not "we missed it" — the tool was structurally
incapable of reporting it. Every time this happens the fix is a new *class* of
check, not a more careful pass of the old one.

---

## The three layers, and what each one can and cannot see

| layer | question it answers | blind to |
|---|---|---|
| static analysis (eslint, `jsx-a11y`, grep) | is the *source* wrong? | anything that only exists after layout |
| `scripts/ui-geometry-audit.mjs` | is anything wrong *inside* this page? | anything only wrong relative to other pages |
| `scripts/ui-consistency-audit.mjs` | does this page match the rest of the app? | whether the design is any *good* |

A defect is invisible to a layer when the fact it depends on does not exist at
that layer. Work down the table when something slips through.

### Layer 1 — static analysis

Can tell you a button has no accessible name. Cannot tell you an icon covers a
label, because *where the icon lands* is not in the source. Don't regex-audit
a11y either — it was 75% false positives here; use `jsx-a11y`.

### Layer 2 — `ui-geometry-audit.mjs` (within-page)

Drives real Chrome and measures the rendered DOM:
`OVERLAP`, `OVERFLOW_X`, `OFFSCREEN`, `TINY_TARGET`, `CLIPPED_TEXT`,
`CONTRAST`, `ZERO_SIZE`, `BAD_VALUE`, `FLOAT_NOISE`.

`BAD_VALUE` catches `NaN`/`undefined`/`[object Object]`; `FLOAT_NOISE` catches
the subtler cousin — `₹2826.0000000000014`, a number that went through JS
arithmetic and was interpolated with no formatter. A long run of 0s or 9s after
the decimal point is the signature; no real price is ever written that way.

```bash
UI_PASSWORD=… npm run audit:ui
# responsive: viewport is a profile axis, so every check above re-runs per width
UI_VIEWPORTS=1440x900,1024x800,768x800,400x800 UI_PROFILES=1 UI_PASSWORD=… npm run audit:ui
# keyboard: walks the page with real Tab presses (opt-in, ~60 presses/route)
UI_FOCUS=1 UI_PROFILES=1 UI_PASSWORD=… npm run audit:ui
UI_THEME=carbon UI_CONTRAST=more UI_PROFILES=1 UI_PASSWORD=… npm run audit:ui
```

Theme, text-scale and **viewport** are profile inputs because each one changes
every measured value. The responsive "lens" is not a separate tool — it is these
same checks pointed at a narrow window, which is how phone-width text clipping
on the dashboard turned up.

The focus pass must use REAL key presses: `:focus-visible` — what almost every
focus ring is bound to — does not match when you call `el.focus()` from script,
so a script-only check reports a missing ring on every control.

### Layer 3 — `ui-consistency-audit.mjs` (cross-route)

Every check here is one idea: **measure a property on every route, take the
mode, flag the deviants.** That converts "this page looks off" — which a human
sees instantly and a machine normally cannot — into an outlier test with numbers
behind it.

`PAGE_GUTTER`, `CONTENT_ORIGIN`, `TITLE_TYPE`, `CARD_RECIPE`, `CONTROL_ROW`,
`LEFT_EDGE`, `LAYOUT_WIDTH`, `EMPTY_STATE`, `SCROLL_RESET`, `DOC_TITLE`,
`HEADING_ORDER`.

`SCROLL_RESET` deserves a note: this shell scrolls an inner `<main>`, so
`window.scrollY` is ALWAYS 0 and a page that lands half-way down looks fine to
every obvious check. Read the real scroller.

```bash
UI_PASSWORD=… UI_THEME=midnight node scripts/ui-consistency-audit.mjs
```

Use the **mode, not the mean**: a convention is what most of the app does, and
one wrong page must not drag the reference. A property that varies everywhere
has no convention to defend — report it as a design question, not as N findings.

---

## Rules learned the hard way

**Validate every detector before believing its count.** The geometry auditor's
first run said 1,452 findings. Four of the first five categories were the
*detector's own bugs*; the honest number was 149. Sample each category and
confirm by hand before acting on any of it.

- `getBoundingClientRect()` is **viewport-relative**. On a scrolled page
  everything above the fold reads negative.
- This app scrolls an inner `<main>`, so `documentElement.scrollHeight` is just
  the viewport height and `window.scrollY` is always 0. Both facts break the
  obvious implementation of several checks.
- **Never parse a colour with a regex.** Tailwind v4 emits
  `oklab(0.363 -0.048 -0.047 / 0.8)`; `/[\d.]+/g` drops the minus signs, so every
  themed colour parses as near-black regardless of hue. Paint to a 1×1 canvas and
  read the pixel — that also composites alpha against the real backdrop.
- A **pointer target is not the layout box**. Padding, a wrapping `<label>` and a
  `::after` hit area all enlarge it invisibly. Probe with `elementFromPoint`.
- **Identical numbers across different inputs mean the input is being ignored.**
  Violet and sky both measuring exactly 1.41:1 was the tell.
- **"Is there a focus ring?" is a question about CHANGE**, not about outlines.
  This app replaces the outline with a border-colour swap, so checking only
  `outline`/`box-shadow` called 34 controls ringless when they were not. Compare
  the focused element against a detached CLONE of itself — a clone cannot match
  `:focus-visible`, so its computed style is the unfocused baseline.
- **Focus scrolls the page.** Comparing viewport-relative `y` between tab stops
  makes every later element look like a jump backwards. Document coordinates.
- **Pin the theme.** A fresh puppeteer profile has empty `localStorage`, so the
  app seeds from `prefers-color-scheme` — headless Chrome reports *light*. An
  unpinned run is not reproducible.

**Never hand-maintain the route list.** Both auditors used to carry their own
literal array. It had drifted to include `/strategies` and `/data`, *neither of
which is a route*: they loaded a blank `<main>`, measured clean, and were
reported as "0 findings" — an audit pass on pages that do not exist. Meanwhile
four real pages were never visited. Both now derive from `src/config/nav.js` via
`scripts/lib/routes.mjs`, and both print their coverage *and their exclusions*.

**State what you skipped.** A number that silently excludes things is worse than
no number, because it reads as coverage.

---

## What none of this can find

Whether the design is *good*: is the most important number the most prominent
one? Does red mean exactly one thing? Is the empty state reassuring or alarming?
Is the wording consistent? For those, screenshot every route and **look**, or
have an agent look. Measurement finds inconsistency; only judgement finds a bad
idea rendered consistently.

## Run the linter you already have

`npx eslint src` — `no-undef` is configured as an **error** and is the
authoritative guard for "used a helper, forgot the import". Two such latent
`ReferenceError`s survived a passing 80-test suite in one sitting, because both
call sites sat behind conditionals that the tests never rendered. Four errors
are pre-existing (`AuthContext`, `GlobalContext`, `Callback`); anything beyond
that is yours.

## When something slips through anyway

Ask which layer *should* have caught it. If none could have, that is a new class
— add the check, then re-run everything. That is how layer 3 came to exist.
