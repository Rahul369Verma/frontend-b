'use strict';
/**
 * `setX(prev => keepIfSame(prev, next))` — keep the previous value when the new one
 * has the same content, so React skips the re-render entirely.
 *
 * Polls and socket snapshots hand back FRESH objects every time (the Dashboard's
 * 2-second snapshot replaced nine pieces of state, and the 8-second activity poll
 * its 100-row list, even when nothing had changed), and each fresh object
 * re-rendered everything under it. Content comparison is a JSON string — cheap
 * next to a render of the page it saves.
 */
export default function keepIfSame(prev, next) {
    if (prev === next) return prev;
    if (prev == null || next == null || typeof prev !== 'object' || typeof next !== 'object') return next;
    try { return JSON.stringify(prev) === JSON.stringify(next) ? prev : next; } catch { return next; }
}
