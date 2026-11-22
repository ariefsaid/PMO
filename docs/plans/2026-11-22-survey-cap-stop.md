# Plan: survey-cap-stop (part B, money path)
Migrations (range 1780-1783; none restates an existing function, so `check:restated-functions` is unaffected):
1. `supabase/migrations/1780_claim_quantity_over_cap_setting.sql` + `rollback/1780_..._down.sql`: column, Admin-only update policy, column grant, audit trigger (copy of 1176 section 1).
2. `1781_claimable_headroom_twin.sql` + rollback: `claimable_headroom(...)` (immutable pure), `survey_quantity_for_line(...)` seam (returns null), `work_order_line_headroom(wo, boq)` (reads facts: ordered from `work_order_lines`, accepted from latest Confirmed acceptance, claimed from live claims plus live opening balances, surveyed from the seam). All revoked from public, anon, authenticated; security definer, `search_path = public`.
3. `1782_claim_line_cap_trigger.sql` + rollback: `enforce_claim_line_cap()` BEFORE INSERT trigger on `progress_claim_lines` (reads the setting; `warn` returns immediately; `block` takes `lock_work_order_billing`, computes headroom excluding the claim itself, refuses with `CLM_OVER_CAP: ...`).
4. 1783 reserved, unused unless a probe fragment is needed.
Tests (written, orchestrator runs): `supabase/tests/1780_claim_quantity_over_cap.test.sql` covering AC-SCS-001..009.
Front end:
5. `pmo-portal/src/lib/db/orgs.ts` (or a small `claimCapSetting` repository next to `hidePrices`): get/set with `assertWriteLanded`; hook `src/hooks/useClaimOverCap.ts`.
6. `pmo-portal/pages/admin/OrgClaimOverCap.tsx` (+ test, EN/ID in `public/locales/*/administration.json`), mounted in `pages/Administration.tsx` beside `OrgDownPaymentItem` (`:320`); gate `can('manage','orgAccounting')`.
7. `pages/project-detail/ProgressClaimModal.tsx` `overClaimHelper`: when the setting is `block`, "will be refused" wording (keys in `projectTabs.json`, EN/ID); tests in `__tests__/ProgressClaimModal.test.tsx` (AC-SCS-010).
8. `public/locales/{en,id}/refusals.json`: `CLM_OVER_CAP` + `CLM_OVER_CAP_detail`; `FIGURES` entry in `src/lib/refusals.ts` for headroom/basis if the sentence carries them.
9. `pmo-portal/src/lib/supabase/database.types.ts`: `claim_quantity_over_cap` on organizations Row/Insert/Update, and the new functions, by hand in generated style. `historyLabels.ts`: label for the audit action. `docs/glossary.md`: "claim ceiling".
Gates: check:guards, typecheck, eslint on changed files, `vitest related` on changed files, one process at a time.
Mutation lines (to report): drop the `block` branch / flip `>` to `>=` / remove the lock call / count withdrawn claims; each must turn a named AC-SCS-003/005/008 assertion red.
