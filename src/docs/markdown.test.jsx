/**
 * The docs' Markdown subset. The case that matters: a construct directly under
 * another with no blank line between (a heading on its table, a sentence on its
 * list) must render BOTH — the first parser kept only the heading and silently
 * dropped the table under it.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { parseBlocks, renderMarkdown, plainText } from './markdown.jsx';
import { DOC_PAGES } from './index.js';

const html = (md) => renderToStaticMarkup(<MemoryRouter>{renderMarkdown(md, { page: 'x' })}</MemoryRouter>);

describe('parseBlocks', () => {
    it('splits where the construct changes, not only at blank lines', () => {
        const md = '## Columns\n| A | B |\n|---|---|\n| 1 | 2 |\nAfter the table.\n- one\n- two\n> **Note:** careful';
        expect(parseBlocks(md).map(b => b.kind)).toEqual(['h3', 'table', 'p', 'ul', 'quote']);
    });

    it('joins consecutive paragraph lines and keeps a table row count', () => {
        const blocks = parseBlocks('line one\nline two\n\n| H |\n|---|\n| r1 |\n| r2 |');
        expect(blocks[0]).toEqual({ kind: 'p', lines: ['line one', 'line two'] });
        expect(blocks[1].kind).toBe('table');
        expect(blocks[1].lines).toHaveLength(4);
    });

    it('a | line without a separator under it is just text', () => {
        expect(parseBlocks('| not a table').map(b => b.kind)).toEqual(['p']);
    });
});

describe('renderMarkdown', () => {
    it('renders the heading AND the table under it', () => {
        const out = html('## The columns\n| Column | Meaning |\n|---|---|\n| **Day** | The day |');
        expect(out).toContain('<h4');
        expect(out).toContain('<table');
        expect(out).toContain('<strong class="font-semibold text-fg-2">Day</strong>');
    });

    it('renders a list that follows a sentence as a list', () => {
        const out = html('It depends on the mode:\n- **Shadow:** nothing blocked\n- **Enforce:** really skipped');
        expect(out).toMatch(/<p[^>]*>It depends on the mode:<\/p><ul/);
        expect((out.match(/<li>/g) || []).length).toBe(2);
    });

    it('supports *italic* without eating bold or lone asterisks', () => {
        const out = html('your trades *are* the **without** book; 2 * 3 stays');
        expect(out).toContain('<em>are</em>');
        expect(out).toContain('<strong class="font-semibold text-fg-2">without</strong>');
        expect(out).toContain('2 * 3 stays');
    });

    it('plainText drops the markup', () => {
        expect(plainText('a *b* **c** `d` [e](f#g)')).toBe('a b c d e');
    });
});

describe('every doc section renders without losing text', () => {
    it('each non-blank source line shows up in the rendered text', () => {
        const lost = [];
        for (const p of DOC_PAGES) {
            for (const s of p.sections) {
                const out = squash(html(s.md).replace(/<[^>]+>/g, ''));
                for (const line of s.md.split('\n')) {
                    if (!line.trim() || isTableSepLine(line)) continue;
                    // the line's opening words, markup stripped, must appear in the rendered text
                    const sig = squash(plainText(line).split(' ').slice(0, 6).join(' '));
                    if (sig && !out.includes(sig)) lost.push(`${p.id}#${s.id}: ${line.slice(0, 60)}`);
                }
            }
        }
        expect(lost).toEqual([]);
    });
});

function isTableSepLine(l) { return /^\|?\s*:?-{2,}/.test(l); }
/** Letters and digits only — entity- and whitespace-proof comparison. */
function squash(t) {
    return String(t).replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
