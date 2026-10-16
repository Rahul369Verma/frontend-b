'use strict';
import { useCallback, useMemo, useState } from 'react';
import useLocalStorage from './useLocalStorage.js';

/**
 * Re-orderable table columns, remembered per browser.
 *
 * A table's columns change with what it is showing (a Gate column only when the
 * gate ran, AI columns only with AI on), so a remembered order is MERGED with
 * today's columns rather than trusted: known keys keep their remembered place, a
 * column that is new (or newly shown) slots in right after the column it
 * follows by default, and keys that are not shown today are dropped from the
 * view but kept in storage so they come back where they were.
 */

/** Remembered order + today's keys → the order to draw. */
export function mergeOrder(saved, keys) {
    const out = (Array.isArray(saved) ? saved : []).filter((k, i, a) => keys.includes(k) && a.indexOf(k) === i);
    keys.forEach((k, i) => {
        if (out.includes(k)) return;
        const prev = keys.slice(0, i).reverse().find(p => out.includes(p));
        out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, k);
    });
    return out;
}

/** Move `from` to just before / after `to`. Unknown keys or a no-op return the same order. */
export function moveKey(order, from, to, side = 'before') {
    if (from === to || !order.includes(from) || !order.includes(to)) return order;
    const out = order.filter(k => k !== from);
    const at = out.indexOf(to);
    out.splice(side === 'after' ? at + 1 : at, 0, from);
    return out;
}

/** Move `key` one step left (-1) or right (+1). */
export function stepKey(order, key, delta) {
    const i = order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return order;
    const out = [...order];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

/**
 * useColumnOrder(storageKey, keys) → { order, move, step, reset, isCustom }
 *   order            today's keys in display order
 *   move(from,to,side)  drop `from` before/after `to`
 *   step(key, ±1)    nudge one place (keyboard / menu)
 *   reset()          back to the default order (forgets the remembered one)
 */
export default function useColumnOrder(storageKey, keys) {
    const [saved, setSaved] = useLocalStorage(storageKey, null, { validate: v => v === null || Array.isArray(v) });
    const sig = keys.join('|');
    const current = useMemo(() => sig.split('|').filter(Boolean), [sig]);
    const order = useMemo(() => mergeOrder(saved, current), [saved, current]);

    // Keep keys that are hidden today at the end of the stored list, so a column
    // that comes back later still has a remembered place.
    const commit = useCallback((next) => setSaved(prev => [...next, ...(Array.isArray(prev) ? prev.filter(k => !next.includes(k)) : [])]), [setSaved]);

    const move = useCallback((from, to, side) => commit(moveKey(order, from, to, side)), [commit, order]);
    const step = useCallback((key, delta) => commit(stepKey(order, key, delta)), [commit, order]);
    const reset = useCallback(() => setSaved(null), [setSaved]);
    const isCustom = order.some((k, i) => k !== current[i]);
    return { order, move, step, reset, isCustom };
}

/**
 * Drag-and-drop between header cells (HTML5 DnD — mouse and pen; touch screens
 * use the Columns menu instead). Returns the key being dragged, where it would
 * land, and the props to spread on each <th>.
 */
export function useColumnDrag(move) {
    const [drag, setDrag] = useState(null);
    const [over, setOver] = useState(null); // { key, side: 'before' | 'after' }

    const sideOf = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
    };
    const end = () => { setDrag(null); setOver(null); };

    const thProps = (key) => ({
        draggable: true,
        onDragStart: (e) => {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', key); } catch { /* some browsers refuse custom data — the state below is enough */ }
            setDrag(key);
        },
        onDragOver: (e) => {
            if (!drag) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const side = sideOf(e);
            setOver(o => (o && o.key === key && o.side === side ? o : { key, side }));
        },
        onDragLeave: (e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            setOver(o => (o && o.key === key ? null : o));
        },
        onDrop: (e) => {
            e.preventDefault();
            if (drag && drag !== key) move(drag, key, sideOf(e));
            end();
        },
        onDragEnd: end,
    });

    return { drag, over, thProps };
}
