# Spec: Candidate work orders with an assessment checklist (#2595)

**Status:** approved scope for the 15 December 2026 release (OD-SCOPE-12; pulled forward from Q2 2027). Owner rulings OD-SCOPE-2 (no client process in code) and the choices under "Build decisions" below replace the open owner decisions. Map #2516 (contractor field operations). IDs `FR-CWO-###`, `NFR-CWO-###`, `AC-CWO-###`. Plan: `docs/plans/2026-11-21-candidate-work-orders.md`. Executor: Orca worker. **Money-adjacent, not money-path:** a candidate carries no billable value and posts nothing. Accepting it creates an ordinary **Draft** work order and stops there; the existing `Draft -> Issued` gate (witness, over-commit acknowledgement, 0193) is untouched. Because the accept step writes `work_orders`, the accept RPC ships alone with the three reviewers.

## Review 20 Nov

Read against `origin/dev`: migrations 0193, 0250, 0260, 0337, 0955, 0997 and 0999; `ProjectSections.tsx`, `Administration.tsx`, `App.tsx` and the current work-order detail route.

- The shipped work-order reference column is `client_po_number`; the candidate's optional `client_reference` now maps to it when acceptance creates a Draft. The plan names the actual work-order currency/tax fields and leaves `wo_number` for the existing issue transition.
- Candidate entry is placed in the existing Contract tab composition and Admin settings route; the RTL path follows the shipped tab test layout. Creation/decision roles are now explicit and match the access requirements.
- Acceptance criteria use Given/When/Then and each ID has one owning layer in the plan traceability table.

## Build decisions (21 Nov, OD-SCOPE applied; the recommended defaults below are taken)

- **OD-SCOPE-2: no checklist item is coded.** The eight items named in the ticket and job story are examples only. The organisation fills its own assessment items in Admin settings; the system ships **no default items**. FR-CWO-008 and AC-CWO-003 are replaced: with no saved template, a candidate is created with no items (nothing to assess) and the Draft can be accepted with a reason alone. Seed or demo data may carry sample items; migrations do not.
- **Invisible until used:** the project page shows the candidate section only when the organisation has at least one template item or the project already has a candidate. An organisation with neither sees no change to any screen; `work_orders`, its lists and its statuses are untouched (OD-CWO-1).
- OD-CWO-1..6 take their recommended defaults. OQ-CWO-1: internal reason only. OQ-CWO-2: one candidate per offer. OQ-CWO-3: Bahasa wording of the item labels is client data, so no label needs translating; only the screen strings are translated.
- Migrations 1405 to 1408 are used (1409 stayed unused). Built deviations from the first plan, all small: (1) the change trail (FR-CWO-018) is the shared audit trail (`audit_events`, who and when, before and after), not the record-history catalogue, which needs per-entity read arms and a gate for a four-table family; (2) there is no Viewer role in the database (roles: Executive, Project Manager, Finance, Engineer, Admin), so AC-CWO-008 uses Finance and another project's Project Manager as the refused callers; (3) screen strings live in the existing `project` and `administration` namespaces, not a new one; (4) the journey sits in `e2e/serial/` because the checklist is an organisation-wide setting.

## Job story

When an organisation considers a piece of work under a contract, I want to open it as a candidate, have the people who know each area check it against our own checklist (site, quantities at contract rates, material, schedule, resources, location, local issues, cost against revenue), and then accept or reject it with a reason on record, so that feasibility checks are recorded before a Draft work order is created and a rejected offer leaves a trail.

## Context and boundary (checked against `origin/dev`)

- A **work order** is the client's purchase order against a contract (`work_orders`, 0193): `project_id` not null, status enum `Draft | Issued | Closed | Cancelled`, `order_value` written only by `set_work_order_value`, `wo_number` minted at issue. Nothing exists before Draft. This spec adds the earlier stage **without adding a status to `work_orders`** (OD-CWO-1).
- **Contract** = a project with a contract value (`projects`). A candidate hangs under one project.
- Contract-rate pricing exists: `boq_items` (rate, 0250/0337) and `work_order_lines` (0337); per-contract unit rates `rate_catalogue_*` (0955). Plan figures per work order: `work_order_plan_lines` (0997). Cost reads: `work_order_cost_amounts` (0999). A candidate is not a work order, so none of these can name it yet; the assessment items hold typed values and a proof file instead (OD-CWO-3).
- File proof follows the private-bucket pattern of `attendance_photos` (1036: private bucket, size and mime limits, `file_path`).
- Audit follows `record_history_config` (0260). Soft-archive (ADR-0018); decisions are server-enforced (ADR-0019).
- No ERP write, no outbox row, no mirror change.

## Definitions

- **Candidate** = a row in `work_order_candidates`: project, title, description, offered date, optional client reference, status `assessing | accepted | rejected`.
- **Assessment checklist** = the org's active **checklist template** (ordered list of item definitions) copied onto a candidate when it is created, so a later template edit never changes an open or decided assessment.
- **Assessment item** = one copied template line on one candidate: `key`, label, `required` flag, `owner_id` (a member), `target_date`, `status` (`open | passed | failed | not_applicable`), `note`, and zero or more proof files.
- **Example items** an organisation may enter as its own template (never coded): site check, quantities priced at contract rates, material availability, schedule, resources, location, local issues, cost against revenue.
- **Ready to accept** = every `required` item is `passed` or `not_applicable` (a `not_applicable` needs a note).
- **Decision** = `accepted` or `rejected`, with `decided_by`, `decided_at` and a non-empty reason (1 to 500 characters), written only by the decision RPC.

## Requirements (EARS)

**Candidate and checklist**
- FR-CWO-001 The system shall let an Admin, Engineer or the project's Project Manager create a candidate under a project, and shall copy the organisation's active checklist template onto it in one step.
- FR-CWO-002 When a candidate is created, the system shall store its items as an independent copy; editing or archiving the template afterwards shall not alter any existing candidate.
- FR-CWO-003 The system shall let the item's owner, an Admin, an Engineer or the project's Project Manager set an item's status, note and proof; each item shall show its owner, target date and proof count.
- FR-CWO-004 The system shall let a user add an ad-hoc item to one candidate; an ad-hoc item is not in the template.
- FR-CWO-005 A proof file shall be an image or PDF in a private bucket, size-limited, and readable only by members who can read the candidate.
- FR-CWO-006 While a candidate is `accepted` or `rejected`, its items and proofs shall be read-only.

**Template**
- FR-CWO-007 The system shall let Admin edit the organisation's checklist template (add, rename, reorder, set required, archive an item). Archived items stay on candidates that already copied them.
- FR-CWO-008 Where no template item has been saved, the system shall create the candidate with no items and shall not supply any item of its own (OD-SCOPE-2).

**Decision**
- FR-CWO-009 The system shall record an accept or reject decision only through one security-definer RPC; direct updates to the decision columns shall be refused by the database.
- FR-CWO-010 When the caller is not the project's Project Manager or an Admin, the decision RPC shall refuse.
- FR-CWO-011 When any `required` item is not ready, accepting shall be refused and name the items; rejecting shall always be allowed.
- FR-CWO-012 A decision shall carry a reason; an empty or whitespace reason shall be refused.
- FR-CWO-013 When a candidate is accepted, the RPC shall create one **Draft** work order on the same project through the existing origination path, carry over the title and description, map the candidate's client reference to `work_orders.client_po_number`, store its id on the candidate, in the same transaction. Accepting twice shall return the same work order and create no second one.
- FR-CWO-014 Accepting shall never issue, price or number the work order; value, tax basis and the `Draft -> Issued` gate stay with the existing work-order flow.
- FR-CWO-015 A decided candidate shall not be reopened; a corrected decision is a new candidate that names the earlier one (`replaces_id`).

**Views and access**
- FR-CWO-016 The project page shall list its candidates with status, items passed of required, overdue items (target date before today in the organisation's timezone) and, once decided, the decision and reason.
- FR-CWO-017 Read access shall follow the work-order readers (the caller's RLS is the boundary); `org_id` is stamped by default and never sent by the client (ADR-0017).
- FR-CWO-018 Every create, item change and decision shall appear in record history with who and when.

## Non-functional requirements
- NFR-CWO-001 English and Bahasa Indonesia strings in a new namespace; `DESIGN.md` tokens; usable at phone width; the screen is composed with the `restructure` skill and judged rendered by the owner (`docs/ux/screen-rules.md`).
- NFR-CWO-002 Dates are organisation calendar dates (`org_current_month`/`default_timezone`, 0245), never browser time.
- NFR-CWO-003 RLS policies wrap caller helpers in `(select helper())` (`supabase/tests/0646_rls_initplan.test.sql`).
- NFR-CWO-004 Every migration is reversible (`supabase/migrations/rollback/`).

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CWO-001 | Given an organisation with a saved template of 3 items, when a candidate is created, then it has exactly those 3 items, each `open`. | pgTAP |
| AC-CWO-002 | Given an open candidate, when Admin renames and archives a template item, then the candidate's items are unchanged. | pgTAP |
| AC-CWO-003 | Given an organisation with no saved template, when a candidate is created, then it has no items and no item text is supplied by the system. | pgTAP |
| AC-CWO-004 | Given a candidate with one required item `open`, when the Project Manager accepts, then it is refused naming that item and no work order exists. | pgTAP |
| AC-CWO-005 | Given all required items `passed` or `not_applicable` with a note, when the Project Manager accepts with a reason, then the candidate is `accepted`, one Draft work order exists on the same project, and the candidate holds its id. | pgTAP |
| AC-CWO-006 | Given an accepted candidate, when accept is called again, then the same work order id returns and the project has one work order from it. | pgTAP |
| AC-CWO-007 | Given a candidate with failed items, when the Project Manager rejects with a reason, then it is `rejected`, no work order exists and the reason is stored. | pgTAP |
| AC-CWO-008 | Given an Engineer who is not the project's Project Manager, or a Viewer, when they call the decision RPC, then it is refused and the candidate is unchanged. | pgTAP (+ mutation check) |
| AC-CWO-009 | Given a blank reason, when accepting or rejecting, then it is refused. | pgTAP |
| AC-CWO-010 | Given an authenticated user, when they directly update candidate `status` or any decision column, then the database refuses the write. | pgTAP |
| AC-CWO-011 | Given a decided candidate, when an item or proof is edited, then it is refused. | pgTAP |
| AC-CWO-012 | Given the accepted Draft work order, when its order value or status is read, then value is 0 and status is `Draft`; no `wo_number` is minted. | pgTAP |
| AC-CWO-018 | Given an organisation with no template items and no candidates, when the project Contract tab opens, then no candidate section appears; given one template item, the section appears. | Unit (RTL) |
| AC-CWO-013 | Given a caller in another organisation, when candidates are read, then none appear. | pgTAP |
| AC-CWO-014 | Given a proof upload of a disallowed type or over the size limit, when the upload is attempted, then it is refused; given a member of another organisation, when they request the file, then it is unreadable. | pgTAP (storage policy) |
| AC-CWO-015 | Given items with target dates, when the list is derived, then passed-of-required and the overdue count use the organisation-local date. | Unit (pure function) |
| AC-CWO-016 | Given a Project Manager, when they open a project's candidate, set items, and accept, then the page shows the decision and links the new Draft work order. | E2E (one journey, owner-sketch-approved layout) |
| AC-CWO-017 | Given a rejected candidate, when a new candidate names it as `replaces_id`, then both show their links and the earlier decision is unchanged. | pgTAP |

Mutation check (ships alone): in the decision RPC, remove the Project Manager check and AC-CWO-008 must go red; drop the required-items test and AC-CWO-004 must go red; remove the idempotency guard and AC-CWO-006 must go red; restore.

## Errors
| Condition | Result |
|---|---|
| Required item not ready when accepting | Refused with the list of items; candidate stays `assessing` |
| Not the project's Project Manager or Admin | Database refusal; the screen hides the buttons (`can()` is UX only) |
| Blank reason | Refused |
| Edit after decision | Refused; shared read-only state |
| Proof wrong type or too large | Refused with the shared upload error |
| Accept finds the work-order origination refuses (for example an archived project) | Whole accept rolls back; candidate stays `assessing` with the cause shown |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-CWO-1 | A candidate is its **own table**; accept creates a Draft work order. Not a fifth status on `work_orders`. | A new status touches every work-order reader, the billing views (0262/0337), the status-keyed money gates and every `status` filter in the app; a missed one counts an unaccepted offer as committed work in work in hand or plan-vs-actual. |
| OD-CWO-2 | Decision by the project's Project Manager or Admin, with a mandatory reason. No second approver in v1. | If the owner wants dual control (assessor not the decider), a self-assessed, self-accepted candidate passes; the fix is a decider-not-owner-of-any-item rule, cheap to add before launch, a migration after. |
| OD-CWO-3 | Items hold status, note, owner, target and proof; they do **not** compute figures. "Quantities priced at contract rates" and "cost against revenue" carry the user's figures as proof (a file or note), not a live calculation. | If the owner expects a computed price and margin, the candidate needs its own quantity lines, a bridge to `work_order_lines` and a margin read, which is a larger feature; the checklist alone would be filled with unchecked figures. |
| OD-CWO-4 | Every template item is `required` by default; Admin may relax any. `not_applicable` needs a note. | Too strict and a small offer cannot be accepted without box-ticking; too loose and an unchecked site or cost item passes. |
| OD-CWO-5 | Accept creates the Draft work order with value 0; the value is set afterwards through the existing flow. | Carrying a value over would bypass `set_work_order_value`, the sole writer of `order_value` and its witness stamp. |
| OD-CWO-6 | Candidate creation and assessment are available to Admin, Engineer and the project's Project Manager; only Admin or the Project Manager decides. | Too narrow: the people with technical or commercial facts cannot complete their checks, delaying acceptance. Too wide: unauthorised staff can change an assessment or make a commercial decision. |
| OQ-CWO-1 | Does a rejected candidate need an external note or only an internal reason? Default internal only. | If an external note is expected, the decision record alone leaves the offeror without an approved response; if it is internal, exposing the reason could disclose internal assessment comments. |
| OQ-CWO-2 | Can one candidate represent multiple offers? Default one candidate per offer. | One checklist could be marked ready for a feasible offer while being used to create a Draft for a different scope, leaving the Draft without the right assessment. |
| OQ-CWO-3 | Resolved: item labels are client data; only screen strings are translated. | n/a |

## Delivery checklist
- [ ] Owner signs OD-CWO-1..6 and answers OQ-CWO-1..3.
- [ ] Owner sketch-glance of the layout before build.
- [ ] Glossary entries: candidate work order, assessment checklist (with the build).
- [ ] After release: `improve-codebase-architecture` on the changed areas.
