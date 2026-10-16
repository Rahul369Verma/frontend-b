// Docs: Delta Exchange (/delta) — the crypto / tokenised-asset derivatives venue.
export default {
    id: 'delta',
    title: 'Delta Exchange',
    route: '/delta',
    summary: 'A second trading venue next to the Indian stock exchanges: Delta Exchange India, which lists derivatives on Bitcoin, Ether, tokenised gold (XAUT) and tokenised US stocks, trading 24 hours a day, 7 days a week. This page shows whether the venue is healthy, every listed contract, option chains and your Delta account.',
    sections: [
        {
            id: 'overview',
            title: 'What Delta is, and how it differs from NSE',
            md: `Most of this app trades Indian index options through the broker **Fyers** (NSE, BSE and MCX). **Delta Exchange India** is a separate exchange for crypto-asset derivatives. The same strategies, backtests, the optimizer and deployments can run on Delta: wherever you can pick an exchange, **Delta Exchange** is one of the choices, and Delta symbols start with \`DELTA:\` (for example \`DELTA:BTCUSD\`).

Things that are different from NSE:

- **Open all the time** — 24×7, including weekends. There is no 15:30 close.
- **Prices are in US dollars**, but every profit, loss and limit in the app is in **rupees**, converted at Delta India's **fixed ₹85 per USD** (Delta itself uses that fixed rate, so there is no exchange-rate guess).
- **Contracts, not lots** — a contract is a fixed small amount of the asset (for example 0.001 BTC). The contract card shows how many rupees one point of price move is worth per contract.
- **Perpetuals** — futures that never expire. To keep their price close to the real asset, longs and shorts pay each other a small **funding** fee every few hours.
- **Regulation** — these are crypto-asset (VDA) instruments: registered with India's FIU, *not* regulated by SEBI, and their tax treatment is unsettled. Check with a chartered accountant before trading real money.

> **Note:** Nothing on this page places an order. Delta trades come only from deployments, exactly like Fyers ones, and real money still needs promotion on [Go Live](go-live).`,
        },
        {
            id: 'status',
            title: 'The status tiles',
            md: `| Tile | Meaning |
|---|---|
| **Listed contracts** | How many contracts Delta lists right now, split by kind: perpetual, future, spot, call, put, move option. |
| **Contract list age** | How long ago the app downloaded the list. It refreshes every hour, plus once a day at 17:30 IST when the new daily options are listed. Red = stale. **Refresh contract list** (top right) downloads it now. |
| **Feed** | **streaming** = live prices are arriving over Delta's socket; **idle** = nothing subscribed. The hint shows how many symbols are subscribed out of the maximum, and how often the socket has reconnected. |
| **Trading** | Which Delta environment the API keys point at — **testnet** (Delta's practice exchange, fake money) or **production** (real money) — or **no API keys**. PAPER deployments work without keys because they only need prices. |

A yellow **Last feed/broker error** line appears under the tiles if the most recent call to Delta failed.`,
        },
        {
            id: 'contract',
            title: 'Contract — look up any contract',
            md: `Search every listed contract by name. The card shows its specification and live price:

| Row | Meaning |
|---|---|
| **Kind** | Perpetual, future, spot, call, put or move option (a move option pays out on the *size* of a move, either way). |
| **Contract** | How much of the asset one contract is. |
| **P&L per point per contract** | Rupees gained or lost when the price moves by 1 for one contract. |
| **Tick** | The smallest price step. |
| **Fees (maker / taker)** | Fee rate when your order rests in the book (maker) or takes an existing order (taker), plus 18% GST. Options also have a **fee cap** as a share of premium. |
| **Max leverage** | How far margin can be stretched, and the initial margin it implies. |
| **Strike / Settles** | For options and futures: the strike and the settlement time in IST. |
| **Funding** | For perpetuals: how often funding is paid, and the current rate. |
| **Last / mark** | Last traded price, and the **mark** price Delta uses to value positions and liquidations. |
| **Bid / ask** | Best buy and sell prices now, and the half-spread in basis points (1 bp = 0.01%) — the cost of crossing the market. |
| **Status** | Whether the contract is trading. |`,
        },
        {
            id: 'option-chain',
            title: 'Option chain',
            md: `Every listed strike for one **underlying** (BTC, ETH or XAUT) and one **expiry**, with the call on the left and the put on the right. Delta settles BTC and ETH options at **17:30 IST** and XAUT at **21:30 IST**. Daily expiries are common, so the list changes every day.`,
        },
        {
            id: 'account',
            title: 'Account',
            md: `With API keys set, this shows the **Wallet** (all balances, in rupees at ₹85/USD), **Available** (not blocked as margin) and every open position: contract, long/short, contracts, entry price, **liquidation** price (where Delta would force-close it for lack of margin) and unrealised P&L.

Without keys it shows how to connect. The keys are set on the server (\`DELTA_API_KEY\`, \`DELTA_API_SECRET\`, \`DELTA_TRADING_ENV\`), created on Delta Exchange India with trading permission and the server's IP whitelisted. Keep \`DELTA_TRADING_ENV=testnet\` until you mean real money.

> **Warning:** Leverage cuts both ways. A leveraged position that moves against you to its liquidation price is closed by the exchange and the margin is lost.`,
        },
        {
            id: 'modelled',
            title: 'What is real and what is modelled',
            md: `- **Real:** contract specifications, live prices, fees, settlement times and (with keys) the account.
- **Modelled in backtests:** Delta has no history of expired options at 1-minute detail, so the backtester prices options with a [Black-Scholes](glossary#black-scholes) model at recent realised volatility. Results label this. Treat option backtests on Delta as a rough guide, and futures/perpetual backtests as closer to real.`,
        },
    ],
};
