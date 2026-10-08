-- Rollback of 0277_change_history_procurement_parent.sql (#878) — restore the 0260 filing:
-- purchase documents parented to their PROJECT (via procurements) at capture, the pre-0277 read API
-- (no grandchild hop) and the pre-0277 parent values on captured events.
--
-- §1 restores the registry rows; §3 re-points `list_record_history` at the 0260 body; §2 reverses the
-- forward backfill for every event the forward pass could have moved (source document still present):
-- a procurement that has a project gives the event back that project; a procurement with no project
-- had NO parent under 0260 (the hop resolved to null), so the parent is cleared. Events whose source
-- document is gone were never moved forward and are left alone.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — registry: back to the project filing (0260 shape)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.record_history_config
   set parent_type = 'project',
       parent_via  = 'procurements'
 where entity_type in ('purchase_request', 'rfq', 'purchase_order', 'payment');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — events: back to the pre-0277 parent values
-- ════════════════════════════════════════════════════════════════════════════════════════════════
with doc as (
  select id, procurement_id from public.purchase_requests
  union all
  select id, procurement_id from public.rfqs
  union all
  select id, procurement_id from public.purchase_orders
  union all
  select id, procurement_id from public.payments
)
update public.record_changes rc
   set parent_type = case when pr.project_id is null then null else 'project' end,
       parent_id   = pr.project_id
  from doc
  join public.procurements pr on pr.id = doc.procurement_id
 where rc.entity_type in ('purchase_request', 'rfq', 'purchase_order', 'payment')
   and rc.parent_type = 'procurement'
   and rc.entity_id = doc.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the read API: the 0260 §6 body (no grandchild hop)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.list_record_history(
  p_entity_type      text,
  p_entity_id        uuid,
  p_include_children boolean     default false,
  p_entity_types     text[]      default null,
  p_before_seq       bigint      default null,
  p_before_at        timestamptz default null,
  p_limit            integer     default 50)
returns table (
  source      text,
  seq         bigint,
  event_id    uuid,
  entity_type text,
  entity_id   uuid,
  parent_type text,
  parent_id   uuid,
  op          text,
  action      text,
  actor_id    uuid,
  changes     jsonb,
  detail      jsonb,
  currency    text,
  created_at  timestamptz)
language sql stable security invoker set search_path = public as $$
  with lim as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as n
  ),
  own as (
    select rc.* from public.record_changes rc
     where rc.org_id = public.auth_org_id()
       and rc.entity_type = p_entity_type and rc.entity_id = p_entity_id
       and (p_before_seq is null or rc.seq < p_before_seq)
       and (p_entity_types is null or rc.entity_type = any (p_entity_types))
     order by rc.seq desc
     limit (select n from lim)
  ),
  kids as (
    select rc.* from public.record_changes rc
     where p_include_children
       and rc.org_id = public.auth_org_id()
       and rc.parent_type = p_entity_type and rc.parent_id = p_entity_id
       and (p_before_seq is null or rc.seq < p_before_seq)
       and (p_entity_types is null or rc.entity_type = any (p_entity_types))
     order by rc.seq desc
     limit (select n from lim)
  ),
  page as (
    select * from (select * from own union all select * from kids) u
     order by u.seq desc
     limit (select n from lim)
  ),
  win as (
    select case when count(*) < (select n from lim) then '-infinity'::timestamptz
                else min(page.created_at) end as lo
      from page
  ),
  audit as (
    select ae.id, ae.action, ae.actor_id, ae.detail, ae.created_at
      from public.audit_events ae
     where ae.entity_id = p_entity_id
       and ae.org_id = public.auth_org_id()
       and (p_entity_types is null or p_entity_type = any (p_entity_types))
       and ae.created_at >= (select lo from win)
       and (p_before_at is null or ae.created_at < p_before_at)
       and ae.action not like '%.delete'
       and ae.action <> all (array[
             'project.create', 'project.transition', 'project.contract_value.set',
             'work_order.create', 'work_order.transition', 'work_order.value.set',
             'budget_version.create', 'budget_version.update', 'procurement.create'])
       and public.record_history_visible(p_entity_type, p_entity_id)
  )
  select r.source, r.seq, r.event_id, r.entity_type, r.entity_id, r.parent_type, r.parent_id,
         r.op, r.action, r.actor_id, r.changes, r.detail, r.currency, r.created_at
    from (
      select 'change'::text as source, p.seq, p.id as event_id, p.entity_type, p.entity_id,
             p.parent_type, p.parent_id, p.op, null::text as action, p.actor_id, p.changes,
             null::jsonb as detail, p.currency, p.created_at
        from page p
      union all
      select 'audit'::text, null::bigint, a.id, p_entity_type, p_entity_id, null::text, null::uuid,
             null::text, a.action, a.actor_id, null::jsonb, a.detail, null::text, a.created_at
        from audit a
    ) r
   order by r.created_at desc, r.seq desc nulls last, r.event_id desc
$$;
