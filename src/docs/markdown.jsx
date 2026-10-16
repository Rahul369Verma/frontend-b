/**
 * A deliberately tiny Markdown subset for the in-app docs.
 *
 * Why not a library: the dev frontend's node_modules live in a container volume
 * (a host `npm install` never reaches it), and the docs need only a handful of
 * constructs. This builds React elements directly — no HTML strings, no
 * dangerouslySetInnerHTML — so doc text can never inject markup.
 *
 * Parsed line by line — a construct ends at a blank line OR where the next line
 * starts a different construct, so a heading may sit directly on its table:
 *   ## Heading / ### Smaller heading
 *   - bullet          1. numbered
 *   > **Tip:** callout  (Tip / Note / Warning / Example pick the colour)
 *   | table | rows |    (second line `|---|---|` is the header separator)
 *   anything else      a paragraph (consecutive lines join)
 * Inline: **bold**, *italic*, `code`, [text](target).
 * Link targets: `#section` (this doc page) · `page#section` / `page` (another doc
 * page) · `/route` (a page of the app) · `https://…` (external, new tab).
 */
import React from 'react';
import { Link } from 'react-router-dom';

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** Where a doc link points: { href, external, app } */
export function resolveTarget(target, currentPage) {
    const t = String(target || '');
    if (/^https?:\/\//.test(t)) return { href: t, external: true };
    if (t.startsWith('/')) return { href: t, app: true };
    if (t.startsWith('#')) return { href: `/docs/${currentPage}${t}` };
    const [page, section] = t.split('#');
    return { href: `/docs/${page}${section ? `#${section}` : ''}` };
}

function renderInline(text, ctx, keyBase) {
    const out = [];
    let last = 0;
    let i = 0;
    String(text).replace(INLINE, (m, _g, offset) => {
        if (offset > last) out.push(text.slice(last, offset));
        const key = `${keyBase}-${i++}`;
        if (m.startsWith('**')) out.push(<strong key={key} className="font-semibold text-fg-2">{m.slice(2, -2)}</strong>);
        else if (m.startsWith('*')) out.push(<em key={key}>{m.slice(1, -1)}</em>);
        else if (m.startsWith('`')) out.push(<code key={key} className="px-1 py-0.5 rounded bg-card-2 text-fg-2 text-[0.92em]">{m.slice(1, -1)}</code>);
        else {
            const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(m);
            const { href, external, app } = resolveTarget(mm[2], ctx.page);
            const cls = 'text-primary-ink underline underline-offset-2 hover:opacity-80';
            // A link to another part of the docs carries its "page#section" so the
            // docs page can show a hover preview of where it goes.
            const docTarget = external || app ? undefined : (mm[2].startsWith('#') ? `${ctx.page}${mm[2]}` : mm[2]);
            out.push(external
                ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={cls}>{mm[1]}</a>
                : <Link key={key} to={href} className={cls} data-doc-target={docTarget}>{mm[1]}</Link>);
        }
        last = offset + m.length;
        return m;
    });
    if (last < text.length) out.push(text.slice(last));
    return out;
}

const CALLOUT = {
    tip: 'border-success/40 bg-success/5',
    note: 'border-info/40 bg-info/5',
    warning: 'border-warning/50 bg-warning/5',
    example: 'border-line-2 bg-card-2/40',
};

function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

const isTableSep = (l) => /^\|?\s*:?-{2,}/.test(l || '');

/** One line's construct: the kind it starts, or 'p' for paragraph text. */
function lineKind(line, next) {
    if (!line.trim()) return 'blank';
    if (/^###\s/.test(line)) return 'h4';
    if (/^##\s/.test(line)) return 'h3';
    if (/^\s*-\s/.test(line)) return 'ul';
    if (/^\s*\d+\.\s/.test(line)) return 'ol';
    if (/^>/.test(line)) return 'quote';
    if (/^\|/.test(line) && isTableSep(next)) return 'table';
    return 'p';
}

/** Lines → [{ kind, lines }]. Headings are one line; everything else runs until the kind changes. */
export function parseBlocks(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const kind = lineKind(lines[i], lines[i + 1]);
        if (kind === 'blank') { i++; continue; }
        if (kind === 'h3' || kind === 'h4') { blocks.push({ kind, lines: [lines[i]] }); i++; continue; }
        if (kind === 'table') {
            const rows = [lines[i], lines[i + 1]];
            i += 2;
            while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
            blocks.push({ kind, lines: rows });
            continue;
        }
        const run = [lines[i++]];
        while (i < lines.length && lineKind(lines[i], lines[i + 1]) === kind) run.push(lines[i++]);
        blocks.push({ kind, lines: run });
    }
    return blocks;
}

/** Markdown subset → array of React elements. */
export function renderMarkdown(md, ctx = {}) {
    return parseBlocks(md).map(({ kind, lines }, bi) => {
        const key = `b${bi}`;
        const first = lines[0];
        // Both heading sizes are <h4>: the docs page puts the page title in an <h2>
        // and each section in an <h3>, and no section mixes ## with ###, so h4 is
        // the next level either way and the outline never skips one.
        if (kind === 'h3') {
            return <h4 key={key} className="text-sm font-semibold text-fg mt-5 mb-1">{renderInline(first.replace(/^##\s+/, ''), ctx, key)}</h4>;
        }
        if (kind === 'h4') {
            return <h4 key={key} className="text-xs font-semibold uppercase tracking-wide text-fg-3 mt-4 mb-1">{renderInline(first.replace(/^###\s+/, ''), ctx, key)}</h4>;
        }
        if (kind === 'ul') {
            return (
                <ul key={key} className="list-disc pl-5 space-y-1 my-2">
                    {lines.map((l, i) => <li key={i}>{renderInline(l.replace(/^\s*-\s+/, ''), ctx, `${key}-${i}`)}</li>)}
                </ul>
            );
        }
        if (kind === 'ol') {
            return (
                <ol key={key} className="list-decimal pl-5 space-y-1 my-2">
                    {lines.map((l, i) => <li key={i}>{renderInline(l.replace(/^\s*\d+\.\s+/, ''), ctx, `${key}-${i}`)}</li>)}
                </ol>
            );
        }
        if (kind === 'quote') {
            const text = lines.map(l => l.replace(/^>\s?/, '')).join(' ');
            const callout = (/^\*\*(Tip|Note|Warning|Example):\*\*/i.exec(text) || [])[1];
            return (
                <div key={key} className={`border-l-4 rounded-r px-3 py-2 my-3 ${CALLOUT[(callout || 'note').toLowerCase()]}`}>
                    {renderInline(text, ctx, key)}
                </div>
            );
        }
        if (kind === 'table') {
            const head = splitRow(first);
            const rows = lines.slice(2).map(splitRow);
            return (
                <div key={key} className="overflow-x-auto my-3">
                    <table className="w-full text-xs border border-line/60">
                        <thead><tr className="bg-card-2/60 text-left">{head.map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold text-fg-2 border-b border-line/60">{renderInline(h, ctx, `${key}-h${i}`)}</th>)}</tr></thead>
                        <tbody>{rows.map((r, ri) => (
                            <tr key={ri} className="border-t border-line/40 align-top">
                                {r.map((c, ci) => <td key={ci} className="px-2 py-1.5">{renderInline(c, ctx, `${key}-${ri}-${ci}`)}</td>)}
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            );
        }
        return <p key={key} className="my-2 leading-relaxed">{renderInline(lines.join(' '), ctx, key)}</p>;
    });
}

/** Markdown subset → plain text (for search). */
export function plainText(md) {
    return String(md || '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\s][^*]*)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^[#>|\-\d.\s]+/gm, ' ')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Every link target used in a markdown string (for the link-integrity test). */
export function linkTargets(md) {
    const out = [];
    String(md || '').replace(/\[[^\]]+\]\(([^)\s]+)\)/g, (_m, t) => { out.push(t); return _m; });
    return out;
}
