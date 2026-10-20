// Docs: Live Portfolio (/live-portfolio) — what everything has earned.
export default {
    id: 'live-portfolio',
    title: 'Live Portfolio',
    route: '/live-portfolio',
    summary: 'What every deployment has earned, in one place: combined totals, one card per strategy, curves, a calendar and breakdowns. The Dashboard is "what is running now"; this page is "what has it all made".',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for',
            md: `Use it to judge results over days and weeks rather than minutes:

- Is the whole book making money? (the combined summary and equity curve)
- Which strategies are carrying it, and which are dragging it down? (strategy cards, breakdowns)
- Are costs eating the profit? (costs line)
- How did trades behave while they were open? (how trades travelled)

Every figure counts **closed** trades only. Open positions are shown separately at the top and are **not** included in any total below them.`,
        },
        {
            id: 'controls',
            title: 'Controls: engine and window',
            where: 'Header',
            md: `- **Single-leg / Multi-leg** — which engine's book to show: single-option trades or multi-leg structures.
- **7d / 30d / 90d / All** — the window, by the day each trade **closed**.
- **Refresh** reloads now (the page also updates itself).
- For multi-leg, the link to **Multi-Leg Results** opens the full results tab with filters by deployment, symbol and structure, and every round-trip.`,
        },
        {
            id: 'open-now',
            title: 'Open now',
            md: `Positions currently open, marked at the latest price: deployment, contract, since when, and **MTM**. These figures are **before costs** — charges are booked when the trade closes — and they keep moving until each position exits.`,
        },
        {
            id: 'summary',
            title: 'Combined summary and costs',
            md: `The headline figures for the window: **Net P&L**, **per trade** (total ÷ number of trades, the true average), **win rate**, **profit factor**, **max drawdown**, best and worst.

The **costs** line says how much trading cost against what was made before costs, and how many trades actually recorded their charges (older trades may not have).

> **Tip:** If charges are a large share of gross profit, the strategy's edge is being spent on costs — trading less often, or in larger size per trade, may matter more than better signals.`,
        },
        {
            id: 'strategies',
            title: 'Strategy cards',
            md: `One card per strategy, ranked by net over the window. Each shows net, per trade, win rate, profit factor, the last 7 and 30 days, the most recent trade, a small equity curve and the mode of its deployments. Labels:

- **Running** — has active deployments.
- **Bleeding** — net negative over the window.
- **Fading** — positive overall but negative over the last 30 days.
- A note like **"only 4 closed trades"** — too few to judge.

**Details** expands the card into its own P&L chart, equity curve, exits by reason and list of deployments (each linking to its detail page). **Compare** adds the strategy to the comparison chart.`,
        },
        {
            id: 'compare',
            title: 'Compare equity curves',
            md: `The selected strategies' cumulative net curves against the combined book, on one axis. Pick strategies with their **Compare** buttons; the button in the header goes back to the default selection (the most-traded strategies).`,
        },
        {
            id: 'daily-equity',
            title: 'Daily P&L and equity curve (combined)',
            md: `- **Daily net P&L** — one bar per trading day (by exit day, IST), green above zero and red below. Drag across the chart to zoom.
- **Equity curve** — the running total of net P&L, with the **drawdown** (fall from the previous peak) shaded underneath. A deep or long shaded area is a painful stretch.`,
        },
        {
            id: 'calendar',
            title: 'Daily P&L calendar',
            md: `One square per calendar day, coloured by that day's net result: green shades for profit, red for loss, darker for bigger (the darkest is beyond ±₹5,000). Grey means no trade closed that day. Patterns such as "Mondays are always red" are easy to spot here — but check them with enough weeks before acting.`,
        },
        {
            id: 'breakdowns',
            title: 'Breakdowns',
            md: `The same trades grouped different ways (by strategy, deployment, symbol, exit reason, weekday, entry hour and more). Columns: **Trades**, **Win %**, **Net**, **Per trade**, **Costs ÷ gross**, **Best**, **Worst**, **Last trade**. Click a column heading to sort.

Every tab adds up to the header total: trades with no deployment or strategy are shown under a label, never dropped.

> **Note:** By exit reason: many stop-loss exits suggest entries are poor; many take-profit exits but a negative total suggests the stop is too wide.`,
        },
        {
            id: 'excursions',
            title: 'How trades travelled',
            md: `For each trade, the worst and best point it reached while open ([MAE and MFE](glossary#mae-mfe)), and what a stop or a target placed at a given level would have done on its own. Use it to test questions like "would a tighter stop have helped?" — on real trades, not a backtest.

**Stop-loss from these trades** suggests a stop level. It picks the level on the older 70% of trades and only offers it if it also helped on the newest 30%. You can type any level and see what it would have changed.

**Set this stop on deployments…** (both engines):
- **Multi-leg:** sets each chosen deployment's rupee stop (*Max loss ₹*). The whole structure closes when its net mark reaches the level.
- **Single-leg:** sets each chosen deployment's stop cap (\`max_single_trade_loss\`, stored **per lot**, so the dialog divides the level by the deployment's lots). From the next entry, a stop that would risk more than the level is pulled in to it. A tighter stop is left alone, and an open position keeps its stop. The live engine, the backtests and the optimizer apply the same rule.

Single-leg marks are taken **before charges**, so this book compares each trade's worst point with its **gross** result.`,
        },
        {
            id: 'deployments',
            title: 'Deployments (single-leg)',
            where: 'Cards under the summary',
            md: `One card per deployment (a strategy on one index, in one mode), ranked by net: its curve, net, per trade, win rate, max drawdown, and the last 7 and 30 days.

**Click a card** to show only that deployment everywhere on the page: the tiles, breakdowns, how trades travelled, every round trip and the day-by-day curves. The **Deployment** box at the top does the same. **All deployments** clears it, and the choice is kept in the link (\`?dep=\`). **Open page** opens the deployment's own page.`,
        },
        {
            id: 'round-trips',
            title: 'Round trips (single-leg)',
            where: 'Table near the bottom',
            md: `Every closed trade in the window, 50 to a page, searchable (contract, index, strategy, exit reason or a trade-id fragment) and sortable. Each row shows:

| Column | Meaning |
|---|---|
| **Gate** | The direction gate's verdict at entry. **Allowed** means the side was at or above the floor. **Probe** means a weak side was let through on purpose, one in every few. These are how a trade happens while the gate is enforcing. |
| **Gross / Chg / Net** | P&L before charges, the charges, and P&L after them. A trade from before 23 Sep 2026 has no charges recorded, so its P&L is marked *before charges*. |
| **Worst / Best** | The worst and best mark while open (recorded since 7 Oct 2026). |
| **Flags** | Anything unusual, with the reason on hover: *never filled*, *closed by recovery*, *orphan close*, *scale-out slice*, *no exit time*, or *index price, not premium* (an old bug recorded the index level as the option price, so that P&L is void). |

**Open a row** to see:
- Its **minute-by-minute path**: recorded by the engine, or rebuilt from the option-chain archive.
- **India VIX** while it was held, drawn on the same chart.
- **What if the stop had not hit?** This holds the same contract on the recorded chain until its own target or the time exit (\`trade_end_time\`, 15:00 when unset), then compares that with the replay's mark at the real exit. It says whether the stop **saved** or **cost** money and whether the trade came back afterwards. The replay uses prices before charges, once a minute. It does not replay trailing stops, strategy exit signals or AI reviews.`,
        },
        {
            id: 'day-by-day',
            title: 'Day by day (single-leg)',
            where: 'Last section (folded)',
            md: `One curve per day: the book's P&L minute by minute, with every trade of that day under it. Tick **India VIX** to draw VIX on each opened day and to see **VIX while held** for each trade. It loads when you open it, because paths of older trades are rebuilt from the archive. The **All** window covers the last 90 days here. Trades that cannot be drawn (never filled, unknown exit, old format) are counted beside it, not hidden.`,
        },
    ],
};
