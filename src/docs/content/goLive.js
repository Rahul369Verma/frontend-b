// Docs: Go Live (/go-live) — the only way from PAPER to LIVE.
export default {
    id: 'go-live',
    title: 'Go Live',
    route: '/go-live',
    summary: 'Moving a strategy from PAPER (simulated) to LIVE (real money) happens here and nowhere else. The page proves the broker accepts your orders, shows whether the strategy has earned it, and promotes it with a "canary" that asks you what to do if the first real trades lose — it never switches anything by itself.',
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

**Drill history** lists every drill, newest first: when, segment, instrument, order, result and detail.

A pass counts for **14 days**. Fyers accepts orders through the API only while the exchange is open (NSE and BSE 09:15–15:30, MCX 09:00–23:30 IST), so a drill can't run in the evening or at the weekend.

**Automatic drills.** Every trading day the server checks each segment while its exchange is open. It runs the same drill by itself when the segment was never drilled, its newest drill failed, or its last pass is more than 7 days old — so a pass never lapses and a promotion is never blocked by an old drill. Each line under a segment says what the automatic drill is doing ("passed at 09:40", "retries after 10:15", "no Delta API keys").

- **When:** MCX futures from 09:05, NSE options from 09:40, BSE options from 09:45, Delta from 09:50 IST. One drill at a time, never in the minutes around a LIVE strategy's entry time or while one is entering or exiting, and never while Fyers is pausing requests.
- **How often:** at most twice a day per segment, 30 minutes apart. After that it tries again the next trading day.
- **What it records:** a pass, or a failure once an order reached the broker. A failure before any order was sent (no quote, no listed contract) proves nothing about the order path, so the gate keeps its earlier pass; it is still listed as an issue.
- **Where it runs:** only on the server that trades (engines on). Any other server shows "Automatic drills: off" and why.

**Drill issues** lists every drill that failed in the last 30 days — by the button or automatically — grouped by segment and error, with the step that failed and how often. Each failure also raises a notification (the bell and Telegram) that clears when the segment next passes. Fix what it names; the next automatic drill confirms the fix.`,
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
- **Loss cap ₹** — if the canary trades lose this much in total, you get an **urgent alert** (the bell, and Telegram's alerts chat) and the deployment's row here shows **loss cap reached — your decision** with two buttons: **Demote to PAPER** or **Keep LIVE**. Nothing changes until you choose — it keeps trading LIVE at the canary size meanwhile. Keep LIVE asks again if it loses another loss cap. Canary trades are sized at 1 lot.
- After the canary's trades, it asks **lift the size cap?** — it stays at the canary size until you press **Lift size cap**.
- **Skip the canary** — while the canary is still running and the deployment is set to more lots than the canary's, its row has a **Skip the canary** button (multi-leg: also a check in the 📦 Lots dialog). It lifts the size cap now: the next entry trades every lot set, its ₹ limits act in full, and the canary stops watching — it no longer asks you at its loss cap. It is your decision, recorded in the audit as CANARY_SKIPPED with how far the canary got. It is not offered while the canary waits at its loss cap: answer Keep LIVE or Demote first.

A name that ends in "(LIVE)" or "(PAPER)" follows the mode when you promote or demote.

**Clone as LIVE** (multi-leg). On a PAPER card, *Clone as LIVE* opens this same dialog, with the same gates, canary and override. Instead of switching the PAPER deployment to LIVE, it makes a **new LIVE copy** named "… (LIVE)". The PAPER one keeps running, unchanged, as its twin. You can set the copy's lots, and its ₹ limits are scaled to them. See [LIVE vs PAPER twins](multi-leg#deploy-twins).

If the evidence gates are not met, promotion is still possible only with a recorded **override**: type the exact phrase shown (it says you accept real losses) and a reason of at least 10 characters. Overrides are logged permanently. Hard gates cannot be overridden.

> **Warning:** Once LIVE, the deployment's card shows a red LIVE / REAL MONEY marker. Check its stop loss is placed at the broker (see [Live Positions](dashboard#live-positions)).`,
        },
    ],
};
