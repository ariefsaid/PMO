# Work-order import from a spreadsheet

Branch feat/1124d-setup · migration 2160 · proof: `supabase/tests/2160_import_work_orders.test.sql`, `pmo-portal/src/components/import/__tests__/workOrderImport.wizard.test.tsx`.

**Job story.** When a project's orders arrive as a list, an authorised user downloads a template, fills one row per work order, sees every row checked, and confirms once, so that all the orders are in the project as Drafts or none are.

## Requirements (EARS)
- **FR-WOI-001** Where setup workflows are enabled and the reader is an Admin or the project's assigned Project Manager, the project's customer orders offer "Import work orders", which opens the shared import wizard with a downloadable template.
- **FR-WOI-002** The template has the work orders on sheet 1 (title, client reference, area when the organisation keeps areas, start and end date, order value, tax treatment, tax amount, currency) and optional scope lines on sheet 2 (client reference, item code, quantity), then Notes. A scope line is linked to its work order by client reference.
- **FR-WOI-003** When the user confirms, the system shall create every work order as a Draft, with its area and scope lines, in one transaction; the number is minted at issue, as before.
- **FR-WOI-004** While any row is invalid or its client reference is already on the project, the system shall not enable the confirm and shall save nothing; each error names the row and the column. If the database refuses a row after the preview, nothing is saved and the row is named.
- **FR-WOI-005** Only an Admin or the project's assigned Project Manager may use bulk import. The importer enforces this and the organisation's opt-in in the database; the ordinary work-order create policy stays unchanged. Issuing follows the existing rules.
- **FR-WOI-006** The workflow is off when an organisation has no setup-workflow setting row; only an Admin may enable or disable it for that organisation.
- **FR-WOI-007** After a successful import, the system shall refresh the project's work-order, drawdown, allocation, acceptance and billing reads plus the organisation-wide unbilled-work-order read.

## Acceptance criteria
- **AC-WOI-001** Given the import is opened, when the template is downloaded, then sheet order is Template, Scope lines, Notes. *(unit)*
- **AC-WOI-002** Given a clean file, when previewed, then every row is valid and confirm sends the whole batch once with area and scope lines resolved. *(unit)*
- **AC-WOI-003** Given any bad row, a reference already on the project, an unknown item code, a quantity above the contract line or a scope row naming no work order, then the error names the row/column and nothing is sent. *(unit)*
- **AC-WOI-004** Given a database refusal on one row, then nothing is saved and the row is named. *(pgTAP + unit)*
- **AC-WOI-005** Given Finance, an Executive, an Engineer, a Project Manager assigned to another project, or another organisation, then the import is refused; an Admin and the project's assigned Project Manager may import. *(pgTAP, unit)*
- **AC-WOI-006** Given an existing organisation with no setting row, then bulk import is refused until an Admin enables setup workflows. *(pgTAP, unit)*
- **AC-WOI-007** Given an imported batch, when it succeeds, then allocation, acceptance, drawdown and billing reads are invalidated. *(unit)*

## Decisions and open items
- Tax treatment is a required column: the product never defaults it (`taxTreatment.ts`). Tax amount blank means 0.
- Not imported, see `docs/briefs/decisions-1124/setup-open.md`: a per-order number (minted at issue) and a discipline (set on contract lines, not on a work order).
