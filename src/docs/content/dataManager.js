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

The table shows, per index: snapshots, days covered, strikes, last spot price, first and last snapshot. The capture button takes one snapshot of every index **now** (it works outside market hours, for checking the recorder).`,
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
