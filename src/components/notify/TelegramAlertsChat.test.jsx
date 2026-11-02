/**
 * Settings → Telegram: the urgent-alerts chat (2-Nov-2026). Not set, set, refusing — each said;
 * the chats that added the bot are listed with their ids; the test says where the message went.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let SETTINGS = {};
let TEST_ANSWER = {};
vi.mock('axios', () => {
    const get = vi.fn(() => Promise.resolve({ data: SETTINGS }));
    const post = vi.fn((url, body) => Promise.resolve({ data: /test-telegram$/.test(url) && body && body.chat === 'alerts' ? TEST_ANSWER : { ok: true } }));
    const api = { get, post, defaults: { headers: { common: {} } }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import TelegramSettingsPanel from './TelegramSettingsPanel.jsx';

const BASE = { telegram: true, telegramLevels: ['critical', 'warning'], reminderHours: 6, resolvedToTelegram: true, telegramConfigured: true, env: 'production' };
const openPanel = () => { const b = screen.getAllByRole('button').find((x) => x.getAttribute('aria-expanded') === 'false' && x.textContent.includes('Telegram')); if (b) fireEvent.click(b); };

describe('TelegramSettingsPanel — urgent alerts chat', () => {
    beforeEach(() => { SETTINGS = {}; TEST_ANSWER = {}; });

    it('not set: says urgent alerts go to the main chat, how to set it, and lists the group that added the bot with its id', async () => {
        SETTINGS = { ...BASE, alerts: { configured: false, sameAsMain: false, chatId: null, seenChats: [{ id: '-1002233445566', title: 'Trading alerts', type: 'supergroup', status: 'member', lastAt: '2026-11-02T04:00:00Z' }] } };
        render(<TelegramSettingsPanel />);
        openPanel();
        await waitFor(() => expect(screen.getByTestId('alerts-chat')).toBeTruthy());
        const t = screen.getByTestId('alerts-chat').textContent;
        expect(t).toMatch(/Not set: urgent alerts go to the main chat/);
        expect(t).toMatch(/create a group/);
        expect(t).toMatch(/TELEGRAM_ALERTS_CHAT_ID=<that id>/);
        expect(t).toMatch(/Trading alerts supergroup · bot member — -1002233445566/);
    });

    it('set but refusing: the failure and the fallback are said; the test answer names the chat it reached', async () => {
        SETTINGS = { ...BASE, alerts: { configured: true, chatId: '-1001', lastOkAt: '2026-11-02T03:00:00Z', lastErrorAt: '2026-11-02T04:00:00Z', lastError: '403 Forbidden: bot is not a member of the supergroup chat', seenChats: [] } };
        TEST_ANSWER = { ok: true, chat: 'main (the alerts chat refused it)', error: '403 Forbidden: bot is not a member of the supergroup chat' };
        render(<TelegramSettingsPanel />);
        openPanel();
        await waitFor(() => expect(screen.getByTestId('alerts-chat')).toBeTruthy());
        const t = screen.getByTestId('alerts-chat').textContent;
        expect(t).toMatch(/Set: urgent alerts go to chat -1001/);
        expect(t).toMatch(/refused the last urgent alert at .*bot is not a member.*sent to the main chat instead/);
        fireEvent.click(screen.getByRole('button', { name: /Test the alerts chat/ }));
        await waitFor(() => expect(screen.getByTestId('alerts-chat').textContent).toMatch(/Sent — to the main \(the alerts chat refused it\) chat\./));
        const axios = (await import('axios')).default;
        expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/notifications\/test-telegram$/), { chat: 'alerts' });
    });

    it('an older server (no alerts field): the panel still renders, without the section', async () => {
        SETTINGS = { ...BASE };
        render(<TelegramSettingsPanel />);
        openPanel();
        await waitFor(() => expect(screen.getByText(/Send notifications to Telegram/)).toBeTruthy());
        expect(screen.queryByTestId('alerts-chat')).toBeNull();
    });
});
