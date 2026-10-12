/** Pure helpers for RegimePanel (kept out of the component file for Fast Refresh). */

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };

export const pct0 = (v) => (n(v) == null ? '—' : `${Math.round(n(v) * 100)}%`);

export function tierTone(read) {
    if (!read || read.unmeasured) return 'muted';
    return read.tier === 'high' ? 'critical' : read.tier === 'low' ? 'good' : 'warning';
}

export function actionTone(action) {
    return action === 'FULL' ? 'good' : action === 'HALF' ? 'warning' : action === 'STAND_ASIDE' ? 'critical' : 'muted';
}

export const ACTION_LABEL = { FULL: 'FULL SIZE', HALF: 'HALF SIZE', STAND_ASIDE: 'STAND ASIDE', UNMEASURED: 'NO READ' };

/** Short name for a symbol (NSE:NIFTY50-INDEX → NIFTY50). */
export const shortSym = (s) => String(s || '').replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '');

/** One-line book warning: short-vol structures open into a wild-leaning read. */
export function bookWarning(book, symbols) {
    const wild = (symbols || []).filter(s => s.read && s.read.tier === 'high').map(s => shortSym(s.symbol));
    const shortVol = Object.values(book || {}).reduce((a, b) => a + (b.shortVol || 0), 0);
    if (!wild.length || !shortVol) return null;
    return `${shortVol} short-volatility structure${shortVol === 1 ? '' : 's'} open while ${wild.join(', ')} read${wild.length === 1 ? 's' : ''} wild-leaning — the indices move together, so this is one bet.`;
}
