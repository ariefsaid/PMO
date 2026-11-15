-- #1855: an Admin imports PMO-native purchase history (no accounting system involved).
-- Each row becomes an ordinary PMO purchase that starts at its furthest document (ADR-0093): the documents are inserted
-- and the existing derivation sets the status. The importing Admin is the requester; no approver and no approved amount
-- are invented (an unpaid purchase stays payable by a real approver, as a captured one is). Nothing is sent to an ERP.
-- Rollback: rollback/0890_import_purchase_history_down.sql
-- The CLI guard-list entry is a separate, later migration.

-- One row per imported purchase: the idempotency key and the audit of who vouched for the approval made outside PMO.
create table public.purchase_history_imports (
  org_id uuid not null references public.organizations(id),
  import_key text not null check (import_key = btrim(import_key) and char_length(import_key) between 1 and 120),
  procurement_id uuid not null unique references public.procurements(id) on delete restrict,
  payload jsonb not null,
  approved_outside_pmo_by text not null,
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now(),
  primary key (org_id, import_key)
);
create index purchase_history_imports_imported_by_idx on public.purchase_history_imports(imported_by);
alter table public.purchase_history_imports enable row level security;
alter table public.purchase_history_imports force row level security;
create policy purchase_history_imports_select on public.purchase_history_imports for select to authenticated
using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
       and (select public.auth_role()) in ('Admin','Finance','Executive','Project Manager'));
revoke all on public.purchase_history_imports from public, anon, authenticated;
grant select on public.purchase_history_imports to authenticated;

create function public.assert_purchase_history_rollback_safe() returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if exists (select 1 from public.purchase_history_imports) then
    raise exception 'purchase_history_exists' using errcode = '55000';
  end if;
end $$;
revoke all on function public.assert_purchase_history_rollback_safe() from public, anon, authenticated;

-- One row, end to end. A refused row raises PFE02 (message = reason); a dry run raises PFE01 after building its result,
-- so both roll the row's writes back without touching the other rows of the batch.
create function public.import_purchase_history_row(p_row jsonb, p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_actor uuid := auth.uid();
  v_key text := btrim(p_row->>'import_key'); v_old record; v_pid uuid; v_inv uuid;
  v_project uuid; v_vendor uuid; v_cat public.budget_category; v_po jsonb; v_rc jsonb; v_in jsonb; v_py jsonb; v_line jsonb;
  v_gross numeric; v_status text; v_payable text; v_total numeric; v_result jsonb;
  v_state text; v_detail text; v_msg text; v_reason text;
begin
  if v_key is null or v_key = '' or char_length(v_key) > 120 then
    return jsonb_build_object('import_key', p_row->>'import_key', 'outcome','refused','reason','import_key_required','erp_write',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':purchase-history:' || v_key, 0));
  select * into v_old from public.purchase_history_imports where org_id = v_org and import_key = v_key;
  if found then
    if v_old.payload is distinct from p_row then
      return jsonb_build_object('import_key',v_key,'outcome','refused','reason','import_key_payload_changed','procurement_id',v_old.procurement_id,'erp_write',false);
    end if;
    return jsonb_build_object('import_key',v_key,'outcome','skip','reason','already_imported','procurement_id',v_old.procurement_id,'erp_write',false);
  end if;
  begin
    v_project := (p_row->>'project_id')::uuid; v_vendor := (p_row->>'vendor_id')::uuid;
    if v_project is null or v_vendor is null or nullif(btrim(p_row->>'title'),'') is null
       or nullif(btrim(p_row->>'approved_outside_pmo_by'),'') is null then
      raise exception using errcode='PFE02', message='required_field_missing';
    end if;
    if p_row ? 'budget_category' then v_cat := (p_row->>'budget_category')::public.budget_category; end if;
    if not exists (select 1 from public.projects where id = v_project and org_id = v_org) then
      raise exception using errcode='PFE02', message='project_not_found';
    end if;
    if not exists (select 1 from public.companies where id = v_vendor and org_id = v_org and type = 'Vendor' and archived_at is null) then
      raise exception using errcode='PFE02', message='vendor_not_found';
    end if;
    v_po := p_row->'order'; v_rc := p_row->'receipt'; v_in := p_row->'invoice'; v_py := p_row->'payment';
    if v_po is null and v_rc is null and v_in is null and v_py is null then
      raise exception using errcode='PFE02', message='no_documents';
    end if;
    if v_py is not null and v_in is null then
      raise exception using errcode='PFE02', message='payment_needs_invoice';
    end if;
    if v_py is not null and coalesce((v_py->>'amount')::numeric,0) <= 0 then
      raise exception using errcode='PFE02', message='payment_amount_invalid';
    end if;
    if v_in is not null and (coalesce((v_in->>'amount')::numeric,0) <= 0 or coalesce(v_in->>'tax_treatment','exclusive') not in ('inclusive','exclusive')
        or coalesce((v_in->>'tax_amount')::numeric,0) < 0) then
      raise exception using errcode='PFE02', message='invoice_invalid';
    end if;
    if v_po is not null and coalesce((v_po->>'amount')::numeric,0) < 0 then
      raise exception using errcode='PFE02', message='order_amount_invalid';
    end if;
    v_gross := case when v_in is null then null else (v_in->>'amount')::numeric
                 + case when coalesce(v_in->>'tax_treatment','exclusive') = 'exclusive' then coalesce((v_in->>'tax_amount')::numeric,0) else 0 end end;
    -- A history row is settled or open, never half: a smaller payment would still derive Paid and strand the rest.
    if v_py is not null and v_gross is not null and (v_py->>'amount')::numeric is distinct from v_gross then
      raise exception using errcode='PFE02', message='payment_must_match_invoice';
    end if;
    insert into public.procurements(org_id, code, title, requested_by_id, project_id, vendor_id, budget_category)
    values (v_org, public.next_procurement_doc_number(v_org,'PROC'), btrim(p_row->>'title'), v_actor, v_project, v_vendor, v_cat)
    returning id into v_pid;
    for v_line in select value from jsonb_array_elements(coalesce(p_row->'lines','[]'::jsonb)) loop
      insert into public.procurement_items(org_id, procurement_id, name, description, quantity, rate)
      values (v_org, v_pid, v_line->>'name', v_line->>'description', (v_line->>'quantity')::numeric, (v_line->>'rate')::numeric);
    end loop;
    -- Documents go in low to high; each insert runs the same record gates and status derivation as an app entry.
    if v_po is not null then
      insert into public.purchase_orders(org_id, procurement_id, po_number, reference_number, status, date, amount)
      values (v_org, v_pid, v_po->>'number', v_po->>'reference', 'Issued', (v_po->>'date')::date, (v_po->>'amount')::numeric);
    end if;
    if v_rc is not null then
      insert into public.procurement_receipts(org_id, procurement_id, gr_number, reference_number, receipt_date, status)
      values (v_org, v_pid, v_rc->>'number', v_rc->>'reference', (v_rc->>'date')::date, coalesce(v_rc->>'status','Complete')::public.procurement_receipt_status);
    end if;
    if v_in is not null then
      v_status := case when v_py is not null and (v_py->>'amount')::numeric = v_gross then 'Paid' else 'Received' end;
      insert into public.procurement_invoices(org_id, procurement_id, vi_number, reference_number, invoice_date, status, amount, tax_treatment, tax_amount)
      values (v_org, v_pid, v_in->>'number', v_in->>'reference', (v_in->>'date')::date, v_status::public.procurement_invoice_status,
              (v_in->>'amount')::numeric, coalesce(v_in->>'tax_treatment','exclusive'), coalesce((v_in->>'tax_amount')::numeric,0))
      returning id into v_inv;
    end if;
    if v_py is not null then
      insert into public.payments(org_id, procurement_id, invoice_id, pay_number, reference_number, status, date, amount, recorded_by_id)
      values (v_org, v_pid, v_inv, v_py->>'number', v_py->>'reference', 'Paid', (v_py->>'date')::date, (v_py->>'amount')::numeric, v_actor);
    end if;
    select status::text, total_value into v_status, v_total from public.procurements where id = v_pid;
    -- A purchase with no approval trail is payable unless the organization requires approval before payment.
    v_payable := case when v_status = 'Paid' then null else public.procurement_payment_allowed(v_pid) end;
    insert into public.purchase_history_imports(org_id, import_key, procurement_id, payload, approved_outside_pmo_by, imported_by)
    values (v_org, v_key, v_pid, p_row, btrim(p_row->>'approved_outside_pmo_by'), v_actor);
    perform public.log_audit('procurement.history_import', v_org, v_actor, v_pid,
      jsonb_build_object('import_key', v_key, 'approved_outside_pmo_by', btrim(p_row->>'approved_outside_pmo_by'), 'status', v_status, 'erp_write', false));
    v_result := jsonb_build_object('import_key',v_key,'outcome','create','would_create',p_dry_run,'procurement_id',case when p_dry_run then null else v_pid end,
      'status',v_status,'total_value',v_total,'erp_write',false,
      'payable', v_payable is null, 'warnings', case when v_payable is null then '[]'::jsonb else jsonb_build_array('not_payable:' || v_payable) end);
    if p_dry_run then raise exception using errcode='PFE01', message='dry run'; end if;
  exception
    when sqlstate 'PFE01' then null;
    when sqlstate 'PFE02' then
      return jsonb_strip_nulls(jsonb_build_object('import_key',v_key,'outcome','refused','reason',sqlerrm,'erp_write',false,
        'message',case sqlerrm when 'payment_needs_invoice' then 'a payment needs its invoice: add the invoice to this row'
                                when 'payment_must_match_invoice' then 'the payment must equal the invoice total (amount plus exclusive tax)' end));
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
      -- A transient failure is not bad data: let the whole call fail and be rerun (nothing of this row is stored).
      if v_state in ('40001','40P01') then raise; end if;
      v_msg := sqlerrm;
      v_reason := case
        when v_detail = 'gate_approval_before_payment' then 'approval_before_payment_on'
        when v_state = '23514' and coalesce(v_detail,'') like 'gate\_%' then v_detail  -- the app's own record gates, with their own text
        when v_state = '22P02' then 'invalid_value'
        when v_state in ('22007','22008') then 'invalid_date'
        when v_state in ('22003') then 'invalid_number'
        when v_state = '23502' then 'required_field_missing'
        when v_state in ('22023','22030','22032','42804') then 'invalid_shape'
        else null end;
      if v_reason = 'approval_before_payment_on' then
        v_msg := 'approval before payment is on: record an approved amount or turn it off for the import';
      elsif v_reason is not null and v_reason not like 'gate\_%' then
        v_msg := null;
      end if;
      return jsonb_strip_nulls(jsonb_build_object('import_key',v_key,'outcome','refused','reason',coalesce(v_reason,sqlerrm),
        'message',v_msg,'erp_write',false));
  end;
  return v_result;
end $$;
revoke all on function public.import_purchase_history_row(jsonb,boolean) from public, anon, authenticated, service_role;

-- The public entry. The actor and organization come from the session; only an active Admin may import.
create function public.import_purchase_history(p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_row jsonb; v_res jsonb := '[]'::jsonb; v_one jsonb;
  v_seen text[] := '{}'; v_key text; v_n integer := 0;
begin
  if v_actor is null or v_org is null or not coalesce(public.is_active_member(), false)
     or public.auth_role()::text is distinct from 'Admin'
     or exists (select 1 from auth.users u where u.id = v_actor and u.banned_until is not null and u.banned_until > now()) then
    raise exception 'Only an active Admin can import purchase history.' using errcode = '42501';
  end if;
  perform public.assert_feature_on(v_org, 'procurement');
  -- The import is for an organization whose purchasing PMO owns; with an accounting system owning it, purchases come from capture.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement_externally_owned' using errcode = '42501';
  end if;
  if p_dry_run is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'invalid_history_rows' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_row) k where k not in
         ('import_key','title','project_id','vendor_id','budget_category','approved_outside_pmo_by','lines','order','receipt','invoice','payment')) then
      raise exception 'invalid_history_rows' using errcode = '22023';
    end if;
    v_key := btrim(v_row->>'import_key');
    if v_key is not null and v_key = any(v_seen) then raise exception 'duplicate_import_key' using errcode = '22023'; end if;
    v_seen := array_append(v_seen, v_key);
  end loop;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_one := public.import_purchase_history_row(v_row, p_dry_run);
    v_res := v_res || jsonb_build_array(v_one);
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'erp_write', false, 'results', v_res,
    'counts', jsonb_build_object(
      'create', (select count(*) from jsonb_array_elements(v_res) r where r->>'outcome' = 'create'),
      'skip', (select count(*) from jsonb_array_elements(v_res) r where r->>'outcome' = 'skip'),
      'refused', (select count(*) from jsonb_array_elements(v_res) r where r->>'outcome' = 'refused'),
      'not_payable', (select count(*) from jsonb_array_elements(v_res) r where r->>'outcome' = 'create' and (r->>'payable')::boolean is false)));
end $$;
revoke all on function public.import_purchase_history(jsonb,boolean) from public, anon, service_role;
grant execute on function public.import_purchase_history(jsonb,boolean) to authenticated;
