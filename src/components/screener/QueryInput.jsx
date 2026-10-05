/**
 * The screener query box, with suggestions while typing: field names (and the
 * words other screeners use for them), keywords and functions.
 *
 * Keys while the list is open: ↑/↓ choose, Enter or Tab insert, Esc closes.
 * Anything else — Ctrl/⌘+Enter to run, typing — goes through untouched.
 */
import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { suggest, applySuggestion } from './querySuggest.js';

const KIND_LABEL = { field: 'field', keyword: 'keyword', function: 'function' };

export default function QueryInput({ value, onChange, fields, onKeyDown, inputRef, invalid = false, placeholder, className = '', rows = 3, ariaLabel = 'Screener query', id }) {
    const localRef = useRef(null);
    const ref = inputRef || localRef;
    const listId = useId();
    const [caret, setCaret] = useState(null);             // null = not focused: no list
    const [sel, setSel] = useState({ key: '', i: 0 });     // highlighted row, for this text + caret only
    const [dismissed, setDismissed] = useState('');        // Esc: closed until the text or caret moves
    const pendingCaret = useRef(null);
    const key = `${value}\u0000${caret}`;
    const s = useMemo(() => (caret == null ? null : suggest(value || '', caret, fields || [])), [value, caret, fields]);
    const open = !!(s && s.items.length) && dismissed !== key;
    const active = open ? Math.min(sel.key === key ? sel.i : 0, s.items.length - 1) : -1;

    // After inserting a suggestion the parent re-renders with the new text; put the caret after it.
    useLayoutEffect(() => {
        const el = ref.current;
        if (el && pendingCaret.current != null) {
            el.setSelectionRange(pendingCaret.current, pendingCaret.current);
            pendingCaret.current = null;
        }
    }, [value, ref]);

    const track = (e) => { const t = e.target; setCaret(t.selectionStart === t.selectionEnd ? t.selectionStart : null); };
    const accept = (i) => {
        const item = s.items[i];
        if (!item) return;
        const r = applySuggestion(value || '', s, item);
        pendingCaret.current = r.caret;
        setCaret(r.caret);
        onChange(r.text);
    };
    const keyDown = (e) => {
        if (open && !e.altKey && !e.metaKey && !e.ctrlKey) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = s.items.length;
                setSel({ key, i: (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
                return;
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); accept(active); return; }
            if (e.key === 'Escape') { e.preventDefault(); setDismissed(key); return; }
        }
        if (onKeyDown) onKeyDown(e);
    };

    return (
        <div className="relative">
            <textarea id={id} ref={ref} value={value} rows={rows} spellCheck={false} placeholder={placeholder}
                aria-label={ariaLabel} aria-invalid={invalid} aria-autocomplete="list" aria-controls={listId}
                aria-activedescendant={open ? `${listId}-${active}` : undefined}
                onChange={(e) => { onChange(e.target.value); track(e); }}
                onSelect={track} onFocus={track} onBlur={() => setCaret(null)}
                onKeyDown={keyDown}
                className={className} />
            <ul id={listId} role="listbox" aria-label="Suggestions"
                className={open ? 'absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-auto rounded border border-line bg-card shadow-lg py-1' : 'hidden'}>
                {open && s.items.map((it, i) => (
                    <li key={`${it.kind}:${it.label}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} tabIndex={-1}
                        onMouseDown={(e) => { e.preventDefault(); accept(i); }}
                        onMouseEnter={() => setSel({ key, i })}
                        className={`flex items-baseline gap-2 px-2.5 py-1 cursor-pointer ${i === active ? 'bg-primary/15' : ''}`}>
                        <span className="font-mono text-2xs text-primary-ink shrink-0">{it.label}</span>
                        <span className="text-3xs text-fg-5 truncate">{it.kind === 'field' ? it.detail : `${KIND_LABEL[it.kind]} · ${it.detail}`}</span>
                    </li>
                ))}
            </ul>
            <div className="sr-only" aria-live="polite">{open ? `${s.items.length} suggestion${s.items.length === 1 ? '' : 's'}: up and down arrows to choose, Enter or Tab to insert, Escape to close` : ''}</div>
        </div>
    );
}
