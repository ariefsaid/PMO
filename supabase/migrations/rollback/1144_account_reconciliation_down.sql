-- Account reconciliation reversal; pending dispositions must be settled first.
do $$ begin
  if exists (select 1 from public.erp_connect_proposals where kind = 'account' and reason = 'unresolved') then
    raise exception 'Settle account reconciliations before reversing this migration';
  end if;
end $$;
drop trigger if exists guard_account_outbox_hold on public.external_command_outbox;
drop function if exists public.guard_account_outbox_hold();
drop trigger if exists guard_account_reconciliation on public.erp_connect_proposals;
drop function if exists public.guard_account_reconciliation();
drop function if exists public.dispose_account_reconciliation(uuid,text,boolean);
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
               and pmo_ids[1] = v_category::text and (state = 'sending' or (state in ('open', 'dismissed') and reason = 'held'))) then
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
create or replace function public.record_connect_send_failure(p_org_id uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return false; end if;
  update public.erp_connect_proposals set send_failures = send_failures + 1 where id = p.id returning send_failures into p.send_failures;
  if p.send_failures < 5 then return false; end if;
  -- #1599: clients never work in the ERP; an account send that ends here is the Operator's task (the drain raises it)
  perform public.record_connect_send_result(p_org_id, p_id, null, case when p.kind = 'account'
    then 'PMO could not create the account. Contact your administrator.'
    else 'We could not finish sending this record. Check it in the ERP, then try again.' end);
  return true;
end $$;
create or replace function public.record_connect_send_held(p_org_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return; end if;
  update public.erp_connect_proposals
     set outcome = 'review', reason = 'held', state = 'open', run_id = null,
         -- #1599: clients never work in the ERP; an undecided account send is the Operator's task (the drain raises it)
         reason_text = case when p.kind = 'account'
           then 'PMO could not confirm whether the account was created. Contact your administrator.'
           else 'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.' end,
         identity = 'review|' || to_jsonb(p.pmo_ids)::text || '|' || to_jsonb(p.external_ids)::text || '|send:' || p.id::text
   where id = p.id;
  perform public.settle_connect_run(p.org_id, p.external_tier);
end $$;
create or replace function public.record_connect_send_result(p_org_id uuid, p_id uuid, p_external_id text, p_rejection text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype; v_reason text;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return; end if;
  if p_rejection is null then
    if coalesce(p_external_id, '') = '' then raise exception 'a successful send names the ERP record' using errcode = '22023'; end if;
    -- the one link writer for every kind (apply_connect_link): it never re-points an existing link and answers a clash in plain words below
    begin
      if p.kind = 'item' and p_external_id = p.pmo_ids[1] then v_reason := null;   -- the line name is the ERP code: nothing to map
      else v_reason := public.apply_connect_link(p.org_id, p.external_tier, p.kind, p.pmo_ids[1], p_external_id, '{"reviewed":true}'::jsonb, p.decided_by);
      end if;
    exception when others then
      raise warning 'record_connect_send_result % : % %', p.kind, sqlstate, sqlerrm;   -- the Admin gets plain words; the log keeps the cause
      v_reason := 'This row could not be applied';
    end;
    if v_reason is null then
      update public.erp_connect_proposals set state = 'applied', reason_text = null where id = p.id;
      perform public.settle_connect_run(p.org_id, p.external_tier);
      return;
    end if;
  else
    v_reason := p_rejection;
  end if;
  -- a refused send is a review row no matcher run writes (run_id null, an identity of its own): the next run cannot overwrite or delete it
  update public.erp_connect_proposals
     set outcome = 'review', reason = 'rejected', reason_text = left(v_reason, 300), state = 'open', run_id = null,
         identity = 'review|' || to_jsonb(p.pmo_ids)::text || '|' || to_jsonb(p.external_ids)::text || '|send:' || p.id::text
   where id = p.id;
  perform public.settle_connect_run(p.org_id, p.external_tier);
end $$;
create or replace function public.record_connect_send_result(p_org_id uuid, p_id uuid, p_external_id text, p_rejection text, p_parent text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype; v_applied boolean;
begin
  if p_rejection is not null or coalesce(btrim(p_parent), '') = '' then
    raise exception 'Account result requires its parent' using errcode = '22023';
  end if;
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found or p.kind <> 'account' then raise exception 'unknown account proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return false; end if;
  perform public.record_connect_send_result(p_org_id, p_id, p_external_id, null);
  select state = 'applied' into v_applied from public.erp_connect_proposals where id = p.id and org_id = p_org_id;
  if p_parent is distinct from p.snapshot->>'parentAccount' then
    update public.erp_connect_proposals set reason_text = (p.snapshot->>'accountName') || ' already exists under ' || p_parent || '; linked there.'
      where id = p.id and org_id = p_org_id and state = 'applied';
  end if;
  return coalesce(v_applied, false);
end $$;
drop function if exists public.record_connect_account_unresolved(uuid,uuid);
alter table public.erp_connect_proposals drop column account_disposed_at;
alter table public.erp_connect_proposals drop constraint erp_connect_proposals_reason_check;
alter table public.erp_connect_proposals add constraint erp_connect_proposals_reason_check check (reason in ('ambiguous','tax-conflict','rejected','held'));
