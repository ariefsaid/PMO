# Plan: edit a work order's billing checklist

Spec: `docs/specs/wo-checklist-edit.spec.md`. Branch: `feat/1124-billing-checklist-edit`. Migration range: 2180–2189; the implementation uses 2180 and restates its writer in 2181.

1. **Database proof** — `supabase/tests/2180_wo_billing_step_add.test.sql` owns the work-order checklist contract: add-step authorization and scoping (AC-WCE-001/003), save-as-template copying and later initialization (AC-WCE-002), separation from claims (AC-WCE-004), ordering and list limits (AC-WCE-005), and the organization setting (FR-WCE-006). The same transaction carries mutation-polarity checks for writer role, light-account refusal, organization-bound lookup, project-manager scope, current-step ordering, switch enforcement, and template-save authorization.
2. **Database changes** — `2180_wo_billing_step_add.sql` adds the writer. `2181_wo_checklist_edit_copy.sql` adds the organization switch (default off), its Admin-only audited setter, a null end-of-list sentinel resolved using the complete server-side list, and a server-side template copy that retains owner roles, hidden-from role keys, target days, optional flags, and document slots. Rollbacks are under `supabase/migrations/rollback/`. Definer inventory and isolation-denominator fragments cover the new public RPCs.
3. **Repository seam** — generated database types, the typed DAL, billing-stage repository contract and implementation, and `useBillingSteps` carry the read/write setting and the optional append position. The UI sends `null` for append so hidden or completed rows cannot shift the insert point.
4. **Screen and settings** — the work-order checklist actions are available only while the organization setting is enabled. Finance or an Admin saves through the database copy RPC; the browser does not rebuild a template from visible rows. The setting is exposed in Administration → Accounting and is editable by an Admin. English and Bahasa strings are in `billingSteps.json`.
5. **Pure rules and UI tests** — `mayChangeStepList` and `stepInsertPlaces` remain client-side affordance rules; save-as-template payload transformation was removed. Vitest covers the settings catalogue, repository, DAL, pure rules, and checklist section.

## Verification record

- `npm run check:guards` — pass.
- `npm run typecheck` — pass.
- `npx eslint --max-warnings=0 <changed TypeScript files>` — pass.
- Six touched Vitest files — 109 tests passed under Node 22.
- Spare-runner pgTAP: `2180_wo_billing_step_add.test.sql` — 142/142 passed. The supporting writer, tenant-isolation, light-account, and capability files `0178_anon_executable_definers`, `0002_tenant_isolation`, `2711_light_account_boundary_sweep`, `2712_light_account_write_guards`, `2715_light_guard_management_definers`, and `2716_role_capability_consumers` also passed.
- Rendered captures were produced for the work-order route and the Accounting setting at 1440px and 390px in English and Bahasa. The work-order route proof passed. The full Accounting route proof remains red on route-wide layout and word-count checks; its axe report has zero serious or critical findings. Captures remain in the ignored private evidence directory.
- `scripts/check-isolation-denominator.mjs --self-test` could not pass against the shared local database because its live catalog does not match this branch's manifest. The branch was not applied to that database. The remote `0002_tenant_isolation` pgTAP check passed.

The first spare-runner pass exposed a misplaced assertion that checked an after-position of 5 after a null append had already made position 5 valid. The assertion now runs before that append, where the position is truly beyond the four-row list; no production behavior or assertion was relaxed. The corrected pgTAP file passed all 142 assertions.
