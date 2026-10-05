# PMO Project Numbering — implementation plan (#771)

## Decision and design

`OD-ID-1` remains the identity boundary: `projects.pmo_project_number` is PMO's stable,
human-readable identifier; the existing nullable `projects.code` remains the organisation's optional,
free-form Client Project Code; the external-reference seam is unchanged. Neither field is derived from
the other.

### Data flow

1. An Admin may save an effective pattern on its own `organizations` row. `NULL` represents the
   system default `PRJ-{YY}-{SEQ4}`; a non-NULL custom pattern contains exactly one each of
   `{CLIENT}`, `{YY}`, and `{SEQ4}`. The browser validates before submit for useful inline feedback;
   a database check validates the same grammar for every write.
2. A company has an optional `client_number_segment`. During create, after a client is selected, the
   form calls a security-definer `propose_project_number(p_client_id uuid)` RPC. The RPC derives
   organisation and role from the JWT, reads the organisation timezone (`UTC` only when it is NULL),
   verifies the selected company belongs to that organisation, requires a nonblank segment only for
   a `{CLIENT}` custom pattern, atomically increments the `(org_id, business_year)` counter with one
   `INSERT … ON CONFLICT … DO UPDATE … RETURNING`, and expands the pattern. A new proposal is
   intentionally reserved when the client changes or the form is abandoned; gaps are accepted.
3. The returned number seeds the editable create-form field. `createProject` inserts the selected
   `pmo_project_number` and optional `code`; a database BEFORE INSERT trigger invokes the same
   allocator for an authorised direct/import/API insert that omitted the PMO number. The partial unique `(org_id, pmo_project_number)` index
   is the final collision authority. Header updates deliberately omit the PMO number, preserving its
   stability after assignment.
4. The additive migration backfills current rows by `(org_id, local creation year, created_at, id)`
   using each organisation's timezone and `PRJ-YY-SEQ`; it then seeds the counter to that year's
   highest assigned sequence. Existing `code`, UUIDs, FKs, routes, and external references are not
   touched.

### Schema and authorization

- Add nullable `organizations.project_number_pattern`, nullable `companies.client_number_segment`,
  eventually non-null/nonblank `projects.pmo_project_number`, and private
  `project_number_counters(org_id, business_year, last_seq)`.
- Keep the incumbent `unique (org_id, code)` constraint unchanged; add a distinct unique index for
  PMO numbers. Do not add a case-folding rule that the spec does not define.
- Use the established `organizations` column-grant/RLS design: every active member may read the
  effective configuration; only an active Admin can update `project_number_pattern`, and
  `authenticated` receives only the column-level grant. The existing company/project policies remain
  the row authority; grants add only the new company/project columns to the existing authorised
  write paths. `pmo_project_number` receives INSERT but not UPDATE privilege.
- The counter table has `org_id`, RLS enabled and forced, no client write grant, and is mutated only
  by the private definer helper. `propose_project_number` is the authenticated wrapper, while the
  project BEFORE INSERT trigger is the fallback for legitimate direct/import/API writes that omit a number. The RPC pins `search_path`, revokes public/anon execution, grants only
  `authenticated`, and re-checks active membership, allowed project-create role, and organisation
  ownership itself.
- The procurement counter remains untouched. It is deliberately not generalized: its keys and
  semantics are document-prefix/day lifecycle minting, whereas this feature needs a project/year
  configuration-aware proposal. An entity-local counter avoids coupling future project patterns to
  procurement numbering. This is a local implementation choice, not a new cross-cutting or
  irreversible architecture, so no ADR is needed.

### Acceptance-test ownership

| AC | Canonical owner | Supplemental proof |
| --- | --- | --- |
| AC-CODE-001 | `supabase/tests/0231_project_numbering.test.sql` | Admin panel RTL test covers loading, inline grammar feedback, save/error/readonly presentation. |
| AC-CODE-002 | `pmo-portal/e2e/serial/AC-CODE-002-project-number-proposal.spec.ts` | pgTAP proves membership, role, tenant, pattern, year, atomic allocation, grants, backfill and uniqueness; RTL proves proposal/loading/missing-segment/edit behavior. |
| AC-CODE-003 | `pmo-portal/e2e/AC-CODE-003-project-identifiers.spec.ts` | RTL pins individual list/card/detail/search predicates and command-palette indexing. |

No new dependency and no shell redesign are required.

## Implementation tasks

> Run app commands from `pmo-portal/`; run Supabase commands from the repository root. Every
> behavior task starts by adding the stated failing test, then implements only enough production code
> to make it green.

### 1. Lock down the database contract first

**Files:** create `supabase/tests/0231_project_numbering.test.sql`.

Write the failing pgTAP contract before adding the migration. Use two organisations, active Admin/PM
fixtures, two companies (one without a segment), deterministic historic `created_at` values on legacy
projects, and authenticated JWT claims. Assert all of the following:

- `organizations.project_number_pattern`, `companies.client_number_segment`,
  `projects.pmo_project_number`, and the `(org_id, business_year)` counter exist; PMO numbers are
  nonblank and unique only within one organisation while existing `projects.code` values are unchanged.
- The default is effective when pattern is NULL; valid custom text with literals and exactly one of
  each required token persists; unknown token, duplicate/missing token, and unmatched-brace writes
  fail; a non-Admin cannot change the setting, and the Admin cannot update another organisation or an
  unrelated organisation column through the new grant.
- An authorised creator receives `CLIENT-YY-0001` then `CLIENT-YY-0002` for the same org/year,
  another org starts at `0001`, a blank/missing client segment for a `{CLIENT}` pattern is rejected,
  and the counter cannot be written directly. Use the existing genuine two-session/lock-timeout
  pgTAP predecessor pattern if needed to prove the upsert serializes the counter row; do not replace
  the atomic assertion with a source-text check.
- An authorised direct project insert which omits `pmo_project_number` receives a number from the
  BEFORE INSERT fallback after `projects_stamp_org_id`; changing an assigned PMO number is refused.
- The RPC's year matches `organizations.default_timezone` at a boundary and explicitly falls back to
  UTC; a client from a different org, an inactive/non-create role, anon, and direct counter access
  are refused.
- Backfilled numbers use `PRJ-YY-SEQ` ordered by local `created_at, id`, and the next proposal
  continues after each `(org, year)` maximum. A direct duplicate PMO-number insert fails `23505`;
  the existing duplicate-client-code rule still fails independently.

Every assertion description that proves an acceptance criterion starts with its applicable
`AC-CODE-001` or `AC-CODE-002` identifier; NFR/security assertions use `NFR-PNO-001` or
`NFR-PNO-002` in their descriptions.

**Verify (red first, then later green):**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0231_project_numbering.test.sql'
```

### 2. Add the reversible schema, backfill, and database allocator

**Files:** create `supabase/migrations/0231_project_numbering.sql`; create
`supabase/migrations/rollback/0231_project_numbering_down.sql`.

After Task 1 is red, implement the migration in this order:

1. Create an immutable SQL/PLpgSQL pattern validator used by a CHECK: accept NULL only as the system-default sentinel; otherwise scan literal/token text so braces are balanced, no unknown token occurs, and
   `{CLIENT}`, `{YY}`, `{SEQ4}` occur exactly once. Add the nullable organisation/company columns
   with comments explaining their distinct identity roles.
2. Add `projects.pmo_project_number` nullable, backfill it with a window `row_number()` partitioned
   by organisation and `extract(year from created_at AT TIME ZONE coalesce(default_timezone,'UTC'))`,
   ordering `created_at, id`; format `PRJ-` + local `YY` + `lpad(seq::text, 4, '0')`; then make the
   field NOT NULL, reject blank values, and add its named `(org_id, pmo_project_number)` unique index.
   Do not alter `projects.code`, UUIDs, FKs, or external-reference data.
3. Create and populate the project counter from the backfilled maximum per `(org_id, business_year)`.
   Enable and force RLS; no browser role receives a write path to it.
4. Add Admin-only active-member RLS plus a column-scoped organisation UPDATE grant for the pattern;
   reissue the existing explicit project INSERT-column grant with `pmo_project_number` included, and
   do not add it to UPDATE. Preserve the incumbent company write grants and allow the new
   PMO-local segment as a non-mirrored enhancement under `companies_native_mirror_guard`; do not
   forward it to an ERP command or widen any table-level grant.
5. Add private `next_project_number(p_org uuid, p_client_id uuid, p_at timestamptz default now())`
   and public `propose_project_number(p_client_id uuid) returns text`: both use pinned `search_path`,
   derive organisation/role server-side, use the timezone-aware one-statement counter upsert and
   literal replacement with a `lpad` minimum width of four. The public wrapper checks active
   membership, project-create role, and selected-company tenancy; the helper has no client execute.
   Revoke public/anon from both and grant only the wrapper to authenticated. Add a `BEFORE INSERT`
   trigger named after `projects_stamp_org_id` in trigger ordering (for example
   `zz_projects_mint_pmo_number`) which mints only when `NEW.pmo_project_number` is NULL, preserving
   supplied proposal/manual values. Add a second trigger refusing any post-insert PMO-number change.
6. Make the down migration reverse all new grants/policies/functions/triggers/indexes/constraints/tables and
   columns in dependency order. It must never alter the incumbent `projects.code` constraint or data.

**Verify:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0231_project_numbering.test.sql'
```

### 3. Regenerate the typed schema and expose narrow DAL/repository contracts

**Files:** modify `pmo-portal/src/lib/supabase/database.types.ts`,
`pmo-portal/src/lib/db/orgs.ts`, `pmo-portal/src/lib/db/orgs.test.ts`,
`pmo-portal/src/lib/db/companies.ts`, `pmo-portal/src/lib/db/companies.test.ts`,
`pmo-portal/src/lib/db/projects.ts`, `pmo-portal/src/lib/db/projects.test.ts`,
`pmo-portal/src/lib/repositories/types.ts`, `pmo-portal/src/lib/repositories/index.ts`, and
`pmo-portal/src/lib/repositories/index.test.ts`.

First add failing DAL/repository tests that assert: organisation pattern reads are RLS-scoped and its
write uses the one readable-org guard; the dedicated local company-segment method sends only the trimmed segment (or NULL) and never
routes it through the ERP company payload; project create accepts an optional `pmo_project_number` and
optional `code`; proposal calls only the RPC with `p_client_id`; header update cannot send the PMO
number; and a `23505` remains an `AppError` code for the form to classify.

Then:

- regenerate types with `supabase gen types typescript --local` and retain the generated
  organisation/company/project/counter/RPC definitions;
- add `getOrgProjectNumberPattern` / `setOrgProjectNumberPattern`; normalize the displayed system default
  to NULL before the update so it never becomes an Admin-defined pattern, and never accept client `org_id`;
- add `setCompanyProjectNumberSegment(id, segment)` as a separate PMO-local DAL/repository method
  which updates only `client_number_segment`; keep the ERP-native `CompanyInput` and its adapter
  payload unchanged;
- extend `CreateProjectInput` with optional `pmo_project_number` and optional `code`, have
  `createProject` include either when supplied (the DB trigger mints an omitted PMO number), add
  `proposeProjectNumber(clientId)`, and keep `ProjectHeaderInput` PMO-number-free;
- add matching `OrgSettingsRepository`, `CompanyRepository`, and `ProjectRepository` signatures and
  wrappers; update the repository-shape assertion.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/orgs.test.ts src/lib/db/companies.test.ts src/lib/db/projects.test.ts src/lib/repositories/index.test.ts && npm run typecheck
```

### 4. Add the shared browser pattern grammar and org-settings query

**Files:** create `pmo-portal/src/lib/projectNumberPattern.ts`,
`pmo-portal/src/lib/projectNumberPattern.test.ts`, `pmo-portal/src/hooks/useOrgProjectNumberPattern.ts`,
and `pmo-portal/src/hooks/useOrgProjectNumberPattern.test.tsx`.

Write failing pure-unit cases for the system default, valid custom literals, each missing/duplicate
required token, unknown tokens, and unmatched braces. Implement a small scanner returning either
`{ valid: true }` or a specific user-facing reason; do not attempt allocation or timezone work in the
browser. Add an org-scoped React Query hook keyed by `['org-project-number-pattern', orgId]` that
reads/writes through `repositories.orgSettings`, invalidates after a successful save, exposes loading
and retry state, and does not manufacture a value after a failed read.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/projectNumberPattern.test.ts src/hooks/useOrgProjectNumberPattern.test.tsx
```

### 5. Deliver the Admin configuration control

**Files:** create `pmo-portal/pages/admin/OrgProjectNumberPattern.tsx` and
`pmo-portal/pages/admin/OrgProjectNumberPattern.test.tsx`; modify
`pmo-portal/pages/Administration.tsx`, `pmo-portal/pages/__tests__/Administration.locale.test.tsx`, `pmo-portal/src/auth/policy.ts`, `pmo-portal/src/auth/policy.test.ts`,
`pmo-portal/public/locales/en/common.json`, and `pmo-portal/public/locales/id/common.json`.

Write the panel tests first: an Admin sees the effective default/current custom text and a text control;
an invalid token/brace/required-token shape produces inline error and does not call save; a valid custom
pattern saves through the repository and reports an error/retry state on failure; non-Admins see the
effective value and an explicit Admin-only explanation rather than a disabled form; loading is a
`ListState` rather than a blank panel.

Implement the panel with `TextField`, token helper text, loading/error/readonly states patterned after
`OrgTaxDefault`, the new `can('manage', 'orgProjectNumbering')` UX gate; add that Admin-only resource/action to `src/auth/policy.ts` rather than misclassifying numbering as accounting, and a visible explanation that
changes affect future proposals only. Mount it in the existing Organisation section of Administration;
add static `t(key, default)` calls and matching English/Bahasa catalogue values. Use DESIGN.md tokens
and responsive `max-w-*` form width; do not alter Administration shell layout.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/admin/OrgProjectNumberPattern.test.tsx pages/__tests__/Administration.locale.test.tsx && npm run check:i18n
```

### 6. Maintain the company client-number segment without erasing existing data

**Files:** modify `pmo-portal/pages/Companies.tsx`, `pmo-portal/pages/CompanyDetail.tsx`,
`pmo-portal/pages/__tests__/CompanyDetail.g3c.test.tsx`, `pmo-portal/pages/Companies.test.tsx`,
`pmo-portal/src/lib/db/companies.ts`, and `pmo-portal/public/locales/en/common.json`, and `pmo-portal/public/locales/id/common.json`.

First add failing RTL coverage for the company edit/detail path: the optional **Client number
segment** is prefilled, saves trimmed text or clear-to-null through the dedicated local mutation, is
available to an authorised editor, and an unrelated native company update preserves its stored value.
Assert the segment mutation never joins the name/type adapter payload.

Implement the optional `TextField` only on the edit path (not the externally-owned create payload)
and current CompanyDetail edit path; show the segment as labelled monospace metadata when present,
not as a replacement for the company name. Thread the separate mutation through the existing cache
invalidation and catalogue strings. Do not make a segment syntactically restrictive beyond
nonblank-after-trim, because the spec defines no alphabet.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/companies.test.ts pages/__tests__/CompanyDetail.g3c.test.tsx && npm run check:i18n
```

### 7. Make project creation obtain and retain an editable proposal

**Files:** modify `pmo-portal/src/hooks/useProjects.ts`, `pmo-portal/components/ProjectFormModal.tsx`,
`pmo-portal/components/ProjectFormModal.projectNumber.test.tsx` (new),
`pmo-portal/components/ProjectFormModal.locale.test.tsx`,
`pmo-portal/components/ProjectFormModal.bahasa.test.tsx`, and
`pmo-portal/public/locales/en/common.json`, and `pmo-portal/public/locales/id/common.json`.

Write the modal tests first. Mock the repository/RPC and prove that selecting a client requests a
proposal; the returned PMO Project Number fills a required monospace field but the user can replace it;
the optional **Client Project Code** is separately labelled and included in the create payload; a
loading proposal is announced; an RPC missing-segment error keeps the number uninvented, explains that
the selected company needs a segment, and blocks save; duplicate `23505` gives a field-level actionable
number conflict while retaining the user's entry. Include a narrow-screen render and `axe` assertion.

Implement a project-number proposal mutation/hook over the repository seam. On client selection, clear
any prior proposal/error, request one proposal, and ignore a late response for a client that is no
longer selected. Reserve only in create mode; do not request or render an editable PMO number in header
edit mode. Add `pmoProjectNumber` and `code` to create `FormValues`/validation/payload; the form requires a
nonblank PMO value only after its proposal state settles, while the DAL type remains optional for
non-form writers protected by the database fallback. Render **PMO Project Number** before the
separately labelled optional **Client Project Code**. The PMO field may be edited before create only;
`ProjectHeaderInput` stays unable to change it. Reuse `EntityFormModal`,
`TextField`, form error summary, ARIA live/error semantics, and existing tokens.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run components/ProjectFormModal.projectNumber.test.tsx components/ProjectFormModal.locale.test.tsx components/ProjectFormModal.bahasa.test.tsx
```

### 8. Preserve the number across every project read shape

**Files:** modify `pmo-portal/src/lib/db/opportunity.ts`,
`pmo-portal/src/lib/db/opportunity.test.ts`, `pmo-portal/pages/project-detail/ProjectDetail.tsx`,
`pmo-portal/pages/project-detail/ProjectDetailHeader.tsx`,
`pmo-portal/pages/project-detail/ProjectDetailRail.tsx`, and `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.test.tsx`.

First extend the explicit-projection regression test to require `pmo_project_number` and make the
pre-win merge fail to compile until it supplies the new generated field. Then add header/rail tests
that verify PMO Project Number and Client Project Code are individually labelled and that an absent
client code has an intentional not-set presentation.

Add `pmo_project_number` to `OPPORTUNITY_COLUMNS`, preserve it in the typed pre-win merge, and replace
any ambiguous one-code subtitle/rail presentation with two labelled identity values. Keep the existing
client/company/PO metadata and all routes intact.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/opportunity.test.ts pages/project-detail/__tests__/ProjectDetailHeader.test.tsx && npm run typecheck
```

### 9. Display and search both identities throughout the Projects surface

**Files:** modify `pmo-portal/pages/Projects.tsx`, `pmo-portal/pages/SalesPipeline.tsx`,
`pmo-portal/src/hooks/useRecordSearch.ts`, `pmo-portal/components/ProjectCard.tsx`,
`pmo-portal/components/ProjectCardShell.tsx`, `pmo-portal/components/ProjectCardShell.test.tsx`,
`pmo-portal/components/ProjectCard.test.tsx`, `pmo-portal/components/ProjectKanbanBoard.test.tsx`,
`pmo-portal/pages/Projects.test.tsx`, `pmo-portal/pages/SalesPipeline.test.tsx`,
`pmo-portal/src/hooks/__tests__/useRecordSearch.test.tsx`, and create
`pmo-portal/pages/__tests__/Projects.projectNumber.test.tsx`.

Write focused RTL tests first with one project carrying both fields: the active Projects and Sales
Pipeline filters, plus the command-palette record index/ranking, each match PMO number and Client
Project Code; list/card/detail rendering labels them separately; and a missing client code does not
hide the PMO number. Add companion card/kanban tests for their compact but separate
labelled/accessible treatment.

Update the Projects and Sales Pipeline filter predicates to search name, `pmo_project_number`, and
`code`; retain each surface's present client/end-customer search terms. Extend `useRecordSearch` so
active and pipeline record subtitles/index text expose both identifiers without creating duplicate
records. In table/grid/kanban cards render PMO number as the primary monospace identifier and Client
Project Code only when present; pass distinct props through `ProjectCard` and `ProjectCardShell`
instead of overloading `code`. Keep card activation, company link rules, existing status/financial
content, and mobile token layout unchanged. Add English/Bahasa static keys and preserve all existing
list working-set URL behaviour.

**Verify:**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/Projects.projectNumber.test.tsx pages/Projects.test.tsx pages/SalesPipeline.test.tsx src/hooks/__tests__/useRecordSearch.test.tsx components/ProjectCardShell.test.tsx components/ProjectCard.test.tsx components/ProjectKanbanBoard.test.tsx && npm run check:i18n
```

### 10. Add the curated real-user create journey

**Files:** create `pmo-portal/e2e/serial/AC-CODE-002-project-number-proposal.spec.ts` and
`pmo-portal/e2e/AC-CODE-003-project-identifiers.spec.ts`.

Before production code is considered complete, write the serial BDD journey. As Admin, create a
uniquely named client with a segment, save a custom `{CLIENT}` pattern through Administration, and
then as a project-create-authorised user create an Internal Project with the selected client. Assert a
number matching the literal/client/year/sequence pattern is proposed, deliberately edit it to a unique
chosen value, save, and assert the saved project displays that PMO number separately from its Client
Project Code. In `try/finally`, restore the organisation setting through the same UI so this
org-global serial fixture cannot leak into later work; use a unique test company/project and never
alter a seed record. Tag the file/header with the mandated serial isolation annotation. Separately, write the
self-isolated AC-CODE-003 journey: create a unique Internal Project carrying an optional Client
Project Code, assert the PMO number and client code are separately visible after save, then search
the active Projects list by each value and reach the same project. Keep it in the normal chromium
lane; it changes no organisation-global configuration and uses only uniquely named rows.

**Verify:**
```bash
scripts/with-db-lock.sh scripts/e2e-local.sh AC-CODE-002-project-number-proposal
scripts/with-db-lock.sh scripts/e2e-local.sh AC-CODE-003-project-identifiers
```

### 11. Run the scoped release-quality gates

**Files:** no production changes; inspect the complete touched-file set.

Run the migration reset and targeted pgTAP as one database lock hold, then the exact unit/RTL suite,
typecheck, zero-warning ESLint over every changed TypeScript/TSX file, i18n completeness, the new
serial journey, and visual/craft-floor detection. Resolve failures in code/tests rather than weakening
or skipping a test. Do not regenerate `package-lock.json`.

**Verify:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0231_project_numbering.test.sql'
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/projectNumberPattern.test.ts src/lib/db/orgs.test.ts src/lib/db/companies.test.ts src/lib/db/projects.test.ts src/lib/db/opportunity.test.ts src/hooks/useOrgProjectNumberPattern.test.tsx pages/admin/OrgProjectNumberPattern.test.tsx src/auth/policy.test.ts pages/__tests__/CompanyDetail.g3c.test.tsx pages/Companies.test.tsx pages/__tests__/Projects.projectNumber.test.tsx pages/Projects.test.tsx pages/SalesPipeline.test.tsx src/hooks/__tests__/useRecordSearch.test.tsx components/ProjectFormModal.projectNumber.test.tsx components/ProjectCardShell.test.tsx && npm run typecheck && npx eslint --max-warnings=0 src/lib/projectNumberPattern.ts src/lib/db/orgs.ts src/lib/db/companies.ts src/lib/db/projects.ts src/lib/db/opportunity.ts src/hooks/useOrgProjectNumberPattern.ts src/hooks/useProjects.ts src/lib/repositories/index.ts src/lib/repositories/types.ts pages/admin/OrgProjectNumberPattern.tsx pages/Administration.tsx pages/Companies.tsx pages/CompanyDetail.tsx pages/Projects.tsx pages/project-detail/ProjectDetail.tsx pages/project-detail/ProjectDetailHeader.tsx pages/project-detail/ProjectDetailRail.tsx components/ProjectFormModal.tsx components/ProjectCard.tsx components/ProjectCardShell.tsx && npm run check:i18n
scripts/with-db-lock.sh scripts/e2e-local.sh AC-CODE-002-project-number-proposal
scripts/with-db-lock.sh scripts/e2e-local.sh AC-CODE-003-project-identifiers
impeccable detect --json
```

## Completion criteria

- The three canonical AC owners above are green, with their AC IDs in the owning test description.
- pgTAP demonstrates backfill preservation, per-org/year atomic allocation, uniqueness, Admin-only
  pattern write, membership/tenant boundaries, and UTC/timezone behaviour.
- Project creation presents an editable proposal, but no post-create header route can mutate it.
- Projects, cards, company/project detail, and pre-win explicit reads carry two distinct identifiers;
  both are searchable where Projects search operates.
- UI strings are complete in both catalogues, responsive in light/dark token themes, and
  `impeccable detect --json` is clean.
