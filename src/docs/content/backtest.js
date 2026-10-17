// Docs: Backtest (/backtest) — test a single-option strategy on past data.
export default {
    id: 'backtest',
    title: 'Backtest',
    route: '/backtest',
    summary: 'Replay a single-option strategy over past prices to see what it would have done — every trade, the equity curve, costs, and how it behaved in different volatility regimes. From here a configuration can be saved, made the default, or deployed as PAPER.',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for',
            md: `A [backtest](glossary#backtest) is a rehearsal on history. Set up the strategy on the left (**Configuration**), press **Run**, and read the **Results** on the right. Nothing here places an order.

> **Warning:** A good backtest is a reason to *paper-trade* an idea, not proof it will make money. Results that depend on a handful of trades, or that collapse when you change one setting slightly, are usually luck. See [Backtesting and out of sample](basics#backtest-oos).`,
        },
        {
            id: 'strategy-market',
            title: 'Configuration · Strategy and market',
            where: 'Top of the Configuration panel (click to expand / collapse)',
            md: `- **Strategy** — the rule set to test. **⭐ Load Best Params** fills in a curated, previously validated set of settings for that strategy; the line under it shows which preset is applied. **Reload presets** fetches the latest list.
- **Resolution (Timeframe)** — candle size in minutes (5 is the usual).
- **Min Conf (%)** — for strategies that output a confidence, ignore signals below this.
- **Exchange / Symbol** — the index (or stock) to test on. **Start / End Date** — the period.
- **Backtest Mode** — *Simulated Premium* estimates the option price from the index move (fast, approximate); *Real Option Data* uses recorded option prices (slow, accurate).
- **Data Source** — where index candles come from: the broker API, the current-month future, or the **local archive** (stored history, fast). *Auto* picks for you.
- **Trading Mode** — *Buying (long options)*, *Selling (naked shorts)* or *Selling (hedged)*. Selling modes show extra inputs: lot size, margin per lot, theta (time decay is already built into the simulated premium) and hedge width.`,
        },
        {
            id: 'strategy-json',
            title: 'Copy, download and import settings (JSON)',
            where: 'Buttons at the top right of the page',
            md: `Every setting on this page can travel as one small JSON text:

- **Copy JSON** puts **every setting the page shows** on the clipboard — strategy, index, timeframe, dates, times, lots, data source, costs, stops and every strategy parameter, including the ones you never changed (their defaults). It is exactly what **Run** sends, so it always reflects your latest edits.
- **Download** saves the same thing as a \`.json\` file.
- **Import JSON** loads settings: paste the JSON (or choose a file) and the window shows what it is, where it came from, and **exactly which settings will change** (**Show changes** lists each one as *old → new*). The settings are rebuilt from the JSON, so parameters that belong only to your previous strategy are **cleared** (listed as such) — the result is an exact copy of what was exported. Nothing changes until you press **Load into Backtest**, and nothing runs until you press **Run**.

The same JSON comes from the **Optimizer**: every result has a **JSON** (copy) button — on each index card (next to *Test* and *Save for …*), on every row of **By index**, on the single-index leaderboard and the best-result card, and in results of **old runs** (open one from *Recent runs*). Copying an Optimizer result gives exactly the settings its **Test** button would send here, with what it scored kept alongside for reference (scores are never imported as settings).

Import also accepts older shapes — a saved strategy, or a plain object of settings — as long as it names a **strategy** this page knows. A JSON without a symbol keeps your current symbol.`,
        },
        {
            id: 'capital-risk',
            title: 'Configuration · Capital, limits and costs',
            md: `| Setting | Meaning |
|---|---|
| **Starting Capital (₹)** | Money the simulated account starts with. Trades are skipped if it runs out. |
| **Lots** | How many lots each trade takes — the trades table's **Qty** column shows it (e.g. *130 (2 × 65)*). One lot is the exchange's lot **on the trade's own day** (NIFTY was 75 until 30 Dec 2025 and is 65 since) — the note under the box shows one lot today and the total quantity. MCX shows its own lot box instead. |
| **Max Daily Loss (₹)** | Stop trading for the day after losing this much. |
| **Max Single Loss (₹)** | The most **one lot** may risk: when the stop × lot would be more, the stop is **tightened** (the quantity stays). It is per **lot**, so 2 lots keep the same stop as 1 lot — the same trades, twice the size — and risk up to twice this. Empty = the global setting, else ₹2,000 — the live engine's rule, which backtests and the Optimizer follow too. Trades it tightened show **cap** in the Qty column. |
| **Max Trades / Day** | Cap on entries per day. |
| **Trade Start / End Time** | The window in which new trades may open; an open intraday trade is closed at the end time. Unset, the end is the global setting, else 15:00 on NSE/BSE — as live. |
| **Slippage (%)** | Assumed price worsening on each fill. |
| **Brokerage/Order (₹)** | Broker fee per order (other charges are computed automatically). |`,
        },
        {
            id: 'stops-targets',
            title: 'Configuration · Stop loss, target and strike',
            md: `- **Stop-Loss Type** — *ATR (dynamic)* sets the stop from recent volatility (ATR = average true range, the typical size of a candle); *Fixed Points*; *Strategy Defined* (the strategy's own level); *Index Level (manual)*.
- **Strike Selection** — which option to buy: **ATM** (delta about 0.5), **ITM 1 or 2 steps** (more expensive, moves more with the index), **OTM 1 step** (cheaper, riskier).
- **SL/TP Reference Chart** — stops and targets are computed on the **index** chart, from ATR or from recent swing highs/lows (**Swing Lookback** = how many candles back to look).
- **Risk : Reward Ratio** — target distance as a multiple of stop distance (2 = aim to make twice what is risked).
- **Fixed SL / TP (Pts)**, **ATR Period**, **Use Smart Volatility SL** — the inputs for the chosen stop type.
- **Minimum SL** — reject trades whose stop is tighter than this (too-tight stops get hit by noise).
- **Trailing Stop-Loss** and **Move SL to Break-even & Trail** — once in profit, move the stop up to entry and then follow the price (multiplier sets how closely).`,
        },
        {
            id: 'ai-options',
            title: 'Configuration · AI options',
            md: `Optional AI layers; each is off unless you turn it on.

- **Internal ML model filter** — a trained in-house model scores each signal; trades below **Min Confidence** are skipped. **Majority vote** needs 2+ models.
- **AI Risk Filter (Multi-Model)** — ask Claude and/or Gemini to confirm each signal. **Fail-closed on AI errors** = if the AI cannot answer, reject the trade (otherwise the normal rules decide).
- **Web research** — let the AI look up news before answering.
- **In-flight position review** (live engine only) — the AI re-checks open trades every few minutes, with a safety buffer, and may tighten the stop, move the target or close.
- **Mastra second-AI validator** — a second AI opinion at execution time (off by default).
- **Apply AI levels** — **Follow AI SL / Follow AI TP** use the AI's suggested stop and target instead of the strategy's (only when they offer a good enough reward for the risk).
- **AI Fair Value Entry** — after a signal, wait for the price to come back to a level the AI considers fair; skip if it does not within about 15 minutes.
- **Follow Strategy Exits** — also exit when the strategy itself signals an exit.

> **Note:** AI calls cost money and time, and in testing the AI confirmation did not reliably improve results ([AI Score](ai-score)). Compare runs with and without it.`,
        },
        {
            id: 'extra-filters',
            title: 'Configuration · Strategy-specific and protective filters',
            md: `- **Strategy-specific inputs** appear for some strategies (for example **Range Duration** and **Breakout Buffer %** for breakout strategies, or the **RL model** for the reinforcement-learning strategy).
- **Adverse Spot Move Stop** — close a trade if the index moves too far against it, catching slow drifts the option stop misses.
- **Daily Profit Lock** — stop opening trades after the day's gain reaches a target percentage.
- **Daily Loss Filter** — after several losing trades in a day, block lower-quality entries.

**Save** stores the configuration under a name for later. **Set as default** makes these the default settings for the strategy in every new backtest (asks first). **Deploy** sends the configuration to the live engine as a **PAPER** deployment — real money only after promotion on [Go Live](go-live).`,
        },
        {
            id: 'results',
            title: 'Results · Summary and equity curve',
            md: `- **Total P&L**, **Avg P&L / Trade**, **Win Rate**, **Total Trades**, **Max Drawdown**, **Sharpe Ratio** — see [statistics](basics#stats).
- **Equity curve** — running profit; switch between the option **premium** view and the **spot index** view.
- **🤖 Ask AI to Improve This Strategy** — see [the AI review](#ai-review) below.
- **Stop** halts a running backtest (and AI processing) but keeps what was computed so far.`,
        },
        {
            id: 'consistency',
            title: 'Results · Consistency across the range',
            md: `**Does the strategy make money throughout the range, or only in one stretch of it?** Total P&L, Sharpe ratio and profit factor all summarise the whole range at once, so a strategy that is flat for a year and then jumps in the last few months can look as good as one that earns a little every month. This card measures the difference.

| Figure | Meaning |
|---|---|
| **Consistency** (0–100) | **Profitable months** × **straightness of the equity line**. Above 60 = steady; 35–60 = uneven; 15–35 = lumpy; below 15 = the result comes from one stretch. |
| **Profitable months** | Months that ended in profit, out of the months that had trades. A month with **no trades does not count** either way, so a strategy that waits for strong signals is not punished. The score uses a smoothed rate, so 3 good months out of 3 is not "100%". For a range shorter than four months, weeks are used. |
| **Equity line straightness** | R² of the account balance against time, one point per trading day. 1.0 = a straight rising line. A line that is flat and then jumps scores low; a falling line scores 0. |
| **Profit from the best fifth of months** | How much of the total came from the best 20% of months. Around 20–40% is even; above 100% means the other months lost money overall. |
| **Worst / best month, longest stretch below a previous high** | Shown under the tiles. |

The bars show each month's net P&L (grey = no trades). The same figure appears in **Run together** and in the **Optimizer**, which can filter on it and rank for it — see [Optimizer: consistency](optimizer#consistency).`,
        },
        {
            id: 'ai-review',
            title: 'Results · Ask AI to Improve This Strategy',
            where: 'Button under the results tiles',
            md: `Sends the whole result to an AI and asks **which of your settings to change, and why**.

### What the AI is given
- **Every setting you can change** — its current value, what it does, and the values it may take. For the strategy's own settings the allowed range is the one the optimizer searches, so the AI cannot invent impossible values.
- **Every trade** (up to 200; beyond that, summaries only), broken down by **entry hour**, **weekday**, **CE / PE**, **exit reason**, **hold time**, **entry premium**, **volume** and **month**, plus the first half against the second half.
- The **cost & greek attribution**, the automatic **findings** (for example "15:00–16:00 is net negative") and the **India VIX** bands.
- **Fixed assumptions** — capital, lot size, slippage, brokerage, candle size. The AI is told never to change these: assuming cheaper fills would "improve" a backtest without improving the strategy.

### Hide the most recent 30% (recommended)
With this ticked the AI only sees the earlier ~70% of trades. Its advice is then tested on the trades it never saw. That is the only honest test: any AI (or person) can "fix" losses it has already been shown. The whole-period tables (attribution, VIX) are left out in this mode because they would reveal the hidden trades.

### Reading the answer
- A verdict, strengths and weaknesses, each quoting a number.
- One row per suggested change: **now → suggested**, *why*, the *evidence*, the *expected effect* and the *risk*. Changes outside the optimizer's range are flagged and left unticked; anything that is not a real setting, or is not an allowed value, is crossed out and cannot be applied.
- **Looked at and left alone** — settings the AI considered and kept.

### Apply & re-test
Applies the ticked changes and re-runs the backtest at once. The **before vs after** card then compares the two runs on the **hidden period** (the honest test), the period the AI saw, and the whole period:
- *Better on data the AI never saw* — encouraging, not proof; paper-trade it before going live.
- *Worse on data the AI never saw* — the advice fitted the past. **Undo** restores your previous settings.
- *In-sample only* — the AI saw every trade, so an improvement proves little.

> **Note:** **Apply only** changes the settings without re-running. Either way nothing is saved until you press Save or Set as default.`,
        },
        {
            id: 'attribution',
            title: 'Results · Cost & greek attribution',
            md: `Splits the total result into where it came from: the index moving your way (**delta**), time decay (**theta**), volatility changes (**vega**), and **costs** (charges and slippage). A strategy that wins on direction but loses it all to theta is buying options with too little time to work.`,
        },
        {
            id: 'vix-breakdown',
            title: 'Results · India VIX breakdown',
            md: `The same trades grouped by the [India VIX](glossary#india-vix) level when each was taken (calm, normal, nervous…), with trades, win rate and net per band. It shows whether the strategy depends on a particular volatility regime. Bands with few trades prove little.`,
        },
        {
            id: 'direction-gate',
            title: 'Results · Direction confidence gate',
            md: `Replays the live engine's [direction confidence gate](dashboard#direction-confidence) inside the backtest. Choose **off**, **shadow** or **enforce** in the results header (this setting is never saved into configurations or deployments).

- In **shadow** it marks the trades it would have blocked; in **enforce** it really skips them and re-runs the backtest with the gate off for a side-by-side comparison, including month by month.
- **Suggested settings** — the panel tests whether the gate's idea works for this strategy at all, searches 180 gate settings on the first 60% of trades, and scores the best one on the rest. **Apply** loads the suggestion; **Turn the gate off** if it says the gate does not help.

> **Note:** In testing on one year of data, the gate helped no strategy reliably — check the suggestion's out-of-sample result before trusting it.`,
        },
        {
            id: 'trades-table',
            title: 'Results · Trades table and trade chart',
            md: `Every trade: entry time, volume, spot at entry, the spot stop and target, money invested, exit time, spot at exit, reason and P&L. With AI on, extra columns show the AI's stop and target levels, fair-value entry, its exit and estimated P&L, and which model decided. Status labels: **REJECTED** (AI turned it down — not taken), **FVE SKIPPED** (the fair-value price never came), **NO DATA**.

- **Re-order the columns** by dragging a column header left or right (a line shows where it will land). On a touch screen, or for a long move, use the **Columns** button: ← / → beside each column, and **Reset to default order**. You can also focus a header's grip (⋮⋮) with Tab and press ← / →. The order is remembered in this browser; the AI comparison columns always stay together at the right.
- **Chart** (on a row) plots that one trade on candles with the levels it was managed against.
- Copy buttons give the exact prompt sent to the AI and its raw reply, for checking.`,
        },
    ],
};
