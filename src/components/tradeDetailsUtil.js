/** Pure helpers for TradeDetailsModal (kept out of the component file for Fast Refresh). */

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };

export const pctOf = (v, dp = 1) => (n(v) == null ? '—' : `${(n(v) * 100).toFixed(dp)}%`);

/** Tone for the gate verdict chip. */
export function gateTone(gate) {
    if (!gate || !gate.decision) return 'muted';
    if (gate.source === 'reconstructed') return gate.decision === 'BLOCK_OR_PROBE' ? 'warning' : 'muted';
    switch (gate.decision) {
        case 'ALLOW': return 'good';
        case 'BLOCK': return 'critical';
        case 'PROBE': return 'info';
        default: return 'muted';
    }
}

/** "9.3 pts below the 40% floor" — the percentage behind the decision. */
export function marginText(gate) {
    if (!gate || gate.marginPts == null) return null;
    const m = gate.marginPts;
    const floor = pctOf(gate.floor, 0);
    if (Math.abs(m) < 0.05) return `exactly at the ${floor} floor`;
    return `${Math.abs(m).toFixed(1)} pts ${m > 0 ? 'above' : 'below'} the ${floor} floor`;
}

/** Did the outcome agree with the gate? Only meaningful for CLOSED trades. */
export function verdictVsOutcome(gate, trade) {
    if (!gate || !trade || trade.status !== 'CLOSED') return null;
    const net = n(trade.net_pnl) ?? n(trade.pnl);
    if (net == null) return null;
    const weak = gate.decision === 'BLOCK' || gate.decision === 'BLOCK_OR_PROBE' || gate.decision === 'PROBE';
    const ok = gate.decision === 'ALLOW' || gate.decision === 'THIN';
    if (weak) return net <= 0 ? 'Weak-side trade that lost — the gate read it right.' : 'Weak-side trade that WON — blocking it would have cost money.';
    if (ok) return net > 0 ? 'Accepted and won.' : 'Accepted and lost — the gate did not see this one coming.';
    return null;
}

/** Flatten a document into [{key, value}] rows for the "all fields" table. */
export function flatten(obj, prefix = '', out = [], depth = 0) {
    if (obj == null || typeof obj !== 'object' || depth > 4) { out.push({ key: prefix || '(value)', value: fmtVal(obj) }); return out; }
    if (Array.isArray(obj)) {
        if (!obj.length) out.push({ key: prefix, value: '[]' });
        obj.slice(0, 50).forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1));
        if (obj.length > 50) out.push({ key: `${prefix}[…]`, value: `${obj.length - 50} more` });
        return out;
    }
    const keys = Object.keys(obj);
    if (!keys.length) out.push({ key: prefix, value: '{}' });
    for (const k of keys) {
        const v = obj[k];
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !(v instanceof Date)) flatten(v, key, out, depth + 1);
        else out.push({ key, value: fmtVal(v) });
    }
    return out;
}

function fmtVal(v) {
    if (v === null) return 'null';
    if (v === undefined) return '—';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
    return String(v);
}

export function holdText(entry, exit) {
    const a = entry ? new Date(entry).getTime() : NaN, b = exit ? new Date(exit).getTime() : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
    const m = Math.round((b - a) / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
