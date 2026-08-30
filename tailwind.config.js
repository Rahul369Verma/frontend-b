/**
 * Tailwind v4 takes its theme from CSS, not from this file.
 *
 * This project loads Tailwind through @tailwindcss/postcss with a bare
 * `@import "tailwindcss"` and no `@config` directive, so v4 never reads a JS config
 * at all — verified against the build output, where `--font-sans` was Tailwind's
 * stock stack rather than the `Source Sans Pro` declared here. The `theme.extend`
 * block was therefore already dead code, and worse: it duplicated the colour tokens,
 * so anyone editing it would expect a retheme and get nothing (or, if an `@config`
 * were ever added, it would shadow the real tokens).
 *
 * Sources of truth:
 *   - src/index.css   — the `@theme` block: every semantic token + its dark default
 *   - src/theme/      — themes.js (theme data), prefs.js (axes), cssVars.js (emitter)
 *
 * Kept as a file (rather than deleted) because postcss/editor tooling and IDE
 * IntelliSense still probe for it, and `content` documents what gets scanned.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
