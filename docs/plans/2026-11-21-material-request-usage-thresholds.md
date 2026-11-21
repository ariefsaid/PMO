# Plan: material request usage thresholds (#2686)

Spec: `docs/specs/material-request-usage-thresholds.spec.md`. Migrations 1330-1333 (1334 spare). Test-first; each migration has a rollback in `supabase/migrations/rollback/`.

## Migrations
- `1330_mrq_usage_threshold_settings.sql`: add `usage_warn_pct_1`, `usage_warn_pct_2` numeric(6,2) null to `material_request_settings` with check (1..1000, pct_2 > pct_1 when both); `mrq_set_usage_thresholds(p_pct_1 numeric, p_pct_2 numeric)` security definer, Admin only, modelled on `mrq_set_cutoff` (1001). Rollback `1330_..._down.sql`.
- `1331_mrq_usage_alerts.sql`: table `material_request_usage_alerts (id, org_id default+stamp trigger, work_order_id, item_id, slot smallint 1|2, pct numeric, use_qty, plan_qty, request_id, notified_user_id, created_at, unique (work_order_id, item_id, slot))`; RLS select for the organisation, no client insert/update/delete; internal `mrq_usage_check(p_request_id uuid)` (not client-callable) that, per line, reads plan/use via `mrq_plan_quantity` and `mrq_prior_quantity`, inserts missing crossings `on conflict do nothing`, and notifies through `notify_workflow_user` when a row was actually inserted. Rollback drops both.
- `1332_mrq_submit_usage_check.sql`: `create or replace` of `mrq_submit` (copy of the head body from 1001/later) adding one `perform public.mrq_usage_check(r.id)` after the plan loop, only when a threshold is set. Rollback restores the previous body.
- `1333_mrq_plan_for_thresholds.sql`: extend read RPC (`mrq_plan_for` / a sibling `mrq_usage_thresholds()`) so the form gets thresholds and reached percent without client math on secrets. Rollback restores.

## Frontend
- `pmo-portal/src/lib/db/materialRequests.ts` + repository: read thresholds, `setUsageThresholds`.
- `pmo-portal/pages/MaterialRequestSettings.tsx`: two number fields (Admin only, `can()` gated), shared form primitives, EN + Bahasa strings.
- `pmo-portal/pages/MaterialRequestNew.tsx` and `MaterialRequestDetail.tsx`: per-line non-blocking warning. Screens: restructure skill; screenshots (390 and 1440 px) under `docs/evidence/1215/2686/`.
- Glossary: "usage threshold".

## Tests and owning layer (per AC)
| AC | Test file |
|---|---|
| AC-MUT-001..007, 011 | `supabase/tests/mrq_usage_thresholds.test.sql` (pgTAP); mutation checks on the unset test, the slot uniqueness and the Admin guard |
| AC-MUT-008 | same pgTAP + `pmo-portal/pages/MaterialRequestSettings.test.tsx` |
| AC-MUT-009 | `pmo-portal/pages/MaterialRequestNew.test.tsx`, `MaterialRequestDetail.test.tsx` |
| AC-MUT-010 | `MaterialRequestSettings.test.tsx` |
Fragments: `supabase/tests/inventory/anon-executable-definers/mrq-usage-thresholds.txt` for client-callable definers; `scripts/isolation-probe-denominator.d/` fragment for the new table. No e2e: no cross-stack journey beyond the existing request flow.
