/**
 * The day-by-day view: one collapsed row per IST day with its total and a
 * coverage chip, expandable by a real button, every excluded trade counted with
 * its reason, and long histories paged rather than rendered all at once.
 *
 * Fixtures are DayCurve objects passed straight in — this tests the component's
 * contract, not the arithmetic in utils/dayCurves.js.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import DayEquityCurves from './DayEquityCurves.jsx';

const IST = 5.5 * 3600e3;
/** ms for an IST wall-clock time on an IST date. */
const istMs = (day, hh, mm) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) - IST;
};

function makeDay(day, total, { marked = true, carriedIn = false, id = `t-${day}` } = {}) {
    const startMs = istMs(day, 9, 15);
    const endMs = istMs(day, 15, 40);
    const entryMs = carriedIn ? istMs(day, 9, 15) - 86400e3 : istMs(day, 10, 0);
    const exitMs = istMs(day, 11, 30);
    const label = 'BANKNIFTY 54300PE PUT';
    return {
        day, startMs, endMs, total,
        points: [
            { ms: startMs, pnl: 0 },
            { ms: istMs(day, 10, 0), pnl: 0 },
            { ms: istMs(day, 10, 30), pnl: marked ? -150 : 0 },
            { ms: exitMs, pnl: total },
            { ms: endMs, pnl: total },
        ],
        trades: [{ id, label, entryMs, exitMs, contribution: total, carriedIn, carriedOut: false, marked, pathSource: marked ? 'archive' : null }],
        markers: [
            ...(carriedIn ? [] : [{ ms: entryMs, kind: 'entry', id, label }]),
            { ms: exitMs, kind: 'exit', id, label },
        ],
        coverage: { trades: 1, marked: marked ? 1 : 0, bookedOnly: marked ? 0 : 1 },
    };
}

/** n consecutive calendar days ending 2026-09-28, newest first. */
function manyDays(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(Date.UTC(2026, 8, 28) - i * 86400e3).toISOString().slice(0, 10);
        out.push(makeDay(d, 100 + i));
    }
    return out;
}

describe('DayEquityCurves', () => {
    const days = [makeDay('2026-09-28', 1250), makeDay('2026-09-25', -300, { marked: false, carriedIn: true })];

    it('renders one collapsed row per day with date, total, trade count and coverage chip', () => {
        render(<DayEquityCurves days={days} excluded={{ noExit: 0, noBooked: 0, invalidTime: 0 }} />);
        const mon = screen.getByRole('button', { name: /Mon 28 Sep 2026/ });
        const fri = screen.getByRole('button', { name: /Fri 25 Sep 2026/ });
        expect(mon.getAttribute('aria-expanded')).toBe('false');
        expect(within(mon).getByText('+₹1,250')).toBeTruthy();
        expect(within(mon).getByText('1 trade')).toBeTruthy();
        expect(within(mon).getByText('marked 1/1')).toBeTruthy();
        expect(within(fri).getByText('-₹300')).toBeTruthy();
        expect(within(fri).getByText('booked only')).toBeTruthy();
        // Collapsed rows draw an inline SVG sparkline — no recharts per row.
        expect(mon.querySelector('svg path')).toBeTruthy();
        expect(document.querySelector('.recharts-wrapper')).toBeNull();
        // Nothing excluded, nothing to warn about.
        expect(screen.queryByText(/Not in these curves/)).toBeNull();
    });

    it('expands a day on click: aria-expanded flips and the trade table appears', () => {
        render(<DayEquityCurves days={days} excluded={{}} />);
        const fri = screen.getByRole('button', { name: /Fri 25 Sep 2026/ });
        fireEvent.click(fri);
        expect(fri.getAttribute('aria-expanded')).toBe('true');
        const panel = screen.getByRole('region', { name: /Fri 25 Sep 2026/ });
        expect(fri.getAttribute('aria-controls')).toBe(panel.id);
        expect(within(panel).getByText('BANKNIFTY 54300PE PUT')).toBeTruthy();
        expect(within(panel).getByText('carried in')).toBeTruthy();
        expect(within(panel).getByText('On this day')).toBeTruthy();
        // Collapsing again removes the panel.
        fireEvent.click(fri);
        expect(fri.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('region', { name: /Fri 25 Sep 2026/ })).toBeNull();
    });

    it('opens from the keyboard (it is a real button)', () => {
        render(<DayEquityCurves days={days} excluded={{}} />);
        const mon = screen.getByRole('button', { name: /Mon 28 Sep 2026/ });
        expect(mon.tagName).toBe('BUTTON');
        mon.focus();
        expect(document.activeElement).toBe(mon);
    });

    it('counts every excluded trade with its reason, zero buckets omitted', () => {
        render(<DayEquityCurves days={days} excluded={{ noExit: 2, noBooked: 1, invalidTime: 0, quarantined: 3 }} />);
        const line = screen.getByText(/Not in these curves/);
        expect(line.textContent).toContain('2 still open (no exit yet)');
        expect(line.textContent).toContain('1 no booked P&L');
        expect(line.textContent).toContain('3 quarantined');
        expect(line.textContent).not.toContain('unreadable entry/exit time');
    });

    it('shows the empty text and the excluded counts when there are no days', () => {
        render(<DayEquityCurves days={[]} excluded={{ noExit: 4 }} emptyText="Nothing booked yet." />);
        expect(screen.getByText('Nothing booked yet.')).toBeTruthy();
        expect(screen.getByText(/4 still open/)).toBeTruthy();
    });

    it('a day made only of positions carried out with no marks has an UNKNOWN total, not ₹0', () => {
        const day = '2026-09-28';
        const id = 'ic-1';
        const label = 'iron_condor · NIFTY50';
        const unknownDay = {
            day, startMs: istMs(day, 9, 15), endMs: istMs(day, 15, 40), total: 0,
            points: [{ ms: istMs(day, 9, 15), pnl: 0 }, { ms: istMs(day, 14, 0), pnl: 0 }, { ms: istMs(day, 15, 40), pnl: 0 }],
            trades: [{ id, label, entryMs: istMs(day, 14, 0), exitMs: istMs('2026-09-29', 11, 0), contribution: 0,
                carriedIn: false, carriedOut: true, marked: false, pathSource: null }],
            markers: [{ ms: istMs(day, 14, 0), kind: 'entry', id, label }],
            coverage: { trades: 1, marked: 0, bookedOnly: 1 },
        };
        render(<DayEquityCurves days={[unknownDay]} excluded={{}} />);
        const row = screen.getByRole('button', { name: /Mon 28 Sep 2026/ });
        expect(within(row).queryByText('₹0')).toBeNull();
        expect(within(row).getByText('—')).toBeTruthy();
        expect(within(row).getByText('unmarked, carried out')).toBeTruthy();
        // No flat sparkline pretending the day was flat.
        expect(row.querySelector('svg path')).toBeNull();
        fireEvent.click(row);
        const panel = screen.getByRole('region', { name: /Mon 28 Sep 2026/ });
        expect(within(panel).getByText('— lands on exit day')).toBeTruthy();
        expect(within(panel).queryByText('₹0')).toBeNull();
        expect(within(panel).getByText(/unknown and is not in this curve/)).toBeTruthy();
    });

    it('explains the exit step per book: pre-cost marks vs marks net of estimated costs', () => {
        const { unmount } = render(<DayEquityCurves days={days} excluded={{}} markBasis="net-of-estimated-costs" />);
        let legend = screen.getByText(/Each day's running P&L/).textContent;
        expect(legend).toMatch(/estimated and actual charges/);
        expect(legend).not.toMatch(/charges plus fill slippage/);
        unmount();
        render(<DayEquityCurves days={days} excluded={{}} markBasis="pre-cost" />);
        legend = screen.getByText(/Each day's running P&L/).textContent;
        expect(legend).toMatch(/charges plus fill slippage/);
        expect(legend).toMatch(/pre-cost/);
    });

    it('names the page-level exclusions: entries that never filled, recovery placeholders, partial days', () => {
        render(<DayEquityCurves days={days} excluded={{ entryFailed: 2, recoveryUnknown: 1, partialDays: 1 }} />);
        const line = screen.getByText(/Not in these curves/).textContent;
        expect(line).toContain('2 entry never filled');
        expect(line).toContain('1 closed by recovery with no known exit');
        expect(line).toContain('1 earlier day(s) not drawn');
    });

    it('renders the first 30 days, then a "Show N more" button', () => {
        render(<DayEquityCurves days={manyDays(35)} excluded={{}} />);
        expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(30);
        expect(screen.getByText('5 older days not shown')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));
        expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(35);
        expect(screen.queryByRole('button', { name: /Show \d+ more/ })).toBeNull();
    });
});

// ── India VIX overlay ────────────────────────────────────────────────────────
// Official daily closes as Fyers returned them (probe of 2026-10-02).
const VIX_CLOSE = {
    '2026-09-21': 11.25, '2026-09-22': 11.0, '2026-09-23': 10.35, '2026-09-24': 12.69,
    '2026-09-25': 12.16, '2026-09-28': 13.64, '2026-09-29': 13.41,
};
const r2 = (x) => Math.round(x * 100) / 100;

/** A contract-shaped /api/market/vix-days body for the asked dates, built from VIX_CLOSE. */
function vixBody({ days, intraday }, override = {}) {
    const keys = Object.keys(VIX_CLOSE).sort();
    const out = {};
    for (const d of [...days, ...intraday]) {
        const i = keys.indexOf(d);
        const close = VIX_CLOSE[d] ?? null;
        const prevClose = i > 0 ? VIX_CLOSE[keys[i - 1]] : null;
        out[d] = {
            day: d, prevClose, close,
            change: close != null && prevClose != null ? r2(close - prevClose) : null,
            changePct: close != null && prevClose != null ? r2(((close - prevClose) / prevClose) * 100) : null,
            provisional: false,
            intraday: intraday.includes(d) && d === '2026-09-28' ? {
                // Stamped at bar END: the 09:15 bar is at 09:16.
                points: [
                    { ms: istMs(d, 9, 16), v: 13.2 }, { ms: istMs(d, 10, 0), v: 13.3 }, { ms: istMs(d, 10, 30), v: 13.5 },
                    { ms: istMs(d, 11, 30), v: 13.65 }, { ms: istMs(d, 15, 30), v: 13.62 },
                ],
                high: 13.65, low: 13.2, first: null, last: null, bars: 5,
            } : null,
            reason: close == null ? 'no session (weekend/holiday)' : null,
            ...(override[d] || {}),
        };
    }
    return { resolution: '1', source: { daily: 'fyers', intraday: intraday.length ? 'fyers' : 'not requested' }, days: out, warnings: [] };
}
const vixFetcher = (override) => vi.fn(async (q) => vixBody(q, override));

/** Six real sessions, newest first, with P&L that rises on the two VIX-up days. */
const sixDays = () => [
    makeDay('2026-09-29', 800), makeDay('2026-09-28', 1250), makeDay('2026-09-25', -300),
    makeDay('2026-09-24', 2100), makeDay('2026-09-23', -450), makeDay('2026-09-22', -120),
];

describe('DayEquityCurves — India VIX', () => {
    beforeEach(() => { try { localStorage.clear(); } catch { /* storage blocked in this env */ } });
    afterEach(() => { delete URL.createObjectURL; delete URL.revokeObjectURL; });

    it('is OFF by default: an unticked labelled checkbox, no request, no VIX anywhere', () => {
        const fetcher = vixFetcher();
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        const box = screen.getByRole('checkbox', { name: 'India VIX' });
        expect(box.checked).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
        expect(screen.queryByText(/^VIX /)).toBeNull();
        expect(screen.queryByRole('region', { name: 'P&L vs India VIX' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Mon 28 Sep 2026/ }));
        expect(screen.queryByText('VIX while held')).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('remembers the choice across mounts', async () => {
        const fetcher = vixFetcher();
        const { unmount } = render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        expect(localStorage.getItem('dayCurves.showVix')).toBe('true');
        await screen.findByText(/Across 6 days/);
        unmount();
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        expect(screen.getByRole('checkbox', { name: 'India VIX' }).checked).toBe(true);
        // Same fetcher → same module cache: the second mount does not ask again.
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('still works when localStorage throws (private mode, blocked site data)', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        const fetcher = vixFetcher();
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        const box = screen.getByRole('checkbox', { name: 'India VIX' });
        expect(box.checked).toBe(false);
        fireEvent.click(box);
        expect(box.checked).toBe(true);
        await screen.findByText(/Across 6 days/);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('ON: one summary request; row chips; the P&L vs VIX summary; an opened day gets its VIX path and column', async () => {
        const fetcher = vixFetcher();
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));

        const summary = await screen.findByRole('region', { name: 'P&L vs India VIX' });
        await waitFor(() => expect(summary.textContent).toMatch(/Across 6 days: correlation r = /));
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][0]).toEqual({
            days: ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29'], intraday: [],
        });
        // Six days can never reach p < 0.05: the floor is printed and the verdict says so.
        expect(summary.textContent).toMatch(/with 6 days the smallest possible p is 0\.17/);
        expect(summary.textContent).toMatch(/too few days for this test to reach p < 0\.05 \(it needs at least 21\)/);
        expect(summary.textContent).not.toMatch(/not distinguishable from chance/);
        expect(summary.textContent).toMatch(/VIX up days: 2, avg P&L \+₹1,675/);
        expect(summary.textContent).toMatch(/VIX down days: 4, avg P&L -₹17\.5/);
        expect(within(summary).queryByText(/Not in these figures/)).toBeNull();
        expect(within(summary).getByText('VIX source: Fyers')).toBeTruthy();

        const mon = screen.getByRole('button', { name: /Mon 28 Sep 2026/ });
        expect(within(mon).getByText('VIX 12.16 → 13.64 ▲1.48')).toBeTruthy();
        const fri = screen.getByRole('button', { name: /Fri 25 Sep 2026/ });
        expect(within(fri).getByText('VIX 12.69 → 12.16 ▼0.53')).toBeTruthy();

        fireEvent.click(mon);
        const panel = screen.getByRole('region', { name: 'P&L on Mon 28 Sep 2026' });
        // Its path is loading; the across-days figures stay up meanwhile.
        expect(within(panel).getByText('Loading India VIX for this day…')).toBeTruthy();
        expect(summary.textContent).toMatch(/Across 6 days/);
        // Trade held 10:00 → 11:30: VIX 13.30 → 13.65, read off bar closes.
        expect(await within(panel).findByText('13.30 → 13.65 (+0.35)')).toBeTruthy();
        expect(within(panel).getByText('VIX while held')).toBeTruthy();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[1][0]).toEqual({ days: [], intraday: ['2026-09-28'] });
        expect(within(panel).getByText('India VIX (right axis)')).toBeTruthy();
        expect(within(panel).getByText('VIX prev close 12.16')).toBeTruthy();
        expect(panel.textContent).toMatch(/can differ slightly from the last bar's close \(13\.62 at 15:30\)/);
    });

    it('labels a day the feed could not price — "—" with the reason, and counts it out of the stats', async () => {
        const fetcher = vixFetcher({ '2026-09-29': { close: null, change: null, changePct: null, reason: 'Fyers returned no bars for this day' } });
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        const summary = await screen.findByRole('region', { name: 'P&L vs India VIX' });
        await waitFor(() => expect(summary.textContent).toMatch(/Across 5 days/));
        expect(within(summary).getByText(/Not in these figures: 1 day with no VIX change/)).toBeTruthy();
        const tue = screen.getByRole('button', { name: /Tue 29 Sep 2026/ });
        const chip = within(tue).getByText('VIX —');
        expect(chip.getAttribute('title')).toMatch(/Fyers returned no bars for this day/);
    });

    it('shows the server\'s reason when VIX cannot be loaded, and Retry asks again', async () => {
        const fetcher = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 503'),
                { response: { status: 503, data: { error: 'broker session not available in this process' } } }))
            .mockImplementation(async (q) => vixBody(q));
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        expect(await screen.findByText(/India VIX could not be loaded for 6 days: broker session not available in this process/)).toBeTruthy();
        const mon = screen.getByRole('button', { name: /Mon 28 Sep 2026/ });
        expect(within(mon).getByText('VIX —').getAttribute('title')).toMatch(/broker session not available/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(within(mon).getByText('VIX 12.16 → 13.64 ▲1.48')).toBeTruthy());
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(screen.queryByText(/could not be loaded/)).toBeNull();
    });

    it('a 200 whose days say "broker session not available" offers Retry (no HTTP error), and Retry fills the rows', async () => {
        const down = { prevClose: null, close: null, change: null, changePct: null, reason: 'broker session not available in this process' };
        const keys = sixDays().map((d) => d.day);
        const fetcher = vi.fn()
            .mockImplementationOnce(async (q) => ({ ...vixBody(q, Object.fromEntries(keys.map((d) => [d, down]))), source: { daily: 'none', intraday: 'not requested' } }))
            .mockImplementation(async (q) => vixBody(q));
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={fetcher} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        const summary = await screen.findByRole('region', { name: 'P&L vs India VIX' });
        await waitFor(() => expect(summary.textContent).toMatch(/6 days still lack a VIX value the server may yet give/));
        expect(within(summary).getByText('VIX source: unavailable')).toBeTruthy();
        expect(screen.queryByText(/could not be loaded/)).toBeNull();          // a 200, not an HTTP failure
        fireEvent.click(within(summary).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(summary.textContent).toMatch(/Across 6 days: correlation r = /));
        expect(within(summary).getByText('VIX source: Fyers')).toBeTruthy();
        expect(within(summary).queryByRole('button', { name: 'Retry' })).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('a day with a position held across its close unmarked is counted out as partial P&L', async () => {
        const days = sixDays();
        const day = '2026-09-24';
        days[3] = {
            ...days[3],
            trades: [...days[3].trades, {
                id: 'ic', label: 'iron_condor · NIFTY50', entryMs: istMs(day, 14, 0), exitMs: istMs('2026-09-25', 11, 0),
                contribution: 0, carriedIn: false, carriedOut: true, marked: false, pathSource: null,
            }],
        };
        render(<DayEquityCurves days={days} excluded={{}} vixFetcher={vixFetcher()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        const summary = await screen.findByRole('region', { name: 'P&L vs India VIX' });
        await waitFor(() => expect(summary.textContent).toMatch(/Across 5 days/));
        expect(within(summary).getByText(/Not in these figures: 1 day whose P&L is partial/)).toBeTruthy();
    });

    it('21 days can reach p < 0.05: p is printed so it reads below 0.05 when it is (1/21, not "0.05")', async () => {
        // 21 weekdays from Tue 1-Sep-2026; VIX change and P&L both rise day by day (r = 1, no rotation ties).
        const keys = [];
        for (let ms = Date.UTC(2026, 8, 1); keys.length < 21; ms += 86400e3) {
            const wd = new Date(ms).getUTCDay();
            if (wd !== 0 && wd !== 6) keys.push(new Date(ms).toISOString().slice(0, 10));
        }
        const days = keys.map((d, i) => makeDay(d, (i + 1) * 100)).reverse();
        const fetcher = vi.fn(async ({ days: asked, intraday }) => ({
            resolution: '1', source: { daily: 'fyers', intraday: 'not requested' }, warnings: [],
            days: Object.fromEntries([...asked, ...intraday].map((d) => {
                const ch = (keys.indexOf(d) + 1) / 10;
                return [d, { day: d, prevClose: 13, close: r2(13 + ch), change: ch, changePct: null, provisional: false, intraday: null, reason: null }];
            })),
        }));
        render(<DayEquityCurves days={days} excluded={{}} vixFetcher={fetcher} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        const summary = await screen.findByRole('region', { name: 'P&L vs India VIX' });
        await waitFor(() => expect(summary.textContent).toMatch(/Across 21 days: correlation r = 1\.00/));
        expect(summary.textContent).toMatch(/rotation test p = 0\.048; with 21 days the smallest possible p is 0\.048\)/);
        expect(summary.textContent).toMatch(/stronger than chance alignment usually produces/);
    });

    it('Download CSV hands over a CSV Blob of the day table and revokes its URL afterwards', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:vix-csv');
        URL.revokeObjectURL = vi.fn();
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<DayEquityCurves days={sixDays()} excluded={{}} vixFetcher={vixFetcher()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'India VIX' }));
        await screen.findByText(/Across 6 days/);
        fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
        expect(click).toHaveBeenCalledTimes(1);
        const blob = URL.createObjectURL.mock.calls[0][0];
        const text = await blob.text();
        const lines = text.trimEnd().split('\n');
        expect(lines[0]).toBe('day,day P&L,trades,VIX prev close,VIX close,VIX change,VIX change %,provisional,note');
        expect(lines[1]).toBe('2026-09-22,-120,1,11.25,11,-0.25,-2.22,no,');
        expect(lines).toHaveLength(7);
        await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:vix-csv'));
    });
});
