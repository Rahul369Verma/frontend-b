import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey.js';
import { ConfirmContext } from './confirmContext.js';

/**
 * A themed, accessible replacement for `window.confirm`.
 *
 * WHY. The app called `window.confirm` in 18 places, including before firing a
 * market exit and before "KILL ALL". Native dialogs block the JS thread, cannot
 * be styled, ignore the theme entirely (a stark white OS box in the middle of a
 * dark trading UI), and give no way to distinguish "close this position" from
 * "delete this file" — every one of them looks identical and equally routine.
 *
 * THE API IS PROMISE-BASED ON PURPOSE. `window.confirm` is synchronous, so every
 * call site reads `if (window.confirm(msg)) { ... }`. A modal cannot be
 * synchronous, but a promise keeps that exact shape:
 *
 *     const confirm = useConfirm();
 *     if (!await confirm('Close this position?')) return;
 *
 * so converting a call site is one `await`, not a restructure into callbacks.
 *
 * Accepts a plain string (like window.confirm) or an options object:
 *   { title, body, confirmLabel, cancelLabel, danger, requireText }
 * `danger` styles destructive actions differently — which is the point: the
 * native dialog could not tell you that closing a position is not the same kind
 * of action as collapsing a card.
 */
export function ConfirmProvider({ children }) {
    const [state, setState] = useState(null);   // { opts, resolve }
    const [typed, setTyped] = useState('');
    const resolveRef = useRef(null);

    const confirm = useCallback((optsOrMessage) => {
        const opts = typeof optsOrMessage === 'string' ? { body: optsOrMessage } : (optsOrMessage || {});
        setTyped('');
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setState({ opts });
        });
    }, []);

    const settle = useCallback((value) => {
        setState(null);
        const r = resolveRef.current;
        resolveRef.current = null;
        r?.(value);
    }, []);

    // Escape cancels — same as dismissing a native dialog.
    useEscapeKey(() => settle(false), Boolean(state));

    const value = useMemo(() => confirm, [confirm]);

    const opts = state?.opts || {};
    const danger = Boolean(opts.danger);
    const needsText = Boolean(opts.requireText);
    const ok = !needsText || typed.trim() === opts.requireText;

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            {state && (
                <div
                    className="fixed inset-0 z-[2147483001] flex items-center justify-center bg-black/60 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="confirm-title"
                    onClick={() => settle(false)}
                >
                    <div
                        className={`w-full max-w-md rounded-xl border p-4 bg-card ${danger ? 'border-danger' : 'border-line-2'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div id="confirm-title" className={`text-sm font-bold mb-2 flex items-center gap-2 ${danger ? 'text-danger' : 'text-fg'}`}>
                            {danger && <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
                            {opts.title || (danger ? 'Confirm this action' : 'Are you sure?')}
                        </div>

                        {opts.body && (
                            <div className="text-xs text-fg-3 space-y-2 mb-3 whitespace-pre-wrap">{opts.body}</div>
                        )}

                        {needsText && (
                            <label className="block text-2xs text-fg-4 mb-3">
                                Type <span className="font-mono text-fg-2">{opts.requireText}</span> to confirm
                                <input
                                    autoFocus
                                    value={typed}
                                    onChange={(e) => setTyped(e.target.value)}
                                    className="w-full mt-1 bg-bg-2 border border-line rounded p-1.5 text-fg-2 font-mono text-xs"
                                />
                            </label>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => settle(false)}
                                className="px-3 py-1.5 rounded border border-line-2 bg-card-2 text-fg-3 text-xs hover:text-fg"
                            >
                                {opts.cancelLabel || 'Cancel'}
                            </button>
                            <button
                                type="button"
                                autoFocus={!needsText}
                                onClick={() => ok && settle(true)}
                                disabled={!ok}
                                className={`px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 ${danger ? 'bg-danger text-on-primary' : 'btn-primary'}`}
                            >
                                {opts.confirmLabel || 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}

export default ConfirmProvider;
