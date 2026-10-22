# Plan — ERP purchases, read-only (EPR)

- **Spec:** `docs/specs/erp-purchases-readonly.spec.md` (FR-EPR-001..008, AC-EPR-001..008).
- **Rulings:** `DD-XING-2` (read, never adopt), ADR-0048 (show ERP's figures), `OD-SEED-3/4`.
- **Executor:** money-adjacent read model → Director-dispatched build + the 3-reviewer battery. No money
  write path is touched; nothing reads the new table into spent/committed/actuals (pgTAP AC-EPR-006 guards it).
- **Release ceiling:** `dev`.

## Design

| Layer | Piece | Why this shape |
|---|---|---|
| DB | `erp_purchase_documents` (0335): one row per submitted/cancelled PO/PI, `unique(org_id, erp_doctype, erp_name)`, `project_ids uuid[]`, `pmo_owned` | A mirror table, not a view over the GL: POs post no GL, and the list needs supplier/bill no/status the GL lacks. |
| DB | `upsert_erp_purchase_documents(org, rows)` definer, service_role only | One call does the newer-wins upsert **and** re-stamps attribution + `pmo_owned` for the whole org, so a project remap or a late `external_refs` row applies on the next tick without refetching. |
| DB | Attribution = header project ∪ (PI) projects on its live GL rows, via the binding's `project_map` | RIS's loader sets a header project only on single-project invoices; multi-project invoices carry it per line, which the GL states. Matches what Actuals counts. |
| DB | RLS: active Admin/Executive/PM/Finance of the org; no write policy | Same audience as the org-wide procurement index (`procurement.view`). |
| Sweep | `purchaseMirrorFeed.ts`, pass (3b) after the ledger feed | Fresh GL rows exist before attribution; failure is recorded per org and never blocks the accounting refresh. Watermarks `purchases::<doctype>`, inclusive `modified`, drafts never listed. |
| FE | `ErpPurchasesSection` under the project's Procurement tab; `/erp-purchases` org page, linked from Procurement only when the org has rows | No new tab; a project without ERP history keeps today's screen. No totals of spend — only the unpaid aging. |
| FE | `erpPurchaseAging.ts` | Paid/unpaid from ERP's `outstanding_amount`; aging per currency; shared invoices left out of a project's buckets. |

## Tasks (done in this order)

1. Migration `supabase/migrations/0335_erp_purchase_documents.sql` + `rollback/0335_…_down.sql`; pgTAP
   `supabase/tests/erp_purchase_documents.test.sql`.
   Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/erp_purchase_documents.test.sql'`.
2. Splice the table + function into `pmo-portal/src/lib/supabase/database.types.ts` (from `supabase gen types typescript --local`).
3. `pmo-portal/src/lib/adapterSeam/erpnext/purchaseMirrorFeed.ts` (+ test); export `readWm`/`advanceWm` from `ledgerMirrorFeed.ts`.
   Verify: `npx vitest run src/lib/adapterSeam/erpnext/purchaseMirrorFeed.test.ts`.
4. Wire `feedOrgPurchases` into `supabase/functions/erpnext-sweep/index.ts` (+ `purchaseFeedPass.test.ts`).
   Verify: `cd supabase/functions/erpnext-sweep && deno test purchaseFeedPass.test.ts --config deno.json --allow-env --allow-net --allow-read`.
5. Repository `src/lib/repositories/erpPurchases.ts` (+ registry/types), hook `src/hooks/useErpPurchases.ts`,
   `src/lib/erpPurchaseAging.ts` (+ test).
6. `pages/procurement/ErpPurchasesTable.tsx`, `pages/project-detail/ErpPurchasesSection.tsx` (+ test) mounted in
   `tabs/ProcurementTab.tsx`; `pages/ErpPurchases.tsx`, route in `App.tsx`, link in `pages/Procurement.tsx`;
   copy in `public/locales/{en,id}/finance.json`; launch-scope line for `/erp-purchases`.
7. e2e `e2e/AC-EPR-008-erp-purchases.spec.ts`. Verify: `scripts/e2e-local.sh --reset AC-EPR-008`.

## Traceability

| AC | Owning test | Layer |
|---|---|---|
| AC-EPR-001 | `purchaseMirrorFeed.test.ts` | unit |
| AC-EPR-002..006 | `supabase/tests/erp_purchase_documents.test.sql` | pgTAP |
| AC-EPR-007 | `pages/project-detail/ErpPurchasesSection.test.tsx` | unit |
| AC-EPR-008 | `e2e/AC-EPR-008-erp-purchases.spec.ts` | e2e |

## Rollout note
First tick after deploy backfills all submitted POs/PIs (≤10,000 per doctype per tick, resumable). Needs the
ERPNext integration user to read Purchase Order / Purchase Invoice — already true for any org whose procurement
domain is ERP-owned; otherwise the pass records `purchases:<error>` and the rest of the sweep is unaffected.
