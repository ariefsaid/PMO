-- 2102_order_needed_by.sql — 1124d decision 3 (spec docs/specs/order-needed-by.spec.md). Proven by supabase/tests/2102_order_needed_by.test.sql.
--   §1 setting organizations.po_needed_by_required_from (null = off, the default). An Admin turns it on; the moment it is turned on is kept, so an
--      order created before that moment is never blocked retroactively.
--   §2 procurements.needed_by: the one "needed by" date on the order header. Written only by set_procurement_needed_by (it fills the lines).
--   §3 procurement_items.needed_by (1346) keeps its meaning (the line's date); the header write is allowed to fill it past the 1346 Draft rule.
--   §4 a guard on procurements: a header date changes only through the RPC and only before the order is sent; with the setting on, an order created
--      after the moment above cannot move to Ordered (sent to the supplier) without its header date. Imports and service writes (no caller) are exempt.
-- Default = today's behaviour for every existing organisation.
-- ── REVERSE (rollback/2102_order_needed_by_down.sql): restore the 1346 line guard; drop the trigger, functions and columns.

-- §1 ---------------------------------------------------------------------------------------------------
alter table public.organizations add column po_needed_by_required_from timestamptz;

create or replace function public.po_needed_by_required_from_of(p_org uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select (select o.po_needed_by_required_from from public.organizations o where o.id = p_org) $$;
revoke all on function public.po_needed_by_required_from_of(uuid) from public, anon;
grant execute on function public.po_needed_by_required_from_of(uuid) to authenticated;

create or replace function public.set_po_needed_by_required(p_on boolean) returns boolean
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old timestamptz;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                              -- mut:setting_admin
    raise exception 'only an Admin changes the needed-by rule' using errcode = '42501'; end if;
  if p_on is null then raise exception 'the needed-by rule is on or off' using errcode = '22023'; end if;
  select o.po_needed_by_required_from into v_old from public.organizations o where o.id = v_org for update;
  if p_on and v_old is null then
    update public.organizations set po_needed_by_required_from = now() where id = v_org;
  elsif not p_on and v_old is not null then
    update public.organizations set po_needed_by_required_from = null where id = v_org;
  else
    return v_old is not null;
  end if;
  perform public.log_audit('purchase.needed_by_required', v_org, auth.uid(), v_org, jsonb_build_object('on', p_on));
  return p_on;
end $$;
revoke all on function public.set_po_needed_by_required(boolean) from public, anon;
grant execute on function public.set_po_needed_by_required(boolean) to authenticated;

-- §2 ---------------------------------------------------------------------------------------------------
alter table public.procurements add column needed_by date;

create or replace function public.po_needed_by_write_on() returns boolean
  language sql stable set search_path = public as $$ select coalesce(current_setting('pmo.po_needed_by_write', true), '') = 'on' $$;
revoke all on function public.po_needed_by_write_on() from public, anon;
grant execute on function public.po_needed_by_write_on() to authenticated;

-- §3 the 1346 line guard, body verbatim, with ONE added exemption at the top: the header write (flag on) may change a line's date alone.
create or replace function public.procurement_items_planning_guard() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_on boolean; v_status public.procurement_status;
begin
  if tg_op = 'UPDATE' and public.po_needed_by_write_on()                                          -- mut:line_exempt (2102)
     and new.category_id is not distinct from old.category_id then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.category_id is not distinct from old.category_id
     and new.needed_by is not distinct from old.needed_by then
    return new;
  end if;
  if new.category_id is null and new.needed_by is null then
    -- clearing is allowed only on a Draft (the values are frozen after submit)
    if tg_op = 'UPDATE' then
      select status into v_status from public.procurements where id = new.procurement_id;
      if v_status is distinct from 'Draft' then
        raise exception 'Line planning is read-only for this request' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  select purchase_line_planning into v_on from public.organizations where id = new.org_id;
  if not coalesce(v_on, false) then
    raise exception 'Line planning is not turned on' using errcode = '42501';
  end if;
  select status into v_status from public.procurements where id = new.procurement_id;
  if tg_op = 'UPDATE' and v_status is distinct from 'Draft' then
    raise exception 'Line planning is read-only for this request' using errcode = '42501';
  end if;
  if new.category_id is not null and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and not exists (select 1 from public.purchase_line_categories c
                      where c.id = new.category_id and c.org_id = new.org_id and c.archived_at is null) then
    raise exception 'Line category is not available' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.procurement_items_planning_guard() from public, anon, authenticated;

-- §4 ---------------------------------------------------------------------------------------------------
create or replace function public.guard_procurement_needed_by() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_from timestamptz;
begin
  if (tg_op = 'INSERT' and new.needed_by is not null) or (tg_op = 'UPDATE' and new.needed_by is distinct from old.needed_by) then
    if not public.po_needed_by_write_on() then                                                    -- mut:write_path
      raise exception 'the needed-by date is set through the order, not by hand' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and old.status in ('Ordered', 'Received', 'Vendor Invoiced', 'Paid', 'Cancelled') then   -- mut:frozen
      raise exception 'the needed-by date cannot change once the order is sent to the supplier' using errcode = '42501'; end if;
  end if;
  if new.status = 'Ordered' and (tg_op = 'INSERT' or old.status is distinct from 'Ordered') and auth.uid() is not null then
    select o.po_needed_by_required_from into v_from from public.organizations o where o.id = new.org_id;
    if v_from is not null and new.created_at >= v_from and new.needed_by is null then            -- mut:required
      raise exception 'Set the needed-by date before sending the order to the supplier' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_needed_by() from public, anon, authenticated;
create trigger procurements_zz_needed_by before insert or update on public.procurements
  for each row execute function public.guard_procurement_needed_by();

-- The write path. who: the requester, or Admin / Executive / Project Manager / Finance. before the order is sent.
-- p_needed_by fills every line that has no date or still carries the old header date; p_lines (item_id, needed_by) sets a line's own date
-- (a null there puts the line back on the header date).
create or replace function public.set_procurement_needed_by(p_id uuid, p_needed_by date, p_lines jsonb default null) returns boolean
  language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_case public.procurements%rowtype; v_e jsonb; v_id uuid; v_d date;
begin
  if auth.uid() is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'the needed-by date is not permitted' using errcode = '42501'; end if;
  select * into v_case from public.procurements where id = p_id and org_id = v_org for update;
  if v_case.id is null
     or v_case.status not in ('Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected')                    -- mut:status
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false)
     or not coalesce(v_case.requested_by_id = auth.uid() or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'), false) then   -- mut:who
    raise exception 'the needed-by date is not permitted' using errcode = '42501'; end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    raise exception 'the lines are a list' using errcode = '22023'; end if;
  perform set_config('pmo.po_needed_by_write', 'on', true);
  update public.procurements set needed_by = p_needed_by where id = p_id;
  if p_needed_by is not null then
    update public.procurement_items set needed_by = p_needed_by
     where procurement_id = p_id and org_id = v_org and (needed_by is null or needed_by is not distinct from v_case.needed_by);
  end if;
  for v_e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_id := (v_e->>'item_id')::uuid;
    v_d := coalesce(nullif(v_e->>'needed_by', '')::date, p_needed_by);
    update public.procurement_items set needed_by = v_d where id = v_id and procurement_id = p_id and org_id = v_org;
  end loop;
  perform set_config('pmo.po_needed_by_write', 'off', true);
  perform public.log_audit('purchase.needed_by', v_org, auth.uid(), p_id, jsonb_build_object('from', v_case.needed_by, 'to', p_needed_by));
  return true;
end $$;
revoke all on function public.set_procurement_needed_by(uuid, date, jsonb) from public, anon;
grant execute on function public.set_procurement_needed_by(uuid, date, jsonb) to authenticated;
