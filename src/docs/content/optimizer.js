// Docs: Optimizer (/optimizer) — search single-option strategy settings, across indexes, honestly.
export default {
    id: 'optimizer',
    title: 'Optimizer',
    route: '/optimizer',
    summary: 'Searches for good settings of one or more single-option strategies, on one or several indexes at once, and keeps only settings that still work on data they were not chosen on — ideally on several indexes with the SAME settings, the strongest sign a result is not luck.',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for — and the trap it guards against',
            md: `An optimizer backtests a strategy many times with different settings and ranks them. The danger is [overfitting](basics#backtest-oos): try enough settings and some will look brilliant on the past purely by chance.

This optimizer fights that in two ways:
1. **Held-out test period** — every setting is chosen on the earlier part of the data and judged on a later part it never saw.
2. **Across indexes** — the same settings are tried on several indexes. Settings that work on NIFTY *and* BANK NIFTY *and* SENSEX are far more believable than ones that only work on one.

Long runs can take hours; they keep their place if paused, and restart themselves after a crash.`,
        },
        {
            id: 'setup',
            title: 'Setting up a run',
            where: 'Parameters panel',
            md: `- **Strategies** — tick one or several (**Select all / Clear**). Strategies without adjustable settings are skipped (listed after the run).
- **Exchange** — NSE / BSE / MCX, or Delta Exchange. **Indexes** — pick one or several (**Just one** switches back to a single index); for several indexes the archive data source is used so prices line up.
- **Lot size**, **Start / End date**, **Backtest mode** (simulated premium = fast and approximate; real option data = slow and accurate), **Data source**, **Resolution** (candle size, applied to every strategy) and **Starting capital**.
- **Search depth** — *quick*, *standard* or *thorough*: how many settings are tried per strategy.
- **Advanced** — iterations per strategy; filters a result must pass (**min trades**, **min win rate**, **max drawdown**, **min Sharpe**); **slippage** and **brokerage**; and **Test (held-out) %** — how much of the end of the period is kept back for the honest test.`,
        },
        {
            id: 'data-check',
            title: 'Data check',
            md: `Before the run, each index's data is checked: days available, date range, how complete it is, and **flat bars** (candles where the price did not move — a sign of bad data). Indexes with poor data are **excluded from the count** rather than silently judged on bad prices.`,
        },
        {
            id: 'progress',
            title: 'Progress while it runs',
            md: `The run moves through four steps — **Loading data**, **Screening** (every strategy, broad search), **Fine-tuning the best**, **Finalizing** — with overall progress and an estimated finish time for the whole run. The grid below shows each strategy × index cell and its status.

- **Pause** stops and keeps every finished backtest; **Resume** continues from the last checkpoint without redoing work.
- A run stopped by a crash or restart resumes **by itself** when the server comes back (within a crash-loop limit); a run you paused or stopped waits for you.
- **Attach to the running job** reconnects to a run already going (for example after a refresh). Only one run can be active at a time.`,
        },
        {
            id: 'results',
            title: 'Reading the results',
            md: `Two views:

### Best across indexes
Settings that **held up on at least k of the n indexes with the same settings** — choose k in **Must hold up on** (the recommended value is about two thirds). The banner at the top states the winner in one sentence, or says honestly that nothing held up. Each row:

| Column | Meaning |
|---|---|
| **Score** | A ranking number that combines results on the held-out test period, discounted for how many settings were tried (so luck scores lower). Higher is better. |
| **Holds up on / Weakest index** | Which indexes it worked on, and its worst one — the cross-index score is set by the weaker indexes, not the best. |
| **Trades/day** | How often it trades. |

Strategies that did **not** hold up on k indexes are listed separately (folded). **Incomplete** ones were not judged on every index.

### By index
Every index separately. Per row: **Score**, **Full P&L** (whole period), **Win %**, **Trades**, **Max DD**, **Verdict** — **Held up** (good on the held-out test) or **Overfit** (good only on the period it was tuned on) — and the **Params**. **Test P&L / win % / PF / trades** are the held-out figures; **Full window** is the whole period.

**Save where it held up** saves the settings as a preset only for the indexes where they held up — never as a global default. **Test** runs a single setting on one index in the Backtest page.`,
        },
        {
            id: 'consistency',
            title: 'Ranking for steady results (Consistency)',
            md: `Every result carries a **Consistency** score (0–100): profitable months × how straight the equity line is. See [what it measures](backtest#consistency).

- **Min Consistency** drops settings whose training-period consistency is below the number (empty = off). Dropped settings are counted under "consistency below the filter".
- **Rank settings for → Steady across the range** keeps the usual score but adds a strong reward for consistency (and a penalty for lumpy results) in both the training and the held-out period. The **held-up test is unchanged**: a setting still has to make money out-of-sample to be ranked at all, so this only re-orders settings that held up.
- The **Consistency** column shows the whole-period figure, and the held-out one beside it ("test").

Fewer, stronger trades are not penalised: months with no trades count neither way. A setting that trades only on its best signals and makes a little in most months will rise; one whose profit came from a single run of months will fall.`,
        },
        {
            id: 'recent-runs',
            title: 'Recent runs',
            md: `Every run is stored: **Done**, **Running**, **Paused**, **Stopped**, **Interrupted** (stopped by a restart — resumes itself) or **Error**. **Attach** reconnects to a running one, **Resume** continues a paused or interrupted one from its checkpoint, **Open** shows a finished one's results, **Delete** removes it. **Clear Results** deletes finished runs only; paused and interrupted runs are kept so they can still resume.`,
        },
    ],
};
