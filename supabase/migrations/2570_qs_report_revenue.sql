-- Report-only validated revenue read; rollback: rollback/2570_qs_report_revenue_down.sql.
-- drops: dsr_report_revenue admits QS only for a validated same-org report with the setting on.
-- Latest body: 2132; membership, field-account and organisation checks retained.
alter table public.organizations add column qs_report_revenue_enabled boolean not null default true;
grant update(qs_report_revenue_enabled) on public.organizations to authenticated;
create policy organizations_update_qs_report_revenue on public.organizations for update to authenticated
using (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
with check (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

CREATE OR REPLACE FUNCTION public.dsr_report_revenue(p_report uuid)
 RETURNS TABLE(line_id uuid, rate numeric, rate_source text, amount numeric, frozen boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.daily_site_reports;
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = public.auth_org_id();
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if not (public.dsr_may_see_revenue(r.project_id)
    or (r.status = 'validated' and public.actor_holds_job_role('quantity_surveyor')
      and coalesce((select o.qs_report_revenue_enabled from public.organizations o where o.id = r.org_id), false))) then raise exception 'you cannot see revenue on this project' using errcode = '42501'; end if;
  if r.status = 'validated' then
    return query select l.id, l.frozen_rate, l.frozen_rate_source, l.frozen_amount, true
      from public.dsr_progress_lines l where l.report_id = r.id order by l.position;
  else
    return query select l.id, v.rate, v.source, case when v.rate is null then null else public.dsr_line_amount(l.quantity, v.rate) end, false
      from public.dsr_progress_lines l
      left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, r.variant_id, r.work_date, r.area_id) v on true
     where l.report_id = r.id order by l.position;
  end if;
end $function$;

