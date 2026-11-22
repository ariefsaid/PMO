-- 1612_clearance_item_document_type.sql — fix/walk-people item 8: a checklist item can point at a document type.
-- A linked item takes its date and expiry from the person's live document of that type (the document the expiring list already
-- watches), so a licence expiry is typed once, on the document. An unlinked item keeps its own recorded date exactly as before.
-- person_clearance_items and person_clearance_summary are restated from 1237 (newest definition) with the linked branch added.
-- Both stay SECURITY INVOKER: whoever may not read a document (a medical type, for one) sees it as not done, never more.
--
-- ── REVERSE (also supabase/migrations/rollback/1612_clearance_item_document_type_down.sql) ──────────────────
--   restore the two functions from 1237, drop the guard and the column.

alter table public.clearance_items add column document_type_id uuid references public.document_types(id) on delete restrict;
grant insert (document_type_id) on public.clearance_items to authenticated;
grant update (document_type_id) on public.clearance_items to authenticated;

-- The linked type must be this organisation's, and for people.
create function public.clearance_items_doc_type_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.document_type_id is not null and not exists (
       select 1 from public.document_types t
        where t.id = new.document_type_id and t.org_id = new.org_id and t.applies_to = 'person' and t.archived_at is null) then
    raise exception 'CLR_DOC_TYPE: choose one of your document types for people' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.clearance_items_doc_type_guard() from public, anon, authenticated;
create trigger clearance_items_z_doc_type_guard_trg before insert or update of document_type_id on public.clearance_items
  for each row execute function public.clearance_items_doc_type_guard();

drop function public.person_clearance_items(uuid);
create function public.person_clearance_items(p_person uuid)
  returns table (item_id uuid, name text, is_required boolean, sort_order integer, done_on date, expires_on date, note text, state text,
                 document_type_id uuid, document_type_name text)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with ctx as (
    select o.id as org_id, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as today,
           (select min(d) from unnest(o.document_warning_days) d) as warn_days
      from public.organizations o where o.id = (select public.auth_org_id())
  )
  select i.id, i.name, i.is_required, i.sort_order,
         case when i.document_type_id is not null then doc.issued_on else c.done_on end,
         case when i.document_type_id is not null then doc.expires_on else c.expires_on end,
         case when i.document_type_id is not null then null else c.note end,
         case
           when i.document_type_id is not null and doc.expires_on is null then 'missing'
           when i.document_type_id is null and c.id is null then 'missing'
           when coalesce(case when i.document_type_id is not null then doc.expires_on else c.expires_on end, 'infinity'::date) < ctx.today then 'expired'
           when case when i.document_type_id is not null then doc.expires_on else c.expires_on end is not null
                and case when i.document_type_id is not null then doc.expires_on else c.expires_on end <= ctx.today + ctx.warn_days then 'expiring'
           else 'done'
         end,
         i.document_type_id, dt.name
    from ctx
    join public.people p on p.id = p_person and p.org_id = ctx.org_id and p.archived_at is null
    join public.clearance_items i on i.org_id = ctx.org_id and i.archived_at is null
    left join public.document_types dt on dt.id = i.document_type_id
    left join public.person_clearances c on c.item_id = i.id and c.person_id = p.id
    left join lateral (
      select d.issued_on, d.expires_on from public.expiry_documents d
       where i.document_type_id is not null and d.person_id = p.id and d.type_id = i.document_type_id and d.archived_at is null
       order by d.expires_on desc limit 1) doc on true
   order by i.sort_order, lower(i.name), i.id
$$;

create or replace function public.person_clearance_summary()
  returns table (person_id uuid, required_count integer, satisfied_count integer, cleared boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with ctx as (
    select o.id as org_id, (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as today
      from public.organizations o where o.id = (select public.auth_org_id())
  ), req as (
    select i.id, i.org_id, i.document_type_id from public.clearance_items i join ctx on ctx.org_id = i.org_id
     where i.archived_at is null and i.is_required
  ), per as (
    select p.id as person_id,
           (select count(*) from req)::integer as required_count,
           (select count(*) from req r
             where (r.document_type_id is null and exists (select 1 from public.person_clearances c
                      where c.item_id = r.id and c.person_id = p.id and (c.expires_on is null or c.expires_on >= ctx.today)))
                or (r.document_type_id is not null and exists (select 1 from public.expiry_documents d
                      where d.person_id = p.id and d.type_id = r.document_type_id and d.archived_at is null and d.expires_on >= ctx.today))
           )::integer as satisfied_count
      from ctx join public.people p on p.org_id = ctx.org_id and p.archived_at is null
  )
  select person_id, required_count, satisfied_count, (required_count > 0 and satisfied_count = required_count) from per
$$;

revoke all on function public.person_clearance_items(uuid) from public, anon;
grant execute on function public.person_clearance_items(uuid) to authenticated;
