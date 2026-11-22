# Feature: A read-only suggestion for the site cash plan: open purchase requests

> **Status:** Re-scoped by the coordinator (steering correction, binding): a READ-ONLY SUGGESTION beside the monthly plan. It
> replaces the earlier design (work-order split table and a period money read), which is withdrawn and reverted. Extends
> `docs/specs/site-imprest.spec.md` (#1515). Plan: `docs/plans/2026-11-22-cash-advance-estimate.md`.
> **IDs:** `FR-CAE-###`, `AC-CAE-###`.

## 1. Job story

*When I plan site cash, I want to see what is about to be bought for this site (the open purchase requests, by purpose and
work order) and start the plan from it, so that the advance I plan for matches what is coming, not only the current balance.*

## 2. Today (verified on this branch)

- **Balance and position:** `get_imprest_position` (`supabase/migrations/0424_imprest_position.sql`; `gap` = limit minus held
  cash) shown as "Still needed" at `pmo-portal/pages/ImprestFloatDetail.tsx` and `pmo-portal/pages/ImprestFloats.tsx`.
- **Monthly plan per purpose:** `imprest_plans` / `imprest_plan_lines` (`0422_imprest_floats_plans.sql`; approval in
  `transition_imprest_plan`, live definition `0534_feature_enforcement.sql`); editor `pmo-portal/pages/imprest/PlansSection.tsx`
  (create a Draft for this or next month, add one line per budget category, submit). Plan usage per purpose for the month:
  `get_imprest_plan_usage`.
- **Purchase requests:** the `procurements` aggregate (`0001_init_schema.sql`; `budget_category` = the purpose, `project_id`,
  `status`, `total_value`), lines in `procurement_items`, the request record in `purchase_requests` (`work_order_id` from
  migration 1029, ADR-0104). The price-hiding read path is `procurements_masked` / `procurement_items_masked` (1216). Read scope
  today: org members; outside Admin, Executive, Project Manager and Finance only the requests one raised
  (`0350_engineer_purchasing_scope.sql`); light accounts are confined by the restrictive policies of 1205-1229.
- **Not present:** nothing on the site cash screen shows what is about to be bought, and the plan editor starts empty.

## 3. Design

No new table, no write, no approval change, no setting, no new money function. One **security-invoker read**,
`get_imprest_open_requests(float)`, over the masked views: it inherits exactly what the caller already sees on the purchase list
(org scope, requester-only scope, light-account policies, hidden prices). It returns, for the float's project, the requests that
are **open**: status Requested, Approved, Vendor Quoted or Quote Selected (submitted, not yet Ordered, Received, Invoiced or
Paid; Draft, Rejected and Cancelled are not requests to buy). One row per request line (a request with no line is one row).
Bounded at 501 rows; the screen shows 500 and says when there are more.

The site cash screen shows them beside the plan: grouped by purpose (the request's budget category) and, within it, by work order
(the request's first purchase-request record that names one; "No work order" otherwise), each request with its number (a link to
the request), title, status, total and lines. **"Start the plan from these"** opens the plan editor pre-filled with one line per
purpose (sum of that purpose's open requests in the site cash's currency); the person edits or removes lines and chooses
**Create draft plan**, which uses the existing plan path (create a Draft, save each line). Nothing is saved before that;
submission and approval are unchanged. No customer formula: the figures are the requests' own totals.

## 4. Requirements (EARS)

- **FR-CAE-001** When a person who may see the float opens it, the system shall list the open purchase requests of the float's
  project (statuses above) and no others: not Draft, Ordered, Received, Invoiced, Paid, Cancelled or Rejected, not another
  project's, not another organisation's.
- **FR-CAE-002** The system shall show each request with its number, title, status, total and lines, grouped by purpose, then by
  work order where the data has one.
- **FR-CAE-003** When the viewer may create plans and chooses "Start the plan from these", the system shall open the plan editor
  with one amount per purpose, editable and removable, and shall write nothing until the person chooses "Create draft plan".
- **FR-CAE-004** The read shall return only what the caller may already read on the purchase list: nothing to an Engineer, a
  light account, another organisation or a signed-out caller; prices as null where the caller may not see prices.
- **FR-CAE-005** While prices are hidden from the viewer, or no request has a purpose and a price in the float's currency, the
  action shall be disabled and say why; requests with no purpose, no visible price or another currency are listed but not counted,
  and the screen says how many.
- **FR-CAE-006** While no request is open, the screen shall say what is missing and who raises one (project members, under
  Procurement) and show no action.
- **FR-CAE-007** The save shall use the existing plan path only; a line that fails to save is told and the draft opens so the person
  adds it; a plan that cannot be created saves nothing.
- **FR-CAE-008** Every sentence shall exist in English and Bahasa Indonesia (the catalogue parity test). The read raises no new
  refusal; the plan path keeps its own.
- **FR-CAE-009** The screen shall read at 390 px and 1440 px with the design tokens and shared primitives.

## 5. Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-CAE-001 | Given requests in every status, when the read runs for the float, then only Requested, Approved, Vendor Quoted and Quote Selected of the float's project return | pgTAP |
| AC-CAE-002 | Given a request with two lines, one with none, then each line returns with the request total and purpose; the one with no line returns once; the screen groups by purpose and work order | pgTAP + Vitest |
| AC-CAE-003 | Given open requests, when the viewer chooses Start the plan, then the editor is pre-filled per purpose, editable, writes nothing until Create draft plan, and saves through the existing plan path | Vitest |
| AC-CAE-004 | Given requests of another project and another organisation, then neither returns | pgTAP |
| AC-CAE-005 | Given a PM, Finance, an Executive, an Engineer (even a requester), a light account, another organisation, a signed-out role, then the first three read the list and the rest read nothing | pgTAP |
| AC-CAE-006 | Given an archived float, then nothing returns | pgTAP |
| AC-CAE-007 | Given hidden prices, then the action is disabled with the reason | Vitest |
| AC-CAE-008 | Given no open request, then the empty state names what is missing and who raises one, and shows no action | Vitest |
| AC-CAE-009 | Given Bahasa Indonesia, then the section reads in it; en and id catalogues match | Vitest |
| AC-CAE-010 | The journey shows the section on the site cash page and opens and discards the pre-filled editor | e2e step (written, not run) |

Mutation check (header of `supabase/tests/1890_imprest_open_requests.test.sql`): drop the status filter, then AC-CAE-001 reddens;
drop the project match, then AC-CAE-004 reddens; make the read `security definer`, then AC-CAE-005 reddens.

## 6. Settings added

None. It changes no money figure, approval route or who may see a record (it shows only what the viewer already sees), so it
is on for every organisation with no switch.

## 7. Existing tests whose steps change

`pages/ImprestFloatDetail.test.tsx` and `.floor.test.tsx` mock the new section (proven by its own test). The e2e journey
`e2e/AC-IMP-090-site-imprest-journey.spec.ts` gains one step; its goal oracles are unchanged.

## 8. Questions only the customer can answer

| # | Question | Recommended answer (built) |
|---|---|---|
| OQ-CAE-1 | Should a Draft request count? | No: a Draft is not yet a request to buy. |
| OQ-CAE-2 | Which date does a suggestion belong to? | None: the list is what is open now; the person chooses this or next month in the plan editor. |
| OQ-CAE-3 | Should the suggestion subtract cash already in hand? | No: it only suggests plan lines; the existing position shows cash. |
