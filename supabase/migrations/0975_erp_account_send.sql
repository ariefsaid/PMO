-- #1599 ECX-4 (OQ-ECX-1, AC-ECX-030/031): an Admin or Finance member creates a direct-cost account for a budget category from PMO.
-- PMO creates LEAF accounts only, under an expense group of the bound ERP company that the person picks from the mirrored chart; it
-- never creates a group, a tax or anything of the fiscal structure. The request queues one `account` send for the shipped send drain
-- (0494): the sweep creates the account through the money outbox under a key naming the category, the requested name and the group, reads it back, and the result writer
-- links it in `budget_category_account_map` through `apply_connect_link` (0880). An account send that ends undecided or after its last
-- try asks Finance to contact the administrator, never to look in the ERP. Reversal: rollback/0975_erp_account_send_down.sql.

-- The expense groups an account may go under: groups of the bound company under the expense root, from the mirrored chart.
create or replace function public.account_send_groups(p_tier text) returns table (erp_name text, account_name text, parent_account text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_company text;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text not in ('Admin', 'Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select b.config->>'company' into v_company from public.external_org_bindings b
   where b.org_id = v_org and b.external_tier = p_tier and b.status = 'active' and b.activated_at is not null;
  return query
    select m.erp_name, m.account_name, m.parent_account from public.erp_account_mirror m
     where m.org_id = v_org and m.company = v_company and m.is_group and m.root_type = 'Expense' and not m.disabled
     order by m.lft, m.erp_name;
end $$;

-- Queues the send. The org is the caller's; the actor is auth.uid(). Every rule is re-checked here (the screen is not the authority):
-- an active Admin or Finance member, an activated ERPNext connection with a company, a known budget category that has no push account yet,
-- a non-blank name, and a parent that is a mirrored expense group of the bound company. Returns the queued send's id.
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
               and pmo_ids[1] = v_category::text and (state = 'sending' or (state = 'open' and reason = 'held'))) then
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

-- C1 for accounts: a category that already has a push account is never sent again (the drain asks before any ERP call). Every other arm is
-- byte for byte what 0741 shipped. Same signature, same grants (replace).
create or replace function public.connect_send_existing_link(p_org_id uuid, p_tier text, p_kind text, p_pmo text) returns text
language sql security definer set search_path = public, pg_temp as $$
  select case p_kind
    when 'party' then (select r.external_record_id from public.external_refs r
                        where r.org_id = p_org_id and r.domain = 'companies' and r.pmo_record_id = p_pmo)
    when 'project' then case when p_tier = 'odoo'
                          then (select b.external_container_id from public.external_project_bindings b
                                 where b.org_id = p_org_id and b.external_tier = 'odoo' and b.project_id::text = p_pmo)
                          else (select b.config->'project_map'->>p_pmo from public.external_org_bindings b
                                 where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
                        end
    when 'item' then (select b.config->'item_map'->>p_pmo from public.external_org_bindings b
                       where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
    when 'account' then (select m.erp_account from public.budget_category_account_map m
                          where m.org_id = p_org_id and m.category::text = p_pmo and m.is_push_target limit 1)
  end
$$;

-- #1599: the two texts a send can end with that point into the ERP name no ERP step for an account (owner ruling: PMO is the client's only
-- interface). Every other kind and every other line is byte for byte what 0494 shipped. Same signatures, same grants (replace).
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

-- Correct historical account reasons for direct table consumers as well as the proposal API.
update public.erp_connect_proposals
   set reason_text = replace(reason_text, '; your administrator has been told.', '. Contact your administrator.')
 where kind = 'account'
   and reason_text in (
     'PMO could not create the account; your administrator has been told.',
     'PMO could not confirm whether the account was created; your administrator has been told.'
   );

revoke all on function public.request_account_send(text, text, text, text), public.account_send_groups(text) from public, anon;
grant execute on function public.request_account_send(text, text, text, text), public.account_send_groups(text) to authenticated;   -- Admin/Finance, re-asserted in each body

-- Store the cross-parent disclosure in the same transaction as the link.
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
revoke all on function public.record_connect_send_result(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_connect_send_result(uuid, uuid, text, text, text) to service_role;
