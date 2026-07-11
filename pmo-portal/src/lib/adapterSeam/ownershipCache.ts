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

/** Build the caller's own-org ownership map (domain→tier) from its `external_domain_ownership`
 *  rows and cache it. Same body for every domain — the map is already domain-keyed. */
export function setTaskOwnership(rows: readonly OwnershipRow[]): void {
  const map: Record<string, string> = {};
  for (const row of rows) map[row.domain] = row.externalTier;
  cache = map;
}

/** Alias naming the generalized intent (P2, FR-ENA-005) — P1 callers keep `setTaskOwnership`;
 *  identical body (the cache is domain-keyed, so one seed already covers every domain). */
export const setDomainOwnership = setTaskOwnership;

/** Reset to the fail-closed cold-start state (sign-out) — `routeTaskWrite()` returns `'pmo'` until re-seeded. */
export function clearOwnershipCache(): void {
  cache = null;
}

/**
 * The generalized per-domain write route (ADR-0056 generalized, FR-ENA-005). Fail-closed: a
 * `null`/never-loaded cache always routes `'pmo'` for ANY domain. Once loaded, delegates to the
 * shared `routeWrite(domain, cache)`.
 */
export function routeDomainWrite(domain: string): WriteRoute {
  return cache ? routeWrite(domain, cache) : 'pmo';
}

/** Back-compat (P1) — delegates to the generalized per-domain route for `'tasks'`. */
export function routeTaskWrite(): WriteRoute {
  return routeDomainWrite('tasks');
}
