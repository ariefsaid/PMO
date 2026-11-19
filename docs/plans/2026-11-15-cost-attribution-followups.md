# Cost attribution follow-ups — implementation plan (#1362)

Spec: [cost-attribution-followups.spec.md](../specs/cost-attribution-followups.spec.md). Base: migration 0376 and its later helper fixes (0720, 0794). **No build has started.** Money-adjacent (actuals semantics): Director-dispatched per issue through an Orca worker; one DB migration, number on request (`NNNN`; renumber with `scripts/renumber-migration.sh`, rollback in `supabase/migrations/rollback/NNNN_cost_attribution_followups_down.sql`).

Local final gate for every task: `cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched files>` plus the named tests. DB tasks run under `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/cost_attribution.test.sql'`.

## Design decisions
1. **Forward-only change = a new rule under a new key**, not a second current row per key. `revise` closes the old rule at `apply_from − 1` and creates the successor in one transaction, so the one-current-row-per-key index and the allocation query stay untouched. In-place edit remains for corrections, with a warning.
2. **Conflicts are computed in the list function** by reusing the predicate of `cost_attribution_assert_no_conflict` (0376 line 176) minus the "exclude the saved key" step, evaluated pairwise over current rules. Allocation is unchanged.
3. **One point in time**: attribution is cut at the snapshot generation time already selected inside `project_mapped_actuals` (0376 `generation` CTE). Lines mirrored later wait one snapshot.
4. **Currency** uses `erp_account_mirror.account_currency` against `projects.currency`; no conversion.
5. **Delete**: replace FK `restrict` with `on delete cascade` for historical targets plus a `before delete` trigger on `projects` that raises `23503` only when a current-version target exists (also inside cascades, as the trigger checks `is_current`, FR-CAF-042 is satisfied by the trigger not the FK).

## Tasks

### Task 1 — prove the unknowns (AC-CAF-007, 008)
1.1 In `supabase/tests/cost_attribution.test.sql` add failing cases: line `as_of` after snapshot generation is excluded; project removed after snapshot counts once. Run the pgTAP command above; expect red.
1.2 Read the GL mirror upsert in `supabase/functions/` (`grep -rn "erp_gl_entry_mirror" supabase/functions`) and record in the PR whether `as_of` is refreshed on every update. If it is not, the migration must set it (a trigger `before update` stamping `now()` when `erp_modified` changes); add that to Task 4.

### Task 2 — revise RPC (AC-CAF-001..003)
2.1 Failing pgTAP: revise from 1 June leaves May allocations equal, old rule's `effective_to` is 31 May, audit row `cost_attribution.revise` exists, bad dates `22023`, stale `40001`, Engineer `42501`.
2.2 Migration `NNNN`: `revise_cost_attribution_rule(p_rule jsonb, p_apply_from date)` as `security definer`, `set search_path = public, pg_temp`, same advisory lock key as `cost_attribution_write`. Body: validate date window, lock and check version as in 0376 lines 341–389, call the end logic with `p_apply_from - 1`, call `cost_attribution_write(p_rule - 'rule_key' - 'expected_version' || jsonb_build_object('effective_from', p_apply_from), 'create', true)`, audit `revise`. `revoke all … from public, anon, authenticated; grant execute … to authenticated`; add to `api_client_request_guard` with save's roles.
2.3 Run the gate; green.

### Task 3 — conflicts on the list (AC-CAF-005)
3.1 Failing pgTAP: two equal-score group rules saved apart, then `erp_account_mirror` re-parented (update `lft`/`rgt`), list returns mutual `conflicts`; allocation winner unchanged.
3.2 Migration: drop and recreate `list_cost_attribution_rules` with `conflicts jsonb`, `currency_checked boolean`; factor the overlap predicate into `cost_attribution_conflicts(p_org_id)` returning `(rule_key, other_key, other_name)`, used by both the list and `cost_attribution_assert_no_conflict`.

### Task 4 — snapshot cut and unknown tagged (AC-CAF-007..009)
4.1 Migration: in `project_mapped_actuals` and `project_mapped_actuals_all` add `and g.as_of <= (select generated_at from generation)` to the attributed lines; make `tagged_to_date` null when the generation has no rows and attributed is present. Read the current bodies at head first (`grep -ln "project_mapped_actuals" supabase/migrations`, latest wins); copy, do not rewrite from 0376. Include the `as_of` stamp from Task 1.2 if needed.
4.2 Run the Task 1 and AC-CAF-009 cases; green. The no-rules parity case from 0376 must stay green.

### Task 5 — currency (AC-CAF-010, 011)
5.1 Failing pgTAP: account currency ≠ project currency refused `22023` on save and preview; group with one foreign descendant refused naming it; missing currency not refused.
5.2 Migration: add the check inside `cost_attribution_normalize` (0376 line 91) after targets resolve, joining `erp_account_mirror` (and descendants via `lft`/`rgt` for groups).

### Task 6 — project delete (AC-CAF-012, 013)
6.1 Failing pgTAP: current-rule target → `23503` naming the rule; historical-only → delete succeeds; org cascade not blocked.
6.2 Migration: change the targets FK to `on delete cascade` and add `before delete on projects` trigger raising `23503` when a current target exists. Rollback restores `restrict`.

### Task 7 — screen (AC-CAF-004, 006, 015)
7.1 Failing Vitest in `pmo-portal/pages/admin/CostAttribution.test.tsx`: conflict warning row; edit form shows restate warning and "Change from date"; the action calls `reviseCostAttributionRule` with the date.
7.2 Add `reviseCostAttributionRule` and the `conflicts` field to `pmo-portal/src/lib/repositories/costAttribution.ts`; regenerate types the repo's usual way; edit `CostAttribution.tsx` and `CostAttributionRuleForm.tsx` using `useEntityForm` primitives and i18n keys under `costAttribution:`. Run `cd pmo-portal && npx vitest run pages/admin/CostAttribution.test.tsx src/lib/repositories/costAttribution.test.ts`; then `scripts/ux-proof.sh` on the admin route.

### Task 8 — finance dashboard (AC-CAF-014, 015)
8.1 Failing Vitest in the `AccountingSnapshotsSection` tests: attributed row under its project; unmatched stays unattributed; plus pgTAP total equals project header.
8.2 Locate the snapshot table's source (`grep -rn "ErpActualsSnapshotRow" pmo-portal/src`), join attributed allocations by project, update `AccountingSnapshotsSection.tsx` (line 141 area). Run its test file.

### Task 9 — rollback and docs
9.1 Write the rollback file; `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/cost_attribution.test.sql'` green. Update `docs/specs/cost-attribution.spec.md` §3 with the new columns and RPC.

## Traceability (ADR-0010)

| AC | Layer | Test |
|---|---|---|
| AC-CAF-001,002,003 | pgTAP | `cost_attribution.test.sql` revise cases |
| AC-CAF-004 | Vitest | `CostAttribution.test.tsx` |
| AC-CAF-005 | pgTAP | conflicts after chart change (the ticket's test gap) |
| AC-CAF-006 | Vitest | `CostAttribution.test.tsx` |
| AC-CAF-007,008,009 | pgTAP | snapshot-cut and unknown-tagged cases |
| AC-CAF-010,011 | pgTAP | currency cases |
| AC-CAF-012,013 | pgTAP | delete cases |
| AC-CAF-014 | Vitest + pgTAP | dashboard row; total parity |
| AC-CAF-015 | Vitest | dashboard unmatched row |

No e2e: no AC is a cross-stack journey beyond what these layers own.

## Owner questions
1. Make "Change from date" the primary action and keep in-place edit only behind a restate warning? Recommend yes.
2. Accept that a line mirrored after a snapshot is attributed one snapshot later, for a single consistent cut? Recommend yes.
3. Refuse a rule on currency mismatch rather than warn? Recommend refuse; a warning leaves wrong money in reports.
