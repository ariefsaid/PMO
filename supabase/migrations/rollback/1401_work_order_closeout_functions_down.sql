-- 1401_work_order_closeout_functions_down.sql — reverses 1401 (functions only; the data stays until the 1400 rollback).
drop function if exists public.complete_closeout_item(uuid, date);
drop function if exists public.attach_closeout_item_document(uuid, uuid);
drop function if exists public.lock_closeout_item(uuid);
drop function if exists public.set_closeout_checklist(jsonb);
