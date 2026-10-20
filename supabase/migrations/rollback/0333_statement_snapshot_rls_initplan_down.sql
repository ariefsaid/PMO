-- Revert 0333; restore the 0316 snapshot read policy text.
begin;

drop policy erp_financial_statement_snapshot_select on public.erp_financial_statement_snapshot;
create policy erp_financial_statement_snapshot_select
  on public.erp_financial_statement_snapshot
  for select to authenticated
  using (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and (
      public.auth_role() in ('Admin', 'Finance', 'Executive')
      or (
        public.auth_role() in ('Project Manager', 'Engineer')
        and scope_kind = 'project'
        and view_kind = 'project_totals'
        and exists (
          select 1
            from public.projects p
           where p.id = erp_financial_statement_snapshot.project_id
             and p.org_id = public.auth_org_id()
        )
      )
    )
  );

commit;
