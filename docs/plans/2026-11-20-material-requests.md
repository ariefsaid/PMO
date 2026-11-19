# Material Requests Implementation Plan (#2524)

> Fresh Orca worker per slice; server slices Director-dispatched. Spec: `docs/specs/material-requests.spec.md` (sign OD-MRQ-1..6, answer OQ-MRQ-1..2 first). Reuse, don't re-invent: `stock_documents` (0413) and its posting engine, the ADR-0019 SoD pattern, `record_history` (0260).

## Migrations (numbers assigned by the Director; each with a rollback file; RLS + force RLS; `stamp_org_id`)
`material_requests`, `material_request_lines` (plan_qty snapshot, over_plan_reason), `approval_chain_steps` (org, position, role, label, only_over_plan), `material_request_steps` (snapshot per request: position, role, status, decided_by, acted_for, decided_at, reason), `approval_stand_ins` (delegator, stand_in, role, from, to), `org_settings` column or table `material_request_cutoff` (time). RPCs: `mrq_submit` (cut-off, over-plan reason, snapshot, idempotent), `mrq_decide_step`, `mrq_create_transfer` (called inside the final decide, one transaction, uses the existing stock-document create path), `mrq_set_stand_in`. Trigger or hook: transfer posted -> request `fulfilled`.

## Slice 1 — chain, stand-in, decide (Director, ships alone)
- [ ] pgTAP `supabase/tests/mrq_approval.test.sql`: AC-MRQ-002..006, 010, 011, 014 failing first.
- [ ] Migration + RPCs; run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/mrq_approval.test.sql'`.
- [ ] Mutation checks on the author rule and the one-step-per-person rule; restore; quote results.

## Slice 2 — submit, over-plan, cut-off, transfer
- [ ] pgTAP `supabase/tests/mrq_submit_transfer.test.sql`: AC-MRQ-001, 007, 008, 009, 012 (test time via a settable clock argument or `set_config`, never real time).
- [ ] RPCs `mrq_submit`, `mrq_create_transfer`; confirm the transfer is Draft and carries work-order reference.

## Slice 3 — repository and policy
- [ ] `pmo-portal/src/lib/db/materialRequests.ts`, `src/lib/repositories/materialRequests.ts`; `src/auth/policy.ts` actions; role-matrix registration (#902).
- [ ] Vitest for over-plan reason and queue filtering (AC-MRQ-001, 013).

## Slice 4 — screens (ui-implementer; `restructure`)
- [ ] `pages/MaterialRequests.tsx` (list + "waiting for me"), request form (lines, needed-by, over-plan reason), step timeline, stand-in settings, Admin chain editor under settings.
- [ ] en + id strings; states: empty, error, no approver, after cut-off.

## Slice 5 — acceptance
- [ ] `e2e/AC-MRQ-015-request-to-transfer.spec.ts` (read `docs/e2e-parallel-conventions.md`); `scripts/e2e-local.sh AC-MRQ-015`; `scripts/ux-proof.sh`.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest and pgTAP files.
