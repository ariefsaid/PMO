# #1325 — Optional project short names

Date: 2026-10-23 · Session: ba204572 · Builder plan: `adws/adw_data/sessions/ba204572/context_handoff/plan.md`
Repository copy: `docs/plans/2026-10-23-project-short-names-ba204572.md`

## Requirements and scope

Requirements source: `gh issue view 1325` and the accompanying operator brief. No separate short-name spec was found under `docs/specs/`; the issue contains all five acceptance criteria. The following IDs normalize its AC-1…AC-5 without changing their meaning:

| ID | Given / When / Then | Owning layer and canonical proof |
| --- | --- | --- |
| AC-001 (issue AC-1) | Given a new or existing delivery/pipeline project, when its optional short name is created, edited or cleared, then it persists independently and its contractual name remains required. | Unit/RTL: `pmo-portal/components/ProjectFormModal.shortName.test.tsx`; DAL tests support persistence. |
| AC-002 (issue AC-2) | Given a project with a short name, when scanning the projects list, pipeline cards/table, project header, breadcrumbs, pickers or global search, then the short name is displayed, the contractual name is disclosed, and searches match either. Without a nonblank short name, display the contractual name. | Unit/RTL: `pmo-portal/pages/Projects.shortName.test.tsx`, with enumerated surface-specific tests below at the same owning layer. SQL projection tests and one browser journey supplement, not replace, these proofs. |
| AC-003 (issue AC-3) | Given different contractual and short names, when producing invoices, statements, exports or an ERPNext Project, then contractual/established ERP identities remain unchanged. | Unit: `supabase/functions/external-set-company/setup.test.ts`, plus actual export/statement/invoice boundary tests below. |
| AC-004 (issue AC-4) | Given the existing authenticated CLI/API, when setting, reading or bulk backfilling short names, then it transports the optional field separately from `name`, including explicit clearing. | Unit/Node: `scripts/pmo.test.mjs` and `scripts/pmo-load.test.mjs`; authenticated pgTAP supports the real database seam. |
| AC-005 (issue AC-5) | Given the migration, when reversing it, then the prior schema/projections return; given another organization's project, when reading or editing its short name, then no foreign row is read or changed. | Integration/pgTAP: `supabase/tests/0365_project_short_name.test.sql`; executable migration-pair reversal is supplementary integration proof. |

Use these `AC-###` tokens in test titles/descriptions, optionally followed by `#1325` to distinguish existing generic AC IDs. Each criterion owns exactly one test layer; multiple surface cases at that layer are intentional.

Do not expand into a dashboard-wide naming rewrite, project renaming, lifecycle changes, financial changes, a new API endpoint, or a new pipeline entity. Keep existing document contents, export columns, integration mappings and company behavior. No new ADR is needed: this follows the existing nullable company enhancement and established DAL/repository/RLS contracts.

## Design and deciding artifacts

### One table, two identities

`pmo-portal/src/lib/db/projects.ts`, `src/lib/db/opportunity.ts`, `src/hooks/useDashboard.ts`, and migration `0261_pipeline_hides_archived.sql` establish that **delivery projects and pipeline entries are different stage partitions of `public.projects`**. `pipeline_stage_config` stores probabilities, not entries. Add **one** nullable `projects.short_name text` in **0365**, not a table/column named opportunities. Winning an entry retains the same row and both names.

Keep `projects.name` contractual everywhere in storage, caches and RPC payloads. Add `short_name` alongside it; never map a display alias back into `name`. Copy the Companies pattern from `0226_company_short_name.sql`, `src/lib/companyDisplayName.ts`, `pages/Companies.tsx`, `src/lib/db/companies.ts`, and `scripts/lib/pmo-load.mjs`, but do not copy obsolete dashboard SQL or company-specific external-ownership routing.

Write normalization: omitted `undefined` means leave unchanged; explicit `null`, empty or whitespace-only means clear to NULL; otherwise trim. Read fallback: `short_name?.trim() || name`. No uniqueness, artificial length limit, backfill, extra index, table, row policy or RPC is needed. Duplicate short names remain distinct by UUID and the existing identifiers.

Authenticated project writes use column privileges, so explicitly grant INSERT/UPDATE of `short_name`; retain the existing row-level tenancy and role policies and server-stamped `org_id`. Do not send `org_id` from application/CLI payloads. Merge `short_name: "text"` into the project's `record_history_config.captured` object so the existing history classification gate remains complete. Preserve all other registry entries.

### Data flow and projections

Create/edit: shared `ProjectFormModal` → typed project repository → DAL → PostgREST → existing project row policies. Full project queries already select `*`. Explicit opportunity, pipeline and loader projections must add the field separately. `get_sales_pipeline()` remains JSON with contractual `name` and added nullable `short_name`; retain its archive/stage filters, classifications, identifiers, company legal/display names, money fields, sort and aggregates.

Global search has TWO paths. Cached name search (`useRecordSearch`) searches both identities. Bounded reference search (`search_record_references`) keeps its current matching/ranking/indexing but returns short-first project titles with contractual identity in context. Update all three project-reference branches, not invoice/receipt document identities. Do not turn reference search into an unbounded name query.

Preserve existing org-scoped query keys and invalidate the newly affected independent families after a successful project mutation: `['fk-options','invoice-project']`, `['financial-statements','mapped-project-name']`, and `['uxs40','references']`, as well as the existing project/opportunity/pipeline/lost/FK-project families. No new shell fetch or per-row lookup is needed. `listProjectIdentity()` currently feeds FinanceDashboard rather than a picker; leave that unrelated surface and its contract unchanged.

### UI direction

Operate mode: allow operators to recognize a job quickly without losing its contractual identity. Keep the same routes, layouts, controls, table columns, permissions and error states. Add one optional `TextField` immediately after Project name, using the existing form/modal/page variants. Use existing DESIGN.md tokens and shared primitives only. Short names are display values, not a reason to shrink identity columns or introduce chips/tooltips/modals.

Lists/cards/header/breadcrumb: short-first text, contractual `title` attribute, existing identifiers unchanged. For picker options use a short-first label and contractual secondary text; native selects can use `Short — Contractual title` because they cannot render Combobox secondary lines. Combobox already searches label and sub. Ensure its selected trigger also discloses the selected option's secondary text with a title. No additional picker network request.

New copy goes in the **feature namespace**, never `common.json`: `public/locales/{en,id}/projects.json`, referenced explicitly as `projects:shortName.*`. In ProjectFormModal and useRecordSearch load `useTranslation(['common', 'projects'])`: common stays the default for incumbent keys and the feature namespace is explicitly loaded before referencing `projects:shortName.*`. Suggested exact keys/values:

| Key in projects.json | en | id |
| --- | --- | --- |
| shortName.label | Short name (optional) | Nama singkat (opsional) |
| shortName.hint | Used in lists and search. The contractual project name stays unchanged. | Digunakan di daftar dan pencarian. Nama proyek dalam kontrak tetap sama. |
| shortName.searchProject | Project · {{name}} | Proyek · {{name}} |
| shortName.searchPipeline | Project · Pipeline · {{name}} | Proyek · Pipeline · {{name}} |

Skills loaded for planning: Impeccable from the installed skill; taste and ui-ux-pro-max from the sibling checkout's existing vendored skill files (this worktree has no `.claude/skills/`). DESIGN.md overrides conflicting generic font/icon/motion advice. No new dependency or lockfile change. Planner baseline detector: bare `impeccable detect --json` exited 127 (CLI unavailable); the installed skill's supported equivalent `node /Users/ariefsaid/.agents/skills/impeccable/scripts/detect.mjs --json` exited 0 with `[]` on ProjectFormModal, Projects, SalesPipeline and ProjectDetailHeader: **0 findings across 4 unchanged files**. This is not post-build evidence. Builder must repeat on every touched UI file and report counts.

### Contractual boundaries

ERP project creation is `supabase/functions/external-set-company/setup.ts::ensureErpProject`: match with `project.name` and create `{ project_name: project.name, company: ctx.company }`. Its real-handler test already exists. Do not route the display helper into that function or document generation.

`InvoiceProjectOption.label` currently serves both pickers and invoice previews. Add a separate required `contractualName: string` field to that option type before making its label short-first. Pickers use label/sub; invoice preview/approval/e-Faktur context uses contractualName. ERP invoice/report links continue using `project_map`, not either human label. FinancialStatements must similarly separate its selector label from the contractual report scope label.

Projects and Pipeline already have explicit `exportValue: row => row.name`; keep those even when screen cells change. Existing revenue/management-pack/procurement/meeting/expense exports remain contractual. Do not change the stored `name` in a hook to accomplish UI display.

### Scale and errors

The change adds a nullable scalar to existing batched reads, not N+1 queries or a second cache. Pure display helpers avoid repeated ad-hoc normalization. Preserve bounded reference queries, debouncing, caps, literal escaping and code-first ranking. The existing list-based name search remains the incumbent scalability seam; server-paginated general name search is outside this issue. Alias lookup must never become a matching/deduplication key in the loader.

Keep AppError/classifyMutationError, zero-row write detection, required-field validation, loading/empty/error states, no eager validation, persistent modal save errors and existing write gates. Do not change permissions or money-path behavior. Rollback restores dependent function bodies before dropping the column; no CASCADE. Reversal necessarily discards optional aliases, so document exporting them first; do not invent a new down-migration refusal policy.

## Execution rules

All numbered tasks are approximately 2–5 minutes of focused editing (test runtime is additional). Follow dependencies in order. For new behavior: write the stated test, run its command and observe the intended RED, implement only the stated change, rerun GREEN. New regression-only assertions for unchanged contractual behavior may pass initially: prove binding with the specified temporary mutation instead of breaking production to manufacture RED. Restore mutations before proceeding. Never weaken or skip tests.

Commands below run from repository root unless they explicitly `cd pmo-portal`. Use bare commands from the inherited toolchain. Use test/DB locks as shown; reset plus DB tests must remain ONE lock hold. Only local test resources are authorized. No push, merge, deployment, main/production promotion or lockfile regeneration is part of this plan.

## Implementation tasks — 30 tasks

### 1. Specify the real schema/write/tenancy contract (AC-001, AC-004, AC-005)

Create `supabase/tests/0365_project_short_name.test.sql`, using synthetic two-org/user/project fixtures and the role/JWT pattern in `supabase/tests/0226_company_short_name.test.sql`. Test nullable text type; omitted alias → NULL; authenticated same-org create/edit/clear; required legal name still required; alias changes leave legal name intact; INSERT/UPDATE column privileges; OAuth-shaped client claim; other-org SELECT returns zero rows and UPDATE RETURNING changes zero rows. Reset to fixture-owner role and assert the foreign row's alias is unchanged. Include a denied non-writer case, keeping current policy behavior. Use exact plan count, `finish()` and transaction rollback. Prefix descriptions with the corresponding AC IDs.

RED command: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0365_project_short_name.test.sql'`.

### 2. Add 0365 storage, history classification and pipeline projection (AC-001, AC-002, AC-004, AC-005)

First extend Task 1's SQL test to prove pipeline rows expose contractual `name` plus nullable `short_name`, archive filtering remains intact, and an alias-only write records a short_name history change without a name change. Extend the exact pipeline key array in `supabase/tests/0234_project_classification.test.sql` with `short_name`; retain every incumbent expected key.

Create `supabase/migrations/0365_project_short_name.sql`: add nullable text column, neutral column comment, `grant insert(short_name), update(short_name) on public.projects to authenticated`, merge only the history captured entry, then forward-copy `get_sales_pipeline()` from `0261_pipeline_hides_archived.sql`. Add `p.short_name` to its CTE and `'short_name', pl.short_name` to JSON. Leave `'name', pl.name` intact. Preserve SECURITY INVOKER, fixed search_path, ACLs and existing behavior. Comment latest definition as 0365 and notify PostgREST. Recheck the latest checked-in body after incorporating the intended dev baseline; do not overwrite sibling functionality or renumber 0365 into 0362–0364.

GREEN command: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0365_project_short_name.test.sql supabase/tests/0234_project_classification.test.sql supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/record_changes_catalog_gate.test.sql'`.

### 3. Preserve short/legal identity in uncached reference hits (AC-002)

Extend `supabase/tests/0329_record_reference_search.test.sql` first: distinct names for a project; customer-order, client-code and PMO-number searches all yield short title and contractual secondary context; one result after multi-reference matches; null/blank alias fallback; existing foreign-org/cap/rank/escaping assertions stay unchanged. Observe RED with that test under the DB lock.

Append the current `0329_record_reference_search.sql` function definition to 0365. Only in its THREE project `all_aliases` branches use `coalesce(nullif(btrim(p.short_name), ''), p.name)` for title and include `p.name` in context when trimmed short name is nonblank and differs. Use identical context expressions across branches so dedupe remains valid. Keep invoice/receipt context, candidate selection, limits, roles, invoker execution and ACLs unchanged. No name-search index.

Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0329_record_reference_search.test.sql supabase/tests/0365_project_short_name.test.sql'`.

### 4. Prove executable down/up reversal (AC-005)

Create `scripts/check-project-short-name-reversal.mjs`, following `scripts/check-m365-record-folder-reversal.mjs`: require the DB lock; read the ACTUAL 0365 up/down files; use local Docker psql with ON_ERROR_STOP and check child exit status; run the probe inside one transaction. Save pre-probe contractual project values; execute down; assert column/history-member absence and callable prior pipeline/reference functions; execute up; assert column, privileges, history member and pipeline JSON key return; assert contractual data/unrelated history configuration unchanged; roll back the entire probe. Include a synthetic alias in the transaction so the test does not pass solely on all-NULL data. The re-added alias column is expected NULL; down is not an alias-data backup. Initial run is RED because the down file is absent.

Create `supabase/migrations/rollback/0365_project_short_name_down.sql`: restore the pre-0365 reference-search body (0329) and pipeline body (0261), comments and ACLs; remove only history captured.short_name; revoke its two column grants; drop the column without CASCADE; notify PostgREST. Both SQL files must compose inside the probe transaction. Add `scripts/with-db-lock.sh node scripts/check-project-short-name-reversal.mjs` to `.github/workflows/ci.yml`'s existing pgTAP job after schema reset, not the DB-free Node-test discovery job.

Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/check-project-short-name-reversal.mjs && supabase test db supabase/tests/0365_project_short_name.test.sql supabase/tests/0329_record_reference_search.test.sql'` and `bash scripts/check-migration-collisions.sh`.

### 5. Update the generated schema contract without collateral drift (AC-001, AC-002)

Add a failing column assertion first to `pmo-portal/src/lib/db/opportunity.test.ts`: OPPORTUNITY_COLUMNS must contain short_name. Generate a local snapshot with `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > /tmp/pmo-1325-ba204572-database.types.ts'`. Incorporate only the generated projects Row `short_name: string | null`, Insert/Update `short_name?: string | null` into `pmo-portal/src/lib/supabase/database.types.ts`. Preserve intentional nullable RPC return annotations and file header; do not replace the entire file blindly or edit the legacy Project shape in `types.ts` as a substitute. Add short_name to `OPPORTUNITY_COLUMNS` in `src/lib/db/opportunity.ts`.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/opportunity.test.ts && npm run typecheck'`; `git diff --check`.

### 6. Thread normalized optional writes through the DAL (AC-001)

In `pmo-portal/src/lib/db/projects.test.ts`, add red cases for create/header-update set, whitespace trimming, explicit NULL/blank clear, omission NOT clearing, separate required contractual name, and no sent org_id. Preserve error/zero-row assertions.

In `src/lib/db/projects.ts`, add `short_name?: string | null` to CreateProjectBase and ProjectHeaderInput. In each explicit insert/update object use `...(input.short_name !== undefined ? { short_name: input.short_name?.trim() || null } : {})`. Existing repository delegates already forward these typed inputs; do not add routing or a new writer.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/projects.test.ts src/lib/db/opportunity.test.ts'`.

### 7. Carry aliases through open and lost pipeline reads (AC-002)

Add red assertions in `pmo-portal/src/lib/db/dashboard.test.ts` and `src/hooks/useDashboard.test.tsx`: RPC data and lost/declined row mapping retain distinct name/short_name values and NULL aliases. Add nullable `short_name: string | null` to PipelineProject in `src/lib/db/dashboard.ts`; add `short_name: r.short_name` in `useLostDeals()` in `src/hooks/useDashboard.ts`. Update typed pipeline fixtures to NULL by default, not unsafe casts. Keep company display/legal and numeric fields untouched.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/dashboard.test.ts src/hooks/useDashboard.test.tsx'`.

### 8. Lock the generic CLI/API transport contract (AC-004)

Extend `scripts/pmo.test.mjs` beside the company short-name transport test: create a project with both fields; GET select `id,name,short_name`; alias-only filtered PATCH does not send name; NULL clears; a multi-ID filter can apply one common value; zero-row update remains an error. Assert returned representations, not only request presence. Generic `pmo.mjs` already transports JSON fields on the allowlisted projects table; do not create a command/endpoint or rewrite API request guards. Treat these as baseline preservation tests if already green. Use the authenticated SQL tests in Task 1 as real write/read enforcement evidence.

Verify: `node --test scripts/pmo.test.mjs`.

### 9. Accept project aliases in bulk-load creation (AC-004)

Write red cases in `scripts/pmo-load.test.mjs` for optional project short_name, non-text validation failure, new-project create payload and read projection. In `scripts/lib/pmo-load.mjs`, add short_name to OPTIONAL_PROJECT_FIELDS/PROJECT_FIELDS, validate it like the company field, and add it to PROJECT_SELECT. Normalize nonblank supplied text before plan/write; blank is an absent loader enhancement, not an instruction to overwrite/clear. Generic update remains the deliberate clear operation. Keep matching by code or legal-name/client, and never by short_name.

Verify: `node --test scripts/pmo-load.test.mjs scripts/pmo.test.mjs`.

### 10. Make alias backfill resumable and non-destructive (AC-004)

Before implementation, add loader tests for existing empty alias → set, identical → no write, different nonblank alias → report conflict, dry-run → no write, zero-row PATCH → failure, and retry after successful alias write → no duplicate write. Preserve the existing `e.path === null` diverged-stage skip; explicitly test it and document using generic filtered update to backfill such rows.

In `scripts/lib/pmo-load.mjs`, add a separate per-project `short_name` plan action (`none`, `same`, `set`, `differs`) from current/wanted trimmed values. For admitted existing rows, execute the alias-only PATCH after identifying/creating the row and before existing value/transitions; require returned rows. Emit `project.set_short_name` and `project.short_name_differs` events using the company's established report shape. Do not conflate alias action with stage path or contract value action; do not overwrite existing differing aliases. Newly created projects already get the field from Task 9 and must not receive a redundant PATCH.

Verify: `node --test scripts/pmo-load.test.mjs scripts/pmo.test.mjs`.

### 11. Add pure display/picker helpers (AC-002)

Create `pmo-portal/src/lib/projectDisplayName.test.ts` first: trim/prefer alias; null/undefined/empty/whitespace fallback; same-as-contractual avoids duplicate picker text; input name is never mutated; duplicate aliases do not alter IDs.

Create `src/lib/projectDisplayName.ts` with structural input `{ name: string; short_name?: string | null }` and two exports: `projectDisplayName(project): string` returns trimmed alias or name; `projectPickerLabel(project): string` returns display alone when it equals name, otherwise `${display} — ${project.name}`. The second is for native selectors, not export data. Neither fetches or localizes record names.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/projectDisplayName.test.ts'`.

### 12. Add the optional field to both shared form modes (AC-001)

Create `pmo-portal/components/ProjectFormModal.shortName.test.tsx` first. Test create with alias, omitted/blank alias, edit preload/change/clear, whitespace normalization, and rejection of a short-name-only form with no contractual name. Test both create origins already supported (Leads and Internal Project); do not add a new status.

In `components/ProjectFormModal.tsx`, add `short_name?: string | null` to ProjectFormInitial, a `short_name: string` form value initialized from it or empty, its fieldProps, and the optional TextField immediately after required name. Include normalized short_name in both create and edit input; do not add it to requiredFields/validation. Include it in hasEntries/dirty detection. Add the four namespace keys specified above to both `public/locales/en/projects.json` and `id/projects.json`; use explicit `projects:shortName.label/hint` references. Do not add any key to common.json.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectFormModal.shortName.test.tsx components/ProjectFormModal.bahasa.test.tsx && npm run check:i18n'`.

### 13. Seed both edit entrypoints and preserve dirty navigation (AC-001)

Add red interaction assertions in `pmo-portal/pages/Projects.shortName.test.tsx`, `pages/project-detail/__tests__/ProjectDetail.test.tsx`, and `pages/__tests__/ProjectNew.test.tsx`: opening edit from list/detail supplies existing alias; save forwards it; short-name-only entry prompts the existing unsaved-leave guard rather than disappearing.

Pass short_name through BOTH edit initializers in `pages/Projects.tsx` and `pages/project-detail/ProjectDetail.tsx`. Keep ProjectNew's existing create mutation/navigation and existing cancel safeguards; its shared form now supplies the new input. Do not add a second pipeline form or modal.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/Projects.shortName.test.tsx pages/project-detail/__tests__/ProjectDetail.test.tsx pages/__tests__/ProjectNew.test.tsx'`.

### 14. Make the projects list short-first but export-contractual (AC-002, AC-003)

Extend `pages/Projects.shortName.test.tsx` first with distinct names: short-first table text; contractual title; search by either; empty alias fallback; existing number/code/company search still works. Capture real column exportValue and require the contractual name.

In `pages/Projects.tsx`, add own alias to the existing search predicate and use projectDisplayName for visible primary cell/initial. KEEP `primaryTitle: p => p.name`, `exportValue: p => p.name`, stable identifiers, table widths, URL search and import matching unchanged. Do not rewrite project rows before rendering.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/Projects.shortName.test.tsx pages/Projects.test.tsx'`.

### 15. Preserve contractual hover in the shared card shell (AC-002)

First extend `pmo-portal/components/ProjectCardShell.test.tsx`: grid button and kanban title can show a short name with contractual title, fallback behavior remains, and kanban still has only one activation target. Add optional `contractualName?: string` to ProjectCardShellProps; use `contractualName ?? name` for both existing title attributes. Keep the visible/accessibility activation name based on display name and existing identifiers. No new markup hierarchy or styling.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectCardShell.test.tsx'`.

### 16. Adopt the shell contract in all four card producers (AC-002)

Add red cases in `components/ProjectCard.test.tsx`, `ProjectKanbanBoard.test.tsx`, and `SalesKanbanBoard.test.tsx` using differing names. Cover delivery grid/kanban and pipeline DealCard/CompactDealCard (phone stage list). Then update `components/ProjectCard.tsx`, `ProjectKanbanBoard.tsx`, and BOTH card producers in `SalesKanbanBoard.tsx` to pass helper-derived name/initial and contractualName from the row. Keep their money/status/selection/navigation logic untouched.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/ProjectCard.test.tsx components/ProjectKanbanBoard.test.tsx components/SalesKanbanBoard.test.tsx components/ProjectCardShell.test.tsx'`.

### 17. Update both pipeline searches and table display (AC-002, AC-003)

Create `pmo-portal/pages/__tests__/SalesPipeline.shortName.test.tsx` first: open and lost fixtures; short table text and contractual title; table and board filters match either name; fallback; compact/mobile path; export accessor remains legal. Then change `pages/SalesPipeline.tsx` BOTH table/scope and board search predicates and its visible primary cell/initial. Preserve contractual primaryTitle/exportValue, identifiers, filters, aggregates and route behavior.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesPipeline.shortName.test.tsx pages/__tests__/SalesPipeline.export.test.tsx'`.

### 18. Keep calendar identity consistent with projects views (AC-002)

Extend `pmo-portal/components/__tests__/ProjectCalendarView.events.test.tsx` first for alias start/end event labels and milestone project context with contractual disclosure. In `components/ProjectCalendarView.tsx`, use projectDisplayName for nameById and event labels; extend the file-local CalEvent interface with `contractualTitle: string`. Populate it for start/end events with the contractual name and for milestone events with contractual name plus the existing phase context. Set BOTH ProjectEventChip and MilestoneEventChip title attributes to this field; keep ariaLabel based on visible short identity and its event kind. Do not change milestone names, date arithmetic or destinations.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run components/__tests__/ProjectCalendarView.events.test.tsx components/__tests__/ProjectCalendarView.milestoneLink.test.tsx'`.

### 19. Make the canonical detail header short-first (AC-002)

Extend `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.test.tsx` first for both delivery/pipeline rows with distinct names and NULL fallback. In `pages/project-detail/ProjectDetailHeader.tsx`, use display initial and `<span title={project.name}>{projectDisplayName(project)}</span>` for RecordHeader.name (already ReactNode). Preserve contract-value controls, financial calculations, actions and responsive layout.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/ProjectDetailHeader.test.tsx pages/project-detail/__tests__/ProjectDetail.prewin.test.tsx'`.

### 20. Carry short/legal names through warm and cold breadcrumbs (AC-002)

Write red tests in `pmo-portal/src/components/shell/__tests__/routeMatch.test.ts`, `Breadcrumb.test.tsx`, and `src/hooks/useCachedRecordLists.test.tsx`: cached list, cold detail, pipeline/lost and legacy sales route; alias display, legal hover, no extra shell query, unchanged ancestry/return navigation.

In `src/components/shell/routeMatch.ts`, extend RecordLists projects/opportunities identity shapes with optional short_name and use the helper in recordLabelForPath's project branches. Add `recordContractualNameForPath(pathname, lists): string | undefined`, resolving the SAME project-first/opportunity-fallback identity by UUID, returning its unchanged name for project/sales detail paths only. Reuse a small internal identity resolver instead of copying lookup logic. In `Breadcrumb.tsx`, add `title?: string` to BreadcrumbPart and render it on the existing crumb span/link/button. In `pmo-portal/App.tsx`, supply the returned contractual title on the current record crumb after breadcrumb construction. Preserve signatures of existing label/route helpers and all nonproject crumbs. Ensure useCachedRecordLists retains short_name when merging detailed rows; no new fetch.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/shell/__tests__/routeMatch.test.ts src/components/shell/__tests__/Breadcrumb.test.tsx src/hooks/useCachedRecordLists.test.tsx App.routes.test.tsx'`.

### 21. Separate FK picker identity from contractual invoice identity (AC-002, AC-003)

First extend `pmo-portal/src/hooks/useFkOptions.test.tsx` for short-first project/invoice options, legal+code secondary text, UUID stability, archived behavior and separate contractualName. Add red assertions in `pages/__tests__/SalesInvoices.fin1.test.tsx` and `pages/approvals/SalesInvoiceApprovalSection.test.tsx` that invoice previews/approval context retain the contractual title when picker label differs.

In `src/hooks/useFkOptions.ts`, map useProjectOptions/useInvoiceProjectOptions label with projectDisplayName. Set sub to `[display !== p.name ? p.name : null, p.code].filter(Boolean).join(' · ') || undefined`, retaining all existing invoice metadata. Add required `contractualName: string` to InvoiceProjectOption and populate `p.name`. Update the legal-document/preview lookup in `pages/SalesInvoices.tsx::projectLabelOf` and `pages/approvals/SalesInvoiceApprovalRow.tsx` to use contractualName; leave selector label short-first. Update typed fixtures with explicit contractualName. InvoiceProjectModal confirmation may show the display label because it selects by ID; it must not become a document title source.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useFkOptions.test.tsx pages/__tests__/SalesInvoices.fin1.test.tsx pages/approvals/SalesInvoiceApprovalSection.test.tsx'`.

### 22. Disclose the selected Combobox option's legal identity (AC-002)

Add a red case to `pmo-portal/src/components/ui/__tests__/Combobox.test.tsx`: an option with label Short and sub Contractual can be found by either, its selected trigger displays Short and has title containing Contractual; no sub retains existing label behavior. In `src/components/ui/Combobox.tsx`, add only `title={selected?.sub ? `${selected.label} — ${selected.sub}` : selected?.label}` to its selected trigger. Preserve search, keyboard/focus, async states and styles. In `pmo-portal/pages/procurement/ProcurementHeaderEdit.test.tsx`, first add a red edit case whose already-loaded project option has a short label/legal sub while projectName is contractual. In `pages/procurement/ProcurementHeaderEdit.tsx`, prefer `projectOptions?.find(o => o.value === form.values.projectId)` for selectedOption, falling back to the current projectName object only while that option is unavailable; otherwise the incumbent explicit selectedOption would override the updated hook label. Existing IncidentFormModal/ProcurementCreate already resolve selected options from hook data; their aliases follow without a new loader. Keep IDs and fallback/loading behavior.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/Combobox.test.tsx src/hooks/useFkOptions.test.tsx pages/procurement/ProcurementHeaderEdit.test.tsx'`.

### 23. Adopt short-first native pickers in expenses and meetings (AC-002, AC-003)

Create `pmo-portal/pages/__tests__/ProjectPickers.shortName.test.tsx` with focused render cases for six selector consumers and distinct names. Assert short-first combined label, contractual availability, correct selected UUID, and that export values remain joined project.name.

Use projectPickerLabel only in project-option builders in `pages/ExpenseClaims.tsx`, `ExpenseClaimNew.tsx`, `ExpenseClaimDetail.tsx`, `Meetings.tsx`, `MeetingCreate.tsx`, and `MeetingDetail.tsx`. Keep existing selector primitives, filters, defaults, writes and output mappings. Do not convert these pages to a different picker just for this field.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/ProjectPickers.shortName.test.tsx'`.

### 24. Distinguish timesheet/statement selector labels from output labels (AC-002, AC-003)

Create `pmo-portal/pages/__tests__/ProjectScopePickers.shortName.test.tsx` first for timesheet add-project and FinancialStatements selector. Extend `pages/__tests__/FinancialStatements.scope.test.tsx`: short selector identity but contractual report scope and mapped ERP project unchanged.

In `pages/Timesheets.tsx`, replace its add-project option label with `p.code ? `${p.code} · ${projectPickerLabel(p)}` : projectPickerLabel(p)`. Remove the now-unused local PICKER_NAME_MAX/pickerLabel truncation utility. This deliberately replaces truncated native option text with the full short-first/contractual label required by AC-002; keep the closed SelectField width/placeholder unchanged. Test full disclosure rather than retaining the old 36-character option cap; never relax selection-by-ID assertions. Keep persisted timesheet rows, exports and push identities unchanged. In `pages/FinancialStatements.tsx`, carry `{ contractualName, pickerLabel }` from the existing project.get result; use projectPickerLabel for selector options and contractual name for statement/report context. Keep the existing mapped-project-name query key and safe scope permissions; no extra per-option request beyond current behavior.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/ProjectScopePickers.shortName.test.tsx pages/__tests__/FinancialStatements.scope.test.tsx'`.

### 25. Make cached global name search match both identities (AC-002)

Extend `pmo-portal/src/hooks/__tests__/useRecordSearch.test.tsx` first with separate active/pipeline records: title uses alias, secondary line includes contractual name, filtering finds either, NULL fallback works, same alias still navigates by correct UUID. Preserve code-first ranking tests.

In `src/hooks/useRecordSearch.ts`, change BOTH projects/pipeline visible titles using projectDisplayName. When display differs, use `t('projects:shortName.searchProject', { name: p.name })` / searchPipeline for sub; otherwise keep incumbent translated sub. Legal text in searchable sub suffices; do not put names in searchCodes, which participate in exact-code ranking. Preserve permissions, caps, debounce, IDs and destinations. Extend `src/components/shell/__tests__/CommandPalette.test.tsx` for an uncached reference result from Task 3 showing short title plus legal context without duplicate cached entries; preserve reference tokens.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/__tests__/useRecordSearch.test.tsx src/hooks/__tests__/useRecordSearch.dedupe.test.ts src/components/shell/__tests__/CommandPalette.test.tsx'`.

### 26. Refresh independent alias-bearing caches after edit (AC-001, AC-002)

In `pmo-portal/src/hooks/useProjectMutations.test.tsx`, write red assertions for successful create/header edit invalidating `['fk-options','invoice-project']`, `['financial-statements','mapped-project-name']` and `['uxs40','references']`, alongside existing project/pipeline/lost caches. Add those exact prefix invalidations in `src/hooks/useProjects.ts::invalidate`. Failed writes must not run success invalidation. Do not add ['project-identity'] when its unrelated projection is unchanged. Assert existing breadcrumb passive cache behavior follows these refreshed project queries.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useProjectMutations.test.tsx src/hooks/useCachedRecordLists.test.tsx'`.

### 27. Bind the ERP contractual-project regression to shipped code (AC-003)

Extend `supabase/functions/external-set-company/setup.test.ts`'s existing real-handler project creation/retry case, with title `AC-003 #1325: ERP Project uses the contractual title, never its short name`. Fixture: contractual name Contractual Delivery Title and alias Delivery. Assert exact ERP search filters use contractual name, POST is `{ project_name: 'Contractual Delivery Title', company: ... }`, saved project_map uses returned ERP identity, retry does not duplicate POST. Make the boundary mock respect the requested projection or additionally assert ownProject's contractual-name select. Keep importing `handleSetCompanyRequest` from `./index.ts`; no copied handler or production dependency-injection seam.

This guards unchanged behavior and should initially pass. Temporarily change the payload project_name to a fixed alias and verify the same test exits nonzero, then restore it and rerun green. No lasting production change to `setup.ts` is intended.

Verify: `(cd supabase/functions/external-set-company && deno test --allow-all setup.test.ts)` and `node scripts/check-edge-fn-test-binding.mjs`.

### 28. Pin contractual exports and ERP document/report links (AC-003)

Add distinct alias/legal fixtures and negative alias assertions to actual boundaries:
- `pmo-portal/pages/__tests__/exportCurrencyColumn.test.tsx`: Projects workbook Project cell stays legal despite short screen label.
- `pages/__tests__/SalesPipeline.export.test.tsx`: actual column exportValue/buildExportRows stays legal.
- `src/lib/reports/managementPack.test.ts` and `managementPackExport.test.ts`: linked project name remains contractual in report/export.
- `src/lib/adapterSeam/erpnext/salesInvoicePo.test.ts`: captured outgoing invoice project remains the mapped ERP identifier, never the short label.
- `src/lib/adapterSeam/erpnext/statementReports.test.ts`: ERP report filter remains mapped project identity.
Keep the contractual statement UI assertion from Task 24 and invoice preview assertions from Task 21. These are preservation tests; a temporary display-helper substitution at each tested boundary must make its focused assertion red, then restore. Change output implementation only if a preceding UI task actually regressed it; do not alter schemas, financial values, PDF bytes or established identifiers.

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/exportCurrencyColumn.test.tsx pages/__tests__/SalesPipeline.export.test.tsx src/lib/reports/managementPack.test.ts src/lib/reports/managementPackExport.test.ts src/lib/adapterSeam/erpnext/salesInvoicePo.test.ts src/lib/adapterSeam/erpnext/statementReports.test.ts pages/__tests__/FinancialStatements.scope.test.tsx'`.

### 29. Add one persisted operator journey and document bulk use (AC-001, AC-002, AC-004)

Read `docs/e2e-parallel-conventions.md` first. Create `pmo-portal/e2e/AC-001-project-short-name.spec.ts`, `@e2e-isolation: self-isolated`, with unique synthetic project/company fixtures and cleanup. One journey: use New project UI with contractual name+alias (a Lead), save, assert short header/breadcrumb with legal title, find by either identity through pipeline/global search, edit alias and reload to prove persistence, clear it and verify legal fallback. Use existing test fixtures for setup and local external-call mocks where needed; do not hit a live ERP or mutate shared seeds. This supplements unit ownership and SQL proofs, not one browser test per render case. Keep the user's goal assertions; do not skip missing UI.

Update `docs/runbooks/pmo-cli.md` with `node scripts/pmo.mjs get projects --select id,name,short_name`, filtered update with `'{"short_name":"Depot"}'`, NULL clearing and multi-ID common-value examples. Explain distinct-value bulk backfill as one filtered PATCH per ID (not PATCH arrays/upsert), and loader fill-empty/skip-same/report-different behavior; diverged stages use generic update. Include a synthetic loader example with both names and clarify contractual exports/ERP names are unchanged.

Verify: `bash scripts/check-e2e-isolation.sh`; `scripts/e2e-local.sh --reset AC-001-project-short-name` (wrapper owns ONE DB lock across reset/run). Also run impacted existing journey fragments `scripts/e2e-local.sh AC-401`, `scripts/e2e-local.sh AC-CMDK-007`, and `scripts/e2e-local.sh AC-S24-004` after confirming their matched specs. Browser runs are targeted; do not dispatch full integration yourself.

### 30. Execute scoped gates and hand over exact evidence (AC-001–AC-005)

No new behavior in this task. Finish all prior RED/GREEN loops first. From repository root run:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
# Includes tracked diffs and newly created files; paths here are app-relative.
(set -euo pipefail; cd pmo-portal; \
  { git diff --relative --name-only -z --diff-filter=ACMRT origin/dev -- '*.ts' '*.tsx'; \
    git ls-files --others --exclude-standard -z -- '*.ts' '*.tsx'; } | \
  xargs -0 npx eslint --max-warnings=0)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev'
node --test scripts/pmo.test.mjs scripts/pmo-load.test.mjs
node --check scripts/check-project-short-name-reversal.mjs
(cd supabase/functions/external-set-company && deno test --allow-all setup.test.ts)
(cd pmo-portal && npm run check:i18n && npm run check:shadow-types)
bash scripts/check-migration-collisions.sh
node scripts/check-edge-fn-test-binding.mjs
scripts/with-db-lock.sh bash -c 'supabase db reset && \
  supabase test db \
    supabase/tests/0365_project_short_name.test.sql \
    supabase/tests/0329_record_reference_search.test.sql \
    supabase/tests/0234_project_classification.test.sql \
    supabase/tests/0261_pipeline_hides_archived.test.sql \
    supabase/tests/record_changes_catalog_gate.test.sql \
    supabase/tests/0226_company_short_name.test.sql \
    supabase/tests/api_client_request_guard.test.sql \
    supabase/tests/api_client_seed_surface.test.sql && \
  node scripts/check-project-short-name-reversal.mjs && \
  node scripts/check-isolation-denominator.mjs'
git diff --check
```

The denominator checker calls bare psql from the operator's inherited PATH. Run it as shown; do not hunt for or hardcode a toolchain binary. If it exits nonzero with actual manifest differences, run its documented `--write` under the same DB lock, review and commit only relevant `scripts/isolation-probe-denominator.json` changes, then rerun successfully. A nullable column plus invoker projection changes should not require a new surface entry; do not change the manifest speculatively or conceal unrelated drift.

Repeat the touched browser journeys from Task 29 after final code changes. Run the Impeccable detector on every changed non-test UI TSX file (include untracked ones). Where the CLI is installed use `impeccable detect --json` with those exact targets; in this environment use the loaded skill's equivalent:

```bash
node /Users/ariefsaid/.agents/skills/impeccable/scripts/detect.mjs --json \
  pmo-portal/components/ProjectFormModal.tsx \
  pmo-portal/components/ProjectCardShell.tsx \
  pmo-portal/components/ProjectCard.tsx \
  pmo-portal/components/ProjectKanbanBoard.tsx \
  pmo-portal/components/SalesKanbanBoard.tsx \
  pmo-portal/components/ProjectCalendarView.tsx \
  pmo-portal/pages/Projects.tsx pmo-portal/pages/SalesPipeline.tsx \
  pmo-portal/pages/project-detail/ProjectDetail.tsx \
  pmo-portal/pages/project-detail/ProjectDetailHeader.tsx \
  pmo-portal/src/components/shell/Breadcrumb.tsx \
  pmo-portal/src/components/ui/Combobox.tsx \
  pmo-portal/pages/SalesInvoices.tsx \
  pmo-portal/pages/approvals/SalesInvoiceApprovalRow.tsx \
  pmo-portal/pages/procurement/ProcurementHeaderEdit.tsx \
  pmo-portal/pages/ExpenseClaims.tsx pmo-portal/pages/ExpenseClaimNew.tsx \
  pmo-portal/pages/ExpenseClaimDetail.tsx pmo-portal/pages/Meetings.tsx \
  pmo-portal/pages/MeetingCreate.tsx pmo-portal/pages/MeetingDetail.tsx \
  pmo-portal/pages/Timesheets.tsx pmo-portal/pages/FinancialStatements.tsx \
  pmo-portal/App.tsx
```

Report file count and findings by rule/severity, distinguish pre-existing findings from newly introduced ones, and resolve new findings within scope. Do not claim the planner's baseline as build evidence. Have rendered Discover review cover projects table/cards/board/calendar, pipeline desktop/phone, cold detail/breadcrumb, picker and Cmd-K at desktop and 390px in en/id; keep long legal names and duplicate short aliases in the fixtures. Graduate any finding into a regression test plus the appropriate routes×oracles/design retention note per `docs/qa-portfolio.md`.

Builder report must include: exact touched paths; 30-task completion/AC matrix; per-command exit statuses and RED/GREEN evidence; ERP mutation proof; rollback proof; detector counts; targeted browser evidence; coverage evidence for ≥80% changed lines; unresolved blockers (none may be silently waived). Normal spec, quality and security reviews still apply. CI's two unit shards, verify and full pgTAP decide the dev PR; local targeted green is not full-suite evidence. Dev is the ceiling. Never `--no-verify`, never weaken tests, never regenerate package-lock.json, never add Co-Authored-By.

## Director questions / handoff

No product question is required to implement the issue's five supplied ACs. The issue is the requirements artifact; if the Director requires a separately signed spec file, obtain that sign-off before starting build rather than inventing additional behavior. The current short-name approach is additive and has no new architecture decision.

All three recon agents completed and their reports were read before this plan was written. Ignored local recon notes under `docs/private/1325-*-recon-ba204572.md` are nonshipping context, not required builder artifacts. Planning did not implement source/tests, run a database reset or execute application test suites. The only mechanical UI evidence is the explicitly labelled four-file unchanged baseline detector run above.
