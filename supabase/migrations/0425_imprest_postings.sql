-- 0425_imprest_postings.sql — #1515 S6: site-float ERP postings (spec §9, DD-IMP-6). ADR-0059 Posture B, ADR-0081 one
-- originator, ADR-0058 outbox. Re-creates expense_posting_actor_check (0270 §5) and expense_posting_for_push (0354 §2)
-- from their current text plus the lines marked `-- 0425`.
-- ⚑ PQ-11 (a float record whose float has no cash account posts nothing) already ships in 0423 §6, which re-created
--   enqueue_expense_claim_postings / enqueue_expense_return_posting; this migration does not touch them again.
-- Proven by supabase/tests/imprest_postings.test.sql, imprest_acl.test.sql and the §6 self-assertion.
-- REVERSE: rollback/0425_imprest_postings_down.sql (stop the sweep pass first).

-- §1 tier-neutral employment: any activated binding whose tier owns `expenses` (no tier literal, so #1509 needs no
-- change here).
create or replace function public.org_employs_imprest_postings(p_org_id uuid) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (select 1 from public.external_org_bindings b
                   join public.external_domain_ownership d on d.org_id = b.org_id and d.external_tier = b.external_tier
                  where b.org_id = p_org_id and b.activated_at is not null and d.domain = 'expenses')
$$;
revoke all on function public.org_employs_imprest_postings(uuid) from public, anon, authenticated;
grant execute on function public.org_employs_imprest_postings(uuid) to service_role;

-- §2 the replenishment side mirror (one row per paid replenishment or funding). Written (insert) only by the trigger
-- below, then only by the sweep (service role).
create table public.imprest_posting_erp_mirror (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  replenishment_id uuid not null references public.imprest_replenishments(id),
  posting          text not null default 'replenishment',
  posting_identity text not null,
  state_stamp      timestamptz not null,
  actor_id         uuid references public.profiles(id),
  push_state       text not null default 'pending',
  push_error       text,
  erp_name         text,
  pushed_at        timestamptz,
  last_attempt_at  timestamptz,
  attempt_count    int not null default 0,
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint imprest_posting_erp_mirror_posting  check (posting = 'replenishment'),
  constraint imprest_posting_erp_mirror_state    check (push_state in ('pending','failed','held','pushed')),
  constraint imprest_posting_erp_mirror_identity check (posting_identity = replenishment_id::text || ':replenishment'),
  constraint imprest_posting_erp_mirror_identity_unique unique (org_id, posting_identity)
);
create index imprest_posting_erp_mirror_queue_idx
  on public.imprest_posting_erp_mirror (org_id, push_state, last_attempt_at nulls first, created_at) where erp_cancelled_at is null;
create index imprest_posting_erp_mirror_rep_idx on public.imprest_posting_erp_mirror (replenishment_id);
comment on table public.imprest_posting_erp_mirror is
  '#1515 S6 — ERP posting intents for paid float replenishments/fundings (ADR-0081) and their ERP-side state.';
alter table public.imprest_posting_erp_mirror enable row level security;
alter table public.imprest_posting_erp_mirror force  row level security;
-- Never more visible than the replenishment it posts (the parent's own RLS decides).
create policy imprest_posting_erp_mirror_select on public.imprest_posting_erp_mirror for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_replenishments r where r.id = imprest_posting_erp_mirror.replenishment_id));
revoke all on public.imprest_posting_erp_mirror from public, anon, authenticated;
grant select on public.imprest_posting_erp_mirror to authenticated;
grant select, insert, update, delete on public.imprest_posting_erp_mirror to service_role;
-- The gate (invoker, service_role) reads the float and the replenishment; the validating edge function (S6.7) writes the
-- cash account. A client holds no update grant on imprest_floats (0422).
grant select on public.imprest_floats, public.imprest_replenishments to service_role;
grant update (erp_cash_account_ref) on public.imprest_floats to service_role;

-- The cash account is bound ONCE, before the float first moves cash, and one ERP account serves one float (review #1, #5).
-- Postings are decided at enqueue time (PQ-11), so a late or changed account leaves the ERP float account wrong for good.
-- Enforced here so no caller path (edge function, service role, SQL) bypasses it. INVOKER: the function reads
-- expense_claims as its caller (service_role), hence the select grant; it adds no definer.
grant select on public.expense_claims to service_role;
create unique index imprest_floats_cash_account_one on public.imprest_floats (org_id, erp_cash_account_ref)
  where erp_cash_account_ref is not null;
create or replace function public.guard_imprest_cash_account() returns trigger
  language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.erp_cash_account_ref is distinct from old.erp_cash_account_ref
     and (old.erp_cash_account_ref is not null
          or exists (select 1 from public.imprest_replenishments r
                      where r.float_id = old.id and r.org_id = old.org_id and r.status = 'Paid')
          or exists (select 1 from public.expense_claims c
                      where c.imprest_float_id = old.id and c.org_id = old.org_id and c.status = 'Paid')) then
    raise exception 'imprest-cash-account-locked' using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.guard_imprest_cash_account() from public, anon, authenticated;
create trigger imprest_floats_guard_cash_account_trg before update of erp_cash_account_ref on public.imprest_floats
  for each row execute function public.guard_imprest_cash_account();

-- DEFINER: the payer's session cannot read the binding/ownership tables or write the mirror. `on conflict do nothing`
-- keeps it from ever failing the transition (ADR-0059 §3.2).
create or replace function public.enqueue_imprest_replenishment_posting() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'Paid' and old.status is distinct from 'Paid'
     and public.org_employs_imprest_postings(new.org_id)
     and exists (select 1 from public.imprest_floats f
                  where f.id = new.float_id and f.org_id = new.org_id and f.erp_cash_account_ref is not null) then
    insert into public.imprest_posting_erp_mirror (org_id, replenishment_id, posting_identity, state_stamp, actor_id)
    values (new.org_id, new.id, new.id::text || ':replenishment', new.paid_at, new.paid_by)
    on conflict (org_id, posting_identity) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_imprest_replenishment_posting() from public, anon, authenticated, service_role;
create trigger imprest_replenishments_enqueue_posting_trg after update of status on public.imprest_replenishments
  for each row when (old.status is distinct from new.status) execute function public.enqueue_imprest_replenishment_posting();

-- §3 the sweep's gate for a replenishment (service_role only; re-reads status, stamp, accounts and the recorded actor's
-- CURRENT standing — an offboarded or demoted person's authority does not keep posting). INVOKER: service_role bypasses
-- RLS, so every read states the org.
create or replace function public.imprest_posting_for_push(p_org_id uuid, p_mirror_id uuid) returns jsonb
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare m public.imprest_posting_erp_mirror%rowtype; r public.imprest_replenishments%rowtype; f public.imprest_floats%rowtype;
        v_role user_role; v_tz text;
begin
  select * into m from public.imprest_posting_erp_mirror where id = p_mirror_id and org_id = p_org_id;
  if not found then raise exception 'imprest posting not found' using errcode = 'P0002'; end if;
  select * into r from public.imprest_replenishments where id = m.replenishment_id and org_id = p_org_id;
  select * into f from public.imprest_floats where id = r.float_id and org_id = p_org_id;
  if r.id is null or f.id is null or r.status is distinct from 'Paid' or r.paid_at is distinct from m.state_stamp
     or f.erp_cash_account_ref is null then
    raise exception 'imprest-posting-precondition-failed' using errcode = 'P0001';
  end if;
  select pf.role into v_role from public.profiles pf where pf.id = m.actor_id and pf.org_id = p_org_id;
  if m.actor_id is null or not public.is_active_member(m.actor_id) or v_role is null or v_role not in ('Finance','Admin')
     or m.actor_id = f.custodian_id then
    raise exception 'imprest-posting-actor-not-authorized' using errcode = '42501';
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = p_org_id), 'UTC');
  return jsonb_build_object('mirror_id', m.id, 'posting_identity', m.posting_identity, 'subject_id', r.id,
    'number', r.number, 'kind', r.kind, 'amount', to_char(r.amount, 'FM999999999990.00'), 'currency', f.currency,
    'float_id', f.id, 'float_cash_account', f.erp_cash_account_ref, 'reference', coalesce(r.payment_reference, r.number),
    'state_stamp', m.state_stamp, 'posting_date', to_char((m.state_stamp at time zone v_tz)::date, 'YYYY-MM-DD'),
    'actor_id', m.actor_id);
end; $$;
revoke all on function public.imprest_posting_for_push(uuid, uuid) from public, anon, authenticated;
grant execute on function public.imprest_posting_for_push(uuid, uuid) to service_role;

-- §4 0270 §5 expense_posting_actor_check VERBATIM except the lines marked `0425`: the float's custodian may be the
-- recorded payer of a float record (DD-IMP-7.5), re-checked for CURRENT eligibility.
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
          or (m.posting <> 'approval' and v_role = 'Finance')
          or (m.posting in ('claim-payment','advance-payment','advance-return','settlement')                        -- 0425 DD-IMP-7.5
              and exists (select 1 from public.expense_claims c join public.imprest_floats f on f.id = c.imprest_float_id  -- 0425
                           where c.id = m.claim_id and f.custodian_id = m.actor_id                                   -- 0425
                             and c.org_id = p_org_id and f.org_id = p_org_id                                          -- 0425
                             and public.imprest_custodian_eligible(p_org_id, f.project_id, m.actor_id)))) then      -- 0425
    raise exception 'expense-posting-actor-not-authorized' using errcode = '42501';
  end if;
end; $$;
revoke all on function public.expense_posting_actor_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expense_posting_actor_check(uuid, uuid) to service_role;
-- The sweep calls the check as service_role, which now calls this (0422 revoked it from everyone).
grant execute on function public.imprest_custodian_eligible(uuid, uuid, uuid) to service_role;

-- §5 0354 §2 expense_posting_for_push VERBATIM except the lines marked `0425`: the float's cash account is frozen into
-- the gate truth, read now from this org's own float row.
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
    'float_cash_account', (select f.erp_cash_account_ref from public.imprest_floats f                       -- 0425
                            where f.id = c.imprest_float_id and f.org_id = p_org_id),                      -- 0425
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

-- §6 closing self-assertion (0270 §6 style): hosted defaults must not leave any of this client-callable.
do $$
declare v text;
begin
  foreach v in array array['public.org_employs_imprest_postings(uuid)', 'public.imprest_posting_for_push(uuid, uuid)',
                           'public.expense_posting_actor_check(uuid, uuid)', 'public.expense_posting_for_push(uuid, uuid)',
                           'public.imprest_custodian_eligible(uuid, uuid, uuid)'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE')
       or not has_function_privilege('service_role', v, 'EXECUTE') then
      raise exception '0425: % ACL is not the intended shape', v;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.enqueue_imprest_replenishment_posting()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_imprest_replenishment_posting()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.enqueue_imprest_replenishment_posting()', 'EXECUTE') then
    raise exception '0425: the enqueue trigger function is executable by a role';
  end if;
  if has_table_privilege('anon', 'public.imprest_posting_erp_mirror', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.imprest_posting_erp_mirror', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('authenticated', 'public.imprest_posting_erp_mirror', 'SELECT')
     or not has_table_privilege('service_role', 'public.imprest_posting_erp_mirror', 'SELECT')
     or not has_table_privilege('service_role', 'public.imprest_posting_erp_mirror', 'INSERT')
     or not has_table_privilege('service_role', 'public.imprest_posting_erp_mirror', 'UPDATE') then
    raise exception '0425: imprest_posting_erp_mirror ACL is not the intended shape';
  end if;
  if has_column_privilege('authenticated', 'public.imprest_floats', 'erp_cash_account_ref', 'INSERT,UPDATE')
     or not has_column_privilege('service_role', 'public.imprest_floats', 'erp_cash_account_ref', 'UPDATE') then
    raise exception '0425: the float cash account is client-writable or not service-writable';
  end if;
end $$;
