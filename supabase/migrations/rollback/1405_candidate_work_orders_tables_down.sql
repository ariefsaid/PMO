-- Rollback of 1405: drops the candidate tables (policies and triggers go with them) and the helpers, in reverse order.
drop table if exists public.work_order_candidate_proofs;
drop table if exists public.work_order_candidate_items;
drop table if exists public.work_order_candidates;
drop table if exists public.work_order_checklist_items;
drop function if exists public.wo_candidate_item_can_edit(uuid);
drop function if exists public.wo_candidate_can_assess(uuid);
drop function if exists public.audit_work_order_candidate_row();
drop function if exists public.check_work_order_candidate_update();
drop function if exists public.check_work_order_candidate_proof();
drop function if exists public.check_work_order_candidate_item();
