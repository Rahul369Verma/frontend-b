/**
 * The AI in-flight review is controlled from the deployment card itself — the
 * same way AI confirmation is — with separate SL / TP permissions that only
 * exist while the review is on.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The panel navigates to per-deployment results, so it needs a router.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const deployments = [
    { _id: 'd-on', name: 'breakout nifty', symbol: 'NSE:NIFTY50-INDEX', strategyName: 'breakout_range', tradeMode: 'PAPER', isActive: true,
      params: { resolution: '5', ai_inflight_review_enabled: true, ai_inflight_review_sl_enabled: false, ai_inflight_review_interval_min: 20 } },
    { _id: 'd-off', name: 'trend bank', symbol: 'NSE:NIFTYBANK-INDEX', strategyName: 'trend_line', tradeMode: 'PAPER', isActive: true,
      params: { resolution: '5' } },
];

vi.mock('axios', () => {
    const get = vi.fn((url) => Promise.resolve({ data: /\/deployments(\?|$)/.test(url) ? deployments : [] }));
    const api = {
        get, post: vi.fn(() => Promise.resolve({ data: {} })), put: vi.fn(() => Promise.resolve({ data: {} })),
        delete: vi.fn(() => Promise.resolve({ data: {} })), patch: vi.fn(() => Promise.resolve({ data: {} })),
        defaults: { headers: { common: {} }, withCredentials: true },
        interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});

import axios from 'axios';
import DeploymentsPanel from './DeploymentsPanel.jsx';

describe('AI in-flight review on the deployment card', () => {
    beforeEach(() => { axios.post.mockClear(); window.confirm = () => true; });

    it('shows the review switch per deployment, with SL / TP chips only while it is on', async () => {
        render(<DeploymentsPanel onTest={() => {}} onSim={() => {}} onManualTrade={() => {}} />);
        await waitFor(() => expect(screen.getAllByLabelText('AI in-flight review')).toHaveLength(2));
        const [onSwitch, offSwitch] = screen.getAllByLabelText('AI in-flight review');
        expect(onSwitch.checked).toBe(true);
        expect(offSwitch.checked).toBe(false);
        // Only the deployment with the review ON has permission chips.
        const sl = screen.getAllByRole('button', { name: 'SL' });
        const tp = screen.getAllByRole('button', { name: 'TP' });
        expect(sl).toHaveLength(1);
        expect(tp).toHaveLength(1);
        expect(sl[0].getAttribute('aria-pressed')).toBe('false');   // stored false
        expect(tp[0].getAttribute('aria-pressed')).toBe('true');    // absent -> allowed
    });

    it('a chip click sends exactly that permission to the per-deployment endpoint', async () => {
        render(<DeploymentsPanel onTest={() => {}} onSim={() => {}} onManualTrade={() => {}} />);
        const tp = await screen.findByRole('button', { name: 'TP' });
        fireEvent.click(tp);
        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const [url, body] = axios.post.mock.calls[0];
        expect(url).toMatch(/\/deployments\/d-on\/toggle-inflight-review$/);
        expect(body).toEqual({ tp: false });
    });

    it('the master switch toggles the review for that deployment only', async () => {
        render(<DeploymentsPanel onTest={() => {}} onSim={() => {}} onManualTrade={() => {}} />);
        await waitFor(() => expect(screen.getAllByLabelText('AI in-flight review')).toHaveLength(2));
        fireEvent.click(screen.getAllByLabelText('AI in-flight review')[1]);
        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const [url, body] = axios.post.mock.calls[0];
        expect(url).toMatch(/\/deployments\/d-off\/toggle-inflight-review$/);
        expect(body).toEqual({ enabled: true });
    });
});
