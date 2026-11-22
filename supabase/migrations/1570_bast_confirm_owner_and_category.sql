-- 1570_bast_confirm_owner_and_category.sql — fix-billing item 1.
-- (a) A default document category for the signed client-acceptance record (BAST), for every organisation.
--     Definition copied from 1164 (the newest); only the name list gains 'Delivery record'.
-- (b) The data the waiting-list lane needs: the acceptances waiting for the caller to confirm.
--     Mirrors confirm_work_order_acceptance (0339): Admin and Finance confirm; the preparer may not, unless
--     they are the only active member. Read under the caller's own RLS; nothing is written.
-- Rollback: rollback/1570_bast_confirm_owner_and_category_down.sql
begin;

create or replace function public.seed_document_categories(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_names text[] := array['Drawing', 'Specification', 'Report', 'Transmittal', 'Submittal', 'Certificate', 'Other', 'Reference', 'Delivery record'];
  v_i int;
  v_id uuid;
begin
  for v_i in 1 .. array_length(v_names, 1) loop
    select id into v_id from public.document_categories
      where org_id = p_org and lower(name) = lower(v_names[v_i]) and archived_at is null;
    if v_id is null then
      insert into public.document_categories (org_id, name, sort_order, is_system)
        values (p_org, v_names[v_i], v_i * 10, true) returning id into v_id;
    end if;
    insert into public.document_category_roles (category_id, org_id, role)
      select v_id, p_org, r from unnest(enum_range(null::public.user_role)) r
      on conflict do nothing;
  end loop;
end $$;
revoke all on function public.seed_document_categories(uuid) from public, anon, authenticated;

select public.seed_document_categories(id) from public.organizations;

create or replace function public.acceptances_awaiting_my_confirmation()
returns table (id uuid, project_id uuid, work_order_id uuid, acceptance_date date, is_final boolean, prepared_by uuid, prepared_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select a.id, a.project_id, a.work_order_id, a.acceptance_date, a.is_final, a.prepared_by, a.prepared_at
    from public.work_order_acceptances a
    join public.work_orders w on w.id = a.work_order_id
   where a.status = 'Draft'
     and w.status = 'Issued'
     and (select public.auth_role()) in ('Admin', 'Finance')
     and (a.prepared_by is distinct from auth.uid()
          or (select count(*) = 1 and bool_or(p.id = auth.uid())
                from public.profiles p
               where p.org_id = (select public.auth_org_id()) and public.is_active_member(p.id)))
   order by a.prepared_at, a.id
   limit 200
$$;
revoke all on function public.acceptances_awaiting_my_confirmation() from public, anon;
grant execute on function public.acceptances_awaiting_my_confirmation() to authenticated;

commit;
