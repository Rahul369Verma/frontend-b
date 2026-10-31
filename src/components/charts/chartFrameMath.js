'use strict';
/**
 * Pure helpers for ZoomableChart (the one chart frame every recharts chart sits in):
 * numeric-domain zoom/pan for `mode="xy"` charts, the pointer → data mapping, and
 * the CSV / PNG exports. No React here, so they are testable on their own.
 */

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** What every chart's controls can do, in one sentence (the toolbar's help). */
export const CHART_HELP = 'Drag across the chart to zoom into a range · Ctrl (or ⌘) + wheel, or a trackpad pinch, zooms at the cursor · Shift + drag, or the hand, pans · sideways scroll pans a zoomed chart · double-click resets · click a legend entry to hide or show that line · keys when the chart has focus: + − ← → 0, F for full screen';

/** A numeric [lo, hi] domain, or null (categorical / unknown). */
export function numericDomain(d) {
    if (!Array.isArray(d) || d.length < 2) return null;
    const lo = d[0], hi = d[d.length - 1];
    return fin(lo) && fin(hi) && hi > lo ? [lo, hi] : null;
}

/** Zoom [lo, hi] by `factor` (<1 in, >1 out) about the point at `frac` (0..1) — never past `full`. */
export function zoomDomain(dom, factor, frac = 0.5, full = null) {
    if (!dom) return null;
    const [lo, hi] = dom;
    const f = Math.min(1, Math.max(0, fin(frac) ? frac : 0.5));
    const anchor = lo + (hi - lo) * f;
    let nlo = anchor - (anchor - lo) * factor;
    let nhi = anchor + (hi - anchor) * factor;
    if (full) {
        const [flo, fhi] = full;
        if (nhi - nlo >= fhi - flo) return null;          // zoomed all the way out
        if (nlo < flo) { nhi += flo - nlo; nlo = flo; }
        if (nhi > fhi) { nlo -= nhi - fhi; nhi = fhi; }
    }
    return nhi > nlo ? [nlo, nhi] : dom;
}

const MINUTE = 60000;
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 10080].map((m) => m * MINUTE);
const IST_MS = 5.5 * 3600e3;

/**
 * Round tick values for a zoomed axis. A zoomed domain has arbitrary ends, and recharts
 * splits a fixed domain evenly — labels like "-1.473969…" that a narrow axis clips.
 * Numbers step by 1/2/5 × 10^k; time (`scale="time"`) by whole minutes/hours, on the IST
 * clock (an hourly tick lands on 10:00 IST, not 10:30).
 */
export function niceTicks(dom, { time = false, target = 5 } = {}) {
    if (!dom) return undefined;
    const [lo, hi] = dom;
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    let step, offset = 0;
    if (time) {
        step = TIME_STEPS.find((s) => span / s <= target + 1) || TIME_STEPS[TIME_STEPS.length - 1];
        offset = IST_MS;
    } else {
        const raw = span / target;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const norm = raw / mag;
        step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    }
    const out = [];
    for (let v = Math.ceil((lo + offset) / step) * step - offset; v <= hi + step * 1e-9 && out.length < 50; v += step) {
        out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return out;
}

/** Shift [lo, hi] by `frac` of its width, kept inside `full` when given. */
export function panDomain(dom, frac, full = null) {
    if (!dom) return null;
    const w = dom[1] - dom[0];
    let lo = dom[0] + w * frac, hi = dom[1] + w * frac;
    if (full) {
        if (lo < full[0]) { hi += full[0] - lo; lo = full[0]; }
        if (hi > full[1]) { lo -= hi - full[1]; hi = full[1]; }
    }
    return [lo, hi];
}

/** A pixel inside the plot area → the data value on a linear axis (y is inverted). */
export function pxToValue(px, plotStart, plotSize, dom, invert = false) {
    if (!dom || !(plotSize > 0)) return null;
    let f = (px - plotStart) / plotSize;
    f = Math.min(1, Math.max(0, f));
    if (invert) f = 1 - f;
    return dom[0] + (dom[1] - dom[0]) * f;
}

/** Where a pixel sits across the plot (0..1), for zooming about the cursor. */
export function fracAcross(px, plotStart, plotSize) {
    if (!(plotSize > 0)) return 0.5;
    return Math.min(1, Math.max(0, (px - plotStart) / plotSize));
}

const csvCell = (v) => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows → CSV: every key whose values are plain (number / string / boolean / date), first-seen order. */
export function rowsToCsv(rows) {
    const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
    const keys = [];
    const seen = new Set();
    for (const r of list.slice(0, 500)) {
        for (const [k, v] of Object.entries(r)) {
            if (seen.has(k) || k.startsWith('_')) continue;
            if (v == null || ['number', 'string', 'boolean'].includes(typeof v) || v instanceof Date) { seen.add(k); keys.push(k); }
        }
    }
    const lines = [keys.map(csvCell).join(',')];
    for (const r of list) lines.push(keys.map((k) => { const v = r[k]; return typeof v === 'object' && v !== null && !(v instanceof Date) ? '' : csvCell(v); }).join(','));
    return lines.join('\n');
}

/** A file name from a chart title: "Equity — combined" → "equity-combined". */
export function fileStem(s, fallback = 'chart') {
    const t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return t || fallback;
}

/** Save a Blob as a file. */
export function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * The chart under `root` as a PNG: the recharts SVG (its colours are resolved hex,
 * never CSS variables) on the page background, plus the HTML legend redrawn as
 * swatches and labels at their on-screen positions. 2x for a sharp image.
 */
export async function chartToPng(root, { background = '#111', font = 'sans-serif', scale = 2 } = {}) {
    const svg = root && root.querySelector('svg.recharts-surface');
    if (!svg) throw new Error('no chart to export');
    const box = root.getBoundingClientRect();
    const sb = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(sb.width));
    clone.setAttribute('height', String(sb.height));
    clone.setAttribute('font-family', font);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the chart image could not be drawn')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(box.width * scale); canvas.height = Math.ceil(box.height * scale);
    const g = canvas.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = background; g.fillRect(0, 0, box.width, box.height);
    g.drawImage(img, sb.left - box.left, sb.top - box.top, sb.width, sb.height);
    // the legend is HTML in recharts 3 — redraw its entries where they sit
    for (const item of root.querySelectorAll('.recharts-legend-item')) {
        const r = item.getBoundingClientRect();
        const icon = item.querySelector('svg');
        const sw = icon && icon.querySelector('[fill]:not([fill="none"]), [stroke]');
        const color = sw ? (sw.getAttribute('fill') !== 'none' && sw.getAttribute('fill')) || sw.getAttribute('stroke') : '#888';
        const text = (item.textContent || '').trim();
        const x = r.left - box.left, y = r.top - box.top + r.height / 2;
        g.fillStyle = color || '#888'; g.fillRect(x, y - 3, 10, 6);
        const cs = getComputedStyle(item);
        g.fillStyle = cs.color || '#ccc'; g.font = `${cs.fontSize || '11px'} ${font}`; g.textBaseline = 'middle';
        g.globalAlpha = Number(cs.opacity) || 1;
        g.fillText(text, x + 14, y);
        g.globalAlpha = 1;
    }
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
}
