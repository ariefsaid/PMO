# Spec: What this work order still lacks (missing list)

**Status:** approved; scope corrected by the coordinator (steering file): billing steps for the work order are a new advisory step list (not `claim_billing_stages`), built by another item; this item derives from it through a typed seam and wires it when it lands. Plan: `docs/plans/2026-11-22-missing-list.md`. IDs `FR-WML-###`, `AC-WML-###`.

## Job story
When I open a work order, I want one list of what it still lacks (steps, attachments, quantities), and to export it, so that I know what to chase and who adds each thing.

## What exists today (base)
- Quantities: `deriveScopeProgress` (`pmo-portal/src/lib/workOrderProgress.ts`) gives accepted per line (confirmed acceptances only); `getBillingReconciliation(projectId, workOrderId)` (`src/lib/db/billingStages.ts`) gives reported progress to date (`progressQty`, null when the item is shared with another work order) and billed quantity. Both already feed the record page.
- Export: `useExport().exportTable(table, entity, 'csv')` (`src/components/export/useExport.ts`).
- The work order's own step list does not exist yet; documents have no work-order link. The close-out checklist keeps its own section and database rule and is NOT part of this list.
- No migration, table or column is needed.

## Requirements (EARS)
- FR-WML-001 The work order page shall show one "Still missing" section listing the gaps below, derived on every view and never stored. Every row is advisory: nothing here refuses anything.
- FR-WML-002 Row kinds: (a) each open step of the work order; (b) each required attachment of an open step not yet attached; (c) quantity reported but not accepted (reported progress minus confirmed accepted, above zero; unknown when the item is shared with another work order, so no row); (d) quantity accepted but not claimed (accepted minus billed, above zero).
- FR-WML-003 Each row says what is missing, why, and who adds it: a step or its attachment, the step's owner role when set, else the project team; a quantity to accept, the project team; a quantity to claim, Finance or an Admin. Wording is a translation string; role names come from data.
- FR-WML-004 Steps enter only through a typed input (`MissingStep[]`: id, position, name, who, done, attachments). The source is the work order's billing step list (`useWorkOrderSteps`, no new query), mapped by `missingStepsFromSource`: open = not done and not skipped; attachments = the step's document slots, attached when a document is set; who adds = the assignee's name, else the owner role's label, else the project team. A viewer without the see right gets no step rows from the read, and the list shows none (no error).
- FR-WML-005 Export CSV downloads the visible rows, in screen order, through the shared export hook (`Missing_<date>.csv`; columns item, kind, why, who adds it).
- FR-WML-006 A closed or cancelled work order shows no list (the section says so). A source that fails shows its own error with retry, never a partial list as complete; loading shows a loading state; an empty list says nothing is missing and offers no export. Quantity rows need the billing read; a caller who may not see billing gets the step rows only.
- NFR-WML-001 Always on, no setting, no migration, no new table. English and Bahasa Indonesia strings in `workOrders` (`missing.*`); `DESIGN.md` tokens; stacked rows at 390px.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WML-001 | Given open and done steps, when derived, then only open steps appear, each with its owner role or the project team. | Unit `src/lib/workOrderMissing.test.ts` |
| AC-WML-002 | Given an open step with a required attachment unattached, attached, and optional, when derived, then only the unattached required one is a row, under the step's owner; a done step lists none. | Unit |
| AC-WML-003 | Given reported 10, accepted 6, billed 2, when derived, then 4 to accept and 4 to claim; a shared item (reported unknown) or fully accepted and claimed items give no row. | Unit |
| AC-WML-004 | Given two different step inputs, when derived, then only the step rows differ. | Unit |
| AC-WML-005 | Given rows, when exported, then header and body follow the rows in order. | Unit |
| AC-WML-006 | Given the section, when it renders with steps, quantities, loading, error, empty, closed, no billing access, then each state shows its copy; Export calls the shared CSV export. | RTL `pages/work-order-detail/MissingSection.test.tsx` |
| AC-WML-007 | Given a work order with an open step and a required slot unattached, when the page opens, then both are listed with who adds them and Export downloads them; when the document is attached and the step finished, then its rows leave. | E2E `e2e/AC-WML-007-missing-list.spec.ts` |
| AC-WML-008 | Given the step list rows, when mapped, then done/skipped are done, who is assignee, else role label, else none, and attachments follow the slots. | Unit |

## Owner questions
Reported quantity is read as the reconciliation's `progressQty` (progress to date), not the separate measured figure; say if the owner means measured work.
