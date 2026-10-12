import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CrossIndexResults from './CrossIndexResults';
import IndexChips from './IndexChips';

const N = 'NSE:NIFTY50-INDEX', B = 'NSE:NIFTYBANK-INDEX', F = 'NSE:FINNIFTY-INDEX';
const cell = (status) => ({ status, oosPF: status === 'robust' ? 1.5 : 0.8, oosTrades: 20, oosPnL: 100, oosWinRate: 55, fullPnL: 900, fullTrades: 60, minSlPoints: 7 });
const result = {
  type: 'multi_index_optimization_result', jobId: 'j', seed: 1, preset: 'quick', budget: { d1: 30, s2: 6, d2: 200 }, nEligible: 3, kDefault: 2, symbols: [N, B, F],
  runConfig: { shared: { start_date: '2025-06-16', end_date: '2026-02-19', oos_split_date: '2025-12-04', oos_fraction: 0.3, dataSource: 'ARCHIVE_SPOT', resolution: '5', capital: 100000 },
    perSymbol: { [N]: { eligible: true, lot_size: 75, days: { test: 50 } }, [B]: { eligible: true, lot_size: 30, days: { test: 50 } }, [F]: { eligible: true, lot_size: 65, days: { test: 50 } } }, warnings: [] },
  excluded: [], indexes: [{ symbol: N, eligible: true, strategies: [] }], incomplete: [{ strategy: 'smc_ob', testedCount: 2, nEligible: 3 }], truncated: [],
  aggregate: [
    { strategy: 'orb', label: 'ORB', drawId: 1, robustCount: 2, kValues: { 2: 0.4, 3: null }, params: { a: 1 }, perSymbol: { [N]: cell('robust'), [B]: cell('robust'), [F]: cell('overfit') } },
    { strategy: 'st', label: 'SuperTrend', drawId: 2, robustCount: 3, kValues: { 2: 0.9, 3: 0.3 }, params: { a: 2 }, perSymbol: { [N]: cell('robust'), [B]: cell('robust'), [F]: cell('robust') } },
    { strategy: 'vw', label: 'VWAP', drawId: 3, robustCount: 1, kValues: { 2: null, 3: null }, params: { a: 3 }, perSymbol: { [N]: cell('robust'), [B]: cell('failed_train'), [F]: cell('no_trades') } },
  ],
  sharedWinner: { strategy: 'st', label: 'SuperTrend', drawId: 2, k: 2, robustCount: 3, nEligible: 3, groupsCovered: 2, groupsTotal: 2, weakest: { symbol: F, oosPF: 1.5, oosTrades: 20 }, strongest: { symbol: N, oosPF: 1.5, oosTrades: 20 }, tradesPerDay: 0.4, trials: 230 },
};

describe('CrossIndexResults', () => {
  it('ranks by the K dropdown, shows the "did not hold up" count and the incomplete band', () => {
    render(<CrossIndexResults result={result} onTest={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(/SuperTrend held up out-of-sample on 3 of 3 indexes/)).toBeTruthy();
    const rows = () => screen.getAllByText(/held up on \d of 3/).map(el => el.closest('td').textContent);
    expect(rows()[0]).toMatch(/SuperTrend/);
    expect(screen.getByRole('button', { name: /Did not hold up on 2 indexes \(1\)/ })).toBeTruthy();
    expect(screen.getByText(/Incomplete/)).toBeTruthy();
    expect(screen.getByText(/smc_ob \(tested on 2 of 3\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Must hold up on'), { target: { value: '3' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Did not hold up on 3 indexes \(2\)/ })).toBeTruthy();
  });

  it('a verdict chip tests that strategy on that index with the index lot', () => {
    const onTest = vi.fn();
    render(<CrossIndexResults result={result} onTest={onTest} onSave={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Test on BANKNIFTY/ })[0]);
    const [params, strategy] = onTest.mock.calls[0];
    expect(strategy).toBe('st');
    expect(params.symbol).toBe(B);
    expect(params.lot_size).toBe(30);
    expect(params.min_sl_points).toBe(7);
  });

  it('"Save where it held up" saves one setting per robust index', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<CrossIndexResults result={result} onTest={vi.fn()} onSave={onSave} />);
    const orbRow = screen.getByText('ORB').closest('tr');
    fireEvent.click(within(orbRow).getByRole('button', { name: /Save where it held up/ }));
    await screen.findByRole('status');
    expect(onSave.mock.calls[0][0].map(b => b.symbol)).toEqual([N, B]);
  });
});

describe('IndexChips', () => {
  it('is a labelled group of pressed-state buttons with All / Just one', () => {
    const onChange = vi.fn();
    render(<IndexChips selected={[N]} onChange={onChange} disabledReasons={{ [F]: 'no data' }} />);
    const group = screen.getByRole('group', { name: 'Indexes' });
    const nifty = within(group).getByRole('button', { name: /^NIFTY$/ });
    expect(nifty.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: /^BANKNIFTY/ }));
    expect(onChange).toHaveBeenLastCalledWith([N, B]);
    // a disabled chip says why and ignores the click (no silent swallow — the reason is visible)
    const fin = within(group).getByRole('button', { name: /FINNIFTY/ });
    expect(fin.getAttribute('aria-disabled')).toBe('true');
    expect(fin.textContent).toMatch(/unavailable: no data/);
    fireEvent.click(fin);
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange.mock.calls[1][0]).not.toContain(F);
    expect(screen.getByText('1 of 6 selected')).toBeTruthy();
  });
});
