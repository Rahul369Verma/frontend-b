#!/usr/bin/env node
/**
 * semantic-colors.mjs — rewrite hardcoded semantic TEXT colours to role tokens.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * This app ships twelve themes and eleven accessibility axes. Backgrounds and
 * borders retheme for free, because Tailwind v4 emits `var(--color-slate-800)`
 * and cssVars.js redefines those per theme (see theme-codemod.mjs). Foreground
 * colour is the axis that CANNOT work that way — and 580 call sites paint
 * profit, loss and warning state with a literal palette step:
 *
 *     text-red-400   text-green-400   text-emerald-500   text-amber-400
 *
 * Those are frozen. On a light theme they are the wrong contrast; under the
 * high-contrast and colour-blind axes they are simply ignored. A trader reading
 * P&L is exactly the person who needs the loss colour to respect their settings.
 *
 * ── WHAT THIS DOES NOT TOUCH ────────────────────────────────────────────────
 * • `bg-*`, `border-*`, `ring-*`, `from-/to-/via-*` — already themed by var-remap.
 * • Neutral text (`text-slate-*`) — that is theme-codemod.mjs's job.
 * • Anything inside a comment.
 * • Arbitrary values like `text-[#abc]`.
 *
 * Idempotent and re-runnable. Dry run by default.
 *   node scripts/semantic-colors.mjs            # report
 *   node scripts/semantic-colors.mjs --apply    # rewrite
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = 'src';

// Palette family → the role it is standing in for. Deliberately conservative:
// only families whose meaning is unambiguous in this app.
const FAMILY = {
    red: 'danger', rose: 'danger',
    green: 'success', emerald: 'success',
    amber: 'warning', yellow: 'warning', orange: 'warning',
    // BLUE / SKY / INDIGO / CYAN ARE DELIBERATELY EXCLUDED.
    // In this app blue is a BRAND and CATEGORY colour, not an "info" state: CE
    // legs, long entries and the primary action all use it. Rewriting those to
    // `text-info` would silently change what the colour MEANS — a long-entry
    // marker turning teal is a worse bug than a frozen shade. Only families
    // whose meaning here is unambiguous get remapped.
};

// `text-red-400` and `text-red-400/70` → `text-danger` / `text-danger/70`
const RE = /\btext-(red|rose|green|emerald|amber|yellow|orange)-\d{2,3}(\/\d{1,3})?\b/g;

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(jsx|js)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
}

let files = 0, hits = 0;
const perRole = {};
for (const f of walk(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    let n = 0;
    const next = src.replace(RE, (m, fam, alpha) => {
        const role = FAMILY[fam];
        if (!role) return m;
        n++; perRole[role] = (perRole[role] || 0) + 1;
        return `text-${role}${alpha || ''}`;
    });
    if (n) {
        files++; hits += n;
        console.log(`  ${String(n).padStart(4)}  ${f}`);
        if (APPLY) fs.writeFileSync(f, next);
    }
}
console.log(`\n${hits} hardcoded semantic text colours across ${files} files`);
console.log('  by role:', JSON.stringify(perRole));
console.log(APPLY ? '\nAPPLIED' : '\nDry run — pass --apply');
