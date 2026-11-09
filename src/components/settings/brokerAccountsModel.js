import { API_URL } from '../../config/api.js';
import { istDateTime } from '../viz/tokens';

// The pieces of Settings → Broker accounts that are not components (BrokerAccounts.jsx).

// this server's own address — what a Fyers app's redirect URL should be (GET / takes the auth_code)
export const serverAddress = () => String(API_URL || '').replace(/\/api\/?$/, '/');

export const FIELDS = [
    { key: 'label', label: 'Name', help: 'Your name for this account, e.g. "Main" or "Family".' },
    { key: 'clientId', label: 'Fyers client ID', help: 'The ID you log in to Fyers with, e.g. XY12345.' },
    { key: 'appId', label: 'App ID', help: 'From the Fyers API dashboard (myapi.fyers.in), e.g. ABCD1234EF-100.' },
    { key: 'secretKey', label: 'Secret key', help: 'The app\'s secret, shown next to its App ID.', secret: true },
    { key: 'redirectUrl', label: 'Redirect URL', help: 'Exactly the redirect URL set on that Fyers app. For this server it is the address shown below.' },
    { key: 'pin', label: 'PIN', help: 'Your 4-digit Fyers login PIN.', secret: true, inputMode: 'numeric' },
    { key: 'totpKey', label: 'TOTP key', help: 'The text key Fyers shows when you turn on External 2FA TOTP (letters and digits) — not a 6-digit code.', secret: true },
];

/** What the card says about an account's session. */
export function sessionLine(account, session) {
    if (account.active && session) {
        if (session.authenticated && !session.tokenExpired) {
            return { tone: 'good', text: session.tokenExpiresAt ? `Logged in — token valid until ${istDateTime(session.tokenExpiresAt)}` : 'Logged in' };
        }
        return { tone: 'critical', text: session.tokenExpired ? 'Token expired — log in again' : 'Not logged in' };
    }
    if (account.token && !account.token.expired && account.token.expiresAt) return { tone: 'neutral', text: `Saved token valid until ${istDateTime(account.token.expiresAt)}` };
    return { tone: 'muted', text: 'Not in use' };
}

