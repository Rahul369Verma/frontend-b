// Docs: Strategy Detail (/strategy/:symbol) — one deployment's (or one index's) full results.
export default {
    id: 'strategy-detail',
    title: 'Strategy Detail',
    route: '/strategy/NSE:NIFTY50-INDEX',
    summary: 'The results page for one single-option deployment (or every trade on one index): equity curve, day-by-day curves, calendar, every trade with its path, and when in the day it makes or loses money. Reached from a deployment card\'s results buttons or the Live Portfolio.',
    sections: [
        {
            id: 'scope',
            title: 'What is being shown: deployment or index',
            where: 'Header',
            md: `The header names the deployment (its ID can be copied) and says **INACTIVE** if it is switched off. Two scopes:

- **This deployment** — only trades tagged with this exact deployment (deployment tagging started at a certain date, so very old trades may be missing).
- **Every trade on this underlying** — all trades on the index, whichever strategy took them.

**Jump to another deployment** switches without going back. The window selector picks the last 7 / 30 / 90 days or all time.`,
        },
        {
            id: 'summary',
            title: 'Summary tiles',
            md: `**Total P&L**, number of **trades**, **win rate**, **profit factor**, best and worst trade, best and worst day, average win and average loss — all for the chosen scope and window. See [Reading performance statistics](basics#stats) for what each means.`,
        },
        {
            id: 'tabs',
            title: 'The five views',
            md: `| View | Shows |
|---|---|
| **Equity Curve** | Cumulative P&L trade by trade. |
| **Day by day** | One curve per trading day — how each day's P&L built up through the session. Some trade paths are rebuilt from the 1-minute option archive: approximate and before costs (marked so). |
| **Calendar** | One square per day, coloured by result. |
| **Trades** | Every trade: entry, exit, contract, side, worst and best point while open ([MAE/MFE](glossary#mae-mfe)), reason, P&L. Expand a row to see its price path. |
| **P&L · Hours** | The distribution of trade results (how many small wins, big losses…) and a heat-map of P&L by **weekday × time of day** — where in the week and the session the strategy makes or loses money. |`,
        },
    ],
};
