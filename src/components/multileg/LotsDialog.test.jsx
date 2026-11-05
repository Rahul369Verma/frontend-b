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
        expect(canaryLine(size(3))).toBe('Its go-live canary is ACTIVE: it trades 1 lot until 10 live trades pass and you lift the size cap on the Go-Live page (4 so far), or until you skip the canary below. Then 3. Until then its ₹ limits act at 1/3 of the figures below, so each lot keeps the same stop.');
        expect(canaryLine(size(3, { canary: { state: 'PASSED', capped: false, lots: 1 } }))).toBeNull();
        expect(sizeNotes(size(2, { open: true, openLots: 1, canary: null }))).toEqual(['A structure is open now at 1 lot: it keeps that size. The new size applies from the next entry.']);
        expect(rupeeRows(size(3), true)).toEqual([{ key: 'max_loss_rupees', label: 'Rupee stop (whole structure)', now: 10000, after: 30000, perLotAfter: 10000 }]);
        expect(rupeeRows(size(3), false)[0]).toMatchObject({ after: 10000, perLotAfter: 3333 });
    });
});

describe('LotsDialog', () => {
    beforeEach(() => { SIZE = (want) => size(want); vi.clearAllMocks(); });

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
        expect(axios.post).not.toHaveBeenCalled();
        expect(onSaved.mock.calls[0][2]).toEqual({ skippedCanary: false });
    });

    // 6-Nov-2026: "how can I skip the canary and make it 2 lots now … it should show the check to
    // skip canary while making changes to lots" — set to 2, the canary trading 1 (8 of 10).
    it('skip the canary: set to 2 and held at 1 — the check alone saves, needs the name, and lifts the cap (no lots edit)', async () => {
        const axios = (await import('axios')).default;
        SIZE = (want) => size(want, { lots: 2, confirmNeeded: false, canary: { state: 'ACTIVE', lots: 1, trades: 10, liveTrades: 8, capped: true, livePnl: 13799.1, lossCapInr: 5000, liftable: true, early: true } });
        const onSaved = vi.fn();
        render(<LotsDialog dep={{ _id: 'd1', name: 'nifty-atm-straddle (LIVE)', lots: 2, trade_mode: 'LIVE' }} onClose={() => {}} onSaved={onSaved} />);
        await waitFor(() => expect(screen.getByTestId('skip-canary')).toBeTruthy());
        expect(screen.getByRole('button', { name: 'No change' }).disabled).toBe(true);
        expect(screen.getByTestId('lots-dialog').textContent).toMatch(/or until you skip the canary below/);
        const box = screen.getByTestId('skip-canary').querySelector('input[type=checkbox]');
        expect(screen.getByTestId('skip-canary').textContent).toBe('Skip the rest of the go-live canary: trade 2 lots from the next entry (8 of 10 live trades done, net +₹13,799).');
        fireEvent.click(box);
        const t = screen.getByTestId('lots-dialog').textContent;
        expect(t).toMatch(/Real money: 2× the canary's 1-lot size\. The canary stops watching it, so it no longer asks you at its ₹5,000 loss cap, and its ₹ limits act in full at 2 lots\./);
        expect(t).not.toMatch(/it trades 1 lot until/);
        const save = screen.getByRole('button', { name: 'Skip canary — trade 2 lots' });
        expect(save.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Type the deployment name to confirm'), { target: { value: 'nifty-atm-straddle (LIVE)' } });
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(axios.patch).not.toHaveBeenCalled();
        expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/golive\/deployments\/multileg\/d1\/canary$/), { decision: 'lift', early: true });
        expect(onSaved.mock.calls[0]).toEqual([null, 2, { skippedCanary: true }]);
    });

    it('size up AND skip: lots first, then the lift; a refused lift says the lots saved but the cap did not', async () => {
        const axios = (await import('axios')).default;
        axios.post.mockRejectedValueOnce({ response: { data: { error: 'the canary is CAP_HIT, not waiting to lift its size cap' } } });
        const onSaved = vi.fn();
        render(<LotsDialog dep={{ _id: 'd1', name: 'nifty-atm-straddle (LIVE)', lots: 1, trade_mode: 'LIVE' }} onClose={() => {}} onSaved={onSaved} />);
        fireEvent.change(screen.getByLabelText('Lots'), { target: { value: '2' } });
        await waitFor(() => expect(screen.getByTestId('skip-canary')).toBeTruthy());
        fireEvent.click(screen.getByTestId('skip-canary').querySelector('input[type=checkbox]'));
        fireEvent.change(screen.getByLabelText('Type the deployment name to confirm'), { target: { value: 'nifty-atm-straddle (LIVE)' } });
        fireEvent.click(screen.getByRole('button', { name: 'Trade 2 lots — skip canary' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('2 lots saved, but the canary was NOT skipped: the canary is CAP_HIT, not waiting to lift its size cap. It still trades 1 lot(s).'));
        expect(axios.patch).toHaveBeenCalledTimes(1);
        expect(axios.post.mock.calls[0][1]).toEqual({ decision: 'lift', early: true });
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('a canary waiting at its loss cap: no check — answer that on the Go-Live page first', async () => {
        SIZE = (want) => size(want, { canary: { state: 'CAP_HIT', lots: 1, trades: 10, liveTrades: 3, capped: true, lossCapInr: 5000, liftable: false, early: false } });
        render(<LotsDialog dep={{ _id: 'd1', name: 'x (LIVE)', lots: 1, trade_mode: 'LIVE' }} onClose={() => {}} onSaved={() => {}} />);
        fireEvent.change(screen.getByLabelText('Lots'), { target: { value: '2' } });
        await waitFor(() => expect(screen.getByTestId('skip-canary-blocked').textContent).toBe('Its canary is waiting at its ₹5,000 loss cap: answer that on the Go-Live page (keep LIVE or demote) before you skip it.'));
        expect(screen.queryByTestId('skip-canary')).toBeNull();
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
