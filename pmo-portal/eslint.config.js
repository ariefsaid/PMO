import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report', 'test-results'] },
  // ── posthog-js import boundary: only client.ts may import the SDK ──────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics/client.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['posthog-js'],
          message: 'Import posthog-js only in src/lib/analytics/client.ts. Use the analytics facade from src/lib/analytics instead.',
        }],
      }],
    },
  },
  // ── analytics/client import boundary: only analytics internals may import client.ts ──
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/analytics/client'],
          message: 'Import from src/lib/analytics/client only inside src/lib/analytics/. Use the public facade from src/lib/analytics instead.',
        }],
      }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
