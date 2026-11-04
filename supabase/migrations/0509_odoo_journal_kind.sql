-- 0509_odoo_journal_kind.sql (#1505 O2 P2, SD-4, DD-OPP-6, FR-OPP-093, OQ-OPP-6)
-- Journals join the Odoo directory mirror (one more kind, no new table), and an organisation picks the default payment journal
-- once: Admin or Finance (or a platform Operator), recorded with who and when, audited.
-- Reversal: rollback/0509_odoo_journal_kind_down.sql.

alter table public.external_master_records drop constraint external_master_records_kind_check;
alter table public.external_master_records add constraint external_master_records_kind_check
  check (kind in ('company','partner','product','uom','warehouse','location','account','tax','analytic_plan','analytic_account','journal'));

-- Keep in step with the table's kind check and DIRECTORY_KINDS in adapterSeam/odoo/kinds.ts.
create or replace function public.assert_odoo_master_kind(p_kind text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('company','partner','product','uom','warehouse','location',
                                      'account','tax','analytic_plan','analytic_account','journal') then
    raise exception 'unknown Odoo kind' using errcode = '22023';
  end if;
end $$;

-- The default is a bank or cash journal of this connection, live and still returned by Odoo. Money leaves from it unless
-- Finance picks another per payment; a posted payment is never rewritten by a later change of the default.
create or replace function public.set_odoo_payment_journal_default(p_org_id uuid, p_actor_id uuid, p_journal_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state jsonb; v_operator boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  -- standing and role rows are held through the write, so a demotion cannot interleave
  perform 1 from public.profiles where id = p_actor_id for share;
  perform 1 from auth.users where id = p_actor_id for share;
  select true into v_operator from public.platform_operators where user_id = p_actor_id for share;
  v_state := public.actor_authorization_state(p_org_id, p_actor_id);
  if not coalesce((v_state->>'active')::boolean, false) then
    raise exception 'active organization member required' using errcode = '42501';
  end if;
  if not (coalesce(v_operator, false) or v_state->>'role' in ('Admin', 'Finance')) then
    raise exception 'current authority required' using errcode = '42501';
  end if;
  perform public.assert_odoo_activated(p_org_id);
  perform 1 from public.external_org_bindings where org_id = p_org_id and external_tier = 'odoo' and status = 'active' for update;
  if p_journal_id !~ '^[0-9]{1,9}$' or not exists (select 1 from public.external_master_records
       where org_id = p_org_id and external_tier = 'odoo' and kind = 'journal' and external_id = p_journal_id
         and active and tombstoned_at is null and attrs ->> 'type' in ('bank', 'cash')) then
    raise exception 'not a bank or cash journal of this connection' using errcode = 'P0001';
  end if;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'default_payment_journal_id', p_journal_id::int, 'default_payment_journal_id_set_by', p_actor_id, 'default_payment_journal_id_set_at', now())
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active';
  perform public.log_audit('integration.odoo.payment_journal', p_org_id, p_actor_id, null, jsonb_build_object('journal', p_journal_id));
end $$;
revoke all on function public.set_odoo_payment_journal_default(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.set_odoo_payment_journal_default(uuid,uuid,text) to service_role;
