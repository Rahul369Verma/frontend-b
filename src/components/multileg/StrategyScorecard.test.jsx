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

describe('StrategyScorecard — ready for live, filters, columns (23-Oct-2026)', () => {
    beforeEach(() => localStorage.clear());
    const CHECKS = [
        { id: 'evidence.backtest', group: 'evidence', title: 'Backtest with real costs, out of sample', level: 'soft', status: 'fail', have: 'none on record', need: '≥ 10 out-of-sample trades with positive net P&L after costs', fix: 'Auto-optimize the saved strategy.' },
        { id: 'evidence.paperSample', group: 'evidence', title: 'Paper record: enough trades', level: 'soft', status: 'pass', have: '20 closed trades over 15 days', need: '≥ 20 trades over ≥ 5 days', fix: null },
        { id: 'quality.consistency', group: 'quality', title: 'Makes money through the range, not in one stretch', level: 'info', status: 'pass', have: '62 — 4 of 5 weeks profitable', need: 'consistency ≥ 50', fix: null },
    ];
    const CONS = (score) => ({ score, bucket: 'week', periods: 5, profitable: 4, losing: 1, idle: 0, smoothedRate: 0.71, r2: 0.87, top20Share: 0.4, longestUnderwaterDays: 3, worstPeriod: { key: '2026-10-05', net: -800 }, bestPeriod: { key: '2026-10-12', net: 6000 }, buckets: [] });
    const rr = (i, over = {}) => row(i, {
        trades: 20, verdict: 'on-track', consistency: CONS(30 + i * 10), romPct: 0.1 * i, margin: { perLot: 206000, basis: 'span', n: 20 }, worstTrade: -2000, tStat: 1.5,
        readiness: { status: 'not-ready', failing: ['Backtest with real costs, out of sample'], passed: 2, total: 3, checks: CHECKS }, ...over,
    });
    const SC2 = (rows) => ({ data: { minTrades: 20, rows, verdictCounts: { 'on-track': rows.length - 1, drifting: 1 }, readinessCounts: { 'not-ready': rows.length }, quality: { minConsistency: 50 }, windowed: false, open: { n: 0, mtmNet: 0, unmarked: 0 } }, err: null });

    it('the Live check opens the go-live evidence, the quality checks and the consistency behind a row', () => {
        wrap(<StrategyScorecard sc={SC2([rr(1)])} />);
        const tr = screen.getByRole('link', { name: 'strat-1 (PAPER)' }).closest('tr');
        expect(within(tr).getByText('40')).toBeInTheDocument();
        fireEvent.click(within(tr).getByRole('button', { name: /Live check for strat-1 \(PAPER\): Not yet · 2\/3/ }));
        const d = screen.getByTestId('detail-d1');
        expect(within(d).getByText(/Not ready for go-live: 1 required check fails — Backtest with real costs, out of sample/)).toBeInTheDocument();
        expect(within(d).getByText('Backtest with real costs, out of sample')).toBeInTheDocument();
        expect(within(d).getByText('Auto-optimize the saved strategy.')).toBeInTheDocument();
        expect(within(d).getByText('Makes money through the range, not in one stretch')).toBeInTheDocument();
        expect(within(d).getByText(/2,06,000 per lot · broker SPAN/)).toBeInTheDocument();
        expect(within(d).getByText('Profitable weeks')).toBeInTheDocument();
        expect(within(d).getByRole('link', { name: 'Go-Live page' })).toHaveAttribute('href', '/go-live');
        fireEvent.click(screen.getByRole('button', { name: 'Details for strat-1 (PAPER)' }));
        expect(screen.queryByTestId('detail-d1')).not.toBeInTheDocument();
    });

    it('filters: a preset narrows the list, says how many it hid, and clears; verdict chips filter too', () => {
        const rows = [rr(1), rr(2), rr(3, { verdict: 'drifting' }), rr(4, { costPct: 70 })];
        wrap(<StrategyScorecard sc={SC2(rows)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
        fireEvent.click(within(screen.getByTestId('scorecard-filters')).getByRole('button', { name: 'Live candidates' }));
        // consistency 40/50/60/70 → ≥ 50 leaves 2, 3 and 4; costs ≤ 50 drops 4
        expect(screen.queryByRole('link', { name: 'strat-1 (PAPER)' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'strat-4 (PAPER)' })).not.toBeInTheDocument();
        expect(screen.getByText(/2 of 4 match the filters — 2 hidden/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Filters \(\d\)$/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(screen.getAllByRole('link', { name: /strat-\d/ })).toHaveLength(4);
        fireEvent.click(screen.getByRole('button', { name: /Drifting · 1/ }));
        expect(screen.getAllByRole('link', { name: /strat-\d/ }).map(a => a.textContent)).toEqual(['strat-3 (PAPER)']);
        expect(JSON.parse(localStorage.getItem('multileg:scorecard:filters')).verdicts).toEqual(['drifting']);
    });

    it('sorts by consistency, and the column picker hides a column and remembers it', () => {
        wrap(<StrategyScorecard sc={SC2([rr(1), rr(3), rr(2)])} />);
        fireEvent.change(screen.getByRole('combobox', { name: /Sort/ }), { target: { value: 'consistency' } });
        expect(screen.getAllByRole('link', { name: /strat-\d/ }).map(a => a.textContent)).toEqual(['strat-3 (PAPER)', 'strat-2 (PAPER)', 'strat-1 (PAPER)']);
        expect(screen.getByRole('columnheader', { name: /Consistency/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
        fireEvent.click(within(screen.getByTestId('scorecard-columns')).getByRole('checkbox', { name: 'Consistency' }));
        expect(screen.queryByRole('columnheader', { name: /Consistency/ })).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('multileg:scorecard:columns'))).not.toContain('consistency');
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
