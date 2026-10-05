/**
 * Visualization tokens — the ONE place chart colour is defined.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 * This file used to hold 127 lines of literal dark-only hex. It now holds the
 * same RULES, expressed against whichever of the 12 themes is active. The
 * values below are no longer typed in; they are cut from the theme's role ramp
 * by `src/theme/chartTheme.js`, which returns exactly the shape this file used
 * to export. Nothing about the design rationale changed — only where the
 * numbers come from.
 *
 * The palette relationships this file encodes were validated against the real
 * dark card surface (#262730), and the theme engine reproduces those anchors
 * byte-for-byte on the default `midnight` theme (see CHART_ANCHORS in
 * `src/theme/ramp.js`, which carries the same OKLCH values forward and rotates
 * them per theme rather than re-deriving them — so the gates below still hold):
 *
 *   categorical [#3987e5, #d95926, #199e70]
 *     ✓ lightness band  ✓ chroma floor  ✓ contrast ≥3:1
 *     ✓ CVD separation worst adjacent ΔE 9.4 (target ≥8)
 *     ✓ normal-vision worst adjacent ΔE 26.5 (floor ≥15)
 *
 *   diverging poles [#3987e5, #e66767]
 *     ✓ all checks — CVD ΔE 19.2, normal-vision ΔE 29.0
 *
 * RULES THIS FILE ENCODES
 * -----------------------
 * • Categorical is capped at 3 slots. A 4th is never generated — fold the tail
 *   into "Other" or facet. (A generated hue is indistinguishable under CVD.)
 * • Diverging = two hues that read as opposite + a NEUTRAL midpoint. The
 *   midpoint is the surface itself, so "zero" reads as nothing.
 * • Status colours are reserved for state and never used as a series. They
 *   always ship with an icon AND a text label, so meaning never rests on hue —
 *   which is also what makes them safe despite sitting outside the series
 *   lightness band.
 * • P&L polarity uses the DIVERGING pair, not green/red. Red/green is the
 *   trading convention but is the classic CVD failure, and on the stress
 *   heatmap colour is doing real work. Every cell is direct-labelled with its
 *   rupee value, so the number always carries the sign regardless.
 *
 * TWO WAYS IN — AND WHICH ONE TO USE
 * -----------------------
 *   useChartTheme()  ← from a component. Returns the ACTIVE theme's role table
 *                      and re-renders the caller when the theme changes.
 *   SURFACE / TEXT / CATEGORICAL / DIVERGING / STATUS / GRID
 *                    ← the frozen `midnight` values. These exist for module
 *                      scope and for callers that are not in a React tree
 *                      (a plain helper, a test, a node probe). They are CORRECT
 *                      but they are FIXED: a component that reads them will not
 *                      follow a theme switch. Prefer the hook in components.
 *
 * The two are the same function of the same data — the constants are literally
 * `buildChartTheme(midnight)` — so they can never disagree about what a role
 * means, only about which theme is being asked.
 */
import { MIDNIGHT_CHART_THEME, useChartTheme } from '../../theme/chartTheme.js';

// The hook is re-exported from here so a chart component has ONE import for
// both its colours and its formatters, and so no call site needs to know the
// theme engine's file layout.
export { useChartTheme };

// ── Surfaces ─────────────────────────────────────────────────────────────────
// midnight: #262730 / #1c1d25 / #0e1117 — the three literal surfaces in the
// shipping stylesheet, which is why they are the documented fallback.
export const SURFACE = MIDNIGHT_CHART_THEME.surface;
export const SURFACE_SUNK = MIDNIGHT_CHART_THEME.surfaceSunk;
export const BACKGROUND = MIDNIGHT_CHART_THEME.background;

// ── Text (never a series colour) ─────────────────────────────────────────────
export const TEXT = MIDNIGHT_CHART_THEME.text;

// ── Categorical: identity. Fixed order, never cycled, hard cap of 3. ─────────
export const CATEGORICAL = MIDNIGHT_CHART_THEME.categorical;

/** Stable hue for a named entity — colour follows the entity, never its rank,
 *  so filtering a list never repaints the survivors.
 *
 *  Fixed to the midnight trio, like the constants above. The theme-aware
 *  version is `useChartTheme().hueFor`, which hashes identically. */
export function hueFor(name, index) {
    if (typeof index === 'number' && index < CATEGORICAL.length) return CATEGORICAL[index];
    let h = 0;
    for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) | 0;
    return CATEGORICAL[Math.abs(h) % CATEGORICAL.length];
}

// ── Diverging: polarity (profit ↔ loss, positive ↔ negative contribution) ────
export const DIVERGING = MIDNIGHT_CHART_THEME.diverging;

/**
 * Blend a pole toward the surface by magnitude. Alpha-over-surface guarantees a
 * monotone lightness ramp with the surface itself as the neutral midpoint — no
 * hand-picked steps to drift out of order.
 *
 * Theme-aware equivalent: `useChartTheme().divergingFill`.
 * @param {number} value   the signed value
 * @param {number} maxAbs  the scale's largest |value|
 */
export function divergingFill(value, maxAbs) {
    return MIDNIGHT_CHART_THEME.divergingFill(value, maxAbs);
}

/** Same ramp expressed as rgb() — for engines without color-mix support.
 *  Theme-aware equivalent: `useChartTheme().divergingRgba`. */
export function divergingRgba(value, maxAbs) {
    return MIDNIGHT_CHART_THEME.divergingRgba(value, maxAbs);
}

// ── Status: state only. Icon + label ALWAYS accompany these. ─────────────────
export const STATUS = MIDNIGHT_CHART_THEME.status;

// The icon set is NOT a colour and is deliberately not themed: it is the
// non-colour channel that makes every status legible under CVD, so it must be
// identical in all 12 themes.
export const STATUS_ICON = { good: '✓', warning: '▲', serious: '▲', critical: '✕', info: 'i' };

// ── Chrome ───────────────────────────────────────────────────────────────────
export const GRID = MIDNIGHT_CHART_THEME.grid;        // solid hairline, one shade off the surface

// ── Formatting ───────────────────────────────────────────────────────────────
// Pure text. Nothing below has ever had a colour in it, and none of it moves
// with the theme.

/**
 * Indian-format rupees. Compact above a lakh so tiles stay one line.
 *
 * THE ONE RUPEE FORMATTER. There used to be four — this one, plus private
 * copies in AiScore, StrategyDetail and multileg/builderFormat — and they had
 * drifted onto TWO different minus signs: ASCII '-' here and in StrategyDetail,
 * U+2212 '−' in the other two. The same P&L therefore rendered as "-₹6,399" on
 * one route and "−₹3,549" on another, and both appeared inside a single card on
 * /multi-leg. Four helpers will always drift again, so the other three now
 * delegate here and this is the only place the convention is written down.
 *
 * The sign is an ASCII hyphen OUTSIDE the ₹ glyph: it survives a copy-paste into
 * a spreadsheet as a negative number, which U+2212 does not.
 *
 * `dp` pins the decimals; omit it for the default (2 below ₹100, whole rupees
 * above — small premiums need the paise, a lakh does not).
 */
export function inr(v, { compact = false, sign = false, dp = null } = {}) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const s = n < 0 ? '-' : (sign && n > 0 ? '+' : '');
    const a = Math.abs(n);
    if (compact && a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`;
    if (compact && a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
    if (compact && a >= 1000) return `${s}₹${(a / 1000).toFixed(1)}k`;
    const max = dp == null ? (a < 100 ? 2 : 0) : dp;
    return `${s}₹${a.toLocaleString('en-IN', { maximumFractionDigits: max })}`;
}

/**
 * An option premium. ALWAYS 2dp.
 *
 * The tick size is 0.05, so "265.8" and "265.80" are the same price — but the
 * trade table stripped trailing zeros while the activity feed padded them, so
 * one page showed the same fill two ways. 2dp everywhere, non-finite as an em
 * dash like every other formatter here.
 */
export function premium(v) {
    const n = Number(v);
    return Number.isFinite(n) ? `₹${n.toFixed(2)}` : '—';
}

/**
 * A date and time in IST, 24-hour.
 *
 * The app renders 169 timestamps as 24-hour and 23 as 12-hour am/pm, because
 * `toLocaleString('en-IN', { timeZone })` defaults to am/pm and the `hour12:
 * false` that appears at 17 other call sites was simply missed here. Two clock
 * formats sat in adjacent tables on the dashboard. Market times are 24-hour,
 * so that is the convention; this is the only place it is written down.
 *
 * Always IST: a trading timestamp with no timezone is ambiguous, and the
 * containers run UTC.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * 'YYYY-MM-DD' (an IST trading date) -> 'Mar 2026'.
 *
 * Parsed from the string, never through Date + a timezone (the input is already
 * a calendar DATE; any shift could cross a month boundary) and never through
 * toLocaleString: 'en-IN' renders September as "Sept" on newer ICU builds and
 * "Sep" on older ones, so the same label differed between browsers.
 */
export function monthYear(day) {
    const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-\d{2}$/.exec(day) : null;
    if (!m) return '\u2014';
    const mon = MONTHS[Number(m[2]) - 1];
    return mon ? `${mon} ${m[1]}` : '\u2014';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/**
 * 'YYYY-MM-DD' (an IST trading date) -> 'Mon 28 Sep 2026'.
 *
 * Same discipline as monthYear(): the input is already a calendar DATE in IST,
 * so it is parsed from the string and the weekday is taken from Date.UTC on
 * those same digits. Routing it through `new Date(day)` + a timezone would let
 * a browser west of UTC print the previous day.
 */
export function istDayLabel(day, { year = true } = {}) {
    const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
    if (!m) return '—';
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const mon = MONTHS[mo - 1];
    const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
    if (!mon || !wd) return '—';
    return `${wd} ${d} ${mon}${year ? ` ${y}` : ''}`;
}

export function istDateTime(v, { seconds = false } = {}) {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
        hour12: false,
    });
}

/** Time of day only, IST, 24-hour. */
export function istTime(v, { seconds = true } = {}) {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit', minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
        hour12: false,
    });
}

/**
 * A rupee axis tick.
 *
 * Was copy-pasted into five files as a local `rupTick`, every copy compacting to
 * Western "k" ONLY — so an equity-curve axis read ₹2200k directly beneath a tile
 * reading -₹15,13,606, two ways of writing the same magnitude a centimetre
 * apart. Uses the same Cr/L/k ladder as inr({compact}) so the axis and the
 * number above it agree.
 *
 * Trailing zeros are dropped (₹22L, not ₹22.00L) because an axis label has less
 * room than a tile and the extra precision buys nothing at tick resolution.
 */
export function rupeeTick(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    const s = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e7) return `${s}₹${+(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `${s}₹${+(a / 1e5).toFixed(2)}L`;
    if (a >= 1000) return `${s}₹${+(a / 1000).toFixed(1)}k`;
    return `${s}₹${Math.round(a)}`;
}

/**
 * Polarity ink for a signed quantity. THREE-way, not two.
 *
 * `v >= 0 ? 'text-success' : 'text-danger'` paints ZERO as profit, which is how
 * "TODAY'S NET P&L ₹0" rendered in green next to a rising arrow, and how every
 * never-traded strategy row showed `+0.00` in profit green. Zero is neither,
 * and a non-value is neither — both get neutral ink.
 *
 * `Number(null)` is 0, which is normally the trap — here it lands on the SAME
 * neutral answer as undefined/NaN, so passing a null through is safe and
 * deliberate. Do not "optimise" this back into a `>= 0` check.
 */
export function pnlTone(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'text-fg-5';
    return n > 0 ? 'text-success' : n < 0 ? 'text-danger' : 'text-fg-5';
}

export function pct(v, dp = 1) {
    const n = Number(v);
    return Number.isFinite(n) ? `${n >= 0 ? '' : ''}${n.toFixed(dp)}%` : '—';
}

export function num(v, dp = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: dp }) : '—';
}
