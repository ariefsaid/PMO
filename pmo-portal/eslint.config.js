import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// ══ Import boundaries ════════════════════════════════════════════════════
// ESLint flat config does NOT merge a rule's options across config objects:
// for any given file, the LAST object that sets `no-restricted-imports`
// REPLACES the earlier options (verify with `eslint --print-config`). Declaring
// one boundary per object therefore silently switched every earlier boundary
// OFF for the files it covered (#1456). Each boundary is a pattern set here, and
// every object below composes the FULL set of pattern sets applicable to the
// files it matches, so no boundary can clobber another. When adding a boundary,
// add it to every object whose files it governs.
//
// Boundaries and their exemptions:
//   posthog-js   every TS file, except src/lib/analytics/client.ts
//   analytics    src/**, except src/lib/analytics/**
//   runtime      src/**, except src/lib/agent/runtime/** and src/lib/agent/*.test.*
//   pages        src/**, except tests (they legitimately render the page under test)
const POSTHOG_SDK = [
  {
    group: ['posthog-js'],
    message: 'Import posthog-js only in src/lib/analytics/client.ts. Use the analytics facade from src/lib/analytics instead.',
  },
];

// Only analytics internals may import client.ts.
const ANALYTICS_CLIENT = [
  {
    group: ['**/analytics/client'],
    message: 'Import from src/lib/analytics/client only inside src/lib/analytics/. Use the public facade from src/lib/analytics instead.',
  },
  {
    group: ['**/analytics/client.ts', '**/analytics/client.js'],
    message: 'Import from src/lib/analytics/client only inside src/lib/analytics/. Use the public facade from src/lib/analytics instead.',
  },
  {
    group: ['@/src/lib/analytics/client', '@/src/lib/analytics/client.ts'],
    message: 'Import from src/lib/analytics/client only inside src/lib/analytics/. Use the public facade from src/lib/analytics instead.',
  },
];

// A2 port isolation (AC-AP-024 / NFR-AP-SEC-003): the concrete adapter may only
// be imported inside src/lib/agent/ (the provider + its tests). Panel, hooks,
// and all other app code must import ONLY from port.ts (the abstract interface)
// or AgentRuntimeContext. Exempt: the runtime directory (provider + adapter) and
// the co-located adapter test files that legitimately test the implementation.
const AGENT_RUNTIME = [
  {
    group: ['**/pmoNativeRuntime', '**/pmoNativeRuntime.ts'],
    message: 'Import only the AgentRuntime port / AgentRuntimeContext. The concrete PmoNativeRuntime adapter may be imported only inside src/lib/agent/ (the provider/tests).',
  },
  {
    group: ['@/src/lib/agent/runtime/pmoNativeRuntime', '@/src/lib/agent/runtime/pmoNativeRuntime.ts'],
    message: 'Import only the AgentRuntime port / AgentRuntimeContext. The concrete PmoNativeRuntime adapter may be imported only inside src/lib/agent/ (the provider/tests).',
  },
];

// pages import boundary (#1456): the dependency graph runs one way,
// pages → components → lib. Shared calculations live under src/lib; pages may
// import them, src must not reach back into pages/.
const PAGES_BOUNDARY = [
  {
    group: ['**/pages/**', '**/pages'],
    message: 'src/ must not import from pages/ — shared code belongs under src/lib (the dependency runs pages → components → lib, #1456).',
  },
];

const restrictImports = (...boundaries) => ['error', { patterns: boundaries.flat() }];

const TEST_FILES = ['src/**/*.test.*', 'src/**/*.spec.*', 'src/**/__tests__/**/*.{ts,tsx}'];

export default tseslint.config(
  { ignores: ['dist', 'dist-consent', 'node_modules', 'coverage', 'playwright-report', 'test-results'] },
  // ── Import boundaries (composed per file class; see the note above) ─────
  // Non-src TS (pages/, e2e/, configs): only the posthog-js boundary applies.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/**'],
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK) },
  },
  // Ordinary src modules: every boundary applies.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics/**', 'src/lib/agent/*.test.*', 'src/lib/agent/runtime/**', ...TEST_FILES],
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, ANALYTICS_CLIENT, AGENT_RUNTIME, PAGES_BOUNDARY) },
  },
  // Analytics internals may import the client, but must obey every other boundary.
  {
    files: ['src/lib/analytics/**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics/client.ts', ...TEST_FILES],
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, AGENT_RUNTIME, PAGES_BOUNDARY) },
  },
  // Agent runtime internals may import the concrete adapter, but must obey every other boundary.
  {
    files: ['src/lib/agent/runtime/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, ANALYTICS_CLIENT, PAGES_BOUNDARY) },
  },
  // src tests: exempt from the pages boundary only (they render page components).
  {
    files: TEST_FILES,
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, ANALYTICS_CLIENT, AGENT_RUNTIME) },
  },
  // …analytics tests keep their analytics exemption too.
  {
    files: ['src/lib/analytics/**/*.test.*', 'src/lib/analytics/**/*.spec.*', 'src/lib/analytics/**/__tests__/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, AGENT_RUNTIME) },
  },
  // …except the real-SDK and dead-click gate tests, which exercise posthog-js itself
  // (consent, deferred load, surveys, person properties, dead clicks). Like the
  // co-located adapter tests above, they get a narrow exemption from the SDK rule
  // ONLY — every other boundary still applies.
  {
    files: ['src/lib/analytics/*.realSdk.test.ts', 'src/lib/analytics/client.deadClickGate.test.ts'],
    rules: { 'no-restricted-imports': restrictImports(AGENT_RUNTIME) },
  },
  // …runtime tests keep their runtime exemption too.
  {
    files: ['src/lib/agent/runtime/**/*.test.*', 'src/lib/agent/runtime/**/*.spec.*', 'src/lib/agent/runtime/**/__tests__/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, ANALYTICS_CLIENT) },
  },
  // …co-located adapter tests in src/lib/agent/ are exempt from the runtime boundary.
  {
    files: ['src/lib/agent/*.test.*', 'src/lib/agent/*.spec.*'],
    rules: { 'no-restricted-imports': restrictImports(POSTHOG_SDK, ANALYTICS_CLIENT) },
  },
  // client.ts is the single posthog-js entry point, so it is exempt from that
  // boundary (and, being an analytics internal, from the analytics one), but it
  // still must not reach into pages/ or the concrete agent adapter. Keep this
  // last: it must win over the analytics objects above.
  {
    files: ['src/lib/analytics/client.ts'],
    rules: { 'no-restricted-imports': restrictImports(AGENT_RUNTIME, PAGES_BOUNDARY) },
  },
  // ── locale drift guard (#477): display formatting lives ONLY in src/lib/format.ts ──
  // toLocaleString / toLocaleDateString / new Intl.* hardcode or imply a locale and bypass the
  // single formatting seam (#468). Exempt: format.ts itself (the seam), the export path (typed
  // cells, DD-I18N-4 — a formatted string in a spreadsheet cell corrupts data), and tests.
  // src/lib/locale/timezones.ts carries a line-scoped disable: it constructs a DateTimeFormat only
  // to VALIDATE an IANA zone id, never to format.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/lib/format.ts',
      'src/lib/export/**',
      'e2e/**',
      '**/__tests__/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^toLocale(String|DateString|TimeString)$/]',
          message:
            'Locale-sensitive display formatting bypasses src/lib/format.ts (single formatting seam, #468/#477). Import a formatter from src/lib/format instead.',
        },
        {
          selector: "NewExpression[callee.object.name='Intl']",
          message:
            'Construct Intl formatters only in src/lib/format.ts (single formatting seam, #468/#477). Import a formatter from src/lib/format instead.',
        },
      ],
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
