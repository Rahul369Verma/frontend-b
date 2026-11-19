/**
 * Words and numbers for "Entry and exit times, on these days" (TimingReplay.jsx): a pair said in a line,
 * which cell is which, the shade of a cell, how a replayed day went, and the builder link for one pair.
 */
import { signed, hhmm } from './stopReplayFormat.js';
import { endedText, istDay } from './comboReplayFormat.js';

/** "09:20 → 15:10" */
export const timingText = (r) => (r ? `${r.entry} → ${r.exit}` : '—');

/** Same entry and exit time? */
export const sameTiming = (a, b) => !!a && !!b && a.entry === b.entry && a.exit === b.exit;

/**
 * A cell's background: green for a net gain, red for a loss, deeper the larger it is against the largest
 * of the grid (`scale`). Theme colours (index.css), so every theme reads it.
 */
export function heatStyle(net, scale) {
    if (net == null || !(scale > 0) || net === 0) return undefined;
    const pct = Math.round(Math.min(1, Math.abs(net) / scale) * 40) + 6;
    return { backgroundColor: `color-mix(in srgb, var(${net > 0 ? '--color-success-fill' : '--color-danger-fill'}) ${pct}%, transparent)` };
}

/** The largest |net| of the cells shown (the shade's full strength). */
export const heatScale = (rows) => Math.max(0, ...(rows || []).map((r) => Math.abs(r.net || 0)));

/**
 * One side of a replayed day: "entered 09:20:05 · 25350 CE · 25350 PE · leg stop 09:37 → structure stop 10:18",
 * or why it did not enter.
 */
export function dayText(s) {
    if (!s) return '—';
    if (s.noEntry) return `no entry: ${s.noEntry}`;
    const parts = [];
    if (s.enteredAt) parts.push(`entered ${hhmm(s.enteredAt)}`);
    if (s.strikes) parts.push(s.strikes);
    if (s.reason) parts.push(endedText(s));
    return parts.join(' · ') || '—';
}

/** "10:15 on 1 day (never-traded leg (OI 0, volume 0))" — the entry times that did not enter on every day. */
export function noEntryLines(noEntry) {
    return Object.entries(noEntry || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([entry, why]) => {
        const days = Object.values(why).reduce((a, n) => a + n, 0);
        return `${entry} on ${days} day${days === 1 ? '' : 's'} (${Object.entries(why).map(([w, n]) => (n === days ? w : `${w}: ${n}`)).join('; ')})`;
    });
}

/** What the replays ran on: "11 of 19 days on the quote tape (entries at the second live enters, every tick); 8 on the archive's minute quotes." */
export function daysPricesLine(p) {
    if (!p) return null;
    const n = (p.tape || 0) + (p.minutes || 0);
    if (!n) return null;
    if (!p.tape) return `All ${n} days on the archive's minute quotes (the quote tape starts ${p.tapeFrom}).`;
    return `${p.tape} of ${n} days on the quote tape (entries at the second live enters, every tick)${p.minutes ? `; ${p.minutes} on the archive's minute quotes` : ''}.`;
}

/**
 * The builder link for one pair: the deployment opened for editing with this entry and exit time, backtested
 * next to its own settings over the days the replay covered (MultiLeg.jsx openEditFromLink; parseTry).
 */
export function timingTryLink(deploymentId, res, cell, label) {
    const cur = res?.picks?.current || null;
    const days = (res?.perTrade || []).map((t) => t.day || istDay(t.entryAt)).filter(Boolean).sort();
    const info = {
        kind: 'timing', timing: { entry: cell.entry, exit: cell.exit }, label,
        from: days[0] || null, source: 'archive',
        whatIf: { trades: res.trades, net: cell.net, worst: cell.worst, currentNet: cur ? cur.net : null, currentWorst: cur ? cur.worst : null },
    };
    const q = new URLSearchParams({ tab: 'backtest', edit: String(deploymentId), try: JSON.stringify(info) });
    return `/multi-leg?${q.toString()}`;
}

/** "+₹6,432 better on 9 days, worse on 6, the same on 4" — how the best did against the current, day by day. */
export function betterWorseText(perTrade) {
    const xs = (perTrade || []).filter((t) => t.bestVsCurrent != null);
    const better = xs.filter((t) => t.bestVsCurrent > 0).length, worse = xs.filter((t) => t.bestVsCurrent < 0).length;
    const total = xs.reduce((a, t) => a + t.bestVsCurrent, 0);
    return `${signed(total)} in all: better on ${better}, worse on ${worse} and the same on ${xs.length - better - worse} of ${xs.length} days`;
}
