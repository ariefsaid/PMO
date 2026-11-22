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

// ══ Restricted syntax boundaries ════════════════════════════════════════
// Flat config replaces no-restricted-syntax options wholesale per matched object.
// Compose them per file class, mirroring no-restricted-imports above.
const LOCALE_RESTRICTIONS = [
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
];

const ROLE_LITERAL_RESTRICTIONS = [
  {
    selector:
      'BinaryExpression[operator=/^([!=]==?)$/]:matches([left.name=/^(role|realRole|effectiveRole)$/], [right.name=/^(role|realRole|effectiveRole)$/], [left.property.name=/^(role|realRole|effectiveRole)$/], [right.property.name=/^(role|realRole|effectiveRole)$/], [left.value=/^(Admin|Executive|Project Manager|Finance|Engineer)$/], [right.value=/^(Admin|Executive|Project Manager|Finance|Engineer)$/]):matches([left.type="Literal"], [right.type="Literal"])',
    message:
      'Comparing a role to a string literal outside src/auth/ bypasses policy.ts and can() (ADR-0016, #2751). Move into a policy action called through can().',
  },
];

const restrictSyntax = (...boundaries) => ['error', ...boundaries.flat()];

// Pre-round legacy files with role literals (tracked for subsequent cleanup; all new code and round code is enforced).
const LEGACY_ROLE_LITERAL_FILES = [
  'App.tsx',
  'components/ProcurementBoard.tsx',
  'pages/AdminUsers.tsx',
  'pages/Administration.tsx',
  'pages/Approvals.tsx',
  'pages/ExecutiveDashboard.tsx',
  'pages/ImprestFloats.tsx',
  'pages/MaterialRequestSettings.tsx',
  'pages/Procurement.tsx',
  'pages/ProcurementCreate.tsx',
  'pages/ProcurementDetails.tsx',
  'pages/ProjectBudget.tsx',
  'pages/admin/BudgetAccountMap.tsx',
  'pages/crews/CrewList.tsx',
  'pages/finance/FinanceHub.tsx',
  'pages/procurement/blocks/needsYou.ts',
  'pages/procurement/list/ProcurementGroupedView.tsx',
  'pages/procurement/list/ProcurementKpiRow.tsx',
  'pages/project-detail/ProjectFinancesSection.tsx',
  'pages/project-detail/ProjectOdooLink.tsx',
  'pages/project-detail/ProjectSections.tsx',
  'pages/project-detail/budget/BudgetErpNotice.tsx',
  'pages/project-detail/tabs/TasksTab.tsx',
  'pages/projects/useProjectListModel.ts',
  'pages/stock/StockCount.tsx',
  'pages/stock/StockMovementForm.tsx',
  'pages/stock/StockTransferDetail.tsx',
  'pages/stock/StockTransferSend.tsx',
  'pages/stock/StockWorkOrderTransfer.tsx',
  'src/components/budget/BudgetOccupantActions.tsx',
  'src/components/dashboard/PMDashboard.tsx',
  'src/components/dashboard/hub/company/CompanyDashboard.tsx',
  'src/components/dashboard/restructure/useNeedsYou.ts',
  'src/components/m365/DocumentLinkPermissions.tsx',
  'src/components/m365/useRecordFolderAction.tsx',
  'src/components/procurement/ProcurementBlock.tsx',
  'src/components/shell/ApprovalsNavCount.tsx',
  'src/components/shell/PhoneNavBar.tsx',
  'src/components/shell/Rail.tsx',
  'src/components/stock/ProofChaseCard.tsx',
  'src/hooks/useDemoEligibility.ts',
  'src/hooks/useFinancialStatements.ts',
  'src/hooks/useInvoicePdfDownload.ts',
  'src/hooks/useMicrosoftDocuments.ts',
  'src/hooks/useProjectOverviewRead.ts',
  'src/hooks/useProjectPosition.ts',
  'src/lib/adapterSeam/erpnext/connectAdapter.ts',
  'src/lib/adapterSeam/erpnext/contract.harness.ts',
  'src/lib/adapterSeam/odoo/connectAdapter.ts',
  'src/lib/adapterSeam/odoo/contract.harness.ts',
  'src/lib/adapterSeam/odoo/normalise.ts',
  'src/lib/db/timesheetTransition.ts',
  'src/lib/expenses/expenseRules.ts',
  'src/lib/invite/inviteHandler.ts',
  'src/lib/procurement/mainAction.ts',
  'src/lib/revenue/nativeInvoice.ts',
];

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
  // ── Restricted syntax (locale drift #477, role literal comparison #2751) ──
  // 1. Ordinary TS files: both locale and role literal restrictions apply.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/auth/**',
      'src/lib/format.ts',
      'src/lib/export/**',
      'e2e/**',
      '**/__tests__/**',
      '**/*.test.*',
      '**/*.spec.*',
      ...LEGACY_ROLE_LITERAL_FILES,
    ],
    rules: {
      'no-restricted-syntax': restrictSyntax(LOCALE_RESTRICTIONS, ROLE_LITERAL_RESTRICTIONS),
    },
  },
  // 2. Pre-round legacy files and src/auth/**: exempt from role literal comparisons, but obey locale drift.
  {
    files: ['src/auth/**/*.{ts,tsx}', ...LEGACY_ROLE_LITERAL_FILES],
    ignores: [
      'src/lib/format.ts',
      'src/lib/export/**',
      'e2e/**',
      '**/__tests__/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    rules: {
      'no-restricted-syntax': restrictSyntax(LOCALE_RESTRICTIONS),
    },
  },
  // 3. Format and export files: exempt from locale drift, but obey role literal comparisons.
  {
    files: ['src/lib/format.ts', 'src/lib/export/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': restrictSyntax(ROLE_LITERAL_RESTRICTIONS),
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
  // Vendored shadcn/ReUI source (#1980): component + helper co-exports are upstream's layout, so
  // fast-refresh's only-export-components is off here. Everything else stays enforced.
  {
    files: ['src/components/reui/**/*.{ts,tsx}', 'src/components/shadcn/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
