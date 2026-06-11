# Spec: Delivery milestones — spine 3 MVP

First build of the Delivery backbone (spine 3). Adds a two-level delivery hierarchy
(milestone → tasks) to the existing project-detail page, with a two-column % progress model
and a weight-weighted project delivery-% rollup. All structural decisions are locked in
**OD-DEL-1..8** (`docs/decisions.md`); this spec formalises them into requirements and
acceptance criteria.

- **Grounds:** `docs/decisions.md` OD-DEL-1..8; ADR-0010 (test pyramid); ADR-0016 (`can()`
  UX-only); ADR-0017 (repository seam); ADR-0018 (soft-archive); ADR-0019 (server-enforced
  writes via RPC); ADR-0021 (canonical `/projects/:id` at every lifecycle stage).
- **Schema — new:** `project_milestones` table + nullable `tasks.milestone_id` FK column
  (migration `0023`). `projects` gains no new column; delivery % is derived at read time.
- **RLS — new policies on `project_milestones`** (standard org-read + PM+Admin write gate,
  same shape as `tasks_write` / `budget_versions_write` in `0002_rls.sql`).

---

## AS-IS (what exists today)

- `tasks(id, org_id, project_id, name, start_date, end_date, assignee_id, status, created_at)`
  with `tasks_project_idx` and a two-policy RLS stack:
  `tasks_write` (Admin/Exec/PM/Finance full CRUD) +
  `tasks_update_own_status` (Engineer assignee, status-only, column-pinned by trigger — migration
  `0016`).
- No `project_milestones` table exists. No `milestone_id` on tasks.
- The `/projects/:id` Tasks tab (`pages/project-detail/`) lists tasks flat without grouping.
- The Projects list (`pages/Projects.tsx`) and PM Dashboard show no delivery-% chip.
- Delivery % is conceptually absent — nothing today tracks or surfaces it.

---

## Scope

### IN

1. **`project_milestones` table** — `id`, `org_id`, `project_id`, `name`, `sort_order` (integer,
   controls display order), `target_date` (nullable date), `weight` (numeric default `1`,
   controls rollup weight), `input_pct` (nullable numeric 0–100, the PM-typed figure),
   `archived_at` (nullable timestamptz — soft-archive per ADR-0018). No status enum; a milestone
   has no lifecycle of its own in MVP (OD-DEL-6).
2. **`tasks.milestone_id` FK** — nullable UUID references `project_milestones(id)` on delete set
   null. A task without a `milestone_id` is ungrouped (OD-DEL-3).
3. **Calculated % derivation** — read-time computed: `count(*) filter (where status='Done') *
   100.0 / nullif(count(*), 0)` over the milestone's tasks. Null when the milestone has no tasks.
   See design note §DN-1.
4. **Effective % rule** (OD-DEL-4) — `coalesce(input_pct, calculated_pct, 0)`.
5. **Project delivery %** (OD-DEL-5) — `sum(weight × effective_pct) / sum(weight)`. Null / absent
   when the project has no milestones.
6. **`/projects/:id` — milestone strip** in the header area (below the stage banner, above the
   tabs): ordered list of milestones with name, target date, effective-% progress bar, and
   two-column % display (calculated + input side by side). Available at every project lifecycle
   stage (ADR-0021; a pre-win deal can be planned).
7. **`/projects/:id` — Tasks tab grouping** — tasks grouped under their milestone heading;
   ungrouped tasks collected under an "Ungrouped" section. Milestone headers show the milestone
   name, target date, and effective %. Adding a task from within a milestone group pre-populates
   `milestone_id`.
8. **Milestone CRUD** — PM + Admin may create / edit / delete milestones (name, sort order, target
   date, weight, input %). Delete: if any tasks reference the milestone, their `milestone_id` is
   set null (FK on delete set null) rather than cascading deletion.
9. **Two-column % display** — the milestone strip and Tasks-tab headers render both
   `calculated_pct` (labelled "From tasks", greyed when null/empty) and `input_pct` (labelled
   "PM input", editable inline by PM/Admin). Blanking the input field clears it, restoring the
   calculated value as authority.
10. **Delivery-% chip** on the Projects list row and PM Dashboard: shows the project delivery %
    as a compact percentage pill (empty/hidden when the project has no milestones).
11. **Authorization** — all milestone writes gated by `can('write', 'milestone')` (UX) + RLS
    (authority) to PM + Admin. Engineers affect calculated % only through task-status updates
    (existing migration-0016 RLS — no change). Finance and Executive are read-only on milestones.

### OUT (explicit non-goals)

- **Stage-gates** — milestones are ordered + dated but nothing blocks progression (OD-DEL-6).
  Revisit with the progress-billing track.
- **Gantt / schedule view** — the phase strip is a simple ordered list; no timeline/bar-chart
  visualisation. A Gantt requires `task_dependencies` + baseline dates — deferred.
- **Org-level milestone templates** — no template table; milestones are free-form per project
  (OD-DEL-2). The org-template seam (a `pipeline_stage_config`-pattern pre-fill) is noted but
  not built.
- **Budget-value-weighted rollup** — `weight` defaults to equal (1) per milestone; the budget-
  allocation-weighted variant is deferred to the cost-code track (OD-DEL-5).
- **Deeper WBS nesting** — no `parent_id`, no sub-milestones, no sub-tasks beyond the two-level
  hierarchy (OD-DEL-3). Additive later if a real customer needs it.
- **Exec portfolio phase-distribution** — no org-wide "how many projects are in Engineering /
  Construction" chart. That needs org-level milestone names — deferred with org templates.
- **Demo-seed enrichment** — adding milestone data to the existing `seed.sql` demo projects is
  a follow-up (noted, not built here; not required to pass any AC below).
- **Gantt dependency visualisation** — `task_dependencies` already exists; consuming it
  graphically is deferred.

---

## Functional requirements (EARS)

### Schema / data model

**FR-DEL-001** — The system shall persist project milestones in a `project_milestones` table
with columns `id` (uuid PK), `org_id` (uuid FK → organizations, server-defaulted),
`project_id` (uuid FK → projects on delete cascade), `name` (text not null), `sort_order`
(integer not null default 0), `target_date` (date, nullable), `weight` (numeric not null
default 1 check ≥ 0), `input_pct` (numeric, nullable, check 0 ≤ value ≤ 100), `archived_at`
(timestamptz, nullable), `created_at` (timestamptz default now()).

**FR-DEL-002** — The system shall add a nullable `milestone_id` column (uuid, FK →
`project_milestones(id)` on delete set null) to the existing `tasks` table.

**FR-DEL-003** — The system shall stamp `org_id` on every `project_milestones` row from the
server-side column default and re-check it via RLS `with check`; no client-supplied `org_id`
shall be accepted.

### Progress derivation

**FR-DEL-004** — When the system derives a milestone's **calculated %**, it shall compute
`count(*) filter (where t.status = 'Done') * 100.0 / nullif(count(*), 0)` over the tasks
whose `milestone_id` matches the milestone. When the milestone has no tasks the calculated %
shall be null (not zero).

**FR-DEL-005** — When the system derives a milestone's **effective %**, it shall return the
first non-null value of: `input_pct`, then `calculated_pct`, then `0`.

**FR-DEL-006** — When the system derives a project's **delivery %**, it shall compute
`sum(m.weight * effective_pct(m)) / sum(m.weight)` over the project's non-archived milestones.
When a project has no non-archived milestones, the system shall return null (no chip rendered).

**FR-DEL-007** — The system shall derive calculated %, effective %, and project delivery % at
**read time** (SQL or DAL computation); no stored trigger shall maintain these values.

### Milestone CRUD

**FR-DEL-008** — When an authorized user creates a milestone, the system shall insert it with
the supplied `name`, `sort_order`, optional `target_date`, `weight` defaulting to 1, and
`input_pct` null.

**FR-DEL-009** — While a milestone exists and is not archived, when an authorized user edits
it, the system shall update any combination of `name`, `sort_order`, `target_date`, `weight`,
and `input_pct` (including setting `input_pct` to null to clear it).

**FR-DEL-010** — When an authorized user deletes a milestone, the system shall soft-archive it
(`archived_at = now()`) rather than hard-deleting (ADR-0018). Tasks referencing the milestone
shall have their `milestone_id` set to null via the FK `on delete set null` cascade, so they
become ungrouped. (The FK `on delete set null` fires on a hard delete; soft-archive does not
trigger the FK — the DAL/RPC must explicitly null out `milestone_id` on tasks before setting
`archived_at`, or the spec owner elects a hard delete for milestones only; see OPEN-QUESTION-1.)

**FR-DEL-011** — When a task's `milestone_id` is set to a milestone in the same project and
org, the system shall accept the assignment. When the supplied milestone belongs to a different
project or org, the system shall reject the write (FK + org check).

### Display — milestone strip

**FR-DEL-012** — While viewing any project detail page (`/projects/:id`), the system shall
render a milestone strip in the header area containing, for each non-archived milestone in
`sort_order` order: the milestone name, the target date (if set), a progress bar reflecting the
effective %, and a two-column % display showing `calculated_pct` (labelled "From tasks",
rendered as "—" when null) and `input_pct` (labelled "PM input", rendered as "—" when null,
editable inline by PM/Admin).

**FR-DEL-013** — When a project has no milestones, the system shall render a contextual
empty-state prompt in the header area (visible only to PM/Admin: "Add a milestone to track
delivery progress"; hidden to other roles).

### Display — Tasks tab grouping

**FR-DEL-014** — While viewing the Tasks tab of a project detail page, the system shall group
tasks under their milestone's heading (in `sort_order` order) and collect tasks whose
`milestone_id` is null under a trailing "Ungrouped" section.

**FR-DEL-015** — While viewing the Tasks tab, each milestone heading shall display the
milestone name, target date, and effective %.

**FR-DEL-016** — When an authorized user adds a task from within a milestone group on the Tasks
tab, the system shall pre-populate the new task's `milestone_id` with that milestone's id.

### Display — Projects list + PM dashboard

**FR-DEL-017** — While displaying a project row on the Projects list or PM Dashboard, the
system shall render a delivery-% chip showing the project's delivery % when at least one
non-archived milestone exists; the chip shall be absent when delivery % is null.

### Authorization

**FR-DEL-018** — The system shall permit `project_milestones` **reads** to any authenticated
user in the same org (`org_id = auth_org_id()`).

**FR-DEL-019** — The system shall restrict `project_milestones` **writes** (create, edit,
archive) to roles `Admin` and `Project Manager`. Engineers, Finance, and Executive shall have
no write path on `project_milestones` (RLS `with check` is the authority; `can()` is UX-only
per ADR-0016).

**FR-DEL-020** — While viewing the milestone strip or Tasks-tab milestone headers, the system
shall hide the inline input-% edit affordance from roles other than PM and Admin (UX-only; the
server enforces the same gate via FR-DEL-019).

**FR-DEL-021** — The system shall gate all milestone create/edit/delete affordances in the UI
with `can('write', 'milestone')`, returning false for Engineer, Finance, and Executive (UX-only
per ADR-0016).

---

## Non-functional requirements

**NFR-DEL-PERF-001** — The milestone strip on `/projects/:id` shall load in ≤200 ms p95 on
local Supabase; the delivery-% chips on the Projects list shall be derived in the same list
query (no second round-trip per row).

**NFR-DEL-DATA-001** — `tasks.milestone_id` is nullable; existing tasks remain unaffected by
the migration — no task gains a `milestone_id` from the migration.

**NFR-DEL-UI-001** — The milestone strip and Tasks-tab grouped headers shall render distinct
**loading**, **empty** (no milestones), and **error + retry** states.

**NFR-DEL-SEAM-001** — The `project_milestones` table shall carry an `org_id` column
(server-defaulted, RLS-enforced) so the schema is compatible with a future multi-tenant push
with no migration required (the `org_id` seam, per CLAUDE.md).

---

## Design note (DN-1) — calculated % storage vs read-time

The spec mandates **read-time SQL derivation** (FR-DEL-007). Two alternative shapes for the
planner to evaluate:

| Shape | Approach | Trade-off |
|---|---|---|
| **A — Inline join** | `milestones` query left-joins `tasks` and aggregates `Done/total` in the same SELECT | Simple, no extra table. Works if milestones are always fetched with their tasks. Risk: a list of milestones with many tasks makes a wide aggregate join. |
| **B — Aggregation RPC** | A security-invoker read RPC `get_project_milestones(p_project_id)` returns milestones + calculated %, effective %, and project delivery % in one call | Cleanest DAL shape; aligns with OD-ARCH-1 (RPC for server-side aggregation). Adds DB coupling but consistent with `get_executive_dashboard` / `get_project_budget` patterns. |

**Recommendation for the planner:** prefer shape B — the aggregation is non-trivial (requires
the effective-% coalesce + the weighted rollup), is owned 100% by the server, and reuses the
established `get_*` security-invoker pattern. Shape A is fine for a lean first iteration if
the planner prefers to avoid a new RPC.

This is a **design decision for the planner** (eng-planner), not an open business question —
either shape satisfies all FRs above.

---

## Worked rollup example (oracle for pgTAP)

Project with 3 milestones:

| Milestone | weight | tasks Done | tasks total | calculated % | input % | effective % |
|---|---|---|---|---|---|---|
| Engineering design | 20 | 5 | 5 | 100 | — (null) | 100 |
| Procurement | 30 | 2 | 5 | 40 | — (null) | 40 |
| Construction | 50 | 0 | 4 | 0 | — (null) | 0 |

Project delivery %:

```
= (20×100 + 30×40 + 50×0) / (20+30+50)
= (2000 + 1200 + 0) / 100
= 3200 / 100
= 32%
```

---

## Acceptance criteria (Given/When/Then)

Each AC names its id as the leading token (traceability) and is annotated with its **owning
layer (ADR-0010)**. Each AC is owned by exactly one layer; a second layer reference means it
_references_ the AC but does not own the proof.

---

### AC-DEL-001 *(Unit)* — Calculated % is Done/total over the milestone's tasks
Given a milestone with 5 tasks (3 Done, 2 To Do),
When the DAL derives the calculated %,
Then it returns 60.

*(FR-DEL-004)*

---

### AC-DEL-002 *(Unit)* — Calculated % is null when a milestone has no tasks
Given a milestone with no tasks,
When the DAL derives the calculated %,
Then it returns null (not 0).

*(FR-DEL-004)*

---

### AC-DEL-003 *(Unit)* — Effective % = input when input is set
Given a milestone with calculated % = 40 and input % = 75,
When the DAL derives the effective %,
Then it returns 75.

*(FR-DEL-005)*

---

### AC-DEL-004 *(Unit)* — Effective % falls back to calculated when input is null
Given a milestone with calculated % = 40 and input % = null,
When the DAL derives the effective %,
Then it returns 40.

*(FR-DEL-005)*

---

### AC-DEL-005 *(Unit)* — Effective % falls back to 0 when both calculated and input are null
Given a milestone with no tasks and input % = null (so calculated % = null),
When the DAL derives the effective %,
Then it returns 0.

*(FR-DEL-005)*

---

### AC-DEL-006 *(Unit)* — Project delivery % — worked-example oracle (32%)
Given a project with 3 milestones: weights 20/30/50, effective % 100/40/0 (Engineering Done,
Procurement 40% done, Construction not started),
When the DAL derives the project delivery %,
Then it returns 32.

*(FR-DEL-006)*

---

### AC-DEL-007 *(Unit)* — Project delivery % is null when a project has no milestones
Given a project with no milestones,
When the DAL derives the project delivery %,
Then it returns null (no chip rendered).

*(FR-DEL-006)*

---

### AC-DEL-008 *(Unit)* — Two-column display: calculated and input rendered side by side
Given a milestone with calculated % = 60 and input % = 75,
When the milestone strip component renders the milestone,
Then it shows a "From tasks" cell reading "60%" and a "PM input" cell reading "75%".

*(FR-DEL-012)*

---

### AC-DEL-009 *(Unit)* — Null calculated % renders "—" in the "From tasks" cell
Given a milestone with no tasks (calculated % = null) and input % = null,
When the milestone strip component renders the milestone,
Then the "From tasks" cell displays "—" and the "PM input" cell displays "—".

*(FR-DEL-012)*

---

### AC-DEL-010 *(Unit)* — Tasks tab groups tasks under their milestone; ungrouped tasks appear last
Given a project with milestone M1 (tasks T1, T2), milestone M2 (task T3), and task T4 with no
milestone,
When the Tasks tab renders,
Then tasks T1 and T2 appear under an M1 heading, T3 appears under an M2 heading, and T4
appears under an "Ungrouped" section after the milestone groups.

*(FR-DEL-014)*

---

### AC-DEL-011 *(Unit)* — Adding a task inside a milestone group pre-populates milestone_id
Given a PM viewing the Tasks tab and clicking "Add task" within the M1 group,
When the task-creation modal opens,
Then the milestone field is pre-populated with M1's id.

*(FR-DEL-016)*

---

### AC-DEL-012 *(Unit)* — PM/Admin see inline input-% edit; Engineer does not
Given a PM viewing the milestone strip,
When they hover/focus the "PM input" cell,
Then an editable field is shown.
Given an Engineer viewing the same strip,
When they view the "PM input" cell,
Then no editable affordance is present (read-only display only).

*(FR-DEL-020, FR-DEL-021)*

---

### AC-DEL-013 *(Unit)* — Delivery-% chip absent when project has no milestones
Given a project with no milestones,
When the Projects list row renders,
Then no delivery-% chip is shown for that row.

*(FR-DEL-017)*

---

### AC-DEL-014 *(Unit)* — Milestone strip renders loading / empty / error states
Given the milestone strip query is pending,
Then a loading skeleton (`milestone-strip-loading`) renders.
Given the query resolves with zero milestones and the viewer is a PM,
Then the empty-state prompt (`milestone-strip-empty`) renders with an "Add a milestone" CTA.
Given the query errors,
Then an error + Retry button renders and Retry re-runs the query.

*(NFR-DEL-UI-001, FR-DEL-013)*

---

### AC-DEL-015 *(pgTAP)* — RLS: reads allowed in-org for all roles; writes blocked for non-PM/Admin
Given an authenticated `Engineer` user,
When they SELECT from `project_milestones` in their org, Then rows are returned.
When they attempt to INSERT a milestone, Then it is rejected by RLS.
Given an authenticated `Finance` user,
When they attempt to UPDATE a milestone, Then it is rejected by RLS.

*(FR-DEL-018, FR-DEL-019)*

---

### AC-DEL-016 *(pgTAP)* — RLS: PM and Admin may write
Given a signed-in `Project Manager`,
When they INSERT a milestone row for a project in their org,
Then the write succeeds and the row is visible to other org members.
Given a signed-in `Admin`,
When they UPDATE a milestone's `input_pct`,
Then the write succeeds.

*(FR-DEL-019)*

---

### AC-DEL-017 *(pgTAP)* — Cross-org isolation: a user cannot read or write another org's milestones
Given org-A and org-B each with milestone data,
When an org-A PM SELECTs `project_milestones`,
Then only org-A rows are returned.
When the org-A PM attempts to INSERT a milestone with `project_id` from org-B,
Then the write is rejected (FK or RLS `with check`).

*(FR-DEL-003, FR-DEL-018)*

---

### AC-DEL-018 *(pgTAP)* — org_id is server-stamped; a client-supplied foreign org_id is rejected
Given a PM in org-A attempting to INSERT a `project_milestones` row with `org_id` set to
org-B's id,
When the insert is executed,
Then RLS `with check (org_id = auth_org_id())` rejects it.

*(FR-DEL-003)*

---

### AC-DEL-019 *(pgTAP)* — Worked-example rollup oracle: 3 milestones weights 20/30/50 → 32%
Given a project seeded with 3 milestones (weights 20/30/50) and tasks producing effective %
100/40/0 respectively (5/5 Done; 2/5 Done; 0/4 Done; all input_pct null),
When the delivery % derivation runs,
Then it returns 32 (per the worked example above).

*(FR-DEL-006, FR-DEL-007)*

---

### AC-DEL-020 *(pgTAP)* — Setting input_pct to null clears it; effective % reverts to calculated
Given a milestone with calculated % = 40 and input_pct = 75, seeded in the DB,
When a PM UPDATE sets input_pct = null,
Then a subsequent effective % derivation returns 40 (calculated).

*(FR-DEL-005, FR-DEL-009)*

---

### AC-DEL-021 *(pgTAP)* — tasks.milestone_id ON DELETE SET NULL: soft-archiving milestone nulls tasks
(See OPEN-QUESTION-1 regarding whether milestone deletion is hard or soft. This test applies to
the hard-delete path via FK; if soft-archive is chosen, a parallel test proves the DAL explicitly
nulls milestone_id before setting archived_at.)
Given milestone M1 with tasks T1 and T2,
When M1 is deleted (hard),
Then T1.milestone_id and T2.milestone_id are both null, and T1 and T2 still exist.

*(FR-DEL-010)*

---

### AC-DEL-022 *(E2E — single curated journey)* — PM creates a milestone, marks a task Done, delivery % updates
Given a signed-in PM on a project's detail page with no milestones,
When the PM adds milestone "Engineering design" (weight 1), navigates to the Tasks tab, creates
task "Detail drawings" under that milestone, and marks the task Done,
Then the milestone strip shows "Engineering design" with "From tasks" = 100% and effective % =
100%, and the Projects list row for that project shows a delivery-% chip of 100%.

*(FR-DEL-001 through FR-DEL-017, end-to-end)*

---

## Error handling

| Condition | Postgres code / signal | Classified user message |
|---|---|---|
| Milestone name blank | `23502` not-null violation | "Milestone name is required" |
| `input_pct` out of range (< 0 or > 100) | `23514` check violation | "Progress must be between 0 and 100" |
| `weight` < 0 | `23514` check violation | "Weight must be 0 or greater" |
| Cross-org milestone assignment | `42501` RLS / FK | "You don't have permission to do that" |
| Write by non-PM/non-Admin role | `42501` RLS | "You don't have permission to edit milestones" |
| Milestone referenced (deleted while a task still points to it after soft-archive) | FK 23503 | "Milestone is in use — remove task assignments first" (only relevant if soft-archive is chosen and the FK is kept; see OPEN-QUESTION-1) |

---

## Traceability (FR → AC → owning layer)

| Requirement | AC(s) | Owning layer (ADR-0010) |
|---|---|---|
| FR-DEL-001 (milestones table) | AC-DEL-015, AC-DEL-016, AC-DEL-017, AC-DEL-018 | pgTAP |
| FR-DEL-002 (tasks.milestone_id FK) | AC-DEL-021 | pgTAP |
| FR-DEL-003 (org_id server-stamped) | AC-DEL-018 | pgTAP |
| FR-DEL-004 (calculated % = Done/total) | AC-DEL-001, AC-DEL-002 | Unit |
| FR-DEL-005 (effective % rule) | AC-DEL-003, AC-DEL-004, AC-DEL-005, AC-DEL-020 | Unit (AC-DEL-020 pgTAP) |
| FR-DEL-006 (project delivery % rollup) | AC-DEL-006, AC-DEL-007, AC-DEL-019 | Unit (AC-DEL-019 pgTAP oracle) |
| FR-DEL-007 (read-time derivation, no trigger) | AC-DEL-019 | pgTAP |
| FR-DEL-008 (create milestone) | AC-DEL-016 | pgTAP |
| FR-DEL-009 (edit milestone) | AC-DEL-016, AC-DEL-020 | pgTAP |
| FR-DEL-010 (delete/archive milestone) | AC-DEL-021 | pgTAP |
| FR-DEL-011 (task milestone_id FK validation) | AC-DEL-017 | pgTAP |
| FR-DEL-012 (milestone strip two-column display) | AC-DEL-008, AC-DEL-009 | Unit |
| FR-DEL-013 (empty-state prompt for PM/Admin) | AC-DEL-014 | Unit |
| FR-DEL-014 (Tasks tab grouping) | AC-DEL-010 | Unit |
| FR-DEL-015 (Tasks tab milestone header shows %) | AC-DEL-010 | Unit |
| FR-DEL-016 (add task pre-populates milestone_id) | AC-DEL-011 | Unit |
| FR-DEL-017 (delivery-% chip on Projects list) | AC-DEL-013, AC-DEL-022 | Unit (E2E end-to-end) |
| FR-DEL-018 (read in-org, all roles) | AC-DEL-015 | pgTAP |
| FR-DEL-019 (write = PM + Admin only) | AC-DEL-015, AC-DEL-016 | pgTAP |
| FR-DEL-020 (hide input-% edit for non-PM/Admin) | AC-DEL-012 | Unit |
| FR-DEL-021 (can() UX gate) | AC-DEL-012 | Unit |
| NFR-DEL-UI-001 (loading/empty/error states) | AC-DEL-014 | Unit |
| NFR-DEL-SEAM-001 (org_id seam) | AC-DEL-018 | pgTAP |

Per-layer AC split: **Unit** AC-DEL-001..014 (14) · **pgTAP** AC-DEL-015..021 (7) · **E2E**
AC-DEL-022 (1, curated journey). Total: 22 ACs, 21 FRs.

---

## Implementation checklist (for eng-planner)

### Migration `0023`
- [ ] `create table project_milestones (...)` with all columns above + indexes
  (`project_milestones_project_idx on (project_id)`, `project_milestones_org_idx on (org_id)`)
- [ ] `alter table tasks add column milestone_id uuid references project_milestones(id) on delete set null`
- [ ] RLS policies: `project_milestones_select` (org-read, all roles),
      `project_milestones_write` (PM + Admin, INSERT/UPDATE/DELETE)
- [ ] Seed: (optional but recommended) add 2–3 milestones to one seed project so the UI
      renders non-empty in local dev; do NOT add to prod (seed.sql = local only per CLAUDE.md)

### DAL (`src/lib/db/milestones.ts`)
- [ ] `listMilestones(projectId)` — SELECT + computed calculated_pct + effective_pct (shape A)
      OR call the `get_project_milestones` RPC (shape B); returns milestones in sort_order
- [ ] `getProjectDeliveryPct(projectId)` — returns the weighted rollup (or included in the RPC)
- [ ] `createMilestone(input)`, `updateMilestone(id, patch)`, `archiveMilestone(id)` (sets
      `archived_at`; also nulls task milestone_ids — see OPEN-QUESTION-1)
- [ ] `updateTaskMilestone(taskId, milestoneId | null)` — assigns/unassigns a task

### Repository (`src/lib/repositories/index.ts`)
- [ ] Expose milestone CRUD + delivery-% through the repository seam (ADR-0017)

### Hooks
- [ ] `useMilestones(projectId)` — TanStack Query, invalidates on milestone mutate
- [ ] `useProjectDeliveryPct(projectId)` (may be co-located with `useMilestones`)
- [ ] `useListProjects` enrichment — include delivery_pct per project row (extend existing DAL
      or add a join/subquery; no second round-trip per row per NFR-DEL-PERF-001)

### UI components
- [ ] `MilestoneStrip` — header-area ordered list; loading/empty/error states; two-column %
      display; PM/Admin inline input-% edit (OD-UX-1: single-click + toast, no confirm for
      routine edits); `ConfirmDialog` on milestone delete
- [ ] `MilestoneFormModal` — create/edit form (name required, sort_order, target_date, weight,
      input_pct) using shared `EntityFormModal` / `useEntityForm` / `TextField` primitives
- [ ] Tasks tab: group tasks by `milestone_id` → milestone heading → task rows; "Ungrouped"
      trailing section; milestone heading shows effective %; "Add task" within group sets
      `milestone_id`
- [ ] Projects list row: `DeliveryPctChip` (absent when null)
- [ ] PM Dashboard: same chip

### Tests
- [ ] Unit tests (Vitest): AC-DEL-001..014 (coverage ≥80% on new milestone DAL + components)
- [ ] pgTAP (migration file `supabase/tests/0023_milestones_rls.test.sql` or similar):
      AC-DEL-015..021 (worked-example oracle + RLS + org isolation + FK cascade)
- [ ] E2E (Playwright `e2e/AC-DEL-022-milestone-journey.spec.ts`): AC-DEL-022 curated journey

---

## Open questions

**OPEN-QUESTION-1 — Soft-archive vs hard-delete for milestones**
The spec mandates soft-archive (`archived_at`) for milestones per ADR-0018. However, the FK
`on delete set null` on `tasks.milestone_id` only fires on a **hard** delete. A soft-archive
(just setting `archived_at`) does NOT trigger the FK cascade — so the DAL must explicitly
`UPDATE tasks SET milestone_id = null WHERE milestone_id = $1` before (or in the same
transaction as) setting `archived_at`. This is straightforward but requires a multi-step write
(best in an atomic RPC if ADR-0019's security-definer pattern applies, or a DAL-level
transaction).

Alternative: use **hard-delete** for milestones instead of soft-archive (ADR-0018 permits
exceptions where the entity has no value as an audit trail and has FK dependents that benefit
from cascade). The FK then handles the task-nulling automatically. The tradeoff: no "restore
milestone" path if accidental deletion is a concern.

**Recommendation for the planner:** pick hard-delete for milestones (milestones have no
financial/audit significance of their own; the FK cascade is clean; soft-archive on a new
table introduces extra query filters with no clear benefit). If the owner later wants an undo /
restore, it's additive.

**OPEN-QUESTION-2 — Delivery % in the Projects list query**
The Projects list currently fetches rows via `listProjects()` in `src/lib/db/projects.ts`.
Adding delivery % per row requires either: (a) a correlated subquery / lateral join in the
existing `listProjects` query, or (b) a second `useProjectDeliveryPct` fetch per row (N+1 —
forbidden by NFR-DEL-PERF-001), or (c) a new `get_projects_with_delivery` RPC aggregating
both project rows and their delivery %. Option (c) is clean but adds a new RPC; option (a)
keeps the existing REST path and adds a subquery. The planner decides; both satisfy the NFR.

**OPEN-QUESTION-3 — input_pct inline edit UX: field or clickable chip?**
The spec says "editable inline" but leaves the interaction unspecified. Two viable shapes:
(a) a click-to-edit number-field within the strip row (consistent with existing inline-edit
patterns on the Tasks tab), or (b) a small "Edit progress" modal. Given OD-UX-1
(routine writes = single-click + toast, no modal), shape (a) is preferred. The planner /
ui-implementer decides the exact affordance.
