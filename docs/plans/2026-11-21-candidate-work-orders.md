# Candidate Work Orders Implementation Plan (#2595)

> Fresh Orca worker per slice. Spec: `docs/specs/candidate-work-orders.spec.md`. Scope approved for the 15 December 2026 release (OD-SCOPE-12); OD-CWO-1..6 take their recommended defaults (spec "Build decisions"). Layout gets the owner's ~30-second sketch-glance in the build phase. Builds on `work_orders` and its origination guard (0193), `attendance_photos` private-bucket pattern (1036), `record_history_config` (0260), `can()` (`pmo-portal/src/auth/policy.ts`). Slice 2 (the accept RPC) writes `work_orders`: Director-dispatched, three reviewers, ships alone.

## Migrations 1405 to 1409 (additive; no change to `work_orders`)
- 1405 tables, constraints, RLS, column grants, record-history registration. 1406 `create_work_order_candidate` and `set_work_order_candidate_template` (+ item/proof write guards). 1407 `decide_work_order_candidate`. 1408 proof bucket and storage policies. 1409 reserved for a fix found in review. Each has a rollback in `supabase/migrations/rollback/`. Isolation fragment `scripts/isolation-probe-denominator.d/2595-candidate-work-orders.json` for the new org_id tables and definer functions.
- No default item is seeded (OD-SCOPE-2): `create_work_order_candidate` copies only the org's active template rows, possibly none.
- Tables, each with `org_id uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001') references organizations`, `stamp_org_id` trigger and RLS: `work_order_checklist_items` (template: key, label, position, required, archived_at), `work_order_candidates` (project_id, title, description, client_reference, offered_on, status check in `assessing|accepted|rejected`, decided_by, decided_at, decision_reason check length 1..500 when decided, work_order_id unique references work_orders, replaces_id references itself, created_by), `work_order_candidate_items` (candidate_id, template_key nullable, label, position, required, owner_id references profiles, target_date, status check in `open|passed|failed|not_applicable`, note), `work_order_candidate_proofs` (item_id, file_path, uploaded_by).
- Constraints: `decided` columns all-or-none with status; `accepted` implies `work_order_id`; `not_applicable` requires a note (trigger).
- RLS: read = the work-order readers via `(select helper())`; candidate creation through its RPC only; item and proof writes require an active candidate and the allowed assessment roles, with the item's owner allowed to update their item; **no client UPDATE grant on candidate status or decision columns** (column-grant surgery follows `work_orders` in 0193 §5). Template writes go through the Admin-only function below.
- Functions: `create_work_order_candidate(project, title, description, client_reference)` `security definer`, `set search_path = public, pg_temp`, re-asserts active membership and Admin/Engineer/project-Manager role, verifies the project is in the caller's org, and copies the organisation's active template items (possibly none) in one transaction; `set_work_order_candidate_template(p_items jsonb)` `security definer`, Admin only, whole-list validation and audit; `decide_work_order_candidate(candidate, decision, reason)` `security definer`, `set search_path = public, pg_temp`: gate (Project Manager of that project or Admin, `is_active_member()`), lock the row `for update`, return the existing work order on a repeat accept, refuse a blank reason, refuse accept when a required item is not `passed`/`not_applicable`, create the Draft work order through the same insert the origination guard permits (`project_id`, project `currency`, project `tax_treatment`, `tax_amount = 0`, `tax_rate = null`, `tax_template = null`, `order_value = 0`, `status = 'Draft'`, no `wo_number`), map `client_reference` to `work_orders.client_po_number`, stamp the candidate; `revoke all ... from public, anon; grant execute ... to authenticated`.
- Storage: private bucket `work-order-candidate-proofs` (image/png, jpeg, webp, application/pdf; 10 MB), policies keyed on the candidate's org, in the style of `attendance-photos` (1036).
- Record history: each of the four tables writes to the shared audit trail (`audit_events`: actor, time, before and after) through one trigger function (FR-CWO-018).
- **Rollback:** `supabase/migrations/rollback/<number>_candidate_work_orders_down.sql` drops the functions, policies, tables and bucket in reverse order.
- ADR: only if the owner rules OD-CWO-1 differently (a status on `work_orders` is architectural and cross-cutting).

## Slice 1: pure derivation (Orca)
- [ ] Write first `pmo-portal/src/lib/candidateAssessment.test.ts` (AC-CWO-015) then `pmo-portal/src/lib/candidateAssessment.ts` exporting `deriveAssessment(items, today)`: passed of required, ready-to-accept, overdue count, blocking items. `today` is the organisation date passed in, never `new Date()`. Verify: `cd pmo-portal && npx vitest run src/lib/candidateAssessment.test.ts`.

## Slice 2: database (Director-dispatched Orca worker; ships alone)
- [ ] pgTAP `supabase/tests/work_order_candidates.test.sql`: AC-CWO-001..014 and 017 (fixtures: template of 3 items, no template (no items), Project Manager of the project, another Project Manager, Engineer, Viewer, Admin, a second organisation, a candidate with failed items, a candidate decided twice). Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/work_order_candidates.test.sql'`.
- [ ] Migration as above. Mutation check (spec): remove the Project Manager gate (AC-CWO-008 red), drop the required-items test (AC-CWO-004 red), remove the idempotency guard (AC-CWO-006 red); restore.
- [ ] `pmo-portal/src/lib/db/workOrderCandidates.ts` (typed reads and the two RPC calls; every figure and status validated, as `src/lib/db/workOrderBilling.ts`), repository `pmo-portal/src/lib/repositories/workOrderCandidates.ts` (ADR-0017), hooks `pmo-portal/src/hooks/useWorkOrderCandidates.ts`, regenerate types in `pmo-portal/src/lib/supabase/database.types.ts`. Unit tests with a mocked client for error classification via `classifyMutationError`.
- [ ] Hide-until-used read: `hasCandidateSetup(orgTemplateCount, projectCandidateCount)` gate used by the Contract tab (AC-CWO-018, RTL in the same test file as the screen).
- [ ] Policy: add `workOrderCandidate` actions to `pmo-portal/src/auth/policy.ts` (create/assess: Admin, Engineer, Project Manager; decide: Admin and the project's Project Manager; template: Admin). UX only; the database decides.

## Slice 3: screen (ui-implementer; `restructure` skill and `docs/ux/screen-rules.md`)
- [ ] Owner sketch-glance first (directional layout only).
- [ ] `pmo-portal/pages/project-detail/tabs/CandidateWorkOrders.tsx` mounted in the Contract area by `pmo-portal/pages/project-detail/ProjectSections.tsx` on `/projects/:projectId/contract`: list, create dialog (`EntityFormModal`/`useEntityForm`), checklist with owner, target, proof upload, accept/reject `ConfirmDialog` with a required reason field; decided candidates read-only with a link to the Draft work order (`/work-orders/:id`). Admin template editor `pmo-portal/pages/admin/WorkOrderCandidateTemplate.tsx` in the existing `/administration/projects` section rendered by `pmo-portal/pages/Administration.tsx`.
- [ ] Strings: built into the existing `project` (`projectDetail.candidates.*`) and `administration` (`admin.candidateTemplate.*`) namespaces, English and Bahasa Indonesia; no new namespace. Bahasa wording per OQ-CWO-3.
- [ ] E2E `pmo-portal/e2e/serial/AC-CWO-016-candidate-to-draft-work-order.spec.ts` (Project Manager journey). Read `docs/e2e-parallel-conventions.md` first and tag the isolation class.
- [ ] Unit/RTL `pmo-portal/pages/project-detail/tabs/__tests__/CandidateWorkOrders.test.tsx`: blocked-accept message names the items; buttons absent for a Viewer; behaviour only, no look-pinning.
- [ ] `scripts/ux-proof.sh` on the project page route. Phone (390) and desktop (1440) screenshots in `docs/evidence/1215/2595/`.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-CWO-001..014, 017 | pgTAP | `supabase/tests/work_order_candidates.test.sql` |
| AC-CWO-015 | Unit | `pmo-portal/src/lib/candidateAssessment.test.ts` |
| AC-CWO-018 | Unit (RTL) | `pmo-portal/pages/project-detail/tabs/__tests__/CandidateWorkOrders.test.tsx` |
| AC-CWO-016 | E2E | `pmo-portal/e2e/serial/AC-CWO-016-candidate-to-draft-work-order.spec.ts` |

## Glossary and docs
- [ ] `docs/glossary.md`: candidate work order, assessment checklist, ready to accept.
- [ ] Update the roadmap issue (#1571) and map #2516 in the session the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file and e2e journey (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh` on the touched route. No full local suite.
