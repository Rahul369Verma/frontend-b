'use strict';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api.js';
import { pollInterval } from './usePolling.js';
import keepIfSame from '../utils/keepIfSame.js';

/**
 * useNotificationSummary — what the bell and the Dashboard strip show.
 *
 * ONE poll for the whole app (every 30 s, paused in hidden tabs), shared by every
 * component that asks, so the bell and the strip never disagree and never double
 * the requests. `refreshNotifications()` re-reads at once (after Acknowledge).
 */
let _state = { summary: null, error: null };
const _subs = new Set();
let _stop = null;

async function read() {
    try {
        const r = await axios.get(`${API_URL}/notifications/summary`);
        const summary = keepIfSame(_state.summary, r.data);
        // unchanged summary → the SAME state object, so no subscriber re-renders
        if (summary === _state.summary && _state.error == null) return;
        _state = { summary, error: null };
    } catch (e) {
        _state = { ..._state, error: e?.response?.data?.error || e.message };
    }
    for (const s of _subs) s(_state);
}

export function refreshNotifications() { return read(); }

export default function useNotificationSummary(pollMs = 30000) {
    const [st, setSt] = useState(_state);
    useEffect(() => {
        _subs.add(setSt);
        if (!_stop) { read(); _stop = pollInterval(read, pollMs); }
        return () => {
            _subs.delete(setSt);
            if (!_subs.size && _stop) { _stop(); _stop = null; }
        };
    }, [pollMs]);
    return st;
}
