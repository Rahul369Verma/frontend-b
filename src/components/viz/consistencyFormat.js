// Words for a consistency score (backend src/domain/research/consistency.js), shared by the
// Backtest card, the Run-together table and the Optimizer.

/** How to read a 0–100 consistency score, in words. */
export function consistencyVerdict(score) {
    if (score == null || !Number.isFinite(Number(score))) return 'no trades';
    if (score >= 60) return 'steady — makes money through most of the range';
    if (score >= 35) return 'uneven — some long flat or losing stretches';
    if (score >= 15) return 'lumpy — the result rests on a few periods';
    return 'one stretch — most of the range is flat or losing';
}

/** A score as a whole number, or an em dash. */
export const consistencyText = (score) => (score == null || !Number.isFinite(Number(score)) ? '—' : String(Math.round(Number(score))));
