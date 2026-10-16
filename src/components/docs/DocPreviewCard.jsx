/**
 * DocPreviewCard — hover (or keyboard-focus) a link to another part of the docs
 * and see where it goes before clicking: the page, the section and its opening
 * words. Glossary links therefore read like footnotes.
 *
 * Positioned in the viewport (fixed) under the link, flipped above it when there
 * is no room below, and clamped to the screen edges. It never takes the pointer,
 * so it cannot get in the way of the link it describes.
 */
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { BookOpen } from 'lucide-react';
import { docPreview } from '../../docs/index.js';

export default function DocPreviewCard({ target, rect }) {
    const ref = useRef(null);
    const info = useMemo(() => (target ? docPreview(target) : null), [target]);

    // Measured, then placed, before paint: written straight to the element so a
    // hover never costs a second render.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !rect) return;
        const card = el.getBoundingClientRect();
        const below = rect.bottom + 8;
        const top = below + card.height > window.innerHeight - 8 ? Math.max(8, rect.top - card.height - 8) : below;
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - card.width - 8);
        el.style.top = `${top}px`;
        el.style.left = `${left}px`;
        el.style.visibility = 'visible';
    }, [rect, info]);

    if (!info || !rect) return null;
    return (
        <div ref={ref} role="tooltip" id="doc-preview-card"
            style={{ top: 0, left: 0, visibility: 'hidden' }}
            className="fixed z-50 w-[22rem] max-w-[calc(100vw-1rem)] pointer-events-none rounded-lg border border-line bg-surface shadow-2xl p-3 text-xs">
            <div className="flex items-center gap-1 text-3xs uppercase tracking-wide text-fg-5">
                <BookOpen className="w-3 h-3" aria-hidden="true" /> {info.pageTitle}
            </div>
            <div className="text-sm font-semibold text-fg mt-0.5">{info.title}</div>
            {info.text && <p className="text-fg-4 mt-1 leading-relaxed">{info.text}</p>}
            <div className="text-3xs text-fg-5 mt-2">Click the link to open it.</div>
        </div>
    );
}
