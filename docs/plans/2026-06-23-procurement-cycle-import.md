# Plan — Procurement-cycle bulk import (ADR-0035)

One-sheet, case-grouped, multi-type `.xlsx` import for the whole procure-to-pay cycle. Owner-confirmed
2026-06-23. Build is sequenced; `eng-planner` refines each milestone into 2–5-min TDD tasks at build time.

## Pre-reqs / invariants
- Reuse the ADR-0024/0027 lazy-exceljs parse seam (`src/lib/import/parseWorkbook`).
- Writes ONLY via existing create fns/RPCs — no new RLS/migration/RPC. RLS is the write authority.
- `org_id` never client-supplied; requester = importing user; PMO mints system numbers; legacy → `external_ref`.
- Insert-only v1; `MAX_IMPORT_ROWS` cap inherited; preview = zero writes.

## Sheet contract (the column set to validate against)
`case_ref`* · `type`* ∈ {PR,RFQ,Quotation,PO,GR,VI,Payment} · `project` · `title` · `case_status` ·
`vendor` (Quotation) · `external_ref` · `status` · `date` · `amount`. Case attributes read first-row-wins per `case_ref` group.

## Milestones

### M1 — Pure parse + group (no writes)
- `procurementCycle/types.ts`: `CycleRow`, `CaseGroup`, `CycleType`, result types.
- `procurementCycle/group.ts`: rows → `CaseGroup[]` keyed by `case_ref`; case attrs first-row-wins.
- Unit: PR-less case (VI+Payment only) groups correctly; multi-case sheet splits; blank `case_ref` → error row.

### M2 — Validation oracle (dry-run, pure)
- `procurementCycle/validate.ts`: per-row type-specific validation (required fields per type; enum
  statuses; `amount` numeric≥0; `date` parseable); ref resolution (project, vendor) via ADR-0027 `refLookup`;
  case-level checks (a group needs ≥1 valid case attr set).
- Unit: each type's required-field matrix; Model-C legality (no PR/PO required); unresolved project/vendor → row error.

### M3 — Ordered committer
- `procurementCycle/commit.ts`: per `CaseGroup` → `createProcurement` (case), then records in canonical
  order PR→RFQ→Quotation→PO→GR→VI→Payment, dispatching `type`→the matching create fn. Resolve the one
  intra-group settlement FK (`payments.invoice_id`→the group's VI) where present, else null. *(There is no
  `invoices.po_id`/`receipts.po_id` column — invoices/receipts anchor on `procurement_id` only; corrected 2026-06-25.)*
  Per-case: header fail → skip group; per-record best-effort with `classifyMutationError`; accumulate created/failed.
- Unit (mocked repositories): direct VI+Payment case commits with linked invoice_id (and null when no VI);
  header-fail skips children; per-record failure isolates.

### M4 — Wizard UI (preview tree + commit)
- `ProcurementCycleImport*` (wizard variant of ADR-0027 FSM): upload → map → **grouped preview tree**
  (case → its records, with valid/error badges) → confirm → result (created/failed per case+record).
- Reuse `<ImportButton>`-style `can('create','procurement')` gate. Lazy exceljs.
- Component unit tests (Vitest/RTL): preview renders the case/record tree; confirm calls commit; error rows surfaced.

### M5 — Page wiring + acceptance
- `pages/Procurement.tsx`: add the cycle-import affordance (distinct from the existing header `<ImportButton>`,
  or replace it — decide at build: likely a single Import entry offering "headers" vs "full cycle", or just cycle).
- e2e (`qa-acceptance`, Playwright): one curated journey — import a sheet containing (a) a full PR→Payment case
  and (b) a PR-less VI→Payment case; assert both cases + their records appear in the ledger with correct
  external refs and null settlement FKs where expected. Tag the owning `AC-IMP-CYCLE-###`.

## Verify
`npm run verify` from `pmo-portal/` before any PR; pgTAP unaffected (no schema change); e2e for M5.

## Open at build time (flag to owner/eng-planner)
- Original **requester** per case: v1 = importing user. Importing the historical requester (name→id) is a
  follow-up column if needed.
- Case **`type`** attribute + **`case_status`** enum surface: confirm the exact allowed values from the
  procurement status model when wiring validation.
- Whether the existing header `<ImportButton>` (ADR-0027 procurement descriptor) stays alongside the cycle
  import or is subsumed by it.
