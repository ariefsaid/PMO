import path from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// ADR-0042 §4: inline the product version + the deployed commit sha at build
// time so a running instance always reports its exact `vX.Y.Z · <sha>`.
// Cloudflare Pages sets CF_PAGES_COMMIT_SHA on every build (prod always stamps
// the deployed commit); local dev falls back to `git rev-parse --short HEAD`.
const pkgVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;
const gitSha =
  (process.env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 7) ||
  (() => {
    try {
      return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      return 'dev';
    }
  })();
const buildTime = new Date().toISOString();

// ── Shared Vitest config (perf: test-speed two-environment split) ────────────
// Base excludes: e2e (Playwright), build output, and the eval harness.
// ADR-0052 / FR-AT2-EV-006: `*.eval.ts` case files are a SEPARATE Vitest project
// (vitest.eval.config.ts → `npm run test:evals`) — never the default suite (a
// leaked eval case needs a live provider key + deployed target and would flake
// the fast lane). `evals/harness/runEval.ts` is excluded too (imported only by
// `*.eval.ts`, pulls in supabase-js auth+fetch). The scorer unit tests
// (`evals/harness/scorers.test.ts`) ARE `.test.ts` and DO run.
const BASE_TEST_EXCLUDE = [
  'e2e/**',
  'node_modules/**',
  'dist/**',
  'evals/cases/**',
  'evals/harness/runEval.ts',
];

// Pure-logic suites under src/lib — assigned to the fast `node` environment
// project. The handful that DO touch real DOM APIs (canvas, sessionStorage,
// XHR/ProgressEvent) carry a `// @vitest-environment jsdom` docblock, which
// overrides the project environment per-file, so they run correctly here
// without a per-file exclude list to maintain.
//
// P3c slice 5: `budgetBackstop.test.ts` lives under `supabase/functions/erpnext-sweep/` (outside this
// config's root) because its production sibling (`budgetBackstop.ts`) is Deno- AND Vitest-importable,
// like `pmo-portal/src/lib/budget/budgetGate.ts` — it needs an explicit entry since Vitest's `include`
// globs are resolved relative to `root` and never climb a `../`. Named explicitly (not a `../**`
// glob) so this does NOT pull in that directory's OTHER, Deno-native tests (`Deno.test`/`jsr:` specifier
// imports), which would crash immediately under Vitest/node.
const NODE_LOGIC_INCLUDE = [
  'src/lib/**/*.{test,spec}.ts',
  '../supabase/functions/erpnext-sweep/budgetBackstop.test.ts',
];

const sharedTestOptions = {
  globals: true,
  setupFiles: ['./test/setup.ts'],
  css: false,
  // AUDIT-M17 (2026-07-04 audit): clear mock call history between tests globally — no more
  // relying on per-file afterEach discipline for call-count assertions. (Implementations set
  // via mockReturnValue/mockImplementation are preserved; this clears calls/results only.)
  clearMocks: true,
  // Dummy Supabase env so client.ts can instantiate in unit tests without a
  // real .env.local (tests that exercise supabase still mock all calls).
  env: {
    VITE_SUPABASE_URL: 'http://localhost:54321',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    VITE_POSTHOG_KEY: '',
    VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
    VITE_ANALYTICS_ENABLED: 'false',
    VITE_DEMO_MODE: 'false',
    VITE_APP_ENV: 'test',
    // Pin the entitlement/feature flags to their defaults so the unit suite is DETERMINISTIC
    // regardless of a developer's .env.local (which scripts/e2e-local.sh writes with these ON for
    // the e2e dev server). Without this pin, running `npm run verify` after an e2e-local run reads
    // the flag-on .env.local and breaks features.test.ts + the flag-gated component tests.
    VITE_FEATURES_USERVIEWS: '',
    VITE_FEATURES_AI_COMPOSER: '',
    VITE_FEATURES_AGENT_ASSISTANT: '',
    VITE_FEATURES_CRM: '',
  },
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) only accepts the function form of manualChunks.
        // Behaviour is identical to the previous object form: each dep maps to
        // the same named chunk (long-lived browser cache for rarely-changed
        // vendor bundles).
        manualChunks: (id: string) => {
          if (id.includes('react-router-dom') || id.includes('/react/') || id.includes('/react-dom/')) {
            // React core + router — changes rarely; long-lived browser cache
            return 'vendor-react';
          }
          if (id.includes('@tanstack/react-query')) {
            // TanStack Query — data-fetching layer
            return 'vendor-query';
          }
          if (id.includes('@supabase/supabase-js') || id.includes('/supabase-js/')) {
            // Supabase client — heaviest single dep
            return 'vendor-supabase';
          }
          if (id.includes('recharts')) {
            // Recharts — chart library, only used in dashboard pages
            return 'vendor-recharts';
          }
        },
      },
    },
  },
  test: {
    // ── Two-environment split (perf: test-speed) ──────────────────────────────
    // The jsdom `environment` setup dominated wall-clock (~508s summed across 603
    // files) even though ~165 pure-logic suites under `src/lib/**` never touch the
    // DOM. Vitest 4 dropped `environmentMatchGlobs`, so we split into two
    // `projects`: a fast `node`-environment project for the DOM-free logic tests
    // and a `jsdom` project for everything that renders. Both inherit the root
    // Vite config (plugins/resolve/define) via `extends: true` and the shared
    // `env`/`setupFiles`/`clearMocks` below. `setup.ts` is node-safe — every DOM
    // op in it is guarded by `typeof window !== 'undefined'`.
    //
    // The 3 `src/lib` .ts tests that DO touch real DOM APIs (canvas/createElement,
    // sessionStorage, XHR/ProgressEvent) carry a `// @vitest-environment jsdom`
    // docblock, which overrides the project environment per-file so they run on
    // jsdom even under the node project.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          ...sharedTestOptions,
          include: NODE_LOGIC_INCLUDE,
          exclude: BASE_TEST_EXCLUDE,
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          ...sharedTestOptions,
          include: ['**/*.{test,spec}.{ts,tsx}'],
          // Everything the node project owns is excluded here so each file runs
          // exactly once (the 3 DOM-dependent src/lib suites carry a per-file
          // `@vitest-environment jsdom` docblock and run under the node project).
          exclude: [...BASE_TEST_EXCLUDE, ...NODE_LOGIC_INCLUDE],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // 'json' writes coverage/coverage-final.json (istanbul shape) for the
      // diff-aware changed-lines gate (scripts/changed-lines-coverage.mjs).
      reporter: ['text', 'html', 'json'],
      // Report EVERY source file, not just test-touched ones (Vitest 4 replaced
      // the old `all: true` with an explicit `include` glob). This makes a
      // newly-added untested file show up as uncovered changed lines rather than
      // being silently absent from the report.
      include: [
        'src/**/*.{ts,tsx}',
        'pages/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'data/**/*.{ts,tsx}',
        'App.tsx',
        'index.tsx',
        'types.ts',
      ],
      exclude: ['e2e/**', 'test/**', '**/*.config.*', 'dist/**'],
    },
  },
});
