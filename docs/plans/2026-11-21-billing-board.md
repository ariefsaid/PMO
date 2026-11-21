# Billing Board Implementation Plan (#2681)

> Status: plan (phase 1), awaiting approval. Spec: `docs/specs/billing-board.spec.md`. Stacked on `feat/2680-claim-billing-steps`. Gate change: write pgTAP and e2e, do not run db reset, pgTAP, e2e, screenshots or mutations; run check:guards, typecheck, eslint on changed files, vitest on touched tests. Executor: Orca worker, bounded slice, no money write (read-only view).

## Migrations
- **1370 `billing_board_read`**: `billing_board(p_project uuid default null) returns table(claim_id, project_id, project_name, work_order_id, wo_number, claim_created_at, step_count, steps_done, current_stage_id, current_position, current_name, owner_role, started_on, completed_on_last, target_days, target_on, due_on, all_done, today)`; `language sql stable security invoker`; join `progress_claims` (not withdrawn) to `claim_billing_stages`, a `lateral` first-open-step pick (order by position), left join `work_orders` for the number; exclude invoiced claims; `order by` current step `started_on` nulls last, `limit 501`. `today` = `native_org_today(org)` so the client uses the server calendar. Due inline as `coalesce(target_on, started_on + target_days)`. Rollback `rollback/1370_billing_board_read_down.sql` drops it. **1371 unused.**
- No table, no definer, so no isolation fragment and no anon-definer inventory entry; run the denominator check on the wave to confirm it is clean.

## Slices (test first)
1. **Pure** `pmo-portal/src/lib/billingBoard.ts` + `billingBoard.test.ts` (AC-BBD-008/009/010): `groupBoard(rows)` -> columns (OD-BBD-1), card age and overdue via `stageAgeDays`/`stageDaysPastTargetDate`, sort.
2. **pgTAP** `supabase/tests/1370_billing_board.test.sql` (AC-BBD-001..007).
3. **Data seam**: `src/lib/db/billingBoard.ts` (RPC, validates every field, no defaults for missing figures), `src/lib/repositories/billingBoard.ts`, `src/hooks/useBillingBoard.ts`; add to the unpaged-reads allowlist only if the guard flags it, with a reason.
4. **Screen** `pmo-portal/pages/BillingBoard.tsx` + `BillingBoard.test.tsx` (AC-BBD-011..014): read `.claude/skills/restructure/SKILL.md` and `docs/ux/screen-rules.md` first; columns on desktop, stacked sections on phone; shared Combobox for the project filter; strings en and id; route `/finance/billing-board` in `App.tsx` for the four roles.
5. **Entry link** on `pages/Receivables*` header, shown only when the hook returns rows (AC-BBD-015); existing Receivables tests untouched.
6. **E2E** `pmo-portal/e2e/AC-BBD-016-billing-board.spec.ts` (read `docs/e2e-parallel-conventions.md`; isolation tag), written not run.
7. **Docs**: `docs/glossary.md` (EN and ID), cross-reference in the #2680 spec, roadmap #1571 note.

## Traceability
| AC | Layer | File |
|---|---|---|
| AC-BBD-001..007 | pgTAP | supabase/tests/1370_billing_board.test.sql |
| AC-BBD-008..010 | unit | pmo-portal/src/lib/billingBoard.test.ts |
| AC-BBD-011..014 | unit (RTL) | pmo-portal/pages/BillingBoard.test.tsx |
| AC-BBD-015 | unit (RTL) | the Receivables entry-link test (new file beside the page) |
| AC-BBD-016 | e2e | pmo-portal/e2e/AC-BBD-016-billing-board.spec.ts |

## Gates (phase 2)
`npm run check:guards`; `npm run typecheck`; `npx eslint --max-warnings=0 <changed>`; `npx vitest run <touched tests>`. pgTAP, denominator, e2e and screenshots on the wave.
