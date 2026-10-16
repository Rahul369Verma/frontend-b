// Docs: Signal Combiner + Run together — combining strategies in the Backtest and Optimizer pages.
export default {
    id: 'signal-combiner',
    title: 'Combining strategies',
    summary: 'Two ways to use several strategies at once: run them side by side on one index ("Run together"), or build one strategy that only trades when its members agree (the Signal Combiner). The optimizer can search combiner settings, and it refuses to crown a combiner that does no better than its best member or than chance.',
    sections: [
        {
            id: 'overview',
            title: 'Two different things',
            md: `**Run together** answers "what if I deploy these strategies at the same time?" Each strategy keeps its own trades; you see them side by side, added together, and with the account-wide daily limits applied.

**Signal Combiner** answers "can these strategies filter each other's signals?" It is ONE strategy. Its **members** are other strategies; it watches their entry signals and enters only when they satisfy a **rule** (for example, two of them agree on the direction within three bars). It holds one position at a time, like any strategy, so it can be backtested, optimized and deployed like one.

The older **Council Ensemble** is a fixed combiner of 13 strategies. It is unchanged; the Signal Combiner is the general version.`,
        },
        {
            id: 'members',
            title: 'Members and their parameters',
            where: 'Backtest → Strategy: Signal Combiner → Members',
            md: `Any strategy can be a member except the few that cannot vote bar by bar (AI- and model-driven ones), the combiners themselves, and MTA EMA Crossover; the builder lists them and why.

For each member you choose where its **parameters** come from:

| Source | Meaning |
|---|---|
| **Code defaults** | The strategy's built-in settings. |
| **Preset** | One of the "Load Best Params" presets. |
| **A deployment's params** | Exactly what one of your deployments runs. |
| **An optimizer run** | A setting that held up out-of-sample in a saved optimizer run. |

The combiner saves each member's **full parameter set** with a short fingerprint (for example **#e79e4e5d**), so a saved combiner keeps working the same even if a preset or a default changes later.

**Role**: a **voter** counts and can trigger; a **primary** is the trigger in the primary rules; a **confirm** member counts but never triggers alone; a **veto** member never counts, but blocks the opposite direction while its signal is fresh. **Weight** is used by the weighted rule.

Members' own "max signals per day" limits are switched off inside a combiner (members are checked on every bar, so their limits would count signals the combiner ignored); the combiner's own daily limit applies.`,
        },
        {
            id: 'rules',
            title: 'Rules',
            md: `| Rule | Enters when |
|---|---|
| **quorum** | At least *Min Votes* different members agree on the direction within the window, one of them on this bar. |
| **weighted** | The members' weights for one direction, minus the weights for the other, reach the threshold. |
| **primary_confirm** | The primary fires on this bar and at least *Min Confirms* other members agree. |
| **primary_veto** | The primary fires on this bar and no other member signalled the opposite direction. |
| **priority** | Any member fires; if several fire on the same bar, the first in the list wins. This **adds** members together rather than filtering them. |

The **window** is how many bars a signal stays fresh. The stop comes from the voters' own stop levels (**SL Mode**: widest, tightest, latest, or the primary's); the target from the chosen voter's own target or a multiple of the risk.

Evidence so far (Council Ensemble, Oct 2025 – Jan 2026): agreement of two members helped; taking any single member's signal (priority) did not.`,
        },
        {
            id: 'report',
            title: 'Where every member signal went',
            where: 'Backtest → Results → Signal combiner',
            md: `After a combiner backtest, this card accounts for **every** member signal. Each one ends in exactly one bucket, and the ✓ column checks that they add up:

| Bucket | Meaning |
|---|---|
| **In an entry** | It was part of the agreement the combiner traded. |
| **Set the stop** | Of those, the member whose stop and target were used. |
| **Cleared** | It was fresh when the combiner entered the other way. |
| **Replaced** | The same member signalled again in the same direction. |
| **Expired unused — why** | It aged out of the window; the reason is the last thing that blocked it (too few agreed, a split, the combiner was in a trade, …). |

**P&L by voter set** shows which combinations actually made money. **How often members fire together** shows overlap: two members that nearly always fire together confirm very little.`,
        },
        {
            id: 'run-together',
            title: 'Run together',
            where: 'Backtest → Run together',
            md: `Pick two or more strategies (with code defaults, a preset, or one of your deployments). They run on the symbol, dates, capital and data settings in the form; capital is split by **weight**.

- **All together** adds the strategies' results.
- **With account caps** applies the live engine's account-wide **max daily loss** and **max entries per day** to the combined book, as live does: once a limit is reached, new entries that day are refused (open trades carry on). Every refused entry is listed. Not simulated: a strategy whose entry was refused might have entered again later that day.
- **How much they overlap**: how often two strategies enter within a few minutes of each other on the same side, and how their daily P&L moves together.

Each data series is loaded once and shared by every strategy in the run.`,
        },
        {
            id: 'optimizer',
            title: 'Optimizing a combiner',
            where: 'Optimizer → Strategies: Signal Combiner',
            md: `Pick **candidate members** (code defaults, presets, deployments or settings from a saved optimizer run). Each optimizer draw picks 2–6 of them, a rule and its settings. **The members' own parameters are never changed by the search** — tuning members and the combiner together would make it far too easy to find a setting that only fits the past.

Members' signals are computed once per index and reused by every draw, so a combiner draw costs about as much as one ordinary strategy.`,
        },
        {
            id: 'gates',
            title: 'Why a combiner may not be crowned',
            md: `After the search, the best setting that held up out-of-sample on each index must pass two checks before it can be the winner:

1. **Beats its best member** — every member is run on its own over the same data. The combiner's held-out score (after the penalty for having been picked from many draws) must be higher than every member's.
2. **Beats chance** — the same members' signals are picked at **random** at the same trade count, 19 times or more. If random picks do as well in more than 5% of runs, the agreement is not adding anything.

A combiner that fails stays in the list, marked **Not crowned**, with the reason and the numbers. With several indexes it must pass on as many indexes as a strategy must hold up on.`,
        },
        {
            id: 'live',
            title: 'Deploying a combiner',
            md: `A combiner deploys like any strategy (PAPER first; LIVE only through Go Live). In the live engine its members are checked on every closed candle, in a trade or not, exactly as in the backtest. After a restart, or for candles before the entry window opens, it replays the bars it missed from recent history so its memory matches the backtest's. Each trade records which members voted and which one set the stop.`,
        },
    ],
};
