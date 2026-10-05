#!/usr/bin/env node
/**
 * ui-geometry-audit.mjs — find UI defects that only exist once the browser has
 * laid the page out.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A static audit (regex, eslint-plugin-jsx-a11y) can tell you a button has no
 * accessible name. It cannot tell you a lock icon is sitting on top of the words
 * "Enter dashboard password", because that fact does not exist in the source —
 * it only exists after the browser resolves position, padding and font size.
 * That is how a visible overlap survived an 800-fix pass: the whole class was
 * invisible to the method.
 *
 * So this drives a real Chrome, walks the rendered DOM, and measures:
 *   OVERLAP        an absolutely-positioned element covering a field's text area
 *   OVERFLOW       content wider/taller than the box that is supposed to hold it
 *   OFFSCREEN      interactive elements outside the viewport
 *   TINY_TARGET    clickable things below the 24px minimum (WCAG 2.2 AA)
 *   CLIPPED_TEXT   text truncated with no title/aria to recover it
 *   CONTRAST       computed foreground/background below 4.5:1
 *   FLOAT_NOISE    unformatted JS floats (2826.0000000000014) on screen
 *   (UI_FOCUS=1)   NO_FOCUS_RING / FOCUS_OFFSCREEN / FOCUS_ORDER / POSITIVE_TABINDEX
 *   ZERO_SIZE      rendered-but-invisible interactive elements
 *
 * Run against each theme + text-size + VIEWPORT combination, because most of
 * these are conditional on exactly those axes:
 *   UI_VIEWPORTS=1440x900,1024x800,768x800,400x800 UI_PROFILES=1 npm run audit:ui
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { auditRoutes } from './lib/routes.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:5173';
const PASSWORD = process.env.UI_PASSWORD || '';
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const OUT = process.env.UI_OUT || '/tmp/ui-audit';
const ONLY = process.env.UI_ONLY ? process.env.UI_ONLY.split(',') : null;
// The Tab walk costs ~60 key presses per route, so it is opt-in: UI_FOCUS=1.
const FOCUS_AUDIT = process.env.UI_FOCUS === '1';

// Derived from src/config/nav.js, never hand-maintained. The literal list that
// used to live here had drifted: it named `/strategies` and `/data`, neither of
// which is a route, and both measured "0 findings" because they loaded a blank
// <main>. Four real pages were never visited at all.
const { routes: NAV_ROUTES, skipped: SKIPPED_ROUTES } = auditRoutes();
const ROUTES = ONLY || NAV_ROUTES;

// Text-size axis is the single biggest source of geometry bugs, so audit at both
// ends rather than only the default.
// The theme and the contrast axis change every measured colour, so they are
// part of the profile, not a global. UI_THEME defaults to the app's own default
// theme; UI_CONTRAST to 'normal'. Audit another with e.g.
//   UI_THEME=carbon UI_CONTRAST=more node scripts/ui-geometry-audit.mjs
const THEME_ID = process.env.UI_THEME || null;
const CONTRAST = process.env.UI_CONTRAST || null;
// index.html sets data-theme-mode before first paint from the stored top-level
// `mode`, so it has to be right or the first frame is the wrong mode.
const THEME_MODE = THEME_ID
  ? (((await import('../src/theme/themes.js')).THEMES).find?.(t => t.id === THEME_ID)?.mode
     || Object.values((await import('../src/theme/themes.js')).THEMES).find(t => t.id === THEME_ID)?.mode
     || 'dark')
  : null;
// Viewport is the OTHER axis that changes every measurement. A layout that is
// fine at 1440 can overflow, overlap or clip at 768 — and every check in this
// file (OVERFLOW_X, OVERLAP, CLIPPED_TEXT, TINY_TARGET) is exactly the right
// instrument for that, it was just never pointed at a narrow window.
// 1440 desktop · 1024 small laptop · 768 tablet · 400 phone.
const VIEWPORTS = (process.env.UI_VIEWPORTS || '1440x900').split(',').map((v) => {
  const [w, h] = v.toLowerCase().split('x').map(Number);
  if (!w || !h) throw new Error(`bad UI_VIEWPORTS entry "${v}" — expected WIDTHxHEIGHT`);
  return { w, h };
});

const PROFILES = (process.env.UI_PROFILES || '1,1.4').split(',').map(Number).flatMap(fontScale =>
  VIEWPORTS.map(vp => ({
  vp,
  name: `scale-${fontScale}` + (VIEWPORTS.length > 1 ? `-${vp.w}w` : '')
    + (THEME_ID ? `-${THEME_ID}` : '')
    + (CONTRAST && CONTRAST !== 'normal' ? `-${CONTRAST}` : ''),
  fontScale,
})));

/** Injected into the page: everything below runs in the browser. */
const PROBE = () => {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const seen = new Set();

  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const txt = (el.getAttribute?.('placeholder') || el.getAttribute?.('aria-label') || el.textContent || '')
      .trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const push = (kind, el, detail, extra = {}) => {
    const k = `${kind}|${label(el)}|${detail}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, el: label(el), detail, ...extra });
  };

  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };

  // ── 1. OVERLAP: an absolutely-positioned element over a field's TEXT area ──
  // This is the lock-icon-on-placeholder bug. For every input/select/textarea we
  // compute the box where its text actually starts (border + padding) and check
  // whether any absolutely-positioned element in the same containing block
  // intrudes into it.
  for (const field of document.querySelectorAll('input, textarea, select')) {
    if (!vis(field)) continue;
    const fr = field.getBoundingClientRect();
    const cs = getComputedStyle(field);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const bL = parseFloat(cs.borderLeftWidth) || 0, bR = parseFloat(cs.borderRightWidth) || 0;
    // where glyphs actually begin / end
    const textLeft = fr.left + bL + padL;
    const textRight = fr.right - bR - padR;
    if (textRight <= textLeft) continue;

    let host = field.parentElement;
    for (let d = 0; host && d < 3; d++, host = host.parentElement) {
      for (const ov of host.children) {
        if (ov === field || ov.contains(field)) continue;
        if (!vis(ov)) continue;
        const os = getComputedStyle(ov);
        if (os.position !== 'absolute' && os.position !== 'fixed') continue;
        const orr = ov.getBoundingClientRect();
        if (orr.width === 0 || orr.height === 0) continue;
        // vertical overlap with the field at all?
        if (orr.bottom < fr.top || orr.top > fr.bottom) continue;
        // does it intrude into the TEXT area (not merely the padding gutter)?
        const intrudes = orr.right > textLeft + 1 && orr.left < textRight - 1;
        if (intrudes) {
          const side = orr.left < (fr.left + fr.width / 2) ? 'left' : 'right';
          const need = side === 'left'
            ? Math.ceil(orr.right - fr.left - bL) : Math.ceil(fr.right - orr.left - bR);
          push('OVERLAP', field,
            `${ov.tagName.toLowerCase()} overlaps the text area on the ${side}; ` +
            `padding-${side} is ${Math.round(side === 'left' ? padL : padR)}px but needs ≥ ${need}px`,
            { overlapPx: Math.round(side === 'left' ? orr.right - textLeft : textRight - orr.left) });
        }
      }
    }
  }

  // ── 2. OVERFLOW / 3. OFFSCREEN / 4. TINY TARGET / 7. ZERO SIZE ────────────
  const INTERACTIVE = 'a,button,input,select,textarea,[role="button"],[role="switch"],[role="tab"],[onclick]';
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { push('ZERO_SIZE', el, `renders ${Math.round(r.width)}×${Math.round(r.height)} but is interactive`); continue; }
    // Measure the EFFECTIVE POINTER TARGET, not the layout box. Padding, a
    // wrapping <label>, and a ::after hit-area all enlarge what a pointer can
    // actually hit, and NONE of them appear in getBoundingClientRect() — so a
    // rect-based check both misses real problems and cannot see their fixes.
    // Probing with elementFromPoint is the ground truth.
    //
    // BOTH dimensions must be under 24: WCAG 2.5.8 targets tiny icon buttons,
    // and a 69×23 text button is one pixel under on one axis, not what the
    // criterion is about.
    // A form control activated by a <label> is as big as that label — WCAG
    // 2.5.8's label exception — and `.sr-only` inputs are a deliberate
    // visually-hidden pattern whose visible proxy is the styled sibling.
    let eff = r;
    if (el.labels && el.labels.length) {
      for (const lab of el.labels) {
        const lr = lab.getBoundingClientRect();
        if (lr.width * lr.height > eff.width * eff.height) eff = lr;
      }
    }
    if (el.classList.contains('sr-only')) eff = { width: 999, height: 999 };

    if (eff.width < 24 && eff.height < 24) {
      const cxp = r.left + r.width / 2, cyp = r.top + r.height / 2;
      const H = 11;                      // half of 24, inset 1px off the boundary
      const hitOk = (x, y) => {
        if (x < 0 || y < 0 || x >= vw || y >= vh) return true;   // can't probe offscreen
        const hit = document.elementFromPoint(x, y);
        if (!hit) return false;
        // el itself (incl. its pseudo-elements), a descendant, or the <label>
        // that activates it — the WCAG 2.5.8 label exception.
        return hit === el || el.contains(hit) || (hit.tagName === 'LABEL' && hit.contains(el));
      };
      const covered = [[cxp - H, cyp - H], [cxp + H, cyp - H], [cxp - H, cyp + H], [cxp + H, cyp + H]]
        .every(([x, y]) => hitOk(x, y));
      if (!covered) {
        push('TINY_TARGET', el, `${Math.round(r.width)}×${Math.round(r.height)}px and the pointer target is not `
          + `24×24 either — below the WCAG 2.2 AA 2.5.8 minimum`);
      }
    }
    // Reachability must be judged against the element's OWN scroll container.
    // This app scrolls an inner <main>, so documentElement.scrollHeight is just
    // the viewport height (900) and every below-the-fold element looked
    // "outside the document" — 1,103 bogus findings. And rect coords are
    // VIEWPORT-relative, so on a scrolled page everything above the fold reads
    // negative (68 more). Both go away in the container's content space.
    //
    // Only NEGATIVE content coords are genuinely unreachable: you cannot scroll
    // to a negative offset. Content below or to the right is reachable by
    // scrolling and is not a defect.
    if (getComputedStyle(el).position !== 'fixed') {
      let sp = null;
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const ss = getComputedStyle(n);
        if (/(auto|scroll)/.test(ss.overflowY + ss.overflowX)) { sp = n; break; }
      }
      const root = document.scrollingElement || document.documentElement;
      const box = sp ? sp.getBoundingClientRect() : { left: 0, top: 0 };
      const host = sp || root;
      const cx = r.left - box.left + host.scrollLeft;
      const cy = r.top - box.top + host.scrollTop;
      if (cx + r.width < -1 || cy + r.height < -1 || cx > host.scrollWidth + 1) {
        push('OFFSCREEN', el, `unreachable at (${Math.round(cx)},${Math.round(cy)}) inside its scroll container `
          + `(${host.scrollWidth}×${host.scrollHeight}) — cannot be scrolled to`);
      }
    }

  }

  // horizontal document overflow — the classic mobile-breakage signal
  if (document.documentElement.scrollWidth > vw + 1) {
    const wide = [...document.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 6);
    for (const el of wide) {
      const r = el.getBoundingClientRect();
      push('OVERFLOW_X', el, `extends ${Math.round(r.right - vw)}px past the right edge (document scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw})`);
    }
  }

  // ── 5. CLIPPED TEXT with no recovery path ─────────────────────────────────
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!t || t.length < 4) continue;
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const clip = cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden';
    if (!clip) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      const hasRecovery = el.title || el.getAttribute('aria-label') || el.closest('[title]');
      if (!hasRecovery) push('CLIPPED_TEXT', el, `text is cut off (${el.scrollWidth}px in a ${el.clientWidth}px box) with no title/aria-label to read it`);
    }
  }

  // ── 5b. BROKEN VALUES that reached the screen ─────────────────────────────
  // Not geometry, but the same principle: only a rendered page can tell you
  // this. A trading screen printing "NaN" beside a live price is worse than one
  // printing nothing, and it survives every static check — `NaN.toFixed(2)`
  // returns the truthy STRING "NaN", so the usual `|| '0.00'` fallback never
  // fires. Found exactly that on the dashboard's 5m trend spread.
  const BAD_VALUE = /(^|[^A-Za-z])(NaN|undefined|Infinity|\[object Object\])([^A-Za-z]|$)/;
  const FLOAT_NOISE = /\d\.\d*(?:0{5,}\d|9{5,}\d)/;
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length || !vis(el)) continue;
    const t = (el.textContent || '').trim();
    if (t && t.length < 120 && BAD_VALUE.test(t)) {
      push('BAD_VALUE', el, `renders ${JSON.stringify(t.slice(0, 60))} — a non-value reached the screen`);
    }
    // Binary floating point leaking into the UI. `0.1+0.2` is
    // 0.30000000000000004, so a value that has been through JS arithmetic and
    // is interpolated WITHOUT a formatter shows its error tail. The dashboard's
    // P&L column read "₹2826.0000000000014" and "₹-2753.9999999999986" on every
    // visible row. A long run of 0s or 9s after the point is the signature —
    // no real price or rupee amount is ever written that way.
    if (t && FLOAT_NOISE.test(t)) {
      push('FLOAT_NOISE', el, `renders ${JSON.stringify(t.slice(0, 60))} — an unformatted JS float; `
        + `use the house formatter (viz/tokens.js inr/num/premium)`);
    }
  }

  // ── 6. CONTRAST on real rendered colours ──────────────────────────────────
  // Colours must be resolved by the BROWSER, never by a regex. Tailwind v4
  // emits `oklab(0.363236 -0.0479263 -0.0467018 / 0.8)` for themed tokens, and
  // `/[\d.]+/g` silently drops the MINUS SIGNS — so every themed colour parsed
  // as near-black regardless of hue. That is why violet-300 and sky-300, two
  // completely different colours, both measured exactly 1.41:1: the hue was
  // being thrown away. 112 "invisible text" findings were this bug, not the app.
  //
  // Painting onto a 1×1 canvas makes the browser do the conversion, which
  // handles oklab/lab/color-mix/hsl/named alike — and, by painting in stacking
  // order, composites alpha against the real backdrop instead of guessing.
  const _cv = document.createElement('canvas'); _cv.width = _cv.height = 1;
  const _cx = _cv.getContext('2d', { willReadFrequently: true });
  const paint = (stack) => {
    _cx.globalCompositeOperation = 'copy';
    _cx.fillStyle = '#ffffff'; _cx.fillRect(0, 0, 1, 1);
    _cx.globalCompositeOperation = 'source-over';
    for (const c of stack) {
      if (!c || c === 'transparent') continue;
      try { _cx.fillStyle = c; } catch { continue; }
      _cx.fillRect(0, 0, 1, 1);
    }
    const d = _cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lumOf = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // The painted backdrop stack: body colour first, then every ancestor that
  // contributes any paint, outermost-in — so a translucent card over a
  // translucent panel composites the way it actually renders.
  const bgStackOf = (el) => {
    const stack = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const b = getComputedStyle(n).backgroundColor;
      if (b && b !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(b)) stack.unshift(b);
    }
    stack.unshift(getComputedStyle(document.body).backgroundColor);
    return stack;
  };
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (t.length < 3 || !vis(el)) continue;
    const cs = getComputedStyle(el);
    const bgStack = bgStackOf(el);
    const L2 = lumOf(paint(bgStack));
    const L1 = lumOf(paint([...bgStack, cs.color]));   // text alpha over its real backdrop
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    // A disabled control is EXEMPT from contrast minimums (WCAG 1.4.3), and
    // flagging them buries the real findings.
    const disabled = el.closest('[disabled],[aria-disabled="true"],.opacity-40,.opacity-50,.opacity-60');
    if (ratio < need && !disabled) {
      push('CONTRAST', el, `${ratio.toFixed(2)}:1 (text ${paint([...bgStack, cs.color]).join(',')} on ${paint(bgStack).join(',')}), needs ${need}:1 (${Math.round(size)}px${bold ? ' bold' : ''})`, { ratio: +ratio.toFixed(2) });
    }
  }

  return out;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Coverage is stated, never assumed: print what is walked AND what is left out.
  console.log(`  routes: ${ROUTES.length} from src/config/nav.js`);
  for (const s_ of SKIPPED_ROUTES) console.log(`  skipped ${s_.route} — ${s_.why}`);
  const _printedCoverage = true;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
  });
  
/**
 * auditFocus — walk the page with the Tab key and report what a keyboard user hits.
 *
 * This cannot live in the page probe: it needs REAL key presses, because
 * `:focus-visible` (which is what almost every focus ring is bound to) only
 * matches on keyboard focus. Calling el.focus() from script does not reproduce
 * it, so a script-only check reports a missing ring on every control.
 *
 * Reports:
 *   NO_FOCUS_RING   focused element paints no outline and no box-shadow — a
 *                   keyboard user cannot see where they are
 *   FOCUS_OFFSCREEN focus lands on something not visible in the viewport
 *   FOCUS_ORDER     focus jumps far back UP the page, so tab order disagrees
 *                   with reading order
 *   POSITIVE_TABINDEX  tabindex > 0 — reorders the whole document, almost never
 *                      what was intended
 */
async function auditFocus(page, maxTabs = 60) {
  const out = [];
  await page.evaluate(() => { window.__uiPrevFocus = null; if (document.activeElement) document.activeElement.blur(); });
  const seen = new Set();
  let backJumps = 0, firstBack = null;

  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    let info;
    try {
      info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const cls = (el.className && typeof el.className === 'string' ? el.className : '')
          .split(/\s+/).filter(Boolean).slice(0, 3).join('.');
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
        // "Is there a visible focus indicator?" is a question about CHANGE, not
        // about outlines. This app's base rule gives inputs and selects
        // `focus:outline-none focus:border-primary`, so the indicator is a
        // border-colour change — checking only outline/box-shadow reported 34
        // controls as having no ring when they plainly do.
        //
        // The baseline comes from a detached CLONE: it cannot match :focus-visible,
        // so its computed style is exactly this element unfocused.
        let base = null;
        try {
          const clone = el.cloneNode(false);
          clone.removeAttribute('id');
          clone.style.position = 'absolute';
          clone.style.left = '-99999px';
          clone.tabIndex = -1;
          (el.parentElement || document.body).appendChild(clone);
          const bs = getComputedStyle(clone);
          base = { outline: `${bs.outlineStyle}|${bs.outlineWidth}|${bs.outlineColor}`,
                   shadow: bs.boxShadow, border: `${bs.borderColor}|${bs.borderWidth}`,
                   bg: bs.backgroundColor };
          clone.remove();
        } catch { /* cloning refused; fall back to the absolute test below */ }

        const focused = { outline: `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}`,
                          shadow: cs.boxShadow, border: `${cs.borderColor}|${cs.borderWidth}`,
                          bg: cs.backgroundColor };
        const changed = base
          ? (base.outline !== focused.outline || base.shadow !== focused.shadow
             || base.border !== focused.border || base.bg !== focused.bg)
          : (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
            || (cs.boxShadow && cs.boxShadow !== 'none');

        // A .sr-only control is a deliberate visually-hidden pattern — its
        // visible proxy is the styled sibling, which carries the ring.
        const srOnly = el.classList.contains('sr-only');

        // TAB ORDER IS A DOM QUESTION, NOT A GEOMETRY ONE.
        //
        // Comparing y between tab stops cannot work here, and two separate
        // artefacts proved it on /backtest: moving from the last sidebar link to
        // the first main-content control is a legitimate landmark handoff that
        // looks like an 816px jump back up, and the config panel is a STICKY
        // inner scroller, so its inputs keep the same y within <main> while the
        // panel scrolls behind them. Both read as "tab order jumps backwards".
        //
        // Tab order already follows DOM order unless something reorders it —
        // a positive tabindex, a portal, or CSS (`order`, `row-reverse`). So ask
        // the DOM directly: did focus move BACKWARDS through the document?
        window.__uiPrevFocus = window.__uiPrevFocus || null;
        let domBackwards = false;
        if (window.__uiPrevFocus && window.__uiPrevFocus.isConnected) {
            // DOCUMENT_POSITION_PRECEDING (2) => el comes BEFORE the previous stop.
            domBackwards = !!(window.__uiPrevFocus.compareDocumentPosition(el)
                              & Node.DOCUMENT_POSITION_PRECEDING);
        }
        window.__uiPrevFocus = el;

        return {
          domBackwards, srOnly, hasIndicator: changed,
          key: el.tagName + '|' + cls + '|' + label,
          sel: el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (label ? ` "${label}"` : ''),
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
          inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
          tabIndex: el.tabIndex,
        };
      });
    } catch { break; }
    if (!info) break;
    if (seen.has(info.key + info.y)) break;          // cycled back to the start
    seen.add(info.key + info.y);

    if (info.tabIndex > 0) {
      out.push({ kind: 'POSITIVE_TABINDEX', el: info.sel,
        detail: `tabindex=${info.tabIndex} — a positive tabindex reorders the whole document` });
    }
    if (!info.hasIndicator && !info.srOnly && info.w > 0 && info.h > 0) {
      out.push({ kind: 'NO_FOCUS_RING', el: info.sel,
        detail: 'keyboard focus paints neither an outline nor a box-shadow — invisible to a keyboard user' });
    }
    if (!info.inView && info.w > 0) {
      out.push({ kind: 'FOCUS_OFFSCREEN', el: info.sel,
        detail: `focus moved to (${info.x},${info.y}), outside the viewport, without scrolling to it` });
    }
    if (info.domBackwards) {
      backJumps++;
      if (!firstBack) firstBack = info.sel;
    }
  }

  if (backJumps > 0) {
    out.push({ kind: 'FOCUS_ORDER', el: '(tab sequence)',
      detail: `focus moves BACKWARDS through the DOM ${backJumps}x (first: ${firstBack}) — `
        + `something reorders the sequence: a positive tabindex, a portal, or CSS order/row-reverse` });
  }
  if (!seen.size) {
    out.push({ kind: 'FOCUS_ORDER', el: '(tab sequence)',
      detail: 'Tab reaches NO focusable element on this route' });
  }
  return out;
}

const findings = [];
  try {
    for (const profile of PROFILES) {
      const page = await browser.newPage();
      await page.setViewport({ width: profile.vp.w, height: profile.vp.h, deviceScaleFactor: 1 });

      // Set the text-size axis the way the app persists it, before first paint.
      await page.evaluateOnNewDocument((fs_) => {
        try {
          const stored = { version: 1, prefs: { fontScale: fs_.scale } };
          if (fs_.contrast) stored.prefs.contrast = fs_.contrast;
          if (fs_.theme) { stored.theme = fs_.theme; stored.mode = fs_.mode; }
          localStorage.setItem('algobot:appearance', JSON.stringify(stored));
        } catch { /* private mode */ }
      }, { scale: profile.fontScale, theme: THEME_ID, mode: THEME_MODE, contrast: CONTRAST });

      // Log in once per profile if a password was supplied.
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      if (PASSWORD) {
        const pw = await page.$('input[type="password"]');
        if (pw) {
          await pw.type(PASSWORD, { delay: 5 });
          await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
          ]);
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      for (const route of ROUTES) {
        try {
          await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 45000 });
        } catch { /* keep going; a slow route still gets measured below */ }
        await new Promise(r => setTimeout(r, 1200));   // let charts/async paint
        let res = [];
        try { res = await page.evaluate(PROBE); } catch (e) { res = [{ kind: 'PROBE_FAILED', el: '-', detail: e.message }]; }
        if (FOCUS_AUDIT) {
          try { res = res.concat(await auditFocus(page)); }
          catch (e) { res.push({ kind: 'FOCUS_FAILED', el: '-', detail: e.message }); }
        }
        for (const f of res) findings.push({ profile: profile.name, route, ...f });
        const shot = path.join(OUT, `${profile.name}${route.replace(/\//g, '_') || '_root'}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
        process.stdout.write(`  ${profile.name.padEnd(10)} ${route.padEnd(18)} ${String(res.length).padStart(4)} findings\n`);
      }
      await page.close();
    }
  } finally { await browser.close(); }

  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(findings, null, 1));
  const by = {};
  for (const f of findings) by[f.kind] = (by[f.kind] || 0) + 1;
  console.log(`\n  TOTAL ${findings.length} findings`);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`);
  console.log(`\n  details: ${path.join(OUT, 'findings.json')}   screenshots: ${OUT}`);
})();
