/** Pure wording for DeploymentStructurePanel (kept out of the component file for Fast Refresh). */

/** "Open since 22 Oct 11:00 IST (entered at index 24,105); index now 24,180" or "If it entered now …". */
export function sourceLine(d, istDateTime) {
    const lotsTxt = `${d.lots} lot${d.lots === 1 ? '' : 's'} × ${d.lotSize}`;
    const head = `${d.structureName || d.template} on ${String(d.symbol || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')} · ${lotsTxt} · ${d.tradeMode || ''}`.trim();
    if (d.source === 'open') {
        const since = d.entryAt ? ` since ${istDateTime(d.entryAt)}` : '';
        const at = d.entrySpot != null ? ` (entered at index ${Number(d.entrySpot).toLocaleString('en-IN')})` : '';
        return `${head} — OPEN${since}${at}; index now ${Number(d.spot).toLocaleString('en-IN')}.`;
    }
    return `${head} — not open. If it entered now, at index ${Number(d.spot).toLocaleString('en-IN')}, these are its legs.`;
}

/**
 * Where a stop or target line would fire TODAY: the index levels where the today curve
 * reaches it, below and above the spot — or that no move today reaches it.
 */
export function levelWhere(l, fmt = (v) => String(v)) {
    const parts = [];
    if (l.todayBelow != null) parts.push(`index ≤ ${fmt(l.todayBelow)}`);
    if (l.todayAbove != null) parts.push(`index ≥ ${fmt(l.todayAbove)}`);
    if (parts.length) return `today it fires at ${parts.join(' or ')}`;
    return l.kind === 'target'
        ? 'no index move reaches it today — it is reached as the premium decays with time'
        : 'no index move within the chart reaches it today';
}
