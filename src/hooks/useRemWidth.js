'use strict';
import { useLayoutEffect, useState } from 'react';

/**
 * useRemWidth — an element's content width in REM, kept current.
 *
 * REM, not px, because the Text Size control scales the root font-size. A
 * layout that switches at a px width keeps cramming the same columns in at
 * 1.4x text, which is exactly how a table ends up with its numbers touching.
 * Measured in rem, "is there room for this table?" is answered in units of
 * text, so a bigger text size moves the breakpoint with it.
 *
 * A 1rem ruler is observed alongside the element: a text-size change alters
 * the answer without moving the element's px width, and ResizeObserver only
 * fires on a size change — the ruler is the thing whose size does change.
 *
 * Returns null until measured (and where ResizeObserver does not exist, e.g.
 * jsdom), so callers pick their own default.
 */
export default function useRemWidth(ref) {
    const [rem, setRem] = useState(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ruler = document.createElement('span');
        ruler.setAttribute('aria-hidden', 'true');
        ruler.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:1rem;height:1px;overflow:hidden';
        document.body.appendChild(ruler);
        const measure = () => {
            const unit = ruler.getBoundingClientRect().width;
            if (unit > 0) setRem(Math.round((el.clientWidth / unit) * 10) / 10);
        };
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        ro.observe(ruler);
        measure();
        return () => { ro.disconnect(); ruler.remove(); };
    }, [ref]);
    return rem;
}
