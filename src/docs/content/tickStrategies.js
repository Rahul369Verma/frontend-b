// Docs: Tick Strategies (/tick-strategies) — the paper-only sub-second engine.
export default {
    id: 'tick-strategies',
    title: 'Tick Strategies',
    route: '/tick-strategies',
    summary: 'A separate engine that reacts to every individual price update ("tick") instead of to finished candles — volume bursts, big single trades, order-book imbalances. It is PAPER ONLY: it never sends an order to the broker. This page creates, controls and records those strategies.',
    sections: [
        {
            id: 'overview',
            title: 'What a tick strategy is — and why it is paper only',
            md: `A [tick](glossary#tick) is one price update from the exchange; NIFTY futures send several per second. The main engine waits for a 1- or 5-minute [candle](glossary#candle) to finish before deciding. A tick strategy decides within a fraction of a second — for example "a single trade 10× larger than normal just printed, and price jumped with it".

These ideas **cannot be backtested** on candles (a candle hides what happened inside it), so they run against the live tick stream and record simulated trades. That is why the page carries a **PAPER ONLY** badge.

> **Warning:** The moves these strategies chase are tiny — often 3 to 6 index points. Turned into a real option trade, costs need about **5.5 points on NIFTY and about 13 on BANK NIFTY** just to break even. Read [Tick Results](tick-results#cost-reality) before believing a positive points total.`,
        },
        {
            id: 'controls',
            title: 'Engine controls',
            where: 'Top-right buttons and the banner under the title',
            md: `| Button | What it does | Open positions | Survives a restart? |
|---|---|---|---|
| **Halt** | Blocks **new** entries. | Still exit normally on target, stop or time. | No |
| **Resume** | Lifts a halt — new entries allowed again. | — | — |
| **KILL ALL** | Closes every open position immediately **and** halts. | Closed now. | No (this session only) |
| **PAUSE** | Closes everything, stops processing ticks entirely and frees the CPU. | Closed now. | **Yes** — stays off across restarts and redeploys until you turn it back on. |
| **Start Engine** | Turns a paused engine back on (re-subscribes to ticks, restarts the watchdog). | — | — |

A banner shows the current state: **PAUSED** (and who paused it), **HALTED** (and who halted it), or **held OFF — pause state unknown** when the server could not read the saved switch and stays off to be safe.`,
        },
        {
            id: 'summary',
            title: 'Summary tiles',
            md: `**Strategies** (how many exist), **Active** (how many are running), **Open Paper Positions** and **Today's Net P&L (all strategies)** — an estimate after option charges and slippage.`,
        },
        {
            id: 'strategies',
            title: 'Deployed strategies',
            md: `One card per tick strategy with its trades, **Win % (net)** (winners after costs), **P&L pts** (index points captured) and **Net ₹ (est)** (the points priced as an ATM option trade after charges and slippage). **Edit** changes the settings; the switch starts or stops it.

The strategy types:

| Type | Idea in one line |
|---|---|
| **Large Order Detector** | A sudden volume burst together with a sharp price push — follow it. |
| **VWAP Reversion** | Price stretched away from the day's average price ([VWAP](glossary#vwap)) on thin volume — bet it snaps back. |
| **Momentum Ignition** | Price suddenly accelerating in one direction — ride the first burst. |
| **Stop-Hunt Reversal** | Price pokes past a recent high/low to trigger stops, then fails — trade the reversal. |
| **CVD Divergence (Exhaustion)** | Price makes a new extreme but buying/selling pressure has faded — fade it. |
| **Order Book Imbalance** | Far more waiting buyers than sellers at the best prices (or the reverse) — follow the heavier side. |
| **Aggressor Delta (Real CVD)** | Follow strong one-sided buying or selling as reported by the exchange, or fade it when it disagrees with price. |
| **Block Print Detector** | One unusually large single trade prints — follow the institution behind it. |`,
        },
        {
            id: 'new-strategy',
            title: 'New Tick Strategy',
            md: `- **Strategy Type** — one of the types above (its description is shown).
- **Name** — your label.
- **Underlying** — an index, an MCX commodity or a stock.
- **Data Source** — **Futures Contract (recommended)** or **Spot / Index**. Indexes themselves are not traded, so their ticks carry **no volume**; most tick strategies need volume, so they watch the near-month future. Pick the **Futures Expiry Date**; **Resolved Symbol** shows the exact contract name sent to the broker. When a contract expires the engine rolls to the next one automatically.
- **Tuning Preset** — sensible starting values; **Parameters** — the individual thresholds (burst multiple, target, stop, maximum hold time…).`,
        },
        {
            id: 'feed',
            title: 'Live event feed',
            md: `What the engine is doing right now: entries, exits (target, stop, time stop), skipped signals and warnings, newest first.`,
        },
        {
            id: 'recordings',
            title: 'Tick recordings and replay',
            md: `Because tick strategies cannot be backtested on candles, you can **record** the raw tick stream and replay it later.

- **New Recording** — pick up to 10 symbols (spot or futures) and optionally **Auto-Stop Minutes**. Each recording shows ticks captured, duration, age and size on disk.
- **Sample** — view the first ticks (time received, price, bid/ask, total buy/sell quantities) to check the data is sensible.
- **Replay** — run a strategy over a recording. **Single Run** uses the current settings; **Optimizer (random params)** tries 1–50 random settings and shows a **Leaderboard** by net P&L. Results show trades, win rate, net P&L, average trade and maximum drawdown.

> **Note:** A recording is usually minutes or hours long — a good replay on one recording proves very little. Treat it as a way to debug a strategy, not to validate it.`,
        },
        {
            id: 'trade-log',
            title: 'Paper trade log',
            md: `Every simulated trade: date and time, strategy, symbol, entry, exit, **P&L pts**, **Net ₹ (est)** (after charges and slippage on an ATM option leg), hold time and status. For the full analysis go to [Tick Results](tick-results).`,
        },
    ],
};
