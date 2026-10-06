import { describe, it, expect } from 'vitest';
import { newestExitIso, mergeTradesById } from './tradeMerge.js';

const t = (id, exitAt, extra = {}) => ({ _id: id, exitAt, netPnl: 100, ...extra });

describe('newestExitIso', () => {
    it('picks the latest exitAt', () => {
        expect(newestExitIso([t('a', '2026-10-06T09:00:00Z'), t('b', '2026-10-06T10:00:00Z')])).toBe('2026-10-06T10:00:00.000Z');
    });
    it('null when no row has an exit', () => {
        expect(newestExitIso([])).toBeNull();
        expect(newestExitIso([{ _id: 'x' }])).toBeNull();
    });
});

describe('mergeTradesById', () => {
    const prev = [t('b', '2026-10-06T10:00:00Z'), t('a', '2026-10-06T09:00:00Z')];

    it('returns prev (same identity) when the delta only repeats known rows', () => {
        expect(mergeTradesById(prev, [t('b', '2026-10-06T10:00:00Z')])).toBe(prev);
        expect(mergeTradesById(prev, [])).toBe(prev);
    });

    it('adds a new exit, newest first', () => {
        const out = mergeTradesById(prev, [t('c', '2026-10-06T11:00:00Z')]);
        expect(out.map(r => r._id)).toEqual(['c', 'b', 'a']);
    });

    it('replaces a row that was quarantined after we loaded it', () => {
        const out = mergeTradesById(prev, [t('a', '2026-10-06T09:00:00Z', { quarantined: true, quarantineReason: 'phantom fill' })]);
        expect(out).not.toBe(prev);
        expect(out.find(r => r._id === 'a').quarantined).toBe(true);
        expect(out).toHaveLength(2);
    });

    it('an old backend that ignores ?after and resends recent rows does not change state', () => {
        expect(mergeTradesById(prev, prev.map(r => ({ ...r })))).toBe(prev);
    });
});
