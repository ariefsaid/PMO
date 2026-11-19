-- 0985_equipment_availability_down.sql — reverse of 0985 (#2526), reverse dependency order. Loses status, rental and proof rows.
drop policy if exists storage_objects_equipment_proof_write on storage.objects;
drop policy if exists storage_objects_equipment_proof_read  on storage.objects;
-- Keep the private bucket and its objects: object removal belongs to the Storage API, not SQL.
-- The access policies above are removed; an operator may handle retained files through Storage.

drop function if exists public.set_equipment_working_hours(numeric);
drop function if exists public.add_equipment_downtime_proof(uuid, date, text, text);
drop function if exists public.set_equipment_status_bulk(date, jsonb);
drop function if exists public.set_equipment_status(uuid, date, text, text);
drop function if exists public.equipment_set_status_core(uuid, date, text, text);
drop function if exists public.end_equipment_rental_term(uuid, date);
drop function if exists public.change_equipment_rental_rate(uuid, date, numeric);
drop function if exists public.save_equipment_rental_term(jsonb);
drop function if exists public.set_equipment_ownership(uuid, text, date);
drop function if exists public.equipment_can_edit_terms(public.user_role);
drop function if exists public.equipment_can_set_status(public.user_role);
drop table if exists public.equipment_escalation_log;
drop table if exists public.equipment_downtime_proofs;
drop table if exists public.equipment_status_history;
drop table if exists public.equipment_status_days;
drop table if exists public.equipment_rental_terms;
drop function if exists public.equipment_status_record_history();
drop function if exists public.equipment_rental_terms_no_overlap();
alter table public.organizations drop column if exists equipment_working_hours;
alter table public.equipment_assets drop column if exists in_service_on, drop column if exists ownership;
