-- Rollback of 1770: drop the work-order billing step tables and the template step role columns.
drop table if exists public.work_order_billing_step_documents;
drop table if exists public.work_order_billing_steps;
drop table if exists public.org_billing_step_settings;
alter table public.billing_step_template_steps drop constraint if exists billing_step_template_steps_owner_key_not_light;
alter table public.billing_step_template_steps drop column if exists hidden_from_role_keys, drop column if exists owner_role_key;
