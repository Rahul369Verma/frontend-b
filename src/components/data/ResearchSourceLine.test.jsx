/**
 * Where recorded prices come from, and a source that does not answer says why (not an empty archive).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const get = vi.fn();
vi.mock('axios', () => {
    const api = { get: (...a) => get(...a), post: vi.fn(), defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import ResearchSourceLine from './ResearchSourceLine.jsx';

describe('ResearchSourceLine', () => {
    it('names the production source and its answer time', async () => {
        get.mockResolvedValueOnce({ data: { configured: true, connected: true, pingMs: 42, source: 'production database (SSH tunnel), db trading_bot, read-only' } });
        render(<ResearchSourceLine />);
        expect(await screen.findByText('production database (SSH tunnel), db trading_bot, read-only')).toBeTruthy();
        expect(screen.getByTestId('research-source').textContent).toMatch(/answers in 42 ms/);
        expect(get.mock.calls[0][1].params).toEqual({ ping: 1 });
    });
    it('a source that does not answer says why, as an alert, with a retry', async () => {
        get.mockResolvedValueOnce({ data: { configured: true, connected: false, source: 'production database (SSH tunnel)', error: 'The production database is not reachable from this stack … prod_db_tunnel' } });
        render(<ResearchSourceLine />);
        const line = await screen.findByRole('alert');
        expect(line.textContent).toMatch(/not answering: The production database is not reachable/);
        expect(screen.getByRole('button', { name: 'check again' })).toBeTruthy();
    });
});
