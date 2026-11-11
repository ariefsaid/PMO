-- rollback/0354_expense_direct_cost_account_down.sql — restores 0270's account-map key list and gate.
-- Stop the sweep's expense pass first (as for 0270). Roll the edge functions back with it: a sweep newer than this
-- database refuses every fresh expense posting (`expense-gate-truth-malformed`) — fail closed, nothing posts wrongly.
-- Deletes the `project_direct_cost` map rows: configuration only, re-entered by an Admin after 0354 is re-applied.
-- Outbox commands already frozen with the direct-cost account replay unchanged (DD-EXP-15).
delete from public.expense_account_map where account_key = 'project_direct_cost';
alter table public.expense_account_map drop constraint expense_account_map_key;
alter table public.expense_account_map add constraint expense_account_map_key check (account_key in
  ('employee_payable','employee_advance','Travel','Accommodation','Meals','Local transport','Other'));

-- 0270 §5 VERBATIM.
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
    'claimant_id', c.claimant_id, 'project_id', c.project_id, 'currency', c.currency,
    'amount', to_char(v_amount, 'FM999999999990.00'), 'lines', v_lines,
    'state_stamp', m.state_stamp,
    'posting_date', to_char((m.state_stamp at time zone v_tz)::date, 'YYYY-MM-DD'),
    'approval_posting_exists', exists (select 1 from public.expense_posting_erp_mirror a
                                        where a.org_id = p_org_id and a.posting_identity = c.id::text || ':approval'),
    'actor_id', m.actor_id);
end; $$;
revoke all on function public.expense_posting_for_push(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expense_posting_for_push(uuid, uuid) to service_role;

do $$
begin
  if pg_get_functiondef('public.expense_posting_for_push(uuid, uuid)'::regprocedure) like '%project_is_internal%' then
    raise exception 'rollback/0354: the gate still carries project_is_internal';
  end if;
  if exists (select 1 from pg_constraint where conname = 'expense_account_map_key'
              and pg_get_constraintdef(oid) like '%project_direct_cost%') then
    raise exception 'rollback/0354: the account map still admits project_direct_cost';
  end if;
  if has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE') then
    raise exception 'rollback/0354: expense_posting_for_push ACL is not the intended shape';
  end if;
end $$;
