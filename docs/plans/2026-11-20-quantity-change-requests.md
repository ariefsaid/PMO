# Quantity Change Requests Implementation Plan (#2578)

## Built on defaults (owner to confirm)

Each open owner decision was built on the spec's recommended default. If the owner rules differently, the named piece changes.

| Decision | Default built | Where it lives |
|---|---|---|
| OD-QCR-1 forecast quantity | A PM (the project's own) or Finance and above records an append-only forecast per contract item; the latest wins; "EAC passes the contract" means E > C | `quantity_forecasts`, `record_quantity_forecast` (1126) |
| OD-QCR-2 roles | Authors and clients-side recorders: Admin, Executive, Project Manager, Finance. Approvers: Admin, Executive, Finance, never the author, any editor or the submitter | `qcr_assert_approver` (1128), `can()` entity `quantityChange` |
| OD-QCR-3 sole operator | No sole-user exception: a request nobody else may approve waits, and the page says so | `qcr_approve`/`qcr_return` (1128), `qcr_approval_state` (1129) |
| OD-QCR-4 limit counting | Every request on the work order counts except a draft withdrawn before it was ever submitted; the withdraw function stamps `withdrawn_from` and the request keeps `first_submitted_at` | `qcr_request_count`, `qcr_withdraw` (1127) |
| OD-QCR-5 direct edits | A direct quantity edit stays possible only while the line has no assessed quantity above zero, no claim line, no confirmed acceptance and no validated daily-report quantity; it appends a `setup_edit` version | `boq_item_quantity_locked`, `guard_boq_quantity_change` (1125) |
| OD-QCR-6 allocation | On client acceptance the work-order allocation rises by the same delta; on a Draft work order its value rises by the value change through `set_work_order_value` | `qcr_record_decision` (1128) |
| OD-QCR-7 when quantity changes | Only when the client accepts; internal approval changes nothing | `qcr_record_decision` |
| OD-QCR-8 proactive requests | Not allowed: a line must be over-contract when raised | `qcr_prepare_lines` (1127) |
| OD-QCR-9 default limit | Empty (no limit) until an Admin sets one | `organizations.quantity_change_limit` (1127) |
| OD-QCR-10 billing ceiling | Recorded and shown, not bypassed: an Issued work order keeps its frozen value, so the extra is billable only after cancel and re-issue; a Draft work order's value rises | `qcr_record_decision`; `billing.*` strings on the request page |
| OQ-QCR-1 different accepted quantity | Record a decline and raise a new request | the request page offers only accepted or declined |
| OQ-QCR-2 decreases | Out of scope: increases only | `qcr_prepare_lines` requires R above C |
| OQ-QCR-3 limit scope | Per work order only | `qcr_raise` |

Smaller choices made while building, none of them an owner decision: a stale base at decision time is **refused** (the AC-QCR-018 wording) and the request stays `sent_to_client`, so the way out is to record it declined and raise a new one (FR-QCR-016's "returned for re-basing" cannot be done in the same transaction as a refusal, and `sent_to_client` cannot be withdrawn); a returned request reopens as a draft when anyone edits it; any author-role user may edit a draft and joins the editor set by doing so; the value change at decision is the difference of two once-rounded values (the version history uses the same rule, so changes always sum to current minus baseline).

## As built (migrations 1125..1129)

| Migration | Contents |
|---|---|
| 1125 `boq_quantity_versions` | `boq_quantity_versions` (append-only for every role; the cascade that deletes a contract line is the one exception), baseline backfill and insert trigger, `boq_item_quantity_locked`, the invoker-rights direct-edit guard (flag honoured only for the table owner), `setup_edit` versions |
| 1126 `quantity_overrun_detection` | `quantity_forecasts`, `qcr_figures` (one set-based read of C, P with its source, E), `quantity_overrun_notices` (the persisted told-once row), `qcr_evaluate_items` and the hooks on assessment quantities, claim lines, acceptance confirmation, daily-report validation, forecasts and contract quantity changes, `record_quantity_forecast` |
| 1127 `quantity_change_requests` | request, line, event and file tables (file table in the 0036/1027 shape, private bucket `quantity-change-files`), `organizations.quantity_change_limit` with audit, `qcr_raise`, `qcr_update_draft`, `qcr_submit`, `qcr_withdraw` |
| 1128 `quantity_change_approval` | `qcr_assert_approver`, `qcr_approve`, `qcr_return`, `qcr_record_sent`, `qcr_record_decision` |
| 1129 `quantity_change_reads` | `qcr_over_contract`, `qcr_work_order_budget`, `qcr_approval_state` |

Not built from the plan above: the `record_history_config` registration (M5): the request keeps its own append-only event table and the spec does not require the record-history catalog; the Administration-page placement of the limit (it sits on the quantity changes page for Admins instead); the version history on the project contract-line tables (it is on the request page, per line); a `quantityChange.json` rename (the namespace is `quantityChanges`).

## Traceability as built (each AC has one owning layer)

| AC | Layer | File |
|---|---|---|
| AC-QCR-001, 002 | pgTAP (owner); also referenced Unit | `supabase/tests/1126_quantity_overrun.test.sql`; `pmo-portal/src/lib/quantityChangeRules.test.ts` |
| AC-QCR-003 | pgTAP | `supabase/tests/1126_quantity_overrun.test.sql` |
| AC-QCR-004, 005, 006, 008, 009, 010 | pgTAP | `supabase/tests/1127_quantity_change_raise.test.sql` |
| AC-QCR-007 | pgTAP-style concurrency (two real sessions) | `supabase/tests/concurrency/quantity_change_requests.py` |
| AC-QCR-011..018, 030 | pgTAP | `supabase/tests/1177_quantity_change_approval.test.sql` |
| AC-QCR-019, 020, 021 | pgTAP | `supabase/tests/1174_boq_quantity_versions.test.sql` |
| AC-QCR-022 | pgTAP | `supabase/tests/1127_quantity_change_raise.test.sql` |
| AC-QCR-023 | Unit | `pmo-portal/src/lib/quantityChangeRules.test.ts` (and the record page test) |
| AC-QCR-024 | pgTAP | `supabase/tests/1127_quantity_change_raise.test.sql`, `1177_quantity_change_approval.test.sql`; isolation denominator |
| AC-QCR-025 | E2E | `pmo-portal/e2e/AC-QCR-025-raise-and-approve-on-a-phone.spec.ts` |
| AC-QCR-026 | E2E | `pmo-portal/e2e/AC-QCR-026-send-and-client-acceptance.spec.ts` |
| AC-QCR-027 | Unit (component) | `pmo-portal/pages/quantityChanges/QuantityChangeDetail.test.tsx` |
| AC-QCR-028, 029 | pgTAP | `supabase/tests/1126_quantity_overrun.test.sql`, `1127_quantity_change_raise.test.sql` |

Mutation checks run (each turned the named test red, then restored and green) are listed in the PR body; the ten run for this slice: editor set dropped, submitter dropped, role gate dropped, stale-base check dropped, limit `>=` to `>`, withdrawn-after-submission not counted, direct-edit guard off, version immutability off, lump-sum refusal off, Draft work-order value not raised; and the work-order lock removed (concurrency harness).

---

*Original plan (kept for the slice order and the screens still to design):*

> **Money / SoD tier: Director-dispatched, one fresh Orca worker per slice, ships alone (not batched).** Spec: `docs/specs/quantity-change-requests.spec.md`. Sign OD-QCR-1..10 and answer OQ-QCR-1..3 first. Builds on `boq_items` (0250, 0337), `work_order_lines`, `work_order_acceptances` (0337), `progress_assessment_quantities`, `progress_claim_lines` (0250), and the shipped daily-report tables `daily_site_reports`/`dsr_progress_lines` (1040/1041); the validated-quantity filter is `status = 'validated' and superseded_at is null and archived_at is null`, as in `work_order_validated_revenue` (1041) — already shipped, so no reconciliation wait.

## Migrations (numbers assigned by the Director; each with a `rollback/` file; RLS enabled and forced; `org_id` by `stamp_org_id` trigger, never from the client)

Described, not numbered. Every policy wraps helpers as `(select public.auth_org_id())`, `(select public.is_active_member())`, `(select public.auth_role())` so `supabase/tests/0646_rls_initplan.test.sql` stays green. Every function that is client-callable is `security definer set search_path = public`, calls `assert_is_active_member()`, `revoke all ... from public, anon` then grants execute to `authenticated`, and joins the definer allow-list that 0178 maintains.

- **M1 — quantity versions (append-only).** Table `contract_quantity_versions` (id, org_id, boq_item_id, version_no, quantity numeric(14,3) with the 0250 finite/positive check, source in `baseline|setup_edit|change_request`, change_request_id nullable, created_by default `auth.uid()`, created_at; unique `(boq_item_id, version_no)`). Backfill one `baseline` row per existing `boq_items` row. Trigger on `boq_items` insert appends version 1. Immutability trigger on the versions table raising 42501 for update and delete (no role bypass). No insert grant: rows come only from definer functions. Guard trigger on `boq_items` quantity update: allowed only when the session flag `pmo.applying_quantity_change` is set by the accept function, or when the item has no assessment quantity, no claim line and no confirmed acceptance line (then it appends a `setup_edit` version). Rollback drops triggers, then the table; `boq_items.quantity` is untouched so rollback is lossless for the live figure.
- **M2 — requests.** Tables `quantity_change_requests` (id, org_id, project_id, work_order_id, status check in the eight states, reason, `client_request_id` unique per org — a partial unique index `(org_id, client_request_id) where client_request_id is not null`, the 1040 `daily_site_reports_client_request` shape — author, `editor_ids uuid[]` (the **set** of everyone who edited, for FR-QCR-011's SoD test), submitted_by, approved_by/at, returned_reason, sent_on, client_reference, decided_on, decision, withdrawn_from, withdrawn_reason, created_at) and `quantity_change_request_lines` (request_id, boq_item_id, base_version_id, trigger_kind, trigger_figure, base_quantity, requested_quantity, line reason; unique `(request_id, boq_item_id)`). Partial unique index: one open request per contract item (`status` in draft..sent_to_client) enforced through a lines-side trigger. Attachments get their **own typed file table** `quantity_change_request_files` in the 0036 shape (parent FK, `title`, `file_path`, `uploaded_by_id`, `created_at`, `archived_at`, parent-org guard, org stamp trigger, org-read + write-role RLS) and a private bucket whose key carries the org as its first segment; there is no shared attachment table, and nothing is filed in `project_documents`. Select policy: own org, active member. No insert/update/delete grant to `authenticated`.
- **M3 — functions** (all definer): `raise_quantity_change_request(work_order, lines, reason, client_request_id)` (locks the `work_orders` row `for update`, counts requests excluding `withdrawn_from = 'draft'`, checks the limit, the trigger condition and that the item is not `lump_sum`, returns the request id and is idempotent on `client_request_id`), `edit_quantity_change_request` (appends the caller to `editor_ids`), `submit_quantity_change_request`, `approve_quantity_change_request` (SoD over author, the whole `editor_ids` set and submitted_by), `return_quantity_change_request`, `withdraw_quantity_change_request` (stamps `withdrawn_from`), `mark_quantity_change_request_sent`, `record_quantity_change_decision` (writes versions, `boq_items.quantity`, the allocation delta in one transaction; on a Draft work order also calls `set_work_order_value` with the delta × rate; on an Issued one records that the ceiling cannot move — OD-QCR-10; stale-base check), `record_forecast_quantity`, and read function `list_over_contract_items(project_id)` returning P, source, E, C per item in one indexed query. P's four sources are the queries named in the spec's Definitions (the item's own latest assessment row, the latest Confirmed acceptance per work order, non-withdrawn claims with no Cancelled invoice, and validated non-superseded non-archived daily reports joined through `work_order_lines`).
- **M4 — forecasts, notices and limit.** Table `contract_quantity_forecasts` (append-only, immutability trigger, no direct grants) and `quantity_over_contract_notices` (one row per `(boq_item_id, trigger_kind)`, holding figure, C and `notified_at`, cleared when the item returns to not-over) so FR-QCR-003's "once" is a row, not a hope. Column `organizations.quantity_change_limit integer null check (>= 0)`; `grant update (quantity_change_limit)` plus the Admin-only, active-member UPDATE policy shape of 0207/0231/0250 (0192 revoked the table-wide grant, so the column grant is the write half); audit trigger `log_audit('org.quantity_change_limit.change', ...)` following 0250's `audit_org_down_payment_item`.
- **M5 — history and notification.** Add the request table to `record_history_config` (captured status, reason, quantities typed `number` — the history renderer knows `money`/`number`/`date`/`timestamp`/`bool`/`ref`, not a `quantity` kind) and **add its arm to `record_history_visible`**, which raises for an entity type it does not know (0260). Over-contract notifications are inserted by the evaluation on the four write events named in FR-QCR-003, through `notify_workflow_user`, guarded by the notice row.

## Slice 1 — pure rules (Orca worker)

- [ ] Write the failing test `pmo-portal/src/lib/__tests__/quantityChangeRules.test.ts` with the hand-calculated fixture (AC-QCR-001, 002, 023): P is the greatest of four sources and names it; E > C triggers; exact equality is not over; value change uses `exactDecimal`; a `lump_sum` item is never over-contract. Run `npx vitest run src/lib/__tests__/quantityChangeRules.test.ts` and see it red.
- [ ] Implement `pmo-portal/src/lib/quantityChangeRules.ts` (`reportedProgress`, `isOverContract`, `versionValueChange`). Green.
- [ ] Component test `pmo-portal/src/components/__tests__/QuantityChangeActions.test.tsx` (AC-QCR-027): approve action absent for author, reason shown. Red, then implement `pmo-portal/src/components/QuantityChangeActions.tsx` reading the projected identity facts.

## Slice 2 — versions and the direct-edit guard (Director-dispatched Orca worker)

- [ ] pgTAP `supabase/tests/quantity_versions.test.sql` first: AC-QCR-019, 020, 021, 024 (versions table). Run chained under one lock: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/quantity_versions.test.sql'`. Red.
- [ ] M1. Green. Also run the existing 0337 and 0250 pgTAP files that touch `boq_items` (`supabase/tests/0337_contract_lines.test.sql`, `0337_contract_lines_api_guard.test.sql`) so the new guard breaks no shipped behaviour; fix the guard, never the old test.
- [ ] Update `pmo-portal/src/lib/db/progressBilling.ts` only if its `boq_items` update path must handle the 42501 "use a quantity change request" error; map the error in `classifyMutationError`.
- [ ] Mutation check: remove the immutability trigger, AC-QCR-019 must go red; restore.

## Slice 3 — request workflow, SoD and limit (Director-dispatched, ships alone)

- [ ] pgTAP `supabase/tests/quantity_change_requests.test.sql` first (all red): AC-QCR-003..018, 022, 024, 028..030. Tests seed two users per role to exercise author, **two successive editors**, submitter and a distinct approver; the concurrency test (AC-QCR-007) uses two connections (`dblink`, as 0163 does) against one work order.
- [ ] M2, M3, M4, M5 in that order, each with its rollback file. Chained run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/quantity_change_requests.test.sql supabase/tests/quantity_versions.test.sql'`.
- [ ] **Mutation checks (each must turn a named test red; restore after each):** (1) replace the author comparison in `approve_quantity_change_request` with `true` — AC-QCR-011 and 013 red; (2) drop the editor-set/submitter terms — AC-QCR-011 red; (3) remove the `for update` lock on the work order — AC-QCR-007 red; (4) change the limit comparison from `>=` to `>` — AC-QCR-006 red; (5) skip the stale-base check — AC-QCR-018 red; (6) write the version before the status check in the decision function — AC-QCR-017 red; (7) drop the `lump_sum` refusal — AC-QCR-029 red; (8) drop the `status = 'validated'` filter on daily reports — AC-QCR-028 red. Record the commands and the red output in the PR body.
- [ ] Rollback proof: apply each `rollback/*_down.sql` on a scratch reset and confirm `boq_items.quantity` values are unchanged.
- [ ] Data layer `pmo-portal/src/lib/db/quantityChangeRequests.ts` plus `__tests__/quantityChangeRequests.test.ts` (mocked), repository `src/lib/repositories/quantityChangeRequests.ts` (ADR-0017); never pass `org_id`. Read paths bounded and paginated (`scripts/check-unpaged-reads.mjs`).
- [ ] `pmo-portal/src/auth/policy.ts`: entity `quantity_change_request` with actions view, forecast, raise, edit, submit, approve, return, withdraw, record_client, set_limit; register in the role matrix (#902). `can()` mirrors the RPC; a test in `src/auth/__tests__/` proves the UI is not looser than the server.

## Slice 4 — screens (ui-implementer; `restructure` skill; `docs/ux/screen-rules.md`)

- [ ] Over-contract flag and "Raise change request" on contract lines (`pages/project-detail/tabs/WorkOrdersTab.tsx`, `pages/project-detail/WorkOrderLinesModal.tsx`) and on the work-order record page (`pages/WorkOrderDetail.tsx`, #2518; see `docs/plans/2026-11-20-work-order-record-page.md`); request count against the limit shown beside it.
- [ ] Request detail with status timeline, trigger snapshot, approve/return panel, send-to-client form (reference, date, attachment), decision form, and the per-item version history table. Use `EntityFormModal`/`useEntityForm`, `ConfirmDialog`, `classifyMutationError`.
- [ ] Admin setting for the request limit on the organisation settings side of Administration (Administration is one sectioned page at `/administration/:section`; add it to an existing section's content or a new section id in `Administration.tsx`'s `AdministrationSection`/`ORGANIZATION_SECTIONS`/`SECTION_LABEL_DEFAULTS`/`buildSectionLabels`), Admin-only, audited.
- [ ] Strings: `pmo-portal/public/locales/en/quantityChange.json` and `.../id/quantityChange.json` (Bahasa Indonesia), both complete; touched-route Bahasa test following `Incidents.bahasa.test.tsx`.
- [ ] `scripts/ux-proof.sh` on touched routes; one rendered review by the Director on rich seed, every state (empty, over, pending, returned, sent, accepted, limit reached).

## Slice 5 — journeys (Orca worker)

- [ ] `pmo-portal/e2e/AC-QCR-025-raise-and-approve.spec.ts` and `AC-QCR-026-client-decision-new-version.spec.ts`; read `docs/e2e-parallel-conventions.md` first and tag isolation. Use the two-user pattern for author and approver. Run `scripts/e2e-local.sh AC-QCR`.

## Traceability (each AC has one owning layer)

| AC | Layer | File |
|---|---|---|
| AC-QCR-001, 002 | pgTAP (owner) | `supabase/tests/quantity_change_requests.test.sql`; also referenced: Unit in `src/lib/__tests__/quantityChangeRules.test.ts` |
| AC-QCR-023 | Unit | `src/lib/__tests__/quantityChangeRules.test.ts` |
| AC-QCR-003..018 | pgTAP | `supabase/tests/quantity_change_requests.test.sql` |
| AC-QCR-019..021 | pgTAP | `supabase/tests/quantity_versions.test.sql` |
| AC-QCR-022, 024, 028..030 | pgTAP | `supabase/tests/quantity_change_requests.test.sql` |
| AC-QCR-025 | E2E | `e2e/AC-QCR-025-raise-and-approve.spec.ts` |
| AC-QCR-026 | E2E | `e2e/AC-QCR-026-client-decision-new-version.spec.ts` |
| AC-QCR-027 | Unit (component) | `src/components/__tests__/QuantityChangeActions.test.tsx` |

## ADR candidates (notes only; no ADR files in this plan)

- ADR candidate: contract quantity as append-only versions with `boq_items.quantity` as a server-written cache of the latest version.
- ADR candidate: client acceptance, not internal approval, is the event that changes a billable quantity; internal approval gates only submission.
- ADR candidate: no sole-operator exception for money-changing approval (differs from acceptance confirmation) if OD-QCR-3 is signed as proposed.
- ADR candidate (only if OD-QCR-10 is ruled the other way): a post-Issue work-order value amendment. That needs the ERP idempotency story for `issued_at`, so it is an ADR, never a line in this migration.

## Glossary (added to `docs/glossary.md` with the spec)

Quantity change request, contract quantity, quantity version, forecast quantity at completion (distinct from the cost-side estimate at completion), over-contract, request limit, internal approval. Disambiguate from PO variation (vendor side).

## Final gate (per CLAUDE.md local gate)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the directly touched vitest files, touched e2e journeys (`scripts/e2e-local.sh`), `node scripts/affected-e2e.mjs` for UI, `scripts/ux-proof.sh` on touched routes, and the touched pgTAP files under `scripts/with-db-lock.sh`. Reviewers: `spec-reviewer`, `code-quality-reviewer`, `security-auditor` (auth, RLS, money). The release PR to `main` runs the full suite; this change merges to `dev` alone.
