-- 1566_operational_waiting_route.sql — who the three operational "waiting" states wait on (fix-waiting item 3, Waiting 3).
-- The record screens name the actual people the database's own decision predicate would let act NOW, instead of a
-- static role label: a Draft work order (issue), an Ordered purchase (record its delivery / receipt), and a Sent
-- stock transfer (receive it). Every predicate below is the SAME one 1560_waiting_decisions uses for that kind, so
-- this route and the per-person waiting list can never disagree:
--   work_order_issue  transition_work_order Draft->Issued (0337), projected by 1560: Admin/Executive/Finance, and the
--                     project's own Project Manager; only while the row carries priced money, the value's author is
--                     recorded and is not the person themselves, and either that person holds won-value authority or
--                     the author is an active member who outranks/manages them. (The author-active half is read from
--                     profiles.status, the caller path's definition of active — the transition's own
--                     assert_is_active_member() still refuses an out-of-band auth ban.)
--   delivery_record   transition_procurement Ordered->Received (1017/1580), projected by 1560: an Admin; the actual
--                     requester while their coarse role is Executive/Project Manager/Finance/Engineer; or the Project
--                     Manager assigned to the record's project. Not every Finance/Executive, and not every PM.
--   transfer_receipt  receive_stock_transfer (1308/1591), projected by 1560: the transfer's named receiver, or a keeper
--                     of its DESTINATION warehouse, and never its sender. Deliberately narrower than
--                     stock_transfer_actor_ok('receive') (any senior role may receive): this names the person it waits on,
--                     not everyone who could.
-- SECURITY INVOKER: the single record is read through the existing RLS (org + active member), so an absent, foreign or
-- unreadable id returns the same empty route as a record that is not waiting — no existence oracle. Names come only
-- from active profiles RLS already exposes to the caller. No org parameter is accepted and org_id is never sent by
-- the client. Read-only: no table, policy or write function changes; the only grant is execute on this function.
-- REVERSE: rollback/1566_operational_waiting_route_down.sql

create or replace function public.get_operational_waiting_route(p_kind text, p_record_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid      uuid := auth.uid();
  v_org      uuid := public.auth_org_id();
  v_approvers jsonb := '[]'::jsonb;
  v_kind     text;
begin
  -- Allowlist by equality, never by interpolation: an unknown kind has no route.
  if p_kind = 'work_order_issue' or p_kind = 'delivery_record' or p_kind = 'transfer_receipt' then
    v_kind := p_kind;
  end if;

  -- A light account decides nothing (1205/1209), and a missing caller or org has no route.
  if v_kind is null or p_record_id is null or v_uid is null or v_org is null or public.actor_is_light() then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', v_kind);
  end if;

  case p_kind
    when 'work_order_issue' then
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role::text)
                                order by p.full_name, p.id), '[]'::jsonb)
        into v_approvers
        from public.work_orders w
        join public.projects pr on pr.id = w.project_id
        join public.profiles p on p.org_id = w.org_id
        left join public.profiles author
               on author.id = w.order_value_set_by and author.org_id = w.org_id
       where w.id = p_record_id
         and w.status = 'Draft'
         and coalesce(w.order_value, 0) > 0
         and w.order_value_set_by is not null
         and p.status = 'active'
         and p.role in ('Admin', 'Executive', 'Project Manager', 'Finance')
         and (p.role <> 'Project Manager' or pr.project_manager_id = p.id)
         and p.id is distinct from w.order_value_set_by
         and (public.holds_won_value_authority(p.role)
              or (w.order_value_set_at is not null
                  and author.status = 'active'
                  and (author.manager_id = p.id or public.role_outranks(author.role, p.role))));
    when 'delivery_record' then
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role::text)
                                order by p.full_name, p.id), '[]'::jsonb)
        into v_approvers
        from public.procurements pr
        left join public.projects pj on pj.id = pr.project_id
        join public.profiles p on p.org_id = pr.org_id
       where pr.id = p_record_id
         and pr.status = 'Ordered'
         and p.status = 'active'
         and (p.role = 'Admin'
              or (p.id = pr.requested_by_id and p.role in ('Executive', 'Project Manager', 'Finance', 'Engineer'))
              or (p.role = 'Project Manager' and pj.project_manager_id = p.id));
    when 'transfer_receipt' then
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role::text)
                                order by p.full_name, p.id), '[]'::jsonb)
        into v_approvers
        from public.stock_transfers x
        join public.profiles p on p.org_id = x.org_id
       where x.id = p_record_id
         and x.status = 'Sent'
         and p.status = 'active'
         and p.id is distinct from x.sent_by
         and (p.id = x.to_user_id
              or exists (select 1
                           from public.stock_warehouse_keepers k
                          where k.org_id = x.org_id
                            and k.user_id = p.id
                            and k.warehouse_id = x.to_warehouse_id));
    else
      null;
  end case;

  return jsonb_build_object('approvers', coalesce(v_approvers, '[]'::jsonb), 'route_kind', v_kind);
end; $$;

revoke all on function public.get_operational_waiting_route(text, uuid) from public, anon;
grant execute on function public.get_operational_waiting_route(text, uuid) to authenticated;
