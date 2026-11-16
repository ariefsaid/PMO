# Spec: CLI time-and-materials operations (#1856)

> **Status:** Draft for owner sign-off, 2026-11-16. Map: #459.
> IDs: `FR-CTM-###`, `NFR-CTM-###`, `AC-CTM-###`.
> **Rules come from elsewhere.** Every amount, role, separation-of-duties and state rule is the app's, already
> specified in `docs/specs/time-and-materials-claims.spec.md` (FR-TM-*) and enforced by the shipped RPCs cited below.
> This spec adds only CLI commands that call those same RPCs. It adds no rule, no RPC and no bypass.
> CLI conventions: `docs/specs/pmo-cli.spec.md`, `docs/runbooks/pmo-cli.md` (recipe 7 today: reads only).
> Executor: money path, so Director-dispatched, one fresh worker per slice (CLAUDE.md routing).

## 0. Job story

> **When** I run a client's time-and-materials month for the owner, **I want** the agent on my machine to keep the
> rate card, assemble the approved hours into a claim, prepare and confirm the client's sign-off and draft the
> invoice, **so that** the month is billed without clicking through the app, and never with fewer checks than the app.

## 1. What ships today

**CLI (`scripts/lib/pmo-tm.mjs`, `scripts/pmo.mjs:1877`):** `pmo tm rates list`, `pmo tm claim preview` (read-only),
`pmo tm claim list`. Nothing writes.

**Server.** Every write below is a `security definer` RPC that re-asserts the caller's org, active membership and role
itself. The app's data layer calls exactly these (`pmo-portal/src/lib/db/timeAndMaterials.ts:286-392`).

| Action | RPC (latest definition) | Who the RPC allows (deciding lines) | SoD it enforces | CLI guard tier today |
|---|---|---|---|---|
| Save a rate line (new, new version, item code) | `save_contract_rate_line(jsonb)` 0541:16; body via `contract_rate_line_write` 0680:97 | active Admin, Finance (0541:37-40) | none of its own (role separation, FR-TM-042) | admitted: `tm_write_rpcs`, active Admin/Finance (0899:158, 265-269) |
| End a rate line | `end_contract_rate_line` 0680:182 | Admin, Finance (0680:191-193) | none | admitted (same) |
| Assign a person to a labour line | `set_contract_rate_assignee` 0680:212 | Admin, Finance (0680:221-224) | none | admitted (same) |
| End an assignment | `end_contract_rate_assignee` 0515:294 | Admin, Finance (0515:300-303) | none | admitted (same) |
| Assemble a draft claim | `assemble_tm_claim` 0680:312 | `may_record_project_progress` (0680:342; 0245:55): Admin, Finance, Executive, or the project's PM; `sales_invoices` feature on | each source in at most one live claim (unique live source, 0680:391-403) | admitted for Admin/Finance only (a PM's token is refused by the guard) |
| Deselect a source | `deselect_tm_source` 0534:995 | `may_record_project_progress` (0534:1009-1011); Draft only | none | admitted for Admin/Finance only |
| Prepare the sign-off | `prepare_tm_signoff` 0517:92 | `may_record_project_progress` (0517:112-114); Draft; same-project document | records the sign-off preparer | admitted for Admin/Finance only |
| Withdraw a claim | `withdraw_tm_signoff` 0517:133 | Draft: assembler, preparer, Admin, Finance (0517:155-158); signed off: Admin, Finance (0517:162-164), refused while a live invoice or ERP raise exists | none | admitted for Admin/Finance only |
| Confirm the sign-off | `confirm_tm_signoff` 0680:415 | Admin, Finance (0680:434-436) | confirmer ≠ assembler and ≠ sign-off preparer, unless sole active member (0680:447-452); Issued/Approved same-project document with a file (0680:456-465) | admitted (same) |
| Draft the invoice, no-ERP org | `create_native_tm_invoice` 0704:10 | Admin, Finance (0704:31-34); refused when an ERP owns revenue (0704:37-41) | creator joins the invoice authors (0704:127); claim's assembler, preparer and confirmer join via `append_progress_claim_author` (0517) | **not admitted** (in no tier) |
| Approve the invoice | `transition_native_sales_invoice` 0534:306 | per its own checks | approver ∉ authors (`assert_sales_invoice_approver`, 0534:351) | not admitted |
| Raise the invoice, ERP org | `adapter-dispatch` revenue command, claim id as intent (app: `pages/project-detail/tabs/BillingTab.tsx:203`) | dispatch guards | claim fence `assert_progress_claim_raisable` + outbox | n/a (edge function) |
| Enter own time | `save_timesheet_week` 0268:206 | Admin, Executive, PM, Engineer; own sheet only (0268:233, 252) | none | not admitted |
| Submit / approve / reopen a week | `transition_timesheet` 0855:6 | owner submits; manager / Admin approves | approver ≠ owner (0855:64); reopen refused while hours sit in a live claim | not admitted |

Reads already admitted: `preview_tm_claim`, `list_tm_claims`, `list_tm_claim_source_details` (`tm_read_rpcs`, active
Admin/Executive/PM/Finance, 0899:159, 270-274; each re-checks `tm_assert_amounts_reader`, 0518); tables
`contract_rate_lines`, `contract_rate_assignees`, `project_documents` (operator read tier, 0899:136-137);
`external_domain_ownership`, `profiles` (read-only tier).

## 2. Scope

**In (this issue).** CLI commands for: rate lines (save, end), assignments (set, end), claim assembly, source
deselection, sign-off preparation, sign-off confirmation, withdrawal, and the no-ERP invoice draft. Each is preview
by default and writes only with `--apply`.

**Out of scope.**
- **Time entry and week approval.** A person's own week is entered and approved in **Timesheets**. The RPCs are complete,
  but time entry is personal (own sheet only) and approval on an ERP-connected org is followed by the ERP push the app
  dispatches. Revisit if the owner wants agents to enter their own time (OQ-CTM-4).
- **Invoice raise when an ERP owns revenue: needs server work first.** The CLI stays on the app's **Create invoice**.
- **Invoice approval.** A money transition stays in the app with its approver rules (DD-API-3).
- **Issuing the signed document.** `confirm` needs an Issued or Approved document; issuing stays in **Project → Documents**
  (`pmo documents create|upload` already registers and uploads a Draft).
- New rules of any kind: partial sign-off, premiums, retention, down-payment recovery (follow-ups in the T&M spec §11).

## 3. Commands

All take `--json`. Exit `0` ok, `1` the server refused or failed, `2` the CLI refused before sending (pmo-cli convention).

```
pmo tm rates set <file.json|-> [--apply]
pmo tm rates end --project <id> --line-key <uuid> --to <date> --version <n> [--apply]
pmo tm assign set <file.json|-> [--apply]
pmo tm assign end --project <id> --assignment <uuid> --to <date> [--apply]
pmo tm claim assemble --project <id> --from <date> --to <date> [--work-order <id>] [--apply]
pmo tm claim sources <claim-id>
pmo tm claim deselect <claim-id> <source-id>... [--apply]
pmo tm claim withdraw <claim-id> [--apply]
pmo tm claim invoice <claim-id> [--apply]
pmo tm signoff prepare <claim-id> --document <document-id> [--note <text>] [--apply]
pmo tm signoff confirm <claim-id> [--apply]
```

**Ruling D3 (accepted, Director, 16 Nov):** claim commands take `--project`; the command refuses a claim not on that
project's list before any write; no new read, no guard change. (`claim deselect|withdraw`, `signoff prepare|confirm`,
`claim invoice` therefore take `--project <id>` in addition to the synopsis above; `claim sources` does not.)

## 4. Functional requirements (EARS)

**General**
- FR-CTM-001 Each write command shall call only the RPC named for it in §1, with the same arguments the app's data layer
  sends; the CLI shall send no `org_id`, no user id of the caller and no amount.
- FR-CTM-002 When a write command runs without `--apply`, the CLI shall read the current state, print the planned change
  and every problem it can see, and send no write.
- FR-CTM-003 When a write command runs with `--apply`, the CLI shall make the write once and then re-read the affected
  record with the read RPC or table named for it, and print what the server now holds.
- FR-CTM-004 Where the signed-in role is outside the guard tier for a command (§1), the CLI shall refuse before sending,
  naming the roles allowed and the app screen to use instead (exit 2).
- FR-CTM-005 The CLI shall never price, round or total an hour itself: amounts shown come from `preview_tm_claim`,
  `list_tm_claims` or the write's own result.
- FR-CTM-006 When the server refuses, the CLI shall print a headline for the error code and the server's own message
  verbatim after it (`explainError` pattern, `scripts/lib/pmo-tm.mjs`), and exit 1.
- FR-CTM-007 The CLI shall offer no command that assembles, prepares and confirms in one run, so confirmation is always a
  separate, deliberate call (the server's SoD still decides).
- FR-CTM-008 When an `--apply` write's outcome is unknown (connection lost, timeout), the CLI shall say so, print the
  read command that shows the truth, and not retry by itself.
- FR-CTM-009 The CLI's T&M write list shall equal the guard's `tm_write_rpcs` (plus `create_native_tm_invoice` once
  admitted), checked by a list-sync test as `TM_READ_RPCS` is.

**Rate card**
- FR-CTM-010 `rates set` shall read a JSON array of rate lines (`project_id`, `kind`, `label`, `unit`, `rate`,
  `currency`, `effective_from`, optional `effective_to`, `asset_id`, `standby_rate`, `sales_item_code`, and for an edit
  `line_key` + `expected_version`) and send the whole file as one `save_contract_rate_line` array call, so the file
  saves completely or not at all.
- FR-CTM-011 When previewing `rates set`, the CLI shall classify each row against the current card as `create`,
  `new version`, `unchanged` or `refused`, and shall refuse before sending: a malformed field, a `currency` other than
  the project's, a rate with more than 2 decimals or below zero, and a new labour line whose label equals a current
  labour line's label on the same project (case-insensitive).
- FR-CTM-012 When a `rates set` row creates a line, the CLI shall mint its `line_key` before sending and print it, so a
  rerun of the same file is refused as a duplicate label rather than creating a second line.
- FR-CTM-013 `rates end` shall call `end_contract_rate_line` with the version read from `rates list`; its preview shows
  the line, its window and the new end date.
- FR-CTM-014 `assign set` shall read a JSON array (`project_id`, `line_key`, `user_id`, `effective_from`, optional
  `effective_to`) and call `set_contract_rate_assignee` once per row; when previewing it shall flag a person who is not an
  active member, a line that is not a current labour line, and a window that overlaps one of the person's assignments
  on that project.
- FR-CTM-015 When an `assign set` row is identical to an assignment that already exists, the CLI shall report it
  `skip` and send nothing for it; a refused row shall not stop later rows, and the run exits 1 if any row was refused.
- FR-CTM-016 `assign end` shall call `end_contract_rate_assignee`.

**Claims**
- FR-CTM-020 Previewing `claim assemble` shall print `preview_tm_claim` for the same project and window: priced lines,
  unrated sources with their reasons, and the total (the existing `formatPreview`).
- FR-CTM-021 When a Draft claim already exists for the same project, the same work order (or none) and an overlapping
  window, `claim assemble` shall print that claim and send nothing (exit 0, `already_assembled`), so rerunning after an
  unknown outcome cannot assemble a second claim.
- FR-CTM-022 After `claim assemble --apply`, the CLI shall print the new claim's id, lines and total from
  `list_tm_claims`, and shall flag a total that differs from the preview's (hours approved in between).
- FR-CTM-023 `claim sources` shall print `list_tm_claim_source_details`: each source's date, person or machine, units,
  line and whether it is still in the claim, plus whether a prepared sign-off is still current.
- FR-CTM-024 `claim deselect` shall call `deselect_tm_source` once per source id; a source no longer in the claim shall
  be reported `skip`. After apply the CLI shall print the claim's new lines and total from `list_tm_claims`.
- FR-CTM-025 `claim withdraw` shall call `withdraw_tm_signoff`; its preview shows the claim's status and what withdrawal
  releases; a claim already withdrawn is reported `already_withdrawn` (exit 0).

**Sign-off**
- FR-CTM-030 `signoff prepare` shall call `prepare_tm_signoff`; its preview shows the claim (status, lines, total) and the
  document (project, status, whether it has a file) and warns when the document is not yet Issued or Approved or has no
  file, because confirmation will refuse it.
- FR-CTM-031 `signoff confirm` shall call `confirm_tm_signoff`; its preview shows the claim, its assembler and sign-off
  preparer by name, the document, and whether the prepared sign-off is still current, and warns when the signed-in user
  assembled or prepared it (the server refuses that unless they are the only active member).
- FR-CTM-032 After `signoff confirm --apply`, the CLI shall print the basis (`standard` | `sole_operator`) and gross the
  server returned; a claim already signed off is reported `already_signed_off` with who confirmed it (exit 0).

**Invoice (no-ERP orgs)**
- FR-CTM-040 `claim invoice` shall call `create_native_tm_invoice`; when `external_domain_ownership` shows an ERP owns
  revenue, the CLI shall refuse before sending and name the app's **Create invoice** (exit 2).
- FR-CTM-041 After `claim invoice --apply`, the CLI shall print the Draft invoice id (the claim id) and the next step:
  a different Admin or Finance approves it in the app.
- FR-CTM-042 When the server answers `claim-already-invoiced`, the CLI shall report `already_invoiced` (exit 0).

## 5. Per-action contract

| Command | Preview prints | Apply prints | Rerun / retry | Typical refusals (server words pass through) |
|---|---|---|---|---|
| `rates set` | per row: create / new version / unchanged / refused + reason; minted `line_key`s | per row `{line_key, version, changed}` | same file again: rows `unchanged`, created rows refused as duplicate label; stale edit → `40001` "re-read with `rates list`" | `42501` role; `22023` field; `23514` currency; `23505` window rewrite; `40001` stale version |
| `rates end` | line, window, new end | new version | `40001` after success: re-read shows it ended | `P0002` not found; `22023` end date |
| `assign set` | per row: create / skip / refused | per row assignment id | identical rows `skip` | `23505` overlap; `P0002` member or line |
| `assign end` | assignment, new end | done | same date again is harmless | `22023` end date |
| `claim assemble` | `preview_tm_claim` table, unrated rows, total | claim id, lines, total; total-drift warning | existing overlapping Draft → `already_assembled`, nothing sent | `P0001` nothing left to claim / source already in claim N; `42501`; `23514` work order on another project |
| `claim sources` | (read) | n/a | n/a | `P0002` claim |
| `claim deselect` | the sources and their units | new lines and total | gone source → `skip` | `P0001` not Draft |
| `claim withdraw` | status, what is released | new status | `already_withdrawn` | `P0001` has an invoice / ERP raise in flight; `42501` |
| `signoff prepare` | claim + document + warnings | prepared by, document | same call again rewrites the same values | `23514` document not on this project; `P0001` not Draft |
| `signoff confirm` | claim, preparers, document, current?, SoD warning | basis, gross | `already_signed_off` | `42501` SoD / role; `23514` document; `P0001` claim changed / hour no longer approved; `BW001` work order remaining value |
| `claim invoice` | claim status, revenue owner | invoice id, next step | `already_invoiced` | `55000` not signed off / withdrawn; `vat-rate-missing`, `no-client`, `claim-total-mismatch`; `42501` `erp-owns-revenue` |

## 6. Non-functional requirements

- NFR-CTM-001 Node 22 standard library only, as `pmo-tm.mjs`.
- NFR-CTM-002 Org and caller come from the token; the CLI never sends either (NFR-TM-001).
- NFR-CTM-003 Every read the CLI uses for a preview is bounded (`limit` ≤ 1000, the existing `MAX_RATE_ROWS` pattern)
  and says when it was truncated rather than planning from a partial card.
- NFR-CTM-004 A preview is advisory: the server re-checks everything at apply, and a preview that passes is never
  reported as proof the write will succeed.
- NFR-CTM-005 Output is English, as the rest of the CLI; amounts print with 2 decimals as returned.
- NFR-CTM-006 Public repo: test fixtures synthetic (no tenant, person or client data).

## 7. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-CTM-001 | Given each write command, when run without `--apply`, then only GET requests and read RPCs are sent and no RPC in `tm_write_rpcs` or `create_native_tm_invoice` is called | Unit (node:test, `scripts/pmo-tm.test.mjs`) |
| AC-CTM-002 | Given each write command with `--apply`, then exactly its RPC from §1 is called once with the app's argument names, and no `org_id`, caller id or amount is in the body | Unit (node:test) |
| AC-CTM-003 | Given a signed-in Project Manager, Engineer or Executive, when any write command runs, then the CLI refuses with exit 2 naming Admin/Finance and the app screen, and sends nothing | Unit (node:test) |
| AC-CTM-004 | Given a rates file with a wrong currency, 3-decimal rate, negative rate or a duplicate current labour label, when previewed or applied, then those rows are refused before sending and nothing is sent with `--apply` | Unit (node:test) |
| AC-CTM-005 | Given a rates file that creates a line, when applied twice, then the first run prints the minted `line_key` and the second refuses the row as a duplicate label without a request | Unit (node:test) |
| AC-CTM-006 | Given a rates file of three rows where the server refuses the third, then the whole file is one RPC call and the CLI reports the refusal with exit 1 (the server's transaction saved nothing) | Unit (node:test); the all-or-nothing save is the RPC's (one call, one transaction): add a pgTAP case to `tm_rate_sales_items.test.sql` (bad third row saves none) if it is not there |
| AC-CTM-007 | Given `assign set` with one identical existing row, one overlapping row and one new row, then the first is `skip`, the second refused with the server's overlap message, the third created, exit 1 | Unit (node:test) |
| AC-CTM-008 | Given a Draft claim for the same project, work order and an overlapping window, when `claim assemble --apply` runs, then it prints that claim as `already_assembled` and calls no writer | Unit (node:test) |
| AC-CTM-009 | Given `claim assemble --apply`, when the assembled total differs from the preview total, then both are printed with a warning | Unit (node:test) |
| AC-CTM-010 | Given a server refusal with code 42501, P0001, P0002, 22023, 23505, 23514, 40001 or 55000, then the CLI prints its headline plus the server's own message and exits 1 | Unit (node:test) |
| AC-CTM-011 | Given `signoff confirm` previewed by the user who assembled or prepared the claim, then it warns that the server will refuse unless they are the only active member; given `--apply`, the server's 42501 is shown verbatim | Unit (node:test); the rule itself owned by pgTAP AC-TM-006 (`tm_signoff.test.sql`) |
| AC-CTM-012 | Given `signoff prepare` with a Draft document or one without a file, then the preview warns that confirmation will refuse it | Unit (node:test) |
| AC-CTM-013 | Given an org whose ERP owns revenue, when `claim invoice` runs, then it refuses before sending and names the app's Create invoice | Unit (node:test) |
| AC-CTM-014 | Given a confirmed, already-invoiced, or withdrawn claim, when `signoff confirm`, `claim invoice` or `claim withdraw` is rerun, then the CLI reports `already_signed_off`, `already_invoiced` or `already_withdrawn` and exits 0 | Unit (node:test) |
| AC-CTM-015 | Given an OAuth API-client token, when it calls `create_native_tm_invoice`, then an active Admin or Finance token passes the guard and a PM, Engineer, Executive or inactive member token is refused `42501`; the same call without `client_id` is unaffected | Integration (pgTAP, `api_client_request_guard.test.sql`) |
| AC-CTM-016 | Given the CLI's T&M write list and the guard's `tm_write_rpcs` (+ the invoice tier), then they are equal | Unit (node:test, list sync) |
| AC-CTM-017 | **One curated journey, no-ERP org, local stack, real CLI.** Given Finance user A, when A sets a rate line and assigns an engineer, a manager approves the engineer's week in the app, A assembles and prepares against an Issued document, and Finance user B confirms and drafts the invoice with the CLI, then B's draft carries the approved units and contract rate, and A's attempt to confirm is refused | E2E (Playwright, one; extends the `AC-CLI-001` CLI harness) |
| AC-CTM-018 | Given the runbook, then recipe 7 lists every command here with roles, the preview/apply rule and the app-only steps (time entry, approval, document issue, ERP invoice raise, invoice approval) | Doc review (no test) |

Server rules are not re-proved here: they are owned by the existing pgTAP files `tm_rates`, `tm_rate_sales_items`,
`tm_assembly`, `tm_signoff`, `tm_reads`, `tm_native_invoice`, `tm_equipment` (AC-TM-001..026).

## 8. Recommended first slice

**Slice 1 (the complete month, no-ERP orgs):** `rates set`, `assign set`, `claim assemble`, `claim sources`,
`claim deselect`, `signoff prepare`, `signoff confirm`, `claim withdraw`, `claim invoice`.
AC-CTM-001..017 for those commands.

**Why this cut.** A T&M month is: rates exist → people's approved hours exist → assemble → client signs → a second
person confirms → invoice drafted → a third person approves. Slice 1 covers every step an operating agent can own; the
steps it leaves (own time entry, week approval, document issue, invoice approval) are another person's decision by
design, so the app is the right place for them. Eight of the nine commands need no server change: their RPCs are
already in the guard's T&M write tier. `claim invoice` needs one guard change admitting `create_native_tm_invoice` to
active Admin/Finance tokens (a migration replacing `api_client_request_guard`, number from the migration register, copied
from the highest guard on dev). Without it the month stops one click short.

**Slice 2:** `rates end`, `assign end` (rare; the app covers them meanwhile).

**Later, needs server work first:** invoice raise for ERP-owned revenue.

## 9. Owner questions (each with my recommended answer)

- **OQ-CTM-1 May the CLI draft the invoice (no-ERP)?** Recommended: **yes, Draft only.** Approval stays in the app by a
  person who did not assemble, prepare, confirm or draft it (server-enforced). *Wrong if:* you want every invoice to be
  started by a person in the app; then slice 1 drops `claim invoice` and needs no migration.
- **OQ-CTM-2 May a Project Manager assemble and prepare from the CLI, as in the app?** Recommended: **not now.** The guard's
  T&M tier is Admin/Finance; widening it is a guard change for a case nobody has asked for. *Wrong if:* PMs are the ones
  running the agent; then the guard admits PM tokens to `assemble_tm_claim`, `deselect_tm_source`, `prepare_tm_signoff`
  and Draft `withdraw_tm_signoff` (the RPCs already check the project's PM).
  **Ruling (Director, 2026-11-16): no.** Admin/Finance tokens only in this slice.
- **OQ-CTM-3 May the CLI confirm a client sign-off?** Recommended: **yes**, as 0518 already planned (confirm is in the
  admitted tier). The confirmer must still be a different Admin/Finance from the assembler and preparer, signed in on
  their own CLI. *Wrong if:* you want a person to look at the signed scan in the app before confirming; then `signoff
  confirm` stays app-only.
- **OQ-CTM-4 Should agents enter their own time from the CLI?** Recommended: **no, not in this issue.** Time is entered by
  each person for themselves; an agent has no week of its own. *Wrong if:* staff want to log hours by command; then a
  follow-up admits `save_timesheet_week` and Submit to the guard for Admin/Executive/PM/Engineer tokens.
  **Ruling (Director, 2026-11-16): no.** No time entry from the CLI.
- **OQ-CTM-5 Rates file: one transaction or row by row?** Recommended: **one transaction** (the RPC's array form, as
  the app's Accept proposed). *Wrong if:* you load large cards where one bad row should not block the rest; then the CLI
  sends rows one by one and reports each.
  **Ruling (Director, 2026-11-16): one transaction**, all or nothing; the dry run shows every row.
