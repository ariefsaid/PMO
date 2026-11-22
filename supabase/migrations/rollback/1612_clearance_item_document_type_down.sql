-- Reverses 1612_clearance_item_document_type.sql: the 1237 functions, then the guard and the column.
drop function if exists public.person_clearance_items(uuid);
create function public.person_clearance_items(p_person uuid)
  returns table (item_id uuid, name text, is_required boolean, sort_order integer, done_on date, expires_on date, note text, state text)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with ctx as (
    select o.id as org_id, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as today,
           (select min(d) from unnest(o.document_warning_days) d) as warn_days
      from public.organizations o where o.id = (select public.auth_org_id())
  )
  select i.id, i.name, i.is_required, i.sort_order, c.done_on, c.expires_on, c.note,
         case
           when c.id is null then 'missing'
           when c.expires_on is not null and c.expires_on < ctx.today then 'expired'
           when c.expires_on is not null and c.expires_on <= ctx.today + ctx.warn_days then 'expiring'
           else 'done'
         end
    from ctx
    join public.people p on p.id = p_person and p.org_id = ctx.org_id and p.archived_at is null
    join public.clearance_items i on i.org_id = ctx.org_id and i.archived_at is null
    left join public.person_clearances c on c.item_id = i.id and c.person_id = p.id
   order by i.sort_order, lower(i.name), i.id
$$;
revoke all on function public.person_clearance_items(uuid) from public, anon;
grant execute on function public.person_clearance_items(uuid) to authenticated;

create or replace function public.person_clearance_summary()
  returns table (person_id uuid, required_count integer, satisfied_count integer, cleared boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with ctx as (
    select o.id as org_id, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as today
      from public.organizations o where o.id = (select public.auth_org_id())
  ), req as (
    select i.id, i.org_id from public.clearance_items i join ctx on ctx.org_id = i.org_id
     where i.archived_at is null and i.is_required
  ), per as (
    select p.id as person_id,
           (select count(*) from req)::integer as required_count,
           (select count(*) from req r join public.person_clearances c on c.item_id = r.id and c.person_id = p.id
             where c.expires_on is null or c.expires_on >= ctx.today)::integer as satisfied_count
      from ctx join public.people p on p.org_id = ctx.org_id and p.archived_at is null
  )
  select person_id, required_count, satisfied_count, (required_count > 0 and satisfied_count = required_count) from per
$$;

drop trigger if exists clearance_items_z_doc_type_guard_trg on public.clearance_items;
drop function if exists public.clearance_items_doc_type_guard();
revoke insert (document_type_id), update (document_type_id) on public.clearance_items from authenticated;
alter table public.clearance_items drop column if exists document_type_id;
