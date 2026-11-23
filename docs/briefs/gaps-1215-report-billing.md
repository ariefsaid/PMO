# Lane gap-billing — state report (22 Nov 2026)

Lane integration branch: `lane/gap-billing-int`. Base merged in: `origin/land/fix-1122` at `4e860a93c`.
Open questions: `docs/briefs/gaps-1215-questions-billing.md`. Screenshots: `docs/evidence/gaps-1215/<slug>/` (desktop 1440 and phone 390).

## Wave proof on the lane (run by the orchestrator, fresh `db reset`, lane head before this report)
- `supabase test db` (whole suite): `Files=1020, Tests=24347 … Result: PASS`
- Field-account sweeps 2711, 2713, 2715: pass (inside the whole suite).
- `node scripts/check-isolation-denominator.mjs`: red only on base or dependency functions, none from this lane: `dsr_withdraw`, `my_decision_standing`, `my_waiting_decisions`, `person_mark_left`, `set_work_order_check_in_area` (base fix round) and `may_see_medical_documents` (the merged role-capability commit). The self-test refuses to run until those manifest entries exist.
- `scripts/isolation-proof.sh --self-test`: ok.
- Journeys, `E2E_WORKERS=1 … scripts/e2e-local.sh AC-BPM-008 AC-ICM-013 AC-WML-007 AC-WBS-012 AC-SCR-014`: `15 passed (2.1m)`.
- `npm run typecheck`: 0 errors (needs `NODE_OPTIONS=--max-old-space-size=6144` in this sandbox). `npm run check:guards`: exit 0. Vitest on the 39 test files the lane changed: `515 passed`.
- A security read was done on every money, approval or access item. Every finding from it was fixed and re-proved before that item's done ref.

## State per item

### billing-steps — VERIFIED (done ref `cloud/done/gap-billing-wo-steps`)
- Branch `feat/gap-billing-wo-steps`, head `03b01c99b`. (`feat/gap-billing-billing-steps` holds a superseded spec from an earlier design: nothing to merge.)
- **Before:** steps existed only on a claim, copied when the claim was raised. Survey and quality staff, at Engineer level, could neither read nor act on them. Owners could be only one of the five access levels.
- **Now:**
  - When a work order is issued, it gets an advisory billing-step list from the organisation's default template. Each step has an owner role (built-in role), an optional named person, target days, attachments and a status.
  - The list shows on the work-order page and as rows on the billing board, and a claim links to it.
  - Who can read and act is decided by two rights, "see billing steps" and "run billing steps", plus a per-step hidden-from role list. That list is how a quality role is kept from the certified-quantity step.
  - The step's holder is told in-app when the step opens; email goes through the existing billing-step event switch. Their waiting list shows their steps.
  - The invoice gate and the claim steps are unchanged.
- **Spec and plan:** `docs/specs/billing-steps.spec.md`, `docs/plans/2026-11-22-billing-steps.md`. ACs AC-WBS-001..012.
- **Settings and defaults:** organisation default template = none, so no list is made. Template step owner role key = none; hidden-from = empty. Default holders of the two rights are catalogue data (spec section 2a).
- **Tests whose steps changed:**
  - 2711: merge of the allowlist shape plus three helper entries.
  - 2716: catalogue string.
  - 1200: two assertions.
  - `BillingStepTemplatesModal.test.tsx`: payload gains two fields, plus a test that a save no longer submits the outer Billing terms form, a base bug fixed here.
- **Mutation checks:** run by the orchestrator. View gate, run gate, hidden-from read and field-account refusal each turned 1770 red and went back to green. After the security fixes the builder ran: strict booleans, owner scope on a manager-level role, and document category visibility.
- **Migrations:** 1770–1775.

### survey-cap — VERIFIED in three parts
- **Part A, warning:** `feat/gap-billing-survey-cap-warn` `6c3f2fe37`, done ref pushed.
  - Before: the claim form pre-filled accepted minus claimed but never warned.
  - Now: a claim line above what is still claimable warns in words and colour, and submit is not blocked.
  - Spec: `docs/specs/survey-cap-warn.spec.md`.
- **Part B, database stop:** `feat/gap-billing-survey-cap-stop` `565e307a1`, done ref pushed. Money path, own branch.
  - New setting `organizations.claim_quantity_over_cap` = `warn` (default, today's behaviour) or `block`. Admin-only, audited.
  - On `block`, the database refuses a claim line over its ceiling (`CLM_OVER_CAP`, EN and ID) under the work-order billing lock.
  - The ceiling is surveyed, else accepted, else ordered, less live claims and opening balances.
  - Spec: `docs/specs/survey-cap-stop.spec.md`.
  - Mutation checks by the orchestrator: mode bypass, the `>`/`>=` boundary, withdrawn claims counting, and lock removal each went red.
- **Part C, survey record:** `feat/gap-billing-survey-cap-record` `70fbe914b`, done ref pushed.
  - Each record is per work order and line: date, who took part (as data, including typed names), surveyed quantity, quality-ready quantity no greater than surveyed, and the survey sheet (required to confirm).
  - Confirmation is by Finance or an Admin who is not the recorder. A correction supersedes the record it corrects.
  - Confirmed surveys sum to the certified figure, which feeds the claim ceiling in A and B. The claim form shows "Surveyed X, of which quality-ready Y".
  - Spec: `docs/specs/survey-cap-record.spec.md`.
  - Mutation checks by the builder on the lane database: separation of duties, quality-ready limit, the confirmed-only sum, supersede, the field-account read, document visibility, and the sheet requirement.
- **Migrations:** 1780–1782 and 1784–1787.

### billed-per-month — VERIFIED (done ref pushed)
- Branch `feat/gap-billing-billed-per-month` `e487b53b6`.
- **Before:** per-month figures existed only on Finance's work-in-hand screen (six complete months).
- **Now:** the work-order Billing panel lists billed per month, from the first billed month to the current month to date, for people who may view sales invoices.
- It uses one shared calculation, `work_order_billed_months_core`, which work in hand now calls too.
- Spec: `docs/specs/billed-per-month.spec.md`. Migration 1790.

### missing-list — VERIFIED (done ref pushed)
- Branch `feat/gap-billing-missing-list` `b266983b6`.
- **Before:** each source showed only in its own section.
- **Now:** a "Still missing" section on the work-order page lists:
  - open billing steps;
  - required step attachments not yet attached;
  - quantities reported but not accepted;
  - quantities accepted but not claimed.

  Each row says who adds it, and the list exports to CSV.
- No migration. Spec: `docs/specs/work-order-missing-list.spec.md`.

### change-review — VERIFIED (done ref `d86f399f7`)
- **Before:** only Admin, Executive and Finance could approve quantity change requests. The per-work-order limit already existed and is unchanged.
- **Now:**
  - The organisation setting `quantity_change_approver_roles` (default empty, today's route) lists built-in roles that may also approve or return, such as the project-control manager.
  - Separation of duties is kept, and field roles and roles that cannot read requests are refused.
  - The listed roles are told at submit and see the request in the shared waiting list (migration 1811 restates `my_waiting_decisions`).
  - Spec: `docs/specs/change-review.spec.md`. Migrations 1810–1811.
  - Mutation checks by the orchestrator: the role rule, separation of duties, and the built-in-roles switch each went red.

### issue-closing-measure — VERIFIED (done ref `0fc7b3fe8`)
- **Before:** the issue type was free text, and effective hours did not exist.
- **Now:**
  - The organisation keeps a list of issue types, kept by an Admin. Each existing organisation's list is seeded from its own values; old rows keep their text.
  - The closing report groups by the listed type.
  - The "Effective working hours" panel shows the site day minus stopped time, per work order per day, beside the closing-time table.
  - Fixed a shipped bug: the closing report never loaded.
- Spec: `docs/specs/issue-closing-measure.spec.md`. Migrations 1820–1823.
- **Tests whose steps changed:** the issue tests now pick a listed type; the list is in the spec, section 5.

### discipline-profit-check — VERIFIED (done ref pushed)
- The base already answers it. One unit test (AC-DPC-001) proves it.
- The cost-allocation question is in the questions file.

### checklist-target-dates — HALF BUILT (steering update 2; database side written, not run)
- Branch `feat/gap-billing-checklist-target-dates`, head `e61f03692` (work-in-progress commit), from `origin/land/fix-1122`. Migrations 1830–1839 (1830–1832 used). Not merged into the lane.
- Ruling: both halves, scanned by the one existing billing overdue runner. Close-out: target days on the template, due at issue, the issuer told once. Site clearance: target days on the item (with `target_set_at`), due from the person record's creation only for people created after the target was set, so existing people are unchanged. `people.created_by` is told, else the Admins. Only while the clearance checklist is on.
- **Done:** spec and plan (`docs/specs/checklist-target-dates.spec.md`, `docs/plans/2026-11-22-checklist-target-dates.md`); migrations 1830 (close-out columns and restated `set_closeout_checklist` / `instantiate_work_order_closeout_items`), 1831 (clearance columns, `clearance_due_on`, `person_clearance_overdue_notices`, `person_clearance_due()`) and 1832 (`notify_overdue_billing_stages` restated from 1368 with two private helpers), each with a rollback.
- **Left, in order:**
  1. guards (restated functions, migrations, refusal codes);
  2. `COT_TARGET_DAYS` sentences in EN and ID;
  3. pgTAP files 1830/1831/1832 for AC-CTD-001..008;
  4. the isolation fragment and fixture row;
  5. generated types by hand;
  6. `src/lib/checklistDue.ts` and its test;
  7. the data layer and hooks (close-out, clearance);
  8. screens: the template target field, the overdue marker on the close-out section and on the person's clearance, overdue counts on the work-orders list and the people list, and notification routes;
  9. EN and ID strings;
  10. gates.

  Then the orchestrator merges into the lane, re-runs the whole wave proof, pushes `cloud/done/gap-billing-checklist-target-dates` and then `cloud/done/gap-billing`.
- **Tests unrun:** everything for this item. Migrations 1830–1832 have never been applied to a database (no `db reset` run with them), and none of their pgTAP, unit, RTL or e2e tests exist yet. The billing-stage tests (1360, 1365, 1368) must be re-run against the restated runner.
- **Mutation lines** (to run once built):
  - Drop `+ t.target_days` in the instantiate function.
  - Drop `overdue_notified_at is null` in the close-out scan.
  - Drop `done_on is null` in the close-out scan.
  - Drop `or p_person_created < p_target_set_at` in `clearance_due_on`.
  - Drop the notices `not exists` in the clearance scan.
  - Drop `clearance_checklist_enabled` in the clearance scan.

## Not finished / to pick up
1. Finish **checklist-target-dates**, then re-run the whole wave proof on the lane. Push `cloud/done/gap-billing-checklist-target-dates`, then the final ref `cloud/done/gap-billing`.
2. The final ref `cloud/done/gap-billing` is **not pushed yet**, because it waits for item 1.
3. Stale done refs pushed early by builders, which this session could not delete (403): `cloud/done/discipline-profit-check`, `cloud/done/change-review`. Ignore them; the `gap-billing-*` names are the real ones.
4. Base-side manifest entries listed in the wave proof above belong to the fix round.

DONE: gap-billing (pending checklist-target-dates)
