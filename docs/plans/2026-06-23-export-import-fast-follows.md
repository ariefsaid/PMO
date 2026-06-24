# Plan — Export/Import fast-follows for Contacts, Projects, Procurement (2026-06-23)

Extends the shipped export (ADR-0024) + import (ADR-0027) slices to the remaining
master-data modules. **No framework, ADR, or dependency changes** — ADR-0027 already names
these "descriptor-only fast-follows", and `<ImportButton descriptor={…}>` already takes the
descriptor as a prop. Grilled + owner-confirmed 2026-06-23.

## Current state (audited)
| Module | Export | Import |
|---|---|---|
| Companies | done | done (`companyImportDescriptor`) |
| Procurement | done | **gap** |
| Contacts | `exportValue` on columns, button not wired | **gap** |
| Projects | **gap** | **gap** |

## Wave 1 — Export wiring (trivial)
- **Contacts** (`pages/Contacts.tsx`): add `exportAction={<ExportButton rows={filtered} columns={columns} entity="Contacts" />}` to `<ListPage>`. Columns already carry `exportValue`.
- **Projects** (`pages/Projects.tsx`): add `exportValue` to the exportable columns, then the same `<ExportButton>` wiring.

## Wave 2 — Import descriptors (factory pattern)
Each new descriptor is a **factory** `makeXImportDescriptor(deps)` returning an
`ImportDescriptor<Input>`. `validate`/`toInput` close over a preloaded **name→id Map** (built
from the org's full in-memory list — pages already load all rows, no pagination) + the current
user. The generic wizard/parse/validate/types are untouched.

**FK match rule (uniform):** exact name, case-insensitive. Empty optional ref → `null`.
Non-empty but **unmatched or ambiguous (duplicate name) → row fails** (lands in the wizard's
failed-rows report; ADR-0027 per-row best-effort intact). **No auto-creating** referenced records.

| Entity | Fields (`*`=required) | Refs resolved | Injected |
|---|---|---|---|
| Contacts | full_name\*, Company\*, title, email, phone, notes | Company→`company_id` | — |
| Projects | name\*, Status\* (origination only: `Leads`/`Internal Project`), Company→`client_id`, Project manager→`project_manager_id`, contract_value (opt, →0), start/end date | Company; PM (load profiles) | — |
| Procurement | title\*, Project→`project_id`, Vendor→`vendor_id`; status forced `Draft` | Project; Vendor(company) | `requested_by`=current user |

Owner-confirmed micro-decisions: import `contract_value` (yes, optional, default 0); optional
ref non-empty-no-match → fail the row; load profiles on the Projects page for PM resolution.

**Procurement import is header-only (Draft PR: title/project/vendor).** It does NOT create phase
lifecycle records (PR→RFQ→PO→Quotation→Receipt→Invoice→Payment — each its own table + RLS +
transition RPC) nor documents. Procurement documents are either metadata rows
(`procurement_documents`: type/status/ref#, no file/URL) or per-phase **binary attachments in a
private Storage bucket** (`procurement-files`; no public URL) — neither is importable from a flat
sheet. Full phase/document import is a separate program (own grill + ADR), deliberately out of
scope here (consistent with ADR-0027's "reuse the create repository, no new write path").
Procurement FK options reuse `useProjectOptions`/`useVendorOptions` (the existing cached FK hooks).

Page wiring per module: load any missing ref list, build descriptor in `useMemo`, drop
`<ImportButton entity=… descriptor=… onImported={refetch} />` beside Export.

## Tests
- Per descriptor: unit tests mirroring `companyDescriptor.test` — required-field validate,
  enum/status validate, ref-hit → id, ref-miss/ambiguous → row error, `toInput` emits no `org_id`.
- Export presence: extend `pages/__tests__/pageExport.test.tsx` to cover Contacts + Projects.
- No new e2e — the generic import-wizard journey is already covered for Companies.

## Verify
`npm run verify` from `pmo-portal/` (typecheck + lint:ci + test + build) before any PR.
