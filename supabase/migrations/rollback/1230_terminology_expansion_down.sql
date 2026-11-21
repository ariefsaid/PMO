delete from public.org_terminology where term_key not in
  ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest');
alter table public.org_terminology drop constraint if exists org_terminology_term_key_check;
alter table public.org_terminology add constraint org_terminology_term_key_check check (term_key in
  ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest'));
