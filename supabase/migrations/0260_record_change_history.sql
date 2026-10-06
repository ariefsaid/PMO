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
--   §6 grants                  — explicit, because hosted Supabase grants EXECUTE on new public functions
--                               (and table privileges) to client roles by default.
--   §7 list_record_history()   — the read API (SECURITY INVOKER): own + child events, seq cursor, and
--                               the read-side union with audit_events under audit_events' own RLS.
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
