/**
 * The Lots dialog (4-Nov-2026, multi-lot deployments): what a size means before saving, the
 * freeze limit, margin against the account, ₹ limits scaled with the lots, the LIVE name check.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { unitsLine, freezeLine, marginLine, canaryLine, sizeNotes, rupeeRows } from './lotsFormat.js';

const size = (want, over = {}) => ({
    id: 'd1', name: 'nifty-atm-straddle (LIVE)', mode: 'LIVE', symbol: 'NSE:NIFTY50-INDEX', lots: 1, want,
    ok: want <= 27, reason: want <= 27 ? null : `${want} lots is ${want * 65} units in one order, above the exchange's freeze limit of 1,755 for NIFTY options — at most 27 lots (orders are not sliced)`,
    lotSize: 65, maxRatio: 1, maxLots: 27, maxLotsAbsolute: 100,
    freeze: { known: true, qty: 1755, asOf: '2026-11-04', source: 'Upstox' },
    margin: { total: 210000 * want, perLot: 210000 }, account: { available: 470000, total: 480000 },
    canary: { state: 'ACTIVE', lots: 1, trades: 10, liveTrades: 4, capped: true },
    sizeMode: 'fixed', open: false, openLots: null,
    rupee: [{ key: 'max_loss_rupees', now: 10000, scaled: 10000 * want }],
    confirmNeeded: want > 1, ...over,
});

let SIZE = (want) => size(want);
vi.mock('axios', () => {
    const get = vi.fn((url, cfg) => Promise.resolve({ data: SIZE(Number(cfg?.params?.lots)) }));
    const patch = vi.fn(() => Promise.resolve({ data: { ok: true, changes: [], notes: [] } }));
    const api = { get, patch, post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import LotsDialog from './LotsDialog.jsx';

describe('lotsFormat', () => {
    it('says the size plainly', () => {
        expect(unitsLine(size(3))).toBe("3 lots × 65 = 195 units in each leg's order.");
        expect(unitsLine(size(2, { maxRatio: 2 }))).toBe("2 lots × 65 = 130 units in each leg's order (260 in the 2× leg).");
        expect(freezeLine(size(3))).toBe('At most 27 lots: the exchange accepts at most 1,755 units of NIFTY options in one order (as of 4 Nov 2026), and orders are not split.');
        expect(freezeLine(size(3, { freeze: { known: false, note: 'no source gives X' } }))).toBe('At most 100 lots. no source gives X');
        expect(marginLine(size(2))).toBe('Margin ≈ ₹4,20,000 for 2 lots (₹2,10,000 per lot). ₹4,70,000 is available now (other LIVE deployments\' entries also draw on it).');
        expect(marginLine(size(3))).toMatch(/₹1,60,000 MORE than the ₹4,70,000 available now: the entry would be refused for funds/);
        expect(marginLine(size(2, { mode: 'PAPER' }))).toMatch(/A PAPER book uses no account margin/);
        expect(marginLine(size(2, { margin: null }))).toMatch(/not priced right now/);
        expect(canaryLine(size(3))).toBe('Its go-live canary is ACTIVE: it trades 1 lot until 10 live trades pass and you lift the size cap on the Go-Live page (4 so far). Then 3.');
        expect(canaryLine(size(3, { canary: { state: 'PASSED', capped: false, lots: 1 } }))).toBeNull();
        expect(sizeNotes(size(2, { open: true, openLots: 1, canary: null }))).toEqual(['A structure is open now at 1 lot: it keeps that size. The new size applies from the next entry.']);
        expect(rupeeRows(size(3), true)).toEqual([{ key: 'max_loss_rupees', label: 'Rupee stop (whole structure)', now: 10000, after: 30000, perLotAfter: 10000 }]);
        expect(rupeeRows(size(3), false)[0]).toMatchObject({ after: 10000, perLotAfter: 3333 });
    });
});

describe('LotsDialog', () => {
    beforeEach(() => { SIZE = (want) => size(want); });

    it('a LIVE size-up: shows units, the limit, margin, the canary, scales the stop, and saves only with the name typed', async () => {
        const axios = (await import('axios')).default;
        const onSaved = vi.fn();
        render(<LotsDialog dep={{ _id: 'd1', name: 'nifty-atm-straddle (LIVE)', lots: 1, trade_mode: 'LIVE' }} onClose={() => {}} onSaved={onSaved} />);
        fireEvent.change(screen.getByLabelText('Lots'), { target: { value: '2' } });
        await waitFor(() => expect(screen.getByTestId('lots-dialog').textContent).toMatch(/2 lots × 65 = 130 units/));
        const t = screen.getByTestId('lots-dialog').textContent;
        expect(t).toMatch(/At most 27 lots/);
        expect(t).toMatch(/Margin ≈ ₹4,20,000 for 2 lots/);
        expect(t).toMatch(/canary is ACTIVE: it trades 1 lot/);
        expect(t).toMatch(/Rupee stop \(whole structure\)₹10,000→₹20,000₹10,000\/lot/);
        const save = screen.getByRole('button', { name: /Trade 2 lots/ });
        expect(save.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Type the deployment name to confirm'), { target: { value: 'nifty-atm-straddle (LIVE)' } });
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(axios.patch).toHaveBeenCalledWith(expect.stringMatching(/\/multileg\/deployments\/d1$/), { lots: 2, scaleRupees: true, confirm: 'nifty-atm-straddle (LIVE)' });
    });

    it('above the freeze limit: the reason is shown and nothing can be saved; unticking the scale says what the stop then means', async () => {
        render(<LotsDialog dep={{ _id: 'd1', name: 'x (PAPER)', lots: 1, trade_mode: 'PAPER' }} onClose={() => {}} onSaved={() => {}} />);
        fireEvent.change(screen.getByLabelText('Lots'), { target: { value: '28' } });
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/freeze limit of 1,755 for NIFTY options — at most 27 lots/));
        expect(screen.getByRole('button', { name: /Trade 28 lots/ }).disabled).toBe(true);
        SIZE = (want) => size(want, { mode: 'PAPER', confirmNeeded: false });
        fireEvent.change(screen.getByLabelText('Lots'), { target: { value: '4' } });
        await waitFor(() => expect(screen.getByTestId('lots-dialog').textContent).toMatch(/4 lots × 65/));
        fireEvent.click(screen.getByRole('checkbox'));
        expect(screen.getByTestId('lots-dialog').textContent).toMatch(/Unscaled, the same ₹ amounts act at 25% of today's loss per lot/);
        expect(screen.queryByLabelText('Type the deployment name to confirm')).toBeNull();
        expect(screen.getByRole('button', { name: /Trade 4 lots/ }).disabled).toBe(false);
    });
});
