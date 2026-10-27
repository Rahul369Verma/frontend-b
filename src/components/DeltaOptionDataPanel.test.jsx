import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import DeltaOptionDataPanel from './DeltaOptionDataPanel.jsx';

vi.mock('axios', () => { const api = { get: vi.fn() }; return { default: api, ...api }; });

describe('Delta option data panel', () => {
    it('shows the contract list coverage and says plainly when the recorder is not running, and why', async () => {
        axios.get.mockResolvedValue({ data: {
            evidence: { ok: true, builtAt: '2026-10-27T02:03:00Z', ageHours: 1.2, coverage: { BTC: { from: '2023-12-28', to: '2026-12-25', expiries: 1040, strikes: 48410 } } },
            recorder: { running: false, reason: 'inactive in development — production only (DELTA_OPTION_RECORD_FORCE=true to override)', metrics: {} },
            storage: { documents: 0 }, coverage: [], retentionDays: 365,
        } });
        render(<DeltaOptionDataPanel />);
        expect(await screen.findByText(/2023-12-28 → 2026-12-25 · 1040 expiries · 48410 strikes/)).toBeTruthy();
        expect(screen.getByText('NOT RECORDING')).toBeTruthy();
        expect(screen.getByText(/production only/)).toBeTruthy();
        expect(screen.getByText('Nothing recorded yet.')).toBeTruthy();
    });
});
