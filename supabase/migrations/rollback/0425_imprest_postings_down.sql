-- 0425_imprest_postings_down.sql — reverse of 0425 (#1515 S6), reverse dependency order. Stop the sweep pass first.
-- 0. the cash-account lock (review #1, #5). The service_role select on expense_claims stays: other readers may rely on it.
drop trigger if exists imprest_floats_guard_cash_account_trg on public.imprest_floats;
drop function if exists public.guard_imprest_cash_account();
drop index if exists public.imprest_floats_cash_account_one;
-- 1. expense_posting_for_push back to its 0354 §2 text (verbatim).
create or replace function public.expense_posting_for_push(p_org_id uuid, p_mirror_id uuid)
returns jsonb
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  m        public.expense_posting_erp_mirror%rowtype;
  c        public.expense_claims%rowtype;
  r        public.expense_advance_returns%rowtype;
  v_ok     boolean;
  v_amount numeric;
  v_lines  jsonb := '[]'::jsonb;
  v_tz     text;
  v_internal boolean := false;                                                                              -- 0354
begin
  select * into m from public.expense_posting_erp_mirror where id = p_mirror_id and org_id = p_org_id;
  if not found then
    raise exception 'expense posting not found' using errcode = 'P0002';
  end if;
  select * into c from public.expense_claims where id = m.claim_id and org_id = p_org_id;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;

  perform public.expense_posting_actor_check(p_org_id, p_mirror_id);

  -- An approval whose claim was cancelled before it posted is never posted fresh (a command already in the outbox
  -- is replayed without this gate and still lands; its cancel follows). With no command, the cancel is a no-op.
  if m.posting = 'approval' and c.status = 'Cancelled' then
    raise exception 'expense-posting-claim-cancelled' using errcode = 'P0001';
  end if;

  v_ok := case m.posting
    when 'approval'        then c.kind = 'claim' and c.status in ('Approved','Paid') and c.approved_at = m.state_stamp
    when 'claim-payment'   then c.kind = 'claim' and c.status = 'Paid' and c.paid_at = m.state_stamp
                                and c.amount - c.advance_applied > 0
    when 'settlement'      then c.kind = 'claim' and c.status = 'Paid' and c.paid_at = m.state_stamp and c.advance_applied > 0
    when 'advance-payment' then c.kind = 'advance' and c.status = 'Paid' and c.paid_at = m.state_stamp
    when 'advance-return'  then c.kind = 'advance' and c.status = 'Paid'
    when 'approval-cancel' then c.kind = 'claim' and c.status = 'Cancelled' and c.cancelled_at = m.state_stamp
                                and c.approved_at is not null
    else false end;
  if m.posting = 'advance-return' then
    select * into r from public.expense_advance_returns
     where id = m.return_id and advance_id = c.id and org_id = p_org_id;
    v_ok := v_ok and found and r.recorded_at = m.state_stamp;
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'expense-posting-precondition-failed' using errcode = 'P0001';
  end if;

  -- 0354 (FR-EXP-119): is the claim's project an Internal Project — read NOW from this org's own row, never from a
  -- payload or the client. A project id that does not resolve inside the org fails closed: no default account.
  if c.project_id is not null then                                                                         -- 0354
    select p.status::text = 'Internal Project' into v_internal                                              -- 0354
      from public.projects p where p.id = c.project_id and p.org_id = p_org_id;                             -- 0354
    if not found then                                                                                       -- 0354
      raise exception 'expense-posting-precondition-failed' using errcode = 'P0001';                        -- 0354
    end if;                                                                                                 -- 0354
  end if;                                                                                                   -- 0354

  v_amount := case m.posting
    when 'claim-payment'  then c.amount - c.advance_applied
    when 'settlement'     then c.advance_applied
    when 'advance-return' then r.amount
    else c.amount end;
  if m.posting = 'approval' then
    select coalesce(jsonb_agg(jsonb_build_object('expense_type', t.expense_type,
                                                 'amount', to_char(t.amount, 'FM999999999990.00'))
                              order by t.expense_type), '[]'::jsonb)
      into v_lines
      from (select l.expense_type::text as expense_type, sum(l.amount) as amount
              from public.expense_claim_lines l where l.claim_id = c.id group by l.expense_type) t;
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = p_org_id), 'UTC');

  return jsonb_build_object(
    'mirror_id', m.id, 'posting', m.posting, 'posting_identity', m.posting_identity,
    'subject_id', coalesce(m.return_id, m.claim_id), 'claim_id', c.id, 'claim_number', c.claim_number,
    'claimant_id', c.claimant_id, 'project_id', c.project_id,
    'project_is_internal', coalesce(v_internal, false),                                                     -- 0354
    'currency', c.currency,
    'amount', to_char(v_amount, 'FM999999999990.00'), 'lines', v_lines,
    'state_stamp', m.state_stamp,
    'posting_date', to_char((m.state_stamp at time zone v_tz)::date, 'YYYY-MM-DD'),
    'approval_posting_exists', exists (select 1 from public.expense_posting_erp_mirror a
                                        where a.org_id = p_org_id and a.posting_identity = c.id::text || ':approval'),
    'actor_id', m.actor_id);
end; $$;
revoke all on function public.expense_posting_for_push(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expense_posting_for_push(uuid, uuid) to service_role;
-- 2. expense_posting_actor_check back to its 0270 §5 text (verbatim); the custodian grant goes.
create or replace function public.expense_posting_actor_check(p_org_id uuid, p_mirror_id uuid)
returns void
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  m      public.expense_posting_erp_mirror%rowtype;
  v_role user_role;
  v_org  uuid;
begin
  select * into m from public.expense_posting_erp_mirror where id = p_mirror_id and org_id = p_org_id;
  if not found then
    raise exception 'expense posting not found' using errcode = 'P0002';
  end if;
  if m.actor_id is null then
    raise exception 'expense-posting-no-recorded-actor' using errcode = '42501';
  end if;
  if not public.is_active_member(m.actor_id) then
    raise exception 'expense-posting-actor-inactive' using errcode = '42501';
  end if;
  select pf.role, pf.org_id into v_role, v_org from public.profiles pf where pf.id = m.actor_id;
  if v_org is distinct from p_org_id then
    raise exception 'expense-posting-actor-cross-org' using errcode = '42501';
  end if;
  if not (v_role = 'Admin'
          or (m.posting = 'approval' and public.holds_spend_approval_authority(v_role))
          or (m.posting <> 'approval' and v_role = 'Finance')) then
    raise exception 'expense-posting-actor-not-authorized' using errcode = '42501';
  end if;
end; $$;
revoke all on function public.expense_posting_actor_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expense_posting_actor_check(uuid, uuid) to service_role;
revoke execute on function public.imprest_custodian_eligible(uuid, uuid, uuid) from service_role;
-- 3. the replenishment posting: trigger, functions, table (the intents are derived; no PMO data is lost).
drop trigger if exists imprest_replenishments_enqueue_posting_trg on public.imprest_replenishments;
drop function if exists public.enqueue_imprest_replenishment_posting();
drop function if exists public.imprest_posting_for_push(uuid, uuid);
drop table if exists public.imprest_posting_erp_mirror;
revoke update (erp_cash_account_ref) on public.imprest_floats from service_role;
revoke select on public.imprest_floats, public.imprest_replenishments from service_role;
drop function if exists public.org_employs_imprest_postings(uuid);
