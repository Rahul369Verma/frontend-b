'use strict';
import { useEffect, useState } from 'react';

/**
 * useLocalStorage — remember a piece of UI state across reloads.
 *
 * ONE implementation. Four copies of this try/catch used to live in
 * MultiLeg.jsx, App.jsx, DeploymentsPanel.jsx and CollapsibleCard.jsx, each
 * with its own idea of what happens when storage is unavailable (private mode,
 * quota, a browser set to block site data). The answer is always the same: fall
 * back to `initial`, never throw, never leave the page blank.
 *
 * `validate(parsed) → boolean` lets a caller reject a stale value — a tab id
 * that no longer exists, a filter enum that was renamed — so a remembered
 * choice can never point at nothing.
 */
export default function useLocalStorage(key, initial, { validate } = {}) {
    const [value, setValue] = useState(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return initial;
            const parsed = JSON.parse(raw);
            return validate && !validate(parsed) ? initial : parsed;
        } catch { return initial; }
    });
    useEffect(() => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode — the in-memory value still works */ }
    }, [key, value]);
    return [value, setValue];
}
