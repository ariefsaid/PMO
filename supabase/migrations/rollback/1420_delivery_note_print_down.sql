-- 1420_delivery_note_print_down.sql — rollback 1420_delivery_note_print.sql

revoke all on function public.mrq_set_delivery_note_settings(boolean, text[]) from public, anon, authenticated;
drop function if exists public.mrq_set_delivery_note_settings(boolean, text[]);

alter table public.material_request_settings
  drop column if exists delivery_note_signature_blocks,
  drop column if exists delivery_note_enabled;

-- Revert term_key check constraint
delete from public.org_terminology where term_key = 'deliveryNote';
alter table public.org_terminology drop constraint if exists org_terminology_term_key_check;
alter table public.org_terminology add constraint org_terminology_term_key_check
  check (term_key in ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest'));
