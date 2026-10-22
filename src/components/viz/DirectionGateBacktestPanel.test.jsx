/**
 * Backtest direction gate: OFF must not change the request; shadow must say what the
 * would-be-blocked trades made; enforce must show the side-by-side and the blocked list.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DirectionGateBacktestPanel, { DirectionGateControls } from './DirectionGateBacktestPanel.jsx';
import { gateParams, GATE_DEFAULTS, settingsToGate } from './directionGateFormat.js';

const settings = { floor: 0.4, probeEvery: 3, halfLifeSessions: 3, minNeff: 3, priorTrades: 4 };

describe('gateParams', () => {
    it('OFF adds nothing to the backtest request', () => {
        expect(gateParams(GATE_DEFAULTS)).toEqual({});
        expect(gateParams(null)).toEqual({});
    });
    it('shadow/enforce send the same keys the live Settings use, as numbers', () => {
        expect(gateParams({ mode: 'enforce', floor: '0.45', halfLife: '5', probeEvery: '4', minNeff: '2' })).toEqual({
            direction_gate_mode: 'enforce', direction_gate_floor: 0.45, direction_gate_half_life: 5, direction_gate_probe_every: 4, direction_gate_min_neff: 2,
            direction_gate_learn_blocked: true,
        });
    });
    it('enforce: blocked trades count unless switched off; shadow blocks nothing so it sends no such key', () => {
        expect(gateParams({ ...GATE_DEFAULTS, mode: 'enforce', learnBlocked: false }).direction_gate_learn_blocked).toBe(false);
        expect('direction_gate_learn_blocked' in gateParams({ ...GATE_DEFAULTS, mode: 'shadow' })).toBe(false);
    });
});

describe('DirectionGateControls', () => {
    it('hides the knobs when off and reports a mode change', () => {
        const onChange = vi.fn();
        render(<DirectionGateControls value={GATE_DEFAULTS} onChange={onChange} />);
        expect(screen.queryByLabelText('floor')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Enforce' }));
        expect(onChange).toHaveBeenCalledWith({ ...GATE_DEFAULTS, mode: 'enforce' });
    });
    it('shows the knobs when on', () => {
        render(<DirectionGateControls value={{ ...GATE_DEFAULTS, mode: 'shadow' }} onChange={() => {}} />);
        expect(screen.getByLabelText('probe every')).toBeTruthy();
        expect(screen.queryByLabelText('blocked trades count')).toBeNull();      // shadow blocks nothing
    });
    it('enforce: the blocked-trades switch is on by default and reports a change', () => {
        const onChange = vi.fn();
        render(<DirectionGateControls value={{ ...GATE_DEFAULTS, mode: 'enforce' }} onChange={onChange} />);
        const box = screen.getByLabelText('blocked trades count');
        expect(box.checked).toBe(true);
        fireEvent.click(box);
        expect(onChange).toHaveBeenCalledWith({ ...GATE_DEFAULTS, mode: 'enforce', learnBlocked: false });
    });
});

describe('DirectionGateBacktestPanel', () => {
    it('shadow: prices the would-be-blocked trades', () => {
        render(<DirectionGateBacktestPanel data={{ mode: 'shadow', settings, decisions: 589, counts: { ALLOW: 412, THIN: 44, PROBE: 34, BLOCK: 99 },
            shadow: { wouldBlock: { n: 81, net: -16391.88 }, savedIfEnforced: 16391.88, note: 'Shadow keeps every trade.' }, blocked: [], blockedTotal: 0, learnsFrom: "this backtest's own closed trades" }} />);
        const s = screen.getByTestId('dir-gate-shadow').textContent;
        expect(s).toMatch(/81 trades would have been blocked/);
        expect(s).toMatch(/would have saved/);
    });
    it('enforce: side-by-side, monthly deltas and the blocked list', () => {
        const comparison = {
            base: { trades: 510, net: 54579, winRate: 0.47, profitFactor: 1.12, maxDrawdown: -54734, CE: { n: 262, net: 51836 }, PE: { n: 248, net: 2742 } },
            gated: { trades: 445, net: 59392, winRate: 0.48, profitFactor: 1.15, maxDrawdown: -41851, CE: { n: 230, net: 50680 }, PE: { n: 215, net: 8712 } },
            delta: { trades: -65, net: 4813 }, months: [{ month: '2026-01', base: 1000, gated: 1500, delta: 500 }], monthsBetter: 1, monthsWorse: 0,
            verdict: 'the gate added ₹4813 over 13 months (better in 5, worse in 6)',
        };
        render(<DirectionGateBacktestPanel data={{ mode: 'enforce', settings, decisions: 626, counts: { BLOCK: 110 }, comparison,
            blocked: [{ at: '2026-01-05T05:30:00Z', side: 'PE', ce: 0.6, pe: 0.3, reason: 'weak side' }], blockedTotal: 110, learnsFrom: 'x' }} />);
        expect(screen.getByTestId('dir-gate-compare').textContent).toMatch(/added ₹4813/);
        expect(screen.getByText('Gate enforced')).toBeTruthy();
        expect(screen.getByText(/Blocked signals \(110, first 1 shown\)/)).toBeTruthy();
    });
    it('enforce: says what each blocked signal would have made, and how the run learned from them', () => {
        render(<DirectionGateBacktestPanel data={{ mode: 'enforce', settings, decisions: 9, counts: { BLOCK: 3 }, comparison: { skipped: 'x' },
            blocked: [
                { at: '2026-01-05T05:30:00Z', side: 'PE', ce: 0.6, pe: 0.3, reason: 'weak side', ghost: 'followed', ghostNet: -2255 },
                { at: '2026-01-05T06:30:00Z', side: 'PE', ce: 0.6, pe: 0.3, reason: 'weak side', ghost: 'unmatched' },
            ], blockedTotal: 2, learnsFrom: 'x',
            learnsFromBlocked: { on: true, followed: 1, followedNet: -2255, unmatched: 1, unavailable: 0, note: '1 blocked signal(s) were followed' } }} />);
        expect(screen.getByText('Would have')).toBeTruthy();
        expect(screen.getByText('no gate-off trade at this candle')).toBeTruthy();
        expect(screen.getByTestId('dir-gate-learns-blocked').textContent).toMatch(/1 blocked signal\(s\) were followed.*would have made/);
    });
    it('enforce with AI on: says why there is no comparison', () => {
        render(<DirectionGateBacktestPanel data={{ mode: 'enforce', settings, decisions: 3, counts: {}, comparison: { skipped: 'AI confirmation/prediction is on' }, blocked: [], blockedTotal: 0, learnsFrom: 'x' }} />);
        expect(screen.getByText(/AI confirmation\/prediction is on/)).toBeTruthy();
    });
});

const sugBase = (rec, extra = {}) => ({
    ok: true, n: 593, split: { trainTrades: 356, testTrades: 237, testFrom: '2026-04-08', baseTrain: 1, baseTest: 1 },
    premise: { n: 589, rho: -0.03, p: 0.762, verdict: "no — a side's recent losses do NOT predict its next trade", holds: false },
    current: { floor: 0.4, halfLifeSessions: 3, probeEvery: 3, minNeff: 3, trainBlocks: 43, testBlocks: 63, trainDelta: 19311.53, testDelta: -3233.06 },
    recommendation: rec,
    diagnosis: [{ key: 'premise', level: 'critical', text: 'Losses do not carry over for this strategy' }],
    top: [{ floor: 0.4, halfLifeSessions: 3, probeEvery: 3, minNeff: 3, trainBlocks: 43, testBlocks: 63, trainDelta: 19311.53, testDelta: -3233.06 }],
    tested: 180, method: 'filter replay', ...extra,
});
const pickA = { floor: 0.4, halfLifeSessions: 3, probeEvery: 3, minNeff: 3, trainBlocks: 43, testBlocks: 63, trainDelta: 19311.53, testDelta: -3233.06, nullP: 0.659 };
const enforceData = (suggestion) => ({ mode: 'enforce', settings, decisions: 3, counts: {}, comparison: { skipped: 'x' }, blocked: [], blockedTotal: 0, learnsFrom: 'x', suggestion });

describe('suggested settings', () => {
    it('settingsToGate maps the tuner keys onto the controls', () => {
        expect(settingsToGate({ floor: 0.25, halfLifeSessions: 10, probeEvery: 2, minNeff: 6 })).toEqual({ mode: 'enforce', floor: 0.25, halfLife: 10, probeEvery: 2, minNeff: 6 });
        expect(settingsToGate(null)).toEqual({ mode: 'off' });
    });
    it('OFF is said plainly, explains why, and its primary action turns the gate off', () => {
        const onApply = vi.fn();
        const rec = { action: 'OFF', settings: { floor: 0.4, halfLifeSessions: 3, probeEvery: 3, minNeff: 3 }, pick: pickA,
            reason: 'the best training setting gained ₹19,312 in training but lost ₹3,233 on the later test period — it was fitting the past' };
        render(<DirectionGateBacktestPanel data={enforceData(sugBase(rec))} onApply={onApply} />);
        const box = screen.getByTestId('dir-gate-suggestion').textContent;
        expect(box).toMatch(/Turn the gate off for this strategy/);
        expect(box).toMatch(/fitting the past/);
        expect(box).toMatch(/Losses do not carry over/);
        expect(box).toMatch(/66% of the time/);
        fireEvent.click(screen.getByRole('button', { name: 'Turn the gate off' }));
        expect(onApply).toHaveBeenLastCalledWith({ mode: 'off' });
        fireEvent.click(screen.getByRole('button', { name: 'Load the training pick anyway' }));
        expect(onApply).toHaveBeenLastCalledWith({ mode: 'enforce', floor: 0.4, halfLife: 3, probeEvery: 3, minNeff: 3 });
    });
    it('USE applies the tuned settings and shows the exact re-run', () => {
        const onApply = vi.fn();
        const rec = { action: 'USE', settings: { floor: 0.45, halfLifeSessions: 10, probeEvery: 3, minNeff: 3 }, pick: { ...pickA, floor: 0.45, halfLifeSessions: 10, testDelta: 5000, nullP: 0.02 },
            reason: 'chosen on the training period, held up on the later test period and beat random skipping (p=0.02)', caution: 'the premise test failed' };
        render(<DirectionGateBacktestPanel data={enforceData(sugBase(rec, { exact: { fullDelta: 4200, testDelta: 3100, trades: 480, verdict: 'the gate added ₹4200 over 13 months (better in 8, worse in 5)' } }))} onApply={onApply} />);
        const box = screen.getByTestId('dir-gate-suggestion').textContent;
        expect(box).toMatch(/Use the gate with these settings/);
        expect(box).toMatch(/Caution: the premise test failed/);
        expect(box).toMatch(/Exact re-run of that pick: the gate added ₹4200/);
        fireEvent.click(screen.getByRole('button', { name: 'Apply these settings' }));
        expect(onApply).toHaveBeenCalledWith({ mode: 'enforce', floor: 0.45, halfLife: 10, probeEvery: 3, minNeff: 3 });
    });
    it('a failed tuning is shown, not hidden', () => {
        render(<DirectionGateBacktestPanel data={enforceData({ ok: false, reason: 'only 12 trades — need at least ~40 to tune anything' })} />);
        expect(screen.getByTestId('dir-gate-suggestion').textContent).toMatch(/only 12 trades/);
    });
});
