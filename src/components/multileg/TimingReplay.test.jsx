/**
 * Entry and exit times, on these days (user, 19-Nov-2026: "find best entry and exit time"):
 *   • a saved grid shows at once: its own pair and the best named, the entry × square-off table with the
 *     best starred and its own ringed, a pair live refuses struck through, the entry times that could not
 *     enter counted, and per day own vs best;
 *   • a positional or signal deployment says why there is no grid;
 *   • "Backtest & update…" carries the pair to the builder as entry_time and square_off, checked.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { parseTry, tryParams, tryText, trySection } from './comboReplayFormat.js';
import { timingTryLink, heatStyle, noEntryLines, daysPricesLine, dayText } from './timingReplayFormat.js';

const AT = (day, hh, mm, ss = 0) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hh, mm, ss) - 5.5 * 3600e3).toISOString();
const cell = (entry, exit, net, worst, extra = {}) => ({ entry, exit, net, worst, n: 3, wins: 2, avg: Math.round(net / 3), targets: 1, stopped: 1, days: 3, noEntry: 0, refused: null, ...extra });
const OWN = cell('09:20', '15:10', 8000, -4000);
const BEST = cell('11:00', '15:10', 12000, -2500);
const SAFE = cell('11:00', '13:00', 3000, -500);
const REFUSED = cell('13:00', '14:00', 20000, -100, { refused: 'under 180 min from the entry to the square-off: the live engine refuses that entry' });
const side = (entry, exit, net, day, reason = 'SQUARE_OFF') => ({ entry, exit, enteredAt: AT(day, +entry.slice(0, 2), +entry.slice(3), 5), strikes: '25350 CE · 25350 PE', credit: 120, prices: 'tape', noEntry: null, net, reason, exitAt: AT(day, +exit.slice(0, 2), +exit.slice(3)), firstStop: null });
const RESULT = {
    deploymentId: 'd1', name: 'nifty-atm-straddle (LIVE)', applicable: true, template: 'short_straddle',
    current: { entry: '09:20', exit: '15:10' }, axes: { entries: ['09:20', '11:00', '13:00'], exits: ['13:00', '14:00', '15:10'] }, minHoldMin: 30, runwayMin: 180,
    trades: 3, days: 3, skipped: [], prices: { tape: 2, minutes: 1, tapeFrom: '2026-11-02' },
    rows: [REFUSED, BEST, OWN, SAFE],
    picks: { best: BEST, current: OWN, noRiskier: BEST, safest: SAFE },
    holdout: { ok: false, why: '3 trade(s): at least 10 are needed to keep the last 30% apart' },
    noEntry: { '11:00': { 'finder declined: no zone': 1 } },
    perTrade: [
        { id: 't18', entryAt: AT('2026-11-18', 9, 20, 3), day: '2026-11-18', prices: 'tape', booked: -4058, bookedReason: 'SQUARE_OFF', current: side('09:20', '15:10', -4214, '2026-11-18'), best: side('11:00', '15:10', 2100, '2026-11-18'), bestVsCurrent: 6314 },
        { id: 't17', entryAt: AT('2026-11-17', 9, 20, 3), day: '2026-11-17', prices: 'tape', booked: -7035, bookedReason: 'LEG_SL_FLATTEN', current: side('09:20', '15:10', -8683, '2026-11-17', 'LEG_SL_FLATTEN'), best: { ...side('11:00', '15:10', null, '2026-11-17'), noEntry: 'finder declined: no zone', net: null, reason: null }, bestVsCurrent: null },
    ],
    caveats: ['Every figure is in hindsight on these days.'],
};

let reply = { status: 'done', result: RESULT, saved: { computedAt: '2026-11-19T01:00:00Z', durationMs: 300000, version: 2, outdated: false, trades: 3, newTrades: 0, settingsChanged: false, limitChanged: false }, limit: 30, closedTrades: 3, beyondLimit: 0, quarantinedExcluded: 0 };
const calls = [];
vi.mock('axios', () => {
    const get = vi.fn((url, cfg) => { calls.push({ url, p: (cfg && cfg.params) || {} }); return Promise.resolve({ data: reply }); });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }) }));
import TimingGridPanel from './TimingReplay.jsx';

describe('a saved entry and exit time grid', () => {
    beforeEach(() => { calls.length = 0; });
    it('shows its own pair and the best, the table, the refusals and the days, computing nothing', async () => {
        render(<MemoryRouter><TimingGridPanel deploymentId="d1" /></MemoryRouter>);
        await screen.findByTestId('saved-replay');
        expect(calls.every((c) => /timing-grid$/.test(c.url) && c.p.peek === 1)).toBe(true);
        expect(screen.getByText(/2 of 3 days on the quote tape/)).toBeTruthy();
        // the headline: the best against its own, in hindsight
        expect(screen.getAllByText(/\+₹12,000/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/\+₹4,000/).length).toBeGreaterThan(0);
        // the table: the best starred, its own ringed, the refused pair struck through and never the best
        const table = screen.getByRole('table', { name: 'Net by entry time and square-off time' });
        const best = within(table).getByTitle(/^11:00 → 15:10/);
        expect(within(best).getByLabelText('best')).toBeTruthy();
        expect(within(table).getByTitle(/^09:20 → 15:10.*its own times/).className).toMatch(/ring-1/);
        const refused = within(table).getByTitle(/^13:00 → 14:00.*live engine refuses/);
        expect(refused.className).toMatch(/line-through/);
        expect(within(refused).queryByLabelText('best')).toBeNull();
        expect(screen.getByText(/under 180 min from entry to square-off/)).toBeTruthy();
        // the entry times that could not enter, counted
        expect(screen.getByText(/11:00 on 1 day \(finder declined: no zone\)/)).toBeTruthy();
        // a refused pair has no button; the best has one, carrying its times
        const link = screen.getAllByRole('link', { name: /Backtest and update with entry 11:00 and square-off 15:10/ })[0];
        expect(decodeURIComponent(link.getAttribute('href'))).toMatch(/"kind":"timing","timing":\{"entry":"11:00","exit":"15:10"\}/);
        expect(screen.getAllByText('live refuses').length).toBeGreaterThan(0);
        // per day: own vs best, and a day the best could not enter
        const days = screen.getByRole('table', { name: /Each day at its own entry and exit time/ });
        expect(within(days).getByText('-₹4,058')).toBeTruthy();
        expect(within(days).getByText(/no entry: finder declined: no zone/)).toBeTruthy();
        expect(within(days).getAllByText(/entered 09:20 · 25350 CE · 25350 PE/).length).toBe(2);
    });

    it('a positional or signal deployment says why there is no grid', async () => {
        reply = { status: 'done', result: { deploymentId: 'd2', name: 'fifth (PAPER)', applicable: false, why: 'it is a positional structure: a time of day never closes it', trades: 0, skipped: [], rows: [], perTrade: [], caveats: [] }, saved: null };
        render(<MemoryRouter><TimingGridPanel deploymentId="d2" /></MemoryRouter>);
        expect((await screen.findByTestId('timing-none')).textContent).toMatch(/No entry and exit time grid for fifth \(PAPER\): it is a positional structure/);
    });
});

describe('the words and the link', () => {
    it('a pair goes to the builder as entry_time and square_off, checked', () => {
        const href = timingTryLink('d1', RESULT, BEST, '★ Best net');
        const t = parseTry(new URLSearchParams(href.split('?')[1]).get('try'));
        expect(t).toMatchObject({ kind: 'timing', timing: { entry: '11:00', exit: '15:10' }, label: '★ Best net', from: '2026-11-17', source: 'archive' });
        expect(tryParams(t, { leg_sl_x: 1.5 })).toEqual({ entry_time: '11:00', square_off: '15:10' });
        expect(trySection(t)).toBe('Entry and exit times');
        expect(tryText(t)).toBe('★ Best net — entry 11:00 · square-off 15:10: +₹12,000 on its last 3 days replayed, +₹4,000 against the current +₹8,000 (worst day -₹2,500; current -₹4,000)');
        // malformed: dropped rather than half-applied
        for (const bad of [{ entry: '9:20', exit: '15:10' }, { entry: '11:00', exit: '10:00' }, { entry: '11:00' }]) {
            expect(parseTry(JSON.stringify({ kind: 'timing', timing: bad }))).toBe(null);
        }
        // a combination still parses as before
        expect(parseTry(JSON.stringify({ key: 'tp_pct_credit', combo: { legSlX: 1.5, maxLoss: 0, tp: 20 } }))).toMatchObject({ key: 'tp_pct_credit' });
        expect(trySection(parseTry(JSON.stringify({ key: 'tp_pct_credit', combo: { legSlX: 1.5, maxLoss: 0, tp: 20 } })))).toBe('Stops and target together');
    });

    it('shades, counts and days in words', () => {
        expect(heatStyle(null, 100)).toBeUndefined();
        expect(heatStyle(0, 100)).toBeUndefined();
        expect(heatStyle(100, 100).backgroundColor).toMatch(/--color-success-fill\) 46%/);
        expect(heatStyle(-50, 100).backgroundColor).toMatch(/--color-danger-fill\) 26%/);
        expect(noEntryLines({ '10:15': { 'never-traded leg': 2, 'no bid': 1 } })).toEqual(['10:15 on 3 days (never-traded leg: 2; no bid: 1)']);
        expect(daysPricesLine({ tape: 0, minutes: 4, tapeFrom: '2026-11-02' })).toMatch(/^All 4 days on the archive's minute quotes/);
        expect(dayText({ noEntry: 'no bid on a short leg' })).toBe('no entry: no bid on a short leg');
    });
});
