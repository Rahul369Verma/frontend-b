// Docs: Parity Audit (/parity-audit) — Standard vs Nitro feature pipelines must agree.
export default {
    id: 'parity-audit',
    title: 'Parity Audit',
    route: '/parity-audit',
    summary: 'A technical check for the RL models. The same model inputs ("features") are computed by two different engines — Standard (CPU) and Nitro (GPU) — and they must produce the same numbers, or a model trained on one would see different data when it runs on the other. This page computes both and compares them, column by column.',
    sections: [
        {
            id: 'overview',
            title: 'Why parity matters',
            md: `An [RL agent](ai-manager#overview) learns from a table of features (indicators such as RSI, moving averages, candle patterns). The **Standard** engine computes them one way on the CPU; **Nitro** computes them another way, fast, on a GPU. If the two disagree, a model trained with Nitro and run with Standard (or the reverse) is effectively looking at a different market — its decisions become meaningless without any error appearing.

Run this audit after changing any feature code, and before trusting a model trained on the other engine.`,
        },
        {
            id: 'config',
            title: 'Audit configuration',
            md: `- **Symbol**, **Feature Profile** (which feature set to compare — the same profiles as [AI Manager](ai-manager#rl)), **Start / End Date**.
- **Warm-up Skip** — ignore the first N candles. Indicators such as a 200-candle average are not valid until enough history exists, and the two engines may fill that start-up period differently; it is not a real disagreement.
- **Tolerance** — the largest average difference allowed for a feature to pass (tiny floating-point differences are normal).

**⚡ Run Parity Audit** starts it; the button shows **Engine Syncing…** while it runs.`,
        },
        {
            id: 'results',
            title: 'Reading the results',
            md: `| Tile | Meaning |
|---|---|
| **Overall Pass Rate** | Share of features whose two versions agree within tolerance. Should be 100%. |
| **Failed Checks** | Features that disagree — each one is a bug to fix before trusting cross-engine models. |
| **Max Tolerance Deviation** | The worst disagreement found. |
| **Columns Verified** | How many features were compared. |

**Comparison Results** lists each feature with its **Delta (MAE)** — the mean absolute error, i.e. the average size of the difference between the two engines — the **Threshold** it was held to and **Status** (pass / fail). Filter to failures to focus. The **Tolerance gauge** shows how much headroom a feature has; **Validation Log** shows the raw engine output.`,
        },
    ],
};
