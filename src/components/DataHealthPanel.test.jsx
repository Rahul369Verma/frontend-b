import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import DataHealthPanel from './DataHealthPanel.jsx';

vi.mock('axios', () => { const api = { get: vi.fn() }; return { default: api, ...api }; });

const health = {
    at: '2026-10-31T05:00:00Z', ms: 812, counts: { critical: 1, warning: 1, info: 1 },
    checks: [
        { priority: 'critical', key: 'tape-never', area: 'Quote tape', title: 'The quote tape has never recorded', message: 'No ticks saved on any of the last 7 session(s).', action: 'Deploy the backend with the recorder fix.' },
        { priority: 'warning', key: 'backup-silent', area: 'Backups', title: 'Backups do not report to the app', message: 'A missed night would go unnoticed.', action: 'Install backup v2.' },
        { priority: 'info', key: 'growth', area: 'Storage', title: 'Recorders add about 108 MB a day', message: '…', action: null },
    ],
    forecast: {
        stores: [
            { coll: 'quote_tape', label: 'Quote tape (every tick)', now: 0, perDay: 68.5e6, retentionDays: null, in30: 2.1e9, in90: 6.2e9, in365: 25e9, estimated: true },
            { coll: 'delta_option_snapshots', label: 'Delta option snapshots', now: 124.8e6, perDay: 34.9e6, retentionDays: 365, in30: 1.2e9, in90: 3.3e9, in365: 12.7e9 },
        ],
        disk: { usedPct: 26.5, free: 113.9e9, total: 154.9e9, perDay: 1.4e9, daysTo90: 72 },
        bucket: { now: 1.2e9, freeBytes: 20e9, paid: false, perDay: 630e6, daysToFree: 30, estimated: true },
        backups: { version: null },
    },
};

describe('Data health panel', () => {
    it('lists every check by priority with its action, and forecasts disk, bucket and each store', async () => {
        axios.get.mockResolvedValue({ data: health });
        render(<DataHealthPanel />);
        expect(await screen.findByText('The quote tape has never recorded')).toBeTruthy();
        expect(screen.getAllByText('1 critical').length).toBeGreaterThan(0);
        expect(screen.getByText('→ Install backup v2.')).toBeTruthy();
        const items = screen.getByTestId('health-checks').querySelectorAll('li');
        expect([...items].map((li) => li.querySelector('span').textContent)).toEqual(['critical', 'warning', 'info']);
        expect(screen.getByText('estimate')).toBeTruthy();
        expect(screen.getByText(/26.5% used · 113.9 GB free of 154.9 GB · grows 1.4 GB\/day · 90% in 72 days/)).toBeTruthy();
        expect(screen.getByText(/about 1.2 GB of the free 20.0 GB · grows 630 MB\/day/)).toBeTruthy();
        expect(screen.getByText(/does not report to the app/)).toBeTruthy();
    });

    it('backup v2: the bucket against its budget, what each store keeps there, and day files the budget held back', async () => {
        const bucket = {
            now: 2.4e9, budget: 18e9, freeBytes: 20e9, paid: false, perDay: 21e6, estimated: false, daysToBudget: null, heldFiles: 2,
            windows: [
                { coll: 'quote_tape', label: 'Quote tape (every tick)', per: 'session', slots: 60, cap: 6e9 },
                { coll: 'option_chain_snapshots', label: 'Option-chain archive (minute snapshots)', per: 'session', slots: null, cap: null },
                { coll: 'delta_option_snapshots', label: 'Delta option snapshots', per: 'day', slots: 30, cap: 0.54e9 },
            ],
        };
        axios.get.mockResolvedValue({ data: { ...health, forecast: { ...health.forecast, bucket, backups: { version: 2, uploadedFiles: 80, uploadedBytes: 2.1e9 } } } });
        render(<DataHealthPanel />);
        const box = await screen.findByTestId('health-bucket');
        expect(box.textContent).toMatch(/2.4 GB of its 18.0 GB budget \(Oracle's free limit is 20.0 GB\) · grows 21 MB\/day · stays under the budget/);
        expect(box.textContent).toMatch(/Quote tape \(every tick\) — newest 60 sessions \(up to 6.0 GB\) · Option-chain archive \(minute snapshots\) — every day · Delta option snapshots — newest 30 days \(up to 540 MB\)/);
        expect(box.textContent).toMatch(/2 day file\(s\) held back by the budget/);
        expect(screen.getByText(/80 day files in the bucket \(2.1 GB\)/)).toBeTruthy();
    });

    it('says all clear when nothing needs a person', async () => {
        axios.get.mockResolvedValue({ data: { ...health, counts: { critical: 0, warning: 0, info: 1 }, checks: [health.checks[2]] } });
        render(<DataHealthPanel />);
        expect((await screen.findAllByText('all clear')).length).toBeGreaterThan(0);
    });
});
