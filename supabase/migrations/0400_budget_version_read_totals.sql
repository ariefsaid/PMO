-- Caller-visible version totals; RLS and table privileges remain those of the caller.
create function public.budget_version_read_totals(p_project_id uuid)
returns table (version_id uuid, total numeric)
language sql stable security invoker
set search_path = ''
as $$
  select v.id, coalesce(sum(li.budgeted_amount), 0)::numeric
  from public.budget_versions v
  left join public.budget_line_items li on li.budget_version_id = v.id and li.org_id = v.org_id
  where v.project_id = p_project_id
  group by v.id
$$;
revoke all on function public.budget_version_read_totals(uuid) from public, anon;
grant execute on function public.budget_version_read_totals(uuid) to authenticated;
