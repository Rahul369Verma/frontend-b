/**
 * Go-live constants and pure helpers (no components here, so fast refresh keeps
 * working in the files that render them).
 */
import { API_URL } from '../../config/api.js';

export const GOLIVE = `${API_URL}/golive`;
export const errText = (e) => e?.response?.data?.error || e?.message || 'request failed';
/** Must match OVERRIDE_PHRASE in backend/src/domain/golive/gates.js. */
export const OVERRIDE_PHRASE = 'I ACCEPT REAL LOSSES';

/** A gate's badge level and word. 'unknown' on a hard gate is a failure. */
export function gateBadge(g) {
    if (g.status === 'pass') return { level: 'good', text: 'pass' };
    if (g.status === 'fail' || (g.level === 'hard' && g.status === 'unknown')) return { level: 'critical', text: g.status === 'unknown' ? 'unproven' : 'fail' };
    if (g.status === 'warn') return { level: 'warning', text: 'warn' };
    return { level: 'info', text: 'unknown' };
}

/** Is this 409 the backend's "LIVE only through the go-live gate" refusal? */
export const isLiveRefusal = (e) => e?.response?.status === 409 && e?.response?.data?.goLive === '/go-live';
