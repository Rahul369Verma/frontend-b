// Docs: Dashboard (/) — the single-option engine's control room.
export default {
    id: 'dashboard',
    title: 'Dashboard',
    route: '/',
    summary: 'The control room for the single-option engine: what is deployed, what is open right now, how today is going, and why each signal did or did not become a trade. (Multi-leg structures have their own control room on the Multi-Leg page, Deploy tab.)',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for',
            md: `Open the Dashboard during market hours to answer three questions at a glance:

1. **Is everything running?** — the header, the Engine Status cell and the Live Market Data card.
2. **How is today going?** — the stats strip (Combined P&L, trades, loss used) and the Live Positions list.
3. **Why did (or didn't) it trade?** — the Signal Status Timeline, the Live Activity Feed and the Direction Confidence card.

The page refreshes itself every few seconds; you never need to reload it. Sections you do not need can be folded away by clicking their title — the app remembers which ones you folded.`,
        },
        {
            id: 'header',
            title: 'Header: mode, broker connection, machine load',
            where: 'Top of the page',
            md: `- **PAPER / LIVE chip** — the engine's overall mode. Each deployment also has its own mode, so check the deployment cards too.
- **Fyers connected / disconnected** — whether the app has a working session with the broker. When disconnected, no prices arrive and no orders can be sent. The session is renewed automatically every morning; if it stays red after 09:15, log in again from [Settings](settings).
- **Subtitle** — the names of the strategies currently active.
- **RAM / CPU** — how hard the server is working. RAM turns amber above 300 MB and red above 400 MB. Sustained red means the server is short of memory, which can slow everything down.`,
        },
        {
            id: 'session-banner',
            title: 'Web session credentials warning',
            where: 'Amber banner under the header — only shown when there is a problem',
            md: `Some AI checks log in to Claude or Gemini through saved browser cookies. This banner appears when those cookies have **expired** or are **missing** for a strategy that uses them. Until fixed, those strategies' AI confirmation will fail (and fall back to their normal rules).

**What to do:** open [Backtest](backtest), paste fresh cookies, and press Deploy again for that strategy. **Re-check** forces an immediate test (results are otherwise cached for 5 minutes).`,
        },
        {
            id: 'global-defaults',
            title: 'Global Defaults',
            where: 'Folded card — click the title to open',
            md: `Account-wide limits that apply to every single-option deployment. While folded, the title line still shows a one-line summary, and a red **⛔ KILL SWITCH** badge if the kill switch is on.

| Tile | Meaning |
|---|---|
| **Trading window** | New trades are only opened between these times. Open trades are still managed outside it. |
| **Max daily loss** | When the day's loss reaches this, the engine **halts** new entries for the rest of the day. |
| **Max trades / day** | A cap on how many new trades can open in one session. |
| **Kill switch** | ENGAGED = no new entries anywhere, until switched off. OFF = trading allowed. |

These values are edited on [Settings](settings#risk-limits).`,
        },
        {
            id: 'deployments',
            title: 'Deployments panel',
            where: 'Large card below Global Defaults',
            md: `Every single-option strategy that has been switched on, grouped by index. Each **card** is one [deployment](glossary#deployment). Use the search box and filter chips at the top to find one; **Reset filters** clears them. Click the panel title to fold the whole panel.

### Switches on each card
- **Deployment active** — on = the deployment watches for signals; off = paused (any open trade is still managed).
- **Live trading (off = paper)** — this deployment only. A red LIVE label means real orders. Promotion to LIVE is normally done through [Go Live](go-live).
- **AI confirmation** — before entering, ask the AI to confirm the signal. A rejected signal is skipped and shows up in the Activity Feed.
- **AI in-flight review** — while a trade is open, the AI re-reviews it every few minutes and may tighten the stop, move the target or close it.

### Buttons
- **Lots** — how many lots each entry buys (hover to see the number of units).
- **Results / 7d / 30d** — open this deployment's results (equity curve, calendar, trades) on the [Strategy Detail](strategy-detail) page.
- **Sim CE / Sim PE** — pretend a buy-CE or buy-PE signal just happened, to test the full path (AI, stop loss, target) **without placing an order**.
- **Backtest** — open this exact configuration in the [Backtest](backtest) page.
- **Edit** — change the name or the settings (as JSON, a structured text format). **Delete** — remove the deployment.
- **+** next to an index name — add another strategy on that index.

### Strips on each card
- **AI settings summary** — which AI options are on (for example *fail closed*: if the AI errors, reject the trade instead of falling back; *fair entry*: wait up to ~15 minutes for a cheaper entry price the AI suggests).
- **Quick stats** — when it was deployed and last updated.
- **All parameters** (folded) — every setting the strategy uses. A value shown as overridden means the engine uses the global setting instead of the one stored on the deployment.
- **New Deployment** form — choose exchange, index, strategy and candle size (resolution, in minutes), optionally a display name, and whether to activate immediately.`,
        },
        {
            id: 'direction-confidence',
            title: 'Direction confidence — CE vs PE',
            where: 'Card below the Deployments panel',
            md: `This card answers one question: **lately, have our bullish (CE) trades or our bearish (PE) trades been working?** It is pure arithmetic on your own recent closed trades — no AI and no market forecast.

It reads **top to bottom, simplest first**: one line on what the gate is doing, the two sides in plain words, whether blocking has helped, the **blocked trades**, and the **latest decisions**. Everything else — the scorecard, session history, day-by-day value and the ghost table — is behind **Show details**.

## The two side boxes
Each box shows the side's **confidence** (0% to 100%: the probability that the side's average result is positive — **50% = no edge either way**) and one sentence saying what that means right now, e.g. *"Below the 40% floor — these signals are blocked; 1 in 3 goes through as a probe (next probe in 2 signals)."* **Numbers** opens the detail:

| Line | Meaning |
|---|---|
| **Trades in window** | How many recent trades on this side are counted, and in brackets the *effective* number after older trades are faded down. |
| **Win rate (decayed)** | Share of winners, with recent trades counting more. |
| **Avg R (decayed)** | Average result in [R](glossary#r-multiple) (profit ÷ money risked), recent trades counting more. |
| **Net in window** | Rupees made or lost by this side's counted trades. |

Old trades fade with a **half-life of 3 sessions** (a trade from 3 sessions ago counts half as much as today's). The maths also starts **sceptical** — as if it had already seen a few break-even trades — so two lucky trades cannot push confidence to 100%. A side is labelled **WEAK** when its confidence falls below the **floor** (40% by default), **THIN** when there are too few trades to judge.

## Off, Shadow, Enforce
| Mode | What the gate does |
|---|---|
| **Off** | Nothing is decided or recorded. |
| **Shadow** (recommended) | On every signal the gate decides what it *would* do and **records** it on the trade — but never blocks anything. |
| **Enforce** | Signals on a weak side are actually **rejected**, except **probes**. |

**Probe:** when a side is weak, every Nth signal (default **1 in 3**) is still let through on purpose, as a small test. If the market has changed and probes start winning, the side's confidence recovers and blocking stops. Without probes a blocked side could never prove itself again.

**Follow blocked trades as ghosts (enforce):** when on, each signal that Enforce blocks is still followed on paper as a [ghost trade](glossary#ghost-trade) — same entry, same exits, real prices, no order — so you can later see what the block cost or saved.

## Scorecard — would blocking have helped?
Over roughly the last 4 weeks:
- **"N trades the gate would have blocked, net ₹X"** — real trades taken while in Shadow that the gate marked BLOCK, and what they made together. If they made money, enforcing would have **cost** that much; if they lost, enforcing would have **saved** it.
- **Probes** — how many probe trades there were and what they made.
- **"N trades have no recorded verdict"** — trades from before this feature existed, or while the gate was Off. They are counted, not hidden.
- **Enforce line** — blocked trades followed as ghosts and what they *would* have made, knock-on trades (real trades that only happened because a block left the slot free), and the resulting **gate value** (see the next section).

The **badge** on the right is the verdict. Its icon matters: **✓** = blocking would have made money, **✕** = blocking would have cost money, **i** = information only — there are not yet enough blocked trades to judge (it needs 10 or more).

## Confidence at each session close
One row per trading day: each side's confidence measured at that day's **15:40 IST close** (the time is shown), with the number of trades counted in brackets. Today's row says **(so far)** until the session ends, because the day is not over. Read it as a history: watching a side's confidence fall below the floor and recover is how you see the gate "think".

## Is it helping?
One sentence on whether blocking has made or cost money over roughly the last 4 weeks. Until 10 or more trades have been blocked it says **too few to judge** — a handful of trades can go either way by luck.

## Blocked trades
Every trade the gate **blocked** (Enforce) or **would have blocked** (Shadow), newest first. The line on top adds it up: how much blocking **saved** (blocked trades that would have lost) and **cost** (blocked trades that would have won), and the net. Each row says in words what happened — *"would have made −₹893 (SL Hit)"* for a blocked trade followed at real prices, *"taken anyway (shadow mode) — made +₹2,179"* for a shadow verdict — and whether blocking saved or cost money.

**Details** opens everything about one block: both sides' confidence at that moment and the engine's exact reason, the contract and prices, the worst and best point while it was followed, and any **AI reviews** — a failed review says *why* it failed (for example *Claude.ai blocked the request with a Cloudflare check*) and how to fix it. AI failures are also raised on [Notifications](notifications#ai-health).

## Latest gate decisions
The most recent signals the gate judged, newest first, with **date and time**, strategy, index and side, decision, confidence and what happened next:

| Decision | Meaning |
|---|---|
| **ALLOW** | The side is trusted enough; the trade goes ahead. |
| **BLOCK** | The side is weak. In Shadow only recorded; with **✕** it was enforced (the signal was rejected). |
| **PROBE** | The side is weak, but this signal was let through on purpose as a test. |
| **THIN** | Too few recent trades on this side to judge — the trade goes ahead. |
| **UNMEASURED** | No fresh reading was available, so the gate stepped aside (it never blocks blind). |

Hover a decision to see its meaning and the engine's exact reason. The list is read from the gate's permanent journal, so it survives restarts (it used to be engine memory and said *"No signals since the engine started"* after every deploy).`,
        },
        {
            id: 'direction-gate-history',
            title: 'Direction gate history — has the gate made or cost money?',
            where: 'Bottom of the Direction confidence card',
            md: `The long-run scorecard, one row per day, with a chart of the running total. Pick the period with **30d / 90d / 180d / 1y**.

## The key idea: gate value
For each day the app compares two imaginary books — **with** the gate and **without** it:

> **Gate value = (profit with the gate) − (profit without the gate).** Positive means the gate made money that day; negative means it cost money.

How it is worked out depends on the mode that day:
- **Shadow:** nothing was really blocked, so your real trades *are* the "without" book. With the gate, the trades it marked BLOCK would not have happened. So **value = −(what those would-block trades made)**. If they made ₹5,098, the gate would have cost ₹5,098 → value −₹5,098.
- **Enforce:** blocked signals really were skipped, so your real trades are the "with" book. Without the gate you would also have had the blocked trades (the **ghosts**) but not the **knock-on** trades. So **value = knock-on profit − ghost profit**. If a ghost lost ₹1,212, blocking it saved ₹1,212 → value +₹1,212.

## The columns
| Column | Meaning |
|---|---|
| **Day** | The trading day the gate made its decisions (the day the trades were *entered*). |
| **Mode** | The gate mode(s) in force that day: **shadow**, **enforce**, or **enforce + shadow** when the mode was switched during the day, so decisions were made under both. |
| **Signals** | How many signals the gate judged that day. "—" on older days just means the decision log did not exist yet (it started in mid-October); trades from those days still carry their verdicts. |
| **Would-block (shadow)** | Real trades the gate marked BLOCK while in Shadow: count · what they made. |
| **Ghosts (enforce)** | Signals really blocked in Enforce and followed as ghosts: count · what they would have made (+ any still open). |
| **Knock-on** | Real trades that only happened because a block left the deployment free: count · what they made. |
| **Not followed** | Blocked signals that could not be followed as ghosts (a later check stopped them, a ghost was already open, or tracking was off). Hover for the reasons. |
| **Probes** | Weak-side signals let through as tests: count · what they made. |
| **Gate value** | That day's value, as defined above. |
| **Cumulative** | The running total of gate value from the first day shown up to this day — the line in the chart. It is the bottom line: above zero, the gate has made money so far; below zero, it has cost money. |

## Worked example
A row reading *14-Oct · enforce + shadow · 5 signals · would-block 1 · −₹2,179 · ghosts 1 · −₹1,212 · gate value +₹3,391 · cumulative −₹1,563* means:
1. Part of the day was Shadow: the gate marked one real trade BLOCK and that trade **lost** ₹2,179 → blocking it would have **saved** ₹2,179.
2. Part of the day was Enforce: one signal really was blocked; followed as a ghost it **would have lost** ₹1,212 → the block **saved** ₹1,212.
3. Gate value for the day = 2,179 + 1,212 = **+₹3,391** (the gate helped).
4. Before this day the running total was −₹4,954 (mostly 9-Oct, when it would have blocked two trades that made ₹5,098). −4,954 + 3,391 = **−₹1,563**: overall the gate has still **cost** money.

## Blocked trades, followed as ghosts
A table of every ghost: when it was blocked, strategy, contract, side, entry and exit price, the exit reason, what it would have made, its worst and best points ([MAE / MFE](glossary#mae-mfe)), any AI reviews it received, and a *caveat* chip when its price had to be estimated.

> **Note:** Ghosts are never orders, never in your P&L, never in Telegram and never fed back into the gate's own confidence. A deployment can hold at most one ghost at a time.`,
        },
        {
            id: 'market-data',
            title: 'Live Market Data (BANKNIFTY)',
            where: 'Folding card',
            md: `A quick health check that prices are flowing, using BANK NIFTY:

- **Spot Price** — the index right now.
- **5m EMA Short / Long** — two moving averages of 5-minute closes (an EMA weights recent prices more). When the short one is above the long one the short-term **trend** is up.
- **5m Trend** — BULLISH or BEARISH from the two EMAs; the bracketed number is the gap between them.
- **Last Update** — time of the last price received. **Last Heartbeat** — the engine's last "I am alive" pulse. **Last Signal Check** — when strategies last evaluated a candle.

If these times stop moving during market hours, the price feed or the engine has stalled.`,
        },
        {
            id: 'stats-strip',
            title: 'Today at a glance (stats strip)',
            where: 'Row of four numbers',
            md: `| Cell | Meaning |
|---|---|
| **Combined P&L** | Today's realised profit (closed trades) plus the open positions' current MTM. Underneath, the two parts separately. |
| **Trades Today** | New trades opened today, out of the daily maximum, and how many are open now. |
| **Daily Loss Used** | How much of the daily loss limit today's combined loss has used. The bar turns amber above 50% and red above 80%; at 100% the engine halts new entries. |
| **Engine Status** | RUNNING or STOPPED, with the active strategies. |`,
        },
        {
            id: 'signal-timeline',
            title: 'Signal Status Timeline',
            where: 'One row per watched index',
            md: `What each strategy concluded at its most recent checks. Each row shows the index, the **current** state, its reason, and on the right a ribbon of small bars — **one bar per recent check, newest on the right**. Hover any bar for its time and reason.

| Colour | Meaning |
|---|---|
| Green | **ENTRY** — a signal fired. |
| Blue | **WAIT** — a filter held it back (for example outside the trading window). |
| Amber | A specific reason blocked it (volume too low, indicator not confirming, …). |
| Grey | **No signal** — nothing to do on that candle (the normal state). |

A long run of grey is normal: most candles produce no signal.`,
        },
        {
            id: 'live-positions',
            title: 'Live Positions',
            where: 'Card listing every open trade',
            md: `One card per open trade. Its border is green when in profit, red when losing.

- **Top line** — trade ID, mode, the option contract, the strategy that produced it, and the live P&L.
- **Entry Option / Option LTP** — the premium paid and the premium now (LTP = last traded price). **Entry Spot / Spot LTP** — the index level then and now. **Held** — how long it has been open.
- **🛡 Broker SL/TP (option premium)** — the stop-loss and target prices placed at the broker, and how far each is from the current price. **"⚠ unprotected"** means no stop and no target exist at the broker; **"TP unreachable"** means the target is so far away it will practically never be hit.
- **🎯 Spot SL/TP** — stop and target expressed as **index** levels (when the AI suggested them). *Engine-monitored* means the engine will act on them.
- **🤖 AI managing** — appears once the AI has acted: lots still open after partial exits, **⏳ +N candles** extra holding time granted past the time limit, or a **🛡️ floor** — a premium level that locks in a gain and only ever moves toward the price.
- **In-flight reviews** — fold-out list of every periodic AI review (HOLD, CLOSE_NOW, UPDATE_SL, UPDATE_TP), with **✓ applied** on the ones the engine acted on.
- **Close** — sends an immediate market exit for this one position through the engine.

> **Warning:** An amber **Orphan position** banner means the trade exists in the database but the engine is not watching it (usually another trade on the same index replaced it in memory). Its stop and target will **not** fire automatically — close it by hand.`,
        },
        {
            id: 'option-chain',
            title: 'Real Option Chain (BANKNIFTY)',
            where: 'Card below Live Positions',
            md: `The live list of BANK NIFTY options around the current price: **calls (CE)** on the left, **strikes** in the middle, **puts (PE)** on the right, with each option's last traded price. Use it to see what a contract costs right now. **Show** picks how many strikes to list; the chain can be hidden to save space.`,
        },
        {
            id: 'trade-history',
            title: 'Trade History',
            where: 'Folding table',
            md: `Every single-option trade, newest first. Search by symbol at the top.

| Column | Meaning |
|---|---|
| **Trade ID** | A short code that identifies the trade everywhere (feed, details, Telegram). |
| **Entry / Exit Time** | When it opened and closed. |
| **Status** | OPEN or CLOSED. |
| **Symbol / Strategy** | The option contract and the strategy that traded it. |
| **Action / Qty** | Direction and number of units. |
| **Price (En/Ex)** | Entry and exit premium. |
| **P&L** | Profit in rupees. |
| **Reason** | Why it closed (stop loss, target, time limit, AI close, manual, …). |

**Details** opens a window with everything recorded about the trade: its stop and target, the AI conversation, and the [direction gate](#direction-confidence) verdict with both sides' confidence at the moment of entry. Rows marked **Legacy** come from an older format with fewer fields.`,
        },
        {
            id: 'activity-feed',
            title: 'Live Activity Feed',
            where: 'Large table at the bottom',
            md: `A single timeline of everything that happened: trades, AI decisions and errors. Filter by index, strategy or trade ID (click a trade ID in the table to filter by it). **Collapse** pauses the feed's refreshing.

| Type | Meaning |
|---|---|
| **TRADE_ENTRY / TRADE_EXIT** | A trade opened or closed (with P&L on exits). |
| **AI_CONFIRM / AI_REJECT** | The AI approved or turned down a signal, with its confidence. |
| **ENTRY_SKIPPED** | A signal passed its checks but still did not become a trade — the Detail column says why (no suitable strike, broker refused, not enough funds, minimum stop distance, halt, no price, gate block, …). |
| **AI_ERROR** | The AI could not be reached or answered badly; the system fell back to its rules. |
| **ENGINE_ERROR** | Something went wrong inside the engine. **CRITICAL** ones need attention. |

Expand an AI row to see the exact prompt sent and the raw reply.`,
        },
        {
            id: 'test-windows',
            title: 'Signal test and simulator windows',
            where: 'Opened from a deployment card (Sim CE / Sim PE / Test)',
            md: `These windows let you rehearse a trade **without** placing a real order.

- **Signal preview** shows the option the engine would buy, its current price, quantity, entry limit price, and the stop loss and target in points. **Force Paper Trade** runs it as a paper trade even if the deployment is LIVE.
- **Signal simulator** runs the strategy on the current candles and shows spot, strike, premium, bid/ask, capital needed, and the projected risk and reward — plus the AI's suggested stop and target when AI is on.`,
        },
    ],
};
