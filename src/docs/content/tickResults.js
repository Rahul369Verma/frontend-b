// Docs: Tick Results (/tick-results) — what the tick strategies earned, on three P&L bases.
export default {
    id: 'tick-results',
    title: 'Tick Results',
    route: '/tick-results',
    summary: 'The results book of the tick engine. Tick Strategies shows what is running; this page shows what it earned — and, above all, whether the tiny moves the strategies catch are big enough to pay for trading them.',
    sections: [
        {
            id: 'basis',
            title: 'P&L basis — three ways to count the same trade',
            md: `A tick trade can be priced three ways, and they can disagree by more than the whole loss. Pick the lens; the header and every breakdown below follow it.

| Basis | Meaning |
|---|---|
| **Underlying** | Index points captured × quantity, before any cost. What the strategy "saw". |
| **Options gross** | The same move as if you had traded an at-the-money option (which moves about half as much as the index), before any cost. |
| **Options net** (default) | The option trade after brokerage, taxes and [slippage](glossary#slippage) — what you would actually have banked. |

Every total is shown for each basis before you switch, so you can see the gap at a glance. Period: **7d**, **30d**, **90d** or **All**.`,
        },
        {
            id: 'summary',
            title: 'Headline numbers',
            md: `**Net P&L** (trades and sessions counted), **Per trade** (total ÷ trades — never rebuilt from win rate), **Win rate** with average win and loss, **Profit factor** (total won ÷ total lost) and **Max drawdown** (deepest fall from the running peak). Trades still open are excluded — they have no realised result yet.

Below them: **Daily net P&L** (one bar per trading day, by the day trades closed, IST — drag to zoom) and the **Equity curve** (the running total, with the fall from each peak shaded underneath).`,
        },
        {
            id: 'cost-reality',
            title: 'Cost reality — does the move outrun the fee?',
            md: `This section does not change with the basis switch: costs are what they are.

- **Cost drag** — charges plus slippage in total; **Drag per trade** — what every round trip pays before it can profit.
- **Underlying → net** — what the signal did versus what you would have banked.
- **From signal to settlement** — the deductions in order: underlying P&L → option repricing → charges (brokerage, STT, exchange, SEBI, stamp duty, GST) → slippage → net.
- **Break-even distance by symbol** — how far the index must move for one option trade to pay its own costs (**Break-even**, worked out exactly from the engine's own cost formula), against how far trades on that symbol typically move (**Median move**). **Cost ÷ move** above 1 means the typical trade cannot pay for itself. **Winners lost to cost** counts trades that made money on the index but lost once the option was paid for.

> **Example:** If NIFTY break-even is about 5.5 points and the median tick trade moves 4 points, most trades lose money however good the signal is. The fix is a larger target or fewer trades, not a better entry.`,
        },
        {
            id: 'calendar',
            title: 'Per-day calendar',
            md: `Every session as a coloured cell (green profit, red loss). A run of red is a regime the strategies do not suit; a single red day is just a day.`,
        },
        {
            id: 'strategies',
            title: 'By strategy and compare',
            md: `**By strategy** — one row per tick strategy: type, state, trades, win %, net, per trade, best, worst and last trade. Click a name for its own summary, daily P&L, equity curve and **Exit reasons** (net by how trades ended — stop-heavy means a broken entry; target-heavy with a negative total means the target is smaller than the cost of reaching it). Rows marked as deleted still count: the trades happened.

**Compare equity curves** overlays the running net of the ticked strategies (by default the four with the most trades).`,
        },
        {
            id: 'breakdowns',
            title: 'Breakdowns',
            md: `The same results grouped by **strategy**, **strategy type**, **symbol**, **exit reason**, **direction** (long/short) and **hold time**. Every tab adds up to the header total — a row with a missing value is put in an "unknown" bucket, never dropped.`,
        },
    ],
};
