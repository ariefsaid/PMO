# Lane report — Material, purchasing and roles (gap-material)

State at stop (owner: usage limit, 22 Nov 2026). Lane integration branch: `lane/gap-material-int`.
The final ref `cloud/done/gap-material` is NOT pushed: roles-that-decide and terminology-reach are not finished,
and the base moved again after the last proof (see "To finish").

## Environment used for proof (the sandbox, for whoever resumes)
- Docker Hub and the public registries were rate-limited, so the stack ran with realtime disabled locally
  (`supabase/config.toml` `[realtime] enabled = false`, marked assume-unchanged, never committed) and started with
  `npx supabase@2.122.1 start -x studio,logflare,vector,imgproxy,mailpit,postgres-meta,edge-runtime,supavisor`.
- `supabase/tests/0178_anon_executable_definers.generated.inc` must be generated before pgTAP:
  `node scripts/anon-definer-inventory.mjs` (CI does this; a run without it fails 0178).
- Screens were captured with `scripts/ux-proof.sh` (vite started and stopped around it) and compared against base
  code on the same database, so only findings the lane adds were sent back.

## Last whole proof on the lane branch (head c873eec20, base origin/land/fix-1122 as of that merge)
- `supabase db reset` + the WHOLE pgTAP suite: `Files=1024, Tests=24409`, one failure:
  `procurement_atomic_create_interleave` (a session-interleave test that also fails on base under the parallel run;
  passes alone — run alone it printed `ok`). The field-account sweeps 2711, 2713, 2715 pass in that run.
- `check:guards`, `check:restated-functions`, `typecheck`: exit 0 (merge builder, after the base merge).
- Isolation denominator (`node scripts/check-isolation-denominator.mjs`): RED. Missing entries from the base
  (`dsr_withdraw`, `my_decision_standing`, `my_waiting_decisions`, `person_mark_left`, `set_work_order_check_in_area`,
  `may_see_medical_documents` — the last arrives with the merged role-capabilities branch) and from roles-that-decide
  (`actor_may_order_purchases()`, `expiry_document_object_is_medical(text)`, `holds_job_role(uuid,text)`,
  `mrq_fills_step(uuid,user_role,text)`, `mrq_pinned_to(uuid,integer,user_role,text)`,
  `mrq_step_authority(uuid,uuid,user_role,text,uuid,uuid)`, `po_set_order_job_roles(text[])`; stale:
  `mrq_pinned_to(uuid,integer,user_role)`, `mrq_step_authority(uuid,uuid,user_role,uuid,uuid)`).
  The self-test needs the manifest clean first.
- Journeys (`E2E_WORKERS=1 scripts/e2e-local.sh`), run before the last base merge: AC-MVP-014, AC-WPL-012,
  AC-OSH-014, AC-UW-012, AC-IMP-090 — `15 passed`. Not re-run after the last base merge. AC-RTD-017 never run.
- Base tests the merge builder saw red on a clean base checkout too (not lane): `navigationRegistryParity.test.tsx`
  (`/approvals` role gates), `notificationTitles.gate.test.ts` (three titles from base migration 1561),
  `ProcurementDetails.slice4`, `ProcurementDetails.writePolicy`.

## Security read
One heavy read covered every money, approval, access and stock change. No critical or high. Four items were found
and fixed before the done refs (usage-warning, wo-per-purchase-line, roles-that-decide x2); each fix has a pgTAP
proof and a mutation check. Details stay out of this public file.

## Per item

### price-visibility-roles — VERIFIED (done ref pushed)
- Branch `feat/gap-material-price-visibility-roles`, head `7b4450c28`, done ref pushed.
- Before: the steering check found field accounts (Foreman, Field user) already read no price once they hold those job
  roles. With hiding on, office roles without the price right also lose prices (open question).
- Now: no behaviour change; acceptance tests prove a Foreman and a Field user read no price on every channel
  (base tables, masked views, committed-spend views, priced definer reads, the price-right answer), with office controls.
- Spec `docs/specs/price-visibility-roles.spec.md`; AC-PVF-001..007; test `supabase/tests/1850_price_visibility_field_roles.test.sql` (43, green; mutation red/green shown).
- Settings: none. Tests whose steps changed: none. Screens: none.

### usage-warning — VERIFIED (done ref pushed)
- Branch `feat/gap-material-usage-warning`, head `ff0c81acc`, done ref pushed.
- Before: the warning measured requested plus sent quantity at request submit and told the project manager.
- Now: a work order has a responsible person (the site engineer; field accounts refused); installed material
  (validated site reports by default, or storekeeper issues by setting) past the first usage threshold records one
  warning per work order and item and tells the responsible person, falling back to the project manager; the check
  never blocks validating or posting. The request-time warning stays as it was.
- Spec `docs/specs/usage-warning.spec.md`; AC-UW-001..020; pgTAP `usage_warning.test.sql`, `work_order_responsible.test.sql` (green, nine mutation checks red/green); e2e AC-UW-012 passed.
- Settings: `usage_installed_source` (default: site reports). The installed check reuses the first usage threshold
  (unset = off). Migrations 1860-1862.
- Screenshots `docs/evidence/gaps-1215/usage-warning/`.

### material-vs-progress — VERIFIED (done ref pushed)
- Branch `feat/gap-material-material-vs-progress`, head `211829672`, done ref pushed (stacks on usage-warning).
- Before: the comparison existed only as a banner inside the stock section of the work-order card; nobody was told.
- Now: when issued material runs ahead of reported progress, the responsible person (else the project manager) is told
  once per episode; the count shows on the work-order card, the work-order page header and the needs-you list; the
  check never blocks a posting; no notification burst on release.
- Spec `docs/specs/material-vs-progress.spec.md`; AC-MVP-001..017; pgTAP `1870_ahead_of_progress_alert.test.sql` (49, green); e2e AC-MVP-014 passed.
- Settings: none new (the existing threshold gates it). Migrations 1870-1872.
- Screenshots `docs/evidence/gaps-1215/material-vs-progress/`.

### wo-per-purchase-line — VERIFIED (done ref pushed)
- Branch `feat/gap-material-wo-per-purchase-line`, head `acbd69ac8`, done ref pushed.
- Before: the work order sat on the request header only.
- Now (steering: trace only): each purchase line can name a work order and discipline, checked by the same rule as
  the documents; picker per line on the request form and Items tab; shown on the order print; when every line names
  the same work order before submit, the request header takes it. Cost is not split per line (open question).
  Equipment-plan approval writes the line's work order into the column.
- Spec `docs/specs/wo-per-purchase-line.spec.md`; pgTAP `1880_…`, `1883_…` (green, mutation shown), changed steps in `equipment_plan_orders`, `1472_…`; e2e AC-WPL-012 passed. Migrations 1880-1883.
- Screenshots `docs/evidence/gaps-1215/wo-per-purchase-line/` (the order print shows the "printing not enabled" state
  on the seed org, so the per-line work order on the print is proven by its unit test only).

### cash-advance-estimate — VERIFIED (done ref pushed)
- Branch `feat/gap-material-cash-advance-estimate`, head `8582eeaf7`, done ref pushed.
- Before: site cash showed the balance and a monthly plan per purpose; no forward view.
- Now (steering: read-only suggestion): beside the monthly plan, the float's project's open purchase requests (not yet
  ordered or paid) with lines and totals, grouped by purpose and work order, and "start the plan from these", which
  pre-fills the existing plan editor. No money write, no approval change.
- Spec `docs/specs/cash-advance-estimate.spec.md`; pgTAP `1890_imprest_open_requests.test.sql` (18, green); e2e step in AC-IMP-090 passed. Migration 1890.
- Screenshots `docs/evidence/gaps-1215/cash-advance-estimate/`.

### opening-stock-history — VERIFIED (done ref pushed)
- Branch `feat/gap-material-opening-stock-history`, head `23362c235`, done ref pushed.
- Before: opening load took counted balances only, from the command line.
- Now: an Admin loads dated in-and-out movements from one documented template, previews (nothing posts), confirms
  atomically and idempotently; every movement goes through the ledger's own writer; customer-supplied items stay at
  zero cost; balance equals the sum of movements. Screen `/stock/opening`; command-line tier added.
- Spec `docs/specs/opening-stock-history.spec.md`; AC-OSH-001..015; pgTAP `1900_opening_stock_history.test.sql` (49, green), `opening_balances.test.sql` unchanged and green; e2e AC-OSH-014 passed. Migrations 1900-1902.
- Screenshots `docs/evidence/gaps-1215/opening-stock-history/`.

### roles-that-decide — BUILT, pgTAP PROVEN, NOT DONE (no done ref)
- Branch `feat/gap-material-roles-that-decide`, head `1ff0dccfe`, merged in the lane branch. Builds on the
  role-capabilities branch at its last clean commit (ebaf4808), not its tip.
- Before: approval steps, step owners and document viewers read the five access levels; only four access levels raise
  and send purchase orders.
- Now: one deciding function `holds_job_role`; material-request approval steps can name a job role (no job role =
  exactly today); an Admin can name job roles that may raise and send purchase orders, for approved purchases only,
  and only people who hold the role (setting ships empty). Billing steps: function exposed, contract documented in the
  spec for the billing lane. Daily cut-off already existed (proven by an existing test).
- Spec `docs/specs/roles-that-decide.spec.md`; pgTAP `roles_that_decide_function`, `_mrq`, `_purchasing`, `_medical_files` (green in the whole-suite run; mutation checks red/green shown).
- LEFT: (1) add its seven functions and remove the two stale ones in `scripts/isolation-probe-denominator.d/` (names
  above), then the denominator self-test; (2) run e2e `e2e/serial/AC-RTD-017-job-role-approval-step.spec.ts`
  (never run); (3) screenshots of the material-request settings step picker and "Who can order purchases"
  (Administration › Accounting) at 390/1440, ux-proof against base; (4) push its done ref.
- Settings: `purchase_order_settings.order_job_roles` (empty). Migrations 1840-1845 (+1535-1539 from the merged branch).

### terminology-reach — HALF BUILT, NOT IN THE LANE BRANCH
- Spec and plan: `docs/specs/terminology-reach.spec.md`, `docs/plans/2026-11-22-terminology-reach.md` (verify table per term inside).
- Slice A (keys + guard), `feat/gap-material-terminology-reach` head `51fb8eb2d`: registry of 39 terms, migration 1903
  + rollback + pgTAP, overrides read sized to the registry, Admin list, locale-term guard with allowlist and self-test
  wired into check:guards. check:guards exit 0, typecheck exit 0, eslint clean, six vitest files green. LEFT: pgTAP 1903 and the adjusted
  1491 test unrun; `check-org-terms.mjs` still covers only the original 16 terms; the guard's variant rule R1 matches
  nothing in today's locale files (exercised by its self-test only).
- Slice D (prints), `feat/gap-material-terminology-reach-d` head `d8252fd3d`: renamed term and role name reach the
  delivery note, purchase order and stock transfer prints; double rewrite removed. Gates green, 24 vitest green.
  Not merged with slice A; vitest for the mapping passes, mutation check not run.
- Slice C (server-side text), `feat/gap-material-terminology-reach-c` head `fd98d8488`: 1904 `org_naming`/`org_term`
  and 1905 email claim returning the org, with rollbacks; email function renames terms and role names per organisation
  at send time (9 Deno tests pass); the bell rewrites database-written bodies in the reader's language. check:guards,
  typecheck, eslint clean. LEFT: merge slice A's registry (it runs on today's 16 keys); pgTAP
  `1904_org_naming_lookup.test.sql` (covers 1905) never run; the last bell / notification-copy vitest run was not
  confirmed. Telegram and ERP-feed texts were left unchanged (no terms, or already keyed through `t()`).
- Slice B (screens en/id): NOT STARTED (worktree branch `feat/gap-material-terminology-reach-b` holds only the spec).
- LEFT: finish C, build B, merge A+B+C+D into the item branch, merge into the lane branch, reset + whole pgTAP,
  check:guards, screenshots of the Administration terminology page, done ref.

## To finish the lane
1. Merge `origin/land/fix-1122` again (it moved 47 commits after the last proof) into `lane/gap-material-int`.
2. Finish roles-that-decide items (1)-(4) and terminology-reach as above.
3. Whole proof once: reset, generate the 0178 include, whole pgTAP, denominator + self-test, 2711/2713/2715,
   journeys AC-MVP-014, AC-WPL-012, AC-OSH-014, AC-UW-012, AC-IMP-090, AC-RTD-017 (+ terminology journeys if any).
4. Push `lane/gap-material-int:refs/heads/cloud/done/gap-material`.

Open questions: `docs/briefs/gaps-1215-questions-material.md` on this branch (add: emails rename terms only and do
not translate the stored English text — recommended: rename only for 15 Dec).

NOT DONE: gap-material (stopped at the usage limit by the owner; resume from this file)
