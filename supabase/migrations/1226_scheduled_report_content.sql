-- 1226_scheduled_report_content.sql — #2714: the body of one scheduled report for ONE recipient, computed in the database.
-- Definer-only (no client grant): the tick calls it per recipient. What the recipient may see is decided here from the
-- recipient's own role and project-manager relation, never from the caller: revenue is the role-gated figure (Admin, Finance,
-- Executive, or the project's own PM: the dsr_may_see_revenue audience keyed on the recipient). Every read is filtered to the
-- recipient's organisation, so no other organisation's row can enter a figure. A figure the recipient may not see is left out.
-- Reverse: rollback/1226_scheduled_report_content_down.sql

create function public.scheduled_report_text(p_locale text, p_key text) returns text
  language sql immutable set search_path = pg_catalog as $$
  select case when p_locale = 'id' then
    case p_key
      when 'daily_progress'  then 'Ringkasan kemajuan'
      when 'overdue_tasks'   then 'Tugas terlambat'
      when 'nothing_progress' then 'Tidak ada laporan lapangan untuk periode ini.'
      when 'nothing_overdue'  then 'Tidak ada tugas yang terlambat.'
      when 'reports'   then 'laporan'
      when 'validated' then 'tervalidasi'
      when 'lines'     then 'baris kemajuan'
      when 'revenue'   then 'pendapatan tervalidasi'
      when 'overdue'   then 'terlambat'
      when 'period'    then 'Periode'
    end
  else
    case p_key
      when 'daily_progress'  then 'Progress summary'
      when 'overdue_tasks'   then 'Overdue tasks'
      when 'nothing_progress' then 'No site reports for this period.'
      when 'nothing_overdue'  then 'No overdue tasks.'
      when 'reports'   then 'reports'
      when 'validated' then 'validated'
      when 'lines'     then 'progress lines'
      when 'revenue'   then 'validated revenue'
      when 'overdue'   then 'overdue'
      when 'period'    then 'Period'
    end
  end $$;
revoke all on function public.scheduled_report_text(text, text) from public, anon, authenticated;

-- Returns the email subject and body. p_from..p_to is the local date range the report covers.
create function public.scheduled_report_content(
  p_kind text, p_org uuid, p_recipient uuid, p_from date, p_to date, p_locale text, p_name text
) returns table (subject text, body text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role   text;
  v_cur    text;
  v_lines  text[] := '{}';
  v_head   text;
  r        record;
begin
  select pr.role::text into v_role from public.profiles pr where pr.id = p_recipient and pr.org_id = p_org;
  if v_role is null then return; end if;   -- not a member of this organisation: no figures at all
  select o.default_currency into v_cur from public.organizations o where o.id = p_org;
  v_head := p_name || E'\n' || public.scheduled_report_text(p_locale, p_kind) || E'\n' || public.scheduled_report_text(p_locale, 'period') || ': '
            || case when p_from = p_to then p_to::text else p_from::text || ' - ' || p_to::text end;

  if p_kind = 'daily_progress' then
    for r in
      select p.name as project, count(distinct d.id) as reports,
             count(distinct d.id) filter (where d.status = 'validated') as validated,
             count(distinct l2.id) as lines,
             sum(l2.frozen_amount) filter (where d.status = 'validated') as revenue,
             (v_role in ('Admin','Finance','Executive') or (v_role = 'Project Manager' and p.project_manager_id = p_recipient)) as may_see_revenue
        from public.daily_site_reports d
        join public.projects p on p.id = d.project_id and p.org_id = p_org
        left join public.dsr_progress_lines l2 on l2.report_id = d.id and l2.org_id = p_org
       where d.org_id = p_org and d.work_date between p_from and p_to
         and d.archived_at is null and d.superseded_at is null and d.status <> 'draft'
       group by p.id, p.name, p.project_manager_id
       order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.reports || ' ' || public.scheduled_report_text(p_locale, 'reports')
        || ' (' || r.validated || ' ' || public.scheduled_report_text(p_locale, 'validated') || '), '
        || r.lines || ' ' || public.scheduled_report_text(p_locale, 'lines')
        || case when r.may_see_revenue and r.revenue is not null
                then ', ' || public.scheduled_report_text(p_locale, 'revenue') || ' ' || to_char(r.revenue, 'FM999999999990.00') || ' ' || v_cur
                else '' end);
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_progress')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');

  elsif p_kind = 'overdue_tasks' then
    for r in
      select p.name as project, count(*) as n
        from public.tasks t
        join public.projects p on p.id = t.project_id and p.org_id = p_org
       where t.org_id = p_org and t.status <> 'Done' and t.tombstoned_at is null and t.end_date < p_to
       group by p.id, p.name order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.n || ' ' || public.scheduled_report_text(p_locale, 'overdue'));
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_overdue')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');
  end if;
end $$;
revoke all on function public.scheduled_report_content(text, uuid, uuid, date, date, text, text) from public, anon, authenticated;
