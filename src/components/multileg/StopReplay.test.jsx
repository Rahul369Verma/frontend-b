/**
 * "Would this trade have come back without its stops?" — the per-trade replay button and
 * the deployment's stop grid. The numbers come from the server (stopWhatIf.js); these
 * tests pin what the page SAYS about them: saved vs cost, touched profit vs finished
 * better, the current setting marked, and nothing excluded silently.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const at = (hh, mm) => new Date(Date.UTC(2026, 9, 12, hh, mm) - 5.5 * 3600e3).toISOString();

const REPORT = {
    tradeId: 't1',
    booked: { net: -1500, reason: 'SQUARE_OFF' },
    configured: { net: -1720, reason: 'SQUARE_OFF', legStops: [{ leg: '23000CE', at: at(9, 36), price: 140 }], path: [{ t: at(9, 21), net: -40 }, { t: at(9, 36), net: -2700 }] },
    noStops: { net: 4380, reason: 'TP_STRUCT', legStops: [], path: [{ t: at(9, 21), net: -40 }, { t: at(11, 0), net: 4380 }] },
    recovery: { firstStopAt: at(9, 36), stopKind: 'LEG_SL', bestAfterStop: 4380, wentPositiveAfterStop: true, endedPositive: true },
    stopped: true, stopEffect: -6100, verdict: 'the stops cost ₹6100 (held without them: ₹4380)',
    stops: { leg_sl_x: 1.4, sl_x_credit: 1.5, sl_pct_debit: 0, max_loss_rupees: 3000 },
    paramsSource: 'trade (as opened)',
    archive: { idx: 'NIFTY50', days: ['2026-10-12'], snapshots: 338, fullChainMinutes: 0, note: null },
    caveats: ['Replayed on the recorded option chain.'],
};

const row = (legSlX, maxLoss, net, worst) => ({ legSlX, maxLoss, n: 3, net, wins: 2, worst, avg: Math.round(net / 3) });
const GRID = {
    deploymentId: 'd1', name: 'straddle', current: { legSlX: 1.4, maxLoss: 3000 }, currentInGrid: true, structureStop: 1.5,
    trades: 3, skipped: [{ id: 'x', why: 'no archived quotes' }],
    rows: [row(1.3, 2000, 9000, -2200), row(1.4, 3000, 7000, -3500), row(1.3, 3000, 6500, -3600), row(1.4, 2000, 6000, -2100)],
    noStops: { n: 3, net: -5000, wins: 1, worst: -7800, avg: -1667 },
    perTrade: [
        { id: 'a', entryAt: at(9, 20), booked: 3294, withStops: 3186, noStops: -7803, stopped: true, stopEffect: 10989, recovery: { firstStopAt: at(9, 24), stopKind: 'LEG_SL', bestAfterStop: -377, wentPositiveAfterStop: false } },
        { id: 'b', entryAt: at(9, 20), booked: -3569, withStops: -3566, noStops: 2839, stopped: true, stopEffect: -6405, recovery: { firstStopAt: at(9, 29), stopKind: 'LEG_SL', bestAfterStop: 2839, wentPositiveAfterStop: true } },
        { id: 'c', entryAt: at(9, 20), booked: 2360, withStops: 1891, noStops: -6091, stopped: true, stopEffect: 7982, recovery: { firstStopAt: at(9, 39), stopKind: 'LEG_SL', bestAfterStop: 2773, wentPositiveAfterStop: true } },
    ],
    caveats: ['Small samples.'],
};

let gridCalls = 0;
vi.mock('axios', () => {
    const get = vi.fn((url) => {
        if (/stop-whatif$/.test(url)) return Promise.resolve({ data: REPORT });
        if (/stop-grid$/.test(url)) {
            gridCalls++;
            return Promise.resolve({ data: gridCalls === 1
                ? { status: 'running', done: 40, total: 93, limit: 30, closedTrades: 4, beyondLimit: 0, quarantinedExcluded: 1 }
                : { status: 'done', done: 93, total: 93, result: GRID, limit: 30, closedTrades: 34, beyondLimit: 4, quarantinedExcluded: 1 } });
        }
        return Promise.resolve({ data: {} });
    });
    const api = { get, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import axios from 'axios';
import { TradeStopReplay, StopGridPanel } from './StopReplay.jsx';
import { reasonText, stopsText, recoveryText, firedLines, tradeStopsText, stopLossText, archiveNotes } from './stopReplayFormat.js';

const trade = {
    _id: 't1', symbol: 'NSE:NIFTY50-INDEX', entryAt: at(9, 20), exitAt: at(15, 10), netPnl: -1500, maeRupees: -2900, mfeRupees: 300,
    path: [{ t: at(9, 21), net: -40, gross: 0, spot: 23000 }, { t: at(9, 36), net: -2700, gross: -2600, spot: 23100 }, { t: at(15, 9), net: -1480, gross: -1400, spot: 23050 }],
};

describe('stop replay wording', () => {
    it('names every exit reason of the shared rules in words', () => {
        expect(reasonText('LEG_SL_FLATTEN')).toBe('every short leg stopped');
        expect(reasonText('TP_STRUCT')).toBe('profit target');
        expect(reasonText('MAX_LOSS')).toBe('rupee stop');
        expect(reasonText('SOMETHING_NEW')).toBe('something new');
        expect(reasonText(null)).toBe('—');
    });
    it('says which stops were replayed, 0 meaning off', () => {
        expect(stopsText(REPORT.stops)).toBe('leg stop 1.4× entry · structure stop 1.5× credit · rupee stop ₹3,000');
        expect(stopsText({ leg_sl_x: 0, sl_x_credit: 0, sl_pct_debit: 0, max_loss_rupees: 0 })).toBe('leg stop off · structure stop off · rupee stop off');
    });
    it('answers "did it come back?" — and says so when no stop fired', () => {
        expect(recoveryText(REPORT)).toMatch(/First stop: leg stop at 09:36 IST — held with no stops, it DID come back into profit — best \+₹4,380/);
        expect(recoveryText({ ...REPORT, stopped: false, recovery: null })).toMatch(/No stop fired/);
        expect(recoveryText({ ...REPORT, recovery: { ...REPORT.recovery, bestAfterStop: -377, wentPositiveAfterStop: false } })).toMatch(/never got back above ₹0/);
    });
});

// the 22-Oct LIVE straddle: CE leg stop first, then the ₹3,000 rupee stop closed the PE
const CE = 'NSE:NIFTY26O2722600CE', PE = 'NSE:NIFTY26O2722600PE';
const stoppedTrade = {
    _id: 't2', symbol: 'NSE:NIFTY50-INDEX', entryAt: at(9, 20), exitAt: at(11, 47), netPnl: -3290, exitReason: 'MAX_LOSS', maeRupees: -3020,
    path: [{ t: at(9, 21), net: -40 }, { t: at(11, 46), net: -2545 }, { t: at(11, 47), net: -3020, trigger: 'MAX_LOSS' }],
    closedLegs: [
        { symbol: CE, action: 'SELL', type: 'CE', strike: 22600, entryPrice: 173.1, exitPrice: 247.2, closeReason: 'LEG_SL', closedAt: at(11, 45), triggerQuote: 245.1 },
        { symbol: PE, action: 'SELL', type: 'PE', strike: 22600, entryPrice: 170.45, exitPrice: 144.85, closeReason: 'MAX_LOSS' },
    ],
    exitTrigger: { reason: 'MAX_LOSS', at: at(11, 47), net: -3020, gross: -2890, spot: 22615, stops: { leg_sl_x: 1.4, sl_x_credit: 2, sl_pct_debit: 0, max_loss_rupees: 3000 } },
    stops: { source: 'at exit', settings: { leg_sl_x: 1.4, sl_x_credit: 2, sl_pct_debit: 0, max_loss_rupees: 3000 }, legStops: { [CE]: 242.34, [PE]: 238.63 }, structurePnlUnit: -343.55, maxLossNetRupees: -3000 },
};

describe('a trade shows its own stops and what fired them (22-Oct-2026)', () => {
    it('lists the stops it ran with and where they came from', () => {
        expect(tradeStopsText(stoppedTrade.stops)).toBe('Its stops (at exit): leg stop 1.4× entry · structure stop 2× credit · rupee stop ₹3,000');
        expect(tradeStopsText(null)).toBe(null);
    });
    it('says what fired, in order: the leg stop (level, tripping quote, fill), then the rupee stop and the fills', () => {
        const lines = firedLines(stoppedTrade);
        expect(lines[0]).toBe('SELL CE 22600: leg stop at ₹242.34 fired 11:45 on a quote of ₹245.10 — bought back at ₹247.20.');
        expect(lines[1]).toBe('Rupee stop fired 11:47 on a net mark of -₹3,020 (stop -₹3,000); booked -₹3,290 — the exit fills came in ₹270 worse than that mark.');
        expect(lines).toHaveLength(2);
    });
    it('a trade closed before the trigger was recorded says so instead of guessing', () => {
        const old = { ...stoppedTrade, exitTrigger: undefined, closedLegs: [] };
        const [line] = firedLines(old);
        expect(line).toMatch(/^Closed by the rupee stop\. This trade did not record the mark that fired it/);
        expect(firedLines({ ...old, exitReason: 'SQUARE_OFF' })).toEqual([]);
    });
    it('draws the rupee stop on the chart and states it above, without being asked', () => {
        const { container } = render(<TradeStopReplay trade={stoppedTrade} />);
        expect(screen.getByTestId('trade-stops').textContent).toMatch(/Its stops \(at exit\).*Rupee stop fired 11:47/s);
        expect(container.textContent).toMatch(/Follows this trade on the recorded option prices past its exit/);
        expect(axios.get).not.toHaveBeenCalledWith(expect.stringMatching(/stop-whatif/), expect.anything());
    });
    it('a trade that recorded no settings says so', () => {
        render(<TradeStopReplay trade={{ ...stoppedTrade, stops: null }} />);
        expect(screen.getByTestId('trade-stops').textContent).toMatch(/did not record its stop settings/);
    });
});

describe('TradeStopReplay', () => {
    beforeEach(() => { axios.get.mockClear(); });
    it('asks only when clicked, then states saved/cost and the recovery', async () => {
        render(<TradeStopReplay trade={trade} />);
        expect(axios.get).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Replay without stops'));
        await waitFor(() => expect(screen.getByText(/All stops together \(leg \+ stop-loss\) COST ₹6,100 on this trade/)).toBeTruthy());
        expect(axios.get.mock.calls[0][0]).toMatch(/\/multileg\/trades\/t1\/stop-whatif$/);
        expect(screen.getByText(/With no stops at all/)).toBeTruthy();
        expect(screen.getByText(/it DID come back into profit/)).toBeTruthy();
        expect(screen.getByText(/Stops replayed: leg stop 1.4× entry/)).toBeTruthy();
        expect(screen.queryByText('Replay without stops')).toBeNull();
    });
    it('says plainly when the archive cannot replay the trade', async () => {
        axios.get.mockImplementationOnce(() => Promise.resolve({ data: { ...REPORT, configured: { net: null }, noStops: { net: null }, archive: { note: 'no archived quotes for the trade\'s days' } } }));
        render(<TradeStopReplay trade={trade} />);
        fireEvent.click(screen.getByText('Replay without stops'));
        await waitFor(() => expect(screen.getByText(/Not enough recorded quotes to replay this trade \(no archived quotes/)).toBeTruthy());
    });
});

// the 22-Oct trade's question: the leg stop is the strategy; what did the STOP-LOSS do?
const WITH_SL = {
    ...REPORT,
    booked: { net: -3290, reason: 'MAX_LOSS' },
    configured: { net: -3023, reason: 'MAX_LOSS', exitAt: at(11, 47), legStops: [{ leg: '22600CE', at: at(10, 23), price: 247 }], path: [{ t: at(9, 21), net: -40 }, { t: at(11, 47), net: -3023 }] },
    noStopLoss: { net: -1450, reason: 'SQUARE_OFF', legStops: [{ leg: '22600CE', at: at(10, 23), price: 247 }], path: [{ t: at(9, 21), net: -40 }, { t: at(13, 0), net: 420 }, { t: at(15, 10), net: -1450 }] },
    noStops: { net: 1239, reason: 'SQUARE_OFF', legStops: [], path: [{ t: at(9, 21), net: -40 }, { t: at(15, 10), net: 1239 }] },
    stopLossFired: true, stopLossEffect: -1573,
    stopLossRecovery: { stoppedAt: at(11, 47), stopKind: 'MAX_LOSS', bestAfterStop: 420, wentPositiveAfterStop: true, endedPositive: false },
    stopEffect: -4262,
};

describe('the stop-loss apart from the leg stops (22-Oct-2026)', () => {
    it('says what the stop-loss alone did, and what the trade did after it with only its leg stops', () => {
        expect(stopLossText(WITH_SL)).toBe('The stop-loss COST ₹1,573 on this trade (leg stops kept either way). After the rupee stop at 11:47 IST, managed by the leg stops only, it came back into profit — best +₹420 — and would have finished at -₹1,450 (square-off).');
        expect(stopLossText({ ...WITH_SL, stopLossFired: false, stopLossRecovery: null, stopLossEffect: 0 })).toMatch(/did not fire in the replay — without it, the trade is the same/);
        expect(stopLossText({ ...WITH_SL, noStopLoss: undefined })).toBe(null);   // an older server
    });
    it('draws both what-ifs, each can be hidden, and states both effects', async () => {
        axios.get.mockImplementationOnce(() => Promise.resolve({ data: WITH_SL }));
        render(<TradeStopReplay trade={stoppedTrade} />);
        fireEvent.click(screen.getByText('Replay without stops'));
        await waitFor(() => expect(screen.getByText(/The stop-loss COST ₹1,573 on this trade/)).toBeTruthy());
        expect(screen.getByText(/All stops together \(leg \+ stop-loss\) COST ₹4,262/)).toBeTruthy();
        expect(screen.getByText(/Without the stop-loss \(leg stops kept\)/)).toBeTruthy();
        // every replay is a checkbox in the chart's legend, on by default
        const box = screen.getByLabelText('replay · no stop-loss (leg stops kept)');
        expect(box.checked).toBe(true);
        expect(screen.getByLabelText('replay · no stops at all').checked).toBe(true);
        expect(screen.getByLabelText('replay · its stops').checked).toBe(true);
        fireEvent.click(box);
        expect(screen.getByLabelText('replay · no stop-loss (leg stops kept)').checked).toBe(false);
    });
});

describe('what the replay stood on: real fills, holes, repaired minutes (22-Oct-2026)', () => {
    it('names the bot\'s own leg-stop fills it used, every hole in the recorded prices, and the repaired minutes', () => {
        const d = { ...WITH_SL, realLegStops: [{ leg: '23050PE', at: at(11, 24), price: 252.9 }],
            archive: { ...REPORT.archive, gaps: [{ from: at(11, 10), to: at(11, 40), minutes: 30 }], candleMinutes: 0 } };
        const [real, hole] = archiveNotes(d);
        expect(real).toBe('The replays that keep the leg stop took the bot\'s own leg stop at the real time and fill: 23050PE at ₹252.90 (11:24).');
        expect(hole).toMatch(/^The recorded prices have a hole while this trade ran: 11:10–11:40 \(30 min\)\. A replay can only act at the first price after a hole\./);
        expect(archiveNotes({ ...d, realLegStops: [], archive: { gaps: [], candleMinutes: 30 } })).toEqual(['30 minute(s) of this replay were repaired from 1-minute candles: the last traded price, no bid/ask.']);
        expect(archiveNotes(REPORT)).toEqual([]);
    });
});

describe('StopGridPanel', () => {
    beforeEach(() => { gridCalls = 0; });
    it('needs one deployment', () => {
        render(<StopGridPanel deploymentId="all" />);
        expect(screen.getByText(/Pick one deployment/)).toBeTruthy();
    });
    it('polls the job, then shows the grid with the current setting marked and every exclusion counted', async () => {
        render(<StopGridPanel deploymentId="d1" />);
        fireEvent.click(screen.getByText(/Replay its last 30 trades/));
        await waitFor(() => expect(screen.getByText(/Replaying… 40\/93/)).toBeTruthy());
        await waitFor(() => expect(screen.getByLabelText('Net P&L by leg stop and rupee stop')).toBeTruthy(), { timeout: 4000 });
        // best and current, in words
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/leg 1.3× \+ rupee ₹2,000/);
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/Current leg 1.4× \+ rupee ₹3,000/);
        expect(screen.getByText(/Best on these trades:/).textContent).toMatch(/No stops at all → -₹5,000/);
        // the current cell carries the ring and says so on hover
        const cur = screen.getByTitle(/CURRENT setting/);
        expect(cur.className).toMatch(/ring-1/);
        // visible omissions: older trades, void fills, unreplayable trades
        const head = screen.getByText(/trade\(s\) replayed/).textContent;
        expect(head).toMatch(/4 older trade\(s\) not included \(limit 30\)/);
        expect(head).toMatch(/1 void fill\(s\) excluded/);
        expect(head).toMatch(/1 could not be replayed \(no archived quotes\)/);
        // touched profit is not finished better
        const sum = screen.getByText(/were stopped/).textContent;
        expect(sum).toMatch(/3 of 3 trades were stopped/);
        expect(sum).toMatch(/2 of those touched profit again/);
        expect(sum).toMatch(/only 1 finished better without stops/);
        expect(screen.getByText(/came back to \+₹2,839/)).toBeTruthy();
    });
});
