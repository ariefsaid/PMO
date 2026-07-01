import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// E3 (ADR-0040): same-origin dev proxy to the agent-native Nitro sidecar. Pure-data module
// (no app imports) so it is safe in this Node/Vite context; the AC-408 unit test asserts it too.
// Relative path (not the `@` alias) because this import runs before the alias is registered.
import { AGENT_SIDECAR_PROXY } from './src/lib/agent/embedProxy';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    // E3: forward same-origin /_agent-native/* (the SDK-fixed prefix) to the Nitro sidecar on
    // 127.0.0.1:8100, preserving the Authorization header the embed auth interceptor stamped.
    // Prod same-origin proxy is a Cloudflare Pages Function (E8).
    proxy: { ...AGENT_SIDECAR_PROXY },
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
          if (id.includes('@agent-native/core') || id.includes('@tabler/icons-react') || id.includes('@assistant-ui/')) {
            // E3: agent-native embed UI (+ its static peers) — lazy-loaded only when the
            // agentNativeEmbed flag is on; isolated in its own long-lived chunk.
            return 'vendor-agent-native';
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
