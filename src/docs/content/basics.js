// Docs: Trading basics — the ideas every other page assumes, from zero.
export default {
    id: 'basics',
    title: 'Trading basics',
    summary: 'The handful of market ideas you need to read every screen in this app. No prior knowledge assumed — each idea builds on the one before it.',
    sections: [
        {
            id: 'index',
            title: 'Indexes: what the system trades on',
            md: `An **index** is a single number that tracks a basket of shares. **NIFTY 50** follows India's 50 largest companies; **BANK NIFTY** (shown as NIFTYBANK) follows the biggest banks; **FINNIFTY** financial companies; **MIDCPNIFTY** mid-sized companies; **SENSEX** and **BANKEX** are the BSE equivalents.

You cannot buy an index directly, but you can trade **options** on it (next section). The current value of the index is called the **spot** price. When the docs say "NIFTY moved 100 points", they mean the spot value changed by 100.

> **Example:** NIFTY at 25,000 rising to 25,100 is a move of +100 points, or +0.4%.`,
        },
        {
            id: 'options',
            title: 'Options: CE and PE',
            md: `An **option** is a contract whose price depends on where the index goes. There are two kinds:

| Name | Also called | Gains when the index… |
|---|---|---|
| **CE** | Call | goes **up** |
| **PE** | Put | goes **down** |

So buying a CE is a bet that the index rises; buying a PE is a bet that it falls. In this app, "CE side" means bullish (up) trades and "PE side" means bearish (down) trades.

Every option has:
- a **strike** — the index level it is tied to (for example the NIFTY 25,000 CE);
- an **expiry** — the date the contract ends (index options expire weekly or monthly; see [Market Rules](market-rules));
- a **premium** — its price right now, in rupees per unit.

A strike close to the current spot is called **ATM** (at the money). A strike that already has value is **ITM** (in the money); one that would only have value after a further move is **OTM** (out of the money). OTM options are cheaper but need a bigger move to pay off.`,
        },
        {
            id: 'lots',
            title: 'Lots and quantity',
            md: `Options are traded in fixed bundles called **lots**. The **lot size** is set by the exchange (for example a certain number of NIFTY units per lot) and changes from time to time — the current values are on [Market Rules](market-rules).

Profit is **premium change × quantity**. If you buy 1 lot of 75 units and the premium rises from ₹100 to ₹110, you made ₹10 × 75 = **₹750** before costs.

> **Note:** Many screens show prices **per unit** (marked "/u") and profits **in rupees** (₹). A move of ₹2 per unit on a 75-unit lot is ₹150.`,
        },
        {
            id: 'buy-vs-sell',
            title: 'Buying versus selling options',
            md: `- **Buying** an option costs the premium up front. The most you can lose is what you paid; the gain can be large if the index moves your way.
- **Selling** (also called *writing* or *going short*) means you **receive** the premium up front. You keep it if the option ends worthless, but if the index moves against you the loss can be much bigger than what you received.

Single-option strategies in this app mostly **buy** a CE or a PE (a few settings allow selling). Multi-leg structures often **sell** options (to collect premium) and **buy** others further away as protection. The difference between what was received and what was paid is the **net credit** (you received more) or **net debit** (you paid more).`,
        },
        {
            id: 'pnl',
            title: 'Profit and loss: gross, net, realised, MTM',
            md: `| Term | Meaning |
|---|---|
| **Gross P&L** | Profit from price changes only, before any costs. |
| **Charges** | Costs of trading: broker fee, securities transaction tax (STT), exchange fee, GST, SEBI fee, stamp duty. |
| **Net P&L** | Gross minus charges — what actually reaches your account. The app treats **net** as the true number. |
| **Realised** | Profit on trades that are already **closed**. It can no longer change. |
| **Unrealised / MTM** | *Mark-to-market*: what an **open** position would make if closed right now at current prices. It changes every second. |

> **Warning:** Your broker's app usually shows P&L **before** charges. Compare it with the app's *gross* figure, not *net*. On small multi-leg trades the charges can be bigger than the profit, so gross can be green while net is red.`,
        },
        {
            id: 'margin',
            title: 'Margin',
            md: `**Margin** is the money your broker blocks in your account while a position is open, as a safety deposit. Buying an option needs only its premium. **Selling** options needs much more, because the possible loss is larger; the exchange computes it with a formula called **SPAN** plus an extra **exposure margin**.

The app shows margin so you can judge **return on capital**: a ₹500 profit on ₹5,000 of margin is a 10% return; the same ₹500 on ₹5,00,000 is 0.1%.

> **Note:** Today the app estimates margin with its own formula (marked "~" on screen); it does not yet ask the broker. Treat margin figures as approximate. Details: [Multi-Leg results](multi-leg#results-tab).`,
        },
        {
            id: 'sl-tp',
            title: 'Stop loss, take profit, trailing stop',
            md: `- **Stop loss (SL)** — a price at which a losing trade is closed automatically, to cap the loss.
- **Take profit (TP / target)** — a price at which a winning trade is closed to lock in the gain.
- **Trailing stop** — a stop loss that moves up behind a winning trade, so some profit is protected if the price turns back.
- **Square-off** — closing everything at a fixed time of day (intraday strategies close before the market shuts).

The distance between the entry price and the stop loss is the money **risked** on the trade. Many statistics in the app are expressed in **R** — profit divided by money risked. A trade that made twice what it risked is **+2R**; one that hit its stop is about **−1R**.`,
        },
        {
            id: 'candles-signals',
            title: 'Candles, signals and strategies',
            md: `Prices are grouped into **candles** (also called bars): one candle summarises a fixed time window — usually **5 minutes** here — with four prices: **open**, **high**, **low**, **close**.

A **strategy** is a fixed recipe that reads candles (and indicators computed from them, such as moving averages or VWAP) and outputs a **signal**: *buy CE*, *buy PE*, or *nothing*. Signals are normally taken when a candle **closes**, so the strategy only acts on complete information.

A **deployment** is one strategy switched on for one index with its own settings and mode (PAPER or LIVE). The same strategy can be deployed on several indexes, or twice on one index with different settings.`,
        },
        {
            id: 'volatility',
            title: 'Volatility: IV, India VIX, IV percentile',
            md: `**Volatility** is how much prices are swinging. It matters because option premiums are higher when the market expects big moves.

- **IV (implied volatility)** — the size of moves the option price itself is assuming, worked backwards from the premium.
- **India VIX** — the market's own "fear gauge": one number for the expected volatility of NIFTY over the next month. Low (around 10–13) = calm; high (20+) = nervous.
- **IV percentile (IVP)** — where today's volatility sits within the last year, from 0 (the calmest it has been) to 100 (the wildest).`,
        },
        {
            id: 'greeks',
            title: 'The Greeks (delta, theta, vega, gamma)',
            md: `The **Greeks** describe how an option's price reacts to change. You only need the idea:

| Greek | Answers the question | In this app |
|---|---|---|
| **Delta (Δ)** | How much does the position gain or lose for a 1-point move in the index? | "₹/pt" |
| **Theta (Θ)** | How much does it gain or lose per day just from time passing? Sellers gain from time; buyers lose. | "₹/day" |
| **Vega (V)** | How much does it gain or lose if volatility rises by 1 point? | "₹/IV pt" |
| **Gamma (Γ)** | How fast delta itself changes as the index moves. | rarely shown |`,
        },
        {
            id: 'expiry-dte',
            title: 'Expiry and DTE',
            md: `**DTE** means *days to expiry* — how long until the option contract ends. Options lose value faster as expiry approaches (time decay, *theta*). On **expiry day** an option that is out of the money becomes worthless; one that is in the money is settled at its intrinsic value.

**Intraday** strategies open and close on the same day. **Positional** strategies can hold for several days, sometimes until expiry.`,
        },
        {
            id: 'backtest-oos',
            title: 'Backtesting, optimising and "out of sample"',
            md: `- A **backtest** replays a strategy over past prices to see how it *would* have performed.
- An **optimizer** tries many different settings to find the best ones.
- **Overfitting** is the trap: with enough tries, some settings look brilliant on the past purely by luck and fail on new data.

To guard against overfitting, the app splits history in two: settings are chosen on the **training** part (*in sample*) and then checked on a part they never saw — the **validation** or **out-of-sample (OOS)** part. A strategy that only does well in training is not trusted.

> **Tip:** When a screen shows "Train" and "Val" (validation) side by side, the **Val** number is the honest one.`,
        },
        {
            id: 'stats',
            title: 'Reading performance statistics',
            md: `| Statistic | Meaning | Good when |
|---|---|---|
| **Win rate** | Share of trades that made money. | Means little alone — a 30% win rate is fine if winners are big. |
| **Average win / loss** | Typical size of a winning / losing trade. | Wins larger than losses. |
| **Expectancy / per trade** | Total net ÷ number of trades — what one trade is worth on average. | Above zero. |
| **Profit factor (PF)** | Total won ÷ total lost. | Above 1 (1.3+ is healthy). |
| **Max drawdown** | The worst fall from a previous high in the running total. | Small relative to profit. |
| **Sharpe / Sortino** | Return compared with how bumpy the ride was. | Higher is better. |
| **MAE / MFE** | The worst (adverse) and best (favourable) point a trade reached while open. | Shows whether winners were ever in trouble. |

> **Warning:** A handful of trades proves nothing. The app often refuses to give a verdict ("too few to judge") until it has enough trades — usually 10 to 30.`,
        },
        {
            id: 'multi-leg-idea',
            title: 'Multi-leg structures in one paragraph',
            md: `A **multi-leg structure** combines several options into one position, each option being a **leg**. Examples: a **straddle** sells a CE and a PE at the same strike (profits if the index stays still); a **strangle** sells them further apart; an **iron condor** sells a strangle and buys cheaper options even further out as insurance, which caps the worst loss. Structures are built, tested and run on the [Multi-Leg](multi-leg) page.`,
        },
        {
            id: 'slippage',
            title: 'Slippage and spread',
            md: `The **bid** is the highest price buyers are offering; the **ask** is the lowest price sellers want; the gap between them is the **spread**. When you buy you usually pay near the ask and when you sell you receive near the bid, so every trade loses a little to the spread.

**Slippage** is the difference between the price the system *decided* on and the price it actually *got*. PAPER trades fill at the live market price, so they have little slippage; LIVE trades can slip, especially in fast markets.`,
        },
    ],
};
