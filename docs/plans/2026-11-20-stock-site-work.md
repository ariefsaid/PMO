# Plan: stock for site work (#2523)

Spec: `docs/specs/stock-site-work.spec.md`. Depends on #2517 (stock_documents.work_order_id). **Director-dispatched Orca worker, Opus,
ships alone.** Read first: `docs/money-path-primer.md`, `0412_stock_master_data.sql`, `0413_stock_posting_engine.sql`, `0415`, `0417`, `0418`,
`0879`-`0886` (latest stock changes), `docs/specs/inventory-project-consumption.spec.md`, `odoo-stock-posting.spec.md`, and 0951 (#2517 trigger).

## Files
- Migration(s) (numbers assigned at dispatch) + rollbacks: (a) kind check widen + #2517 trigger widen; (b) `stock_tags`, `stock_items.tag_id`, zero-cost rule triggers; (c) `stock_document_files` + bucket policies; (d) `get_work_order_stock_balance(wo)` read RPC.
- Tests: `supabase/tests/<n>_stock_site_work.test.sql`; `src/lib/db/stockDocuments.ts`, `stockMaster.ts`, `stockReports.ts` + tests; `src/lib/repositories/stock*`.
- UI: `pages/stock/*` (location form kinds, tag admin, item form tag field, document attachments panel), work-order page stock section (#2518).

## Tasks (TDD; money tier)
1. pgTAP red AC-SSW-001/012/013 then migration (a): kind widening; confirm `stock_documents_shape` and 0951 `check_cost_attribution` (`w.kind = 'site'` today → include yard/staging).
2. pgTAP red AC-SSW-002/003/004/005/006 then migration (b). Zero-cost enforcement is a trigger on `stock_document_lines` reading the item's tag, `security definer`; the posting engine is not edited unless a failing test requires it. **Mutation-check AC-SSW-002 and AC-SSW-004.**
3. Verify Odoo/ERP posting tolerance of value 0 rows (read `odoo-stock-posting.spec.md`); if it breaks, record as an open item for the Director, do not patch the outbox here.
4. pgTAP red AC-SSW-007/008 then migration (c) with storage RLS modelled on 0391.
5. pgTAP/Layer-1 AC-SSW-009 then migration (d): ledger-derived only, `security_invoker`, value shown only to current stock-value roles; reconciliation fixture.
6. DAL/repositories + unit tests AC-SSW-010/011.
7. UI per `restructure`: location kind select, tag admin (Admin only), item tag field, attachments on the document page, balance block on the work-order page. English and Bahasa strings; the tag's name comes from data.
8. E2E `e2e/AC-SSW-001-yard-to-work-order.spec.ts` (serial lane if it posts, read `docs/e2e-parallel-conventions.md`).
9. Glossary: Yard, Staging, Stock tag, Client-supplied (free-issue) stock, Zero-cost item.

## Gates and review
CLAUDE.md local final gate; pgTAP files touched under the DB lock with reset+test as one hold; mutation results quoted. Reviewers: spec, code-quality, security-auditor (tag Admin gate, storage read, definer triggers); the Director reviews the ledger invariant. Ships alone; owner answers open questions 1, 2, 5 before dispatch.
