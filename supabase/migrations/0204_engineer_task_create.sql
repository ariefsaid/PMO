-- 0204_engineer_task_create.sql — an Engineer may create and edit tasks (DD-TASK-8, #551).
-- Proven by supabase/tests/0204_engineer_task_create.test.sql (AC-T8-001..021).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- `tasks_insert` admitted only Admin/Executive/Project Manager/Finance, and **no decision ever
-- justified that list** — it traces to `0002_rls.sql:93-97` and was copied forward verbatim by
-- `0093` → `0146` → `0199`. `OD-MTG-1` then ruled every role including Engineer may minute a
-- meeting, and a meeting's `/action` creates a task. Full reasoning: DD-TASK-8 in docs/decisions.md
-- (single source; not restated here — the first draft triplicated it and the copies drift).
--
-- ── ⚑ SHAPED BY A 3-LENS REVIEW THAT REFUSED THE FIRST DRAFT (2026-08-24) ───────────────────────
-- The first draft also copied the ASSIGNEE disjunct into `tasks_update`. Two reviewers proved by
-- live probe that this (a) was fully redundant with `tasks_update_own_status` (0199:140-144), whose
-- oracle stayed green with the disjunct deleted, and (b) had exactly one net effect: it LACKED the
-- `not task_domain_externally_owned(...)` conjunct the own-status policy carries, and permissive
-- policies OR — so an Engineer assignee could tombstone a ClickUp-mirrored task (hiding it from
-- every DAL read) and freeze its mirror clock. The disjunct is GONE: `tasks_update_own_status`
-- remains the single owner of the assignee rule. The creator disjunct carries the external guard
-- for the same reason. And `created_by` is now PINNED on update (§1b): it is an authorization
-- input, and the first draft left it client-writable — a creator could reassign authorship and
-- mint an edit right for an arbitrary colleague (the `0197` §4 class, again).
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
--   drop trigger if exists tasks_aa_pin_created_by on public.tasks;
--   drop function if exists public.pin_task_created_by();
--   drop trigger if exists tasks_stamp_created_by on public.tasks;
--   drop function if exists public.stamp_task_created_by();
--   drop index if exists public.tasks_created_by_idx;
--   alter table public.tasks drop column if exists created_by;
--   -- re-create tasks_insert / tasks_update from 0199 §3 (0199:116-131) verbatim, and restore
--   -- enforce_assignee_status_only from its **0200** body (0200:123-166 — NOT 0199's: 0200's
--   -- fail-closed allowlists are a security fix this rollback must not silently revert).
-- ================================================================================================

-- ── §1 — the author column, stamped server-side, never accepted from a client ───────────────────
alter table public.tasks
  add column created_by uuid references public.profiles(id) on delete set null;

-- An FK and an RLS USING/WITH CHECK predicate column; the sibling person column (assignee_id) is
-- indexed for the same two reasons.
create index tasks_created_by_idx on public.tasks (created_by);

comment on column public.tasks.created_by is
  'Who created the task. Stamped from auth.uid() on INSERT and PINNED immutable on UPDATE — it is '
  'read as an edit right by tasks_update (DD-TASK-8), so it is an authorization input, never a user '
  'field. NULL for server-authority inserts (seed, migrations, mirror writers): no caller, no author.';

create or replace function public.stamp_task_created_by()
  returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- ⚑ OVERWRITE, do not default. A default would let a client claim authorship of someone else's
  -- work, and §3 reads this column to decide who may edit (AC-T8-004/005).
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  -- No else: a server-authority caller has no human author; a fabricated one would manufacture an
  -- edit right out of nothing (AC-T8-012).
  return new;
end; $$;

create trigger tasks_stamp_created_by
  before insert on public.tasks
  for each row execute function public.stamp_task_created_by();

-- ── §1b — the UPDATE pin: created_by is immutable for EVERY actor ────────────────────────────────
-- ⚑ Unconditional on purpose, service_role included: an authz input, not a user field (the org_id
-- pin of 0190 is the precedent). ⚑ A `revoke update (created_by)` would be a SILENT NO-OP here —
-- a column revoke cannot subtract from the existing table-level UPDATE grant (2026-07-30 lesson) —
-- so it must be a trigger. Named `tasks_aa_*` to fire BEFORE `tasks_assignee_status_only`
-- (same-event triggers fire alphabetically): the pin must clean `new` before the allowlist diffs it.
create or replace function public.pin_task_created_by()
  returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.created_by := old.created_by;
  return new;
end; $$;

create trigger tasks_aa_pin_created_by
  before update on public.tasks
  for each row execute function public.pin_task_created_by();

-- ── §2 — INSERT: admit Engineer. Every other conjunct is byte-identical to 0199. ────────────────
drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance','Engineer')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
    and not public.task_domain_externally_owned(project_id));

-- ── §3 — UPDATE: the four write roles, OR the creator on a PMO-owned task ───────────────────────
-- ⚑ NO assignee disjunct — `tasks_update_own_status` (0199:140-144) owns that rule, alone, with
-- its external guard intact. ⚑ The creator disjunct carries the SAME external guard: without it a
-- creator would pass this policy on a ClickUp-mirrored task and reach the trigger's externally-owned
-- allowlist, which hands out tombstoned_at — the exact hole the review proved on the assignee path.
-- Managers keep their unguarded path: they legitimately write milestone_id on external tasks
-- (AC-CUA-021), and the trigger's external branch pins them to that allowlist.
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() in ('Admin','Executive','Project Manager','Finance')
         or (created_by = (select auth.uid())
             and not public.task_domain_externally_owned(project_id)))
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())))
  with check (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() in ('Admin','Executive','Project Manager','Finance')
         or (created_by = (select auth.uid())
             and not public.task_domain_externally_owned(project_id)))
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())));

-- ── §4 — the column pin: a creator may edit their task's WORK fields, not its lifecycle ─────────
-- Body copied verbatim from 0200 (the current definition — NOT 0199's) with exactly one branch
-- added; re-typing a live function body changes it. The creator branch is an ALLOWLIST DIFF, not a
-- `return new`: the review proved an unconditional return let a creator tombstone/archive their own
-- task (a delete in every user-visible sense while AC-T8-010 asserts delete did not widen) and
-- rewrite id/created_at/source_updated_at (repudiation + a latent mirror freeze).
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
declare
  -- Complement of 0199 §4's 13-column externally-owned deny-list (0200's §A). Behaviour-preserving.
  k_external_allowed constant text[] :=
    array['milestone_id','completed_at','tombstoned_at','source_updated_at'];
  -- The assignee's real scope (0200's §A/§B). Every other column — including every column added to
  -- `tasks` after today — is refused without anyone having to remember to add it to a list.
  k_assignee_allowed constant text[] := array['status','completed_at'];
  -- DD-TASK-8: the creator's scope — the work fields. Deliberately EXCLUDES the lifecycle and
  -- provenance columns (archived_at, tombstoned_at, source_updated_at, id, org_id, created_at,
  -- created_by, import_*): fail-closed on every future column, same polarity as the other two.
  -- project_id is here ON PURPOSE — "file this My Tasks item into a project" is the ordinary
  -- workflow (OD-TASK-2's context); moving it INTO an externally-owned project still fails at §3's
  -- external guard and at this function's external branch.
  k_creator_allowed constant text[] :=
    array['name','description','priority','status','assignee_id','milestone_id','parent_task_id',
          'project_id','start_date','end_date','completed_at','last_update'];
begin
  -- 0093's service-role mirror bypass, unchanged.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;

  if public.task_domain_externally_owned(new.project_id) then
    if to_jsonb(new) - k_external_allowed is distinct from to_jsonb(old) - k_external_allowed then
      -- Message byte-preserved from 0093/0140/0146/0199 — asserted verbatim elsewhere.
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;

  -- ⚑ DD-TASK-8, the one added branch: the creator edits WORK fields only. Without any branch here
  -- §3 is cosmetic (the policy admits the creator, this trigger then pins them to status — create-
  -- without-rename); with an unconditional return it over-grants (see header). `old.created_by` is
  -- the right side to read, and it is pinned immutable by §1b, so it cannot be claimed.
  if old.created_by is not null and old.created_by = (select auth.uid()) then
    if to_jsonb(new) - k_creator_allowed is distinct from to_jsonb(old) - k_creator_allowed then
      raise exception 'creator may edit task fields, not lifecycle or provenance columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Server authority: no authenticated portal caller, so there is no assignee to pin (0200's §C —
  -- what lets seed.sql, migrations and pgTAP fixtures write native fields).
  if auth.uid() is null then
    return new;
  end if;

  if to_jsonb(new) - k_assignee_allowed is distinct from to_jsonb(old) - k_assignee_allowed then
    -- Message byte-preserved from 0016 onward — first_class_tasks.test.sql matches it verbatim.
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

comment on function public.enforce_assignee_status_only() is
  'Column pin for non-service-role task UPDATEs. Externally-owned: everyone is pinned to '
  '{milestone_id, completed_at, tombstoned_at, source_updated_at}. PMO-owned: write roles pass; the '
  'CREATOR may change work fields (DD-TASK-8, 0204); the assignee may change {status, completed_at}; '
  'server authority (no auth.uid()) passes. created_by itself is pinned immutable by '
  'tasks_aa_pin_created_by, which fires first.';
