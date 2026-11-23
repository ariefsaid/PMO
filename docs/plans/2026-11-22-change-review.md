# Plan: change-review (spec `docs/specs/change-review.spec.md`)

Migrations 1810-1819 only. Every function body restated below comes from the latest migration defining it (grep of all migrations: highest number wins): `qcr_assert_approver` 1177, `qcr_submit` 1176, `qcr_approval_state` 1178 with the `assert_not_light` line 1219 rewrote into the database (verify with `pg_get_functiondef` before running). The orchestrator verifies each with `pg_get_functiondef`.

## Tasks (test first)

1. **pgTAP (write first, red):** `supabase/tests/1810_change_review.test.sql` covering AC-CHR-001..007 (the limit is untouched; 1127 is unchanged); update the steps of `1177_quantity_change_approval.test.sql` (the refusal messages of approve/return now carry `QCR_NOT_APPROVER:` / `QCR_SOD_AUTHOR:`; the goal, a refusal with 42501, is kept). Fixtures give two profiles a `built_in_role` key; enabling the key needs `built_in_roles_enabled` on the organisation (1201/1202).
2. **Migration `supabase/migrations/1810_change_review_approver_roles.sql`** (rollback `supabase/migrations/rollback/1810_change_review_approver_roles_down.sql`):
   - `organizations.quantity_change_approver_roles text[] not null default '{}'`; column grant `update (quantity_change_approver_roles)` plus an Admin-only active-member UPDATE policy in the 1176 limit-policy shape, `(select ...)`-wrapped helpers; a before-update trigger rejecting any key absent from `built_in_roles` (`QCR_APPROVER_ROLE_UNKNOWN`); an audit trigger in the shape of `audit_org_quantity_change_limit` (`org.quantity_change_approver_roles.change`, before and after).
   - `qcr_may_approve_role(p_org uuid)` (security definer, stable): true when `auth_role() in ('Admin','Executive','Finance')` or the caller's `actor_built_in_role()` is in that organisation's list. One copy of the role rule.
   - Restate `qcr_assert_approver` (calls it; refusals `QCR_NOT_APPROVER:` and `QCR_SOD_AUTHOR:`, same SoD condition) and `qcr_approval_state` (role check and `eligible_approver_exists` both through the same rule; the existence query joins profiles by role or listed built-in role).
   - Restate `qcr_submit` so the people told are those who may review (base approver levels or a listed role, excluding the author, editors and submitter).
   - The setting trigger also refuses light-account keys (`QCR_APPROVER_ROLE_LIGHT`).
   - `scripts/isolation-probe-denominator.d/` fragment: the new function `qcr_may_approve_role(uuid)` added to a new `1810-change-review.json` (follow `2578-quantity-change.json`). No new table.
3. **Types:** hand-edit `pmo-portal/src/lib/supabase/database.types.ts`: `organizations` Row/Insert/Update gain `quantity_change_approver_roles: string[]` (Insert/Update optional); Functions gain `qcr_may_approve_role`.
4. **Refusals:** `pmo-portal/public/locales/en/refusals.json` and `.../id/refusals.json`: `QCR_NOT_APPROVER`, `QCR_SOD_AUTHOR`, `QCR_APPROVER_ROLE_UNKNOWN`, `QCR_APPROVER_ROLE_LIGHT`; a case in `refusals.test.ts`. Each sentence says what to do next.
5. **DAL/hook:** in `pmo-portal/src/lib/db/quantityChanges.ts` add `getApproverRoles`/`setApproverRoles` beside `getLimit`/`setLimit` (generated types, no casts), repository seam, hook in `pmo-portal/src/hooks/useQuantityChanges.ts`; tests in `quantityChanges.test.ts`.
6. **UI:** `pmo-portal/pages/quantityChanges/QuantityChangeDetail.tsx`: show approve/return when the server's `approval.data.can_approve` is true, not only the static `can('approve')` role set (AC-CHR-009); settings control for the reviewer-role list beside the limit (Admin edit, others read; shared form primitives, tokens, EN + ID strings, 390px and 1440px). `policy.ts` `QCR_APPROVER` stays the base set (UX only; the server decides). Update `quantityChange.policy.test.ts` only if its goals shift (they should not).
7. **Gates:** `npm run check:guards`, `npm run typecheck`, `npm run check:restated-functions`, `node scripts/check-refusal-codes.mjs`, eslint on changed files, `npx vitest related --run` on changed sources.

## Mutation checks (for the orchestrator)
- In `qcr_assert_approver`, make the SoD condition `if false then` : AC-CHR-003 must go red.
- In `qcr_may_approve_role`, return true unconditionally: AC-CHR-001 and AC-CHR-004 must go red.
- In `qcr_submit`, drop the `qcr_profile_may_approve(...)` condition in the notification loop: AC-CHR-006 must go red.

## Screenshots to capture later
Request detail pending approval as a listed-role user (approve and return shown); as author (action absent, reason shown); settings control (Admin and non-Admin); 390px and 1440px.
