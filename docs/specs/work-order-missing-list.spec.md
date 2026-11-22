# Spec: What this work order still lacks (missing list)

**Status:** phase 2, awaiting approval. Gap-billing lane, item `missing-list`. OD-SCOPE-2 and OD-SCOPE-6 apply. Plan: `docs/plans/2026-11-22-missing-list.md`. IDs `FR-WML-###`, `NFR-WML-###`, `AC-WML-###`.

## Job story
When I open a work order, I want one list of what it still lacks before it can be billed or closed (documents, steps, quantities), and to export it, so that I know what to chase and who adds each thing.

## What exists today (checked on the base)
- Close-out checklist: `work_order_closeout_items` (migration 1400), read by `pmo-portal/src/lib/db/closeoutChecklist.ts:55` (`listWorkOrderCloseoutItems`); `closeoutRemaining` (`src/lib/closeoutChecklist.ts:19`) counts required items not done. The database refuses to close while one is open (spec `work-order-closeout-checklist.spec.md` FR-WCO-020). Each item needs an attached document before it is done (FR-WCO-011).
- Billing steps live on the claim: `claim_billing_stages` plus checklist `claim_billing_stage_documents` (read by `getClaimBillingTrace`, `src/lib/db/billingStages.ts:184`); open = not completed and not skipped (`billing_stages_open`). A claim belongs to a work order through `progress_claims.work_order_id` (`database.types.ts:16318`). A step carries an optional owner role (`owner_role`, #2680). There is no step list on the work order itself today.
- Quantities: `deriveScopeProgress` (`src/lib/workOrderProgress.ts:22`) gives allocated vs accepted per line; `getBillingReconciliation(projectId, workOrderId)` (`billingStages.ts:250`) gives measured, billed and unbilled per item. Both already feed the record page (`pages/WorkOrderDetail.tsx`).
- Export: `useExport().exportTable(table, entity, 'csv')` (`src/components/export/useExport.ts`) with `toCsv`/`exportFilename`; first used by `pages/ManagementPack.tsx:213`.
- The record page has no combined list: each source shows only in its own section (`CloseoutSection`, `ScopeSection`, `BillingSection`).

Conclusion: every input exists; nothing needs a new table, column or migration. The list is a pure derivation over existing reads.

## Requirements (EARS)
- FR-WML-001 The work order page shall show one section, "Still missing", listing every gap derived from the existing sources; the list is never stored.
- FR-WML-002 Each row shall say: what is missing (kind and name), what it blocks (billing, closing, or both), why, and who adds it.
- FR-WML-003 Sources: (a) each required close-out item not done: blocks closing; if it has no attached document the row says the document is missing, else that it is to be marked done; (b) each open step on a live (not withdrawn, not invoiced) claim of this work order: blocks billing, naming each required checklist document with no file attached as its own row; (c) each allocated line whose accepted quantity is below the allocated quantity: blocks closing, naming the shortfall in the line's unit; (d) each reconciliation item with unbilled quantity above zero: blocks "fully billed", naming the quantity.
- FR-WML-004 Who adds: a step's own owner role when set, else "Finance or an Admin"; a close-out item "Finance, an Admin or the project's manager"; a quantity shortfall "the project team (record the acceptance)"; unbilled quantity "Finance (raise a claim)". Wording is a translation string, not a rule; it restates what the database already allows.
- FR-WML-005 Optional close-out items and skipped steps never appear; a work order that is Closed or Cancelled shows no list (empty state says so).
- FR-WML-006 The derivation takes its step rows from a "step source" function argument. Today's source reads steps of this work order's claims; when billing steps exist on the work order from opening (another lane item), only the source changes. Rows carry `source` so the two never double-count.
- FR-WML-007 An Export button shall download the visible rows as CSV through the shared export hook (`exportTable`), file `Missing_<date>.csv`, columns: item, kind, blocks, reason, who adds, claim or checklist reference. Same rows, same order as the screen.
- FR-WML-008 While any source is loading, the section shows a loading state; if a source fails it shows its own error with retry, never a partial list presented as complete. A user who may not read billing sees the close-out and quantity rows only (their reads are RLS-scoped; no new access).
- FR-WML-009 An empty list says "Nothing is missing. This work order has what it needs to be billed and closed." and has no export button (disabled button is not needed; export hidden with reason in copy).
- NFR-WML-001 Always on, no setting; no migration; no new table, so no isolation-probe fragment. English and Bahasa Indonesia strings in the existing `workOrders` namespace; `DESIGN.md` tokens; 390px stacked rows, 1440px table.
- NFR-WML-002 No item, role or step name is coded: names come from the organisation's own rows; roles come from `owner_role` data.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WML-001 | Given required close-out item one with no document and optional item two not done, when the list is derived, then one row for item one (document missing, blocks closing, who adds as FR-WML-004) and none for item two. | Unit `src/lib/workOrderMissing.test.ts` |
| AC-WML-002 | Given a live claim with a current step owned by a role and a second open step with a required document unattached, when derived, then a step row names the owner role, and a document row names the unattached document; a completed or skipped step, and a withdrawn or invoiced claim's steps give no row. | Unit |
| AC-WML-003 | Given allocated 10 and accepted 6, when derived, then a row says 4 of the unit remain to accept; fully accepted gives none; reconciliation item with unbilled 3 gives a billing row. | Unit |
| AC-WML-004 | Given a different step source passed in, when derived, then its rows replace claim rows and the rest is unchanged. | Unit |
| AC-WML-005 | Given the rows, when exported, then the CSV table header and body equal the screen rows in order; no rows, no table. | Unit (`toMissingExport`) |
| AC-WML-006 | Given the work order page with gaps, when it renders, then the section lists them with blocks and who adds, Export calls `exportTable(..., 'csv')`; loading, error with retry, empty and Closed states each render their copy. | RTL `pages/work-order-detail/MissingSection.test.tsx` |
| AC-WML-007 | Given an issued work order with an open required close-out item, when a user opens its record, then the section lists it and Export downloads a CSV containing its name. | E2E (one journey, `e2e/AC-WML-007-missing-list.spec.ts`) |

## Owner questions
None blocking. Recommended defaults built: a quantity shortfall blocks closing (final acceptance closes the order); unbilled measured quantity is shown as "not fully billed", not as a block, matching OD-SCOPE-6 (a held claim can be deliberate).
