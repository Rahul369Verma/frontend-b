import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SavedStrategiesPanel from './SavedStrategiesPanel.jsx';

const LIST = [
    { _id: 's1', name: 'october-Short Straddle - NIFTY50', template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', entry_mode: 'time', backtest: { metrics: { netPnl: 405156, n: 181 } } },
    { _id: 's2', name: 'goodSIC', template: 'iron_condor', symbol: 'NSE:NIFTY50-INDEX', entry_mode: 'time' },
];
const LIVE = new Map([['s1', { deployments: [{ _id: 'd1' }], trades: 4, net: 4779, open: 1 }]]);
const props = (over = {}) => ({
    list: LIST, templates: [], deployLots: 1, onDeployLots: vi.fn(), pending: {},
    openId: null, onToggle: vi.fn(), onLoad: vi.fn(), onDeploy: vi.fn(), onDelete: vi.fn(),
    renderDetails: () => null, live: LIVE, defaultOpen: true, ...over,
});

describe('SavedStrategiesPanel — live results from deployments', () => {
    beforeEach(() => localStorage.clear());

    it('shows a deployed chip with booked trades and net, only on strategies that were deployed', () => {
        render(<SavedStrategiesPanel {...props()} />);
        const row = screen.getByText('october-Short Straddle - NIFTY50').closest('tr');
        expect(within(row).getByText(/1 deployed · 4 trades ·/)).toBeInTheDocument();
        expect(within(row).getByText('₹4,779')).toBeInTheDocument();
        const other = screen.getByText('goodSIC').closest('tr');
        expect(within(other).queryByText(/deployed/)).not.toBeInTheDocument();
    });

    it('sorts by live net, never-deployed strategies last', () => {
        render(<SavedStrategiesPanel {...props({ list: [LIST[1], LIST[0]] })} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'liveNet' } });
        const names = screen.getAllByRole('row').slice(2).map(r => r.querySelector('td')?.textContent || '');
        expect(names[0]).toMatch(/october-Short Straddle/);
        expect(names[1]).toMatch(/goodSIC/);
    });
});

describe('SavedStrategiesPanel — accordion', () => {
    beforeEach(() => localStorage.clear());

    it('is CLOSED by default: header with the count, no list, no toolbar', () => {
        render(<SavedStrategiesPanel {...props({ defaultOpen: undefined })} />);
        const toggle = screen.getByRole('button', { name: /Saved strategies \(2\)/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('goodSIC')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        // collapsing never hides a fact: the deployed count rides on the header
        expect(toggle).toHaveTextContent('1 deployed');
    });

    it('opens on click and closes again', () => {
        render(<SavedStrategiesPanel {...props({ defaultOpen: undefined })} />);
        const toggle = screen.getByRole('button', { name: /Saved strategies/ });
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('goodSIC')).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(screen.queryByText('goodSIC')).not.toBeInTheDocument();
    });

    it('controlled: follows `open` and reports clicks through onOpenChange', () => {
        const onOpenChange = vi.fn();
        const { rerender } = render(<SavedStrategiesPanel {...props({ defaultOpen: undefined, open: false, onOpenChange })} />);
        fireEvent.click(screen.getByRole('button', { name: /Saved strategies/ }));
        expect(onOpenChange).toHaveBeenCalledWith(true);
        expect(screen.queryByText('goodSIC')).not.toBeInTheDocument();   // parent has not opened it yet
        rerender(<SavedStrategiesPanel {...props({ defaultOpen: undefined, open: true, onOpenChange })} />);
        expect(screen.getByText('goodSIC')).toBeInTheDocument();
    });
});

describe('SavedStrategiesPanel — a 70/30 split saved with a plain backtest', () => {
    beforeEach(() => localStorage.clear());
    const SPLIT = {
        _id: 's3', name: 'nifty-core', template: 'short_strangle', symbol: 'NSE:NIFTY50-INDEX', entry_mode: 'time',
        backtest: {
            from: '2025-01-01', to: '2026-10-16', resolution: '5',
            metrics: { netPnl: 500000, n: 442, winRate: 80, roiOnMarginPct: 90, profitFactor: 3 },
            split: { ratio: 0.3, train: { netPnl: 300000, n: 308 }, val: { netPnl: 200000, n: 134, profitFactor: 4 }, robustness: { robust: true, ratio: 0.67, note: 'holds out of sample' } },
        },
    };
    const FADED = { ...SPLIT, _id: 's4', name: 'bankex', backtest: { ...SPLIT.backtest, split: { ...SPLIT.backtest.split, val: { netPnl: -5000, n: 134 }, robustness: { robust: false, ratio: -0.02, note: 'edge disappears out-of-sample' } } } };

    it('fills the Val/Train columns, says "Held up" / "Faded" — never "Holds"/"Overfit" — and shows no Auto chip', () => {
        render(<SavedStrategiesPanel {...props({ list: [SPLIT, FADED, LIST[0]] })} />);
        const row = screen.getByText('nifty-core').closest('tr');
        expect(within(row).getByText('✓ Held up')).toBeInTheDocument();
        expect(within(row).queryByText(/Auto #/)).not.toBeInTheDocument();
        expect(within(row).queryByText(/Overfit/)).not.toBeInTheDocument();
        const faded = screen.getByText('bankex').closest('tr');
        expect(within(faded).getByText('⚠ Faded')).toBeInTheDocument();
        // a plain backtest without a split still shows — in the OOS columns
        expect(within(row).queryByText('↗ Better lately')).not.toBeInTheDocument();
        const plain = screen.getByText('october-Short Straddle - NIFTY50').closest('tr');
        expect(within(plain).queryByText(/Held up|Faded/)).not.toBeInTheDocument();
    });

    it('a strategy that lost in the first part and gained lately reads "Better lately", not "Held up"', () => {
        const IMPROVED = { ...SPLIT, _id: 's5', name: 'goodSIC', backtest: { ...SPLIT.backtest, split: { ...SPLIT.backtest.split, train: { netPnl: -26133, n: 124 }, val: { netPnl: 13088, n: 55 }, robustness: { robust: true, ratio: null, note: 'positive out-of-sample (train was weak)' } } } };
        render(<SavedStrategiesPanel {...props({ list: [IMPROVED] })} />);
        const row = screen.getByText('goodSIC').closest('tr');
        expect(within(row).getByText('↗ Better lately')).toBeInTheDocument();
        expect(within(row).queryByText('✓ Held up')).not.toBeInTheDocument();
    });
});
