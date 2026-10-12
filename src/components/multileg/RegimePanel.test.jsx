/**
 * The regime card must not overstate itself: a symbol without data says why, the
 * direction lean is labelled unreliable, verdicts are shown as shadow, and the
 * scorecard reports the base rate next to the hit rate.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { RegimeView } from './RegimePanel.jsx';
import { bookWarning, shortSym, actionTone } from './regimeFormat.js';

const data = {
    mode: 'shadow', method: 'Pure maths, no AI.',
    profiles: { builtAt: '2026-10-09T13:00:00Z', fingerprints: 2, calibrated: ['NSE:NIFTY50-INDEX'] },
    job: { running: false },
    symbols: [
        { symbol: 'NSE:NIFTY50-INDEX', read: { tier: 'high', label: 'wild-leaning', slot: '11:00', n: 77, probs: { quiet: 0.14, normal: 0.34, wild: 0.52 }, components: { morningRangePct: 0.9, prevRangePct: 0.8, rvRatioPct: 0.7 } },
          lean: { lean: 'down', z: 1.2, note: 'NOT reliable' }, event: { date: '2026-10-09', label: 'RBI policy' } },
        { symbol: 'NSE:FINNIFTY-INDEX', read: { unmeasured: 'no calibration for this symbol yet — rebuild regime profiles' } },
    ],
    book: { PAPER: { structures: 3, delta: -120, vega: -900, theta: 400, shortVol: 3, longVol: 0 } },
    rows: [
        { kind: 'deployment', id: 'd1', name: 'strangle-1100', template: 'short_strangle', symbol: 'NSE:NIFTY50-INDEX', exposure: { direction: 'neutral', vol: 'short volatility' },
          needs: 'best on QUIET days · loses on WILD days', fp: { mean: 1283, byTier: { quiet: { mean: 2188 }, normal: { mean: 1153 }, wild: { mean: -511 } } }, fit: { action: 'HALF', expected: 640, reason: 'wild-leaning read' } },
        { kind: 'strategy', id: 'strategy:s1', name: 'bull put', template: 'bull_put_spread', symbol: 'NSE:NIFTY50-INDEX', exposure: { direction: 'bullish', vol: 'short volatility' },
          needs: 'loses on average in every volatility regime — only works when the market goes UP', fp: null, fit: { action: 'STAND_ASIDE', expected: -300 } },
    ],
    scorecard: {
        calibration: { scored: 12, pending: 2, wildAfterWildRead: 0.5, quietAfterQuietRead: 0.6, brier: 0.6, brierNoSkill: 0.67, verdict: 'only 12 scored reads — too few to judge (need ~20+)' },
        verdicts: { byAction: { HALF: { n: 2, net: -3000 } }, unrecorded: 5, halfSizeEffect: 1500, standAsideEffect: 0 },
    },
};

describe('RegimeView', () => {
    it('shows a read, says why another symbol has none, and labels the lean unreliable', () => {
        render(<RegimeView data={data} onMode={() => {}} onRebuild={() => {}} />);
        const nifty = screen.getByTestId('read-NIFTY50');
        expect(within(nifty).getByText('wild-leaning')).toBeTruthy();
        expect(nifty.textContent).toMatch(/not reliable, display only/);
        expect(nifty.textContent).toMatch(/Event day: RBI policy/);
        expect(within(screen.getByTestId('read-FINNIFTY')).getByText(/rebuild regime profiles/)).toBeTruthy();
    });
    it('warns when short-vol structures are open into a wild read', () => {
        render(<RegimeView data={data} onMode={() => {}} onRebuild={() => {}} />);
        expect(screen.getByTestId('book').textContent).toMatch(/3 short-volatility structures open while NIFTY50 reads wild-leaning/);
    });
    it('shows deployed by default and saved strategies on request', () => {
        render(<RegimeView data={data} onMode={() => {}} onRebuild={() => {}} />);
        expect(screen.getByText('strangle-1100')).toBeTruthy();
        expect(screen.queryByText('bull put')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
        expect(screen.getByText('bull put')).toBeTruthy();
        expect(screen.getByText('STAND ASIDE')).toBeTruthy();
    });
    it('scorecard puts the base rate next to the hit rate and says when it is too early', () => {
        render(<RegimeView data={data} onMode={() => {}} onRebuild={() => {}} />);
        const sc = screen.getByTestId('scorecard');
        expect(sc.textContent).toMatch(/base 33%/);
        expect(sc.textContent).toMatch(/too few to judge/);
        expect(sc.textContent).toMatch(/Half-size on HALF trades would have changed P&L by \+₹1,500/);
    });
    it('only offers off and shadow — no enforce', () => {
        const onMode = vi.fn();
        render(<RegimeView data={data} onMode={onMode} onRebuild={() => {}} />);
        expect(screen.queryByRole('button', { name: /enforce/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Off' }));
        expect(onMode).toHaveBeenCalledWith('off');
    });
    it('narrow layout renders cards instead of the table', () => {
        render(<RegimeView data={data} onMode={() => {}} onRebuild={() => {}} narrow />);
        expect(screen.queryByRole('table')).toBeNull();
        expect(screen.getByText('strangle-1100')).toBeTruthy();
    });
});

describe('regimeFormat', () => {
    it('helpers', () => {
        expect(shortSym('BSE:SENSEX-INDEX')).toBe('SENSEX');
        expect(actionTone('HALF')).toBe('warning');
        expect(bookWarning({ PAPER: { shortVol: 0 } }, data.symbols)).toBe(null);
    });
});
