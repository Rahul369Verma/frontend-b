// Docs: Data Manager (/data-manager) — the stored history that backtests and models run on.
export default {
    id: 'data-manager',
    title: 'Data Manager',
    route: '/data-manager',
    summary: 'Backtests, the optimizer and the AI models all need past prices. The broker only gives limited history (and none for options that have already expired), so the app keeps its own archive. This page shows the live option-chain recorder and lets you download and store more history.',
    sections: [
        {
            id: 'option-archive',
            title: 'Live option-chain archive',
            md: `While the market is open, the production server continuously records every index's **option chain** — the premium, open interest, bid/ask and implied volatility of every strike. Once an option expires the broker no longer provides its history, so this recording is the only way to backtest on **real** option prices (including skew — the way far-away strikes are priced differently), instead of estimating them with a formula.

| Tile | Meaning |
|---|---|
| **Total storage** | Disk space used by the archive. |
| **Snapshots saved** | How many chain snapshots have been recorded. |
| **Growth** | Space added per day and the projected size after a year. |
| **Retention** | How many days are kept; older snapshots are deleted automatically, which caps the total size. |

The table shows, per index: snapshots, days covered, strikes, last spot price, first and last snapshot. The capture button takes one snapshot of every index **now** (it works outside market hours, for checking the recorder).

**Repairing holes.** If the recorder misses minutes (for example while the broker is rate-limiting requests), those minutes are refilled from the broker's **1-minute candles**: every weekday at 15:45 IST automatically, or now with **🩹 Repair holes** (today and the two days before). A repaired minute holds the minute's last traded price and the implied volatility worked out from it, but **no bid/ask or open interest** — a candle does not have them — and it is labelled as repaired. It only works while the contract has **not expired**: after expiry the broker keeps no history, so a hole must be repaired before then. Trade replays say how many of their minutes were repaired and shade any hole that is left.`,
        },
        {
            id: 'quote-tape',
            title: 'Live quote tape',
            md: `The option-chain archive above keeps one snapshot a minute. The trading engine looks every 10 seconds, so a stop that trips between two snapshots shows up a minute late in a backtest, at a worse price. The **quote tape** keeps **every** price update instead.

**What is recorded.** Every quote tick (last price, bid/ask and their sizes, volume, open interest) of the NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and SENSEX option chains: about 15 strikes either side of the index on the two nearest expiries, both calls and puts, plus the indices and India VIX. BANKEX is left out because its options do not trade. Recording runs on exchange days from a minute before the open to six minutes after the derivatives close (09:14–15:46), in production only. Each minute is packed and compressed to about a tenth of its size, and it is **kept forever**, because past ticks cannot be downloaded again.

**Decision log.** The multi-leg engine also writes down each of its loops: when it looked, every price it read (and whether it came from the live feed or a broker request), and where each open structure stood afterwards. This is the record a backtest is checked against.

**Live vs exact replay.** Every evening (with the nightly audit, 19:30 IST) the day's whole multi-leg book is replayed on the tape by the live engine itself, at the moments the live loop actually ran. Each deployment's trades are then compared with what live did:

| Result | Meaning |
|---|---|
| **match** | Same entry and exit moments, strikes, stops and exit reason; P&L within ₹1. |
| **price only** | The same decisions, but a fill price differed: the tape's tick at that moment was not the one the trading feed had. |
| **differs** | A decision was different. The row says which (for example *entry +11s* or *legs stopped*). |
| **missing / extra in replay** | One side traded and the other did not. |

A LIVE deployment fills at the broker, while the replay fills at the paper rule, so for LIVE rows only the decisions decide the result. The panel also shows how often the tape showed the engine the same price its own feed did. **Check today now** runs the comparison immediately. Any difference also appears under Notifications → Nightly audit.`,
        },
        {
            id: 'delta-options',
            title: 'Delta option data (BTC, ETH, gold)',
            md: `What the Multi-Leg backtests, Optimizer and Auto use when you pick a **Delta** symbol (BTC, ETH or XAUT gold options on Delta Exchange India).

**Contract list.** Every option Delta has ever listed — each expiry and strike, and **when** it was listed. A backtest of a date holds only the contracts that existed then: Delta lists a daily expiry every day (about three days ahead), weeklies on Fridays, monthlies on the last Friday, and adds strikes as the price moves. The server rebuilds the list at its first start (several minutes) and updates it every day at 18:05 IST, after Delta's 17:30 IST settlement.

**Recorder.** Delta keeps its old contracts but **not** their minute prices, implied volatility, bid/ask or open interest. The recorder saves them as they happen — every minute for strikes near the price and expiries in the next 10 days, and the whole chain every 15 minutes — for every contract of BTC, ETH and XAUT. It runs in production only, around the clock. These quotes are what will let a Delta strategy be checked against **real** prices later; until then Delta backtests price options with a model (see [Multi-Leg → Delta](multi-leg#delta-options)).

The panel shows the list's coverage, whether the recorder is running (and why not), what it has stored and how much disk it uses (about 40 MB a day; kept for a year by default).`,
        },
        {
            id: 'futures',
            title: 'Futures & AI dataset',
            md: `Download the price history of index **futures** and store it locally — the data the RL models train on and the backtester can use. Choose **Symbols**, a **Resolution** (1, 5 (recommended), 15 minutes, 1 hour, daily, or **All Timeframes (Batch)**) and press **Archive Futures**.`,
        },
        {
            id: 'spot',
            title: 'SPOT data archiver',
            md: `Store the history of the index or stock **itself** (spot) for a chosen date range: **Symbols**, **From / To Date** and **Resolution** (or all timeframes). Backtests set to the *local archive* data source read from here, which is faster and repeatable.`,
        },
        {
            id: 'options',
            title: 'Options archiver',
            md: `Downloads 1-minute history of the **current month's** options (calls and puts) around the at-the-money strike, while they are still tradable. Choose the **Target Symbols**, the **Expiry Date** (or **Auto-Select (Current Month) for Batch**) and **Strike Range (+/-)** — how many strikes either side of ATM — then **Archive Option Chain**.

> **Tip:** Run it before an expiry: after the contract expires the broker will not supply its candles any more.`,
        },
        {
            id: 'archives',
            title: 'Local archives',
            md: `Everything stored, grouped by instrument and tagged **FUT** (futures), **SPOT** (index/stock) or **OPT** (options), with the resolutions available for each.`,
        },
    ],
};
