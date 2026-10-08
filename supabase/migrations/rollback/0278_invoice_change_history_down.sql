-- Reverses #920: remove invoice capture, registry entries and their visibility arms. This down migration
-- drops captured sales/vendor invoice history because the restored visibility function cannot read it;
-- the shared history tables and other entities are untouched.
drop trigger if exists sales_invoices_zz_record_change on public.sales_invoices;
drop trigger if exists procurement_invoices_zz_record_change on public.procurement_invoices;
delete from public.record_history_config where entity_type in ('sales_invoice', 'procurement_invoice');
-- Remove rows before restoring record_history_visible: its rollback definition has no invoice arms, so
-- retaining these types would make every authenticated record_changes read raise an exception.
delete from public.record_changes where entity_type in ('sales_invoice', 'procurement_invoice');

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
      if v_old -> v_col is distinct from v_new -> v_col then
        v_changes := v_changes || jsonb_build_object(v_col,
          jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col));
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
  if v_actor is null then v_actor := nullif(current_setting('app.actor_id', true), '')::uuid; end if;
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
    else
      raise exception 'record_history_visible: no visibility arm for entity type %', p_entity_type
        using errcode = 'P0001';
  end case;
end $$;

-- Rollback invariant: no retained row may ask the restored visibility function to handle an invoice type.
do $rollback_history_check$
begin
  if exists (select 1 from public.record_changes
             where entity_type in ('sales_invoice', 'procurement_invoice')) then
    raise exception '0278 rollback left invoice change history rows behind'
      using errcode = 'P0001';
  end if;
end
$rollback_history_check$;
