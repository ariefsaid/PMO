-- 0277_change_history_procurement_parent.sql — #878: file purchase documents under their PROCUREMENT.
--
-- 0260 registered purchase_requests / rfqs / purchase_orders / payments with the PROJECT as parent
-- (parent_via 'procurements'): the capture trigger walked procurement_id → procurements.project_id and
-- stamped the event with the project. A procurement's own History tab therefore could not show its
-- documents' edits, and a procurement with no project showed them nowhere. This migration re-files the
-- four document kinds under their procurement and keeps them reachable from the project on READ (the
-- project History tab already rolls children up; it now takes one extra hop through procurements).
--
--   §1 registry  — the four document rows re-pointed: parent_type 'procurement', parent_col
--                  'procurement_id' (unchanged), parent_via null (direct parent, no hop at capture).
--   §2 backfill  — events already captured the 0260 way move to their procurement when the source
--                  document still exists (its procurement_id, NOT NULL on all four tables, is the
--                  truth). Both 0260 capture shapes are re-filed: parent 'project' (the common
--                  case) and parent NULL (the no-project procurement, where the hop resolved to
--                  null — the exact rows #878 says showed nowhere). A document whose row is gone
--                  keeps its old parent: it stays readable where it was, and the procurement tab
--                  only ever rolls up live documents anyway.
--   §3 read API  — list_record_history grows a 'grandkids' arm: with include_children, a PROJECT also
--                  returns change rows whose parent is one of its procurements. Everything else (own +
--                  kids arms, seq paging, the audit window, visibility per row under the RLS policy)
--                  is byte-for-byte the 0260 shape.
--   §4 assertion — the deploy fails here rather than silently keeping the old filing.
--
-- The capture trigger needs no change and no re-attach: it reads record_history_config at fire time,
-- so new events are filed under the procurement from the moment §1 lands.
--
-- Reversibility: supabase/migrations/rollback/0277_change_history_procurement_parent_down.sql
-- (restores the registry, the pre-0277 read API and the pre-0277 parent values).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the registry: the four purchase documents hang directly off their procurement
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.record_history_config
   set parent_type = 'procurement',
       parent_via  = null
 where entity_type in ('purchase_request', 'rfq', 'purchase_order', 'payment');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — re-file the events 0260 already captured (project-parented or parentless; source row present)
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
   set parent_type = 'procurement',
       parent_id   = doc.procurement_id
  from doc
 where rc.entity_type in ('purchase_request', 'rfq', 'purchase_order', 'payment')
   and rc.entity_id = doc.id
   and (rc.parent_type is null or rc.parent_type = 'project');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the read API: same shape as 0260 §6, plus the project's grandchild hop.
-- Each change row stays visibility-checked per row by the record_changes SELECT policy
-- (org + active member + the source row's own RLS), so a document the caller cannot read
-- contributes no event here either.
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
  -- #878: purchase documents are filed under their procurement, so a project's roll-up takes one
  -- extra hop: documents whose parent procurement belongs to this project.
  grandkids as (
    select rc.* from public.record_changes rc
     where p_include_children
       and p_entity_type = 'project'
       and rc.org_id = public.auth_org_id()
       and rc.parent_type = 'procurement'
       and rc.parent_id in (select pr.id from public.procurements pr where pr.project_id = p_entity_id)
       and (p_before_seq is null or rc.seq < p_before_seq)
       and (p_entity_types is null or rc.entity_type = any (p_entity_types))
     order by rc.seq desc
     limit (select n from lim)
  ),
  page as (
    select * from (select * from own union all select * from kids union all select * from grandkids) u
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — closing self-assertion (the 0260 §8 style): a deploy that does not land this exact filing
-- fails here rather than later.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text;
begin
  select string_agg(entity_type, ', ' order by entity_type) into v_bad
    from public.record_history_config
   where entity_type in ('purchase_request', 'rfq', 'purchase_order', 'payment')
     and (parent_type <> 'procurement' or parent_col <> 'procurement_id' or parent_via is not null);
  if v_bad is not null then
    raise exception '0277: purchase documents not filed under their procurement: %', v_bad
      using errcode = 'P0001';
  end if;
end $$;
