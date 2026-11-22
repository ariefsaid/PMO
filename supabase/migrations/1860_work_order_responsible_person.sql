-- 1860_work_order_responsible_person.sql — a work order's responsible person (the site engineer): one nullable person on the work order.
-- Spec docs/specs/usage-warning.spec.md (FR-UW-010..012). Later items in the gap-material lane read this column. Proven by supabase/tests/work_order_responsible.test.sql.
-- REVERSE: rollback/1860_work_order_responsible_person_down.sql.
-- Same shape as 1320's site location: a nullable column, a same-organisation guard trigger, a definer setter (the client UPDATE column list on
-- work_orders is a pinned surface), and the change-history registry entry. Nothing reads it yet; null for every existing work order.

alter table public.work_orders add column responsible_person_id uuid references public.profiles(id);
create index work_orders_responsible_person_idx on public.work_orders (responsible_person_id) where responsible_person_id is not null;
update public.record_history_config
   set captured = captured || '{"responsible_person_id":"ref"}'::jsonb
 where table_name = 'work_orders';

create or replace function public.guard_work_order_responsible_person() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.responsible_person_id is not null and (tg_op = 'INSERT' or new.responsible_person_id is distinct from old.responsible_person_id) then
    if not exists (select 1 from public.profiles p                                                     -- mut:rsp_same_org
                    where p.id = new.responsible_person_id and p.org_id = new.org_id and p.status = 'active') then
      raise exception 'RSP_PERSON: the responsible person must be an active member of this organisation' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_work_order_responsible_person() from public, anon, authenticated;
create trigger work_orders_zzzzzz_responsible_person before insert or update of responsible_person_id on public.work_orders
  for each row execute function public.guard_work_order_responsible_person();

-- Who may set it: whoever may edit the work order (work_orders_update, 0193): Admin, Executive, Project Manager, Finance.
create or replace function public.set_work_order_responsible_person(p_work_order_id uuid, p_person_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() not in ('Admin', 'Executive', 'Project Manager', 'Finance') then            -- mut:rsp_role
    raise exception 'RSP_FORBIDDEN: your role cannot set a work order''s responsible person' using errcode = '42501'; end if;
  perform 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org for update;  -- mut:rsp_org
  if not found then raise exception 'work order not found' using errcode = 'P0002'; end if;
  update public.work_orders set responsible_person_id = p_person_id where id = p_work_order_id and org_id = v_org;
end $$;
revoke all on function public.set_work_order_responsible_person(uuid, uuid) from public, anon;
grant execute on function public.set_work_order_responsible_person(uuid, uuid) to authenticated;
