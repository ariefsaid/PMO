# Purchase request lines: category and needed-by date (#2696)

Map: #2516. Not money path (no amount, approval or ledger rule changes). Builds on procurement lines
(`procurement_items`, 0001), Draft line authoring (0015, 0019, 0393) and org purchase settings
(`organizations.procurement_gates`, 0360, `procurement-flexible-entry.spec.md`). Owner rulings: `docs/decisions.md` OD-SCOPE-1, OD-SCOPE-2.

**Job story.** When any department requests, I want each line to say project or overhead and when it is needed, so purchasing plans by line.

## Findings that shape the design
- No needed-by date exists on `procurements` or `procurement_items` today (checked: `procurements` columns in 0001, 0243, 0361, 0399, 0449; `procurement_items` in 0001). A request-level needed-by therefore does not exist; this ticket adds a **per-line** date only and does not add a header date. (`material_requests.needed_by`, 1000, is a different record and is not touched.)
- `procurements.budget_category` (0243) is a fixed enum for budget routing. It is unrelated to the line category here: the line category is a client-controlled list and never drives approval routing or budget logic.
- `public.create_procurement_with_items` is NOT re-created by this ticket (parallel ticket #2697 re-creates it). The two line fields are written by a separate definer RPC, `set_procurement_line_planning`, which the create form calls after the draft exists.

## Requirements (EARS)
- **FR-PLP-001** The system shall store the line categories as organisation data in `purchase_line_categories(id, org_id, name, position, archived_at)`, one list per organisation, with `name` 1..60 characters and unique per organisation ignoring case among active rows.
- **FR-PLP-002** When an Admin turns on line planning for an organisation that has no categories, the system shall seed two general starter rows, "Project" and "Overhead". Code shall never branch on a category name; only its id is stored on a line.
- **FR-PLP-003** The system shall let only an active Admin of the organisation add, rename, reorder or retire a category, through `set_purchase_line_category(...)` / `archive_purchase_line_category(...)`; every active member of the organisation may read the list. Retiring sets `archived_at`; a retired category stays on lines that already carry it and cannot be chosen again.
- **FR-PLP-004** The system shall store the organisation setting as `organizations.purchase_line_planning boolean not null default false`, readable by active members through `get_purchase_line_planning()` and changeable only by an active Admin through `set_purchase_line_planning(boolean)`, audited.
- **FR-PLP-005** The system shall add nullable `category_id uuid` and `needed_by date` to `procurement_items`, with a composite foreign key `(org_id, category_id)` to the category list so a line cannot carry another organisation's category.
- **FR-PLP-006** While line planning is OFF, the system shall refuse any non-null `category_id` or `needed_by` on a line (trigger on `procurement_items`) and the screens shall show no new field, column or text.
- **FR-PLP-007** When line planning is ON and the case is a Draft that the caller may edit (same rule as `procurement_item_values_editable`), `set_procurement_line_planning(p_item uuid, p_category uuid, p_needed_by date)` shall set the two fields of that line; a null clears a field. It shall refuse a retired or foreign category, a non-Draft case, and a caller who may not edit the draft's lines, with the same neutral error as the other line writes.
- **FR-PLP-008** While line planning is ON, the create form and the draft's line editor shall show a Category select (active categories) and a Needed-by date on each line, both optional; the create form shall call `set_procurement_line_planning` for each filled line after the draft is created.
- **FR-PLP-009** While line planning is ON, the request detail line table shall show Category and Needed-by columns for every line (an empty value as an em dash), on desktop and as labelled rows on a phone.
- **FR-PLP-010** The system shall carry the new fields in English and Bahasa Indonesia strings and use the shared form primitives and `DESIGN.md` tokens only.
- **FR-PLP-011** Where a line of a non-Draft case already carries the two fields, the system shall keep them read-only (the trigger refuses a change unless the case is a Draft).

## Settings
| Setting | Where | Default | Who changes it |
|---|---|---|---|
| Line planning (category and needed-by per request line) | `organizations.purchase_line_planning` | OFF | Admin, Administration > purchase rules |
| Line categories (the list) | `purchase_line_categories` rows | none until planning is turned on, then two starter rows | Admin, same page |

## Default-off
Both new line columns are nullable and every existing row keeps NULL. The setting defaults to OFF, so an existing organisation sees no new field, column or string on any purchase screen, and `create_procurement_with_items`, the line RLS and every existing test are untouched. The new tables are empty until an Admin enables the setting. With the setting OFF the trigger refuses any value, so no path can fill the fields silently.

## Acceptance criteria (Given/When/Then; owning layer)
- **AC-PLP-001** (pgTAP) Given any organisation, When a member reads `purchase_line_categories`, Then they see only their own organisation's rows; a second organisation's rows are invisible, and a direct insert, update or delete by any role is refused.
- **AC-PLP-002** (pgTAP) Given an Admin, When they add, rename, reorder and retire categories through the RPCs, Then each works; Given a Project Manager, Finance or Employee, Then each call is refused with 42501.
- **AC-PLP-003** (pgTAP) Given an Admin turns planning on for an organisation with no categories, Then two starter rows exist; turning it off and on again adds no duplicates; a non-Admin is refused.
- **AC-PLP-004** (pgTAP) Given planning OFF (default), When a line insert or `set_procurement_line_planning` sets a category or date, Then it is refused; existing lines stay NULL.
- **AC-PLP-005** (pgTAP) Given planning ON and the requester's Draft, When they set category and needed-by on a line, Then both are stored; a null clears; a retired or other-organisation category is refused.
- **AC-PLP-006** (pgTAP) Given a case that is not a Draft, or a caller who is neither requester nor an allowed role, When they call the RPC, Then it is refused and the line is unchanged.
- **AC-PLP-007** (pgTAP) Given a second organisation's Admin, When they call the RPC on or read this organisation's line or category, Then nothing is found or changed.
- **AC-PLP-008** (unit, `src/lib/db/procurementLinePlanning.test.ts`) The data seam validates every field (uuid category, ISO date), maps the RPC errors, and never defaults a missing value.
- **AC-PLP-009** (unit, `ProcurementCreate.linePlanning.test.tsx`) Given planning OFF, Then the create form renders no Category or Needed-by field; Given ON, Then each line shows both, and after creation the RPC is called once per filled line.
- **AC-PLP-010** (unit, `ProcurementDetails.linePlanning.test.tsx`) Given ON, Then the line table shows Category and Needed-by (em dash when empty); Given OFF, Then neither column exists; Given a Draft, Then the fields are editable, otherwise read-only.
- **AC-PLP-011** (unit, `OrgPurchaseLines.test.tsx`) Given an Admin, When they turn planning on and add, rename and retire a category, Then the matching calls are made; a non-Admin sees no controls.
- **AC-PLP-012** (unit) Both language files carry every new key (the existing locale-parity test stays green untouched).

## Mutation checks (written here, run by the orchestrator)
Each is applied alone and must turn the named assertion of `supabase/tests/1345_purchase_line_planning.test.sql` red; restore after each.
1. Drop the Admin check in `set_purchase_line_category`: "AC-PLP-002 Finance cannot add a category".
2. Drop the OFF guard in `procurement_items_planning_guard`: "AC-PLP-004 a direct insert with a date is refused while OFF".
3. Drop the editable check in `set_procurement_line_planning`: "AC-PLP-006 a non-requester Engineer is refused".
4. A foreign category is refused by three independent layers, each bound by its own assertion (the messages differ so they cannot mask each other): 4a change the composite FK to `(category_id)`: "AC-PLP-005 foreign-key layer" (trigger disabled in the test, so only the FK can refuse); 4b drop `c.org_id = v_org` in the RPC: "AC-PLP-005 RPC layer" (asserts the RPC's own message); 4c drop `c.org_id = new.org_id` in the trigger: "AC-PLP-005 trigger layer" (direct write as the table owner, asserts the trigger's message).
5. Drop the organisation condition from the category select policy: "AC-PLP-007 org B cannot read org A categories". The other half of AC-PLP-007 (an org B Admin calling the RPC on an org A line) is refused by the item lookup, the setting and the draft-editable check together; no single mutation of them turns it red, and no claim is made for one.
6. Drop the Draft check in the guard trigger: "AC-PLP-006 trigger layer".

## As built (deviations from the first draft)
- The data seam is `src/lib/db/procurementLinePlanning.ts` with effect-based hooks (`src/hooks/usePurchaseLinePlanning.ts`), not a repository method: the repository key lists are pinned by existing tests, which stay untouched. The create page also has no query client in its existing tests, so the setting is read without one (a pending or failed read means OFF).
- The line editor is a separate panel (`LinePlanningPanel`) under the Items tab, so `LineItemsSection` and its tests are unchanged.
- `database.types.ts` gains the table, the RPCs and the optional Insert/Update columns; the `procurement_items` Row type is left alone until the next type regeneration (adding required Row fields breaks existing fixtures typed as the row).
- The pgTAP file is `supabase/tests/1345_purchase_line_planning.test.sql` (32 assertions); the e2e journey is `pmo-portal/e2e/serial/AC-PLP-009-line-planning.spec.ts` (serial lane, it flips an organisation setting). Neither was run by the builder.

## Out of scope
Rollups or reports by category, approval routing by category, a request-level needed-by date, ERP field mapping, and category history. Nothing here is deferred from the ticket.
