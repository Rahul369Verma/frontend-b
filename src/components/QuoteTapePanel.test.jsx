import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import QuoteTapePanel from './QuoteTapePanel.jsx';

vi.mock('axios', () => { const api = { get: vi.fn(), post: vi.fn() }; return { default: api, ...api }; });

const tape = {
    recorder: { running: true, recording: false, active: false, reason: 'inactive in development — production only (QUOTE_TAPE_FORCE=true to override)', window: '09:14–15:46 IST', strikes: 15, symbols: 0, metrics: {} },
    storage: { documents: 0 }, days: [], events: [], loopLog: { off: false, loops: 0, documents: 0 },
};

describe('Live quote tape panel', () => {
    it('says plainly when nothing records, and why; no parity yet says when it will run', async () => {
        axios.get.mockImplementation((url) => Promise.resolve({ data: /quote-tape/.test(url) ? tape : { day: null, rows: [], note: 'no parity check has run yet — it runs with the nightly audit (19:30 IST)' } }));
        render(<QuoteTapePanel />);
        expect(await screen.findByText('NOT RECORDING')).toBeTruthy();
        expect(screen.getByText(/production only/)).toBeTruthy();
        expect(screen.getByText('Nothing recorded yet.')).toBeTruthy();
        expect(screen.getByText(/runs with the nightly audit/)).toBeTruthy();
    });

    it('lists every verdict a deployment got and the first difference — nothing is folded away', async () => {
        const parity = { day: '2026-10-27', rows: [
            { deploymentId: 'a', name: 'nifty-wide-tail', trade_mode: 'PAPER', clock: 'live loop instants', counts: { MATCH: 3, DIFFERS: 1 },
                rows: [{ verdict: 'MATCH', diffs: [] }, { verdict: 'DIFFERS', diffs: ['entry +11s', 'exit SL_STRUCT live vs SQUARE_OFF replay'] }],
                notes: ['edited 2026-10-27T05:00Z'], feed: { compared: 12000, agreePct: 99.8, differ: 20, missing: 4 } },
            { deploymentId: 'b', name: 'quiet', trade_mode: 'LIVE', counts: {}, rows: [], notes: [] },
        ] };
        axios.get.mockImplementation((url) => Promise.resolve({ data: /quote-tape/.test(url) ? tape : parity }));
        render(<QuoteTapePanel />);
        expect(await screen.findByText('3 match')).toBeTruthy();
        expect(screen.getByText('1 differs')).toBeTruthy();
        expect(screen.getByText(/entry \+11s · exit SL_STRUCT live vs SQUARE_OFF replay/)).toBeTruthy();
        expect(screen.getByText('no trades on either side')).toBeTruthy();
        expect(screen.getByText(/99.8% identical over 12,000 reads/)).toBeTruthy();
    });

    it('recording: the quote board says how many symbols the multileg engine can read without asking the broker, and says when it is full', async () => {
        const rec = { ...tape.recorder, recording: true, active: true, reason: null, symbols: 640, board: { slots: 640, capacity: 4096, full: 3 } };
        axios.get.mockImplementation((url) => Promise.resolve({ data: /quote-tape/.test(url) ? { ...tape, recorder: rec } : { day: null, rows: [] } }));
        render(<QuoteTapePanel />);
        const line = await screen.findByTestId('tape-board');
        expect(line.textContent).toMatch(/latest tick of 640 symbols, read by the multileg engine before it asks the broker · board full: 3 symbol\(s\) priced through the broker/);
    });
});
