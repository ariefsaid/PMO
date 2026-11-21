-- 1206 (#2710): RESTRICTIVE row policies that confine a light account to its own items.
-- Rollback: supabase/migrations/rollback/1206_light_accounts_restrictive_policies_down.sql
-- A restrictive policy can only narrow what the permissive policies already allow, so every existing policy is untouched and, for
-- anyone who is not a light account, `(select actor_is_light()) is not true` is true: the outcome equals today's.
-- The caller test is ONE `(select public.actor_is_light())` per policy (0646 initplan); the own-row test is evaluated only for a
-- light account (the OR is true first for everyone else).
--
-- COVERED (deny every row and every write to a light account): project and delivery tables, budgets, the CRM lists, procurement,
--   invoices and payments, journals, stock quantity and price tables, daily reports, equipment, rate and cost tables, ERP mirrors.
-- COVERED WITH OWN-ROW TEST: tasks, incident_reports, work_orders, crews, crew_members, work_order_crews.
-- LEFT UNCOVERED, with the reason: profiles (the signed-in shell reads its own and colleagues' names; no money or project data),
--   organizations, org_features, org_terminology, notifications (own rows by existing policy), attendance_days and
--   attendance_photos (existing policy is already own / own-crew only), timesheets and timesheet_entries (own by existing policy,
--   the person's own hours), people (the people_directory view is owner-run and shows basic names only; fixing it is a view change),
--   built_in_roles catalogue (reference data), plans and global_features (reference data), user_views and agent_* tables
--   (per-person), audit_events and error_events (platform).

do $$
declare t text;
begin
  foreach t in array array[
    'projects','project_milestones','project_documents','project_stage_entries','project_progress_entries','project_shared_cost_splits',
    'boq_items','boq_material_allowances','budget_versions','budget_line_items','budget_projections','budget_year_distributions',
    'budget_distribution_plans','companies','contacts','crm_activities','procurements','procurement_items','procurement_quotations',
    'procurement_invoices','procurement_invoice_lines','procurement_receipts','procurement_receipt_lines','purchase_orders',
    'purchase_order_lines','purchase_requests','rfqs','payments','incoming_payments','sales_invoices','expense_claims',
    'expense_claim_lines','imprest_floats','journal_entries','journal_entry_lines','stock_items','stock_balances','stock_ledger',
    'stock_documents','stock_document_lines','stock_warehouses','work_order_lines','work_order_acceptances','work_order_plan_lines',
    'daily_site_reports','equipment_assets','tm_claims','progress_claims','subcontract_acceptances','contract_rate_lines',
    'rate_catalogue_items','rate_catalogue_rates','erp_actuals_snapshot','erp_gl_entry_mirror','erp_ap_aging_snapshot',
    'erp_ar_aging_snapshot','meetings','comments']
  loop
    execute format(
      'create policy light_account_deny on public.%I as restrictive for all to authenticated using ((select public.actor_is_light()) is not true)', t);
  end loop;
end $$;

-- tasks: read and update own (assignee); no insert, no delete; update limited to status by the trigger below.
create policy light_account_scope_select on public.tasks as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or assignee_id = (select auth.uid()));
create policy light_account_scope_update on public.tasks as restrictive for update to authenticated
  using ((select public.actor_is_light()) is not true or assignee_id = (select auth.uid()))
  with check ((select public.actor_is_light()) is not true or assignee_id = (select auth.uid()));
create policy light_account_scope_insert on public.tasks as restrictive for insert to authenticated
  with check ((select public.actor_is_light()) is not true);
create policy light_account_scope_delete on public.tasks as restrictive for delete to authenticated
  using ((select public.actor_is_light()) is not true);

create function public.tasks_light_status_only() returns trigger
  language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if public.actor_is_light()
     and (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'LIGHT_ACCOUNT: a light account may change only the status of its own task' using errcode = '42501';
  end if;
  return new;
end $$;
-- `aa_` fires before the other BEFORE UPDATE triggers, so it sees only what the client sent.
create trigger aa_tasks_light_status_only before update on public.tasks
  for each row execute function public.tasks_light_status_only();

-- incident_reports: read own, report new (reported_by is stamped to the caller by 0017); no edit, no delete.
create policy light_account_scope_select on public.incident_reports as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or reported_by = (select auth.uid()));
create policy light_account_scope_insert on public.incident_reports as restrictive for insert to authenticated
  with check ((select public.actor_is_light()) is not true or reported_by = (select auth.uid()));
create policy light_account_scope_update on public.incident_reports as restrictive for update to authenticated
  using ((select public.actor_is_light()) is not true);
create policy light_account_scope_delete on public.incident_reports as restrictive for delete to authenticated
  using ((select public.actor_is_light()) is not true);

-- work_orders, crews, crew_members, work_order_crews: read only what the person is on or leads; no writes.
do $$
declare t text; c text;
begin
  foreach t in array array['work_orders','crews','crew_members','work_order_crews'] loop
    foreach c in array array['insert','update','delete'] loop
      if c = 'insert' then
        execute format('create policy light_account_scope_insert on public.%I as restrictive for insert to authenticated with check ((select public.actor_is_light()) is not true)', t);
      else
        execute format('create policy light_account_scope_%s on public.%I as restrictive for %s to authenticated using ((select public.actor_is_light()) is not true)', c, t, c);
      end if;
    end loop;
  end loop;
end $$;
create policy light_account_scope_select on public.work_orders as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or public.light_can_see_work_order(id));
create policy light_account_scope_select on public.crews as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or public.light_can_see_crew(id));
create policy light_account_scope_select on public.crew_members as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or public.light_can_see_crew_member(crew_id, worker_id));
create policy light_account_scope_select on public.work_order_crews as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or public.light_can_see_crew(crew_id));
