/**
 * Market Rules — what a human must act on is never hidden: a failed source, a
 * source serving stale content, a held fact and every code ≠ market mismatch
 * are all on screen with counts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import MarketRules from './MarketRules.jsx';
import { describeKey, formatValue } from '../components/marketRules/format.js';

vi.mock('axios', () => {
    const api = { get: vi.fn(), post: vi.fn() };
    return { default: api, ...api };
});

const STATUS = {
    running: null,
    schedule: [{ label: '07:45 IST Mon–Sat', what: 'all sources' }],
    engineFile: { facts: 343, generatedAt: '2026-10-14T02:15:00Z' },
    unreviewedAlerts: 2,
    families: {
        margin: { total: 19, byStatus: { 'single-source': 18, conflict: 1 } },
        lot: { total: 200, byStatus: { confirmed: 60, authoritative: 14, 'single-source': 126 } },
    },
    lastRun: {
        runId: 'ref_1', trigger: 'schedule-am', startedAt: '2026-10-14T02:15:00Z',
        sources: [
            { source: 'nse:lots', ok: true, observations: 56, notices: 0, ms: 120, warnings: [] },
            { source: 'kite', ok: true, observations: 19, notices: 0, ms: 2200, warnings: ['Zerodha futures margin file lists only expired contracts (latest 2026-06) — not used'] },
            { source: 'upstox', ok: false, error: 'HTTP 503', observations: 0, notices: 0, ms: 900, warnings: [] },
        ],
        drift: [{ kind: 'lot', what: 'MCX:GOLDTEN', static: 10, actual: 1, status: 'single-source', note: 'INSTRUMENT_CONFIG.lotSize differs' }],
        counts: { facts: 343 },
    },
};

beforeEach(() => {
    axios.get.mockImplementation((url) => {
        if (url.endsWith('/reference/status')) return Promise.resolve({ data: STATUS });
        if (url.endsWith('/reference/facts')) return Promise.resolve({ data: { total: 1, shown: 1, facts: [
            { key: 'margin|MCX|SILVER', family: 'margin', value: 0.1275, status: 'conflict', sources: [{ source: 'kite', value: 0.2263 }, { source: 'upstox', value: 0.10 }], effectiveFrom: '2026-10-13' },
        ] } });
        return Promise.resolve({ data: {} });
    });
});

describe('MarketRules', () => {
    it('formats facts the way a trader reads them', () => {
        expect(formatValue('margin', 0.1036)).toBe('10.36%');
        expect(formatValue('lot', 65)).toBe('65');
        expect(formatValue('holiday', 'open 17:00-23:55')).toBe('open 17:00-23:55');
        expect(describeKey('lot|NSE|NIFTY|2026-11')).toBe('NSE NIFTY · Nov 2026');
        expect(describeKey('margin|MCX|GOLD')).toBe('MCX GOLD');
        expect(describeKey('holiday|NSE|2027-01-26')).toBe('NSE · Tue 26 Jan 2027');
    });

    it('shows the failed source, the stale source, the held fact and the code ≠ market lot', async () => {
        render(<MarketRules />);
        await waitFor(() => expect(screen.getByText('MCX:GOLDTEN')).toBeTruthy());
        expect(screen.getByText(/upstox: HTTP 503/)).toBeTruthy();
        expect(screen.getByText(/kite: Zerodha futures margin file lists only expired contracts/)).toBeTruthy();
        expect(screen.getByText('1 failed')).toBeTruthy();
        // Held = conflicts + suspicious across families.
        expect(screen.getByText('sources disagree or a jump needs review')).toBeTruthy();
        // The facts tab lists the conflict with both sources' readings.
        await waitFor(() => expect(screen.getByText('kite 22.63%')).toBeTruthy());
        expect(screen.getByText('upstox 10.00%')).toBeTruthy();
        expect(screen.getByText('conflict')).toBeTruthy();
    });
});
