-- Record historical journal costs without writing to the accounting system.
-- Rollback: rollback/0858_record_only_journal_down.sql
alter table public.procurements
  add column record_only boolean not null default false,
  add column record_only_stage text,
  add column record_only_date date,
  add column record_only_reference text;

-- Request identity and source history remain after the purchase is undone.
create table public.erp_purchase_captures (
  procurement_id uuid primary key references public.procurements(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  request_id uuid not null,
  payload jsonb not null,
  kind text not null check (kind in ('order','receipt','supplier_invoice','supplier_payment','journal','adjustment')),
  stage text not null check (stage in ('draft','ordered','received','invoiced','part_paid','paid','cancelled')),
  captured_by uuid not null references public.profiles(id),
  captured_at timestamptz not null default now(),
  undone_at timestamptz,
  undo_reason text,
  unique (org_id, request_id)
);
create index erp_purchase_captures_org_binding_idx on public.erp_purchase_captures(org_id,binding_id);
alter table public.erp_purchase_captures enable row level security;
alter table public.erp_purchase_captures force row level security;
create policy erp_purchase_captures_select on public.erp_purchase_captures for select to authenticated
using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
       and (select public.auth_role()) in ('Admin','Finance','Executive','Project Manager'));
revoke all on public.erp_purchase_captures from public, anon, authenticated;
grant select on public.erp_purchase_captures to authenticated;

create function public.guard_erp_purchase_capture_org() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.procurements where id=new.procurement_id and org_id=new.org_id)
     or not exists (select 1 from public.external_org_bindings where id=new.binding_id and org_id=new.org_id)
     or not exists (select 1 from public.profiles where id=new.captured_by and org_id=new.org_id) then
    raise exception 'capture_org_mismatch' using errcode='23514';
  end if;
  return new;
end $$;
create trigger erp_purchase_captures_org_guard before insert or update on public.erp_purchase_captures
for each row execute function public.guard_erp_purchase_capture_org();

create function public.assert_record_only_rollback_safe() returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if exists (select 1 from public.erp_purchase_captures) then
    raise exception 'record_only_history_exists' using errcode='55000';
  end if;
end $$;
revoke all on function public.assert_record_only_rollback_safe() from public, anon, authenticated;

-- A source key is the 0687 stable tuple (doctype, voucher, project, account), scoped by session org.
create function public.create_record_only_journal_purchase(p_group jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_actor uuid := auth.uid();
  v_request uuid; v_project uuid; v_vendor uuid; v_purchase uuid; v_old jsonb;
  v_currency text; v_binding uuid; v_bindings integer; v_title text; v_reference text; v_line jsonb; v_source record;
  v_total numeric := 0; v_date date; v_sources jsonb := '[]'::jsonb; v_party uuid; v_key text; v_seen text[] := '{}';
begin
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_request := (p_group->>'request_id')::uuid;
  v_project := (p_group->>'project_id')::uuid;
  v_vendor := (p_group->>'vendor_id')::uuid;
  v_title := nullif(btrim(p_group->>'title'), '');
  v_reference := nullif(btrim(p_group->>'reference'), '');
  if v_request is null or v_project is null or v_vendor is null or v_title is null then
    raise exception 'required_field_missing' using errcode = '22023';
  end if;
  if jsonb_typeof(p_group->'journal_lines') is distinct from 'array'
     or jsonb_array_length(p_group->'journal_lines') not between 1 and 500 then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':journal-request:' || v_request::text, 0));
  select procurement_id, payload into v_purchase, v_old from public.erp_purchase_captures
   where org_id = v_org and request_id = v_request;
  if found then
    if v_old is distinct from p_group then raise exception 'request_payload_changed' using errcode = '22023'; end if;
    select total_value, currency, record_only_date into v_total, v_currency, v_date from public.procurements where id=v_purchase and org_id=v_org;
    return jsonb_build_object('outcome','skip','reason','already_recorded','would_create',false,'procurement_id',v_purchase,
      'amount',v_total,'currency',v_currency,'erp_write',false,'request_id',v_request,'source_keys',p_group->'journal_lines',
      'project_id',v_project,'vendor_id',v_vendor,'reference',v_reference,'assignment_origin','erp_project',
      'actuals_delta',0,'source_date',v_date,'stage','already_settled_in_erp');
  end if;
  if not exists (select 1 from public.projects where id = v_project and org_id = v_org) then
    raise exception 'project_not_found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.companies where id = v_vendor and org_id = v_org and type = 'Vendor' and archived_at is null) then
    raise exception 'vendor_not_found' using errcode = '22023';
  end if;
  if not public.org_reads_erp_ledger() then raise exception 'ledger_basis_missing' using errcode = '22023'; end if;
  select count(*), (array_agg(id))[1] into v_bindings, v_binding from public.external_org_bindings where org_id=v_org and activated_at is not null;
  if v_bindings <> 1 then raise exception 'ambiguous_binding' using errcode='22023'; end if;
  select default_currency into v_currency from public.organizations where id = v_org;
  if v_currency is null or btrim(v_currency) = '' then raise exception 'currency_missing' using errcode = '22023'; end if;
  -- Serialize source groups in deterministic key order, including groups that do not yet have a link row.
  for v_line in select value from jsonb_array_elements(p_group->'journal_lines')
    order by jsonb_build_array(value->>'erp_doctype',value->>'voucher_no',value->>'project_id',value->>'account')::text loop
    if (v_line->>'project_id')::uuid is distinct from v_project then
      raise exception 'project_mismatch' using errcode = '22023';
    end if;
    v_key := jsonb_build_array(v_line->>'erp_doctype',v_line->>'voucher_no',v_project,v_line->>'account')::text;
    if v_key = any(v_seen) then raise exception 'duplicate_line' using errcode = '22023'; end if;
    v_seen := array_append(v_seen,v_key);
    v_sources := v_sources || jsonb_build_array(v_line);
    perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_key, 0));
    select * into v_source from public.erp_journal_cost_lines(v_org, v_project, v_line->>'voucher_no')
     where erp_doctype = v_line->>'erp_doctype' and account = v_line->>'account';
    if not found then raise exception 'line_not_found' using errcode = '22023'; end if;
    if v_source.is_cancelled or v_source.amount <= 0 then raise exception 'line_not_positive_or_cancelled' using errcode = '22023'; end if;
    -- Inspect underlying mapped GL rows before accepting the aggregate: a credit is not silently netted into a purchase.
    if exists (
      select 1 from public.erp_gl_entry_mirror g
       where g.org_id=v_org and g.voucher_type=v_source.erp_doctype and g.voucher_no=v_source.voucher_no
         and g.account=v_source.account and not g.is_cancelled and coalesce(g.debit,0)-coalesce(g.credit,0)<0
         and g.project in (
           select m.value from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) m
            where b.org_id=v_org and b.external_tier='erpnext' and b.activated_at is not null and m.key=v_project::text
           union all
           select pb.external_container_id from public.external_project_bindings pb
            where pb.org_id=v_org and pb.project_id=v_project and pb.external_tier='odoo'
              and exists (select 1 from public.external_org_bindings b where b.org_id=v_org and b.external_tier='odoo' and b.activated_at is not null)
         )
    ) then raise exception 'negative_line_requires_review' using errcode='22023'; end if;
    if exists (select 1 from public.erp_journal_line_links where org_id=v_org and erp_doctype=v_source.erp_doctype
       and voucher_no=v_source.voucher_no and project_id=v_project and account=v_source.account) then
      raise exception 'line_already_attached' using errcode = '22023';
    end if;
    if v_source.party is null or btrim(v_source.party) = '' then
      if coalesce((p_group->>'vendor_confirmed')::boolean,false) is not true then
        raise exception 'vendor_confirmation_required' using errcode = '22023';
      end if;
    else
      v_party := public.erp_supplier_company(v_org, v_source.party, v_source.party);
      if v_party is distinct from v_vendor then raise exception 'supplier_mismatch' using errcode = '22023'; end if;
    end if;
    v_total := v_total + v_source.amount;
    v_date := least(v_date, v_source.posting_date);
  end loop;
  if p_dry_run then
    return jsonb_build_object('outcome','create','would_create',true,'procurement_id',null,'amount',v_total,'currency',v_currency,'erp_write',false,'request_id',v_request,'source_keys',v_sources,'project_id',v_project,'vendor_id',v_vendor,'reference',v_reference,'assignment_origin','erp_project','actuals_delta',0,'source_date',v_date,'stage','already_settled_in_erp');
  end if;
  insert into public.procurements(org_id, code, title, requested_by_id, project_id, vendor_id, currency, total_value, origin, record_only, record_only_stage, record_only_date, record_only_reference, status)
  values(v_org, public.next_procurement_doc_number(v_org,'PROC'), v_title, v_actor, v_project, v_vendor, v_currency, v_total, 'erp_link', true, 'already_settled_in_erp', v_date, v_reference, 'Paid')
  returning id into v_purchase;
  for v_line in select value from jsonb_array_elements(v_sources) loop
    insert into public.erp_journal_line_links(org_id,procurement_id,erp_doctype,voucher_no,project_id,account,linked_by)
    values(v_org,v_purchase,v_line->>'erp_doctype',v_line->>'voucher_no',v_project,v_line->>'account',v_actor);
  end loop;
  insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
  values(v_org,v_binding,v_request,v_purchase,p_group,'journal','paid',v_actor);
  perform public.log_audit('procurement.record_only_create',v_org,v_actor,v_purchase,
    jsonb_build_object('project_id',v_project,'vendor_id',v_vendor,'sources',v_sources,'reference',v_reference,
                       'assignment_origin','erp_project','before_project',v_project,'after_project',v_project,'actuals_delta',0));
  return jsonb_build_object('outcome','create','would_create',false,'procurement_id',v_purchase,'amount',v_total,'currency',v_currency,'erp_write',false,'request_id',v_request,'source_keys',v_sources,'project_id',v_project,'vendor_id',v_vendor,'reference',v_reference,'assignment_origin','erp_project','actuals_delta',0,'source_date',v_date,'stage','already_settled_in_erp');
end $$;
revoke all on function public.create_record_only_journal_purchase(jsonb,boolean) from public, anon;
grant execute on function public.create_record_only_journal_purchase(jsonb,boolean) to authenticated;

-- This single policy point is temporary: a later release can allow individual forward steps here.
create function public.record_only_step_refusal(p_procurement_id uuid) returns text
language sql stable security definer set search_path = public, pg_catalog as $$
  select case when p.record_only then 'record_only_forward_step_refused' end
    from public.procurements p where p.id = p_procurement_id
$$;
revoke all on function public.record_only_step_refusal(uuid) from public, anon, authenticated;
grant execute on function public.record_only_step_refusal(uuid) to service_role;

create function public.guard_record_only_status() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.status is distinct from old.status and public.record_only_step_refusal(old.id) is not null
     and not (new.status = 'Cancelled' and not exists (
       select 1 from public.erp_journal_line_links where procurement_id = old.id)) then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger procurements_record_only_status before update of status on public.procurements
for each row execute function public.guard_record_only_status();

-- Ordinary detach cannot split a record-only wrapper; complete undo owns that operation.
create or replace function public.detach_erp_journal_line(p_link_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_link public.erp_journal_line_links%rowtype; v_proc uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can detach a journal line.' using errcode = '42501';
  end if;
  select k.procurement_id into v_proc from public.erp_journal_line_links k
   where k.id = p_link_id and k.org_id = public.auth_org_id();
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform 1 from public.procurements where id = v_proc for update;
  if public.record_only_step_refusal(v_proc) is not null then
    raise exception 'record_only_use_undo' using errcode = '42501';
  end if;
  delete from public.erp_journal_line_links
   where id = p_link_id and org_id = public.auth_org_id() returning * into v_link;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform public.log_audit('procurement.journal_detach', v_link.org_id, auth.uid(), v_link.procurement_id,
    jsonb_build_object('erp_doctype', v_link.erp_doctype, 'voucher_no', v_link.voucher_no,
                       'project_id', v_link.project_id, 'account', v_link.account));
end $$;

create function public.undo_captured_purchase(p_procurement_id uuid, p_reason text, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_proc public.procurements%rowtype; v_history jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then raise exception 'not authorized' using errcode = '42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into v_proc from public.procurements where id=p_procurement_id and org_id=v_org for update;
  if not found or not v_proc.record_only then raise exception 'purchase_not_found' using errcode = 'P0002'; end if;
  select payload into v_history from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id;
  if not found then raise exception 'purchase_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.erp_purchase_captures where procurement_id=p_procurement_id and kind='journal') then raise exception 'unsupported_capture_kind' using errcode='22023'; end if;
  if v_proc.status = 'Cancelled' then return jsonb_build_object('outcome','skip','reason','already_undone'); end if;
  if not p_dry_run then
    delete from public.erp_journal_line_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.procurements set status='Cancelled', updated_at=now() where id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(), undo_reason=p_reason where procurement_id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history->'journal_lines','reason',p_reason,
                         'assignment_origin','erp_project','before_project',v_proc.project_id,'after_project',v_proc.project_id,'actuals_delta',0));
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false);
end $$;
revoke all on function public.undo_captured_purchase(uuid,text,boolean) from public, anon;
grant execute on function public.undo_captured_purchase(uuid,text,boolean) to authenticated;

create function public.guard_record_only_source() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if public.record_only_step_refusal(old.id) is not null and
    (new.total_value is distinct from old.total_value or new.project_id is distinct from old.project_id
      or new.vendor_id is distinct from old.vendor_id or new.currency is distinct from old.currency
      or new.origin is distinct from old.origin
      or new.record_only_stage is distinct from old.record_only_stage or new.record_only_date is distinct from old.record_only_date
      or new.record_only_reference is distinct from old.record_only_reference) then
    raise exception 'record_only_source_locked' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger procurements_a_record_only_source before update on public.procurements
for each row execute function public.guard_record_only_source();

create function public.guard_record_only_child() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if public.record_only_step_refusal(new.procurement_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger record_only_child_guard before insert or update on public.purchase_requests for each row execute function public.guard_record_only_child();
create trigger record_only_child_guard before insert or update on public.rfqs for each row execute function public.guard_record_only_child();
create trigger record_only_child_guard before insert or update on public.procurement_quotations for each row execute function public.guard_record_only_child();
create trigger record_only_child_guard before insert or update on public.purchase_orders for each row execute function public.guard_record_only_child();
create trigger record_only_child_guard before insert or update on public.procurement_receipts for each row execute function public.guard_record_only_child();
create trigger record_only_child_guard before insert or update on public.procurement_invoices for each row execute function public.guard_record_only_child();
create trigger record_only_child_guard before insert or update on public.payments for each row execute function public.guard_record_only_child();

-- A historical settled journal never creates a new commitment on source cancellation.
create or replace function public.procurement_ledger_held(p_procurement_id uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select case when exists (select 1 from public.erp_purchase_captures r where r.procurement_id = p.id and r.kind='journal' and r.undone_at is null) then p.total_value else coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
       + coalesce((select sum(greatest(l.amount, 0))                                        -- 0687 FR-JEC-021
                     from public.erp_journal_line_links k
                     cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l
                    where k.procurement_id = p.id
                      and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)
       end
    from public.procurements p
   where p.id = p_procurement_id and (auth.uid() is null or p.org_id = public.auth_org_id())
     -- 0350 Engineer purchasing scope: invoice money is for the four money roles only (else no row → null).
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())  -- 0372: an offboarded member's token reads nothing
$function$;

create or replace function public.procurement_ledger_held_many(p_ids uuid[])
 returns table(procurement_id uuid, held numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select p.id,
         case when exists (select 1 from public.erp_purchase_captures r where r.procurement_id = p.id and r.kind='journal' and r.undone_at is null) then p.total_value else coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
       + coalesce((select sum(greatest(l.amount, 0))                                        -- 0687 FR-JEC-021
                     from public.erp_journal_line_links k
                     cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l
                    where k.procurement_id = p.id
                      and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)
       end
    from public.procurements p
   where p.id = any (p_ids) and (auth.uid() is null or p.org_id = public.auth_org_id())
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())
$function$;

-- Permit the CLI to reach the Admin-checked record-only RPCs.
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project', 'import_budget_line_v2'];
  -- #1835 stage-date correction tier: exact RPC + read endpoint, active Admin only.
  stage_admin_rpcs constant text[] := array['redate_stage_entry'];
  stage_admin_tables constant text[] := array['project_stage_entries'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item',
    'attach_erp_journal_lines', 'project_erp_journal_lines', 'create_record_only_journal_purchase', 'undo_captured_purchase'];  -- 0688 (#1919)
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  -- ACTIVE-ADMIN `pmo rpc` TIER (#1326) — keep in step with scripts/pmo.mjs ADMIN_RPCS.  -- 0366
  admin_cli_rpcs constant text[] := array['recategorise_budget_lines'];  -- 0366
  -- OPERATOR READ TIER (`pmo get/documents/m365`, #1270) — keep in step with scripts/pmo.mjs.  -- 0367
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps',  -- 0367
    'contract_rate_lines', 'contract_rate_assignees'];  -- 0518
  operator_read_rpcs constant text[] := array['project_mapped_actuals', 'link_m365_documents_batch'];  -- 0367
  -- BUDGET OPS TIER (`pmo budgets`, #1270 B): the activation check. Same role set as the RPC's own check. A Draft's source
  -- file goes through link_m365_documents_batch (0367 tier, host-pinned). activate_budget_version is deliberately NOT here
  -- (owner has not ruled).  -- 0370
  budget_ops_rpcs constant text[] := array['budget_activation_mode'];  -- 0370
  -- ACTIVE-ADMIN ACCOUNT-MAP TIER (`pmo accounts map set`, #1270 B) — the same Admin rule as the table's own policy.  -- 0370
  account_map_tables constant text[] := array['budget_category_account_map'];  -- 0370
  account_map_rpcs constant text[] := array['set_budget_push_account'];  -- 0370
  -- COST ATTRIBUTION TIER (`pmo attribution`, #1271): preview/save/end for active Admin/Finance; list for the
  -- project-actuals audience. Same role sets as the RPCs' own checks.  -- 0376
  cost_attribution_write_rpcs constant text[] := array['preview_cost_attribution', 'save_cost_attribution_rule', 'end_cost_attribution_rule'];  -- 0376
  cost_attribution_read_rpcs constant text[] := array['list_cost_attribution_rules'];  -- 0376
  -- EQUIPMENT TIER (`pmo equipment`, #1519): costing preview/save/end for active Admin/Finance; costing and allocation
  -- reads for the amounts audience; usage totals for any active member. Same role sets as the RPCs' own checks.  -- 0497
  equipment_write_rpcs constant text[] := array['preview_equipment_costing', 'save_equipment_costing', 'end_equipment_costing'];  -- 0497
  equipment_read_rpcs constant text[] := array['list_equipment_costing', 'list_equipment_allocations'];  -- 0497
  equipment_usage_rpcs constant text[] := array['list_equipment_usage_totals'];  -- 0497
  -- TIME-AND-MATERIALS TIER (`pmo tm`, #1514): the rate and sign-off writers for active Admin/Finance; the claim list and
  -- preview for the amounts audience. Same role sets as the RPCs' own checks. The rate card itself is a table read, so
  -- `contract_rate_lines` and `contract_rate_assignees` join the operator read tier below; RLS stays the tenancy rule.  -- 0518
  tm_write_rpcs constant text[] := array['save_contract_rate_line', 'end_contract_rate_line', 'set_contract_rate_assignee', 'end_contract_rate_assignee', 'assemble_tm_claim', 'deselect_tm_source', 'prepare_tm_signoff', 'withdraw_tm_signoff', 'confirm_tm_signoff'];  -- 0518
  tm_read_rpcs constant text[] := array['list_tm_claims', 'preview_tm_claim', 'list_tm_claim_source_details'];  -- 0588
  -- NATIVE RECEIPT TIER (`pmo purchases receive` on a PMO-owned org, #1866): same role set as the RPC's own check.  -- 0702
  native_receipt_rpcs constant text[] := array['create_procurement_receipt'];  -- 0702
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (stage_admin_rpcs) then  -- 0585
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (purchase_rpcs) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (operator_read_rpcs) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'POST' and target = any (budget_ops_rpcs) then  -- 0370
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (account_map_rpcs) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (cost_attribution_write_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (cost_attribution_read_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (equipment_write_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_read_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_usage_rpcs) then  -- 0497
      if coalesce(public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (tm_write_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (tm_read_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (native_receipt_rpcs) then  -- 0702
      if coalesce(public.auth_role()::text in ('Admin', 'Project Manager') and public.is_active_member(), false) then  -- 0702
        return;  -- 0702
      end if;  -- 0702
    end if;  -- 0702
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (admin_cli_rpcs) then  -- 0366
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0366
        return;  -- 0366
      end if;  -- 0366
    end if;  -- 0366
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method in ('GET', 'POST') and target = any (account_map_tables) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'GET' and target = any (stage_admin_tables) then  -- 0585
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'GET' and target = any (operator_read_tables) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'GET' and target = any (purchase_read_views) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

create or replace function public.procurement_create_refusal(
  p_org_id uuid, p_procurement_id uuid, p_erp_doc_kind text, p_actor_user_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_step public.procurement_status;
  v_proc public.procurements;
  v_refusal text;
  v_linked_state text;
begin
  v_step := case p_erp_doc_kind
    when 'purchase-order'   then 'Ordered'::public.procurement_status
    when 'goods-receipt'    then 'Received'::public.procurement_status
    when 'purchase-invoice' then 'Vendor Invoiced'::public.procurement_status
    when 'payment'          then 'Paid'::public.procurement_status
  end;
  -- The foreground gate asks nothing of other kinds; neither does this.
  if v_step is null then return null; end if;
  if p_procurement_id is not null then
    select * into v_proc from public.procurements
     where id = p_procurement_id and org_id = p_org_id for update;
  end if;
  if v_proc.id is null then return 'purchase_not_found'; end if;
  v_refusal := public.record_only_step_refusal(v_proc.id);
  if v_refusal is not null then return v_refusal; end if;
  if p_erp_doc_kind in ('goods-receipt','purchase-invoice') then
    v_linked_state := public.linked_step_state(p_org_id, p_procurement_id, p_erp_doc_kind);
    if v_linked_state like 'already_in_erp_unlinked:%' then
      return 'ERP ' || substr(v_linked_state, 25) || ' already records this; link it instead of sending a new one.';
    elsif v_linked_state = 'already_in_erp' then
      return 'step_already_recorded';
    end if;
  end if;
  if p_erp_doc_kind = 'purchase-invoice' and v_proc.is_subcontract                                       -- 0475
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = v_proc.id) then -- 0475
    return 'subcontract_bill_lines_required';  -- PQ-9: #1505 replaces this with the cap over the payload  -- 0475
  end if;                                                                                                 -- 0475
  -- A payment: 0368's payment rule first (closed / awaiting approval / approval missing), then the order-step rules.
  if p_erp_doc_kind = 'payment' then
    v_refusal := public.procurement_payment_allowed(v_proc.id);
  end if;
  if v_refusal is null then
    v_refusal := public.procurement_gate_violation(v_proc.id, v_step);
  end if;
  if v_refusal is null and p_erp_doc_kind = 'payment' then
    if p_actor_user_id is null then
      v_refusal := 'actor_missing';
    elsif public.procurement_amount_approver(v_proc.id, p_actor_user_id) then                                 -- 0474
      v_refusal := 'separation_of_duties';
    elsif (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
      v_refusal := 'exceeds_approved_amount';
    end if;
  end if;
  return v_refusal;
end $$;
create or replace function public.insert_procurement_outbox_pending(
  p_org uuid, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid, p_case uuid, p_snapshot jsonb
) returns public.external_command_outbox
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.external_command_outbox; v_mismatch boolean; v_input_digest text;
begin

  if exists (select 1 from public.procurements where id=p_case and org_id=p_org)
     and public.record_only_step_refusal(p_case) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;
  perform public.assert_feature_on(p_org, 'procurement');
  if p_tier is distinct from 'erpnext' or p_operation is distinct from 'create'
     or public.procurement_case_uuid(p_payload->>'procurementId') is distinct from p_case
     or not coalesce(p_payload->>'erp_doc_kind' in ('purchase-order', 'goods-receipt', 'purchase-invoice'), false)
     or jsonb_typeof(p_snapshot) is distinct from 'array' then
    raise exception 'invalid procurement snapshot' using errcode = '22023';
  end if;
  if p_payload->>'erp_doc_kind' = 'goods-receipt' then
    v_input_digest := p_payload->'pmo_gr_snapshot'->>'raw_digest';
    if v_input_digest is null or v_input_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid receipt witness' using errcode = '22023';
    end if;
  end if;
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, payload_digest, actor_user_id, procurement_input_digest)
  values (p_org, 'procurement', p_record_id, p_key, p_tier, p_operation, 'pending', p_payload, p_digest, p_actor, v_input_digest)
  returning * into v_row;
  perform 1 from public.procurements where id = p_case and org_id = p_org for update;
  if not found then raise exception 'procurement case not found' using errcode = '42501'; end if;
  with current_lines as (
    select name, description, quantity::numeric as quantity, rate::numeric as rate
      from public.procurement_items where org_id = p_org and procurement_id = p_case
  ), snapshot_lines as (
    select x.name, x.description, x.quantity, x.rate
      from jsonb_to_recordset(p_snapshot) as x(name text, description text, quantity numeric, rate numeric)
  )
  select exists (
    (select * from current_lines except all select * from snapshot_lines)
    union all
    (select * from snapshot_lines except all select * from current_lines)
  ) into v_mismatch;
  if v_mismatch then raise exception 'procurement line snapshot changed' using errcode = '40001'; end if;
  return v_row;
end $$;

create or replace function public.po_revision_push_refusal(p_org uuid, p_po_id uuid, p_revision integer, p_revise_cancels boolean)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_proc uuid;
begin
  select o.procurement_id into v_proc from public.purchase_orders o where o.id = p_po_id and o.org_id = p_org;
  if v_proc is null then return 'po_not_found'; end if;
  if public.record_only_step_refusal(v_proc) is not null then return 'record_only_forward_step_refused'; end if;
  if p_revision is null or not exists (select 1 from public.purchase_order_revisions r
                                        where r.po_id = p_po_id and r.revision = p_revision and r.status = 'Issued') then
    return 'revision_not_issued';
  end if;
  if p_revision is distinct from public.po_effective_revision(p_po_id) then return 'revision_superseded'; end if;
  if coalesce(p_revise_cancels, true) and (
       exists (select 1 from public.procurement_invoices i
                where i.procurement_id = v_proc and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at))
       or exists (select 1 from public.procurement_erp_links k
                    join public.erp_purchase_documents d on d.id = k.erp_purchase_document_id
                   where k.procurement_id = v_proc and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1 and not d.pmo_owned)) then
    return 'po_has_submitted_bill';
  end if;
  return null;
end $$;

-- Once creation has completed, the ordinary attach route cannot add a source to this wrapper.
create function public.guard_record_only_journal_attach() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if exists (select 1 from public.erp_purchase_captures where procurement_id = new.procurement_id) then
    raise exception 'record_only_use_undo' using errcode = 'JEC02';
  end if;
  return new;
end $$;
create trigger record_only_journal_attach_guard before insert or update on public.erp_journal_line_links
for each row execute function public.guard_record_only_journal_attach();


-- An ordinary document link cannot change the source family of a captured journal purchase.
create function public.guard_record_only_erp_link() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if exists (select 1 from public.erp_purchase_captures where procurement_id = new.procurement_id and kind='journal') then
    raise exception 'record_only_use_undo' using errcode = 'PFE02';
  end if;
  return new;
end $$;
create trigger record_only_erp_link_guard before insert or update on public.procurement_erp_links
for each row execute function public.guard_record_only_erp_link();

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_pr_id uuid; v_pr_no text;                                                                          -- 0766
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- FR-PLN-006 closure: cancelling or rejecting an EXISTING purchase is a CLOSING transition (paid closes
  -- an already-invoiced one); a switch-off must not strand it. Every forward/minting transition is gated.
  if p_to is null or p_to::text not in ('Cancelled','Rejected','Paid') then
    perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds is a no-op — its current step, or a lower step it
  -- has evidence for (e.g. Received, then a request for Ordered once an order is recorded).
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid')
     and (v_from = p_to
          or (public.procurement_step_rank(p_to) < public.procurement_step_rank(v_from)
              and (exists (select 1 from public.purchase_orders x where p_to = 'Ordered' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_receipts x where p_to = 'Received' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_invoices x where p_to = 'Vendor Invoiced' and x.procurement_id = p_id
                                and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
                   or exists (select 1 from public.procurement_erp_links l
                                join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                               where l.procurement_id = p_id and d.erp_docstatus = 1
                                 and d.erp_doctype = case p_to::text when 'Ordered' then 'Purchase Order'
                                                     when 'Received' then 'Purchase Receipt' else 'Purchase Invoice' end)))) then
    return;
  end if;

  if public.record_only_step_refusal(p_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  -- 0749 (#1607): an ERP-owned purchase places its order through the connected system, never as a PMO-only row.
  if p_to = 'Ordered' and public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_id), false) then
    raise exception 'This purchase is managed in your connected system. Record the purchase order to place the order there.'
      using errcode = '42501';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null and v_category is not null then
      perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  end if;

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- 0766 (#1986): a purchase request captured while the purchase was still Draft is the request this transition submits.
  if p_to = 'Requested' then
    select r.id, r.pr_number into v_pr_id, v_pr_no from public.purchase_requests r
     where r.procurement_id = p_id and r.status = 'Draft' and r.import_key is null and r.pr_number is not null
       and (select pr_number from public.procurements where id = p_id) is null
     order by r.created_at limit 1 for update;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, v_pr_no, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' and v_pr_id is not null then
    update public.purchase_requests set status = 'Submitted' where id = v_pr_id;
  elsif p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;

create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  -- Header edits are allowed only to the requester or Admin while Draft/Rejected.
  -- Filling a missing vendor remains a set-once operation in any state.
  if (new.title is distinct from old.title or new.code is distinct from old.code
      or (old.status in ('Draft','Rejected') and
          (new.project_id is distinct from old.project_id
           or new.budget_category is distinct from old.budget_category))
      or (old.vendor_id is not null and new.vendor_id is distinct from old.vendor_id)) then
    if old.requested_by_id is distinct from auth.uid() and public.auth_role() is distinct from 'Admin' then
      raise exception 'Procurement header edit is not permitted.' using errcode = '42501';
    end if;
    if old.status not in ('Draft','Rejected') and not (old.record_only and new.code is not distinct from old.code and new.vendor_id is not distinct from old.vendor_id) then
      raise exception 'Procurement header is not editable in this state.' using errcode = '42501';
    end if;
  end if;
  if old.status in ('Draft','Rejected') then return new; end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.budget_category is distinct from old.budget_category then
    raise exception 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.total_value is distinct from old.total_value
     and not (old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
       and exists (select 1 from public.procurement_quotations q
                    where q.procurement_id = old.id and q.is_selected
                      and q.total_amount = new.total_value and q.vendor_id is not distinct from new.vendor_id)) then
    raise exception 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  -- No client holds an UPDATE grant on currency today; this keeps the freeze if one is ever added.
  if new.currency is distinct from old.currency then
    raise exception 'procurements.currency cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  return new;
end; $$;
