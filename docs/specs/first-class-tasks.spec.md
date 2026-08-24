# First-class tasks — spec

**Issue:** #462 (closed decision ticket) · **Sequence:** step 2 of the RIS go-live map (#450), gates
#463 (meetings) · **Rulings:** `DD-TASK-1..5`, `DD-TASK-6`, `OD-TASK-1..2`, `DD-MTG-2`, `OD-2` (repealed here),
`OD-INT-9`, `FR-IEM-010..013` · ⚑ **`DD-TASK-7` was raised and RETRACTED 2026-08-21 — see §8.2**

**Id prefix:** `FCT` — `FR-FCT-###` / `AC-FCT-###`. Unused elsewhere in `docs/specs/` (checked
against every `FR-`/`AC-` prefix in the tree). ⚑ Not to be confused with the **legacy `AC-TASK-###`**
ids already in `supabase/tests/0052_task_engineer_status.test.sql` and `src/lib/db/tasks.ts` — those
belong to the 2026 CRUD slice and stay as they are.

> **Why this document exists.** #462 is closed with five rulings and no spec, no build ticket and no
> size. `DD-TASK-2` demands that new pgTAP oracles exist **before** the migration; that is impossible
> without written criteria for them to encode. This is that missing half.
>
> **Three of #462's premises are false against `dev`.** Where the ticket and the code disagree, the
> code wins. All three are recorded in §7 with `file:line`, because each would have produced a
> different migration.

## 1. Scope

Make `tasks.project_id` nullable so a task may belong to a project or to nothing, and reconcile the
**write-authorization surface** — four RLS policies and four triggers — as one atomic change. Then
repeal `OD-2` (the "tasks always require a project filter" contract) and reach project-less tasks
from the UI.

**In:** the nullable column, the policy/trigger reconciliation, the `OD-2` repeal across its five
shipped sites, `My Tasks` handling of project-less rows, a `/tasks/:id` deep link.

**Out, by ruling:** `tasks.meeting_id` and everything meeting-shaped (`DD-TASK-2`, ships with #463);
nullable `timesheet_entries.project_id` (`DD-TASK-5`); an org-wide task browser, saved task views,
filters beyond assignee and status (`DD-TASK-4`); any ERPNext or ClickUp sync change.

**What exists today.** `tasks.project_id uuid not null references projects(id) on delete cascade` —
`supabase/migrations/0001_init_schema.sql:209`. The current policy and trigger bodies live in
`supabase/migrations/0146_project_task_ownership.sql`, **not** in `0002`/`0016`/`0034`/`0093` where
they were introduced; `check_tasks_parent_same_project` is the one exception, still at
`0140_task_model_fields.sql:54-68`.

## 2. Requirements (EARS)

### 2.1 Schema

- **FR-FCT-001** — *Ubiquitous.* `tasks.project_id` shall be nullable.
- **FR-FCT-002** — *Ubiquitous.* The FK shall keep `on delete cascade`. Deleting a project deletes
  its tasks; a project-less task is one that was **never** given a project, never one orphaned by a
  deletion. (`on delete set null` would silently convert deleted-project work into
  "unassigned" work — see §8 if the owner wants the other answer.)
- **FR-FCT-003** — *Ubiquitous.* This migration shall **not** add `tasks.meeting_id`, nor any second
  nullable parent (`DD-TASK-2`).
- **FR-FCT-004** — *State-driven.* While a task has no project it shall have no milestone —
  `check (milestone_id is null or project_id is not null)`. Every server-side rollup joins tasks
  **through `milestone_id`**, never `project_id` (`0023:68,95` · `0026:33` · `0033:167` ·
  `0141:42,76` · `0145:42,77`), so without this a project-less task with a borrowed milestone id
  moves a project's delivery percentage.
- **FR-FCT-005** — *Ubiquitous.* `timesheet_entries.project_id` shall remain `not null`
  (`0001_init_schema.sql:197`) and no timesheet code shall change (`DD-TASK-5`).

### 2.2 Write authorization — the four policies

- **FR-FCT-010** — *Ubiquitous.* The four write policies on `tasks` shall agree on the
  no-project case. Today they do not: with `project_id is null`, `tasks_insert` (`0146:47-50`),
  `tasks_update` (`0146:52-56`) and `tasks_delete` (`0146:58-61`) all deny via
  `exists (select 1 from projects p where p.id = tasks.project_id …)`, while
  `tasks_update_own_status` (`0146:63-67`) passes.
- **FR-FCT-011** — *State-driven.* While a task has no project, the four write roles
  (`Admin`, `Executive`, `Project Manager`, `Finance`) shall retain INSERT, UPDATE and DELETE on it,
  scoped by `org_id = auth_org_id()`.
- **FR-FCT-012** — *State-driven.* While a task **has** a project, the parent-org guard shall be
  unchanged: the project must be in the caller's org. The guard's job is tenancy, and it must not be
  weakened for project-carrying rows in the course of admitting project-less ones.
- **FR-FCT-013** — *State-driven.* While a task has no project, `tasks_update_own_status` shall grant
  the assignee exactly the scope it grants today on a project-carrying task — the row, and `status`
  alone — and shall not become a full-edit path for any role.
- **FR-FCT-014** — *Ubiquitous.* External ownership shall be resolved for a task through **one**
  predicate whose answer for a project-less row is **declared** rather than incidental. Today
  `project_domain_externally_owned(project_id,'tasks')` (`0146:16-36`) returns `false` for a NULL
  project only because `p.id = null` matches no row — the same accident that produces
  FR-FCT-020/021's failures.
- **FR-FCT-015** — *Ubiquitous.* `tasks_select` (`0002_rls.sql:91`) and both `task_dependencies`
  policies (`0002_rls.sql:100-108`) shall be unchanged. The read path derives tenancy from the task's
  own `org_id`, and the dependency guard checks `t.org_id` on **both** endpoints — neither consults
  `project_id`. (#462's headline "the read path is unaffected" is **confirmed**.)

### 2.3 Write authorization — the four triggers

The four triggers on `tasks` are `tasks_stamp_org_id` (`0074:126-133`, project-independent),
`tasks_assignee_status_only` (`0016:65`, body at `0146:71-117`), `trg_stamp_task_completed_at`
(`0034:40`, body at `0146:119-136`), and `tasks_check_parent_same_project` (`0140:66`, body at
`0140:54-64`).

- **FR-FCT-020** — *Event-driven.* When a service-role mirror writer updates a task it owns
  externally, `stamp_task_completed_at` shall preserve the supplied `completed_at`. Its bypass is
  gated on `project_domain_externally_owned(new.project_id,'tasks')` (`0146:122-125`); for a
  project-less row that is false, and the function then **rewrites** `completed_at` from `status`
  (`0146:126-134`) with no error raised. The ClickUp mirror writes `completed_at` explicitly
  (`supabase/functions/_shared/clickupMirrorDeps.ts:87` on update, `:112` on mint).
- **FR-FCT-021** — *Event-driven.* When a task is externally owned, `enforce_assignee_status_only`
  shall pin its native fields for every non-service-role caller (`0146:78-97`) and shall exempt the
  service-role mirror (`0146:74-77`). Both branches are gated on the same project-derived predicate
  and are therefore unreachable for a project-less row: the pin silently disappears, and the mirror
  bypass silently disappears (that one fails **loud**, at `0146:101-115`, with `42501`).
- **FR-FCT-022** — *Ubiquitous.* `check_tasks_parent_same_project` shall not be vacuous. For two
  project-less tasks it evaluates `null is distinct from null` → `false` (`0140:57-59`), so any
  project-less task may parent any other project-less task in the org. The invariant must state what
  it guarantees for the NULL case rather than inherit it from three-valued logic.
- **FR-FCT-023** — *Ubiquitous.* The reconciliation of FR-FCT-020/021/022 shall be **one** change to
  how task ownership is resolved, not three patches to three call sites (`DD-TASK-2` §3).

### 2.4 The `OD-2` repeal

`requiredFilter: 'project_id'` is declared once and enforced in five shipped places:

| # | Site | Line |
|---|---|---|
| 1 | the declaration | `pmo-portal/src/lib/viewspec/types.ts:246` |
| 2 | the view compiler | `pmo-portal/src/lib/viewspec/compiler.ts:243-252` |
| 3 | the builder UI (`tasksFilterSatisfied` gates submit) | `pmo-portal/src/components/builder/PanelEditorForm.tsx:196-208` |
| 4 | the agent read path | `supabase/functions/agent-chat/entityCatalog.ts:35,77` + `supabase/functions/agent-chat/actions.ts:131-138` |
| 5 | the two system prompts | `supabase/functions/compose-view/prompt.ts:39-40` + `supabase/functions/agent-chat/prompt.ts:63-64` |

- **FR-FCT-030** — *Ubiquitous.* `requiredFilter` shall be removed from the `tasks` entry, and all
  five sites shall stop demanding a `project_id` filter. The `requiredFilter` **mechanism** stays —
  it is entity-generic and no other entity uses it today; deleting it is a separate decision.
- **FR-FCT-031** — *Ubiquitous.* Every tasks read on the repealed paths shall stay row-capped. This
  is **already true** and the requirement exists to keep it so: `executor.ts:137` applies
  `.limit(compiled.limit ?? 500)` unconditionally, and `actions.ts:142` clamps to
  `AGENT_READ_ROW_CAP`.
- **FR-FCT-032** — *Ubiquitous.* Every tasks read on the repealed paths shall carry an explicit,
  deterministic order. This is **not** true today: `resolvedOrderBy` is optional
  (`executor.ts:127-132`) and the agent read path applies no order at all
  (`actions.ts:154-168`), so an unfiltered capped read returns an arbitrary N rows. This is the half
  of `DD-TASK-3`'s "hard row cap plus explicit ordering" that is actually missing.
- **FR-FCT-033** — *Ubiquitous.* No replacement required filter shall be introduced (`DD-TASK-3`).

### 2.5 Surfaces (`DD-TASK-4`)

- **FR-FCT-040** — *Ubiquitous.* `My Tasks` shall render project-less assigned tasks. The page
  already exists and is already assignee-scoped across projects (`pmo-portal/pages/MyTasks.tsx`,
  route `/my-tasks` at `pmo-portal/App.tsx:137`, query at
  `pmo-portal/src/hooks/useMyTasks.ts:36-63`) — see §7.
- **FR-FCT-041** — *State-driven.* While a task has no project, `My Tasks` shall group it under a
  distinct heading that is **not** a project link. Today the group key is `t.project_id`
  (`MyTasks.tsx:57-66`) and the heading is `<Link to={/projects/${group.projectId}/tasks}>`
  (`MyTasks.tsx:118-127`) — a NULL project id produces a link to `/projects/null/tasks`.
- **FR-FCT-042** — *State-driven.* While a task has no project, the row shall offer no **Log time**
  affordance. The link is `/timesheets?project=${task.project_id}` (`MyTasks.tsx:165-170`), and
  `FR-FCT-005` makes the destination unusable. Hiding it is the "legible workflow with an obvious
  prompt" `DD-TASK-5` names.
- **FR-FCT-043** — *Ubiquitous.* A `/tasks/:id` route shall exist that is not nested under a project.
  No such route exists today (`App.tsx:136-137` is the only task route; `MyTasks.tsx:137-139`
  documents the absence). `getTask(id)` (`src/lib/db/tasks.ts:115-126`) is already project-agnostic
  and needs no change.
- **FR-FCT-044** — *Ubiquitous.* No org-wide task browser, saved task view, or filter beyond assignee
  and status shall ship (`DD-TASK-4`).
- **FR-FCT-045** — *Ubiquitous.* The FE shall not create project-less tasks in this ticket.
  `TaskInput.project_id` is required (`src/lib/db/tasks.ts:21`); `DD-TASK-2` says step 1 ships a
  capability whose only consumer is pgTAP, and the creating UI arrives with #463.

### 2.6 Types

- **FR-FCT-050** — *Ubiquitous.* `database.types.ts` shall be **regenerated**, not hand-edited and
  not cast around. `tasks.Row.project_id` is `string` and `Insert.project_id` is required today
  (`pmo-portal/src/lib/supabase/database.types.ts:4257,4276`); regenerating it to `string | null` is
  what turns the FE sweep from a grep into a typecheck.

## 3. Acceptance criteria

**Authorization (the disagreement).**

- **AC-FCT-001** — *Given* a project-less task, *when* a Project Manager in its org updates its name,
  *then* the update succeeds. *(Today: `tasks_update`'s USING hides the row → a **silent 0-row
  no-op** the DAL reports as success — `src/lib/db/tasks.ts:211-212` checks `error`, never a row
  count.)*
- **AC-FCT-002** — *Given* a project-less task, *when* a Project Manager deletes it, *then* it is
  gone. *(Today: silent 0-row no-op.)*
- **AC-FCT-003** — *Given* a project-less task, *when* a Project Manager archives it, *then*
  `archived_at` is set. *(Today: `archiveTask` → `tasks_update` → silent 0-row no-op.)*
- **AC-FCT-004** — *Given* an org, *when* a Project Manager inserts a task with no project, *then*
  the row is created. *(Today: `tasks_insert`'s WITH CHECK denies → `42501`; no policy admits a
  project-less INSERT for any authenticated role.)*
- **AC-FCT-005** — *Given* a project-less task assigned to an Engineer, *when* that Engineer changes
  its `status`, *then* the change succeeds and no other column moves.
- **AC-FCT-006** — *Given* a project-less task assigned to an Engineer, *when* that Engineer changes
  its `name`, *then* it is rejected with `42501`.
- **AC-FCT-007** — *Given* a project-less task assigned to a **Project Manager**, *when* that PM
  changes its `name` via the own-status path, *then* the outcome matches AC-FCT-001 — the assignee
  policy is not a wider door than the manager policy. *(Today it is: `tasks_update_own_status` admits
  the row and `enforce_assignee_status_only` returns early for any write role at `0146:98-100`, so an
  assigned PM gets full structure edit on a row an unassigned PM cannot touch at all.)*
- **AC-FCT-008** — *Given* a task **with** a project in another org, *when* any role writes to it,
  *then* it is denied — the parent-org guard is intact.
- **AC-FCT-009** — *Given* a project-less task in org A, *when* a user in org B reads or writes it,
  *then* they see nothing and change nothing.

**Triggers.**

- **AC-FCT-010** — *Given* a project-less task, *when* the service-role mirror writes
  `completed_at = T` alongside a `status` that does not imply completion, *then* the stored value is
  `T`. *(Today: silently rewritten from `status`.)*
- **AC-FCT-011** — *Given* a project-less task, *when* the externally-owned pin is expected to be
  inactive, *then* an authenticated write role may edit its native fields; and *given* the pin is
  expected to be active, *then* the same write is rejected `42501`. One oracle per direction — a pin
  that is never active and a pin that is never inactive both pass a single-direction test.
- **AC-FCT-012** — *Given* two project-less tasks, *when* one is set as the other's
  `parent_task_id`, *then* the outcome is the one this spec declares, asserted explicitly rather than
  inherited from `null is distinct from null`.
- **AC-FCT-013** — *Given* a project-less task, *when* a `milestone_id` is set on it, *then* the
  write is rejected (FR-FCT-004).
- **AC-FCT-014** — *Given* a milestone with one project-carrying task and one project-less task
  pointed at it by any means, *when* `get_project_milestones` runs, *then* the rollup counts only the
  project-carrying task.
- **AC-FCT-015** — *Given* a task **with** an externally-owned project, *when* a Project Manager
  edits a native field, *then* it is rejected `42501` — the pre-existing pin still fires. *(The
  neighbour oracle `DD-TASK-2` §4 demands; the shipped proofs are
  `supabase/tests/tasks_external_owned_rls.test.sql` and `tasks_parent_external_owned_rls.test.sql`.)*

**`OD-2` repeal.**

- **AC-FCT-020** — *Given* a `QuerySpec` on `tasks` with no `project_id` filter, *when* it is
  compiled, *then* it compiles.
- **AC-FCT-021** — *Given* that same spec, *when* it is compiled, *then* the compiled query carries a
  `limit` ≤ 500 **and** a non-empty `orderBy`.
- **AC-FCT-022** — *Given* the agent's `query_entity` on `tasks` with no filter, *when* it runs,
  *then* it returns rows capped at `AGENT_READ_ROW_CAP` in a deterministic order, and the internal
  `tombstoned_at is null` filter is still applied (`actions.ts:145-150`).
- **AC-FCT-023** — *Given* the builder's panel editor with entity `tasks` and no filter, *when* the
  form is submitted, *then* it submits.
- **AC-FCT-024** — *Given* either system prompt, *when* it is built, *then* it contains no
  "REQUIRED FILTER" line for `tasks`. ⚑ `prompt.test.ts:49` currently asserts
  `expect(prompt).toContain('project_id')` **because** of the required filter; `project_id` is also a
  plain allowed column (`types.ts:241`), so that assertion stays green after the repeal and proves
  nothing. It must be replaced, not relied on.

**Surfaces.**

- **AC-FCT-030** — *Given* the signed-in user has one project task and one project-less task, *when*
  `My Tasks` renders, *then* both appear, the project-less one under a heading that is not a link,
  and no anchor href contains `/projects/null`.
- **AC-FCT-031** — *Given* a project-less task row in `My Tasks`, *when* it renders, *then* no
  **Log time** control is present.
- **AC-FCT-032** — *Given* a project-less task id, *when* `/tasks/:id` is opened, *then* the task
  renders; *given* an id in another org, *then* a not-found state renders and no row data leaks.
- **AC-FCT-033** — *Given* the app builds, *when* `npm run typecheck` runs after the types regen,
  *then* zero errors — i.e. every FE site that assumed `project_id: string` has been handled.

## 4. Traceability

| AC | Owning layer | Location |
|---|---|---|
| AC-FCT-001..009 | Integration (**pgTAP**) | new `supabase/tests/<n>_tasks_nullable_project_rls.test.sql` — RLS role×NULL matrix; the DB is the authority |
| AC-FCT-010..013 | Integration (**pgTAP**) | same file — trigger behaviour under `set role` + `request.jwt.claims`, per the `tasks_external_owned_rls.test.sql` harness |
| AC-FCT-014 | Integration (**pgTAP**) | extend `supabase/tests/0145_task_archive_rollup_and_rls.test.sql` (the rollup oracle already lives there) |
| AC-FCT-015 | Integration (**pgTAP**) | extend `supabase/tests/tasks_external_owned_rls.test.sql` — the neighbour |
| AC-FCT-020/021 | Unit (Vitest) | `src/lib/viewspec/compiler.test.ts` — replaces the `AC-VC-016` case at `:477` |
| AC-FCT-022 | Unit (Vitest) | `supabase/functions/agent-chat/actions.queryEntity.test.ts` |
| AC-FCT-023 | Unit (Vitest/RTL) | `src/components/builder/PanelEditorForm.test.tsx` |
| AC-FCT-024 | Unit (Vitest) | `src/lib/agent/prompt.test.ts` — the replacement assertion |
| AC-FCT-030/031 | Unit (Vitest/RTL) | new `pmo-portal/pages/__tests__/MyTasks.nullProject.test.tsx` — rendering, not a journey |
| AC-FCT-032 | **E2E** (Playwright) | `e2e/AC-FCT-032-standalone-task-deep-link.spec.ts` — the only genuinely cross-stack case: RLS + route + render for a row no project-scoped query can reach |
| AC-FCT-033 | CI gate | `npm run typecheck` inside `npm run verify` |

One curated e2e for the whole ticket. Everything else is owned at the layer that can actually fail
for the right reason — the authorization matrix is pgTAP's by ADR-0010, and putting any of it in
Playwright would trade a precise oracle for a slow one.

## 5. Order of operations

`DD-TASK-2` gives the order; this is it with the reason for each edge, because the reasons are what
stop a builder from "helpfully" resequencing.

1. **Write the pgTAP oracles first, against the current schema. Watch them go red.**
   Non-negotiable. Their entire job is to fail if the migration gets the authorization surface wrong;
   written afterwards they get written to match whatever shipped. Several will fail at
   `insert … project_id = null` with a not-null violation rather than on the assertion — that is a
   legitimate red, and the oracle must be shaped so it turns green **for its own reason** afterwards,
   not merely because the insert started working.
2. **One atomic migration.** Nullable column + FR-FCT-004's CHECK + the single ownership predicate +
   **all four policies** + **both trigger bodies**, in one file. The defect this ticket exists to
   prevent is the *disagreement between* these parts, so changing some and not others is the failure
   mode — not a cautious partial step toward it.
3. **Run the mutation battery against the NEIGHBOURS, not just the changed policies.** Break one rule
   at a time (`const allowed = true`-style) and confirm the specific oracle reddens. Suspect every
   `throws_ok(sql, code, null)` — a null code matches any error, so a policy edit that changes *which*
   error fires leaves such a test green while the behaviour moved. The recorded July lesson is that a
   fix disarmed a neighbouring oracle and the battery could not see it.
4. **Regen `database.types.ts`, then fix the FE.** In that order, and never the reverse: regenerating
   first flips `project_id` to `string | null` (`database.types.ts:4257`) and the typechecker then
   *enumerates* every site that assumed non-null. Fixing the FE first, or casting past the regen,
   converts a complete list into a guess. This is the single strongest argument for the sequence.
5. **App surfaces** — `My Tasks` grouping and Log-time suppression, then `/tasks/:id`.
6. **The `OD-2` repeal, last.** All five sites in §2.4, plus FR-FCT-032's ordering. It goes last
   because until step 2 lands there are no project-less tasks, so an unfiltered tasks query returns
   exactly what a filtered one does — the repeal would be reviewed on a diff where nothing can
   demonstrate it is safe, and it would widen the agent's read surface ahead of any capability that
   needs it.
7. **E2E** (AC-FCT-032), then the full `npm run verify`, then `scripts/verify-main-pr.sh` before any
   PR at `main`.

⚑ **`meeting_id` is not in this list.** It is the second nullable parent and takes its own migration
after this one lands alone (`DD-TASK-2`, `DD-MTG-2`). Splitting them is what lets the dangerous change
be reviewed on its own diff.

## 6. Traps this work will hit

- ⚑ **The manager lock-out is silent, not loud.** `tasks_update` and `tasks_delete` deny through
  `using`, which **hides the row** — PostgREST returns success with zero rows affected, and
  `updateTask`/`deleteTask`/`archiveTask` only inspect `error` (`src/lib/db/tasks.ts:211-212,
  249-253, 269-271`). A builder testing by hand will see "saved" and a value that did not change. Only
  INSERT fails loudly (`with check` → `42501`). Any oracle for AC-FCT-001/002/003 must assert the
  **row's value**, never the absence of an error.
- ⚑ **`DD-CUR-4`'s inverse.** `tasks` carries **table-level** grants to `authenticated` **and
  `anon`** (`0075_explicit_api_grants.sql:250-253`), not the column-level grants `budget_versions`
  has. So the opposite trap applies: a new column on `tasks` is writable the moment it exists, with
  no grant to add and nothing to forget — which means a column-level grant is **not** available as a
  defence layer here, and any restriction must be expressed in policy or trigger. Check `0194` before
  assuming the `anon` grants are still live.
- ⚑ **The lint-hardening test is a pattern check, not a text check.**
  `supabase/tests/0058_lint_hardening.test.sql:117-125,208-214` asserts that
  `tasks_update_own_status`'s qualifier contains `( SELECT auth.uid()` and that the count of
  `auth.uid()` equals the count of `( SELECT auth.uid()`. Rewriting the policy is fine; introducing a
  bare `auth.uid()` anywhere in it is not. #462 predicts this test "**will** go red the moment that
  policy is edited" — it will not (see §7). Do **not** treat a green here as evidence the rewrite was
  reviewed.
- ⚑ **`repositoryMethod` is vestigial on the view path.** `executeCompiledQuery` builds a PostgREST
  chain from `entityEntry.table` (`executor.ts:110-121`) and never calls
  `repositories.task.list`. So repealing `OD-2` does **not** require a `task.listAll()` DAL method,
  and the `'task.list'` string at `types.ts:238` is not a call site. Do not "fix" `listTasks` to
  accept an optional project id on account of the repeal — it stays the per-project read that
  `useTasks` and the project detail tabs use.
- ⚑ **`prompt.test.ts:49` cannot detect the repeal.** It asserts the prompt contains `project_id`,
  which remains true afterwards because `project_id` is also an ordinary allowed column
  (`types.ts:241`). Replace it with an assertion on the absence of the `REQUIRED FILTER` line
  (`compose-view/prompt.ts:40`) or the test silently stops testing anything.
- ⚑ **Two prompts, not one.** `supabase/functions/compose-view/prompt.ts` and
  `supabase/functions/agent-chat/prompt.ts` each render the required-filter line independently
  (`:39-40` and `:63-64`). Missing one leaves the model instructed to send a filter the compiler no
  longer needs — harmless, but it will be read as a live contract by the next person.
- ⚑ **PostgREST's task/project embed is a LEFT join and will not drop the row.**
  `useMyTasks.ts:39` uses `project:projects!tasks_project_id_fkey(name)` with no `!inner`, so a
  project-less task **is returned**, with `project: null` mapping to `project_name: '—'`
  (`:60`). The bug is downstream: `MyTask.project_id` is typed `string` (`:22`), the grouping keys on
  it (`MyTasks.tsx:57-66`), and the headings and links interpolate it. Do not "fix" the query; fix the
  consumer.
- ⚑ **`DD-TASK-4`'s partial index has no query.** The ruling calls for "the partial index for the
  `project_id is null` case". No shipped or specified v1 query filters on `project_id is null`:
  `My Tasks` filters on `assignee_id` (`useMyTasks.ts:40`, served by `idx_tasks_assignee_id`,
  `0042_fk_hotpath_indexes.sql:31`, asserted at `0084_fk_hotpath_indexes.test.sql:40-48`) and
  `/tasks/:id` filters on the primary key. Build the index when a query needs it. Note also that
  `tasks_project_idx` (`0001:217`) is a plain btree and already indexes NULLs.
- ⚑ **The service-role bypasses are gated on the pin, and the pin is gated on the project.** Both
  `enforce_assignee_status_only` (`0146:74-77`) and `stamp_task_completed_at` (`0146:122-125`) take
  their service-role escape **only when the project is externally owned**. That coupling is
  deliberate and must survive the rewrite — a bypass that fires on `service_role` alone would let any
  service-role writer set `completed_at` on a PMO-owned task.
- ⚑ **`mintMirror` already refuses a project-less task** (`clickupMirrorDeps.ts:100`:
  `if (!projectId) throw …`). So no ClickUp mirror row can be project-less today, and FR-FCT-020's
  failure is latent, not live. It becomes live the moment any service-role writer — a meeting sync,
  an importer, a backfill — writes a project-less task. Do not downgrade it on the grounds that it
  cannot happen yet; that is precisely the window.
- ⚑ **A milestone is not checked against its task's project today.** There is no
  same-project trigger for `milestone_id` (only `check_tasks_parent_same_project` for
  `parent_task_id`, `0140:54-68`). That is a pre-existing gap and out of scope — but FR-FCT-004 must
  not be written as if it were closing it. The CHECK is `milestone_id is null or project_id is not
  null`, nothing more.
- ⚑ **`AC-TASK-105` will need re-reading.** `supabase/tests/0052_task_engineer_status.test.sql`
  asserts "an Engineer CANNOT INSERT a task" and "CANNOT DELETE a task (→ 0-row no-op)". Those remain
  true, but the file's header describes the policies as they were at `0016`/`0002`. Update the header
  in the same commit, deliberately, with the reasoning — do not leave a comment block describing a
  policy that no longer exists.
- ⚑ **`archived_at` and `tombstoned_at` are different things.** `archived_at` is the PMO soft-archive
  (`0140:39`, ADR-0018); `tombstoned_at` marks an upstream delete (`0093:163`) and is filtered out of
  every read (`db/tasks.ts:98,120` · `useMyTasks.ts:41` · `actions.ts:145-150`). A project-less task
  can be archived; it should never be tombstoned, since nothing upstream owns it.

## 7. What #462 gets wrong (the code wins)

Recorded in full because each was stated confidently and each changes the work.

**(a) `My Tasks` already exists.** `DD-TASK-4` reasons from "today the only task query filters by
project", and offers "an assignee-scoped list" as new work that "reaches project-less tasks for free".
The page shipped: `pmo-portal/pages/MyTasks.tsx`, routed at `pmo-portal/App.tsx:137`, backed by
`useMyTasks` (`src/hooks/useMyTasks.ts:36-80`), which is a cross-project assignee-scoped read. It does
**not** reach project-less tasks for free — the row is returned (LEFT join, §6) but the page groups
and links by a project id it assumes is present. The work is a **modification with a
regression risk**, not a green-field addition. `/tasks/:id`, by contrast, genuinely does not exist and
the code says so (`MyTasks.tsx:137-139`).

**(b) The lint-hardening test will not go red on a policy edit.** `DD-TASK-2` says "the existing
lint-hardening test asserts a policy's exact qualifier text and **will** go red the moment that policy
is edited. That is a feature: it forces a human to look." `0058_lint_hardening.test.sql:117-125` and
`:208-214` assert a `like '%( SELECT auth.uid()%'` pattern and a regexp-count equality — not exact
text. A rewritten `tasks_update_own_status` that keeps `auth.uid()` wrapped stays green. **The
forcing function #462 relies on does not exist**, so the human look has to be scheduled rather than
assumed: this spec's §5 step 3 (the neighbour mutation battery) is where it happens.

**(c) The prescribed root-cause fix would regress `0146` and lock meeting tasks out.** `DD-TASK-2` §3
says the four trigger failures "share a single cause: external-ownership is resolved **via the task's
project** rather than the task's own org", and prescribes resolving it via the org instead. Resolving
via the project is not an accident — it is what `0146_project_task_ownership.sql` was written to do
(FR-IEM-010..013), deliberately replacing the org-level `domain_externally_owned(new.org_id,'tasks')`
of `0093:100-105`/`0140:78-81`. Reverting to org-level would mean that in any org whose `tasks` domain
is ClickUp-owned, **every project-less task becomes read-only to every user** (pinned by
`0146:78-97`) and writable only by a service-role mirror that will never write it — meeting action
items would be uneditable in exactly the orgs most likely to have them.

The diagnosis is nonetheless right: one cause, three call sites, and the NULL answer arrives by
accident. The correct single fix is the *declared* version of the current behaviour — one task-level
ownership resolution whose contract states "a task with no project is never externally owned", used by
every call site (`0146:50,61,65,67,75,78,123`) and pinned by AC-FCT-011's two-directional oracle — not
a reversion to the org-level predicate. FR-FCT-014/023 are written to that.

**Two smaller corrections.** `DD-TASK-3` asks for "a hard row cap plus explicit ordering"; the cap
already exists on both paths (`executor.ts:137`, `actions.ts:142`) and only the ordering is missing
(FR-FCT-032). And `DD-TASK-3` describes `OD-2`'s "real purpose" as boundedness — ADR-0037's recorded
rationale is narrower and more favourable to the repeal: it existed to avoid adding a
`task.listAll()` DAL method, and the ADR itself states that an org-wide task list "is fine from a
security standpoint" (`docs/adr/0037-view-composition-compiler-dsl.md:20-37`). Since the view path
never calls the DAL method at all (§6), `OD-2`'s original reason is already moot.

**Confirmed as stated:** the read path is unaffected (`tasks_select`, `0002_rls.sql:91`, is org-only;
`task_dependencies_write`, `0002_rls.sql:102-108`, guards on `t.org_id` at both endpoints);
`timesheet_entries.project_id` is `not null` (`0001_init_schema.sql:197`); the four write policies do
disagree, with three denying and one passing; `stamp_task_completed_at` does silently overwrite a
mirror-supplied `completed_at`; and `check_tasks_parent_same_project` does go vacuous.

## 8. ✅ Resolved (owner grill 2026-08-21, from #527)

**Both questions below were open when this spec was written. Both are now settled and neither changes
the shipped migration (`0199`).** Kept in place rather than deleted, because the *reasoning* is what a
future agent needs — the answers alone would invite re-litigation.

### 8.1 Project hard-delete keeps `on delete cascade` — `DD-TASK-6`

**Ruled: keep cascade.** FR-FCT-002 stands unchanged; `0199` did not touch the FK.

⚑ **State the honest strength of this.** Verified while re-checking the batch: **nothing in the schema
references `tasks` except `tasks.parent_task_id` itself** (`0140:38`, `on delete cascade`). No
timesheet, no dependency table, no mirror row FKs a task. So *both* options work cleanly — `on delete
set null` would not dangle anything either. **This is a preference, not a forced move**, and the
preference is that a project-less task should mean "never had a project", never "outlived one":
otherwise deleting a project quietly converts its work into unattributed items in `My Tasks` that
nobody is watching.

Project hard-delete is reachable but **Admin-only and restrictive** (`0052_project_delete_admin_only.sql:27-30`),
and projects are soft-archived in normal use (ADR-0018). So the path this rules on is rare by design.

### 8.2 Two project-less tasks MAY be parent and child — `DD-TASK-7` retracted

**Ruled: allow. FR-FCT-022's statement stands and `0199`'s behaviour is correct.**

⛔ **This spec contradicted itself, and the contradiction is why a bad ruling nearly shipped.**
FR-FCT-022 (§3) states plainly that *"a project-less task may parent any other project-less task in
the org"*; §8.2 as originally written said the spec *"defaults to **forbid**"*. The migration followed
FR-FCT-022. A grill session read the §8 default, took it as the spec's position, and recorded
`DD-TASK-7` ("forbid") — then filed a build ticket against `0199` for not implementing a rule the same
document had already stated the other way.

**The owner rejected it on the right grounds:** *"spec is written by LLM so can be inherent assumption
without basis... unless you can specify why its an issue."* Checked, and nothing breaks:

- **The invariant is satisfied, not evaded.** Two project-less tasks *are* in the same non-project;
  `null is distinct from null` → false is the correct reading of "parent must be in the same project".
- **No visibility widening.** `tasks_select` (`0199:126-127`) admits `project_id is null` **or** any
  project in the caller's org — org-wide either way, so nesting changes nothing.
- **No computed figure moves.** Since `0141:43,77`, any task with a parent is excluded from milestone
  counts, `delivery_pct`, S-curve and Gantt. A project-less subtask was already invisible to every
  rollup.
- **No dangling rows.** `parent_task_id` is `on delete cascade` (`0140:38`).

⚑ **The rule this leaves behind, binding on anyone reading this spec: a spec default is not evidence.**
Neither the §8 default nor `0199`'s header cited a consequence, and their agreement with each other is
not a second source. Before turning a stated default into a ruling, answer *what actually breaks*.

### 8.3 Children follow their parent between projects — `OD-TASK-2` (new)

Raised by the owner while resolving §8.2: *"when parent task gets transferred, from a 'default' project
to 'actual' project, children task should also transfer right?"* **Yes.**

**A subtask has no independent project identity** — it exists only in relation to its parent — and
blocking the move instead would fail the ordinary "file this `My Tasks` item into a project" workflow
for a reason the user cannot act on. So the project change **cascades down the subtree**.

⚑ **This is not implemented, and the gap is pre-existing, not introduced by `0199`.**
`check_tasks_parent_same_project` is `before insert or update ... for each row` bound to the row
*carrying* `parent_task_id` (`0140:66`, body replaced at `0199:251`) — it fires on the child, never on
the parent. Moving a parent from project A to project B therefore leaves its children in A, silently,
and has done since `0140`. Tracked as [#550](https://github.com/ariefsaid/PMO/issues/550).

### 8.4 An Engineer may create and edit tasks — `DD-TASK-8`

Surfaced while re-checking this batch: `tasks_insert` (`0199:116-121`) requires
`auth_role() in ('Admin','Executive','Project Manager','Finance')` and **`Engineer` is not in it**,
which collides with `OD-MTG-1` (every role, Engineer included, may minute meetings) the moment a
meeting's `/action` creates a task.

⛔ **The restriction had no decision behind it.** Traced: `0002_rls.sql:93-97` (the original
bootstrap's `FOR ALL` `tasks_write`) → `0093:69` split it per-command and **carried the list verbatim**
→ `0146:42` *"re-created, never edited in 0093"* → `0199:116` copied it again. No `OD-`/`DD-` ever
justified it, and every recorded `Engineer` ruling is about something else — including `OD-W5-C3-A`,
which sets the **Engineer default tab to Tasks**.

**Ruled (`DD-TASK-8`): widen it.** The one substantive objection is that a top-level, unarchived task
carrying a `milestone_id` moves `delivery_pct`, milestone counts, the S-curve and Gantt (`0141:43,77`,
`0145:43,78`) — the PM's number. It fails: **if the delivery percentage only counts tasks that
privileged roles typed, it measures administrative attention rather than delivery.** Attribution and
visibility are the right controls, not a write ban.

**Scope — not a role-list edit:**

- **FR-FCT-040** — *Ubiquitous.* `tasks` shall carry **`created_by uuid references profiles(id)`**,
  stamped by a `BEFORE INSERT` trigger from `auth.uid()` and **never accepted from the client** (the
  `org_id` stamp's shape). ⛔ Without it, "a task you created" is inexpressible — the table has only
  `assignee_id`, so an Engineer creating a task assigned to someone else loses write access on save.
- **FR-FCT-041** — *Ubiquitous.* `tasks_insert` shall admit `Engineer`; the org, active-member,
  parent-org and external-ownership guards are unchanged.
- **FR-FCT-042** — *Ubiquitous.* `tasks_update` shall admit `created_by = auth.uid() or assignee_id =
  auth.uid()`. Insert and update widen **together** — a user who can create a task but not rename it is
  incoherent.
- **FR-FCT-043** — *Ubiquitous.* `policy.ts`'s `task.create` / `task.edit` (`:90,185`) shall widen to
  match, or the affordance stays invisible to the role the ruling exists for. Delete stays with the
  existing roles (destructive, ADR-0019).

⚑ **Test note — mutation-check the attribution, not the allow.** A fixture where the Engineer is both
creator and assignee **cannot distinguish `created_by` from `assignee_id`** and will pass against a
policy that checks neither correctly. Required: an Engineer-created task assigned to *someone else*
(writable), an Engineer-assigned task created by *someone else* (writable), and one that is neither
(refused) — then break each disjunct and confirm the matching case reddens. Also assert a
client-supplied `created_by` is overwritten by the trigger rather than accepted.

Tracked as [#551](https://github.com/ariefsaid/PMO/issues/551).

### 8.5 Correction to #527 item 8's premise

#527 stated that while ClickUp owns the domain `tasks_insert` *"denies INSERT outright"*, so a
meeting's `/action` could not create a task at all. **Overstated.**
`task_domain_externally_owned(NULL)` returns `false` by construction (`0199:77-78`), so a
**project-less** task is insertable regardless of external ownership. The denial binds only on tasks
that carry a project.

The outcome is unchanged — `OD-TASK-1` rules that PMO owns tasks at RIS and ClickUp is not in play —
but the reasoning recorded on the ticket was wrong and should not be reused.
