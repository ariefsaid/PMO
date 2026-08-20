# Blocked planning record — Issue #489: org lifecycle guard

**Status:** blocked; do not start implementation.

## Evidence reviewed

- `gh issue view 489`
- `docs/decisions.md`: `DD-ORG-3`, `DD-ORG-4`, and `DD-RIS-1`
- `supabase/migrations/0087_external_domain_ownership.sql` (Operator-only security-definer/RLS shape)
- `supabase/migrations/0190_profiles_org_id_immutable.sql` on `origin/dev` (the active worktree is behind it)
- `docs/environments.md` (the only documented reseed procedure)
- `bash scripts/check-migration-collisions.sh` (passes)

## Why a no-placeholder build plan cannot be written yet

1. **There is no Issue #489 specification or acceptance-criteria namespace.** `docs/specs/` has no lifecycle-marker spec and the request supplies no `FR-`/`AC-###` identifiers. The planner contract requires every behavior task and owning test to trace to an existing acceptance criterion; inventing IDs would invent the missing SDD artifact.

2. **The required production backfill cannot safely be expressed from this public checkout.** `DD-ORG-4` specifies the intended states, but this repo contains neither the deployment-local immutable IDs nor a stable, approved selector for the existing organizations. A migration matching display names would be an unsafe guess; a default would violate the explicit-state requirement. Those identifiers must not be added to public tracked docs. The owner/operator must provide an approved private execution mapping and a separately reviewed, one-time operational backfill procedure.

3. **There is no org-scoped reseed/wipe script to guard.** The only current destructive procedure is the unscoped `TRUNCATE ... CASCADE` SQL in `docs/environments.md`; it is table-wide and cannot become an org-scoped operation simply by calling `assert_org_destroyable(org_id)`. The repository has no authoritative inventory/ordering of all org-scoped business tables for a safe targeted wipe. Choosing dynamic catalog deletes, a static dependency-ordered delete list, or retirement of the procedure is an unresolved destructive-operation design decision.

4. **The creation dependency named by the issue is not shipped.** `operator_create_org` is recorded as “not yet shipped” in `docs/operator-runbook.md`; no such function exists on `origin/dev`. #489 therefore cannot change that function to stamp a creation state. The owner must sequence #484 before #489, or explicitly expand #489 to implement the missing creation RPC and its companion-creation contract.

5. **The worktree is stale.** Its `HEAD` stops at migration `0189`; `origin/dev` contains `0190_profiles_org_id_immutable.sql`. The requested migration number `0191` is correct only after synchronizing this branch with `origin/dev`. Do not author migrations or tests against the stale base.

## Required owner decisions before replanning

1. Sign off `docs/specs/org-lifecycle-guard.spec.md` with EARS requirements and uniquely named `AC-###` criteria for: explicit state values; default-deny authority; `NULL` and unknown-state polarity; Operator-only audited transitions; terminal `live`; non-blocking ordinary record deletion; script fail-fast behavior; and the exact mutation-test evidence.
2. Privately authorize the deployment-local backfill mapping for the existing protected and disposable organizations, including the execution authority and rollback/verification evidence. Do not put organization IDs in tracked files.
3. Select and document the future destructive command’s bounded interface and full data closure: (a) safe org-scoped wipe/reseed script with a fixed transactionally reviewed delete order, (b) a database-owned wholesale-operation RPC, or (c) remove the legacy whole-database reseed procedure and defer an org-scoped wipe. The selected approach must call the database assertion before any destructive statement and have an independent script-layer test.
4. Confirm #484 lands first (and stamps `lifecycle_state` explicitly during creation), or approve adding that otherwise out-of-scope creation RPC to this issue.

## Replanning entry conditions

- Rebase `feat/489-org-lifecycle-guard` onto the current `origin/dev` without changing source files, confirm `0190` is present, then rerun `bash scripts/check-migration-collisions.sh` before reserving `0191`.
- The owner decisions above and signed spec exist.
- Then produce the TDD-first implementation plan: pgTAP owns every database authority/ACL/polarity/audit/delete criterion; Node tests own the script fail-fast criterion; the plan records the two mandatory guard mutations and ends with `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` plus `cd pmo-portal && npm run verify:locked`.
