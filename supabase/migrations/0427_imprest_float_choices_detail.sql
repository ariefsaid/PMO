-- 0427_imprest_float_choices_detail.sql — #1635: the expense form's float chooser also returns the float's currency,
-- amount and project name, so a claimant (who cannot read imprest_floats) sees amounts in the float's currency.
-- Same filters, DEFINER, grants as 0424 §3; the return type changes, so drop + create.
-- ── REVERSE: rollback/0427_imprest_float_choices_detail_down.sql (re-creates the 0424 §3 shape) ──────────────────────
drop function if exists public.imprest_float_choices(uuid, public.budget_category);
create function public.imprest_float_choices(p_project uuid, p_category public.budget_category default null)
returns table (float_id uuid, custodian_name text, remaining numeric, currency text, float_amount numeric, project_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, pf.full_name,
         case when p_category is null then null
              else public.imprest_remaining(f.id, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date,
                                            p_category) end,
         f.currency, f.float_amount, pr.name
    from public.imprest_floats f
    join public.profiles pf on pf.id = f.custodian_id
    join public.organizations o on o.id = f.org_id
    join public.projects pr on pr.id = f.project_id
   where f.project_id = p_project and f.org_id = public.auth_org_id() and f.archived_at is null
     and public.is_active_member() and f.custodian_id is distinct from auth.uid()
   order by pf.full_name
$$;
revoke all on function public.imprest_float_choices(uuid, public.budget_category) from public, anon;
grant execute on function public.imprest_float_choices(uuid, public.budget_category) to authenticated;
