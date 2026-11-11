-- #1506 C5: Odoo customer receipts (AC-OCI-040/042/043/044/046/063).
-- The O2 default_payment_journal_id is the inbound bank/cash journal too; receipts need its inbound method line,
-- while client withholding adds one org-scoped tax-prepaid account. No separate receipt-journal key is required.
-- Reversal: rollback/0512_odoo_receipt_defaults_down.sql.

alter table public.incoming_payments
  add column if not exists recorded_by_id uuid references public.profiles(id);

-- One live Odoo receipt command per invoice. A confirmed receipt releases the invoice for a later partial receipt.
create unique index external_command_outbox_one_inflight_odoo_receipt_per_invoice
  on public.external_command_outbox (org_id, (payload->>'salesInvoiceId'))
  where external_tier = 'odoo' and domain = 'revenue' and payload->>'erp_doc_kind' = 'incoming-payment'
    and payload->>'salesInvoiceId' is not null
    and state in ('pending','committing','committed','quarantined','held');

-- The selected account is revalidated against the active mirrored Odoo directory before every withheld receipt.
-- The RPC's caller is the verified JWT actor passed by the edge function; clients cannot call this function directly.
create or replace function public.set_odoo_tax_prepaid_account(p_org_id uuid, p_actor_id uuid, p_account_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state jsonb; v_company_id text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = p_actor_id for share;
  perform 1 from auth.users where id = p_actor_id for share;
  v_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if not coalesce((v_state->>'active')::boolean, false) then
    raise exception 'active organization member required' using errcode = '42501';
  end if;
  if not coalesce(v_state->>'role' in ('Admin', 'Finance'), false) then
    raise exception 'current authority required' using errcode = '42501';
  end if;
  perform public.assert_odoo_activated(p_org_id);
  select config->>'odoo_company_id' into v_company_id
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active'
   for update;
  if v_company_id is null or p_account_id !~ '^[0-9]{1,9}$' or not exists (
    select 1 from public.external_master_records
     where org_id = p_org_id and external_tier = 'odoo' and kind = 'account'
       and external_id = p_account_id and active and tombstoned_at is null
       and attrs->>'account_type' in ('asset_current', 'asset_prepayments')
       and jsonb_typeof(attrs->'company_ids') = 'array'
       and exists (select 1 from jsonb_array_elements_text(attrs->'company_ids') c(id) where c.id = v_company_id)
  ) then
    raise exception 'not a tax-prepaid account of this connection' using errcode = 'P0001';
  end if;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'tax_prepaid_account_id', p_account_id::int,
           'tax_prepaid_account_id_set_by', p_actor_id,
           'tax_prepaid_account_id_set_at', now())
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active';
  perform public.log_audit('integration.odoo.tax_prepaid_account', p_org_id, p_actor_id, null, jsonb_build_object('account', p_account_id));
end $$;
revoke all on function public.set_odoo_tax_prepaid_account(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.set_odoo_tax_prepaid_account(uuid,uuid,text) to service_role;

-- Extend the 0508 operator resolution route to receipts while retaining every creator/org/role/state check.
create or replace function public.resolve_held_outbox_command(
  p_outbox_id uuid, p_resolution text, p_external_record_id text default null, p_reason text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_org     uuid;
  v_state   text;
  v_domain  text;
  v_tier    text;
  v_creator uuid;
  v_record  text;
  v_payload jsonb;
  v_kind    text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select o.org_id, o.state, o.domain, o.external_tier, o.actor_user_id, o.pmo_record_id, o.payload, o.payload->>'erp_doc_kind'
    into v_org, v_state, v_domain, v_tier, v_creator, v_record, v_payload, v_kind
    from public.external_command_outbox o where o.id = p_outbox_id for update;
  if v_org is null then
    raise exception 'outbox command not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from public.auth_org_id()
     or public.auth_role() not in ('Admin', 'Finance')
     or not public.is_active_member()
     or v_creator is null
     or v_creator = v_actor then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_state is distinct from 'held' then
    raise exception 'outbox command is % — only a held command can be resolved', v_state using errcode = 'P0001';
  end if;
  if v_tier is distinct from 'odoo'
     or not ((v_domain = 'procurement' and v_kind = 'payment') or (v_domain = 'revenue' and v_kind = 'incoming-payment')) then
    raise exception 'only a held Odoo vendor payment or customer receipt can be resolved here' using errcode = 'P0001';
  end if;

  if p_resolution = 'adopt' then
    if p_external_record_id is null or p_external_record_id !~ '^account\.payment:[0-9]+$' then
      raise exception 'adopt names an Odoo payment as account.payment:<id>' using errcode = '22023';
    end if;
    if exists (select 1 from public.external_refs r
                where r.org_id = v_org and r.external_tier = 'odoo' and r.external_record_id = p_external_record_id
                  and not (r.domain = v_domain and r.pmo_record_id = v_record)) then
      raise exception '% is already linked to another record', p_external_record_id using errcode = 'P0001';
    end if;
    v_payload := v_payload || jsonb_build_object('odoo_adopted_ref', p_external_record_id);
  elsif p_resolution = 'absent' then
    if p_external_record_id is not null then
      raise exception 'absent names no document' using errcode = '22023';
    end if;
    v_payload := v_payload || jsonb_build_object('odoo_absent_confirmed', true);
  else
    raise exception 'resolution must be adopt or absent' using errcode = '22023';
  end if;

  update public.external_command_outbox
     set state            = 'failed',
         payload          = v_payload,
         last_error       = 'hold resolved (' || p_resolution || ') by operator ' || v_actor::text || ': ' || coalesce(p_reason, ''),
         claim_generation = claim_generation + 1,
         updated_at       = now()
   where id = p_outbox_id;

  perform public.log_audit(
    'resolve_held_outbox_command', v_org, v_actor, p_outbox_id,
    jsonb_build_object('resolution', p_resolution, 'external_record_id', p_external_record_id, 'reason', p_reason, 'resolved_from', v_state)
  );
end;
$$;

revoke all on function public.resolve_held_outbox_command(uuid, text, text, text) from public;
grant execute on function public.resolve_held_outbox_command(uuid, text, text, text) to authenticated;
revoke execute on function public.resolve_held_outbox_command(uuid, text, text, text) from anon;
