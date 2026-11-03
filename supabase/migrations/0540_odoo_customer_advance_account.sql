-- #1506 C4 — an organisation selects the Odoo liability account its customer advances post to.
-- Reversal: rollback/0540_odoo_customer_advance_account_down.sql.

-- C4 read-back can flag an invoice after Odoo posts it; the mirror vocabulary must accept that write.
alter table public.sales_invoices
  drop constraint sales_invoices_odoo_attention_check,
  add constraint sales_invoices_odoo_attention_check check (
    odoo_attention in (
      'total-mismatch', 'cost-account-missing', 'money-unreadable', 'lines-unreadable', 'advance-account-mismatch'
    )
  );
comment on column public.sales_invoices.odoo_attention is
  'Why an Odoo-held invoice needs a person (set by the mirror writer only); includes posted advance-account mismatches.';

create or replace function public.set_odoo_customer_advance_account(p_org_id uuid, p_actor_id uuid, p_account_ref text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state jsonb;
  v_config jsonb;
  v_company_id text;
  v_account_id text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  perform 1 from public.profiles where id = p_actor_id for share;
  perform 1 from auth.users where id = p_actor_id for share;
  v_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if not coalesce((v_state->>'active')::boolean, false) then
    raise exception 'active organisation member required' using errcode = '42501';
  end if;
  if v_state->>'role' not in ('Admin', 'Finance') then
    raise exception 'current authority required' using errcode = '42501';
  end if;

  perform public.assert_odoo_activated(p_org_id);
  select config into v_config
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active'
   for update;
  if not found then
    raise exception 'active Odoo binding required' using errcode = 'P0001';
  end if;

  if p_account_ref !~ '^account\.account:[1-9][0-9]{0,8}$' then
    raise exception 'customer-advance account reference is invalid' using errcode = 'P0001';
  end if;
  v_account_id := split_part(p_account_ref, ':', 2);
  v_company_id := v_config->>'odoo_company_id';
  if v_company_id !~ '^[1-9][0-9]*$' or not exists (
    select 1
      from public.external_master_records m
     where m.org_id = p_org_id and m.external_tier = 'odoo' and m.kind = 'account'
       and m.external_id = v_account_id and m.active and m.tombstoned_at is null
       and m.attrs->>'account_type' like 'liability%'
       and m.attrs->>'account_type' <> 'liability_payable'
       and jsonb_typeof(m.attrs->'company_ids') = 'array'
       and (m.attrs->'company_ids') ? v_company_id
  ) then
    raise exception 'customer-advance account is not active in the bound Odoo company' using errcode = 'P0001';
  end if;

  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
       'customer_advance_account_ref', p_account_ref,
       'customer_advance_account_set_by', p_actor_id,
       'customer_advance_account_set_at', now())
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active';
  perform public.log_audit('integration.odoo.customer_advance_account', p_org_id, p_actor_id, null,
    jsonb_build_object('account', p_account_ref));
end $$;

revoke all on function public.set_odoo_customer_advance_account(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.set_odoo_customer_advance_account(uuid,uuid,text) to service_role;
