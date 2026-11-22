-- 1566_operational_waiting_route.sql — WHO a record is assigned to while it waits (fix-waiting item 3, Waiting 3).
-- A Draft work order (issue), an Ordered purchase (record its delivery / receipt) and a Sent stock transfer (receive
-- it) each name the people the waiting list ASSIGNS that record to — the same population 1560_waiting_decisions lists
-- for the kind, read for one record so the screen can say "Waiting for <name>, <role>" instead of a static label.
--
-- This is the ASSIGNMENT, not a complete list of everyone the write gate would admit. The deciding functions stay the
-- authority for whether an act succeeds; this read never re-decides a write. The deliberate narrowings, recorded in the
-- spec (FR-WAIT-004):
--   work_order_issue  the coarse issue roles (Admin/Executive/Finance) and the project's own Project Manager, while the
--                     Draft carries priced money with a recorded author, and never the price author. transition_work_order
--                     (0337) also admits a Project Manager who does not manage the project, a price author acting on
--                     their own won-value authority, and any issue role on an unpriced Draft: those people are not
--                     assigned to this record, so they are not named here.
--   delivery_record   an Admin, the purchase's actual requester (while their coarse role may record a receipt) and the
--                     project's own Project Manager. transition_procurement (1580) admits any non-requester Project
--                     Manager on Ordered->Received; only the manager of this purchase's project is assigned. A light
--                     account cannot record a receipt at all (1580 runs assert_not_light), so no light person is assigned.
--   transfer_receipt  the transfer's addressed receiver, or a full-account keeper of its destination warehouse, and never
--                     its sender. A light account reads only a transfer addressed to it (1480's restrictive SELECT), so a
--                     light keeper who is not the addressed receiver cannot open this file and is not assigned. This is
--                     narrower than stock_transfer_actor_ok('receive') (an Admin may receive any transfer): it names the
--                     people the transfer waits on, not everyone who could.
--
-- The work-order SoD limbs inline the two limbs of may_approve_work_of because 0218 revoked that helper from
-- authenticated (no new helper is created or granted here). The inlined direction is the one transition_work_order
-- applies — may_approve_work_of(the value's author, the issuer): the value counts as witnessed when the ISSUER's own
-- line manager set it, or when the author's role outranks the issuer's. The manager fact is read from the issuer's
-- profile (p.manager_id = w.order_value_set_by), never the reverse.
--
-- Display states: a person is named while their profile is in a supported account state (active), so the screen can
-- display the assignment. The deciding transition remains the authority for every act; this read only displays who the
-- waiting assignment names.
--
-- SECURITY INVOKER: the single record is read through the existing RLS (org + active member), so an absent, foreign or
-- unreadable id returns the same empty assignment as a record that is not waiting — no existence oracle. Names come
-- only from profiles RLS already exposes to the caller. No org parameter is accepted and org_id is never sent by the
-- client. Read-only: no table, policy or write function changes; the only grant is execute on this function.
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
      -- The assignment 1560 lists: the authority roles, plus this project's own manager, once the money has a witness.
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
                  and (p.manager_id = w.order_value_set_by or public.role_outranks(author.role, p.role))));
    when 'delivery_record' then
      -- The receipt gate refuses every light account (1580 assert_not_light), so no light person is assigned.
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role::text)
                                order by p.full_name, p.id), '[]'::jsonb)
        into v_approvers
        from public.procurements pr
        left join public.projects pj on pj.id = pr.project_id
        join public.profiles p on p.org_id = pr.org_id
       where pr.id = p_record_id
         and pr.status = 'Ordered'
         and p.status = 'active'
         and not public.is_light_role_key(p.built_in_role)
         and (p.role = 'Admin'
              or (p.id = pr.requested_by_id and p.role in ('Executive', 'Project Manager', 'Finance', 'Engineer'))
              or (p.role = 'Project Manager' and pj.project_manager_id = p.id));
    when 'transfer_receipt' then
      -- Addressed receiver (any account, including a light one) or a full destination keeper; never the sender.
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
              or (not public.is_light_role_key(p.built_in_role)
                  and exists (select 1
                                from public.stock_warehouse_keepers k
                               where k.org_id = x.org_id
                                 and k.user_id = p.id
                                 and k.warehouse_id = x.to_warehouse_id)));
    else
      null;
  end case;

  return jsonb_build_object('approvers', coalesce(v_approvers, '[]'::jsonb), 'route_kind', v_kind);
end; $$;

revoke all on function public.get_operational_waiting_route(text, uuid) from public, anon;
grant execute on function public.get_operational_waiting_route(text, uuid) to authenticated;
