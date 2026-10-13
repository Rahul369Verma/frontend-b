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
