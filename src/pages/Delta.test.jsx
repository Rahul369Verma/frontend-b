/**
 * Delta Exchange UI: the picker searches and picks by keyboard; the settings
 * panel shows the contract's rupee facts and the margin a size would block; the
 * page says plainly when no API keys are set and lists the option chain.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import axios from 'axios';
import DeltaInstrumentPicker from '../components/delta/DeltaInstrumentPicker';
import DeltaParams from '../components/delta/DeltaParams';
import Delta from './Delta.jsx';
import { deltaPrice, describeInstrument, rupeesPerPoint, feePct } from '../components/delta/deltaFormat.js';

vi.mock('axios', () => {
    const api = { get: vi.fn(), post: vi.fn() };
    return { default: api, ...api };
});

const BTC = { symbol: 'DELTA:BTCUSD', deltaSymbol: 'BTCUSD', kind: 'perpetual', underlying: 'BTC', description: 'Bitcoin Perpetual', contractValue: 0.001, contractUnit: 'BTC', tickSize: 0.5, currency: 'USD', fx: 85, maxLeverage: 200, makerRate: 0.0002, takerRate: 0.0005, initialMarginPct: 0.5, tradingStatus: 'operational' };
const CALL = { symbol: 'DELTA:C-BTC-84000-151026', deltaSymbol: 'C-BTC-84000-151026', kind: 'call', underlying: 'BTC', strike: 84000, settlementTime: '2026-10-15T12:00:00Z', contractValue: 0.001, tickSize: 0.1, currency: 'USD', takerRate: 0.0001 };

beforeEach(() => {
    axios.get.mockImplementation((url) => {
        if (url.endsWith('/delta/instruments')) return Promise.resolve({ data: { total: 2, shown: 2, results: [BTC, CALL] } });
        if (url.includes('/delta/instrument/')) return Promise.resolve({ data: { instrument: BTC, ticker: { close: 83000, mark_price: 83001, quotes: { best_bid: 82999.5, best_ask: 83000 } }, spreadBps: 0.03 } });
        if (url.endsWith('/delta/status')) return Promise.resolve({ data: {
            registry: { total: 1153, byKind: { perpetual: 237, call: 464, put: 444, move: 4, spot: 4 }, ageMinutes: 12, stale: false },
            venue: { feed: { connected: true, symbols: 3, cap: 150, reconnects: 0, refusedSubscriptions: 0 }, trading: { env: 'testnet', credentials: false, orderSocket: false } },
            trading: { env: 'testnet', credentials: false }, money: { note: 'Fixed ₹85 per USD.' },
        } });
        if (url.endsWith('/delta/account')) return Promise.resolve({ data: { configured: false, env: 'testnet' } });
        if (url.endsWith('/delta/option-chain')) return Promise.resolve({ data: { underlying: 'BTC', expiries: ['2026-10-15T12:00:00Z'], expiry: '2026-10-15T12:00:00Z', chain: [{ strike: 84000, call: CALL, put: null }] } });
        return Promise.resolve({ data: {} });
    });
});

describe('Delta formatting', () => {
    it('prices in the contract currency, rupees per point at the fixed ₹85', () => {
        expect(deltaPrice(83448.5)).toBe('$83,448.5');
        expect(deltaPrice(7100000.1, 'INR')).toBe('₹71,00,000.1');
        expect(deltaPrice(null)).toBe('—');
        expect(rupeesPerPoint(BTC)).toBeCloseTo(0.085, 10);
        expect(feePct(0.0005)).toBe('0.050%');
        expect(describeInstrument(CALL)).toMatch(/^BTC Call 84000 · /);
    });
});

describe('DeltaInstrumentPicker', () => {
    it('searches and picks with the keyboard', async () => {
        const onChange = vi.fn();
        render(<DeltaInstrumentPicker id="t-picker" value={null} onChange={onChange} />);
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'BTC' } });
        await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2));
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('DELTA:C-BTC-84000-151026', CALL);
    });
});

describe('DeltaParams', () => {
    it('shows the contract’s rupee facts and the margin 10 contracts block at 10x', async () => {
        render(<DeltaParams symbol="DELTA:BTCUSD" params={{ lots: 10, delta_leverage: 10 }} onChange={() => {}} />);
        await waitFor(() => expect(screen.getByText(/max 200x/)).toBeTruthy());
        // 10 × 0.001 BTC × $83,000 × ₹85 = ₹70,550 notional → ₹7,055 at 10x.
        expect(screen.getByText(/₹70,550 notional/)).toBeTruthy();
        expect(screen.getByText(/blocks ₹7,055/)).toBeTruthy();
        expect(screen.getByLabelText(/Leverage/)).toBeTruthy();
    });
});

describe('Delta page', () => {
    it('says plainly that no keys are set and still lists contracts and the chain', async () => {
        render(<Delta />);
        await waitFor(() => expect(screen.getByText('no API keys')).toBeTruthy());
        expect(screen.getByText('1153')).toBeTruthy();
        expect(screen.getByText(/DELTA_API_KEY=/)).toBeTruthy();
        await waitFor(() => expect(screen.getByText('C-BTC-84000-151026')).toBeTruthy());
    });
});
