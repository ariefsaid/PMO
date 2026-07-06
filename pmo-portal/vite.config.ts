import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    // ADR-0052 / FR-AT2-EV-006: `*.eval.ts` case files are a SEPARATE Vitest project
    // (vitest.eval.config.ts → `npm run test:evals`). They must NEVER run in the
    // default suite / `verify` — a leaked eval case would need a live provider key +
    // deployed target and would flake the deterministic fast lane. The runner module
    // (`evals/harness/runEval.ts`) is excluded too: it is only imported by `*.eval.ts`
    // files and pulls in `@supabase/supabase-js` auth + fetch — not unit-test territory.
    // The scorer unit tests (`evals/harness/scorers.test.ts`) are `.test.ts` and DO run.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'evals/cases/**', 'evals/harness/runEval.ts'],
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
    },
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
