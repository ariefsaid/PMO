# 15 Dec map: integration rehearsal (#2516)

Branch `integ/mp-1215`, cut from `origin/dev`. Eighteen feature branches merged with `git merge --no-ff`, in the order below. Rehearsal only: nothing here is a PR or a merge into `dev`.

## Merge order and outcome

| # | Branch | Result |
|---|---|---|
| 1 | feat/2517-work-order-cost-spine | already contained in dev (no-op) |
| 2 | feat/2518-work-order-page | clean |
| 3 | feat/2520-unit-rate-catalogue | clean |
| 4 | feat/2519-plan-vs-actual | conflict: i18n/index.ts |
| 5 | feat/2521-site-issue-log | conflicts: database.types.ts, isolation-fixtures.sql, 0178 test |
| 6 | feat/2523-stock-site-work | conflicts: glossary.md, WorkOrderCustomerOrderCard.tsx, StockDocumentDetail.test.tsx, database.types.ts |
| 7 | feat/2524b-material-requests-ui | conflicts: App.tsx, i18n/index.ts, isolation-fixtures.sql, 0178 test |
| 8 | feat/2525-three-way-match | conflicts: isolation-fixtures.sql, isolation-probe-denominator.json, 0178 test |
| 9 | feat/2522-billing-stages | 7 conflicted files (BillingTab, repositories index/test, database.types.ts, denominator, 0178 test, embed-ambiguity guard) |
| 10 | feat/2526-equipment-availability | 11 conflicted files (glossary, retention, spec add/add, word-budget, App, EquipmentUsage, routeMatch, repositories x3, module-completeness) |
| 11 | feat/2526b-rental-deduction | clean |
| 12 | feat/2527-document-expiry | already contained (no-op) |
| 13 | feat/2528-crews-roster | 8 conflicted files (policy.ts, Rail test, i18n, database.types.ts, module-completeness, fixtures, denominator, 0178 test) |
| 14 | feat/2542b-people-register | conflicts: glossary, App, EquipmentAssetDetail, repositories index/test/types |
| 15 | feat/2542-expiring-documents-edit | already contained (no-op) |
| 16 | feat/2529-org-terminology | 9 conflicted files (glossary, word-budget, package.json, Administration, AdministrationShell test, administration.json en/id, NotificationBell, i18n) |
| 17 | feat/2530-import-templates | 14 conflicted files (see table; this branch carries older copies of equipment, people and document-expiry code) |
| 18 | feat/2531-task-work-order | conflicts: glossary.md, repositories/index.ts |

## Conflict resolutions (all keep both sides)

| Merge step | File | Side A intent (already merged) | Side B intent (incoming) | Resolution |
|---|---|---|---|---|
| 2519-plan-vs-actual | pmo-portal/src/lib/i18n/index.ts | NAMESPACES array gained `workOrders` (via 2518) | NAMESPACES array gained `workOrderPva` | Union: both namespaces kept (`... 'workOrderCost', 'workOrders', 'workOrderPva'`) |
| 2521-site-issue-log | pmo-portal/src/lib/supabase/database.types.ts | RPC types `set_work_order_plan`, shared-cost split RPCs, `work_order_cost_amounts` | RPC type `create_task_from_incident` | Union: both sets of RPC types kept; closing brace restored between them |
| 2521-site-issue-log | scripts/isolation-fixtures.sql | isolation fixture rows for work_order_plan_lines + project_shared_cost_splits | isolation fixture rows for incident_files + storage object | Union: both fixture blocks kept, sequential |
| 2521-site-issue-log | supabase/tests/0178_anon_executable_definers.test.sql | retained-RPC count 182 (with plan/cost RPCs) | count 180 (179 baseline + `create_task_from_incident`) | Union count 183 in comment and in AC-ACL-002 / AC-ACL-003 assertions (both RPC names are in the list); NOTE: the dev baseline plus both features' retained names was re-derived by hand, not run (no Docker) |
| 2523-stock-site-work | docs/glossary.md | "Unit-rate catalogue (#2520)" section | "Stock for site work (#2523)" section | Union: both sections kept, blank line between |
| 2523-stock-site-work | pmo-portal/pages/project-detail/tabs/WorkOrderCustomerOrderCard.tsx | `import { Link } from 'react-router'` (work-order page link) | `import React, { useState }` (stock panel toggle state) | Union: `import React, { useState }` plus the `Link` import |
| 2523-stock-site-work | pmo-portal/pages/stock/StockDocumentDetail.test.tsx | `vi.mock` of `useWorkOrderRecord` (work-order page link) | `vi.mock` of `useTasks` `useAssignableProfiles` | Union: both mocks kept |
| 2523-stock-site-work | pmo-portal/src/lib/supabase/database.types.ts | RPC types incl. `create_task_from_incident` | RPC type `archive_stock_document_file` | Union: both kept; closing brace restored between them |
| 2524b-material-requests-ui | pmo-portal/App.tsx | `/work-orders/:id` preload rule and route | `/material-requests*` preload rules and routes | Union: both route/preload sets kept |
| 2524b-material-requests-ui | pmo-portal/src/lib/i18n/index.ts | NAMESPACES with `workOrders`, `workOrderPva` | NAMESPACES with `materialRequests` | Union: `'workOrders', 'workOrderPva', 'materialRequests'` |
| 2524b-material-requests-ui | scripts/isolation-fixtures.sql | plan/shared-cost + incident_files fixtures | material-request tables + extra by-id fixtures | Union: both fixture sets kept sequentially |
| 2524b-material-requests-ui | supabase/tests/0178_anon_executable_definers.test.sql | retained RPC list + count 183 (shared-cost/plan RPCs) | eight `mrq_*` writers + count 187 | Union list; count 191 (= 183 + 8), re-counted from the list (191 entries) |
| 2525-three-way-match | scripts/isolation-fixtures.sql | expiry/equipment/work-order/material-request fixtures | three-way-match fixtures (procurement items, match rows) | Union: both kept sequentially |
| 2525-three-way-match | scripts/isolation-probe-denominator.json | function entry `clear_shared_cost_split(uuid)` | entries `approve_bill_match_exception(uuid,text)`, `bill_match_evaluate(uuid)` | Union: all three entries kept; JSON validated |
| 2525-three-way-match | supabase/tests/0178_anon_executable_definers.test.sql | count 191 | count 181 (that branch is behind dev: lacks `set_cost_attribution`, `set_document_warning_days`) | Union count 195 = dev 179 + 16 new names, counted from the merged list (no duplicates); the union list is the arbiter, not the sum of branch counts |
| 2522-billing-stages | pmo-portal/pages/project-detail/tabs/BillingTab.tsx | Rate catalogue button + drawer (2520) | Billing terms button + `BillingTermsModal` (2522) | Union: both buttons and both overlays kept |
| 2522-billing-stages | pmo-portal/src/lib/repositories/index.test.ts | repository-key list incl. `documentExpiry` | list incl. `billingStages` | Union: `billingStages` added to the merged list |
| 2522-billing-stages | pmo-portal/src/lib/repositories/index.ts | `rateCatalogue: rateCatalogueRepository` | `billingStages: billingStagesRepository` | Union: both entries |
| 2522-billing-stages | pmo-portal/src/lib/supabase/database.types.ts | (hunk 1) `approval_chain_steps`/`approval_stand_ins` tables; (hunk 2) view `work_order_cost_lines` | (hunk 1) `billing_stage_*`, `claim_billing_stages` tables; (hunk 2) view `claim_retention` | Union: both table sets and both views; closing braces restored |
| 2522-billing-stages | scripts/isolation-probe-denominator.json | document-expiry / incident function entries | billing-stage / retention function entries | Union: all entries kept; JSON validated |
| 2522-billing-stages | supabase/tests/0178_anon_executable_definers.test.sql | count 195 | count 187 | Union count 205 = 195 + 10 billing/retention writers, counted from the list (205 entries) |
| 2522-billing-stages | supabase/tests/postgrest_embed_ambiguity_guard.test.sql | `work_order_plan_lines -> profiles` pair | `retention_releases -> users` pair | Union: both pairs kept, `$$` terminator after the last one |
| 2525 fix-up (carried in the 2526 merge commit) | supabase/tests/0178_anon_executable_definers.test.sql | -- | -- | My own earlier line-number edits had overwritten two original header comment lines (0907 and 0965 amendment notes); restored them verbatim and kept one union-count comment above the insert (205) |
| 2526-equipment-availability | docs/glossary.md | Rate catalogue + Stock for site work sections | Equipment availability section | Union: all sections kept |
| 2526-equipment-availability | docs/retention.md | `incident-escalation` row | `equipment-downtime-escalation` row | Union: both rows |
| 2526-equipment-availability | docs/specs/equipment-availability.spec.md | (add/add) earlier copy: status "proposed", owner decisions "not rulings", unchecked sign-off | later copy: status "accepted", Director rulings section, sign-off checked | Took the feature branch's accepted text (same spec, supersedes the proposal text; no requirement dropped) |
| 2526-equipment-availability | docs/ux/word-budget.json | word budget entries for `/equipment`, `/equipment/expiring` | entries for `/equipment/availability` | Union: all entries; commas fixed; JSON validated |
| 2526-equipment-availability | pmo-portal/App.tsx | `/equipment/expiring` preload + route | `/equipment/availability` preload + route | Union |
| 2526-equipment-availability | pmo-portal/pages/equipment/EquipmentUsage.tsx | `Link` to expiring documents | `Button` navigating to availability | Union: both controls rendered |
| 2526-equipment-availability | pmo-portal/src/components/shell/routeMatch.ts | `/equipment/expiring` parent | `/equipment/availability` parent | Union |
| 2526-equipment-availability | pmo-portal/src/lib/repositories/index.test.ts | key list with `documentExpiry`, `billingStages` | key list with `equipmentAvailability` | Union: `equipmentAvailability` added |
| 2526-equipment-availability | pmo-portal/src/lib/repositories/index.ts | `documentExpiry` import + entry | `equipmentAvailability` import + entry | Union |
| 2526-equipment-availability | pmo-portal/src/lib/repositories/types.ts | `documentExpiry: DocumentExpiryRepository` | `equipmentAvailability: EquipmentAvailabilityRepository` | Union |
| 2526-equipment-availability | scripts/check-module-completeness.mjs | `/equipment/expiring` exemption | `/equipment/availability` exemption | Union |
| 2528-crews-roster | pmo-portal/src/auth/policy.ts | `equipmentAvailability` permission entry (2526) | `crew` + `attendance` permission entries (2528) | Union: both entries; closing brace and next doc-comment opener restored between them |
| 2528-crews-roster | pmo-portal/src/components/shell/__tests__/Rail.more.test.tsx | per-role rail lists include `/material-requests` | per-role rail lists include `/crews` | Union: both routes in every role list; `/crews` placed after `/equipment` as on the 2528 branch (order asserted against that branch's lists) |
| 2528-crews-roster | pmo-portal/src/lib/i18n/index.ts | NAMESPACES with workOrders, workOrderPva, materialRequests | NAMESPACES with `crews` | Union: `... 'materialRequests', 'crews'` |
| 2528-crews-roster | pmo-portal/src/lib/supabase/database.types.ts | RPC types (shared-cost, task from incident, stock file) | RPC types `place_new_crew_worker`, `create_crew_with_roles` | Union |
| 2528-crews-roster | scripts/check-module-completeness.mjs | `/material-requests` exemption (two maps) | `/crews` exemption (two maps) | Union in both maps |
| 2528-crews-roster | scripts/isolation-fixtures.sql | all earlier fixtures | crews/attendance fixtures | Union: both kept |
| 2528-crews-roster | scripts/isolation-probe-denominator.json | `approval_chain_steps`, `approval_stand_ins` rows | `attendance_days`, `attendance_photos` rows | Union; JSON validated |
| 2528-crews-roster | supabase/tests/0178_anon_executable_definers.test.sql | count 205 + header comment | count 182 (179 + 3 attendance writers) | Union list gains `attendance_record`, `attendance_generate_timesheet`, `attendance_decide_week`; count 208 (list re-counted: 208 entries) |
| 2542b-people-register | docs/glossary.md | rate catalogue, stock, equipment-availability sections | Expiring document, People register entries | Union |
| 2542b-people-register | pmo-portal/App.tsx | `/crews` preload + route | `/equipment/people/:personId` preload + route | Union |
| 2542b-people-register | pmo-portal/pages/equipment/EquipmentAssetDetail.tsx | `EquipmentRentalTerms` import + render (permission gated) | `ExpiryDocumentsCard` import + render | Union: both cards rendered |
| 2542b-people-register | pmo-portal/src/lib/repositories/index.test.ts | key list with `equipmentAvailability` | key list with `people` | Union (`people` added; list is `.sort()`ed) |
| 2542b-people-register | pmo-portal/src/lib/repositories/index.ts, types.ts | `equipmentAvailability` repository | `people` repository | Union (import, entry, type) |
| 2529-org-terminology | docs/glossary.md | rate catalogue .. people register sections | Organisation terminology section | Union |
| 2529-org-terminology | docs/ux/word-budget.json | `/equipment*` budget entries | `/administration/terminology` entries | Union, commas fixed, JSON validated |
| 2529-org-terminology | pmo-portal/package.json | `check:guards` chain with `check:no-erp-steps` | `check:guards` chain with `check:org-terms` | Union: both guards in the chain (`... check:plain-words && check:org-terms && check:no-erp-steps ...`) |
| 2529-org-terminology | pmo-portal/pages/Administration.tsx | ORGANIZATION_SECTIONS with `people` | with `terminology` | Union: both sections |
| 2529-org-terminology | pmo-portal/pages/AdministrationShell.test.tsx | comment "Eight organisation sections (People included)" | comment "Seven organisation sections" | Comment now says nine sections; link-count assertion (auto-merged, 9) verified by running the test, see gates |
| 2529-org-terminology | pmo-portal/public/locales/{en,id}/administration.json | `people` block | `terminology` block | Union: both blocks, brace restored; JSON validated |
| 2529-org-terminology | pmo-portal/src/components/shell/NotificationBell.tsx | `useTranslation(['common','incidents'])` + overdue-incident title via `incidents:notification.overdue` | `useTranslation(['common','notifications'])` + `notificationTitle(row, t)` | Union: namespaces `['common','incidents','notifications']`; overdue incident keeps its translated title, every other row uses `notificationTitle(row, t)` (was `row.title`) |
| 2529-org-terminology | pmo-portal/src/lib/i18n/index.ts | NAMESPACES with crews etc. | with `notifications` | Union: `... 'crews', 'notifications'` |
| 2530-import-templates | docs/glossary.md | Expiring document .. Organisation terminology sections (blank-line hunks) | Import templates section | Union |
| 2530-import-templates | pmo-portal/App.tsx; scripts/check-module-completeness.mjs | `/equipment/expiring`, `/equipment/availability` entries | same two entries, reversed order | Same content; kept one copy of each (HEAD order) |
| 2530-import-templates | pmo-portal/pages/stock/StockSetup.tsx | New button gated on `tab !== 'items' \|\| !tagsEnabled \|\| itemTags.isSuccess` (tags must load first) | `ImportButton`s for items and warehouses in a fragment | Union: ImportButtons kept; New button keeps the tags-loaded gate inside the fragment |
| 2530-import-templates | pmo-portal/src/lib/db/equipmentAvailability.ts | paged `listStatusDays(from,to,assetIds?)`, `listLatestStatusDays`, `listEquipmentProofs` | `createRentedAsset` + older unpaged `listStatusDays(from,to)` | Union: kept HEAD's paged `listStatusDays` (superset; 2-arg callers still valid), added `createRentedAsset`/`RentedAssetInput`; the older unpaged variant is a duplicate name so it is dropped (superseded, not lost) |
| 2530-import-templates | pmo-portal/src/lib/db/people.ts | (add/add) 2542b: fuller DAL (`listPeople` paged, `createPerson` with job title/profile link, `updatePerson`, `archivePerson`) | 2530: minimal `listPeople`/`createPerson({code,name})` | Took the 2542b file (superset of the same two functions); the 2530 import descriptor is adapted if typecheck requires it (see gates) |
| 2530-import-templates | pmo-portal/src/lib/repositories/contracts/documentExpiry.ts, documentExpiry.ts | subject-document methods (list/create/update/archive/attachments) | `listPeople`, `createPerson` | Union: all methods |
| 2530-import-templates | pmo-portal/src/lib/repositories/equipmentAvailability.ts | `rentalCheck`, `proofUrl`, paged `listStatusDays`, latest/proof lists | `createRentedAsset`, older `listStatusDays` | Union: all methods; HEAD's `listStatusDays` kept |
| 2530-import-templates | pmo-portal/src/lib/repositories/index.ts, types.ts | documentExpiry, equipmentAvailability, people | equipmentAvailability, documentExpiry (reordered) | Same set; HEAD copy kept |
| 2530-import-templates | pmo-portal/src/lib/repositories/index.test.ts | key list incl. `billingStages`, `people` | key list incl. `rateCatalogue` | Union: `rateCatalogue` added |
| 2530-import-templates | scripts/isolation-probe-denominator.json | attendance_* / crew_can_manage definer entries | `create_rented_equipment_asset(...)` | Union; JSON validated |
| 2530-import-templates | supabase/tests/0178_anon_executable_definers.test.sql | count 208 | count 191 (that branch lists 12 equipment/rate-catalogue/stock-file writers the others lack) | Union list of 220 distinct names (re-counted, no duplicates); count 220 |
| 2531-task-work-order | docs/glossary.md | long union of sections appended after the shared tail | "Proof of completion" paragraph continuing the shared tail | Union: 2531 paragraph placed directly after the shared text, then the other sections |
| 2531-task-work-order | pmo-portal/src/lib/repositories/index.ts | `billingStagesRepository` import | `taskProofRepository` import | Union: both imports |

Note on the 0178 retained-RPC count: no branch's own count is additive, because several branches were cut before others amended the list. The merged list is the arbiter; it was re-counted after each merge (final: 220 distinct names, no duplicates).

## Migration clashes

`ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` before any renumber: `0988` only.

| Number | Files | Owning branches | Order dependencies | Resolution on integ |
|---|---|---|---|---|
| 0988 | `0988_crews_roster.sql` (+ rollback `0988_crews_roster_down.sql`), `0988_atomic_equipment_import.sql` (+ rollback `0988_atomic_equipment_import_down.sql`) | feat/2528-crews-roster, feat/2530-import-templates | `0989_attendance_days` and `0990_attendance_timesheet` reference crews from `0988_crews_roster`, so crews keeps 0988. `atomic_equipment_import` needs the equipment tables of 0985-0987 only (earlier) and nothing later references it | Renamed `0988_atomic_equipment_import.sql` to `1009_atomic_equipment_import.sql` and its rollback to `1009_atomic_equipment_import_down.sql` (highest number on the union was 1008). `scripts/renumber-migration.sh` refused (two files share 0988), so `git mv` was used; a sweep for `0988_atomic` found no references anywhere, and the pgTAP file `supabase/tests/equipment_import_atomic.test.sql` is named by feature, not number. After: `check:migrations` reports "611 files, no duplicates". |

Proposed renumber on the feature branch (not done there): feat/2530-import-templates should take the next free number at its own merge time.

No pgTAP test or rollback file references the old 0988 number for the atomic import. The pgTAP/db reset were NOT run (Docker not available), so the new ordering (1009 after 1008) is checked only by the prefix guard and by reading dependencies.

## ADR number clash (found by `check:adrs`)

`docs/adr/0103-user-defined-roles.md` (already on dev) and `docs/adr/0103-retention-held-on-the-receivable.md` (feat/2522-billing-stages) share 0103. On integ the retention ADR was renamed to `0105-retention-held-on-the-receivable.md` (0104 is taken by work-orders-on-the-cost-side) and its references in 0961 migration comments, the 0961 pgTAP header, ClaimBillingStages.tsx, the billing-stages spec and plan and the glossary were updated. Left alone: `docs/specs/work-order-record-page.spec.md` says "ADR-0103" for the #2517 decision, whose file is ADR-0104 (a stale reference on its branch, not touched).

## Gates (union, `pmo-portal/`)

Docker is not available: pgTAP and `supabase db reset` were not run; every SQL change above (0178 count, fixtures, probe denominator, embed guard, renumber) is checked by reading and by the file-based guards only.

`node_modules`: `package-lock.json` is byte-identical to the main checkout's, so `node_modules` is a symlink to it (no install, lock untouched).

- `npm run check:guards`: exit 0 (last lines: `layout-baseline guard: 350 key(s), none grew against origin/dev`, `layout-baseline guard self-test passed`). Two things failed first and were fixed on integ, see below.
- `npm run typecheck`: exit 0, no errors (after the people import fix).
- `npx vitest related --run <all 318 changed non-e2e .ts/.tsx source files>` (e2e specs not run): `Test Files  8 failed | 1308 passed (1316)`, `Tests  31 failed | 14067 passed (14098)`. After the two union fixes below, the 8 files were re-run: `Test Files  6 failed | 2 passed (8)`, `Tests  7 failed | 126 passed (133)`, and all 7 remaining failures exist on a single feature branch (below).

## Failures caused by the union, fixed on integ (one commit each)

| Commit subject | Root cause |
|---|---|
| Renumber atomic_equipment_import 0988 -> 1009 | Two branches picked 0988 |
| Renumber retention ADR 0103 -> 0105 | ADR number used by a doc already on dev and by the 2522 ADR |
| Fix org-terms ratchet: work-order breadcrumb takes the Projects module label | 2518 added a literal `label: 'Projects'` in routeMatch.ts; 2529's new guard (baseline 4) counts a fifth hit. Now reads the existing module label (`?? pathname` fallback; `i18nKey` still replaces it at render). Baseline untouched |
| Fix people import typing: createPerson takes optional job title/profile link | 2530's people import sends only code and name; 2542b's richer `createPerson` input type requires `job_title` and `profile_id` (TS2739). Made both optional on create; the import's input type is `Pick<PersonInput, 'code'|'name'>` |
| Fix administration shell link counts | 2542b added People and 2529 added Terminology; each branch's tests count one of them. Union has both: 10 links for an Admin, 12 for an Operator (test comment and "eleven" title updated) |
| Fix equipment asset floor test: stub rental terms and expiry cards | `pages/equipment/EquipmentAssetDetail.floor.test.tsx` exists on dev only (the feature branches predate it); the asset page now renders `EquipmentRentalTerms` (2526) and `ExpiryDocumentsCard` (2542b), which call `useAuth` outside the test's provider. Both are stubbed there; they have their own tests |

## Pre-existing failures (reproduced on the individual branch, left as they are)

| Test | Branch where it also fails | Cause |
|---|---|---|
| `src/lib/repositories/index.test.ts` (2 tests: one repository per entity; expected methods) | feat/2531-task-work-order | the `taskProof` repository and `listOpenByWorkOrder` method are not in the expected lists |
| `pages/__tests__/Administration.fxAccess.test.tsx` (AC-FX-010) | feat/2542b-people-register | Finance now also sees a People link; the test still expects two links |
| `pages/stock/StockSisa.id.test.tsx` (#2451) | feat/2523-stock-site-work | the branch adds the Bahasa string "Saldo stok perintah kerja ..." to `locales/id/stock.json`, which this test forbids |
| `src/hooks/useEfakturMutations.test.tsx` (AC-EFK-004) | feat/2522-billing-stages | the mutation now also invalidates the billing-reconciliation query family; the test expects the old list |
| `src/hooks/useIncidents.test.tsx` (AC-IN-004) | feat/2521-site-issue-log | `transition` is now called with a third argument (undefined); the test expects two |
| `pages/project-detail/__tests__/ProjectDetail.route-chunks.test.tsx` | feat/2521-site-issue-log | `ProjectIssuesLink` calls `useAuth` outside the test's provider |

## Notes for the real merge

- The commit subject "Keep catalogue writes out of view-only sessions" (b5081199c, in the rate-catalogue branch) contains the word "sessions"; it is in a merged feature commit, not rewritten here.
- feat/2530-import-templates was built on older copies of the equipment, people and document-expiry layers; merge it last (as here) and expect the same conflicts.
- Not run: pgTAP, `supabase db reset`, the browser suite (CI owns them on the release PR).
