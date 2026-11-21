-- 1424_issue_closing_report_down.sql — reverse migration 1424 (#2678).

drop function if exists public.get_issue_closing_time_report(date, date, text);
drop table if exists public.issue_department_groups;
drop table if exists public.issue_closing_report_settings;
