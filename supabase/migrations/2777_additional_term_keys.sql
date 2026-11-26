-- Additional organisation terminology keys.
insert into public.org_term_keys (term_key) values
  ('workOrderPlan'), ('foreman')
on conflict (term_key) do nothing;
