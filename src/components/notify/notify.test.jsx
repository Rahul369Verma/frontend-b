import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationItem from './NotificationItem.jsx';
import { badgeOf, timeAgo, whenLine, WATCHED, firstSentence, auditHeadline } from './notifyFormat.js';
import { BlockedTradesView } from '../risk/BlockedTrades.jsx';
import { summaryLine } from '../risk/blockedFormat.js';
import { GateDecisionsView } from '../risk/GateDecisions.jsx';
import { aiFailureShort, ghostAiSummary } from '../risk/directionGateHistoryFormat.js';

// Simple first (user, 16-Oct-2026): every warning reads as one plain sentence;
// why / how to fix / raw detail sit behind a Details button.

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const NOW = Date.parse('2026-10-16T10:00:00Z');

const AI_DOWN = {
    _id: 'n1', key: 'ai:claude-web/claude-opus-5-5', status: 'open', kind: 'condition', severity: 'warning', category: 'ai',
    title: 'AI is not answering (claude-opus-5-5)',
    message: '4 deployments use it for in-flight review. While it fails, AI reviews return ERROR and trades fall back to their normal stops and targets.',
    reason: 'Claude.ai blocked the request with a Cloudflare "Just a moment…" browser check (HTTP 403). Last good answer: 2026-10-08 08:18 UTC.',
    action: 'Switch AI review to the official Claude API (an API key), or turn AI review off.',
    link: '/notifications#ai-health', firstAt: '2026-10-16T04:00:00Z', lastAt: '2026-10-16T09:58:00Z', count: 12, telegramAt: '2026-10-16T04:00:00Z',
    meta: { deployments: [{ name: 'breakout NIFTY' }, { name: 'inside_bar MIDCP' }], code: 'cloudflare_challenge' },
};

describe('NotificationItem', () => {
    it('shows one sentence; Details reveals why and how to fix; Acknowledge reports the row', () => {
        const onAck = vi.fn();
        wrap(<ul><NotificationItem n={AI_DOWN} onAck={onAck} /></ul>);
        expect(screen.getByText('AI is not answering (claude-opus-5-5)')).toBeTruthy();
        expect(screen.queryByText(/How to fix/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Details/ }));
        expect(screen.getByText(/Cloudflare/)).toBeTruthy();
        expect(screen.getByText(/official Claude API/)).toBeTruthy();
        expect(screen.getByText(/Affects: breakout NIFTY, inside_bar MIDCP/)).toBeTruthy();
        expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/notifications#ai-health');
        fireEvent.click(screen.getByRole('button', { name: /Acknowledge/ }));
        expect(onAck).toHaveBeenCalledWith(AI_DOWN);
    });
    it('a resolved one cannot be acknowledged', () => {
        wrap(<ul><NotificationItem n={{ ...AI_DOWN, status: 'resolved', resolvedAt: '2026-10-16T09:00:00Z' }} onAck={() => {}} /></ul>);
        expect(screen.queryByRole('button', { name: /Acknowledge/ })).toBeNull();
    });
});

describe('notifyFormat', () => {
    it('badge counts what needs a person; red when anything is urgent', () => {
        expect(badgeOf(null).count).toBe(0);
        expect(badgeOf({ unread: 2, bySeverity: { critical: 0, warning: 2 } })).toMatchObject({ count: 2, level: 'warning' });
        expect(badgeOf({ unread: 3, bySeverity: { critical: 1 } }).level).toBe('critical');
        expect(badgeOf({ unread: 0, bySeverity: {} }).label).toBe('Notifications — all clear');
    });
    it('time and the when-line', () => {
        expect(timeAgo('2026-10-16T09:59:30Z', NOW)).toBe('just now');
        expect(timeAgo('2026-10-16T09:15:00Z', NOW)).toBe('45 min ago');
        expect(timeAgo('2026-10-16T09:00:00Z', NOW)).toBe('1 h ago');
        expect(timeAgo('2026-10-14T10:00:00Z', NOW)).toBe('2 days ago');
        expect(whenLine(AI_DOWN, NOW)).toBe('since 6 h ago · seen 12× · sent to Telegram');
        expect(firstSentence('One thing broke. Then more.')).toBe('One thing broke.');
        expect(auditHeadline({ counts: { critical: 0, warn: 0, info: 3 } })).toBe('Everything reconciles — nothing to fix');
        expect(auditHeadline({ counts: { critical: 1, warn: 4 } })).toBe('1 urgent finding, 4 warnings');
    });
    it('the watched list covers the AI check, the broker, engines, disk and the database', () => {
        const all = WATCHED.map((w) => w.what).join(' | ');
        for (const w of ['AI not answering', 'Broker not logged in', 'engine halted', 'disk', 'Database unreachable', 'blocked a trade']) expect(all).toMatch(new RegExp(w, 'i'));
        expect(WATCHED.find((w) => /Nightly audit findings/.test(w.what)).when).toMatch(/19:30 IST \(the server runs it\)/);
    });
});

const BLOCKED = {
    days: 90,
    summary: { blocked: 3, wouldBlock: 1, saved: 2105, cost: 724, net: 1381, undecided: 0 },
    rows: [
        { id: 'd1', at: '2026-10-16T04:48:09Z', mode: 'enforce', side: 'CE', strategy: 'breakout_range', index: 'NIFTY', spotSymbol: 'NSE:NIFTY50-INDEX', confidence: 0.337, floor: 0.4,
            why: 'CE confidence 34% < floor 40%', state: 'followed', result: 'would have made −₹893 (SL Hit)', verdict: 'Blocking saved ₹893', net: -893, gateEffect: 893,
            summary: 'Blocked — CE confidence 34% < floor 40%. It would have made −₹893 (SL Hit).', contract: 'NSE:NIFTY26O1923150CE', entryPrice: 94.85, exitPrice: 82, exitReason: 'SL Hit',
            mae: -835, mfe: 868, sides: { CE: { confidence: 0.337 }, PE: { confidence: 0.51 } },
            aiReviews: [{ at: '2026-10-16T05:03:00Z', action: 'ERROR', failed: true, model: 'claude-web/claude-opus-5-5', reason: 'Claude.ai blocked the request with a Cloudflare check', fix: 'Use the official API' }] },
        { id: 'd2', at: '2026-10-15T06:00:00Z', mode: 'enforce', side: 'CE', strategy: 'universal', index: 'BANKNIFTY', confidence: 0.31, state: 'followed', result: 'would have made +₹724 (EMA Exit)', verdict: 'Blocking cost ₹724', net: 724, gateEffect: -724, summary: '…', aiReviews: [] },
    ],
};

describe('BlockedTrades', () => {
    beforeEach(() => { localStorage.clear(); });
    it('one plain summary line, then one row per block', () => {
        expect(summaryLine(BLOCKED.summary, 90)).toBe('3 blocked, 1 would have been blocked (shadow) in the last 90 days. Blocking saved ₹2,105 and cost ₹724 — net +₹1,381 (the gate made money).');
        expect(summaryLine({ blocked: 0, wouldBlock: 0 }, 30)).toBe('No trade was blocked in the last 30 days.');
        render(<BlockedTradesView data={BLOCKED} days={90} />);
        expect(screen.getByTestId('gate-verdict').textContent).toMatch(/Too few to judge \(4 of 10 needed\)/);
        const t = screen.getByTestId('blocked-trades');
        expect(t.textContent).toMatch(/would have made −₹893 \(SL Hit\)/);
        expect(t.textContent).toMatch(/Blocking cost ₹724/);
    });
    it('Details opens the full picture, including WHY the AI review failed', () => {
        render(<BlockedTradesView data={BLOCKED} days={90} />);
        fireEvent.click(screen.getAllByRole('button', { name: /Details/ })[0]);
        const dlg = screen.getByRole('dialog');
        expect(within(dlg).getByText(/Blocked — CE confidence 34% < floor 40%/)).toBeTruthy();
        expect(dlg.textContent).toMatch(/At that moment: CE 34% · PE 51%/);
        expect(dlg.textContent).toMatch(/NSE:NIFTY26O1923150CE/);
        expect(dlg.textContent).toMatch(/Worst point/);
        expect(within(dlg).getByText('Failed')).toBeTruthy();
        expect(dlg.textContent).toMatch(/Cloudflare/);
        expect(dlg.textContent).toMatch(/How to fix: Use the official API/);
    });
});

describe('GateDecisions', () => {
    it('reads the journal, not engine memory — and says so when empty', () => {
        render(<GateDecisionsView data={{ rows: [{ decisionId: 'x', at: '2026-10-16T07:50:10Z', strategy: 'hybrid_inside_bar', symbol: 'NSE:MIDCPNIFTY-INDEX', side: 'PE', decision: 'ALLOW', confidence: 0.509 }], total: 9 }} />);
        const d = screen.getByTestId('gate-decisions').textContent;
        expect(d).toMatch(/9 on record/);
        expect(d).toMatch(/MIDCPNIFTY PE/);
        expect(d).toMatch(/51%/);
        render(<GateDecisionsView data={{ rows: [], total: 0 }} />);
        expect(screen.getByText(/No decisions recorded yet/)).toBeTruthy();
    });
});

describe('ghost AI label', () => {
    it('a failed review reads "failed", with the reason — not a bare ERROR', () => {
        const a = ghostAiSummary({ inflightReviews: [{ ts: '2026-10-16T05:03:00Z', action: 'ERROR', reasoning: 'Safety default — 403 <title>Just a moment...</title>' }] });
        expect(a.label).toBe('1 AI · failed');
        expect(a.title).toMatch(/AI review failed — Claude.ai blocked the request \(Cloudflare check, HTTP 403\)/);
        expect(aiFailureShort('connect ECONNREFUSED')).toMatch(/could not be reached/);
    });
});
