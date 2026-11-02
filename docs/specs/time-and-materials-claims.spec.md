# Spec: Time-and-materials claims (#1514)

> **Status:** proposed, pending owner sign-off of the §10 decisions (each carries a default).
> Route: `docs/plans/2026-10-30-epc-odoo-build-route.md` item T3 (owner-signed 2026-10-30); owner ruling in #1488
> (standard time-and-materials billing) and the billing-kinds ruling #1443.
> IDs: `FR-TM-###`, `NFR-TM-###`, `AC-TM-###`. Executor: Director-dispatched (money / SoD), one fresh worker per slice.
> Reuses, never forks: progress claims and the claim→invoice path (`0250`, `0262`, `0343`), client acceptance
> (ADR-0091, `0337`), timesheet approval (`transition_timesheet`, `0180`), equipment usage (#1519), billing kinds
> (`0410`, DD-BKIND-1). **No second billing system.**
> Migration numbers: `0515`–`0519` only (plan). Rollback required.

## 0. Job story

> **When** we have worked on a client's project by the hour (people) and by the day or hour (machines) under
> contract rates, **I want** to gather the hours and machine time that were already approved, have the client sign
> them off, and invoice exactly what was signed at the contract rates, **so that** we are paid for the work done and
> never bill hours the client did not accept.

## 1. Context (what ships today, what this adds)

- A **progress claim** is the PMO record of a client invoice (claim id = `sales_invoices.id`, `0250`). It holds priced
  lines copied at creation (`progress_claim_lines`), is immutable, and can be raised as an invoice only when billing
  evidence is attached (`assert_progress_claim_raisable`). Lines are keyed to a bill-of-quantities line, so hours
  and machine time do not fit them as they stand.
- **Client acceptance** (ADR-0091): prepare, then confirm against a signed project document; the confirmer is
  Admin or Finance and differs from the preparer, except the sole active member (`0298`). Confirmed rows are immutable.
- **Timesheets**: a whole week moves Draft → Submitted → Approved by someone other than the owner
  (`transition_timesheet`). Entries carry project, date, hours. Nothing in them says who may bill them or at what rate.
- **Equipment usage** (#1519, owner-signed, not yet built): approved per-asset, per-project usage entries, work or
  standby. Its internal hire rate is a *cost* setting; the client rate in this spec is a *revenue* setting.
- **Billing kinds** (DD-BKIND-1): an invoice with kind `contract` draws down the contract value; the project
  finances payload is the single authority.
- There is **no contract rate** anywhere today (searched `supabase/migrations/*.sql` for `bill_rate`, `hourly_rate`,
  `rate_card`: none).

## 2. Scope

**In**
1. A **contract rate card** per project: rate lines by billing role (people) and, once #1519 lands, by asset
   (machines); effective-dated, versioned, audited; people assigned to a role line per project.
2. **Assembly** of a draft T&M claim from *approved* timesheet hours (and, after #1519, approved equipment usage)
   for a date range; each source row can sit in at most one live claim.
3. **Client sign-off**: prepare, confirm against a signed project document, withdraw. The signed quantities are
   exactly the assembled quantities.
4. **Invoicing through the existing claim→invoice path**: a confirmed sign-off creates the claim record; the existing
   invoice raise, approval, push to the connected ERP, billing kind and contract drawdown apply unchanged.
5. Screens (rate card, assemble, sign-off, claim detail) and CLI list/preview, reusing shared form primitives and `can()`.

**Out of scope (follow-ups, §11)**
- A client portal or e-signature; the signature is a scanned or attached signed document (as BAST).
- Overtime premiums, rate multipliers, minimum charges, rounding rules beyond cents (OQ-TM-4).
- Down-payment recovery on T&M claims (OQ-TM-8); retention on claims (#1572).
- Materials billed from stock issues (route item T1 supplies the movement; billing it is its own issue). This spec bills
  people and machines; a priced extra line is OQ-TM-10.
- Internal timesheet payroll cost, the cost side of equipment (#1519) and the ERP's own timesheet-to-sale routes (Odoo
  sale orders are not used; OQ-OCI-6).
- Offline capture (T9), GPS attendance (T6), payroll (T7): they feed timesheets and are untouched here.

## 3. Terms

- **Rate line**: one billable thing on a project's rate card: a billing role (`kind=labour`, label such as "Site
  engineer") or an asset (`kind=equipment`), a unit (`hour` or `day`), a rate, optional standby rate, effective window.
- **Assignee**: a person assigned to a labour rate line on a project (a person holds at most one labour line per
  project per date).
- **Source**: an approved timesheet entry (labour) or approved equipment usage entry (equipment).
- **Assembled quantity**: sum of source units per rate line for one claim.
- **T&M claim**: header + lines + sources, tied to one project and a date range, optionally one client work order.
- **Sign-off**: the confirmed client acceptance of a T&M claim: a signed project document plus the exact quantities.

## 4. Functional requirements (EARS)

**AC-1 Rate card**
- FR-TM-001 The system shall hold per-org, per-project rate lines: kind (`labour` | `equipment`), label, unit
  (`hour` | `day`), rate ≥ 0 in the project's currency, optional standby rate (equipment only), `effective_from`,
  optional `effective_to`.
- FR-TM-002 Rate lines shall be versioned as cost attribution settings are (`version`, `is_current`,
  `expected_version` → `40001`, identical save → no new version, audit before/after). A later version applies from
  its `effective_from`; earlier periods keep the version current on their dates.
- FR-TM-003 When a rate line is saved, the system shall refuse overlapping windows for one line, a rate over the
  numeric bound, and a currency other than the project's.
- FR-TM-004 The system shall let an Admin or Finance assign people to a labour line for a project with a date
  window and shall refuse overlapping windows for one person on one project.
- FR-TM-005 Only Admin and Finance shall save or end rate lines and assignments (security-definer RPCs). A Project
  Manager reads rates for projects they manage; Engineers read none.

**AC-2 Assembly**
- FR-TM-010 When a user with prepare rights assembles a claim for a project and date range, the system shall offer only
  sources that are Approved, non-archived, inside the range, in the project, and not already in a live claim.
- FR-TM-011 For each labour source the system shall resolve the person's assigned rate line for the entry date and
  group quantity per rate line. A source with no assignee line, or a line with no rate effective on that date, is
  **unrated**: listed with its reason, excluded from the claim, never priced by guess.
- FR-TM-012 Equipment sources shall resolve by asset to the equipment rate line; work units bill at the rate, standby
  units only where a standby rate is set (else listed as unbilled standby). (Waits for #1519.)
- FR-TM-013 The preparer may deselect sources before sign-off; the draft shall show per rate line: units, rate,
  amount, and the per-person (or per-day) breakdown behind it.
- FR-TM-014 The system shall record each source in at most one non-withdrawn claim (unique over live claims, race-safe),
  so the same hour can never be billed twice.
- FR-TM-015 The system shall freeze, on each claim line, the rate, unit, label and rate-line version used, so a later
  rate change never restates the claim (FR-TM-002).
- FR-TM-016 Line amount = `round(units × rate, 2)`; the claim total is the sum of line amounts, rounded once per line.
- FR-TM-017 While a source sits in a live claim, the system shall refuse to reopen or edit its timesheet (or archive
  its usage entry); withdrawing the claim releases the sources.
- FR-TM-018 Assembly shall accept an optional client work order of the same project; when present the work order's
  billing fence applies at sign-off (FR-TM-033).

**AC-3 Client sign-off**
- FR-TM-020 The preparer (PM of the project, Finance, Executive or Admin, per `may_record_project_progress`) shall
  prepare a sign-off from a draft claim with a note and a same-project project document.
- FR-TM-021 When confirming, the system shall require an Issued or Approved same-project project document with a
  file, record the confirmer and basis (`standard` | `sole_operator`), and freeze the claim, lines and sources.
- FR-TM-022 The confirmer shall be Admin or Finance and shall not be the preparer, unless the confirmer is the sole
  active org member by the exact `0298` predicate; the RPC re-asserts both.
- FR-TM-023 The signed quantities are the assembled quantities. A client who signs fewer hours is handled by
  deselecting those sources and preparing again (OQ-TM-5); there is no partial confirm.
- FR-TM-024 A confirmed sign-off is immutable. A Draft one may be withdrawn by its preparer, Admin or Finance,
  releasing its sources.
- FR-TM-025 Every prepare, withdraw and confirm shall write an `audit_events` row.

**AC-4 Invoice through the existing path (the acceptance)**
- FR-TM-030 When a sign-off is confirmed, the system shall create the progress-claim record (`kind=time_materials`,
  claim id = the T&M claim id) with the document attached as billing evidence, in the same transaction.
- FR-TM-031 The system shall refuse to raise an invoice for a T&M claim that has no confirmed sign-off (the claim
  fence `assert_progress_claim_raisable` extended); hours without a confirmed sign-off cannot be invoiced.
- FR-TM-032 The resulting invoice lines shall be the claim lines: label, unit, **approved units** and **contract rate**
  with the line amount; the header equals the sum of lines.
- FR-TM-033 Where a work order is linked, the claim shall reserve its gross against the work order at confirm
  (`assert_work_order_invoiceable`), taking the work order billing lock first, as `create_progress_claim` does.
- FR-TM-034 A T&M invoice is `billing_kind = contract` and draws down the contract value; when it takes contract billing
  above a known contract value the existing excess display (DD-BKIND-1) applies. No new kind is added.
- FR-TM-035 The invoice approver shall differ from the claim's preparer and its confirmer: both are recorded as
  invoice authors (`sales_invoice_authors`), extending `append_progress_claim_author`.
- FR-TM-036 When connected to an ERP, the invoice shall reach it through the existing revenue command and recovery
  path unchanged; the ERP body's lines come from the claim lines (§7). Withdrawing a claim before its invoice exists
  releases the sources; once the invoice is cancelled the claim withdraws as for progress claims.
- FR-TM-037 A T&M claim shall carry no down-payment recovery (OQ-TM-8) and shall be refused when the claim currency
  differs from the project currency.

**AC-5 Access and SoD**
- FR-TM-040 Rate lines, assignments, claims and sign-offs shall be readable by Admin, Finance, Executive and the PM of the
  project; an Engineer reads none of the amounts and only their own timesheet. Other orgs read nothing.
- FR-TM-041 Clients have no direct INSERT, UPDATE or DELETE on any new table; writes go through the RPCs;
  `org_id` is stamped, never sent.
- FR-TM-042 Separation: setting a rate (Admin, Finance) is separate from approving hours (timesheet approver) is
  separate from confirming client sign-off (Admin or Finance, not the preparer) is separate from approving the invoice
  (not an author). pgTAP proves each denial.

**AC-6 Screens and CLI**
- FR-TM-050 Screens: project → Billing → Rate card; project → Billing → Time and materials (assemble, review
  unrated, prepare sign-off, confirm, claim detail with source drill-down, "Create invoice" via the existing flow).
- FR-TM-051 CLI: `pmo tm rates list`, `pmo tm claim preview --project --from --to` (read-only), `pmo tm claim list`.

## 5. Non-functional requirements

- NFR-TM-001 Org scope from the JWT (`auth_org_id()`), never an argument.
- NFR-TM-002 Money is `numeric`; never float. Quantities `numeric(10,2)` hours/days, rates `numeric(14,2)`.
- NFR-TM-003 Assembly for a project-month with 10k source rows returns in under 2 s (index sources by
  (org, project, date, status)); lists are bounded (`LIST_LIMIT + 1` sentinel); no PostgREST 1000-row truncation of a
  money read (aggregate in SQL).
- NFR-TM-004 Dates use the org timezone for the entry-date cut, stored as `date`.
- NFR-TM-005 All user-visible strings via i18n in `en` and `id`; numbers through the shared formatters.
- NFR-TM-006 Keyboard-operable forms, labelled inputs, AA contrast, no colour-only status (`axe-core` gate).
- NFR-TM-007 Public repo: fixtures synthetic, no tenant data.

## 6. Data model sketch (contract for build; names final at plan time)

| table | key columns |
|---|---|
| `contract_rate_lines` | id, org_id, project_id, line_key, version, is_current, kind `labour\|equipment`, label, asset_id null (equipment), unit `hour\|day`, rate, standby_rate null, effective_from, effective_to null, created_by |
| `contract_rate_assignees` | id, org_id, project_id, line_key, user_id, effective_from, effective_to null |
| `tm_claims` | id (= progress_claims.id once signed off), org_id, project_id, work_order_id null, period_from, period_to, status `Draft\|SignedOff\|Withdrawn`, currency, gross_amount, prepared_by, confirmed_by null, confirm_basis null, document_id null, note |
| `tm_claim_lines` | id, claim_id, line_key, rate_version, kind, label, unit, units, rate, amount; unique (claim_id, line_key) |
| `tm_claim_sources` | id, org_id, claim_id, claim_line_id, source_kind `timesheet_entry\|equipment_usage`, source_id, units; **partial unique (source_kind, source_id) where the claim is live** |

`progress_claims.kind` gains `time_materials`; its shape check admits it. RPCs (security definer, org from the JWT):
`save_contract_rate_line`, `end_contract_rate_line`, `set_contract_rate_assignee`, `assemble_tm_claim` (draft write),
`deselect_tm_source`, `prepare_tm_signoff`, `withdraw_tm_signoff`, `confirm_tm_signoff`, plus stable reads
`preview_tm_claim`, `list_tm_claim`. Errors reuse the repo's codes: `42501`, `22023`, `23514`, `P0001`, `P0002`, `40001`.

## 7. ERP posting via the adapter contract

- **No T&M-specific command, in either ERP.** A T&M claim is a PMO claim whose lines are approved units × frozen contract
  rate; it rides the same revenue invoice command as a volume claim (`docs/specs/odoo-client-invoices.spec.md`
  OQ-OCI-6, FR-OCI-019a, AC-OCI-024). The invoice key is the claim/invoice id, so one claim yields at most one ERP invoice.
- ERPNext: `dispatchRevenue.ts` reads `progress_claim_lines` to build the body
  (`pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenue.ts:409`). T&M lines have no BoQ item; the slice (T6) makes the
  reader return one canonical line shape (label, unit, quantity, rate, amount) for both claim kinds, with an ERP
  item per the org's existing service-item mapping (OQ-TM-9). Odoo reads the same canonical shape (Odoo C4b, after this merges).
- PMO stays the source of the quantities; the ERP's own timesheet or sale-order routes are not used. Hours that disagree
  with an ERP timesheet are not reconciled here (named failure in OQ-TM-9).
- Posting honesty, idempotency, held-not-reissued, and mirror reconciliation are inherited unchanged
  (`docs/money-path-primer.md`).

## 8. Acceptance criteria (Given / When / Then)

| AC | Given / When / Then | Owner layer |
|---|---|---|
| AC-TM-001 | **Issue acceptance.** Given approved timesheet hours 120 h for the assigned engineer and a labour rate of 50,000.00/h, when the claim is assembled, the client signs off and a second user confirms, then the claim line is 120 × 50,000.00 = 6,000,000.00 and the invoice raised from it shows those approved units and that rate | pgTAP |
| AC-TM-002 | Given a T&M claim that is Draft (no confirmed sign-off), when an invoice is raised for it, then the system refuses; given hours that are Submitted, Rejected or Draft, then they are not offered by assembly | pgTAP |
| AC-TM-003 | Given an hour in a live claim, when a second claim is assembled (also in a concurrent call), then the hour is absent from it and the second insert is refused by the unique source; given the first claim is withdrawn, then the hour is offered again | pgTAP |
| AC-TM-004 | Given a claim signed off at 50,000.00/h, when the rate line is changed to 60,000.00 from today, then the claim line still reads 50,000.00; a later claim for later dates uses 60,000.00 | pgTAP |
| AC-TM-005 | Given hours by a person with no assigned line, or a date with no effective rate, then they are listed unrated with a reason, are excluded, and the claim total ignores them | pgTAP |
| AC-TM-006 | Given a preparer who is not the sole active member, when they confirm their own preparation, then it is refused; the sole active member confirms with basis `sole_operator`; a PM cannot confirm; confirm needs an Issued or Approved same-project document with a file | pgTAP |
| AC-TM-007 | Given a signed-off claim, when its invoice is approved by its preparer or its confirmer, then the existing invoice SoD refuses; a third user succeeds | pgTAP |
| AC-TM-008 | Given a source in a live claim, when its timesheet is reopened or the usage entry archived, then it is refused with the claim named; after withdrawal it succeeds | pgTAP |
| AC-TM-009 | Given a T&M invoice, then `billing_kind = contract`, the project's contract drawdown rises by its net, and a contract total above the contract value shows the excess and the invoice in the existing payload | pgTAP |
| AC-TM-010 | Given a linked work order whose remaining value is below the claim gross, when confirming, then the work-order fence refuses with `BW001` and nothing is written | pgTAP |
| AC-TM-011 | Given rates and claims, roles: Engineer reads none; PM reads own project; Finance/Admin write rates; a PM cannot save a rate; other org reads nothing and cannot target a foreign project; no direct table writes | pgTAP |
| AC-TM-012 | Given a rate line in a currency other than the project's, or an overlapping window, then the save is refused | pgTAP |
| AC-TM-013 | Given a rounding case 3 lines of 0.333 h × 100.00, then each line is rounded once and the header equals the sum of lines | pgTAP |
| AC-TM-014 | Given a connected ERPNext org and a signed-off T&M claim, then the invoice body's lines carry label, quantity and rate from the claim lines and none for unsigned hours | Deno |
| AC-TM-015 | **After #1519.** Given approved equipment usage 40 h work and 6 h standby on an asset with rate 800,000.00/h and no standby rate, then the claim bills 40 h and lists 6 h standby as unbilled | pgTAP |
| AC-TM-016 | Given the rate card and assemble screens, when a Finance user sets a rate, assigns a person, a PM prepares and a second user confirms, then the claim detail and the "create invoice" action reflect it; keyboard-only operable | Vitest/RTL + axe |
| AC-TM-017 | CLI `tm rates list`, `tm claim preview` (read-only), `tm claim list` | Vitest (CLI) |
| AC-TM-018 | One curated e2e journey: set rate and assignee, approve a week, assemble, sign off, raise the invoice, see approved units and rate on it | Playwright (one) |
| AC-TM-019 | Given the extended claim fence, when the sign-off is a mutation (fence returns true unconditionally), then AC-TM-002 turns red (mutation check, recorded in the PR) | pgTAP |

## 9. Risks the build must design against

1. **Double billing**: an hour in two claims, or billed and then edited. Unique live-source constraint, reopen refusal.
2. **Unsigned billed**: the invoice path bypassing the sign-off. Fence at the single choke point (the outbox claim fence)
   and at claim creation; mutation-checked.
3. **Rate restatement**: a later rate change rewriting history. Rates frozen on lines; versions windowed.
4. **Silent drop**: unrated hours vanishing. They are listed, with reasons.
5. **Wrong number on screen**: the detail recomputes from frozen lines; sources drill to person and day.
6. **Collusion**: one user sets the rate, signs off and approves the invoice. Separated by role and by author rule.
7. **Internal rate leaking into the client rate**: equipment hire cost (#1519) and client rate are separate columns and tables.

## 10. Owner decisions (each has a default and a named failure if the default is wrong)

- **OQ-TM-1 Rate dimension.** Default: **rates are per project, per billing role label (and per asset for machines);
  people are assigned to a role line per project** (not the system role in `profiles.role`, which is an access role).
  *Wrong:* the contract prices by seniority grade across all projects; PMO has to assign every person on every project and
  rates drift between projects.
- **OQ-TM-2 Which hours are billable.** Default: **every approved hour on the project by an assigned person; no
  per-entry billable flag.** *Wrong:* a site engineer works internal hours on a client project; those are billed
  because nobody unchecked them.
- **OQ-TM-3 Rate period.** Default: **effective-dated versions; a claim freezes the rate it used.** *Wrong:* the client
  expects a retroactive rate correction; PMO needs a credit-and-rebill, which is out of scope.
- **OQ-TM-4 Premiums and standby.** Default: **one rate per unit; machines may carry a standby rate; no overtime
  multiplier, no minimum charge.** *Wrong:* the contract pays 1.5× after 40 h; the invoice under-bills until the premium
  is modelled.
- **OQ-TM-5 Partial sign-off.** Default: **the client signs exactly what was assembled; if they sign fewer, the preparer
  deselects the disputed sources and prepares again.** *Wrong:* the client regularly strikes a few hours; re-preparation is
  tedious. Follow-up: signed quantity per line below approved, with the remainder released.
- **OQ-TM-6 Who confirms.** Default: **Admin or Finance, never the preparer, sole-active-member exception (`0298`).**
  *Wrong:* a PM is expected to confirm client sign-off on site; they cannot, and Finance becomes a bottleneck.
- **OQ-TM-7 Evidence of the signature.** Default: **a scanned or attached signed document in the project documents
  (Issued or Approved, with a file); PMO does not verify the signature.** *Wrong:* a forged or irrelevant file is
  attached; the confirmer is the control, and the audit shows who confirmed.
- **OQ-TM-8 Down-payment recovery.** Default: **none on T&M claims in v1.** *Wrong:* a client advance exists and T&M
  billing runs past it without recovery; the advance stays held until progress claims recover it.
- **OQ-TM-9 ERP item and hours reconciliation.** Default: **T&M lines map to the org's existing service-item
  mapping, one invoice line per rate line, and PMO hours are the source; no reconciliation with ERP timesheets.**
  *Wrong:* the ERP accountant expects ERP-sourced hours; the invoice cannot be traced to ERP hours (as OQ-OCI-6).
- **OQ-TM-10 Priced extras ("materials").** Default: **not in v1: only people and machines are billed.**
  *Wrong:* the client expects consumables on the same sheet; Finance raises a separate ordinary invoice (kind
  contract or other) and the T&M sheet understates the month.
- **OQ-TM-11 Start before #1519?** Default: **yes: ship the labour path (T1 to T4, T6) first; equipment rate lines and
  usage sources (T5) wait for #1519's usage entries to merge.** *Wrong:* the first client needs machines on day one;
  the T&M feature is half-useful until T5.

## 11. Follow-ups (not in this issue)

Client portal or e-signature; partial signed quantity; overtime and premium rules; materials from stock issues (T1);
retention on claims (#1572); down-payment recovery on T&M; ERP-timesheet reconciliation; per-person invoice lines.
