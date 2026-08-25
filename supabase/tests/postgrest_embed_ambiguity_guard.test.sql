-- PostgREST embed-ambiguity guard.
--
-- WHY THIS EXISTS. On 2026-07-29, migration 0177 added `projects.contract_value_set_by ->
-- profiles(id)` — the money-SoD witness. `projects` already had `project_manager_id -> profiles`,
-- so that made TWO foreign keys between the same pair of tables. PostgREST refuses an
-- unqualified embed when more than one relationship could satisfy it, so every query written as
-- `pm:profiles(full_name)` started returning an ERROR rather than rows.
--
-- The blast radius was not the project list. It was NINETEEN e2e specs — projects, tasks,
-- timesheets, documents, kanban, calendar, the command palette, the pipeline — because they all
-- land on a screen that lists or resolves a project. Two call sites were unqualified
-- (src/lib/db/projects.ts and src/lib/db/opportunity.ts, the second being the pre-win fallback,
-- which is why fixing only the first left half the suite red).
--
-- ⚑ ADDING A FOREIGN KEY IS A BREAKING CHANGE TO EVERY UNQUALIFIED EMBED OF ITS TARGET, and
-- NOTHING BELOW e2e CAN CATCH IT: unit tests mock the Supabase client so the embed string is
-- never resolved against a real schema, and pgTAP tests SQL rather than PostgREST. e2e does not
-- run on PR->dev. So the defect reached dev, and CI burned an hour on two runs that both hit the
-- 30-minute cap and killed Playwright before it printed a diagnosis.
--
-- WHAT THIS GUARD DOES. It pins the exact set of table pairs that have more than one FK between
-- them. Add an FK that creates a NEW ambiguous pair and this test fails — forcing whoever adds it
-- to come here, read this note, and check every embed of that target before updating the list.
-- It cannot assert the TypeScript is qualified (pgTAP cannot see it); it asserts the schema
-- condition that MAKES qualification mandatory, at the moment that condition is introduced.

begin;
select plan(2);

-- The known-ambiguous set. Every pair here REQUIRES `alias:target!constraint_name(cols)` in any
-- PostgREST embed. Verified qualified in the DAL as of 2026-07-29.
select set_eq(
  $$ select src.relname::text || ' -> ' || tgt.relname::text
       from pg_constraint c
       join pg_class src on src.oid = c.conrelid
       join pg_class tgt on tgt.oid = c.confrelid
       join pg_namespace n on n.oid = src.relnamespace
      where c.contype = 'f' and n.nspname = 'public'
      group by src.relname, tgt.relname
     having count(*) > 1 $$,
  $$ values ('credits -> profiles'),
            ('erp_employees -> profiles'),
            ('platform_operators -> profiles'),
            ('procurements -> profiles'),
            ('projects -> profiles'),
            ('task_dependencies -> tasks'),
            -- 0204 (#551, DD-TASK-8): tasks gained `created_by` alongside `assignee_id`, so this
            -- pair is new. ⚑ CHECKED BEFORE ADDING, as this assertion's own message demands: the
            -- only embed of profiles from tasks is `src/lib/db/tasks.ts:77`, and it is ALREADY
            -- qualified — `assignee:profiles!tasks_assignee_id_fkey(id, full_name)`. The other
            -- tasks selects (`useMyTasks.ts:41`, `milestones.ts:230`, the ClickUp dispatch factory)
            -- embed no profile at all. So nothing broke; the pair is recorded, not waived.
            ('tasks -> profiles'),
            -- 0205 (#526): meeting_access_grants carries user_id AND granted_by, both -> profiles.
            -- The DAL shipped in the same branch and every profiles embed in it is
            -- constraint-qualified (src/lib/db/meetings.ts — `!meeting_access_grants_user_id_fkey`
            -- and `!meeting_access_grants_granted_by_fkey`; verified by the 526 spec review). Any
            -- NEW embed of profiles from this table must be qualified the same way.
            ('meeting_access_grants -> profiles'),
            ('timesheets -> profiles'),
            -- 0193 (#498): work_orders carries THREE person columns — order_value_set_by (the SoD
            -- witness), issued_by, and over_commit_ack_by. Checked before adding: nothing in the DAL
            -- embeds profiles from work_orders (the table has no client code yet), so there is no
            -- unqualified embed to break. Whatever ships first MUST use
            -- `alias:profiles!work_orders_<column>_fkey(...)`.
            ('work_orders -> profiles') $$,
  'AC-EMBED-001 the set of multi-FK table pairs is EXACTLY the known set — a new pair here means '
  'every unqualified PostgREST embed of that target is now a runtime error (0177 shipped one, and '
  'it took 19 e2e specs down). Before updating this list: grep the DAL for embeds of the target '
  'and qualify them with !constraint_name.'
);

-- The specific pair that caused the incident, asserted by name so the regression is explicit and
-- so `grep projects_contract_value_set_by_fkey` lands on this explanation.
select set_eq(
  $$ select conname::text from pg_constraint
      where conrelid = 'public.projects'::regclass
        and confrelid = 'public.profiles'::regclass
        and contype = 'f' $$,
  $$ values ('projects_contract_value_set_by_fkey'), ('projects_project_manager_id_fkey') $$,
  'AC-EMBED-002 projects has exactly TWO FKs to profiles — so src/lib/db/projects.ts and '
  'src/lib/db/opportunity.ts MUST both embed profiles as '
  '!projects_project_manager_id_fkey. Dropping one of these FKs would make the qualification '
  'unnecessary but not wrong; adding a third demands another review of both call sites.'
);

select * from finish();
rollback;
