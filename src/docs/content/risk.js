// Docs: Portfolio Risk (/risk) — how much risk the whole account carries.
export default {
    id: 'risk',
    title: 'Portfolio Risk',
    route: '/risk',
    summary: 'A whole-account view of risk across both engines (single-option and multi-leg). It is read-only: it measures and warns, it never trades. Five tabs: Live Book, Stress, Attribution, Portfolio and Limits.',
    sections: [
        {
            id: 'overview',
            title: 'What this page is for',
            md: `Each engine manages its own positions, but risk adds up across them: a short strangle in one place and several bullish calls in another can all point the same way. This page adds every open option together and asks:

- If the market moves 1%, or volatility jumps, what happens to the **whole account**? (Live Book, Stress)
- Where did past profit actually come from, and how much did costs eat? (Attribution)
- Are our strategies really different bets, or the same bet several times? (Portfolio)
- Are the account-wide safety limits sensible? (Limits)

It refreshes every 15 seconds (**Auto 15s**) or on **Refresh**.`,
        },
        {
            id: 'live-book',
            title: 'Live Book',
            md: `### Headline tiles
| Tile | Meaning |
|---|---|
| **Net delta** | Rupees gained or lost if the market moves 1%, expressed in NIFTY-equivalent terms so different indexes can be added up. |
| **Net vega** | Rupees gained or lost if volatility rises by 1 point. Large negative = the book is short volatility and a panic would hurt. |
| **Theta** | Rupees gained or lost per calendar day from time passing alone. |
| **Premium at risk** | The most the long (bought) options could lose — the premium that could go to zero. |

Margin is shown **Exact** when the broker supplied it, or **Est.** (estimated) when it did not.

### Cards
- **Directional concentration** — long side against short side, and how much of the risk sits on one index. *Are these separate bets, or one bet in many costumes?*
- **Which engine holds the risk** — the same numbers split by engine (single-leg / multi-leg).
- **Exposure by underlying** — rupees per 1% move for each index, comparable across indexes.
- **Book warnings** — legs that could not be priced (**Unpriced**). They are still open, so the totals may *understate* risk.
- **Open legs** — every open option: contract, engine, strategy, side, quantity, premium, IV (and how it was worked out), days to expiry and delta. A leg without a live quote is marked at its entry price.`,
        },
        {
            id: 'stress',
            title: 'Stress',
            md: `"What if?" for the whole book. Every leg is **fully repriced** under each shock (not estimated from the greeks), because big moves are exactly where simple approximations fail.

- **Shock grid** — the book's P&L for combinations of market move and volatility change. **Worst / best case in grid** are its extremes.
- **Named scenarios** — realistic shocks (for example a gap down with a volatility spike), worst first. The top three rows are the ones to read. The magnitudes are templates, not forecasts.
- For a book that only buys options, the worst case is floored at losing the premium paid.`,
        },
        {
            id: 'attribution',
            title: 'Attribution',
            md: `Where closed trades' profit came from, over a chosen window.

- **Where the money came from** — gross P&L split into **direction (delta)**, **convexity (gamma)**, **volatility (vega)**, **decay (theta)** and **unexplained**, then **slippage** and **charges** taken out to reach **net**. Only trades that recorded their market snapshot at entry and exit can be fully split; the rest are cost-analysed only.
- **Cost drag** — the share of the gross edge consumed by costs. A **Gross is positive but net is negative** warning means trading costs turned a winning strategy into a losing one.
- **Break-even reality check** — the premium move each trade needed just to pay its own costs. **TP below break-even** counts trades whose target was too small to ever make money after costs.
- **Breakdown** — the same by strategy and by index.`,
        },
        {
            id: 'portfolio',
            title: 'Portfolio',
            md: `Are the strategies really different from each other?

- **The headline** — how many strategies traded, how many **independent bets** they really are (strategies whose daily results move together closely are counted as one), and how many are **redundant** (same bet, extra size, no extra edge).
- **Clusters — what to keep, what to drop** — groups of strategies that move together. In each cluster the one with the best risk-adjusted return is the **Keep**; the others are **Redundant**.
- **Capital allocation** — a suggested split of capital across the independent bets.
- **Most duplicated pairs** — pairs of strategies whose daily results are very similar (correlation r ≥ 0.7).
- **Correlation matrix** — every pair: blue = move together, red = move opposite.
- **What each strategy is actually betting on** — each strategy's trade results explained by market factors (needs 20+ fully analysed trades). **R²** says how much the factors explain; **Driver** is the main one.`,
        },
        {
            id: 'limits',
            title: 'Limits (portfolio risk controls)',
            md: `Account-wide limits the engines check **before** opening a new position: for example the most short-volatility exposure, premium at risk, or a refusal to enter during a violent market. A helper can **suggest** values at about twice the current book's reading.

> **Note:** These are runaway guards — necessary, never sufficient. They stop the book from becoming extreme; they do not make a strategy good.`,
        },
    ],
};
