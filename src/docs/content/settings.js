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
            title: 'Fyers API settings (the broker)',
            md: `**Fyers** is the broker the app trades and reads prices through. It needs an **App ID** and **Redirect URL** from your Fyers developer dashboard (the redirect URL must match exactly).

Fyers issues a login **token** that expires every day. **Auto Login (TOTP)** creates a fresh one automatically using your authenticator code (takes 10–15 seconds); the app also does this on its own each morning. **Delete Token** logs the app out — use it if the token is stuck or invalid, then log in again.

> **Warning:** Live orders are also refused unless the server's IP address is whitelisted in the Fyers dashboard. A successful [broker drill](go-live#drills) is the proof that everything works.`,
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
