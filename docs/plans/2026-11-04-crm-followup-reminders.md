# CRM Follow-up Reminders Implementation Plan

> **UNSIGNED / DO NOT BUILD.** Owner must decide spec decisions 1–4 and approve the spec and screen direction first; revise this plan if any default changes. Executor is an Orca supervised worker following the implementer contract and TDD.

**Goal:** Let a user schedule and complete personal CRM follow-ups, receive a due inbox item, and filter the pipeline to their due deals.

**Architecture:** Persist parent-bound follow-ups with enforced owner and parent scope; deliver each revision transactionally via the existing dispatcher tick and notifications inbox. Query own due deal IDs once and intersect both existing pipeline models; preserve existing task reminders and automation paths.

**Tech Stack:** React 19, TypeScript, Supabase Postgres/RLS, Deno dispatcher, Vitest, pgTAP, Playwright.

**Spec:** `docs/specs/crm-followup-reminders.spec.md`.

## Global constraints

No new schedule/credential or model call; no owner delegation, snooze, email, or composition redesign. Use date-time with explicit ambiguous-time resolution, preserve actual current parent/role/org rules, transactional retry, maximum 100 ordered deliveries per tick, reversible migration, and existing tokens/i18n. Director assigns the migration number at dispatch after checking parallel branches; the worker must not invent it. Each AC has one owning layer as in the spec; cross-layer regression checks supplement rather than replace it. All task estimates are 2–5 minute reviewable steps, not end-to-end estimates.

## Review focus

- Concurrent ticks and transaction failure: Task 2 asserts exactly one committed notification and retry after rollback.
- Revoked parent access and inactive owners: Tasks 1–2 exercise current access on write and delivery.
- DST gaps and overlaps: Task 4 asserts error or explicit offset selection, never silent coercion.
- Query error versus zero matches: Task 5 tests the error state and retry.
- Boundary crossing while mounted: Task 5 tests minute refresh and invalidation without navigation.

## Files and interfaces

- New migration and matching rollback under `supabase/migrations/` and `supabase/migrations/rollback/`; new `supabase/tests/crm_followups.test.sql` and a concurrency test under `scripts/`. Regenerate `pmo-portal/src/lib/supabase/database.types.ts` using the project procedure. Update isolation inventory for new DB objects.
- New `pmo-portal/src/lib/db/crmFollowups.ts`, `src/lib/repositories/crmFollowups.ts`, and `src/hooks/useCrmFollowups.ts`: `listForParent(kind: 'contact' | 'opportunity', id: string)`, `createFollowup(kind, id, dueAt: string)`, `rescheduleFollowup(id: string, dueAt: string)`, `completeFollowup(id: string)`, and `listDueDealIds(): Promise<string[]>`. Mutations return persisted row; timestamp strings are ISO instants. Use caller-scoped reads, no client org or owner IDs.
- New `pmo-portal/pages/contact/FollowupForm.tsx` and `FollowupPanel.tsx` reused by `ContactDetail.tsx` and the deal record (`project-detail/ProjectDetail.tsx`, via `pages/sales/DealBand.tsx`); new form test and locale keys in both `public/locales/en` and `public/locales/id`.
- `supabase/functions/agent-dispatch/index.ts` and `index.test.ts`: invoke service-only `deliver_due_crm_followups(100)` once per authorized tick independently of assistant feature entitlement; failure is logged and does not prevent the existing dispatcher from running.
- `src/lib/listWorkingSet.ts`, its tests, `pages/SalesPipeline.tsx`, `pages/sales-pipeline/pipelineListModel.ts` and tests: add URL-owned boolean `followup=1`; both filter functions consume `dueDealIds: ReadonlySet<string> | null`, where null means toggle off and an empty set means loaded with no matches. Never pass an empty set for a failed query.

## Tasks

### 1. Parent-bound persistence and access (AC-001, AC-002)

- [ ] Add pgTAP cases for contact and project create/read/update/complete, wrong parent, other tenant, forged owner, current parent scope, and non-writer. Assert exactly one parent, server-stamped owner/org, future instant, immutable parent/owner and completed state transition.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/crm_followups.test.sql` from repo root; confirm the new tests fail because objects do not exist.
- [ ] Add the assigned-number migration and rollback: fields and indexes in spec, constraints, RLS, grants, and caller-bound mutations; ensure parent authorization is evaluated under caller's actual scope. Preserve completed history; prohibit updates to a completed item. Add object inventory and regenerate types.
- [ ] Run the same locked pgTAP command; confirm all assertions pass and no parse errors. Test rollback and reapply under one DB lock. Inspect the effective grants and policies after migration, not only the SQL text.

### 2. Atomic due delivery (AC-003–005)

- [ ] Add pgTAP assertions for due boundary, future/completed rows, redate revisions, parent archive, revoked access, inactive recipient and restored eligibility; assert inbox entity metadata and owner. Add `scripts/crm-followup-delivery-race.test.mjs` with two concurrent transactions against one due row and a forced rollback/retry case.
- [ ] Run the touched pgTAP file and `scripts/with-db-lock.sh node --test scripts/crm-followup-delivery-race.test.mjs`; confirm the delivery cases fail before implementation.
- [ ] In the same migration add `public.deliver_due_crm_followups(p_limit integer) returns integer`, executable only by service role; clamp limit to 100, lock eligible rows in `(due_at,id)` order with skip-locked, re-evaluate owner and parent access, insert notification and stamp revision in one transaction. Use a shared, explicit subject-access predicate that matches effective parent read scope for the recipient; do not evaluate `auth.uid()` as the service actor. Invalid eligibility remains retryable, while bounded selection must not allow permanently ineligible rows to starve eligible ones.
- [ ] Run both commands again, check output bodies and no pgTAP parse errors. Review query plans for due scan and owner/deal lookup. Mutation-check tenant/owner and duplicate protections by temporarily breaking each and proving tests fail; restore before releasing the lock.

### 3. Existing tick integration (AC-011)

- [ ] Add Deno tests to `supabase/functions/agent-dispatch/index.test.ts`: disabled assistant feature still invokes the CRM RPC once, RPC failure is logged and existing automation path still executes, and unauthorized requests invoke neither path.
- [ ] Run `deno test --allow-env --allow-net supabase/functions/agent-dispatch/index.test.ts` and observe the new failure.
- [ ] Call the bounded RPC from the authenticated tick before automation gating, catch and report errors without aborting automation work; do not alter the existing cadence or agent reminder paths.
- [ ] Re-run the Deno test and the existing task reminder tests; confirm pass. Follow the shipped-handler test-binding guard.

### 4. Record workflow and inbox (AC-007, AC-009, AC-010)

- [ ] Add repository/hook tests for one parent, server errors, invalidation and local-time conversion; form tests cover DST gap, both overlap offsets, past/now, saving error retains input, and completion. Add inbox contact route/mark-read test.
- [ ] Run `cd pmo-portal && npx vitest run src/lib/db/crmFollowups.test.ts pages/contact/__tests__/FollowupForm.test.tsx src/components/shell/__tests__/NotificationBell.test.tsx` under `scripts/with-test-lock.sh`; observe new failures.
- [ ] Implement typed DAL/repository/hook and shared panel/form; place on existing contact and opportunity detail surfaces only after owner direction. Gate writes with current record permissions and use server errors, accessible labels, loading/empty/error states, en/id strings and explicit timezone/offset. Complete changes status, not inbox read.
- [ ] Re-run the same tests under the test lock; verify existing contact/project behavior and navigation tests for the touched surfaces.

### 5. Pipeline filter (AC-006, AC-010)

- [ ] Extend codec and model tests for URL round-trip, clear all, table scope/stage/search/classification intersection, board all-stage behavior, mobile, direct deal only, future/completed/other-owner exclusion, empty result, errors, minute boundary and invalidation.
- [ ] Run `cd pmo-portal && npx vitest run src/lib/listWorkingSet.test.ts pages/sales-pipeline/__tests__/pipelineListModel.test.ts pages/SalesPipeline.test.tsx` under the test lock; observe failures.
- [ ] Add `followup=1` codec and toggle; fetch own due IDs in one caller-scoped bounded/paged query, preserve errors and retry, feed both model functions and export rows, and refresh at minute boundary while mounted. Keep existing scopes, funnel summaries and unrelated URL keys unchanged.
- [ ] Re-run these tests under the lock; verify results and accessibility of toggle on every presentation.

### 6. Curated journey and gates (AC-008)

- [ ] Read `docs/e2e-parallel-conventions.md`; write `pmo-portal/e2e/AC-CRM-FU-008-followup.spec.ts` with isolation tag. Create a due deal follow-up through the real UI, advance the delivery through the permitted test seam, select its inbox item, assert the correct deal and still-open follow-up, then complete it and assert removal.
- [ ] Run `scripts/e2e-local.sh AC-CRM-FU-008` under the DB lock; diagnose any failure rather than weakening the journey. Run `node scripts/affected-e2e.mjs` and execute selected touched journeys, then `scripts/ux-proof.sh` for affected routes under the DB lock.
- [ ] Run `npm run check:guards`, locked `npm run typecheck`, `npx eslint --max-warnings=0` on touched TS/TSX files, touched Vitest and Deno files, and touched pgTAP under the DB lock. Record output bodies, no parse errors, 80% changed-code coverage, rollback evidence and required mutation checks. Run the CRM race test under the DB lock. Obtain spec, quality, security and acceptance reviews; ship only through the approved dev workflow.

## Traceability and release

AC-001–002 → Task 1; AC-003–005 → Task 2; AC-011 → Task 3; AC-007/009/010 → Task 4; AC-006/010 → Task 5; AC-008 → Task 6. The owner must explicitly sign the spec and sketch before dispatch; no production release is authorized here. Verify existing tick delivery in the target environment after deployment without creating a second schedule.
