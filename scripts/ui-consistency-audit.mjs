#!/usr/bin/env node
/**
 * ui-consistency-audit.mjs — find UI defects that are only wrong RELATIVE TO
 * THE REST OF THE APP.
 *
 * ── WHY THIS EXISTS, AND WHY ui-geometry-audit.mjs COULD NOT CATCH IT ───────
 * The geometry auditor answers "is anything wrong INSIDE this page?" — overlap,
 * overflow, contrast, tap targets. Every one of those is a within-page rule, so
 * every one of them can be decided by looking at that page alone.
 *
 * `/tick-results` shipped with no page gutter while all twelve other routes use
 * `p-6`, so its heading sat flush against the top edge. NOTHING inside
 * /tick-results was broken. No overlap, no overflow, no contrast failure, no
 * clipped text. It was wrong only in comparison. The geometry auditor is
 * structurally incapable of seeing that, and so is every linter, because the
 * convention it violated is written down nowhere — <main> adds no padding, so
 * each page hand-rolls its own and two of them simply forgot.
 *
 * ── THE METHOD ──────────────────────────────────────────────────────────────
 * Measure one property on EVERY route, take the MODE, and flag the routes that
 * deviate. This turns "looks inconsistent" — the thing a human notices instantly
 * and a machine normally cannot — into an outlier test with numbers behind it.
 *
 * The mode is the right statistic, not the mean: a convention is what MOST of
 * the app does, and one page being wrong should not drag the reference value.
 * A property that varies everywhere has no mode worth defending, so it is
 * reported as "no convention" rather than as thirteen findings — that is a
 * design decision to make, not a bug to fix.
 *
 * Checks:
 *   PAGE_GUTTER      the padding box every route's content sits in
 *   CONTENT_ORIGIN   x/y of the first heading — where the page visually starts
 *   TITLE_TYPE       font-size/weight of the page title
 *   CARD_RECIPE      radius/border/background of the dominant card
 *   CONTROL_HEIGHT   the modal button height, and one-off outliers
 *   LEFT_EDGE        whether a route's own blocks share one left edge
 *   EMPTY_STATE      routes that render a blank <main> with no explanation
 *   SCROLL_RESET     routes that land part-way down instead of at the top
 *   DOC_TITLE        routes sharing one browser-tab title
 *   HEADING_ORDER    missing/duplicate <h1>, skipped heading levels
 *
 * Usage:
 *   UI_PASSWORD=… node scripts/ui-consistency-audit.mjs
 *   UI_ROUTES=/risk,/tick-results UI_PASSWORD=… node scripts/ui-consistency-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { auditRoutes } from './lib/routes.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:5173';
const PASSWORD = process.env.UI_PASSWORD || '';
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const OUT = process.env.UI_OUT || '/tmp/ui-consistency';

// Derived from src/config/nav.js, never hand-maintained — see scripts/lib/routes.mjs
// for the coverage drift that made this necessary.
const { routes: NAV_ROUTES, skipped: SKIPPED_ROUTES } = auditRoutes();
const ROUTES = process.env.UI_ROUTES ? process.env.UI_ROUTES.split(',').filter(Boolean) : NAV_ROUTES;

/** Injected into the page. Returns raw measurements; all judgement happens in Node. */
const MEASURE = () => {
  const cs = (el) => getComputedStyle(el);
  const px = (v) => Math.round(parseFloat(v) || 0);
  const sel = (el) => {
    if (!el) return null;
    const c = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = cs(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      && parseFloat(s.opacity || '1') > 0.05;
  };

  const main = document.querySelector('main');
  const out = { ok: !!main };
  if (!main) return out;

  // ── PAGE_GUTTER ───────────────────────────────────────────────────────────
  // The page's own padded wrapper: <main> itself contributes none in this app,
  // so walk the first chain of single-child wrappers and take the largest
  // horizontal padding found. That tolerates a page wrapping its content in a
  // fragment or an extra div without changing the answer.
  let node = main, best = { top: 0, right: 0, bottom: 0, left: 0 }, bestEl = null, depth = 0;
  while (node && depth < 4) {
    const s = cs(node);
    const p = { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
    if (p.left + p.right > best.left + best.right) { best = p; bestEl = node; }
    const kids = [...node.children].filter(visible);
    if (kids.length !== 1) { if (depth === 0 && kids.length) node = kids[0]; else break; }
    else node = kids[0];
    depth++;
  }
  out.gutter = best;
  out.gutterEl = sel(bestEl || main);
  out.mainChildren = [...main.children].filter(visible).length;

  // ── CONTENT_ORIGIN + TITLE_TYPE ───────────────────────────────────────────
  const heads = [...main.querySelectorAll('h1,h2')].filter(visible);
  if (heads.length) {
    const h = heads[0], r = h.getBoundingClientRect(), s = cs(h);
    // The <h1>'s OWN left edge is the wrong thing to compare across routes: an
    // icon sitting before it in a flex row pushes it right, which reported
    // /ai-manager, /parity-audit and /strategy/:symbol as misaligned when their
    // header blocks start exactly where everyone else's do. Measure the header
    // BLOCK — the ancestor that is a direct child of the page wrapper — because
    // that is the edge a human actually reads the page against.
    // Stop BELOW the padded wrapper: the wrapper's own border box sits at the
    // unpadded edge (64,0), so climbing into it reports a correctly-padded page
    // as flush against the sidebar.
    const stopAt = bestEl || main;
    let block = h;
    while (block.parentElement && block.parentElement !== main
           && block.parentElement !== stopAt
           && !block.parentElement.isSameNode(document.body)) {
      const pr = block.parentElement.getBoundingClientRect();
      if (pr.width > r.width * 3 || pr.width > 400) { block = block.parentElement; break; }
      block = block.parentElement;
    }
    const br = block.getBoundingClientRect();
    out.title = {
      text: (h.textContent || '').trim().slice(0, 40),
      x: Math.round(br.left), y: Math.round(br.top),
      glyphX: Math.round(r.left),
      fontSize: parseFloat(s.fontSize), fontWeight: s.fontWeight,
      tag: h.tagName.toLowerCase(), sel: sel(h), blockSel: sel(block),
    };
  }

  // A centred page (mx-auto + a max-width) is a deliberate layout choice, not a
  // misalignment — reported on its own axis so it never masquerades as one.
  out.centred = null;
  {
    const wrapEl = bestEl || main;
    for (const cand of [wrapEl, ...[...wrapEl.children].filter(visible)]) {
      const ws = cs(cand);
      const mw = px(ws.maxWidth);
      const cr = cand.getBoundingClientRect();
      const mainR = main.getBoundingClientRect();
      // Centred = a real max-width AND visibly inset from both sides of <main>.
      const inset = Math.round(cr.left - mainR.left);
      if (mw > 0 && inset > 32 && Math.abs((mainR.right - cr.right) - inset) < 8) {
        out.centred = { maxWidth: mw, inset };
        break;
      }
    }
  }

  // ── CARD_RECIPE ───────────────────────────────────────────────────────────
  // A "card" = has a real background AND a border AND a radius. Take the recipe
  // used by the most elements on this route; that is the page's card identity.
  const recipes = {};
  for (const el of main.querySelectorAll('div,section,article')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 60) continue;   // a chip/badge is not a card
    const s = cs(el);
    const bg = s.backgroundColor;
    if (!bg || /rgba\(0, 0, 0, 0\)/.test(bg)) continue;
    const bw = px(s.borderTopWidth);
    const rad = px(s.borderTopLeftRadius);
    if (bw < 1 || rad < 1) continue;
    const key = `r${rad}|b${bw}|${s.borderTopColor}|${bg}`;
    (recipes[key] = recipes[key] || { key, radius: rad, border: bw, borderColor: s.borderTopColor, bg, n: 0 }).n++;
  }
  const rl = Object.values(recipes).sort((a, b) => b.n - a.n);
  out.card = rl[0] || null;
  out.cardVariants = rl.length;

  // ── CONTROL_ROW ───────────────────────────────────────────────────────────
  // Comparing every button to one app-wide "modal height" was the wrong model:
  // buttons legitimately come in sizes, and the mode landed at 18px (the tiny
  // inline steppers), which made every ordinary 32px toolbar button an outlier.
  // What a human actually sees is two controls SIDE BY SIDE at different
  // heights, so measure per row instead.
  const rows = new Map();
  for (const el of main.querySelectorAll('button,input,select,a[class*="rounded"]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 10) continue;
    const st = cs(el);
    const looksLikeControl = (st.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(st.backgroundColor))
      || px(st.borderTopWidth) >= 1;
    if (!looksLikeControl) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const key = `${parent.tagName}|${Math.round(r.top / 4)}`;   // same row band
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ h: Math.round(r.height), rad: px(st.borderTopLeftRadius), sel: sel(el) });
  }
  out.controlRows = [];
  for (const [, items] of rows) {
    if (items.length < 2) continue;
    const hs2 = items.map(i => i.h);
    const spread = Math.max(...hs2) - Math.min(...hs2);
    if (spread > 4) {
      out.controlRows.push({ spread, items: items.slice(0, 5) });
    }
  }

  // ── LEFT_EDGE ─────────────────────────────────────────────────────────────
  // Direct block children of the page wrapper should share one left edge.
  const wrap = bestEl && bestEl !== main ? bestEl : main;
  const edges = {};
  for (const el of [...wrap.children]) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 120) continue;
    const x = Math.round(r.left);
    (edges[x] = edges[x] || { x, n: 0, sample: sel(el) }).n++;
  }
  out.leftEdges = Object.values(edges).sort((a, b) => b.n - a.n);

  // ── SCROLL_RESET ──────────────────────────────────────────────────────────
  // Arriving at a route should put you at the top of it. This app scrolls an
  // inner <main>, so window.scrollY is always 0 and the defect hides entirely —
  // read the real scroller.
  out.scrollTop = Math.round(main.scrollTop || 0);

  // ── DOC_TITLE ─────────────────────────────────────────────────────────────
  // What the browser TAB says. Users navigate by tab; identical titles on every
  // route make a pinned tab, a bookmark and a history entry indistinguishable.
  out.docTitle = document.title;

  // ── HEADING_ORDER ─────────────────────────────────────────────────────────
  const levels = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(visible).map(h => +h.tagName[1]);
  out.h1Count = levels.filter(l => l === 1).length;
  out.headingSkips = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) out.headingSkips.push(`h${levels[i - 1]}->h${levels[i]}`);
  }

  // ── EMPTY_STATE ───────────────────────────────────────────────────────────
  const text = (main.innerText || '').trim();
  out.textLength = text.length;
  out.mainHeight = Math.round(main.getBoundingClientRect().height);
  out.contentHeight = Math.round(main.scrollHeight);

  return out;
};

/** Mode of a list of primitives, with the counts kept so findings can cite them. */
function mode(values) {
  const c = new Map();
  for (const v of values) { const k = JSON.stringify(v); c.set(k, (c.get(k) || 0) + 1); }
  let bestK = null, bestN = 0;
  for (const [k, n] of c) if (n > bestN) { bestK = k; bestN = n; }
  return { value: bestK == null ? null : JSON.parse(bestK), count: bestN, distinct: c.size };
}

const findings = [];
const add = (kind, route, detail, severity = 'medium') =>
  findings.push({ kind, route, detail, severity });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Coverage is stated, never assumed: print what is walked AND what is left out.
  console.log(`  routes: ${ROUTES.length} from src/config/nav.js`);
  for (const s_ of SKIPPED_ROUTES) console.log(`  skipped ${s_.route} — ${s_.why}`);
  const _printedCoverage = true;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // Pin the theme. A fresh puppeteer profile has empty localStorage, so the app
  // seeds from prefers-color-scheme — headless Chrome reports LIGHT, so this was
  // silently auditing `daylight` while the geometry auditor pins `midnight`.
  // Card backgrounds and borders differ per theme, so an unpinned run is not
  // reproducible and the two auditors cannot be compared.
  const THEME = process.env.UI_THEME || null;
  if (THEME) {
    const { THEMES } = await import('../src/theme/themes.js');
    const list = Array.isArray(THEMES) ? THEMES : Object.values(THEMES);
    const mode = (list.find(t => t.id === THEME) || {}).mode || 'dark';
    await page.evaluateOnNewDocument((t, md) => {
      try { localStorage.setItem('algobot:appearance', JSON.stringify({ version: 1, theme: t, mode: md, prefs: {} })); }
      catch { /* private mode */ }
    }, THEME, mode);
    console.log(`  theme: ${THEME} (${mode})`);
  } else {
    console.log('  theme: app default for prefers-color-scheme (headless Chrome reports LIGHT)');
  }

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

  const m = {};
  for (const route of ROUTES) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch { /* a slow route still gets measured */ }
    await new Promise(r => setTimeout(r, 1200));
    try { m[route] = await page.evaluate(MEASURE); }
    catch (e) { m[route] = { ok: false, error: e.message }; }
    await page.screenshot({ path: path.join(OUT, `${route.replace(/\//g, '_') || '_root'}.png`) }).catch(() => {});
    const g = m[route].gutter;
    process.stdout.write(`  ${route.padEnd(18)} gutter ${g ? `${g.top}/${g.left}` : '—'}`
      + `  title@${m[route].title ? `${m[route].title.x},${m[route].title.y}` : '—'}\n`);
  }
  await browser.close();

  const live = ROUTES.filter(r => m[r] && m[r].ok);

  // ── PAGE_GUTTER ───────────────────────────────────────────────────────────
  const gLeft = mode(live.map(r => m[r].gutter.left));
  const gTop = mode(live.map(r => m[r].gutter.top));
  for (const r of live) {
    const g = m[r].gutter;
    if (g.left !== gLeft.value) {
      add('PAGE_GUTTER', r,
        `left padding ${g.left}px, but ${gLeft.count}/${live.length} routes use ${gLeft.value}px `
        + `(wrapper ${m[r].gutterEl})`, g.left === 0 ? 'high' : 'medium');
    }
    if (g.top !== gTop.value && g.left === gLeft.value) {
      add('PAGE_GUTTER', r,
        `top padding ${g.top}px, but ${gTop.count}/${live.length} routes use ${gTop.value}px`, 'medium');
    }
  }

  // ── CONTENT_ORIGIN ────────────────────────────────────────────────────────
  const withTitle = live.filter(r => m[r].title);
  const oX = mode(withTitle.map(r => m[r].title.x));
  const oY = mode(withTitle.map(r => m[r].title.y));
  for (const r of withTitle) {
    const t = m[r].title;
    // A centred page's x offset IS the centring, already reported as
    // LAYOUT_WIDTH — reporting it again as misalignment is double-counting.
    const xOff = m[r].centred ? 0 : Math.abs(t.x - oX.value);
    if (xOff > 2 || Math.abs(t.y - oY.value) > 4) {
      add('CONTENT_ORIGIN', r,
        `title "${t.text}" starts at (${t.x},${t.y}); ${Math.max(oX.count, oY.count)}/${withTitle.length} `
        + `routes start at (${oX.value},${oY.value}) — off by (${t.x - oX.value},${t.y - oY.value})`,
        Math.abs(t.y - oY.value) > 20 ? 'high' : 'medium');
    }
  }
  for (const r of live) {
    if (!m[r].title) add('CONTENT_ORIGIN', r, 'no <h1>/<h2> at all — the page has no visible title', 'medium');
  }

  // ── LAYOUT_WIDTH ──────────────────────────────────────────────────────────
  const centred = live.filter(r => m[r].centred);
  if (centred.length && centred.length < live.length / 2) {
    for (const r of centred) {
      add('LAYOUT_WIDTH', r,
        `content is centred in a ${m[r].centred.maxWidth}px column (${m[r].centred.inset}px inset) `
        + `while ${live.length - centred.length}/${live.length} routes run full width — `
        + `deliberate? it reads as a different page shape`, 'low');
    }
  }

  // ── TITLE_TYPE ────────────────────────────────────────────────────────────
  const tSize = mode(withTitle.map(r => m[r].title.fontSize));
  const tWeight = mode(withTitle.map(r => m[r].title.fontWeight));
  for (const r of withTitle) {
    const t = m[r].title;
    if (t.fontSize !== tSize.value) {
      add('TITLE_TYPE', r,
        `title renders at ${t.fontSize}px, but ${tSize.count}/${withTitle.length} routes use ${tSize.value}px`,
        Math.abs(t.fontSize - tSize.value) > 6 ? 'high' : 'low');
    }
    if (t.fontWeight !== tWeight.value) {
      add('TITLE_TYPE', r,
        `title weight ${t.fontWeight}, but ${tWeight.count}/${withTitle.length} routes use ${tWeight.value}`, 'low');
    }
  }

  // ── CARD_RECIPE ───────────────────────────────────────────────────────────
  // A route with one or two cards has no "dominant recipe" to speak of — calling
  // it a deviant on a sample of 1 is noise. Excluded routes are named below
  // rather than quietly skipped.
  const CARD_MIN = 3;
  const withCard = live.filter(r => m[r].card && m[r].card.n >= CARD_MIN);
  const thinCard = live.filter(r => m[r].card && m[r].card.n < CARD_MIN);
  if (thinCard.length) {
    add('CARD_RECIPE', '(coverage)',
      `${thinCard.length} route(s) had fewer than ${CARD_MIN} cards so their recipe was not compared: `
      + thinCard.map(r => `${r}(${m[r].card.n})`).join(', '), 'low');
  }
  const noCard = live.filter(r => !m[r].card);
  if (noCard.length) {
    add('CARD_RECIPE', '(coverage)',
      `${noCard.length} route(s) render no card-shaped container at all: ${noCard.join(', ')}`, 'low');
  }
  const cRad = mode(withCard.map(r => m[r].card.radius));
  const cBg = mode(withCard.map(r => m[r].card.bg));
  for (const r of withCard) {
    const c = m[r].card;
    if (c.radius !== cRad.value) {
      add('CARD_RECIPE', r,
        `dominant card radius ${c.radius}px (${c.n} elements), but ${cRad.count}/${withCard.length} `
        + `routes use ${cRad.value}px`, 'low');
    }
    if (c.bg !== cBg.value) {
      add('CARD_RECIPE', r,
        `dominant card background ${c.bg}, but ${cBg.count}/${withCard.length} routes use ${cBg.value}`, 'medium');
    }
  }

  // ── CONTROL_ROW ───────────────────────────────────────────────────────────
  for (const r of live) {
    const bad = (m[r].controlRows || []).sort((x, y) => y.spread - x.spread);
    if (bad.length) {
      const worst = bad[0];
      add('CONTROL_ROW', r,
        `${bad.length} toolbar row(s) mix control heights; worst spread ${worst.spread}px: `
        + worst.items.map(i => `${i.sel}@${i.h}px`).join(', '),
        worst.spread > 12 ? 'medium' : 'low');
    }
  }

  // ── LEFT_EDGE ─────────────────────────────────────────────────────────────
  for (const r of live) {
    const e = m[r].leftEdges;
    if (e.length > 1) {
      const off = e.slice(1).filter(x => Math.abs(x.x - e[0].x) > 2);
      if (off.length) {
        add('LEFT_EDGE', r,
          `blocks do not share a left edge: ${e[0].n} at x=${e[0].x}, but `
          + off.map(o => `${o.n} at x=${o.x} (${o.sample})`).join('; '), 'medium');
      }
    }
  }

  // ── EMPTY_STATE ───────────────────────────────────────────────────────────
  for (const r of live) {
    if (m[r].textLength < 40) {
      add('EMPTY_STATE', r,
        `<main> renders only ${m[r].textLength} characters — a blank page with no empty-state copy`, 'high');
    }
  }

  // ── SCROLL_RESET ──────────────────────────────────────────────────────────
  for (const r of live) {
    if (m[r].scrollTop > 8) {
      add('SCROLL_RESET', r,
        `lands ${m[r].scrollTop}px down its own scroller instead of at the top — something calls `
        + `scrollIntoView/scrollTop during mount and moves the PAGE, not just its own widget`,
        m[r].scrollTop > 200 ? 'high' : 'medium');
    }
  }

  // ── DOC_TITLE ─────────────────────────────────────────────────────────────
  const titles = new Map();
  for (const r of live) {
    const t = m[r].docTitle || '';
    if (!titles.has(t)) titles.set(t, []);
    titles.get(t).push(r);
  }
  for (const [t, rs] of titles) {
    if (rs.length > 1) {
      add('DOC_TITLE', rs.length === live.length ? '(all routes)' : rs.join(','),
        `${rs.length} routes all report the browser-tab title ${JSON.stringify(t)} — tabs, bookmarks `
        + `and history entries are indistinguishable`,
        rs.length === live.length ? 'medium' : 'low');
    }
  }

  // ── HEADING_ORDER ─────────────────────────────────────────────────────────
  for (const r of live) {
    if (m[r].h1Count === 0) {
      add('HEADING_ORDER', r, 'no <h1> — no page landmark for screen readers or "jump to heading"', 'low');
    } else if (m[r].h1Count > 1) {
      add('HEADING_ORDER', r, `${m[r].h1Count} <h1> elements — only one of them is the page`, 'low');
    }
    if (m[r].headingSkips && m[r].headingSkips.length) {
      add('HEADING_ORDER', r, `heading level skipped: ${[...new Set(m[r].headingSkips)].join(', ')}`, 'low');
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || a.kind.localeCompare(b.kind));
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

  console.log('\n' + '─'.repeat(78));
  for (const f of findings) {
    console.log(`  ${f.severity.toUpperCase().padEnd(6)} ${f.kind.padEnd(15)} ${f.route.padEnd(17)} ${f.detail}`);
  }
  console.log('─'.repeat(78));
  console.log(`  TOTAL ${findings.length} findings across ${live.length} routes`);
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(findings, null, 1));
  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(m, null, 1));
  console.log(`\n  details: ${OUT}/findings.json   measurements: ${OUT}/measurements.json`);
})();
