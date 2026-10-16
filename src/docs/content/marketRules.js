// Docs: Market Rules (/market-rules) — lot sizes, ticks, sessions, holidays and margins, kept in sync with the market.
export default {
    id: 'market-rules',
    title: 'Market Rules',
    route: '/market-rules',
    summary: 'Exchanges change their rules: lot sizes, trading hours, holidays, margins and charges. A strategy running on an out-of-date lot size or holiday list trades the wrong quantity or tries to trade a closed market. This page checks those rules against several sources twice a day and shows anything that disagrees.',
    sections: [
        {
            id: 'overview',
            title: 'How rules are kept current',
            md: `Twice a day (**07:45** and **18:45 IST**, and 2 minutes after a restart) the app reads each rule from several sources — NSE, and the brokers Fyers, Upstox and Zerodha. (MCX's and BSE's own websites refuse automated access, so their rules come from broker feeds.)

A value is **applied** only when the sources agree, the exchange itself says so, or it is the only source. Anything else is **held** — not applied — and listed here for review. A held value never silently changes how the app trades.

**Sync now** runs a check immediately. **+ contract calendar** also rebuilds the recent list of contract expiries, lot sizes and strike steps from the exchanges' daily price files (takes a few minutes).`,
        },
        {
            id: 'summary',
            title: 'The headline tiles',
            md: `| Tile | Meaning |
|---|---|
| **Last sync** | When the last check ran and what started it. |
| **Facts** | How many rules are tracked: **confirmed** (sources agree), **one source**, **stale** (not re-confirmed recently). |
| **Held** | Rules where sources disagree, or a value jumped suspiciously — waiting for review. Should be 0. |
| **Code ≠ market** | Settings written into the app's code that disagree with confirmed facts. |
| **Rule circulars to review** | New notices from SEBI / NSE / charges pages that may change a rule. |`,
        },
        {
            id: 'sources',
            title: 'Sources',
            md: `Each source from the last sync: how many readings it supplied, how many circulars, and how long it took. A source returning nothing usually means its website changed or blocked the request.`,
        },
        {
            id: 'drift',
            title: 'Where the code disagrees with the market',
            md: `Some rules are written into the app's code (for example lot sizes in the instrument settings, session times, holiday lists). This compares them with the confirmed facts. Holidays and MCX margins are already taken from the synced facts while the app runs; a **lot size** listed here needs a code change to fix.`,
        },
        {
            id: 'tabs',
            title: 'Facts, Changes, Circulars, Sync history',
            md: `- **Facts** — every tracked rule by family (**MCX margin**, **Lots**, **Ticks** (smallest price step), **Sessions** (trading hours), **Holidays**), with its value, status (**Confirmed**, **One source**, **Held**, **Stale**), which sources supported it, the date it is **in force from** and when it was last checked. A held fact shows the **proposed** value that was not applied. Search and filter by status.
- **Changes** — every time a rule changed: when, kind, from → to, and why.
- **Circulars** — notices from the regulators and exchanges. **Can change a rule** (lots, margins, expiry, sessions, holidays, taxes and charges), **Derivatives news**, or **All**. Open one to read it; mark it reviewed once you have checked whether it affects the app.
- **Sync history** — every run: started, trigger, sources, facts, changes and errors.`,
        },
    ],
};
