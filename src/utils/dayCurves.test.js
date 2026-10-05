import { describe, it, expect } from 'vitest';
import {
    buildDayCurves, normalizeSingleLegTrade, normalizeMultilegTrade, toMs, istDayOf, istWeekday,
    istDayStartMs, singleLegVoidReason, dayPnlPartial,
} from './dayCurves.js';

// ── helpers ──────────────────────────────────────────────────────────────────
/** An IST wall-clock instant as epoch ms — written with an explicit +05:30 so
 *  the test never depends on the machine's timezone. */
const ist = (day, hhmm, ss = '00') => Date.parse(`${day}T${hhmm}:${ss}+05:30`);
const iso = (ms) => new Date(ms).toISOString();

/** A NormTrade built directly (for the math tests). */
const nt = (over) => ({
    id: 't', label: 't', entryMs: null, exitMs: null, bookedNet: null, path: null, pathSource: null, ...over,
});
/** marks from [hhmm, net] pairs on one IST day. */
const marks = (day, pairs) => pairs.map(([hhmm, net]) => ({ ms: ist(day, hhmm), net }));

/** pnl of the curve at exactly instant ms (must be a sample point). */
const at = (dayCurve, ms) => {
    const p = dayCurve.points.find((q) => q.ms === ms);
    if (!p) throw new Error(`no point at ${iso(ms)}`);
    return p.pnl;
};
const dayOf = (res, day) => res.days.find((d) => d.day === day);

const D1 = '2026-09-28'; // Monday
const D2 = '2026-09-29'; // Tuesday

// A realistic closed trade_history row (fields as served by GET /api/trades).
const singleDoc = (over = {}) => ({
    _id: '66f2a0c1e4b0a1b2c3d4e5f6',
    tradingsymbol: 'NSE:BANKNIFTY26SEP54300PE',
    symbol: 'NSE:BANKNIFTY26SEP54300PE',
    spotSymbol: 'NSE:NIFTYBANK-INDEX',
    side: 'PUT', // the OPTION TYPE, not short
    type: 'PE',
    quantity: 120,
    entryPrice: 40.4,
    exitPrice: 39.6,
    entryTime: iso(ist(D1, '10:00')),
    exitTime: iso(ist(D1, '10:30')),
    pnl: -258,
    gross_pnl: -258,
    net_pnl: -331.42,
    charges: { total: 73.42 },
    status: 'CLOSED',
    action: 'ENTRY', // stays ENTRY after the close — must not be read as open
    ...over,
});

// A realistic multileg_trades row (GET /api/multileg/trades).
const multiDoc = (over = {}) => ({
    _id: '66f2b111e4b0a1b2c3d4e5f7',
    deploymentId: 'dep-1',
    template: 'iron_condor',
    symbol: 'NSE:NIFTY50-INDEX',
    trade_mode: 'PAPER',
    entryAt: iso(ist(D1, '09:30')),
    exitAt: iso(ist(D1, '15:20')),
    grossPnl: -180,
    charges: 89.27,
    netPnl: -269.27,
    holdHours: 5.83,
    maeRupees: -400,
    mfeRupees: 120,
    // deliberately out of order + a recorder gap
    path: [
        { t: iso(ist(D1, '15:19')), net: -250, gross: -170, spot: 25010 },
        { t: iso(ist(D1, '09:31')), net: -60, gross: 20, spot: 25000 },
        { t: iso(ist(D1, '12:00')), net: null, gross: null, spot: 25040 },
        { t: iso(ist(D1, '12:01')), net: 120, gross: 200, spot: 25050 },
    ],
    ...over,
});

// ── normalizers ──────────────────────────────────────────────────────────────
describe('normalizeSingleLegTrade', () => {
    it('reads a realistic closed row: side PUT is the option type, net_pnl is the booked result', () => {
        const n = normalizeSingleLegTrade(singleDoc());
        expect(n).toMatchObject({
            id: '66f2a0c1e4b0a1b2c3d4e5f6',
            label: 'BANKNIFTY26SEP54300PE · PUT',
            entryMs: ist(D1, '10:00'),
            exitMs: ist(D1, '10:30'),
            bookedNet: -331.42, // NOT the naive (39.6-40.4)*120 = -96 from decision prices
            bookedBasis: 'net',
            path: null,
            pathSource: null,
        });
        expect(n.label).not.toMatch(/short/i); // missing direction = an option BUY
    });

    it('falls back to pnl only when net_pnl is absent, and says so', () => {
        const n = normalizeSingleLegTrade(singleDoc({ net_pnl: undefined }));
        expect(n.bookedNet).toBe(-258);
        expect(n.bookedBasis).toBe('gross');
        // null / '' are ABSENT, not zero
        expect(normalizeSingleLegTrade(singleDoc({ net_pnl: null })).bookedNet).toBe(-258);
        expect(normalizeSingleLegTrade(singleDoc({ net_pnl: '' })).bookedNet).toBe(-258);
        const none = normalizeSingleLegTrade(singleDoc({ net_pnl: null, pnl: null, gross_pnl: undefined }));
        expect(none.bookedNet).toBeNull();
        expect(none.bookedBasis).toBeNull();
        // a real zero IS a value
        expect(normalizeSingleLegTrade(singleDoc({ net_pnl: 0 })).bookedNet).toBe(0);
    });

    it('labels weekly contracts and CALLs, and only says "short" for direction -1', () => {
        const weekly = normalizeSingleLegTrade(singleDoc({
            tradingsymbol: 'NSE:NIFTY2692924000CE', side: 'CALL', type: 'CE', direction: 1,
        }));
        expect(weekly.label).toBe('NIFTY2692924000CE · CALL');
        const noSide = normalizeSingleLegTrade(singleDoc({ side: undefined, type: 'PE' }));
        expect(noSide.label).toBe('BANKNIFTY26SEP54300PE · PUT');
        const short = normalizeSingleLegTrade(singleDoc({ direction: -1 }));
        expect(short.label).toBe('BANKNIFTY26SEP54300PE · short PUT');
    });

    it('splits open/closed by status, never by action', () => {
        const open = normalizeSingleLegTrade(singleDoc({ status: 'OPEN', exitTime: undefined, net_pnl: undefined, pnl: 0 }));
        expect(open.exitMs).toBeNull();
        // status OPEN wins even if an exitTime leaked onto the row
        expect(normalizeSingleLegTrade(singleDoc({ status: 'OPEN' })).exitMs).toBeNull();
        // CLOSED without a readable exit time is corrupt, not open
        expect(Number.isNaN(normalizeSingleLegTrade(singleDoc({ exitTime: undefined })).exitMs)).toBe(true);
        expect(Number.isNaN(normalizeSingleLegTrade(singleDoc({ exitTime: 'yesterday' })).exitMs)).toBe(true);
    });

    it('keeps a recorded path (gross MTM marks), sorted, and honours an archive pathSource', () => {
        const path = [
            { t: iso(ist(D1, '10:02')), ltp: 41.9, net: 180, spot: 54310 },
            { t: iso(ist(D1, '10:01')), ltp: 41.0, net: 72, spot: 54300 },
            { t: iso(ist(D1, '10:03')), ltp: null, net: null, spot: 54320 }, // gap — skipped
        ];
        const rec = normalizeSingleLegTrade(singleDoc({ path }));
        expect(rec.pathSource).toBe('recorded');
        expect(rec.path).toEqual([{ ms: ist(D1, '10:01'), net: 72 }, { ms: ist(D1, '10:02'), net: 180 }]);
        const arc = normalizeSingleLegTrade(singleDoc({ path, pathSource: 'archive' }));
        expect(arc.pathSource).toBe('archive');
        const refused = normalizeSingleLegTrade(singleDoc({ pathSource: null, pathReason: 'strike not in archived chain' }));
        expect(refused.path).toBeNull();
        expect(refused.pathSource).toBeNull();
        expect(refused.pathReason).toBe('strike not in archived chain');
        const allGaps = normalizeSingleLegTrade(singleDoc({ path: [{ t: iso(ist(D1, '10:01')), net: null }] }));
        expect(allGaps.path).toBeNull();
        expect(allGaps.pathReason).toBe('path had no usable marks');
    });

    it('returns null only for input that is not an object', () => {
        expect(normalizeSingleLegTrade(null)).toBeNull();
        expect(normalizeSingleLegTrade(undefined)).toBeNull();
        expect(normalizeSingleLegTrade('trade')).toBeNull();
        const bad = normalizeSingleLegTrade({ entryTime: 'garbage' });
        expect(bad).not.toBeNull();
        expect(Number.isNaN(bad.entryMs)).toBe(true);
    });
});

describe('normalizeMultilegTrade', () => {
    it('reads a realistic structure: netPnl booked, template · symbol label, path sorted, null net skipped', () => {
        const n = normalizeMultilegTrade(multiDoc());
        expect(n).toMatchObject({
            id: '66f2b111e4b0a1b2c3d4e5f7',
            label: 'iron_condor · NIFTY50',
            entryMs: ist(D1, '09:30'),
            exitMs: ist(D1, '15:20'),
            bookedNet: -269.27,
            bookedBasis: 'net',
            pathSource: 'recorded',
            quarantined: false,
        });
        expect(n.path.map((p) => p.net)).toEqual([-60, 120, -250]);
        expect(n.path.map((p) => p.ms)).toEqual([ist(D1, '09:31'), ist(D1, '12:01'), ist(D1, '15:19')]);
    });

    it('a quarantined fill has no booked number (counted, not curved)', () => {
        const n = normalizeMultilegTrade(multiDoc({ quarantined: true }));
        expect(n.bookedNet).toBeNull();
        const res = buildDayCurves([n]);
        expect(res.days).toHaveLength(0);
        expect(res.excluded).toEqual({ noExit: 0, noBooked: 1, invalidTime: 0 });
    });

    it('falls back to name, then deploymentId+entryAt for the id', () => {
        const n = normalizeMultilegTrade(multiDoc({ _id: undefined, template: undefined, name: 'NIFTY condor', symbol: 'BSE:BANKEX-INDEX' }));
        expect(n.label).toBe('NIFTY condor · BANKEX');
        expect(n.id).toBe(`dep-1-${iso(ist(D1, '09:30'))}`);
        expect(normalizeMultilegTrade(null)).toBeNull();
    });

    it('the exit step is booked net minus the last mark (-269.27 vs -250)', () => {
        const res = buildDayCurves([normalizeMultilegTrade(multiDoc())]);
        const d = dayOf(res, D1);
        expect(at(d, ist(D1, '15:19'))).toBe(-250);
        expect(at(d, ist(D1, '15:20'))).toBe(-269.27);
        expect(at(d, ist(D1, '12:00'))).toBe(-60); // the null mark at 12:00 is skipped, not ₹0
        expect(at(d, ist(D1, '12:01'))).toBe(120);
        expect(d.total).toBe(-269.27);
        expect(d.coverage).toEqual({ trades: 1, marked: 1, bookedOnly: 0 });
    });
});

// ── the curve math ───────────────────────────────────────────────────────────
describe('buildDayCurves — one intraday day', () => {
    it('booked-only single-leg trades: starts at 0 at 09:15 IST, steps at each exit, ends at the sum', () => {
        const a = normalizeSingleLegTrade(singleDoc());
        const b = normalizeSingleLegTrade(singleDoc({
            _id: 'b', entryTime: iso(ist(D1, '11:00')), exitTime: iso(ist(D1, '12:00')), net_pnl: 500.5,
        }));
        const res = buildDayCurves([a, b]);
        expect(res.days).toHaveLength(1);
        const d = res.days[0];
        expect(d.day).toBe(D1);
        expect(d.startMs).toBe(ist(D1, '09:15'));
        expect(d.endMs).toBe(ist(D1, '15:40'));
        expect(d.points[0]).toEqual({ ms: ist(D1, '09:15'), pnl: 0 });
        expect(at(d, ist(D1, '10:29'))).toBe(0);
        expect(at(d, ist(D1, '10:30'))).toBe(-331.42);
        expect(at(d, ist(D1, '11:59'))).toBe(-331.42);
        expect(at(d, ist(D1, '12:00'))).toBe(169.08);
        expect(d.points[d.points.length - 1]).toEqual({ ms: ist(D1, '15:40'), pnl: 169.08 });
        expect(d.total).toBe(169.08);
        expect(d.coverage).toEqual({ trades: 2, marked: 0, bookedOnly: 2 });
        expect(res.excluded).toEqual({ noExit: 0, noBooked: 0, invalidTime: 0 });
        expect(res.bookedBasis).toEqual({ net: 2, grossFallback: 0 });
        expect(d.trades.map((t) => t.contribution)).toEqual([-331.42, 500.5]);
        expect(d.trades.every((t) => !t.carriedIn && !t.carriedOut && !t.marked)).toBe(true);
    });

    it('a trade without a path is ONE step at its exit and nothing else', () => {
        const res = buildDayCurves([nt({ id: 'x', entryMs: ist(D1, '10:00'), exitMs: ist(D1, '11:00'), bookedNet: 75 })]);
        const d = res.days[0];
        let steps = 0;
        for (let i = 1; i < d.points.length; i++) if (d.points[i].pnl !== d.points[i - 1].pnl) steps++;
        expect(steps).toBe(1);
        expect(at(d, ist(D1, '11:00'))).toBe(75);
        expect(d.coverage.bookedOnly).toBe(1);
        expect(d.trades[0].marked).toBe(false);
    });

    it('a trade with a path follows its marks, then steps to bookedNet at the exit', () => {
        const trade = nt({
            id: 'p', entryMs: ist(D1, '10:00'), exitMs: ist(D1, '10:05', '30'), bookedNet: 60, pathSource: 'recorded',
            path: [
                { ms: ist(D1, '10:01'), net: 50 },
                { ms: ist(D1, '10:02'), net: null }, // recorder gap — must NOT read as 0
                { ms: ist(D1, '10:03'), net: 120 },
                { ms: ist(D1, '10:04'), net: 90 },
            ],
        });
        const d = buildDayCurves([trade]).days[0];
        expect(at(d, ist(D1, '10:00'))).toBe(0); // no mark yet
        expect(at(d, ist(D1, '10:01'))).toBe(50);
        expect(at(d, ist(D1, '10:02'))).toBe(50);
        expect(at(d, ist(D1, '10:03'))).toBe(120);
        expect(at(d, ist(D1, '10:04'))).toBe(90);
        expect(at(d, ist(D1, '10:05'))).toBe(90);
        // exit is at 10:05:30 — off the minute grid, but sampled exactly
        expect(at(d, ist(D1, '10:05', '30'))).toBe(60);
        expect(at(d, ist(D1, '10:06'))).toBe(60);
        expect(d.total).toBe(60);
        expect(d.coverage).toEqual({ trades: 1, marked: 1, bookedOnly: 0 });
        expect(d.trades[0]).toMatchObject({ marked: true, pathSource: 'recorded', contribution: 60 });
    });

    it('overlapping trades sum at every instant', () => {
        const a = nt({
            id: 'a', label: 'A', entryMs: ist(D1, '09:30'), exitMs: ist(D1, '11:00'), bookedNet: 400,
            path: marks(D1, [['09:45', 100], ['10:15', 300], ['10:45', 450]]),
        });
        const b = nt({ id: 'b', label: 'B', entryMs: ist(D1, '10:00'), exitMs: ist(D1, '10:30'), bookedNet: -150 });
        const d = buildDayCurves([b, a]).days[0];
        expect(at(d, ist(D1, '09:44'))).toBe(0);
        expect(at(d, ist(D1, '09:45'))).toBe(100);
        expect(at(d, ist(D1, '10:15'))).toBe(300);
        expect(at(d, ist(D1, '10:30'))).toBe(150); // 300 + (-150)
        expect(at(d, ist(D1, '10:45'))).toBe(300); // 450 - 150
        expect(at(d, ist(D1, '11:00'))).toBe(250); // 400 - 150
        expect(d.total).toBe(250);
        expect(d.trades.map((t) => t.id)).toEqual(['a', 'b']); // by entry time
        expect(d.markers.map((m) => `${m.kind}:${m.id}`)).toEqual(['entry:a', 'entry:b', 'exit:b', 'exit:a']);
        expect(d.coverage).toEqual({ trades: 2, marked: 1, bookedOnly: 1 });
    });

    it('points are strictly ascending and include exact entry/exit instants off the grid', () => {
        const entry = ist(D1, '10:00', '17.500');
        const exit = ist(D1, '13:41', '09.250');
        const d = buildDayCurves([nt({ entryMs: entry, exitMs: exit, bookedNet: 10 })]).days[0];
        for (let i = 1; i < d.points.length; i++) expect(d.points[i].ms).toBeGreaterThan(d.points[i - 1].ms);
        expect(d.points.some((p) => p.ms === entry)).toBe(true);
        expect(d.points.some((p) => p.ms === exit)).toBe(true);
        expect(d.markers).toEqual([
            { ms: entry, kind: 'entry', id: 't', label: 't' },
            { ms: exit, kind: 'exit', id: 't', label: 't' },
        ]);
        // 09:15..15:40 at 1 min = 386 grid points, plus the two event instants
        expect(d.points).toHaveLength(386 + 2);
    });

    it('stepMin coarsens the grid, aligned to 09:15 IST', () => {
        const d = buildDayCurves([nt({ entryMs: ist(D1, '10:02'), exitMs: ist(D1, '10:07'), bookedNet: 1 })], { stepMin: 5 }).days[0];
        const ms = d.points.map((p) => p.ms);
        expect(ms).toContain(ist(D1, '10:00'));
        expect(ms).toContain(ist(D1, '10:05'));
        expect(ms).toContain(ist(D1, '10:02'));
        expect(ms).toContain(ist(D1, '10:07'));
        expect(ms).not.toContain(ist(D1, '10:01'));
    });
});

describe('buildDayCurves — positions carried across days', () => {
    // Entered D1 14:00, last D1 mark +400 at 15:30; D2 opens with a gap to +250
    // at 09:16, rallies to +300, exits 10:30 booked +280.
    const carried = nt({
        id: 'ml', label: 'iron_condor · NIFTY50', entryMs: ist(D1, '14:00'), exitMs: ist(D2, '10:30'), bookedNet: 280,
        pathSource: 'recorded',
        path: [
            ...marks(D1, [['14:01', 50], ['14:30', 200], ['15:00', 350], ['15:30', 400]]),
            ...marks(D2, [['09:16', 250], ['10:00', 300]]),
        ],
    });

    it('day 1 books the mark at its close; day 2 books bookedNet minus that mark', () => {
        const res = buildDayCurves([carried]);
        expect(res.days.map((d) => d.day)).toEqual([D2, D1]); // newest first
        const d1 = dayOf(res, D1), d2 = dayOf(res, D2);
        expect(d1.total).toBe(400);
        expect(d2.total).toBe(-120);
        expect(d1.total + d2.total).toBe(280); // INVARIANT
        expect(d1.trades[0]).toMatchObject({ carriedIn: false, carriedOut: true, contribution: 400, marked: true });
        expect(d2.trades[0]).toMatchObject({ carriedIn: true, carriedOut: false, contribution: -120, marked: true });
        // markers: day 1 shows only the entry, day 2 only the exit
        expect(d1.markers.map((m) => m.kind)).toEqual(['entry']);
        expect(d2.markers.map((m) => m.kind)).toEqual(['exit']);
    });

    it('the overnight gap lands at day 2\'s first mark, not at the open', () => {
        const d2 = dayOf(buildDayCurves([carried]), D2);
        expect(at(d2, ist(D2, '09:15'))).toBe(0);
        expect(at(d2, ist(D2, '09:16'))).toBe(-150); // 250 - 400
        expect(at(d2, ist(D2, '10:00'))).toBe(-100); // 300 - 400
        expect(at(d2, ist(D2, '10:29'))).toBe(-100);
        expect(at(d2, ist(D2, '10:30'))).toBe(-120); // 280 - 400: the exit step
    });

    it('a booked-only position carried over a day contributes 0 there and everything on its exit day', () => {
        const D3 = '2026-09-30';
        const longHold = nt({ id: 'hold', entryMs: ist(D1, '11:00'), exitMs: ist(D3, '10:00'), bookedNet: -900 });
        const other = nt({ id: 'mid', entryMs: ist(D2, '10:00'), exitMs: ist(D2, '10:10'), bookedNet: 40 });
        const res = buildDayCurves([longHold, other]);
        expect(res.days.map((d) => d.day)).toEqual([D3, D2, D1]);
        const d2 = dayOf(res, D2);
        expect(d2.trades.find((t) => t.id === 'hold')).toMatchObject({ carriedIn: true, carriedOut: true, contribution: 0, marked: false });
        expect(d2.total).toBe(40);
        expect(dayOf(res, D1).total).toBe(0);
        expect(dayOf(res, D3).total).toBe(-900);
    });

    it('flags days whose total is not their own P&L: an unmarked carry-out leaves a gap, its exit day takes the earlier move', () => {
        const D3 = '2026-09-30';
        const longHold = nt({ id: 'hold', entryMs: ist(D1, '11:00'), exitMs: ist(D3, '10:00'), bookedNet: -900 });
        const other = nt({ id: 'mid', entryMs: ist(D2, '10:00'), exitMs: ist(D2, '10:10'), bookedNet: 40 });
        const res = buildDayCurves([longHold, other, carried]);
        const hold = (d) => dayOf(res, d).trades.find((t) => t.id === 'hold');
        expect(hold(D1).spansEarlierDays).toBe(false);
        expect(hold(D2).spansEarlierDays).toBe(true);
        expect(hold(D3)).toMatchObject({ carriedIn: true, carriedOut: false, spansEarlierDays: true, contribution: -900 });
        // A carried position MARKED on the day before brings only this day's move.
        expect(dayOf(res, D2).trades.find((t) => t.id === 'ml').spansEarlierDays).toBe(false);
        // D1: 'hold' is unknown there but 'ml' is known, so D1's total misses 'hold's move.
        expect(dayPnlPartial(dayOf(res, D1))).toEqual({ missing: 1, spanning: 0 });
        expect(dayPnlPartial(dayOf(res, D2))).toEqual({ missing: 1, spanning: 0 });
        expect(dayPnlPartial(dayOf(res, D3))).toEqual({ missing: 0, spanning: 1 });
        // A day made only of unknown trades is dayIsUnknown's, not partial.
        const alone = buildDayCurves([longHold]);
        expect(dayPnlPartial(dayOf(alone, D1))).toBeNull();
        expect(dayPnlPartial(dayOf(buildDayCurves([carried]), D2))).toBeNull();
    });

    it('a mark after 15:40 widens its day instead of falling between days', () => {
        const late = nt({
            id: 'late', entryMs: ist(D1, '15:00'), exitMs: ist(D2, '09:20'), bookedNet: 100,
            path: [...marks(D1, [['15:10', 10], ['15:55', 70]]), ...marks(D2, [['09:16', 90]])],
        });
        const res = buildDayCurves([late]);
        const d1 = dayOf(res, D1), d2 = dayOf(res, D2);
        expect(d1.endMs).toBe(ist(D1, '15:55'));
        expect(d1.total).toBe(70);
        expect(d2.total).toBe(30);
    });

    it('INVARIANT on a random book: Σ day totals === Σ bookedNet (to the paisa)', () => {
        // deterministic LCG so a failure is reproducible
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
        const trades = [];
        const base = ist('2026-09-01', '09:15');
        for (let i = 0; i < 200; i++) {
            const dayOff = Math.floor(rnd() * 20);
            const entry = base + dayOff * 86400000 + Math.floor(rnd() * 380) * 60000 + Math.floor(rnd() * 60000);
            const hold = rnd() < 0.15 ? Math.floor(rnd() * 3 * 86400000) : Math.floor(rnd() * 200 * 60000);
            const exit = entry + hold;
            const hasPath = rnd() < 0.6;
            const path = [];
            if (hasPath) {
                for (let t = entry; t <= exit; t += 60000 + Math.floor(rnd() * 1000)) {
                    path.push({ ms: t, net: rnd() < 0.05 ? null : Math.round((rnd() - 0.5) * 200000) / 100 });
                }
            }
            trades.push(nt({
                id: `r${i}`, entryMs: entry, exitMs: exit,
                bookedNet: Math.round((rnd() - 0.5) * 500000) / 100,
                path: hasPath ? path : null,
            }));
        }
        const res = buildDayCurves(trades);
        const sumDays = res.days.reduce((s, d) => s + d.total, 0);
        const sumBooked = trades.reduce((s, t) => s + t.bookedNet, 0);
        expect(Math.abs(sumDays - sumBooked)).toBeLessThan(0.01 * trades.length);
        expect(Math.abs(sumDays - sumBooked)).toBeLessThan(0.05);
        // and per trade: its contributions across days add up to its booked net
        const byTrade = new Map();
        for (const d of res.days) for (const t of d.trades) byTrade.set(t.id, (byTrade.get(t.id) || 0) + t.contribution);
        for (const t of trades) expect(Math.abs(byTrade.get(t.id) - t.bookedNet)).toBeLessThan(0.01 * 5);
        // each day's total is its last point, and days are newest first
        for (const d of res.days) expect(d.total).toBe(d.points[d.points.length - 1].pnl);
        for (let i = 1; i < res.days.length; i++) expect(res.days[i - 1].day > res.days[i].day).toBe(true);
    });
});

describe('buildDayCurves — IST day bucketing', () => {
    it('00:30 UTC is the same IST date as 09:30 IST; 19:00 UTC is the NEXT IST date', () => {
        const early = nt({ id: 'early', entryMs: Date.parse('2026-09-28T00:30:00Z'), exitMs: Date.parse('2026-09-28T04:00:00Z'), bookedNet: 5 });
        const night = nt({ id: 'night', entryMs: Date.parse('2026-09-28T19:00:00Z'), exitMs: Date.parse('2026-09-28T19:30:00Z'), bookedNet: 7 });
        const res = buildDayCurves([early, night]);
        expect(res.days.map((d) => d.day)).toEqual(['2026-09-29', '2026-09-28']);
        const d28 = dayOf(res, '2026-09-28');
        expect(d28.trades.map((t) => t.id)).toEqual(['early']);
        expect(d28.startMs).toBe(Date.parse('2026-09-28T00:30:00Z')); // window widened to 06:00 IST
        expect(dayOf(res, '2026-09-29').trades.map((t) => t.id)).toEqual(['night']);
        expect(dayOf(res, '2026-09-29').startMs).toBe(Date.parse('2026-09-28T19:00:00Z'));
    });

    it('a trade spanning IST midnight (18:00Z → 19:00Z) belongs to both IST dates', () => {
        const x = nt({ id: 'x', entryMs: Date.parse('2026-09-28T18:00:00Z'), exitMs: Date.parse('2026-09-28T19:00:00Z'), bookedNet: -12.34 });
        const res = buildDayCurves([x]);
        expect(res.days.map((d) => d.day)).toEqual(['2026-09-29', '2026-09-28']);
        expect(dayOf(res, '2026-09-28').total).toBe(0);
        expect(dayOf(res, '2026-09-29').total).toBe(-12.34);
    });

    it('istDayOf / toMs / istWeekday never use the machine timezone', () => {
        expect(istDayOf(Date.parse('2026-09-28T18:29:59.999Z'))).toBe('2026-09-28');
        expect(istDayOf(Date.parse('2026-09-28T18:30:00Z'))).toBe('2026-09-29');
        expect(istDayOf(null)).toBeNull();
        // a zone-less timestamp is an Indian-market time
        expect(toMs('2026-09-28T09:30:00')).toBe(ist(D1, '09:30'));
        expect(toMs('2026-09-28 09:30')).toBe(ist(D1, '09:30'));
        expect(toMs('2026-09-28T04:00:00.000Z')).toBe(ist(D1, '09:30'));
        expect(toMs(new Date(ist(D1, '09:30')))).toBe(ist(D1, '09:30'));
        expect(toMs(null)).toBeNull();
        expect(toMs('')).toBeNull();
        expect(Number.isNaN(toMs('2026-09-28'))).toBe(true); // a date is not an instant
        expect(Number.isNaN(toMs('not a time'))).toBe(true);
        expect(istWeekday('2026-09-28')).toBe('Mon');
        expect(istWeekday('2026-10-03')).toBe('Sat');
        expect(istWeekday('bad')).toBeNull();
    });
});

describe('buildDayCurves — exclusions are counted, never silent', () => {
    it('counts open trades, missing booked results and invalid times separately', () => {
        const ok = normalizeSingleLegTrade(singleDoc());
        const open = normalizeSingleLegTrade(singleDoc({ _id: 'o', status: 'OPEN', exitTime: undefined, net_pnl: undefined, pnl: undefined, gross_pnl: undefined }));
        const noBooked = normalizeSingleLegTrade(singleDoc({ _id: 'n', net_pnl: null, pnl: null, gross_pnl: null }));
        const badEntry = normalizeSingleLegTrade(singleDoc({ _id: 'e', entryTime: 'garbage' }));
        const noEntry = normalizeSingleLegTrade(singleDoc({ _id: 'e2', entryTime: undefined }));
        const closedNoExit = normalizeSingleLegTrade(singleDoc({ _id: 'c', exitTime: undefined }));
        const backwards = normalizeSingleLegTrade(singleDoc({ _id: 'b', exitTime: iso(ist(D1, '09:00')) }));
        const openMl = normalizeMultilegTrade(multiDoc({ _id: 'm', exitAt: undefined, netPnl: undefined }));
        const res = buildDayCurves([ok, open, noBooked, badEntry, noEntry, closedNoExit, backwards, openMl, null]);
        expect(res.excluded).toEqual({ noExit: 2, noBooked: 1, invalidTime: 5 });
        expect(res.days).toHaveLength(1);
        expect(res.days[0].coverage.trades).toBe(1);
        expect(res.days[0].total).toBe(-331.42);
    });

    it('counts fallbacks to gross pnl', () => {
        const a = normalizeSingleLegTrade(singleDoc({ net_pnl: undefined }));
        const b = normalizeSingleLegTrade(singleDoc({ _id: 'b' }));
        expect(buildDayCurves([a, b]).bookedBasis).toEqual({ net: 1, grossFallback: 1 });
    });

    it('empty / missing input yields no days and zero counts', () => {
        expect(buildDayCurves([])).toEqual({ days: [], excluded: { noExit: 0, noBooked: 0, invalidTime: 0 }, bookedBasis: { net: 0, grossFallback: 0 } });
        expect(buildDayCurves(undefined).days).toEqual([]);
    });

    it('marks outside a trade\'s life are ignored (value is 0 before entry, booked after exit)', () => {
        const t = nt({
            entryMs: ist(D1, '10:00'), exitMs: ist(D1, '10:10'), bookedNet: 20,
            path: marks(D1, [['09:50', 999], ['10:05', 30], ['10:20', -999]]),
        });
        const d = buildDayCurves([t]).days[0];
        expect(at(d, ist(D1, '10:00'))).toBe(0);
        expect(at(d, ist(D1, '10:05'))).toBe(30);
        expect(at(d, ist(D1, '10:20'))).toBe(20);
        expect(d.startMs).toBe(ist(D1, '09:15'));
    });
});

describe('buildDayCurves — performance', () => {
    it('1000 trades × 400 marks in well under a second', () => {
        const trades = [];
        const base = ist('2026-01-01', '09:15');
        for (let i = 0; i < 1000; i++) {
            const dayOff = i % 250;
            const entry = base + dayOff * 86400000 + (i % 7) * 60000;
            // every 10th trade is held for ~3 days (multi-day path)
            const spacing = i % 10 === 0 ? 11 * 60000 : 55000;
            const path = [];
            for (let k = 1; k <= 400; k++) path.push({ ms: entry + k * spacing, net: (k % 37) * 3 - 50 });
            const exit = entry + 401 * spacing;
            trades.push(nt({ id: `p${i}`, entryMs: entry, exitMs: exit, bookedNet: -10 + (i % 13), path }));
        }
        const t0 = performance.now();
        const res = buildDayCurves(trades);
        const ms = performance.now() - t0;
        expect(res.days.length).toBeGreaterThan(200);
        const sumDays = res.days.reduce((s, d) => s + d.total, 0);
        const sumBooked = trades.reduce((s, t) => s + t.bookedNet, 0);
        expect(Math.abs(sumDays - sumBooked)).toBeLessThan(0.01 * trades.length);
        expect(ms).toBeLessThan(1000);
    });
});

describe('date-range cut and void single-leg docs', () => {
    it('istDayStartMs snaps any instant to IST midnight of its IST date (fixed +05:30, no browser zone)', () => {
        expect(istDayStartMs(ist('2026-09-23', '12:00'))).toBe(ist('2026-09-23', '00:00'));
        // 00:10 IST is still the previous UTC date — the IST date wins.
        expect(istDayStartMs(ist('2026-09-23', '00:10'))).toBe(ist('2026-09-23', '00:00'));
        expect(istDayStartMs(ist('2026-09-23', '23:59', '59'))).toBe(ist('2026-09-23', '00:00'));
        expect(istDayStartMs(ist('2026-09-23', '00:00'))).toBe(ist('2026-09-23', '00:00'));
        expect(istDayStartMs(null)).toBeNull();
        expect(istDayStartMs(NaN)).toBeNull();
    });

    it('a range cut at IST midnight keeps the oldest day whole (a rolling cut dropped its morning)', () => {
        const now = ist('2026-09-30', '12:00');
        const rolling = now - 7 * 86400e3;                       // 23-Sep 12:00 IST
        const snapped = istDayStartMs(rolling);                  // 23-Sep 00:00 IST
        const row = (id, e, x, net) => ({ _id: id, status: 'CLOSED', tradingsymbol: 'NSE:NIFTY2692924000CE', side: 'CALL',
            entryTime: iso(e), exitTime: iso(x), net_pnl: net });
        const all = [
            row('am', ist('2026-09-23', '09:30'), ist('2026-09-23', '10:30'), -4000),
            row('pm', ist('2026-09-23', '13:00'), ist('2026-09-23', '14:00'), 1500),
        ];
        // The server keeps docs whose exit instant is >= from.
        const served = (from) => all.filter((t) => Date.parse(t.exitTime) >= from);
        const total = (from) => buildDayCurves(served(from).map(normalizeSingleLegTrade)).days[0].total;
        expect(total(rolling)).toBe(1500);                        // the bug: half a day, shown as whole
        expect(total(snapped)).toBe(-2500);
    });

    it('singleLegVoidReason: an aborted entry and a recovery placeholder are not round trips; a reconciled recovery is', () => {
        expect(singleLegVoidReason({ status: 'CLOSED', entry_failed: true, pnl: 0 })).toBe('entryFailed');
        expect(singleLegVoidReason({ status: 'CLOSED', recovery_closed: true, pnl: 0, failure_reason: 'absent' })).toBe('recoveryUnknown');
        expect(singleLegVoidReason({ status: 'CLOSED', recovery_closed: true, pnl: 0, gross_pnl: null, net_pnl: null })).toBe('recoveryUnknown');
        // Recovery that reconciled a real broker SL fill carries its gross: it stays.
        expect(singleLegVoidReason({ status: 'CLOSED', recovery_closed: true, pnl: -640, gross_pnl: -640, net_pnl: null })).toBeNull();
        expect(singleLegVoidReason({ status: 'CLOSED', pnl: 700, net_pnl: 640 })).toBeNull();
        expect(singleLegVoidReason(null)).toBeNull();
    });
});
