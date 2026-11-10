# Plan — Odoo labour hours and project costs (O7, #1510)

- **Route:** #1481, item O7 of `docs/plans/2026-10-30-epc-odoo-build-route.md` (owner-signed 2026-10-30; ADR-0094). Reuses the shipped P3b timesheet push (`docs/specs/erpnext-adapter-p3b-timesheets.spec.md`, ADR-0059 Posture B, migrations 0136/0138/0161–0166) and the shipped Odoo seam (#1504 directory mirror 0421, `adapter-dispatch`, `odoo-sweep`).
- **Acceptance (the issue's):** Given approved hours and payroll costs, when posted, then the user can reconcile each project attribution and recover an uncertain posting without duplication.
- **Blocked by:** #1504 (Odoo connect and master data — the directory mirror, the project↔cost-account link and the sweep are on `dev`; the issue stays open for its remaining slices, none of which this plan needs) and #1518 (manual payroll sheet — **L5's producer task (T9) waits for it**; the rest of L5 builds and proves the posting machinery with fixture allocations). **Executor:** Director-dispatched per slice (money/SoD: a duplicated week of hours inflates project cost exactly as a duplicated payment inflates cash).
- **Spec:** none exists. §1 carries the requirements (EARS) and acceptance criteria (`FR-OLH-*`, `AC-OLH-*`); they operationalise the signed route item and ADR-0059 §7 only. **The Director confirms §0 and §1 with the owner before L2**; L1 is pure and reversible and may start now. If the owner wants a spec file, §1 moves verbatim to `docs/specs/odoo-labour-hours.spec.md`.
- **Baseline:** every file cited as existing was read at `origin/dev` `916978fa5` (2026-11-09/10). Migration head there is `0820`. Names marked *(new)* do not exist yet.
- **Migration numbers: 0860–0864 only.** Used: **0860** (L2), **0861** (L2), **0862** (L3), **0863** (L5). **0864 is returned unused.** Collision: `scripts/renumber-migration.sh <old> <new>`. Each migration needs `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`.
- **Public repo:** fixtures use invented names (`Example One`, `Example Two`, `PT Contoh Baja`), synthetic UUID prefix `15100000-`, `@example.com` emails, no client names, hosts, secrets or environment-variable names.
- **Executor note:** builders work in their own worktree off `origin/dev`, push branches only, and run the CLAUDE.md local gate (`check:guards`, typecheck, eslint on touched files, the touched vitest files, `deno test` for touched edge functions, the touched pgTAP files under `scripts/with-db-lock.sh`). The bed tasks run under `scripts/with-odoo-lock.sh` (lock order `odoo → erpnext → db → test`).

---

## 0. Decisions (default taken; Director overrides)

| # | Question | Default taken | Why |
|---|---|---|---|
| **D1** | Which Odoo records does labour write? | **Two kinds, one PMO domain:** approved **hours** → `account.analytic.line` rows on each project's analytic account (`hr_timesheet`'s own model; `docs/research/2026-10-30-odoo20-api.md` §2.5, the analytic chain); approved **payroll cost** → one `account.move` entry (miscellaneous journal) whose expense lines carry `analytic_distribution`. Both ride the existing outbox under the `timesheets` domain (`erp_doc_kind` `timesheet` and `labour-cost`). | The route says "connect … to Odoo's analytic records". Analytic lines are the analytic ledger's own record; a journal entry is the only artefact that reaches **both** analytic and financial reporting (an analytic line posts no GL). One domain avoids a second ownership map, cap map and role set for what is one PMO module. |
| **D2** | Analytic-line granularity | **One line per (timesheet, project, entry date)**, hours summed over that day's entries. `date` = the entry date, `employee_id` = the sheet owner's linked employee, `project_id` = the project's Odoo project (so `account_id` is derived by Odoo — bed row 5 of the 2026-10-31 report). | Preserves day-level truth and month boundaries (a payroll period cut mid-week stays correct); one sheet's lines are bounded (≤ 7 × projects). Aggregating to a week would push hours into the wrong month at a week-end date. |
| **D3** | Which artefact carries the **cost**? | **PMO payroll (`payroll` basis, default):** hour lines are written with `amount: 0` and the cost arrives only from the `labour-cost` journal. **`odoo-rate` basis:** hour lines carry no `amount` (Odoo computes hours × `hr.employee.hourly_cost`) and the journal refuses. The basis is an employ-time choice stored in the binding config. | Two cost sources for one project is a double count. PMO computes Indonesian payroll (T7/#1518); stock Odoo Community has **no payroll at all** (the `hr_payroll` engine is Enterprise-only — `docs/research/2026-10-30-odoo20-native-coverage.md` §2.4, §4 row 4), so Odoo can only ever hold an internal hourly rate, never the payroll figure. `amount: 0` is a **bed claim** (V-OLH-4/-5): if Odoo recomputes it from `hourly_cost`, `odoo-rate` becomes the only honest basis and the Director decides before L5 (see §4). |
| **D4** | How is the POSTER of payroll cost authorised? | A DB gate mirroring `approved_timesheet_for_push` (0138): `approved_labour_cost_for_push` re-reads the batch, requires status `Approved`, the caller's org, and the caller to be the batch's approver or Admin/Finance, and returns the **allocations from the DB** — the command payload never decides an amount. | The shipped precedent (0138 + `approvalGuard.ts`), for the shipped reason: a payload-asserted approval is forgeable, and an amount from the payload is an unauthorised GL entry. |
| **D5** | Where does the PMO user ↔ Odoo employee link live? | **`erp_employees`** (0136 §2) unchanged, with the Odoo id in `external_refs` under domain `timesheets` as `hr.employee:<id>`; the confirm path is the shipped `confirm_erp_employee_link` (0148). The Odoo employee mirror is fed by the Odoo sweep, proposes on a unique work-email match, and **never confirms**. | One link table per concept (the shipped one), one confirm RPC, and the existing Approvals "Employee links" surface. A second employee table would fork the SoD-critical rule "whose cost a week of hours becomes". |
| **D6** | Does PMO create Odoo employees? | **No.** `employee.send` stays `unavailable` for Odoo (reason below); `employee.match` becomes `supported`. An Admin links a mirrored employee; a PMO user with no employee cannot have hours posted (`employee-unlinked`). | The ERPNext tier already ruled `employee.send: unavailable` because PMO holds no HR master data and never invents it (`erpnext/workflowDeclarations.ts:27`). Odoo's `hr.employee` needs employment facts too; inventing them is a payroll error. |
| **D7** | Payroll cost artefact and corrections | **One journal entry per approved batch version**, one expense line per project with `analytic_distribution`, one payable line for the total. A correction creates the **next batch revision** and posts the **per-project delta** (new − already posted); a zero delta posts nothing. A posted entry is never edited or reversed by PMO. | A posted `account.move` cannot be edited (V-OLH-9). Deltas keep the net exactly right without reversal machinery, and the anchor is stable per revision (`lcost:<batch>:<revision>`) so a lost answer is adopted, never re-posted. |
| **D8** | Which journal and accounts? | **Admin-chosen at employ time**, from the shipped account/journal mirrors: a miscellaneous journal, a labour-expense account, a payroll-payable account. **No defaults are invented**; an unset config refuses (`labour-cost-unconfigured`) before any Odoo read. | The org's chart is the org's decision; PMO guessing an expense account posts to the wrong P&L line. Same shape as the shipped payment-journal/tax-account defaults. |
| **D9** | Feature gate | **None new.** Both kinds appear when the org employs `timesheets` under Odoo. The Approvals badge, the Employee-links section and the project Labour panel are all keyed on that ownership. | The shipped `timesheets` module has no feature key separate from ownership (`feedKinds.ts:52-57` maps the domain to the `timesheets` switch for the ERPNext feed). |
| **D10** | A project with no cost-account link | **Refused before any outbox row** (`project-unmapped`), naming the project code. | Shipping hours with no analytic account posts nothing (Odoo needs `project_id`), or worse posts to a default. The shipped `resolveOdooCostAccount` already classifies `unlinked`/`needs-attention` (`_shared/odooPurchaseRefs.ts:24-35`). |
| **D11** | Corrections, removals and deletes on the hours side | A re-approved sheet **writes** the anchored lines to the new hours; a project line that no longer exists is **never deleted in Odoo** — PMO marks it `orphaned` and surfaces it. PMO never deletes an analytic line, an `account.move` or an employee. | Deleting in an ERP to make PMO's copy tidy is how an accountant's correction disappears. `orphaned` is a visible, reversible state. |
| **D12** | Currency | **Odoo company currency only.** A batch whose currency is not the company's refuses (`labour-cost-currency`); no conversion in this slice. | Odoo's analytic amount and journal line share the company currency; a PMO-side conversion would be a second FX engine (`fx-rates-jisdor` owns rates). |
| **D13** | Recovery of an uncertain posting | **A person converges; automation holds.** A **person's** push — a new approval or the "Check again" retry (`replay: false`) — creates every missing triple and writes every present one. An **automated recovery** (`replay: true`, i.e. the sweep replaying a frozen row) that finds **some but not all** of the sheet's anchors refuses `labour-lines-incomplete` and creates nothing: an isolate killed between a create and its anchor leaves a line whose anchor is absent, which is indistinguishable from "never created". An automated recovery that finds **nothing** is governed by the outbox (`reissueOnInconclusiveAbsence: false` ⇒ hold). The payroll journal is held on any inconclusive probe. | ADR-0058 C-1 applied to labour: hours and cost are money-adjacent, and an anchor is a second Odoo call here (create, then `ir.model.data`), so a miss is weaker evidence than it is for a partner's `ref`. Holding costs one operator step in a rare case; reissuing costs a duplicated week. |
| **D14** | The ERPNext backstop while Odoo owns `timesheets` | **The ERPNext timesheet backstop must not run for a sheet the org has employed on Odoo** — gated on `domain_owned_by_tier(org,'timesheets','erpnext')` in both its queue halves. | `listPendingTimesheetPushes` and `listApprovedSheetsWithoutMirror` filter by org and status only (`erpnext-sweep/index.ts:2954-2984, 3020-3049`). An org with an ERPNext binding for other domains and Odoo owning `timesheets` would have every approved week pushed to **both** ERPs — the same hours counted twice in two ledgers. This is a defect the plan must close, not a preference. |

---

## 1. Requirements and acceptance criteria

### 1.1 Functional requirements (EARS)

**Employing**

- **FR-OLH-001** — When an Admin employs `timesheets` under Odoo, the system SHALL refuse unless the Odoo connection is activated, no ERPNext ownership of `timesheets` exists, and the stored capability snapshot shows `hr.employee` readable, `account.analytic.line`, `account.move` and `account.move.line` readable, creatable and writable, and `ir.model.data` creatable; the refusal SHALL name the first missing model (or `model:operation`).
- **FR-OLH-002** — Where an org employs `timesheets` under ERPNext, the system SHALL refuse an Odoo employ with words naming the tier that already holds it.
- **FR-OLH-003** — While the org employs `timesheets` under Odoo, the sweep SHALL mirror `hr.employee` into `erp_employees` (`employee_number` = Odoo's `name`, `employee_name`, `work_email`, `erp_status` from `active`, `erp_modified` from `write_date`) within its tick budget, SHALL never write an older `write_date` over a newer one, and SHALL tombstone (never delete) an employee the daily census no longer sees.
- **FR-OLH-004** — When a mirrored employee's `work_email` matches exactly one active PMO profile in the org whose `link_state` is `unlinked`, the feed SHALL set `link_state = 'proposed'` with reason `work-email-exact-match`; it SHALL NOT confirm, and it SHALL NOT change a `confirmed` or `rejected` row's `profile_id`.
- **FR-OLH-005** — When an Admin confirms an employee link, the system SHALL record the Admin and the time, SHALL refuse a foreign-org employee or a non-Admin caller, and SHALL write one audit row; a second confirm for the same employee SHALL replace the link and be audited.

**Hours**

- **FR-OLH-010** — When an approved timesheet is pushed, the system SHALL create, for each (project, entry date) with hours > 0, one `account.analytic.line` carrying `project_id` (the project's linked Odoo project), `employee_id` (the sheet owner's confirmed employee), `date` (the entry date), `unit_amount` (the summed hours, 2 dp), a description naming the PMO sheet, and the activated company; under the `payroll` cost basis it SHALL also write `amount = 0`.
- **FR-OLH-011** — The system SHALL refuse a push before any Odoo call when the sheet is not Approved, the caller may not push it, the owner has no confirmed employee link, any project has no live analytic-account link, an entry's project belongs to another org, or the stored snapshot lacks a model or operation the push uses — naming the reason.
- **FR-OLH-012** — The system SHALL create at most one analytic line per (timesheet, project, entry date), ever: each line SHALL carry an immutable Odoo external identifier derived from that triple; a fresh push SHALL create every missing line and write every present one, while a recovery of an unknown outcome that finds some but not all anchors SHALL hold with nothing created.
- **FR-OLH-013** — When a re-approved sheet no longer contains an anchored (project, date) line, the system SHALL leave the Odoo line in place and SHALL mark that line `orphaned` in PMO; it SHALL NOT delete any Odoo record.
- **FR-OLH-014** — When a pushed line's stored Odoo `amount` is not zero under the `payroll` cost basis, the system SHALL mark the line `cost-drift` within the sweep's reconciliation window and surface it to an Admin/Finance viewer; it SHALL NOT silently accept the figure.

**Payroll cost**

- **FR-OLH-020** — When an approved labour-cost batch version is pushed, the system SHALL create one `account.move` of type `entry` in the configured journal with one expense line per project (debit = the project's delta, `analytic_distribution` = that project's analytic account at 100 %) and one payable line for the total (credit), then post it.
- **FR-OLH-021** — The batch, its approver and its allocations SHALL be read from the database by the gate; the command payload SHALL NOT decide the approval, the approver, the accounts or any amount.
- **FR-OLH-022** — The system SHALL post the per-project delta between the batch version's allocations and the amounts already posted for the batch through earlier revisions; where every delta is zero it SHALL post nothing and record the version as settled.
- **FR-OLH-023** — The system SHALL refuse a push before any Odoo call when the journal, the labour-expense account or the payroll-payable account is unset; the batch is not Approved; the batch currency is not the company currency; an allocation is non-positive, not two decimal places, or names an unlinked project; or the batch's lines sum to a different total than its header.

**Reconciliation**

- **FR-OLH-030** — When a user opens a project's finances, the system SHALL show, per period, the hours posted to that project (from PMO's own posting records), the payroll cost posted (batch, period, amount, state) and when PMO last read the project's Odoo state.
- **FR-OLH-031** — While Odoo cannot be reached, the system SHALL keep showing the last known figures with their time, SHALL disable every labour write with the reason, and SHALL never render a failed read as zero.
- **FR-OLH-032** — The system SHALL offer an Admin/Finance viewer a "Check again" for a held or failed posting that re-sends the same command under its stored key, and SHALL show held postings without a retry button.

### 1.2 Non-functional

- **NFR-OLH-001** — No Odoo customisation: stock models and fields only; every Odoo field name lives in `adapterSeam/odoo/labour/*` and is backed by a §4 verdict.
- **NFR-OLH-002** — The labour reads add at most 1 call per pushed line's read-back and at most 2 calls per kind to a tick's reserve, and only for orgs that employ `timesheets` under Odoo.
- **NFR-OLH-003** — All copy in English and Indonesian, both files in one commit.
- **NFR-OLH-004** — Every new SECURITY DEFINER function is on the isolation denominator, revoked from `public`/`anon`, and granted only to the role that needs it.

### 1.3 Acceptance criteria (Given/When/Then; owning layer in §6)

- **AC-OLH-001** — Given an activated Odoo connection whose snapshot lacks `account.analytic.line:create`, when an Admin employs `timesheets`, then it is refused naming `account.analytic.line:create`; with a full snapshot and the journal and accounts chosen it succeeds and writes one audit row.
- **AC-OLH-002** — Given an org that employs `timesheets` under ERPNext, when an Admin tries to employ it under Odoo, then it is refused with the words naming ERPNext.
- **AC-OLH-010** — Given Odoo employees `Example One` (email `one@example.com`) and `Example Two`, when the feed applies a page and then a newer page renames `Example One`, then `erp_employees` holds the new name and the later `write_date`; an older page applied after it changes nothing; an employee absent from the census is tombstoned, not deleted.
- **AC-OLH-011** — Given profiles `one@example.com` (active) and `two@example.com` (disabled), when the feed proposes, then `Example One` becomes `proposed` against the active profile and `Example Two` stays `unlinked`; a `confirmed` row is left byte-identical by a feed page that changes the email.
- **AC-OLH-012** — Given a proposed employee row, when a non-Admin confirms it, then it is refused (42501); when the org's Admin confirms it, then `link_state = confirmed`, `linked_by`/`linked_at` are the server's, and one audit row records it; confirming a second employee for the same profile replaces the first.
- **AC-OLH-020** — Given an approved sheet with 3 h and 1 h on `P-1` Monday, 2.5 h on `P-1` Tuesday and 4 h on `P-2` Monday, when the push is built, then it carries one line for `P-1` dated Monday with 4 h, one for `P-1` dated Tuesday with 2.5 h and one for `P-2` dated Monday with 4 h — each naming the project, the linked employee, the entry date and the company, and each with `amount` 0 under the payroll basis.
- **AC-OLH-021** — Given an Engineer-role approver pushing an approved sheet, when the owner has no confirmed employee link, then it is refused `employee-unlinked` with zero Odoo calls and no outbox row; given a linked owner but a project with no live cost account, then it is refused `project-unmapped` naming the project code.
- **AC-OLH-022** — Given a definite failure after two of three lines landed, when a person presses "Check again", then the two anchored lines are adopted and the third is created under its own anchor, exactly once (three lines, no fourth); given instead an **automated** recovery that finds two of three anchors, then it holds with nothing created and the sheet says the lines need checking in Odoo; one line exists per (project, date) at all times.
- **AC-OLH-023** — Given a sheet pushed with lines on `P-1` and `P-2`, when it is re-approved without `P-2`, then `P-2`'s Odoo line still exists, PMO records it `orphaned`, and the project panel shows one orphaned line.
- **AC-OLH-030** — Given an approved batch version with deltas on `P-1` 1,000,000 and `P-2` 500,000 in the company currency, when the entry is built, then its body is one `entry` in the configured journal with one expense line per project carrying that project's analytic account at 100 %, one payable line with the total as a credit, and debit total = credit total; a project with no analytic account refuses the build naming the project code.
- **AC-OLH-031** — Given a batch approved by Finance user F, when a Project Manager posts it, then it is refused (42501) with no outbox row; when F posts it, then it is accepted; when an amount in the payload differs from the DB, then the DB amount is what posts.
- **AC-OLH-032** — Given a batch version 1 posted at 1,500,000, when revision 2 allocates 1,200,000 and 400,000, then the second entry posts a +200,000 delta on `P-2` only, and a revision 3 that restates the same figures posts nothing and records the version settled.
- **AC-OLH-040** — Given a project with labour postings, when its finances render, then the Labour section shows hours by period, cost postings with state, the last-read time, an orphaned line, a held posting without a retry, a failed posting with "Check again" for Finance, and the empty, loading, error and Odoo-unreachable states with their copy.
- **AC-OLH-090** *(the issue's acceptance, cross-stack, on the bed)* — Given an org employing `timesheets` under Odoo with a confirmed employee link and a linked project, when the manager approves a week and Finance posts the approved payroll batch, then Odoo holds one analytic line per (project, date) with those hours and exactly one posted journal entry carrying the batch's per-project amounts on the projects' analytic accounts; when the batch is corrected and re-approved, then a second entry carries only the deltas; and the project's Labour panel shows the same hours and cost.

---

## 2. Data flow

```
 Approvals (manager)                     Administration → Labour cost (Finance)
   approve ─► transition_timesheet            approve batch ─► labour_cost_batches.status = 'Approved'
        │  (shipped, SoD: approver ≠ owner)          │  (produced by #1518's payroll run; L5 waits for it)
        ▼                                            ▼
 repositories.timesheet.pushApproved          repositories.labourCost.pushApproved
        │  gate: approved_timesheet_for_push (0138)     │ gate: approved_labour_cost_for_push *(new, 0863)*
        ▼                                            ▼
 dispatchDomainCommand('timesheets', 'create', …)   dispatchDomainCommand('timesheets', 'create',
        │  key ts:<sheet>:<approved_at>                    {erp_doc_kind:'labour-cost'}, key lcp:<batch>:<approved_at>)
        ▼                                            ▼
 adapter-dispatch ─ authGuard (OWNING_TIERS.timesheets → erpnext | odoo)
        │            approvalGuard (payload replaced by DB truth)
        ▼
 resolveOdooTimesheetAdapter / resolveOdooLabourCostAdapter      *(new)*
        │  preflight: employee link · project→analytic account · channels · capability gap
        ▼
 dispatchMoneyWrite (outbox: claim → probe anchors → create/write → finalize)  (shipped, ADR-0058)
        │                                   │
        │ hours: account.analytic.line      │ cost: account.move(move_type 'entry') + action_post
        │ one per (sheet, project, date)    │ one per batch revision, delta lines per project
        ▼                                   ▼
 readModel writer (timesheets, tier-branched):  timesheet_erp_mirror.push_state  (shipped table)
                                                + odoo_labour_lines *(new, 0862)*
                                                + labour_cost_postings *(new, 0863)*
        │
        ▼
 odoo-sweep labour pass *(new)*: employee feed → outbox recovery → mirror queue backstop
                                 → anchored-line reconcile (existence + amount drift)

 Project → Finances → Labour panel reads PMO tables only (never Odoo on render).
```

- **PMO stays the SoT for entry and approval** (ADR-0059 §7, OD-TS-1: whole-week, line-manager approval, never self-approval). Odoo owns the analytic and financial records that result. Nothing about the push decides whether an approval happened.
- **One PMO record, one external artefact per line/batch revision.** The outbox key is deterministic (`ts:`, `lcp:`); the per-line anchor is immutable and keyed by the triple; the per-batch anchor is keyed by the revision. A second attempt collides on the outbox 4-tuple or adopts on the anchor — never a second line, never a second entry for one revision.
- **The analytic ledger and the GL meet here.** Hours write analytic lines only (no GL). Cost writes a journal entry, whose lines generate analytic lines (V-OCI4/V-ODA2 shape) **and** reach the shipped ledger feed (`odoo/ledger/feed.ts`, 0744), so project actuals on `dev` pick labour cost up with no new read path.
- **Not a Posture-A flip** (ADR-0059): `timesheets`/`timesheet_entries` stay user-writable; the Odoo state lives in `timesheet_erp_mirror` (shipped side table) plus the posting tables this plan adds (`odoo_labour_lines`, and `labour_cost_batches`/`labour_cost_allocations`/`labour_cost_postings`). The reversal is dropping those four tables and the ownership row; no PMO time data is lost.
- **What crosses layers, and what must not:** pages → repositories → dispatch (ADR-0017). `pages/**` never imports the DAL. The adapter keeps every Odoo field name; the DB keeps every rule (gate, delta, orphan, drift).

---

## 3. What exists on dev (reuse; never re-invent)

**Prior art first** (`scripts/prior-art.sh timesheet`, `scripts/prior-art.sh labour`, 2026-11-10): **OD-TS-1..4 — timesheet approval, LOCKED 2026-06-04** (whole-week sheet, approver = line manager, never self-approve, per-project PM approval deferred by OD-TS-3); **ADR-0059** (Posture B: PMO SoT with an external side mirror); **ADR-0058** (the fenced outbox); **ADR-0048** (the ledger is the oracle); **ADR-0019** (server-enforced SoD); **ADR-0010** (test layers); **#1271** (cost attribution — read-side only, which this plan does not touch). The word *labour* has no ruling of its own: both searches return no decision for it, which is not proof that none exists — the closest rulings are the ones named here.

**Research:** `docs/research/2026-10-30-odoo20-api.md` §2.5 (the analytic model, `analytic_distribution`, timesheet costing), `docs/research/2026-10-30-odoo20-native-coverage.md` §2.4/§4 (Community has no payroll) and `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §5 (the verified analytic chain, the timesheet-as-analytic-line shape, `hr.employee.hourly_cost`).

| Need | Exists | Where |
|---|---|---|
| Whole-week approval, line-manager approver, never self-approve | `timesheets`, `timesheet_entries`, `transition_timesheet` | `0007_timesheet_approval.sql:176-205`; `docs/decisions.md` OD-TS-1..4 (LOCKED 2026-06-04) |
| Approved-only gate read (org + status + actor + entries from the DB) | `approved_timesheet_for_push` | `supabase/migrations/0138_approved_timesheet_for_push.sql:34-120` |
| Dispatch-side gate + canonical identity replacement | `enforceTimesheetApproved`, `isTimesheetPush`, `applyCanonicalTimesheetTruth` | `supabase/functions/adapter-dispatch/approvalGuard.ts:57-120`; wired `adapter-dispatch/index.ts:339-420` |
| Deterministic push key shared by UI and sweep | `timesheetPushKey` → `ts:<uuid>:<stamp>` | `pmo-portal/src/lib/adapterSeam/erpnext/timesheetPushKey.ts`; admitted by `adapter-dispatch/transitionTargetGuard.ts:234` |
| FE push command (routing is ownership-based, tier-agnostic) | `repositories.timesheet.pushApproved` | `pmo-portal/src/lib/repositories/timesheets.ts:56-83`; `routeDomainWrite` `adapterSeam/ownershipCache.ts:73` |
| Push-state side table (pending/pushing/pushed/failed/held + fair-order stamp) | `timesheet_erp_mirror` | `0136_p3b_timesheet_erp_storage.sql:33-60`; `0427_sweep_queue_last_attempt.sql:15` |
| Push-state surfaces | `PushStateBadge`, Approvals `PushAttentionSection`, `ReopenableApprovedSection`, `db/timesheetPush.ts` (`getPushState`, `listPushesNeedingAttention`) | `pmo-portal/src/components/timesheets/PushStateBadge.tsx`; `pmo-portal/pages/approvals/*`; `pmo-portal/src/lib/db/timesheetPush.ts` |
| Operator attestation out of an unknown outcome | `attest_timesheet_no_erp_document` | `supabase/migrations/0164_timesheet_post_submit_unknown_witness.sql:444-503` |
| Employee link storage + confirm (tier-neutral) | `erp_employees`, `confirm_erp_employee_link` | `0136_…:82-130`; `supabase/migrations/0148_confirm_erp_employee_link.sql:24-90` |
| Employee-link surfaces | `EmployeeLinkConfirmSection`, `useProposedEmployeeLinks`, `db/timesheetPush.listProposedEmployeeLinks` | `pmo-portal/pages/approvals/EmployeeLinkConfirmSection.tsx`; `pmo-portal/src/hooks/useTimesheetApproval.ts:230-260` |
| Confirmed-employee lookup + fail-closed ref preflight | `lookupConfirmedErpEmployee`, `resolveTimesheetRefs` | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchTimesheet.ts:16-90` |
| Money-tier detection (odoo already a money tier) | `MONEY_TIERS`, money-idempotency path | `pmo-portal/src/lib/adapterSeam/dispatch.ts:786-800` |
| Outbox claim/commit/finalize/recover | `dispatchMoneyWrite` | `pmo-portal/src/lib/adapterSeam/dispatch.ts`; primer `docs/money-path-primer.md` |
| Domain ownership gate across tiers | `OWNING_TIERS`, ownership loop, kind→domain check | `supabase/functions/adapter-dispatch/authGuard.ts:58,100-160` |
| Role rule delegated to a DB gate | `ROLE_RULE_DELEGATED_TO_DB_GATE` includes `timesheets` | `supabase/functions/adapter-dispatch/authGuard.ts:44-52` |
| Kind→domain map (has `timesheet`, `employee`) | `KIND_DOMAIN` | `pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts:20-44` |
| Money-write roles per domain (empty ⇒ fail closed) | `moneyWriteRolesForDomain` | `supabase/functions/_shared/moneyWriteRoles.ts:18-32` |
| Odoo adapter registry + outbox-deps router | `ODOO_ADAPTER_REGISTRY`, `resolveOdooMoneyOutboxDeps` | `supabase/functions/adapter-dispatch/odooAdapters.ts:139`; `odooMoneyOutbox.ts:172-176` |
| Non-document Odoo command through the outbox (create → anchor probe, held) | companies: `resolveOdooCompaniesAdapter`, `resolveOdooCompaniesMoneyOutboxDeps`, `odooCompanyAnchorKey` | `supabase/functions/adapter-dispatch/odooCompanies.ts` (whole file) |
| Odoo recovery pass (`outbox_reconcile_candidates` → reauthorise → `dispatchMoneyWrite`) | `reconcileOdooProcurementOutbox`, `reconcileOdooRevenueOutbox` | `supabase/functions/adapter-dispatch/odooProcurementRecovery.ts:1-120`; `_shared/odooSweep.ts:188-234` |
| Sweep tick, kind loop, reserve, after-sweep seams | `ODOO_KIND_ORDER`, `RESERVE_PER_KIND`, `AFTER_SWEEP`, kind loop | `supabase/functions/_shared/odooSweep.ts:24,162,235-245,54` |
| Generic kind runner + census | `runKind`, `runCensus`, `odooKindReaders`, `KindRunDeps` | `pmo-portal/src/lib/adapterSeam/odoo/sweep.ts:55-140` |
| Request bodies / parsers | `anchorDocument`, `externalIdentifier`, `parseOdooExternalRef`, `probeOdooByAnchor` | `odoo/procurementAdapter.ts:96-104`; `odoo/purchase/anchors.ts`; `odoo/purchase/recoveryProbe.ts` |
| Immutable-anchor probe by `ir.model.data` | `externalIdentifier` → `{module:'pmo', name:<key normalised>}` | `odoo/purchase/anchors.ts` |
| Project → analytic account (fail-closed classification) | `resolveOdooCostAccount` → `{resolved|unlinked|needs-attention}` | `supabase/functions/_shared/odooPurchaseRefs.ts:24-35` |
| `analytic_distribution` write shape | revenue invoice line | `odoo/revenue/invoiceBody.ts:109` |
| Ledger feed (reads `account.move.line`, incl. `analytic_distribution`) | `ledger/feed.ts`, `runLedgerPass` | `pmo-portal/src/lib/adapterSeam/odoo/ledger/feed.ts:14-57`; `_shared/odooLedgerFeed.ts` |
| Capability discovery + probe | `O1_MODELS`, `LATER_MODELS` (already lists `account.analytic.line`), `probeModel`, `CapabilitySnapshot` | `odoo/discovery.ts:20-51,55-84` |
| Capability-gap pattern | `procurementCapabilityGap`, `equipmentCapabilityGap` (#1511) | `odoo/purchase/capabilities.ts`; `odoo/assets/capabilities.ts` |
| Workflow declarations already reserving this work | `employee.match`, `employee.send`, `cutover.timesheet`, `timesheet.push` = pending #1510 | `odoo/workflowDeclarations.ts:17,34-35,42,54` |
| Shared contract suite for `timesheet.push` | `timesheetPushSuite`, harness `pushTimesheet` (currently rejects `pending`) | `adapterSeam/contractSuite/timesheet.suite.ts:1-40`; `odoo/contract.harness.ts:307` |
| Employee kind unserved in Odoo setup today | `unserved('employee')`, `sendMaster` has no employee arm | `odoo/connectAdapter.ts:124-170` |
| Employ verb + DB guard | `EMPLOYABLE`, `admin_change_domain_ownership` | `external-set-company/odoo/purchasing.ts:12`; `0743_companies_employ_guard.sql:21-104` |
| Odoo setup checklist rows + employ action | `OdooSetupChecklist` steps array, `EmployAction` | `src/components/integrations/odoo/OdooSetupChecklist.tsx:81-153` |
| Push error copy (tokens → plain words) | `describePushError`, `employee-unlinked`, `project-unmapped`, `analytic-plan-unset`, `command-held` | `pmo-portal/src/lib/adapterSeam/pushErrorCopy.ts:129,134,198,208` |
| Project finances section (where the Labour panel goes) | `ProjectFinancesSection`, `ProjectEquipmentPanel` (the sibling pattern) | `pmo-portal/pages/project-detail/ProjectFinancesSection.tsx:19,291`; `ProjectEquipmentPanel.tsx:15-40` |
| Migration conventions (reversible, rollback dir, revocation) | — | `docs/plans/2026-11-09-odoo-fleet-maintenance.md` §Conventions; `scripts/check-migration-collisions.sh` |
| Bed + lock | `scripts/odoo-dev-bed.sh` (`hr_timesheet` installed), `scripts/with-odoo-lock.sh` | `docs/environments.md` "Odoo 20 Community dev bed" |

---

## 4. Bed claims to verify (V-OLH), and what L1 assumes meanwhile

The 2026-10-31 bed report verified the analytic chain, the timesheet-as-analytic-line shape and `hr.employee.hourly_cost` (`docs/research/2026-10-31-odoo20-dev-bed-verification.md` §5, notes `:130-133`). Everything below is **not** covered there; L1 writes the fake and the builders to these field names, and **L0 confirms each before the slice that depends on it starts**: V-OLH-1/-2/-6/-12 before L3, V-OLH-4/-5/-7/-8/-9 before L5. A differing verdict is a one-line change in `odoo/labour/*` plus its fixture.

| V | Claim | Used by |
|---|---|---|
| V-OLH-1 | An `account.analytic.line/create` that names an explicit `employee_id` succeeds for the integration user even though that user has no `hr.employee` of its own; without `employee_id` it fails 422 "Timesheets must be created with an active employee" (report row 7) | L3 create path, runbook prerequisite |
| V-OLH-2 | `account.analytic.line` v20 fields: `name, date, unit_amount, amount, project_id, employee_id, company_id, account_id, write_date`; `account_id` is derived from `project_id` on create; `project_id` may be set without `task_id` | kinds, bodies, read-back |
| V-OLH-3 | The integration user can `search_read` `hr.employee` (`name, work_email, active, write_date`) — or must read `hr.employee.public` instead | L2 employee feed, employ gate |
| V-OLH-4 | `amount` is writable at create on `account.analytic.line` and the stored value is the one sent (`0`), not recomputed from `hourly_cost` at create | D3 payroll basis, AC-OLH-020 |
| V-OLH-5 | A later write to `hr.employee.hourly_cost` does **not** recompute existing analytic lines' `amount` (if it does, `payroll` basis cannot be durable and D3 flips) | FR-OLH-014, D3 fallback |
| V-OLH-6 | An `ir.model.data` row (`module='pmo'`, name from the key) on `account.analytic.line` and on `account.move` can be created by the integration user only with the Access Rights group, and survives an edit of the anchored record | anchors, AC-OLH-022 |
| V-OLH-7 | `account.move/create {move_type:'entry', journal_id, line_ids:[[0,0,{account_id,debit,credit,name,analytic_distribution}]]}` then `action_post {ids}` posts it (state `posted`) and generates analytic lines whose `amount` equals the debit | L5 journal body, AC-OLH-030 |
| V-OLH-8 | `analytic_distribution` keys are analytic-account ids as **strings**, values numbers; a yearless distribution key is accepted on an `entry` line (the multi-plan `"id,id"` shape is not needed here) | L5 body |
| V-OLH-9 | A posted `account.move` refuses `write` on `line_ids`/amounts (so a correction must be a new entry, D7); `button_draft` availability is recorded but unused | D7, FR-OLH-022 |
| V-OLH-10 | `account.analytic.line/search_read` by `[['id','in',[ids]]]` returns the lines and their current `amount`/`unit_amount` (the reconciliation read) | FR-OLH-014, L3 reconcile |
| V-OLH-11 | Deleting an analytic line in Odoo leaves no tombstone for the sweep (only an id reconcile sees it) | FR-OLH-013, L3 reconcile |
| V-OLH-12 | `has_access` answers for the integration user on `account.analytic.line` (create/write) and `account.move` (create/write) — the employ gate's truth | L2 employ blocker |
| V-OLH-13 | A `type='general'` `account.journal` exists and is writable by the integration user; the chosen expense and payable accounts are postable (`deprecated` false) | L5 preflight |

**If V-OLH-4 or V-OLH-5 differs**, D3 changes before L5: the cost basis defaults to `odoo-rate`, the payroll journal is deferred to a follow-up, and the acceptance is met by hours × the Odoo rate (recorded in this plan's §0 and in the runbook). L5 does not start until the two verdicts are written.

---

## 5. Screens and every state (UI lane; L6)

Tokens and primitives only (`DESIGN.md`; `ListPage`, `DataTable`, `StatusPill`, `EntityFormModal`, `useEntityForm`, `TextField`, `SelectField`, `Combobox`, `FormGrid`, `ConfirmDialog`, `ListState`, `OdooConnectionBanner`). Composition: the Director's one rendered review (impeccable + taste); the owner judges screenshots. Dates via the shared formatters; the em dash is the only empty marker.

### 5.1 Approvals — "Needs attention" and Employee links (existing surfaces, extended)

- `PushAttentionSection` already lists `failed`/`held` mirror rows for the caller's audience. With Odoo, a held timesheet reads: badge `held`, body "Odoo did not confirm 2 of 5 hours lines. An Admin needs to check them in Odoo before anything is sent again." (a new `describePushError` code `labour-lines-held`).
- `EmployeeLinkConfirmSection`: unchanged behaviour; the copy becomes tier-neutral where it says "ERP employee" → "employee record in Odoo" when the org employs Odoo (`useExternalDomainOwnership`).
- States: none new; the shipped empty ("Nothing needs attention"), loading and error states stay.

### 5.2 Project → Finances → **Labour** (new panel, beside `ProjectEquipmentPanel`)

Shown when the org employs `timesheets` under Odoo; otherwise absent (today's page byte-for-byte).

- Heading "Labour"; subtitle "Approved hours and payroll cost sent to Odoo."
- **Hours** table (all roles): Period · Project · Hours · Status (Posted · Not in Odoo any more · Carries a cost) · Last read from Odoo. Newest first, 50 rows, "Showing {{shown}} of {{total}}".
- **Cost** table (Admin/Finance/Executive/PM: the `get_project_finances` audience): Period · Batch · Amount · State pill (Posted · Waiting for Odoo · Did not post · Held) · Posted at. Amounts via `formatExactMoney` in the project currency; em dash when unknown.
- **Drift strip** (Admin/Finance): "{{count}} hour line(s) carry a cost in Odoo that PMO did not post. Check the employee rate in Odoo." with a link to Employee links.
- **Waiting strip**: "Waiting for Odoo to confirm {{count}} posting(s)." + "Check again" (Admin/Finance) re-sending the stored key.
- **Held strip**: "Odoo did not confirm {{count}} posting(s). Finance needs to check them in Odoo before anything is sent again." (no button).
- States: loading (`ListState loading`), error with Retry, empty ("No labour posted to this project yet." / "Approved hours appear here after the manager approves the week."), truncated note, Odoo unreachable → `OdooConnectionBanner` above the panel + actions disabled with the reason as tooltip and `aria-describedby`, non-employing org → panel absent.

### 5.3 Administration → **Labour cost** (new section, Admin + Finance)

- Title "Labour cost"; subtitle "Approved payroll cost per project, and where it stands in Odoo."
- Table: Period · Revision · Projects · Total · State (Draft · Approved · Posted · Nothing to post · Did not post · Held) · Action.
- Row action: "Post to Odoo" (the batch's approver, Admin or Finance) with a `ConfirmDialog` naming the total and the project count; "Check again" for `failed`; nothing for `held`.
- Empty state: "No approved payroll cost yet. A payroll run produces it." Hint (when #1518 is absent): the runbook link.
- Non-employing org: the section is not routed (the Administration nav hides it, `may('manage','labourCost')` false when nothing is employed).
- States: loading, error + Retry, saving (row busy, table read-only), refusal inline (`pushErrorCopy`), success toast "Posted to Odoo".

### 5.4 Odoo setup checklist — new rows (existing component)

- Row "Labour hours in Odoo" — done when `timesheets` is employed on `odoo`; hint "After this, approved hours and payroll cost are posted to your projects in Odoo."; Admin-only button "Use Odoo for labour" (a third `EmployAction` domain).
- Row "Cost basis" — `SelectField`: "PMO payroll posts the cost" (default) / "Odoo rates the hours"; help line explaining the double-count avoidance; saved through an actor-checked setter.
- Row "Labour accounts" — three `Combobox` picks over the mirrored journals/accounts (journal, labour expense, payroll payable) and a Save; refusals inline.

### 5.5 Copy (en | id) — new keys

Namespace `labour` unless marked `administration`. Both locale files in the same commit.

| Key | en | id |
|---|---|---|
| `panel.title` | Labour | Tenaga kerja |
| `panel.subtitle` | Approved hours and payroll cost sent to Odoo. | Jam yang disetujui dan biaya gaji yang dikirim ke Odoo. |
| `panel.hours` | Hours | Jam |
| `panel.cost` | Payroll cost | Biaya gaji |
| `panel.period` | Period | Periode |
| `panel.project` | Project | Proyek |
| `panel.lines` | Lines | Baris |
| `panel.amount` | Amount | Jumlah |
| `panel.batch` | Batch | Batch |
| `panel.state` | State | Status |
| `panel.postedAt` | Posted | Dibukukan |
| `panel.lastRead` | Last read from Odoo {{time}} | Terakhir dibaca dari Odoo {{time}} |
| `panel.statePosted` | Posted | Dibukukan |
| `panel.stateWaiting` | Waiting for Odoo | Menunggu Odoo |
| `panel.stateFailed` | Did not post | Gagal dibukukan |
| `panel.stateHeld` | Held | Ditahan |
| `panel.orphaned` | No longer on the timesheet | Tidak lagi ada di lembar jam |
| `panel.emptyHours` | No labour posted to this project yet. | Belum ada tenaga kerja yang dibukukan ke proyek ini. |
| `panel.emptyHoursSub` | Approved hours appear here after the manager approves the week. | Jam yang disetujui muncul di sini setelah manajer menyetujui minggunya. |
| `panel.drift` | {{count}} hour line(s) carry a cost in Odoo that PMO did not post. Check the employee rate in Odoo. | {{count}} baris jam memuat biaya di Odoo yang tidak dibukukan PMO. Periksa tarif karyawan di Odoo. |
| `panel.waiting` | Waiting for Odoo to confirm {{count}} posting(s). | Menunggu Odoo mengonfirmasi {{count}} pembukuan. |
| `panel.held` | Odoo did not confirm {{count}} posting(s). Finance needs to check them in Odoo before anything is sent again. | Odoo tidak mengonfirmasi {{count}} pembukuan. Keuangan perlu memeriksanya di Odoo sebelum ada yang dikirim ulang. |
| `panel.checkAgain` | Check again | Periksa lagi |
| `cost.title` | Labour cost | Biaya gaji |
| `cost.subtitle` | Approved payroll cost per project, and where it stands in Odoo. | Biaya gaji yang disetujui per proyek, dan statusnya di Odoo. |
| `cost.revision` | Revision | Revisi |
| `cost.projects` | Projects | Proyek |
| `cost.total` | Total | Total |
| `cost.post` | Post to Odoo | Bukukan ke Odoo |
| `cost.confirm` | Post {{total}} for {{count}} project(s)? | Bukukan {{total}} untuk {{count}} proyek? |
| `cost.posted` | Posted to Odoo | Dibukukan ke Odoo |
| `cost.empty` | No approved payroll cost yet. A payroll run produces it. | Belum ada biaya gaji yang disetujui. Proses penggajian akan menghasilkannya. |
| `cost.draft` | Draft | Draf |
| `cost.approved` | Approved | Disetujui |
| `cost.settled` | Nothing to post | Tidak ada yang dibukukan |
| `cost.held` | Held | Ditahan |
| `cost.failed` | Did not post | Gagal dibukukan |
| `administration:odoo.checklist.labour` | Labour hours in Odoo | Jam kerja di Odoo |
| `administration:odoo.checklist.labourHint` | After this, approved hours and payroll cost are posted to your projects in Odoo. | Setelah ini, jam yang disetujui dan biaya gaji dibukukan ke proyek Anda di Odoo. |
| `administration:odoo.employ.labourAction` | Use Odoo for labour | Gunakan Odoo untuk tenaga kerja |
| `administration:odoo.employ.labourTitle` | Post labour to Odoo? | Bukukan tenaga kerja ke Odoo? |
| `administration:odoo.employ.labourBody` | From now on, approved timesheets and approved payroll cost are posted to your projects' analytic accounts in Odoo. PMO keeps entry and approval. | Mulai sekarang, lembar jam yang disetujui dan biaya gaji yang disetujui dibukukan ke akun analitik proyek Anda di Odoo. PMO tetap memegang pencatatan dan persetujuan. |
| `administration:odoo.employ.labourConfirm` | Use Odoo for labour | Gunakan Odoo untuk tenaga kerja |
| `administration:odoo.checklist.labourBasis` | Cost basis | Dasar biaya |
| `administration:odoo.checklist.labourBasisPayroll` | PMO payroll posts the cost | Gaji dari PMO yang membukukan biaya |
| `administration:odoo.checklist.labourBasisOdoo` | Odoo rates the hours | Odoo menghitung dari tarif jam |
| `administration:odoo.checklist.labourAccounts` | Labour accounts | Akun tenaga kerja |
| `administration:odoo.checklist.labourJournal` | Journal | Jurnal |
| `administration:odoo.checklist.labourExpense` | Labour expense account | Akun beban tenaga kerja |
| `administration:odoo.checklist.labourPayable` | Payroll payable account | Akun utang gaji |

`pushErrorCopy.ts` codes added in L3/L5: `labour-lines-held` → "Odoo did not confirm every hour line. An Admin needs to check them in Odoo." / "Odoo tidak mengonfirmasi semua baris jam. Admin perlu memeriksanya di Odoo."; `labour-cost-unconfigured` → "Choose the labour journal and accounts in the Odoo setup first." / "Pilih jurnal dan akun tenaga kerja di pengaturan Odoo terlebih dahulu."; `labour-cost-currency` → "Payroll cost must be in the Odoo company currency." / "Biaya gaji harus dalam mata uang perusahaan Odoo."; `employee-unlinked` stays (it is the shipped refusal for the owner's missing link).

---

## 6. Traceability (each AC has exactly one owning test)

| AC | Owning layer | File (new unless noted) | Slice |
|---|---|---|---|
| AC-OLH-001 | pgTAP | `supabase/tests/odoo_labour_employ.test.sql` | L2 |
| AC-OLH-002 | pgTAP | `supabase/tests/odoo_labour_employ.test.sql` | L2 |
| AC-OLH-010 | pgTAP | `supabase/tests/odoo_labour_employee_feed.test.sql` | L2 |
| AC-OLH-011 | pgTAP | `supabase/tests/odoo_labour_employee_feed.test.sql` | L2 |
| AC-OLH-012 | pgTAP | `supabase/tests/odoo_labour_employee_feed.test.sql` | L2 |
| AC-OLH-020 | Vitest | `pmo-portal/src/lib/adapterSeam/odoo/labour/bodies.test.ts` | L1 |
| AC-OLH-021 | Deno | `supabase/functions/adapter-dispatch/odooLabour.test.ts` | L3 |
| AC-OLH-022 | Deno | `supabase/functions/adapter-dispatch/odooLabour.test.ts` | L3 |
| AC-OLH-023 | pgTAP | `supabase/tests/odoo_labour_lines.test.sql` | L3 |
| AC-OLH-030 | Vitest | `pmo-portal/src/lib/adapterSeam/odoo/labour/costBody.test.ts` | L5 |
| AC-OLH-031 | pgTAP | `supabase/tests/odoo_labour_cost_gate.test.sql` | L5 |
| AC-OLH-032 | Deno | `supabase/functions/adapter-dispatch/odooLabourCost.test.ts` | L5 |
| AC-OLH-040 | Vitest/RTL | `pmo-portal/pages/project-detail/ProjectLabourPanel.test.tsx` | L6 |
| AC-OLH-090 | Playwright, bed-gated | `pmo-portal/e2e/AC-OLH-090-odoo-labour.spec.ts` | L7 |

Supporting (not owning) tests: discovery block in `odoo/discovery.test.ts`, capability gap in `odoo/labour/capabilities.test.ts`, fakes in `odoo/fakeOdoo.test.ts`, adapter cases against `fakeOdoo` in `odoo/labour/adapter.test.ts`, the contract suite in `adapterSeam/contractSuite/*` + `odoo/contract.harness.ts`, DAL/hook tests, i18n parity.

---

## 7. Slice map

| Slice | Contents | ACs owned | Migration | Blocked by | Worker tier | Ships |
|---|---|---|---|---|---|---|
| **L0** Bed verdicts | V-OLH-1..13 on the bed, recorded in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §"O7 findings (#1510)" | evidence | none | bed free (lock) | cheap worker (GLM/DeepSeek) | docs, push direct to `dev` |
| **L1** Read contract (pure) | labour anchors, hours bodies, cost entry body, capability gap, discovery `labour` block, fake Odoo models | 020 | none | none | **Sonnet, ~3 h** | batchable |
| **L2** Employee feed + employ | `apply_odoo_employees`, propose/confirm reuse, sweep employee pass, employ blocker + ownership + `org_employs_odoo_timesheets`, **ERPNext backstop tier gate** | 001, 002, 010, 011, 012 | **0860**, **0861** | L1 (types), L0 (V-OLH-3/-12) | Sonnet; **security-auditor mandatory** | alone (service-role writer + ownership guard + cross-tier gate) |
| **L3** Hours push | Odoo timesheet adapter (per-line anchors), dispatch parts, read-model writer + `odoo_labour_lines`, anchored-line reconcile | 021, 022, 023 | **0862** | L2, L0 (V-OLH-1/-2/-6/-12) | **Opus** (money); security-auditor mandatory | **alone** |
| **L4** Labour backstop and sweep | move the shared backstop to `_shared/`, Odoo live deps, the Odoo sweep's labour pass (outbox recovery + mirror queue), the batch backstop | (supporting) | none | L3 | Sonnet | batchable with L6 |
| **L5** Payroll cost posting | batch/allocation tables, gate, delta, journal body + adapter, dispatch wiring, writer + postings table | 030, 031, 032 | **0863** | L1, L0 (V-OLH-4/-5/-7/-9), L4 for T6 only, #1518 for the producer | **Opus** (money/SoD); security-auditor mandatory | **alone** |
| **L6** Data layer + screens | DAL, repository, hooks, policy, Labour panel, Administration section, checklist rows, i18n | 040 | none | L3, L5 (types) | Sonnet UI lane | batchable |
| **L7** Acceptance, declarations, docs | bed composite, curated e2e, workflow flips, runbook, roadmap | 090 | none | L6, L0 | Sonnet | batchable; docs direct to `dev` |

Order: L0 (as the lock allows) → L1 → L2 → L3 → (L4 ∥ L5; L5's T9 alone waits for #1518) → L6 → L7. Branches `feat/1510-l<n>` off `origin/dev`, own worktree, `.env.local` copied in; workers push branches only; the Director batches and opens PRs. **L3 and L5 ship alone** (money).

---

## Conventions every task follows

- **TDD:** each task names its failing test first, then the code; the commit body states in one sentence why the test failed before and passes after.
- **Local gate:** `cd pmo-portal && npm run check:guards`, then `~/.local/bin/pmo-slot tsc 2 bash -c 'cd pmo-portal && NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck'`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files under `~/.local/bin/pmo-slot vitest 3 …`, touched edge-fn tests via `scripts/deno-test-edge-fns.sh`, migrations also `scripts/check-migration-collisions.sh` and `--self-test`.
- **Command shorthands:** `V` = `cd pmo-portal && npx vitest run <files>`; `D` = `cd supabase/functions/<fn> && deno test --allow-env --allow-net --allow-read <files>`; `P` = `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` from the repo root, output checked for `Parse errors`; `B` = `scripts/with-odoo-lock.sh …` for bed work.
- **Migrations:** reversible, `supabase/migrations/rollback/<NNNN>_<slug>_down.sql` in reverse order, header repeats the reverse. Every function ends `revoke all … from public, anon;` then grants the one role that needs it; service writers `grant execute … to service_role`; client RPCs `grant execute … to authenticated`; definers `set search_path = public`. Rebuilt bodies are copied from the newest definition: `grep -liE "function +(public\.)?<name> *\(" supabase/migrations/*.sql | sort | tail -1`.
- **CI traps per migration slice:** pgTAP `0137` (service_role grants on new functions), `0178` (`client_callable_rpc_names` — add each new **client-callable definer writer** with `-- ⚑ AMENDED BY <NNNN> (#1510)` and re-derive the count by hand), `0646` initplan guard (`(select public.auth_org_id())` in policies, never bare), the isolation denominator (`scripts/isolation-probe-denominator.json`: every new non-trigger SECURITY DEFINER function under `definer_functions`), `0136` side-mirror inventory (**unchanged**: these are push-state tables, not side mirrors).
- **Edge-fn tests** import the shipped handler/module (never a copy) and mock `globalThis.fetch` (`scripts/check-edge-fn-test-binding.mjs`).
- **Git:** conventional commits, no attribution trailers; `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must find nothing; never `--no-verify`; push only `feat/1510-l<n>`.
- **Merge-order note:** #1511 (fleet, in flight) adds `ASSET_MODELS` + `assets` to `odoo/discovery.ts`, `equipment` to `EMPLOYABLE` and its own branch in `admin_change_domain_ownership`. This plan adds `LABOUR_MODELS` + `labour` and a `timesheets` branch to the same two places. Whichever lands second rebases and keeps both; the kinds/employ tests are the check.

---

## L0 — Bed verdicts (no product code)

**L0-T1** *(5 min)* Bring the bed up: `scripts/with-odoo-lock.sh scripts/odoo-dev-bed.sh up`, then `scripts/odoo-dev-bed.sh status`; confirm `hr_timesheet`, `project`, `analytic`, `account` are installed.
**L0-T2** *(15 min)* Extend `scripts/odoo-probe.mjs` with a §O7 block: `fields_get` for `account.analytic.line`, `hr.employee` and `account.move.line`; print per V-OLH row the field's presence and `required`/`readonly` flag (shapes only, no values, never credentials).
**L0-T3** *(20 min)* With the bed's integration key, run the behaviour battery under `scripts/with-odoo-lock.sh`:
- create one analytic line **with** an explicit `employee_id` on a project (V-OLH-1), and one **without** (expect 422, record the message);
- create one with `amount: 0` and read it back (V-OLH-4); write `hourly_cost` on that employee and re-read the line (V-OLH-5);
- create one `ir.model.data` (`module='pmo'`) on the line and on a misc `account.move`, edit the line, re-read the anchor (V-OLH-6);
- create the misc entry with one debit line carrying `analytic_distribution` and one credit line, `action_post`, then `search_read` the analytic lines it generated (V-OLH-7/-8); attempt a `write` on the posted entry (V-OLH-9);
- `search_read` the analytic lines by id (V-OLH-10); delete one in the UI/`unlink` and re-run the id read (V-OLH-11);
- `has_access` battery (V-OLH-12) and the journal/account postability read (V-OLH-13).
**L0-T4** *(10 min)* Record `verified` / `differs: <actual>` per V-OLH row in `docs/research/2026-10-31-odoo20-dev-bed-verification.md` under a new "O7 findings (#1510)" heading. A differing name updates this plan's §4 row and the L1 builder in the same commit. Push docs direct to `dev` (docs-only rule).

---

## L1 — Read contract, pure (no migration; Sonnet, ~3 h)

Files: `pmo-portal/src/lib/adapterSeam/odoo/labour/{anchors.ts,bodies.ts,costBody.ts,capabilities.ts}` *(new)* with their `*.test.ts`, plus edits to `odoo/discovery.ts`, `odoo/discovery.test.ts`, `odoo/fakeOdoo.ts`, `odoo/fakeOdoo.test.ts`.

Why separate files: `kinds.test.ts` requires every `KIND_SPECS` field to be in `O1_MODELS`, and every `O1_MODELS` gap degrades the connection (`connectionState.ts:34`). A timesheet-less Odoo (no `hr_timesheet`) must not degrade an org's connection, so labour models live in their own discovery block that never feeds `missing` — the same reasoning #1511 used for `assets`.

### L1-T1 *(10 min)* Failing test: labels and hours packing (AC-OLH-020)
Create `odoo/labour/bodies.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { packLabourLines, labourLineName, buildLineValue } from './bodies.ts';

const entries = [
  { project_id: 'p1', entry_date: '2026-11-02', hours: '3.00', project_org_id: 'o1' },
  { project_id: 'p1', entry_date: '2026-11-02', hours: '1.00', project_org_id: 'o1' },
  { project_id: 'p1', entry_date: '2026-11-03', hours: '2.50', project_org_id: 'o1' },
  { project_id: 'p2', entry_date: '2026-11-02', hours: '4.00', project_org_id: 'o1' },
  { project_id: 'p2', entry_date: '2026-11-02', hours: '0.00', project_org_id: 'o1' },
];

describe('odoo/labour/bodies — AC-OLH-020', () => {
  it('AC-OLH-020 packs one line per project and date, summing that day', () => {
    const packed = packLabourLines(entries);
    expect(packed.outcome).toBe('ready');
    expect(packed.outcome === 'ready' && packed.lines.map((l) => [l.projectId, l.date, l.hours])).toEqual([
      ['p1', '2026-11-02', 4], ['p1', '2026-11-03', 2.5], ['p2', '2026-11-02', 4],
    ]);
  });
  it('AC-OLH-020 a day over 24 hours, a negative hour or a malformed date refuses the whole push', () => {
    expect(packLabourLines([{ project_id: 'p3', entry_date: '2026-11-02', hours: '25.00' }])).toEqual({ outcome: 'refused', code: 'daily-hours-exceed-24' });
    expect(packLabourLines([{ project_id: 'p3', entry_date: '2026-11-02', hours: '13.00' }, { project_id: 'p3', entry_date: '2026-11-02', hours: '12.00' }])).toEqual({ outcome: 'refused', code: 'daily-hours-exceed-24' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2026-11-02', hours: '-1' }])).toEqual({ outcome: 'refused', code: 'hours-invalid' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2 Nov', hours: '1' }])).toEqual({ outcome: 'refused', code: 'date-invalid' });
  });
  it('AC-OLH-020 the line value carries the project, employee, date, hours and zero amount', () => {
    expect(buildLineValue({ projectId: '7', employeeId: '3', date: '2026-11-02', hours: 4, companyId: 1, name: 'TS 2026-W45', basis: 'payroll' }))
      .toEqual({ project_id: 7, employee_id: 3, date: '2026-11-02', unit_amount: 4, name: 'TS 2026-W45', company_id: 1, amount: 0 });
  });
  it('AC-OLH-020 the odoo-rate basis sends no amount at all', () => {
    expect(buildLineValue({ projectId: '7', employeeId: '3', date: '2026-11-02', hours: 4, companyId: 1, name: 'TS 2026-W45', basis: 'odoo-rate' }))
      .not.toHaveProperty('amount');
  });
  it('AC-OLH-020 the line name names the PMO sheet and the day, never a person or a client', () => {
    expect(labourLineName({ sheetRef: 'TS 2026-W45', date: '2026-11-02' })).toBe('TS 2026-W45 · 2026-11-02');
  });
});
```
Verify (CI): `V src/lib/adapterSeam/odoo/labour/bodies.test.ts` → red (module missing).

### L1-T2 *(15 min)* `odoo/labour/bodies.ts`
Export `packLabourLines(entries): { outcome:'ready'; lines: PackedLine[] } | { outcome:'refused'; code: string }`, `buildLineValue(input)`, `labourLineName({sheetRef,date})`. Rules: hours parsed as a decimal string (never a float), summed per `(project_id, entry_date)` with 2-dp rounding (`4.00 + 1.00 = 5`), non-positive totals dropped, a day's total > 24 → `daily-hours-exceed-24`, a non-numeric/negative hour → `hours-invalid`, a date not `^\d{4}-\d{2}-\d{2}$` with a real calendar date → `date-invalid`. `buildLineValue` sends ids as numbers, `unit_amount` as a number, `amount: 0` only under `payroll`. Header comment cites V-OLH-1/-2/-4.
Verify (CI): L1-T1 green.

### L1-T3 *(10 min)* Failing test: anchors are immutable and unique per triple
`odoo/labour/anchors.test.ts`:
- `labourLineKey('a1b2…','p1…','2026-11-02')` → `lbl:<sheet>:<project>:20261102`; a non-uuid or a bad date throws.
- `labourExternalIdentifier(key)` → `{ module: 'pmo', name: 'lbl_<sheet with _>_<project with _>_20261102' }` and never contains `:`/`-`.
- `labourCostKey(batchId, revision)` → `lcost:<batch>:3`; a revision < 1 throws.
- `parseLabourLineKey(name)` round-trips a normalised name back to the key, and returns `null` for a purchase anchor (`po_…`) and for garbage.
- `keyFromLabourExternalIdentifier('po_…')` is null (no cross-family adoption).
Verify (CI): red.

### L1-T4 *(10 min)* `odoo/labour/anchors.ts`
```ts
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const LABOUR_LINE_KEY_RE = new RegExp(`^lbl:${uuid}:${uuid}:(\\d{8})$`, 'i');
export const LABOUR_COST_KEY_RE = new RegExp(`^lcost:${uuid}:[1-9][0-9]*$`, 'i');
export function labourLineKey(timesheetId: string, projectId: string, date: string): string { … }
export function labourExternalIdentifier(key: string): { module: 'pmo'; name: string } {
  if (!LABOUR_LINE_KEY_RE.test(key) && !LABOUR_COST_KEY_RE.test(key)) throw new Error('Invalid labour key');
  return { module: 'pmo', name: key.replace(/[^a-zA-Z0-9_]/g, '_') };
}
```
Header: "Same mechanism as `purchase/anchors.ts` (`ir.model.data`, module `pmo`); a separate key family so no probe can ever adopt a purchase document, and vice versa." Do **not** touch `PURCHASE_KEY_RE` or `externalIdentifier`. Reuse `parseOdooExternalRef`.
Verify (CI): L1-T3 green; `V src/lib/adapterSeam/odoo/purchase/anchors.test.ts` unchanged-green.

### L1-T5 *(10 min)* Failing test: the cost entry body (AC-OLH-030)
`odoo/labour/costBody.test.ts`:
- two projects (1,000,000 and 500,000) → `{ move_type:'entry', journal_id: 9, date:'2026-10-31', ref:'PMO labour 2026-10', line_ids: [[0,0,{account_id:41,name:'Labour · P-1',debit:1000000,credit:0,analytic_distribution:{'77':100}}], [0,0,{…P-2, debit:500000, analytic_distribution:{'78':100}}], [0,0,{account_id:42,name:'Payroll payable',debit:0,credit:1500000}]] }`.
- a project with no analytic account → `{outcome:'refused', code:'project-unmapped', projectCode:'P-2'}`; an amount with 3 dp → `labour-cost-precision`; a zero/negative delta list → `{outcome:'settled'}`; a currency mismatch → `labour-cost-currency`; a debit total ≠ credit → cannot happen (the credit is derived) and a test asserts the derived credit always equals the sum.
Verify (CI): red.

### L1-T6 *(10 min)* `odoo/labour/costBody.ts`
Pure builder, no Odoo vocabulary outside this file. `buildCostEntry({ batch, lines, maps, companyCurrency })` where `lines` are `{ projectId, projectCode, analyticAccountId, deltaCents }` sorted by project code, `maps` = `{ journalId, expenseAccountId, payableAccountId }`. Amounts are integer cents in, decimal strings out (the `cents.ts` helper). `date` = the batch period end. `ref` = `PMO labour <YYYY-MM>` (plain text, no anchor — the anchor is `ir.model.data`, V-OLH-6). Header cites V-OLH-7/-8.
Verify (CI): L1-T5 green.

### L1-T7 *(10 min)* Failing test: discovery probes labour models without degrading
Append to `odoo/discovery.test.ts`:
- `'AC-OLH-001 the labour models are probed with access and recorded under labour'`: full fixture → `Object.keys(snap.labour).sort()` equals `Object.keys(LABOUR_MODELS).sort()`.
- `'AC-OLH-001 an Odoo without hr_timesheet records the labour models absent and adds nothing to missing'`: fixture without `account.analytic.line` → `snap.labour['account.analytic.line'].exists === false` and `snap.missing` equals the full-fixture `missing`.
- Update the shipped full-fixture case only by adding the `labour` expectation; do not loosen existing assertions.
Verify (CI): `V src/lib/adapterSeam/odoo/discovery.test.ts` → red.

### L1-T8 *(10 min)* Discovery `labour` block
In `odoo/discovery.ts`:
```ts
/** The labour models (labour/anchors.ts, V-OLH-1..13) plus the anchor model. Probed apart from O1_MODELS so an Odoo
 *  without hr_timesheet is recorded as absent, never degraded (FR-OLH-001). */
export const LABOUR_MODELS: Record<string, readonly string[]> = {
  'hr.employee': ['name', 'work_email', 'active', 'write_date'],
  'account.analytic.line': ['name', 'date', 'unit_amount', 'amount', 'project_id', 'employee_id', 'account_id', 'company_id', 'write_date'],
  'account.move': ['name', 'move_type', 'state', 'journal_id', 'date', 'write_date'],
  'account.move.line': ['account_id', 'debit', 'credit', 'analytic_distribution', 'move_id', 'display_type', 'write_date'],
  'ir.model.data': ['module', 'name', 'model', 'res_id'],
};
```
Add `labour?: Record<string, ModelProbe>` to `CapabilitySnapshot` (optional so an old snapshot still type-checks) and probe it after the `assets` loop (or the `later` loop if #1511 has not landed). It never touches `missing`. Leave `LATER_MODELS` as is (`account.analytic.line` is already listed; one duplicate call per discovery is harmless — `ponytail:` drop it from `LATER_MODELS` when nothing reads `later['account.analytic.line']`).
Verify (CI): L1-T7 green; whole discovery file green.

### L1-T9 *(10 min)* Capability gap, test first
`odoo/labour/capabilities.test.ts`: `labourCapabilityGap(null)` → `'hr.employee'` (fails closed, first in walk order); a full snapshot → `null`; `account.analytic.line` with `create:false` → `'account.analytic.line:create'`; `hr.employee` with `create:false` → `null` (PMO never creates one); `account.move` with `write:false` → `'account.move:write'`; `fields_missing:['unit_amount']` on the line model → `'account.analytic.line:unit_amount'`; `ir.model.data` without create → `'ir.model.data:create'`.
`odoo/labour/capabilities.ts`: `LABOUR_WRITE_MODELS = ['account.analytic.line','account.move','account.move.line'] as const` (+ `ir.model.data` create-only) and `labourCapabilityGap(snapshot)` walking `Object.keys(LABOUR_MODELS)` in order. Header: "The SQL twin is `odoo_labour_employ_blocker` (0861); keep them in step."
Verify (CI): `V src/lib/adapterSeam/odoo/labour/capabilities.test.ts`.

### L1-T10 *(15 min)* Fake Odoo models
In `odoo/fakeOdoo.ts` add `hr.employee`, `account.analytic.line`, `account.move` (entry only) and `account.move.line` to the model table with `create`, `write`, `search_read`, `fields_get`, `has_access`; `write_date` bumps on write; an analytic-line create **without** `employee_id` raises a 422 validation error (V-OLH-1); a `create` with `amount` stores it verbatim (V-OLH-4); `account.move` `action_post` sets `state='posted'` and appends one `account.move.line` per distribution split plus the credit line's counterpart; a `write` on a posted move raises (V-OLH-9); `unlink` of an analytic line removes it with no tombstone (V-OLH-11). Failing cases first in `fakeOdoo.test.ts`, one per behaviour.
Verify (CI): `V src/lib/adapterSeam/odoo/fakeOdoo.test.ts`.

### L1-T11 *(5 min)* Gate and push
`cd pmo-portal && npm run check:guards && npx eslint --max-warnings=0 src/lib/adapterSeam/odoo/labour/*.ts src/lib/adapterSeam/odoo/discovery.ts src/lib/adapterSeam/odoo/discovery.test.ts src/lib/adapterSeam/odoo/fakeOdoo.ts src/lib/adapterSeam/odoo/fakeOdoo.test.ts`. Grep sibling mocks: `grep -rln "odoo/discovery\|fakeOdoo" pmo-portal/src supabase/functions` and confirm none pins the exact snapshot keys without `labour`. Commit `feat(odoo): labour kinds, hours bodies, cost entry body and capability gap (#1510 L1)`; push `feat/1510-l1`.

---

## L2 — Employee feed, employ guard, cross-tier gate (0860, 0861; security-auditor mandatory)

### L2-T1 *(15 min)* Failing pgTAP: employees apply, propose, never confirm (AC-OLH-010, -011, -012)
Create `supabase/tests/odoo_labour_employee_feed.test.sql`: `begin; select plan(12);` fixture = org `15100000-0000-0000-0000-000000000001` with an activated odoo binding (copy the fixture block of `supabase/tests/odoo_master_records_rls.test.sql`), profiles `one@example.com` (active, Admin), `two@example.com` (disabled) and `four@example.com` (active, Project Manager), and an existing `erp_employees` row for employee `9` (`link_state='confirmed'`, profile `four`). `set local role service_role`; then:
- `apply_odoo_employees(org, '[{"external_id":"3","name":"Example One","work_email":"one@example.com","active":true,"write_date":"2026-11-09 08:00:00"}]')` returns 1; row exists with `employee_number='3'`, `link_state='proposed'`, `link_proposed_reason='work-email-exact-match'`.
- A newer page (`Example One Renamed`, `2026-11-10 …`) updates the name; an older page (`2026-11-08 …`) changes nothing (`AC-OLH-010 an older page changes nothing`).
- An employee whose email matches only the disabled profile stays `unlinked` (`AC-OLH-011`).
- The `confirmed` row's `profile_id`/`link_state` are byte-identical after a page that changes its email (`AC-OLH-011 a confirmed link is never re-pointed`).
- `active:false` sets `erp_status='inactive'`; a census finish with the id missing tombstones (`erp_cancelled_at is not null`) and never deletes.
- `confirm_erp_employee_link(id, profile)` as the org Admin sets `confirmed` + writes one audit row; as a non-Admin raises `42501`; for another org's employee `P0002` (`AC-OLH-012`). Confirming employee `3` for profile `four` (which already holds employee `9` as confirmed) moves `9` out of `confirmed` and leaves exactly one confirmed row for that profile.
- `apply_odoo_employees` as `authenticated` raises `42501`; a malformed row (no `name`, bad `write_date`) is skipped whole and the function returns the count applied.
`select * from finish(); rollback;`
Verify (CI): `P supabase/tests/odoo_labour_employee_feed.test.sql` → red.

### L2-T2 *(15 min)* Migration `0860_odoo_labour_employee_feed.sql`
1. `create function public.apply_odoo_employees(p_org_id uuid, p_rows jsonb) returns integer language plpgsql security definer set search_path = public` — service-role assertion first (copy 0421's opener), `assert_odoo_activated(p_org_id)`; per row: strict parse (`external_id` numeric text, `name` non-empty, `write_date` matching `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$`), skip a malformed row, one row per Odoo id (newest `write_date` wins); **SELECT-then-write**, NOT an `on conflict` upsert: `erp_employees` carries **no** unique key on `(org_id, employee_number)` and must not gain one — the shipped contract leaves a person number shared by two rows *open* rather than guessing (`erp_connect_setup.test.sql`) and the ERPNext feed plain-inserts, so an index here turns a handled data condition into a hard 23505 feed failure (this is the r9 Critical; `claim_erp_sweep_lock` already serialises the per-org writers, so no arbiter is needed). Update the one existing row for the number (lowest id, deterministic) with `employee_name`, `work_email`, `erp_status`, `erp_modified` = `write_date`, else insert; **never** write `profile_id`/`link_state` of a `confirmed`/`rejected` row, **never** update when the stored `erp_modified` is newer, and **never** insert a second row for a number the table already holds; then the proposal:
```sql
with unique_match as (
  select e.id as employee_id, min(p.id) as profile_id
    from public.erp_employees e
    join public.profiles p
      on p.org_id = e.org_id and p.status = 'active'
     and lower(btrim(p.email)) = lower(btrim(e.work_email))
   where e.org_id = p_org_id
     and e.link_state = 'unlinked' and e.erp_cancelled_at is null and e.work_email is not null
   group by e.id
  having count(*) = 1
)
update public.erp_employees e
   set link_state = 'proposed', link_proposed_reason = 'work-email-exact-match'
  from unique_match m
 where e.id = m.employee_id
   and not exists (select 1 from public.erp_employees c
                    where c.org_id = p_org_id and c.link_state = 'confirmed' and c.profile_id = m.profile_id);
```
Check the shipped `profiles` column names (`status`, `email`) against `0001_init_schema.sql` before writing; adjust the predicates, not the intent.
2. `create function public.finish_odoo_employee_census(p_org_id uuid, p_run text, p_seen jsonb) returns integer` — service-role only: tombstone (`erp_cancelled_at = now()`) every live row of the org whose `employee_number` is not in `p_seen`, never delete, never touch `profile_id`/`link_state`. Keep it separate from the directory census (different table).
3. Grants: `revoke all on function public.apply_odoo_employees(uuid,jsonb), public.finish_odoo_employee_census(uuid,text,jsonb) from public, anon, authenticated; grant execute on function … to service_role;` and a `do $$` self-assertion that `authenticated` cannot execute either.
4. Denominator: add both `regprocedure` texts under `definer_functions`. 0137: both are service-only, so no `client_callable_rpc_names` entry.
Rollback `rollback/0860_odoo_labour_employee_feed_down.sql`: drop both functions (no table change and no index; `erp_employees` predates this migration — say so in the header).
Verify (CI): L2-T1 green; `P supabase/tests/odoo_labour_employee_feed.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql`.

### L2-T3 *(15 min)* Failing pgTAP: employ guard (AC-OLH-001, AC-OLH-002)
`supabase/tests/odoo_labour_employ.test.sql` (fixture: org, Admin, Project Manager, an activated odoo binding whose `config.capabilities.labour` is the full five-model JSON with the write flags, `config.journal_id`/`labour_expense_account_id`/`payroll_payable_account_id` set):
- Admin `admin_change_domain_ownership(org,'odoo','timesheets','employ')` lives; `external_domain_ownership` row exists; one `integration.domain_ownership.employ` audit row.
- reset; `jsonb_set(config, '{capabilities,labour,account.analytic.line,create}', 'false')` → `P0001` naming `account.analytic.line:create` (`AC-OLH-001`).
- no `labour` key (old snapshot) → `P0001` `Odoo is missing hr.employee`.
- an active ERPNext ownership of `timesheets` → `P0001` `timesheets is already employed on another ERP` (`AC-OLH-002`; the 0743 message is already correct — assert the words, not a new branch).
- `p_external_tier='erpnext'` while Odoo owns it → the same words.
- PM JWT → `42501`.
Verify (CI): red.

### L2-T4 *(15 min)* Migration `0861_odoo_labour_employ.sql`
1. `public.odoo_labour_employ_blocker(p_org_id uuid) returns text` stable security definer (the 0743 `odoo_companies_employ_blocker` shape): not activated → its words; then for each model of `array['hr.employee','account.analytic.line','account.move','account.move.line','ir.model.data']` read `v_p := b.config #> array['capabilities','labour', m]`; absent/not exists/not read → `'Odoo is missing ' || m`; a missing field → `'Odoo is missing ' || m || ':' || field`; for the write models missing `create`/`write` (for `ir.model.data`: `create` only) → `'Odoo is missing ' || m || ':create'`. Then the three config keys: unset → `'Choose the labour journal and accounts in the Odoo setup first.'`. Comment: "TS twin `odoo/labour/capabilities.ts`; keep in step."
2. `create or replace function public.admin_change_domain_ownership(…)` = the newest body (0743 at baseline; re-check with the grep in Conventions) with: the guarded list `p_domain in ('procurement','revenue','companies','timesheets')`; the `case` gains `when 'timesheets' then public.odoo_labour_employ_blocker(p_org_id)`. Grants unchanged.
3. `public.org_employs_odoo_timesheets(p_org uuid) returns boolean language sql stable set search_path = public` (invoker, not on the denominator): `select exists (select 1 from public.external_domain_ownership where org_id = p_org and external_tier = 'odoo' and domain = 'timesheets')`. `revoke all … from public, anon; grant execute … to authenticated, service_role;`.
4. `public.set_odoo_labour_config(p_org_id uuid, p_journal_id text, p_expense_account_id text, p_payable_account_id text, p_basis text) returns void` security definer, Admin or Finance, org re-asserted, active member: validates the basis in (`payroll`,`odoo-rate`), the three ids as positive numeric text, **and that each names a live row of the org's account/journal mirror** (the `set_odoo_payment_journal_default` precedent rejects an id the mirror does not hold); writes them into `external_org_bindings.config` as `labour_journal_id`, `labour_expense_account_id`, `labour_payable_account_id`, `labour_cost_basis`; one audit row (`integration.odoo.labour_config`). This function is written here because the employ blocker (T4 point 1) validates exactly these keys — the UI that calls it arrives in L6.
Rollback: restore 0743's `admin_change_domain_ownership` verbatim; drop the three new functions.
Denominator: add `odoo_labour_employ_blocker(uuid)` and `set_odoo_labour_config(uuid,text,text,text,text)`. 0178: add `('set_odoo_labour_config'),  -- ⚑ AMENDED BY 0861 (#1510)` — it is client-callable — and re-derive the count by hand.
Verify (CI): L2-T3 green; `P supabase/tests/odoo_labour_employ.test.sql` plus every file that greps `admin_change_domain_ownership` (`grep -l admin_change_domain_ownership supabase/tests/*.sql`).

### L2-T5 *(10 min)* Failing test: the employ verb and the setup adapter's employee (AC-OLH-001)
Append to `supabase/functions/external-set-company/odoo.test.ts` (or the file that exercises `employDomain`): "employ `timesheets` calls `admin_change_domain_ownership` with domain `timesheets`"; a `P0001` `Odoo is missing account.analytic.line:create` returns 422 with the "Check the connection again" hint.
Append to `pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.test.ts`: `listMasters('employee')` on the **setup** adapter still returns `{rows: [], nextCursor: null}` and `canSend('employee') === false` (census and sends unchanged by this slice; the employee feed is not a connect-run kind).
Verify (CI): red.

### L2-T6 *(5 min)* Employ verb
`supabase/functions/external-set-company/odoo/purchasing.ts:12`: `const EMPLOYABLE = new Set(['procurement', 'companies', 'timesheets']);` and the comment at `:11` names 0861. Nothing else moves — the database holds the rules.
Verify (CI): L2-T5 green.

### L2-T7 *(15 min)* The ERPNext backstop's tier gate, test first (D14)
Append to `supabase/functions/erpnext-sweep/queueFairnessLive.test.ts` (or a new `timesheetTierGate.test.ts` beside it):
- `'FR-OLH-002 the ERPNext backstop lists no sheet for an org that employs timesheets on odoo'`: the ownership RPC answers `false` for erpnext → `listPendingTimesheetPushes` returns `[]` and `listApprovedSheetsWithoutMirror` issues no `timesheets` read.
- `'FR-OLH-002 an org owning timesheets on erpnext is unchanged'`: the shipped fixture returns the same rows byte-for-byte.
Green: in `timesheetBackstopDepsLive` (`erpnext-sweep/index.ts:3020`), before either query, call
```ts
const owned = await serviceClient.rpc('domain_owned_by_tier', { p_org_id: org.orgId, p_domain: 'timesheets', p_tier: 'erpnext' });
if (owned.error || owned.data !== true) return [];   // unreadable ⇒ nothing to drive; the Odoo host owns it
```
and the same guard at the top of `reconcileOrgTimesheetPushesLive` so a stranded sheet is not even gated. Two call sites, one predicate; put the predicate in a tiny exported helper with its own test.
**Mutation check (paste in the PR):** force the helper to `true` → the first case goes red; restore.
Verify (CI): `D supabase/functions/erpnext-sweep` (whole dir) — the shipped suites must stay green.

### L2-T8 *(10 min)* Employee feed sweep pass
Failing test first in `supabase/functions/odoo-sweep/odooSweep.test.ts`:
- `'FR-OLH-003 a labour-employing org reads hr.employee after the directory and applies it'`: ownership true, snapshot `labour` readable → a `hr.employee/search_read` request appears after `res.partner`, the rows go to `apply_odoo_employees`.
- `'FR-OLH-003 an org that does not employ timesheets reads no employee and the tick does not fail'`.
Green, in `_shared/odooSweep.ts`: after the directory kind loop (and the #1511 asset kinds if present), when `org_employs_odoo_timesheets` answers true **and** `labourReadable(capabilities, 'hr.employee')`, run one page of `hr.employee/search_read` (fields from `LABOUR_MODELS`, `write_date asc, id asc`, cursor from a new `readCursor(sc, orgId, 'employee')` stored via the new `apply_odoo_employees` + `finish_odoo_employee_census`; count it against the reserve like a kind (`RESERVE_PER_KIND`), never failing the tick on a labour error other than an `OdooError`).
Verify (CI): `D supabase/functions/odoo-sweep`.

### L2-T9 *(5 min)* Gate and push
Collision check, `node scripts/check-isolation-denominator.mjs --self-test`, eslint on touched TS (portal + functions), `npm run check:guards`. Commit `feat(odoo): employee feed, labour employ guard and the ERPNext backstop tier gate (#1510 L2, migrations 0860 0861)`; push `feat/1510-l2`. PR body asks security-auditor to check: service-role only on both writers, the org filter on the tombstone, the proposal's "exactly one active profile and no other confirmed link" predicate, the employ blocker failing closed on an absent snapshot, and the backstop gate failing closed on an unreadable ownership answer.

---

## L3 — Hours push through the outbox (0862; Opus, money)

### L3-T1 *(15 min)* Failing pgTAP: the posting ledger (AC-OLH-023)
`supabase/tests/odoo_labour_lines.test.sql`: fixture = org employing `timesheets` on odoo, an approved timesheet `t1` owned by profile `u1`, `erp_employees` confirmed with `external_refs` `hr.employee:3`. service_role:
- `record_odoo_labour_lines(org, t1, '[{"project_id":"<p1>","entry_date":"2026-11-02","hours":"4.00","external_id":"101"},{"project_id":"<p2>","entry_date":"2026-11-02","hours":"2.00","external_id":"102"}]')` inserts two rows `state='posted'`; a replay with the same triples updates (never duplicates) and returns the same count.
- A later call omitting `p2` marks that row `orphaned` and **does not delete it** (`AC-OLH-023`); the `external_id` is unchanged.
- `mark_odoo_labour_line_state(org, t1, '101', 'cost-drift', jsonb_build_object('odoo_amount', 400000))` sets the state and the detail; an unknown external id is a no-op returning 0.
- A cross-org `p_org_id` in the payload's project raises `P0002`; a non-service caller raises `42501`.
- `attest_timesheet_no_erp_document` records the tier-neutral wording (assert the message contains "the ERP holds no timesheet" and not "ERPNext") and still refuses a non-Admin or an unknown witness.
- `list_project_labour(p_project_id)` (authenticated, org-scoped) returns the hours rows with their state, and an Engineer sees them; `list_project_labour_cost(p_project_id)` (admin/finance/exec/PM only) raises `42501` for an Engineer.
`select * from finish(); rollback;`
Verify (CI): red.

### L3-T2 *(15 min)* Migration `0862_odoo_labour_lines.sql`
1. Table:
```sql
create table public.odoo_labour_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id) on delete cascade,
  timesheet_id uuid not null references public.timesheets(id) on delete cascade,
  project_id uuid not null references public.projects(id),
  entry_date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  external_id text not null,             -- the Odoo account.analytic.line id
  state text not null default 'posted' check (state in ('posted','orphaned','cost-drift')),
  detail jsonb,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  unique (org_id, timesheet_id, project_id, entry_date)
);
```
`stamp_org_id()` trigger, RLS enabled + forced, one `select` policy for active members of the org restricted to rows of a timesheet they may read (mirror `timesheet_erp_mirror_select`, `0136:64-75`), no write policy (service role only). Index `(org_id, project_id, entry_date)` and `(org_id, state)`.
2. `record_odoo_labour_lines(p_org_id uuid, p_timesheet_id uuid, p_rows jsonb) returns integer` security definer, service-only: validate each row (project belongs to a timesheet entry of this sheet and this org, date/hours shape), upsert on the unique key (`state='posted'`, `detail=null`), then mark `orphaned` the rows of this sheet whose triple is not in the payload, return the number written.
3. `mark_odoo_labour_line_state(p_org_id uuid, p_timesheet_id uuid, p_external_id text, p_state text, p_detail jsonb default null) returns integer` security definer, service-only, state-checked.
4. `list_project_labour(p_project_id uuid)` security invoker, org-scoped via `auth_org_id()`, `is_active_member()`; `list_project_labour_cost(p_project_id uuid)` raising `42501` unless `auth_role() in ('Admin','Executive','Project Manager','Finance')` (the `get_project_finances` audience).
5. `create or replace function public.attest_timesheet_no_erp_document(uuid, text)` = 0164's body with **one** change: the recorded message reads "the ERP holds no timesheet for this week" instead of naming ERPNext, so an Odoo-employed org's Admin sees truthful words (FR-OLH-032's held route). Same signature, grants and audit; no other line moves.
6. Grants + `do $$` self-assertions; denominator for the three definers.
Rollback: drop the three writers and the table (PMO time data is untouched — say so in the header), and restore 0164's `attest_timesheet_no_erp_document` verbatim.
Verify (CI): L3-T1 green; `P supabase/tests/odoo_labour_lines.test.sql supabase/tests/0159_attestation_admits_the_reopen.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0646_rls_initplan.test.sql`.

### L3-T3 *(20 min)* Failing test: the Odoo timesheet adapter against the fake (AC-OLH-022)
`pmo-portal/src/lib/adapterSeam/odoo/labour/adapter.test.ts` *(new)* against `fakeOdoo`:
- create with three packed lines → three `account.analytic.line` records, each with an `ir.model.data` anchor `module 'pmo'` whose name equals `labourExternalIdentifier(labourLineKey(...))`, `commit` returns `{ externalRecordId: 'account.analytic.line:<first id>', canonical: { external_tier:'odoo', labour_lines:[{project_id, entry_date, hours, external_id}], erp_total_hours:'6.50' } }`.
- a **fresh** create for the same record and key where all anchors exist → no new lines; adopts, writes the corrected hours where they differ.
- a **fresh** create (a re-approval, new key) that adds one triple → creates only that line, writes the changed one, touches neither of the others.
- a **fresh** create after a definite failure where two of three anchors exist (a person's "Check again") → adopts the two, creates the third, three lines total.
- `ctx.replay === true` with two of three anchors present → `commit-rejected 'labour-lines-incomplete'` and **zero** creates (the D13 rule).
- an anchor pointing at another record → `commit-rejected 'ambiguous-anchor'`.
- `probe(record)` returns the anchored ids for the triples it finds, or `null` for none.
- a create where the fake stored the line but the anchor write throws → the adapter throws on the same attempt (nothing is left claimed as done); the outbox-level consequence is case 6 of L3-T5, not a second adapter call.
Verify (CI): red.

### L3-T4 *(20 min)* `odoo/labour/adapter.ts`
`createOdooLabourAdapter({ call, ctx })` implementing `Adapter`: `commit` for `create`/`update` of a `timesheet` command; key = `timesheet:<sheet uuid>` validated; per packed line, probe by anchor (`ir.model.data` `search_read` `[['module','=','pmo'],['name','=',name]]`, then `read` the anchored record) → present: compare `unit_amount`/`date` and `write` when different; absent: when `ctx.replay` **and** at least one anchor was found, refuse `'labour-lines-incomplete'` (D13); otherwise `create` the line **then** write its anchor. After all lines: `search_read` the resulting ids for `unit_amount, amount, date, employee_id, project_id` and refuse `'unreadable-after-write'` on a miss, `'labour-cost-double'` when the payroll basis expects `amount = 0` and reads otherwise (V-OLH-4/-5). `probe(record)` returns the anchored ids it finds (a partial set is a legitimate answer — the deps decide what it means) or null. Reuse `labourExternalIdentifier`, `labourLineKey`, `buildLineValue`, `packLabourLines`; no field name outside `labour/*`.
Verify (CI): L3-T3 green.

### L3-T5 *(20 min)* Failing served test: dispatch wiring (AC-OLH-021, AC-OLH-022)
`supabase/functions/adapter-dispatch/odooLabour.test.ts` *(new; add to `scripts/check-edge-fn-test-binding.mjs` `REQUIRED` importing the shipped `resolveOdooTimesheetAdapter`)*, `globalThis.fetch` mocked as a JSON-2 fake (helpers from `odooCompanies.test.ts`), driven through the shipped `index.ts` handler:
1. `AC-OLH-021` an approved sheet whose owner has no confirmed employee link → 422 `employee-unlinked`, no outbox row, no Odoo call.
2. `AC-OLH-021` a project with no `external_project_bindings` row → `project-unmapped` naming the code, no outbox row.
3. `AC-OLH-021` the gate returning an entry whose project belongs to another org (the shared same-org preflight, `assertCommandLinksSameOrg`) → `cross-org-link-rejected`, no outbox row. A payload's own `entries` never reach the adapter — `applyCanonicalTimesheetTruth` replaced them with gate truth.
4. `AC-OLH-022` happy path: three lines created, one outbox row keyed `ts:<sheet>:<approved_at>`, `record_odoo_labour_lines` called once with the three rows.
5. `AC-OLH-022` lost answer: the fake stores the create **with its anchors** then the fetch throws; re-send the same command → the probe finds all three, nothing is created again, the mirror finalizes once.
6. `AC-OLH-022` held on an automated recovery: one anchor deleted in the fake (the line survives), the outbox row forced past its quarantine window, the sweep replays it → the probe finds two, the recovery refuses `labour-lines-incomplete`, the outbox ends `held`, and **no fourth line exists**.
7. `AC-OLH-022` the person converges: the same state as case 6, but a foreground "Check again" (`replay: false`) → the two are adopted, the third is created, three lines total.
8. a re-approved sheet (new key, one project added and one figure changed) → the changed line is written, the new line is created under its own anchor, the untouched line is not written.
9. connection refused (`odooClientForOrg` refusal) → `config-rejected`, no outbox row.
10. snapshot missing `account.analytic.line:create` → `config-rejected` naming it.
**Mutation checks (paste in the PR):** drop the `ctx.replay` guard in the adapter → case 6 red (the recovery creates a fourth line); `reissueOnInconclusiveAbsence: () => true` → a nothing-found recovery stops holding; drop the employee lookup → case 1 red; drop the cost-account resolution → case 2 red; restore.
Verify (CI): `D supabase/functions/adapter-dispatch/odooLabour.test.ts` → red.

### L3-T6 *(20 min)* Dispatch parts `adapter-dispatch/odooLabour.ts` *(new)*
Mirror `odooCompanies.ts`:
- `resolveOdooTimesheetAdapter(ctx)`: `assertCommandLinksSameOrg`; `odooClientForOrg` refusal → `config-rejected`; `labourCapabilityGap` → `config-rejected` "Odoo labour needs {{gap}} …"; resolve the owner's confirmed employee (`lookupConfirmedErpEmployee` + `external_refs`, reusing `erpnext/dispatchTimesheet.ts`; refuse `employee-unlinked`); resolve every entry project's cost account (`resolveOdooCostAccount`; `unlinked` → `project-unmapped` with the project code, `needs-attention` → `project-needs-attention`); pack the lines (refusal → `config-rejected` with the code) before returning the adapter.
- `resolveOdooTimesheetMoneyOutboxDeps(ctx)`: `reissueOnInconclusiveAbsence: false` for **both** operations (a probe that finds nothing on an unknown outcome holds, D13); `probeByRemarksKey: () => adapter.probe(record)`. A definite failure's ordinary retry is unaffected — it never takes the probe path, and the adapter converges.
- The adapter receives `replay: ctx.replay` from `AdapterSelectContext` (`dispatchAdapters.ts:44`) so it can apply the D13 partial-anchor rule.
- Wire: `ODOO_ADAPTER_REGISTRY.timesheets` (`odooAdapters.ts:139`); `odooMoneyOutbox.ts:175` gains `if (ctx.command.domain === 'timesheets') return resolveOdooTimesheetMoneyOutboxDeps(ctx);`; `authGuard.ts:58` `OWNING_TIERS.timesheets = [ERPNEXT_TIER, ODOO_TIER]`.
- `index.ts`: no key derivation change — the FE and the sweep already send the deterministic `ts:` key (`timesheetPushKey`), and `applyCanonicalTimesheetTruth` replaces it from DB truth.
- `createOdooLabourAdapter` returns `capabilityMap: new Set(['timesheets'])`.
Verify (CI): L3-T5 green; `D` on `authGuard.test.ts`, `odooAdapters.test.ts`, `odooMoneyOutbox.test.ts`, `odooCompanies.test.ts` (unchanged behaviour for other domains).

### L3-T7 *(15 min)* Read-model writer, tier-branched
Failing test first: `readModelWriters.timesheets.odoo.test.ts` *(new)* — a canonical carrying `external_tier: 'odoo'` upserts `timesheet_erp_mirror` (`push_state:'pushed'`, `approved_at_pushed` the witness, `ts_number` untouched) **and** calls `record_odoo_labour_lines` with the sheet id and the lines; a canonical from ERPNext (`erp_total_hours`) does neither (byte-for-byte today's behaviour, proven by the shipped `readModelWriters.timesheets.test.ts` staying green).
In `readModel/timesheets.ts`, branch on `canonical.external_tier === 'odoo'` inside `upsert`; keep `markTimesheetPushOutcome` unchanged (`labour-lines-held` rides `push_error`). Failing case first for a `held` outcome carrying the new token.
Verify (CI): `D supabase/functions/adapter-dispatch/readModelWriters.timesheets.odoo.test.ts supabase/functions/adapter-dispatch/readModelWriters.timesheets.test.ts`.

### L3-T8 *(10 min)* Anchored-line reconcile (existence + drift)
Failing pgTAP first (append to `odoo_labour_lines.test.sql`; add the function to **`0862_odoo_labour_lines.sql`** — same branch, before the push in T9): `reconcile_odoo_labour_lines(org, '[{"external_id":"101","found":false},{"external_id":"102","found":true,"unit_amount":"4.00","amount":"400000"}]')` marks `101` `orphaned` (detail `removed-in-odoo`) and `102` `cost-drift`; a `found:true` row with the expected hours and (payroll basis) `amount=0` clears the state back to `posted`; rows not listed keep their state and get `checked_at = now()`.
Calls it, in the sweep, for at most 200 `posted`/`cost-drift` rows of the org ordered by `checked_at nulls first` (one `search_read` of up to 200 ids — V-OLH-10/-11), wired as an `AFTER_SWEEP` entry gated on ownership. `ponytail:` a per-org monthly cadence if the read cost shows.
Verify (CI): `P supabase/tests/odoo_labour_lines.test.sql`; `D supabase/functions/odoo-sweep`.

### L3-T9 *(5 min)* Gate and push
Collision check, denominator self-test, eslint, `check:guards`, `D supabase/functions/adapter-dispatch` (whole dir). Commit `feat(odoo): push approved hours to Odoo analytic lines through the outbox (#1510 L3, migration 0862)`; push `feat/1510-l3`. PR body: the mutation evidence, and for security-auditor: the held-on-miss policy, the per-line anchor uniqueness, the employee/project refusals before any outbox row, and that no Odoo value is echoed into an error message.

---

## L4 — The backstop, shared and hosted twice (no migration)

The ERPNext backstop's orchestration (`timesheetBackstop.ts`) is tier-neutral by construction: every dependency is injected. Its *live* deps are not (`buildMoneyWriteDepsLive` hardwires ERPNext at `erpnext-sweep/index.ts:4067-4110`). Two copies would drift exactly as the push key would have — the header of `timesheetPushKey.ts` states the rule.

### L4-T1 *(10 min)* Move, do not copy
`git mv supabase/functions/erpnext-sweep/timesheetBackstop.ts supabase/functions/_shared/timesheetBackstop.ts`; update the imports in `erpnext-sweep/index.ts:220-226` and move `timesheetBackstop.test.ts` beside it. **No behaviour change**: the whole `D supabase/functions/erpnext-sweep` and the moved test must pass untouched (only import paths change).
Verify (CI): `D supabase/functions/_shared supabase/functions/erpnext-sweep`.

### L4-T2 *(15 min)* Extract the shared live helpers
Move `findTimesheetOutboxRow`, `mintTimesheetOutboxRow`, `parkTimesheetMirrorRow`, `listApprovedSheetsWithoutMirror` and `stampQueueAttempt`'s timesheet arm out of `erpnext-sweep/index.ts` into `supabase/functions/_shared/timesheetBackstopDeps.ts`, parameterised by an injected `dispatch(command)` (the only tier-specific step) and by the ownership predicate from L2-T7. The ERPNext host passes a `dispatch` that calls `buildReconcileDepsLive`; nothing else changes. Failing test first: a case proving the Odoo predicate short-circuits before any mint (the L2-T7 case moves here).
Verify (CI): `D supabase/functions/_shared supabase/functions/erpnext-sweep`.

### L4-T3 *(20 min)* Odoo live deps + sweep pass
`supabase/functions/adapter-dispatch/odooLabourRecovery.ts` *(new)*: the `odooProcurementRecovery.ts` shape — filter candidates to `externalTier === 'odoo' && row.domain === 'timesheets' && row.state !== 'held'`, re-authorise with `checkOutboxReplayAuthorization`, then `dispatchMoneyWrite` with `resolveOdooTimesheetMoneyOutboxDeps` + `resolveOdooTimesheetAdapter`. Budget: 8 calls per sheet candidate (pack ≤ 7 lines + read-back) reserved from the tick.
In `_shared/odooSweep.ts`: `AFTER_SWEEP` gains `reconcileOdooLabour` (the recovery) and `runLabourBackstop` (the shared pure module with the Odoo `dispatch`), both gated on `org_employs_odoo_timesheets`; the tick result gains `outbox_labour_reconciled`/`outbox_labour_errors` counts.
Failing tests first in `odoo-sweep/odooSweep.test.ts`: an Odoo-owned org with `pending`/`failed` mirror rows drives at most the tick limit, oldest first; a sheet whose `approved_timesheet_for_push` refuses (offboarded approver) is recorded and does not wedge the queue (the per-row containment the ERPNext twin documents).
Verify (CI): `D supabase/functions/adapter-dispatch supabase/functions/odoo-sweep`.

### L4-T4 *(5 min)* Gate and push
`npm run check:guards`, eslint, `D` on both dirs. Commit `refactor(timesheets): one backstop, hosted by both sweeps (#1510 L4)`; push `feat/1510-l4`. PR body: "no behaviour change for ERPNext — the whole shipped suite green, only import/move diffs".

---

## L5 — Payroll cost posting (0863; Opus, money/SoD; **blocked by #1518 for the producer**)

**Do not start before** L0's V-OLH-4/-5/-7/-9 verdicts are recorded and D3 is confirmed. The producer (#1518's payroll run writing `labour_cost_batches`/`labour_cost_allocations`) lands in L5-T9 and is the only task that waits for that issue; T1–T8 build and prove the machinery with fixtures.

### L5-T1 *(20 min)* Failing pgTAP: the batch model, the gate and the delta (AC-OLH-031, AC-OLH-032)
`supabase/tests/odoo_labour_cost_gate.test.sql`: fixture = org employing `timesheets` on odoo, profiles F (Finance) and M (Project Manager), projects `P-1`/`P-2` linked to analytic accounts `77`/`78`, a batch `b1` revision 1 `Approved` by F with allocations (P-1 1,000,000; P-2 500,000), company currency IDR, config journal/accounts set.
- `approved_labour_cost_for_push(b1)` as F returns the header + two allocations from the DB; as M raises `42501`; for a `Draft` batch `P0001`; for another org `42501`.
- `record_labour_cost_postings(org, b1, 1, '[{"project_id":"<P-1>","amount":"1000000","external_id":"901"}]')` inserts one posting `state='posted'`; `posted_labour_cost_totals(b1)` returns `{P-1: 1000000}` (service-only).
- revision 2 (new batch row `b2`, `supersedes_id = b1`, revision 2) approved with (P-1 1,200,000; P-2 400,000) → `labour_cost_deltas(b2)` returns `[{P-1: +200000}, {P-2: -100000}]` (P-2's earlier total was 500,000); a revision 3 restating the same two figures returns `[]` (`AC-OLH-032`).
- a batch whose header total ≠ the sum of its allocations raises `P0001` on approve; a non-positive allocation raises `P0001`.
- `approve_labour_cost_batch(b2)` as M raises `42501`; as F sets `Approved`, `approved_by`/`approved_at` server-side, one audit row (`labourCost.approve`).
`select * from finish(); rollback;`
Verify (CI): red.

### L5-T2 *(20 min)* Migration `0863_odoo_labour_cost.sql`
1. `labour_cost_batches (id, org_id, period_start date, period_end date check (>= period_start), revision int check (>=1), supersedes_id uuid references labour_cost_batches(id), currency text not null, total numeric(14,2) not null check (>= 0), status text check in ('Draft','Approved'), approved_by uuid, approved_at timestamptz, push_state text not null default 'pending' check (push_state in ('pending','pushing','pushed','failed','held','settled')), push_error text, pushed_at timestamptz, last_attempt_at timestamptz, created_at, unique (org_id, period_start, revision))`; `labour_cost_allocations (id, org_id, batch_id references … on delete restrict, profile_id, project_id, amount numeric(14,2) check (amount > 0), check (scale(amount) <= 2), unique (batch_id, project_id))`; `labour_cost_postings (id, org_id, batch_id, revision int, project_id, amount numeric(14,2), external_id text, state text check in ('posted','orphaned'), posted_at, unique (batch_id, revision, project_id))`. RLS forced; select policies for the `get_project_finances` audience; no client writes. The batch's own `push_state` is the mirror of a batch push (deliberately **not** `timesheet_erp_mirror`, whose `timesheet_id` is a timesheet FK); `last_attempt_at` gives the backstop the same fair-order stamp (`0427` shape).
2. `approve_labour_cost_batch(p_batch_id uuid)` security definer: active member, `auth_role() in ('Admin','Finance')`, org re-asserted, status `Draft`, header total = sum(allocations), every allocation's project in the org, currency = the binding's company currency; sets `Approved` + server stamps; audit `labourCost.approve`.
3. `approved_labour_cost_for_push(p_batch_id uuid)` security definer (the 0138 twin): org, `Approved`, caller = `approved_by` or Admin/Finance, returns `(batch_id, revision, period_end, currency, total, approved_at, allocations jsonb)`.
4. `labour_cost_deltas(p_batch_id uuid) returns table (project_id uuid, delta numeric)` security definer, service-only: each allocation minus the sum of `labour_cost_postings` for the **same batch chain** (walk `supersedes_id` down) for that project; omit zero rows.
5. `record_labour_cost_postings(...)` + `posted_labour_cost_totals(...)` security definer, service-only.
6. `list_project_labour_cost(p_project_id uuid)` (replace the L3 stub with the real read: period, batch, amount, state, posted_at).
7. Grants, self-assertions, denominator, and the 0178 `client_callable_rpc_names` entry for the one client-callable writer (`approve_labour_cost_batch`) with the `⚑ AMENDED BY 0863 (#1510)` marker and a re-derived count.
Rollback: drop the three tables (PMO payroll data would live here — the down migration states that dropping it loses labour-cost history and is only for pre-production; `docs/decisions.md`/ADR-0006 pre-production posture).
Verify (CI): L5-T1 green; `P supabase/tests/odoo_labour_cost_gate.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0646_rls_initplan.test.sql`.

### L5-T3 *(20 min)* Failing served test: the cost adapter and the gate (AC-OLH-032)
`supabase/functions/adapter-dispatch/odooLabourCost.test.ts` *(new; add to `check-edge-fn-test-binding.mjs`)*:
1. `AC-OLH-032` a revision-2 batch with deltas (+200,000 / −100,000) → one `account.move` with two expense lines and one payable line of +100,000 (the delta total), `action_post` called once, one anchor `lcost:<batch>:2`, one posting row per project.
2. a revision that restates the same figures (empty delta) → **200 with no Odoo call** and the mirror `pushed` with `labour-cost-settled` (the shipped "nothing to push is a success" idiom, `readModel/timesheets.ts`'s `outcome === null` arm).
3. `AC-OLH-031` a Project Manager posts → 403 before any outbox row; the batch's approver posts → 200; a payload whose `total` differs from the DB → the DB total posts.
4. a lost answer: the fake stores the entry, the response is lost, the anchor probe finds it → adopts, one entry.
5. an anchor miss → `held`, no second entry.
6. config unset (no journal) → `config-rejected labour-cost-unconfigured`, no outbox row.
7. currency mismatch → `labour-cost-currency`, no outbox row.
**Mutation checks:** skip the gate call in `index.ts` → case 3 red; `reissueOnInconclusiveAbsence: () => true` → case 5 red; restore.
Verify (CI): red.

### L5-T4 *(15 min)* Adapter, dispatch parts, writer
- `odoo/labour/costAdapter.ts` *(new)*: `createOdooLabourCostAdapter({call, ctx})`; anchor key `lcost:<batch uuid>:<revision>` (`labourCostKey`) validated by `LABOUR_COST_KEY_RE`; create the entry from `buildCostEntry`, write the `ir.model.data` anchor from `labourExternalIdentifier(labourCostKey(batchId, revision))`, `action_post`, read the entry back (`state='posted'`, each line's `analytic_distribution` and `debit`/`credit` — refuse `'cost-read-back-mismatch'`), `probe()` by anchor.
- `adapter-dispatch/odooLabourCost.ts` *(new)*: `isLabourCostPush(command)` (`domain === 'timesheets' && record.erp_doc_kind === 'labour-cost'`); `resolveOdooLabourCostAdapter` (capability gap → `config-rejected`; the three config keys → `labour-cost-unconfigured`; read the deltas through the service client; dry-build the body and refuse with its code); `resolveOdooLabourCostMoneyOutboxDeps` (`reissueOnInconclusiveAbsence: false`, `probeByRemarksKey: () => adapter.probe(record)`).
- `adapter-dispatch/labourCostGuard.ts` *(new)* + its test: `enforceLabourCostApproved(callerClient, batchId)` calls `approved_labour_cost_for_push` **under the caller's JWT** and maps `P0001`→422 `labour-cost-not-approved`, `42501`→403, `P0002`→404; `applyCanonicalLabourCostTruth(command, gated)` replaces `record.id`, `approved_at`, `total`, `currency` and `allocations` from the gate's answer and re-derives the key (`labourCostPushKey`). Failing cases first: a payload amount that differs from the gate's never reaches the builder.
- `index.ts`: `if (isLabourCostPush(command)) { … }` **before** the opaque-key check, the `isTimesheetPush` twin (`index.ts:339-360`).
- `KIND_DOMAIN['labour-cost'] = 'timesheets'` in `erpnext/feedKinds.ts:20-44`; `authGuard.ts` needs no change (the domain is already `ROLE_RULE_DELEGATED_TO_DB_GATE`).
- Writer: extend `readModel/timesheets.ts` `upsert` with a second branch on `canonical.erp_doc_kind === 'labour-cost'` that updates **`labour_cost_batches`** (`push_state:'pushed'` or `'settled'`, `push_error: null`, `pushed_at`) and calls `record_labour_cost_postings` with the external ids — never `timesheet_erp_mirror` (its `timesheet_id` is a timesheet FK). Failing test first in `readModelWriters.labourCost.test.ts`; the shipped `readModelWriters.timesheets.test.ts` must stay green.
Verify (CI): L5-T3 green; `D` on `authGuard.test.ts`, `odooAdapters.test.ts`, `odooMoneyOutbox.test.ts`, `readModelWriters.timesheets.test.ts`.

### L5-T5 *(10 min)* Wire the FE command and its repository
Failing test first: `pmo-portal/src/lib/repositories/labourCost.test.ts` *(new)* — `pushApproved(batchId)` calls `approved_labour_cost_for_push` (throwing on `P0001`/`42501`), then `dispatchDomainCommand('timesheets','create',{id, erp_doc_kind:'labour-cost', approved_at}, {idempotencyKey: labourCostPushKey(id, approvedAt)})`; a PMO-only org (`routeDomainWrite('timesheets') !== 'external'`) is a benign no-op, exactly like `repositories/timesheets.ts:56-60`.
`pmo-portal/src/lib/adapterSeam/labourCostPushKey.ts` *(new)*: `lcp:<uuid>:<stamp>` with the tier-neutral rationale comment (one derivation, two originators).
Verify (CI): `V src/lib/repositories/labourCost.test.ts src/lib/adapterSeam/labourCostPushKey.test.ts`.

### L5-T6 *(15 min)* The backstop's second subject
The L4 host drives timesheets; batches need the same treatment: `listPendingLabourCostBatches(org)` (a new query on `labour_cost_batches` where `push_state in ('pending','failed')` and approved, oldest first, bounded 100), the gate re-asserted per row with `p_actor = approved_by`, and the same `dispatch`. Pure orchestration in `_shared/labourCostBackstop.ts`, mirroring the timesheet one; failing test first in `_shared/labourCostBackstop.test.ts` (a refused gate is a recorded outcome, per-row containment, no re-drive of `pushed`/`held`/`pushing`/`settled`).
Verify (CI): `D supabase/functions/_shared`.

### L5-T7 *(5 min)* Gate and push
Collision check, denominator, eslint, `check:guards`, `D supabase/functions/adapter-dispatch supabase/functions/_shared`, `P` on the two new pgTAP files. Commit `feat(odoo): post approved payroll labour cost as a journal entry (#1510 L5, migration 0863)`; push `feat/1510-l5`. PR body: mutation evidence, and for security-auditor: the gate replacing payload truth, the delta arithmetic (a correction can never double-post), held-on-miss, no FX conversion, and that a posted entry is never edited.

### L5-T8 *(5 min)* Declarations
`connect/workflows.ts` + every `TierWorkflows` declaration: `labourCost.push` v1 ("post an approved payroll cost batch's per-project delta to the ERP once, by batch revision") and `labourCost.read` v1 where a read exists. Odoo `pending: 1510` until L7; ERPNext `unavailable` "Payroll labour cost posts from Odoo under this plan; ERPNext labour cost is not built" (say it once, in the module header, and keep the row short). Grep `grep -rln "TierWorkflows" pmo-portal/src` for every declaration that must carry the new keys.
Verify (CI): `V src/lib/adapterSeam/contractSuite/parity.test.ts`.

### L5-T9 *(15 min)* Producer wiring — **blocked by #1518**
When #1518's payroll run exists: a service-only `create_labour_cost_batch(p_org_id, p_period_start, p_period_end, p_currency, p_allocations jsonb)` that creates the next revision (or T1 for a first run) from the payroll run's per-employee, per-project cost; its caller is #1518's approval step. Failing pgTAP first (a second call for the same period creates revision 2 and links `supersedes_id`; a project not in the org raises `P0002`). **Until #1518 lands, this task is not started and L5's ACs are proved with fixtures** — stated in the PR body so nobody reads a green suite as "payroll is wired".
Verify (CI): `P supabase/tests/odoo_labour_cost_gate.test.sql`.

---

## L6 — Data layer and screens (UI lane)

### L6-T1 *(10 min)* DAL, test first
Create `pmo-portal/src/lib/db/labour.test.ts` (the DAL in `src/lib/db/labour.ts`, following the repo's per-concern split): `listProjectLabour(projectId)` → `rpc('list_project_labour')`; `listProjectLabourCost(projectId)` → `rpc('list_project_labour_cost')`; `listLabourBatches()` reading `labour_cost_batches` joined to its allocations count (bounded, `LIST_LIMIT + 1` saturating read); `approveLabourBatch(id)` → `rpc('approve_labour_cost_batch')`; `getPushState`/`listPushesNeedingAttention` reuse `db/timesheetPush.ts` unchanged.
Verify (CI): `V src/lib/db/labour.test.ts`.

### L6-T2 *(5 min)* Repository
Add the functions to `repositories/timesheets.ts` (or a `labourCost` member) and its contract, so pages never import the DAL (ADR-0017). Update `repositories/index.test.ts`'s member/method expectations.
Verify (CI): `V src/lib/repositories/index.test.ts src/lib/repositories/composition.test.ts`.

### L6-T3 *(10 min)* Hooks, test first
`src/hooks/useLabour.ts` *(new)* + test: `useProjectLabour(projectId)`, `useProjectLabourCost(projectId, enabled)` (enabled only for the money audience), `useLabourBatches()`, `useApproveLabourBatch()`, `usePushLabourBatch()`, `useOdooTimesheetsOwned()` (`useExternalDomainOwnership` contains `{externalTier:'odoo', domain:'timesheets'}`); org id in every key; a successful push invalidates `labour`, `labourCost`, `pending`, `timesheet`.
Verify (CI): `V src/hooks/useLabour.test.tsx`.

### L6-T4 *(5 min)* Policy
`src/auth/policy.ts`: entity `labourCost` — `approve`/`post`: Admin, Finance; `view`: Admin, Executive, Project Manager, Finance; `view` of hours: every active role. `can()` refuses both while viewing-as. Failing case first in the policy test file.
Verify (CI): `V src/auth/policy.test.ts`.

### L6-T5 *(20 min)* The project Labour panel (AC-OLH-040)
`pmo-portal/pages/project-detail/ProjectLabourPanel.tsx` *(new)* + `.test.tsx` with one `it` per state of §5.2 (titles prefixed `AC-OLH-040`): hours rows with the state and last-read; cost rows for the money audience only; an Engineer sees hours and no amounts; orphaned row; drift strip; waiting strip with "Check again" calling the send hook with the stored key; held strip without a button; empty; loading; error + Retry; Odoo unreachable → banner and disabled actions with the reason; a non-employing org renders nothing. Compose beside `ProjectEquipmentPanel` at `ProjectFinancesSection.tsx:291`.
Verify (CI): `V pages/project-detail/ProjectLabourPanel.test.tsx pages/project-detail/ProjectFinancesSection.test.tsx`.

### L6-T6 *(20 min)* Administration → Labour cost (supporting; AC-OLH-040 is owned by L6-T5)
`pmo-portal/pages/admin/LabourCost.tsx` *(new)* + test: the batch table, the `Draft`/`Approved`/`Posted`/`Did not post`/`Held`/`Settled` pills; "Post to Odoo" (approver/Admin/Finance) with the confirm dialog; "Check again" for `failed`; refusal inline via `pushErrorCopy`; empty; loading; error; non-employing org hides the section. Register it in `Administration.tsx` beside `cost-attribution` (`:179`) with `may('manage','labourCost')` (`:325` shape) and the same Finance access carve-out.
Verify (CI): `V pages/admin/LabourCost.test.tsx pages/AdministrationShell.test.tsx`.

### L6-T7 *(10 min)* Checklist rows and the config card
`OdooSetupChecklist.tsx:81` `EmployAction` gains domain `'timesheets'` (label keys from §5.5); the steps array (`:135-153`) gains the labour employ row, the Cost-basis `SelectField` and the three-account picker, each saving through the actor-checked `set_odoo_labour_config` added by 0861 (one RPC, Admin+Finance, audited). Failing cases first in `OdooSetupChecklist.test.tsx`.
Verify (CI): `V src/components/integrations/odoo/OdooSetupChecklist.test.tsx`.

### L6-T8 *(10 min)* i18n
Every §5.5 key in `public/locales/en/labour.json` and `public/locales/id/labour.json` (new namespace, registered where the other namespaces are), and the `administration` keys in both `administration.json`. Run the i18n catalogue/parity test (`grep -rln "locales/id" pmo-portal/src/lib/i18n`). No key in one file only.
Verify (CI): `V src/lib/i18n` (its parity suites).

### L6-T9 *(5 min)* Gate and push
eslint touched files, `npm run check:guards`, `node scripts/affected-e2e.mjs` (lists specs visiting `/projects/:id` and `/administration`; CI's release run executes them). Commit `feat(labour): labour panel, cost administration and Odoo setup rows (#1510 L6)`; push `feat/1510-l6`. `scripts/ux-proof.sh /projects/<seed id> /administration` runs in the Director's rendered review.

---

## L7 — Acceptance, declarations and docs

### L7-T1 *(20 min)* Bed composite
`supabase/functions/adapter-dispatch/odooLabour.bed.test.ts` *(new; bed-gated on the documented bed variables, never on `CI`)*: create a linked project and a confirmed employee, push an approved sheet with three entries → three analytic lines with the right hours and `amount = 0`; push a payroll batch revision 1 → one posted entry with the expected lines and distributions; push revision 2 → a delta entry; re-push revision 1's key → no new documents (V-OLH-6/-10). Run under `scripts/with-odoo-lock.sh` with the bed's variables sourced, never printed.

### L7-T2 *(20 min)* Curated journey (AC-OLH-090)
`pmo-portal/e2e/AC-OLH-090-odoo-labour.spec.ts` *(new)*, header `// @e2e-isolation: dedicated-row` + reason, gated exactly like `AC-OCI-100-…spec.ts:11-27` (partial configuration throws; none skips). Journey: a Finance Admin employs labour in Odoo (setup checklist), links the employee, approves a week in Approvals, posts an approved batch, opens the project's Labour panel; **goal oracle:** read Odoo over JSON-2 — one analytic line per (project, date) with those hours, exactly one posted entry whose lines carry the batch's amounts on the projects' analytic accounts, and the panel showing the same hours and cost; correct the batch and assert a second entry carries only the delta. Add the allowlist entry to `scripts/check-e2e-skips.mjs` (the `AC-OCI-100` shape, `verified: <run date>`, restore path).

### L7-T3 *(10 min)* Declarations
Flip Odoo `timesheet.push`, `employee.match` → `supported` and `labourCost.push` → `supported` once L7-T1/T2 are green; `employee.send` → `unavailable` with the reason "PMO adopts Odoo employees and never creates HR master data"; `cutover.timesheet` stays `pending: 1510` with a note that the cutover proof rides the same bed run, and is flipped in the same commit if the composite covers it. Implement the Odoo `pushTimesheet` harness arm (`odoo/contract.harness.ts:307`) so `timesheetPushSuite` runs against the Odoo fake; add `labourCost` to the registry's parity expectations.
Verify (CI): `V src/lib/adapterSeam/odoo/contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts src/lib/adapterSeam/dispatchGateWiring.test.ts`.

### L7-T4 *(10 min)* Runbook and roadmap
`docs/runbooks/odoo-labour.md` *(new)*: employ prerequisites (hr_timesheet installed, the integration user's groups and `has_access`, the employee-link step, the integration user's own `hr.employee` row if V-OLH-1 shows it is required), the cost-basis choice and why only one source of cost, what PMO writes and never writes (D1/D7/D11), held postings and how to resolve one (look in Odoo, then "Check again" or attest), sync timing, and the correction routine. `docs/runbooks/pmo-cli.md`: one line that labour postings are app-only. Roadmap update: the Director, not the worker (workers post nothing to GitHub).

---

## 8. Risks and ceilings

| Risk | Where closed |
|---|---|
| A week of hours counted twice | Deterministic `ts:` outbox key (shipped) + one line per (sheet, project, date) with an immutable anchor + held-on-miss (L3-T5 cases 5-7, mutation-checked) |
| Hours and cost both charging the project | D3: one cost basis per org; `amount = 0` verified at read-back and drift-marked daily (FR-OLH-014) |
| The ERPNext backstop pushing an Odoo-owned week | D14 + L2-T7's tier gate on both queue halves, mutation-checked |
| A correction double-posting payroll cost | Revisions + per-project delta (L5-T2 §4, AC-OLH-032); a posted entry is never edited |
| Whose cost a week becomes | The confirmed link only (D5); the feed proposes and never confirms; an offboarded approver is refused by the shipped gate |
| A forged approval or amount on the wire | Both gates re-read the DB under the caller's JWT and replace payload truth (0138 precedent + L5-T4) |
| Odoo's own rate re-costing our hours later | `cost-drift` state and surface (FR-OLH-014); `odoo-rate` basis is the honest alternative (D3 fallback) |
| Tick budget: +1 kind and a reconcile read | Reserves counted by the shipped loop; the reconcile is bounded to 200 ids per tick, labour-employing orgs only (NFR-OLH-002) |
| Analytic-line volume | One row per (sheet, project, date) per `odoo_labour_lines`; `ponytail:` archive rows older than two fiscal years if an org passes 2M |
| An org's real Odoo has no `hr_timesheet` | The labour models are a separate discovery block and never degrade the connection (L1-T8); employ refuses with the model named |
| #1518 slipping | L1–L4 ship hours; L5's machinery is proved on fixtures and only the producer waits; the plan says so in every PR body |

## 9. Follow-ups (not built here; file as issues when the Director accepts the plan)

Hour-line deletion when a project leaves a sheet (D11 says never, automatically) · an `odoo-rate` basis that reads Odoo's `hourly_cost` back for comparison · FX conversion of payroll cost (D12) · per-employee payroll breakdown in the panel · attendance-derived hours without a timesheet (#1517/T6) · timesheet-based client billing (T3/#1443) · a CLI verb for posting labour cost · analytic budgets (Enterprise-only, DD-ODA-6) · reading `account.analytic.line` back as a mirror for richer reconciliation.
