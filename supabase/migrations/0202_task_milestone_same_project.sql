-- 0202_task_milestone_same_project.sql — #538: a task's milestone must be a milestone of the task's
-- OWN project. Recorded at the end of 0200 and deliberately not fixed there.
--
-- THE HARM. 0199 §1's `tasks_milestone_needs_project` says a task carrying a `milestone_id` must
-- have SOME project. Nothing said it had to be the RIGHT one. Every server-side rollup joins tasks
-- through `milestone_id` and never through `project_id` (0023:68,95 · 0026:33 · 0033:167 ·
-- 0141:42,76 · 0145:42,77), so a task sitting in project A but pointed at a milestone of project B
-- counts toward B — and B's delivery percentage moves. #532 closed the ASSIGNEE door onto this (an
-- Engineer assignee can no longer write `milestone_id` at all). A write-role user still holds it,
-- and for them it is not an authorization question: a PM legitimately holds write authority over
-- tasks. It is a missing integrity constraint, so it is fixed as one.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SURVEY FIRST — a constraint added blind simply fails to apply.
-- Local `supabase db reset` (seed.sql included), 2026-08-21:
--     tasks_total 52 · with_milestone 46 · project-less 0 · project-less-with-milestone 0
--     MISMATCHED (t.project_id is distinct from m.project_id):  0
--     org-mismatched (t.org_id is distinct from m.org_id):      0
-- So there is nothing to repair, null out, or grandfather with `not valid`. The constraint is added
-- VALID and Postgres validates it against the existing 46 rows at ADD time — which is the strongest
-- of the three options and was available only because the survey said so.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse, in order:
--   alter table public.tasks drop constraint tasks_milestone_id_fkey;
--   alter table public.tasks add constraint tasks_milestone_id_fkey
--     foreign key (milestone_id) references public.project_milestones(id) on delete set null;
--   drop index if exists public.project_milestones_project_id_id_key;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the FK target. A composite FK needs a unique constraint/index on exactly its referenced
-- columns; `project_milestones_pkey` on (id) alone will not serve (project_id, id).
--
-- It is redundant with the primary key in the information-theoretic sense — (project_id, id) cannot
-- be non-unique when id already is — and that redundancy is the point: it is what makes the pair
-- referenceable. It is also a usable index for the RLS-scoped `where project_id = …` reads that
-- `get_project_milestones` performs, so `project_milestones_project_idx` is not made dead by it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create unique index project_milestones_project_id_id_key
  on public.project_milestones (project_id, id);

comment on index public.project_milestones_project_id_id_key is
  '#538: the target of tasks_milestone_id_fkey''s composite (project_id, milestone_id) reference. '
  'Redundant with the pkey by construction — that is what makes the column PAIR referenceable.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — REPLACE the single-column FK with the composite one. Chosen over a trigger, and over ADDING
-- a second FK alongside the existing one. Both alternatives were considered and both are worse:
--
--   • A TRIGGER is exemptable and therefore weaker. `tasks` already carries a trigger-shaped
--     exemption for server authority (0200 §C, `auth.uid() is null`) that seed.sql, migrations and
--     pgTAP fixtures rely on — so a trigger written in the same house style would let exactly the
--     writers with the least review write the mismatch. The FK binds `service_role`, definer RPCs,
--     the ClickUp mirror and psql alike, with no branch anyone can widen.
--
--   • ADDING a second FK (leaving `tasks_milestone_id_fkey` in place) would create a SECOND foreign
--     key between `tasks` and `project_milestones`, and PostgREST then refuses every UNQUALIFIED
--     embed of that target — the 0177 incident that took nineteen e2e specs down. That is exactly
--     what `postgrest_embed_ambiguity_guard.test.sql` (AC-EMBED-001) pins, and it would go red.
--     Replacing keeps the pair single-FK, so the guard's known-set is untouched.
--
-- ⚑ The constraint keeps its EXISTING NAME even though it now spans two columns. The name is the
-- PostgREST embed hint (`milestone:project_milestones!tasks_milestone_id_fkey(...)`) and the key in
-- the generated `database.types.ts` Relationships block; renaming it would be a breaking change to
-- both for no gain. It is a two-column key with a one-column name, on purpose.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.tasks drop constraint tasks_milestone_id_fkey;

alter table public.tasks
  add constraint tasks_milestone_id_fkey
  foreign key (project_id, milestone_id)
  references public.project_milestones (project_id, id)
  -- ⚑ §3 (NULL semantics) and §4 (referential actions) below are the two things that decide whether
  -- this constraint enforces anything at all. Read them before changing this line.
  match simple
  on delete set null (milestone_id)
  on update no action;

comment on constraint tasks_milestone_id_fkey on public.tasks is
  '#538: a task''s milestone must belong to the task''s OWN project. Composite (project_id, '
  'milestone_id) -> project_milestones (project_id, id). MATCH SIMPLE deliberately (0202 §3) — '
  'MATCH FULL cannot be applied at all, and the vacuous case it would cover is already refused by '
  'tasks_milestone_needs_project. ON DELETE SET NULL names milestone_id ONLY (0202 §4) so a '
  'milestone delete does not take the task''s project with it.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — THE NULL SEMANTICS, which is where this constraint could have looked present and enforced
-- nothing. A composite FK with SOME columns NULL is satisfied VACUOUSLY under MATCH SIMPLE (the
-- default). Each of the three live cases was PROBED against the real schema, not reasoned about:
--
--   (1) project NULL + milestone NULL — legal since #525. MATCH SIMPLE: admitted (vacuous). ✔
--   (2) project SET  + milestone NULL — the common case, 6 of 52 seeded tasks. MATCH SIMPLE:
--       admitted (vacuous, because milestone_id is NULL). ✔
--   (3) project NULL + milestone SET  — MATCH SIMPLE: admitted VACUOUSLY BY THIS FK. It is refused
--       by 0199 §1's `tasks_milestone_needs_project` CHECK (23514), and by nothing else.
--
-- ⛔ SO THE CHECK IS LOAD-BEARING AND MUST NOT BE DROPPED as "now covered by the FK". Probed: with
-- the CHECK dropped and this FK in place, `insert … (project_id, milestone_id) values (null, <a
-- real milestone>)` returns INSERT 0 1. The CHECK and the FK cover disjoint halves of the space —
-- the CHECK owns "no project", the FK owns "wrong project" — and neither is redundant.
--
-- ⛔ AND MATCH FULL IS NOT THE FIX. MATCH FULL admits only all-NULL or all-non-NULL keys, so it
-- refuses case (2) — every task that has a project and no milestone yet, which is the ordinary
-- state of a task the moment it is created. It does not merely forbid that going forward: the ADD
-- CONSTRAINT itself FAILS against today's data, verbatim —
--     ERROR: insert or update on table "tasks" violates foreign key constraint "tasks_milestone_id_fkey"
--     DETAIL: MATCH FULL does not allow mixing of null and nonnull key values.
-- MATCH SIMPLE is therefore not a concession; it is the only match type that describes this column
-- pair, and its one hole is the one the CHECK already closed a migration earlier.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — REFERENTIAL ACTIONS, checked against what already happens rather than chosen fresh.
--
-- ON DELETE. 0023 §2 set `on delete set null` so that hard-deleting a milestone UN-GROUPS its tasks
-- rather than deleting them (Director OQ1, AC-DEL-021, proven by 0063_milestone_delete_sets_null).
-- A composite `on delete set null` with NO column list nulls EVERY column of the key — it would
-- clear `project_id` too, silently converting a project's work into #525's "project-less task"
-- bucket and dropping it out of the project entirely. PG15+'s column list is what avoids that:
-- `set null (milestone_id)` nulls the milestone and leaves the project alone, which is 0023's
-- behaviour exactly. Probed: after deleting the milestone the task survives with milestone_id NULL
-- and project_id INTACT. (Postgres requires the named columns to be a subset of the key, and the
-- resulting row then satisfies the FK vacuously per §3 — the two decisions fit together.)
--
-- ON UPDATE stays NO ACTION, which is what the single-column FK had. It is not inert any more,
-- though, and this is a real behaviour change worth naming: moving a milestone to another project
-- (`update project_milestones set project_id = …`) while any task still references it is now
-- REFUSED (23503) instead of silently producing the very mismatch this migration exists to prevent.
-- `on update cascade` was rejected — dragging tasks into a different project behind the PM's back
-- is the harm, not the remedy. Nothing in the app can hit this: `updateMilestone`
-- (src/lib/db/milestones.ts) patches only name/sort_order/target_date/weight/input_pct and never
-- project_id, so the refusal is reachable only by a deliberate SQL-level re-parent.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
