import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StrategyScorecard, { OpenNow } from './StrategyScorecard.jsx';
import ExcursionsPanel from './ExcursionsPanel.jsx';

const row = (i, over = {}) => ({
    deploymentId: `d${i}`, name: `strat-${i} (PAPER)`, template: 'short_straddle', symbol: 'NSE:NIFTY50-INDEX', tradeMode: 'PAPER',
    status: 'ACTIVE', lots: 1, trades: 4, wins: 3, winRate: 75, net: 1000 * i, perTrade: 250 * i, profitFactor: 2, gross: 1500 * i, charges: 500 * i,
    costPct: 33, maxDrawdown: -200, curve: [[Date.UTC(2026, 9, 7), 500 * i], [Date.UTC(2026, 9, 8), 1000 * i]], recent: { n: 4, net: 1000 * i },
    flags: [], verdict: 'too-few', leaning: 'up', expected: { perTrade: 1578, winRate: 90.9, source: 'oos', label: 'out-of-sample' },
    ci95: null, gapPerTrade: 250 * i - 1578, why: null, open: null, ...over,
});
const SC = (rows, open = { n: 0, mtmNet: 0, unmarked: 0 }) => ({ data: { minTrades: 20, rows, verdictCounts: { 'too-few': rows.length }, open }, err: null });
const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('StrategyScorecard', () => {
    beforeEach(() => localStorage.clear());

    it('labels small samples honestly and shows live vs the backtest it came from', () => {
        wrap(<StrategyScorecard sc={SC([row(1)])} templates={[{ key: 'short_straddle', name: 'Short Straddle' }]} />);
        const r = screen.getByRole('link', { name: 'strat-1 (PAPER)' }).closest('tr');
        expect(within(r).getByText(/Too few trades \(4\/20\)/)).toBeInTheDocument();
        expect(within(r).getByText('₹1,578')).toBeInTheDocument();
        expect(within(r).getByText('(-1,328)')).toBeInTheDocument();
        expect(within(r).getByText('OOS')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'strat-1 (PAPER)' })).toHaveAttribute('href', '/multi-leg?tab=results&deployment=d1');
    });

    it('shows 15 rows, then all on request — and says how many are hidden', () => {
        wrap(<StrategyScorecard sc={SC(Array.from({ length: 20 }, (_, i) => row(i + 1)))} />);
        expect(screen.getByText(/Showing 15 of 20/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show all 20' }));
        expect(screen.getAllByRole('checkbox')).toHaveLength(20);
    });

    it('compares 2-4 strategies and blocks a fifth', () => {
        wrap(<StrategyScorecard sc={SC(Array.from({ length: 6 }, (_, i) => row(i + 1)))} />);
        const boxes = screen.getAllByRole('checkbox');
        fireEvent.click(boxes[0]);
        expect(screen.getByText(/pick one more/)).toBeInTheDocument();
        fireEvent.click(boxes[1]);
        expect(screen.getByText('Comparing 2 strategies — cumulative net by exit time')).toBeInTheDocument();
        fireEvent.click(boxes[2]); fireEvent.click(boxes[3]);
        expect(boxes[4]).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.queryByText(/Comparing/)).not.toBeInTheDocument();
    });

    it('open now: count and MTM up front, the list on request', () => {
        const rows = [row(1, { open: { state: 'OPEN', since: '2026-10-12T04:00:00Z', mtmNet: -250, markedAt: null } }), row(2)];
        wrap(<OpenNow sc={SC(rows, { n: 1, mtmNet: -250, unmarked: 0 })} />);
        expect(screen.getByText('1 structure')).toBeInTheDocument();
        expect(screen.getByText(/MTM/)).toHaveTextContent('-₹250');
        fireEvent.click(screen.getByRole('button', { name: 'Show list' }));
        expect(screen.getByRole('link', { name: 'strat-1 (PAPER)' })).toBeInTheDocument();
    });

    it('open now says so when nothing is open', () => {
        wrap(<OpenNow sc={SC([row(1)])} />);
        expect(screen.getByText(/Nothing open in this filter/)).toBeInTheDocument();
    });
});

describe('ExcursionsPanel', () => {
    const X = {
        n: 3, missing: 1, giveBackMedianPct: 67, inProfitN: 3,
        deep: [{ threshold: 2000, touched: 2, finishedPositive: 1, recoveredPct: 50 }],
        stopIf: [{ threshold: 2000, hit: 2, netChange: -1800 }],
        targetIf: [{ threshold: 2000, hit: 0, netChange: 0 }],
        points: [[-2500, 1000, 800], [-3200, 100, -3000], [-100, 1200, 400]],
    };
    it('states give-back, the recovery rate and the stop what-if, and counts what is missing', () => {
        render(<ExcursionsPanel excursions={X} />);
        expect(screen.getByText('67%')).toBeInTheDocument();
        expect(screen.getByText(/1 trade in this filter have no recorded/)).toBeInTheDocument();
        const r = screen.getByText('₹2,000').closest('tr');
        expect(within(r).getByText('1 (50%)')).toBeInTheDocument();
        expect(within(r).getByText('-₹1,800')).toBeInTheDocument();
    });
    it('says plainly when there is nothing to show', () => {
        render(<ExcursionsPanel excursions={{ n: 0 }} />);
        expect(screen.getByText(/No trade in this filter has a recorded/)).toBeInTheDocument();
    });
});
