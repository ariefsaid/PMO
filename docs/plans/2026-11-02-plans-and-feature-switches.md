# Plans and Feature Switches Implementation Plan

> **For agentic workers:** Use the supervised Orca executor and test-driven development. Execute slices in order; slices 1–3 are auth-tier changes and ship alone.

**Goal:** Give each organisation an Operator-assigned plan, enforce its switches and limits, and keep existing behaviour through migration.

**Architecture:** A database resolver owns the global → override → plan precedence. Caller-scoped RPC projections serve the UI and assistant; privileged jobs use a separately authorized server-only entry point to the same resolver. A data migration contains the catalogue and plan matrix. Keep deployment-availability gates independent of entitlement, and retain the Admin feedback control.

**Tech stack:** PostgreSQL/RLS/pgTAP, React/TypeScript/Vitest, Deno, Playwright, PostHog.

**Spec:** `docs/specs/plans-and-feature-switches.spec.md` (D1–D15); map #1718.

**Scope:** S1 is detailed below. S2–S6 are outlines; each requires a separate detailed plan before implementation, per Director ruling.

## Constraints and review focus

- No billing or prices; core features remain on; off retains data. All new SQL has rollback files, RLS, an org seam, fixed search paths and explicit grants.
- Preserve both layers of current behaviour: `org_has_feature` defaults absent rows to true (`supabase/migrations/0070_org_features.sql:54`); FE absent rows use environment and revenue ownership (`pmo-portal/src/auth/useFeature.tsx:24`, `pmo-portal/src/hooks/useOrgFeatures.ts:29`). Environment capability gates remain ANDed with entitlement and cannot grant an entitlement. Capture before/after results in migration tests, including absent and explicit rows and both revenue ownership modes, subject to the revenue exception below.
- `feedback_surveys` retains its Admin-owned writer and default-on semantics (`supabase/migrations/0419_feedback_surveys_switch.sql:20`); exclude it from global and Operator controls. All core keys in D5 and meetings/tasks are always on and rejected by all switch-writing RPCs.
- Migration numbers 0530–0534 are reserved for this lane; check collisions against the target branch immediately before integration. Use numbered down migrations. Test 0137's service-role inventory and `0178_anon_executable_definers.test.sql`; no new anon-executable definer is intended.
- Later slice plans must test failure, unavailable resolution, org changes during a cached query, concurrent limit requests, and duplicate monthly jobs. Never make authorization decisions using impersonated UI state.
- Do not add an Operator toggle to `FEATURE_KEYS_TOGGLEABLE` until the corresponding UI and server gates actually consume the resolved entitlement. `agent_assistant` and `user_views` have separate deployment capability gates (`pmo-portal/src/lib/features.ts:48`); `aiComposer` is an environment subflag, not an entitlement.

## Decisions and open questions

1. Catalogue placement #1719: use the spec's S/G/P/E matrix verbatim as initial data; 0531 is the amendable data migration, not hard-coded UI logic.
2. Basic/full #1720: planning default supplied by Director: `procurement` covers create, approve and track; `procurement_full` covers receipts, three-way match and ERP push. `sales_invoices` covers raise and track; `revenue` covers incoming payments and ageing. Keep the module-to-key mapping data-driven so the owner can amend it.
3. Enterprise seats and AI credits are per contract: represent unspecified as NULL (unlimited seats / no automatic credit grant), and permit the Operator to enter values; Pro/Enterprise active projects NULL means unlimited. No automatic credit grant for NULL avoids inventing an amount.
4. Monthly allowance: default to additive monthly grants, not expiration of prior credits, because the existing pool is an append-only ledger (`supabase/migrations/0067_org_credit_balance.sql:13`). One credit represents $0.005; grant allowance × 0.005 in existing monetary units. Confirm rollover semantics before releasing limits.
5. Revenue compatibility (Director ruling): entitlement is global/override/plan; display additionally follows existing ERP ownership only when the override is absent. This preserves the old FE value but deliberately changes `org_has_feature` for an ERP-owned org with no revenue row. The policy-safe enforcement projection must use entitlement, not display. This is an explicit qualification of FR-PLN-005 and AC-PLN-016 requiring spec reconciliation before S1 ships.

## Interfaces and catalogue

- 0530 creates `plans(id text primary key, name text, seat_limit integer, project_limit integer, ai_monthly_messages integer)`, `plan_features(plan_id text, feature_key text, enabled boolean)`, `org_plans(org_id uuid primary key, plan_id text)`, and `global_features(feature_key text primary key, enabled boolean default true)`; all relevant FKs and unique constraints are explicit. `org_features` remains the override table. An absent org plan resolves Enterprise.
- `resolve_feature_internal(p_org_id uuid,p_key text) returns table(enabled boolean,display_enabled boolean,source text)` is private to the database, stable and shared. `org_has_feature(uuid,text)` keeps its active-member/own-org guard and returns `display_enabled`; `org_feature_enabled(uuid,text)` retains its non-raising RLS contract and returns `enabled` from the same resolver. For revenue only, when no override exists, `display_enabled = enabled AND NOT erp_owns_revenue`; for all other cases it equals enabled. `resolved_org_features()` returns own-org `(feature_key, enabled, display_enabled, source)`; an Operator-only `operator_resolved_org_features(uuid)` returns the selected organisation's result. No unauthenticated execution; service jobs use an explicitly service-only wrapper.
- Global false wins; otherwise an explicit org row wins; otherwise plan row wins. `feedback_surveys` resolves its existing row/default independently; core keys return `(true,'core')`. Reject unknown keys and guard every write RPC; preserve `operator_toggle_feature(uuid,text,boolean)` and add a clear-override RPC.
- In 0531 seed the complete matrix in the spec: all tiers for `timesheets`, `crm`, `procurement`, `sales_invoices`, `incidents`, `import_export`, `agent_assistant`, `feedback_surveys`; Growth+ for `sales_pipeline`, `procurement_full`, `revenue`, `budget_projection`, `imprest`, `user_views`, `m365_integration`, `clickup_sync`; Pro+ for `erp_sync`, `erp_purchases`, `financial_statements`, `management_pack`, `budget_phasing`, `multi_currency`, `stock`, `api_access`; Enterprise only for `sso`. Seed all globals on except the Admin-owned key, and backfill each existing org to Enterprise without replacing any existing override. Seed limits `(10,25,300)`, `(25,100,1500)`, `(50,NULL,5000)`, `(NULL,NULL,NULL)` in S/G/P/E order.
- Use per-org query keys and invalidate after every assignment or switch change; no cross-org shared cached result. The UI holds the route while a result is pending and displays an unavailable/error state on failure.

### Existing callers and revenue boundary

A source search of `pmo-portal`, `supabase/functions`, and migrations found no production call to `org_has_feature` beyond its definition and grants in `supabase/migrations/0070_org_features.sql:54` and `supabase/migrations/0210_service_only_definers_execute_grants.sql:71`; generated types are not calls. Migration history calls `org_feature_enabled` in `supabase/migrations/0097_companies_contacts_erpnext_flip.sql:59`, `0203_rls_active_member_write_composition.sql:173`, `0233_erp_contacts.sql:28`, `0393_procurement_draft_line_authoring.sql:89`, `0406_procurement_atomic_create.sql:24` and `0449_subcontract_po_lines.sql:48`. The 0081 policy rewrite (`supabase/migrations/0081_feature_flag_write_enforcement.sql:145`) maps incidents, CRM, procurement, timesheets and user views; its listed tables do not include a revenue mapping. These are migration-source findings, not a substitute for inspecting the live `pg_policies` and function bodies in S1 tests. Revenue's current FE ownership projection is `pmo-portal/src/hooks/useOrgFeatures.ts:18`.

## S1 — resolution core (0530, 0531, 0532)

### Task 1 — registry and compatibility (AC-PLN-016)

**Files:** create `supabase/migrations/0530_plan_registry.sql`, `supabase/migrations/0531_plan_catalogue.sql`, matching files under `supabase/migrations/rollback/`, and `supabase/tests/plans_compatibility.test.sql`.

- [ ] First write a pgTAP fixture with two existing orgs and all existing key rows, including absent/on/off and Admin feedback; capture the pre-migration result before applying migrations in a migration-upgrade harness. Assert the post-migration Enterprise result equals that snapshot. For revenue assert the pre-existing FE ownership rule rather than the old DB result; retain the existing FE environment tests unchanged. Add an ERP-owned, absent-override case proving an otherwise authorized revenue-table write succeeds.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/plans_compatibility.test.sql'`; verify the new registry assertion fails on the old schema. Inspect TAP for `not ok` and `Parse errors`.
- [ ] Create the four tables, indexes, FK constraints, default-deny RLS and explicit service grants in 0530. Populate exactly the matrix and limits above in 0531; preserve existing overrides and the Admin feedback policies. Write reverse SQL in dependency order, preserving pre-existing org rows.
- [ ] Repeat the locked command; every assertion passes and no parse errors occur. Run the migration-upgrade harness as well; a fresh reset alone cannot prove an existing-org upgrade.

### Task 2 — resolution and source (AC-PLN-001, 002, 004)

**Files:** create `supabase/migrations/0532_plan_resolution.sql`, matching rollback, `supabase/tests/plans_resolution.test.sql`.

- [ ] Test global stock off plus override on → false/global; global on plus Starter/no override → false/plan; override on → true/override; no plan → Enterprise; every core key → true/core; any layer's attempt to write a core key → `core_not_gatable`. Test own-org, other-org, inactive and service contexts and both wrapper contracts. For revenue, assert ERP-owned/no override returns false for display but true for policy enforcement, explicit override wins, and global-off defeats override.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/plans_resolution.test.sql'`; observe failing assertions before implementation.
- [ ] Implement the interfaces above and pin `search_path`; preserve `org_feature_enabled`'s non-raising behaviour for policy evaluation (`supabase/migrations/0081_feature_flag_write_enforcement.sql:108`). Add operator RPCs `operator_set_org_plan(uuid,text)`, `operator_set_global_feature(text,boolean)`, `operator_clear_feature_override(uuid,text)` and `operator_set_plan_feature(text,text,boolean)`, plus `operator_set_plan_limits(text,integer,integer,integer)`. Audit actor, time, old and new state in the same transaction. Reject core/feedback keys, unknown keys, invalid limits and nonexistent orgs.
- [ ] Re-run the same locked command and verify all TAP output. Mutation check global precedence and core rejection: invert each condition, confirm the owning tests fail, restore, and re-run green.

### Task 3 — privileges and operator access (AC-PLN-003)

**Files:** `supabase/migrations/0532_plan_resolution.sql`, `supabase/tests/plans_permissions.test.sql`, `supabase/tests/0137_service_role_grants.test.sql`, `supabase/tests/0178_anon_executable_definers.test.sql`.

- [ ] Test direct writes by anon/authenticated/Admin and non-Operator RPC calls fail, active Operator RPC calls succeed, inactive Operator and other-org member reads fail, service role works only through its documented entry point, and Admin feedback writes still work only for its org.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/plans_permissions.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`; verify failures first.
- [ ] Add explicit revoke/grant, RLS and active Operator checks; do not broaden anon-definer allow-list. Grant service role only the privileges required by inventory and service operations; make explicit exceptions in 0137 only where RPC-only writes are required, with tests.
- [ ] Re-run the same command; inspect all TAP, zero failures and parse errors. Mutation-check the Operator guard by bypassing it, show the test fails, then restore.

## S2 — server enforcement (0533): outline

**Goal / AC:** Refuse writes, RPCs, sync and jobs for disabled modules while retaining data (AC-PLN-005). First produce a reviewed catalogue mapping every existing gated key to its table writes, RPCs, edge handlers and job consumers, including service-role paths and the procurement basic/full boundary. The slice's own detailed plan must enumerate each exact path and failing test, introduce `0533_feature_enforcement.sql` and rollback, and prove both denial and restoration. Include typed `feature_off` and mutation checks.

## S3 — FE and console: outline

**Goal / AC:** Use the database effective projection for navigation and routes; present the Operator console and read-only Admin page (AC-PLN-008, 012, 013). First inventory route/nav gates, current deployment capability gates, repository APIs, actual test paths and translations. The slice's detailed plan must test loading, failure, invalidation, org changes and the current Admin feedback path. `agent_assistant` and `user_views` keep deployment kill switches as an additional AND. Run rendered review and UX proof.

## S4 — assistant and analytics: outline

**Goal / AC:** Follow resolved switches and emit a privacy-preserving missing-tool signal (AC-PLN-006, 007); register plan as analytics group property (FR-PLN-016). First inventory entities and named actions against keys, including write actions and both tool loops. Filter the generic `query_entity` entity catalogue and reject disabled entities on execution; filter named tools through the same mapping. Test the shipped handler, no message text in the single event, consent, org changes, and run agent evals. Add the missing stock read tool as needed.

## S5 — limits (0534): outline

**Goal / AC:** Enforce seats and active projects and grant monthly credits exactly once (AC-PLN-009–011). First inventory the invite lifecycle, project status taxonomy, credit ledger and scheduler, including the transaction boundary around external invite issuance. Count active members plus pending invites inside the invite RPC under the organisation row lock, without a reservation table; prove concurrency and failure cleanup. Detailed plan owns migration `0534_plan_limits.sql`, rollback, monthly idempotency and per-contract behavior. Decide credit rollover and the invite transaction boundary before implementation; do not claim a SQL lock covers an external request after its transaction ends.

## S6 — completeness and one journey: outline

**Goal / AC:** CI catches unregistered modules and one cross-org journey verifies the full switch (AC-PLN-014, 015). First inventory route/nav/entity sources and assistant registrations so the gate discovers additions independently of its own catalogue. Detailed plan must include failing fixtures for each missing requirement, core modules, plan rows, read tools and draft-confirm write tools. Add one isolated Playwright journey: Operator disables stock in A; A loses nav, URL access and assistant tool while B remains enabled. Read `docs/e2e-parallel-conventions.md` before writing it.

## Planned AC ownership (later slices finalize exact paths)

| AC | Owning test |
|---|---|
| 001–002, 004 | `supabase/tests/plans_resolution.test.sql` |
| 003 | `supabase/tests/plans_permissions.test.sql` |
| 005 | `supabase/tests/plans_feature_enforcement.test.sql` |
| 006–007 | `supabase/functions/agent-chat/index.test.ts` |
| 008 | `pmo-portal/src/auth/__tests__/useFeature.test.tsx` |
| 009–010 | `supabase/tests/plans_limits.test.sql` |
| 011 | `supabase/tests/plans_monthly_credits.test.sql` |
| 012 | `pmo-portal/pages/AdministrationFeatures.test.tsx` |
| 013 | `pmo-portal/pages/YourPlan.test.tsx` |
| 014 | `scripts/check-module-completeness.test.mjs` |
| 015 | `pmo-portal/e2e/AC-PLN-015-plan-switch.spec.ts` |
| 016 | `supabase/tests/plans_compatibility.test.sql` (FE compatibility cases in the S3 plan) |

## Final gates per slice

For each eventual implementation PR, run from `pmo-portal/` `npm run check:guards`, `../scripts/with-test-lock.sh npm run typecheck`, `npx eslint --max-warnings=0` on exact changed TS/TSX paths, and directly touched Vitest files under the test lock. Run changed edge handler Deno tests; DB changes run only touched pgTAP plus 0137/0178 under one `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db …'` hold, inspect output for parse errors. Run touched e2e and UI proof for UI work, script tests for changed scripts. Security, spec and quality reviewers review each code slice; UI gets rendered review. Do not push or merge without the applicable owner checkpoint.
