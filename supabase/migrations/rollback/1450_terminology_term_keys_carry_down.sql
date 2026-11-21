-- Reverse of 1450: restore 1420_delivery_note_print.sql's constraint (the six original keys plus 'deliveryNote').

alter table public.org_terminology drop constraint if exists org_terminology_term_key_check;
alter table public.org_terminology add constraint org_terminology_term_key_check
  check (term_key in ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest','deliveryNote'));
