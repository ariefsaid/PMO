/**
 * agent-native embedded plugin mount — BYOA (Bring Your Own Auth) via Supabase.
 *
 * Exports the default Nitro plugin that calls `createAgentNativeEmbeddedPlugin`
 * with a `getSession` function that resolves the caller from the host deputy
 * AsyncLocalStorage. The middleware (server/middleware/deputy.ts) has ALREADY
 * verified the inbound JWT and entered the deputy scope by the time
 * `getSession` runs, so we read the verified context from the store rather
 * than re-hitting `auth.getUser`.
 *
 * Plugin options shape (verified against installed
 * @agent-native/core@0.84.8 dist/server/embedded.d.ts):
 *   {
 *     databaseUrl: <agent_native_app role URL — isolated schema>,
 *     auth: getSession,        // bare fn → becomes the BYOA getSession
 *     // defaults: resources on, org/onboarding/integrations/terminal off,
 *     // sentry on, coreRoutes on, agentChat on (actions wired by Step 3).
 *   }
 *
 * `databaseUrl` uses a DEDICATED role (agent_native_app) whose default
 * search_path is `agent_native, public`. agent-native runs raw unqualified DDL
 * via postgres-js, so this role-level search_path is the only clean way to keep
 * its tables out of PMO's `public` schema (hard constraint). Verified: an
 * unqualified CREATE TABLE under this role lands in `agent_native`.
 */
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";
import type { H3Event } from "h3";
import { getDeputyContext } from "../lib/deputy-store";
import { createActivityAction } from "../actions/create-activity";
import { pmoQueryAction } from "../actions/pmo-query";
import { queryEntityAction } from "../actions/query-entity";
import { updateTaskStatusAction } from "../actions/update-task-status";

/**
 * BYOA getSession — resolve the host caller for agent-native.
 *
 * Reads the deputy context populated by the middleware. Returns null for
 * anonymous requests (no Bearer / invalid JWT), which agent-native maps to an
 * anonymous session. The returned shape is the verified, host-side identity;
 * agent-native normalizes it internally via normalizeAgentNativeEmbeddedSession.
 */
async function getSession(_event: H3Event) {
  const deputy = getDeputyContext();
  if (!deputy) return null;
  return {
    userId: deputy.userId,
    email: deputy.email,
    orgId: deputy.orgId,
    orgRole: deputy.role,
  };
}

/**
 * DATABASE_URL for agent-native's OWN tables.
 *
 * Dedicated role → isolated schema. The `?schema=` query string is NOT honored
 * by postgres-js / agent-native's raw-SQL path; isolation comes from the role's
 * default search_path (`agent_native, public`), set once via:
 *   ALTER ROLE agent_native_app SET search_path = agent_native, public;
 * The query param is kept only as documentation; it carries no effect.
 *
 * Falls back to process.env.DATABASE_URL if explicitly provided (e.g. a remote
 * Neon install with its own isolation strategy).
 */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
  const port = process.env.POSTGRES_PORT ?? "54322"; // Supabase direct DB port
  const password = process.env.POSTGRES_PASSWORD ?? "agent_native_pw";
  return `postgresql://agent_native_app:${password}@${host}:${port}/postgres`;
}

const embeddedPlugin = createAgentNativeEmbeddedPlugin({
  databaseUrl: resolveDatabaseUrl(),
  auth: getSession,
  // defaults are correct for an embedded host-auth install:
  //   resources: true, org: false, onboarding: false,
  //   integrations: false, terminal: false, sentry: true,
  //   coreRoutes: true, agentChat: true.
  //
  // Step 3 — the PMO deputy action. Registered explicitly via the `actions`
  // option (NOT relying on auto-discovery): agent-native's autoDiscoverActions
  // uses a raw ESM `import()` that bypasses Nitro's bundler, so actions can't
  // lean on the `~/` alias or extensionless relative imports safely. Passing
  // the action here guarantees it resolves through the plugin module graph.
  // The key is the registered action name surfaced at
  // `/_agent-native/actions/pmo_query`. Shape: `Record<string, ActionEntry>`;
  // `defineAction`'s ActionDefinition return is structurally assignable.
  actions: {
    pmo_query: pmoQueryAction,
    query_entity: queryEntityAction,
    create_activity: createActivityAction,
    update_task_status: updateTaskStatusAction,
  },
});

export default embeddedPlugin;
