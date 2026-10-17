// Docs: Notifications (/notifications) — every warning the platform raises, the AI health check, Telegram.
export default {
    id: 'notifications',
    title: 'Notifications',
    route: '/notifications',
    summary: 'One place for everything that needs you: the AI not answering, the broker logged out in market hours, an engine halted, out-of-date exchange data, a nearly full disk, a trade the direction gate blocked. Urgent problems and warnings are also sent to Telegram.',
    sections: [
        {
            id: 'overview',
            title: 'How it works',
            md: `The **bell** at the bottom of the left rail shows how many things need you — **red** when something is urgent, **amber** for warnings. The **Dashboard** shows the same items at the top, under *Needs attention*. Click either to come here.

There are two kinds:
- **Problems** (*Needs attention*) are true **right now** — for example "Broker is not logged in during market hours". Each stays listed until the problem is fixed, then clears **by itself** and moves to *History*.
- **Notices** are one-off events — for example "Direction gate blocked a CE trade".

Each row is one sentence. **Details** shows **why** it happened and **how to fix it**; **Open** goes to the page involved; **Acknowledge** says you have seen it — it stays listed until it clears, but Telegram stops repeating it.

The server checks every **2 minutes**. Nothing here places or changes a trade.`,
        },
        {
            id: 'ai-health',
            title: 'AI health',
            md: `Several deployments let an AI review open trades (and some ask it to confirm entries). If that AI stops answering, every review comes back **ERROR** and nothing used to say so — from 8-Oct-2026 every review failed because Claude.ai answered the server with a Cloudflare *"Just a moment…"* page.

So every **6 hours** — and whenever you press **Test now** — the server sends **one small sample review prompt** to each AI model your deployments use, down exactly the path a real review takes. Each model shows:

| Status | Meaning |
|---|---|
| **Working** | It answered the sample normally (time shown). |
| **Not answering** | It failed — the reason is written in plain words, with how to fix it and when it last gave a good answer. |
| **Not checked yet** | The first check runs a few minutes after the server starts. |

A failure is raised as a notification and sent to Telegram. A **real** review that fails during the day raises it straight away, without waiting for the next check, and a normal answer clears it. While the AI fails, trades fall back to their normal stops and targets — nothing is blocked — unless a deployment's AI *entry confirmation* is set to **fail closed**, which blocks its entries (that case is marked **Urgent**).

**Recent checks** lists every check: when, why it ran (server start, every 6 h, Test now), the result and the reason.`,
        },
        {
            id: 'nightly-audit',
            title: 'Nightly audit',
            md: `Every weekday at **19:30 IST** the server runs the nightly audit by itself — no cron to set up. It checks for the silent kinds of drift that have cost money before:
- expiries and option symbols against the broker's own listing;
- measured spreads against the cost model;
- put-call parity on the stored chains;
- booked charges against today's rate card;
- structures stuck open or holding expired legs;
- the market-rules sync;
- the go-live gate;
- every recent multi-leg trade's contract and lot.

19:30 is after the 18:45 market-rules sync and while the broker login is still valid. If the server restarts later that evening, it catches up.

The panel shows when it last ran and what it found — **Everything reconciles**, **Warnings** or **Urgent findings** — and when it runs next. **Findings** lists every finding of the last run, and **Recent runs** the last two weeks. **Run now** checks immediately.

Each urgent finding and warning is also a notification (and goes to Telegram). It clears when a later run no longer finds it. A run that **fails**, or a weekday run that **did not happen** by 20:30, is a warning too. You can still run it by hand on the server with \`make audit\` (print only) or \`make audit-notify\`.`,
        },
        {
            id: 'telegram',
            title: 'Telegram',
            md: `Urgent problems and warnings also go to your Telegram chat (notices too, if you tick them). A problem that stays open is **repeated** every 6 hours by default until you acknowledge it or it is fixed, and a **✅ resolved** message follows when it clears. **Send a test message** checks the connection.

Messages carry the environment tag — **[PRODUCTION]** or **[DEV]**. The development and production servers share one Telegram chat, so on the development server Telegram starts **off**.`,
        },
        {
            id: 'watched',
            title: 'What the platform watches',
            md: `The panel at the bottom lists every condition that raises a notification today, its level and when it is checked — the AI health check, broker login and price feed (market hours), a halted single-leg engine, a stopped multi-leg loop, a stale direction gate, out-of-date exchange contract data, a nearly full disk, the database being unreachable (sent to Telegram directly, since it cannot be stored), and the nightly audit's findings (every weekday at 19:30 IST).`,
        },
        {
            id: 'slowness',
            title: 'Slowness alerts',
            md: `Every kind of slowness is a notification in the **Slowness** category — one per problem, refreshed while it keeps happening, and **resolved** after 15 quiet minutes. Each says how often, the worst time against its budget, and what was involved.

| Watched | Slow when |
|---|---|
| **Server froze** | the server's single thread was held ≥ 300 ms — every request, price update and engine check waited. It names what was running. ≥ 2 s is urgent. |
| **Slow API** | a request took ≥ 2 s or sent ≥ 1 MB (backtests, optimizer runs and exports: ≥ 10 min) |
| **Slow database query** | one MongoDB command took ≥ 500 ms — by collection, with the filter's field names |
| **Slow outside call** | the broker, NSE, Telegram… took ≥ 5 s (AI models: ≥ 90 s) |
| **Engine loop running late** | a live, position-watch or multi-leg loop took longer than its own interval |
| **Memory pressure** | the server's memory ≥ 85% full, or a garbage-collection pause ≥ 300 ms |
| **Slow page** | your browser froze ≥ 500 ms on a page, or waited ≥ 5 s for an answer |

They go to Telegram like any other warning (production on by default): the first time a problem appears, a reminder while it stays, and a resolved message when it clears.`,
        },
    ],
};
