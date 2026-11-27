# Owner-supplied material tracking implementation plan

**Goal:** one repeatable workbook command and material stage screens that reconcile to accepted workbook evidence.
**Spec:** `docs/specs/owner-supplied-material-tracking.spec.md` (owner sign-off required before build).
**Architecture:** reuse section material plans, client requisitions and stock posting; SQL supplies all stage arithmetic. React consumes repository → DAL; CLI consumes the same RPC contracts as tests.
**Stack:** React 19, TypeScript, Supabase SQL/pgTAP, Node 22 CLI; isolated Python/openpyxl subprocess for XLSX decoding. Source remains outside git.

## Execution and ownership

Three bounded Orca workers build in parallel, one branch each: `feat/3010-material-db`, `feat/3010-material-loader`, `feat/3010-material-screens`. No file overlap. The coordinator is the sole integration writer; merges branches into `batch/3010-owner-material` and owns shared browser/performance/parity proof. CI is the merge gate. Workers own their scoped tests; no repeated full-suite local proofs. Every 2–5 minute step below is a work unit, not a claim that the whole slice takes minutes. Stop on a contract conflict and ask; no silent API drift. Estimated build plus scoped proof: A 14–18 hours, B 12–16 hours, C 10–14 hours; shared integration/review 4–6 hours. Source remediation is additional and depends on owner answers.

Read `docs/orca-dispatch.md` batch integration, `docs/product-expectations.md`, ADR-0016/0017/0019 and e2e conventions before implementation. No service credentials, no direct ledger inserts, no money changes, no production writes. Work only through dev-ceiling feature branches. Mutate security rules deliberately once to prove tests fail, then restore. Do not rewrite a failing test to match implementation.

## Frozen interface contract v1 (historical reference)

Superseded in phase 1 by opening stage totals; live stage/movement writers and reservations[] / movements[] replay are phase 2. The shipped phase-1 contract imports no stock documents or requisitions; it reuses existing work orders, creates sections and stores opening totals with display-only evidence. The section read also returns skipped_source_rows/skipped_reason_codes, and the work-order read returns partial_section_count. The original interface below is retained as phase-2 design context, not an instruction to build removed behavior.

All proposed RPCs derive organisation/actor from the session; no caller org argument. UUIDs are strings; quantities are decimal strings at scale ≤3; dates are ISO calendar dates or null; percentages are decimal strings in 0..100 or null. Rows always carry IDs. Every writer locks its referenced work order/plan and validates same-org parentage. Definers pin search_path, enforce real role and expose only intended functions to authenticated callers. All public functions below return JSONB except the two set-returning reads. Errors use SQLSTATE 42501 for denied, P0001 with machine `details` codes `material-conflict`, `material-invalid`, `material-overlap`, `material-source-changed`, `material-section-required`.

### Database additions (A owns)

Reserve migrations `2790_owner_material_schema.sql` and `2791_owner_material_rpcs.sql`; verify unoccupied at dispatch and renumber with `scripts/renumber-migration.sh` if needed before parallel briefs freeze. Reverse scripts use matching names under `supabase/migrations/rollback/`.

- `stock_material_categories`: id, org_id, code, name, archived_at; unique live org/code.
- `owner_material_warehouses`: id, org_id, code, name, archived_at; external reservation locations only.
- `work_order_sections.owner_cost_code text`; plan `category_id uuid`; item `material_category_id uuid` optional default. Existing plan quantity is authoritative.
- Add `section_material_plan_id` to `client_requisition_lines` and `owner_warehouse_id` to `client_requisition_events`. Generated types at this head confirm these physical relation names; the private sample loader uses different names and must not dictate the schema. Preserve current APIs. Composite parent/organisation references prevent cross-parent links. Add nullable `import_batch_id` to `client_requisitions`; historic import mode is server-only to the Admin import RPC, never a generic caller-controlled bypass.
- `owner_material_movement_links`: org_id, document_id, stock_line_id, section_material_plan_id, stage (`received`,`issued`,`returned`,`transfer_in`,`transfer_out`,`owner_return`), unique document-line/stage/plan. Join `stock_ledger.document_id` to `stock_documents.id`, and `stock_ledger.line_id` to `stock_document_lines.id` / link `stock_line_id`; aggregate signed `qty_delta` by attribution and stage, excluding reversed documents and double-sided location transfer entries. Quantity is always from the posted ledger/document line, never copied here. Only actual receipt documents count as received; transfers within stock do not. Same-WO cross-section transfer uses two counterpart links and nets at work-order level. Attribute live documents through the new writer before posting; ambiguous existing history stays unallocated and is reported.
- `owner_material_reconciliation_steps`: id, org_id, position, name, percentage, archived_at; ordered percentage constraints and final 100 validated atomically by config RPC. `owner_material_reconciliation`: org_id, section_id unique, step_id, changed_on, changed_by, reason. `owner_material_reconciliation_events`: immutable previous/new step and actor/time/reason. No checklist mutation.
- `owner_material_import_batches`: id, org_id, source_key unique within org, schema_version, created_by. `owner_material_import_rows`: batch_id, org_id, entity_key, payload_hash, result_ids JSONB; unique batch/entity_key. Stable source key comes from the approved mapping, not file digest, so corrections cannot masquerade as a new source; a file digest is audit metadata only.
- RLS on all additions: active visible-project members read project records, same-org active members read catalogues; no direct history writes; Admin configuration/import, Material Coordinator and existing recorder roles stage/status writes; stock keeper retains stock posting authority; Admin-only destructive actions, referenced data cannot be deleted. Imported stock writer is Admin-only and preserves normal stock dates, zero-cost and nonnegative-balance validation. Do not bypass frozen work-order rules: refuse unsupported state and ask for explicit correction.

### RPC signatures and payloads

`om_material_lines(p_work_order_id uuid, p_section_id uuid default null, p_page integer default 1, p_page_size integer default 50)` returns rows:
`{plan_id,section_id,item_id,item_code,item_name,unit,category_code,owner_cost_code,planned,requested,set_aside,received,issued,returned,transfer_in,transfer_out,owner_return,closing,requested_pct,set_aside_pct,received_pct,issued_pct,closing_pct,total_count}`.

`om_material_rollup(p_project_id uuid, p_page integer default 1, p_page_size integer default 50, p_work_order_id uuid default null)` returns rows:
`{work_order_id,number,title,section_count,requested_pct,set_aside_pct,received_pct,issued_pct,closing_pct,reconciliation_step,reconciliation_pct,unallocated_movement_count,total_count}`. Reads use RLS visibility and one set-based aggregate over eligible plans and posted movements; no N+1. Drilldown uses the lines read grouped by section and the same SQL aggregate helper, not browser-derived authoritative percentages. All means use eligible line counts, not section averages.

`om_material_record_stage(p_plan_id uuid,p_event jsonb,p_request_id uuid)` → `{event_id}`. Event shape `{kind:'requested'|'reserved'|'released',quantity,reference,event_on,owner_warehouse_id?}`. Requested writes create or update the canonical draft/open request according to current lifecycle, never edit posted history; corrections are events. Reservation/release reuses `csr_*` semantics and recorder authority. Live stage bounds stay intact.

`om_material_set_reconciliation(p_section_id uuid,p_step_id uuid,p_reason text default null)` → `{section_id,step_id,percentage}`.
`om_material_post_movement(p_plan_id uuid,p_movement jsonb,p_request_id uuid)` → `{document_id}`. Movement shape `{kind:'receive'|'issue'|'return'|'transfer',quantity,event_on,location_id,to_location_id?,to_plan_id?,reference}`. Reuse stock posting, receipt witness and keeper checks; validate counterpart plan for a cross-section/work-order transfer, link both sides in the same transaction, and preserve three-decimal zero-cost quantities. A Material Coordinator who is not the keeper cannot post through this wrapper. C calls this wrapper from the attributed receipt/movement actions on the material surface; the old unsectioned actions retain their original APIs.
`om_material_set_scale(p_steps jsonb)` → `{count}`; steps `[{name,position,percentage}]`, Admin only.
`om_material_config()` → `{categories:[{id,code,name}],owner_warehouses:[{id,code,name}],steps:[{id,name,position,percentage}]}`. Catalogue sizes are bounded configuration; items/our locations are resolved with paged existing reads.

`om_material_import(p_source_key text,p_schema_version integer,p_payload jsonb,p_confirm boolean default false)` → `{batch_id:null|uuid,results:[{entity_key,status:'create'|'update'|'skip'|'refused',ids:{work_order_id?,section_id?,plan_id?,document_ids?},before?,after?,reason?,sheet,row,column?}],complete:boolean}`.
Payload `{kind:'catalogue'|'section',project_id,source_digest,entities:[...]}`. Catalogue chunk ≤500 entries: `{entity_key,hash,type:'item'|'category'|'owner_warehouse',code,name,unit?,zero_cost_tag_id?}`. Section payload is exactly one section and ≤200 item rows: `{entity_key,hash,sheet,row,owner_order_number,location_name,section_code,owner_cost_code,title,lines:[{entity_key,hash,row,item_code,unit,category_code,planned,requested,request_reference,request_on,reservations:[{quantity,owner_warehouse_code,reference,event_on}],movements:[{entity_key,kind,quantity,event_on,location_code,to_location_code?,to_owner_order_number?,to_location_name?,reference}],expected:{received,issued,returned,transfer_in,transfer_out,owner_return,closing}}],reconciliation_step?}`.
Preview takes the same locks/validation decisions as confirm but makes zero writes; confirmation revalidates all state. Section transaction includes missing work order, section, plans, requisitions, movement links and stock documents. Multiple sections sharing an order use a project/order advisory lock and unique match enforcement. Stable entity keys include logical source/section/item/movement identity, never row number alone; sheet/row are provenance. Aggregate multi-date quantities require explicit mapping. Stock-side destinations must resolve before the transaction. Changed posted quantities conflict; planned quantity changes update. Do not create dummy value/contract lines to satisfy work-order creation. If creation cannot use normal Draft defaults without commercial inputs, report it as a blocker before implementation.

The loader and screen workers commit mocked contract tests immediately, and can work before A merges; only integration tests require A. A returns results in deterministic entity order, never relies on input array indices for identity. Reuse the CLI session, HTTP transport and error conventions already in `scripts/pmo.mjs`.

## Slice A: database, RPCs and pgTAP

Exclusive files: the four migration/rollback files above; `supabase/tests/2790_owner_material.test.sql`; `supabase/tests/2791_owner_material_import.test.sql`; `scripts/perf/owner_material_explain.sql`; `pmo-portal/src/lib/supabase/database.types.ts`; `supabase/tests/inventory/anon-executable-definers/2791-owner-material.txt`; `scripts/isolation-probe-denominator.d/2791-owner-material.json`. Register tracked column classifications through the migration's `record_history_config` statements. Do not edit screen/CLI files.

Each checkbox below is 2–5 minutes; repeat the test/implement/check trio per named contract until complete.

- [ ] Read current requisition relation renames, receive/issue/return and work-order transfer bodies; record actual document-line→ledger join in the test's fixture comments.
- [ ] Write AC-003 fixture: receipt 10, issue 6, return 1, transfer-out 2; run targeted pgTAP red.
- [ ] Add schema references/indexes and reverse script; reset and rerun targeted test, keeping red failures explicit.
- [ ] Write AC-005 read/role cases for each new table and each RPC, then same-org wrong-parent cases; run red.
- [ ] Implement grants/RLS/guards and writer role fences; rerun those cases green.
- [ ] Implement ledger stage joins and exclusion of reversal/internal transfer; rerun AC-003 green.
- [ ] Add AC-004 uneven denominator and zero-denominator cases; implement SQL means and page count; rerun green.
- [ ] Add AC-006 same-source resume, alternate Admin, changed history and rollback-on-failed-line cases; run red.
- [ ] Implement catalogue import chunk; rerun its create/skip/conflict cases green.
- [ ] Implement atomic missing work-order/section creation and plan upsert; rerun matching/quantity update cases green.
- [ ] Implement historic requisition events and stock document posting with attribution; rerun history cases green.
- [ ] Add two-session race harness inside the import pgTAP file using the repository's concurrency pattern; verify one result per entity.
- [ ] Implement config/reconciliation audit and same-org checks; rerun scale/status cases green.
- [ ] Add attributed live-stage and document paths; prove old unsectioned behavior still works and attributed paths affect the same read.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`; inspect the diff for unrelated changes.
- [ ] Run each scoped security mutation, capture failing case counts, restore and rerun green.
- [ ] Run registrations and record proof before committing scoped files.

Exact root verification (reset only under this lock; split holds if approaching 15 minutes):
```sh
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2790_owner_material.test.sql supabase/tests/2791_owner_material_import.test.sql && scripts/check-schema-registrations.sh'
```
App directory: `npm run migration-registers`, `npm run check:guards`, `npm run typecheck`. Full pgTAP is CI/shared-server proof, not another local run. Reversal is demonstrated on local disposable reset data before final forward reset.

## Slice B: CLI workbook loader

Exclusive files: `scripts/pmo.mjs`; `scripts/lib/pmo-owner-material.mjs`; `scripts/lib/owner-material-workbook.py`; `scripts/requirements-owner-material.txt` (pin openpyxl version used in rehearsal); `scripts/pmo-owner-material.test.mjs`; `scripts/owner-material-workbook.test.py`; `docs/runbooks/pmo-cli.md`. Synthetic workbooks are generated in temporary directories by tests, never checked in. Node spawns an explicitly configured isolated venv Python with `-I`; no auto-install during loading.

- [ ] Add synthetic section workbook builder and AC-002 dirty-cell expectations; run parser test red.
- [ ] Implement strict header variants, code preservation, date/numeric parsing and source-coordinate errors; run green.
- [ ] Add cached-formula mismatch and no-cache cases; implement formula arithmetic validation without evaluation; run green.
- [ ] Add mapping schema for sheet→order/location, owner warehouse, stock location, dates and split documents; reject unknown mapping keys.
- [ ] Add AC-001 fake transport assertions for default dry run and second unchanged invocation; run red.
- [ ] Implement item/category paged resolution, exact matching and deterministic stable keys; run green.
- [ ] Add same-number multi-location, existing real plan quantity change and ambiguous identity cases; implement preview and run green.
- [ ] Add AC-012-style overlap assertions under AC-002: estimated posted history causes refusal, unrelated data untouched; run green after implementation.
- [ ] Add unknown-outcome transport test; implement server-state resume and forbid silent retries with a new key; run green.
- [ ] Implement section payload assembly, explicit movement counterparts and per-unit totals reconciliation; test synthetic transfer pairs and inconsistent closing.
- [ ] Wire `material load` command, help, ordinary session/RPC allowlists and `--confirm`; run CLI tests green.
- [ ] Add report JSON writer outside repository with digest/coordinate/refusal totals; assert nonzero exit on incomplete sections and no secret output.
- [ ] Document venv setup, private mapping shape, existing-record cleanup prerequisites and repeat invocation in runbook.
- [ ] Run scoped checks and commit only B's files.

Exact root checks: `node --test scripts/pmo-owner-material.test.mjs scripts/pmo.test.mjs`; `python3 -I -m venv /tmp/owner-material-loader-venv`; `/tmp/owner-material-loader-venv/bin/pip install -r scripts/requirements-owner-material.txt`; `/tmp/owner-material-loader-venv/bin/python -I scripts/owner-material-workbook.test.py`. App directory: `npm run check:guards`; `npm run typecheck`; `npx eslint --max-warnings=0 ../scripts/pmo.mjs ../scripts/lib/pmo-owner-material.mjs ../scripts/pmo-owner-material.test.mjs` (if root script files are outside eslint scope, use `node --check` for each and document that scope explicitly).

## Slice C: work-order material stages and portfolio rollup

Exclusive files: `pmo-portal/pages/work-order-detail/ClientMaterialSection.tsx`; new `pmo-portal/pages/work-order-detail/OwnerMaterialPipeline.tsx` and `.test.tsx`; `pmo-portal/pages/WorkOrders.tsx`; new `pmo-portal/pages/workOrders/OwnerMaterialRollup.tsx` and `.test.tsx`; `pmo-portal/src/lib/db/ownerMaterial.ts` and `.test.ts`; `pmo-portal/src/lib/repositories/ownerMaterial.ts`; `pmo-portal/src/hooks/useOwnerMaterial.ts`; `pmo-portal/src/auth/policy.ts` and new `policy.ownerMaterial.test.ts`; `pmo-portal/src/lib/i18n/orgTerms.ts`; `pmo-portal/src/lib/i18n/terms.registry.json`; `pmo-portal/public/locales/en/workOrders.json`; `pmo-portal/public/locales/id/workOrders.json`; `pmo-portal/e2e/AC-007-owner-material-role-job.spec.ts`; `docs/glossary.md`. Use existing repository exports by direct module import so no index registry overlaps A.

- [ ] Read screen owner runbook and DESIGN.md; sketch material stages in existing work-order surface and Materials view in Work Orders. Coordinator gets directional owner glance before build.
- [ ] Write DAL mock tests for exact RPC args, decimal strings, page counts and errors; run red.
- [ ] Implement typed DAL and repository; run green. No client org argument and no direct Supabase in components.
- [ ] Write policy tests for Material Coordinator ordinary access, keeper, read-only impersonation and ordinary reader; implement exact UX gates; run green.
- [ ] Write AC-008 loading/empty/error/denied/page-back cases for pipeline; run red.
- [ ] Implement section selector and paged table with accessible headers and numeric alignment; run green.
- [ ] Add stage evidence and reconciliation form save/refusal tests; implement shared form primitives and invalidate both query keys on success.
- [ ] Add rollup mock test for one page request and section drilldown; implement Work Orders Materials view, URL page and selected section; run green.
- [ ] Add terminology registry entries for neutral stage terms, both languages and glossary definitions; run registry and component tests.
- [ ] Write AC-007 role-job journey: Admin prepares scale/keeper assignment, Material Coordinator signs in at their actual access level, performs the recorded job and verifies saved rollup. No role escalation in the job steps.
- [ ] Render desktop/tablet/phone, loading/empty/error and rich-data states; fix one review round and rerun touched component tests.
- [ ] Run scoped gates and commit C's files.

App directory exact commands:
```sh
npm run check:guards
npm run typecheck
npx vitest run --maxWorkers=1 src/lib/db/ownerMaterial.test.ts src/auth/policy.ownerMaterial.test.ts pages/work-order-detail/OwnerMaterialPipeline.test.tsx pages/workOrders/OwnerMaterialRollup.test.tsx
npx eslint --max-warnings=0 pages/work-order-detail/ClientMaterialSection.tsx pages/work-order-detail/OwnerMaterialPipeline.tsx pages/work-order-detail/OwnerMaterialPipeline.test.tsx pages/WorkOrders.tsx pages/workOrders/OwnerMaterialRollup.tsx pages/workOrders/OwnerMaterialRollup.test.tsx src/lib/db/ownerMaterial.ts src/lib/db/ownerMaterial.test.ts src/lib/repositories/ownerMaterial.ts src/hooks/useOwnerMaterial.ts src/auth/policy.ts src/auth/policy.ownerMaterial.test.ts src/lib/i18n/orgTerms.ts e2e/AC-007-owner-material-role-job.spec.ts
```
Root: `node scripts/affected-e2e.mjs`; coordinator owns execution of its enumerated journeys plus `scripts/e2e-local.sh AC-007-owner-material-role-job` and `scripts/ux-proof.sh /work-orders /work-orders/<seeded-id>` under `scripts/with-db-lock.sh` (substitute the actual local seeded UUID; never reset without this branch's migration/seed change). Read e2e conventions first; no CI-only gates or unexplained skips. Capture every state at 1440, 1024, 390. Use normal shared server setup outside DB lock; lock holds at most 15 minutes.

## Shared integration and acceptance

Coordinator exclusively adds `scripts/owner-material-parity.mjs` and `scripts/owner-material-parity.test.mjs` for AC-010 and performance runner `scripts/perf/owner-material-benchmark.mjs` for AC-009. These files are not built in any parallel slice.

1. Merge A/B/C locally, resolve interfaces against v1, and run changed targeted tests once; no outer full verification chains. Check migration registry, repository role matrix and every acceptance owner.
2. Read private profile `M0-workbook-profile.md` in the coordinator's private build folder; preserve source. Resolve every dirty class using an approved private map. Openpyxl caches are evidence only; report arithmetic conflicts. Never label partial import a successful full demonstration.
3. Preview overlap against the updated sample data. Match real work orders/items/sections/plans and top up. Admin separately reverses overlapping estimated movements/cancels sample requests; no wholesale reset of shared demo data. Do not touch the sample loader scripts or its running organisation from this planning task.
4. `node scripts/owner-material-parity.mjs --source /private/material.xlsx --map /private/material-map.json --project <uuid>` reads source and RPCs, reports per-item/per-unit and mean differences for five samples and all accepted sections; it does not write. Test first with `node --test scripts/owner-material-parity.test.mjs`. Require exact scale-three stage equality and ≤0.01 percentage-point display difference; require a second confirmed loader command to create/update zero records.
5. AC-009: benchmark seeds only made-up rows in local disposable data, 18,600 items/12,000 lines; `scripts/with-db-lock.sh node scripts/perf/owner-material-benchmark.mjs` measures 20 warm calls with p95 <500ms and captures EXPLAIN from `scripts/perf/owner_material_explain.sql`. Resolve planner/index issues before claiming P0 proof.
6. One integration writer owns merged-role browser journeys and one manual `scripts/ci-e2e.sh batch/3010-owner-material` for the round. CI owns full regression proof. Prior to a PR-bound push use `node scripts/ci-test-scope.mjs --base origin/dev` and run the selected unit list with one worker; >60 files goes to spare server or explicit CI handoff. No PR in this docs task.
7. Record proof counts, role-job screenshot, parity refusals and timings. Owner approves composition and any source interpretations. Record short video only after complete parity for the selected demonstration scope. No promotion above dev.

## Traceability

| Spec | Acceptance | Canonical test | Slice |
|---|---|---|---|
| FR-001..004,012 | AC-001 | `scripts/pmo-owner-material.test.mjs` | B |
| FR-009,011,012 | AC-002 | `scripts/owner-material-workbook.test.py` (parsing); Node test references AC-002 as supplementary transport proof | B |
| FR-005,006 | AC-003 | `supabase/tests/2790_owner_material.test.sql` | A |
| FR-007,NFR-001 | AC-004 | `supabase/tests/2790_owner_material.test.sql` | A |
| FR-008,015,NFR-003 | AC-005 | `supabase/tests/2790_owner_material.test.sql` | A |
| FR-010 | AC-006 | `supabase/tests/2791_owner_material_import.test.sql` | A |
| FR-005,008,013,014,015 | AC-007 | `pmo-portal/e2e/AC-007-owner-material-role-job.spec.ts` | C/shared run |
| FR-013,014,016,NFR-004 | AC-008 | `pmo-portal/pages/work-order-detail/OwnerMaterialPipeline.test.tsx` (rollup file supplementary) | C |
| NFR-002 | AC-009 | `scripts/perf/owner-material-benchmark.mjs` | integration |
| FR-006,007,009..012 | AC-010 | `scripts/owner-material-parity.mjs` | integration |

All owning test titles begin with the AC ID. Add terms Requested, Owner set-aside, Received, Issued, Returned, Transferred, Closing stock and Material reconciliation to glossary in C, explicitly distinguishing external owner reservation from internal stock held. No client names, real codes, workbook rows or private source coordinates in commits, fixtures or public proof.
