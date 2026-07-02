/**
 * Host-owned AsyncLocalStorage — the deputy credential seam.
 *
 * WHY THIS EXISTS (the load-bearing security detail):
 *
 * agent-native (verified against installed @agent-native/core@0.84.8 types)
 * gives actions NO clean raw-credential seam:
 *
 *   1. `ActionRunContext` (the `ctx` passed to `defineAction.run`) exposes only
 *      send / userEmail / orgId / caller / attachments / signal / actionName /
 *      threadId / turnId. No `event`, no headers, no raw JWT.
 *   2. The framework's `RequestContext` (from getRequestContext()) is a fixed
 *      interface with no index signature — userEmail / userName / orgId /
 *      timezone / authContextAccessed / requestOrigin / isIntegrationCaller /
 *      integration / run. You cannot add a `rawJwt` field to it.
 *   3. `AuthSession.token` is the framework's own Better-Auth session-cookie
 *      token, NOT a passthrough that lands in actions.
 *
 * Therefore the deputy invariant — "call PMO data AS THE CALLER through RLS" —
 * must use a HOST-OWNED `AsyncLocalStorage` populated by a Nitro middleware
 * that runs BEFORE agent-native's routes. The middleware verifies the inbound
 * JWT (service_role, getUser ONLY) and stashes the RAW caller JWT. A Step 3
 * action later reads that raw JWT via `getCallerJwt()` to build the caller
 * (anon key + caller JWT) Supabase client, so RLS resolves as the caller.
 *
 * Mirrors the verified deputy pattern in
 * `supabase/functions/agent-chat/index.ts` (service_role → auth.getUser ONLY;
 * anon key + caller JWT for all business data).
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The per-request deputy context. */
export interface DeputyContext {
  /** Raw caller JWT (from `Authorization: Bearer <jwt>`). NEVER service_role. */
  readonly rawJwt: string;
  /** Verified user id (Supabase auth.users.id, JWT `sub`). */
  readonly userId: string;
  /** Verified user email (from auth.getUser). */
  readonly email: string;
  /** org_id resolved from `profiles` (identity read — service_role allowed). */
  readonly orgId: string | null;
  /** role resolved from `profiles` (identity read — service_role allowed). */
  readonly role: string | null;
}

const deputyStore = new AsyncLocalStorage<DeputyContext>();

/**
 * Run `fn` inside a deputy context. Called by the deputy middleware once the
 * inbound JWT has been verified. All async work spawned downstream (including
 * agent-native's action `run`) inherits the store via Node's async hooks.
 */
export function runWithDeputy<T>(ctx: DeputyContext, fn: () => T | Promise<T>): T | Promise<T> {
  return deputyStore.run(ctx, fn);
}

/**
 * Read the caller JWT for the current async chain.
 *
 * Returns `undefined` when there is no authenticated caller on this chain:
 *   - the request carried no/invalid `Authorization: Bearer`, or
 *   - this code path is not running under the deputy middleware (e.g. a CLI).
 *
 * Step 3 actions MUST treat `undefined` as "no caller — refuse the data call".
 * Building a caller client with a missing JWT would silently bypass RLS.
 */
export function getCallerJwt(): string | undefined {
  return deputyStore.getStore()?.rawJwt;
}

/**
 * Read the full deputy context for the current async chain, or `undefined`.
 * Prefer `getCallerJwt()` when you only need the credential; use this when an
 * action wants `userId` / `orgId` without re-deriving them.
 */
export function getDeputyContext(): DeputyContext | undefined {
  return deputyStore.getStore();
}
