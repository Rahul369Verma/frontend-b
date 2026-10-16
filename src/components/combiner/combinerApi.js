// Signal combiner endpoints (backend/controllers/combinerController.js) and the small pure
// helpers the combiner UI shares. Design: backend/docs/STRATEGY_COMBINER_ARCHITECTURE.md.
import axios from 'axios';
import { API_URL } from '../../config/api.js';

export const getCombinerMembers = () => axios.get(`${API_URL}/combiner/members`).then(r => r.data);
export const resolveCombinerMembers = (body) => axios.post(`${API_URL}/combiner/resolve`, body).then(r => r.data);
export const getCombinerCandidates = (jobId, perStrategy = 1) =>
    axios.get(`${API_URL}/combiner/candidates`, { params: { jobId, perStrategy } }).then(r => r.data);
export const getDeployments = () => axios.get(`${API_URL}/deployments`).then(r => r.data);
export const getOptimizerJobs = () => axios.get(`${API_URL}/engine/optimizer/jobs`, { params: { limit: 30 } }).then(r => r.data);

/** The `members` param in any of its forms (array, JSON string, comma ids) → member refs. */
export function parseMembers(raw) {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) return raw.map(m => (typeof m === 'string' ? { strategy: m } : m));
    const s = String(raw).trim();
    if (s.startsWith('[')) {
        try { return JSON.parse(s).map(m => (typeof m === 'string' ? { strategy: m } : m)); } catch { return []; }
    }
    return s.split(',').map(x => x.trim()).filter(Boolean).map(strategy => ({ strategy }));
}

/** A member's source in words. */
export function sourceLabel(src) {
    if (!src || !src.kind || src.kind === 'defaults') return 'code defaults';
    if (src.kind === 'preset') return `preset ${src.ref}`;
    if (src.kind === 'deployment') return `deployment ${src.name || src.ref}`;
    if (src.kind === 'optimizer') {
        const r = src.ref || {};
        return `optimizer ${String(r.jobId || '').slice(0, 8)} · ${String(r.symbol || '').replace(/^.*:/, '').replace('-INDEX', '')} · draw ${r.drawId}`;
    }
    if (src.kind === 'custom') return 'custom params';
    return src.kind;
}

/** Every member signal lands in exactly one bucket; the report proves it per member. */
export function bucketsAddUp(m) {
    const expired = Object.values(m.expired || {}).reduce((a, b) => a + b, 0);
    return m.used + m.cleared + m.replaced + expired + m.openAtEnd === m.fired;
}

/** Reason codes → words for the accounting tables. */
export const BLOCK_WORDS = {
    NOT_ASKED: 'not asked (in a trade / outside the window / daily cap)',
    NO_QUORUM: 'too few members agreed',
    SPLIT: 'members split on direction',
    STALE: 'no fresh vote on the bar',
    BELOW_THRESHOLD: 'weight below threshold',
    NO_PRIMARY: 'primary did not fire',
    NO_CONFIRM: 'not confirmed',
    VETOED: 'vetoed',
    COOLDOWN: 'combiner cooldown',
    MAX_PER_DAY: 'combiner daily cap',
    LUNCH: 'lunch window',
    FILTER_15M: '15m trend against',
    FILTER_1H: '60m trend against',
    LOW_VOLUME: 'low volume',
    NO_SL: 'no voter stop',
    SL_WRONG_SIDE: 'stop on wrong side',
    RISK_BOUNDS: 'risk outside ATR bounds',
    NO_VOTES: 'no member signal',
    ENTER: 'entered',
};
