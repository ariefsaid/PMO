-- 0260_record_change_history.sql — #719 record change history, DATA LAYER.
-- Spec: docs/specs/record-change-history.spec.md (D1-D4; accepted OD-CHG-1). Plan:
-- docs/plans/2026-10-06-record-change-history-data.md (column classification table, decisions 1-8).
--
-- What this adds (additive: no existing table's columns, policies or grants change):
--   §1 record_history_config  — the code-owned registry: one row per tracked table, every column
--                               classified captured (col -> kind) / flag / omit. No client grant.
--   §2 record_changes          — append-only event table, FORCE RLS, exactly one policy (SELECT).
--   §3 record_change_capture() — the one generic AFTER INSERT OR UPDATE trigger function (definer).
--   §4 attach by list          — `<table>_zz_record_change` on every registry table (re-runnable).
--   §5 record_history_visible() + the SELECT policy — a history row is visible exactly when its source
--                               row is visible to the caller under the source table's own RLS.
--   §6 list_record_history()   — the read API (SECURITY INVOKER): own + child events, seq cursor, and
--                               the read-side union with audit_events under audit_events' own RLS.
--   §7 grants                  — explicit, because hosted Supabase grants EXECUTE on new public functions
--                               (and table privileges) to client roles by default.
--   §8 closing self-assertion  — classification completeness, trigger attachment, and the ACL shape,
--                               so the deployed database (not only the local one) is proven.
--
-- Reversibility: supabase/migrations/rollback/0260_record_change_history_down.sql (drops the triggers,
-- the three functions and both tables; loses history, never touches business rows).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the registry
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.record_history_config (
  entity_type text primary key,
  table_name  text not null unique,
  parent_type text,
  parent_col  text,
  -- one-hop parent: the row's parent_col points at this table, whose project_id is the roll-up target.
  parent_via  text check (parent_via in ('budget_versions', 'procurements')),
  captured    jsonb  not null,             -- {column: kind}
  flag_cols   text[] not null default '{}',
  omit_cols   text[] not null default '{}',
  check (jsonb_typeof(captured) = 'object'),
  check ((parent_type is null) = (parent_col is null)),
  check (parent_via is null or parent_col is not null)
);
alter table public.record_history_config enable row level security;
alter table public.record_history_config force row level security;
-- No policy and no client grant: the registry is read only by the definer trigger and the gates.

insert into public.record_history_config
  (entity_type, table_name, parent_type, parent_col, parent_via, captured, flag_cols, omit_cols) values
('project', 'projects', null, null, null,
 '{"code":"text","name":"text","status":"enum","client_id":"ref","project_manager_id":"ref","end_client_id":"ref",
   "contract_value":"money","budget":"money","spent":"money","tax_amount":"money","tax_rate":"number",
   "start_date":"date","end_date":"date","contract_date":"date","archived_at":"timestamp",
   "customer_contract_ref":"text","currency":"text","tax_template":"text","service_line":"text","sector":"text",
   "location":"text","award_type":"text","bidding_entity":"text","tax_treatment":"enum","subject_to_vat":"bool"}',
 '{}',
 '{id,org_id,created_at,last_update,decided_at,contract_value_set_by,contract_value_set_at,tax_base_numerator,tax_base_denominator,pmo_project_number,import_batch_id,imported_at,import_key}'),
('budget_version', 'budget_versions', 'project', 'project_id', null,
 '{"project_id":"ref","version":"number","name":"text","status":"enum","currency":"text"}',
 '{}',
 '{id,org_id,created_at,activated_at,import_batch_id,imported_at,import_key}'),
('budget_line_item', 'budget_line_items', 'project', 'budget_version_id', 'budget_versions',
 '{"budget_version_id":"ref","category":"enum","description":"text","fiscal_year":"text",
   "budgeted_amount":"money","actual_amount":"money"}',
 '{}',
 '{id,org_id,import_batch_id,imported_at,import_key}'),
('work_order', 'work_orders', 'project', 'project_id', null,
 '{"project_id":"ref","wo_number":"text","client_po_number":"text","title":"text","currency":"text",
   "tax_template":"text","status":"enum","tax_treatment":"enum","order_value":"money","tax_amount":"money",
   "tax_rate":"number","order_date":"date","start_date":"date","end_date":"date"}',
 '{description}',
 '{id,org_id,created_at,order_value_set_by,order_value_set_at,issued_by,issued_at,over_commit_ack_by,over_commit_ack_at,closed_at,cancelled_at,tax_base_numerator,tax_base_denominator}'),
('procurement', 'procurements', 'project', 'project_id', null,
 '{"code":"text","title":"text","pr_number":"text","po_number":"text","currency":"text","project_id":"ref",
   "requested_by_id":"ref","vendor_id":"ref","status":"enum","budget_category":"enum","total_value":"money"}',
 '{approval_notes,rejection_notes}',
 '{id,org_id,created_at,updated_at,approved_by_id,vendor_invoiced_at,import_batch_id,imported_at,import_key}'),
('purchase_request', 'purchase_requests', 'project', 'procurement_id', 'procurements',
 '{"procurement_id":"ref","pr_number":"text","reference_number":"text","currency":"text","status":"enum",
   "date":"date","amount":"money"}',
 '{}',
 '{id,org_id,created_at,import_batch_id,imported_at,import_key,erp_docstatus,erp_modified,erp_amended_from,erp_cancelled_at,external_ref}'),
('rfq', 'rfqs', 'project', 'procurement_id', 'procurements',
 '{"procurement_id":"ref","rfq_number":"text","reference_number":"text","currency":"text","status":"enum",
   "date":"date","amount":"money"}',
 '{}',
 '{id,org_id,created_at,import_batch_id,imported_at,import_key,erp_docstatus,erp_modified,erp_amended_from,erp_cancelled_at}'),
('purchase_order', 'purchase_orders', 'project', 'procurement_id', 'procurements',
 '{"procurement_id":"ref","po_number":"text","reference_number":"text","currency":"text","status":"enum",
   "date":"date","amount":"money"}',
 '{}',
 '{id,org_id,created_at,import_batch_id,imported_at,import_key,erp_docstatus,erp_modified,erp_amended_from,erp_cancelled_at,external_ref}'),
('payment', 'payments', 'project', 'procurement_id', 'procurements',
 '{"procurement_id":"ref","invoice_id":"ref","pay_number":"text","reference_number":"text","currency":"text",
   "status":"enum","date":"date","amount":"money"}',
 '{}',
 '{id,org_id,created_at,import_batch_id,imported_at,import_key,erp_docstatus,erp_modified,erp_amended_from,erp_cancelled_at}'),
('task', 'tasks', 'project', 'project_id', null,
 '{"project_id":"ref","assignee_id":"ref","milestone_id":"ref","parent_task_id":"ref","meeting_id":"ref",
   "name":"text","status":"enum","priority":"enum","start_date":"date","end_date":"date","archived_at":"timestamp"}',
 '{description}',
 '{id,org_id,created_at,completed_at,created_by,tombstoned_at,source_updated_at}'),
('company', 'companies', null, null, null,
 '{"name":"text","short_name":"text","client_number_segment":"text","type":"enum","archived_at":"timestamp"}',
 '{}',
 '{id,org_id,created_at,erp_party_type,erp_supplier_name,erp_customer_name,erp_tax_id,erp_payment_terms_days,erp_cancelled_at,erp_docstatus,erp_modified,erp_amended_from}'),
('contact', 'contacts', 'company', 'company_id', null,
 '{"company_id":"ref","full_name":"text","title":"text","archived_at":"timestamp"}',
 '{email,phone,notes}',
 '{id,org_id,created_at,erp_modified}');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — the event table (append-only; the audit_events write-path contract)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.record_changes (
  seq         bigint generated always as identity,
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  entity_type text not null,
  entity_id   uuid not null,
  parent_type text,
  parent_id   uuid,
  op          text not null check (op in ('insert', 'update')),
  actor_id    uuid,
  changes     jsonb not null default '{}',
  currency    text,
  created_at  timestamptz not null default now(),
  unique (seq)
);
create index record_changes_entity_idx on public.record_changes (org_id, entity_type, entity_id, seq desc);
create index record_changes_parent_idx on public.record_changes (org_id, parent_type, parent_id, seq desc)
  where parent_id is not null;
alter table public.record_changes enable row level security;
alter table public.record_changes force row level security;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the capture function. SECURITY DEFINER (postgres owner, RLS-bypassing) so its INSERT passes
-- FORCE RLS with no INSERT policy, exactly as log_audit does. AFTER trigger: NEW is final (org stamp,
-- currency stamp and every BEFORE guard have run). It is the sole writer of record_changes.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    -- exact no-op: nothing to diff, nothing serialized.
    if old is not distinct from new then
      return null;
    end if;
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
    if v_changes = '{}'::jsonb then
      return null;               -- only omit columns (or nothing captured) changed
    end if;
  else
    v_new := to_jsonb(new);    -- insert: who and when, no values
  end if;

  -- parent: a column on the row, or one hop through budget_versions / procurements to the project.
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

  -- actor: the JWT caller (live inside a definer); only without one, the transaction-local
  -- app.actor_id a service-role writer may set; else null ("System").
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — attach by list (the 0074 shape: drop-then-create, re-runnable). The list IS the registry, and
-- §8 plus the pgTAP catalog gate fail if the two ever disagree.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  for t in select table_name from public.record_history_config order by table_name loop
    execute format('drop trigger if exists %I on public.%I', t || '_zz_record_change', t);
    execute format(
      'create trigger %I after insert or update on public.%I for each row execute function public.record_change_capture()',
      t || '_zz_record_change', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — visibility = the source row's own RLS (spec D2). SECURITY INVOKER: each arm runs as the caller,
-- so the source table's policies (org, active member, and anything narrower added later) decide. One
-- static arm per registry entity, no dynamic SQL; an entity without an arm raises, which the catalog
-- gate turns into a red test. A history row whose source row is gone is therefore unreadable.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    when 'payment'          then return exists (select 1 from public.payments          where id = p_entity_id);
    when 'task'             then return exists (select 1 from public.tasks             where id = p_entity_id);
    when 'company'          then return exists (select 1 from public.companies         where id = p_entity_id);
    when 'contact'          then return exists (select 1 from public.contacts          where id = p_entity_id);
    else
      raise exception 'record_history_visible: no visibility arm for entity type %', p_entity_type
        using errcode = 'P0001';
  end case;
end $$;

-- The ONE policy (SELECT). Org + active member first (cheap), then the per-row source-RLS check.
create policy record_changes_select on public.record_changes
  for select to authenticated
  using (org_id = public.auth_org_id()
         and public.is_active_member()
         and public.record_history_visible(entity_type, entity_id));

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the read API. SECURITY INVOKER: record_changes is read under §5's policy and audit_events
-- under its own (own-org Admin / Operator), so a caller who cannot read audit_events gets no audit
-- line, with no role check here to drift from that policy (spec D3, FR-CHG-011).
--
-- Change rows page by seq, newest first (served by the two indexes). Audit lines have no seq (null)
-- and are interleaved by time: a page returns the record's audit lines with created_at in
-- [min(created_at) of this page's change rows, p_before_at); the last page (fewer change rows than
-- p_limit) has no lower bound. Cursor for the next page: p_before_seq = the smallest seq received,
-- p_before_at = the smallest created_at received so far. Each audit line then lands on exactly one page.
-- Audit lines are the requested record's own (entity_id = p_entity_id), and exclude the actions a
-- captured field change already shows plus every delete (a deleted record has no page).
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — grants. Explicit in both directions: hosted Supabase grants new public tables and functions to
-- client roles by default (the local stack does not), so nothing here relies on a default.
-- service_role keeps its table defaults (the audit_events shape; 0137 AC-SVCROLE-008).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke all on table public.record_changes        from public, anon, authenticated;
revoke all on table public.record_history_config from public, anon, authenticated;
grant select on table public.record_changes to authenticated;
revoke all on sequence public.record_changes_seq_seq from public, anon, authenticated;

-- Trigger functions are checked for EXECUTE at CREATE TRIGGER, not at fire time: no grant needed.
revoke all on function public.record_change_capture() from public, anon, authenticated, service_role;
revoke all on function public.record_history_visible(text, uuid) from public, anon;
grant execute on function public.record_history_visible(text, uuid) to authenticated, service_role;
revoke all on function public.list_record_history(text, uuid, boolean, text[], bigint, timestamptz, integer)
  from public, anon;
grant execute on function public.list_record_history(text, uuid, boolean, text[], bigint, timestamptz, integer)
  to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — closing self-assertion (the 0211 style): raise, so a deploy that does not land this exact shape
-- fails here rather than later. Proves the deployed database, whatever its default privileges.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text;
begin
  -- every column of every tracked table classified exactly once, and nothing classified that does not exist
  with cfg as (
    select c.table_name, k.col, k.cls
      from public.record_history_config c
      cross join lateral (
        select jsonb_object_keys(c.captured) as col, 'captured' as cls
        union all select unnest(c.flag_cols), 'flag'
        union all select unnest(c.omit_cols), 'omit') k),
  cols as (
    select c.relname::text as table_name, a.attname::text as col
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
       and c.relname in (select table_name from public.record_history_config))
  select string_agg(x, ', ' order by x) into v_bad from (
    select cols.table_name || '.' || cols.col || ' unclassified' as x
      from cols left join cfg using (table_name, col) where cfg.col is null
    union all
    select cfg.table_name || '.' || cfg.col || ' classified ' || count(*) || 'x'
      from cfg group by cfg.table_name, cfg.col having count(*) > 1
    union all
    select cfg.table_name || '.' || cfg.col || ' does not exist'
      from cfg left join cols using (table_name, col) where cols.col is null) d;
  if v_bad is not null then
    raise exception '0260: record_history_config classification gap: %', v_bad;
  end if;

  -- every registry table has the capture trigger
  select string_agg(c.table_name, ', ') into v_bad
    from public.record_history_config c
   where not exists (
     select 1 from pg_trigger t
      where t.tgrelid = ('public.' || c.table_name)::regclass and not t.tgisinternal
        and t.tgfoid = 'public.record_change_capture()'::regprocedure);
  if v_bad is not null then
    raise exception '0260: tracked tables without the capture trigger: %', v_bad;
  end if;

  -- function ACL, hosted shape
  if has_function_privilege('anon', 'public.record_change_capture()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_change_capture()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.record_change_capture()', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_history_visible(text, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_history_visible(text, uuid)', 'EXECUTE')
     or has_function_privilege('anon',
          'public.list_record_history(text, uuid, boolean, text[], bigint, timestamptz, integer)', 'EXECUTE')
     or not has_function_privilege('authenticated',
          'public.list_record_history(text, uuid, boolean, text[], bigint, timestamptz, integer)', 'EXECUTE') then
    raise exception '0260: record history function ACL is not the intended shape';
  end if;

  -- table ACL: no client write path; the registry unreadable by clients
  if has_table_privilege('anon', 'public.record_changes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.record_changes', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('authenticated', 'public.record_changes', 'SELECT')
     or has_table_privilege('anon', 'public.record_history_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.record_history_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception '0260: record history table ACL is not the intended shape';
  end if;
end $$;
