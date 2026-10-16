'use strict';
/**
 * Per-browser conveniences for the docs page: recently viewed pages and which
 * contents groups are folded. Nothing here matters if it is lost — storage can
 * be blocked (private windows, cleared site data), so every access is guarded
 * and the page works the same without it.
 */
const RECENT_KEY = 'docs:recent';
const FOLDED_KEY = 'docs:folded-groups';
const RECENT_MAX = 6;

function read(key, fallback) {
    try {
        const raw = window.localStorage.getItem(key);
        const v = raw ? JSON.parse(raw) : fallback;
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : fallback;
    } catch { return fallback; }
}

function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked — fine */ }
}

export function readRecent() { return read(RECENT_KEY, []); }

/** Move `pageId` to the front of the recent list; returns the new list. */
export function pushRecent(pageId) {
    const next = [pageId, ...readRecent().filter(id => id !== pageId)].slice(0, RECENT_MAX);
    write(RECENT_KEY, next);
    return next;
}

export function readFolded() { return read(FOLDED_KEY, []); }

export function writeFolded(titles) { write(FOLDED_KEY, titles); }
