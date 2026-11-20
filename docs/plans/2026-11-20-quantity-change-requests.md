# Quantity Change Requests Implementation Plan (#2578)

> **Money / SoD tier: Director-dispatched, one fresh Orca worker per slice, ships alone (not batched).** Spec: `docs/specs/quantity-change-requests.spec.md`. Sign OD-QCR-1..9 and answer OQ-QCR-1..3 first. Builds on `boq_items` (0250, 0337), `work_order_lines`, `work_order_acceptances` (0337), `progress_assessment_quantities` (0250), `progress_claim_lines` (0250). Daily-report quantities (#1522) join the progress source when that ships; reconcile its final names before Slice 1.

## Migrations (numbers assigned by the Director; each with a `rollback/` file; RLS enabled and forced; `org_id` by `stamp_org_id` trigger, never from the client)

Described, not numbered. Every policy wraps helpers as `(select public.auth_org_id())`, `(select public.is_active_member())`, `(select public.auth_role())` so `supabase/tests/0646_rls_initplan.test.sql` stays green. Every function that is client-callable is `security definer set search_path = public`, calls `assert_is_active_member()`, `revoke all ... from public, anon` then grants execute to `authenticated`, and joins the definer allow-list that 0178 maintains.

- **M1 — quantity versions (append-only).** Table `contract_quantity_versions` (id, org_id, boq_item_id, version_no, quantity numeric(14,3) with the 0250 finite/positive check, source in `baseline|setup_edit|change_request`, change_request_id nullable, created_by default `auth.uid()`, created_at; unique `(boq_item_id, version_no)`). Backfill one `baseline` row per existing `boq_items` row. Trigger on `boq_items` insert appends version 1. Immutability trigger on the versions table raising 42501 for update and delete (no role bypass). No insert grant: rows come only from definer functions. Guard trigger on `boq_items` quantity update: allowed only when the session flag `pmo.applying_quantity_change` is set by the accept function, or when the item has no assessment quantity, no claim line and no confirmed acceptance line (then it appends a `setup_edit` version). Rollback drops triggers, then the table; `boq_items.quantity` is untouched so rollback is lossless for the live figure.
- **M2 — requests.** Tables `quantity_change_requests` (id, org_id, project_id, work_order_id, status check in the eight states, reason, `client_request_id` unique per org, author, last_editor, submitted_by, approved_by/at, returned_reason, sent_on, client_reference, decided_on, decision, withdrawn_reason, created_at) and `quantity_change_request_lines` (request_id, boq_item_id, base_version_id, trigger_kind, trigger_figure, base_quantity, requested_quantity, line reason; unique `(request_id, boq_item_id)`). Partial unique index: one open request per contract item (`status` in draft..sent_to_client) enforced through a lines-side trigger. Attachments use the shared private attachment mechanism (reconcile the entity-type registration in `project_documents`/attachments when building). Select policy: own org, active member. No insert/update/delete grant to `authenticated`.
- **M3 — functions** (all definer): `raise_quantity_change_request(work_order, lines, reason, client_request_id)` (locks the `work_orders` row `for update`, counts requests, checks limit and trigger condition, idempotent on `client_request_id`), `edit_quantity_change_request`, `submit_quantity_change_request`, `approve_quantity_change_request` (SoD), `return_quantity_change_request`, `withdraw_quantity_change_request`, `mark_quantity_change_request_sent`, `record_quantity_change_decision` (writes versions, `boq_items.quantity`, allocation delta in one transaction; stale-base check), `record_forecast_quantity`, and read function `list_over_contract_items(project_id)` returning P, source, E, C per item in one indexed query.
- **M4 — forecasts and limit.** Table `contract_quantity_forecasts` (append-only, immutability trigger, no direct grants). Column `organizations.quantity_change_limit integer null check (>= 0)`; `grant update (quantity_change_limit)` through the existing Admin-only organizations policy; audit trigger `log_audit('org.quantity_change_limit.change', ...)` following 0250's `audit_org_down_payment_item`.
- **M5 — history and notification.** Add the request table to `record_history_config` (captured status, reason, quantity fields typed `quantity`/`ref`); over-contract notification inserted by the evaluation function once per item and kind, using the existing notification mechanism.

## Slice 1 — pure rules (Orca worker)

- [ ] Write the failing test `pmo-portal/src/lib/__tests__/quantityChangeRules.test.ts` with the hand-calculated fixture (AC-QCR-001, 002, 023): P is the greatest of four sources and names it; E > C triggers; exact equality is not over; value change uses `exactDecimal`. Run `npx vitest run src/lib/__tests__/quantityChangeRules.test.ts` and see it red.
- [ ] Implement `pmo-portal/src/lib/quantityChangeRules.ts` (`reportedProgress`, `isOverContract`, `versionValueChange`). Green.
- [ ] Component test `pmo-portal/src/components/__tests__/QuantityChangeActions.test.tsx` (AC-QCR-027): approve action absent for author, reason shown. Red, then implement `pmo-portal/src/components/QuantityChangeActions.tsx` reading the projected identity facts.

## Slice 2 — versions and the direct-edit guard (Director-dispatched Orca worker)

- [ ] pgTAP `supabase/tests/quantity_versions.test.sql` first: AC-QCR-019, 020, 021, 024 (versions table). Run chained under one lock: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/quantity_versions.test.sql'`. Red.
- [ ] M1. Green. Also run the existing 0337 and 0250 pgTAP files that touch `boq_items` (`supabase/tests/0337_contract_lines.test.sql`, `0337_contract_lines_api_guard.test.sql`) so the new guard breaks no shipped behaviour; fix the guard, never the old test.
- [ ] Update `pmo-portal/src/lib/db/progressBilling.ts` only if its `boq_items` update path must handle the 42501 "use a quantity change request" error; map the error in `classifyMutationError`.
- [ ] Mutation check: remove the immutability trigger, AC-QCR-019 must go red; restore.

## Slice 3 — request workflow, SoD and limit (Director-dispatched, ships alone)

- [ ] pgTAP `supabase/tests/quantity_change_requests.test.sql` first (all red): AC-QCR-003..018, 022, 024. Tests seed two users per role to exercise author, editor, submitter and a distinct approver; the concurrency test (AC-QCR-007) uses two connections against one work order.
- [ ] M2, M3, M4, M5 in that order, each with its rollback file. Chained run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/quantity_change_requests.test.sql supabase/tests/quantity_versions.test.sql'`.
- [ ] **Mutation checks (each must turn a named test red; restore after each):** (1) replace the author comparison in `approve_quantity_change_request` with `true` — AC-QCR-011 and 013 red; (2) drop the editor/submitter terms — AC-QCR-011 red; (3) remove the `for update` lock on the work order — AC-QCR-007 red; (4) change the limit comparison from `>=` to `>` — AC-QCR-006 red; (5) skip the stale-base check — AC-QCR-018 red; (6) write the version before the status check in the decision function — AC-QCR-017 red. Record the commands and the red output in the PR body.
- [ ] Rollback proof: apply each `rollback/*_down.sql` on a scratch reset and confirm `boq_items.quantity` values are unchanged.
- [ ] Data layer `pmo-portal/src/lib/db/quantityChangeRequests.ts` plus `__tests__/quantityChangeRequests.test.ts` (mocked), repository `src/lib/repositories/quantityChangeRequests.ts` (ADR-0017); never pass `org_id`. Read paths bounded and paginated (`scripts/check-unpaged-reads.mjs`).
- [ ] `pmo-portal/src/auth/policy.ts`: entity `quantity_change_request` with actions view, forecast, raise, edit, submit, approve, return, withdraw, record_client, set_limit; register in the role matrix (#902). `can()` mirrors the RPC; a test in `src/auth/__tests__/` proves the UI is not looser than the server.

## Slice 4 — screens (ui-implementer; `restructure` skill; `docs/ux/screen-rules.md`)

- [ ] Over-contract flag and "Raise change request" on contract lines (`pages/project-detail/tabs/WorkOrdersTab.tsx`, `WorkOrderLinesModal`) and on the work-order record page (reconcile the file name with `docs/plans/2026-11-20-work-order-record-page.md`); request count against the limit shown beside it.
- [ ] Request detail with status timeline, trigger snapshot, approve/return panel, send-to-client form (reference, date, attachment), decision form, and the per-item version history table. Use `EntityFormModal`/`useEntityForm`, `ConfirmDialog`, `classifyMutationError`.
- [ ] Admin setting for the request limit on the organisation settings screen.
- [ ] Strings: `pmo-portal/public/locales/en/quantityChange.json` and `.../id/quantityChange.json` (Bahasa Indonesia), both complete; touched-route Bahasa test following `Incidents.bahasa.test.tsx`.
- [ ] `scripts/ux-proof.sh` on touched routes; one rendered review by the Director on rich seed, every state (empty, over, pending, returned, sent, accepted, limit reached).

## Slice 5 — journeys (Orca worker)

- [ ] `pmo-portal/e2e/AC-QCR-025-raise-and-approve.spec.ts` and `AC-QCR-026-client-decision-new-version.spec.ts`; read `docs/e2e-parallel-conventions.md` first and tag isolation. Use the two-user pattern for author and approver. Run `scripts/e2e-local.sh AC-QCR`.

## Traceability (each AC has one owning layer)

| AC | Layer | File |
|---|---|---|
| AC-QCR-001, 002, 023 | Unit (+ pgTAP read for 001, 002) | `src/lib/__tests__/quantityChangeRules.test.ts`; `supabase/tests/quantity_change_requests.test.sql` |
| AC-QCR-003..018 | pgTAP | `supabase/tests/quantity_change_requests.test.sql` |
| AC-QCR-019..021 | pgTAP | `supabase/tests/quantity_versions.test.sql` |
| AC-QCR-022, 024 | pgTAP | `supabase/tests/quantity_change_requests.test.sql` |
| AC-QCR-025 | E2E | `e2e/AC-QCR-025-raise-and-approve.spec.ts` |
| AC-QCR-026 | E2E | `e2e/AC-QCR-026-client-decision-new-version.spec.ts` |
| AC-QCR-027 | Unit (component) | `src/components/__tests__/QuantityChangeActions.test.tsx` |

## ADR candidates (notes only; no ADR files in this plan)

- ADR candidate: contract quantity as append-only versions with `boq_items.quantity` as a server-written cache of the latest version.
- ADR candidate: client acceptance, not internal approval, is the event that changes a billable quantity; internal approval gates only submission.
- ADR candidate: no sole-operator exception for money-changing approval (differs from acceptance confirmation) if OD-QCR-3 is signed as proposed.

## Glossary (to `docs/glossary.md` in the same PR)

Quantity change request, contract quantity, quantity version, forecast quantity at completion (distinct from the cost-side estimate at completion), over-contract, request limit, internal approval. Disambiguate from PO variation (vendor side).

## Final gate (per CLAUDE.md local gate)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the directly touched vitest files, touched e2e journeys (`scripts/e2e-local.sh`), `node scripts/affected-e2e.mjs` for UI, `scripts/ux-proof.sh` on touched routes, and the touched pgTAP files under `scripts/with-db-lock.sh`. Reviewers: `spec-reviewer`, `code-quality-reviewer`, `security-auditor` (auth, RLS, money). The release PR to `main` runs the full suite; this change merges to `dev` alone.
