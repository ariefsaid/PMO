-- Reverse of 1159_crew_tool_rpcs.sql. Reverse 1083 first.
drop view if exists public.crew_tool_line_summary;
drop function if exists public.set_crew_tool_settings(uuid, integer);
drop function if exists public.close_crew_tool_report(uuid, text);
drop function if exists public.correct_crew_tool_report(uuid, text, integer, text);
drop function if exists public.report_crew_tool(uuid, uuid, text, integer, text, jsonb);
drop function if exists public.crew_tool_locale(uuid);
drop function if exists public.crew_tool_org_locale(uuid);
drop function if exists public.crew_tool_message(text, text, text, integer, text, date);
