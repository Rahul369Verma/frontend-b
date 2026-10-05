/**
 * Query suggestions: what is offered while typing, and what inserting one does
 * — in the pure helper and through the real textarea's keyboard.
 */
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { suggest, tokenAt, applySuggestion } from './querySuggest.js';
import QueryInput from './QueryInput.jsx';

const FIELDS = [
    { name: 'pe', type: 'number', unit: '×', description: 'Price to earnings', group: 'Valuation (PE)' },
    { name: 'pe_change_5d_pct', type: 'number', unit: '%', description: 'PE change over 5 sessions', group: 'Valuation (PE)' },
    { name: 'pb', type: 'number', unit: '×', description: 'Price to book', group: 'Book value (PB)' },
    { name: 'debt_equity', type: 'number', unit: '×', description: 'Borrowings ÷ equity', group: 'Results & balance sheet (filings)' },
    { name: 'net_debt_cr', type: 'number', unit: '₹ cr', description: 'Borrowings minus liquid assets', group: 'Results & balance sheet (filings)' },
    { name: 'cagr_3y_pct', type: 'number', unit: '%', description: 'Annualised price return over 3 years', group: 'Long-term returns (stored history)' },
    { name: 'market_cap_cr', type: 'number', unit: '₹ cr', description: 'Market capitalisation', group: 'Size & foreign-holding limits' },
    { name: 'industry', type: 'string', unit: null, description: 'NSE industry', group: 'Identity' },
];
const labels = (s) => (s ? s.items.map(i => i.label) : []);

describe('suggest', () => {
    it('completes field names by prefix, shortest first', () => {
        expect(labels(suggest('pe', 2, FIELDS))[0]).toBe('pe_change_5d_pct');   // "pe" itself is complete
        expect(labels(suggest('p', 1, FIELDS))).toEqual(expect.arrayContaining(['pe', 'pb', 'pe_change_5d_pct']));
    });
    it('finds a field by any word of its name, and by the words other screeners use', () => {
        expect(labels(suggest('debt', 4, FIELDS))).toEqual(['debt_equity', 'net_debt_cr']);
        expect(labels(suggest('return', 6, FIELDS))[0]).toBe('cagr_3y_pct');
        expect(labels(suggest('mcap', 4, FIELDS))).toContain('market_cap_cr');
    });
    it('offers keywords and functions, not inside quoted text or mid-word', () => {
        expect(labels(suggest('pe < 20 an', 10, FIELDS))).toContain('AND');
        expect(labels(suggest('ab', 2, FIELDS))).toContain('abs()');
        expect(suggest("industry CONTAINS 'ba", 21, FIELDS)).toBe(null);
        expect(tokenAt('pe_change', 2)).toBe(null);
    });
    it('inserting replaces the typed word and leaves the caret after it', () => {
        const s = suggest('pb < 2 AND deb', 14, FIELDS);
        const r = applySuggestion('pb < 2 AND deb', s, s.items[0]);
        expect(r).toEqual({ text: 'pb < 2 AND debt_equity ', caret: 23 });
    });
});

describe('QueryInput', () => {
    function Harness() {
        const [q, setQ] = useState('');
        return <><QueryInput value={q} onChange={setQ} fields={FIELDS} /><output data-testid="q">{q}</output></>;
    }
    const type = (ta, text) => {
        fireEvent.change(ta, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
    };
    it('shows suggestions while typing; arrows move, Enter inserts, Escape closes', () => {
        render(<Harness />);
        const ta = screen.getByRole('textbox', { name: 'Screener query' });
        act(() => ta.focus());
        type(ta, 'debt_equity < 1 AND cag');
        expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([expect.stringContaining('cagr_3y_pct')]);
        fireEvent.keyDown(ta, { key: 'Enter' });
        expect(screen.getByTestId('q').textContent).toBe('debt_equity < 1 AND cagr_3y_pct ');
        type(ta, 'de');
        expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
        const first = screen.getAllByRole('option')[0];
        expect(first.getAttribute('aria-selected')).toBe('true');
        fireEvent.keyDown(ta, { key: 'ArrowDown' });
        expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('false');
        fireEvent.keyDown(ta, { key: 'Escape' });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
    it('passes other keys through (Ctrl+Enter runs the scan)', () => {
        let ran = 0;
        render(<QueryInput value="pe" onChange={() => {}} fields={FIELDS} onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') ran++; }} />);
        const ta = screen.getByRole('textbox', { name: 'Screener query' });
        fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
        expect(ran).toBe(1);
    });
});
