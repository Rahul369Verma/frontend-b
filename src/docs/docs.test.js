/**
 * Documentation integrity — a broken docs link should fail here, not in front of a reader.
 *
 *   1. every doc page is well-formed (ids unique, every section has text);
 *   2. every link INSIDE the docs resolves (#section, page#section, /app-route);
 *   3. every 📖 link in the app (Card/CollapsibleCard `docs="…"`, <DocLink to="…">)
 *      points at a real page#section;
 *   4. every page in the menu has a doc page, and every doc page that names an
 *      app route names a real one.
 */
import { describe, it, expect } from 'vitest';
import { DOC_PAGES, findDoc } from './index.js';
import { linkTargets } from './markdown.jsx';
import { NAV_ITEMS, ALL_ROUTES } from '../config/nav.js';

const SOURCES = import.meta.glob(['/src/**/*.jsx', '/src/**/*.js', '!/src/**/*.test.*', '!/src/docs/**'], { query: '?raw', import: 'default', eager: true });

const routeMatches = (path) => ALL_ROUTES.some(r => {
    const re = new RegExp(`^${r.path.replace(/:[A-Za-z]+\??/g, '[^/]+')}$`);
    return re.test(path.split(/[?#]/)[0]);
});

describe('docs — pages are well-formed', () => {
    it('has pages, unique page ids, unique section ids, and text in every section', () => {
        expect(DOC_PAGES.length).toBeGreaterThan(3);
        const ids = DOC_PAGES.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of DOC_PAGES) {
            expect(p.title, p.id).toBeTruthy();
            expect(p.sections.length, p.id).toBeGreaterThan(0);
            const sids = p.sections.map(s => s.id);
            const dupes = sids.filter((s, i) => sids.indexOf(s) !== i);
            expect(dupes, `${p.id}: duplicate section ids`).toEqual([]);
            for (const s of p.sections) {
                expect(s.title, `${p.id}#${s.id}`).toBeTruthy();
                expect(String(s.md || '').trim().length, `${p.id}#${s.id} has no text`).toBeGreaterThan(40);
            }
        }
    });
});

describe('docs — links inside the docs resolve', () => {
    it('every #section, page#section and /route link points at something real', () => {
        const broken = [];
        for (const p of DOC_PAGES) {
            for (const s of p.sections) {
                for (const t of linkTargets(s.md)) {
                    if (/^https?:\/\//.test(t)) continue;
                    if (t.startsWith('/')) { if (!routeMatches(t)) broken.push(`${p.id}#${s.id} → ${t} (no such app route)`); continue; }
                    const target = t.startsWith('#') ? `${p.id}${t}` : t;
                    if (!findDoc(target)) broken.push(`${p.id}#${s.id} → ${t}`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    it('every doc page that names an app route names a real one', () => {
        const bad = DOC_PAGES.filter(p => p.route && !routeMatches(p.route)).map(p => `${p.id} → ${p.route}`);
        expect(bad).toEqual([]);
    });
});

describe('docs — every 📖 link in the app resolves', () => {
    const uses = [];
    for (const [file, src] of Object.entries(SOURCES)) {
        String(src).replace(/\bdocs=["']([^"']+)["']/g, (_m, t) => { uses.push({ file, t }); return _m; });
        String(src).replace(/<DocLink\b[^>]*\bto=["']([^"']+)["']/g, (_m, t) => { uses.push({ file, t }); return _m; });
        // Computed targets: every quoted 'page#section' inside a `to={…}` / `docs={…}` expression…
        String(src).replace(/\b(?:to|docs)=\{([^}]*)\}/g, (_m, expr) => {
            expr.replace(/['"]([a-z][a-z-]*#[a-z0-9-]+)['"]/g, (_n, t) => { uses.push({ file, t }); return _n; });
            return _m;
        });
        // …and every section of a `TAB_DOC` map, joined to the page its template prefixes.
        const map = /const TAB_DOC = \{([^}]*)\}/.exec(src);
        const page = /to=\{`([a-z][a-z-]*)#\$\{TAB_DOC\[/.exec(src);
        if (map || page) {
            if (!map || !page) uses.push({ file, t: `TAB_DOC map and its DocLink must appear together (${map ? 'no DocLink' : 'no map'})` });
            else map[1].replace(/:\s*['"]([a-z0-9-]+)['"]/g, (_n, sid) => { uses.push({ file, t: `${page[1]}#${sid}` }); return _n; });
        }
    }

    it('finds the links (the scan itself works)', () => {
        expect(uses.length).toBeGreaterThan(0);
    });

    it('none of them is broken', () => {
        const broken = uses.filter(u => !findDoc(u.t)).map(u => `${u.file}: ${u.t}`);
        expect(broken).toEqual([]);
    });
});

describe('docs — coverage', () => {
    it('every page in the menu has a doc page', () => {
        const documented = new Set(DOC_PAGES.map(p => p.route).filter(Boolean));
        const missing = NAV_ITEMS.filter(n => n.path !== '/docs' && !documented.has(n.path)).map(n => n.path);
        expect(missing).toEqual([]);
    });
});
