/**
 * Settings → Broker accounts (9-Nov-2026): Fyers logins are entered here only, never in env.
 *   - every saved account is listed; the active one offers Log in now, the others Make active;
 *   - Make active is disabled while a LIVE Fyers position is open, and says why;
 *   - adding an account posts every field; a field error from the server lands under that field;
 *   - an edit sends only what changed — an empty secret keeps the saved one;
 *   - a missing BROKER_CREDS_KEY on the server is shown, and saving is disabled.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

let listReply;
const post = vi.fn();
const put = vi.fn();
vi.mock('axios', () => {
    const api = {
        get: vi.fn(() => Promise.resolve({ data: listReply })),
        post: (...a) => post(...a), put: (...a) => put(...a), delete: vi.fn(() => Promise.resolve({ data: {} })),
        defaults: { headers: { common: {} }, withCredentials: true },
        interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    };
    api.create = vi.fn(() => api);
    return { default: api, ...api };
});
import BrokerAccounts from './BrokerAccounts.jsx';
import { sessionLine } from './brokerAccountsModel.js';

const MAIN = {
    id: 'a1', label: 'Main', appId: 'ABCD1234EF-100', redirectUrl: 'https://trading.example/', clientId: 'XY•••45', active: true,
    saved: { secretKey: true, pin: true, totpKey: true }, lastLoginAt: '2026-11-09T03:31:00Z', lastLoginOk: true, token: null,
};
const FAMILY = { ...MAIN, id: 'a2', label: 'Family', clientId: 'AB•••90', active: false, lastLoginAt: null, lastLoginOk: null };
const SESSION = { account: { id: 'a1', label: 'Main' }, authenticated: true, tokenExpiresAt: '2026-11-10T00:30:00Z', tokenExpired: false };

beforeEach(() => {
    post.mockReset(); put.mockReset();
    listReply = { accounts: [MAIN, FAMILY], session: SESSION, key: { ok: true }, liveOpen: { total: 0 } };
});

const card = async (label) => (await screen.findByText(label)).closest('li');

describe('Broker accounts', () => {
    it('lists each account; the active one logs in, the other can be made active', async () => {
        render(<BrokerAccounts />);
        const main = await card('Main');
        expect(within(main).getByText('Active')).toBeTruthy();
        expect(within(main).getByText(/Logged in — token valid until/)).toBeTruthy();
        expect(within(main).getByRole('button', { name: /Log in now/ })).toBeTruthy();
        expect(within(main).queryByRole('button', { name: /Make active/ })).toBeNull();
        const fam = await card('Family');
        expect(within(fam).getByRole('button', { name: /Make active/ }).disabled).toBe(false);
        expect(within(fam).getByText('never')).toBeTruthy();
    });

    it('a LIVE position open: Make active is disabled and the page says why', async () => {
        listReply = { ...listReply, liveOpen: { total: 1 } };
        render(<BrokerAccounts />);
        const fam = await card('Family');
        const b = within(fam).getByRole('button', { name: /Make active/ });
        expect(b.disabled).toBe(true);
        expect(b.getAttribute('title')).toMatch(/Close the open LIVE positions first/);
        expect(screen.getByText(/1 LIVE position is open on Fyers/)).toBeTruthy();
    });

    it('add: posts every field; a field error from the server shows under that field', async () => {
        post.mockRejectedValueOnce({ response: { data: { error: 'PIN is the 4-digit Fyers login PIN.', fields: { pin: 'PIN is the 4-digit Fyers login PIN.' } } } });
        const onMessage = vi.fn();
        render(<BrokerAccounts onMessage={onMessage} />);
        fireEvent.click(await screen.findByRole('button', { name: /Add Fyers account/ }));
        const dialog = await screen.findByRole('dialog');
        const values = { Name: 'Third', 'Fyers client ID': 'CD11111', 'App ID': 'QQQQ1111WW-100', 'Secret key': 'sek', PIN: '12', 'TOTP key': 'KRSXG5CTMVRXEZLU' };
        for (const [label, v] of Object.entries(values)) fireEvent.change(within(dialog).getByLabelText(label), { target: { value: v } });
        expect(within(dialog).getByLabelText('PIN').getAttribute('type')).toBe('password');
        expect(within(dialog).getByLabelText('PIN').getAttribute('autocomplete')).toBe('new-password');
        fireEvent.click(within(dialog).getByRole('button', { name: /Save account/ }));
        await waitFor(() => expect(post).toHaveBeenCalled());
        expect(post.mock.calls[0][0]).toMatch(/\/broker-accounts$/);
        expect(post.mock.calls[0][1]).toMatchObject({ label: 'Third', clientId: 'CD11111', appId: 'QQQQ1111WW-100', secretKey: 'sek', pin: '12', totpKey: 'KRSXG5CTMVRXEZLU' });
        expect(post.mock.calls[0][1].redirectUrl).toBeTruthy();
        const pin = within(dialog).getByLabelText('PIN');
        await waitFor(() => expect(pin.getAttribute('aria-invalid')).toBe('true'));
        expect(within(dialog).getByText('PIN is the 4-digit Fyers login PIN.')).toBeTruthy();
    });

    it('edit: sends only what changed; empty secrets are kept', async () => {
        put.mockResolvedValueOnce({ data: { account: { ...MAIN, label: 'Main acct' }, loginChanged: false, accounts: [MAIN, FAMILY], session: SESSION } });
        render(<BrokerAccounts onMessage={() => {}} />);
        const main = await card('Main');
        fireEvent.click(within(main).getByRole('button', { name: /Edit/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByLabelText('PIN').getAttribute('placeholder')).toMatch(/leave empty to keep/);
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Main acct' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /Save changes/ }));
        await waitFor(() => expect(put).toHaveBeenCalled());
        expect(put.mock.calls[0][0]).toMatch(/\/broker-accounts\/a1$/);
        expect(put.mock.calls[0][1]).toEqual({ label: 'Main acct' });
    });

    it('no BROKER_CREDS_KEY on the server: says so and nothing can be saved', async () => {
        listReply = { accounts: [], session: { authenticated: false }, key: { ok: false, message: 'BROKER_CREDS_KEY is not set.' }, liveOpen: { total: 0 } };
        render(<BrokerAccounts />);
        expect((await screen.findByRole('alert')).textContent).toMatch(/BROKER_CREDS_KEY is not set/);
        expect(screen.getByRole('button', { name: /Add Fyers account/ }).disabled).toBe(true);
        expect(screen.getByText(/No Fyers account yet/)).toBeTruthy();
    });

    it('sessionLine: an expired token on the active account reads as such', () => {
        expect(sessionLine(MAIN, { authenticated: true, tokenExpired: true }).text).toMatch(/Token expired/);
        expect(sessionLine(MAIN, { authenticated: false }).tone).toBe('critical');
        expect(sessionLine(FAMILY, SESSION).text).toBe('Not in use');
    });
});
