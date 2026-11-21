-- 1153_record_linked_task_close_down.sql — reverse of 1071 (triggers, then functions). Loses no task data.
drop function if exists public.task_linked_records(uuid[]);
drop trigger if exists material_requests_close_linked_tasks on public.material_requests;
drop trigger if exists expense_claims_close_linked_tasks on public.expense_claims;
drop trigger if exists procurements_close_linked_tasks on public.procurements;
drop function if exists public.trg_close_linked_tasks();
drop function if exists public.close_tasks_for_record(text, uuid, text);
