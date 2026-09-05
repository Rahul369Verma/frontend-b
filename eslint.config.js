import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
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
