-- 1038_task_work_order_proof_down.sql — reverse of 0991 (reverse order; storage objects must be emptied first).
drop policy if exists storage_objects_task_proof_write on storage.objects;
drop policy if exists storage_objects_task_proof_read  on storage.objects;
delete from storage.buckets where id = 'task-proofs';
drop trigger if exists tasks_zz_done_needs_proof on public.tasks;
drop function if exists public.guard_task_done_needs_proof();
drop table if exists public.task_proofs;
drop function if exists public.task_proofs_audit();
drop function if exists public.task_proofs_guard_remove();
drop function if exists public.task_proofs_before_insert();
drop trigger if exists tasks_check_work_order on public.tasks;
drop function if exists public.check_task_work_order();
drop index if exists public.tasks_work_order_idx;
alter table public.tasks drop column if exists proof_required, drop column if exists work_order_id;
