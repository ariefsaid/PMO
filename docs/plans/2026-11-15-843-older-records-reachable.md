# Plan: older expense claims and imprest floats reachable from their lists (#843)

> Spec: `docs/specs/server-side-paging.spec.md` (branch `docs/spec-843`), rollout step 6, FR-PAGE-001..003,
> FR-PAGE-012, FR-PAGE-020, FR-PAGE-030, AC-PAGE-024. Built on the spec's defaults (keyset + sentinel +
> separate count; "Load more"). No new control: the lists reuse the shared `DataTable` paging footer
> ("Showing x of y" + its existing Load more action) exactly as the Equipment assets list does
> (`pages/equipment/EquipmentAssets.tsx`, `useEquipmentAssetPages`).

## Defect
Both lists read the newest 200 rows and show a "Showing the latest 200" notice. Record 201 and older
cannot be reached from the list in the All view.

## Design
- Keyset cursor `(created_at desc, id desc)` — the `listNotificationsPage` shape — so a row written
  between two reads never repeats or is skipped. Shared type + filter in `src/lib/createdAtCursor.ts` (outside `lib/db`, so hooks may import it, #1632).
- Page size stays 200 (the existing cap), read as 200 + 1 sentinel; `truncated` still means "more rows".
- A head count over the same filters gives the "of y" (the `countAssets` shape); a failed count shows
  the loaded count only, never a wrong total.
- Existing `list()` / `listFloats()` callers (dashboard, record crumbs) keep their first-page behaviour:
  the cursor argument is optional.
- No migration: both tables already order by `created_at, id` under RLS; indexes are a separate
  NFR-PAGE-005 check owed with the DB session.

## Files
| File | Change |
|---|---|
| `pmo-portal/src/lib/createdAtCursor.ts` | new: `CreatedAtCursor`, `afterCreatedAt()`, `cursorAfter()` |
| `pmo-portal/src/test/pagedQueryMock.ts` | new test helper: one-page fixture to paged-hook shape for the existing page tests |
| `pmo-portal/src/lib/db/expenseClaims.ts` | `listExpenseClaims(filters, cursor?)`; `countExpenseClaims(filters)` |
| `pmo-portal/src/lib/db/imprest.ts` | `listFloats(cursor?)` with `id` tie-break; `countFloats()` |
| `pmo-portal/src/lib/repositories/{expenses,imprest}.ts` + contracts | pass cursor; expose counts |
| `pmo-portal/src/hooks/useExpenseClaims.ts` | `useExpenseClaimPages(filters)` (infinite query + count) |
| `pmo-portal/src/hooks/useImprest.ts` | `useImprestFloatPages()` (infinite query + count) |
| `pmo-portal/pages/ExpenseClaims.tsx`, `pages/ImprestFloats.tsx` | use the page hooks; pass `total/hasMore/onLoadMore` to `DataTable`; delete the "latest 200" notices |
| `public/locales/{en,id}/expenseClaims.json`, `{en,id}/imprest.json` | add `list.loadMore` |
| `public/locales/{en,id}/common.json`, `{en,id}/imprest.json`, `scripts/i18n-common-keys-baseline.json` | remove the dead "latest 200" notice text |

## Tasks (test-first)
1. RED: `pages/ExpenseClaims.olderRecords.test.tsx` and `pages/ImprestFloats.olderRecords.test.tsx` —
   render a list with 201 records over two pages; assert "Showing 200 of 201", no "latest 200" notice,
   Load more reaches the oldest record, and the count then reads 201.
2. RED: DAL tests — cursor adds the keyset `or` filter; count uses the same filters, `head: true`.
3. GREEN: cursor helper, DAL, repositories, hooks (hook tests for the next cursor).
4. GREEN: wire both pages; update hook mocks in existing page tests to the new hook name.
5. Catalogues en + id; gates: `check:guards`, `typecheck`, eslint on touched files, touched vitest files.

## Owed (later session, needs DB)
pgTAP AC-PAGE-010/012 for both tables, index/EXPLAIN check (NFR-PAGE-005), e2e, rendered captures.
