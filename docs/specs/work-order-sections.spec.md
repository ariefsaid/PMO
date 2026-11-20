# Spec: Work-order sections (fronts) (#2576)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-WOS-###`, `NFR-WOS-###`, `AC-WOS-###`. Plan: `docs/plans/2026-11-20-work-order-sections.md`. Executor: Orca worker for the section master, roll-up reads and screens; the material-request link touches the approval and stock path and is Director-dispatched, shipping alone. Map #2516 (after go-live, Q2). Depends on shipped #2517 (work order on cost lines), #2519 plan lines (`0997`) and #2524 material requests (`1000`/`1001`). Soft dependencies on **unshipped** #2528 (crews and roster), #1522 (daily site report), #2531 (tasks per work order) and #2529 (terminology): each child link ships when its owner ships (see Delivery checklist).

## Job story

When a work order covers several places or scopes, I want to split it into sections, each with its crew and foreman, so that plans, material checks, progress and readiness are held per section and still add up to the work order.

## Context and boundary

- A **section** is an optional child of one work order. A work order with no sections behaves exactly as it does today: no screen, read or rule changes for it (AC-WOS-001).
- Sections divide a work order; they do not replace it. Money, billing, acceptance, order value and status stay on the work order. A section has no value, invoice or approval of its own.
- Every child record that can name a section already names the work order; the section is an additional, optional pointer that must belong to the **same** work order, enforced by a composite foreign key, not by the client.
- Only "plans, material checks, progress and readiness" are asked for. Cost attribution (the seven #2517 cost sources) does **not** gain a section in this spec (OD-WOS-4). Weekly plans and richer readiness checklists are asked for by one source only and are **out of scope** (OD-WOS-5).
- Naming: the PMO term stays the generic "section". An organisation's own word is applied through the terminology seam (see NFR-WOS-004), not hard-coded.

## Shipped facts relied on (checked 2026-11-20)

- `work_orders` (`0193`): `id`, `org_id`, `project_id` (not null, immutable), `status` (`Draft`/`Issued`/`Closed`/`Cancelled`), currency pinned to the project's. Work orders are never hard-deleted by users.
- `work_order_plan_lines` (`0997`): `work_order_id`, optional `discipline_id`, `kind` in (`direct_budget`, `indirect_budget`, `equipment_hours`, `crew_hours`), one row per work order x discipline x kind (unique index); guard trigger `check_work_order_plan_line` keeps org/project coherence and freezes a Cancelled work order.
- `material_requests` / `material_request_lines` (`1000`, `1001`): header carries `work_order_id` and `project_id`; lines carry `plan_qty` (snapshot at submission, from `mrq_plan_quantity`: the work order's allocated BoQ material allowance) and `prior_qty`; statuses `draft`, `pending`, `approved`, `rejected`, `cancelled`, `fulfilled`.
- Cost spine (`0951`): nullable `work_order_id` + `discipline_id` on seven cost sources and the `security_invoker` view `work_order_cost_lines`. Untouched by this spec.
- Archive convention: additive `archived_at` (ADR-0018). Org seam: `org_id` default plus `stamp_org_id()` trigger, RLS on every table.
- Terminology today: `pmo-portal/src/lib/i18n/terms.ts` (`useTerms()`, keys under `common:terms.*`, e.g. `clientWorkOrder`). The organisation-editable dictionary (#2529) is **open and unshipped**; there is no per-org override store yet.

## Definitions (used by the acceptance criteria)

- **Sectioned record**: a plan line, material request, task, crew roster placement or daily-report progress line whose `section_id` is set. **Unsectioned remainder**: the same record kinds on the work order with `section_id` null.
- **Roll-up** of a quantity Q for a work order = sum of Q over every section + the unsectioned remainder. Because every record keeps its `work_order_id`, the work-order total is the sum of *all* records on the work order, so the roll-up equals it by construction. This is the **roll-up invariant**: for every work order and every measure, `sum(sections) + remainder = work-order total` exactly (exact decimals, no rounding in between).
- **Readiness** (held, not computed): one of `not_ready`, `ready`, `blocked`, with an optional note, who set it and when. A section is created `not_ready`.
- **Work-order readiness roll-up**: counts of live sections per readiness value, and "all sections ready" when the work order has at least one live section and every live section is `ready`. A work order with no live section has no readiness roll-up.
- **Live section**: not archived.

## Requirements (EARS)

**Section master**
- FR-WOS-001 The system shall let an authorized user add a section to a work order with a code (unique per work order), a name, an optional location or scope note and an optional foreman.
- FR-WOS-002 The foreman, when set, shall be an active user of the same organisation. The system shall not require one.
- FR-WOS-003 The system shall let an authorized user edit a section's name, note, foreman and sort order, and shall keep every change in record history with actor and time.
- FR-WOS-004 Where a work order is `Cancelled`, the system shall refuse new sections and any change to its sections. Where it is `Closed`, the system shall refuse new sections but still allow readiness updates and archive.
- FR-WOS-005 The system shall archive a section (ADR-0018) rather than delete it. A section shall not be archived while it has a `draft` or `pending` material request or a task that is not Done. An archived section is not offered on new records and is refused on a new or moved record; records already pointing at it keep it.
- FR-WOS-006 The system shall permit hard delete only for an Admin and only while nothing references the section; a referenced section's delete is blocked by the foreign key and reported as "in use".
- FR-WOS-007 A section's work order, project and organisation are fixed once created.

**Child records name a section**
- FR-WOS-008 Plan lines shall carry an optional `section_id`. The one-per-kind uniqueness shall become one per work order x section (or none) x discipline (or none) x kind.
- FR-WOS-009 A material request shall carry an optional `section_id`, editable only while the request is editable (`draft` or after a return). Its lines' plan and prior quantities shall be shown against the section's planned quantity where one is set (FR-WOS-013) and always against the work order's plan, which is unchanged.
- FR-WOS-010 Where #2528 has shipped, a crew roster placement on a work order shall carry an optional `section_id`, so a crew works one section on a date range; the same crew shall not be placed on two sections of one work order on overlapping dates. A section's crew is the set of crews placed on it for a date.
- FR-WOS-011 Where #1522 has shipped, a daily-report progress line shall carry an optional `section_id`. Where #2531 has shipped, a task on a work order shall carry an optional `section_id`.
- FR-WOS-012 A child record shall be refused if its `section_id` names a section of a different work order, project or organisation, whichever path wrote it. A record with no section is always valid.

**Per-section plans and material checks**
- FR-WOS-013 The system shall let an authorized user set a **planned material quantity** per section and stock item, as an allocation of the work order's planned quantity for that item. The sum of section allocations for an item shall not exceed the work order's planned quantity (refused on write); if the work order's plan later falls below the sum, the screen shall flag the item as over-allocated rather than rewrite anything.
- FR-WOS-014 The system shall show, per section, the **material check**: for each item, section plan, requested (pending, approved, fulfilled, as defined by the shipped prior-quantity rule), and remaining; and the same three figures for the unsectioned remainder.
- FR-WOS-015 A material request line over its section's plan shall require the existing over-plan reason (1 to 500 characters), exactly as for the work order's plan; the stricter of the two checks applies. A section with no allocation for the item is checked against the work order's plan only.

**Progress**
- FR-WOS-016 The system shall show, per section, progress from records the section owns: validated daily quantities per contract item (where #1522 has shipped) and tasks Done of tasks total (where #2531 has shipped). Until a source ships its measure is absent, never zero-filled.
- FR-WOS-017 The work order's figures shall be the sum over sections plus the remainder (the roll-up invariant), by the same SQL read, not recomputed in the client.
- FR-WOS-018 Section progress shall be display only; it never changes a contract quantity, progress claim, acceptance or invoice.

**Readiness**
- FR-WOS-019 The system shall let an authorized user, or the section's foreman, set the section's readiness and note; each change is kept in history with actor and time.
- FR-WOS-020 The work-order screen shall show the readiness roll-up (counts per value and "all ready"); readiness shall not gate any transition, approval or posting (OD-WOS-5).

**Screens and reads**
- FR-WOS-021 The work-order record page shall list sections with code, name, foreman, crew for today, readiness, plan and progress, and a row for the unsectioned remainder labelled "Not in a section". It shall appear only when the work order has at least one section or the user can add one.
- FR-WOS-022 Lists filter by work order, section, readiness and archived state, with stable order and bounded pagination.

**Access**
- FR-WOS-023 Actions (create, edit, archive, delete, set readiness, set section plan) shall be registered in the role matrix (#902) and gated by `can()`; RLS/RPC enforce. Roles that may write the work order's plan figures may write section structure and section plans; the foreman may only set readiness on their own section; read follows work-order read.
- FR-WOS-024 Every new table carries `org_id` by default, RLS with each caller-context helper wrapped as `(select helper())`, and the audit and history hooks used by comparable tables.

## Non-functional requirements
- NFR-WOS-001 Roll-up for one work order with 50 sections and 10,000 child rows is one indexed read with bounded pagination; indexes on `(work_order_id, section_id)` on each child.
- NFR-WOS-002 Phone-usable section list and readiness toggle (320px, large tap targets), `DESIGN.md` tokens, English and Bahasa Indonesia, keyboard accessible.
- NFR-WOS-003 All quantities and money exact decimals; rounding only at display.
- NFR-WOS-004 No hard-coded "section"/"front" on screens, exports or notifications: every use goes through `useTerms()` (`common:terms.section`, with English default "Section" and Bahasa "Bagian"). When #2529 ships, its per-org override applies to this key with no further change here; this ticket adds the key and uses it everywhere, so #2529's "find hard-coded uses" check has nothing to find.
- NFR-WOS-005 Adding sections is additive and reversible: every migration has a rollback file; a work order with no sections reads identically before and after.

## Acceptance criteria and owning layer

Fixture used below: work order W with plan lines direct budget 1,000.00 (section A 400.00, section B 350.00, none 250.00) and an item "cable" with W plan 100, section A allocation 60, section B allocation 30; requests pending/approved on W: A 40, B 10, none 20.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WOS-001 | Given a work order with no sections, when its page and reads run, then output is identical to before the feature (no section row, same totals, same material check). | Unit + pgTAP |
| AC-WOS-002 | Given the fixture, when roll-up is read, then direct budget is A 400.00 + B 350.00 + remainder 250.00 = 1,000.00 = the work-order total, exactly; cable requested is 40 + 10 + 20 = 70. | Unit (pure function) + pgTAP (read) |
| AC-WOS-003 | Given a section of work order W1, when a plan line, material request or other child on W2 names it, then refused by the composite foreign key; on W1 it is accepted; with no section it is accepted. | pgTAP |
| AC-WOS-004 | Given two sections in one work order, when a second section reuses a code, then refused; archived sections free nothing (code stays reserved). | pgTAP |
| AC-WOS-005 | Given a Cancelled work order, when a section is added or edited, then refused; on a Closed one add is refused and readiness update is accepted. | pgTAP |
| AC-WOS-006 | Given a section with a `pending` material request, when archived, then refused with the blocking reason; with none open it archives and is then not offered on a new request but its old requests still show it. | pgTAP |
| AC-WOS-007 | Given a referenced section, when an Admin deletes it, then blocked as "in use"; an unreferenced one deletes; a non-Admin delete is refused. | pgTAP |
| AC-WOS-008 | Given allocations for cable of 60 (A) and 30 (B) against a work-order plan of 100, when B is raised to 50, then refused; when the work order's plan later drops to 80, then the item is flagged over-allocated and no figure is rewritten. | pgTAP + Unit |
| AC-WOS-009 | Given a request line of 25 cable on section A whose requested total would be 65 against A's allocation 60, when submitted without a reason, then refused; with a reason it is accepted; the work-order check still applies independently. | pgTAP |
| AC-WOS-010 | Given a section with no cable allocation, when a line for cable is submitted on it, then it is checked against the work order's plan only. | pgTAP |
| AC-WOS-011 | Given a material request in `approved`, when its section is changed, then refused; in `draft` it is accepted. | pgTAP |
| AC-WOS-012 | Given a plan line change moving a figure between sections, when the work order's total is read, then it is unchanged and each section's figure moves by exactly that amount. | Unit + pgTAP |
| AC-WOS-013 | Given readiness changes on a section, when history is read, then each change shows actor, time and note; a section starts `not_ready`. | pgTAP |
| AC-WOS-014 | Given sections ready, ready and blocked, when the roll-up is read, then counts are 2/0/1 and "all ready" is false; with all ready it is true; with no live section there is no roll-up. | Unit |
| AC-WOS-015 | Given the section's foreman, when they set readiness on their own section it is accepted; on another section or to edit plans it is refused. | pgTAP |
| AC-WOS-016 | Given a user in another organisation or without permission, when they read or write sections or their plans, then refused. | pgTAP |
| AC-WOS-017 | Given #2528 shipped and crew X placed on section A from day 1 to 10, when X is placed on section B of the same work order on day 5, then refused; from day 11 accepted. | pgTAP |
| AC-WOS-018 | Given an organisation that renamed the term (once #2529 ships) or the default, when the section list, filters, empty state and notifications render, then they use the term from `useTerms()`; the hard-coded-use check finds none. | Unit |
| AC-WOS-019 | Given a project manager on the work-order page, when they add two sections with foremen and planned amounts, request material on one, set it ready and read the roll-up, then the figures match AC-WOS-002 and the readiness roll-up shows it. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Duplicate section code on the work order | Field error |
| Child names a section of another work order | Refused (`WOS_SECTION_WO`, 23503/23514), no write |
| Archive blocked by open requests or tasks | Refused with the blocking count |
| Section on a Cancelled work order | Refused |
| Allocation sum above the work-order plan | Refused with the plan figure |
| Delete of a referenced section | "In use" (23503) |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-WOS-1 | A work order has zero or more sections; none is mandatory and records may stay unsectioned (the remainder). | If every record must be sectioned, existing work orders and every shipped create path would be blocked or need a backfill. |
| OD-WOS-2 | The foreman is one user of the organisation, optional. | If foremen are vendor workers with no login, they cannot be named; a worker-based foreman needs #2528's worker record, a later change. |
| OD-WOS-3 | Section is a flat list per work order, no nesting. | If sections must nest (area, then sub-area), a parent pointer and roll-up depth are needed; today's flat roll-up stays correct for the leaf level. |
| OD-WOS-4 | Cost attribution does not gain a section; cost stays per work order and discipline. | If costs must be seen per section, `section_id` is added to the seven #2517 sources and the view, a larger change than the rest of this spec. |
| OD-WOS-5 | Readiness is one held value with a note and rolls up as counts; it gates nothing. Weekly plans and readiness checklists are out of scope. | If readiness must gate work starting or material approval, the held value is too weak and a checklist model is needed; one source only asked for it, so it is not assumed. |
| OD-WOS-6 | Per-section material allocation is optional; the work-order plan check always applies and the stricter applies. | If sections must be the only check, an unallocated section would block all requests. |
| OD-WOS-7 | The English term is "Section"; Bahasa "Bagian"; the client's word comes through the terminology dictionary. | A wrong default word shows on every screen until the org renames it. |
| OQ-WOS-1 | Is a crew placed on a section, or on the work order with the foreman choosing the section per day? Default: placed on a section by date range. | Crew-per-day section choice needs an attendance-level pointer, a different table. |
| OQ-WOS-2 | Should progress percent per section be value-weighted or quantity-weighted? Default: show quantities and task counts only, no single percent. | A single percent invites a second formula against the shipped value-weighted work-order percent. |

## Delivery checklist
- [ ] Owner signs OD-WOS-1..7, answers OQ-WOS-1..2.
- [ ] Slice order: section master and roll-up read; plan-line and material-request links (the latter alone); crew, daily-report and task links each when #2528, #1522, #2531 ship; terminology key now, override when #2529 ships.
- [ ] Glossary: section, unsectioned remainder, roll-up invariant, readiness (section), section allocation.
- [ ] ADR candidate: composite-FK "child belongs to the same parent" pattern, if a second feature adopts it.
