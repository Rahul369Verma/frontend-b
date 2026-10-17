'use strict';
/**
 * Copy an Optimizer result as the portable strategy JSON the Backtester imports
 * (utils/strategyJson.js). The settings are exactly what that result's "Test"
 * button sends to the Backtester, so pasting the JSON there loads the same run.
 */
import { buildStrategyJson, strategyJsonText, copyText } from '../../utils/strategyJson.js';
import { toast } from '../toastStore.js';

const shortSym = (s) => String(s || '').replace(/^(NSE|BSE|MCX):/, '').replace(/-INDEX$/, '');

/** What the result scored, kept in the JSON for reference (never imported as a setting). */
export function resultsFromCell(cell = {}, verdict = null) {
    const r = {
        verdict: verdict || null,
        testPnL: cell.oosPnL ?? null, testWinRate: cell.oosWinRate ?? null, testPF: cell.oosPF ?? null, testTrades: cell.oosTrades ?? null,
        fullPnL: cell.fullPnL ?? null, fullTrades: cell.fullTrades ?? null,
    };
    return Object.values(r).some((v) => v != null) ? r : null;
}

/** From a single-index row: { full|metrics, oos }. */
export function resultsFromRow(row = {}, verdict = null) {
    const f = row.full || row.metrics || {};
    const o = row.oos || {};
    return resultsFromCell({
        oosPnL: o.totalPnL, oosWinRate: o.winRate, oosPF: o.profitFactor, oosTrades: o.totalTrades,
        fullPnL: f.totalPnL, fullTrades: f.totalTrades,
    }, verdict);
}

/** Build + copy; toasts the outcome. Returns the JSON object (also when the copy failed). */
export async function copyStrategyJson(params, { strategy = null, results = null, label = null } = {}) {
    const flat = { ...(params || {}), ...(strategy ? { strategy } : {}) };
    const j = buildStrategyJson(flat, {
        source: 'optimizer',
        label: label || `${flat.strategy || 'strategy'} on ${shortSym(flat.symbol)} — optimizer result`,
        results,
    });
    const ok = await copyText(strategyJsonText(j));
    if (ok) toast.success(`Copied ${flat.strategy || 'strategy'} for ${shortSym(flat.symbol) || 'this index'} — paste it in Backtest → Import JSON`);
    else toast.error('Could not copy to the clipboard in this browser');
    return j;
}
