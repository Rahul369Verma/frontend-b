import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import EngineJournal from './EngineJournal.jsx';
import { buildQuery, mergeHead, journalReducer, JOURNAL_EMPTY } from './journalQuery.js';

vi.mock('axios');

const ev = (i, over = {}) => ({ _id: `id${String(i).padStart(4, '0')}`, at: new Date(Date.UTC(2026, 9, 6, 7, 50, 0) - i * 17000).toISOString(), deploymentId: 'sx', name: 'zone-strangle-sensex (PAPER)', type: i % 2 ? 'ZONE' : 'ENTRY_SKIPPED', message: `row ${i}`, ...over });
const SUMMARY = {
    since: '2026-10-05T18:30:00.000Z', total: 1904,
    byDeployment: [{ deploymentId: 'sx', name: 'zone-strangle-sensex (PAPER)', n: 1716 }, { deploymentId: 'bs', name: 'october-Put Ratio Backspread - NIFTY50 - volume_surge (PAPER)', n: 2 }],
    byType: [{ type: 'ENTRY_SKIPPED', n: 900 }, { type: 'ZONE', n: 858 }],
};
const DEPS = [{ _id: 'sx', name: 'zone-strangle-sensex (PAPER)' }, { _id: 'bs', name: 'october-Put Ratio Backspread - NIFTY50 - volume_surge (PAPER)' }, { _id: 'quiet', name: 'quiet-dep (PAPER)' }];

function route(handler) {
    axios.get.mockImplementation((url) => {
        if (url.includes('/multileg/events/summary')) return Promise.resolve({ data: SUMMARY });
        const qs = new URLSearchParams(url.split('?')[1]);
        return Promise.resolve({ data: handler(qs) });
    });
}

describe('EngineJournal', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('pages OLDER rows with the cursor and says how many of how many are shown', async () => {
        const all = Array.from({ length: 120 }, (_, i) => ev(i));
        route((qs) => {
            const start = qs.get('beforeId') ? all.findIndex(e => e._id === qs.get('beforeId')) + 1 : 0;
            const pageRows = all.slice(start, start + 50);
            const more = start + 50 < all.length;
            return { events: pageRows, hasMore: more, next: more ? { before: pageRows.at(-1).at, beforeId: pageRows.at(-1)._id } : null, ...(qs.get('beforeId') ? {} : { total: 120 }) };
        });
        render(<EngineJournal deployments={DEPS} />);
        expect(await screen.findByText('row 0')).toBeInTheDocument();
        expect(screen.getByText(/50 of 120 shown/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load 50 older' }));
        expect(await screen.findByText('row 99')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load 50 older' }));
        expect(await screen.findByText('row 119')).toBeInTheDocument();
        expect(screen.getByText(/Start of the journal — all 120 shown/)).toBeInTheDocument();
        const older = axios.get.mock.calls.map(c => c[0]).filter(u => u.includes('beforeId='));
        expect(older[0]).toContain(`beforeId=${all[49]._id}`);
    });

    it('lists EVERY deployment in the filter — today\'s writers with counts, and ones with no rows today', async () => {
        route(() => ({ events: [ev(0)], hasMore: false, next: null, total: 1 }));
        render(<EngineJournal deployments={DEPS} />);
        const select = await screen.findByLabelText('Deployment');
        await waitFor(() => expect(within(select).getByText(/zone-strangle-sensex \(PAPER\) — 1,716 today/)).toBeInTheDocument());
        expect(within(select).getByText(/quiet-dep \(PAPER\) — 0 today/)).toBeInTheDocument();
        fireEvent.change(select, { target: { value: 'bs' } });
        await waitFor(() => expect(axios.get.mock.calls.some(c => c[0].includes('deploymentId=bs'))).toBe(true));
    });

    it('names a flooding deployment as a share of the day instead of letting it bury the rest', async () => {
        route(() => ({ events: [ev(0)], hasMore: false, next: null, total: 1 }));
        render(<EngineJournal deployments={DEPS} />);
        expect(await screen.findByText(/zone-strangle-sensex \(PAPER\) wrote 90% of today's rows \(1,716 of 1,904\)/)).toBeInTheDocument();
    });

    it('shows repeats that are being collapsed RIGHT NOW (not yet booked)', async () => {
        route(() => ({ events: [ev(0)], hasMore: false, next: null, total: 1 }));
        render(<EngineJournal deployments={DEPS} repeats={{ sx: [{ type: 'ZONE', n: 37, since: '2026-10-06T07:35:00.000Z' }, { type: 'ENTRY_SKIPPED', n: 37, since: '2026-10-06T07:35:00.000Z' }] }} />);
        expect(await screen.findByText(/ZONE ×37 since 13:05, ENTRY_SKIPPED ×37 since 13:05/)).toBeInTheDocument();
    });

    it('focus from the parent filters to that deployment', async () => {
        route(() => ({ events: [ev(0)], hasMore: false, next: null, total: 1 }));
        const { rerender } = render(<EngineJournal deployments={DEPS} focus={null} />);
        await screen.findByText('row 0');
        rerender(<EngineJournal deployments={DEPS} focus={{ id: 'bs', n: 1 }} />);
        await waitFor(() => expect(axios.get.mock.calls.some(c => c[0].includes('deploymentId=bs'))).toBe(true));
        expect(screen.getByLabelText('Deployment')).toHaveValue('bs');
    });
});

describe('journal helpers', () => {
    it('buildQuery carries filters and the (before, beforeId) cursor', () => {
        const q = new URLSearchParams(buildQuery({ deploymentId: 'd1', type: 'ZONE', q: 'no quote' }, { before: '2026-10-06T07:00:00.000Z', beforeId: 'abc' }));
        expect(Object.fromEntries(q)).toEqual({ limit: '50', deploymentId: 'd1', types: 'ZONE', q: 'no quote', before: '2026-10-06T07:00:00.000Z', beforeId: 'abc' });
    });
    it('mergeHead prepends new rows and keeps loaded older pages', () => {
        const prev = [ev(1), ev(2), ev(3)];
        const m = mergeHead(prev, { events: [ev(0), ev(1)], hasMore: true });
        expect(m.rows.map(r => r._id)).toEqual(['id0000', 'id0001', 'id0002', 'id0003']);
        expect(m.reset).toBe(false);
    });
    it('mergeHead REPLACES (never leaves a silent gap) when more arrived than one page holds', () => {
        const m = mergeHead([ev(100)], { events: [ev(0), ev(1)], hasMore: true });
        expect(m.reset).toBe(true);
        expect(m.rows.map(r => r._id)).toEqual(['id0000', 'id0001']);
    });
});

describe('journalReducer', () => {
    it('a poll keeps the OLDER-page cursor when it only prepends; replaces it when the head jumped', () => {
        let s = journalReducer(JOURNAL_EMPTY, { type: 'head', reset: true, head: { events: [ev(0), ev(1)], next: { before: 'a', beforeId: 'id0001' }, hasMore: true, total: 9 } });
        s = journalReducer(s, { type: 'older', page: { events: [ev(2), ev(3)], next: { before: 'b', beforeId: 'id0003' } } });
        const polled = journalReducer(s, { type: 'head', head: { events: [ev(-1), ev(0)], next: { before: 'x', beforeId: 'id000-' }, hasMore: true, total: 10 } });
        expect(polled.rows.map(r => r._id)).toEqual(['id00-1', 'id0000', 'id0001', 'id0002', 'id0003']);
        expect(polled.next.beforeId).toBe('id0003');
        expect(polled.total).toBe(10);
        const jumped = journalReducer(s, { type: 'head', head: { events: [ev(-9), ev(-8)], next: { before: 'y', beforeId: 'id00-8' }, hasMore: true } });
        expect(jumped.next.beforeId).toBe('id00-8');
        expect(jumped.rows).toHaveLength(2);
    });
    it('an unchanged poll returns the same state object (no re-render)', () => {
        const s = journalReducer(JOURNAL_EMPTY, { type: 'head', reset: true, head: { events: [ev(0)], hasMore: false, total: 1 } });
        expect(journalReducer(s, { type: 'head', head: { events: [ev(0)], hasMore: false, total: 1 } })).toBe(s);
    });
});

describe('EngineJournal — review fixes', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('an older page requested from a cursor a poll has replaced is DROPPED (no silent gap)', () => {
        const s0 = journalReducer(JOURNAL_EMPTY, { type: 'head', reset: true, head: { events: [ev(0)], next: { before: 'a', beforeId: 'id0000' }, hasMore: true } });
        const jumped = journalReducer(s0, { type: 'head', head: { events: [ev(-9)], next: { before: 'z', beforeId: 'id00-9' }, hasMore: true } });
        const late = journalReducer(jumped, { type: 'older', cursor: { before: 'a', beforeId: 'id0000' }, page: { events: [ev(1)], next: null } });
        expect(late).toBe(jumped);
    });

    it('a superseded request never clears loading or claims "No events match" for the new filter', async () => {
        const pending = [];
        axios.get.mockImplementation((url) => {
            if (url.includes('/summary')) return Promise.resolve({ data: SUMMARY });
            return new Promise((resolve) => pending.push({ url, resolve }));
        });
        render(<EngineJournal deployments={DEPS} />);
        await waitFor(() => expect(pending.length).toBe(1));
        fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'ZONE' } });
        await waitFor(() => expect(pending.length).toBe(2));
        pending[0].resolve({ data: { events: [], hasMore: false, next: null, total: 0 } });   // the OLD filter answers first
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByText('No events match these filters.')).toBeNull();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
        pending[1].resolve({ data: { events: [ev(1)], hasMore: false, next: null, total: 1 } });
        expect(await screen.findByText('row 1')).toBeInTheDocument();
    });

    it('remounting with an OLD focus neither scrolls nor filters; a NEW focus does both', async () => {
        route(() => ({ events: [ev(0)], hasMore: false, next: null, total: 1 }));
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        const old = { id: 'bs', n: 1 };
        const { rerender } = render(<EngineJournal deployments={DEPS} focus={old} />);
        await screen.findByText('row 0');
        expect(scroll).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Deployment')).toHaveValue('');
        rerender(<EngineJournal deployments={DEPS} focus={{ id: 'bs', n: 2 }} />);
        await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
        expect(screen.getByLabelText('Deployment')).toHaveValue('bs');
    });

    it('filtering to a DELETED deployment (clicked from an old row) keeps it selected and labelled', async () => {
        route(() => ({ events: [ev(0, { deploymentId: 'gone', name: 'old-dep (PAPER)' })], hasMore: false, next: null, total: 1 }));
        render(<EngineJournal deployments={DEPS} />);
        fireEvent.click(await screen.findByRole('button', { name: '[old-dep (PAPER)]' }));
        await waitFor(() => expect(screen.getByLabelText('Deployment')).toHaveValue('gone'));
        expect(within(screen.getByLabelText('Deployment')).getByText(/old-dep \(PAPER\) \(deleted\)/)).toBeInTheDocument();
    });
});
