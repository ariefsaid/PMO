# Work-order import from a spreadsheet

Branch feat/1124d-setup · migration 2160 · proof: `supabase/tests/2160_import_work_orders.test.sql`, `pmo-portal/src/components/import/__tests__/workOrderImport.wizard.test.tsx`.

**Job story.** When a project's orders arrive as a list, an authorised user downloads a template, fills one row per work order, sees every row checked, and confirms once, so that all the orders are in the project as Drafts or none are.

## Requirements (EARS)
- **FR-WOI-001** Where the reader may create a work order, the project's customer orders offer "Import work orders", which opens the shared import wizard with a downloadable template.
- **FR-WOI-002** The template has the work orders on sheet 1 (title, client reference, area when the organisation keeps areas, start and end date, order value, tax treatment, tax amount, currency) and optional scope lines on sheet 2 (client reference, item code, quantity), then Notes. A scope line is linked to its work order by client reference.
- **FR-WOI-003** When the user confirms, the system shall create every work order as a Draft, with its area and scope lines, in one transaction; the number is minted at issue, as before.
- **FR-WOI-004** While any row is invalid or its client reference is already on the project, the system shall not enable the confirm and shall save nothing; each error names the row and the column. If the database refuses a row after the preview, nothing is saved and the row is named.
- **FR-WOI-005** Who may import is who may create a work order (`can('create','workOrder')`; the database policy is the authority). Issuing follows the existing rules.

## Acceptance criteria
- **AC-WOI-001** Given the import is opened, when the template is downloaded, then sheet order is Template, Scope lines, Notes. *(unit)*
- **AC-WOI-002** Given a clean file, when previewed, then every row is valid and confirm sends the whole batch once with area and scope lines resolved. *(unit)*
- **AC-WOI-003** Given any bad row, a reference already on the project, an unknown item code, a quantity above the contract line or a scope row naming no work order, then the error names the row/column and nothing is sent. *(unit)*
- **AC-WOI-004** Given a database refusal on one row, then nothing is saved and the row is named. *(pgTAP + unit)*
- **AC-WOI-005** Given an Engineer or another organisation, then the import is refused; a Project Manager and an Admin may import. *(pgTAP)*

## Decisions and open items
- Tax treatment is a required column: the product never defaults it (`taxTreatment.ts`). Tax amount blank means 0.
- Not imported, see `docs/briefs/decisions-1124/setup-open.md`: a per-order number (minted at issue) and a discipline (set on contract lines, not on a work order).
