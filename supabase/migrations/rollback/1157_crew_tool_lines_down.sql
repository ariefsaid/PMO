-- Reverse of 1157_crew_tool_lines.sql. Reverse 1160, 1159 and 1158 first (they depend on this table).
-- Restores 1035's guard_crew_refs() body and 1154's record_history_visible() body (0448's arms plus usage_standard).
drop trigger if exists crew_tool_lines_zz_record_change on public.crew_tool_lines;
delete from public.record_history_config where entity_type = 'crew_tool_line';
delete from public.record_changes where entity_type = 'crew_tool_line';

create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
begin
 case p_entity_type
  when 'project' then return exists(select 1 from public.projects where id=p_entity_id);
  when 'budget_version' then return exists(select 1 from public.budget_versions where id=p_entity_id);
  when 'budget_line_item' then return exists(select 1 from public.budget_line_items where id=p_entity_id);
  when 'work_order' then return exists(select 1 from public.work_orders where id=p_entity_id);
  when 'procurement' then return exists(select 1 from public.procurements where id=p_entity_id);
  when 'purchase_request' then return exists(select 1 from public.purchase_requests where id=p_entity_id);
  when 'rfq' then return exists(select 1 from public.rfqs where id=p_entity_id);
  when 'purchase_order' then return exists(select 1 from public.purchase_orders where id=p_entity_id);
  when 'payment' then return exists(select 1 from public.payments where id=p_entity_id);
  when 'task' then return exists(select 1 from public.tasks where id=p_entity_id);
  when 'company' then return exists(select 1 from public.companies where id=p_entity_id);
  when 'contact' then return exists(select 1 from public.contacts where id=p_entity_id);
  when 'sales_invoice' then return exists(select 1 from public.sales_invoices where id=p_entity_id);
  when 'procurement_invoice' then return exists(select 1 from public.procurement_invoices where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  when 'project_stage_entry' then return exists(select 1 from public.project_stage_entries where id=p_entity_id);
  when 'usage_standard' then return exists(select 1 from public.consumable_usage_standards where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;

create or replace function public.guard_crew_refs() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  case tg_table_name
    when 'crews' then
      if new.field_controller_id is not null and not exists (
           select 1 from public.profiles p where p.id = new.field_controller_id and p.org_id = new.org_id) then
        raise exception 'CRW_REF: the field controller is not in this organisation' using errcode = '23514';
      end if;
      if new.discipline_id is not null and (tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id)
         and not exists (select 1 from public.cost_disciplines d
                          where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
        raise exception 'CRW_REF: the discipline is not on this organisation''s list' using errcode = '23514';
      end if;
      if new.vendor_company_id is not null and not exists (
           select 1 from public.companies c where c.id = new.vendor_company_id and c.org_id = new.org_id) then
        raise exception 'CRW_REF: the vendor company is not in this organisation' using errcode = '23514';
      end if;
      if new.archived_at is not null and old.archived_at is null and (
           exists (select 1 from public.crew_members m
                    where m.crew_id = new.id and coalesce(m.valid_to, 'infinity'::date) >= current_date)
           or exists (select 1 from public.work_order_crews r
                    where r.crew_id = new.id and coalesce(r.valid_to, 'infinity'::date) >= current_date)) then
        raise exception 'CRW_ARCHIVE_IN_USE: end this crew''s current and future members and roster placements first'
          using errcode = '23514';
      end if;
    when 'crew_standard_roles' then
      if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id) then
        raise exception 'CRW_REF: the crew is not in this organisation' using errcode = '23514';
      end if;
    when 'people' then
      if new.vendor_company_id is not null and not exists (
           select 1 from public.companies c where c.id = new.vendor_company_id and c.org_id = new.org_id) then
        raise exception 'CRW_REF: the vendor company is not in this organisation' using errcode = '23514';
      end if;
    when 'crew_members' then
      if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id
                        and (c.archived_at is null or tg_op = 'UPDATE')) then
        raise exception 'CRW_REF: the crew is not a live crew of this organisation' using errcode = '23514';
      end if;
      if not exists (select 1 from public.people w where w.id = new.worker_id and w.org_id = new.org_id) then
        raise exception 'CRW_REF: the person is not in this organisation' using errcode = '23514';
      end if;
      if new.standard_role_id is not null and not exists (
           select 1 from public.crew_standard_roles s where s.id = new.standard_role_id and s.crew_id = new.crew_id) then
        raise exception 'CRW_REF: the role is not one of this crew''s standard roles' using errcode = '23514';
      end if;
    when 'work_order_crews' then
      if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id
                        and (c.archived_at is null or tg_op = 'UPDATE')) then
        raise exception 'CRW_REF: the crew is not a live crew of this organisation' using errcode = '23514';
      end if;
      if not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.org_id = new.org_id
                        and (w.status <> 'Cancelled' or tg_op = 'UPDATE')) then
        raise exception 'CRW_REF: the work order is not a live work order of this organisation' using errcode = '23514';
      end if;
  end case;
  if tg_op = 'UPDATE' and tg_table_name in ('crew_members', 'work_order_crews') then
    new.version := old.version + 1;
    perform public.log_audit(tg_table_name || '.correct', new.org_id, auth.uid(), new.id,
              jsonb_build_object('before', to_jsonb(old) - 'org_id', 'after', to_jsonb(new) - 'org_id'));
  end if;
  return new;
end $$;
revoke all on function public.guard_crew_refs() from public, anon, authenticated;

drop table if exists public.crew_tool_lines;
drop function if exists public.guard_crew_tool_line();
