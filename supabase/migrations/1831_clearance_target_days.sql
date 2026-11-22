-- 1831_clearance_target_days.sql — a clearance item can carry a target in days, counted from the person record's creation (#2800).
-- FR-CTD-003..005, 010. Proven by supabase/tests/1831_clearance_target_days.test.sql.
-- The clearance checklist has no per-person creation event: items are the organisation's list and a person's state is a row recorded
-- when an item is done. The one per-person anchor is people.created_at (creator people.created_by). So a person's item is due on
-- (the person's creation day + target days) ONLY when the person was created on or after the item's target_set_at; a person who
-- existed before the target was set has no due day, so existing checklists read exactly as before.
-- ── REVERSE: rollback/1831_clearance_target_days_down.sql ────────────────────────────────────────────────────────────

alter table public.clearance_items
  add column target_days   smallint check (target_days between 1 and 365),
  add column target_set_at timestamptz,
  add constraint clearance_items_target_stamp check ((target_days is null) = (target_set_at is null));
grant insert (target_days) on public.clearance_items to authenticated;
grant update (target_days) on public.clearance_items to authenticated;

-- target_set_at is written only here: stamped when the target is set or changed, cleared when it is removed.
create function public.clearance_items_target_stamp() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.target_days is null then
    new.target_set_at := null;
  elsif tg_op = 'INSERT' or old.target_days is distinct from new.target_days then
    new.target_set_at := now();
  else
    new.target_set_at := old.target_set_at;
  end if;
  return new;
end $$;
revoke all on function public.clearance_items_target_stamp() from public, anon, authenticated;
create trigger clearance_items_z_target_stamp_trg before insert or update on public.clearance_items
  for each row execute function public.clearance_items_target_stamp();

-- The one due-day rule, shared by the read function below and the runner (1832). Pure; no table read.
create function public.clearance_due_on(p_person_created timestamptz, p_target_set_at timestamptz, p_target_days smallint, p_tz text)
  returns date language sql immutable set search_path = public, pg_temp as $$
  select case when p_target_days is null or p_target_set_at is null or p_person_created < p_target_set_at then null
              else (p_person_created at time zone coalesce(p_tz, 'UTC'))::date + p_target_days end
$$;
revoke all on function public.clearance_due_on(timestamptz, timestamptz, smallint, text) from public, anon;
grant execute on function public.clearance_due_on(timestamptz, timestamptz, smallint, text) to authenticated;

-- Once-per (person, item) overdue notice. Written only by the runner (1832); read like person_clearances; light accounts refused.
create table public.person_clearance_overdue_notices (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  item_id     uuid not null references public.clearance_items(id) on delete cascade,
  notified_at timestamptz not null default now(),
  unique (person_id, item_id)
);
create index person_clearance_overdue_notices_org_idx on public.person_clearance_overdue_notices (org_id);
create trigger person_clearance_overdue_notices_stamp_org_id before insert on public.person_clearance_overdue_notices
  for each row execute function public.stamp_org_id();
alter table public.person_clearance_overdue_notices enable row level security;
alter table public.person_clearance_overdue_notices force row level security;
revoke all on public.person_clearance_overdue_notices from public, anon, authenticated;
grant select on public.person_clearance_overdue_notices to authenticated;
grant all on public.person_clearance_overdue_notices to service_role;
create policy person_clearance_overdue_notices_select on public.person_clearance_overdue_notices for select to authenticated using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin','Project Manager','Finance','Executive'));
create policy light_account_deny_select on public.person_clearance_overdue_notices as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);

-- Each person's items with a due day and whether they are overdue: SECURITY INVOKER, so the caller's RLS decides which people and
-- documents they see (as person_clearance_items, 1612). "Done" = a recorded row, or for an item tied to a document type the person's
-- live document with an expiry (the 1612 reading). Done items are not listed.
create function public.person_clearance_due()
  returns table (person_id uuid, item_id uuid, due_on date, overdue boolean)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  -- The light refusal is inlined, not delegated: assert_not_light() is not executable by authenticated (1205 revokes it),
  -- and this function stays SECURITY INVOKER, so `perform public.assert_not_light()` fails 42501 for every authenticated
  -- reader. Same actor_is_light() condition, message and code as 1205; no EXECUTE grant and no definer conversion (#2800).
  if public.actor_is_light() then
    raise exception 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this' using errcode = '42501';
  end if;
  return query
  with ctx as (
    select o.id as org_id, o.default_timezone as tz, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as today
      from public.organizations o where o.id = (select public.auth_org_id())
  )
  select p.id, i.id, d.due, d.due < ctx.today
    from ctx
    join public.people p on p.org_id = ctx.org_id and p.archived_at is null
    join public.clearance_items i on i.org_id = ctx.org_id and i.archived_at is null
    cross join lateral (select public.clearance_due_on(p.created_at, i.target_set_at, i.target_days, ctx.tz) as due) d
   where d.due is not null
     and not (case when i.document_type_id is null
                   then exists (select 1 from public.person_clearances c where c.person_id = p.id and c.item_id = i.id)
                   else exists (select 1 from public.expiry_documents x
                                 where x.person_id = p.id and x.type_id = i.document_type_id and x.archived_at is null and x.expires_on is not null) end);
end $$;
revoke all on function public.person_clearance_due() from public, anon;
grant execute on function public.person_clearance_due() to authenticated;
