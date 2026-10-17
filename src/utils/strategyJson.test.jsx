import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
    buildStrategyJson, strategyJsonText, parseStrategyJson, diffSettings, jsonFileName, STRATEGY_JSON_FORMAT,
} from './strategyJson.js';
import StrategyJsonControls from '../components/backtest/StrategyJsonControls.jsx';
import CrossIndexResults from '../components/optimizer/CrossIndexResults.jsx';

// User, 17-Oct-2026: export the current Backtester settings as JSON, import JSON,
// and copy any Optimizer result (index cards, By-index rows, old runs) as JSON
// the Backtester imports.

const CURRENT = { strategy: 'universal', symbol: 'NSE:NIFTYBANK-INDEX', resolution: '5', start_date: '2025-01-01', end_date: '2026-10-16', capital: 100000, ema_fast: 9, use_trend_filter: true };
const KNOWN = ['universal', 'breakout_range', 'hybrid_inside_bar'];

describe('strategyJson', () => {
    it('round-trips: what Copy writes, Import reads back unchanged (bookkeeping fields dropped)', () => {
        const j = buildStrategyJson({ ...CURRENT, _id: 'x', __v: 0, createdAt: 'y' }, { source: 'backtest' });
        expect(j.format).toBe(STRATEGY_JSON_FORMAT);
        expect(j.strategy).toBe('universal');
        expect(j.settings._id).toBeUndefined();
        const back = parseStrategyJson(strategyJsonText(j), { knownStrategies: KNOWN });
        expect(back.ok).toBe(true);
        expect(back.settings).toEqual(CURRENT);
        expect(back.meta.source).toBe('backtest');
    });
    it('accepts the shapes that already exist: Optimizer hand-off, a saved strategy, plain settings, class names', () => {
        const handoff = parseStrategyJson(JSON.stringify({ symbol: 'NSE:NIFTY50-INDEX', strategy: 'BreakoutRangeStrategy', resolution: '1', params: { min_sl_points: 17, lot_size: 65 } }), { knownStrategies: KNOWN });
        expect(handoff.settings).toMatchObject({ strategy: 'breakout_range', symbol: 'NSE:NIFTY50-INDEX', resolution: '1', min_sl_points: 17, lot_size: 65 });
        const saved = parseStrategyJson(JSON.stringify({ _id: 'a', name: 'my set', strategyName: 'hybrid_inside_bar', symbol: 'NSE:MIDCPNIFTY-INDEX', params: { x: 1 } }), { knownStrategies: KNOWN });
        expect(saved.settings).toEqual({ strategy: 'hybrid_inside_bar', symbol: 'NSE:MIDCPNIFTY-INDEX', x: 1 });
        const plain = parseStrategyJson(JSON.stringify({ strategy: 'universal', ema_fast: 12 }));
        expect(plain.ok).toBe(true);
        expect(plain.warnings.join(' ')).toMatch(/No symbol/);
    });
    it('says plainly what is wrong', () => {
        expect(parseStrategyJson('').error).toMatch(/Paste/);
        expect(parseStrategyJson('{ nope').error).toMatch(/not valid JSON/);
        expect(parseStrategyJson('[1,2]').error).toMatch(/one JSON object/);
        expect(parseStrategyJson('{"ema_fast": 9}').error).toMatch(/No strategy/);
        expect(parseStrategyJson('{"strategy":"made_up"}', { knownStrategies: KNOWN }).error).toMatch(/does not know the strategy "made_up"/);
        expect(parseStrategyJson(JSON.stringify({ format: STRATEGY_JSON_FORMAT, version: 9, strategy: 'universal', settings: {} })).warnings.join(' ')).toMatch(/newer version/);
    });
    it('lists exactly what changes, strategy and symbol first', () => {
        const d = diffSettings(CURRENT, { ema_fast: 21, strategy: 'breakout_range', symbol: 'NSE:NIFTY50-INDEX', capital: '100000' });
        expect(d.map((x) => x.key)).toEqual(['strategy', 'symbol', 'ema_fast']);   // "100000" == 100000 → no change
        expect(jsonFileName({ strategy: 'universal', symbol: 'NSE:NIFTYBANK-INDEX', exportedAt: '2026-10-17T05:00:00Z' })).toBe('universal-NIFTYBANK-2026-10-17.json');
    });
});

describe('Backtest — StrategyJsonControls', () => {
    beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } }); });

    it('Copy JSON puts every current setting on the clipboard', async () => {
        render(<StrategyJsonControls params={CURRENT} onImport={() => {}} knownStrategies={KNOWN} />);
        fireEvent.click(screen.getByRole('button', { name: /Copy JSON/ }));
        await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
        const j = JSON.parse(navigator.clipboard.writeText.mock.calls[0][0]);
        expect(j.settings).toEqual(CURRENT);
    });

    it('Import JSON previews the changes and loads only on "Load into Backtest"', () => {
        const onImport = vi.fn();
        render(<StrategyJsonControls params={CURRENT} onImport={onImport} knownStrategies={KNOWN} />);
        fireEvent.click(screen.getByRole('button', { name: /Import JSON/ }));
        const dlg = screen.getByRole('dialog');
        const incoming = buildStrategyJson({ ...CURRENT, strategy: 'breakout_range', symbol: 'NSE:NIFTY50-INDEX', ema_fast: 21 }, { source: 'optimizer', results: { verdict: 'held up', testPnL: 20794, testPF: 4.23, testTrades: 21 } });
        fireEvent.change(within(dlg).getByLabelText('Strategy JSON'), { target: { value: strategyJsonText(incoming) } });
        const pv = within(dlg).getByTestId('import-preview');
        expect(pv.textContent).toMatch(/3 settings will change/);
        expect(pv.textContent).toMatch(/test P&L ₹20,794 · test PF 4.23 · 21 test trades/);
        fireEvent.click(within(dlg).getByRole('button', { name: /Show changes/ }));
        expect(within(dlg).getByTestId('import-changes').textContent).toMatch(/strategy: universal → breakout_range/);
        expect(onImport).not.toHaveBeenCalled();
        fireEvent.click(within(dlg).getByRole('button', { name: 'Load into Backtest' }));
        expect(onImport.mock.calls[0][0]).toMatchObject({ strategy: 'breakout_range', symbol: 'NSE:NIFTY50-INDEX', ema_fast: 21 });
    });

    it('with the page\'s rebuild rule, the old strategy\'s parameters are listed as cleared and the symbol is kept', () => {
        const onImport = vi.fn();
        const SYSTEM = ['symbol', 'resolution', 'start_date', 'end_date', 'capital'];
        const buildNext = (cur, s) => ({ ...Object.fromEntries(SYSTEM.filter((k) => cur[k] !== undefined).map((k) => [k, cur[k]])), ...s });
        render(<StrategyJsonControls params={CURRENT} onImport={onImport} knownStrategies={KNOWN} buildNext={buildNext} />);
        fireEvent.click(screen.getByRole('button', { name: /Import JSON/ }));
        fireEvent.change(screen.getByLabelText('Strategy JSON'), { target: { value: JSON.stringify({ strategy: 'breakout_range', range_minutes: 30 }) } });
        expect(screen.getByTestId('import-preview').textContent).toMatch(/2 settings will change, 2 cleared/);
        fireEvent.click(screen.getByRole('button', { name: /Show changes/ }));
        expect(screen.getByTestId('import-changes').textContent).toMatch(/ema_fast: 9 → cleared/);
        fireEvent.click(screen.getByRole('button', { name: 'Load into Backtest' }));
        const next = onImport.mock.calls[0][0];
        expect(next).toEqual({ symbol: 'NSE:NIFTYBANK-INDEX', resolution: '5', start_date: '2025-01-01', end_date: '2026-10-16', capital: 100000, strategy: 'breakout_range', range_minutes: 30 });
    });

    it('a bad JSON cannot be loaded', () => {
        render(<StrategyJsonControls params={CURRENT} onImport={() => {}} knownStrategies={KNOWN} />);
        fireEvent.click(screen.getByRole('button', { name: /Import JSON/ }));
        fireEvent.change(screen.getByLabelText('Strategy JSON'), { target: { value: '{"strategy":"made_up"}' } });
        expect(screen.getByRole('alert').textContent).toMatch(/does not know/);
        expect(screen.getByRole('button', { name: 'Load into Backtest' })).toBeDisabled();
    });
});

describe('Optimizer — Copy JSON on an index card', () => {
    const N = 'NSE:NIFTY50-INDEX', B = 'NSE:NIFTYBANK-INDEX';
    const cell = { status: 'robust', oosPF: 4.23, oosTrades: 21, oosPnL: 20794, oosWinRate: 71.4, fullPnL: 93566, fullTrades: 81, minSlPoints: 17 };
    const result = {
        type: 'multi_index_optimization_result', jobId: 'j', seed: 1, nEligible: 2, kDefault: 2, symbols: [N, B],
        runConfig: { shared: { start_date: '2025-06-16', end_date: '2026-02-19', oos_split_date: '2025-12-04', oos_fraction: 0.3, dataSource: 'ARCHIVE_SPOT', resolution: '5', capital: 100000, backtest_mode: 'Simulated Premium' },
            perSymbol: { [N]: { eligible: true, lot_size: 65 }, [B]: { eligible: true, lot_size: 30 } }, warnings: [] },
        excluded: [], indexes: [], incomplete: [], truncated: [],
        aggregate: [{ strategy: 'breakout_range', label: 'Breakout Range', drawId: 1, robustCount: 2, kValues: { 2: 0.9 }, params: { range_minutes: 30, symbols: ['x'] }, perSymbol: { [N]: cell, [B]: { ...cell, minSlPoints: 29 } } }],
        sharedWinner: null,
    };
    beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } }); });

    it('copies exactly what "Test" sends for that index, importable by the Backtester', async () => {
        const onTest = vi.fn();
        render(<CrossIndexResults result={result} onTest={onTest} onSave={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Expand Breakout Range/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Copy strategy JSON for NIFTY' }));
        await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
        const j = JSON.parse(navigator.clipboard.writeText.mock.calls[0][0]);
        expect(j.format).toBe(STRATEGY_JSON_FORMAT);
        expect(j.settings).toMatchObject({ strategy: 'breakout_range', symbol: N, lot_size: 65, min_sl_points: 17, range_minutes: 30, resolution: '5', start_date: '2025-06-16' });
        expect(j.settings.symbols).toBeUndefined();   // run orchestration never travels
        expect(j.results).toMatchObject({ testPnL: 20794, testPF: 4.23, testTrades: 21 });
        // the same settings the Test button sends
        fireEvent.click(screen.getAllByRole('button', { name: /^Test$/ })[0]);
        expect(onTest.mock.calls[0][0]).toMatchObject({ symbol: N, lot_size: 65, min_sl_points: 17 });
        const back = parseStrategyJson(navigator.clipboard.writeText.mock.calls[0][0]);
        expect(back.ok).toBe(true);
        expect(back.settings.symbol).toBe(N);
    });
});
