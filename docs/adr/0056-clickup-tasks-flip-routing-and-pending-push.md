# ADR-0056 — ClickUp tasks-flip: FE write-routing source + pending-push composition

- **Status:** Accepted (Director, 2026-07-10)
- **Date:** 2026-07-10
- **Deciders:** Director (eng-planner phase), pending owner sign-off at merge
- **Related:** ADR-0055 (external-system adapters — SoT/enhancement), ADR-0017 (repository seam),
  ADR-0016 (`can()` UX-only, RLS is authority), ADR-0018 (soft-archive), spec
  `docs/specs/clickup-adapter.spec.md` (FR-CUA-020/021/022/030/031/070..073, OD-CUA-1/2).
- **Scope:** two cross-cutting FE decisions the ClickUp tasks-flip forces, kept out of the individual
  build tasks so the whole team routes writes and renders pending-push one way.

## Context

P1 flips the **real** `tasks` domain to ClickUp-owned per org (FR-CUA-020). Two questions have no
single obvious answer and touch every task write, so they are decided here once:

1. **Where does the task DAL learn the org's ownership?** The `TaskRepository` interface must stay
   **unchanged** (FR-CUA-021, ADR-0017) — its methods are plain `async` functions with **no React
   context**, so they cannot call `useExternalDomainOwnership()` (a TanStack hook). Yet
   `createTask`/`updateTask`/`updateTaskStatus`/`deleteTask` must route to the adapter dispatch when
   `tasks`→`clickup` and take the direct DAL otherwise — **in-memory, no round-trip** (NFR-CUA-PERF-002),
   and **fail-closed to `pmo`** when ownership is unknown (FR-CUA-031).

2. **Where does the pending-push state (`idle`→`pushing`→`pushed`|`push-failed`) live?** The shared
   `executeWriteWithPendingPush` returns/attaches a `PendingPushState`, but the repository methods
   return `Promise<TaskRow>`/`Promise<void>` — surfacing pending-push through the return type would
   change the interface and leak external-tier concepts into every non-ClickUp caller.

## Decision

**1. A module-level ownership cache is the routing source (fail-closed).**
- New pure module `pmo-portal/src/lib/adapterSeam/ownershipCache.ts` holds a single
  `OwnershipMap | null` for the **current session's own org** plus `setTaskOwnership(map)` /
  `clearOwnershipCache()` / `routeTaskWrite(): 'pmo' | 'external'`.
- `routeTaskWrite()` returns `'external'` **iff** the cache is non-null **and**
  `routeWrite('tasks', cache) === 'external'` (i.e. the loaded map positively asserts
  `tasks`→`clickup`); **every other state — `null` (cold start / not-yet-loaded), load failure,
  indeterminate — returns `'pmo'`** (fail-closed to the byte-for-byte invariant, FR-CUA-030/031).
- The cache is seeded **load-on-auth**: a top-level `useOwnershipCacheSync()` hook (mounted once at
  app root) subscribes to the existing `useExternalDomainOwnership()` query and calls
  `setTaskOwnership(...)` on success, `clearOwnershipCache()` on sign-out. Same lifecycle as the
  cached features/entitlement map. **RLS is the enforcement authority** (ADR-0016): the cache is a
  UX/DX short-circuit only — a stale/absent cache can only ever route a write to the **direct DAL**,
  where RLS still denies a native-field write on a flipped org (`42501`). The cache can never
  *manufacture* adapter access.

**2. Pending-push is composed at the hook/surface layer, not the repository return type.**
- `useTaskMutations` computes a `PendingPushState` per in-flight task via the shared `pendingPush.ts`
  helpers (`beginPush`/`completePush`/`failPush`/`classifyExternalError`) **gated on
  `routeTaskWrite()`**: for `'external'` → `pushing` on mutate, `pushed` on success, `push-failed` +
  classified `{headline, detail}` on error; for `'pmo'` → always `IDLE_PENDING_PUSH` (no state ever
  introduced — FR-CUA-071). The repository interface is untouched.
- Task surfaces (board / list / detail in `pages/project-detail/tabs/TasksTab.tsx`) render the state
  through a small shared `TaskPushBadge` presentational component. The board drag may apply the
  optimistic `pushing`-immediately variant (FR-CUA-073); semantics unchanged underneath.

## Consequences

- The `TaskRepository` interface and every non-ClickUp caller are **byte-for-byte unchanged**
  (FR-CUA-030, AC-CUA-001). The only new coupling is the task DAL importing `routeTaskWrite` +
  `dispatchTaskCommand`, both of which short-circuit to the existing direct DAL when the cache is
  `pmo`/absent.
- Fail-closed is the default: a bug in cache seeding degrades to "everyone is PMO-owned" (writes hit
  RLS), **never** to "route to a dispatch that isn't configured." A flipped org whose cache failed to
  load simply gets `42501` on a native write until the map loads — honest, not silent corruption.
- Pending-push stays a pure composition of the P0 shared behavior (`pendingPush.ts`), re-used, never
  re-implemented (FR-CUA-070). Adding a fourth surface later = render `TaskPushBadge`, no new state
  machine.
- The cache is **own-org only** and is cleared on sign-out; there is no cross-org leakage vector (it
  never holds another org's map, and RLS is the authority regardless).
