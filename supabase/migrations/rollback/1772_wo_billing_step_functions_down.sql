-- Rollback of 1772: drop the work-order billing step writers.
drop function if exists public.set_billing_step_template_roles(uuid, jsonb);
drop function if exists public.set_default_billing_step_template(uuid);
drop function if exists public.skip_work_order_step(uuid);
drop function if exists public.complete_work_order_step(uuid, date);
drop function if exists public.attach_work_order_step_document(uuid, uuid, uuid);
drop function if exists public.assign_work_order_step(uuid, uuid);
drop function if exists public.lock_wo_billing_step(uuid);
drop function if exists public.notify_wo_step_opened(public.work_order_billing_steps);
