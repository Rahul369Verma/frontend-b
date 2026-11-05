/**
 * The size, said in full (5-Nov-2026: "I deployed 2 lots and it bought 1 … we are not showing
 * lots anywhere"): the card names what the go-live canary lets it trade; a trade names the lots
 * it held and why fewer than set.
 */
import { describe, it, expect } from 'vitest';
import { cardLots, tradeLots, canaryLine } from './lotsFormat.js';

const LIVE2 = { name: 'nifty-atm-straddle (LIVE)', trade_mode: 'LIVE', lots: 2, golive: { canary: { state: 'ACTIVE', lots: 1, trades: 10, liveTrades: 8 } }, position: { state: 'IDLE' } };

describe('cardLots', () => {
    it('canary-capped LIVE: set 2, trading 1, with the count — never just "2 lots"', () => {
        const L = cardLots(LIVE2);
        expect(L.text).toBe('2 lots · trading 1 (canary 8/10)');
        expect(L.capped).toBe(true);
        expect(L.trades).toBe(1);
        expect(L.title).toMatch(/every entry trades 1 lot until 10 live trades pass \(8 so far\) and you lift the size cap on the Go-Live page \(or skip the canary in this Lots dialog\)\. Its ₹ limits act at 1\/2 meanwhile\./);
    });
    it('lifted, PAPER or 1 lot: just the size', () => {
        expect(cardLots({ ...LIVE2, golive: { canary: { ...LIVE2.golive.canary, state: 'PASSED' } } }).text).toBe('2 lots');
        expect(cardLots({ ...LIVE2, trade_mode: 'PAPER' }).text).toBe('2 lots');
        expect(cardLots({ ...LIVE2, lots: 1 }).text).toBe('1 lot');
        expect(cardLots({ lots: null }).text).toBe('1 lot');
    });
    it('an open structure of another size says so', () => {
        expect(cardLots({ ...LIVE2, position: { state: 'OPEN', lots: 1 } }).text).toBe('2 lots · trading 1 (canary 8/10)');
        expect(cardLots({ ...LIVE2, golive: null, position: { state: 'OPEN', lots: 1 } }).text).toBe('2 lots · open: 1 lot');
    });
});

describe('tradeLots', () => {
    it('"1 of 2" when the canary held it below the size set; the units in the title', () => {
        expect(tradeLots({ lots: 1, configuredLots: 2, canaryCapped: true })).toMatchObject({ text: '1 of 2', lots: 1 });
        expect(tradeLots({ lots: 2, lotSize: 65 })).toMatchObject({ text: '2', title: '2 lots of 65 (130 units a leg)' });
        expect(tradeLots({ lots: null })).toMatchObject({ text: '—', lots: null });
    });
});

describe('canaryLine', () => {
    it('says the ₹ limits act in proportion while capped', () => {
        const s = { mode: 'LIVE', want: 2, canary: { capped: true, state: 'ACTIVE', lots: 1, trades: 10, liveTrades: 8 }, rupee: [{ key: 'max_loss_rupees', now: 10000, scaled: 20000 }] };
        expect(canaryLine(s)).toMatch(/Until then its ₹ limits act at 1\/2 of the figures below, so each lot keeps the same stop\.$/);
        expect(canaryLine({ ...s, rupee: [] })).not.toMatch(/₹ limits/);
    });
});
