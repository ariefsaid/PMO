# Spec: Cost attribution follow-ups (#1362)

> **Status:** Draft — 2026-11-15. Follows [cost-attribution.spec.md](cost-attribution.spec.md) (#1271, shipped; its contract §3 stays the base).
> IDs: `FR-CAF-###`, `NFR-CAF-###`, `AC-CAF-###`. Ticket items 1–6 map to the sections below.
> Migration: `NNNN` (number on request). pgTAP: extend `supabase/tests/cost_attribution.test.sql`.
> Out of scope: timesheet-based splits, revenue, converting currencies (no FX table is introduced).

## 1. What exists today vs what is new

| Ticket item | Today | New |
|---|---|---|
| 1 Edit restates history | `save_cost_attribution_rule` with a `rule_key` inserts version + 1 that replaces the old one across its whole window; the screen's Edit gives no warning | A forward-only "Change from date" action; in-place edit stays for corrections and warns |
| 2 Silent tie | Equal-score overlap is refused at save only; at read time the lower `rule_key` wins | The list flags rules that tie today |
| 3 Tagged vs attributed | Tagged reads the latest snapshot; attributed reads the live ledger mirror; tagged shows 0 when only attributed cost exists | Both read one point in time; tagged stays unknown when there is no snapshot |
| 4 Currency | Not checked | A rule whose account currency differs from a target project's currency is refused |
| 5 Delete block | Targets use `on delete restrict`; old versions block project deletion forever | In-use block kept for current rules only; history stops blocking |
| 6 Finance dashboard | The snapshot table lists attributed lines as "Not attributed to a project" | Attributed cost shows under its project |

## 2. Requirements (EARS)

**Item 1 — forward-only change**
- FR-CAF-001 When a user changes a rule's targets or split from a chosen date, the system shall end the current rule on the day before that date and create a new rule starting on it, in one transaction. Cost posted before the date keeps its old allocation.
- FR-CAF-002 The chosen date shall be after the current rule's `effective_from` and not later than today plus 366 days; otherwise the change is refused (`22023`).
- FR-CAF-003 The change shall write one audit event (`cost_attribution.revise`) with before and after images, and carry the stale-version check (`40001`) of the existing save.
- FR-CAF-004 While a user edits a rule in place, the screen shall state that the change applies to its whole window, including months already reported, and name the forward-only action as the alternative.
- FR-CAF-005 Only active Admin and Finance members shall use the change (same guard and OAuth client rules as save).

**Item 2 — read-time conflicts**
- FR-CAF-010 `list_cost_attribution_rules` shall return, for each current rule, `conflicts` (a list of `{rule_key, name}`): current rules with equal score, overlapping windows and intersecting matches, evaluated against the account tree as it is now.
- FR-CAF-011 When a rule has conflicts, the list shall show a warning on its row naming the other rule(s) and that the lower rule key currently wins.
- FR-CAF-012 The allocation winner (score, then `rule_key`) shall not change.

**Item 3 — one point in time**
- FR-CAF-020 Attribution shall consider only ledger lines whose mirror `as_of` is not later than the generation time of the snapshot the project's tagged cost is read from. A line mirrored after that snapshot attributes at the next snapshot.
- FR-CAF-021 Where a project has attributed cost and no snapshot rows, `tagged_to_date` shall be null (unknown), `attributed_to_date` known, and `actuals_to_date` null, the same rule as an unknown tagged amount elsewhere.
- FR-CAF-022 With no rules, every existing field of `project_mapped_actuals`, `project_mapped_actuals_all`, `get_project_finances` and the dashboards shall be unchanged.

**Item 4 — currency**
- FR-CAF-030 When a rule is saved or previewed, the system shall refuse it (`22023`, naming the account and the project) if the matched account's `account_currency` differs from a target project's currency. For a group rule, every descendant expense account is checked.
- FR-CAF-031 Where `account_currency` is absent for an account, the check shall not refuse and the list shall mark the rule "currency unchecked".
- FR-CAF-032 The refusal shall not change tagged cost; its currency gap is recorded as known and out of scope here.

**Item 5 — project deletion**
- FR-CAF-040 When a project is the target of a current rule version, deleting it shall be refused as in use (`23503`) with the rule named.
- FR-CAF-041 When a project is the target only of non-current versions, deleting it shall succeed and those targets shall go with it; history for other targets stays readable with the project shown as removed.
- FR-CAF-042 Deleting a project inside a cascade shall not be blocked by rule targets.

**Item 6 — finance dashboard**
- FR-CAF-050 The finance dashboard's actuals table shall show attributed cost against its project, labelled attributed, and shall keep "Not attributed to a project" only for lines no rule places.
- FR-CAF-051 The dashboard's per-project total shall equal the project header's `actuals_to_date` for the same fiscal year.

**NFR**
- NFR-CAF-001 Org scope stays `auth_org_id()`; no new writable table and no client write path.
- NFR-CAF-002 `list_cost_attribution_rules` stays one call; the conflict check adds no per-row round trip and finishes in under 1 s on 100 rules (local, measured).

## 3. Contract changes

- New RPC `revise_cost_attribution_rule(p_rule jsonb, p_apply_from date)` → jsonb `{rule_key, version, id, ended_rule_key, changed}`. `p_rule` is the §3.2 rule JSON with `rule_key` and `expected_version` required; the result carries the new rule's key.
- `list_cost_attribution_rules` gains `conflicts jsonb` and `currency_checked boolean`.
- `project_mapped_actuals` / `_all`: columns unchanged; semantics per FR-CAF-020/021.
- Foreign key `cost_attribution_rule_targets.project_id`: `restrict` replaced by a guard that blocks only current versions (FR-CAF-040/042).

## 4. Acceptance criteria

| AC | Given / When / Then | Owner |
|---|---|---|
| AC-CAF-001 | Given a rule with attributed cost in May, when it is revised from 1 June, then May allocations are unchanged, June onward use the new split, and the old rule ends 31 May | pgTAP |
| AC-CAF-002 | Given a revise date on or before `effective_from`, or beyond 366 days, then it is refused `22023`; a stale version is refused `40001`; an Engineer is refused `42501` | pgTAP |
| AC-CAF-003 | Given a revise, then one `cost_attribution.revise` audit row carries before and after | pgTAP |
| AC-CAF-004 | Given the edit form, when opened on an existing rule, then the restate warning and the "Change from date" action are visible; the action sends the chosen date | Vitest |
| AC-CAF-005 | Given two equal-score group rules saved apart, when the chart re-parents so they intersect, then the list returns each in the other's `conflicts` and the lower key still wins the line | pgTAP |
| AC-CAF-006 | Given rules in conflict, when the list renders, then each row shows the warning naming the other rule | Vitest |
| AC-CAF-007 | Given a line mirrored after the latest snapshot, when actuals are read, then it is not yet attributed; after a newer snapshot it is | pgTAP |
| AC-CAF-008 | Given a line whose ERP project was removed after the snapshot, then it is counted once (tagged until the next snapshot, then attributed) | pgTAP |
| AC-CAF-009 | Given attributed cost and no snapshot rows, then `tagged_to_date` is null, `attributed_to_date` known, `actuals_to_date` null; with no rules all fields equal the pre-change output | pgTAP |
| AC-CAF-010 | Given an account in another currency than a target project, when saved or previewed, then `22023` names both; same currency saves | pgTAP |
| AC-CAF-011 | Given a group rule with one foreign-currency descendant, then it is refused naming that account | pgTAP |
| AC-CAF-012 | Given a project that is a target of a current rule, when deleted, then `23503` naming the rule; given only a historical target, then the delete succeeds | pgTAP |
| AC-CAF-013 | Given a delete inside a cascade from the org, then rule targets do not block it | pgTAP |
| AC-CAF-014 | Given attributed cost on project P, when the finance dashboard loads, then P's row shows it labelled attributed and the P total equals the project header | Vitest + pgTAP (total) |
| AC-CAF-015 | Given unmatched lines, then they still show "Not attributed to a project" | Vitest |
