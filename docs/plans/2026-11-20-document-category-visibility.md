# Document Category Visibility Implementation Plan (#2579)

> Fresh Orca worker, Director-dispatched, ships alone (changes read authority on an existing table and a storage bucket). Spec: `docs/specs/document-category-visibility.spec.md`. Sign OD-DCV-1..10 first. Scheduled after the 15 December go-live. Builds on `project_documents` (0001, 0017, 0025, 0176, 0292), the storage policies (0025, 0310, 0391), the RLS initplan guard (0646, 0696) and the CLI register (0884).

ADR candidate: category-gated document visibility: one predicate, a restrictive policy on the register table and on `storage.objects` for the `project-documents` bucket, with the role seam left on the shipped `auth_role()` (0002). Write the ADR only if the owner confirms OD-DCV-1.

## Built on defaults (owner to confirm)

The build took the recommended default of every open owner decision in the spec. Each is a one-line change or a data change if the owner rules otherwise.

- OD-DCV-1: the five existing `user_role` values; the role seam is `auth_role()`. No custom roles (#902) and no ADR written (the ADR is held until this is confirmed).
- OD-DCV-2: existing categories start with all roles; a new category must name its roles at creation, a create with none is refused, and Admin is always added. The administration form starts a new category with Admin only checked, so the Admin chooses on purpose.
- OD-DCV-3: Admin sees every category and cannot be removed from any (`set_document_category_roles` refuses a set without Admin; the policy also short-circuits for Admin).
- OD-DCV-4: a hidden document leaves no trace (no count, placeholder or message on any screen; the database returns no row).
- OD-DCV-5: scope is the project register and its bucket; procurement, expense, incident and expiry attachments are untouched.
- OD-DCV-6: a person files into, and edits within, only categories they can see (the restrictive policy's `with check`).
- OD-DCV-7: system category names are translated (English, Bahasa Indonesia); organisation-created names show as typed.
- OD-DCV-8: a revision lineage shares one category; the insert trigger stamps the parent's category and refuses a different one; a re-file (`refile_document_lineage`) moves the whole lineage in one transaction. The revision form shows the category locked.
- OD-DCV-9: no implicit see-everything role besides Admin; Executive sees only what the matrix says.
- OD-DCV-10: linked Microsoft 365 files keep Microsoft's permissions; the administration page says so.
- OD-DCV-11: `Reference` is a system category (seeded with all roles, cannot be renamed or archived) and is not offered in the ordinary register forms.

### Deviations from the plan text (recorded while building)

- The category-change record is written to `audit_events` through `log_audit` (actor, time, old and new roles or names; Admin and Operator readable), not by registering the two tables in `record_history_config`. The registry needs a classification, a parent arm and a `record_history_visible` arm per table; the audit trail already carries the same facts for this surface and is what `project_documents` itself uses.
- `pmo documents create` does not read the live category list: that read would need the command-line request guard's table list changed, in a migration other work also restates. Instead the command sends the name, the database resolves it case-insensitively against the organisation's live categories (else `Other`), and the command reports `category_note` when the entry did not land where asked. A live read is a follow-up for the Director to schedule.
- The pgTAP runner in this sandbox cannot pull the `pg_prove` image, so the files were run with `psql` against the same local stack (TAP output read directly). CI's `pgtap` job is the pull-request proof.

## Data-model facts this plan relies on (re-verify at head before building)
- `project_documents.category` is `text not null`; writers that supply only that text include the CLI (`scripts/lib/pmo-documents.mjs`), the Microsoft 365 folder and link routines (0336, 0338, 0375, 0534, 0763, and the definers in 0292) and the operator write API (0370, 0884). They must keep working unchanged. Shipped code writes a label the JSON list does not hold: `Reference` for a Microsoft 365 folder entry (`DocumentFormModal` defaults to it, `documentCategoryLabel` translates it), so the seed below is eight names, not seven.
- `auth_role()` (0002) reads `profiles.role` on every statement, so a role change takes effect on the next request and is the one seam ADR-0103 later replaces.
- Revision creation is a client INSERT that supplies `category` and `parent_document_id` (`documents.ts` `createDocumentRevision`), so FR-DCV-009 must be enforced by the trigger, not by the modal.
- `project_documents` is **not** in `record_history_config` (0260); its audit trail is `audit_events` via `log_audit` (0292) and is Admin/Operator-readable. If any document type is ever registered, `record_history_visible` raises for an unknown entity type and needs an arm.
- Storage keys are `{org_id}/{project_id}/{document_id}/{filename}`; the category is not in the path, so re-filing never moves objects.
- Existing policies: `project_documents_select`, `project_documents_write`, `project_documents_delete_admin_only`, `project_documents_insert_self_author`; storage: `storage_objects_project_doc_read` (0310) and the restrictive author write policies (0391). `pg_policies` at head decides; re-read it, do not trust this list.
- Roles are the `user_role` enum (Executive, Project Manager, Finance, Engineer, Admin).

## Migrations (new migrations, numbers assigned at build; each with a rollback file in `supabase/migrations/rollback/`)
1. **Categories and rules.**
   - `document_categories(id uuid pk default gen_random_uuid(), org_id uuid not null default <seam default> references organizations, name text not null, sort_order int not null default 0, is_system bool not null default false, archived_at timestamptz, created_at timestamptz default now())`; unique `(org_id, lower(name)) where archived_at is null`; unique `(id, org_id)` for composite references. RLS enabled and forced; select for active members of the org (names are not sensitive; document rows are), write Admin only, via the management function only (revoke direct insert/update from `authenticated`).
   - `document_category_roles(category_id, org_id, role user_role, primary key (category_id, role))` with composite FK `(category_id, org_id)`; RLS forced; select for active members of the org; no direct writes.
   - Seed the eight system categories per organisation (the seven names in `pmo-portal/src/lib/documentCategories.json`, which already includes `Other`, plus `Reference`), all roles each. A trigger on organisation insert seeds new organisations. Add any existing non-matching distinct `category` text found in `project_documents` as custom categories with all roles, so parity holds; `Reference` must be seeded as system, not discovered as custom (OD-DCV-11).
   - Rollback: drop tables and trigger; data loss limited to the rules (documents keep their text column).
2. **Document reference and resolution.**
   - Add `project_documents.category_id uuid` with composite FK `(category_id, org_id)`; backfill by (org, name); set `not null`; index `(org_id, category_id)`.
   - `BEFORE INSERT OR UPDATE` trigger on `project_documents`: if `category_id` is null resolve the text name in the row's org (else `Other` when blank or unknown); then set `category` to the category's name. Reject a category of another org, or an archived category on insert and category change. On INSERT with `parent_document_id` set, stamp the parent's `category_id` and refuse a supplied one that differs (and a parent the caller cannot read), so a split lineage cannot be created by the client. Keep the column and the trigger so every existing writer is unchanged. The 0348 header-guard and 0292 audit trigger compare `category`; extend them to `category_id`.
   - Rename of a category updates denormalised text in the same transaction (function below).
   - Rollback: drop trigger and column.
3. **Visibility rule and enforcement.**
   - `public.document_category_visible(p_category_id uuid, p_org_id uuid) returns boolean` language sql stable, **not** security definer, `set search_path = public`: `exists (select 1 from document_category_roles r where r.category_id = p_category_id and r.org_id = p_org_id and r.role = (select auth_role()))`. It exists for the non-policy callers below (edge functions, definers that need to ask); the role seam itself is the shipped `auth_role()` (OD-DCV-1).
   - Restrictive policy `project_documents_category_visible` `as restrictive for all` on `project_documents`: using and with check `(select auth_role()) = 'Admin' or exists (select 1 from public.document_category_roles r where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id and r.role = (select auth_role()))`. **Inline it**, do not call the helper per row: the policy must keep the `(select auth_role())` InitPlan form and one primary-key probe per row (NFR-DCV-001). The existing permissive policies stay; restrictive policies AND with them.
   - Restrictive `storage_project_documents_category_visible` on `storage.objects` for select, insert, update, delete: `bucket_id <> 'project-documents' or exists (select 1 from public.project_documents pd where pd.id::text = split_part(name,'/',3) and pd.org_id::text = split_part(name,'/',1))`. The subquery runs under the caller's RLS, so the register policy supplies the category rule; add an explicit pgTAP proof (do not rely on this reasoning alone). The existing write policies already pin `project_id` from path segment 2.
   - Other readers: every security-definer routine, view or edge function found by Task 1 gets the same predicate (`document_category_visible`) or is switched to security-invoker. Notification fan-out filters recipients through the same function (FR-DCV-014).
   - Rollback: drop the two policies and the function (policies first).
4. **Management functions** (security definer, `set search_path = public`, Admin and active member and org checked inside, never client org): `create_document_category(name, roles[])` (refuses an empty role set), `rename_document_category(id, name)` (refuses system), `set_document_category_roles(id, roles[])` (atomic replace; refuses removing Admin), `archive_document_category(id)` / `restore_...`, `reorder_document_categories(ids[])`, `refile_document_lineage(document_id, category_id)` (whole lineage, one transaction, caller must edit every revision and see both categories). Register `document_categories` and `document_category_roles` in `record_history_config` (0260) so changes record actor, time, old and new — and add the matching arms to `record_history_visible`, which raises for an entity type it does not know. Revoke execute from `public`; grant to `authenticated`. Rollback: drop functions, then the `record_history_visible` arms, then the registry rows.

## Task 1 — reader inventory (no code merged; output is a checked list in the PR)
- [ ] At the working schema head list every reader of `project_documents` and the `project-documents` bucket: `pg_policies`, `pg_proc` bodies (grep `project_documents`), views, `operator_read_tables` entries (0367 chain, last restated in 0884 — its tier admits Admin, Executive, Project Manager and Finance, so an Engineer is refused before any category rule), record-history readers (`project_documents` is not in `record_history_config`; its trail is `audit_events`), notification emitters (`notify_workflow_user`, 0237 — no document notification exists today), `supabase/functions/**` (`m365-token-custody/documentPreview.ts`, `documentVerification.ts`, `recordFolders.ts`, `recordFileUpload.ts`, `agent-chat/readEntities.ts`), `scripts/pmo.mjs`, `scripts/lib/pmo-documents.mjs` and `pmo-portal/src/lib/db/documents.ts`. For each: does it run as the caller (RLS applies) or with a privilege that skips RLS? Record the answer and the predicate it will use. Include the two service-role M365 definers (`m365_issue_document`, `m365_refresh_reference`, 0292) and confirm the handlers read the row under the caller's JWT before calling them.
- [ ] Review `role_table_grants` for `project_documents`, the two new tables and `storage.objects`.

## Task 2 — pure and DAL pieces (TDD, unit)
- [ ] `src/lib/documentCategories.ts`: keep `documentCategoryLabel` for system names; add `categoryDisplay(t, category)` (system key → translated, custom → as typed). Test first in `src/lib/__tests__/documentCategories.test.ts`: AC-DCV-018 label cases, en and id.
- [ ] `src/lib/db/documentCategories.ts`: `listDocumentCategories()`, `createCategory`, `renameCategory`, `setCategoryRoles`, `archiveCategory`, `restoreCategory`, `reorderCategories`, `refileLineage`; every write throws `AppError` preserving the Postgres code; `org_id` never sent. Tests in `documentCategories.test.ts` with the mocked client (AC-DCV-020 repository receives the replaced set).
- [ ] `src/lib/repositories/index.ts`: add `DocumentCategoryRepository`; hooks use `useQuery` (ADR-0017).
- [ ] `src/auth/policy.ts`: add entity `documentCategory` with `manage` allowed for Admin only; test in the policy test file (AC-DCV-019). Register in the role matrix (#902) per FR-DCV-020.
- [ ] `src/lib/db/documents.ts`: `ProjectDocumentInput` gains `category_id`; keep `category` text out of writes. Update `documents.test.ts` and `NewRevisionModal` (revision keeps parent's category, FR-DCV-009).

## Task 3 — pgTAP (write first, expect red against the old schema)
One file `supabase/tests/<number>_document_category_visibility.test.sql` (number assigned at build), fixture as in the spec. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<file>'`.
- [ ] AC-DCV-001 parity: seed documents under the pre-change shape, apply, compare counts per role.
- [ ] AC-DCV-002, 010, 011, 013: text resolution, stamped org, system/archived rules, revision inheritance.
- [ ] AC-DCV-003, 006, 007: row reads, writes and transition/revision functions as each role.
- [ ] AC-DCV-004, 005: storage select, signed-link creation (`storage.objects` read as authenticated), overwrite and delete; read-back as Finance.
- [ ] AC-DCV-008, 009, 012: management function rules, atomic replace, history rows, lineage re-file.
- [ ] AC-DCV-014, 015: operator read path and assistant read path as a **Project Manager** (a tier role a category rule can exclude); notification recipients through `notify_workflow_user` for a `project_document` entity.
- [ ] AC-DCV-021: run the existing `supabase/tests/0646_rls_initplan.test.sql`. It derives its cases from `pg_policies`, so it binds the new policy automatically; there is no pinned list to edit. If it reports a bare helper call, fix the policy, not the test.
- [ ] AC-DCV-023: rename propagation to the denormalised text and its history row.
- [ ] **Mutation check:** (a) remove the viewer-role clause from the register policy: AC-DCV-003 red; (b) remove it from the storage policy: AC-DCV-004 red; (c) replace `(select auth_role())` with `'Admin'`: AC-DCV-003 red; (d) drop the parent-category copy on the revision trigger: AC-DCV-013 red; restore each.

## Task 4 — migration and routines
- [ ] Write migrations 1 to 4 above to pass Task 3, then `scripts/with-db-lock.sh supabase db reset` and the new test, then the existing document tests (`0052`, `0053`, `0066`, `0067`, `0068`, `0310`, `0391`, `0409`, `1857`) which must stay green unchanged.
- [ ] Update the routines Task 1 flagged (security-definer readers, notification fan-out, operator read allow-list) and add each to the pgTAP file.
- [ ] Regenerate `pmo-portal/src/lib/supabase/database.types.ts` the way the repository does (never by hand-editing).

## Task 5 — edge functions and CLI (unit)
- [ ] `supabase/functions/m365-token-custody/documentPreview.ts`: it already reads the register row through the caller-scoped client and returns the existing generic not-found for an unreadable row, with no Graph call — add nothing but the regression test (AC-DCV-016); `documentPreview.test.ts` already carries the shape. Cover the folder-resolution and drift paths (`recordFolders.ts`, `documentVerification.ts`) with the same caller-read assertion, and confirm their service-role definer calls (`m365_link_record_folder`, `m365_issue_document`, `m365_refresh_reference`) only follow a caller-scoped read.
- [ ] `agent-chat/readEntities.ts`: confirm it reads as the caller; add a test that a hidden row is absent from results.
- [ ] `scripts/lib/pmo-documents.mjs`: replace the fixed `CATEGORIES` check with a lookup of the organisation's live categories through the operator read path; keep the JSON only as the offline seed/fallback and update `scripts/pmo-documents.test.mjs`'s parity assertion accordingly. Test in the existing `pmo-documents` test (AC-DCV-017).

## Task 6 — screens (ui-implementer; `restructure`; en and id strings)
- [ ] `pages/project-detail/tabs/DocumentsTab.tsx`, `DocumentDrawer.tsx`, `DocumentFormModal.tsx`: the category column, filter and grouping already exist and derive from the visible rows, so keep them; make the create/edit/revision forms offer only visible categories, drop `category` text from writes in favour of `category_id`, and add no hidden-count text; RTL tests for AC-DCV-018.
- [ ] `pages/AdministrationDocumentCategories.tsx` as a new **Administration section** (Administration is one sectioned page, `/administration/:section`): add the id to `AdministrationSection`, `ORGANIZATION_SECTIONS` and `SECTION_LABEL_DEFAULTS`, add its static `t()` entry to `buildSectionLabels`, and render it in the section switch. Link hidden for non-Admin. List with role-matrix checkboxes (Admin locked on), create, rename, reorder, archive and restore, Microsoft 365 permissions note; mobile layout; labelled checkboxes. RTL tests for AC-DCV-019, 020.
- [ ] Translation files `src/locales/en|id` for new keys (rebase translation-file edits immediately before the PR, #1070).

## Task 7 — e2e
- [ ] `pmo-portal/e2e/AC-DCV-022-category-visibility-journey.spec.ts` (isolation tag per `docs/e2e-parallel-conventions.md`): Admin creates `Commercial approval` for Finance and Executive; Finance uploads; Engineer's Documents tab shows nothing of it and a direct file request fails; Finance sees and downloads. Run `scripts/e2e-local.sh AC-DCV-022`.

## Traceability

| AC | Owning test | Layer |
|---|---|---|
| AC-DCV-001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 023 | `supabase/tests/<n>_document_category_visibility.test.sql` | pgTAP |
| AC-DCV-016 | `supabase/functions/m365-token-custody/documentPreview` test (hidden row) | Deno unit |
| AC-DCV-017 | `scripts/lib` pmo-documents test | Unit |
| AC-DCV-018 | `pages/project-detail/tabs` DocumentsTab test; `documentCategories.test.ts` | Unit (RTL) |
| AC-DCV-019 | `src/auth` policy test; administration section test | Unit |
| AC-DCV-020 | administration section test; `src/lib/db/documentCategories.test.ts` | Unit (RTL) |
| AC-DCV-021 | `supabase/tests/0646_rls_initplan.test.sql` (existing guard) | pgTAP |
| AC-DCV-022 | `e2e/AC-DCV-022-category-visibility-journey.spec.ts` | E2E |

## Glossary
- [ ] Add **Document category**, **Viewer roles** and **System category** to `docs/glossary.md` next to **Document**.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, the touched vitest files, the touched pgTAP file plus the document tests listed in Task 4 (under the DB lock), the touched e2e journey, `deno test` for changed functions, and `scripts/ux-proof.sh` on the register and the new administration section. Security-auditor review is required (auth, RLS, storage, public surfaces).
