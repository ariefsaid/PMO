# Budget push on ERPNext v16 — one ERP Budget per account (#1033)

**Status:** signed (owner, 2026-10-15) · **Tier:** money path (Director-dispatched) · **Ruling:** `DD-OPS-12`
**Extends:** `erpnext-adapter-p3c-budget.spec.md` (FR-BUD-1xx), `budget-fiscal-year-phasing.spec.md` (FR-BFY-0xx),
`budget-account-map-multi.spec.md` (FR-BAM-0xx). Everything those specs say still holds on v15; this spec only
adds the v16 shape.

## Job story

When Finance activates a project budget for an org whose ERPNext is v16, I want each budgeted account to land in
ERPNext as its own Budget, so that ERPNext's overspend controls work per account exactly as they do on v15 — and a
revision changes only the accounts that changed.

## What ERPNext v16 does (verified 2026-10-15 on a v16.33 copy site, rolled back)

- A Budget carries ONE `account` + `budget_amount` in its header; there is no `accounts[]` table.
- `fiscal_year` is gone: `from_fiscal_year` + `to_fiscal_year` are required. `budget_start_date`/`budget_end_date`
  fill from them.
- `distribution_frequency` (required, default `Monthly`) + `distribute_equally` (default 1) produce a
  12-row `budget_distribution` automatically.
- ERPNext refuses a second live Budget for the same project + account + overlapping years (`DuplicateBudgetError`).
- Cancel + amend (`amended_from`) still works, so FR-BUD-121's revision-by-amend carries over per document.
- A list call naming `fiscal_year` is rejected (the field does not exist).

## Requirements (EARS)

- **FR-BV16-001 (shape by version)** — Where the org's ERP binding has `version_major = 16`, the budget push shall
  build v16 bodies; where it has 15, it shall build today's v15 body unchanged. The major is read from the binding
  at push time (`external_org_bindings.version_major`), never inferred.
- **FR-BV16-002 (one body per account)** — For each fiscal year of an activated version, the v16 push shall emit
  one Budget per ERP account with a non-zero amount: `{company, budget_against: 'Project', project, account,
  budget_amount, from_fiscal_year: <year>, to_fiscal_year: <year>, distribution_frequency: 'Monthly',
  distribute_equally: 1}` plus every `action_if_*` / `applicable_on_*` field FR-BUD-131 sends today. It shall send
  no `accounts` and no `fiscal_year`.
- **FR-BV16-003 (one account, one category)** — The account map already guarantees one category per ERP account
  (`unique (org_id, erp_account)`, FR-BAM-001/DD-BAM-2), so each non-zero category yields its own account's Budget.
  If two non-zero categories ever resolve to the same account (a regressed reader), the v16 push shall refuse with
  `commit-rejected` naming the account — never sum, never let one row win (same posture as FR-BAM-007).
  *(Amended 2026-10-15, Director: the signed draft asked to sum shared accounts; the map makes that state
  impossible, so the requirement is narrowed to the defensive refusal.)*
- **FR-BV16-004 (identity + idempotency)** — Each v16 Budget shall have its own PMO identity
  `<version>:<year>:<account>` and its own idempotency key, so a replayed push creates nothing new and one
  account's failure never blocks or duplicates another's.
- **FR-BV16-005 (grain probe)** — Before creating, the v16 push shall look for a live Budget on (company, project,
  account, year) using `from_fiscal_year`; the FR-BFY-076 refusals (two or more live, a draft, a live doc PMO does
  not own) apply per account unchanged.
- **FR-BV16-006 (revision)** — When a newer version of the same project-year is activated, the v16 push shall, per
  account: amend the account's Budget when its amount changed; do nothing when unchanged; create one for a newly
  budgeted account; and cancel the PMO-owned Budget of an account no longer budgeted (amount now zero or category
  removed), so no stale control keeps limiting spend.
- **FR-BV16-007 (mirror + status)** — PMO shall keep one mirror row per (version, year, account) on v16 (v15 keeps
  one per (version, year)). The per-year push status Finance sees shall be the worst state among that year's
  accounts (failed > pending > pushed), with the failing account named.
- **FR-BV16-008 (inbound)** — The sweep shall track each v16 Budget's lifecycle (Desk cancel, amend) per account
  under the existing rules (never adopt a Desk-created Budget, never fight a Desk cancel, no amounts flow back —
  FR-BUD-140/142/152), and shall never request `fiscal_year` from a v16 site.
- **NFR-BV16-001** — Every existing v15 budget test stays green unchanged (the local dev bed is v15).

## Acceptance criteria

- **AC-BV16-001** *(unit)* — Given a v16 binding and a 2026 version with Labor → Salary 50,000 and Materials → COGS
  25,000, when the body builder runs, then it returns two bodies with the FR-BV16-002 fields, years 2026/2026, and
  no `accounts`/`fiscal_year` keys.
- **AC-BV16-002** *(unit)* — Given a v15 binding and the same version, when the body builder runs, then the body is
  byte-identical to today's.
- **AC-BV16-003** *(unit)* — Given a v16 binding and a (synthetic) map where Labor and Overtime both resolve to
  Salary, when the body builder runs, then it throws `commit-rejected` naming Salary and builds no body.
- **AC-BV16-004** *(unit/served)* — Given a v16 activation with two accounts, when the push runs twice, then two
  ERP creates happen once each, under distinct identities and keys, and the replay is a no-op.
- **AC-BV16-005** *(unit)* — Given a revision where Salary 50,000→60,000, COGS unchanged, Equipment added and
  Travel dropped, then Salary is amended, COGS untouched, Equipment created, Travel's Budget cancelled.
- **AC-BV16-006** *(pgTAP)* — Given two accounts for one version-year on v16, when one push fails, then two mirror
  rows exist and the year's status reads failed, naming that account; v15 rows keep their existing key.
- **AC-BV16-007** *(unit)* — Given a v16 org, when the sweep builds its Budget list call, then `fiscal_year` is not
  requested.
- **AC-BV16-008** *(live, rehearsal site only)* — Given the RIS rehearsal copy (v16.33), when a version is activated
  through the real dispatch path, then one submitted Budget per account exists with the right amounts, and a
  revision amends only the changed account. Evidence recorded in the PR; never run against a live client site.

## Out of scope

- v16's native "Revise Budget" (`revise_budget`, `revision_of`) — cancel + amend is enough and matches v15.
- Custom monthly distribution (equal monthly is today's v15 behaviour).
- Moving the local dev bed to v16 (a chore; the rehearsal site is the v16 proof for now).
