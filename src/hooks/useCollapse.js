'use strict';
import { useCallback, useEffect, useState } from 'react';

/**
 * useCollapse — the open/closed state of a foldable panel (an accordion section).
 *
 * ONE implementation behind every foldable surface: Card and Panel
 * (components/viz/primitives.jsx), CollapsibleCard, and the hand-built toggles
 * that predate them. Each used to keep its own useState + localStorage try/catch,
 * and none of them could be folded together.
 *
 *  - Remembered per panel when it has a `storageKey` (stored '1' / '0', the
 *    format CollapsibleCard always used, so existing preferences survive).
 *  - "Collapse all / Expand all" (CollapseAllControl) reaches every mounted panel
 *    through one window event — no registry, no context provider to forget.
 *  - Controlled: pass `open` + `onOpenChange` to own the state (e.g. to pause a
 *    poll while folded); the event and the toggle then go through onOpenChange.
 *
 * Storage can be unavailable (private mode, blocked site data): the panel still
 * folds, the preference just does not persist.
 */
export const FOLD_ALL_EVENT = 'ui:fold-all';

/** Fold (false) or unfold (true) every mounted panel on the page. */
export function setAllFolded(open) {
    try { window.dispatchEvent(new CustomEvent(FOLD_ALL_EVENT, { detail: { open: !!open } })); } catch { /* no window (SSR/tests without DOM) */ }
}

function readStored(key, fallback) {
    if (!key) return fallback;
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v === '1';
    } catch { return fallback; }
}

export default function useCollapse({ storageKey = null, defaultOpen = true, open: controlledOpen, onOpenChange } = {}) {
    const isControlled = typeof controlledOpen === 'boolean';
    const [inner, setInner] = useState(() => readStored(storageKey, defaultOpen));
    const open = isControlled ? controlledOpen : inner;

    const setOpen = useCallback((next) => {
        const v = !!next;
        if (!isControlled) setInner(v);
        if (storageKey) { try { localStorage.setItem(storageKey, v ? '1' : '0'); } catch { /* not persisted — still folds */ } }
        if (onOpenChange) onOpenChange(v);
    }, [isControlled, storageKey, onOpenChange]);

    const toggle = useCallback(() => setOpen(!open), [setOpen, open]);

    useEffect(() => {
        const onAll = (e) => setOpen(!!(e && e.detail && e.detail.open));
        window.addEventListener(FOLD_ALL_EVENT, onAll);
        return () => window.removeEventListener(FOLD_ALL_EVENT, onAll);
    }, [setOpen]);

    return { open, toggle, setOpen };
}

/** Plain text of a React node — the title of a panel, for a stable storage key. */
export function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (typeof node === 'object' && node.props) return textOf(node.props.children);
    return '';
}

/**
 * The key a panel remembers itself under when the caller gave none: the page
 * (first path segment), its docs anchor and its title with numbers masked —
 * "Trades (42)" and "Trades (43)" are the same panel.
 */
export function deriveFoldKey({ docs = null, title = null }) {
    const t = textOf(title).replace(/\d[\d,.]*/g, '#').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t && !docs) return null;
    let page = '';
    try { page = (window.location.pathname || '').split('/')[1] || 'home'; } catch { /* no location */ }
    return `fold:${page}|${docs || ''}|${t}`;
}
