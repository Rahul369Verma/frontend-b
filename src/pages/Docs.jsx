/**
 * Docs — the in-app documentation (/docs and /docs/:pageId#section).
 *
 * Every page of the app has a doc page here, and every section of the app links
 * to its explanation through a 📖 DocLink. The words are written for someone with
 * no trading or software background; the content lives in src/docs/content/*.js
 * as a small Markdown subset (src/docs/markdown.jsx), so it is searchable and a
 * broken link fails a test instead of a reader.
 *
 * LAYOUT. The page fills <main> and never scrolls it: contents, article and the
 * "On this page" rail each scroll on their own, so the contents stay in reach
 * however far down a page you read. Which panes show is decided by the page's
 * width in REM (useRemWidth), so a larger Text Size moves the breakpoints with it:
 * three panes when there is room, two (contents + article), or one with the
 * contents in a drawer.
 *
 * WHILE READING. The section being read is highlighted in both the contents and
 * the rail (scroll-spy) and written into the address bar (same history entry),
 * so a copied URL opens where you are. Links to other parts of the docs preview
 * their target on hover. Keyboard: / or Ctrl+K search, j/k sections, [ ] pages,
 * ? lists them all.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    BookOpen, Search, ChevronLeft, ChevronRight, Link2, ExternalLink, ArrowUp, Keyboard, ListTree, X, MapPin, Clock, Filter,
} from 'lucide-react';
import { PageHeader, Modal } from '../components/viz/primitives';
import { DOC_PAGES, getDocPage, searchDocs, queryWords, groupOf, readingMinutes } from '../docs/index.js';
import { renderMarkdown, plainText } from '../docs/markdown.jsx';
import DocsToc from '../components/docs/DocsToc.jsx';
import DocsSearchResults from '../components/docs/DocsSearchResults.jsx';
import DocPreviewCard from '../components/docs/DocPreviewCard.jsx';
import { pushRecent } from '../components/docs/docsPrefs.js';
import useRemWidth from '../hooks/useRemWidth.js';
import { toast } from '../components/toastStore.js';

/** Page width (rem) at which each layout fits. */
const THREE_PANES_REM = 76;
const TWO_PANES_REM = 48;

const SHORTCUTS = [
    ['/', 'Search the docs'],
    ['Ctrl K', 'Search the docs (works while typing elsewhere too)'],
    ['↑ ↓  Enter', 'Move through search results and open one'],
    ['Esc', 'Clear the search, or close a window'],
    ['j', 'Next section'],
    ['k', 'Previous section'],
    [']', 'Next page'],
    ['[', 'Previous page'],
    ['?', 'Show this list'],
];

// Added to a section for a moment when a link lands on it, so the eye finds it.
const FLASH = ['bg-primary/5', 'ring-1', 'ring-primary/30'];

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Scroll the article pane (never <main>) so section `id` sits at its top. */
function scrollPaneTo(pane, id, smooth) {
    const el = document.getElementById(`doc-${id}`);
    if (!pane || !el) return false;
    const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 12;
    if (pane.scrollTo) pane.scrollTo({ top, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
    else pane.scrollTop = top;
    return true;
}

function flashSection(id) {
    const el = document.getElementById(`doc-${id}`);
    if (!el) return;
    el.classList.add(...FLASH);
    window.setTimeout(() => el.classList.remove(...FLASH), 1600);
}

function Kbd({ children }) {
    return <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-line-2 bg-card-2 text-3xs font-mono text-fg-3">{children}</kbd>;
}

/** The article itself. Memoised: scroll-spy re-renders the shell on every section change, not this. */
const ArticleBody = memo(function ArticleBody({ page, unknownId, showInlineToc, onCopy }) {
    const [filter, setFilter] = useState('');
    const group = groupOf(page.id);
    const idx = DOC_PAGES.findIndex(p => p.id === page.id);
    const prev = idx > 0 ? DOC_PAGES[idx - 1] : null;
    const next = idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : null;
    const isGlossary = page.id === 'glossary';
    const f = filter.trim().toLowerCase();
    const sections = isGlossary && f
        ? page.sections.filter(s => s.title.toLowerCase().includes(f) || plainText(s.md).toLowerCase().includes(f))
        : page.sections;
    const letters = isGlossary
        ? [...new Map(page.sections.map(s => [s.title[0].toUpperCase(), s.id])).entries()]
        : [];

    return (
        <>
            {unknownId && (
                <p className="mb-3 text-xs text-warning">There is no doc page called “{unknownId}” — showing {page.title} instead.</p>
            )}
            <nav aria-label="Breadcrumb" className="text-2xs text-fg-5 mb-1">
                <Link to="/docs" className="hover:text-fg-3">Docs</Link>
                {group && <> › <span>{group.title}</span></>}
                {' › '}<span className="text-fg-4">{page.title}</span>
            </nav>
            <h2 className="text-2xl font-bold text-fg leading-tight">{page.title}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-2xs text-fg-5">
                <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" />≈ {readingMinutes(page)} min read</span>
                <span>{page.sections.length} section{page.sections.length === 1 ? '' : 's'}</span>
                {page.route && (
                    <Link to={page.route} className="inline-flex items-center gap-1 text-primary-ink hover:underline">
                        Open this page in the app <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </Link>
                )}
            </div>
            {page.summary && <p className="text-[0.95rem] text-fg-3 mt-3 mb-5 leading-relaxed">{page.summary}</p>}

            {showInlineToc && page.sections.length > 1 && !isGlossary && (
                <details open className="mb-6 border border-line/60 rounded-lg bg-card-2/30">
                    <summary className="cursor-pointer px-3 py-2 text-3xs uppercase tracking-wide text-fg-5">On this page</summary>
                    <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs px-3 pb-3">
                        {page.sections.map(s => <li key={s.id}><Link to={`/docs/${page.id}#${s.id}`} className="text-fg-3 hover:text-primary-ink">{s.title}</Link></li>)}
                    </ul>
                </details>
            )}

            {isGlossary && (
                <div className="mb-6 space-y-2 border border-line/60 rounded-lg bg-card-2/30 p-3">
                    <label className="relative block max-w-sm">
                        <span className="sr-only">Filter glossary terms</span>
                        <Filter className="w-3.5 h-3.5 text-fg-5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                        <input type="search" value={filter} onChange={e => setFilter(e.target.value)}
                            placeholder={`Filter ${page.sections.length} terms — e.g. margin`}
                            className="w-full h-8 bg-slate-800 border border-line rounded-md pl-8 pr-2 text-xs text-fg-2 placeholder:text-fg-5" />
                    </label>
                    {f ? (
                        <p className="text-2xs text-fg-5">{sections.length} of {page.sections.length} terms match “{filter.trim()}”.</p>
                    ) : (
                        <nav aria-label="Jump to letter" className="flex flex-wrap gap-1">
                            {letters.map(([letter, sid]) => (
                                <Link key={letter} to={`/docs/${page.id}#${sid}`} replace
                                    className="w-7 h-7 inline-flex items-center justify-center rounded border border-line/70 text-xs text-fg-3 hover:text-primary-ink hover:border-primary/50">
                                    {letter}
                                </Link>
                            ))}
                        </nav>
                    )}
                </div>
            )}

            {sections.map((s, i) => (
                <section key={s.id} id={`doc-${s.id}`} data-doc-section={s.id}
                    className={`rounded-lg -mx-3 px-3 pb-2 transition-colors duration-700 ${i ? 'border-t border-line/40 pt-5 mt-3' : 'pt-1'}`}>
                    <h3 className="group text-lg font-semibold text-fg flex items-center gap-2">
                        <span>{s.title}</span>
                        <button type="button" onClick={() => onCopy(page.id, s.id)}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-fg-5 hover:text-primary-ink"
                            title="Copy a link to this section" aria-label={`Copy a link to “${s.title}”`}>
                            <Link2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </h3>
                    {s.where && (
                        <p className="inline-flex items-center gap-1 text-2xs text-fg-5 mt-1 px-2 py-0.5 rounded-full bg-card-2/60">
                            <MapPin className="w-3 h-3" aria-hidden="true" /> {s.where}
                        </p>
                    )}
                    <div className="mt-1 leading-relaxed">{renderMarkdown(s.md, { page: page.id })}</div>
                </section>
            ))}

            <div className="grid sm:grid-cols-2 gap-3 mt-10 pt-5 border-t border-line/60">
                {prev ? (
                    <Link to={`/docs/${prev.id}`} className="group border border-line/60 rounded-lg p-3 hover:border-primary/50">
                        <div className="text-3xs uppercase tracking-wide text-fg-5 flex items-center gap-1"><ChevronLeft className="w-3 h-3" aria-hidden="true" /> Previous</div>
                        <div className="text-sm font-semibold text-fg-2 group-hover:text-primary-ink">{prev.title}</div>
                    </Link>
                ) : <span />}
                {next && (
                    <Link to={`/docs/${next.id}`} className="group border border-line/60 rounded-lg p-3 text-right hover:border-primary/50">
                        <div className="text-3xs uppercase tracking-wide text-fg-5 flex items-center justify-end gap-1">Next <ChevronRight className="w-3 h-3" aria-hidden="true" /></div>
                        <div className="text-sm font-semibold text-fg-2 group-hover:text-primary-ink">{next.title}</div>
                    </Link>
                )}
            </div>
        </>
    );
});

function OnThisPage({ page, active, onTop, onCopy, onPick }) {
    return (
        <div className="text-xs space-y-4">
            <div>
                <div className="text-3xs uppercase tracking-wide text-fg-5 mb-1.5">On this page</div>
                <ul className="border-l border-line/60">
                    {page.sections.map(s => {
                        const on = s.id === active;
                        return (
                            <li key={s.id}>
                                <Link to={`/docs/${page.id}#${s.id}`} onClick={onPick} aria-current={on ? 'location' : undefined}
                                    className={`block -ml-px pl-2.5 py-0.5 border-l-2 leading-snug ${on ? 'border-primary text-primary-ink font-medium' : 'border-transparent text-fg-4 hover:text-fg'}`}>
                                    {s.title}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </div>
            <div className="space-y-1.5 border-t border-line/60 pt-3">
                <button type="button" onClick={onTop} className="flex items-center gap-1.5 text-fg-4 hover:text-fg">
                    <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /> Back to top
                </button>
                <button type="button" onClick={() => onCopy(page.id, active)} className="flex items-center gap-1.5 text-fg-4 hover:text-fg">
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Copy link to {active ? 'this section' : 'this page'}
                </button>
                {page.route && (
                    <Link to={page.route} className="flex items-center gap-1.5 text-fg-4 hover:text-fg">
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open in the app
                    </Link>
                )}
            </div>
        </div>
    );
}

function SearchTips() {
    return (
        <div className="text-xs text-fg-4 space-y-2">
            <div className="text-3xs uppercase tracking-wide text-fg-5">Search tips</div>
            <p>Every word you type must appear in a result — fewer, simpler words find more.</p>
            <p>Section titles that match rank first, then page names, then the text.</p>
            <p className="flex flex-wrap items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> pick · <Kbd>Enter</Kbd> open · <Kbd>Esc</Kbd> clear</p>
        </div>
    );
}

export default function Docs() {
    const { pageId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const page = getDocPage(pageId) || DOC_PAGES[0];
    const unknownId = pageId && !getDocPage(pageId) ? pageId : null;

    const rootRef = useRef(null);
    const paneRef = useRef(null);
    const barRef = useRef(null);
    const searchRef = useRef(null);
    const rafRef = useRef(0);
    const lastPageRef = useRef(null);
    const hoverRef = useRef(0);
    const articleRef = useRef(null);

    const rem = useRemWidth(rootRef);
    const layout = rem == null ? 'two' : rem >= THREE_PANES_REM ? 'three' : rem >= TWO_PANES_REM ? 'two' : 'one';

    const [query, setQuery] = useState('');
    const [sel, setSel] = useState(0);
    const [active, setActive] = useState(null);
    const [showTop, setShowTop] = useState(false);
    const [tocOpen, setTocOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [preview, setPreview] = useState(null);

    const q = query.trim();
    const hits = useMemo(() => (q ? searchDocs(q) : []), [q]);
    const words = useMemo(() => queryWords(q), [q]);
    const idx = DOC_PAGES.findIndex(p => p.id === page.id);
    const prev = idx > 0 ? DOC_PAGES[idx - 1] : null;
    const next = idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : null;

    useEffect(() => { pushRecent(page.id); }, [page.id]);

    /** Scroll-spy, reading progress, back-to-top and the address bar — once per frame at most. */
    const measure = useCallback(() => {
        rafRef.current = 0;
        const pane = paneRef.current;
        if (!pane) return;
        const { scrollTop, scrollHeight, clientHeight } = pane;
        const room = scrollHeight - clientHeight;
        if (barRef.current) barRef.current.style.transform = `scaleX(${room > 2 ? Math.min(1, scrollTop / room) : 0})`;
        setShowTop(scrollTop > clientHeight * 0.8);
        setPreview(null);
        const secs = pane.querySelectorAll('section[data-doc-section]');
        if (!secs.length) { setActive(null); return; }
        const paneTop = pane.getBoundingClientRect().top;
        let cur = secs[0].dataset.docSection;
        for (const s of secs) {
            if (s.getBoundingClientRect().top - paneTop <= 96) cur = s.dataset.docSection;
            else break;
        }
        if (room > 2 && scrollTop >= room - 2) cur = secs[secs.length - 1].dataset.docSection;
        setActive(cur);
        // The address follows the reading position on the SAME history entry (the
        // router's own state object is kept), so a copied URL opens right here.
        const pid = pane.dataset.page;
        const want = scrollTop < 8 ? `/docs/${pid}` : `/docs/${pid}#${cur}`;
        if (pid && `${window.location.pathname}${window.location.hash}` !== want) {
            window.history.replaceState(window.history.state, '', want);
        }
    }, []);

    const onPaneScroll = useCallback(() => {
        if (!rafRef.current) rafRef.current = window.requestAnimationFrame(measure);
    }, [measure]);

    // Reset the handle as well as cancelling: a cancelled frame left in the ref
    // would make onPaneScroll think one is still pending — forever (React's dev
    // double-mount runs this cleanup once on every load).
    useEffect(() => () => {
        if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
    }, []);

    // Arrival: every navigation (a new location.key) lands on its #section, or on
    // the top of a new page. Same-page jumps glide; arriving from elsewhere snaps.
    useLayoutEffect(() => {
        const pane = paneRef.current;
        const id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
        const samePage = lastPageRef.current === page.id;
        lastPageRef.current = page.id;
        if (!pane) return;
        if (id) {
            if (!scrollPaneTo(pane, id, samePage)) window.requestAnimationFrame(() => scrollPaneTo(pane, id, false));
            flashSection(id);
        } else if (!samePage) {
            pane.scrollTop = 0;
        }
        onPaneScroll();
    }, [location.key, location.hash, page.id, onPaneScroll]);

    const copyLink = useCallback(async (pid, sid) => {
        const url = `${window.location.origin}/docs/${pid}${sid ? `#${sid}` : ''}`;
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copied — paste it anywhere to open this spot in the docs.');
        } catch {
            toast.info(`Copy this link: ${url}`);
        }
    }, []);

    const toTop = useCallback(() => {
        const pane = paneRef.current;
        if (pane?.scrollTo) pane.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
        else if (pane) pane.scrollTop = 0;
    }, []);

    const clearSearch = useCallback(() => { setQuery(''); setSel(0); }, []);
    const closeAndClear = useCallback(() => { setTocOpen(false); setQuery(''); setSel(0); }, []);

    const openHit = (h) => {
        if (!h) return;
        clearSearch();
        navigate(`/docs/${h.page.id}#${h.section.id}`);
    };

    const onSearchKey = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, Math.max(0, hits.length - 1))); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); openHit(hits[sel]); }
        else if (e.key === 'Escape') { if (query) clearSearch(); else e.currentTarget.blur(); }
    };

    // Page-wide keyboard shortcuts (never while typing in a field, except Ctrl+K).
    useEffect(() => {
        const step = (dir) => {
            const ids = page.sections.map(s => s.id);
            const at = Math.max(0, ids.indexOf(active));
            const to = ids[Math.min(ids.length - 1, Math.max(0, at + dir))];
            if (to) navigate(`/docs/${page.id}#${to}`, { replace: true });
        };
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return;
            }
            if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || helpOpen) return;
            if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
            else if (e.key === '?') setHelpOpen(true);
            else if (e.key === 'Escape') { setTocOpen(false); setPreview(null); }
            else if (q) return;
            else if (e.key === 'j') step(1);
            else if (e.key === 'k') step(-1);
            else if (e.key === ']' && next) navigate(`/docs/${next.id}`);
            else if (e.key === '[' && prev) navigate(`/docs/${prev.id}`);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active, page, prev, next, q, helpOpen, navigate]);

    // Hover / keyboard-focus previews for links into the docs: one delegated
    // listener set on the article, so the hundreds of links need no handlers.
    useEffect(() => {
        const root = articleRef.current;
        if (!root) return undefined;
        const linkOf = (e) => e.target.closest?.('a[data-doc-target]');
        const show = (delay) => (e) => {
            const a = linkOf(e);
            if (!a) return;
            window.clearTimeout(hoverRef.current);
            hoverRef.current = window.setTimeout(() => setPreview({ target: a.dataset.docTarget, rect: a.getBoundingClientRect() }), delay);
        };
        const hide = (e) => {
            const a = linkOf(e);
            if (!a || a.contains(e.relatedTarget)) return;
            window.clearTimeout(hoverRef.current);
            setPreview(null);
        };
        const onOver = show(350);
        const onFocus = show(0);
        root.addEventListener('mouseover', onOver);
        root.addEventListener('mouseout', hide);
        root.addEventListener('focusin', onFocus);
        root.addEventListener('focusout', hide);
        return () => {
            window.clearTimeout(hoverRef.current);
            root.removeEventListener('mouseover', onOver);
            root.removeEventListener('mouseout', hide);
            root.removeEventListener('focusin', onFocus);
            root.removeEventListener('focusout', hide);
        };
    }, []);

    const toc = <DocsToc current={page} activeSection={q ? null : active} onPick={closeAndClear} />;

    return (
        <div ref={rootRef} className="h-full min-h-0 flex flex-col gap-3 p-4">
            <PageHeader icon={BookOpen} title="Documentation"
                subtitle="What every page and section of this app shows, in plain words — no trading or software background needed."
                actions={(
                    <>
                        <label className="relative w-[22rem] max-w-full">
                            <span className="sr-only">Search the documentation</span>
                            <Search className="w-4 h-4 text-fg-5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                            <input ref={searchRef} type="search" value={query}
                                onChange={e => { setQuery(e.target.value); setSel(0); if (paneRef.current) paneRef.current.scrollTop = 0; }}
                                onKeyDown={onSearchKey}
                                placeholder="Search — e.g. margin, probe, shadow"
                                aria-label="Search the documentation" aria-keyshortcuts="/ Control+K"
                                aria-controls="docs-article"
                                className="w-full h-9 bg-slate-800 border border-line rounded-md pl-8 pr-9 text-sm text-fg-2 placeholder:text-fg-5" />
                            {!query && <span aria-hidden="true" className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><Kbd>/</Kbd></span>}
                        </label>
                        {layout === 'one' && (
                            <button type="button" onClick={() => setTocOpen(true)} aria-expanded={tocOpen}
                                className="h-9 px-3 rounded-md border border-line bg-slate-800 text-xs text-fg-3 inline-flex items-center gap-1.5">
                                <ListTree className="w-4 h-4" aria-hidden="true" /> Contents
                            </button>
                        )}
                        <button type="button" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)"
                            aria-label="Keyboard shortcuts"
                            className="h-9 w-9 rounded-md border border-line bg-slate-800 text-fg-4 hover:text-fg inline-flex items-center justify-center">
                            <Keyboard className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </>
                )} />

            <div className="flex-1 min-h-0 flex gap-4">
                {layout !== 'one' && (
                    <aside data-docs-pane className="w-60 shrink-0 overflow-y-auto overscroll-contain rounded-lg border border-line/60 bg-surface p-3">
                        {toc}
                    </aside>
                )}

                <div className="relative flex-1 min-w-0 flex flex-col rounded-lg border border-line/60 bg-surface overflow-hidden">
                    <div className="absolute inset-x-0 top-0 h-0.5 z-10" aria-hidden="true">
                        <div ref={barRef} className="h-full bg-primary origin-left" style={{ transform: 'scaleX(0)' }} />
                    </div>
                    <div ref={paneRef} data-docs-pane data-page={page.id} onScroll={onPaneScroll}
                        tabIndex={0} aria-label="Documentation text"
                        className="flex-1 min-h-0 overflow-y-auto overscroll-contain focus:outline-none">
                        <article ref={articleRef} id="docs-article" aria-live={q ? 'polite' : undefined}
                            className="mx-auto max-w-[50rem] px-5 sm:px-8 py-6 text-sm text-fg-3">
                            {q
                                ? <DocsSearchResults query={q} hits={hits} words={words} selected={sel} onHover={setSel} onOpen={clearSearch} />
                                : <ArticleBody key={page.id} page={page} unknownId={unknownId} showInlineToc={layout !== 'three'} onCopy={copyLink} />}
                        </article>
                    </div>
                    {showTop && !q && (
                        <button type="button" onClick={toTop} title="Back to top" aria-label="Back to top"
                            className="absolute bottom-4 right-4 h-9 w-9 rounded-full border border-line bg-card-2 text-fg-3 hover:text-fg shadow-lg inline-flex items-center justify-center">
                            <ArrowUp className="w-4 h-4" aria-hidden="true" />
                        </button>
                    )}
                </div>

                {layout === 'three' && (
                    <aside data-docs-pane className="w-52 shrink-0 overflow-y-auto overscroll-contain py-1 pr-1">
                        {q ? <SearchTips /> : <OnThisPage page={page} active={active} onTop={toTop} onCopy={copyLink} onPick={clearSearch} />}
                    </aside>
                )}
            </div>

            {tocOpen && layout === 'one' && (
                <div className="fixed inset-0 z-40 flex">
                    <div data-docs-pane role="dialog" aria-modal="true" aria-label="Documentation contents"
                        className="w-[min(20rem,85vw)] h-full overflow-y-auto overscroll-contain bg-surface border-r border-line p-3 shadow-2xl">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-fg">Contents</span>
                            <button type="button" onClick={() => setTocOpen(false)} aria-label="Close contents" className="p-1 text-fg-5 hover:text-fg">
                                <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                        </div>
                        {toc}
                    </div>
                    <button type="button" className="flex-1 bg-black/50" aria-label="Close contents" onClick={() => setTocOpen(false)} />
                </div>
            )}

            <DocPreviewCard target={preview?.target} rect={preview?.rect} />

            <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
                <ul className="space-y-1.5 text-xs">
                    {SHORTCUTS.map(([k, what]) => (
                        <li key={k} className="flex items-center justify-between gap-6">
                            <span className="text-fg-3">{what}</span>
                            <span className="flex gap-1">{k.split(/\s{1,2}/).map(part => <Kbd key={part}>{part}</Kbd>)}</span>
                        </li>
                    ))}
                </ul>
                <p className="text-2xs text-fg-5 mt-3">Hover over a link to another part of the docs to preview it. The address bar follows the section you are reading, so copying it shares that exact spot.</p>
            </Modal>
        </div>
    );
}
