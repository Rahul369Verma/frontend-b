/**
 * Every third-party module this app imports must be DECLARED and INSTALLED.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 * `Failed to resolve import "lightweight-charts"` broke the app in a container,
 * and the render suite reported 21/21 passing — because that suite MOCKS the
 * module (`vi.mock('lightweight-charts', factory)`). A mock factory replaces the
 * module wholesale: vitest never resolves the real one, so a mocked import
 * passes identically whether the package is installed, missing, or has never
 * existed. Proven by deleting the package and re-running: 21/21 still passed.
 *
 * Mocking is right for that suite — a canvas charting library cannot render in
 * jsdom. But it means the render tests are structurally blind to dependency
 * problems, and something else has to look. This is that something.
 *
 * NO MOCKS IN THIS FILE, deliberately. It reads the source and the filesystem.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `import.meta.url` rather than __dirname: this file is linted with the app's
// BROWSER config, where Node globals are undefined. Same reason setup.js uses
// globalThis instead of `global`.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SRC = path.join(ROOT, 'src');

/** Every .js/.jsx under src/, excluding this test's own directory. */
function sourceFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sourceFiles(p, out);
        else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) out.push(p);
    }
    return out;
}

/**
 * Bare specifiers only — a relative or absolute path is not a package.
 * `@scope/name/sub` → `@scope/name`; `name/sub` → `name`.
 */
function packagesIn(code) {
    const found = new Set();
    const add = (spec) => {
        if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('virtual:')) return;
        if (spec.startsWith('node:') || spec.startsWith('data:') || spec.startsWith('http')) return;
        const parts = spec.split('/');
        found.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    };
    // static imports / re-exports, and dynamic import()
    for (const m of code.matchAll(/(?:^|\n)\s*import\s[^'"]*?['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of code.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of code.matchAll(/(?:^|\n)\s*export\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1]);
    return found;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
]);

const imported = new Map();   // package -> [files]
for (const f of sourceFiles(SRC)) {
    for (const p of packagesIn(fs.readFileSync(f, 'utf8'))) {
        if (!imported.has(p)) imported.set(p, []);
        imported.get(p).push(path.relative(ROOT, f));
    }
}

describe('third-party imports are declared and installed', () => {
    it('found imports to check (the scanner itself works)', () => {
        // Guard against a silently-empty scan reporting a clean pass.
        expect(imported.size).toBeGreaterThan(3);
        expect([...imported.keys()]).toContain('react');
    });

    for (const [name, files] of [...imported].sort()) {
        it(`${name} is declared in package.json`, () => {
            expect(declared.has(name), `"${name}" is imported by ${files[0]} but is in neither dependencies nor devDependencies. Run: npm install ${name}`).toBe(true);
        });

        it(`${name} is actually installed`, () => {
            // Resolve from disk rather than importing it: importing would be
            // intercepted by any vi.mock elsewhere, which is precisely the
            // blindness this file exists to remove.
            const dir = path.join(ROOT, 'node_modules', name);
            expect(
                fs.existsSync(path.join(dir, 'package.json')),
                `"${name}" is declared but NOT present in node_modules (imported by ${files[0]}). `
                + 'On a fresh checkout or inside a container built before it was added, the app fails at import time with '
                + '"Failed to resolve import". Run: npm install',
            ).toBe(true);
        });
    }
});
