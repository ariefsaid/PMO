-- rollback/1539: restore the five capabilities (CHECK list and 1200 seed rows) and the five helpers (1200, 1203 bodies).
alter table public.built_in_role_capabilities drop constraint built_in_role_capabilities_capability_check;
alter table public.built_in_role_capabilities add constraint built_in_role_capabilities_capability_check
  check (capability in (
    'sees_prices', 'stock_post', 'stock_approve', 'daily_report_enter', 'daily_report_validate',
    'crew_time_approve', 'billing_stage_run', 'invoice_raise', 'people_documents_view', 'medical_documents_view'));

insert into public.built_in_role_capabilities (role_key, capability) values
('storekeeper','stock_post'),
('material_coordinator','stock_approve'),
('construction_manager','crew_time_approve'),
('billing_officer','billing_stage_run'),
('finance_manager','invoice_raise'),
('finance_officer','invoice_raise')
on conflict do nothing;

create function public.built_in_role_tier(p_key text) returns text
  language sql stable set search_path = pg_catalog, public as $$
  select r.tier from public.built_in_roles r where r.key = p_key
$$;
revoke all on function public.built_in_role_tier(text) from public, anon;
grant execute on function public.built_in_role_tier(text) to authenticated, service_role;

create function public.built_in_role_may_approve(p_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(public.built_in_role_tier(p_key) = 'manager', false)
$$;
create function public.built_in_role_may_prepare(p_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(public.built_in_role_tier(p_key) = 'officer', false)
$$;
create function public.built_in_role_may_stand_in(p_actor_key text, p_absent_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(
    public.built_in_role_tier(p_actor_key) = 'manager'
    and public.built_in_role_tier(p_absent_key) = 'manager'
    and public.role_rank(public.built_in_role_base(p_actor_key)) >= public.role_rank(public.built_in_role_base(p_absent_key)),
    false)
$$;
revoke all on function public.built_in_role_may_approve(text), public.built_in_role_may_prepare(text),
  public.built_in_role_may_stand_in(text, text) from public, anon;
grant execute on function public.built_in_role_may_approve(text), public.built_in_role_may_prepare(text),
  public.built_in_role_may_stand_in(text, text) to authenticated, service_role;

create function public.actor_holds_built_in_role(p_key text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.actor_built_in_role() = p_key, false)
$$;
revoke all on function public.actor_holds_built_in_role(text) from public, anon;
grant execute on function public.actor_holds_built_in_role(text) to authenticated, service_role;
