# Spec: Third-party inspection tracker with cost (#2580)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-TPI-###`, `NFR-TPI-###`, `AC-TPI-###`. Plan: `docs/plans/2026-11-20-third-party-inspections.md`. Executor: Orca worker for the tracker, screens and prerequisite read; the purchase link and cost read are a money path and are Director-dispatched, shipping alone. Map #2516; blocked by #2517 (cost attribution, ADR-0104, shipped on `dev`); the per-section link is blocked by #2576 (work-order sections, open, nothing shipped: see FR-TPI-004). Feeds #2522 (billing stage checklist) and the readiness checks of #2576 as a read-only prerequisite; does not build either.

## Review 20 Nov

Read against `0035`, `0036`, `0028`, `0449`, `0950`-`0952`, `0999`, `0260` and `policy.ts` on `origin/dev` and `origin/land/1215-r1` (billing stages is `1021` on the landing branch; neither branch has an inspection entity, so this is not a reinvention).

- **The section AC claimed a check the schema cannot make.** With no sections table, a bare uuid cannot be validated; FR-TPI-004 and AC-TPI-009 now refuse any non-null `section_id` (`TPI_SECTION_UNAVAILABLE`) until #2576 adds the foreign key, and the same-work-order refusal is #2576's test. The context's claim that #2576 had no spec was also wrong: `docs/specs/work-order-sections.spec.md` exists; only its table is unshipped.
- **Cancelling could bypass a gate.** FR-TPI-003 now allows cancellation only for a tracked-only inspection (creator while requested, or a manager); a required one is reported or waived, so OD-TPI-8 and AC-TPI-010 carry the rule.
- **Money visibility is server-side.** FR-TPI-008 now says the cost read returns null amounts to a caller outside Admin/Executive/Finance/Project Manager, matching AC-TPI-001; the screen is not the fence.
- **"A result" was satisfiable by the default.** FR-TPI-013 and AC-TPI-005 require `pass`/`fail`/`conditional`, and the 10-file cap is refused in the database.
- **A waiver on a tracked-only inspection is meaningless.** FR-TPI-014 refuses it (`TPI_WAIVE_NOT_REQUIRED`), and AC-TPI-008 now covers it.
- **Untestable ACs reworded.** AC-TPI-002 asserts the exact written rows, and AC-TPI-012 asserts advancing/reporting/waiving leaves a blocked bill's match state unchanged (rather than restating #2525's own AC).
- **Project and org scope made explicit.** FR-TPI-001 derives the project from the work order and refuses a Cancelled or foreign work order; FR-TPI-007/AC-TPI-003 refuse a case of another organisation.

Open owner decisions: OD-TPI-1..7 plus the new **OD-TPI-8** (cancel rule); OQ-TPI-1..4. Build note: the record-history catalog gate hard-codes 17 registered entities; the inspection row registration must bump it and add a visibility arm (plan corrected).

## Job story

When an external body must test or inspect part of a work order, I want to track each test from request through purchase, invitation, execution and report, with its cost on the work order, so that the work order is not billed or declared ready before the required reports exist, and the cost of every test is on the right work order.

## Context and boundary

- A **third-party inspection** is one external test or inspection of a work order (or of one of its sections), done by an outside company (a vendor, an existing `companies` row), whose cost is bought through procurement.
- Cost reuses procurement end to end. The inspection **links** to a procurement case (`procurements`, with its `purchase_requests`, `purchase_orders`, `procurement_receipts`, `procurement_invoices`); cost attribution (#2517) already stamps `work_order_id` on those records and the database already refuses a work order of another project (`check_cost_attribution`). This feature adds **no cost table, no cost writer and no posting path**. Its cost figures are a read of the linked case's records already attributed to the same work order.
- **`estimate` is a planning figure.** The optional estimate and currency on an inspection are the requester's expectation of the test price. They never post cost, never create or fill a purchase record, are not used in any total, roll-up or the prerequisite read, and are shown only beside the real cost, labelled "estimate". Only records of the linked procurement case carry cost.
- Approvals, SoD, three-way match (#2525), payment and ERP outbox all stay procurement's. An inspection never approves, posts or pays anything.
- Sections do not exist yet (#2576: no table shipped; its spec is open in `docs/specs/work-order-sections.spec.md`). The inspection carries a nullable section reference, hidden until #2576 ships (FR-TPI-004).
- The report is an attachment (shared private file mechanism, as `purchase_request_files`). A vendor portal, e-mail send to the vendor and any lab-system integration are out of scope; an invitation is recorded by hand (who, when, how). Any later automation goes behind the connector seam.

## Definitions

- **Inspection status** (ordered): `requested` -> `purchase_raised` -> `invited` -> `executed` -> `reported`; `cancelled` from any status before `reported`, and only when the inspection is required for no gate (FR-TPI-003).
- **Result**: `pending` (default), `pass`, `fail`, `conditional`. Set when the report is recorded.
- **Required for**: a set of gates this inspection blocks, any of `readiness`, `billing`; empty means tracked only.
- **Complete** (the prerequisite meaning): status `reported` and result `pass` or `conditional`, or a recorded **waiver** (FR-TPI-014). `fail` and `pending` are not complete (OD-TPI-2); only an inspection required for no gate may be cancelled (FR-TPI-003), so a required inspection cannot leave the gate by cancellation.
- **Inspection cost**: read through the shipped `work_order_cost_lines` view (#2517), which names each cost record by `source` and `record_id` but carries no money and no case id. The read keeps the lines whose `work_order_id` is the inspection's and whose record (joined by `record_id` to `purchase_orders` / `procurement_invoices`) belongs to the linked case, then takes the amounts from those procurement rows, per currency (never blended). **Committed** = `purchase_order` lines whose order status is `Issued`, `Acknowledged` or `Closed` (the check constraint on `purchase_orders.status`, 0035, allows `Draft`, `Issued`, `Acknowledged`, `Closed`; no later migration changes it); a `Draft` order is not a commitment and is excluded; **billed** = `vendor_bill` lines, excluding voided and ERP-cancelled bills as the work-order cost amounts of #2519 do. An **actual (paid)** figure, where wanted, is taken from the shipped `work_order_cost_amounts(project_id)` rows with the same `record_id`s, so it can never disagree with the work-order plan-versus-actual. Money is visible to Admin, Executive, Finance and Project Manager only (the roles of that read); other roles see the status without amounts.

## Requirements (EARS)

**Tracking**
- FR-TPI-001 The system shall let an authorized user create an inspection on a work order with a title, test kind (text from an organisation list, OQ-TPI-1), planned date, optional vendor (company), optional estimate and currency (a planning figure only: see Context), optional note, and the `required for` gates. The work order's project is derived on the server, never chosen by the client; a work order of another organisation or a Cancelled one is refused (`TPI_WO_SCOPE`).
- FR-TPI-002 The system shall move an inspection only forward through the status order via one RPC per step, each stamping the date and actor; no client may write `status` directly.
- FR-TPI-003 When an inspection is cancelled, the system shall require a reason and keep the row and its history; archived, never hard-deleted (ADR-0018). Only an inspection required for **no** gate may be cancelled; a required one is reported or waived (FR-TPI-014), so cancellation can never drop a gate. The creator may cancel while the inspection is `requested`; a Project Manager, Finance or Admin may cancel any tracked-only inspection (`.cancel`, FR-TPI-019).
- FR-TPI-004 The inspection shall carry a nullable `section_id`. Until #2576 ships there is no sections table, so the server refuses any non-null value (`TPI_SECTION_UNAVAILABLE`) and the screen does not show the field; that later migration adds the foreign key and the same-work-order/organisation check, and the screen offers the picker then. Roll-up per work order (counts by status) shall work with the section null.
- FR-TPI-005 Every status step and the waiver shall be audited in record history with actor and time. The inspection row is the tracked entity; its report-file rows are append-only (FR-TPI-015) and are not a second tracked entity.

**Purchase and cost**
- FR-TPI-006 When an inspection is `requested`, the system shall let a Project Manager, Finance or Admin raise its purchase: one RPC creates a Draft procurement case on the inspection's project with the inspection's vendor in its header by calling the shipped `create_procurement_with_items(p_id, p_header, p_items)` (0449; no direct insert into any procurement table), or links an existing unlinked case, and moves the inspection to `purchase_raised`. On a linked existing case it attributes that case's existing purchase request, purchase order, goods receipt and vendor bill rows to the inspection's work order through the shipped `set_cost_attribution` (0951, FR-TPI-021). It does not call `create_purchase_request` or `create_purchase_order`: the request and order are created by procurement's own flow, and the estimate is never copied into them.
- FR-TPI-021 When a purchase request, purchase order, goods receipt or vendor bill is inserted with a null `work_order_id` and its `procurement_id` is linked from a non-cancelled `third_party_inspections` row, the system shall fill `work_order_id` with that inspection's work order; it shall never overwrite a value already set, and shall touch no other column. The filled value then passes through the shipped `check_cost_attribution` rule like any other, and an explicitly set different work order is kept and validated by it, not replaced (OD-TPI-6).
- FR-TPI-007 The system shall refuse linking a case of another organisation or project, whose records name another work order, or that another inspection already holds (`procurement_id` is unique on the tracker, so a case is linked by at most one inspection and an inspection has at most one case).
- FR-TPI-008 The system shall show each inspection's committed and billed cost, per currency, from the linked case, never entered by hand and never written by this feature. The read enforces the money roles on the server: a caller outside Admin, Executive, Finance and Project Manager receives the rows with no amounts (null), not amounts hidden only by the screen.
- FR-TPI-009 The work-order cost read of #2517 shall include these purchases unchanged; project totals shall not change because an inspection exists (NFR-WCA-001 holds).
- FR-TPI-010 Cost approval, SoD, three-way match and payment shall apply to the linked case exactly as to any purchase; the inspection tracker shall not offer a way around them.

**Invitation, execution, report**
- FR-TPI-011 `invited` requires the purchase raised, and records invitation date, who was invited (free text or the vendor contact) and how (note).
- FR-TPI-012 `executed` requires `invited` and records the execution date, which shall not be in the future.
- FR-TPI-013 `reported` requires `executed`, at least one report attachment (file, uploader, time; PDF/image/Office types, 15 MB each, capped at 10 live attachments, kept in a new private bucket, see the plan: the shipped procurement bucket is 5 MB and closed to the Engineer role) and a result of `pass`, `fail` or `conditional` (not the `pending` default). The database refuses the step without them and refuses an 11th live attachment; the future-date rule on the execution date is FR-TPI-012.
- FR-TPI-014 Where an inspection is `required for` a gate and is not complete, a Project Manager, Finance or Admin may record a **waiver** with a mandatory reason; it is audited, and shows on the prerequisite read. A waiver on an inspection required for no gate is refused (`TPI_WAIVE_NOT_REQUIRED`): there is no gate to release. A person shall not waive an inspection they created (OD-TPI-3): the waiver RPC refuses when the caller is the inspection's creator, and no role may write the waiver columns directly, so the rule cannot be bypassed from the client.
- FR-TPI-015 A report attachment of a `reported` inspection is append-only; a correction is a new attachment plus a note.

**Prerequisite read (for #2522 and #2576)**
- FR-TPI-016 The system shall offer a read `work_order_inspection_prerequisites(work_order_id, section_id, gate)` returning the blocking inspections (id, title, status, result, waiver) and a single `complete` boolean, under the caller's row rules. With no sections shipped, `section_id` must be null and the read covers every inspection of the work order; a non-null value is refused until #2576. It is a read only: this feature does not block an invoice or a readiness state itself; #2522 and #2576 call it and own the block (OD-TPI-4).
- FR-TPI-017 While the gate is `billing` and a blocking inspection is incomplete, the work-order page of #2518 shall show it as an open checklist item (display only here).

**Overdue**
- FR-TPI-018 When an inspection is past its planned date and not `reported`, the system shall show it as overdue and notify its requester and the work order's project manager once per inspection through the existing notification mechanism, computed from stored dates, never a client clock.

**Access**
- FR-TPI-019 Actions (`inspection.create`, `.advance`, `.raise_purchase`, `.waive`, `.cancel`, `.view`) shall be registered in the role matrix and gated by `can()`; RPCs and RLS enforce. Engineer may create, advance (invite, execute, report) and cancel their own tracked-only inspection while it is `requested`, on inspections of their organisation's projects (the shipped schema has no per-project membership: project and work-order reads are org-wide for active members, OD-TPI-7), and may not raise a purchase, waive or cancel a required inspection; Finance, Project Manager and Admin may do all; others read.
- FR-TPI-020 Inspection and file rows carry `org_id` (`stamp_org_id` on the inspection; the file row copies its inspection's org and is `on delete restrict`, never cascade), with RLS and FORCE RLS on every new table and a parent-org `exists` in every file write policy. A second organisation reads and writes nothing.

## Non-functional requirements
- NFR-TPI-001 A work order's list and roll-up read in one indexed query (`org_id, work_order_id`), bounded pagination.
- NFR-TPI-002 Phone-usable status step and report upload; `DESIGN.md` tokens; English and Bahasa Indonesia.
- NFR-TPI-003 Money exact decimals in the currency of each record; dates are calendar dates, not browser time.

## Acceptance criteria and owning layer

Hand-worked example: work order WO-1 has two required inspections, A (soil test) and B (weld test). A: purchase order 1,000 (USD, `Issued`), vendor bill 1,000, reported `pass`. B: purchase order 2,500 (USD, `Acknowledged`), vendor bill 2,400, executed, no report, plus a second `Draft` purchase order of 800 (USD) on the same case. Then (the 800 Draft order is excluded): committed 3,500, billed 3,400, per inspection A 1,000 / 1,000 and B 2,500 / 2,400; prerequisite `complete` = **false** with B listed as blocking (`executed`). After B is reported `conditional`, `complete` = **true**. A third inspection C (EUR 500, unlinked purchase, `requested`) adds nothing to the USD totals and shows "no purchase".

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-TPI-001 | Given the example, when costs are read, then A 1,000/1,000, B 2,500/2,400, work order totals 3,500 committed / 3,400 billed USD with B's 800 Draft order excluded from committed, C none (its estimate is not in any figure); no EUR is added to USD; the figures come from `work_order_cost_lines` records of the linked case and an Engineer sees no amounts. | pgTAP (read) + Unit (display) |
| AC-TPI-002 | Given a requested inspection with an estimate, when a Project Manager raises its purchase, then exactly one Draft procurements row exists on the inspection's project with the inspection's vendor (plus its create-intent row), no purchase request, order, receipt or bill exists, the inspection is `purchase_raised`, nothing was copied from `estimate`, and the case's `requested_by_id` is the caller. | pgTAP |
| AC-TPI-018 | Given a case linked to an inspection, when (a) a purchase order is created later on it, then it carries the inspection's work order and appears in `work_order_cost_lines`; (b) a case not linked to any inspection (or linked only to a cancelled one) gets a record, then its `work_order_id` stays null; (c) a record is inserted naming a different work order of the same project, then that value is kept, and one of another project is refused (`COST_WO_PROJECT`); (d) the existing cost-attribution proofs in `supabase/tests/0950_work_order_cost_attribution.test.sql` stay green unchanged. | pgTAP |
| AC-TPI-003 | Given a case of another organisation or another project, or one naming another work order, or already held by another inspection, when linked, then refused (`23514`, a `TPI_*` message). | pgTAP |
| AC-TPI-004 | Given an inspection, when a client writes `status` directly or skips a step (invite before purchase, report before execute), then refused. | pgTAP |
| AC-TPI-005 | Given an executed inspection, when it is reported with no attachment, or with a result left `pending`, then refused; with one attachment and a `pass`, `fail` or `conditional` result, it is `reported`; an 11th live attachment is refused. | pgTAP |
| AC-TPI-006 | Given a `reported` inspection, when a report attachment is removed or replaced, then refused; a new attachment is accepted. | pgTAP |
| AC-TPI-007 | Given the example, when the prerequisite is read for `billing`, then `complete` is false with B blocking; after B is reported `conditional`, true; a `fail` stays false. | pgTAP + Unit (completeness rule) |
| AC-TPI-008 | Given an incomplete required inspection, when a Project Manager other than its creator waives it with a reason, then the read shows complete with the waiver and the waiver is audited; without a reason, or on an inspection required for no gate, refused. | pgTAP |
| AC-TPI-017 | Given an inspection created by a Project Manager, when that same person calls the waiver RPC, or any user updates the waiver columns directly, then refused (`TPI_WAIVE_SELF` / no grant) and the read stays incomplete; a different Project Manager, Finance or Admin may waive. | pgTAP |
| AC-TPI-009 | Given no sections table (pre-#2576), when an inspection is created with a non-null `section_id`, then refused (`TPI_SECTION_UNAVAILABLE`); with the section null it counts in the work-order roll-up. The same-work-order/organisation refusal for a real section is owned by #2576's foreign key, not tested here. | pgTAP |
| AC-TPI-010 | Given a tracked-only inspection, when it is cancelled with a reason, then it keeps its row, reason and history and is excluded from the prerequisite; given one required for a gate, cancellation is refused (`TPI_CANCEL_REQUIRED`) so it keeps blocking until reported or waived; it is never hard-deleted. | pgTAP |
| AC-TPI-011 | Given a planned date in the past and no report, when the overdue sweep runs twice, then exactly one notice per inspection exists for each recipient. | pgTAP |
| AC-TPI-012 | Given a linked case whose bill is blocked by procurement's three-way match, when the inspection is advanced, reported or waived, then the bill's match state is unchanged and no inspection function writes it; only procurement's own approval releases it. | pgTAP |
| AC-TPI-013 | Given a user of another organisation, or an Engineer raising a purchase or waiving, then refused; an Engineer of the organisation may advance a tracked inspection and cancel their own tracked-only one while it is `requested`, and a required one cannot be cancelled. | pgTAP + Unit (`can()`) |
| AC-TPI-014 | Given project totals before and after inspections are created and purchased, when read, then committed and actual spend change only by the purchase, never by the inspection row. | pgTAP |
| AC-TPI-015 | Given a Project Manager on a work order, when they request a test, raise its purchase, record invitation, execution and an uploaded report, then the work order page shows it complete and its cost. | E2E (one journey) |
| AC-TPI-016 | Given an Engineer on a phone, when they attach the report photo and set the result, then the inspection shows `reported`. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Linking a case of another organisation, another project, another work order, or held by another inspection | Refused, names which |
| Step out of order, or direct status write | Refused: "complete the previous step" |
| Report without file or with a `pending` result; execution date in the future; 11th attachment | Field error |
| Waiver without reason, by the creator, or on an inspection required for no gate | Refused with reason |
| Cancel an inspection required for a gate | Refused (`TPI_CANCEL_REQUIRED`): report it or waive it |
| Section set before #2576 ships | Refused (`TPI_SECTION_UNAVAILABLE`) |
| Purchase refused by procurement's own rules (budget, approval) | Passed through unchanged; the inspection stays `requested` |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-TPI-1 | Cost is read from the linked procurement case, with no cost entered on the inspection. | If the team wants to log a cost without a purchase, the work order shows no cost for it and the PM must raise a record-only purchase. |
| OD-TPI-2 | Complete = reported with `pass` or `conditional`; `fail` blocks until re-tested or waived. | If `conditional` should block, an invoice goes out on a conditional result the client rejects. |
| OD-TPI-3 | A waiver needs a reason and a person other than the creator. | If the creator may waive, one person can request a test and waive it, so the prerequisite is meaningless. |
| OD-TPI-4 | This feature only exposes the prerequisite; #2522 and #2576 own the block. | If the block is wanted now, an invoice can still be issued while a required test is open. |
| OD-TPI-5 | One inspection = one test event; a re-test is a new inspection on the same work order. | If re-tests must share one record, history and cost of the failed attempt merge. |
| OD-TPI-6 | A trigger on the four procurement record tables stamps the linked inspection's work order on a new record that names none (attribution columns only; no create function, status or amount changes). | If wrong (the owner would rather not touch the money-path tables), drop the trigger and attribute each later record by hand with `set_cost_attribution`; until someone does, an unattributed purchase order or bill drops out of the work-order cost. The trigger belongs to Slice 3, which ships alone. |
| OD-TPI-7 | Engineer scope is the organisation's active members with the Engineer role, as for tasks and timesheets; there is no per-project membership helper in the shipped schema (the only project-person link is `projects.project_manager_id`). | If Engineers must be limited to assigned projects, a project-membership concept must be built first, and an Engineer could otherwise advance any inspection in the organisation. |
| OD-TPI-8 | A required inspection cannot be cancelled; it is reported (pass/fail/conditional) or waived by a person other than its creator. Cancellation is for tracked-only inspections. | If a required inspection could be cancelled, one person could drop a gate by cancelling the test, and the waiver's second-person rule would mean nothing. |
| OQ-TPI-1 | Is the test-kind list per organisation (default: a small org-kept list, free text allowed for now) or fixed? | Reports cannot be grouped by kind. |
| OQ-TPI-2 | Does the vendor's own invoice always come through a purchase (default yes), or may the client pay the tester directly? | Direct client payment means no cost to attribute; the tracker then holds a zero-cost inspection. |
| OQ-TPI-3 | Overdue is the planned date, or the planned date plus N days? Default the planned date. | Noise or silence. |
| OQ-TPI-4 | Is one inspection ever required at the work-order level and again per section? Default no: it names one or the other. | Prerequisite counts it twice or not at all. |

## Delivery checklist
- [ ] Owner signs OD-TPI-1..8, answers OQ-TPI-1..4.
- [ ] Tracker (status, files, overdue) ships before the purchase link; the purchase link and cost read ship alone (money).
- [ ] Section picker waits for #2576; prerequisite wiring into #2522 / #2576 is their ticket.
- [ ] Glossary: third-party inspection, inspection prerequisite.
