/**
 * The documentation registry — every doc page, in reading order, grouped for
 * the contents list. A page module is plain data:
 *   { id, title, route?, summary, sections: [{ id, title, where?, md }] }
 * `md` is the Markdown subset rendered by ./markdown.jsx.
 *
 * Links INTO the docs are "page#section" strings (DocLink `to`, Card `docs`);
 * src/docs/docs.test.js fails if any of them points at nothing.
 */
import { plainText } from './markdown.jsx';
import start from './content/start.js';
import basics from './content/basics.js';
import glossary from './content/glossary.js';
import dashboard from './content/dashboard.js';
import livePortfolio from './content/livePortfolio.js';
import strategyDetail from './content/strategyDetail.js';
import charts from './content/charts.js';
import risk from './content/risk.js';
import backtest from './content/backtest.js';
import optimizer from './content/optimizer.js';
import signalCombiner from './content/signalCombiner.js';
import multiLeg from './content/multiLeg.js';
import alerts from './content/alerts.js';
import goLive from './content/goLive.js';
import delta from './content/delta.js';
import tickStrategies from './content/tickStrategies.js';
import tickResults from './content/tickResults.js';
import aiManager from './content/aiManager.js';
import aiScore from './content/aiScore.js';
import parityAudit from './content/parityAudit.js';
import marketRules from './content/marketRules.js';
import dataManager from './content/dataManager.js';
import settings from './content/settings.js';

const GROUPS = [
    { title: 'Start here', ids: ['start', 'basics', 'glossary'] },
    { title: 'Watch what is running', ids: ['dashboard', 'live-portfolio', 'strategy-detail', 'charts', 'risk'] },
    { title: 'Research', ids: ['backtest', 'optimizer', 'signal-combiner', 'multi-leg', 'alerts'] },
    { title: 'Going live', ids: ['go-live', 'delta'] },
    { title: 'Tick engine', ids: ['tick-strategies', 'tick-results'] },
    { title: 'AI', ids: ['ai-manager', 'ai-score'] },
    { title: 'System', ids: ['parity-audit', 'market-rules', 'data-manager', 'settings'] },
];

const BY_ID = Object.fromEntries([
    start, basics, glossary, dashboard, livePortfolio, strategyDetail, charts, risk,
    backtest, optimizer, signalCombiner, multiLeg, alerts, goLive, delta, tickStrategies, tickResults,
    aiManager, aiScore, parityAudit, marketRules, dataManager, settings,
].map(p => [p.id, p]));

export const DOC_GROUPS = GROUPS
    .map(g => ({ title: g.title, pages: g.ids.map(id => BY_ID[id]).filter(Boolean) }))
    .filter(g => g.pages.length);

/** Reading order = contents order. */
export const DOC_PAGES = DOC_GROUPS.flatMap(g => g.pages);

export function getDocPage(id) { return id ? BY_ID[id] || null : null; }

/** "page#section" → { page, section|null } or null when the page does not exist. */
export function findDoc(target) {
    const [pid, sid] = String(target || '').split('#');
    const page = getDocPage(pid);
    if (!page) return null;
    if (!sid) return { page, section: null };
    const section = page.sections.find(s => s.id === sid) || null;
    return section ? { page, section } : null;
}

const INDEX = DOC_PAGES.flatMap(page => page.sections.map(section => ({
    page, section,
    title: section.title.toLowerCase(),
    pageTitle: page.title.toLowerCase(),
    text: `${plainText(section.md)} ${section.where || ''}`,
})));

/** The contents group a page sits in (for breadcrumbs). */
export function groupOf(pageId) {
    return DOC_GROUPS.find(g => g.pages.some(p => p.id === pageId)) || null;
}

/** Rough reading time at 200 words a minute — at least one minute. */
export function readingMinutes(page) {
    const words = [page.summary || '', ...page.sections.map(s => s.md)]
        .reduce((n, md) => n + plainText(md).split(' ').filter(Boolean).length, 0);
    return Math.max(1, Math.round(words / 200));
}

/** A short preview of a "page#section" target, for hover cards. null if it does not exist. */
export function docPreview(target, max = 260) {
    const hit = findDoc(target);
    if (!hit) return null;
    const text = hit.section ? plainText(hit.section.md) : (hit.page.summary || '');
    return {
        pageTitle: hit.page.title,
        title: hit.section ? hit.section.title : hit.page.title,
        text: text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text,
    };
}

/** The words a query searches for (lower-case), shared with the result highlighter. */
export function queryWords(query) {
    return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word must appear (section title, page title or text); section-title hits rank first. */
export function searchDocs(query, limit = 40) {
    const words = queryWords(query);
    if (!words.length) return [];
    const hits = [];
    for (const e of INDEX) {
        const lowText = e.text.toLowerCase();
        if (!words.every(w => e.title.includes(w) || e.pageTitle.includes(w) || lowText.includes(w))) continue;
        const score = words.reduce((a, w) => a + (e.title.includes(w) ? 10 : 0) + (e.pageTitle.includes(w) ? 3 : 0) + (lowText.includes(w) ? 1 : 0), 0);
        const at = lowText.indexOf(words[0]);
        const snippet = at < 0 ? e.text.slice(0, 160)
            : `${at > 60 ? '…' : ''}${e.text.slice(Math.max(0, at - 60), at + 140)}${at + 140 < e.text.length ? '…' : ''}`;
        hits.push({ page: e.page, section: e.section, score, snippet });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
