-- 2720: retire the candidate work order writers (#2915). Draft work orders with checks replaced them (#2898, 2680).
-- Dropped: the create and decide functions, the check triggers and functions, the audit triggers on the three candidate
-- tables, the assess/edit helpers with the write policies and column grants that used them, and the proof bucket's
-- policies. Kept: the candidate, item and proof tables with their read policies (earlier records stay readable),
-- work_order_checklist_items (the check template), and audit_work_order_candidate_row (the checklist audit trigger
-- still calls it). No storage object or bucket row is touched.
-- Rollback: supabase/migrations/rollback/2720_retire_candidate_work_order_functions_down.sql.

drop function public.create_work_order_candidate(uuid, text, text, text, date, uuid);
drop function public.decide_work_order_candidate(uuid, text, text);

drop trigger zz_work_order_candidate_items_check on public.work_order_candidate_items;
drop trigger zz_work_order_candidate_proofs_check on public.work_order_candidate_proofs;
drop trigger zz_work_order_candidates_check on public.work_order_candidates;
drop function public.check_work_order_candidate_item();
drop function public.check_work_order_candidate_proof();
drop function public.check_work_order_candidate_update();

drop trigger zz_work_order_candidates_audit on public.work_order_candidates;
drop trigger zz_work_order_candidate_items_audit on public.work_order_candidate_items;
drop trigger zz_work_order_candidate_proofs_audit on public.work_order_candidate_proofs;

drop policy work_order_candidates_update on public.work_order_candidates;
drop policy work_order_candidate_items_insert on public.work_order_candidate_items;
drop policy work_order_candidate_items_update on public.work_order_candidate_items;
drop policy work_order_candidate_proofs_insert on public.work_order_candidate_proofs;
drop policy work_order_candidate_proofs_update on public.work_order_candidate_proofs;
drop policy storage_objects_wo_candidate_proof_write on storage.objects;
drop policy storage_objects_wo_candidate_proof_read on storage.objects;

revoke update (title, description, client_reference, offered_on) on public.work_order_candidates from authenticated;
revoke insert (candidate_id, label, required, owner_id, target_date, note) on public.work_order_candidate_items from authenticated;
revoke update (status, note, owner_id, target_date) on public.work_order_candidate_items from authenticated;
revoke insert (id, item_id, file_path, file_name) on public.work_order_candidate_proofs from authenticated;
revoke update (archived_at) on public.work_order_candidate_proofs from authenticated;

drop function public.wo_candidate_item_can_edit(uuid);
drop function public.wo_candidate_can_assess(uuid);

-- The bucket row stays: Supabase refuses a direct delete from storage.buckets (use the Storage API), and a bucket
-- with no policy is unreachable for clients. Remove it through the Storage API once confirmed empty in each environment.
