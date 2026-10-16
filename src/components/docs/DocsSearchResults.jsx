/**
 * DocsSearchResults — search hits shown in place of the article. Matched words
 * are highlighted; the row picked with ↑/↓ in the search box is marked and kept
 * in view, and Enter (handled by the box) opens it.
 */
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CornerDownLeft } from 'lucide-react';
import { groupOf } from '../../docs/index.js';

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlight({ text, words }) {
    if (!words.length || !text) return text || null;
    const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'ig');
    return String(text).split(re).map((part, i) => (i % 2 === 1
        ? <mark key={i} className="bg-warning/25 text-fg rounded-sm px-0.5">{part}</mark>
        : part));
}

export default function DocsSearchResults({ query, hits, words, selected, onHover, onOpen }) {
    const listRef = useRef(null);

    useEffect(() => {
        const el = listRef.current?.querySelector('[data-selected="true"]');
        const pane = listRef.current?.closest('[data-docs-pane]');
        if (!el || !pane) return;
        const p = pane.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.top < p.top + 8) pane.scrollTop -= (p.top + 8 - r.top);
        else if (r.bottom > p.bottom - 8) pane.scrollTop += (r.bottom - p.bottom + 8);
    }, [selected]);

    if (!hits.length) {
        return (
            <div className="py-10 text-center">
                <p className="text-sm text-fg-3">Nothing matches “{query}”.</p>
                <p className="text-xs text-fg-5 mt-1">Try a single simpler word (for example <em>margin</em>, <em>stop</em>, <em>probe</em>), or browse the contents.</p>
            </div>
        );
    }
    return (
        <div ref={listRef} className="space-y-2">
            <p className="text-2xs text-fg-5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{hits.length} match{hits.length === 1 ? '' : 'es'} for “{query}”</span>
                <span className="inline-flex items-center gap-1">↑ ↓ to move · <CornerDownLeft className="w-3 h-3" aria-hidden="true" /> to open · Esc to clear</span>
            </p>
            <ul className="space-y-2" aria-label="Search results">
                {hits.map((h, i) => {
                    const sel = i === selected;
                    return (
                        <li key={`${h.page.id}#${h.section.id}`}>
                            <Link to={`/docs/${h.page.id}#${h.section.id}`} onClick={onOpen} onMouseEnter={() => onHover?.(i)}
                                data-selected={sel ? 'true' : undefined}
                                className={`block border rounded-lg p-3 ${sel ? 'border-primary/70 bg-primary/5' : 'border-line/60 hover:border-primary/50 hover:bg-card-2/40'}`}>
                                <div className="text-2xs text-fg-5">{groupOf(h.page.id)?.title} › <Highlight text={h.page.title} words={words} /></div>
                                <div className="text-sm font-semibold text-fg"><Highlight text={h.section.title} words={words} /></div>
                                {h.snippet && <div className="text-xs text-fg-4 mt-1 leading-relaxed"><Highlight text={h.snippet} words={words} /></div>}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
