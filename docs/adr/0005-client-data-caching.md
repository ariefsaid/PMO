# ADR-0005: TanStack Query for client-side server-state caching

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/target-architecture.spec.md` §4, §9; baseline `NFR-008`, `F-7`.

## Context
The prototype recomputes derived data on every render and loses all state on navigation/refresh
(`baseline.spec.md §3`), and handles no loading/error/empty states because there was no async
(`NFR-008`). Moving to Supabase introduces real async reads/writes. We need a layer that caches server
data, manages async status, dedupes requests, supports optimistic updates, and invalidates on mutation —
without hand-rolling it per page.

## Decision
Adopt **TanStack Query (React Query) v5** as the **server-state** cache/sync layer. UI/local state stays
in `useState`/`useReducer` (no global client-state store like Redux for MVP). Conventions:
- `queryKey` includes `org_id` so cache identity is tenant-scoped (no cross-tenant bleed when multi-tenant
  lands).
- Lists default `staleTime` ~30s, `gcTime` ~5m; mutations `invalidateQueries` on the affected aggregate.
- **Optimistic** updates only for high-frequency low-risk edits (timesheet hour cells, task edits) with
  rollback; **server-confirmed** for state-machine transitions (procurement, timesheet submit/approve).

## Consequences
- **Positive:** Directly powers the §4.3 loading/error/empty contract via query status flags; caching +
  background revalidation + request dedup improve perceived speed and cut redundant fetches; built-in
  optimistic + rollback and invalidation reduce per-page boilerplate. Small, well-maintained dep.
- **Negative:** A new dependency and mental model; cache-key discipline required (always include
  `org_id`); over-aggressive `staleTime` could show stale data (tuned per query).
- **Rejected:** SWR (thinner mutation/invalidation story); Redux Toolkit Query (heavier; we don't need a
  global client store); hand-rolled fetching (reinvents this layer, the `NFR-008` gap).
