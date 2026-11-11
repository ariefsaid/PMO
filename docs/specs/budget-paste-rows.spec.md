# Budget paste rows

**Status:** Draft for owner sign-off; specification only, not implementation approval.
**Issue:** [#1445](https://github.com/ariefsaid/PMO/issues/1445).
**Scope:** Paste spreadsheet rows into the selected project's Draft budget line editor.

## Problem and job story

A budget editor working from a spreadsheet needs to enter several budget lines without retyping
one line at a time. When I have spreadsheet rows ready, I want to paste them into PMO, check their
categories and calculated amounts, and explicitly save them to my selected Draft so that PMO holds
the budget and the source document remains supporting evidence.

## Owner decisions — verbatim

Deciding artifact: [owner comment, 2026-10-28](https://github.com/ariefsaid/PMO/issues/1445#issuecomment-6469106169).

> **Owner decision (2026-10-28):** PMO is not templated on any client workbook. Budgets are entered in PMO; any client document is attached as evidence.
> 1. The budget line editor accepts **pasted rows from any spreadsheet** (category, description, amount or qty × rate) with a preview before saving.
> 2. Proposing lines from an uploaded document (AI/OCR) is a later enhancement, filed separately — a plus, not a requirement.
> 3. The verification need is met by **previewing the attached document inside PMO** (#1447 / #1406), not by reading a specific workbook format.

## Prior art and boundary

`scripts/prior-art.sh paste` and `scripts/prior-art.sh budget` were run before drafting.

- **OD-BUDGET-1**, `docs/decisions.md`: the Active version's line amounts determine project budget.
  Pasting into a Draft must not change that authority or activate a version.
- **ADR-0027**, `docs/adr/0027-bulk-import-descriptor-and-write-path.md`: preview performs no writes,
  explicit commit, existing repository writes, sequential per-row results, and a 500-row cap.
- **DD-BIMP-1/4/7**, `docs/decisions.md`, and `docs/specs/budget-import.spec.md`: the existing workbook
  importer is cross-project, hosted on Projects, and resolves an import target Draft. This feature is
  a different entry point: it binds to the editor's explicitly selected Draft, without resolving
  another Draft or creating a version behind the user.
- **DD-BIMP-2/5/8**: preserve server-set currency, line-level import provenance semantics, and honest
  write counts. The workbook importer's content-key deduplication is not a manual paste rule.
- **ADR-0010/0016/0017/0019**: lowest sufficient test layer, real-role UI permissions, repository
  seam, and server-enforced write/state/approval rules remain binding.

The following detailed interaction rules are proposed spec defaults, not additional quotations
from the owner: append to the selected Draft, column mapping rather than workbook templates,
neutral numeric parsing consistent with the existing budget importer, and no silent rounding.
They make the narrow paste-entry contract reviewable without changing the existing file importer.

## Functional requirements (EARS)

- **FR-001 — Entry.** While the selected budget version is Draft and the real user may create/edit
  budget lines, the editor shall offer a labelled Paste rows action alongside manual line entry.
- **FR-002 — Clipboard input.** When the user pastes spreadsheet plain text, the editor shall accept
  tab-separated cells and LF/CRLF row endings, preserve empty cells, and support spreadsheet-quoted
  cells containing tabs, newlines, or escaped quotes without evaluating formulas or HTML.
- **FR-003 — Mapping.** When rows are supplied, the editor shall allow the user to map columns to
  Category, Description, Amount, Quantity, and Rate, ignore unrelated columns, and explicitly include
  or exclude a header row; no client-specific sheet, header, cell address, or column order is required.
- **FR-004 — Category.** When a row is validated, the editor shall require a supported budget category,
  accept the app's category labels, and allow an unrecognised source category to be mapped to a
  supported category before that row can be saved; it shall not invent a category or silently default it.
- **FR-005 — Amount modes.** When preparing the preview, the editor shall let the user choose direct
  Amount or Quantity × Rate for the pasted set and shall identify that choice visibly. In direct
  mode Quantity/Rate shall not override Amount; in calculated mode Amount shall not override the
  product. A source containing both shall require an explicit mode choice before saving.
- **FR-006 — Numeric validation.** When validating numeric cells, the editor shall use the existing
  neutral import convention (dot decimal, optional valid comma grouping), explain that convention,
  and reject malformed, non-finite, non-positive, or out-of-range results. Direct amounts and final
  products shall fit `numeric(14,2)`; products shall be computed with decimal-safe arithmetic and
  shall not be silently rounded. A product requiring more than two decimal places shall require
  correction or an explicitly supplied direct amount. Quantity and Rate shall both be positive.
- **FR-007 — Preview.** When rows are parsed or mappings change, the editor shall show source row
  numbers, resolved categories, descriptions, selected amount inputs, final amounts, row errors,
  valid/invalid counts, the valid-row total, and the selected target version before any write.
- **FR-008 — Confirmation.** While the preview contains valid rows, the editor shall allow one
  explicit Save N valid rows action, stating that invalid rows are excluded and existing lines are
  retained. Empty sets, unmapped required columns, ambiguous amount mode, and over-limit input
  shall not permit saving. Cancel, close, paste, mapping, and preview shall perform zero writes.
- **FR-009 — Target and payload.** When the user confirms saving, the editor shall append each valid
  row to the Draft captured for this preview through `repositories.budget.createLineItem`, using
  only category, nullable description, and the reviewed budgeted amount. It shall neither replace
  existing lines nor select/create another version. New lines shall remain un-phased (`fiscal_year`
  null); the existing editor may phase them afterwards. Quantity/Rate are preview inputs, not new
  stored columns; currency, actuals, status, and tenancy shall not be supplied by pasted cells.
- **FR-010 — Commit results.** When saving begins, the editor shall disable duplicate submission,
  write sequentially, and report created and failed source rows separately using classified errors.
  Successfully created rows shall leave the retry set; a retry within the same open result shall
  submit only failed rows. Identical source rows shall remain separate intentional manual entries,
  and a new, separately confirmed paste shall be a new append, not an import-key deduplication run.
- **FR-011 — Stale state and refresh.** When the selected version changes before confirmation, the
  editor shall invalidate that preview and require review of the new target. When the target stops
  being Draft or permission is lost, saving shall stop and explain the rejection; already committed
  rows shall remain honestly reported. After any successful write, the editor shall refresh budget
  line data, totals, and activation readiness, preserving the existing editor/approver separation.
- **FR-012 — Bounded input.** When pasted input exceeds 500 nonblank data rows, the editor shall
  reject the set with a visible limit message rather than truncate it; wholly blank rows shall be
  ignored without renumbering the remaining source rows.

## Non-functional requirements

- **NFR-001 — Authority.** The implementation shall retain the real-role `can()` checks and existing
  RLS, tenant defaults, parent-version checks, Draft guard, and editor tracking. Parsing and preview
  shall run locally; pasted source text shall not be sent to an AI service or application logs.
- **NFR-002 — Money.** Preview and persistence shall use the same validated decimal result;
  tests shall include fractional multiplication, precision boundaries, and the maximum column value.
- **NFR-003 — Access and language.** The paste flow shall be keyboard operable with labelled fields,
  focus restoration, announced validation/results, and EN/ID copy using shared primitives and
  `DESIGN.md` tokens. Wide previews shall scroll within their container without clipping controls.
- **NFR-004 — Responsiveness.** Preview and confirmation shall support the full 500-row limit without
  a write during parsing; committing shall show progress and prevent concurrent confirmation.

## Acceptance criteria and canonical test ownership

Every criterion has one owning layer; implementation tests must carry its AC identifier. Paths
marked **new** are proposed tests, not claims about files already present.

| ID | Given / When / Then | Owner and canonical location |
|---|---|---|
| AC-001 | Given arbitrarily ordered TSV columns with an optional header, quoted cells, empty descriptions, and blank rows, when parsing and the chosen mapping run, then the result preserves the intended cells and source row numbers without side effects. | Unit — **new** `pmo-portal/src/lib/budget/pasteRows.test.ts` |
| AC-002 | Given direct amounts or positive Quantity/Rate inputs, when each mode is selected, then final amounts and totals match decimal-safe arithmetic; malformed values, non-positive values, precision overflow, excess fractional product digits, and an unchosen conflicting mode cannot enter the save set. | Unit — **new** `pmo-portal/src/lib/budget/pasteRows.test.ts` |
| AC-003 | Given unknown categories, extra columns, and invalid rows alongside valid rows, when the user maps categories and reviews the preview, then row errors and valid counts/total update, and Save N names exactly the valid subset. | Unit — `pmo-portal/pages/ProjectBudget.test.tsx` |
| AC-004 | Given an open preview, when the user cancels/closes it or changes the selected version, then no write occurs and a changed target requires a fresh preview; empty, over-500-row, or unmapped input cannot be confirmed. | Unit — `pmo-portal/pages/ProjectBudget.test.tsx` |
| AC-005 | Given three valid rows including two identical lines, when one save succeeds for two rows and fails for one, then results identify each row honestly, a retry submits only the failure, duplicate clicks do not duplicate submissions, and all successful payloads use the captured version and reviewed amounts without actuals, tenant, currency, status, or import keys. | Unit — **new** `pmo-portal/src/hooks/useBudgetPasteRows.test.tsx` |
| AC-006 | Given Admin, Executive, Project Manager, Finance, Engineer, and impersonated sessions, when the Draft editor renders, then paste follows the real-role budget-line create/edit permissions and is unavailable for read-only or Active/Archived views. | Unit — `pmo-portal/pages/ProjectBudget.test.tsx` |
| AC-007 | Given authenticated writers, non-writers, foreign-tenant versions, and non-Draft versions, when the existing line insert path is exercised, then only permitted same-tenant Draft writes persist and a pasted-line writer is tracked for the existing activation separation rule. | pgTAP — **new** `supabase/tests/budget_paste_rows_contract.test.sql`, reusing the existing role, tenancy, Draft, and editor fixtures |
| AC-008 | Given a labelled paste dialog with errors and a save result, when operated by keyboard in EN and ID at narrow and wide viewports, then controls remain reachable, errors/results are announced, and closing restores focus. | Unit — `pmo-portal/pages/ProjectBudget.test.tsx` (RTL plus axe) |
| AC-009 | Given a real permitted session with a selected Draft containing a line and a separate Active version, when the user pastes one direct-amount set and one Quantity × Rate set, previews and confirms each, then reloading shows the original and new Draft lines with the reviewed total, while the Active version and effective project budget are unchanged. | E2E — **new** `pmo-portal/e2e/AC-009-budget-paste-rows.spec.ts` |
| AC-010 | Given a pending write whose response is lost or a target that becomes non-Draft, when saving cannot confirm success, then uncertain rows are marked for reconciliation without automatic retry, further authority-rejected submissions stop, and already confirmed successes remain accurately reported. | Unit — **new** `pmo-portal/src/hooks/useBudgetPasteRows.test.tsx` |

The pgTAP criterion is a required regression contract, not a claim of live database inspection in
this docs-only task. Existing reference proofs are `supabase/tests/0009_budget_role_gate.test.sql`,
`0010_budget_tenant_isolation.test.sql`, `0011_budget_draft_guard.test.sql`, and
`budget_version_editors.test.sql` (all under `supabase/tests/`).

## Role and RLS contract

`pmo-portal/src/auth/policy.ts` defines budget-line create/edit for Admin, Executive, Project Manager,
and Finance. The paste affordance shall require `can('create', 'budgetLine')` and
`can('edit', 'budgetLine')` from the real session plus selected status Draft; impersonation remains
view-only under ADR-0016. UI gating is not write authority: all inserts shall retain existing
same-org/parent-version RLS enforcement, server-owned tenancy defaults, Draft-only trigger checks,
and editor tracking. No paste-specific role bypass, service credential, or activation path is introduced.
The named pgTAP contract must prove this against implementation head; migration text alone does not
establish live policy or grant state.

## Error handling

| Condition | Required response |
|---|---|
| Empty/malformed text, unmapped fields, or over 500 data rows | Explain the input problem; retain source for correction; no write. |
| Unknown category or invalid amount/product | Identify source row and field; exclude row until corrected; no silent coercion. |
| No valid rows | Disable confirmation; explain what must be corrected. |
| Permission/state rejection during commit | Stop remaining submissions, refresh target state, retain accurate success/failure/unsubmitted results. |
| Individual row write failure | Classify and show failure for that row; continue other rows unless authority/state was lost. |
| Connection failure with uncertain write outcome | Do not label the row created or automatically retry it; refresh persisted lines and require reconciliation before resubmission. |

## Affected code and data (read from this checkout)

| Exact path / table | Role in the future implementation |
|---|---|
| `pmo-portal/pages/ProjectBudget.tsx` | `LineItemEditor`, selected-version binding, permission gates, preview entry and result integration. |
| `pmo-portal/src/hooks/useBudget.ts` | Existing query keys and invalidation for lines, totals, readiness, and project finances. |
| `pmo-portal/src/lib/repositories/index.ts` | Existing `repositories.budget.createLineItem` seam; no new direct UI Supabase access. |
| `pmo-portal/src/lib/repositories/types.ts` | Existing typed repository contract; retain the existing create input. |
| `pmo-portal/src/lib/db/budgets.ts` | `NewLineItem` and `createLineItem`; existing amount-only persistence with optional fiscal year. |
| `pmo-portal/src/lib/import/budgetDescriptor.ts` | Existing category enum and neutral money validation reference; preserve cross-project import behavior. |
| `pmo-portal/src/lib/import/readCsvGrid.ts` | Strict quoted-grid parsing reference; comma CSV is not a drop-in TSV parser. |
| `pmo-portal/src/auth/policy.ts` | Existing `budgetLine` create/edit gates and `budgetVersion` editor-aware activation gate. |
| `pmo-portal/public/locales/en/finance.json`, `pmo-portal/public/locales/id/finance.json` | Paste, mapping, validation, preview, progress, and result messages. |
| `pmo-portal/src/lib/supabase/database.types.ts` | Confirms current line shape: amount, category, description, fiscal year; no Quantity/Rate columns. |
| `budget_line_items` | Append reviewed amounts to the selected version only. |
| `budget_versions`, `budget_version_editors` | Read target state and retain server-owned editor/approval tracking. |

**Migration needs:** None proposed. Persist the derived amount through the existing line write path;
no new table, enum, RPC, provenance key, Quantity/Rate columns, or RLS policy is required for this scope.
This spec does not change attachment tables or the workbook importer's schema/contracts.

## Implementation checklist

- [ ] Plan the paste parser, mapping/amount-mode validation, decimal-safe product, and preview tests.
- [ ] Add the Draft-only paste interaction using shared form/dialog primitives and EN/ID messages.
- [ ] Add a repository-backed commit hook with row results, guarded retries, and existing invalidation.
- [ ] Bind each AC to its canonical test, retaining existing budget role/state/editor contract proofs.
- [ ] Run the scoped builder gates, touched journey, and rendered budget captures during implementation;
  no code, database, or browser execution is part of this specification task.

## Out of scope

AI/OCR/document-proposed lines (#1466); client workbook templates or specific sheet/cell readers;
attachment upload/preview work (#1447 / #1406); cross-project file-import redesign; replacement or
bulk deletion of placeholder lines; automatic version creation, activation, archive, or ERP dispatch;
batch activation (#1273); formula execution; storing a new Quantity/Rate model; automatic currency
conversion; changes to fiscal-year phasing; durable replay/idempotency across separate paste sessions.

## Open questions

No additional owner decision is required to draft this bounded contract. The explicitly labelled
spec defaults above remain reviewable at sign-off; they must not be represented as verbatim owner rulings.
