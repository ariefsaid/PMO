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

## Build notes (#2524 server + repository slices, 2026-11-19)

Built test-first on `feat/2524-material-requests` (base `feat/2517-work-order-cost-spine`). Defaults taken where the
spec asked for owner sign-off; each is a recommended default from the spec, not a new ruling:

- **OD-MRQ-1..6** applied as their stated defaults. The chain is set by an Admin; no chain is seeded, and submit is
  refused with `MRQ_NO_CHAIN` until one exists (fail closed).
- **OQ-MRQ-1 (plan):** the BoQ material allowances (0417) of the contract lines on the work order (0337
  `work_order_lines`), prorated by the work order's share of each line's quantity. No allowance means plan 0, so every
  line is over plan and needs a reason. `mrq_plan_for` gives the form the same figures `mrq_submit` snapshots.
- **OQ-MRQ-2 (source warehouse):** the final step's decider names it (`p_source_warehouse_id`); the destination is the
  request's site warehouse, else the project's only site warehouse. The draft is made by `create_stock_document`, so the
  decider must keep the source warehouse (or be an Admin); otherwise the whole decision rolls back (AC-MRQ-008).
- **Steps name a system role** (`user_role`). Purpose labels carry the job ("material coordinator"); there is no
  field-controller role, so every active member may raise a request.
- **Project time zone:** projects have none; the organisation's `default_timezone` is used (as `stock_org_today`).
- **History:** transitions go to an append-only `material_request_events` table (actor, stand-in-for, reason) rather
  than the 0260 registry, whose catalog gates would have had to classify every column of three new tables; the step
  rows keep each decision. Moving to 0260 later is additive.
- **Approval routing reuse:** the SoD pattern and real-role authority of ADR-0019/0243 are reused; the spend router
  itself routes by money amount and budget line, which a material request does not carry.
- **Not built here:** slice 4 (screens) and slice 5 (the AC-MRQ-015 journey). The spec ships the server slice alone,
  and a UI issue first takes the owner's sketch-glance.

Migrations 1000 (schema) and 1001 (RPCs); 1002–1003 unused. Proofs: `supabase/tests/mrq_approval.test.sql` (40),
`supabase/tests/mrq_submit_transfer.test.sql` (34), `pmo-portal/src/lib/db/materialRequests.test.ts`,
`pmo-portal/src/auth/policy.materialRequest.test.ts`. Mutation-checked: author rule, one-step rule, order rule,
stand-in window, over-plan reason (each red when disabled, green when restored).

## Build notes (#2524 UI slice, 2026-11-19)

Branch `feat/2524b-material-requests-ui`, on the server slice. No migrations. Screens (slice 4) and the journey (slice 5):

- **Routes** (every member; RLS scopes reads; core-marked in `scripts/check-module-completeness.mjs` until the owner decides a catalogue switch):
  `/material-requests` (tabs: Waiting for me / All requests, status filter), `/material-requests/new` and `/:requestId/edit`
  (phone-first form: project → work order, needed-by, items with plan / already requested / new total, over-plan reason),
  `/material-requests/:requestId` (chain with who acted and stand-in identity, lines against plan, history, approve / send back /
  reject, withdraw, transfer link, retry when approved without a transfer), `/material-requests/settings` (Admin edits the chain
  and cut-off; stand-ins set by the person away or an Admin).
- **Seams used:** `materialRequestRepository` through `useMaterialRequests` hooks; `can()` gates from `policy.ts`
  (`materialRequest`, `approvalChain`, `standIn`); the final step's decider names the source warehouse (OQ-MRQ-2 default) and the
  database refusal codes map to plain sentences (`materialRequestRefusal`).
- **Strings:** `public/locales/{en,id}/materialRequests.json`; computed keys avoided so the extractor sees every string.
- **Proofs:** Vitest `pages/MaterialRequests*.test.tsx` (AC-MRQ-001 form reason, AC-MRQ-003 author never sees Approve, AC-MRQ-013 queue,
  AC-MRQ-007 transfer link); e2e `e2e/AC-MRQ-015-request-to-transfer.spec.ts` (Engineer on a 390px phone, PM → Finance → Admin).
- **Not run here:** the e2e journey and `scripts/ux-proof.sh` need the local Supabase stack and a browser session; see the report.
