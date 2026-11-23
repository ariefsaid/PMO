-- Reverse of 1935: the 1831 body of person_clearance_due; the helper goes.
create or replace function public.person_clearance_due()
  returns table (person_id uuid, item_id uuid, due_on date, overdue boolean)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  -- Preserve the light-account refusal at this invoker read boundary.
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
drop function if exists public.clearance_document_done(uuid, uuid);
