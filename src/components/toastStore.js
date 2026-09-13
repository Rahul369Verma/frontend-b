'use strict';
/**
 * toastStore — the imperative notification API, separated from the component.
 *
 * Split out because this file exports a plain object, not a component, and the
 * react-refresh rule (rightly) rejects mixing the two: a fast-refresh of a file
 * that also holds module state would reset that state mid-session. Same reason
 * `confirmContext.js` sits beside `ConfirmDialog.jsx`.
 *
 * See Toast.jsx for why the API is imperative rather than a hook.
 */
let _seq = 0;
const _listeners = new Set();
let _toasts = [];

function emit() { for (const l of _listeners) l(_toasts); }

/** Longer for errors: a failure message you cannot re-read is a failure twice. */
const DEFAULT_MS = { error: 9000, warning: 7000, success: 4000, info: 5000 };

function push(level, message, opts = {}) {
    const text = message instanceof Error ? message.message : String(message ?? '');
    if (!text.trim()) return null;
    const id = ++_seq;
    // Collapse an identical message that is already on screen instead of
    // stacking duplicates — a retry loop should not bury the rest of the UI.
    const dupe = _toasts.find(t => t.text === text && t.level === level);
    if (dupe) {
        _toasts = _toasts.map(t => (t.id === dupe.id ? { ...t, count: (t.count || 1) + 1, at: Date.now() } : t));
        emit();
        return dupe.id;
    }
    _toasts = [..._toasts, { id, level, text, at: Date.now(), ms: opts.ms ?? DEFAULT_MS[level] ?? 5000, title: opts.title || null }];
    // Hard cap: a burst of failures must not fill the viewport.
    if (_toasts.length > 5) _toasts = _toasts.slice(-5);
    emit();
    return id;
}

export function dismiss(id) { _toasts = _toasts.filter(t => t.id !== id); emit(); }

export const toast = {
    error: (m, o) => push('error', m, o),
    warning: (m, o) => push('warning', m, o),
    success: (m, o) => push('success', m, o),
    info: (m, o) => push('info', m, o),
    dismiss,
    clear: () => { _toasts = []; emit(); },
};


export const subscribe = (fn) => { _listeners.add(fn); return () => { _listeners.delete(fn); }; };
export const snapshot = () => _toasts;
export const DEFAULTS = DEFAULT_MS;
