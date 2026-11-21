-- 1265 (#2669): profit per discipline. An organisation setting (off by default) and an optional discipline on a contract item.
-- Spec: docs/specs/discipline-profit.spec.md. Proven by supabase/tests/1265_discipline_profit.test.sql.
-- Reverse: supabase/migrations/rollback/1265_discipline_profit_setting_down.sql (reverse 1266 first).

alter table public.organizations
  add column discipline_profit_enabled boolean not null default false;
comment on column public.organizations.discipline_profit_enabled is
  'Show revenue next to cost per discipline on the project plan-versus-actual tab (#2669). Off by default. Written only through set_org_discipline_profit_enabled (Admin).';

-- The contract item's discipline (from the organisation's own list). Not in any column grant: written only by set_boq_item_discipline (1266).
alter table public.boq_items add column discipline_id uuid references public.cost_disciplines(id);
create index boq_items_discipline_idx on public.boq_items (discipline_id) where discipline_id is not null;

create function public.get_org_discipline_profit_enabled()
returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select o.discipline_profit_enabled from public.organizations o
                    where o.id = (select public.auth_org_id()) and (select public.is_active_member())), false)
$$;
revoke all on function public.get_org_discipline_profit_enabled() from public, anon;
grant execute on function public.get_org_discipline_profit_enabled() to authenticated;

create function public.set_org_discipline_profit_enabled(p_enabled boolean)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_old boolean;
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change this setting' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'a value is required' using errcode = '22023'; end if;
  select o.discipline_profit_enabled into v_old from public.organizations o where o.id = v_org for update;
  if v_old is distinct from p_enabled then
    update public.organizations set discipline_profit_enabled = p_enabled where id = v_org;
    perform public.log_audit('org.discipline_profit.change', v_org, auth.uid(), v_org,
                             jsonb_build_object('from', v_old, 'to', p_enabled));
  end if;
  return p_enabled;
end $$;
revoke all on function public.set_org_discipline_profit_enabled(boolean) from public, anon;
grant execute on function public.set_org_discipline_profit_enabled(boolean) to authenticated;
