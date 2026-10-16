// Docs: AI Score (/ai-score) — does the AI confirmation actually help?
export default {
    id: 'ai-score',
    title: 'AI Score',
    route: '/ai-score',
    summary: 'The app can ask an AI (Claude or Gemini) to confirm each signal before entering, and to review open trades. That costs money and seconds. This page joins every AI verdict to what the trade actually did, to answer one question honestly: is the AI adding anything?',
    sections: [
        {
            id: 'overview',
            title: 'Why this page is careful',
            md: `The obvious comparison — trades the AI **confirmed** versus trades it **rejected** — is impossible: a rejected trade was never taken, so it has no result. This page does not invent one. Instead it shows only comparisons where **both groups really traded**, and says plainly when a number is too thin to mean anything.

Pick the period: **30d**, **90d**, **180d** or **1y**. Every number shows its trade count (**n**) — an average without its count is not a result.

A **t** value appears under comparisons. Roughly: below 2, the difference could easily be luck; above 2 it "clears the rough 5% line". When there are too few trades, no statistic is shown at all rather than a meaningless one.`,
        },
        {
            id: 'gate',
            title: 'Is the gate adding anything?',
            md: `Compares **AI-confirmed trades** with trades taken while the AI gate was **switched off**. Both groups traded, so both have real outcomes. Each side shows its [expectancy](glossary#expectancy) (average net per trade), total and win rate.

> **Note:** This is not a controlled experiment: the gate was switched on and off at different times, in different markets. A difference here is a hint, not proof.`,
        },
        {
            id: 'confidence',
            title: 'Is confidence informative?',
            md: `The AI gives each verdict a confidence score (0–100). If the score means anything, trades with higher confidence should earn more on average. The chart groups confirmed trades by confidence band and shows the average result per band.

- **Rising** left to right — confidence carries information.
- **Flat or falling** — it is noise and should not be used to decide anything. (In this app's history, high-confidence verdicts actually did *worse*.)`,
        },
        {
            id: 'inflight',
            title: 'In-flight reviews',
            md: `While a trade is open the AI can review it and suggest tightening the stop, moving the target or closing. Some suggestions are **applied**; others are **refused** by the engine's safety rules. Both groups kept trading, so comparing them is the closest thing here to a fair A/B test.`,
        },
        {
            id: 'rejects',
            title: 'Rejects, skipped and errors',
            md: `Counted, deliberately **not** scored:

- **REJECT** — the AI said no; no order was placed, so there is no result to score.
- **SKIPPED** — the gate was never reached (another rule stopped the trade first).
- **Errors** — the AI call failed (timeout, blocked, bad answer). What happened next depends on the deployment's fail-open / fail-closed setting.`,
        },
        {
            id: 'by-model',
            title: 'By model',
            md: `The same question split by which model answered: trades, expectancy, total, share won and worst trade. Models with few trades are noise — read the counts first.`,
        },
        {
            id: 'coverage',
            title: 'Coverage — what this report could not see',
            md: `Every closed trade in the window is accounted for: **with a verdict**, **without a verdict** (the gate was off — these are *not* rejects), and **unjoinable logs** (AI calls that carry no job or trade id, so they cannot be matched to a trade). Nothing is dropped silently.`,
        },
    ],
};
