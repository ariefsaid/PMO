drop function if exists public.end_contract_rate_assignee(uuid, uuid, date);
drop function if exists public.set_contract_rate_assignee(uuid, uuid, uuid, date, date);
drop function if exists public.end_contract_rate_line(uuid, uuid, date, integer);
drop function if exists public.save_contract_rate_line(jsonb);
drop function if exists public.contract_rate_line_write(jsonb, text);
drop function if exists public.contract_rate_line_content(uuid);
drop function if exists public.contract_rate_line_normalize(uuid, jsonb);
drop table if exists public.contract_rate_assignees;
drop table if exists public.contract_rate_lines;
