// ── FORMATTERS + tiny geometry helpers, shared by every panel of the builder ──
//
// Every numeric render on the strategy builder goes through one of these. A
// trading screen that prints "₹NaN" or "undefined" beside a real number is
// worse than one that prints nothing, because both look equally authoritative.
//
// Lives in a .js file with NO component exports on purpose: mixing helpers and
// components in one module breaks Fast Refresh (and trips
// react-refresh/only-export-components).

export const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export const fmt = (v, d = 0) => {
    const n = num(v);
    return n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: d });
};

/** Rupees with a proper minus glyph and the sign outside the ₹. */
export const rup = (v, d = 0) => {
    const n = num(v);
    if (n == null) return '—';
    return `${n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: d })}`;
};

export const pct = (v, d = 1) => {
    const n = num(v);
    return n == null ? '—' : `${n.toFixed(d)}%`;
};

/** Signed rupees — the sign is the point (credit vs debit, long vs short vol). */
export const sgn = (v, d = 0) => {
    const n = num(v);
    if (n == null) return '—';
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: d })}`;
};

/** Signed plain number (greeks, deltas) — no currency glyph. */
export const sgnNum = (v, d = 2) => {
    const n = num(v);
    if (n == null) return '—';
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })}`;
};

/** Compact Indian magnitudes for axis ticks — open interest runs to lakhs. */
export const compact = (v) => {
    const n = num(v);
    if (n == null) return '—';
    const a = Math.abs(n);
    if (a >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
    if (a >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
    if (a >= 1e3) return `${Math.round(n / 1e3)}k`;
    return String(Math.round(n));
};

export const shortSym = (s) => String(s || '').replace('NSE:', '').replace('BSE:', '').replace('-INDEX', '');

export const addDays = (iso, n) => {
    const d = new Date(`${iso}T10:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → '28 Aug'. Parsed by hand rather than through Date so a
 *  browser west of UTC cannot render the previous day. */
export const shortDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '—';
    const mi = Number(m[2]) - 1;
    return `${Number(m[3])} ${MONTHS[mi] || '?'}`;
};

/** Linear interpolation of a payoff curve at an arbitrary spot.
 *  The what-if curve is built over its OWN spot window (the server re-centres
 *  the window on the shifted spot), so it cannot be zipped index-by-index onto
 *  the base curve — it has to be resampled onto the base curve's x values or
 *  the two lines drift apart by a few points at every strike. */
export function interpAt(curve, x, key) {
    if (!Array.isArray(curve) || curve.length < 2) return null;
    const first = curve[0], last = curve[curve.length - 1];
    if (x <= first.spot) return num(first[key]);
    if (x >= last.spot) return num(last[key]);
    let lo = 0, hi = curve.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (curve[mid].spot <= x) lo = mid; else hi = mid;
    }
    const a = curve[lo], b = curve[hi];
    const av = num(a[key]), bv = num(b[key]);
    if (av == null || bv == null) return null;
    const span = b.spot - a.spot;
    return span === 0 ? av : av + (bv - av) * ((x - a.spot) / span);
}

export const inputCls = 'w-full mt-1 bg-slate-800 border border-line rounded p-1.5 text-fg-2';
export const cellCls = 'bg-slate-800 border border-line rounded px-1 py-0.5 text-fg-2 text-2xs';
export const btnCls = 'text-3xs px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-3 hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed';
export const tabCls = (on) => `text-2xs px-2.5 py-1 rounded-t border-b-2 ${on ? 'border-primary text-primary-ink bg-primary/10' : 'border-transparent text-fg-5 hover:text-fg-3'}`;

/**
 * WHICH STANDARD-DEVIATION HORIZON IS ON SCREEN.
 *
 * The server publishes the same sigma twice and they are NOT interchangeable:
 *   sdLevels          — TRADING time. What the pricing kernel and the greeks
 *                       actually ran on; a weekend barely ages the position.
 *   sdLevelsCalendar  — CALENDAR time. Wider, because spot keeps moving over a
 *                       weekend whether or not options decay. This is what most
 *                       broker screens quote, so it is the default here.
 * Whichever is shown, the panel LABELS it — an unlabelled "1SD" that disagrees
 * with another platform for an invisible reason is worse than no number.
 *
 * Returns { levels, horizon } where horizon may differ from the requested mode
 * if the requested one came back empty (no IV ⇒ no sigma at all).
 */
export function sdFor(an, mode, spot) {
    const cal = Array.isArray(an?.sdLevelsCalendar) ? an.sdLevelsCalendar : [];
    const trd = Array.isArray(an?.sdLevels) ? an.sdLevels : [];
    const want = mode === 'calendar' ? cal : trd;
    if (want.length) return { levels: want, horizon: mode };
    const other = mode === 'calendar' ? trd : cal;
    if (other.length) return { levels: other, horizon: mode === 'calendar' ? 'trading' : 'calendar' };
    // Last resort: the ±1σ expected move, which is computed on TRADING time.
    const em = num(an?.expectedMove), s = num(spot);
    if (em != null && em > 0 && s != null && s > 0) {
        return {
            levels: [{ sd: 1, points: em, pct: (em / s) * 100, up: s + em, down: s - em }],
            horizon: 'trading',
        };
    }
    return { levels: [], horizon: mode };
}

export const SD_HORIZON_NOTE = {
    calendar: 'calendar days — wall-clock, and what most broker screens quote',
    trading: 'trading time — the horizon the pricing and the greeks actually used',
};
