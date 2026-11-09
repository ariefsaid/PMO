# ERP journal-entry costs on the project — spec

- **Issue:** #1919 (owner P0/P1, 2026-11-05)
- **Status:** Draft for owner sign-off
- **IDs:** `FR-JEC-###`, `NFR-JEC-###`, `AC-JEC-###`
- **Plan:** `docs/plans/2026-11-05-erp-journal-costs-on-project.md`
- **Builds on:** ERP purchase linking (`docs/specs/procurement-flexible-entry.spec.md`, migrations 0360/0361/0372,
  ADR-0093), the ledger mirror and actuals snapshot (0101, 0382), cost attribution (0376), PMO-posted journals
  (ADR-0078, ADR-0081, imprest postings 0425).

## 1. Job story

When I review a project's cost, I want to see every ERP document behind the spent figure, including costs the
ERP booked as journal entries, and tie a journal line to the PMO purchase it paid, so I can tell what was bought,
from whom, and that nothing is counted twice.

## 2. What exists today (observed)

- **OBS-JEC-001** Project actuals are summed from the ledger mirror (`erp_gl_entry_mirror` → `erp_actuals_snapshot`,
  per project, account and fiscal year), then mapped to budget categories through `budget_category_account_map`
  (`project_mapped_actuals`). A journal entry row tagged with an ERP project that maps to a PMO project is already
  in that project's actuals. Nothing lists it.
- **OBS-JEC-002** ERP supplier invoices, receipts, orders and payments are mirrored per document into
  `erp_purchase_documents`; the project's Procurement tab lists those not in a purchase ("From the accounting
  system · not linked to a procurement"), and `link_erp_purchase_documents` ties them to a PMO purchase
  (`procurement_erp_links`). Linking sends nothing to the ERP.
- **OBS-JEC-003** Count-once rule for ledger orgs: actual cost comes only from the ledger; a purchase's
  *open commitment* is `max(0, total − ledger_held)`, where `procurement_ledger_held` sums the purchase's linked
  submitted ERP purchase invoices and its PMO-pushed invoices. Linking therefore never moves *actuals*; it lowers
  *committed*.
- **OBS-JEC-004** PMO itself posts journal entries for expense claims (`expense_posting_erp_mirror.erp_name`) and
  imprest transfers (`imprest_posting_erp_mirror.erp_name`). Those already have a PMO source document.
- **OBS-JEC-005** The ledger mirror does not carry the GL Entry `remarks` field, where the vendor and invoice
  reference of a journal usually sits.
- **OBS-JEC-006** The Odoo adapter has no ledger read yet (#1507 open), so Odoo journal items reach no project
  today.

## 3. Definitions

- **Journal cost line** — for one ERP journal (ERPNext `Journal Entry`), one PMO project and one ledger account:
  the non-cancelled ledger rows of that journal whose ERP project maps to the PMO project (binding `project_map`,
  unambiguous names only, the same rule the actuals snapshot uses) and whose account is mapped to a budget
  category. Amount = Σ debit − Σ credit of those rows. A journal split across two projects gives two lines; a
  journal touching two cost accounts on one project gives two lines.
- **Line key** — `(org, erp_doctype, voucher_no, project_id, account)`. It survives an ERP repost, which replaces
  ledger row names but not the voucher, project or account.
- **PMO-posted journal** — a journal whose number is recorded by a PMO posting mirror (OBS-JEC-004).
- **Attach** — record that a journal cost line belongs to a PMO purchase. Link only; nothing is sent to the ERP.

## 4. Functional requirements (EARS)

### Listing

- **FR-JEC-001** The system shall list, on a project's Procurement tab, every journal cost line of that project
  that is not PMO-posted, showing posting date, journal number, account, budget category, amount, remark, party
  (when the ERP row carries one), attached purchase (if any) and a link to the document in the ERP (built from
  the binding's site address; plain text when none is recorded).
- **FR-JEC-002** The system shall mirror the GL Entry `remarks` field with each ledger row, and shall re-read the
  existing mirror once so historical journals carry their remark.
- **FR-JEC-003** Where a journal cost line has no attached purchase, the system shall show the note "Paid directly
  and recorded in the accounting system as a journal, so no purchase was raised in PMO."
- **FR-JEC-004** The system shall show no total on the journal list that could be read as additional spend; the
  section states its lines are already in project spending (as the ERP purchase-document section does).
- **FR-JEC-005** The procurement list shall keep listing only PMO purchases; journal lines are a separate list.
- **FR-JEC-006** While the org reads no ERP ledger, the system shall not render the journal list.

### Attach and detach

- **FR-JEC-010** When a permitted member attaches a journal cost line to a purchase, the system shall record the
  link and send nothing to the ERP.
- **FR-JEC-011** The system shall refuse an attach, with a reason, when: the line does not exist or has a
  non-positive amount; the journal is PMO-posted; the line is already attached to another purchase; the purchase
  is not in the caller's org, is Cancelled or Rejected, or belongs to a different project than the line; the
  purchase currency differs from the org's ledger currency.
- **FR-JEC-012** An attach of a line already attached to the same purchase shall succeed as a no-op
  (`already_attached`).
- **FR-JEC-013** The system shall accept 1–500 lines per attach call, decide each line independently, and support
  a dry run that reports every line's outcome and writes nothing (one code path for the screen and the CLI).
- **FR-JEC-014** When a permitted member detaches a line, the system shall delete the link and restore the
  purchase's open commitment.
- **FR-JEC-015** The system shall record an audit event for every attach and detach.
- **FR-JEC-016** The purchase detail shall list its attached journal lines beside its linked ERP documents, with
  Detach for permitted members.

### Count once

- **FR-JEC-020** Attaching or detaching a journal line shall not change any project's actuals.
- **FR-JEC-021** While a journal line is attached to a purchase, the purchase's ledger-held amount shall include
  the line's current amount, so its open commitment drops by that amount (floored at zero).
- **FR-JEC-022** When the ERP cancels a journal or a repost changes its rows, the attached line's held amount shall
  follow the mirror on the next read (a cancelled journal holds nothing; the link stays and shows "cancelled in
  the accounting system").
- **FR-JEC-042** While an attached line has a later negative journal line on the same project and account, the list
  shall flag it "possibly reversed" and keep its hold (the mirrored ledger rows carry no link from a reversal to its original).
- **FR-JEC-023** A journal split across projects shall attach per project line; attaching one project's line
  shall not change another project's actuals, committed spend or list.

### Roles and tenancy

- **FR-JEC-030** Viewing journal lines shall be permitted to active Admin, Executive, Project Manager and Finance
  members of the org (the audience of ERP purchase documents). Other roles see no journal section.
- **FR-JEC-031** Attaching shall be permitted to the roles that may link ERP purchase documents (Admin, Executive,
  Project Manager, Finance); detaching to the roles that may unlink them (Admin, Finance). The database is the
  authority; the screen hides what the role cannot do.
- **FR-JEC-032** Every read and write shall be scoped to the caller's org; a line, link or purchase of another org
  behaves as not found.

### Other ERPs

- **FR-JEC-040** Where an ERP adapter mirrors ledger rows into the ledger mirror, its journal rows shall be listed
  and attachable through the same line key, using the adapter's journal doctype as `erp_doctype`.
- **FR-JEC-041** Odoo journal items are out of this delivery: they arrive when the Odoo ledger read (#1507) feeds
  the ledger mirror; this spec then applies unchanged with `erp_doctype = 'account.move'`.

### Out of scope

- Rebooking or editing anything in the ERP.
- Creating a new PMO purchase from journal lines (owner question Q2).
- Lines reaching a project only by a cost-attribution rule (owner question Q1).
- A journal line counting toward a purchase's payment ceiling or moving its status to Paid.

## 5. Non-functional

- **NFR-JEC-001** The project's journal list loads in one database call, bounded by the project's journals; the
  ledger-held change keeps `project_committed_spend` set-based (0651) — one extra aggregate, no per-row call.
- **NFR-JEC-002** No list read may silently truncate at PostgREST's 1000-row cap: the list RPC returns all lines of
  the project or pages by key.

## 6. Acceptance criteria (Given/When/Then)

| ID | Criterion | Owning layer |
|---|---|---|
| AC-JEC-001 | **Given** a ledger org with a journal whose two cost rows tag project A (one account) **When** a Finance member opens A's Procurement tab **Then** one journal line shows the journal number, date, account, category, net amount and remark | pgTAP (RPC rows) + Vitest (render) |
| AC-JEC-002 | **Given** a journal splitting one bank payment across projects A and B **When** each project's list is read **Then** A shows only A's line and amount, B only B's | pgTAP |
| AC-JEC-003 | **Given** a journal PMO posted for an expense claim **When** the project's list is read **Then** it is not listed, and attaching it is refused `journal_posted_by_pmo` | pgTAP |
| AC-JEC-004 | **Given** an unattached line of amount *j* and a purchase on the same project with open commitment *c* **When** the line is attached **Then** the project's actuals are unchanged and the purchase's open commitment is `max(0, c − j)` | pgTAP (count-once) |
| AC-JEC-005 | **Given** an attached line **When** it is detached **Then** actuals are unchanged and the open commitment returns to *c* | pgTAP |
| AC-JEC-006 | **Given** a line attached to purchase P **When** someone attaches it to purchase Q **Then** it is refused `line_attached_to_another_purchase`; attaching it to P again returns `already_attached` | pgTAP |
| AC-JEC-007 | **Given** a split journal's A line attached to an A purchase **When** B's committed spend and actuals are read **Then** both are unchanged; attaching the A line to a B purchase is refused `project_mismatch` | pgTAP |
| AC-JEC-008 | **Given** an attached line **When** the ERP cancels the journal (mirror rows `is_cancelled`) **Then** the purchase's held amount drops by *j* and the link remains | pgTAP |
| AC-JEC-009 | **Given** a Cancelled purchase, a purchase in another currency, or a line with amount ≤ 0 **When** attach is called **Then** each is refused with its reason and nothing is written | pgTAP |
| AC-JEC-010 | **Given** a dry run of three lines (one valid, one already attached elsewhere, one unknown) **When** attach runs with `p_dry_run` **Then** the outcomes are link / refused / refused and no link row exists afterwards | pgTAP |
| AC-JEC-011 | **Given** an Engineer **When** they call the list or attach RPC **Then** the list returns no rows and attach raises 42501; **Given** a Project Manager **When** they detach **Then** 42501 | pgTAP |
| AC-JEC-012 | **Given** a member of org B **When** they read org A's project lines or attach org A's line or purchase **Then** no rows / `line_not_found` / `purchase_not_found`; org B's link rows are invisible to org A | pgTAP |
| AC-JEC-013 | **Given** a ledger row fetched from ERPNext with `remarks` **When** the feed writes it **Then** the mirror row carries the remark, through both the voucher-replace path and the full replay | Vitest (feed) + pgTAP (replace RPC) |
| AC-JEC-014 | **Given** an unattached line **When** a Project Manager attaches it to a purchase from the project page **Then** the line shows the purchase and the purchase detail lists the line with no Detach button for that role | Vitest (RTL, mocked repo) |
| AC-JEC-015 | **Given** a project with journal lines and a PMO purchase **When** an operator opens the Procurement tab, attaches a line, then opens the purchase **Then** the attached line is on the purchase and the project's spent figure is the same as before | Playwright e2e `e2e/AC-JEC-015-journal-attach.spec.ts` (one cross-stack journey) |
| AC-JEC-016 | **Given** an org reading no ERP ledger **When** the Procurement tab renders **Then** no journal section shows | Vitest |
| AC-JEC-017 | **Given** the CLI with a JSON file of lines **When** `pmo purchases attach-journals <file> --dry-run` runs **Then** it prints each line's outcome and writes nothing | node test (`scripts/pmo-purchases.test.mjs`) |
| AC-JEC-018 | **Given** an attached line and a later negative journal line on its project and account **When** the project's lines are listed **Then** the attached line is flagged possibly reversed and keeps its hold | pgTAP 0687 |
| AC-JEC-020 | **Given** a purchase with attached journal lines **When** its project is changed **Then** the change is refused with a message to ask Finance or an Admin to detach the lines, and the purchase and lines stay on their project; an unattached purchase, or an attached one after detach, moves | pgTAP 0699 |
