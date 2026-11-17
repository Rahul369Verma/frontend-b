/**
 * FitVisibleWidth — an expanded row's contents, kept inside the part of a wide table you can see.
 *
 * A detail row (`<td colSpan={…}>`) is as wide as the whole table. When the table is wider than the
 * panel that scrolls it, a chart in that row is drawn across the full table width and its right
 * end sits off screen (18-Nov-2026: the round-trip path chart showed 09:20 → 13:00 of a replay
 * that ran to 13:18, and its tooltip was cut off). This sizes the contents to the scrolling
 * ancestor's VISIBLE width and pins them to its left edge (position: sticky), so they stay in view
 * however far the table is scrolled sideways.
 *
 * With no horizontally scrolling ancestor (or no ResizeObserver, e.g. jsdom) it is a plain block.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';

function scrollerOf(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return p;
    }
    return null;
}

export default function FitVisibleWidth({ children, className = '' }) {
    const ref = useRef(null);
    const [width, setWidth] = useState(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const sc = scrollerOf(el);
        if (!sc) return undefined;
        // the cell's own padding stays inside the visible width
        const cell = el.parentElement;
        const cs = cell ? getComputedStyle(cell) : null;
        const pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
        const measure = () => setWidth(Math.max(0, sc.clientWidth - pad));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(sc);
        return () => ro.disconnect();
    }, []);
    return (
        <div ref={ref} className={`sticky left-0 ${className}`} style={width != null ? { width } : undefined} data-testid="fit-visible-width">
            {children}
        </div>
    );
}
