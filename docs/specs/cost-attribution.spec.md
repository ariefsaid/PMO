# Spec: Cost attribution rules (#1271)

> **Status:** Draft — 2026-10-24. Owner-decided ACs: issue #1271, last comment (owner go 2026-10-24).
> IDs: `FR-CAT-###`, `NFR-CAT-###`, `AC-CAT-###`. Issue ACs map as `AC-1..AC-7` below.
> Migration `0376_cost_attribution.sql` (+ rollback). pgTAP: `supabase/tests/cost_attribution.test.sql`.
> Out of scope: timesheet-based splits (they replace a rule later), revenue (#1008).

## 1. Context

Project cost actuals come from mirrored ERP ledger lines (`erp_gl_entry_mirror`) that carry an ERP project,
summed into `erp_actuals_snapshot` per (project, cost centre, account, fiscal year) and read through
`project_mapped_actuals` (0290) by account → budget category (`budget_category_account_map`). Lines with no
ERP project (payroll, overhead) reach no project. A cost attribution rule assigns those lines to projects,
read-side only: PMO never writes to ERPNext or to any mirror/snapshot table.

## 2. Requirements (EARS)

**AC-1 Rule**
- FR-CAT-001 The system shall hold per-org cost attribution rules, each with one match and one target.
- FR-CAT-002 A rule's match shall name exactly one of: an ERP account, or an ERP account group (every
  descendant account of the group in the org's account mirror, same company).
- FR-CAT-003 Where a rule names a cost centre and/or a party (optionally a party type), the system shall match
  only lines carrying that cost centre / party.
- FR-CAT-004 A rule shall match only ledger lines with no ERP project (`coalesce(project,'') = ''`), not
  cancelled, with a posting date.
- FR-CAT-005 A rule's target shall be one or more distinct projects of the org with percentages in (0, 100],
  at most 4 decimals, summing to exactly 100. One project at 100 is the single-project case.
- FR-CAT-006 The system shall never write to ERPNext, `erp_gl_entry_mirror` or `erp_actuals_snapshot` for a rule.

**AC-2 Effective dating, versions, audit**
- FR-CAT-010 Each rule shall have `effective_from` (required) and `effective_to` (optional, inclusive), compared
  against the line's posting date. `effective_to = effective_from − 1 day` is allowed and means "never applies"
  (how a mistaken rule is voided).
- FR-CAT-011 When a rule is edited or ended, the system shall insert a new version (version + 1) under the same
  stable `rule_key` and mark the previous version not current. Past versions stay readable.
- FR-CAT-012 When a save names a `rule_key`, it shall carry `expected_version`; when that is not the current
  version, the save shall be refused (`40001`).
- FR-CAT-013 Every create / edit / end shall write one `audit_events` row (`cost_attribution.create|update|end`)
  with actor, time, and `before` / `after` rule images. A save identical to the current version writes nothing.

**AC-3 Counts in budget vs actual**
- FR-CAT-020 Attributed cost shall reach a project's actuals through the same account → category map as tagged
  cost (a payroll account mapped to Labor lands in Labor).
- FR-CAT-021 `project_mapped_actuals.actuals_to_date` (and everything built on it: project header, budget vs
  actual, dashboards) shall be tagged + attributed; new fields `tagged_to_date` and `attributed_to_date` state
  the split. With no rules, every existing field is byte-identical to before.
- FR-CAT-022 Each line's allocation shall be rounded to cents per target, the last target taking the remainder,
  so a line's allocations sum exactly to the line.

**AC-4 No double count**
- FR-CAT-030 A line that carries an ERP project shall never be attributed.
- FR-CAT-031 When a line matches several current rules, it shall go only to the most specific one.
  Specificity score = 10 × (number of narrowing fields set: cost centre, party) + (2 for account, 1 for group).
- FR-CAT-032 When a save would leave two current rules with equal score, overlapping windows and intersecting
  matches (same account, or nested/equal groups, and each narrowing field null on one side or equal), the save
  shall be refused (`23505`, "conflicts with rule <name>"). Read time still picks one rule per line
  (score, then `rule_key`) so no line is ever counted twice.

**AC-5 Access**
- FR-CAT-040 Only active Admin and Finance members shall save, end or preview rules (security-definer RPCs).
- FR-CAT-041 Rules shall be readable by active Admin, Finance, Executive and Project Manager members of the same
  org (the `get_project_finances` audience). Engineers and other orgs read nothing / are refused.
- FR-CAT-042 Clients shall have no direct INSERT/UPDATE/DELETE on the rule tables.

**AC-6 Preview**
- FR-CAT-050 When a draft rule is previewed, the system shall return amount per project, per month (posting
  month), per category, computed by the same allocation code the saved rule will use, with the same validation
  and conflict refusal as save.

**AC-7 Screen / CLI** (built by the UI and CLI lanes against §3)
- FR-CAT-060 Admin → Accounting setup → Cost attribution lists current rules (match, target, dates, version) with
  add, edit and end. CLI: `pmo attribution preview <file>`, `pmo attribution set <file> [--dry-run]`,
  `pmo attribution list`.

**NFR**
- NFR-CAT-001 Org scope comes from the JWT (`auth_org_id()`), never an argument.
- NFR-CAT-002 Read cost: one partial index on unprojected ledger lines by (org, account, posting date).

## 3. Contract (stable — UI and CLI build against this)

### 3.1 Tables

`cost_attribution_rules` — one row per version.

| column | type | notes |
|---|---|---|
| id | uuid pk | the version's id |
| org_id | uuid | default `auth_org_id()` |
| rule_key | uuid | stable across versions |
| version | int | 1, 2, … ; unique (org_id, rule_key, version) |
| is_current | bool | exactly one current row per rule_key |
| name | text | 1–120 chars |
| match_account | text null | exactly one of account / account_group |
| match_account_group | text null | |
| match_cost_center | text null | |
| match_party_type | text null | only with match_party |
| match_party | text null | |
| effective_from | date | |
| effective_to | date null | inclusive; ≥ effective_from − 1 |
| specificity | int | FR-CAT-031 score, derived |
| created_by | uuid | actor of this version |
| created_at | timestamptz | |

`cost_attribution_rule_targets` — (rule_id → `cost_attribution_rules.id`, org_id, position smallint,
project_id → projects, percent numeric(7,4)); pk (rule_id, position); unique (rule_id, project_id).

### 3.2 Rule JSON (input to preview and save)

```json
{
  "rule_key": null,            // null = new rule; uuid = new version of that rule
  "expected_version": null,    // required when rule_key is set
  "name": "Engineer payroll to anchor project",
  "account": "Salary - RIS",   // or "account_group": "Payroll Expenses - RIS"
  "cost_center": null, "party_type": null, "party": null,
  "effective_from": "2025-01-01", "effective_to": null,
  "targets": [{"project_id": "…uuid…", "percent": 100}]
}
```

### 3.3 RPCs

| RPC | returns | who |
|---|---|---|
| `preview_cost_attribution(p_rule jsonb)` | table(`project_id uuid, month date, category budget_category, amount numeric, line_count int`) — `category` null = account not mapped to any budget category (will not show in actuals) | Admin, Finance |
| `save_cost_attribution_rule(p_rule jsonb)` | jsonb `{rule_key, version, id, changed}` | Admin, Finance |
| `end_cost_attribution_rule(p_rule_key uuid, p_effective_to date, p_expected_version int)` | jsonb `{rule_key, version, id, changed}` | Admin, Finance |
| `list_cost_attribution_rules(p_include_history boolean default false)` | table(`id, rule_key, version, is_current, name, match_account, match_account_group, match_cost_center, match_party_type, match_party, effective_from, effective_to, specificity, targets jsonb, created_by, created_at`) — `targets` = `[{project_id, project_name, percent}]` by position | Admin, Finance, Executive, PM |

Errors: `42501` not authorized; `22023` invalid rule (message names the field); `P0002` rule/project/account
not found; `23505` conflicting rule; `40001` stale `expected_version`.

All four are on the OAuth API-client guard for active Admin/Finance (list: + Executive, PM).

### 3.4 Actuals result

`project_mapped_actuals(p_project_id, p_fiscal_year)` gains two columns (existing six unchanged in name/order):

- `tagged_to_date numeric` — the former `actuals_to_date` (snapshot, ERP-project-tagged lines).
- `attributed_to_date numeric` — rule-attributed lines in that category / fiscal year.
- `actuals_to_date` = tagged + attributed (null if either is unknown, same null rules as before);
  `source_sum`, `has_rows`, `actuals_as_of` include attributed lines.

`get_project_finances(p_project_id)` → `actuals` gains `tagged_total`, `attributed_total` (text, same null rule
as `total`), and each `categories[]` item gains `tagged_amount`, `attributed_amount`. `total` / `amount` are
tagged + attributed. `get_budget_projection` is unchanged in shape and counts attributed cost through
`project_mapped_actuals`.

## 4. Acceptance criteria (Given/When/Then)

| AC | Issue | Given / When / Then | Owner |
|---|---|---|---|
| AC-CAT-001 | AC-1 | Given an untagged line on account A, when a rule A → P(100) is saved, then P's attributed cost includes the line and no row is written to any mirror/snapshot table | pgTAP |
| AC-CAT-002 | AC-1 | Given a group rule G, when a line posts to a descendant account of G, then it is attributed; a line on an account outside G is not | pgTAP |
| AC-CAT-003 | AC-1 | Given targets 60/40, when saved, then each line splits 60/40 to the cent and sums to the line; targets summing to ≠ 100 are refused | pgTAP |
| AC-CAT-004 | AC-2 | Given effective_from/to, when lines fall before, inside and after, then only inside lines are attributed | pgTAP |
| AC-CAT-005 | AC-2 | Given rule v1, when edited, then v2 is current, v1 readable in history, and an audit row has before/after; a stale expected_version is refused | pgTAP |
| AC-CAT-006 | AC-3 | Given account A mapped to Labor, when attributed, then `project_mapped_actuals` Labor shows `attributed_to_date`, `tagged_to_date` unchanged, `actuals_to_date` = sum; `get_project_finances` shows the split | pgTAP |
| AC-CAT-007 | AC-4 | Given a line tagged to an ERP project, when a rule matches its account, then it is never attributed | pgTAP |
| AC-CAT-008 | AC-4 | Given an account rule and a cost-centre-narrowed rule on the same account, when a line has that cost centre, then only the narrowed rule takes it; account beats group | pgTAP |
| AC-CAT-009 | AC-4 | Given a current rule, when a second rule of equal specificity with overlapping window and match is saved, then it is refused | pgTAP |
| AC-CAT-010 | AC-4 | Given tagged snapshot rows and rules, then company-wide tagged + attributed ≤ ledger total for the matched accounts | pgTAP |
| AC-CAT-011 | AC-5 | Finance/Admin save; Executive/PM read but cannot save; Engineer refused both; other org sees none and cannot target a foreign project; no direct table writes | pgTAP |
| AC-CAT-012 | AC-6 | Given a draft, when previewed then saved, then preview rows equal the saved rule's allocations per project and month | pgTAP |
| AC-CAT-013 | AC-5 | OAuth API client: Finance/Admin may call preview/save/end/list; an Engineer client is refused | pgTAP |
| AC-CAT-014 | AC-7 | Screen lists/adds/edits/ends rules | UI lane (Vitest/RTL) |
| AC-CAT-015 | AC-6/7 | CLI preview / set --dry-run / list | CLI lane (Vitest) |
