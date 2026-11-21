-- Reverses 1145: restores the 1143 bodies. An already-disposed outbox row stays failed.
create or replace function public.request_account_send(p_tier text, p_category text, p_parent_account text, p_account_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_binding public.external_org_bindings%rowtype;
        v_category public.budget_category; v_name text := btrim(coalesce(p_account_name, '')); v_parent text := btrim(coalesce(p_parent_account, ''));
        v_identity text; v_id uuid;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text not in ('Admin', 'Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- account.send is declared on ERPNext only (pending on Odoo, #1504)
  if p_tier is distinct from 'erpnext' then raise exception 'Creating accounts from PMO is not available for this ERP yet' using errcode = 'P0001'; end if;
  select * into v_binding from public.external_org_bindings
   where org_id = v_org and external_tier = p_tier and status = 'active' and activated_at is not null;
  if not found or coalesce(v_binding.config->>'company', '') = '' then
    raise exception 'Connect the ERP and choose its company first' using errcode = 'P0001';
  end if;
  begin
    v_category := p_category::public.budget_category;
  exception when invalid_text_representation then
    raise exception 'Unknown budget category' using errcode = '22023';
  end;
  -- Serialize concurrent requests for this category before testing or changing its proposal.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_category::text, 0));
  if v_name = '' then raise exception 'Give the account a name' using errcode = '22023'; end if;
  if length(v_name) > 140 then raise exception 'The account name is too long' using errcode = '22023'; end if;
  if not exists (select 1 from public.erp_account_mirror m
                  where m.org_id = v_org and m.company = v_binding.config->>'company' and m.erp_name = v_parent
                    and m.is_group and m.root_type = 'Expense' and not m.disabled) then
    raise exception 'Choose an expense group of the connected company' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.budget_category_account_map where org_id = v_org and category = v_category and is_push_target) then
    raise exception 'This category already has an account' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.erp_connect_proposals where org_id = v_org and external_tier = p_tier and kind = 'account'
               and pmo_ids[1] = v_category::text and (state = 'sending' or (state in ('open', 'dismissed') and (reason = 'held' or (reason = 'unresolved' and account_disposed_at is null))))) then
    raise exception 'An account for this category is already on its way to the ERP' using errcode = 'P0001';
  end if;
  -- an earlier refusal for this category is settled by asking again
  update public.erp_connect_proposals set state = 'dismissed'
   where org_id = v_org and external_tier = p_tier and kind = 'account' and pmo_ids[1] = v_category::text
     and outcome = 'review' and reason = 'rejected' and state = 'open';
  v_identity := 'send|' || to_jsonb(array[v_category::text])::text || '|[]|account-request';
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, run_id, kind, outcome, identity, pmo_ids, external_ids, snapshot, state, decided_by, decided_at)
    values (v_org, v_binding.id, p_tier, null, 'account', 'send', v_identity, array[v_category::text], '{}',
            jsonb_build_object('accountName', v_name, 'parentAccount', v_parent), 'sending', v_actor, now())
    on conflict (org_id, external_tier, kind, identity) do update
      set binding_id = excluded.binding_id, outcome = 'send', reason = null, reason_text = null, snapshot = excluded.snapshot, state = 'sending',
          send_claimed_at = null, send_failures = 0, decided_by = excluded.decided_by, decided_at = excluded.decided_at, run_id = null
    returning id into v_id;
  perform public.log_audit('integration.account_send_request', v_org, v_actor, v_id,
    jsonb_build_object('tier', p_tier, 'category', v_category::text, 'parentAccount', v_parent, 'accountName', v_name));
  return v_id;
end $$;

create or replace function public.dispose_account_reconciliation(p_id uuid, p_reason text, p_absent boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); p public.erp_connect_proposals%rowtype;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 or length(btrim(p_reason)) > 1000 or p_absent is distinct from true then
    raise exception 'A reason and absence attestation are required' using errcode = '22023';
  end if;
  select * into p from public.erp_connect_proposals where id = p_id and org_id = v_org and kind = 'account';
  if not found then raise exception 'unknown account request' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p.pmo_ids[1], 0));
  select * into p from public.erp_connect_proposals where id = p_id and org_id = v_org for update;
  if p.reason is distinct from 'unresolved' or p.state not in ('open','dismissed') or p.account_disposed_at is not null
    or (p.send_claimed_at is not null and p.send_claimed_at > now() - interval '5 minutes') then
    raise exception 'Account request is not eligible for disposition' using errcode = 'P0001';
  end if;
  perform 1 from public.external_command_outbox o where o.org_id = v_org and o.external_tier = p.external_tier
    and o.domain = 'accounts' and o.pmo_record_id = p.pmo_ids[1] for update;
  if not found or exists (select 1 from public.external_command_outbox o where o.org_id = v_org and o.external_tier = p.external_tier
    and o.domain = 'accounts' and o.pmo_record_id = p.pmo_ids[1]
    and (o.state <> 'held' or o.external_record_id is not null or (o.claimed_at is not null and o.claimed_at > now() - interval '5 minutes'))) then
    raise exception 'Account request is not eligible for disposition' using errcode = 'P0001';
  end if;
  update public.erp_connect_proposals set account_disposed_at = now() where id = p.id and org_id = v_org;
  perform public.log_audit('integration.account_reconciliation_disposition', v_org, v_actor, p.id,
    jsonb_build_object('tier', p.external_tier, 'category', p.pmo_ids[1], 'reason', btrim(p_reason), 'accountAbsent', true));
end $$;

create or replace function public.guard_account_outbox_hold() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.domain = 'accounts' and old.state = 'held' and new.state is distinct from 'held' then
    raise exception 'Account outbox hold requires reconciliation' using errcode = 'P0001';
  end if;
  return new;
end $$;
