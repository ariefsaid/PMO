-- 1080_crew_tool_lines.sql — #2581 (map #2516): the counted hand-tool register per crew.
-- Spec: docs/specs/crew-tools-register.spec.md (FR-CTR-001..005, 016, 017). Plan: docs/plans/2026-11-20-crew-tools-register.md.
-- Proven by supabase/tests/crew_tools.test.sql. Reports, the task link and the RPCs follow in 1081..1083.
--
-- A tool line is a named tool type held by one crew with a quantity and an optional serial. Hand tools are not
-- equipment assets (usage, costing, availability) and not stock items (warehouse ledger): OD-CTR-1.
-- Writes are direct under RLS + column grants for a crew manager (`crew_can_manage()`); every change is kept in
-- record history. The crew is `on delete restrict` and a crew holding live lines cannot be archived (FR-CTR-005).
-- Reversal: rollback/1080_crew_tool_lines_down.sql.

create table public.crew_tool_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  crew_id     uuid not null references public.crews(id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  code        text check (code is null or char_length(btrim(code)) between 1 and 40),
  serial      text check (serial is null or char_length(btrim(serial)) between 1 and 80),
  -- At least 1 when created or edited (guard below); only a written_off close may take it to 0 (FR-CTR-014).
  held_qty    integer not null check (held_qty >= 0),
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint crew_tool_lines_serial_qty check (serial is null or held_qty <= 1)
);
-- FR-CTR-002 / AC-CTR-002: one live line per serial per organisation; archiving frees it.
create unique index crew_tool_lines_serial_live on public.crew_tool_lines (org_id, lower(btrim(serial)))
  where serial is not null and archived_at is null;
-- NFR-CTR-002: a crew's screen is one indexed read.
create index crew_tool_lines_crew_idx on public.crew_tool_lines (crew_id, name, id) where archived_at is null;
create index crew_tool_lines_created_by_idx on public.crew_tool_lines (created_by) where created_by is not null;
create trigger crew_tool_lines_stamp_org_id before insert on public.crew_tool_lines
  for each row execute function public.stamp_org_id();

-- Same-organisation crew (also on a move, FR-CTR-003) and the create/edit quantity rule. zz_: after the org stamp.
-- SECURITY: definer so it can see a foreign crew's org to refuse it. The close RPC (1082) sets pmo.crew_tool_rpc
-- for the one write allowed to reach held 0.
create function public.guard_crew_tool_line() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.crew_id is distinct from old.crew_id then
    if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id
                      and c.archived_at is null) then
      raise exception 'CTR_REF: the crew is not a live crew of this organisation' using errcode = '23514';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.held_qty is distinct from old.held_qty)
     and coalesce(current_setting('pmo.crew_tool_rpc', true), '') <> 'on' and new.held_qty < 1 then
    raise exception 'CTR_QTY: a tool line holds at least 1' using errcode = '23514';
  end if;
  if new.serial is not null and (tg_op = 'INSERT' or new.serial is distinct from old.serial)
     and new.held_qty <> 1 then
    raise exception 'CTR_QTY: a line with a serial number holds exactly 1' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_crew_tool_line() from public, anon, authenticated;
create trigger zz_crew_tool_lines_guard before insert or update on public.crew_tool_lines
  for each row execute function public.guard_crew_tool_line();

-- FR-CTR-005: replace 1035's guard (body copied unchanged, `people` branch included) adding one more `exists`
-- to the crews branch: a crew holding live tool lines cannot be archived. Same error code, same single trigger.
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
      -- FR-CRW-002 + FR-CTR-005: archive only a crew with no open or future membership or roster placement and no live tool line.
      if new.archived_at is not null and old.archived_at is null and (
           exists (select 1 from public.crew_members m
                    where m.crew_id = new.id and coalesce(m.valid_to, 'infinity'::date) >= current_date)
           or exists (select 1 from public.work_order_crews r
                    where r.crew_id = new.id and coalesce(r.valid_to, 'infinity'::date) >= current_date)
           or exists (select 1 from public.crew_tool_lines t
                    where t.crew_id = new.id and t.archived_at is null)) then
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
    -- FR-CRW-005: a correction bumps the version (the client sends the version it read) and is audited.
    new.version := old.version + 1;
    perform public.log_audit(tg_table_name || '.correct', new.org_id, auth.uid(), new.id,
              jsonb_build_object('before', to_jsonb(old) - 'org_id', 'after', to_jsonb(new) - 'org_id'));
  end if;
  return new;
end $$;
revoke all on function public.guard_crew_refs() from public, anon, authenticated;

-- ── RLS (FR-CTR-016/017): every active member reads (the crew master's rule, OQ-CTR-4); a crew manager writes ─────────────
alter table public.crew_tool_lines enable row level security;
alter table public.crew_tool_lines force row level security;
create policy crew_tool_lines_select on public.crew_tool_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy crew_tool_lines_insert on public.crew_tool_lines for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage()));
create policy crew_tool_lines_update on public.crew_tool_lines for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.crew_tool_lines from public, anon, authenticated;
grant select on public.crew_tool_lines to authenticated;
grant insert (id, crew_id, name, code, serial, held_qty, note) on public.crew_tool_lines to authenticated;
grant update (crew_id, name, code, serial, held_qty, note, archived_at) on public.crew_tool_lines to authenticated;
grant all on public.crew_tool_lines to service_role;

-- ── record history (FR-CTR-003, AC-CHG-011): who changed a line's quantity, crew or serial, and when ─────────────────────
insert into public.record_history_config(entity_type, table_name, parent_type, parent_col, parent_via, captured, flag_cols, omit_cols) values
('crew_tool_line', 'crew_tool_lines', null, null, null,
 '{"crew_id":"ref","name":"text","code":"text","serial":"text","held_qty":"number","archived_at":"timestamp"}',
 '{note}', '{id,org_id,created_by,created_at}');
create trigger crew_tool_lines_zz_record_change after insert or update on public.crew_tool_lines
  for each row execute function public.record_change_capture();

-- The catalog gate wants a visibility arm for every registered entity: 0448's body verbatim plus one arm.
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
  when 'crew_tool_line' then return exists(select 1 from public.crew_tool_lines where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
