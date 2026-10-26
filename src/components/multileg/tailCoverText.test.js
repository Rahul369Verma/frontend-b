import { describe, it, expect } from 'vitest';
import { tailCoverText } from './tailCoverText.js';

const STOPS = {
    capsTail: true, settings: { leg_sl_x: 1.48, sl_x_credit: 1.5, sl_pct_debit: 0, max_loss_rupees: 0 },
    legStops: [{ type: 'CE', strike: 22700, entry: 160.3, stopAt: 237.24 }, { type: 'PE', strike: 22600, entry: 105, stopAt: 155.4 }],
    structureStopRupees: -8622, maxLossRupees: null,
};

describe('deploy preview: what bounds a naked short', () => {
    it('both stops set: says where each fires, not that they are missing (the 23-Oct confusion)', () => {
        const t = tailCoverText({ unbounded: true, stops: STOPS });
        expect(t.tone).toBe('warning');
        expect(t.text).toContain('1.48× its entry (22700 CE at ₹237.2 · 22600 PE at ₹155.4)');
        expect(t.text).toContain('closes at −₹8,622 (sl_x_credit 1.5)');
        expect(t.text).not.toMatch(/unless|UNDEFINED/);
    });
    it('a stop missing: names it, in red', () => {
        const t = tailCoverText({ unbounded: true, stops: { ...STOPS, capsTail: false, settings: { ...STOPS.settings, sl_x_credit: 0 } } });
        expect(t.tone).toBe('danger');
        expect(t.text).toMatch(/is missing a structure stop \(sl_x_credit > 1\)\. The engine will refuse/);
        expect(t.text).not.toContain('leg stop');
    });
    it('a rupee stop is listed too; a bounded payoff says nothing; an older backend keeps the old warning', () => {
        expect(tailCoverText({ unbounded: true, stops: { ...STOPS, maxLossRupees: -3000 } }).text).toContain('or at −₹3,000 net (rupee stop)');
        expect(tailCoverText({ unbounded: false, stops: STOPS })).toBe(null);
        expect(tailCoverText({ unbounded: true }).tone).toBe('danger');
    });
});
