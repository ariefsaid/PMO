# Plan: stock lane 1124d (handover scope, material completion, order needed-by)

Specs: `docs/specs/stock-handover-scope.spec.md`, `docs/specs/work-order-material-completion.spec.md`, `docs/specs/order-needed-by.spec.md`. Migrations 2100 to 2102 (range 2100-2129), each with a rollback.

| Item | Files | Owning layer per AC |
|---|---|---|
| 1 handover scope | `supabase/migrations/2100_stock_handover_scope.sql` (column, setter, `stock_post_core` clause, proof-status read); `src/lib/db/stockTransfers.ts`, `repositories/stockTransfers.ts`, `TransferModeSettings.tsx`, `public/locales/*/stock.json` | AC-HSC-001..007 pgTAP `supabase/tests/2100_stock_handover_scope.test.sql`; AC-HSC-008/009 unit |
| 2 material completion | `2101_work_order_material_completion.sql` (one read over `get_work_order_stock_balance` and the ledger); `src/lib/db/stockSiteWork.ts`, `pages/stock/WorkOrderMaterialCompletion.tsx`, `pages/work-order-detail/MaterialCompletionLink.tsx`, route `/work-orders/:id/material-completion` | AC-WMC-001..004 pgTAP `2101_...test.sql`; AC-WMC-001/003/006/007 unit |
| 3 order needed-by | `2102_order_needed_by.sql` (setting, header column, guard trigger, write RPC, 1346 line guard exemption); `src/lib/db/procurementNeededBy.ts`, `usePoNeededBy.ts`, `OrderNeededByPanel.tsx`, `OrgOrderNeededBy.tsx` | AC-NBY-001..007 pgTAP `2102_...test.sql`; AC-NBY-008..010 unit |

Verify: `npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run <changed>`, and (orchestrator, with Docker) `supabase test db` on the three pgTAP files plus the mutation checks named in each spec.
