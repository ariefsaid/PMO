# Spec: load a client's starting data from the CLI, without the Director (issue #796)

> **Status:** Draft — 2026-10-06. Builds on `docs/specs/pmo-cli.spec.md` (#728).
> **Decisions:** DD-API-1/2/3, OD-SEED-5 (won projects load at their real stage, bids as submitted,
> budgets from each project's workbook, work orders left to users, client / end customer / prospect are
> roles of one company), OD-ID-1 (PMO mints the project number; the organisation's code stays in
> `projects.code`). **ADR:** [ADR-0074](../adr/0074-api-client-admin-load-tier.md).
> **Plan:** [`docs/plans/2026-10-06-client-starting-data-cli.md`](../plans/2026-10-06-client-starting-data-cli.md).
> **Depends on:** #770 merged (the five classification columns on `projects`). Independent of #772.

## 1. Job story

When I bring a new client onto PMO, I want to load their companies, won projects (at their real stage,
with contract value) and open bids, plus each project's draft budget, from one file with one command,
so the load needs neither the Director nor a service-role key and every row passes the same rules as
the app.

## 2. The load file (JSON, version 1)

One JSON object with two optional lists. Field names are the database's where one exists.

| Section / field | Required | Meaning |
|---|---|---|
| `companies[].name` | yes | Legal name. The match key. |
| `companies[].short_name` | no | Display name (#797). |
| `projects[].code` | no | The organisation's own project code (`projects.code`, OD-ID-1). Match key when given. |
| `projects[].name` | yes | Project name. With `client`, the match key when there is no `code`. |
| `projects[].client` | yes | Legal name of the client company (who is invoiced). |
| `projects[].end_client` | no | Legal name of the end customer (#758). |
| `projects[].stage` | yes | Target stage: `Leads`, `PQ Submitted`, `Quotation Submitted`, `Tender Submitted`, `Negotiation`, `Won, Pending KoM`, `Ongoing Project`, `On Hold`, `Close Out`. |
| `projects[].contract_value` | won: yes; bid: no | Amount, ≤ 2 decimals. |
| `projects[].tax_treatment`, `tax_amount` | with a value | `inclusive`/`exclusive`; total tax (0 = no tax). No default — the RPC requires both. |
| `projects[].tax_rate`, `tax_base_numerator`, `tax_base_denominator`, `tax_template` | no | Passed to `set_project_contract_value` unchanged. |
| `projects[].customer_contract_ref`, `contract_date` | won: yes; bid: refused | The client's contract/PO number and date; recorded by the win step. |
| `projects[].start_date`, `end_date`, `project_manager_id` | no | Plain project columns. |
| `projects[].service_line`, `sector`, `location`, `award_type`, `bidding_entity` | no | Classification (#770). |
| `projects[].budget[]` | no | Lines: `category` (the `budget_category` enum, incl. `Special expenses`), `budgeted_amount`, optional `description`, `fiscal_year`, `reference`. |

Load files hold client data. They live outside the repository and are never committed.

## 3. Decisions (with reasons)

- **D1 — one `pmo load <file> [--dry-run]` command, not more generic verbs.** The value is the order and
  the skip rules; letting Claude chain raw `rpc` calls would re-derive them on every load. `get`,
  `create`, `update` and `rpc` keep exactly their #728 lists.
- **D2 — owner-only = an active Admin, checked twice.** The CLI reads the caller's profile and refuses
  anyone else before any write (a clear message). The database guard is the authority: it allows the
  new endpoints only when `public.auth_role() = 'Admin'` and `public.is_active_member()` for the token's
  user, read live, so a demoted or offboarded owner loses them at once.
- **D3 — no new write path, no new RPC.** Companies and projects are plain RLS-governed inserts (as in
  the app). Contract value goes through `set_project_contract_value` (0227) and stage through
  `transition_project` (0183) — their org check, role gate, SoD and `log_audit` rows apply unchanged.
  Budget rows are plain inserts under the existing Draft-only origination trigger (0176) and import-key
  index (0195). The only database change is which endpoints an OAuth token may reach (D4).
- **D4 — guard entries (migration `0234`, amends `0222`).** For an **active Admin's** OAuth token only:
  `POST /rpc/set_project_contract_value`, `POST /rpc/transition_project`, `GET`/`POST` on
  `budget_versions` and `budget_line_items`. For every OAuth token: `GET external_domain_ownership`
  (read-only; the load checks whether ERPNext owns companies). Nothing else changes: no PATCH/DELETE on
  budget tables, no `activate_budget_version`, no work-order or money RPC, no `project_map` write.
- **D5 — won projects walk the real state machine.** The CLI never inserts a project past `Leads` (the
  0173 origination trigger forbids it, and the service-role route OD-SEED-5 allowed the Director is not
  used). It creates the project as `Leads`, sets the value, then calls `transition_project` along a
  fixed forward path: `Leads → PQ Submitted → Quotation Submitted → Won, Pending KoM →` (`Ongoing
  Project` | `On Hold` | `Close Out`); bids stop at their stage (`Tender Submitted` via `Quotation
  Submitted`, `Negotiation` via `Tender Submitted`). The win step carries `customer_contract_ref` and
  `contract_date`, so `decided_at` is the real contract date. An Admin holds won-value authority, so
  the money SoD (ADR-0070) needs no second person. *Effect accepted:* the audit trail shows the walk on
  the load date, attributed to the owner — an honest record of a load.
- **D6 — contract value is set while the project is a Lead, before the win**, and only when the
  project's current value is 0. A different non-zero value is reported and left alone.
- **D7 — budgets are draft-only and use the app's import rules.** Target version = the project's highest
  Draft, else a new Draft named `Imported` with `import_batch_id` / `imported_at` (the app's
  `budgetDescriptor.ts`). Each line carries the app's `computeBudgetLineImportKey` key (a byte-identical
  `.mjs` copy, proven by a parity test); a line whose key is already in that version is skipped, and a
  `23505` from the 0195 index counts as skipped. If the project already has an Active or Archived
  version the budget is skipped (more lines go through the app's budget import). The CLI never sends
  `status`, `activated_at` or `actual_amount`. **Activation stays in the app** (approval + ERPNext push).
- **D8 — match keys (idempotency).** Company: exact legal name. Project: `code`, else exact name +
  client. Contract value: current value 0. Stage: the project's current stage on the target's path
  (resume from there; off the path → "diverged", left alone). Budget line: `(version, import_key)`.
  A completed file re-run makes zero writes.
- **D9 — companies while ERPNext owns them are not created by the CLI.** Today, with the `companies`
  domain externally owned, a PMO insert is refused by RLS (`companies_insert`, 0097). The shipped push
  path for a PMO-created company is the app: `repositories.company.create` → `dispatchCreate('companies',
  { …, erp_doc_kind: 'customer' })` → edge function `adapter-dispatch` → outbox (ADR-0058) → ERPNext
  `Customer` → canonical mirror row + `external_refs`; `short_name` is then a PMO-only update. A Customer
  created natively in ERPNext arrives through the feed's party adopt (`erpnextFeedDeps.ts`
  `mintMirrorRow`). The CLI stays on the REST API, inside the 0222 guard; it does not call edge
  functions. So the preflight lists each missing company and stops; the owner creates them in the app
  or in ERPNext (its own bulk import), then re-runs. The CLI still sets an empty `short_name` on a
  matched company (a PMO-only field).
- **D10 — PMO project numbers are minted by the database at load time** (0231 trigger), in the load
  year. The organisation's code goes to `projects.code`.
- **D11 — stop at the first refusal.** The CLI prints what it did and what failed, exits 1, and a re-run
  resumes (D8).
- **D12 — JSON only.** The data is nested (project → budget lines; names → ids), Claude converts the
  spreadsheets, and a CSV parser is new code. No new dependency.
- **D13 — reads are filtered lookups** (by name, code, project or version), never full-table lists,
  so PostgREST's `max_rows` cap cannot hide a match; a lookup that returns 1000 rows is refused.

## 4. What stays in the app

Budget activation · work orders (OD-SEED-5) · the ERP project link (`config.project_map` is
service-role-only today; #772 ships its writer) · creating companies while ERPNext owns them (D9) ·
changing an existing value, stage or short name (re-runs never overwrite) · `Loss Tender`, `Internal
Project`, archive, restore, delete · classification option lists (Admin settings, #770 — configure
before loading) · people and roles.

## 5. Requirements (EARS)

- **FR-CSD-001** The CLI shall offer `pmo load <file.json | -> [--dry-run]`, which loads the file's
  companies, then its projects (create → contract value → stage), then their draft budgets, in file order.
- **FR-CSD-002** When `pmo load` runs, the CLI shall validate the whole file before any request and, if
  any problem is found, list every problem and exit 2 without sending anything.
- **FR-CSD-003** When the file is valid, the CLI shall read the caller's profile and, unless the role is
  `Admin` and the status `active`, exit 2 without writing.
- **FR-CSD-004** Before any write, the CLI shall resolve every company, project and budget against the
  database with read-only requests and, if any reference cannot be resolved, list every problem and exit
  2 without writing.
- **FR-CSD-005** Where `--dry-run` is given, the CLI shall send only GET requests and print the actions
  it would take.
- **FR-CSD-006** For each company, the CLI shall match it by exact legal name; when matched, it shall
  set `short_name` only if the stored one is empty and report a different stored one; when not matched
  while PMO owns companies, it shall create it as type `Client`; when not matched while ERPNext owns
  companies, it shall report a problem (FR-CSD-004).
- **FR-CSD-007** For each project not matched (D8), the CLI shall create it with status `Leads` and the
  file's plain fields, and shall never send `status` other than `Leads`, `contract_value`, win artifacts
  or `pmo_project_number`.
- **FR-CSD-008** When a project row carries a contract value and the project's current value is 0, the
  CLI shall call `set_project_contract_value` with the file's tax fields before any stage move.
- **FR-CSD-009** The CLI shall move each project from its current stage to the file's stage by calling
  `transition_project` once per step of the fixed path (D5), passing `customer_contract_ref` and
  `contract_date` at the `Won, Pending KoM` step; while the current stage is not on the path, it shall
  make no write for that project and report it.
- **FR-CSD-010** When a project row carries budget lines, the CLI shall load them per D7.
- **FR-CSD-011** If the server refuses a write, then the CLI shall stop, print the actions done and the
  one that failed, and exit 1.
- **FR-CSD-012** The CLI shall print `{ dry_run, counts, actions }` on stdout; each project action
  carries the project id and PMO project number when known.
- **FR-CSD-013** While a REST request's token carries `client_id`, the database shall additionally allow
  the D4 Admin-tier endpoints only when the token's user is an active Admin, and `GET
  external_domain_ownership` to any such token; every other endpoint and method stays as in 0222.
- **FR-CSD-014** When `get`/`create`/`update`/`rpc` name a load-tier table or RPC, the CLI shall refuse
  before any request and point to `pmo load`.
- **NFR-CSD-001** Node 22 standard library only; no new dependency.
- **NFR-CSD-002** The CLI shall use only the owner's own session token; never a service-role key.
- **NFR-CSD-003** A re-run of a completed file shall make zero writes.
- **NFR-CSD-004** Each database read in the load shall be a filtered lookup, and a lookup returning
  1000 rows shall be treated as unprovable and refused.

## 6. Acceptance criteria (Given / When / Then)

- **AC-CSD-001** Given a signed-in Project Manager, or a disabled Admin, when they run `pmo load` with a
  valid file, then the CLI exits 2 saying it is for an active Admin, and no POST/PATCH is sent.
- **AC-CSD-002** Given a file with several problems (missing win artifacts, unknown field, bad stage,
  bad category, a 3-decimal amount, duplicate company, two identical budget lines), when `pmo load`
  runs, then every problem is listed by row, the exit code is 2, and no request is sent.
- **AC-CSD-003** Given an Admin and a valid file, when `pmo load --dry-run` runs, then only GET requests
  are sent and stdout lists the planned actions in execution order.
- **AC-CSD-004** Given companies already in PMO, when the load runs, then an existing company is matched
  by legal name and not re-created; an empty short name is filled; a different stored short name is
  reported and left; a missing company (PMO owns companies) is created as `Client` with its short name.
- **AC-CSD-005** Given ERPNext owns companies, when the file names a company PMO does not have, then the
  preflight reports it (naming the app and ERPNext routes), exits 2, and nothing is written.
- **AC-CSD-006** Given a new won project at `Ongoing Project`, when the load runs, then it is created as
  `Leads` (no value, no win artifacts in the insert), `set_project_contract_value` is called with the
  file's tax fields, then `transition_project` to `PQ Submitted`, `Quotation Submitted`, `Won, Pending
  KoM` (with contract ref and date) and `Ongoing Project`, in that order.
- **AC-CSD-007** Given a new bid at `Tender Submitted`, when the load runs, then it is created as
  `Leads`, its value is set, and it moves to `PQ Submitted`, `Quotation Submitted`, `Tender Submitted`
  with no win artifacts.
- **AC-CSD-008** Given a file that was fully loaded, when it is loaded again, then no write is made and
  every action is a skip.
- **AC-CSD-009** Given a matched project part-way along its path, when the load runs, then only the
  remaining steps are made; given one whose stage is off the path (e.g. `Loss Tender`), then nothing is
  written for it and it is reported `project.diverged`; given a different non-zero value, then the value
  is reported and left.
- **AC-CSD-010** Given budget lines, when the load runs, then: with no version, one Draft `Imported`
  version (batch stamps, no status, no activation) and its lines (app import key, no `actual_amount`)
  are created; with a Draft, its already-loaded keys are skipped and the rest attached to it; with an
  Active or Archived version, the budget is skipped; a `23505` on a line counts as skipped.
- **AC-CSD-011** Given the app's budget import, then the CLI's line key equals
  `computeBudgetLineImportKey` for the same cells, and the CLI's categories equal the generated
  `budget_category` enum.
- **AC-CSD-012** Given the server refuses the win step, when the load runs, then it stops there, exits 1,
  and the error carries the actions done and the failed one; no later write is sent.
- **AC-CSD-013** Given OAuth-client tokens, then an active Admin may POST the two RPCs and GET/POST the
  two budget tables; a Project Manager or a disabled Admin is refused (`42501`) on all of them; the
  Admin is still refused PATCH/DELETE on budget tables, `activate_budget_version` and
  `set_work_order_value`; any client may GET but not POST `external_domain_ownership`.
- **AC-CSD-014** Given the CLI and the latest guard migration, then the CLI's load-tier lists equal the
  migration's `admin_write_tables` / `admin_rpcs`, its read-only tables equal `read_only_tables`, and
  every step of every load path is legal in the latest `transition_project` map.
- **AC-CSD-015** Given an active Admin, when the exact call sequence of AC-CSD-006 runs in the database,
  then the project stands at `Ongoing Project` with its value, contract ref and date (`decided_at` = the
  contract date), and `project.create`, `project.contract_value.set` and four `project.transition` audit
  rows are attributed to that Admin.
- **AC-CSD-016** Given `pmo rpc transition_project` or `pmo create budget_versions`, then the CLI refuses
  before any request, saying only `pmo load` uses it.

## 7. Traceability

| AC | Owning layer | Owning test |
|---|---|---|
| AC-CSD-001 | CLI node test | `scripts/pmo.test.mjs` › AC-CSD-001 |
| AC-CSD-002 | CLI node test | `scripts/pmo-load.test.mjs` › AC-CSD-002 (no-request half: `scripts/pmo.test.mjs`) |
| AC-CSD-003 | CLI node test | `scripts/pmo.test.mjs` › AC-CSD-003 (planner half: `scripts/pmo-load.test.mjs`) |
| AC-CSD-004 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-005 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-006 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-007 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-008 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-009 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-010 | CLI node test | `scripts/pmo-load.test.mjs` |
| AC-CSD-011 | Unit (Vitest) | `pmo-portal/src/lib/import/__tests__/budgetLoadParity.test.ts` |
| AC-CSD-012 | CLI node test | `scripts/pmo-load.test.mjs` (exit code: `scripts/pmo.test.mjs`) |
| AC-CSD-013 | Integration (pgTAP) | `supabase/tests/api_client_seed_surface.test.sql` |
| AC-CSD-014 | CLI node test | `scripts/pmo.test.mjs` (lists), `scripts/pmo-load.test.mjs` (paths) |
| AC-CSD-015 | Integration (pgTAP) | `supabase/tests/client_starting_data_sequence.test.sql` |
| AC-CSD-016 | CLI node test | `scripts/pmo.test.mjs` |

No new e2e: the live pre-request wiring is already proven by the AC-CLI-001 journey; the Admin tier is a
pure function of request settings (pgTAP), and the RPC sequence is proven in the database (AC-CSD-015).

## 8. Rollout

`0234` reaches the hosted database only with the owner's per-instance production yes. Until then, a
hosted `pmo load` stops at its first read (`GET external_domain_ownership` → `42501`) and writes nothing.
