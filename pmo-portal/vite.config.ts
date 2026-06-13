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
        manualChunks: {
          // React core + router — changes rarely; long-lived browser cache
          // Note: react/react-dom are already inlined into the main bundle by
          // Rollup when they're re-exported by react-router-dom; combining them
          // avoids an empty chunk warning.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // TanStack Query — data-fetching layer
          'vendor-query': ['@tanstack/react-query'],
          // Supabase client — heaviest single dep
          'vendor-supabase': ['@supabase/supabase-js'],
          // Recharts — chart library, only used in dashboard pages
          'vendor-recharts': ['recharts'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    css: false,
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
