'use strict';
/**
 * Toast — non-blocking notifications, replacing 56 native `alert()` calls.
 *
 * ── WHY alert() HAD TO GO ───────────────────────────────────────────────────
 * `alert()` freezes the entire page until it is dismissed, cannot be styled, is
 * invisible to all twelve themes and every accessibility axis, stacks
 * unreadably when two fire at once, and — on a trading dashboard — will happily
 * block a live feed from rendering while it waits for a click. It is also the
 * only widget in this app a user cannot copy text out of.
 *
 * ── IMPERATIVE ON PURPOSE ───────────────────────────────────────────────────
 * The API is a module singleton (`toast.error(msg)`), NOT a hook. That is a
 * deliberate trade: a hook would have to be called at the top of every
 * component, which means 56 call sites each needing a new hook line, several of
 * them inside plain callbacks and async helpers where hooks are illegal. A
 * singleton makes the replacement a one-for-one swap with no restructuring —
 * and swapping `alert(x)` for `toast.error(x)` is a change anyone can review.
 *
 * Announced to screen readers via a polite live region, so a notification is not
 * something only sighted users receive.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { subscribe, snapshot, dismiss } from './toastStore.js';

const STYLE = {
    error: { icon: XCircle, cls: 'border-danger/50 bg-danger/10 text-danger' },
    warning: { icon: AlertTriangle, cls: 'border-warning/50 bg-warning/10 text-warning' },
    success: { icon: CheckCircle2, cls: 'border-success/50 bg-success/10 text-success' },
    info: { icon: Info, cls: 'border-line-2 bg-card text-fg-2' },
};

function Toast({ t, onClose }) {
    const { icon: Icon, cls } = STYLE[t.level] || STYLE.info;
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        if (paused || !t.ms) return undefined;
        const left = Math.max(500, t.ms - (Date.now() - t.at));
        const id = setTimeout(onClose, left);
        return () => clearTimeout(id);
        // `t.at` moves when a duplicate arrives, which correctly restarts the clock.
    }, [paused, t.ms, t.at, onClose]);

    return (
        <div
            className={`pointer-events-auto w-full rounded-lg border p-2.5 shadow-lg backdrop-blur-sm ${cls}`}
            // Hovering pauses dismissal — you cannot read a long error that is
            // counting down while you reach for it.
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
        >
            <div className="flex items-start gap-2">
                <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    {t.title && <div className="text-2xs font-semibold">{t.title}</div>}
                    {/* selectable + wrapping: an error you cannot copy is hard to act on */}
                    <div className="text-2xs whitespace-pre-wrap break-words select-text">{t.text}</div>
                </div>
                {t.count > 1 && <span className="text-3xs opacity-70 tabular-nums shrink-0">×{t.count}</span>}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Dismiss notification"
                    className="shrink-0 opacity-60 hover:opacity-100 rounded"
                >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

/** Mount ONCE, near the root. */
export default function Toaster() {
    const [items, setItems] = useState(snapshot);
    useEffect(() => subscribe(setItems), []);
    const close = useCallback((id) => dismiss(id), []);

    return (
        <div
            // Below the confirm dialog's z-index so a modal is never obscured by
            // a notification about the thing the modal is asking about.
            className="fixed top-3 right-3 z-[2147483000] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 pointer-events-none"
            role="region"
            aria-label="Notifications"
        >
            {/* polite, not assertive: these must not interrupt a screen reader mid-sentence */}
            <div aria-live="polite" aria-atomic="false" className="sr-only">
                {items.map(t => <div key={t.id}>{t.level}: {t.text}</div>)}
            </div>
            {items.map(t => <Toast key={t.id} t={t} onClose={() => close(t.id)} />)}
        </div>
    );
}
