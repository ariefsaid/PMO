-- Compose area-aware rate lookup (2132) and validator roles/revenue masking (2290).
-- drops: the two four-argument rate calls gain d.area_id; all remaining 2290 logic is retained verbatim.
-- Rollback: rollback/2441_dsr_validation_queue_composed_down.sql.
create or replace function public.dsr_validation_queue()
returns table (report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid,
               author_name text, submitted_at timestamptz, total_revenue numeric, unrated_lines integer, age_days integer,
               waiting_for_validator boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         case
           when public.dsr_may_see_revenue(d.project_id) then -- mut:dsr_queue_revenue_mask
             coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                       left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id) v on true
                       where l.report_id = d.id), 0)
           else null::numeric
         end,
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id))),
         greatest(0, (public.equipment_org_today(d.org_id) - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and not public.is_light_role_key(pr.built_in_role)
                        and (pr.role in ('Admin','Finance')
                             or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)
                             or (public.org_built_in_roles_enabled(d.org_id)
                                 and exists (select 1 from public.organizations o
                                              where o.id = d.org_id
                                                and pr.built_in_role = any (o.daily_report_validate_roles)))))
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
    left join public.profiles a on a.id = d.author_id
   where d.org_id = public.auth_org_id() and d.status = 'submitted' and d.archived_at is null
     and public.dsr_may_validate(d.project_id)
   order by d.submitted_at, d.id
   limit 500;
end $$;
