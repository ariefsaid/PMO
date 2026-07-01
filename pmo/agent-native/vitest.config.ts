/**
 * Vitest config for the agent-native Step 5 GATE.
 *
 * globalSetup boots the Nitro sidecar (port 8100) once for the whole run so the
 * gate test can drive the action over HTTP — exercising the full deputy chain
 * (middleware → ALS → action → Supabase RLS). The server is torn down after.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  test: {
    globalSetup: [resolve(projectRoot, "test/global-setup.ts")],
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
