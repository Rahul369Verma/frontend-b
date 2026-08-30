#!/usr/bin/env node
/**
 * a11y-labels.mjs — associate <label> elements with the form control they name.
 *
 * THE DEFECT. The app had 231 <label> elements and exactly 3 `htmlFor`
 * attributes, and ZERO of its 176 <input> / 102 <select> controls carried an
 * `id`. Labels sit as siblings of their control (`<label>Lot Size</label>` then
 * `<input>`), which is presentation only: nothing connects the two, so a screen
 * reader announces the control as unlabelled, and clicking the label does not
 * focus the field.
 *
 * WHAT IT PAIRS. A <label> with no htmlFor, whose next ELEMENT sibling (JSX
 * whitespace skipped) is an <input>, <select> or <textarea> with no id. Labels
 * followed by a <div> are read-only value displays, not controls, and are left
 * alone — that distinction is why this is an AST pass and not a regex.
 *
 * WHY IT SKIPS `.map()` BODIES. An id must be unique in the DOM. A label/control
 * pair rendered inside a list callback appears N times, so a static id would
 * point every one of those labels at the FIRST control — worse than no
 * association at all. Those pairs need React's useId() and a component-level
 * change, so they are reported for hand-fixing rather than guessed at.
 *
 * IDS are `<file-slug>-<label-slug>-<n>`: stable across runs (so re-running is a
 * no-op and diffs stay clean), readable in devtools, and file-scoped so two
 * pages can both have a "Symbol" field.
 */
import { readFileSync, writeFileSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { parse } from '@babel/parser';

const DRY = process.argv.includes('--dry-run');
const CONTROLS = new Set(['input', 'select', 'textarea']);
const ROOT = 'src';

const files = [];
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { if (!/node_modules|dist/.test(p)) walk(p); }
        else if (extname(p) === '.jsx') files.push(p);
    }
})(ROOT);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);

/** Static text of a label, for the id slug. Ignores expressions. */
function labelText(node) {
    return node.children
        .filter((c) => c.type === 'JSXText')
        .map((c) => c.value.trim()).join(' ').trim();
}

const name = (el) => (el.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : null);
const hasAttr = (el, a) => el.openingElement.attributes.some(
    (x) => x.type === 'JSXAttribute' && x.name?.name === a);

let totalPaired = 0, totalSkippedMap = 0, totalSkippedNoText = 0;
const report = [];

for (const file of files) {
    const code = readFileSync(file, 'utf8');
    let ast;
    try {
        ast = parse(code, { sourceType: 'unambiguous', plugins: ['jsx'], errorRecovery: false });
    } catch (err) { report.push(`  PARSE FAIL ${file}: ${err.message}`); continue; }

    const fileSlug = slug(basename(file, '.jsx'));
    const edits = [];     // {pos, text}
    let n = 0, skippedMap = 0, skippedNoText = 0;

    // Walk with an ancestor stack so we can tell whether we are inside a .map().
    (function visit(node, inMap) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach((c) => visit(c, inMap)); return; }
        if (!node.type) return;

        let nowInMap = inMap;
        if (node.type === 'CallExpression'
            && node.callee?.type === 'MemberExpression'
            && ['map', 'flatMap', 'forEach'].includes(node.callee.property?.name)) {
            nowInMap = true;
        }

        if (node.type === 'JSXElement' && Array.isArray(node.children)) {
            const kids = node.children.filter((c) => c.type !== 'JSXText' || c.value.trim());
            for (let i = 0; i < kids.length - 1; i++) {
                const a = kids[i], b = kids[i + 1];
                if (a.type !== 'JSXElement' || b.type !== 'JSXElement') continue;
                if (name(a) !== 'label' || hasAttr(a, 'htmlFor')) continue;
                if (!CONTROLS.has(name(b)) || hasAttr(b, 'id')) continue;

                const text = labelText(a);
                if (!text) { skippedNoText++; continue; }
                if (nowInMap) { skippedMap++; continue; }

                const id = `${fileSlug}-${slug(text)}-${++n}`;
                edits.push({ pos: a.openingElement.name.end, text: ` htmlFor="${id}"` });
                edits.push({ pos: b.openingElement.name.end, text: ` id="${id}"` });
            }
        }
        for (const k of Object.keys(node)) {
            if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
            visit(node[k], nowInMap);
        }
    })(ast.program, false);

    if (edits.length) {
        let out = code;
        for (const e of edits.sort((x, y) => y.pos - x.pos)) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
        if (!DRY) writeFileSync(file, out);
    }
    if (n || skippedMap || skippedNoText) {
        report.push(`  ${String(n).padStart(3)} paired  ${skippedMap ? `(${skippedMap} in .map skipped) ` : ''}${skippedNoText ? `(${skippedNoText} no static text) ` : ''} ${file}`);
    }
    totalPaired += n; totalSkippedMap += skippedMap; totalSkippedNoText += skippedNoText;
}

console.log(report.join('\n'));
console.log(`\n${DRY ? '[DRY RUN] ' : ''}TOTAL: ${totalPaired} label/control pairs associated`);
console.log(`  ${totalSkippedMap} skipped inside .map() — need useId(), hand-fix`);
console.log(`  ${totalSkippedNoText} skipped: label has no static text (dynamic {label} prop)`);
