/**
 * Accessibility regressions that were real bugs, not lint theatre.
 *
 * Each of these was a control a keyboard user could not operate at all. They are
 * pinned here because the failure is invisible: the mouse path keeps working, so
 * nothing looks broken while the control is unusable for anyone who cannot use one.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

describe('interactive controls are keyboard-operable', () => {
    it('Optimizer toggles are real switches, not clickable divs', () => {
        const s = read('pages/Optimizer.jsx');
        // Two settings switches. As <div onClick> they took no focus and were
        // never announced as on/off.
        // Count ATTRIBUTES, not prose: the surrounding comments mention
        // role="switch" too, and matching those made this assert 4 instead of 2.
        expect((s.match(/^\s*role="switch"$/gm) || []).length).toBe(2);
        expect((s.match(/^\s*aria-checked=/gm) || []).length).toBe(2);
        // named by their visible text, not a duplicated string
        expect((s.match(/aria-labelledby=/g) || []).length).toBe(2);
        expect(s).not.toMatch(/rounded-full p-1 cursor-pointer[^>]*\n\s*onClick/);
    });

    it('the deployment-id copy affordance is a button', () => {
        const s = read('components/DeploymentsPanel.jsx');
        expect(s).toMatch(/aria-label=\{`Copy deployment ID/);
    });

    it('the DataManager dropdown trigger is a button with expanded state', () => {
        const s = read('components/DataManager.jsx');
        expect(s).toMatch(/aria-haspopup="listbox"/);
        expect(s).toMatch(/aria-expanded=\{isOpen\}/);
    });

    it('a leg row is operable by Enter and Space', () => {
        const s = read('components/multileg/StrategyBuilder.jsx');
        expect(s).toMatch(/role="button"[\s\S]{0,200}onKeyDown/);
        expect(s).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
    });
});

describe('theming', () => {
    it('no component paints semantic state with a frozen palette step', () => {
        // text-red-400 etc. ignore all twelve themes and every contrast axis.
        const bad = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.jsx$/.test(e.name) && !/\.test\./.test(e.name)) {
                    const m = fs.readFileSync(p, 'utf8').match(/\btext-(red|rose|green|emerald|amber|yellow|orange)-\d{2,3}/g);
                    if (m) bad.push(`${path.relative(SRC, p)}: ${[...new Set(m)].join(', ')}`);
                }
            }
        };
        walk(SRC);
        expect(bad, `hardcoded semantic text colours:\n${bad.join('\n')}`).toEqual([]);
    });

    it('only tokens the stylesheet actually defines are used', () => {
        // `text-positive` / `text-negative` were used in 4 files and defined
        // NOWHERE — they rendered as no colour at all. The real roles are
        // success / danger / warning / info.
        const bad = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.jsx$/.test(e.name) && !/\.test\./.test(e.name)) {
                    if (/\b(text|bg|border)-(positive|negative)\b/.test(fs.readFileSync(p, 'utf8'))) bad.push(path.relative(SRC, p));
                }
            }
        };
        walk(SRC);
        expect(bad, `undefined colour tokens in:\n${bad.join('\n')}`).toEqual([]);
    });
});

describe('no blocking dialogs', () => {
    it('nothing calls native alert() — it freezes the page and ignores every theme', () => {
        const bad = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.jsx$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'Toast.jsx') {
                    const src = fs.readFileSync(p, 'utf8');
                    for (const [i, line] of src.split('\n').entries()) {
                        if (/(?<![.\w])alert\s*\(/.test(line) && !line.trim().startsWith('//') && !line.includes('*')) {
                            bad.push(`${path.relative(SRC, p)}:${i + 1}`);
                        }
                    }
                }
            }
        };
        walk(SRC);
        expect(bad, `native alert() at:\n${bad.join('\n')}`).toEqual([]);
    });
});
