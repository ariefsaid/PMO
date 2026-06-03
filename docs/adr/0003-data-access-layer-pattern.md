# ADR-0003: Typed data-access layer (one module per aggregate)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/target-architecture.spec.md` §3, §8; baseline `F-6`, `F-7`.

## Context
The prototype reads ES-module mock arrays directly in components and resolves relationships with
render-time `.find()` (`baseline.spec.md §3`, `F-7`), with formatting and lifecycle logic duplicated
across ~7 and 3 files respectively (`F-6`). We need a single, typed boundary between UI and Supabase so
that: components don't know about transport; the tenancy seam lives in one place; and we can later swap a
direct query for an Edge Function without touching components.

## Decision
Introduce `src/lib/db/*` — **one typed module per aggregate** (`projects`, `procurements`, `budgets`,
`timesheets`, `tasks`, `companies`, `profiles`, `documents`, `incidents`, `dashboard`). Rules:
- Only `src/lib/supabase/client.ts` imports supabase-js; **no component imports it directly.**
- Row types come from `database.types.ts` (`supabase gen types typescript`); typecheck fails on drift.
- Relationship resolution happens in **SQL joins/views**, never client `.find()` (kills `F-7`).
- The **`org_id` tenancy seam** lives in `src/lib/db/_tenant.ts`; the client never sets `org_id` on write.
- State-machine transitions and KPI aggregates go through Postgres RPC/views called from these modules
  (spec §8.4).
- React components consume these modules through TanStack Query hooks (`src/hooks/*`), not directly.

## Consequences
- **Positive:** One place to enforce tenancy, typing, and error throwing; trivial to mock in unit tests;
  transport is swappable (direct query ↔ Edge Function) per module; eliminates duplicated logic (`F-6`)
  by routing all reads/writes through shared modules + `lib/format.ts` + `lib/procurement-lifecycle.ts`.
- **Negative:** A thin layer of indirection and boilerplate per aggregate; discipline required to keep
  supabase-js out of components (enforce via lint rule / review).
