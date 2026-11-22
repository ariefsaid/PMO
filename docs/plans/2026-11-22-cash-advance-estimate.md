# Plan: read-only suggestion for the site cash plan (cash-advance-estimate)

Spec: `docs/specs/cash-advance-estimate.spec.md`. Migration number 1890 (range 1890-1899); no money write, no approval change.

## Tasks (test first)

1. **supabase/migrations/1890_imprest_open_requests.sql** + `supabase/migrations/rollback/1890_imprest_open_requests_down.sql`:
   `get_imprest_open_requests(uuid)`, `security invoker`, over `procurements_masked`, `procurement_items_masked`,
   `purchase_requests`, `work_orders`; open statuses only; one row per line; limit 501. Nothing existing is restated.
   pgTAP `supabase/tests/1890_imprest_open_requests.test.sql` owns AC-CAE-001, 002, 004, 005, 006 (mutation check in its header).
2. **Types and DAL:** `src/lib/supabase/database.types.ts` (the function), `src/lib/db/imprest.ts` `getOpenRequests`
   (bounded 500 + sentinel, no casts), repository + contract, hook `useImprestOpenRequests` (key root `imprest-open-requests`).
3. **Pure helpers:** `src/lib/imprest/planSeed.ts` (`foldRequests`, `seedFromRequests`), tested in `planSeed.test.ts`.
4. **UI** (skill `restructure`, `DESIGN.md` tokens, shared primitives, EN + ID in `public/locales/{en,id}/imprest.json` under `open`):
   `pages/imprest/OpenRequestsSection.tsx` (list by purpose and work order, empty state, disabled action with reason),
   `pages/imprest/PlanSeedEditor.tsx` (pre-filled editor, existing plan path), `PlansSection.tsx` takes `seed` / `onSeedDone`,
   `ImprestFloatDetail.tsx` holds the seed and renders the section above the plans.
   Vitest: `OpenRequestsSection.test.tsx` (AC-CAE-002/003/007/008/009), `PlanSeedEditor.test.tsx` (AC-CAE-003), `planSeed.test.ts`.
5. **e2e:** one step in `e2e/AC-IMP-090-site-imprest-journey.spec.ts` (AC-CAE-010), written, not run.
6. **Docs:** `docs/glossary.md` adds **Open requests (site cash)**.

## Traceability
| AC | Layer | File |
|---|---|---|
| 001, 002 (data), 004, 005, 006 | pgTAP | `supabase/tests/1890_imprest_open_requests.test.sql` |
| 002, 003, 007, 008, 009 | Vitest | `OpenRequestsSection.test.tsx`, `PlanSeedEditor.test.tsx`, `src/lib/imprest/planSeed.test.ts` |
| 010 | e2e step | `e2e/AC-IMP-090-site-imprest-journey.spec.ts` |

## Rollback
`rollback/1890_imprest_open_requests_down.sql` drops the function. No data, no table, nothing restated.
