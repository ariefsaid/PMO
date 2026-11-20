-- 0960_billing_stages_down.sql — reverses 0960. Refuses while any claim has a stage plan (dropping it would remove the record of
-- how each claim reached its invoice, and the gate that held it). Project stage lists alone are dropped.
do $$ begin
  if exists (select 1 from public.claim_billing_stages) then
    raise exception 'claims carry billing stage plans; 0960 cannot be rolled back' using errcode = 'P0001';
  end if;
end $$;
drop trigger if exists sales_invoices_zz_billing_stages on public.sales_invoices;
drop trigger if exists external_command_outbox_zz_billing_stages on public.external_command_outbox;
drop function if exists public.assert_claim_billing_stages_complete();
drop function if exists public.billing_stages_open(uuid);
drop function if exists public.complete_billing_stage(uuid, date, text, text);
drop function if exists public.note_billing_stage(uuid, text);
drop function if exists public.attach_billing_stage_document(uuid, uuid);
drop function if exists public.lock_billing_stage_claim(uuid);
drop trigger if exists progress_claims_zz_billing_stages on public.progress_claims;
drop function if exists public.instantiate_claim_billing_stages();
update public.record_history_config
   set captured = captured - 'invoice_deadline_day' - 'invoice_deadline_warn_days' where entity_type = 'project';
drop function if exists public.set_project_invoice_deadline(uuid, integer, integer);
drop function if exists public.set_billing_stage_template(uuid, jsonb);
drop table if exists public.claim_billing_stage_documents;
drop table if exists public.claim_billing_stages;
drop table if exists public.billing_stage_template_documents;
drop table if exists public.billing_stage_templates;
alter table public.projects drop column if exists invoice_deadline_warn_days, drop column if exists invoice_deadline_day;
