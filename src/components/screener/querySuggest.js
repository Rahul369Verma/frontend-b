/**
 * Suggestions while typing a screener query: catalog fields, the query
 * language's keywords and functions (backend src/domain/screener/query.js).
 * Pure — the textarea component (QueryInput.jsx) only renders and applies.
 */

export const KEYWORDS = ['AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'CONTAINS', 'BETWEEN'];
export const FUNCTIONS = [
    { name: 'abs', hint: 'abs(x) — size of a move either way, e.g. abs(return_z) >= 3' },
    { name: 'min', hint: 'min(a, b)' },
    { name: 'max', hint: 'max(a, b)' },
];

/**
 * Words people bring from other screeners, pointing at our field names. A word
 * matches by prefix, so "debt" finds debt_equity through its own name anyway;
 * these cover the names that do not share a prefix.
 */
const ALIASES = {
    mcap: ['market_cap_cr'], market: ['market_cap_cr'], cap: ['market_cap_cr', 'mcap_rank', 'size_bucket'],
    return: ['cagr_3y_pct', 'cagr_5y_pct', 'change_250d_pct', 'change_60d_pct'], returns: ['cagr_3y_pct', 'cagr_5y_pct', 'change_250d_pct'],
    de: ['debt_equity'], leverage: ['debt_equity', 'net_debt_cr'], borrowings: ['debt_equity', 'net_debt_cr'],
    profit: ['profit_growth_yoy_pct', 'profit_cr_q', 'net_margin_pct'], sales: ['revenue_growth_yoy_pct', 'revenue_cr_q'], revenue: ['revenue_growth_yoy_pct', 'revenue_cr_q'],
    dividend: ['dividend_yield_ttm_pct', 'dividend_ttm_rs', 'next_dividend_rs'], yield: ['dividend_yield_ttm_pct'],
    price: ['close', 'change_pct'], book: ['book_value', 'pb'], earnings: ['eps_ttm', 'eps_change_pct', 'pe'],
    promoter: ['promoter_pct', 'promoter_pct_change', 'promoter_buy_pct_30d'], pledge: ['promoter_pledge_pct'],
    delivery: ['deliv_pct', 'deliv_pct_jump'], volume: ['volume_ratio', 'avg_volume_20d'],
};

/** The identifier being typed just before `caret`, or null (inside a string, or nothing typed). */
export function tokenAt(text, caret) {
    const before = text.slice(0, caret);
    // Inside a quoted literal ('TCS', 'bank'): nothing to suggest.
    if ((before.match(/'/g) || []).length % 2 === 1) return null;
    const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
    if (!m) return null;
    // Only when the caret ends the word: completing the middle of a name would split it.
    if (/^[A-Za-z0-9_]/.test(text.slice(caret))) return null;
    return { word: m[0], from: caret - m[0].length, to: caret };
}

/**
 * @param {string} text
 * @param {number} caret
 * @param {Array<{name, type, unit, description, group}>} fields
 * @returns {{ from, to, items: Array<{ kind: 'field'|'keyword'|'function', label, insert, detail }> } | null}
 */
export function suggest(text, caret, fields, limit = 8) {
    const t = tokenAt(text, caret);
    if (!t) return null;
    const w = t.word.toLowerCase();
    const scored = [];
    const seen = new Set();
    const add = (score, item) => { if (!seen.has(item.label)) { seen.add(item.label); scored.push([score, item]); } };
    const fieldItem = (f) => ({ kind: 'field', label: f.name, insert: `${f.name} `, detail: `${f.type !== 'number' ? `${f.type} · ` : f.unit ? `${f.unit} · ` : ''}${f.description}` });
    for (const f of fields) {
        const n = f.name.toLowerCase();
        if (n === w) continue;   // already complete
        if (n.startsWith(w)) add(0 + n.length / 1000, fieldItem(f));
        else if (w.length >= 2 && n.split('_').some(part => part.startsWith(w))) add(1 + n.length / 1000, fieldItem(f));
        else if (w.length >= 3 && n.includes(w)) add(2 + n.length / 1000, fieldItem(f));
        else if (w.length >= 4 && (f.description || '').toLowerCase().includes(w)) add(4 + n.length / 1000, fieldItem(f));
    }
    const byName = new Map(fields.map(f => [f.name, f]));
    for (const [alias, names] of Object.entries(ALIASES)) {
        if (!(alias === w || (w.length >= 3 && alias.startsWith(w)))) continue;
        names.forEach((n, i) => { const f = byName.get(n); if (f) add(3 + i / 100, fieldItem(f)); });
    }
    if (w.length >= 2) {
        for (const k of KEYWORDS) if (k.toLowerCase().startsWith(w) && k.toLowerCase() !== w) add(0.5, { kind: 'keyword', label: k, insert: `${k} `, detail: 'keyword' });
        for (const fn of FUNCTIONS) if (fn.name.startsWith(w) && fn.name !== w) add(0.5, { kind: 'function', label: `${fn.name}()`, insert: `${fn.name}(`, detail: fn.hint });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
    return { from: t.from, to: t.to, items: scored.slice(0, limit).map(([, it]) => it) };
}

/** Apply a suggestion: the new text and where the caret goes. */
export function applySuggestion(text, s, item) {
    const next = text.slice(0, s.from) + item.insert + text.slice(s.to).replace(/^ +/, item.insert.endsWith(' ') ? '' : '');
    return { text: next, caret: s.from + item.insert.length };
}
