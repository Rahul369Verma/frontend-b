import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react, 'jsx-a11y': jsxA11y },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ── ACCESSIBILITY ───────────────────────────────────────────────────
      // A hand-rolled regex audit of this app produced hundreds of false
      // positives (it read `{busy ? 'Saving…' : 'Save'}` as a nameless button).
      // jsx-a11y understands JSX, so it is the honest inventory. Set to `warn`
      // rather than `error` deliberately: turning ~100 findings into build
      // failures on day one gets the rule set deleted, not the issues fixed.
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/aria-props': 'error',            // a misspelt aria-* does nothing at all
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/label-has-associated-control': ['warn', { assert: 'either' }],
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/tabindex-no-positive': 'error',  // positive tabindex breaks tab order app-wide

      // JSX identifiers were invisible to no-unused-vars and no-undef (there was
      // no react plugin), so renaming a destructured `icon: Icon` param to
      // `_Icon` silenced a warning and shipped `ReferenceError: Icon is not
      // defined` on two pages. With these two rules a JSX tag counts as a use,
      // and an undeclared JSX tag is an error — the crash becomes a lint failure.
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      // `_`-prefixed means "deliberately unused". The config previously set only
      // varsIgnorePattern, so an unused FUNCTION PARAMETER or CAUGHT ERROR could
      // not be marked intentional at all — the convention existed but the linter
      // did not honour it, which is why `catch (_) {}` still reported.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
])
