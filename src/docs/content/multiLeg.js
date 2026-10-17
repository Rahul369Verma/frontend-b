// Docs: Multi-Leg (/multi-leg) — build, test, optimise, deploy and review option structures.
export default {
    id: 'multi-leg',
    title: 'Multi-Leg',
    route: '/multi-leg',
    summary: 'Everything about multi-option structures (spreads, straddles, strangles, condors, butterflies): draw one, test it on history, search for good settings, run it live or on paper, and review what it earned. The page has seven tabs, used roughly left to right.',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for, and the order to use it',
            md: `A [multi-leg structure](basics#multi-leg-idea) holds several options at once. This page is a full workshop for them:

| Tab | Use it to… |
|---|---|
| **Builder** | Draw any structure leg by leg and see its payoff, greeks, probability of profit and margin. |
| **Backtest** | Run one structure on past data and see every trade. |
| **Optimizer** | Try many settings for one structure, ranked honestly on data they were not chosen on. |
| **Scan** | Run every structure on several indexes at default settings — a quick leaderboard. |
| **Auto ⚡** | The big search: strategies × settings × structures × indexes, in four stages. |
| **Deploy** | Turn a saved strategy into a running deployment (PAPER or LIVE) and watch it. |
| **Results** | Review everything the deployments have booked. |

A typical path: find an idea in **Scan** or **Auto**, check it in **Backtest**, **Save** it, deploy it as PAPER from **Deploy**, then judge it in **Results** before ever considering LIVE.`,
        },
        {
            id: 'setup-panel',
            title: 'The setup panel (Backtest, Optimizer, Scan, Auto)',
            where: 'Left side of the research tabs',
            md: `The research tabs share one setup panel. Each setting has a tooltip; the important ones:

### What to test
- **⭐ Professional preset** — a ready-made setup for the chosen structure (strikes, stops, entry time). A starting point, not a recommendation.
- **🧭 Market read** — reads the index's recent momentum and where option sellers are positioned, and suggests a preset. In testing, its *direction* call did not beat chance; use it as context, not as a signal.
- **Structure** — the template (iron condor, short strangle, butterfly, …). The **Payoff at expiry** chart beside it shows its shape: profit (above zero) or loss (below) for each index level on expiry day, per unit.
- **Symbol** — the index. **From / To** — the date range.
- **Data source** — *Broker candles + model chain* prices options from a volatility model for any dates (estimated prices). *Live option-chain archive* uses real recorded bid/ask prices, but only exists from August 2026. Real prices are more trustworthy; model prices reach further back.
- **Validation (OOS)** — hold out the last 20–40% of the period as an [out-of-sample](glossary#oos) check. Always on in Auto.

### When to enter
- **Entry trigger** — *Time* enters at a fixed clock time; *Strategy signal* waits for a single-option strategy (for example Breakout Range) to signal, then opens the structure in that direction. **Tuned signal params** come from an optimizer champion or a save; discard them to run the strategy at its defaults.

### How big, and what to refuse
- **Risk per trade (₹)** — size each structure so its worst case risks about this much; lots = budget ÷ worst-case loss per lot, capped by **max lots**.
- **Daily loss cap** — the deployment stops entering for the day after losing this much.
- **Max short vega / max |delta|** — refuse structures that are too exposed to a volatility jump, or that start out already leaning one way. Enforced in both the backtest and the live engine.
- **Entry slippage cap** — LIVE entries are limit orders no more than this % away from the quote.

### Strike placement
- **Offset** uses the template's fixed distances from the current price. **Zone** chooses the short strikes from the market's own probability picture (see [Builder](#builder-tab)), within a **delta band** (for example 0.15–0.45) and with **wings** a set number of strike steps further out. Far wings did better on return-on-margin in testing.
- **AI zone review** — *off*; *shadow* (an AI second opinion is stored but never changes anything); *gate* (skip the entry if the AI objects).

### Volatility and realism
- **Min / max IVP** — only sell premium when volatility is rich, or only buy when it is cheap ([IVP](glossary#ivp)).
- **Delta alert** — warn when a "neutral" structure has drifted directional.
- **Spread model** (backtest only) — a minimum ₹ cost per leg and wider spreads further from the money, so backtests pay realistic costs.
- **IV multiplier** — model prices use recent realised volatility × this number. **Calibrate** sets it from today's live chain so backtest premiums match what the live engine sees.

### Parameters
Every structure setting (profit target, stop loss, hold days, entry time, …) is listed and editable. In the Optimizer each one can be given a range to sweep.`,
        },
        {
            id: 'builder-tab',
            title: 'Builder tab',
            md: `Draw any structure by hand — no template needed.

- **Index, expiry, spot, IV** — leave spot and IV blank to use live market values.
- **Legs** — each row is one option: BUY or SELL, CE or PE, strike, **ratio** (lots of this leg per lot of the structure) and premium (blank = priced live; you can **pin** a price). Buttons flip every leg (turn a structure into its mirror image), set all legs to one expiry, scale all ratios, duplicate or remove a leg.
- **Summary** — net credit or debit, max profit, max loss, break-evens, **risk/reward** (max loss ÷ max profit), **intrinsic** (the part of the premium that cannot decay) and **time value** (the part that does — positive means you are paid to wait), **DTE** on the trading clock (what the maths uses) and on the calendar (what your broker shows).
- **Standard-deviation levels** — how far the index typically moves by expiry: about 2 in 3 days end within ±1σ.

### Analysis tabs
| Tab | Shows |
|---|---|
| **Payoff** | The structure's P&L at expiry and **now** across index levels, with σ bands and (optional) open interest per strike behind it. Hover to read the P&L and how far that level is from the current spot, in points and %. |
| **P&L Table** | A grid of P&L for index level × date, colour-coded. |
| **Greeks** | [Delta, theta, vega](basics#greeks) per leg and for the whole structure. |
| **Legs** | What each leg was priced at, from which quote (mid, last trade or pinned). |

### Zone finder
Suggests short strikes for a strangle or iron condor from the market's implied distribution. **Choose by** *EV ÷ tail* (expected value per unit of worst-case risk), *Max EV* or *Max POP*. It respects a delta band, wing width, an entry time and a planned exit time. **Load** puts the pick into the builder; **Score** rates the legs you already have. An optional AI reviewer can comment on event risk, but it cannot change the arithmetic.

### Chain ladder
The live option chain around the money: calls left, puts right, with open interest, bid/ask, half-spread, change, volume and vega columns you can toggle.

**Save** stores the structure as a saved strategy, which can then be backtested or deployed.`,
        },
        {
            id: 'backtest-tab',
            title: 'Backtest tab',
            md: `Runs the structure in the setup panel over the chosen dates and shows what it would have done.

### Headline tiles
**Trades**, **Win rate**, **Net P&L**, **Profit factor**, **Sharpe / Sortino** (return versus bumpiness), **Avg win / Avg loss**, **Max DD** (worst fall from a peak), **Avg margin**, **ROI on margin** (net ÷ margin), **Worst Δ/unit** (the most directional the structure ever got) and **Exits** (how trades ended: target, stop, time, expiry…). Hover any tile with a ⓘ for the exact definition.

### Equity chart
Running net profit trade by trade. A steady upward line is what you want; long flat or falling stretches are periods the structure did not work.

### Trades table
| Column | Meaning |
|---|---|
| **Entry / Exit / Hold** | When it opened, closed, and how long it was held. |
| **Reason** | Why it closed. |
| **Spot in→out** | The index at entry and exit. |
| **Credit** | Net premium received (or paid, if negative) per unit. |
| **Lots** | Size taken; "risk" sizing varies per trade. |
| **Worst Δ/u** | The most directional the structure was at any point while open. |
| **Margin** | Estimated margin blocked. |
| **Net ₹** | Profit after charges. |

### Attribution
Splits the profit into what came from the index moving (delta), time passing (theta), volatility changing (vega) and costs — useful to see *why* a structure made or lost money.

**Save** stores the configuration as a saved strategy (it then appears on the [Deploy](#deploy-saved-strategies) tab).`,
        },
        {
            id: 'optimizer-tab',
            title: 'Optimizer tab (grid sweep)',
            md: `Tries many combinations of settings for **one** structure on **one** index and ranks them.

- **Sweep configuration** — for each parameter you can enter several values (for example stop loss 1.2, 1.5, 2.0). Every combination is backtested, up to a **cap**. **Refine** re-tests finer values around the best results.
- **Ranking metric** — what "best" means (net P&L, profit factor, Sharpe…).

### Reading the results table
Each row is one combination. The **Val** columns (validation trades, win %, net, PF, Sharpe, ROI) are measured on the held-out period the settings were *not* chosen on — rank by these. **Train net** is the in-sample result, shown for comparison. A combination that is great in Train but poor in Val is overfitted.

**Apply** loads that combination into the setup panel and runs the full backtest.`,
        },
        {
            id: 'scan-tab',
            title: 'Scan tab',
            md: `Runs **every structure** on each selected index at **default settings**, producing one leaderboard. It answers "which kinds of structure have worked here lately?" before you spend time tuning one.

Columns: structure, its **outlook** (bullish / bearish / neutral / volatile), index, number of trades (validation trades if a hold-out is set), win %, net, profit factor, **ROI/margin**, train net. **Full backtest** opens the row in the Backtest tab; **Optimize** opens it in the Optimizer with the structure and index preloaded.`,
        },
        {
            id: 'auto-tab',
            title: 'Auto ⚡ tab (the full race)',
            md: `The most thorough search: **every selected strategy × its settings × every structure × every index**, run in four stages so the time goes to the promising ideas.

| Stage | What happens |
|---|---|
| **1 · Broad race** | Every combination at default (plus a few random) settings. Only the best survive. |
| **2 · Signal tuning** | The survivors' entry-signal settings are searched. |
| **3 · Structure tuning** | The survivors' structure settings (targets, stops, strikes…) are swept, then refined. |
| **4 · Final check** | The champions are re-run over the whole period, optionally through the AI confirmation gate. |

### Settings
- **Structures** — all, or only bullish / bearish / neutral / volatile ones. **Symbols** — up to four indexes.
- **Signal strategies** — which single-option strategies may trigger entries (**AI Filtered** is a group of AI-assisted ones).
- **Rank by** and **Validation (OOS)** — always on here; you only choose how much to hold out.
- **Budget level** — how many combinations each stage may try (quick → deep). **Advanced budget** edits every number.
- **Entries** — *Signals + time-based neutrals* (directional structures wait for a signal, neutral ones enter on the clock) or *Strategy signals only*.
- **AI-validate champions** — replay each champion's entries through the AI gate in stage 4.

### While it runs
The progress card shows the stage, % done and an estimated finish time. **Pause** stops it and keeps its place (a [checkpoint](glossary#checkpoint), saved every few minutes and at the exact point on any stop), so **Resume** continues where it stopped. **Cancel run** ends it for good.

### Recent runs
Every run is saved, so you can re-attach after a page refresh. The legend reads: **crash or resource guard → auto-resume · paused by you → stays paused**:
- a run that **crashed** (server restart, error) restarts itself from its checkpoint, up to 3 times in a row;
- a run the [resource guard](glossary#resource-guard) **parked** (low memory, or market hours on the production server) restarts by itself as soon as the reason clears — the row shows the reason in plain words;
- a run **you** paused stays paused until you press Resume.

### Champions and the leaderboard
The best results appear as cards (🏆 = first). Each shows **Val net** (the honest number), **Train net**, **Full net** (whole period) and the exact settings. Load a champion into the Backtest tab to inspect it, or save it as a strategy. The **Full leaderboard** lists every stage-3 survivor; the **OOS** column marks with ✓ the ones that held up on validation and with ⚠ the ones that did not.`,
        },
        {
            id: 'deploy-regime',
            title: 'Deploy · Market regime & structure fit',
            where: 'Top of the Deploy tab',
            md: `A pure-maths estimate (no AI) of **what kind of afternoon is likely** — quiet, normal or wild — and which deployed structures suit it. It runs in **Shadow**: every entry records the read and verdict, but nothing is resized or blocked until the scorecards below show it would help.

- **Read per index** — built from the morning's range, yesterday's range and recent volatility compared with that index's own last year, giving the probability of a quiet, normal or wild rest of session. **NO READ** means no calibration exists yet for that index — press **Rebuild profiles**.
- **Rebuild profiles** — replays every deployment and saved strategy over the last year to learn how each one did on quiet, normal and wild days. It takes a few minutes. Until it has run, every row says *no profile yet*.
- **Structure fit for today** — per structure: what it needs, its average ₹ per lot on quiet · normal · wild days in the replay, and **today's verdict**:

| Verdict | Meaning |
|---|---|
| **FULL** | Expected to be worth trading at full size under today's read. |
| **HALF** | Today reads wild-leaning and this structure does worse than usual on wild days — half size cut the worst losses in testing. |
| **STAND ASIDE** | Expected value under today's read is zero or negative (or it lost in every regime last year). |
| **NO READ / UNMEASURED** | Not enough information to judge. |

- **Is the read right?** — scores the daily 11:00 read against how the afternoon actually went. It needs about 20 scored days before it means anything. The **Brier** score measures forecast accuracy (lower is better; about 0.67 is no better than guessing).
- **Would acting on it have helped?** — real trades grouped by the verdict they had, and what halving HALF trades or skipping STAND ASIDE trades would have changed.

> **Note:** The replay uses model option prices (one volatility per day): trust the *ordering* of quiet/normal/wild more than the exact ₹ amounts. The direction lean is display only — it failed to predict in testing.`,
        },
        {
            id: 'deploy-saved-strategies',
            title: 'Deploy · Saved strategies',
            where: 'Folding list (closed by default)',
            md: `Every structure you saved from Backtest, Builder or an optimizer champion. The folded header shows how many there are and how many are deployed; click it to open.

- **Filter** by name, structure, index or signal; **Sort** by date, backtest result, live result and more.
- A **deployed** chip shows the live track record of strategies already running: deployments, booked trades and net.
- **Deploy lots** — the size new deployments will start with.
- Per strategy: **Load** (into the setup panel), **Deploy** as PAPER or LIVE, **Delete**, and **details** (settings and the backtest that justified saving it).

### The result columns
- **Full window** — the whole backtest the strategy was saved with: net, profit factor, win %, return on margin and trades.
- **Val / Train** — the same window cut into its first 70% (*Train*) and last 30% (*Val*). Two kinds of saves fill them:
  - an **Auto-optimize** champion (marked *Auto #rank*): the optimizer chose the settings on Train only, so Val is a true out-of-sample test. The verdict reads **✓ Holds** or **⚠ Overfit**.
  - a **backtest split** of hand-set settings: nothing was tuned on either part, so Val only shows whether the edge was still there most recently. The verdict reads **✓ Held up**, **⚠ Faded**, or **↗ Better lately** when the first part lost and only the last part made money. It is never used as Go Live evidence.
- A plain backtest save without a split shows the full window only.

Deploying opens a **pre-deploy review** that checks the settings for mistakes. LIVE deployments then continue to the [Go Live](go-live) checks.`,
        },
        {
            id: 'deploy-summary',
            title: 'Deploy · Summary cards and engine banner',
            md: `| Card | Meaning |
|---|---|
| **Combined P&L (all books)** | Realised today + open MTM, PAPER and LIVE together. |
| **Structures closed today** | Booked round-trips today, and how many deployments have used today's one entry slot. |
| **Daily Loss Used** | The worse book's loss as a share of its daily cap. |
| **Engine Status** | RUNNING, HALTED or STOPPED, with what is open. "⚠ loop Ns ago" means the engine's 10-second loop has not run recently. |

A red **halt** banner explains why the engine stopped taking entries (reason, who, when) and whether it clears itself next trading day or needs **Resume engine**. An amber banner means the engine loop is stale — open structures may not be managed.`,
        },
        {
            id: 'deploy-signal-timeline',
            title: 'Deploy · Signal Status Timeline',
            where: 'Folding list (closed by default)',
            md: `One row per deployment: its current state, the reason, and a ribbon of its recent checks (newest on the right; hover for time and reason). Click a name to open its engine journal. When folded, the header shows a count per state.

| State | Colour | Meaning |
|---|---|---|
| **ENTRY** | Green | A structure was entered. |
| **READY** | Blue | Conditions met, about to enter. |
| **WAIT** | Amber | Waiting — outside the entry window, wrong weekday, … |
| **NEUTRAL** | Faint | A signal deployment saw no signal on the last candle. |
| **DONE** | Grey | Already entered today (one structure per deployment per day). |

Changes of state are also saved permanently in the journal, so "why didn't it trade on Tuesday?" can be answered later.`,
        },
        {
            id: 'deploy-toolbar',
            title: 'Deploy · Filters, bulk actions and book exposure',
            md: `- **Filter** — all books, LIVE only, PAPER only, **Open only** (deployments holding a structure).
- **Sort** — by state, MTM, total P&L or name.
- **Stop all** stops every deployment from entering (open structures are still managed). **Close all** closes every open structure now. Both ask for confirmation; if any LIVE structure is open, Close all also makes you type **CLOSE ALL**.
- **Book exposure** — the whole book's greeks against the engine's limits: Δ (₹ per index point), V (₹ per volatility point — **short vega** is what the vega cap limits) and Θ (₹ per day).`,
        },
        {
            id: 'deployment-card',
            title: 'Deploy · A deployment card',
            md: `One card per deployment. **REAL MONEY** on a red border means LIVE.

### Header
Name, mode (PAPER / LIVE), status (ACTIVE / STOPPED) and position state (IDLE, ENTERING, OPEN, EXITING). Buttons:
- **📈 chart** — the live risk graph (next section). **📊 activity** — its equity curve. **journal** — its own engine events. **🧾 results** — opens the [Results tab](#results-tab) showing only this deployment. **details** — full order detail.

### Tiles
- **MTM net** — what you would keep if you closed now, after charges. When the market is closed it is marked with its age ("⚠ … 9.6h old") because it is a snapshot that may pre-date the closing prices; opening details re-prices it from the broker.
- Under it, **gross** (before charges) and **chg** (estimated round-trip charges).
- **Today** and **Total (N)** — booked net today, and over all N trades.
- **MTM today** — a small line of the open structure's value through the day.
- **Greeks line** — Δ ₹/pt, V ₹/IV-pt (of legs still open), Θ ₹/day and the volatility percentile at entry.

For time-entry deployments the card says when the next entry arms; a **stood down** note explains why no structure was entered today.`,
        },
        {
            id: 'risk-graph',
            title: 'Deploy · The live risk graph (📈 chart)',
            md: `How the open structure's profit depends on where the index goes.

- **Solid line — expiry**: P&L if held to expiry at each index level.
- **Dashed line — now (T+0)**: P&L if closed right now at each level. **Dotted line — next open**: the same at the next trading open, after one more day of time decay.
- **Shaded band — ±1σ move**: the range the index typically stays inside until expiry.
- **Vertical lines** — **now** (current spot), **entry** (spot when opened) and strikes. **Horizontal dashed lines** — the take-profit (green) and stop-loss (red) levels in ₹.
- **Dot** — your P&L right now.
- **Hover** anywhere: the tooltip shows that index level, how far it is from entry and from now in points and %, and the P&L at expiry, at the next open and now.
- The header shows **BE** (break-evens), **IV**, **DTE** and **POP** (probability of finishing in profit).
- The footer gives MTM gross and net, max profit and max loss — **UNBOUNDED** in red means the loss has no limit (an uncovered short option).

### If nothing moves
Below the chart: how much the structure would gain or lose by the next open from time decay alone, how much a 1-point volatility change would be worth then, and how far the index typically moves overnight — because one volatility point often outweighs a whole day of decay.`,
        },
        {
            id: 'order-details',
            title: 'Deploy · Order details',
            where: '"details" button on a card',
            md: `The professional view of one deployment:

- **Deployment** — created, mode, entry rule, when it entered and the spot at entry.
- **Legs table** — strike, entry price, current or exit price, filled quantity, status and broker order ID for each leg.
- **Margin**, **TP level** and **SL level** in ₹, and **MTM now**.
- **Projected close** — when the structure will close by time if the price does nothing, and which rule decides it (hold limit, days-to-expiry exit, square-off…).
- **Broker reconciliation** (LIVE) — our recorded prices against the broker's average fill price; **Drift** is the difference.
- Buttons: **Resume** (re-activate), **Close now** (exit the structure immediately) and **Delete** (only when flat).`,
        },
        {
            id: 'engine-journal',
            title: 'Deploy · Engine journal',
            where: 'Bottom of the Deploy tab',
            md: `Every event the multi-leg engine raised: signals, skips (with the reason), stand-downs, entries, exits, recoveries and errors — paged back to the first day. Filter by deployment, event type or text; **Show only it** narrows to one deployment.

When the same event repeats (for example "no signal" every 10 seconds), it is counted rather than written again, and booked as one **REPEATS** row every 15 minutes while it continues.

Below it, **Structure trades** lists every completed round-trip of the deployments on this tab; the [Results tab](#results-tab) analyses them in depth.`,
        },
        {
            id: 'results-tab',
            title: 'Results tab',
            md: `What the deployments have booked. Everything here counts **closed** round-trips; open structures appear separately under *Open now*.

### Filters
**Book** (all / LIVE / PAPER), **Deployment** (a deployment opened from a card's 🧾 results link is preselected and highlighted; **✕ all** clears it), **Structure**, **Symbol**, and the **window** (last 30 / 90 days / all, by exit date).

### Scorecard
One row per deployment with a **verdict** that compares its live per-trade result with its own saved backtest:

| Verdict | Meaning |
|---|---|
| **No trades yet / Too few trades** | Not enough booked trades to judge. |
| **On track** | The backtest's per-trade result sits inside live's likely range — they agree. |
| **Ahead of backtest** | Live is making more per trade than the backtest. |
| **Below backtest** | Live is lower, but not by enough to call it drift. |
| **Drifting** | Live per-trade is more than half below the backtest — a prompt to look. |
| **Profitable · no backtest / Bleeding** | Enough trades, but no saved backtest to compare: making or losing money. |

**Fading** marks a profitable deployment whose most recent trades lost. **Open now** lists structures currently open with their net MTM. **Compare** overlays the equity curves of the deployments you tick.

### Summary tiles
Net P&L, per trade (total ÷ trades — the true average), win rate, profit factor, max drawdown, **per trade ÷ margin** and **avg margin**, gross (pre-cost) and charges paid, average hold, best / worst trade and day, average win / loss, trading days.

> **Note:** Margin is currently the engine's **estimate** (marked "~"), not the broker's figure. It is too high for naked strangles and straddles and too low for hedged condors and butterflies, so per-trade ÷ margin is only a rough guide.

### P&L over time
Daily net P&L bars (by exit day) and the equity curve with the drawdown shaded beneath it.

### Breakdowns
The same trades grouped by **Symbol, Structure, Exit reason, Deployment, Weekday, Month, IV regime at entry, Days to expiry at entry, Hold length, Entry hour, Entry slippage**, plus a **Calendar** of daily results. Columns: trades, win %, net, per trade, avg margin, per trade ÷ margin, costs ÷ gross. Click a column to sort.

### How trades travelled
Each trade's worst and best point while open ([MAE / MFE](glossary#mae-mfe)), and what a tighter stop or a profit target would have done to the totals. **Hover a dot** to see which trade it is, when it closed, and its worst point, best point and result.

**Stop-loss from these trades** prices a rupee stop on the trades in view:
- **Suggested stop** — the level that would have added most on the **older 70%** of trades, then checked on the **newest 30%** it never saw. It is only suggested when it helped on both; otherwise the panel says why not.
- **Stop at −₹** — type any level: how many trades it would have closed, how many of those had gone on to finish in profit, and the net change (all trades, older, newest). The dashed line on the chart marks it.
- **Set this stop on deployments…** — sets it as each chosen deployment's **Max loss ₹**: the whole structure closes once its mark, **net of the estimated charges to close it**, reaches minus that amount (exit reason **MAX_LOSS**). It applies from the next check, including to a structure that is open now (one already past the level closes at once — the window says which). The live engine and every backtest apply the same rule. **Turn off** removes it.

The figures are upper bounds: every trade that touched the level is booked at exactly that loss, while a real stop fills a little worse and marks are about a minute apart. Filter Results to one deployment to price a stop for that deployment alone.

### Round-trips table
Every booked structure: entry → exit, deployment, structure, index, mode, exit reason, credit per unit, IV percentile at entry, **margin** (~ = estimated), gross, charges, net and net ÷ margin. Click a row (or **Expand page**) to see its legs, its MTM path and details. Search and page through long lists. A row **struck through** is [quarantined](glossary#quarantined): booked on a price that was not real, shown but excluded from every total.`,
        },
    ],
};
