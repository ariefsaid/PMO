-- 0428_imprest_float_choices_detail_down.sql — reverse of 0428: the 0424 §3 chooser, verbatim.
drop function if exists public.imprest_float_choices(uuid, public.budget_category);
create function public.imprest_float_choices(p_project uuid, p_category public.budget_category default null)
returns table (float_id uuid, custodian_name text, remaining numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, pf.full_name,
         case when p_category is null then null
              else public.imprest_remaining(f.id, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date,
                                            p_category) end
    from public.imprest_floats f
    join public.profiles pf on pf.id = f.custodian_id
    join public.organizations o on o.id = f.org_id
   where f.project_id = p_project and f.org_id = public.auth_org_id() and f.archived_at is null
     and public.is_active_member() and f.custodian_id is distinct from auth.uid()
   order by pf.full_name
$$;
revoke all on function public.imprest_float_choices(uuid, public.budget_category) from public, anon;
grant execute on function public.imprest_float_choices(uuid, public.budget_category) to authenticated;
