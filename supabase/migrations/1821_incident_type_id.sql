-- 1821_incident_type_id.sql — issue-closing-measure: issues point at the kept list (FR-ICM-002/003/004/007/008).
-- `incident_reports.type` (text) stays as the stored label, so every reader and all history keep working.
-- Backfill: one list entry per distinct lower(btrim(type)) per organisation (label = the most frequent spelling, ties
-- by earliest use; blank = "Other"); an organisation with no issues gets "Other". `type` text is not rewritten.
-- Resolver: a person (a signed-in caller under the client role) may only name a live entry of their own organisation, else 23514
-- ICM_TYPE_NOT_IN_LIST. A trusted context (no signed-in client caller: migrations, jobs, imports, seed, fixtures) may name a new
-- label and it is added to the list, so no import fails and the list stays complete.
-- guard_incident_issue_fields (1391) is not restated: this trigger sorts after it, so a non-manager's type change is
-- still refused there first. Proven by supabase/tests/1820_incident_types.test.sql.
-- Reverse: rollback/1821_incident_type_id_down.sql (drops the column and triggers; `type` untouched).

alter table public.incident_reports add column type_id uuid references public.incident_types(id);
create index incident_reports_type_id_idx on public.incident_reports (type_id);

-- ── backfill (idempotent) ────────────────────────────────────────────────────────────────────────────
insert into public.incident_types (org_id, label)
select org_id, label from (
  select distinct on (org_id, k) org_id, k, label
    from (
      select i.org_id,
             lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80))) as k,
             left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80) as label,
             count(*) over (partition by i.org_id, lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80))), left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80)) as n,
             min(i.created_at) over (partition by i.org_id, lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80))), left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80)) as first_seen
        from public.incident_reports i
    ) s
   order by org_id, k, n desc, first_seen, label
) d
on conflict do nothing;

insert into public.incident_types (org_id, label)
select o.id, 'Other' from public.organizations o
 where not exists (select 1 from public.incident_types t where t.org_id = o.id)
on conflict do nothing;

update public.incident_reports i set type_id = t.id
  from public.incident_types t
 where t.org_id = i.org_id and t.archived_at is null
   and lower(btrim(t.label)) = lower(btrim(left(coalesce(nullif(btrim(i.type), ''), 'Other'), 80)))
   and i.type_id is null;

-- ── resolver (FR-ICM-003) ────────────────────────────────────────────────────────────────────────────
create function public.resolve_incident_type() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_label text; v_want text;
  -- a person = a signed-in caller acting under the client role. `role` is the session setting a client request (and a test)
  -- sets; it is not changed by this function being a definer, and a table-owner session with leftover JWT claims is not a person.
  v_person boolean := auth.uid() is not null and current_setting('role', true) in ('authenticated', 'anon');
begin
  if current_setting('pmo.incident_type_rename', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.type is not distinct from old.type and new.type_id is not distinct from old.type_id then
    return new;
  end if;

  if new.type_id is not null and (tg_op = 'INSERT' or new.type_id is distinct from old.type_id) then
    select t.id, t.label into v_id, v_label from public.incident_types t
     where t.id = new.type_id and t.org_id = new.org_id and t.archived_at is null;
    if v_id is null and v_person then
      raise exception 'ICM_TYPE_NOT_IN_LIST: pick an issue type from the list, or ask an Admin to add it' using errcode = '23514';
    end if;
  end if;

  if v_id is null then
    v_want := left(nullif(btrim(coalesce(new.type, '')), ''), 80);
    if v_want is null and not v_person then v_want := 'Other'; end if;
    if v_want is not null then
      select t.id, t.label into v_id, v_label from public.incident_types t
       where t.org_id = new.org_id and t.archived_at is null and lower(btrim(t.label)) = lower(v_want);
    end if;
    if v_id is null then
      if v_person then
        raise exception 'ICM_TYPE_NOT_IN_LIST: pick an issue type from the list, or ask an Admin to add it' using errcode = '23514';
      end if;
      -- trusted context: add the label to the organisation's list
      insert into public.incident_types (org_id, label) values (new.org_id, left(v_want, 80))
        returning id, label into v_id, v_label;
    end if;
  end if;

  new.type_id := v_id;
  new.type := v_label;
  return new;
end $$;
revoke all on function public.resolve_incident_type() from public, anon, authenticated;
create trigger incident_reports_zz_type_list before insert or update of type, type_id on public.incident_reports
  for each row execute function public.resolve_incident_type();

-- ── rename carries to issues and department groups (FR-ICM-004) ─────────────────────────────────────
create function public.incident_types_carry_rename() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.label is distinct from old.label then
    perform set_config('pmo.incident_type_rename', 'on', true);
    update public.incident_reports set type = new.label where type_id = new.id and org_id = new.org_id;
    perform set_config('pmo.incident_type_rename', 'off', true);
    update public.issue_department_groups g
       set issue_types = (
         select coalesce(array_agg(case when lower(btrim(e.v)) = lower(btrim(old.label)) then new.label else e.v end order by e.ord), '{}')
           from unnest(g.issue_types) with ordinality as e(v, ord))
     where g.org_id = new.org_id
       and exists (select 1 from unnest(g.issue_types) x where lower(btrim(x)) = lower(btrim(old.label)));
  end if;
  return new;
end $$;
revoke all on function public.incident_types_carry_rename() from public, anon, authenticated;
create trigger incident_types_zz_carry_rename after update of label on public.incident_types
  for each row execute function public.incident_types_carry_rename();
