// Docs: Go Live (/go-live) — the only way from PAPER to LIVE.
export default {
    id: 'go-live',
    title: 'Go Live',
    route: '/go-live',
    summary: 'Moving a strategy from PAPER (simulated) to LIVE (real money) happens here and nowhere else. The page proves the broker accepts your orders, shows whether the strategy has earned it, and promotes it with a "canary" that demotes itself if the first real trades lose.',
    sections: [
        {
            id: 'overview',
            title: 'Why there is one door to LIVE',
            md: `Real money should never be one accidental click away. Every other switch in the app refuses to turn a deployment LIVE and sends you here instead. Going LIVE takes three proofs:

1. **The broker accepts our orders** — a broker drill (below).
2. **The strategy has evidence** — paper results and an honest backtest.
3. **Risk is contained** — the first real trades are small and capped (the canary).

Moving back to PAPER (**Demote to PAPER**) is always allowed. A multi-leg deployment is demoted only when it holds no open structure.`,
        },
        {
            id: 'summary',
            title: 'The headline tiles',
            md: `| Tile | Meaning |
|---|---|
| **Real trades ever** | Trades that actually went through the broker with an order ID. |
| **Venues blocking** | Exchanges or brokers not yet ready for live orders (failed or missing drill, missing keys). |
| **Ready to promote** | Deployments that pass every gate. |
| **Live now** | Deployments currently trading real money. |
| **Venues** | Each venue's status. |

**Re-check** runs every gate again now.`,
        },
        {
            id: 'drills',
            title: 'Broker drills',
            md: `A drill sends a tiny real order designed **not** to fill (for example a limit price far from the market), confirms the broker **accepted** it, then cancels it. It is the only reliable proof that the account, the API keys and the server's whitelisted IP address all work — a paper trade proves none of that.

Choose the account, the instrument and the order; the window explains what will be sent and what happens next. If the order fills anyway, it is closed immediately at market and the page tells you to check the broker book.

**Drill history** lists every drill, newest first: when, segment, instrument, order, result and detail.`,
        },
        {
            id: 'deployments',
            title: 'Deployments and their gates',
            md: `Every single-leg and multi-leg deployment, checked against every gate. Each row shows its paper record and backtest evidence and a chip per gate.

- **Hard gates** — the venue, the broker drill, the system's own health. They can never be overridden; if their state is unknown they count as failed.
- **Evidence gates** — enough paper trades, a positive out-of-sample backtest, and so on. **Verify backtest** re-runs the evidence backtest.
- **All gates** — opens the full checklist with the reason for each pass or fail.

A **Stopped** badge means the deployment takes no new entries.`,
        },
        {
            id: 'promote',
            title: 'Promoting: the canary and overrides',
            md: `Promotion asks for **canary** settings — how the first live trades are limited:

- **Trades** — how many of the first live trades are canary trades (default 10).
- **Loss cap ₹** — if the canary trades lose this much in total, the deployment **demotes itself to PAPER** (when flat). Canary trades are sized at 1 lot.

If the evidence gates are not met, promotion is still possible only with a recorded **override**: type the exact phrase shown (it says you accept real losses) and a reason of at least 10 characters. Overrides are logged permanently. Hard gates cannot be overridden.

> **Warning:** Once LIVE, the deployment's card shows a red LIVE / REAL MONEY marker. Check its stop loss is placed at the broker (see [Live Positions](dashboard#live-positions)).`,
        },
    ],
};
