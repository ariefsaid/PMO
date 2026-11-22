# Plan: roles that decide (2026-11-22)

Spec: `docs/specs/roles-that-decide.spec.md`. Branch `feat/gap-material-roles-that-decide` (base `land/fix-1122`, merged
`feat/role-capabilities-one-gate` at ebaf4808). Migration range 1840-1849. Builders run no database, pgTAP, e2e or screenshot job;
the orchestrator runs them once per wave. Purchasing (part B) is money path: per CLAUDE.md it can ship as its own batch; it is in
separate commits so the Director can split it.

## Restated functions: source of each body (latest definition at head)

| Function | Latest textual definition | Plus dynamic guard | Change |
|---|---|---|---|
| `mrq_step_authority` | 1045:73 | none (helper) | new `p_job_role` arg (drop + create) |
| `mrq_pinned_to` | 1120 | none | new `p_job_role` arg (drop + create) |
| `mrq_decide_step` | 1045:98 | 1461 `perform public.assert_not_light();` | authority call, SoD identity |
| `mrq_waiting_for_me` | 1045:170 | none | returns `job_role` (drop + create) |
| `mrq_step_recipients` | 1336:15 | none | authority call |
| `mrq_set_step_pin` | 1045:38 | 1530 guard line | pin must fill the step |
| `mrq_set_chain` | 1001:157 | 1530 guard line | accepts `job_role` |
| `mrq_submit` | 1333 | 1461 guard line | snapshot copies `job_role` |
| `create_purchase_order` | 0712 | 1530 guard line | `or may_order_purchases(auth.uid())` |
| `transition_procurement` | 1017:13 | 1461 guard line | ordering branch |

Each restated body is copied from the row above **with** the guard line the dynamic rewrite inserted (it is in `pg_get_functiondef`
at head though no migration spells it); the orchestrator checks each against `pg_get_functiondef`. `npm run check:restated-functions`
must pass with no `-- drops:` marker. Policies restated from `pg_policies` at head (0646 / 0696 text for `purchase_orders_*`, 0350 for
the read scopes, checked against 0646's expected-text table).

## Tasks

### A. The deciding function (commit 1)
1. Red: `supabase/tests/roles_that_decide_function.test.sql` — AC-RTD-001 (28 keys x five people, null/unknown, inactive).
2. Green: `supabase/migrations/1840_holds_job_role.sql` — `holds_job_role(uuid, text)`; revoke from public/anon; grant authenticated,
   service_role. Rollback `supabase/migrations/rollback/1840_holds_job_role_down.sql` (drop function).
3. `supabase/tests/2711_light_account_boundary_sweep.test.sql`: add `('holds_job_role','helper', ...)`.
4. Red/green: `pmo-portal/src/auth/builtInRoles.ts` `holdsJobRole` + `pmo-portal/src/auth/builtInRoles.test.ts` AC-RTD-002 (same
   case table as the pgTAP file).

### B. Material-request steps (commit 2)
5. Red: `supabase/tests/roles_that_decide_mrq.test.sql` — AC-RTD-003, -004, -006, -007, -008, -009 (step half); AC-RTD-005 is the
   untouched `mrq_approval.test.sql`, `mrq_step_pin.test.sql`, `mrq_stuck_pin.test.sql`, `mrq_approver_inbox.test.sql`.
6. Green: `supabase/migrations/1841_mrq_job_role_steps.sql` — columns `job_role` on `approval_chain_steps`, `material_request_steps`,
   `approval_step_pins` (FK `built_in_roles(key)`); restated functions per the table. New refusal `MRQ_JOB_ROLE_OFF`.
   Rollback `rollback/1841_mrq_job_role_steps_down.sql`: restores the 1045/1120/1336/1001/1333 bodies (with guard lines), drops columns.
7. DAL/repository: `pmo-portal/src/lib/db/materialRequests.ts` (`ChainStepInput.jobRole`, `listApprovalChain`, waiting rows, pins),
   `src/lib/repositories/materialRequests.ts`, `src/hooks/useMaterialRequests.ts`; tests `src/lib/db/materialRequests.test.ts`,
   `src/hooks/__tests__/useMaterialRequests.test.tsx`. Generated types: orchestrator regenerates `src/lib/supabase/database.types.ts`
   after the wave's reset; the builder writes the matching shape so `check:typed-dals` stays zero and no cast is added.
8. UI: `pmo-portal/pages/MaterialRequestSettings.tsx` chain editor — job-role `SelectField` grouped by tier (shown while
   `built_in_roles_enabled`), access level read-only; `pages/project-detail/ProjectApprovalPins.tsx` candidates by `holdsJobRole`.
   Tests `pages/MaterialRequestSettings.test.tsx` AC-RTD-014. Strings `public/locales/{en,id}/materialRequests.json`. Restructure
   skill, DESIGN.md tokens, 390px + 1440px (captures by the orchestrator).
9. Refusals: `MRQ_JOB_ROLE_OFF` in `public/locales/{en,id}/refusals.json`, `materialRequests.ts` REFUSALS map. AC-RTD-016.

### C. Purchasing (commits 3-4, money path)
10. Red: `supabase/tests/roles_that_decide_purchasing.test.sql` — AC-RTD-009 (setting half), -011, -012, -013.
11. Green: `supabase/migrations/1842_purchase_order_job_roles.sql` — `purchase_order_settings.order_job_roles`, catalogue-key check
    (trigger), `po_set_order_job_roles(text[])` (Admin, setting gate, `PO_JOB_ROLE_OFF` / `PO_ORDER_ROLE_INVALID`),
    `may_order_purchases(uuid)`; restated `create_purchase_order`, `transition_procurement`; altered `purchase_orders_insert` /
    `_update` (helpers wrapped `(select ...)`). Rollback `rollback/1842_purchase_order_job_roles_down.sql`.
12. `supabase/migrations/1843_purchasing_read_scope_order_roles.sql` — the 0350 §1-§3 restrictive read scopes gain
    `or (select public.may_order_purchases(auth.uid()))`; §4 money tables untouched. Rollback restores the 0350 text.
13. `2711` sweep: add `may_order_purchases`, `po_set_order_job_roles` (or guard it in-body), check `2716` still green.
14. FE: `src/lib/db/purchaseOrderSettings.ts`, `src/hooks/usePurchaseOrderSettings.ts`, `pages/admin/PurchaseOrderSettingsSection.tsx`
    (multi-select of job roles, note on Q1 consequence), `src/auth/policy.ts` procurement `view`/`transition` to Ordered for a filler,
    `src/components/shell/Rail.tsx` procurement nav. Tests: the section test, `policy` test, AC-RTD-015. Strings
    `public/locales/{en,id}/administration.json`, refusals.

### D. Docs (commit 5)
15. `docs/glossary.md`: **Job role**, **Fills a job role**, **Ordering job roles**; `docs/specs/builtin-role-set.spec.md` §5 points
    at this spec; `docs/specs/material-requests.spec.md` FR-MRQ-005/007/023 name job roles.
16. E2E: `pmo-portal/e2e/AC-RTD-017-job-role-approval-step.spec.ts` (serial lane, isolation tag per `docs/e2e-parallel-conventions.md`).

## Traceability

| AC | Owning test |
|---|---|
| AC-RTD-001 | `supabase/tests/roles_that_decide_function.test.sql` |
| AC-RTD-002 | `pmo-portal/src/auth/builtInRoles.test.ts` |
| AC-RTD-003..009 | `supabase/tests/roles_that_decide_mrq.test.sql` (005: existing mrq files) |
| AC-RTD-010 | `supabase/tests/mrq_submit_transfer.test.sql:62-86` (existing) |
| AC-RTD-011..013 | `supabase/tests/roles_that_decide_purchasing.test.sql` (013 also existing 0350 test) |
| AC-RTD-014 | `pmo-portal/pages/MaterialRequestSettings.test.tsx` |
| AC-RTD-015 | `pmo-portal/pages/admin/PurchaseOrderSettingsSection.test.tsx`, `pmo-portal/src/auth/policy` tests |
| AC-RTD-016 | `scripts/check-refusal-codes.mjs` + locale files |
| AC-RTD-017 | `pmo-portal/e2e/AC-RTD-017-job-role-approval-step.spec.ts` |

## Gates (builder, in `pmo-portal/`)

`npm run check:guards` · `npm run typecheck` · `npx eslint --max-warnings=0 <changed files>` · `npx vitest related --run <changed
source files>`. Orchestrator: `supabase db reset` + `supabase test db` on the three new files, the four mrq files, `0350`, `2711`,
`2716`; the e2e journey; captures of the two settings screens at 390px and 1440px; type regeneration.
