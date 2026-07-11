/**
 * ADR-0056 — the FE task-write routing source: a module-level, fail-closed ownership cache.
 *
 * `TaskRepository` methods are plain async functions with NO React context, so they cannot call
 * `useExternalDomainOwnership()` (a TanStack hook) directly. This module is the in-memory,
 * no-round-trip (NFR-CUA-PERF-002) short-circuit they consult instead: `routeTaskWrite()` returns
 * `'external'` **iff** the cache is loaded AND positively asserts `tasks`→some external tier;
 * every other state (never loaded, sign-out, an org whose map doesn't mention `tasks`) fails
 * closed to `'pmo'` (FR-CUA-030/031) — RLS remains the sole enforcement authority (ADR-0016); this
 * cache can only ever route a write to the direct DAL, never manufacture adapter access.
 *
 * Seeded load-on-auth by `useOwnershipCacheSync()` (C6); own-org only; cleared on sign-out.
 * Relative imports only (adapterSeam convention — consistency with the Deno-importable siblings).
 */
import { routeWrite, type OwnershipMap, type WriteRoute } from './router.ts';

/** The shape `setTaskOwnership` needs from an `external_domain_ownership` row (camelCase DAL shape). */
export interface OwnershipRow {
  domain: string;
  externalTier: string;
}

let cache: OwnershipMap | null = null;

/** Build the caller's own-org ownership map from its `external_domain_ownership` rows and cache it. */
export function setTaskOwnership(rows: readonly OwnershipRow[]): void {
  const map: Record<string, string> = {};
  for (const row of rows) map[row.domain] = row.externalTier;
  cache = map;
}

/** Reset to the fail-closed cold-start state (sign-out) — `routeTaskWrite()` returns `'pmo'` until re-seeded. */
export function clearOwnershipCache(): void {
  cache = null;
}

/**
 * The task-write routing decision (ADR-0056). Fail-closed: a `null`/never-loaded cache always
 * routes `'pmo'`. Once loaded, delegates to the shared `routeWrite('tasks', cache)`.
 */
export function routeTaskWrite(): WriteRoute {
  return cache ? routeWrite('tasks', cache) : 'pmo';
}
