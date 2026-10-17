#!/usr/bin/env node
/**
 * ui-perf-audit — is any page doing work while nobody touches it, or re-rendering
 * in a loop? Runs in a real browser, because none of this is visible to a unit
 * test: jsdom has no layout, no canvas and no real event loop, and a test renders
 * a component once — it never watches what the page does over ten seconds.
 *
 * Per route (the nav's routes, scripts/lib/routes.mjs):
 *   idle     React commits/s, script ms/s, long tasks, API calls while untouched
 *   scroll   frames/s and script ms/s while scrolling
 *   /charts  the pointer RESTING on the chart (renders must be 0 — 17-Oct-2026 a
 *            render loop ran 4 commits/s there), a mouse sweep and a drag
 *
 * React commits are counted by a stand-in DevTools hook (onCommitFiberRoot), so
 * it works on the dev server and on a production build alike.
 *
 *   UI_BASE=http://localhost:5173 UI_PASSWORD=… npm run audit:ui:perf
 *   UI_ONLY=/,/charts   limit routes · UI_JSON=out.json   write the rows
 * Exit code 1 when a budget below is broken. Dev React is several times slower
 * than a production build (vite build + vite preview); judge timings on that.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { auditRoutes } from './lib/routes.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:5173';
const PASSWORD = process.env.UI_PASSWORD || '';
const CHROME = process.env.CHROME_BIN || (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : '/usr/bin/google-chrome');
const ONLY = process.env.UI_ONLY ? process.env.UI_ONLY.split(',') : null;

// What a page may do while nobody is touching it.
const BUDGET = {
    idleCommitsPerS: 0.5,      // a poll every few seconds is fine; a render loop is not
    idleScriptMsPerS: 100,     // 10% of a core while idle
    restingChartCommits: 0,    // the pointer resting on a chart renders nothing
    scrollFps: 45,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOOK = `
  window.__commits = 0; window.__frames = 0; window.__long = { n: 0, ms: 0 };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject() { return 1; }, onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, on() {}, off() {}, sub() { return () => {}; } };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__long.n++; window.__long.ms += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  (function f() { window.__frames++; requestAnimationFrame(f); })();
`;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], protocolTimeout: 180000 });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
await page.evaluateOnNewDocument(HOOK);
const cdp = await page.target().createCDPSession();
await cdp.send('Performance.enable');
let apiCalls = 0;
page.on('request', (r) => { if (/\/api\//.test(r.url())) apiCalls++; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const counters = () => page.evaluate(() => ({ commits: window.__commits, frames: window.__frames, longN: window.__long.n }));
async function window_(action) {
    const m0 = await metrics(), c0 = await counters(), a0 = apiCalls, t0 = Date.now();
    await action();
    const dt = (Date.now() - t0) / 1000, m1 = await metrics(), c1 = await counters();
    return {
        commitsPerS: +((c1.commits - c0.commits) / dt).toFixed(2), commits: c1.commits - c0.commits,
        scriptMsPerS: Math.round(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / dt),
        fps: Math.round((c1.frames - c0.frames) / dt), longTasks: c1.longN - c0.longN, apiCalls: apiCalls - a0,
    };
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
if (PASSWORD) {
    const pw = await page.$('input[type="password"]');
    if (pw) { await pw.type(PASSWORD); await page.keyboard.press('Enter'); await sleep(2500); }
}

const routes = (ONLY || auditRoutes()).filter((r) => r !== '/callback');
const rows = [], broken = [];
for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await page.mouse.move(5, 5);
    await sleep(4000);                                    // let the first load settle
    const idle = await window_(() => sleep(6000));
    await page.mouse.move(760, 520);
    const scroll = await window_(async () => { for (let i = 0; i < 30; i++) { await page.mouse.wheel({ deltaY: i < 15 ? 300 : -300 }); await sleep(100); } });
    const row = { route, idle, scroll };
    if (route === '/charts') {
        const box = await page.evaluate(() => { const el = document.querySelector('[role=application]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        if (box) {
            await sleep(500);
            await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2); await sleep(400);
            row.resting = await window_(() => sleep(3000));
            row.sweep = await window_(async () => { for (let x = box.x + 10; x < box.x + box.w - 80; x += 12) await page.mouse.move(x, box.y + box.h * 0.4); });
            if (row.resting.commits > BUDGET.restingChartCommits) broken.push(`${route}: ${row.resting.commits} renders with the pointer resting on the chart (a render loop)`);
        }
    }
    if (idle.commitsPerS > BUDGET.idleCommitsPerS) broken.push(`${route}: ${idle.commitsPerS} renders/s while idle`);
    if (idle.scriptMsPerS > BUDGET.idleScriptMsPerS) broken.push(`${route}: ${idle.scriptMsPerS} ms/s of script while idle`);
    if (scroll.fps < BUDGET.scrollFps) broken.push(`${route}: ${scroll.fps} fps while scrolling`);
    rows.push(row);
    process.stderr.write(`${route}  idle ${idle.commitsPerS} renders/s · ${idle.scriptMsPerS} ms/s · ${idle.apiCalls} api   scroll ${scroll.fps} fps${row.resting ? `   chart resting ${row.resting.commits} renders · sweep ${row.sweep.fps} fps` : ''}\n`);
}
await browser.close();

if (process.env.UI_JSON) fs.writeFileSync(process.env.UI_JSON, JSON.stringify(rows, null, 2));
if (errors.length) console.log(`page errors (${errors.length}):\n  ${errors.slice(0, 10).join('\n  ')}`);
if (broken.length) {
    console.log(`\n${broken.length} budget(s) broken:\n  ${broken.join('\n  ')}`);
    process.exit(1);
}
console.log(`\n${rows.length} routes within budget.`);
