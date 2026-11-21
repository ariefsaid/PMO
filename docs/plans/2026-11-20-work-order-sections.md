# Work-Order Sections Implementation Plan (#2576)

> Fresh Orca worker per slice; Slice 3 (material requests) Director-dispatched and ships alone. Spec: `docs/specs/work-order-sections.spec.md`. Sign OD-WOS-1..7 and answer OQ-WOS-1..2 first. Builds on shipped `work_orders` (0193), `work_order_plan_lines` (0997), `material_requests`/`material_request_lines` (1000/1001), `work_order_cost_lines` (0951, untouched). Child links to #2528 crews, #1522 daily report, #2531 tasks and the #2529 override are separate later slices, each started only when its dependency has shipped; reconcile their final table and column names at that time.
> Read first: `docs/specs/work-order-plan-vs-actual.spec.md`, `docs/specs/material-requests.spec.md` (FR-MRQ-002, `mrq_plan_quantity`), `docs/adr/0018*.md`, the reference slice `pages/Companies.tsx` + `src/lib/db/companies.ts`.

## Built on defaults (owner to confirm)

The builder took each recommended default; none is a ruling. If one is wrong, the "if wrong" column of the spec names what breaks.
- **OD-WOS-1** zero or more sections per work order; no record is forced into one (the remainder row exists whenever at least one section does).
- **OD-WOS-2** the foreman is one active user of the organisation, optional; the section's foreman may set readiness on their own section only (a guard trigger limits them to the readiness columns).
- **OD-WOS-3** a flat list per work order (200 at most), no nesting.
- **OD-WOS-4** cost attribution does not gain a section.
- **OD-WOS-5** readiness is one held value plus a note; it gates nothing; no weekly plans or checklists.
- **OD-WOS-6** per-section material allocation is optional; the work-order plan check always applies and the stricter of the two applies.
- **OD-WOS-7** English "Section", Bahasa "Bagian", through `terms.section` / `terms.sections`.
- **OQ-WOS-1** a crew is placed on a section by date range (the roster's shipped one-placement-a-day rule refuses two sections the same day).
- **OQ-WOS-2** quantities and task counts only; no single progress percent.
- Builder choices inside those defaults: a Closed work order refuses new sections and structure edits but still takes readiness and archive; a Cancelled one refuses every change; an archived section stays in the roll-up (records already on it keep it) and a section code stays reserved after archive.

## Build state at the end of the branch (reconciled with `dev`, 2026-11-20)

The Delivery checklist's "unshipped" owners had in fact shipped on `dev` when this was built: crews roster (`1035`, #2528), daily site reports (`1040`, #1522), task-to-work-order link (`1038`, #2531) and org terminology (`1024`, #2529). Built: crew placement, task and daily-report progress-line links (`1171`; the progress line gained a `work_order_id` stamped from its report so the composite key holds, and `dsr_replace_lines`/`dsr_correct` are restated whole), plan lines, material check and request link, and the validated-quantity-per-section read (`work_order_section_progress`, `1172`) shown on the sections block. **Not built:** `section` as an *overridable* term in #2529's closed term set (the key and its use are in place; the override is a one-line addition to that set plus its check constraint).

Migrations used: `1169` section master, `1170` plan-line link, `1171` crew and task links, `1172` reads, `1173` material allocation, request link and submit check (shipped alone, own commits).

## Design
- **Parent-child integrity by composite key.** `work_order_sections` has `unique (id, work_order_id)`. Each child that already has `work_order_id` gains `section_id uuid null` and a composite foreign key `(section_id, work_order_id) references work_order_sections (id, work_order_id)`. With default MATCH SIMPLE a null `section_id` skips the check, so an unsectioned record is always valid and a section of another work order is impossible at the database, whichever path writes. Org and project coherence is checked in the section's own guard trigger and the children's existing guards. ADR candidate: this composite-FK pattern.
- **Roll-up by construction.** Children keep `work_order_id`; the work-order total is the sum of all rows on it. The section read is a `group by section_id` (null shown as "Not in a section"), so `sum(sections) + remainder = total` holds without a second formula. The invariant is a Layer-1 unit test and a pgTAP assertion.
- **Pure module** `pmo-portal/src/lib/workOrderSections.ts`: `rollupBySection(rows, measure)`, `readinessRollup(sections)`, `allocationHeadroom(woPlan, allocations)`; exact decimals via the repo's `exactDecimal` helper; no I/O.

## Migrations (numbers assigned by the Director; each with a `supabase/migrations/rollback/*_down.sql`; RLS enabled and forced; `org_id` default `coalesce(auth_org_id(), seed org)` plus `stamp_org_id()` before-insert trigger as in 0997; every policy calls helpers as `(select helper())`, checked by `supabase/tests/0646_rls_initplan.test.sql`)
1. **Section master.** `work_order_sections` (id, org_id, project_id, work_order_id not null, code, name, location_note, foreman_id null references profiles, readiness text check in (`not_ready`,`ready`,`blocked`) default `not_ready`, readiness_note, readiness_set_by, readiness_set_at, sort_order, archived_at, created_by/at, updated_by/at). Unique `(org_id, work_order_id, code)` including archived; unique `(id, work_order_id)`. Guard trigger (definer, `set search_path`): work order on the row's org and project; foreman is an active same-org user; keys immutable; Cancelled work order refuses all writes, Closed refuses insert only; archive refused while a `draft`/`pending` material request references it (and, once #2531 ships, a task not Done). Policies: select as work order read; insert/update for the roles that write plan figures; foreman update limited to readiness columns through a guard trigger or column grants; delete Admin only. Audit via the history hook used by `work_order_plan_lines`. **Rollback:** drop table (cascades policies/triggers), drop the guard and audit functions.
2. **Plan-line link.** `work_order_plan_lines.section_id` plus composite FK; replace the one-per-kind unique index with one that includes `coalesce(section_id, nil uuid)`; add `section_id` to the table's INSERT and UPDATE column grants and extend `set_work_order_plan` (0997, security invoker) to take a section per change — without the grant the RPC cannot write or move a section. Backfill nothing (all null). **Rollback:** drop the column, restore the 0997 index and grants (refuse the down migration, with a clear message, if two lines now collide only by section).
3. **Section material allocation.** `work_order_section_material_plan` (org_id, work_order_id, section_id, item_id, quantity numeric(14,3) check > 0, unique (section_id, item_id), composite FK to section). Definer trigger: sum of allocations per work order and item must not exceed `mrq_plan_quantity` for that item (reuse the function, do not copy it); an archived section takes no new allocation. **Rollback:** drop table and trigger.
4. **Material-request link.** `material_requests.section_id` plus composite FK on `(section_id, work_order_id)`; the existing edit guard makes it editable only in `draft` or after a return; the submit RPC (1001) is extended so the over-plan reason is required if the line is over the work-order plan **or** the section allocation; the prior-quantity read gains a per-section variant. Existing RPC bodies are changed in a new migration that restates the function whole, never edited in place; cross-check with the three-way-match and spend-route migrations that follow 1001 for overlapping functions. **Rollback:** restore the prior function bodies, drop the column.
5. **Reads.** `work_order_section_rollup(p_work_order_id uuid)` (security invoker, bounded, returns one row per live section plus the null row: plan by kind, requested/remaining material per item via a paged companion read, readiness) and view `work_order_section_readiness`. **Rollback:** drop both.
6. **Later, one migration per dependency** (each only after its ticket ships): crew roster placement `section_id` with an exclusion constraint preventing one crew on two sections of a work order on overlapping dates (#2528); daily-report progress line `section_id` (#1522); `tasks.section_id` (#2531). Same composite-FK rule and rollback shape.

## Slice 1 — pure module and terminology key (Orca)
- [ ] 1.1 Write failing `pmo-portal/src/lib/__tests__/workOrderSections.test.ts` with the AC-WOS-002 fixture (400.00 + 350.00 + 250.00 = 1,000.00; cable 40 + 10 + 20 = 70) and a 0.1 x 3 float-trap case. Run `npx vitest run src/lib/__tests__/workOrderSections.test.ts`; red.
- [ ] 1.2 Implement `rollupBySection`; green. Mutation check: drop the remainder row; the test must go red; restore.
- [ ] 1.3 Tests then code for `readinessRollup` (the render of the server's counts, AC-WOS-014) and `allocationHeadroom` (AC-WOS-008 first half).
- [ ] 1.4 Add `section: t('terms.section', 'Section')` to `pmo-portal/src/lib/i18n/terms.ts` and the key to `public/locales/en/common.json` (`terms.section`: "Section") and `public/locales/id/common.json` (`terms.section`: "Bagian"). Test AC-WOS-018 (a rendered stand-in uses `useTerms().section`, no literal). Run `npm run check:guards` for the catalogue parity.

## Slice 2 — section master, plan-line link, reads (Orca; Opus builder, RLS-adjacent)
- [ ] 2.1 pgTAP `supabase/tests/<NNNN>_work_order_sections.test.sql` written first: AC-WOS-001, 003 (plan-line path), 004, 005, 007, 012, 013, 014, 015, 016 and AC-WOS-002 at the SQL layer. Run chained under one lock: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<NNNN>_work_order_sections.test.sql'`. Red.
- [ ] 2.2 Migrations 1, 2 and 5 with rollback files; green. Also run `supabase test db supabase/tests/0646_rls_initplan.test.sql` and `supabase/tests/0997_work_order_plan_vs_actual.test.sql` (plan figures unchanged for unsectioned lines).
- [ ] 2.3 Mutation checks: set the composite FK to a plain FK on `section_id` (AC-WOS-003 must go red); remove the Cancelled refusal (AC-WOS-005 red); drop the foreman column restriction (AC-WOS-015 red). Restore each.
- [ ] 2.4 `pmo-portal/src/lib/db/workOrderSections.ts` (DAL), `src/lib/repositories/workOrderSections.ts` (ADR-0017), hooks; never pass `org_id` from the client. Register actions `create|edit|archive|delete|set_readiness` for entity `work_order_section` and `set_plan` in `src/auth/policy.ts` and the role matrix (#902, FR-WOS-023); `can()` unit tests per role incl. the foreman case.
- [ ] 2.5 Plan editor change: `src/lib/db/workOrderPlanLines.ts` (or the shipped plan-line DAL) accepts an optional `sectionId`; the plan table shows section totals and the remainder row.

## Slice 3 — material check and request link (Director-dispatched, ships alone; approval and stock path)
- [ ] 3.1 Read `docs/money-path-primer.md` and the 1000/1001 migrations and any later migration redefining `submit_material_request` or `mrq_*`.
- [ ] 3.2 pgTAP `supabase/tests/<NNNN>_work_order_section_materials.test.sql`: AC-WOS-008 (allocation caps), 009, 010, 011. Red, then migrations 3 and 4; green. Mutation check: make the section check always pass; AC-WOS-009 must go red; restore. Also rerun the shipped material-request pgTAP files for unchanged behaviour of unsectioned requests.
- [ ] 3.3 Section selector on the request form (`SelectField`, live sections of the work order only), section allocation editor, per-section material check table; strings in `materialRequests.json` (en + id). Reuse `classifyMutationError` for the new refusals.

## Slice 4 — screens (ui-implementer; `restructure`)
- [ ] 4.1 Compose the work-order page Sections block with the `restructure` skill (taste and stageshow), judged on the rendered screen by the owner (`docs/ux/screen-rules.md`): section rows (code, name, foreman, crew today, readiness chip, plan, progress), the "Not in a section" row, readiness toggle usable at 320px, empty state with the add action, archive via `ConfirmDialog`. Forms use `EntityFormModal`/`useEntityForm`/`TextField`/`SelectField`/`Combobox`. New namespace `workOrderSections` in `public/locales/en` and `id`, listed in `NAMESPACES` (`src/lib/i18n/index.ts`) and on the route preload rule (`CATALOGUES.md`); Bahasa written by the Director/agent, not copied from English.
- [ ] 4.2 Unit/RTL for the section list states (empty, loading, error, archived hidden, foreman view) asserting user actions only.
- [ ] 4.3 E2E `pmo-portal/e2e/AC-WOS-019-sections-rollup.spec.ts` (one journey, per `docs/e2e-parallel-conventions.md`, with its `@e2e-isolation` tag). Run `scripts/e2e-local.sh AC-WOS-019`.
- [ ] 4.4 `scripts/ux-proof.sh` on the touched routes; `node scripts/affected-e2e.mjs`.

## Slice 5+ — when each dependency ships
- [ ] #2528: crew placement pointer, AC-WOS-017 pgTAP (exclusion constraint), foreman list and "crew today" on the section row; answer OQ-WOS-1 first.
- [ ] #1522: progress-line pointer and per-section validated quantities; no second percent formula (OQ-WOS-2).
- [ ] #2531: `tasks.section_id`, Done-of-total per section, archive guard on open tasks.
- [ ] #2529: confirm the override store applies to `terms.section`; remove any literal found by its check.

## Traceability (each AC owned at one lowest sufficient layer, ADR-0010)
| AC | Layer | File |
|---|---|---|
| AC-WOS-001 | pgTAP (owner) | `<NNNN>_work_order_sections.test.sql`; also referenced: Unit in `workOrderSections.test.ts` |
| AC-WOS-002 | pgTAP (owner) | `<NNNN>_work_order_sections.test.sql`; also referenced: Unit in `workOrderSections.test.ts` |
| AC-WOS-003, 004, 005, 006, 007 | pgTAP | `<NNNN>_work_order_sections.test.sql` (006 also needs a material request fixture) |
| AC-WOS-008 | pgTAP (owner) | `<NNNN>_work_order_section_materials.test.sql`; also referenced: Unit in `workOrderSections.test.ts` |
| AC-WOS-009, 010, 011 | pgTAP | `<NNNN>_work_order_section_materials.test.sql` |
| AC-WOS-012 | pgTAP (owner) | `<NNNN>_work_order_sections.test.sql`; also referenced: Unit in `workOrderSections.test.ts` |
| AC-WOS-013, 015, 016 | pgTAP | `<NNNN>_work_order_sections.test.sql` |
| AC-WOS-014 | pgTAP (owner) | `<NNNN>_work_order_sections.test.sql`; also referenced: Unit (render) in `workOrderSections.test.ts` |
| AC-WOS-017 | pgTAP | crew-link test, Slice 5 |
| AC-WOS-018 | Unit | terminology test, Slice 1 |
| AC-WOS-019 | E2E | `e2e/AC-WOS-019-sections-rollup.spec.ts` |

## Glossary (added to `docs/glossary.md` with the spec)
Section (child of a work order, generic term; the org's own word comes from the terminology dictionary) · Unsectioned remainder · Roll-up invariant · Section readiness · Section allocation (planned material quantity per section).

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, touched vitest files, touched pgTAP files under `scripts/with-db-lock.sh`, touched e2e journeys, `scripts/ux-proof.sh` on touched routes. Reviewers: spec, code-quality and security-auditor (RLS on three new tables, foreman column restriction, composite-FK bypass attempts). Slice 3 also gets the money/SoD tier review.
