import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('axios', () => {
    const get = vi.fn(), post = vi.fn();
    return { default: { get, post } };
});
import axios from 'axios';
import MemberBuilder from './MemberBuilder.jsx';
import CombinerReport from './CombinerReport.jsx';
import PortfolioRunPanel from './PortfolioRunPanel.jsx';
import { CombinerGates } from '../optimizer/CombinerGatesPanel.jsx';
import { parseMembers, bucketsAddUp } from './combinerApi.js';

const CATALOG = {
    eligible: [
        { id: 'smc_ob', label: 'Smart Money', presets: [{ id: 'smc_fast', label: 'Fast', evidence: 'validated' }] },
        { id: 'wyckoff_spring', label: 'Wyckoff', presets: [] },
    ],
    excluded: [{ id: 'rl_agent', label: 'RL Agent', reason: 'its entry check is asynchronous' }],
    rules: [{ id: 'quorum', description: '' }],
    roles: [{ id: 'voter' }, { id: 'primary' }, { id: 'confirm' }, { id: 'veto' }],
};
const resolved = (members) => ({
    ok: true,
    members: members.map((m, i) => ({ id: m.strategy, strategy: m.strategy, role: m.role || 'voter', weight: 1, params: { x: i }, hash: `h${i}`, source: m.source || { kind: 'defaults' } })),
    dataNeeds: { use_15m_filter: true, use_1h_filter: false },
    errors: [],
});

beforeEach(() => {
    axios.get.mockReset(); axios.post.mockReset();
    axios.get.mockImplementation((url) => {
        if (url.endsWith('/combiner/members')) return Promise.resolve({ data: CATALOG });
        if (url.endsWith('/settings')) return Promise.resolve({ data: { max_daily_loss: 3000, max_trades_per_day: 5 } });
        return Promise.resolve({ data: [] });
    });
});

describe('combinerApi helpers', () => {
    it('reads every form of the members param', () => {
        expect(parseMembers('smc_ob, wyckoff_spring')).toEqual([{ strategy: 'smc_ob' }, { strategy: 'wyckoff_spring' }]);
        expect(parseMembers('[{"strategy":"smc_ob","role":"veto"}]')).toEqual([{ strategy: 'smc_ob', role: 'veto' }]);
        expect(parseMembers(['smc_ob'])).toEqual([{ strategy: 'smc_ob' }]);
        expect(parseMembers('')).toEqual([]);
    });
    it('checks that every member signal is in exactly one bucket', () => {
        expect(bucketsAddUp({ fired: 5, used: 2, cleared: 1, replaced: 0, expired: { NO_QUORUM: 1 }, openAtEnd: 1 })).toBe(true);
        expect(bucketsAddUp({ fired: 5, used: 2, cleared: 0, replaced: 0, expired: {}, openAtEnd: 0 })).toBe(false);
    });
});

describe('MemberBuilder', () => {
    it('resolves the members on the backend and writes back only a clean result, with the data needs', async () => {
        axios.post.mockImplementation((url, body) => Promise.resolve({ data: resolved(body.members) }));
        const onChange = vi.fn();
        render(<MemberBuilder value="smc_ob,wyckoff_spring" resolution="5" onChange={onChange} />);
        await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 2000 });
        const [json, needs] = onChange.mock.calls[0];
        expect(JSON.parse(json).map(m => m.id)).toEqual(['smc_ob', 'wyckoff_spring']);
        expect(needs).toEqual({ use_15m_filter: true, use_1h_filter: false });
        expect(axios.post.mock.calls[0][1]).toMatchObject({ resolution: '5', members: [{ strategy: 'smc_ob' }, { strategy: 'wyckoff_spring' }] });
        expect(await screen.findByText('#h0')).toBeTruthy();
        // what cannot be a member is shown, with the reason
        expect(screen.getByText(/RL Agent — its entry check is asynchronous/)).toBeTruthy();
    });

    it('shows a resolve error next to the member and does not write the bad set back', async () => {
        axios.post.mockResolvedValue({ data: { ok: false, members: [], errors: [{ index: 0, strategy: 'smc_ob', error: 'deployment x not found' }] } });
        const onChange = vi.fn();
        render(<MemberBuilder value="smc_ob" onChange={onChange} />);
        expect(await screen.findByText(/deployment x not found/, {}, { timeout: 2000 })).toBeTruthy();
        expect(screen.getByText(/not applied/)).toBeTruthy();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('a new source drops the frozen params so the member is resolved afresh', async () => {
        axios.post.mockImplementation((url, body) => Promise.resolve({ data: resolved(body.members) }));
        render(<MemberBuilder value='[{"strategy":"smc_ob","params":{"a":1},"source":{"kind":"defaults"}}]' onChange={vi.fn()} />);
        const select = await screen.findByDisplayValue('Code defaults');
        fireEvent.change(select, { target: { value: 'preset:smc_fast' } });
        await waitFor(() => {
            const last = axios.post.mock.calls[axios.post.mock.calls.length - 1][1].members[0];
            expect(last.source).toEqual({ kind: 'preset', ref: 'smc_fast' });
            expect(last.params).toBeUndefined();
        }, { timeout: 2000 });
    });
});

const REPORT = {
    kind: 'signal_combiner', rule: 'quorum', settings: { vote_window_bars: 3 }, entries: 2, trades: 2, tradesWithSignalRecord: 2,
    decisions: { ENTER: 2, NO_QUORUM: 7 },
    members: [
        { id: 'a', strategy: 'smc_ob', role: 'voter', hash: 'h1', source: { kind: 'defaults' }, fired: 4, CE: 3, PE: 1, used: 2, chosen: 2, cleared: 0, replaced: 0, expired: { NO_QUORUM: 2 }, openAtEnd: 0, errors: 0, dailyCapDisabled: true },
        { id: 'b', strategy: 'wyckoff_spring', role: 'voter', hash: 'h2', source: { kind: 'defaults' }, fired: 3, CE: 3, PE: 0, used: 2, chosen: 0, cleared: 0, replaced: 0, expired: {}, openAtEnd: 0, errors: 0 },
    ],
    coFire: { ids: ['a', 'b'], windowBars: 3, same: [[0, 2], [2, 0]], opposite: [[0, 0], [0, 0]] },
    voterSets: [{ key: 'a+b', trades: 2, wins: 1, net: 350 }], byChosen: [{ key: 'a', trades: 2, wins: 1, net: 350 }], warnings: [],
};

describe('CombinerReport', () => {
    it('accounts for every member signal and flags a member whose buckets do not add up', () => {
        const bad = { ...REPORT, members: [REPORT.members[0], { ...REPORT.members[1], used: 1 }] };
        render(<CombinerReport report={bad} />);
        expect(screen.getByText('NO')).toBeTruthy();                         // "Buckets add up" tile
        expect(screen.getAllByTitle('buckets do not add up to fired').length).toBe(1);
        expect(screen.getAllByText('a+b').length).toBeGreaterThan(0);
        expect(screen.getByText(/too few members agreed 2/)).toBeTruthy();
    });
});

describe('CombinerGates', () => {
    it('says why a combiner is not crowned', () => {
        render(<CombinerGates gates={{ pass: false, verdict: 'does not beat its best member wyckoff_spring (2.139 vs 1.499)', drawId: 12, trades: 52, combinerScore: 1.4995, bestMember: 'wyckoff_spring', beatsBestMemberBy: -0.64,
            members: [{ label: 'wyckoff_spring', trades: 173, deflatedNoTrials: 2.139, oosPnL: 5000 }], null: { runs: 19, pAccept: 0.25, targetTrades: 52, tradesRange: [34, 53], atLeastAsGood: 2, pValue: 0.15 } }} />);
        expect(screen.getByText('Not crowned')).toBeTruthy();
        expect(screen.getByText(/does not beat its best member/)).toBeTruthy();
        expect(screen.getByText(/2 scored at least as well → p = 0.15/)).toBeTruthy();
    });
});

describe('PortfolioRunPanel', () => {
    it('runs the strategies together with the form\'s data settings and the live account caps, and shows refused entries', async () => {
        axios.post.mockResolvedValue({ data: {
            multi: true, capital: 200000,
            portfolio: { metrics: { totalTrades: 3, totalPnL: 1200, winRate: 66.7, profitFactor: 2.1, roiPct: 0.6 }, equityCurve: [{ date: '2026-01-01T04:00:00Z', balance: 200000 }, { date: '2026-01-02T04:00:00Z', balance: 201200 }] },
            withSharedCaps: { metrics: { totalTrades: 2, totalPnL: 900 }, equityCurve: [], dropped: [{ deployment: 'Smart Money', entryTime: '2026-01-02T05:00:00Z', type: 'CE', pnl: 300, reason: 'daily trade cap (5/5)' }], droppedByDeployment: { 'Smart Money': 1 }, note: 'n' },
            overlap: { windowMinutes: 15, pairs: [{ a: 'Smart Money', b: 'Wyckoff', aEntries: 2, bEntries: 1, sameSide: 1, oppositeSide: 0, daysBothTraded: 1, days: 2, dailyPnlCorrelation: 0.5 }] },
            dataLoads: { distinct: 3, requests: 6 },
            perDeployment: [{ name: 'Smart Money', metrics: { totalTrades: 2, totalPnL: 800 }, capital: 100000, equityCurve: [] }, { name: 'Wyckoff', metrics: { totalTrades: 1, totalPnL: 400 }, capital: 100000, equityCurve: [] }],
        } });
        const base = { symbol: 'NSE:NIFTY50-INDEX', start_date: '2026-01-01', end_date: '2026-02-01', capital: 200000, resolution: '5', dataSource: 'ARCHIVE_SPOT', strategy: 'smc_ob', ema_fast: 9 };
        render(<PortfolioRunPanel baseParams={base} presets={{}} strategyOptions={[{ id: 'smc_ob', label: 'Smart Money' }, { id: 'wyckoff_spring', label: 'Wyckoff' }]} />);
        await waitFor(() => expect(screen.getByDisplayValue('3000')).toBeTruthy());     // caps from Settings
        fireEvent.click(screen.getByRole('button', { name: /Run 2 together/ }));
        await screen.findByText('All together — net');
        const body = axios.post.mock.calls[0][1];
        expect(body.deployments.map(d => d.strategyName)).toEqual(['smc_ob', 'wyckoff_spring']);
        expect(body.shared_caps).toEqual({ max_daily_loss: 3000, max_trades_per_day: 5 });
        expect(body.dataSource).toBe('ARCHIVE_SPOT');
        expect(body.ema_fast).toBeUndefined();                                        // single-strategy params stay out
        expect(screen.getByText('3 for 6 requests')).toBeTruthy();
        expect(screen.getByText(/Entries the account caps refused \(1\)/)).toBeTruthy();
        const table = screen.getAllByRole('table')[0];
        expect(within(table).getByText('Smart Money')).toBeTruthy();
    });
});
