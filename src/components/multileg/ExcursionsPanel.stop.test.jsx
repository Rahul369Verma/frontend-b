/**
 * How trades travelled — the dot tooltip, the stop-loss picker and "Set this stop"
 * (user, 17-Oct-2026: hovering a dot showed an empty box; asked for a suggested,
 * editable stop that can be SET so it changes future trades).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ThemeProvider from '../../theme/ThemeContext.jsx';
import { rowsOf, stopEffect, suggestStop, splitByTime, lowestLossStop, stopTable, worstAfter } from '../../utils/stopWhatIf.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import axios from 'axios';
import ExcursionsPanel, { DotTip } from './ExcursionsPanel.jsx';
import { buildChartTheme } from '../../theme/chartPalette.js';
import { buildChartType } from '../../theme/chartTheme.js';

// 60 trades over 60 days: losers that went to −₹3,000 and kept going (a stop helps),
// some that dipped to −₹800 and recovered (a tight stop would hurt).
const day = (i) => `2026-0${8 + Math.floor(i / 30)}-${String((i % 30) + 1).padStart(2, '0')}`;
const POINTS = Array.from({ length: 60 }, (_, i) => {
    if (i % 3 === 0) return [-4000, 200, -3800, 'iron-fly NIFTY', day(i), 'dep-a'];      // ran away
    if (i % 3 === 1) return [-800, 900, 600, 'strangle BANKNIFTY', day(i), 'dep-b'];     // dipped, recovered
    return [-200, 1500, 1200, 'iron-fly NIFTY', day(i), 'dep-a'];                         // clean winner
});
const X = { n: 60, missing: 0, giveBackMedianPct: 40, inProfitN: 40, points: POINTS,
    deep: [500, 1000, 2000, 3000, 5000].map((t) => ({ threshold: t, touched: 0, finishedPositive: 0, recoveredPct: null })),
    stopIf: [], targetIf: [] };

describe('stop what-if', () => {
    const rows = rowsOf(POINTS);
    it('a stop at −T books every trade that touched it at exactly −T (the backend table\'s formula)', () => {
        const e = stopEffect(rows, 2000);
        expect(e.hit).toBe(20);                        // the 20 run-aways
        expect(e.netChange).toBe(20 * (-2000 - -3800)); // +36,000
        const tight = stopEffect(rows, 500);
        expect(tight.hit).toBe(40);                    // also cuts the 20 that recovered
        expect(tight.recovered).toBe(20);
        expect(tight.netChange).toBe(20 * (-500 + 3800) + 20 * (-500 - 600));
    });
    it('suggests a level chosen on the older 70% and shows how it did on the newest 30%', () => {
        const s = suggestStop(rows);
        expect(s.ok).toBe(true);
        const { older, newer } = splitByTime(rows);
        expect(s.older.n).toBe(older.length);
        expect(s.newer.n).toBe(newer.length);
        expect(s.level).toBeGreaterThan(800);           // never cuts the dips that recovered
        expect(s.level).toBeLessThanOrEqual(4000);
        expect(s.newer.netChange).toBeGreaterThan(0);
    });
    it('no suggestion when no level helps, or when the best one fails on the newest trades', () => {
        const allRecover = rowsOf(POINTS.map((p) => [p[0], p[1], 500, p[3], p[4], p[5]]));
        expect(suggestStop(allRecover).ok).toBe(false);
        // the run-aways happen only in the OLDER part; on the newest trades the deep dips recover
        const shifted = rowsOf(POINTS.map((p, i) => (i >= 42 && p[0] === -4000 ? [-4000, 900, 2500, p[3], p[4], p[5]] : p)));
        const s = suggestStop(shifted);
        expect(s.ok).toBe(false);
        expect(s.reason).toMatch(/did not help on the newest/);
        expect(suggestStop(rowsOf(POINTS.slice(0, 10))).reason).toMatch(/too few/);
    });
});

describe('the lowest-loss stop (user, 23-Oct-2026: "it does not tell the minimum-loss stop")', () => {
    const rows = rowsOf(POINTS);
    it('is the level with the best total on ALL trades, with its worst trade, said apart from the suggestion', () => {
        const low = lowestLossStop(rows);
        expect(low.level).toBe(850);                    // just past the −₹800 dips that recover: every run-away cut, no recoverer
        expect(low.hit).toBe(20);
        expect(low.netChange).toBe(20 * (-850 + 3800));
        expect(low.total).toBe(20 * -3800 + 20 * 600 + 20 * 1200);
        expect(low.netAfter).toBe(low.total + low.netChange);
        expect(low.worstAfter).toBe(-850);
        expect(low.worstWithout).toBe(-3800);
        expect(worstAfter(rows, 2000)).toBe(-2000);
    });
    it('says "no stop" when every level cuts the result, and lists round levels with the picks', () => {
        const allRecover = rowsOf(POINTS.map((p) => [p[0], p[1], 500, p[3], p[4], p[5]]));
        expect(lowestLossStop(allRecover).level).toBeNull();
        const t = stopTable(rows, [850]);
        expect(t.map((r) => r.level)).toEqual([500, 850, 1000, 1500, 2000, 2500, 3000, 4000]);   // nothing past the deepest worst point (−₹4,000)
        expect(t.find((r) => r.level === 850).netAfter).toBe(lowestLossStop(rows).netAfter);
    });
    it('the picker shows it, the levels on request, and "use it" moves the level there', () => {
        render(<ThemeProvider><ExcursionsPanel excursions={X} /></ThemeProvider>);
        const line = screen.getByTestId('stop-lowest-loss');
        expect(line.textContent).toMatch(/Lowest loss on all 60 trades: stop at −₹850 → net .*20 trades stopped, worst trade .*850 instead of .*3,800\. Hindsight/);
        fireEvent.click(within(line).getByRole('button', { name: 'every level' }));
        expect(screen.getByTestId('stop-table').textContent).toMatch(/−₹850 ★/);
        // here the suggestion (checked on the newest trades) is the same level, so the picker already sits on it
        expect(within(line).queryByRole('button', { name: 'use it' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Stop level in rupees'), { target: { value: '3000' } });
        fireEvent.click(within(screen.getByTestId('stop-lowest-loss')).getByRole('button', { name: 'use it' }));
        expect(screen.getByLabelText('Stop level in rupees').value).toBe('850');
    });
});

describe('the dot tooltip', () => {
    it('says which trade, when, and its worst, best and finish — in readable colours', () => {
        const ct = { ...buildChartTheme('midnight'), type: buildChartType(1, 1) };
        render(<DotTip active payload={[{ payload: { mae: -1768, mfe: 300, net: -558, label: 'zone-strangle-nifty (PAPER)', day: '2026-10-16' } }]} ct={ct} basis="net" />);
        const tip = screen.getByTestId('excursion-tip');
        expect(tip.textContent).toMatch(/zone-strangle-nifty \(PAPER\)/);
        expect(tip.textContent).toMatch(/closed 2026-10-16/);
        expect(tip.textContent).toMatch(/Worst point: .*1,768/);
        expect(tip.textContent).toMatch(/Finished: .*558 net/);
        expect(tip.style.color).not.toBe('');           // explicit ink, never the black default
    });
});

describe('Stop-loss picker and "Set this stop"', () => {
    beforeEach(() => { axios.get.mockReset(); axios.post.mockReset(); });

    it('starts on the suggestion, re-prices any level you type, and only the multi-leg book can set it', () => {
        const { unmount } = render(<ThemeProvider><ExcursionsPanel excursions={X} /></ThemeProvider>);
        expect(screen.getByTestId('stop-suggestion').textContent).toMatch(/Suggested stop: ₹/);
        expect(screen.queryByRole('button', { name: /Set this stop/ })).toBeNull();     // single-leg / analysis only
        fireEvent.change(screen.getByLabelText('Stop level in rupees'), { target: { value: '500' } });
        expect(screen.getByTestId('stop-effect').textContent).toMatch(/40 of 60 trades would have closed at the stop — 20 of them had gone on to finish in profit/);
        unmount();
    });

    it('sets the level on the ticked deployments through the max-loss endpoint, and warns about LIVE and already-past structures', async () => {
        axios.get.mockResolvedValue({ data: [
            { _id: 'dep-a', name: 'iron-fly NIFTY', symbol: 'NSE:NIFTY50-INDEX', trade_mode: 'LIVE', status: 'ACTIVE', params: {}, position: { state: 'OPEN', lastMtmNetRupees: -2600 } },
            { _id: 'dep-b', name: 'strangle BANKNIFTY', symbol: 'NSE:NIFTYBANK-INDEX', trade_mode: 'PAPER', status: 'ACTIVE', params: { max_loss_rupees: 5000 }, position: { state: 'IDLE' } },
            { _id: 'dep-c', name: 'unrelated', symbol: 'BSE:SENSEX-INDEX', trade_mode: 'PAPER', params: {}, position: { state: 'IDLE' } },
        ] });
        axios.post.mockResolvedValue({ data: { ok: true } });
        render(<ThemeProvider><ExcursionsPanel excursions={X} canApplyStop /></ThemeProvider>);
        fireEvent.change(screen.getByLabelText('Stop level in rupees'), { target: { value: '2500' } });
        fireEvent.click(screen.getByRole('button', { name: /Set this stop on deployments/ }));
        const dlg = await screen.findByRole('dialog');
        await within(dlg).findByText('iron-fly NIFTY');
        expect(within(dlg).getByLabelText('Apply to iron-fly NIFTY').checked).toBe(true);      // in scope
        expect(within(dlg).getByLabelText('Apply to strangle BANKNIFTY').checked).toBe(true);
        expect(within(dlg).queryByText('unrelated')).toBeNull();                               // others folded away
        expect(dlg.textContent).toMatch(/rupee stop now: ₹5,000/);
        expect(dlg.textContent).toMatch(/1 ticked deployment is LIVE/);
        expect(dlg.textContent).toMatch(/1 open structure is already past −₹2,500/);
        fireEvent.click(within(dlg).getByRole('button', { name: /Set ₹2,500 on 2 deployments/ }));
        await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
        expect(axios.post.mock.calls.map((c) => [c[0].replace(/^.*\/api/, ''), c[1]])).toEqual([
            ['/multileg/deployments/dep-a/max-loss', { max_loss_rupees: 2500 }],
            ['/multileg/deployments/dep-b/max-loss', { max_loss_rupees: 2500 }],
        ]);
    });
});
