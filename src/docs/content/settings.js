// Docs: Settings (/settings) — broker keys, the daily loss limit, AI cookies and notifications.
export default {
    id: 'settings',
    title: 'Settings',
    route: '/settings',
    summary: 'App-wide configuration: where live prices come from, the daily loss limit that protects the account, the broker connections (Fyers, Angel One), MCX trading, the AI login cookies and Telegram notifications. Three tabs: API Configuration, AI Web Cookies and Notifications.',
    sections: [
        {
            id: 'data-source',
            title: 'Live data source',
            where: 'API Configuration tab → General Configuration',
            md: `Where the engine reads the market price for its analysis:

- **Spot Price (Index)** — the index value itself (for example NIFTY 50). An index cannot be traded, so it carries no volume.
- **Futures Price (Current Month)** — the near-month future, which tracks the index closely and does carry volume (useful for volume-based strategies).

Options are always bought and sold as options; this only changes what the strategies *look at*.`,
        },
        {
            id: 'risk-limits',
            title: 'Max Daily Loss — the account circuit breaker',
            where: 'API Configuration tab → General Configuration',
            md: `If the day's loss reaches this amount (closed trades **plus** the current loss on open ones), the engine **halts**: it blocks every new entry, for single-option *and* multi-leg deployments. Positions already open still exit normally on their stop, target or time.

- A halt set by this limit **lifts by itself at the start of the next trading day**.
- A halt you set yourself (the kill switch) does **not** lift by itself — you must resume it.
- Set it to the most you are willing to lose in one day. Too small and one bad morning stops trading; too large and it protects nothing.

> **Note:** Each deployment can also have its own limits; this one covers the whole account. Account-wide exposure limits (premium at risk, short volatility) live on [Portfolio Risk → Limits](risk#limits).`,
        },
        {
            id: 'fyers',
            title: 'Fyers broker accounts',
            where: 'API Configuration tab → Fyers broker accounts',
            md: `**Fyers** is the broker the app trades and reads prices through. Its logins are set up **here only**. They are saved in the app's database, never in configuration files, and nothing falls back to those files.

You can save several accounts (for example your own and a family member's). **One is active**, and the whole app uses it for prices, option chains and orders.

**What each account needs**
- **Name**: your own label.
- **Fyers client ID**: the ID you log in to Fyers with.
- **App ID** and **Secret key**: from the Fyers API dashboard (myapi.fyers.in) → your app.
- **Redirect URL**: exactly the one set on that Fyers app. For this app it is the server's own address, which the form shows.
- **PIN**: the 4-digit Fyers login PIN.
- **TOTP key**: the text key Fyers shows when you turn on *External 2FA TOTP*. It is not a 6-digit code.

The secret key, PIN and TOTP key are **encrypted on the server** and are never shown again. To change one, type the new value. A field left empty keeps the saved value.

**Steps to add an account**
1. In the Fyers API dashboard, create an app with this server's address as its redirect URL. Copy the App ID and Secret key.
2. Turn on External 2FA TOTP in the Fyers account's security settings and copy the text key (add it to your authenticator app too).
3. Whitelist the server's IP address on the Fyers app. Without that, Fyers refuses every order.
4. Press **Add Fyers account**, fill every field and save. The first account becomes active and logs in at once. Its card shows whether the login worked, and if not, which step failed.

**Logging in.** A Fyers token lasts one day. The app logs in by itself with the saved PIN and TOTP key whenever the token is missing or expired. **Log in now** does it on demand (10–15 seconds). **Browser login** uses the Fyers website instead.

**Switching accounts.** Press **Make active** on another account. The data feed and every order move to it within seconds. This is **refused while a LIVE position is open**, because that position's orders and stop-loss belong to the account that opened it. Close it first. Deleting the active account has the same rule.

> **Warning:** Use one Fyers account per server. Two servers (production, a dev machine, the optimizer box) logged in with the same account keep logging each other out. Live orders also need the server's IP address whitelisted in the Fyers dashboard. A successful [broker drill](go-live#drills) proves everything works.`,
        },
        {
            id: 'angel',
            title: 'Angel One settings',
            md: `An optional second broker connection (its **API Key**). It is used only as an alternative source of historical candles, for example when training models; every order goes through Fyers.`,
        },
        {
            id: 'mcx',
            title: 'Commodities (MCX)',
            md: `**Enable MCX Trading** allows the engine to trade commodity futures such as Gold, Silver and Crude Oil. MCX trades much longer hours than NSE (into the night), has different lot sizes and margins (see [Market Rules](market-rules)), and its contracts are named by expiry month.`,
        },
        {
            id: 'ai-cookies',
            title: 'AI Web Cookies',
            md: `The AI confirmation and review features talk to Claude and Gemini through their websites, using your logged-in session. Paste the cookie values from your browser (**Claude sessionKey** and **org_id**; Gemini **__Secure-1PSID**, **__Secure-1PSIDTS** and optionally **__Secure-1PSIDCC**) and press **Update cookies**. Cookies expire; when the AI starts failing, refresh them.

> **Warning:** These values are logins. Anyone who has them can use your AI accounts — never share them or paste them anywhere else.`,
        },
        {
            id: 'notifications',
            title: 'Notifications',
            md: `The app sends Telegram messages for entries, exits, halts, errors and alerts. **Send Test Notification** sends a test message so you can check the Telegram bot is connected.`,
        },
    ],
};
