-- Reverses 0250_progress_billing.sql. Run 0251's rollback first (it reads the view). BoQ lines, assessment
-- quantities, claims and evidence are dropped; #765's percent entries stay (a quantity-derived percent remains
-- as a typed one); posted ERP documents are untouched.
drop function if exists public.get_project_billing(uuid);
drop view if exists public.sales_invoice_work_billed;
drop trigger if exists sales_invoices_append_progress_claim_author on public.sales_invoices;
drop function if exists public.append_progress_claim_author();
drop trigger if exists external_command_outbox_zz_progress_claim_fence on public.external_command_outbox;
drop function if exists public.assert_progress_claim_raisable();
drop function if exists public.withdraw_progress_claim(uuid);
drop function if exists public.attach_claim_evidence(uuid, uuid);
drop table if exists public.progress_claim_evidence;
drop function if exists public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean);
drop table if exists public.progress_claim_lines;
drop table if exists public.progress_claims;
drop function if exists public.refuse_progress_claim_line_change();
drop function if exists public.assert_progress_claim_update();
drop function if exists public.record_progress_assessment(uuid, date, jsonb, text);
drop table if exists public.progress_assessment_quantities;
drop function if exists public.progress_assessment_line_ok(uuid, uuid);
drop table if exists public.boq_items;
drop function if exists public.check_boq_item_work_order_same_project();
drop trigger if exists organizations_audit_down_payment_item on public.organizations;
drop function if exists public.audit_org_down_payment_item();
alter table public.organizations drop column if exists down_payment_item;

-- Restore 0245's record_project_progress verbatim (without 0250's quantity refusal).
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;
