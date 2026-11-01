import { describe, it, expect } from 'vitest';
import { applyMarks, applyBook, applyPoll, stateChanged } from './liveMerge.js';

const dep = (id, state, at, mtm = 1) => ({ _id: id, name: id, position: { state, lastMtm: mtm, lastMtmRupees: mtm * 65, lastMtmNetRupees: mtm * 65 - 100, lastMtmAt: at } });
const mark = (id, at, mtm) => ({ id, at, mtm, grossRupees: mtm * 65, chargesEst: 100, netRupees: mtm * 65 - 100, spot: 22510, ltps: { A: 50 }, src: 'tape' });

describe('Multi-Leg live stream merge', () => {
    it('a mark updates an OPEN structure only when it is newer than the one shown', () => {
        const list = [dep('a', 'OPEN', '2026-11-02T05:30:00.000Z'), dep('b', 'IDLE', null)];
        const next = applyMarks(list, [mark('a', '2026-11-02T05:30:03.000Z', 4), mark('b', '2026-11-02T05:30:03.000Z', 9)]);
        expect(next[0].position).toMatchObject({ lastMtm: 4, lastMtmRupees: 260, lastMtmNetRupees: 160, lastSpot: 22510, lastMtmAt: '2026-11-02T05:30:03.000Z', liveLtps: { A: 50 }, markSrc: 'tape' });
        expect(next[1]).toBe(list[1]);
        expect(applyMarks(next, [mark('a', '2026-11-02T05:30:02.000Z', 7)])).toBe(next);   // older: ignored, no re-render
    });

    it('a book or a poll replaces the deployment but never pulls a fresher streamed mark back to the loop\'s older one', () => {
        const shown = [dep('a', 'OPEN', '2026-11-02T05:30:09.000Z', 6)];
        const book = { ...dep('a', 'OPEN', '2026-11-02T05:30:00.000Z', 2), totals: { trades: 3 } };
        const after = applyBook(shown, [book]);
        expect(after[0].totals).toEqual({ trades: 3 });
        expect(after[0].position.lastMtm).toBe(6);
        // the structure closed: the book wins whole
        const closed = applyBook(shown, [dep('a', 'IDLE', '2026-11-02T05:30:00.000Z', 2)]);
        expect(closed[0].position).toMatchObject({ state: 'IDLE', lastMtm: 2 });
        // a new deployment is added; a poll drops one that is gone
        expect(applyBook(shown, [dep('b', 'IDLE', null)]).map((d) => d._id)).toEqual(['a', 'b']);
        expect(applyPoll([...shown, dep('gone', 'IDLE', null)], [book]).map((d) => [d._id, d.position.lastMtm])).toEqual([['a', 6]]);
    });

    it('a mark belongs to one structure: never carried onto the next structure the same deployment opened', () => {
        const shown = [{ ...dep('a', 'OPEN', '2026-11-02T05:30:09.000Z', 6), position: { ...dep('a', 'OPEN', '2026-11-02T05:30:09.000Z', 6).position, entryAt: '2026-11-02T04:00:00.000Z' } }];
        const reentered = { ...dep('a', 'OPEN', null, 0), position: { ...dep('a', 'OPEN', null, 0).position, entryAt: '2026-11-02T05:30:08.000Z' } };
        expect(applyBook(shown, [reentered])[0].position).toMatchObject({ entryAt: '2026-11-02T05:30:08.000Z', lastMtm: 0 });
        expect(applyMarks(shown, [{ ...mark('a', '2026-11-02T05:30:10.000Z', 3), entryAt: '2026-11-02T05:30:08.000Z' }])).toBe(shown);
        expect(applyMarks(shown, [{ ...mark('a', '2026-11-02T05:30:10.000Z', 3), entryAt: '2026-11-02T04:00:00.000Z' }])[0].position.lastMtm).toBe(3);
    });

    it('says when a structure opened or closed (the trades table and the day story refresh then)', () => {
        const before = [dep('a', 'OPEN', null), dep('b', 'IDLE', null)];
        expect(stateChanged(before, [dep('a', 'OPEN', null)])).toBe(false);
        expect(stateChanged(before, [dep('a', 'IDLE', null)])).toBe(true);
        expect(stateChanged(before, [dep('new', 'OPEN', null)])).toBe(false);
    });
});
