-- 2282: bounded project progress whose measured quantity exceeds confirmed client acceptance.
-- Reuses get_project_billing's assessment and acceptance rules; it creates no claim or allocation.
-- Reverse: rollback/2282_billing_unaccepted_progress_down.sql.
begin;
create function public.billing_unaccepted_progress(p_project uuid default null)
  returns table (
    project_id uuid, project_name text, boq_item_id uuid, item_code text, description text,
    unit text, quantity text, today date)
  language sql stable security invoker set search_path = public as $$
  with tz as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as name
  ), projects_in_scope as (
    select p.id, p.name
      from public.projects p
     where p.org_id = public.auth_org_id()
       and public.is_active_member()
       and public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance')
       and p.archived_at is null
       and (p_project is null or p.id = p_project)
  ), progress as (
    select p.id as project_id, p.name as project_name, line.x
      from projects_in_scope p
      cross join lateral (select public.get_project_billing(p.id) as j) billing
      cross join lateral jsonb_array_elements(coalesce(billing.j -> 'boq', '[]'::jsonb)) line(x)
  )
  select pr.project_id,
         pr.project_name,
         (pr.x ->> 'boq_item_id')::uuid,
         b.item_code,
         b.description,
         b.unit,
         ((pr.x ->> 'assessed_quantity')::numeric - coalesce((pr.x ->> 'accepted_quantity')::numeric, 0))::text,
         (now() at time zone tz.name)::date
    from progress pr
    join public.boq_items b on b.id = (pr.x ->> 'boq_item_id')::uuid
    cross join tz
   where pr.x ->> 'assessed_quantity' is not null
     and (pr.x ->> 'assessed_quantity')::numeric > coalesce((pr.x ->> 'accepted_quantity')::numeric, 0)
   order by pr.project_name, b.line_no nulls last, b.created_at, b.id
   limit 501
$$;
revoke all on function public.billing_unaccepted_progress(uuid) from public, anon;
grant execute on function public.billing_unaccepted_progress(uuid) to authenticated, service_role;
commit;
