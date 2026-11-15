# Spec: correct records the data loader created, from the CLI (issue #1858)

> **Status:** Draft — 2026-11-15. Builds on [`client-starting-data-cli.spec.md`](client-starting-data-cli.spec.md) (`pmo load`, #796)
> and [ADR-0074](../adr/0074-api-client-admin-load-tier.md). Runbook: `docs/runbooks/pmo-cli.md` §11.
> **Decisions:** the loader never overwrites (it reports a conflict); a correction is a separate, explicit, previewed act.

## 1. Job story

When a value I loaded for a client turns out wrong, I want to fix that one value from the command line, see the
before and after first, and have the database refuse what the app would refuse, so I never delete and reload
or leave the fix to a screen an agent cannot drive.

## 2. Scope

Smallest useful set: what `pmo load` writes **and** what the app lets a user edit today (the same plain table
updates, same column grants, same row-level security; no new write path).

| Command | Record (loader key) | Fields | App screen it mirrors |
|---|---|---|---|
| `pmo correct project` | project: `--code`, or `--name` + `--client` | `name`, `short_name`, `start_date`, `end_date`, `project_manager_id`, `service_line`, `sector`, `location`, `award_type`, `bidding_entity` | Project header → Edit |
| `pmo correct contract-line` | contract line: project + `--key` (its `import_key`) | `description`, `unit`, `quantity`, `rate`, `basis` | Project → Contract & billing |
| `pmo correct budget-line` | budget line: project + `--line` (the row exactly as in the load file) | `budgeted_amount`, `description` | Project → Budget (Draft lines) |

Out of scope, refused with the app's own pointer: project `code`, `client`, `end_client`, `currency`, `stage`/`status`,
`contract_value` and tax (moved only by the app's guarded RPCs), `archived_at`, a budget line's `category`,
`fiscal_year`, `actual_amount` and import identity, a contract line's `key` and `item_code`, companies (use **Companies**), and every delete.

## 3. Requirements (EARS)

- **FR-CLICOR-001** The CLI shall provide `pmo correct project|contract-line|budget-line`; each requires an active Admin
  (the same tier as `pmo load`) and takes `--set <field>=<value>` one or more times.
- **FR-CLICOR-002** When `--dry-run` is given, the command shall read the target and print, per field, `current → new`,
  and send no write.
- **FR-CLICOR-003** The command shall resolve its target by the loader's key only; when zero or more than one record
  matches it shall stop with exit 2 and write nothing.
- **FR-CLICOR-004** The command shall validate every value with the loader's own rules (same limits, decimals, dates,
  basis list; a lump-sum line keeps quantity 1) before any request, and refuse a field outside §2's table naming where to change it.
- **FR-CLICOR-005** When the new value equals the current one, the field shall be reported `unchanged` and not sent;
  when every field is unchanged the command writes nothing and exits 0.
- **FR-CLICOR-006** The write shall be one update by record id through the app's own table update (`projects`, `boq_items`,
  `budget_line_items`) under the signed-in user's token, carrying only the named fields. The database stays the authority:
  its refusal (row security, trigger, column grant) is shown with its own message and exit 1.
- **FR-CLICOR-007** When the update changes no row (hidden by row security, or gone), the command shall fail with
  `no_rows` instead of reporting success.
- **FR-CLICOR-008** A budget line shall be corrected only while its version is a Draft per-year version; otherwise the
  command shall refuse with the app's reason (`line-items can only change while the owning version is Draft`) before writing.
- **FR-CLICOR-009** A correction shall not change a record's import identity. After it, re-running the original load file
  with `--dry-run` shall still report the record as already loaded, never as new. (Contract-line keys are value-free; a budget line keeps
  its original import key, so the *original* row stays its address; the corrected value is not put back into the load file.)
- **FR-CLICOR-010** The command shall print what it did: the record's id, each field's before and after, and the `--dry-run` hint
  when it was not a preview.

## 4. Acceptance criteria

- **AC-CLICOR-001** *Given* a project loaded with a wrong `end_date`, *When* an Admin runs `pmo correct project --code C-1 --set end_date=2026-12-31 --dry-run`,
  *Then* it prints `end_date: 2026-06-30 → 2026-12-31`, sends no write, and exits 0.
- **AC-CLICOR-002** *Given* that preview, *When* the same command runs without `--dry-run`, *Then* exactly one project update is sent, by id, carrying only `end_date`.
- **AC-CLICOR-003** *Given* a project that is addressed by `--name` + `--client` and two projects match, *When* the command runs, *Then* it exits 2 naming the ambiguity and sends no write.
- **AC-CLICOR-004** *Given* `--set contract_value=1`, `--set status=Won`, `--set code=X`, `--set currency=USD` or `--set archived_at=…`, *When* any correct command runs, *Then* it exits 2 before any request, naming where the app changes it.
- **AC-CLICOR-005** *Given* an invalid value (`end_date=31/12/2026`, `rate=1.234`, `quantity=0`, `basis=weekly`), *Then* the command exits 2 listing every problem, with no request sent.
- **AC-CLICOR-006** *Given* a contract line `L-10` of unit `m` and a correction `--set basis=lump_sum`, *When* the line's quantity is not 1, *Then* the command refuses (a lump-sum line must have quantity 1) before writing; with `--set basis=lump_sum --set quantity=1` it succeeds.
- **AC-CLICOR-007** *Given* a contract line, *When* `--set rate=1500.50 --set description="…"` runs, *Then* one `boq_items` update by id carries `rate` and `description` only; `basis` is sent as `earning_basis`.
- **AC-CLICOR-008** *Given* a budget line identified by its load row, *When* `--set budgeted_amount=1200` runs against a Draft version, *Then* one `budget_line_items` update by id carries `budgeted_amount` only; `actual_amount`, `category`, `fiscal_year` and the import columns are never sent.
- **AC-CLICOR-009** *Given* the project's budget version is Active or Archived, *When* a budget-line correction runs, *Then* it refuses with the app's reason and sends no write.
- **AC-CLICOR-010** *Given* the budget row matches no line (or its key matches two), *Then* the command exits 2 and writes nothing.
- **AC-CLICOR-011** *Given* the signed-in user is not an active Admin, *When* any correct command runs, *Then* it exits 2 (`pmo correct is for an active Admin`) before any read of the target.
- **AC-CLICOR-012** *Given* the update returns no row (row security hid it), *Then* the command fails `no_rows`, exit 1.
- **AC-CLICOR-013** *Given* a new value equal to the current one, *Then* the field shows `unchanged`, no request is sent, exit 0.
- **AC-CLICOR-014** *Given* a corrected contract line or budget line, *When* the original load file is re-run with `--dry-run`, *Then* the line is reported as already loaded (skip), not created.
- **AC-CLICOR-015** *Given* an API-client token, *Then* the database guard allows `PATCH` on `boq_items` and `budget_line_items` for an active Admin only (pgTAP; every other role, method and table stays refused).

## 5. Non-goals

No delete, no bulk "apply this file of corrections" (one record per command; a later file mode can reuse the same functions),
no way to change stage, contract value, currency or tax, no correction of companies, no creating a missing record.

## 6. Design

- `scripts/lib/pmo-correct.mjs` (new, Node standard library only): `parseSets`, `validateSets` (reuses the loader's validators),
  `resolveTarget` (reads only), `planCorrection` → `{ id, table, changes[], unchanged[] }`, `applyCorrection`. It takes the
  loader's `api` object (`get`, `patch`), so tests drive it with a fake.
- `scripts/pmo.mjs` wires one `correct` command (a few lines) and `--help`.
- Database: the only gap is the API-client guard, which allows `GET`/`POST` on the Admin load tables but not `PATCH`; the
  app already holds the column grants. A migration that replaces `api_client_request_guard()` adds `PATCH` on those two tables for
  an active Admin; no new function, no grant change.
