-- 1162_client_requisitions_down.sql — reverse 1086 (apply rollback/1087_client_requisition_rpcs_down.sql first).
drop table if exists public.client_requisition_events;
drop table if exists public.client_requisition_pickups;
drop table if exists public.client_requisition_lines;
drop table if exists public.client_requisitions;
drop function if exists public.guard_client_requisition_history();
