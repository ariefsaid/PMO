-- 0278_invoice_change_history.sql — #920: history for PMO-owned facts on ERP-mirrored invoices.
-- Sales/vendor invoice amounts, statuses and ERP read-model fields are deliberately omitted: syncs refresh them.
-- e-Faktur is PMO-owned (#893). Sales received_date (#767) and vendor withholding (#876) are captured for
-- authenticated PMO writes only: the ERP feed also refreshes those mirror columns, and must not create noise.
-- Rollback: supabase/migrations/rollback/0278_invoice_change_history_down.sql.

insert into public.record_history_config
  (entity_type, table_name, parent_type, parent_col, captured, flag_cols, omit_cols) values
('sales_invoice', 'sales_invoices', 'project', 'project_id',
 '{"efaktur_number":"text","efaktur_date":"date","received_date":"date","author_user_id":"ref","approved_by_id":"ref","approved_at":"timestamp","pmo_native":"bool","pmo_number":"text","native_lines":"text"}',
 '{}',
 '{id,org_id,project_id,customer_id,si_number,reference_number,invoice_date,amount,erp_outstanding_amount,status,erp_docstatus,erp_modified,erp_amended_from,erp_cancelled_at,created_at,currency,tax_treatment,tax_amount,tax_rate,tax_template,work_order_id,tax_base_numerator,tax_base_denominator,erp_due_date,overpaid_amount,erp_opening_amount,erp_opening_at}'),
('procurement_invoice', 'procurement_invoices', 'procurement', 'procurement_id',
 '{"efaktur_number":"text","efaktur_date":"date","withheld_amount":"money","withheld_pph_type":"enum"}',
 '{}',
 '{id,org_id,procurement_id,vi_number,invoice_date,status,created_at,po_id,reference_number,amount,import_batch_id,imported_at,import_key,erp_outstanding_amount,erp_docstatus,erp_modified,erp_amended_from,erp_cancelled_at,currency,tax_treatment,tax_amount,tax_rate,tax_template,tax_base_numerator,tax_base_denominator,external_ref}');

-- Keep machine mirror updates of received_date and vendor withholding fields out of history. Their
-- SECURITY DEFINER PMO setters retain auth.uid(), so user edits are captured and attributed; other
-- captured columns retain the generic 0260 behavior.
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
         or not ((v_cfg.table_name = 'sales_invoices' and v_col in ('received_date', 'author_user_id'))
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

create or replace function public.record_history_visible(p_entity_type text, p_entity_id uuid)
  returns boolean language plpgsql stable security invoker set search_path = public as $$
begin
  case p_entity_type
    when 'project'          then return exists (select 1 from public.projects          where id = p_entity_id);
    when 'budget_version'   then return exists (select 1 from public.budget_versions   where id = p_entity_id);
    when 'budget_line_item' then return exists (select 1 from public.budget_line_items where id = p_entity_id);
    when 'work_order'       then return exists (select 1 from public.work_orders       where id = p_entity_id);
    when 'procurement'      then return exists (select 1 from public.procurements      where id = p_entity_id);
    when 'purchase_request' then return exists (select 1 from public.purchase_requests where id = p_entity_id);
    when 'rfq'              then return exists (select 1 from public.rfqs              where id = p_entity_id);
    when 'purchase_order'   then return exists (select 1 from public.purchase_orders   where id = p_entity_id);
    when 'payment'           then return exists (select 1 from public.payments           where id = p_entity_id);
    when 'task'              then return exists (select 1 from public.tasks              where id = p_entity_id);
    when 'company'           then return exists (select 1 from public.companies           where id = p_entity_id);
    when 'contact'           then return exists (select 1 from public.contacts            where id = p_entity_id);
    when 'sales_invoice'     then return exists (select 1 from public.sales_invoices     where id = p_entity_id);
    when 'procurement_invoice' then return exists (select 1 from public.procurement_invoices where id = p_entity_id);
    else
      raise exception 'record_history_visible: no visibility arm for entity type %', p_entity_type
        using errcode = 'P0001';
  end case;
end $$;

create trigger sales_invoices_zz_record_change
  after insert or update on public.sales_invoices for each row execute function public.record_change_capture();
create trigger procurement_invoices_zz_record_change
  after insert or update on public.procurement_invoices for each row execute function public.record_change_capture();
