-- 0021_lint_hardening.sql — Database lint hardening (AC-DBLINT-001 / AC-DBLINT-002).
-- Forward-only, behavior-neutral; reversibility = `supabase db reset` (ADR-0006, pre-production).
--
-- TWO lint classes fixed surgically via ALTER (not drop+recreate), so function bodies and policy
-- FOR/roles are not re-specified — only the targeted attributes change:
--
-- 1) SEARCH_PATH PIN (AC-DBLINT-001 — Supabase lint class: function_search_path_mutable, SECURITY WARN)
--    4 security-invoker aggregation RPCs (get_project_budget, get_executive_dashboard, get_win_rate,
--    get_sales_pipeline) were created without a pinned search_path. Any object created/renamed in a
--    non-public schema can shadow public objects and hijack these functions. Pinning search_path=public
--    is the standard hardening (the SoD/definer RPCs already pin it, per 0005/0006/0007/0014/0015/0018).
--    `ALTER FUNCTION … SET search_path = public` pins it without re-bodying the functions, avoiding the
--    get_sales_pipeline 0009-vs-0020 re-body trap.
--
-- 2) AUTH.UID() INITPLAN WRAP (AC-DBLINT-002 — Supabase lint class: auth_rls_initplan, PERFORMANCE WARN)
--    10 RLS policies call auth.uid() without the (select …) wrapper. PostgreSQL evaluates a bare
--    function call in a WHERE/USING/WITH CHECK expression once per row; wrapping it as
--    `(select auth.uid())` lets the planner hoist the result to an InitPlan evaluated once per
--    statement. This is a pure planner hint — semantics are IDENTICAL. Only auth.uid() is wrapped;
--    auth_org_id() and auth_role() are STABLE security-definer functions in the public schema that
--    the linter does not flag (they already carry their own per-call optimizations).
--    `ALTER POLICY … USING / WITH CHECK` changes only the predicate expression; FOR command, roles,
--    and policy name are untouched.
--
-- Explicitly NOT touched (per plan scope):
--   • auth_org_id() / auth_role() — custom STABLE public fns the linter does not flag.
--   • multiple_permissive_policies — broad RLS refactor; own issue.
--   • anon/authenticated security_definer_function_executable — by design (ADR-0019 pattern).
--   • unindexed_foreign_keys / unused_index (INFO, single-tenant org_id selectivity).

-- ============================================================================
-- 1) AC-DBLINT-001 — pin search_path on the 4 security-invoker aggregation RPCs.
-- ============================================================================
alter function public.get_project_budget(uuid)       set search_path = public;
alter function public.get_executive_dashboard()      set search_path = public;
alter function public.get_win_rate(date, date)       set search_path = public;
alter function public.get_sales_pipeline()           set search_path = public;

-- ============================================================================
-- 2) AC-DBLINT-002 — wrap auth.uid() as (select auth.uid()) in the 10 flagged policies.
--    Only auth.uid() is wrapped; auth_org_id()/auth_role() are custom STABLE public fns the
--    linter does not flag — left unchanged (minimal change, no semantic impact).
-- ============================================================================

alter policy timesheets_insert on timesheets
  with check (org_id = auth_org_id() and user_id = (select auth.uid()));

alter policy timesheets_update_own on timesheets
  using      (org_id = auth_org_id() and user_id = (select auth.uid()) and status = 'Draft')
  with check (org_id = auth_org_id() and user_id = (select auth.uid()) and status = 'Draft');

alter policy timesheets_select on timesheets
  using (org_id = auth_org_id() and (user_id = (select auth.uid())
         or auth_role() in ('Admin','Executive','Project Manager','Finance')
         or exists (select 1 from public.profiles p
                    where p.id = timesheets.user_id and p.manager_id = (select auth.uid()))));

alter policy timesheet_entries_select on timesheet_entries
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and (t.user_id = (select auth.uid())
           or auth_role() in ('Admin','Executive','Project Manager','Finance'))));

alter policy timesheet_entries_write on timesheet_entries
  using (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Engineer')
    and exists (select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
        and t.user_id = (select auth.uid()) and t.status = 'Draft')
    and exists (select 1 from public.projects p
        where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Engineer')
    and exists (select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
        and t.user_id = (select auth.uid()) and t.status = 'Draft')
    and exists (select 1 from public.projects p
        where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()));

alter policy profiles_update_self on profiles
  using (id = (select auth.uid()))
  with check (
    org_id      = (select p.org_id     from profiles p where p.id = (select auth.uid()))
    and role    = (select p.role       from profiles p where p.id = (select auth.uid()))
    and manager_id is not distinct from (select p.manager_id from profiles p where p.id = (select auth.uid())));

alter policy tasks_update_own_status on tasks
  using      (org_id = auth_org_id() and assignee_id = (select auth.uid()))
  with check (org_id = auth_org_id() and assignee_id = (select auth.uid()));

alter policy procurement_items_requester on procurement_items
  with check (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id() and p.requested_by_id = (select auth.uid())));

alter policy procurement_items_requester_mod on procurement_items
  using (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id() and p.requested_by_id = (select auth.uid())))
  with check (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id() and p.requested_by_id = (select auth.uid())));

alter policy procurement_items_requester_del on procurement_items
  using (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id() and p.requested_by_id = (select auth.uid())));
