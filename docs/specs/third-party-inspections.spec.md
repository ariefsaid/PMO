# Spec: Third-party inspection tracker with cost (#2580)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-TPI-###`, `NFR-TPI-###`, `AC-TPI-###`. Plan: `docs/plans/2026-11-20-third-party-inspections.md`. Executor: Orca worker for the tracker, screens and prerequisite read; the purchase link and cost read are a money path and are Director-dispatched, shipping alone. Map #2516; blocked by #2517 (cost attribution, ADR-0104, shipped on `dev`); the per-section link is blocked by #2576 (work-order sections, open, nothing shipped: see FR-TPI-004). Feeds #2522 (billing stage checklist) and the readiness checks of #2576 as a read-only prerequisite; does not build either.

## Job story

When an external body must test or inspect part of a work order, I want to track each test from request through purchase, invitation, execution and report, with its cost on the work order, so that the work order is not billed or declared ready before the required reports exist, and the cost of every test is on the right work order.

## Context and boundary

- A **third-party inspection** is one external test or inspection of a work order (or of one of its sections), done by an outside company (a vendor, an existing `companies` row), whose cost is bought through procurement.
- Cost reuses procurement end to end. The inspection **links** to a procurement case (`procurements`, with its `purchase_requests`, `purchase_orders`, `procurement_receipts`, `procurement_invoices`); cost attribution (#2517) already stamps `work_order_id` on those records and the database already refuses a work order of another project (`check_cost_attribution`). This feature adds **no cost table, no cost writer and no posting path**. Its cost figures are a read of the linked case's records already attributed to the same work order.
- Approvals, SoD, three-way match (#2525), payment and ERP outbox all stay procurement's. An inspection never approves, posts or pays anything.
- Sections do not exist yet (#2576: no table, no spec on `dev`). The inspection carries a nullable section reference, hidden until #2576 ships (FR-TPI-004).
- The report is an attachment (shared private file mechanism, as `purchase_request_files`). A vendor portal, e-mail send to the vendor and any lab-system integration are out of scope; an invitation is recorded by hand (who, when, how). Any later automation goes behind the connector seam.

## Definitions

- **Inspection status** (ordered): `requested` -> `purchase_raised` -> `invited` -> `executed` -> `reported`; `cancelled` from any status before `reported`.
- **Result**: `pending` (default), `pass`, `fail`, `conditional`. Set when the report is recorded.
- **Required for**: a set of gates this inspection blocks, any of `readiness`, `billing`; empty means tracked only.
- **Complete** (the prerequisite meaning): status `reported` and result `pass` or `conditional`, or a recorded **waiver** (FR-TPI-014). `fail`, `pending` and cancelled-without-waiver are not complete (OD-TPI-2).
- **Inspection cost**: sum of `procurement_invoices` amounts of the linked case whose `work_order_id` equals the inspection's, per currency (never blended). **Committed** is the same over `purchase_orders`. Both come from procurement's own rows.

## Requirements (EARS)

**Tracking**
- FR-TPI-001 The system shall let an authorized user create an inspection on a work order with a title, test kind (text from an organisation list, OQ-TPI-1), planned date, optional vendor (company), optional estimate and currency, optional note, and the `required for` gates.
- FR-TPI-002 The system shall move an inspection only forward through the status order via one RPC per step, each stamping the date and actor; no client may write `status` directly.
- FR-TPI-003 When an inspection is cancelled, the system shall require a reason and keep the row and its history; archived, never hard-deleted (ADR-0018).
- FR-TPI-004 The inspection shall carry a nullable `section_id` with no foreign key until #2576 ships. Where sections exist, the system shall refuse a section of another work order or organisation and the screen shall offer a section picker; until then the field is not shown. Roll-up per section and per work order (counts by status) shall work with the section null.
- FR-TPI-005 Every status step shall be audited in record history with actor and time.

**Purchase and cost**
- FR-TPI-006 When an inspection is `requested`, the system shall let a Project Manager, Finance or Admin raise its purchase: one RPC creates (or links an existing, unlinked) procurement case on the inspection's project through the existing procurement create functions, attributes the case's records to the inspection's work order and the inspection's vendor, and moves the inspection to `purchase_raised`.
- FR-TPI-007 The system shall refuse linking a case whose project differs from the inspection's, whose records name another work order, or that another inspection already holds (one case per inspection; a case may be reused only by the same inspection).
- FR-TPI-008 The system shall show each inspection's committed and billed cost, per currency, from the linked case, never entered by hand and never written by this feature.
- FR-TPI-009 The work-order cost read of #2517 shall include these purchases unchanged; project totals shall not change because an inspection exists (NFR-WCA-001 holds).
- FR-TPI-010 Cost approval, SoD, three-way match and payment shall apply to the linked case exactly as to any purchase; the inspection tracker shall not offer a way around them.

**Invitation, execution, report**
- FR-TPI-011 `invited` requires the purchase raised, and records invitation date, who was invited (free text or the vendor contact) and how (note).
- FR-TPI-012 `executed` requires `invited` and records the execution date, which shall not be in the future.
- FR-TPI-013 `reported` requires `executed`, at least one report attachment (file, uploader, time; PDF/image/Office types, 15 MB each, capped at 10) and a result. The database refuses the step without them.
- FR-TPI-014 Where an inspection is `required for` a gate and is not complete, a Project Manager, Finance or Admin may record a **waiver** with a mandatory reason; it is audited, and shows on the prerequisite read. A person shall not waive an inspection they created (OD-TPI-3).
- FR-TPI-015 A report attachment of a `reported` inspection is append-only; a correction is a new attachment plus a note.

**Prerequisite read (for #2522 and #2576)**
- FR-TPI-016 The system shall offer a read `work_order_inspection_prerequisites(work_order_id, section_id, gate)` returning the blocking inspections (id, title, status, result, waiver) and a single `complete` boolean, under the caller's row rules. It is a read only: this feature does not block an invoice or a readiness state itself; #2522 and #2576 call it and own the block (OD-TPI-4).
- FR-TPI-017 While the gate is `billing` and a blocking inspection is incomplete, the work-order page of #2518 shall show it as an open checklist item (display only here).

**Overdue**
- FR-TPI-018 When an inspection is past its planned date and not `reported`, the system shall show it as overdue and notify its requester and the work order's project manager once per inspection through the existing notification mechanism, computed from stored dates, never a client clock.

**Access**
- FR-TPI-019 Actions (`inspection.create`, `.advance`, `.raise_purchase`, `.waive`, `.view`) shall be registered in the role matrix and gated by `can()`; RPCs and RLS enforce. Engineer may create and advance (invite, execute, report) on their projects, not raise a purchase or waive; Finance and Project Manager may do all; others read.
- FR-TPI-020 Inspection and file rows carry `org_id` by default, RLS on every new table, a second organisation reads and writes nothing.

## Non-functional requirements
- NFR-TPI-001 A work order's list and roll-up read in one indexed query (`org_id, work_order_id`), bounded pagination.
- NFR-TPI-002 Phone-usable status step and report upload; `DESIGN.md` tokens; English and Bahasa Indonesia.
- NFR-TPI-003 Money exact decimals in the currency of each record; dates are calendar dates, not browser time.

## Acceptance criteria and owning layer

Hand-worked example: work order WO-1 has two required inspections, A (soil test) and B (weld test). A: purchase order 1,000 (USD), vendor bill 1,000, reported `pass`. B: purchase order 2,500 (USD), vendor bill 2,400, executed, no report. Then: committed 3,500, billed 3,400, per inspection A 1,000 / 1,000 and B 2,500 / 2,400; prerequisite `complete` = **false** with B listed as blocking (`executed`). After B is reported `conditional`, `complete` = **true**. A third inspection C (EUR 500, unlinked purchase, `requested`) adds nothing to the USD totals and shows "no purchase".

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-TPI-001 | Given the example, when costs are read, then A 1,000/1,000, B 2,500/2,400, work order totals 3,500 committed / 3,400 billed USD, C none; no EUR is added to USD. | pgTAP (read) + Unit (display) |
| AC-TPI-002 | Given a requested inspection, when a Project Manager raises its purchase, then a case exists on the inspection's project with its records attributed to the work order and vendor, the inspection is `purchase_raised`, and no client-supplied amount or work order was needed. | pgTAP |
| AC-TPI-003 | Given a case on another project, or one naming another work order, or already held by another inspection, when linked, then refused (`23514`, a `TPI_*` message). | pgTAP |
| AC-TPI-004 | Given an inspection, when a client writes `status` directly or skips a step (invite before purchase, report before execute), then refused. | pgTAP |
| AC-TPI-005 | Given an executed inspection, when it is reported with no attachment or no result, then refused; with both, it is `reported`. | pgTAP |
| AC-TPI-006 | Given a `reported` inspection, when a report attachment is removed or replaced, then refused; a new attachment is accepted. | pgTAP |
| AC-TPI-007 | Given the example, when the prerequisite is read for `billing`, then `complete` is false with B blocking; after B is reported `conditional`, true; a `fail` stays false. | pgTAP + Unit (completeness rule) |
| AC-TPI-008 | Given an incomplete required inspection, when a Project Manager waives it with a reason, then the read shows complete with the waiver; without a reason, or by the creator, refused; the waiver is audited. | pgTAP |
| AC-TPI-009 | Given an inspection that names a section, when the section belongs to another work order or organisation, then refused; with the section null the roll-up still counts it (the column carries no foreign key until #2576). | pgTAP |
| AC-TPI-010 | Given a cancelled inspection, when read, then it stays with its reason and history and is excluded from the prerequisite unless waived-required is set; it is never hard-deleted. | pgTAP |
| AC-TPI-011 | Given a planned date in the past and no report, when the overdue sweep runs twice, then exactly one notice per inspection exists for each recipient. | pgTAP |
| AC-TPI-012 | Given an inspection and its purchase, when the bill needs a three-way-match exception, then only procurement's own approval releases it; the tracker offers no override. | pgTAP (covered by AC of #2525, asserted unchanged) |
| AC-TPI-013 | Given a user of another organisation, or an Engineer raising a purchase or waiving, then refused; a project's Engineer may advance. | pgTAP + Unit (`can()`) |
| AC-TPI-014 | Given project totals before and after inspections are created and purchased, when read, then committed and actual spend change only by the purchase, never by the inspection row. | pgTAP |
| AC-TPI-015 | Given a Project Manager on a work order, when they request a test, raise its purchase, record invitation, execution and an uploaded report, then the work order page shows it complete and its cost. | E2E (one journey) |
| AC-TPI-016 | Given an Engineer on a phone, when they attach the report photo and set the result, then the inspection shows `reported`. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Linking a case of another project, another work order, or held by another inspection | Refused, names which |
| Step out of order, or direct status write | Refused: "complete the previous step" |
| Report without file or result; execution date in the future | Field error |
| Waiver without reason, or by the creator | Refused with reason |
| Section of another work order | Refused (once #2576 ships) |
| Purchase refused by procurement's own rules (budget, approval) | Passed through unchanged; the inspection stays `requested` |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-TPI-1 | Cost is read from the linked procurement case, with no cost entered on the inspection. | If the team wants to log a cost without a purchase, the work order shows no cost for it and the PM must raise a record-only purchase. |
| OD-TPI-2 | Complete = reported with `pass` or `conditional`; `fail` blocks until re-tested or waived. | If `conditional` should block, an invoice goes out on a conditional result the client rejects. |
| OD-TPI-3 | A waiver needs a reason and a person other than the creator. | If the creator may waive, one person can request a test and waive it, so the prerequisite is meaningless. |
| OD-TPI-4 | This feature only exposes the prerequisite; #2522 and #2576 own the block. | If the block is wanted now, an invoice can still be issued while a required test is open. |
| OD-TPI-5 | One inspection = one test event; a re-test is a new inspection on the same work order. | If re-tests must share one record, history and cost of the failed attempt merge. |
| OQ-TPI-1 | Is the test-kind list per organisation (default: a small org-kept list, free text allowed for now) or fixed? | Reports cannot be grouped by kind. |
| OQ-TPI-2 | Does the vendor's own invoice always come through a purchase (default yes), or may the client pay the tester directly? | Direct client payment means no cost to attribute; the tracker then holds a zero-cost inspection. |
| OQ-TPI-3 | Overdue is the planned date, or the planned date plus N days? Default the planned date. | Noise or silence. |
| OQ-TPI-4 | Is one inspection ever required at the work-order level and again per section? Default no: it names one or the other. | Prerequisite counts it twice or not at all. |

## Delivery checklist
- [ ] Owner signs OD-TPI-1..5, answers OQ-TPI-1..4.
- [ ] Tracker (status, files, overdue) ships before the purchase link; the purchase link and cost read ship alone (money).
- [ ] Section picker waits for #2576; prerequisite wiring into #2522 / #2576 is their ticket.
- [ ] Glossary: third-party inspection, inspection prerequisite.
