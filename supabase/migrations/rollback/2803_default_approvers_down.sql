-- Restore prior defaults and functions.
alter table public.organizations alter column quantity_change_approver_roles set default array[]::text[];
create or replace function public.guard_purchase_order_job_roles() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.order_job_roles is not distinct from old.order_job_roles then return new; end if;
  new.order_job_roles := coalesce(array(select distinct k from unnest(new.order_job_roles) k order by k), array[]::text[]);
  if cardinality(new.order_job_roles) = 0 then return new; end if;
  if exists (select 1 from unnest(new.order_job_roles) k
              left join public.built_in_roles r on r.key = k
             where r.key is null or r.tier = 'field') then                                             -- mut:order_roles_valid
    raise exception 'PO_ORDER_ROLE_INVALID: choose built-in roles from the list; a field role cannot order' using errcode = '23514';
  end if;
  if not public.org_built_in_roles_enabled(new.org_id) then                                            -- mut:order_roles_setting
    raise exception 'PO_JOB_ROLE_OFF: turn on built-in roles before naming roles that order' using errcode = 'P0001';
  end if;
  if public.org_hide_prices_enabled(new.org_id) and exists (select 1 from unnest(new.order_job_roles) k
              where not public.built_in_role_sees_prices(k)) then                                         -- 2701 mut:order_roles_prices
    raise exception 'PO_ORDER_ROLE_NO_PRICES: while prices are hidden, only built-in roles that see prices can order' using errcode = '23514';
  end if;
  return new;
end $$;

update public.purchase_order_settings set order_job_roles = array[]::text[] where order_job_roles is null;
alter table public.purchase_order_settings alter column order_job_roles set default array[]::text[];
alter table public.purchase_order_settings alter column order_job_roles set not null;
create or replace function public.po_set_order_job_roles(p_keys text[]) returns text[]
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_keys text[];
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                                  -- mut:order_roles_admin
    raise exception 'PO_ADMIN_ONLY: only an Admin can change purchase order settings' using errcode = '42501';
  end if;
  insert into public.purchase_order_settings (org_id, order_job_roles, updated_by, updated_at)
  values (v_org, coalesce(p_keys, array[]::text[]), v_uid, now())
  on conflict (org_id) do update set order_job_roles = excluded.order_job_roles, updated_by = excluded.updated_by, updated_at = now()
  returning order_job_roles into v_keys;
  perform public.log_audit('purchase_order.order_job_roles_set', v_org, v_uid, null, jsonb_build_object('order_job_roles', to_jsonb(v_keys)));
  return v_keys;
end $$;
create or replace function public.actor_may_order_purchases() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select bool_or(public.holds_job_role(auth.uid(), k)
                   and public.actor_built_in_role() is not distinct from k)                             -- mut:order_holds_key
      from public.purchase_order_settings s cross join lateral unnest(s.order_job_roles) k
     where s.org_id = public.auth_org_id()), false)
$$;
