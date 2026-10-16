/**
 * Delta Exchange display helpers — kinds, prices in the contract's own currency
 * (USD for derivatives, ₹ for *_INR spot pairs), fee rates, expiries in IST.
 * P&L stays in rupees everywhere on the platform (Delta India's fixed ₹85/USD).
 */

export const DELTA_USD_INR = 85;

export const KIND_LABEL = {
    perpetual: 'Perpetual',
    future: 'Future',
    spot: 'Spot',
    call: 'Call',
    put: 'Put',
    move: 'Move option',
    irs: 'Rate swap',
};

/** Picker filter groups → the registry kinds they search. */
export const KIND_FILTERS = [
    { v: 'perpetual,future', label: 'Perpetuals' },
    { v: 'call,put', label: 'Options' },
    { v: 'move', label: 'Move' },
    { v: 'spot', label: 'Spot (INR)' },
    { v: '', label: 'All' },
];

export const isDeltaSymbol = (s) => typeof s === 'string' && s.startsWith('DELTA:');

/** A price in the contract's currency: '$83,448.50' or '₹71,02,345.1'. */
export function deltaPrice(v, currency = 'USD') {
    const n = Number(v);
    if (v == null || v === '' || !Number.isFinite(n)) return '—';
    if (currency === 'INR') return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
}

/** 0.0005 → '0.050%'. */
export const feePct = (rate) => (rate == null || !Number.isFinite(Number(rate)) ? '—' : `${(Number(rate) * 100).toFixed(3)}%`);

/** Option expiry instant → 'Wed 14 Oct, 17:30 IST'. */
export function expiryIst(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    return new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
}

/** One line describing a contract for a picker row. */
export function describeInstrument(i) {
    if (!i) return '';
    if (i.kind === 'call' || i.kind === 'put' || i.kind === 'move') {
        return `${i.underlying} ${KIND_LABEL[i.kind]} ${i.strike} · ${expiryIst(i.settlementTime)}`;
    }
    return i.description || i.deltaSymbol;
}

/** ₹ per 1-point move per contract (contract value × fixed ₹85; INR spot = 1). */
export const rupeesPerPoint = (i) => (i ? Number(i.contractValue) * (i.currency === 'INR' ? 1 : DELTA_USD_INR) : null);
