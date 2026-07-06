/**
 * Dedicated Vitest project for agent eval cases (`*.eval.ts`).
 *
 * ADR-0052 / FR-AT2-EV-004/006. Run via `npm run test:evals` ONLY — NEVER via the
 * default `npm test` / `verify` (the default project excludes `evals/cases/**`).
 *
 * Evals drive the DEPLOYED agent-chat function over HTTP (a real model call + tool
 * selection on the weak prod model — FR-AT2-EV-003). That is nondeterministic and
 * costs money, so:
 *   - `fileParallelism: false` — serial execution (stay within the cost budget +
 *     avoid rate-limits, DEC-7).
 *   - `testTimeout: 60_000` — a deployed run + optional judge call can take ~20-30s.
 *   - no coverage — evals are a behavior net, not a line-coverage surface.
 *
 * A case whose required env vars are absent SKIPS gracefully (NFR-AT2-SEC-005) —
 * never reds the suite on a missing secret. A failing scorer is a real regression →
 * Vitest exits non-zero (FR-AT2-EV-004).
 */
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['evals/cases/**/*.eval.ts'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    // Real model calls are slow + nondeterministic; serial keeps cost bounded.
    fileParallelism: false,
    testTimeout: 60_000,
    // No env mocks here — evals read real credentials from process env (GH secrets /
    // the developer's shell). `process.env` access is genuine at run time.
    env: {},
    coverage: { enabled: false },
  },
});
