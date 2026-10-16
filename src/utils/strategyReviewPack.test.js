import { describe, it, expect } from 'vitest';
import {
    istHour, summarize, buildEvidence, holdoutSplit, settingsCatalog, checkSuggestions, compareRuns,
    attributionSummary, vixSummary, assumptionsOf, tradesCsv,
} from './strategyReviewPack.js';

// IST = UTC+05:30. 15:05 IST = 09:35Z.
const T = (istStr, pnl, extra = {}) => {
    const entry = new Date(`${istStr}+05:30`).toISOString();
    const exit = new Date(Date.parse(entry) + 55 * 60000).toISOString();
    return { entryTime: entry, exitTime: exit, pnl, type: pnl > 0 ? 'CE' : 'PE', entryPrice: 120, exitPrice: 130, reason: 'Max Hold Reached', ...extra };
};

describe('summarize', () => {
    it('net, win rate, profit factor, drawdown and losing streak', () => {
        const s = summarize([T('2026-01-05T10:00:00', 100), T('2026-01-05T11:00:00', -50), T('2026-01-06T10:00:00', -30), T('2026-01-07T10:00:00', 200)]);
        expect(s.trades).toBe(4);
        expect(s.net).toBe(220);
        expect(s.win_pct).toBe(50);
        expect(s.profit_factor).toBe(3.75);
        expect(s.max_drawdown_rupees).toBe(80);
        expect(s.max_losing_streak).toBe(2);
    });
    it('prefers net_pnl over pnl', () => {
        expect(summarize([{ entryTime: '2026-01-05T04:30:00Z', pnl: 100, net_pnl: 90 }]).net).toBe(90);
    });
});

describe('buildEvidence', () => {
    const trades = [
        T('2026-01-05T15:05:00', -400), T('2026-01-06T15:10:00', -300), T('2026-01-07T11:30:00', 900),
        T('2026-01-08T11:45:00', 500, { reason: 'TARGET_HIT (Intra)', volume: 300, avg_volume: 100 }), T('2026-01-09T09:35:00', -100, { entryPrice: 20 }),
    ];
    const ev = buildEvidence(trades);

    it('buckets entry hour in IST (a 15:05 IST trade is in 15:00, not 09:00 UTC)', () => {
        expect(istHour(Date.parse(trades[0].entryTime))).toBe(15);
        const h15 = ev.breakdowns.entry_hour.find(r => r.bucket === '15:00');
        expect(h15).toEqual({ bucket: '15:00', trades: 2, win_pct: 0, net: -700, avg: -350 });
    });

    it('normalises "(Intra)" exit reasons, buckets weekday, premium and volume ratio', () => {
        expect(ev.breakdowns.exit_reason.map(r => r.bucket)).toEqual(['Max Hold Reached', 'TARGET_HIT']);
        expect(ev.breakdowns.weekday.map(r => r.bucket)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        expect(ev.breakdowns.entry_premium).toBeUndefined();   // 5 trades: too few to split by premium
        expect(ev.breakdowns.volume_ratio.find(r => r.bucket === '3x+').trades).toBe(1);
        expect(ev.breakdowns.volume_ratio.find(r => r.bucket === 'no volume').trades).toBe(4);
    });

    it('carries period, metrics and every trade as CSV', () => {
        expect(ev.period).toEqual({ from: '2026-01-05', to: '2026-01-09' });
        expect(ev.metrics.trades).toBe(5);
        const lines = ev.trades_csv.split('\n');
        expect(lines).toHaveLength(6);
        expect(lines[1]).toBe('2026-01-05 15:05,PE,120.00,130.00,-400,Max Hold Reached,55,');
    });

    it('drops the CSV when there are too many trades for a prompt', () => {
        expect(tradesCsv(trades, 3)).toBe('');
    });
});

describe('quantileBands', () => {
    it('splits on the data (BANK NIFTY-sized premiums get their own bands)', async () => {
        const { quantileBands } = await import('./strategyReviewPack.js');
        const q = quantileBands([700, 720, 750, 780, 800, 850, 900, 950, 980, 1000, 1020, 1100]);
        expect(q.edges).toEqual([780, 900, 1000]);
        expect(q.labels).toEqual(['<₹780', '₹780–900', '₹900–1000', '₹1000+']);
        expect(quantileBands([1, 2, 3])).toBeNull();
    });
});

describe('holdoutSplit', () => {
    const many = Array.from({ length: 30 }, (_, i) => T(`2026-02-${String(i + 1).padStart(2, '0')}T10:00:00`.replace('-02-29', '-03-01').replace('-02-30', '-03-02'), i % 3 ? 100 : -50));
    it('hides the last ~30% on a day boundary', () => {
        const s = holdoutSplit(many, 0.3);
        expect(s.seen.length + s.hidden.length).toBe(30);
        expect(s.hidden.length).toBe(9);
        expect(s.seen.every(t => Date.parse(t.entryTime) < s.cutoffMs)).toBe(true);
        expect(s.hidden.every(t => Date.parse(t.entryTime) >= s.cutoffMs)).toBe(true);
    });
    it('returns null when there are too few trades to split', () => {
        expect(holdoutSplit(many.slice(0, 10))).toBeNull();
    });
});

const TUNING = {
    space: { dynamic_lookback: { type: 'int', min: 10, max: 50 }, breakout_mode: { type: 'enum', options: ['DYNAMIC', 'ORB'] }, use_trend_filter: { type: 'bool' } },
    defaults: { dynamic_lookback: 20, breakout_mode: 'ORB', use_trend_filter: true },
};
const PARAMS = { dynamic_lookback: 18, breakout_mode: 'DYNAMIC', use_trend_filter: true, trade_end_time: '15:15', max_daily_loss: 2000, slippage_percent: 0.05, capital: 50000 };

describe('settingsCatalog', () => {
    const cat = settingsCatalog(PARAMS, TUNING);
    const by = Object.fromEntries(cat.map(c => [c.key, c]));
    it('never offers assumptions; labels, groups and allowed values come from the guide + backend space', () => {
        expect(by.slippage_percent).toBeUndefined();
        expect(by.capital).toBeUndefined();
        expect(by.trade_end_time).toMatchObject({ group: 'Timing', type: 'time', label: 'Trade End Time' });
        expect(by.dynamic_lookback).toMatchObject({ group: 'Strategy', type: 'int', allowed: "int 10–50 (the optimizer's range)", default: 20 });
        expect(by.breakout_mode.allowed).toBe('one of DYNAMIC, ORB');
        expect(by.use_trend_filter.what).toMatch(/trend/);
    });
    it('assumptionsOf lists the fixed context', () => {
        expect(assumptionsOf(PARAMS)).toEqual({ slippage_percent: 0.05, capital: 50000 });
    });
});

describe('checkSuggestions', () => {
    const cat = settingsCatalog(PARAMS, TUNING);
    const res = Object.fromEntries(checkSuggestions({
        dynamic_lookback: '25', breakout_mode: 'SOMETHING', trade_end_time: '14:30', max_daily_loss: 1500,
        slippage_percent: 0.01, made_up_key: 3, use_trend_filter: 'false', dynamic_lookback_x: 1,
    }, cat).map(r => [r.key, r]));
    const bad = checkSuggestions({ trade_end_time: '2:30 pm', dynamic_lookback: 80 }, cat);

    it('coerces types and accepts in-range values', () => {
        expect(res.dynamic_lookback).toMatchObject({ value: 25, status: 'ok' });
        expect(res.trade_end_time).toMatchObject({ value: '14:30', status: 'ok' });
        expect(res.use_trend_filter).toMatchObject({ value: false, status: 'ok' });
        expect(res.max_daily_loss.status).toBe('ok');
    });
    it('rejects assumptions, unknown keys, invalid options and bad times', () => {
        expect(res.slippage_percent.status).toBe('invalid');
        expect(res.made_up_key.status).toBe('invalid');
        expect(res.breakout_mode.status).toBe('invalid');
        expect(bad.find(r => r.key === 'trade_end_time').status).toBe('invalid');
    });
    it('flags values outside the optimizer range', () => {
        const r = bad.find(x => x.key === 'dynamic_lookback');
        expect(r.status).toBe('warn');
        expect(r.note).toMatch(/10–50/);
    });
});

describe('compareRuns', () => {
    it('splits before/after at the hidden-period cutoff', () => {
        const before = [T('2026-01-05T10:00:00', 100), T('2026-03-05T10:00:00', -200)];
        const after = [T('2026-01-05T10:00:00', 100), T('2026-03-05T10:00:00', 50)];
        const cut = Date.parse('2026-03-01T00:00:00+05:30');
        const c = compareRuns(before, after, cut);
        expect(c.hidden.before.net).toBe(-200);
        expect(c.hidden.after.net).toBe(50);
        expect(c.seen.before.net).toBe(100);
        expect(c.all.after.net).toBe(150);
        expect(compareRuns(before, after).hidden).toBeUndefined();
    });
});

describe('attribution / VIX summaries', () => {
    it('keep the totals and findings, skip errors', () => {
        const a = attributionSummary({ overall: { netPnl: 93565.79, grossPnl: 99800, thetaPnl: -5500, junk: 'x' }, findings: [{ severity: 'info', message: '15:00–16:00 is net ₹-2383.83', action: 'exclude', code: 'X' }] });
        expect(a.overall).toEqual({ netPnl: 93565.79, grossPnl: 99800, thetaPnl: -5500 });
        expect(a.findings[0]).toEqual({ severity: 'info', message: '15:00–16:00 is net ₹-2383.83', action: 'exclude' });
        expect(attributionSummary({ error: 'x' })).toBeNull();
    });
    it('VIX keeps traded bands and the chance test', () => {
        const v = vixSummary({ breakdown: { bands: [{ band: '<11', trades: 0 }, { band: '13-15', trades: 29, winRatePct: 69, netPnl: 40514, avgPnlPerTrade: 1397 }] }, nullTest: { pRotation: 0.3, pShuffle: 0.15 } });
        expect(v.bands).toEqual([{ bucket: 'VIX 13-15', trades: 29, win_pct: 69, net: 40514, avg: 1397 }]);
        expect(v.p_rotation).toBe(0.3);
    });
});

describe('form fallbacks and settings a backtest ignores', () => {
    it('fills what the form shows for settings never set, only in the mode that shows them', async () => {
        const { withFormFallbacks } = await import('./settingGuide.js');
        const p = withFormFallbacks({ strategy: 'x' });
        expect(p.trade_end_time).toBe('15:00');
        expect(p.sl_type).toBe('ATR');
        expect(p.fixed_sl_points).toBeUndefined();          // only with sl_type FIXED
        expect(withFormFallbacks({ sl_type: 'FIXED' }).fixed_sl_points).toBe(40);
        expect(withFormFallbacks({ trade_end_time: '14:00' }).trade_end_time).toBe('14:00');
    });
    it('max_trades_per_day is context, never a suggestion (single backtests ignore it)', () => {
        const cat = settingsCatalog({ max_trades_per_day: 10, trade_end_time: '15:00' }, null);
        expect(cat.map(c => c.key)).toEqual(['trade_end_time']);
        expect(assumptionsOf({ max_trades_per_day: 10 }).max_trades_per_day).toMatch(/no effect here/);
        const [r] = checkSuggestions({ max_trades_per_day: 4 }, cat);
        expect(r.status).toBe('invalid');
        expect(r.note).toMatch(/no effect in this backtest/);
    });
});
