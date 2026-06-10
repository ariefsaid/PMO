-- 0058_lint_hardening.test.sql — pgTAP catalog assertions for migration 0021 (DB lint hardening).
-- AC-DBLINT-001: 4 security-invoker aggregation RPCs have search_path pinned to public.
-- AC-DBLINT-002: 10 flagged RLS policies wrap auth.uid() as (select auth.uid()) for InitPlan hoisting.
-- AC-DBLINT-003 is owned by the broader existing test suite (0046–0057); not re-authored here.
begin;
select plan(24);

-- ─────────────────────────────────────────────────────────────────────────────
-- AC-DBLINT-001 (×4): search_path = public pinned on the 4 security-invoker RPCs.
-- Disambiguate overloads via pg_get_function_identity_arguments(oid).
-- ─────────────────────────────────────────────────────────────────────────────

select ok(
  (select 'search_path=public' = any(proconfig)
     from pg_proc
    where proname = 'get_sales_pipeline'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) = ''),
  'AC-DBLINT-001: get_sales_pipeline() search_path pinned to public'
);

select ok(
  (select 'search_path=public' = any(proconfig)
     from pg_proc
    where proname = 'get_executive_dashboard'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) = ''),
  'AC-DBLINT-001: get_executive_dashboard() search_path pinned to public'
);

select ok(
  (select 'search_path=public' = any(proconfig)
     from pg_proc
    where proname = 'get_win_rate'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) = 'p_from date, p_to date'),
  'AC-DBLINT-001: get_win_rate(date,date) search_path pinned to public'
);

select ok(
  (select 'search_path=public' = any(proconfig)
     from pg_proc
    where proname = 'get_project_budget'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) = 'p_project_id uuid'),
  'AC-DBLINT-001: get_project_budget(uuid) search_path pinned to public'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- AC-DBLINT-002 (×10): each flagged policy's relevant clause contains
-- '( SELECT auth.uid()' (the InitPlan-hoisted form). Check the clause that
-- carries the bare auth.uid() per policy:
--   INSERT-only → with_check; SELECT-only → qual; UPDATE → primary clause;
--   DELETE-only → qual.
-- ─────────────────────────────────────────────────────────────────────────────

-- timesheets_insert (INSERT — with_check only)
select ok(
  (select with_check like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'timesheets'
      and policyname = 'timesheets_insert'),
  'AC-DBLINT-002: timesheets_insert with_check wraps auth.uid() as (select auth.uid())'
);

-- timesheets_update_own (UPDATE — qual + with_check both carry auth.uid())
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'timesheets'
      and policyname = 'timesheets_update_own'),
  'AC-DBLINT-002: timesheets_update_own qual wraps auth.uid() as (select auth.uid())'
);

-- timesheets_select (SELECT — qual only; manager_id subquery also had bare uid)
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'timesheets'
      and policyname = 'timesheets_select'),
  'AC-DBLINT-002: timesheets_select qual wraps auth.uid() as (select auth.uid())'
);

-- timesheet_entries_select (SELECT — qual only)
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'timesheet_entries'
      and policyname = 'timesheet_entries_select'),
  'AC-DBLINT-002: timesheet_entries_select qual wraps auth.uid() as (select auth.uid())'
);

-- timesheet_entries_write (ALL — qual carries auth.uid())
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'timesheet_entries'
      and policyname = 'timesheet_entries_write'),
  'AC-DBLINT-002: timesheet_entries_write qual wraps auth.uid() as (select auth.uid())'
);

-- profiles_update_self (UPDATE — qual carries bare auth.uid())
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'profiles'
      and policyname = 'profiles_update_self'),
  'AC-DBLINT-002: profiles_update_self qual wraps auth.uid() as (select auth.uid())'
);

-- tasks_update_own_status (UPDATE — qual carries auth.uid())
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'tasks'
      and policyname = 'tasks_update_own_status'),
  'AC-DBLINT-002: tasks_update_own_status qual wraps auth.uid() as (select auth.uid())'
);

-- procurement_items_requester (INSERT — with_check only)
select ok(
  (select with_check like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'procurement_items'
      and policyname = 'procurement_items_requester'),
  'AC-DBLINT-002: procurement_items_requester with_check wraps auth.uid() as (select auth.uid())'
);

-- procurement_items_requester_mod (UPDATE — qual carries auth.uid())
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'procurement_items'
      and policyname = 'procurement_items_requester_mod'),
  'AC-DBLINT-002: procurement_items_requester_mod qual wraps auth.uid() as (select auth.uid())'
);

-- procurement_items_requester_del (DELETE — qual only)
select ok(
  (select qual like '%( SELECT auth.uid()%'
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'procurement_items'
      and policyname = 'procurement_items_requester_del'),
  'AC-DBLINT-002: procurement_items_requester_del qual wraps auth.uid() as (select auth.uid())'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- AC-DBLINT-002 completeness (×10): NO bare un-wrapped auth.uid() remains in any
-- flagged policy. Guards the multi-occurrence policies (timesheets_select's
-- manager_id sub-clause, profiles_update_self's 3 self-lookups) where the positive
-- presence check above could pass while leaving a sibling occurrence un-hoisted.
-- Oracle: across both clauses, every auth.uid() occurrence is the wrapped form, i.e.
-- count(auth.uid()) = count(( SELECT auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────────

select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'timesheets' and policyname = 'timesheets_insert'),
  'AC-DBLINT-002: timesheets_insert has no un-wrapped auth.uid()'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'timesheets' and policyname = 'timesheets_update_own'),
  'AC-DBLINT-002: timesheets_update_own has no un-wrapped auth.uid()'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'timesheets' and policyname = 'timesheets_select'),
  'AC-DBLINT-002: timesheets_select has no un-wrapped auth.uid() (incl. manager_id sub-clause)'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'timesheet_entries' and policyname = 'timesheet_entries_select'),
  'AC-DBLINT-002: timesheet_entries_select has no un-wrapped auth.uid()'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'timesheet_entries' and policyname = 'timesheet_entries_write'),
  'AC-DBLINT-002: timesheet_entries_write has no un-wrapped auth.uid() (USING + WITH CHECK)'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_self'),
  'AC-DBLINT-002: profiles_update_self has no un-wrapped auth.uid() (all 3 self-lookups)'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_update_own_status'),
  'AC-DBLINT-002: tasks_update_own_status has no un-wrapped auth.uid()'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'procurement_items' and policyname = 'procurement_items_requester'),
  'AC-DBLINT-002: procurement_items_requester has no un-wrapped auth.uid()'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'procurement_items' and policyname = 'procurement_items_requester_mod'),
  'AC-DBLINT-002: procurement_items_requester_mod has no un-wrapped auth.uid()'
);
select ok(
  (select regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
        = regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( SELECT auth\.uid\(\)')
     from pg_policies
    where schemaname = 'public' and tablename = 'procurement_items' and policyname = 'procurement_items_requester_del'),
  'AC-DBLINT-002: procurement_items_requester_del has no un-wrapped auth.uid()'
);

select * from finish();
rollback;
