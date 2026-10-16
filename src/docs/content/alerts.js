// Docs: Stock Alerts (/alerts) — screen every NSE stock, save screens as Telegram alerts, test them on history.
export default {
    id: 'alerts',
    title: 'Stock Alerts',
    route: '/alerts',
    summary: 'A stock screener over every NSE-listed company, built on NSE\'s own daily files and company filings. Write a condition (for example "volume is 3× normal and price is up 5%"), see which stocks match today, test whether that condition picked good stocks in the past, and save it as an alert that messages you on Telegram when a stock newly matches. It never trades.',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for',
            md: `The rest of the app trades index options. This page is different: it looks at **individual shares** (Reliance, TCS, …) to find ones worth your attention. It has three tabs:

- **Screener** — write a query, see today's matches, test it on history.
- **Alerts** — saved queries that run on a schedule and send a Telegram message.
- **Data** — where every number comes from and how fresh it is.

> **Note:** A match is a **reason to look**, not a recommendation to buy. The history test tells you whether the condition has picked better-than-average stocks in the past — and most conditions have not.`,
        },
        {
            id: 'starting-points',
            title: 'Starting points',
            where: 'Screener tab, top',
            md: `Ready-made screens grouped by theme (momentum, value, promoter buying, results surprises…). Each shows what a replay over stored history **actually measured** for it — they are ideas, not proven edges.

- **Click a starting point** to load it into the query editor.
- Tick **Test** on several and press **Test together** to compare them on history in one table. Choose how many past **Sessions** to replay and **Sell after** (how many sessions each simulated trade is held — up to six values, e.g. 5, 10, 20; 1 = buy at the next open and sell the same day's close).`,
        },
        {
            id: 'query',
            title: 'Query',
            md: `A condition written over **fields** (the **Fields** panel lists them; click one to insert it), evaluated against every stock in the chosen universe. Combine conditions with **AND**, **OR**, **NOT** and brackets, for example:

\`volume_ratio > 3 AND chg_pct > 5 AND turnover_cr > 10\`

| Control | Meaning |
|---|---|
| **Universe** | Which stocks to check: all stocks, only the normal (EQ) segment, F&O stocks, NIFTY 50 / 100 / 200 / 500, Midcap 150, Smallcap 250, or ETFs. |
| **Min turnover ₹cr/day** | Ignore stocks that trade less than this on an average day. Thinly traded stocks make the noisiest "sudden" moves. |
| **Sort by / High → low** | Order of the results. |
| **Prices** | **Auto** uses live prices while the market is open and the last close otherwise; **EOD** forces last close; **Live** forces live prices. |
| **Save as alert** | Turn this query into a scheduled alert (see [Alerts](#alerts)). |
| **Test on history** | Replay the query over stored history (see [Would this have caught anything?](#replay)). **Max/day** keeps only the top N signals per day if you could only act on a few; 0 = all. |

If the query only reads **market-wide** fields (NIFTY level, FII/DII flows, India VIX…), every stock has the same value, so it is a yes/no **Market condition** rather than a stock list. Saved as an alert, it messages you when the condition turns true.`,
        },
        {
            id: 'results',
            title: 'Matches and the stock detail',
            md: `The matches table lists each stock with close, % change, turnover and the fields you sorted by. Small marks on a name: **F&O** (has stock futures and options), **BE** (trade-for-trade segment: every trade must be delivered, no intraday squaring off) and **adj.** (a split or bonus in the last 20 sessions — earlier prices are adjusted).

**Click a stock** for its detail: price and P/E history, shareholding (promoter, FII, DII, mutual funds, retail, pledged), quarterly results, insider and promoter trades, board meetings and corporate actions. **What these numbers mean** explains each figure in plain words. A small calculator shows what trading it after costs would have returned — note that **shorting overnight** in the cash market is not allowed for retail traders in India; a short is only realistic through stock futures or puts (F&O stocks).`,
        },
        {
            id: 'replay',
            title: 'Would this have caught anything? (history test)',
            md: `Replays the query over stored history and checks what happened after each **new** match (what an alert would have messaged you).

- **Signal** — a stock that newly matched after a day's close. We pretend you bought at the **next day's open** and sold at the close N sessions later.
- **Raw return** — what that trade did. **Excess** — raw return minus what the average stock in the same universe did over exactly the same days. Excess removes the market: if everything rose 3%, a stock that rose 3% earns no credit.
- **Mean excess / signal** — average excess over all signals. **Mean excess / day** — average the signals of each day first, then the days, so one crowded day cannot dominate. If the two disagree, trust the per-day number.
- **t** — how sure we can be the per-day average is not luck. Below 2: could easily be chance. Above 2: probably real *in this window* — but test 20 screens and one will reach t≈2 by luck alone, so re-test on new data.
- **Beat the universe** — share of signals with positive excess. An edge often lives in the *size* of the wins, not the hit rate.
- **By month** — a real effect shows up in most months; one great month carrying the year is a warning sign.
- **Verdict** — a one-word summary of the above.

The **simulated trades** view adds costs: net profit, average trade after costs, win %, capital needed and return on it, against simply holding the benchmark.`,
        },
        {
            id: 'alerts',
            title: 'Alerts tab',
            md: `Each saved alert runs automatically and sends a Telegram message.

| Setting | Meaning |
|---|---|
| **Name / Query / Min turnover** | What to screen. |
| **Run at (IST)** | Comma-separated times, e.g. \`08:45, 20:30\`. |
| **Cooldown days** | Do not message about the same stock again within this many days (stops a stock that hovers around a threshold from repeating). |
| **Notify on** | **New matches** (only stocks that were not matching last time) or **Every run**. |
| **Telegram / Enabled** | Send messages; switch the alert on or off. |

Each card shows its last run (how many matched, how many new). **History** lists every run; **Edit** and **Delete** do what they say. Tick several alerts and press **Test alerts on history** to compare them side by side.`,
        },
        {
            id: 'data',
            title: 'Data tab — where the numbers come from',
            md: `The broker's API only supplies prices, so fundamentals and flows come from public sources:

- **NSE ingest** — the daily price file (bhavcopy: open, high, low, close, delivery) and the P/E file, fetched mornings and evenings on weekdays. Days already stored are skipped.
- **Supplementary NSE data** — index closes and P/E, FII/DII/retail derivative positions, the F&O price file (open interest), the F&O ban list, bulk and block deals, FII/DII cash flows.
- **Ownership, disclosures & filings** — shareholding filings, promoter and insider trades, board meetings, corporate actions, quarterly results, foreign investor flows (NSDL) and size categories (AMFI). Each row shows how much is stored, the date range and when it refreshes.
- **Your own fundamentals (optional CSV)** — fill gaps for stocks without a stored filing.
- **PE files the quality gate acted on** — NSE occasionally publishes a broken P/E file; files that changed more than 30% of stocks' earnings at once are set aside rather than trusted.
- **How the numbers are made** — the corrections applied to NSE's files.

> **Note:** Every value is used only from the date it was **published**, so history tests never peek at information that was not yet public — the most common way screen backtests fool people.`,
        },
    ],
};
