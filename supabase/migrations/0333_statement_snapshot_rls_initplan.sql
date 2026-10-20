-- 0333 — statement snapshot read policy resolves caller context once per statement.
-- Rollback: rollback/0333_statement_snapshot_rls_initplan_down.sql
-- Same predicate as 0316; each auth helper is wrapped in a scalar sub-select so the
-- planner evaluates it once per statement (InitPlan) instead of once per scanned row.
begin;

drop policy erp_financial_statement_snapshot_select on public.erp_financial_statement_snapshot;
create policy erp_financial_statement_snapshot_select
  on public.erp_financial_statement_snapshot
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (
      (select public.auth_role()) in ('Admin', 'Finance', 'Executive')
      or (
        (select public.auth_role()) in ('Project Manager', 'Engineer')
        and scope_kind = 'project'
        and view_kind = 'project_totals'
        and exists (
          select 1
            from public.projects p
           where p.id = erp_financial_statement_snapshot.project_id
             and p.org_id = (select public.auth_org_id())
        )
      )
    )
  );

commit;
