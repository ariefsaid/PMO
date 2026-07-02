import { defineNitroConfig } from "nitro/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * PMO agent-native sidecar — Nitro config.
 *
 * Nitro auto-scans `server/` for:
 *   - server/middleware/deputy.ts    → host deputy (runs BEFORE agent-native routes)
 *   - server/plugins/agent-native.ts → mounts createAgentNativeEmbeddedPlugin (BYOA)
 *
 * The agent-native plugin is ALSO explicitly listed in `plugins` for
 * belt-and-suspenders (Nitro 3.x auto-scans server/plugins/, but explicit
 * registration is the type-safe guarantee).
 *
 * `serverDir` is set explicitly so Nitro scans THIS package's server dir
 * regardless of monorepo cwd.
 *
 * Hard constraint: PMO's `public` schema must NOT receive agent-native tables.
 * We point DATABASE_URL at a dedicated role (`agent_native_app`) whose default
 * search_path is `agent_native, public`, so every unqualified CREATE TABLE the
 * framework's migrations emit lands in the isolated `agent_native` schema.
 * (Verified empirically: agent-native runs raw unqualified DDL via postgres-js;
 * it does not honor a `?schema=` query param, so role-level search_path is the
 * only clean isolation seam. Confirmed at boot: 26 agent-native tables landed
 * in `agent_native`, zero leaked into `public`.)
 */
export default defineNitroConfig({
  serverDir: resolve(projectRoot, "server"),
  srcDir: projectRoot,
  compatibilityDate: "2025-01-01",
  plugins: [
    resolve(projectRoot, "server/plugins/agent-native.ts"),
  ],
  alias: {
    // Lets actions/ and server/ import host code via "~/server/lib/..." instead
    // of brittle relative paths. NOTE: action auto-discovery uses raw ESM
    // import (not Nitro's bundler), so actions must be registered through the
    // plugin `actions` option OR live in the `actions/` dir with
    // bundler-resolved imports — see server/plugins/agent-native.ts.
    "~": projectRoot,
  },
});
