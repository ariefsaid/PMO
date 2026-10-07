-- rollback/0270_expense_postings_down.sql — reverse of 0270 (ADR-0006). App first: deploy an erpnext-sweep without
-- pass (7) and an external-set-company without the expense actions, THEN run this in one transaction.
-- Intents, returns rows and the account map are dropped; claims, advances and returned_amount are untouched.
-- Outbox rows and external_refs in domain 'expenses' stay as audit (ADR-0058 §Consequences).
begin;
drop trigger if exists expense_advance_returns_enqueue_posting_trg on public.expense_advance_returns;
drop trigger if exists expense_claims_enqueue_postings_trg on public.expense_claims;
drop function if exists public.enqueue_expense_return_posting();
drop function if exists public.enqueue_expense_claim_postings();
drop function if exists public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid);
drop policy if exists external_command_outbox_expenses_read_scope on public.external_command_outbox;
drop policy if exists erp_gl_entry_mirror_employee_read_scope on public.erp_gl_entry_mirror;
drop function if exists public.expense_posting_for_push(uuid, uuid);
drop function if exists public.expense_posting_actor_check(uuid, uuid);
drop function if exists public.org_employs_expense_postings(uuid);
drop table if exists public.expense_posting_erp_mirror;
drop table if exists public.expense_account_map;

-- 0247 §9 body, verbatim (before the returns table goes, so nothing references it).
create or replace function public.record_expense_advance_return(p_id uuid, p_amount numeric, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.expense_claims%rowtype;
  v_out  numeric;
  v_uid  uuid      := auth.uid();
  v_role user_role := auth_role();
begin
  perform public.assert_is_active_member();
  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense advance not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.kind is distinct from 'advance' or v_row.status is distinct from 'Paid' then
    raise exception 'only a paid advance can have cash returned against it' using errcode = 'P0001';
  end if;
  if v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot record a return of their own advance' using errcode = '42501';
  end if;
  if v_role is distinct from 'Finance' and v_role is distinct from 'Admin' then
    raise exception 'only Finance or an Admin records an advance return' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a return amount must be greater than zero' using errcode = 'P0001';
  end if;
  v_out := public.expense_advance_outstanding(p_id);
  if p_amount > v_out then
    raise exception 'a return of % exceeds the % still outstanding on this advance', round(p_amount, 2), round(v_out, 2)
      using errcode = 'P0001';
  end if;
  update public.expense_claims set returned_amount = returned_amount + p_amount where id = p_id;
  perform public.log_audit('expense_advance.return', v_row.org_id, v_uid, p_id,
    jsonb_build_object('amount', p_amount, 'reference', nullif(btrim(p_reference), ''), 'outstanding_after', v_out - p_amount));
end; $$;
revoke all on function public.record_expense_advance_return(uuid, numeric, text) from public, anon;
grant execute on function public.record_expense_advance_return(uuid, numeric, text) to authenticated;

drop table if exists public.expense_advance_returns;
-- The 'expenses' ownership rows are inert without 0270; remove them so a re-apply starts un-employed.
delete from public.external_domain_ownership where domain = 'expenses';
commit;
