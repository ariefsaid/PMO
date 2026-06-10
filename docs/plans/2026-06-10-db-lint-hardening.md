# Plan — DB lint hardening (migration 0021)

**Date:** 2026-06-10 · **Branch:** `chore/0021-db-lint-hardening` · **Owner-approved scope.**

## Problem
Supabase database linter raised two **behavior-neutral** classes worth fixing now:

1. **`function_search_path_mutable` (SECURITY, WARN)** — 4 `security invoker` aggregation RPCs were
   never given a pinned `search_path`, unlike the SoD/definer RPCs (which pin `search_path = public`,
   per 0005). Pin them for consistent search-path-injection hardening.
2. **`auth_rls_initplan` (PERFORMANCE, WARN)** — 10 RLS policies call `auth.uid()` un-wrapped, so it is
   re-evaluated **per row**. Wrap as `(select auth.uid())` so the planner hoists it to a once-per-query
   InitPlan. Pure perf; identical semantics.

**Explicitly out of scope (deferred / rejected):**
- `multiple_permissive_policies` — caused by the `_write FOR ALL` + `_select` overlap on every business
  table. Real, but a broad RLS refactor that must be re-proven table-by-table with pgTAP → **own issue**.
- `anon_security_definer_function_executable` on `auth_org_id()`/`auth_role()` — **rejected**: those fns
  are invoked inside nearly every RLS policy; `revoke execute from anon` would break pre-auth query
  paths. They already return null for `anon` (no JWT) → empty results. Leave as-is.
- `authenticated_security_definer_function_executable` — **by design** (the ADR-0019 SoD-RPC pattern;
  each definer fn re-asserts authz internally). Accept.
- `unindexed_foreign_keys` / `unused_index` (INFO) — single-tenant: `org_id` has zero selectivity, so
  the indexes that exist read as "unused" and missing ones wouldn't help. Revisit at multi-tenant.
- Slow queries — all `oban_jobs` / `_analytics`, i.e. Supabase internals, not app tables.

## Approach — surgical `ALTER`, fully reversible
Use `ALTER FUNCTION … SET search_path` and `ALTER POLICY … USING/WITH CHECK` rather than drop+recreate.
This avoids re-bodying functions (and the get_sales_pipeline 0009-vs-0020 trap) and re-declaring policy
`FOR`/roles. No authz logic changes — only the `auth.uid()` → `(select auth.uid())` wrap.

## Acceptance criteria
- **AC-DBLINT-001** — each of `get_project_budget(uuid)`, `get_executive_dashboard()`,
  `get_win_rate(date,date)`, `get_sales_pipeline()` has `search_path=public` in `pg_proc.proconfig`.
- **AC-DBLINT-002** — each of the 10 flagged policies' `qual`/`with_check` contains `( SELECT auth.uid()`
  and no longer contains a bare un-wrapped `auth.uid()`.
- **AC-DBLINT-003** — **no access regression**: the full existing functional pgTAP suite (timesheets,
  timesheet_entries, procurement_items, profiles, tasks RLS — 0046–0049, 0055, 0056, 0057, etc.) still
  passes. Owned by the existing suite (not re-authored here).

## Files
- `supabase/migrations/0021_lint_hardening.sql` — the ALTERs below.
- `supabase/tests/0058_lint_hardening.test.sql` — pgTAP catalog assertions for AC-001/002.

## Target SQL (migration 0021) — exact
```sql
-- 1) AC-DBLINT-001 — pin search_path on the 4 security-invoker aggregation RPCs.
alter function public.get_project_budget(uuid)       set search_path = public;
alter function public.get_executive_dashboard()      set search_path = public;
alter function public.get_win_rate(date, date)       set search_path = public;
alter function public.get_sales_pipeline()           set search_path = public;

-- 2) AC-DBLINT-002 — wrap auth.uid() as (select auth.uid()) in the 10 flagged policies.
--    Only auth.uid() is wrapped; auth_org_id()/auth_role() are custom STABLE public fns the
--    linter does not flag — left unchanged (minimal change).

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
```

## pgTAP (0058) — assertion shape
```sql
begin;
select plan(14);
-- AC-DBLINT-001: 4 × is( (select proconfig from pg_proc where ... ) @> '{search_path=public}', true, ...)
--   (match by proname + pg_get_function_identity_arguments to disambiguate overloads)
-- AC-DBLINT-002: for each of the 10 policies, ok(qual/with_check LIKE '%( SELECT auth.uid()%') and
--   the corresponding bare-uid count is 0. Read from pg_policies (polname, qual, with_check).
select * from finish();
rollback;
```

## Verify
- Local: `supabase db reset --yes && supabase test db` → 0058 green + whole suite green.
- CI authoritative: the `integration` job (`supabase test db` + Playwright) runs on the PR.

## Notes / risk
- **Migration-number collision:** another director is on `main` locally (not pushed). 0021/0058 are free on
  `origin/main`. If they push a 0021 first, renumber to 0022/0059 before merge.
- No FE/TS changes; `verify` job (typecheck/unit/build/lint) unaffected but still runs.
