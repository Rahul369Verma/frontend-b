/**
 * The per-trade path chart serves both books. A single-leg path carries no
 * gross and is pre-cost; a path rebuilt from the option-chain archive must say
 * so; and a trade with no path must say WHY instead of drawing an empty frame.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TradePathChart from './TradePathChart.jsx';

const at = (min) => new Date(Date.UTC(2026, 8, 28, 4, 0) + min * 60000).toISOString();

const singleLeg = {
    entryAt: at(0),
    exitAt: at(10),
    netPnl: -300,
    maeRupees: -420,
    mfeRupees: 120,
    pathSource: 'archive',
    path: [
        { t: at(0), net: 0, ltp: 136.2 },
        { t: at(1), net: 120, ltp: 137.2 },
        { t: at(2), net: -420, ltp: 132.7 },
        { t: at(9), net: -240, ltp: 134.2 },
    ],
};

describe('TradePathChart', () => {
    it('renders a single-leg (no gross) path with the archive chip and states the exit step', () => {
        render(<TradePathChart trade={singleLeg} />);
        const chip = screen.getByText('rebuilt from archived quotes');
        expect(chip.getAttribute('title')).toMatch(/option-chain archive/);
        expect(chip.getAttribute('title')).toMatch(/Approximate/);
        // No gross series on a single-leg path, so no gross toggle.
        expect(screen.queryByText('gross (pre-cost)')).toBeNull();
        expect(screen.getByText(/4 marks, ~1\/min, pre-cost/)).toBeTruthy();
        // MAE/MFE and the booked figure are shown as rupees.
        expect(screen.getAllByText('-₹420').length).toBeGreaterThan(0);
        expect(screen.getAllByText('-₹300').length).toBeGreaterThan(0);
        // Booked -300 vs last mark -240: the -60 exit step is explained, and for
        // pre-cost marks the cause is charges plus slippage.
        expect(screen.getByText(/Exit step -₹60/)).toBeTruthy();
        expect(screen.getByText(/charges plus fill slippage/)).toBeTruthy();
    });

    it('labels an engine-recorded path as recorded', () => {
        render(<TradePathChart trade={{ ...singleLeg, pathSource: 'recorded' }} />);
        expect(screen.getByText('recorded')).toBeTruthy();
        expect(screen.queryByText('rebuilt from archived quotes')).toBeNull();
    });

    it('keeps the multileg behaviour: gross toggle, net-of-estimated-costs wording', () => {
        const multileg = {
            entryAt: at(0), exitAt: at(5), netPnl: -269.27, maeRupees: -400, mfeRupees: 50,
            path: [
                { t: at(0), net: -40, gross: 0, spot: 54300 },
                { t: at(5), net: -250, gross: -210, spot: 54350 },
            ],
        };
        render(<TradePathChart trade={multileg} />);
        expect(screen.getByText('gross (pre-cost)')).toBeTruthy();
        expect(screen.getByText(/net of estimated costs/)).toBeTruthy();
        expect(screen.getByText(/estimated and actual charges/)).toBeTruthy();
    });

    it('shows the server reason when there is no path, and no chart', () => {
        const { container } = render(
            <TradePathChart trade={{ ...singleLeg, path: null, pathSource: null, pathReason: 'strike not in the archived chain' }} />,
        );
        expect(screen.getByText(/No minute-by-minute P&L path for this trade/)).toBeTruthy();
        expect(screen.getByText('strike not in the archived chain')).toBeTruthy();
        expect(container.querySelector('.recharts-wrapper')).toBeNull();
    });

    it('reads a zone-less timestamp as IST (same parser as the day curves), never the browser zone', () => {
        const bare = {
            ...singleLeg,
            entryAt: '2026-09-28T09:30:00',
            exitAt: '2026-09-28T09:40:00',
            path: [
                { t: '2026-09-28T09:31:00', net: 10 },
                { t: '2026-09-28T09:39:00', net: -20 },
            ],
        };
        render(<TradePathChart trade={bare} />);
        // Entry → Exit stat: 09:30 IST → 09:40 IST whatever TZ the runner is in.
        expect(screen.getByText(/09:30.*→ 09:40/)).toBeTruthy();
    });

    it('treats absent MAE/MFE as absent, not as ₹0', () => {
        render(<TradePathChart trade={{ ...singleLeg, maeRupees: null, mfeRupees: undefined }} />);
        expect(screen.queryByText('₹0')).toBeNull();
    });

    // A loser that was red from the first mark: MFE is floored at 0 by both
    // producers, so "MFE − booked" would call the whole loss a mismanaged winner.
    const neverGreen = {
        entryAt: at(0), exitAt: at(10), netPnl: -258, maeRupees: -300, mfeRupees: 0, pathSource: 'archive',
        path: [
            { t: at(1), net: -40, ltp: 40.07 },
            { t: at(5), net: -300, ltp: 37.9 },
            { t: at(9), net: -96, ltp: 39.6 },
        ],
    };
    const statValue = (label) => screen.getByText(label).nextElementSibling;
    const statTitle = (label) => screen.getByText(label).parentElement.getAttribute('title');

    it('never calls a trade that was never in profit a winner that gave money back', () => {
        render(<TradePathChart trade={neverGreen} />);
        expect(statValue('Gave back').textContent).toBe('never in profit');
        expect(statTitle('Gave back')).toMatch(/never in profit/);
        expect(document.body.textContent).not.toMatch(/earned it/);
        // ₹0 MFE is explained as a floor, with the real best mark named.
        expect(statTitle('MFE (best)')).toMatch(/floored at ₹0/);
        expect(statTitle('MFE (best)')).toMatch(/-₹40/);
    });

    it('computes gave back on the marks\' own basis: pre-cost best mark minus the LAST mark, charges left to the exit step', () => {
        render(<TradePathChart trade={singleLeg} />);
        // best 120 (MFE), last mark -240 → 360 handed back; the -60 to the booked
        // -300 is the exit step (charges + slippage), not part of it.
        expect(statValue('Gave back').textContent).toBe('₹360');
        expect(statTitle('Gave back')).toMatch(/last mark/);
    });

    it('a gross fallback is labelled gross, never "after charges", and its exit step is slippage only', () => {
        render(<TradePathChart trade={{ ...neverGreen, bookedBasis: 'gross' }} />);
        expect(screen.queryByText('Booked net')).toBeNull();
        expect(statValue('Booked gross').textContent).toBe('-₹258');
        expect(statTitle('Booked gross')).toMatch(/BEFORE charges/);
        expect(statTitle('Booked gross')).not.toMatch(/after charges/);
        expect(screen.getByText(/Exit step -₹162: booked gross/).textContent).toMatch(/fill slippage only/);
        expect(document.body.textContent).not.toMatch(/charges plus fill slippage/);
    });

    it('with no booked result, "Booked net" is blank and the last mark is labelled as a mark', () => {
        render(<TradePathChart trade={{ ...neverGreen, netPnl: null }} />);
        expect(statValue('Booked net').textContent).toBe('—');
        expect(statValue('Last mark (pre-cost)').textContent).toBe('-₹96');
        expect(screen.queryByText('Exit step')).toBeNull();
    });

    it('a quarantined (void) fill is never presented as booked', () => {
        const voidTrade = {
            entryAt: at(0), exitAt: at(5), netPnl: 4200, quarantined: true, maeRupees: -400, mfeRupees: 50,
            path: [
                { t: at(0), net: -40, gross: 0, spot: 54300 },
                { t: at(5), net: -250, gross: -210, spot: 54350 },
            ],
        };
        render(<TradePathChart trade={voidTrade} />);
        expect(statValue('Booked net').textContent).toBe('void');
        expect(statTitle('Booked net')).toMatch(/never traded/);
        expect(screen.queryByText('₹4,200')).toBeNull();
        expect(screen.queryByText('Exit step')).toBeNull();
        expect(document.body.textContent).not.toMatch(/actually booked/);
        expect(screen.getByText(/Void fill: this round-trip/)).toBeTruthy();
    });
});
