// Docs: Getting started — what this app is and how to find your way around it.
export default {
    id: 'start',
    title: 'Getting started',
    summary: 'What this app is, what each part of it does, and how to read these docs. Start here if you have never used it before.',
    sections: [
        {
            id: 'what-is-this',
            title: 'What this app is',
            md: `This is an **automated trading system for the Indian stock market**, mainly for **index options** (contracts on indexes such as NIFTY 50, BANK NIFTY and SENSEX). It does four jobs:

1. **Watches the market** — it receives live prices from the broker (Fyers) every second.
2. **Decides when to trade** — a *strategy* (a fixed set of rules, for example "buy when price breaks above the morning range") looks at the prices and produces a *signal*.
3. **Trades** — it opens and closes positions on its own, either for real money (**LIVE**) or in simulation (**PAPER**).
4. **Records and explains everything** — every trade, every decision and every reason a trade was skipped is saved so you can study it later.

Around that core there are research tools to test an idea on past data before risking anything ([Backtest](backtest), [Optimizer](optimizer)), tools for multi-option trades ([Multi-Leg](multi-leg)), a fast "tick" engine ([Tick Strategies](tick-strategies)), an AI assistant that can review trades ([AI Manager](ai-manager)), and a stock screener ([Stock Alerts](alerts)).

> **Note:** If words like *option*, *strike*, *premium* or *lot* are new to you, read [Trading basics](basics) next. Every technical word used in these docs is also explained in the [Glossary](glossary).`,
        },
        {
            id: 'paper-vs-live',
            title: 'PAPER and LIVE — the most important switch',
            md: `Every strategy runs in one of two modes:

| Mode | What happens | Money at risk |
|---|---|---|
| **PAPER** | The system behaves exactly as if it were trading — same signals, same prices, same exit rules — but **no order is sent to the broker**. Fills are simulated at the live market price. | None |
| **LIVE** | Real orders are sent to your broker account. | Real money |

Everything new should run in PAPER first. The results pages show PAPER and LIVE side by side (often called the two **books**) so you can compare. Moving a strategy from PAPER to LIVE is done deliberately on the [Go Live](go-live) page, which checks evidence and safety limits first.

> **Warning:** A LIVE badge (usually red) on a card means real money. Read the card twice before pressing any button on it.`,
        },
        {
            id: 'layout',
            title: 'Finding your way around',
            md: `The **left rail** (the narrow column of icons) is the main menu. Hover an icon to see its name; the button at the top of the rail expands it to show names permanently.

| Page | In one line |
|---|---|
| [Dashboard](dashboard) | What is running right now: live positions, today's P&L, signals, engine health. |
| [Live Portfolio](live-portfolio) | What everything has made over time — both books, every strategy. |
| [Charts](charts) | Price charts with your trades drawn on them. |
| [Backtest](backtest) | Test a single-option strategy on past data. |
| [Optimizer](optimizer) | Search for the best settings of a strategy, honestly. |
| [Multi-Leg](multi-leg) | Build, test, deploy and review multi-option structures (spreads, condors, straddles). |
| [Delta Exchange](delta) | The second venue — crypto and tokenised assets, open 24×7. |
| [Go Live](go-live) | The only way from PAPER to LIVE: drills, evidence, limits. |
| [Portfolio Risk](risk) | How much risk the whole account is carrying. |
| [Stock Alerts](alerts) | A screener and alerts over every NSE stock (no trading). |
| [Tick Strategies](tick-strategies) / [Tick Results](tick-results) | The fast engine that reacts to every price tick, and what it earned. |
| [AI Manager](ai-manager) / [AI Score](ai-score) | The AI assistant's settings and logs, and whether it has been worth it. |
| [Parity Audit](parity-audit) | Checks that the backtest and the live engine agree. |
| [Market Rules](market-rules) | Exchange facts the system relies on: lot sizes, expiries, holidays, charges. |
| [Data Manager](data-manager) | Historical price data stored for research. |
| [Settings](settings) | Global switches, limits and broker login. |

At the bottom of the rail are the **Appearance** settings (theme, text size, contrast) and a status light showing whether the app is connected to the server.

**Folding sections.** Long pages are built from sections that fold like an accordion. Click a section's title (the **›** arrow) to fold or unfold it. A folded section keeps its title, its one-line description and its controls, and sometimes shows a short summary, such as today's regime read or how many signals are waiting. Each section remembers how you left it, in this browser. **Collapse all** / **Expand all** at the top right of a long page (Dashboard, Multi-Leg, Live Portfolio, Risk, Alerts, Tick Results, Go Live…) folds or opens every section at once. A few panels stop refreshing while folded, such as the multi-leg Engine events, the Dashboard activity feed and the market-regime read, and catch up as soon as you open them.`,
        },
        {
            id: 'using-docs',
            title: 'How to use these docs',
            md: `- Almost every section of the app has a small **📖 book icon** next to its title. Click it to open the explanation of exactly that section in a new browser tab, so you do not lose your place.
- Use the **search box** at the top of this page to find any word (for example *margin*, *probe* or *drawdown*). Press **/** to jump into it from anywhere on the page, use **↑ ↓** to pick a result and **Enter** to open it.
- The **contents** (left), the **text** (middle) and **On this page** (right) scroll separately. The section you are reading is highlighted in both lists, and the thin bar along the top of the text shows how far through the page you are.
- **Hover over a link** to another part of the docs (for example a glossary word) to preview what it says without leaving your place.
- The **address bar follows the section you are reading**, and the 🔗 icon next to each section title copies a link to it — handy for sending someone straight to one explanation.
- Keyboard: **j** / **k** next and previous section, **]** / **[** next and previous page, **?** lists every shortcut.
- On a narrow screen the contents move behind a **Contents** button.
- Each doc page starts with what the page is for, then explains every section on it in the order you see it on screen. The **Glossary** has a filter box and an A–Z bar.
- Many numbers in the app also have a tooltip — hover over a number or a small ⓘ to see a one-line explanation.

> **Tip:** Sections marked with a coloured badge use the same colours everywhere: green = good / running, red = bad / stopped / real money at risk, amber = warning or waiting, blue or grey = information. Badges also carry a symbol (✓ ▲ ✕ i) so they never rely on colour alone.`,
        },
        {
            id: 'time-and-sessions',
            title: 'Times, sessions and "stale" data',
            md: `- **All times are Indian Standard Time (IST)**, shown on a 24-hour clock (14:10 = 2:10 pm).
- A **session** is one trading day. Indian equity and index markets open at **09:15** and close at **15:30** IST on weekdays, except exchange holidays (listed on [Market Rules](market-rules)). Some calculations use **15:40**, when the closing session of the derivatives market ends.
- Outside market hours prices do not move. The app then shows the **last known** value and usually marks it as **stale** (for example "mark 8h old"). A stale number is a snapshot, not a live reading.
- "Today" always means the current IST trading day.`,
        },
        {
            id: 'safety',
            title: 'Safety nets you will see mentioned',
            md: `The system has several automatic brakes. You will meet them throughout the docs:

- **Daily loss limit** — if a book loses more than a set amount in a day, new entries stop for the rest of the day (a **halt**). See [Settings](settings#risk-limits).
- **Kill switch / halt** — stops new entries immediately. Open positions are still managed and closed by their own rules.
- **Stop loss (SL)** — every trade has a price at which it is closed to cap the loss. On LIVE trades it is also placed at the broker so it works even if the app goes down.
- **Gates** — optional filters that can skip a signal (for example a VIX filter or the direction confidence gate). Most new gates start in **Shadow** mode: they record what they *would* have done without changing anything, so you can judge them before trusting them. See [Shadow and Enforce](glossary#shadow-mode).
- **Resource guard** — research jobs (optimizer runs) pause automatically when the computer is short of memory, so they never starve the trading engines.`,
        },
    ],
};
