# Cost and Schedule Performance Indices Implementation Plan (#2597)

> Fresh Orca worker per slice. Spec: `docs/specs/work-order-performance-indices.spec.md`. Read-only money path; no posting, no SoD change, no stored figure. **Ships alone** (a wrong index is a wrong decision); Director-dispatched, three reviewers. OD-CSP-1..8 take the spec's recommended defaults; owner's panel sketch-glance precedes the panel slice. Target 15 December 2026. Builds on the daily site report (`daily_site_reports`/`dsr_progress_lines` 1040, `work_order_validated_revenue` and `dsr_may_see_revenue` 1041), plan versus actual (`work_order_cost_amounts` 0999, `pmo-portal/src/lib/workOrderPlanVsActual.ts`, `pmo-portal/src/lib/db/workOrderFinance.ts`), `work_order_billing.order_net` (0337), `native_org_today` (0275) and the S-curve (`pmo-portal/src/lib/delivery/sCurve.ts`, `pmo-portal/pages/project-detail/ProjectSCurve.tsx`).

## Migration 1285: organisation settings (coordinator change 21 Nov)
`supabase/migrations/1285_performance_indices_settings.sql`: `organizations.performance_indices_enabled boolean not null default false`, `performance_band_low numeric(3,2) not null default 0.90`, `performance_band_high numeric(3,2) not null default 1.10`, `check (performance_band_low > 0 and performance_band_low < 1 and performance_band_high > 1)`; `grant update (performance_indices_enabled, performance_band_low, performance_band_high) on public.organizations to authenticated` (the existing own-org, active-member, Admin-only update policy applies, as 0231/0234). Rollback `rollback/1285_performance_indices_settings_down.sql`. pgTAP `supabase/tests/performance_indices_settings.test.sql` owns AC-CSP-019 and the validation half of AC-CSP-020. Admin UI: `pmo-portal/pages/admin/OrgPerformanceIndices.tsx` (switch and two band fields, `can()`-gated) mounted where `OrgProjectNumberPattern` is mounted, via `pmo-portal/src/lib/db/orgs.ts`. The panels render only when the switch is on (AC-CSP-018, `PerformanceIndices.test.tsx`/`ProjectPerformance.test.tsx`); the reading uses the bands (AC-CSP-020 unit, `workOrderPerformance.test.ts`).

## Migration 1286: the read (number 1286 from the assigned range 1285-1289)
One migration, `supabase/migrations/1286_work_order_performance.sql`, additive. It returns `{"enabled": false}` and nothing else when the organisation switch is off, and includes `bands` otherwise: `get_work_order_performance(p_project_id uuid, p_as_of date default null)` returning one `jsonb` (per-work-order rows plus the project total). No table, column or grant change.
- Gate first: `is_active_member()`, role in Admin, Executive, Finance or the project's Project Manager, **and** `dsr_may_see_revenue(p_project_id)`; else raise `42501`. Project in the caller's org, else `P0002`. `security definer`, `set search_path = public, pg_temp` (it reads `dsr_progress_lines` for validated lines the same way `work_order_validated_revenue` does); `revoke all ... from public, anon; grant execute ... to authenticated`.
- As-of = `coalesce(p_as_of, native_org_today(org))`; `native_org_today` is defined in 0275 and reads `organizations.default_timezone`.
- EV per work order: sum of `dsr_progress_lines.frozen_amount` joined to `daily_site_reports` where `status = 'validated'`, `superseded_at is null`, `archived_at is null`, `work_date <= as-of`; count lines with null `frozen_amount` as `unrated_lines`.
- PV per work order: BAC (`work_order_billing.order_net`) x planned fraction from `work_orders.start_date`/`end_date`, computed in integer cents with half-up; null when a date is missing or `end_date < start_date`.
- AC per work order: from direct rows of `work_order_cost_amounts(p_project_id)` with `reason = 'counted'`, matching currency, and `occurred_on <= as-of`; `unresolved-direct` or an undated counted direct row makes AC incomplete. Commitment, stocked, transfer, unposted, unrated and shared/unassigned rows do not count as actual direct cost. A counted direct cost in another currency makes AC not comparable. The read is refused for callers outside the revenue-and-cost role gate; do not return a partial `restricted` figure.
- Status rules: `Issued` and `Closed` get figures (a Closed work order's BAC is its closing value; actual EV/AC are capped at the earlier of the requested as-of date and its organisation-local `closed_at` date; PV still uses `end_date`); `Draft` and `Cancelled` are listed as excluded with a reason. The current 0193 project currency guard requires all a project's work orders to use the project's currency.
- Project total: the read returns per-work-order rows; the browser (`deriveProjectPerformance`) forms the ratio of exact sums over complete Issued/Closed rows and counts the excluded; bound 500 work orders, `truncated` and an omitted-work-order count. Preserve the `work_order_cost_amounts` `reason` distinctions and refuse a complete AC when a counted direct row has no date.
- Returns amounts as exact decimal strings; ratios are computed in the browser pure function from integers, never in float.
- **Rollback:** `supabase/migrations/rollback/1286_work_order_performance_down.sql` = `drop function if exists public.get_work_order_performance(uuid, date);`.
- ADR: none expected; record one only if the owner rules a different plan basis (OD-CSP-1) because every future schedule figure would share it.

## Slice 1: pure derivation (Orca)
- [ ] Write first `pmo-portal/src/lib/workOrderPerformance.test.ts` with the hand-calculated fixture and AC-CSP-001..005, then `pmo-portal/src/lib/workOrderPerformance.ts` exporting `deriveWorkOrderPerformance(row)` and `deriveProjectPerformance(rows)`. Integer cents via `parseExactCents`/`formatExactCents` from `pmo-portal/src/lib/exactDecimal.ts`; ratio of sums; half-up two decimals; every undefined case a distinct state (no cost yet, no dates, unrated lines, incomplete AC, not comparable). Verify: `cd pmo-portal && npx vitest run src/lib/workOrderPerformance.test.ts`.
- [ ] Money display reuses `moneyText`/`moneyUnits` from `pmo-portal/src/lib/projectFinances.ts` and `formatExactMoney` from `pmo-portal/src/lib/format.ts`; add nothing new unless a test shows a gap.

## Slice 2: database read (Orca)
- [ ] pgTAP `supabase/tests/work_order_performance.test.sql`: AC-CSP-006..015 and 017 (fixtures: reports in draft, submitted, returned, validated and a superseded validated; a validated line with no rate; lines on, before and after the as-of date; the hand-calculation fixture seeded through rates and cost lines plus commitment, stocked and unposted rows; a counted direct cost in a second currency; a counted direct cost without a date; Closed with closing value and progress/cost after close, Draft, Cancelled; a UTC+7 organisation at a month boundary; Engineer, Viewer, another project's Project Manager, an offboarded account, organisation B; more than the row bound). AC-CSP-009 also asserts counted direct AC equals the plan-versus-actual row. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/work_order_performance.test.sql'`.
- [ ] Migration as above. Mutation check (spec): add `submitted` to the status filter (AC-CSP-006 red), drop the as-of bound (AC-CSP-007 red), remove the role gate (AC-CSP-013 red), average instead of ratio of sums (AC-CSP-005 red); restore.
- [ ] `pmo-portal/src/lib/db/workOrderPerformance.ts` (typed read; every figure validated, a missing or non-numeric one is an error, never 0, as `pmo-portal/src/lib/db/workOrderBilling.ts`), repository `pmo-portal/src/lib/repositories/workOrderPerformance.ts` (ADR-0017), hook `pmo-portal/src/hooks/useWorkOrderPerformance.ts`, regenerate `pmo-portal/src/lib/supabase/database.types.ts`. Unit tests with a mocked client for error classification.

## Slice 3: panels (ui-implementer; `restructure` skill and `docs/ux/screen-rules.md`)
- [x] Owner sketch-glance replaced by phone and desktop screenshots in `docs/evidence/1215/2597/`.
- [ ] `pmo-portal/pages/work-order-detail/PerformanceIndices.tsx` inside `PlanVsActualSection.tsx` (figures, text readings, as-of date, drill-down to the validated reports, cost lines and the two plan dates); `pmo-portal/pages/project-detail/ProjectPerformance.tsx` beside `ProjectSCurve` in `pmo-portal/pages/project-detail/ProjectSections.tsx`, gated by the same `can()` as plan versus actual (UX only). One basis line and one hidden-figures line per panel. `ProjectSCurve` and `sCurve.ts` stay unchanged.
- [ ] Strings: add to `pmo-portal/public/locales/en/workOrderPva.json` and `.../id/workOrderPva.json` (already registered for `/work-orders/:id` in `pmo-portal/App.tsx`); add the project namespace entry where `ProjectSections` strings live. Bahasa per OQ-CSP-3.
- [ ] E2E `pmo-portal/e2e/serial/AC-CSP-016-project-performance-indices.spec.ts` (serial: it switches the organisation setting on) (Finance user; seeded validated reports and cost; assert both indices beside the curve and a work-order row opens its page with the same figures). Read `docs/e2e-parallel-conventions.md` first and tag the isolation class.
- [ ] Unit/RTL `pmo-portal/pages/work-order-detail/PerformanceIndices.test.tsx`: hidden-figure reasons, truncation line, text readings; behaviour only, no look-pinning.
- [ ] `scripts/ux-proof.sh` on the project page and `/work-orders/:id`.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-CSP-001..005, 020 (reading) | Unit | `pmo-portal/src/lib/workOrderPerformance.test.ts` |
| AC-CSP-018 | Unit (RTL) | `pmo-portal/pages/work-order-detail/PerformanceIndices.test.tsx` (covers both panels), `pmo-portal/src/lib/db/workOrderPerformance.test.ts` (the off response) |
| AC-CSP-019, 020 (validation) | pgTAP | `supabase/tests/performance_indices_settings.test.sql` |
| AC-CSP-006..015, 017 | pgTAP | `supabase/tests/work_order_performance.test.sql` |
| AC-CSP-016 | E2E | `pmo-portal/e2e/serial/AC-CSP-016-project-performance-indices.spec.ts` (serial: it switches the organisation setting on) |

`PerformanceIndices.test.tsx` also covers the AC-CSP-015 truncation presentation; pgTAP remains the owning layer for the bounded server response. The UI hides AC-CSP-013 callers based on the same `can()` check, while pgTAP owns its server refusal.

## Glossary and docs
- [ ] `docs/glossary.md`: earned value (validated progress at contract rate), planned value, cost performance index, schedule performance index; note beside Left to bill and Remaining work that these are different quantities.
- [ ] Update the roadmap issue (#1571) and map #2516 in the session the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file and e2e journey (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh` on the touched routes. No full local suite.
