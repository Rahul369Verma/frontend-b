/**
 * DocsToc — the docs' contents pane: recently viewed pages, then every group of
 * pages (foldable), with the open page's sections listed under it and the one
 * being read highlighted (scroll-spy, driven by the article pane).
 *
 * The pane scrolls on its own; when the highlighted section moves out of view
 * the pane follows it, without touching the article's scroll.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { DOC_GROUPS, getDocPage } from '../../docs/index.js';
import { readFolded, readRecent, writeFolded } from './docsPrefs.js';

export default function DocsToc({ current, activeSection, onPick }) {
    const [folded, setFolded] = useState(() => new Set(readFolded()));
    const paneRef = useRef(null);

    // keep the highlighted section visible inside this pane only
    useEffect(() => {
        const pane = paneRef.current?.closest('[data-docs-pane]');
        const el = paneRef.current?.querySelector('[data-toc-active="true"]');
        if (!pane || !el) return;
        const p = pane.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.top < p.top + 8) pane.scrollTop -= (p.top + 8 - r.top);
        else if (r.bottom > p.bottom - 8) pane.scrollTop += (r.bottom - p.bottom + 8);
    }, [activeSection, current.id]);

    const toggle = (title) => setFolded(prev => {
        const next = new Set(prev);
        if (next.has(title)) next.delete(title); else next.add(title);
        writeFolded([...next]);
        return next;
    });

    const recentPages = readRecent().filter(id => id !== current.id).map(getDocPage).filter(Boolean).slice(0, 4);

    return (
        <nav ref={paneRef} aria-label="Documentation contents" className="text-xs space-y-4">
            {recentPages.length > 0 && (
                <div>
                    <div className="flex items-center gap-1 text-3xs uppercase tracking-wide text-fg-5 mb-1">
                        <History className="w-3 h-3" aria-hidden="true" /> Recently viewed
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {recentPages.map(p => (
                            <Link key={p.id} to={`/docs/${p.id}`} onClick={onPick}
                                className="px-2 py-0.5 rounded-full border border-line/70 text-fg-4 hover:text-fg hover:border-primary/50">
                                {p.title}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
            {DOC_GROUPS.map(g => {
                const hasCurrent = g.pages.some(p => p.id === current.id);
                const open = hasCurrent || !folded.has(g.title);
                const listId = `toc-${g.title.replace(/\W+/g, '-').toLowerCase()}`;
                return (
                    <div key={g.title}>
                        <button type="button" onClick={() => toggle(g.title)} disabled={hasCurrent}
                            aria-expanded={open} aria-controls={listId}
                            title={hasCurrent ? 'The page you are reading is in this group' : open ? 'Fold this group' : 'Unfold this group'}
                            className="w-full flex items-center gap-1 text-3xs uppercase tracking-wide text-fg-5 hover:text-fg-3 disabled:hover:text-fg-5 mb-1">
                            {open ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                            <span className="flex-1 text-left">{g.title}</span>
                            <span className="normal-case tracking-normal">{g.pages.length}</span>
                        </button>
                        {open && (
                            <ul id={listId} className="space-y-0.5">
                                {g.pages.map(p => {
                                    const here = p.id === current.id;
                                    return (
                                        <li key={p.id}>
                                            <Link to={`/docs/${p.id}`} onClick={onPick}
                                                aria-current={here ? 'page' : undefined}
                                                className={`block rounded px-2 py-1 ${here ? 'bg-primary/10 text-primary-ink font-semibold' : 'text-fg-3 hover:text-fg hover:bg-card-2/50'}`}>
                                                {p.title}
                                            </Link>
                                            {here && (
                                                <ul className="ml-3 mt-0.5 mb-1 border-l border-line/60">
                                                    {p.sections.map(s => {
                                                        const active = s.id === activeSection;
                                                        return (
                                                            <li key={s.id}>
                                                                <Link to={`/docs/${p.id}#${s.id}`} data-toc-active={active ? 'true' : undefined}
                                                                    onClick={onPick}
                                                                    aria-current={active ? 'location' : undefined}
                                                                    className={`block -ml-px pl-2 py-0.5 border-l-2 truncate ${active ? 'border-primary text-primary-ink font-medium' : 'border-transparent text-fg-4 hover:text-fg'}`}
                                                                    title={s.title}>
                                                                    {s.title}
                                                                </Link>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
