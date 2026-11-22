# Lane report: gap-people (People, crews and time). State file, written on a usage-limit pause.

Status: STOPPED (weekly usage limit) before the FINAL step. Others finish from this file. The final done ref `cloud/done/gap-people` is NOT pushed yet.
To resume, read "Next steps" at the bottom.

Base: origin/land/fix-1122. Integration branch: lane/gap-people-int (head: see `git log -1`).
The steering file (briefs/gaps-1215: docs/briefs/gaps-1215/STEER-people.md, "Update 1") corrected the items: it added the heavy item no-login-labour-cost, cut pay-time back from a reversal to a second record, put crew-multi-wo on hold, and simplified manpower-request and medical-release. The open questions are in docs/briefs/gaps-1215-questions-people.md on this branch.

## Migration numbers used (range 1700-1769)
pay-time 1700-1702 · guard-headcount 1710 + 1722-1724 (its restatements must sort after 1720/1721, so it uses unused numbers from the labour-cost range) · no-login-labour-cost 1720-1721 · idle-with-rent 1730-1731 · manpower-request 1740-1742 · medical-release 1750-1752 · expiry-to-manager 1760-1761 · people-import-update none · crew-followed 1768-1769 · crew-multi-wo none.
The range covers seven items at ten each, not nine. I gave expiry-to-manager 1760-1764, people-import-update 1765-1767 and crew-followed 1768-1769.

## Proof method (integration branch, this sandbox)
`supabase db reset` plus the WHOLE pgTAP suite (1010 files), the isolation-denominator check, and the lane journeys via `E2E_WORKERS=1 scripts/e2e-local.sh <specs>`.
The field-account sweep tests (2711, 2713, 2715) run inside the whole suite.
Mutation checks: break the live function, run the item's pgTAP file (it must go red), restore, then re-run (it must pass).
Screenshots at 390 px and 1440 px are under docs/evidence/gaps-1215/<slug>/.

Last whole-suite result (round 6, before guard-headcount, idle-with-rent and the second base merge): 1009 of 1010 files passed. The one red was crew-followed's fixture, since fixed; that file then passed on its own, 53 of 53.

## Per item

### pay-time: VERIFIED (done ref pushed: cloud/done/gap-people-pay-time @ d0866e78c)
- Branch: feat/gap-people-pay-time @ d0866e78c.
- Before: the foreman's per-person tick already became approved hours without clock-in. The only second source was clock-in against the crew tick on one row, and anyone recording a manual correction cleared the disagreement flag.
- Now:
  - A surveyor or timekeeper (roles named in a setting) enters a second record for a worker's day.
  - If the two differ beyond the tolerance, the day blocks timesheet generation, sending and approval until a deciding role (a setting) picks which figure stands. The other figure is kept as evidence.
  - Nobody decides hours they recorded, and the author of the standing second record cannot approve that week.
  - The site report shows hours per person, with the source and the decision.
- Settings: `attendance_second_record_roles` (default the quantity surveyor role; manager levels can always enter) and `attendance_decider_roles` (default empty, which means today's week approvers). Until a decision, the site-report (foreman) figure stands.
- Spec: docs/specs/pay-time.spec.md. ACs: AC-PAY-001 to 011.
- Tests whose steps changed:
  - SiteReportDetail.test (a mock added).
  - The 2711 allowlist (two helpers).
  - The AC-PAY-010 journey now approves as a different manager, because of the separation rule.
- Proof:
  - pgTAP 1700: 53 of 53.
  - Journey AC-PAY-010 passes.
  - Mutation checks: dropping the author merge turns 3 assertions red; dropping the recorder check turns 7 red. Both restore green.

### no-login-labour-cost (HEAVY, added by steering): VERIFIED (cloud/done/gap-people-no-login-labour-cost @ 7f9c0c544)
- Before: approved attendance of crew members with no login reached no money read; rates existed only per login or access level.
- Now:
  - Rates can be set per labour class, and classes are assigned to people with dates.
  - Approved no-login attendance days are priced in work_order_cost_amounts. They count once against timesheets, through one no-double-count view.
  - It is gated on the existing labour-cost setting. A Project Manager sees aggregates only.
  - A history lock stops re-pricing of approved days.
  - Also fixed: plan versus actual failed on expense-claim rows, and the work-order cost list dropped attendance lines.
- Settings: none new.
- Spec: docs/specs/no-login-labour-cost.spec.md. ACs: AC-NLL-001 to 014.
- Proof:
  - pgTAP 1720 and 1721 pass.
  - Journey AC-NLL-014 passes.
  - Mutation checks: removing the setting gate turns 2 assertions red; the PM-privacy break turns 2 red. Both restore green.
  - Security read found no issue.

### guard-headcount: BUILT, UNPROVEN (no done ref)
- Branch: feat/gap-people-guard-headcount @ 967ad881f. It is merged into the integration branch at 4bdcbda98.
- Built:
  - A `headcount_days` table: a count per work order, crew, date and labour class. Entry is by the crew's recorders; another manager approves.
  - Approved lines are priced count × the daily equivalent of the class rate, in the same cost reader. The quantity is person-hours.
  - The history lock is extended.
  - Screen: a Head count section under each crew's day.
- Spec: docs/specs/guard-headcount.spec.md (not yet updated for the extra migration 1724).
- Unrun tests:
  - supabase/tests/1710_headcount_days.test.sql (38 assertions; plan count set by hand).
  - supabase/tests/1722_headcount_cost.test.sql (32).
  - pmo-portal/e2e/serial/AC-HC-011-headcount-day.spec.ts.
  - The existing 1720, 1721, 2711, 0173, 0203 and isolation denominator tests have not been re-run with guard-headcount applied.
- Left to do:
  - Run those tests and fix reds.
  - Mutation checks M1-M7 (spec section 5).
  - The heavy security read.
  - Screenshots of the head-count section.
  - Update the spec for the extra migration 1724 and for unpriced rows carrying null quantity.
  - Push cloud/done/gap-people-guard-headcount.

### idle-with-rent: BUILT, UNPROVEN (no done ref; NOT yet merged into the integration branch)
- Branch: feat/gap-people-idle-with-rent @ accc77aef. It contains guard-headcount.
- Built:
  - A setting `idle_cost_settings.scope`, "Idle cost covers", default `labour_average` (today's figure).
  - At `people_and_equipment`, idle cost = idle hours × that day's head count (present workers plus approved head-count lines) × hourly cost, plus approved standby equipment shared by idle minutes.
  - It is a view only and never enters actuals.
- Spec: docs/specs/idle-with-rent.spec.md.
- Unrun tests:
  - supabase/tests/1730_idle_cost_scope.test.sql (8 assertions).
  - supabase/tests/1731_idle_with_rent.test.sql (19).
  - pmo-portal/e2e/serial/AC-IWR-012-idle-cost-scope.spec.ts.
  - The existing AC-IHC-011 journey and its idle-cost pgTAP files have not been re-run against the restated work_order_idle_cost.
- Left to do:
  - Merge feat/gap-people-idle-with-rent into lane/gap-people-int. It carries guard-headcount, already merged.
  - Run those tests and fix reds.
  - Mutation steps 1-8 (header of 1731).
  - The heavy security read.
  - Screenshots of the idle block and of the "Idle cost covers" control.
  - Push cloud/done/gap-people-idle-with-rent.

### manpower-request (simplified by steering): VERIFIED (cloud/done/gap-people-manpower-request @ 7ce5f52e7)
- Before: nothing existed.
- Now:
  - Manpower needs (position from the discipline list, head count, needed-by date, optional work order or crew, note) are linked to people.
  - Progress comes from the existing cleared-for-site checklist. Filled and in-progress figures are shown only to the people team and the roles that read clearances.
  - Open needs appear in the people team's needs-you list, and the creator is told when a need is met or cancelled.
  - No approval step: the steering removed it.
- Spec: docs/specs/manpower-request.spec.md.
- Proof: pgTAP 1740 at 45 of 45; journey AC-MPN-010 passes; the count-audience mutation goes red, then restores.

### medical-release (minimal form): VERIFIED (cloud/done/gap-people-medical-release @ 96f188d79)
- Now:
  - The people team opens a release per person and date. The deciding manager is fixed when it is opened.
  - Only that manager approves or defers (with a reason). Each step is audited and the worker is told.
  - While it is pending or deferred, the database refuses new or extended placements, loans and present attendance. Recording the worker absent or on leave is still allowed.
  - The state word is readable only by the people team, the decider and those who roster the person, including the Foreman (a field account).
- Shared notice helper: notify_person (migration 1750).
- Spec: docs/specs/medical-release.spec.md.
- Proof: pgTAP 1750 and 1751 (40 of 40, re-runnable); journey AC-MR-009 passes; mutations on the decider check and on the hold both go red, then restore.

### expiry-to-manager: VERIFIED (cloud/done/gap-people-expiry-to-manager @ 8473cb789)
- Before: warnings already went to people.manager_id plus per-type roles.
- Now:
  - A Manager field on the person form.
  - "Also tell the person" per document type (default off).
  - An explicitly empty role list stays empty.
  - The direct manager records a renewal (non-medical only). It is audited and the worker is told through notify_person; it queues no expiry email.
- Spec: docs/specs/expiry-to-manager.spec.md.
- Proof: pgTAP document_expiry_manager (20 assertions) passes; journey JOB-F14 passes; the manager-only mutation goes red, then restores.

### people-import-update: VERIFIED (cloud/done/gap-people-people-import-update @ f1393eb46)
- Now:
  - Upload updates people matched by code (name, job title, manager by email) and adds new ones.
  - A preview shows New, Will update (old → new), No change and Invalid.
  - Blank cells never clear a value.
  - A document import (code, type, number, issue date, expiry date) runs under the same gate as the person page; medical types are refused.
- No migration.
- Spec: docs/specs/people-import-update.spec.md.
- Proof: pgTAP 1765 passes; journey AC-PIU-002 passes.

### crew-followed: VERIFIED (cloud/done/gap-people-crew-followed @ b72d4d12e)
- Now:
  - The foreman of the receiving crew, or a roster keeper, records on the day that a worker followed their crew. Phone clock-in can pick any crew rostered on that work order today; picking another crew goes to the supervisor, and approval records the picked crew.
  - A follow is refused beside a present day elsewhere, except for a crew manager.
  - A crew manager can undo a follow (unsubmitted rows only, audited).
  - Restatements are built on the base's 1551 bodies.
- Spec: docs/specs/crew-followed.spec.md.
- Tests whose steps changed: crewErrors.test (PCI_CREW wording) and 2705 test 13 (crew c03).
- Proof: pgTAP 1768 at 53 of 53; journey AC-FOL-010 passes; the authority mutation goes red, then restores.

### crew-multi-wo: ON HOLD per steering (decision note only; cloud/done/gap-people-crew-multi-wo @ 129c50924)
- docs/specs/crew-multi-wo.spec.md lays out options A and B and recommends A. Four owner decisions are logged in the questions file. Nothing is built.

## Security read (one heavy read, before guard-headcount and idle-with-rent)
All findings were fixed and their tests mutation-checked, except where noted. Neutral wording here; detail stays out of the repository.
- pay-time: the separation rule now covers the author of a standing second record.
- medical-release: the decider is fixed when the release is opened.
- crew-followed: a follow is refused beside a present day elsewhere; a follow can be undone; a helper is no longer client-callable.
- manpower-request: progress counts are limited to the right audience.
- expiry-to-manager: renewals are audited.
- guard-headcount and idle-with-rent: NOT yet read.

## Known items outside the lane
- The base function set_work_order_check_in_area (from base migration 1550) is missing from the isolation-denominator manifest, so `check-isolation-denominator` reports it. This is pre-existing in the base and was left as is.
- The bare checkbox on the base's IdleCostSwitch probably has no visible label, like the one fixed on LabourCostSettings. Not changed.

## Next steps (to resume)
1. On lane/gap-people-int (base already merged at e0c90b52d), re-run the static gates, then merge feat/gap-people-idle-with-rent.
2. Run `supabase db reset` and the whole pgTAP suite; fix reds through the item's builder.
3. Run the isolation denominator check and all lane journeys (AC-MR-009, JOB-F14, AC-PIU-002, AC-NLL-014, AC-MPN-010, AC-FOL-010, AC-PAY-010, AC-HC-011, AC-IWR-012).
4. Do one heavy security read of guard-headcount and idle-with-rent, run their mutation steps, and take their screenshots. Push cloud/done/gap-people-guard-headcount and cloud/done/gap-people-idle-with-rent.
5. FINAL: merge origin/land/fix-1122 again, re-run steps 2-3, push lane/gap-people-int:refs/heads/cloud/done/gap-people, and add the result lines here, ending with DONE: gap-people.

## Integration-merge state at pause
- The merge of origin/land/fix-1122 (about 53 new base commits) into lane/gap-people-int is COMMITTED at e0c90b52d. Conflicts were resolved in the locales, glossary, Approvals, DocumentTypes, People repositories and test, import wizard, AttendanceTick, ExpiringDocuments and the SiteReportDetail test. No restated-function collisions with lane 17xx migrations were found.
- NOT re-verified after the last test edits: the final combined typecheck, guards and vitest run was stopped. Before the wave run, re-run typecheck, check:guards and vitest on pages/admin, pages/crews, pages/equipment, pages/siteReports, src/components/import, src/lib/repositories and src/components/my.
- guard-headcount is merged into lane/gap-people-int. idle-with-rent is NOT merged yet.
- Item done refs pushed: pay-time, no-login-labour-cost, manpower-request, medical-release, expiry-to-manager, people-import-update, crew-followed, crew-multi-wo (decision note).
