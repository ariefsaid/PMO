-- 0191_org_lifecycle_guard.sql — DD-ORG-3 default-deny wholesale destruction guard.
-- Reversible. Manual reverse (after removing any callers):
--   drop function if exists public.operator_set_org_lifecycle_state(uuid,text);
--   drop function if exists public.assert_org_destroyable(uuid);
--   revoke all on public.organizations from authenticated;
--   alter table public.organizations drop column if exists lifecycle_state;
-- Existing organizations are deliberately backfilled below; review any deployment-specific
-- organizations before applying this migration. Never use a default to classify real data.

alter table public.organizations add column lifecycle_state text;

-- The local/default organization is the maintained demo fixture. Real deployments must set their
-- owner-controlled organizations explicitly (DD-ORG-4); NULL remains protected by the guard.
update public.organizations
   set lifecycle_state = 'demo'
 where id = '00000000-0000-0000-0000-000000000001';

comment on column public.organizations.lifecycle_state is
  'Explicit lifecycle marker: live, demo, or test. NULL and future values are protected by assert_org_destroyable().';

-- Authority for every org-wholesale destructive operation. This is intentionally an allowlist:
-- refusing only live would fail open for NULL and states introduced later.
create or replace function public.assert_org_destroyable(p_org_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  select lifecycle_state into v_state
    from public.organizations
   where id = p_org_id
   for share;

  if not found or v_state is null or v_state not in ('demo', 'test') then
    raise exception 'org_not_destroyable: organization % is protected', p_org_id
      using errcode = '42501', hint = 'Only organizations explicitly marked demo or test may be targeted.';
  end if;
end;
$$;
revoke all on function public.assert_org_destroyable(uuid) from public;
grant execute on function public.assert_org_destroyable(uuid) to authenticated;

-- Operator-only transition path. Direct client writes remain unavailable: organizations has no
-- authenticated UPDATE grant for this column, and this RPC is the audited write boundary.
create or replace function public.operator_set_org_lifecycle_state(
  p_org_id uuid, p_lifecycle_state text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_previous text;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if p_lifecycle_state not in ('live', 'demo', 'test') then
    raise exception 'invalid_lifecycle_state' using errcode = '22023';
  end if;

  select lifecycle_state into v_previous
    from public.organizations
   where id = p_org_id
   for update;
  if not found then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  if v_previous = 'live' and p_lifecycle_state <> 'live' then
    raise exception 'live_org_terminal' using errcode = '42501';
  end if;
  if v_previous is distinct from p_lifecycle_state then
    update public.organizations
       set lifecycle_state = p_lifecycle_state
     where id = p_org_id;
    perform public.log_audit(
      'org.lifecycle_state.change', p_org_id, auth.uid(), p_org_id,
      jsonb_build_object('from', v_previous, 'to', p_lifecycle_state));
  end if;
end;
$$;
revoke all on function public.operator_set_org_lifecycle_state(uuid,text) from public;
grant execute on function public.operator_set_org_lifecycle_state(uuid,text) to authenticated;
