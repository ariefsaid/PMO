-- 1237_person_clearance_status.sql — #2707: the one place "cleared for site" is computed (FR-CLR-005).
-- Both functions are SECURITY INVOKER: the caller's RLS decides which people, items and states they see, so a role that
-- cannot read the checklist gets no rows. "Today" is the organisation's local date (default_timezone, as equipment_org_today 0447 computes it; inlined because that helper is not executable by callers).
-- Cleared = at least one live required item, and every live required item has a row whose expiry is empty or not past.
-- Reverse: rollback/1237_person_clearance_status_down.sql.

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

create function public.person_clearance_summary()
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

revoke all on function public.person_clearance_items(uuid) from public, anon;
revoke all on function public.person_clearance_summary() from public, anon;
grant execute on function public.person_clearance_items(uuid) to authenticated;
grant execute on function public.person_clearance_summary() to authenticated;
