-- 1935_clearance_document_done.sql — a clearance item tied to a document type reads "done" the same for every reader.
-- clearance_document_done(person, type): a definer that answers only yes or no (a live, dated document of that type exists), and only
-- about a person the caller may read. person_clearance_due (restated from 1831, the only migration that defines it) uses it, so a
-- manager's figure for an item tied to a medical type is right although the manager cannot read medical documents.
-- drops: person_clearance_due's inline read of expiry_documents for document-tied items, now one call to clearance_document_done.
-- Proven by supabase/tests/1831_clearance_target_days.test.sql. Rollback: rollback/1935_clearance_document_done_down.sql

create function public.clearance_document_done(p_person uuid, p_type uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  -- Yes or no only: no date, status or row. Answered only about a person the caller may read (people_select, 1536).
  select coalesce((
    select exists (select 1 from public.expiry_documents x
                    where x.person_id = p.id and x.type_id = p_type and x.archived_at is null and x.expires_on is not null)
      from public.people p
     where public.assert_not_light() and public.is_active_member()
       and p.id = p_person and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Project Manager', 'Finance', 'Executive')                       -- mut:reader
            or p.manager_id = auth.uid() or p.profile_id = auth.uid() or public.actor_has_person_documents_access())), false)
$$;
revoke all on function public.clearance_document_done(uuid, uuid) from public, anon;
grant execute on function public.clearance_document_done(uuid, uuid) to authenticated;

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
                   -- 1935: through the yes/no helper, so a reader who may not see a medical document still gets the right figure.
                   else public.clearance_document_done(p.id, i.document_type_id) end);
end $$;
revoke all on function public.person_clearance_due() from public, anon;
grant execute on function public.person_clearance_due() to authenticated;
