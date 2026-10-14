-- 0287_project_finances.sql — #1008 project attribution and project-scoped finance readings.
-- Rollback: migrations/rollback/0287_project_finances_down.sql.

alter table public.sales_invoices add column erp_project text;
comment on column public.sales_invoices.erp_project is
  '#1008: source ERP Project name; provenance, not PMO attribution. Omitted feed fields do not clear it.';
create index sales_invoices_null_erp_project_scan_idx
  on public.sales_invoices(org_id,id)
  where project_id is null and not pmo_native and si_number is not null;
create index erp_actuals_snapshot_project_read_idx
  on public.erp_actuals_snapshot(org_id,snapshot_id,project_id,fiscal_year,account);
create index erp_actuals_snapshot_latest_read_idx
  on public.erp_actuals_snapshot(org_id,created_at desc,id desc) include(snapshot_id);

create function public.sales_invoice_project_org_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id
  ) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return new;
end $$;
alter function public.sales_invoice_project_org_guard() owner to postgres;
revoke all on function public.sales_invoice_project_org_guard() from public,anon,authenticated;
create trigger sales_invoices_project_org_guard
before insert or update of org_id,project_id on public.sales_invoices
for each row execute function public.sales_invoice_project_org_guard();

create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create function public.assign_sales_invoice_project(p_si_id uuid,p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_si public.sales_invoices; v_role public.user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  -- PFIN_ASSIGN_ROLE_CHECK: mutation target; keep this exact marker and predicate.
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_si from public.sales_invoices where id = p_si_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_si.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.org_id = v_si.org_id
  ) then raise exception 'project not found' using errcode = 'P0002'; end if;
  if v_si.pmo_native or v_si.si_number is null or v_si.author_user_id is not null
     or exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_si_id)
     or not exists (select 1 from public.external_refs r where r.org_id = v_si.org_id
                    and r.domain = 'revenue' and r.pmo_record_id = p_si_id::text
                    and r.external_record_id = v_si.si_number) then
    raise exception 'only an adopted ERP invoice can be attributed here' using errcode = '23514';
  end if;
  if (v_si.work_order_id is not null and not exists (
        select 1 from public.work_orders w where w.id = v_si.work_order_id
          and w.org_id = v_si.org_id and w.project_id = p_project_id))
     or exists (select 1 from public.progress_claims c where c.id = p_si_id
                and (c.org_id is distinct from v_si.org_id or c.project_id is distinct from p_project_id)) then
    raise exception 'project conflicts with the invoice billing context' using errcode = '23514';
  end if;
  if v_si.project_id is not distinct from p_project_id then return; end if;
  update public.sales_invoices set project_id = p_project_id where id = p_si_id;
end $$;
alter function public.assign_sales_invoice_project(uuid,uuid) owner to postgres;
revoke all on function public.assign_sales_invoice_project(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_sales_invoice_project(uuid,uuid) to authenticated;

update public.record_history_config
   set captured = captured || '{"project_id":"ref"}'::jsonb,
       omit_cols = array_append(array_remove(omit_cols,'project_id'),'erp_project')
 where entity_type = 'sales_invoice';

create or replace function public.record_change_capture() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_cfg      public.record_history_config%rowtype;
  v_old      jsonb;
  v_new      jsonb;
  v_changes  jsonb := '{}';
  v_col      text;
  v_parent   uuid;
  v_currency text;
  v_actor    uuid;
begin
  select * into v_cfg from public.record_history_config where table_name = tg_table_name;
  if not found then
    raise exception 'record_change_capture: table % is not in record_history_config', tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if old is not distinct from new then return null; end if;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for v_col in select jsonb_object_keys(v_cfg.captured) loop
      if current_setting('role', true) is distinct from 'service_role'
         or not ((v_cfg.table_name = 'sales_invoices' and v_col in ('received_date', 'author_user_id', 'project_id'))
                 or (v_cfg.table_name = 'procurement_invoices' and v_col in ('withheld_amount', 'withheld_pph_type'))) then
        if v_old -> v_col is distinct from v_new -> v_col then
          v_changes := v_changes || jsonb_build_object(v_col,
            jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col));
        end if;
      end if;
    end loop;
    foreach v_col in array v_cfg.flag_cols loop
      if v_old -> v_col is distinct from v_new -> v_col then
        v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('changed', true));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  else
    v_new := to_jsonb(new);
  end if;

  if v_cfg.parent_col is not null then
    v_parent := (v_new ->> v_cfg.parent_col)::uuid;
    if v_cfg.parent_via = 'budget_versions' then
      select bv.project_id, bv.currency into v_parent, v_currency
        from public.budget_versions bv where bv.id = v_parent;
    elsif v_cfg.parent_via = 'procurements' then
      select p.project_id into v_parent from public.procurements p where p.id = v_parent;
    end if;
  end if;
  v_currency := coalesce(v_new ->> 'currency', v_currency);

  v_actor := auth.uid();
  if v_actor is null then
    v_actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  end if;

  insert into public.record_changes
    (org_id, entity_type, entity_id, parent_type, parent_id, op, actor_id, changes, currency)
  values
    ((v_new ->> 'org_id')::uuid, v_cfg.entity_type, (v_new ->> 'id')::uuid,
     case when v_parent is not null then v_cfg.parent_type end, v_parent,
     lower(tg_op), v_actor, v_changes, v_currency);
  return null;
end $$;
