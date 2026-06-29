# ADR-0037 — View-Composition Trusted Core: compiler DSL, whitelist shape, and `tasks` required-filter rule

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Director, eng-planner
- **Related:** ADR-0036 (parent decision — deputy model, build sequence), ADR-0001 (org_id seam), ADR-0010 (test pyramid), ADR-0017 (repository seam), ADR-0030 (Layer-1 gate-tests)
- **Implements:** ADR-0036 §4a/b/c (primitive registry, query-spec DSL, compiler), §10.2 issue I2

## Context

ADR-0036 §4 specifies the trusted core as three sub-components (primitive registry, query-spec DSL,
compiler) but defers the exact DSL shape, whitelist structure, token set, and error-code taxonomy to
the implementing plan. This ADR records the architectural decisions made during planning for I2 that
are irreversible or cross-cutting — specifically the four owner-decision (OD) resolutions and the
error-taxonomy extension. These decisions constrain I3 (renderer) and I4 (builder UI), so they are
recorded here rather than left as implementation notes.

## Decisions

### 1. `tasks` entity requires a `project_id` filter at compile time (OD-2, option a)

The existing `repositories.task.list(projectId)` method requires a project ID — it is a per-project
read, not an org-wide list. Rather than adding a new `task.listAll()` DAL method (option b), the
compiler enforces that any `QuerySpec` with `entity: 'tasks'` must carry at least one filter on
`project_id` with op `eq` or `in`. If absent, the compiler throws `ValidationError({ code:
'MISSING_REQUIRED_FILTER' })`.

A `$current_project` token is added to the valid token set, resolving to `ctx.projectId`. If
`ctx.projectId` is absent (null/undefined), the compiler throws `ValidationError({ code:
'UNRESOLVABLE_TOKEN', detail: '$current_project' })` rather than emitting a null filter.

**Rationale:** Option (a) keeps I2 pure TypeScript (no new DAL method, no migration, no test at
pgTAP layer). Option (b) would require a new `listAll()` call that bypasses the project scoping
that the existing RLS does not enforce at the table level for `tasks` — RLS scopes by `org_id`,
not `project_id`, so a `listAll()` returning all tasks org-wide is fine from a security standpoint
but adds a DAL method that is out of I2's scope. **Deferrability:** if the renderer (I3) needs
org-wide task aggregation, the DAL extension is a one-method addition at that phase.

**Consequence:** QuerySpecs for tasks always carry a `project_id` constraint. The renderer (I3)
passes `ctx.projectId` when the view context has a current project; otherwise the filter must be
a literal UUID. Agent-composed specs that want org-wide task stats must wait for option (b) in I4+.

### 2. `$current_team` resolves to null → `UNRESOLVABLE_TOKEN` (OD-4)

No `team_id` concept exists in the current PMO schema. The token `$current_team` is included in
the type and token set for forward-compatibility, resolving to `ctx.teamId`. When `ctx.teamId` is
absent, rather than emitting a null-value filter (which would produce undefined query behavior),
the compiler throws `ValidationError({ code: 'UNRESOLVABLE_TOKEN', detail: '$current_team' })`.

**Rationale:** A null filter passed to the repository would either match no rows (`IS NULL`) or
error at the Supabase client layer — neither is the intended behavior. Failing loudly at compile
time surfaces the missing context explicitly and prevents silent data mismatches.

### 3. `timeRange` is normalized to two `date-range` filter clauses (OQ-3)

The DSL exposes both a top-level `timeRange?: TimeRangeSpec` and a `filters[].op: 'date-range'`
operator. To avoid dual representation, the compiler normalizes `timeRange` into two appended
`resolvedFilters` entries (from and to as a `[string, string]` tuple with op `date-range`) and
also populates `resolvedTimeRange` as a standalone descriptor for the renderer's convenience. The
renderer (I3) uses `resolvedTimeRange` to render date-range pickers; it uses `resolvedFilters` for
the actual data-fetch call. The two representations are always consistent.

### 4. Numeric column whitelist includes `budget` and `spent` for `projects` (OD-1)

The spec (FR-VC-022) names `contract_value` as the confirmed numeric column for `projects`. The
database schema (`database.types.ts`) shows `budget: number` and `spent: number` also on the
`projects` table Row type. Both are financial-meaning fields (budgeted amount and spent-to-date)
that are genuinely useful in `sum/avg/min/max` aggregations. They are added to `numericColumns`
for `projects` in the V1 whitelist, consistent with FR-VC-022's "implementer expands after type
audit" instruction.

No other entity has numeric columns worth whitelisting in V1: `tasks`, `incidents`, `contacts`,
`companies`, and `user_views` rows contain no financial-amount columns visible to the query layer
at this entity level (procurement amounts are on `procurements`, not the whitelisted entities).

### 5. Error-code taxonomy (extension beyond FR-VC-038)

The spec enumerates six error codes. Three additional codes are introduced:

- `MISSING_REQUIRED_FILTER` — entity requires a filter on a specific column that is absent. Used
  for `tasks` (project_id). The code is distinct from `UNKNOWN_COLUMN` (which is a whitelist miss)
  to allow I3/I4 to provide a more specific error message to the user.
- `UNRESOLVABLE_TOKEN` — a known token whose context value is absent (e.g. `$current_team` when
  `ctx.teamId` is null). Distinct from `UNKNOWN_TOKEN` (which is an unrecognized `$...` string)
  to differentiate "token unknown" from "token known but context lacks the value."
- `NOT_GROUPABLE_COLUMN` — a column that exists in `allowedColumns` but not in `groupableColumns`.
  Using `UNKNOWN_COLUMN` here would be misleading: the column is known but not permitted in the
  `groupBy` position. A distinct code lets I3/I4 render "this column cannot be grouped on" rather
  than "unknown column". The same rationale that produced `MISSING_REQUIRED_FILTER` over
  `UNKNOWN_COLUMN` for OD-2 applies here.

All three codes are exported from `ValidationError` in `types.ts` and are type-safe
(`ValidationErrorCode` union). I3/I4 catch these codes to render actionable UI messages.

### 6. `contacts` whitelist uses `full_name` (schema-verbatim column name)

The spec (FR-VC-021) lists `name` as the minimum column for `contacts`. The actual DB schema column
is `full_name` (the `contacts.Row` type in `database.types.ts`). The whitelist uses `full_name` to
match the actual column name. QuerySpecs must use `full_name`, not `name`. The renderer (I3)
displays it as "Name" in column headers. No alias layer is introduced in I2.

## Consequences

**Positive**
- The `tasks` required-filter rule prevents a class of "forgot to scope by project" bugs at compile
  time, without any runtime overhead.
- The normalized `timeRange` → `resolvedFilters` pipeline means the renderer has a single
  `resolvedFilters` array to hand to the repository, with no special-case timeRange handling needed.
- The extended error codes give I3/I4 the vocabulary to display specific, actionable messages to
  spec-authors (agent and human).
- The `budget`/`spent` numeric whitelist immediately enables financially-useful aggregations for
  the most common entity (`projects`) without any schema change.

**Negative / costs**
- `MISSING_REQUIRED_FILTER` is a compiler-enforced constraint that restricts expressible QuerySpecs
  for `tasks`. If org-wide task aggregation is needed before I4, a one-method DAL addition and
  whitelist entry update unblocks it — the change is backward-compatible (new whitelisted repository
  method alongside the existing one).
- The `full_name` vs `name` mismatch requires spec-authors (agent or human) to know the DB column
  name. I4 (the manual builder UI) can surface this with a human-readable label, but the raw
  `QuerySpec` JSON always uses `full_name`. An alias layer (if ever needed) belongs in I3/I4.

## Verification

- `tsc --noEmit` zero errors (import chain from `compiler.ts` does not reach `src/lib/supabase/client`
  or any `src/lib/db/*` module — confirmed by the absence of those imports in `compiler.ts`).
- All AC-VC-001..013 Vitest tests pass (`npm test -- src/lib/viewspec`).
- `npm run verify` green (no broken build, lint, or cross-component breakage).
