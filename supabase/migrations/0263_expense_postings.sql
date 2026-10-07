-- 0263_expense_postings.sql — #775 phase B: expense claims and cash advances post to ERPNext
-- (ADR-0059 Posture B; ADR-0081 one originator). Spec: docs/specs/expense-claims.spec.md §10.
-- Plan: docs/plans/2026-10-07-expense-claims-phase-b.md (+ part2..part6).
-- Proven by supabase/tests/0263_expense_advance_returns.test.sql, 0263_expense_postings_enqueue.test.sql,
--   0263_expense_posting_gate.test.sql, 0263_expense_postings_acl.test.sql and the §6 self-assertion.
--
-- §1 expense_advance_returns + record_expense_advance_return (0247 §9 body + one insert)
-- §2 expense_account_map (written only by external-set-company, as service role)
-- §3 expense_posting_erp_mirror (posting intent + Posture-B side mirror)
-- §4 org_employs_expense_postings, enqueue_expense_posting and the two enqueue triggers
-- §5 expense_posting_actor_check + expense_posting_for_push (the sweep's database gate, service_role only)
-- §5b read scope of expense rows in the shared outbox and GL mirror (approval rank only)
-- §6 closing self-assertion (the ACL shape, whatever the database's default privileges)
--
-- ⛔ transition_expense_claim, spend_approval_route and every phase-A policy are NOT touched (ADR-0059 §3.1).
-- ⛔ org_id has NO default on the three new tables: every writer states it (the 0074/0213 seed-default class).
-- REVERSE: supabase/migrations/rollback/0263_expense_postings_down.sql (stop the sweep pass first).

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — each cash return is its own row (DD-EXP-17): the subject of one advance-return posting.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.expense_advance_returns (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  advance_id  uuid not null references public.expense_claims(id),
  amount      numeric(14,2) not null,
  reference   text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  returned_on date not null,
  constraint expense_advance_returns_amount_range check (amount > 0 and amount < 'Infinity'::numeric)
);
create index expense_advance_returns_advance_idx on public.expense_advance_returns (advance_id);
comment on table public.expense_advance_returns is
  '#775 phase B — one row per cash return on an advance; written only by record_expense_advance_return. '
  'Returns recorded before 0263 exist only as expense_advance.return audit events.';

alter table public.expense_advance_returns enable row level security;
alter table public.expense_advance_returns force  row level security;
create policy expense_advance_returns_select on public.expense_advance_returns for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_advance_returns.advance_id));
revoke all on public.expense_advance_returns from public, anon, authenticated;
grant select on public.expense_advance_returns to authenticated;
grant select, insert, update, delete on public.expense_advance_returns to service_role;

-- 0247 §9 VERBATIM except the one marked insert. Reverse: rollback/0263 restores the 0247 text.
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
  -- 0263 (DD-EXP-17): the return as its own row — the subject of its advance-return posting.
  insert into public.expense_advance_returns (org_id, advance_id, amount, reference, recorded_by, returned_on)
  values (v_row.org_id, p_id, p_amount, nullif(btrim(p_reference), ''), v_uid,
          (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = v_row.org_id),
                                       'UTC'))::date);
  perform public.log_audit('expense_advance.return', v_row.org_id, v_uid, p_id,
    jsonb_build_object('amount', p_amount, 'reference', nullif(btrim(p_reference), ''), 'outstanding_after', v_out - p_amount));
end; $$;
revoke all on function public.record_expense_advance_return(uuid, numeric, text) from public, anon;
grant execute on function public.record_expense_advance_return(uuid, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — the Admin account map (DD-EXP-16). Clients READ it; only external-set-company writes it, as service role,
-- after reading the account from ERPNext and applying FR-EXP-112. A client-writable map would let the
-- Creditors / untyped-advance refusals be skipped.
-- ⚑ The key list repeats public.expense_type's labels: a new label needs a new key here (AC-EXP-104 fails until).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.expense_account_map (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  account_key text not null,
  erp_account text not null,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  constraint expense_account_map_key check (account_key in
    ('employee_payable','employee_advance','Travel','Accommodation','Meals','Local transport','Other')),
  constraint expense_account_map_account_present check (btrim(erp_account) <> '' and length(erp_account) <= 140),
  constraint expense_account_map_one_per_key unique (org_id, account_key)
);
comment on table public.expense_account_map is
  '#775 phase B — ERPNext account per expense posting key; written only by external-set-company (validated).';
alter table public.expense_account_map enable row level security;
alter table public.expense_account_map force  row level security;
create policy expense_account_map_select on public.expense_account_map for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.expense_account_map from public, anon, authenticated;
grant select on public.expense_account_map to authenticated;
grant select, insert, update, delete on public.expense_account_map to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the posting intent and Posture-B side mirror (ADR-0059 §6, ADR-0081). One row per posting; written
-- (insert) only by §4's triggers, then only by the sweep (service role). Reverse = drop table: no PMO data lost.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.expense_posting_erp_mirror (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  claim_id         uuid not null references public.expense_claims(id) on delete cascade,
  return_id        uuid references public.expense_advance_returns(id) on delete cascade,
  posting          text not null,
  posting_identity text not null,
  state_stamp      timestamptz not null,
  actor_id         uuid references public.profiles(id),
  push_state       text not null default 'pending',
  push_error       text,
  erp_name         text,
  pushed_at        timestamptz,
  last_attempt_at  timestamptz,
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint expense_posting_erp_mirror_posting  check (posting in
    ('approval','claim-payment','settlement','advance-payment','advance-return','approval-cancel')),
  constraint expense_posting_erp_mirror_state    check (push_state in ('pending','failed','held','pushed')),
  constraint expense_posting_erp_mirror_return   check ((posting = 'advance-return') = (return_id is not null)),
  constraint expense_posting_erp_mirror_identity check (posting_identity = coalesce(return_id, claim_id)::text || ':' || posting),
  constraint expense_posting_erp_mirror_identity_unique unique (org_id, posting_identity)
);
-- The sweep's work queue (NFR-EXP-013): pending/failed, never a cancelled one, least recently attempted first — a
-- round robin, so intents that keep failing cannot starve new ones behind the per-tick bound.
create index expense_posting_erp_mirror_queue_idx
  on public.expense_posting_erp_mirror (org_id, push_state, last_attempt_at nulls first, created_at)
  where erp_cancelled_at is null;
create index expense_posting_erp_mirror_claim_idx on public.expense_posting_erp_mirror (claim_id);
comment on table public.expense_posting_erp_mirror is
  '#775 phase B — ERPNext posting intents for expense claims/advances (ADR-0081) and their ERP-side state.';
comment on column public.expense_posting_erp_mirror.last_attempt_at is
  'When the sweep last took this intent up (the work queue''s round-robin order); null = never attempted.';

alter table public.expense_posting_erp_mirror enable row level security;
alter table public.expense_posting_erp_mirror force  row level security;
-- Never more visible than the claim it posts (the parent's own RLS decides).
create policy expense_posting_erp_mirror_select on public.expense_posting_erp_mirror for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_posting_erp_mirror.claim_id));
revoke all on public.expense_posting_erp_mirror from public, anon, authenticated;
grant select on public.expense_posting_erp_mirror to authenticated;
grant select, insert, update, delete on public.expense_posting_erp_mirror to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — the event writes its intents in its own transaction (ADR-0081), only while the org employs `expenses`
-- (DD-EXP-13: an activated ERPNext binding AND the ownership row). That is also OD-XING-1's epoch: an event
-- before employment never posts.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.org_employs_expense_postings(p_org_id uuid) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (select 1 from public.external_org_bindings b
                  where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null)
     and exists (select 1 from public.external_domain_ownership d
                  where d.org_id = p_org_id and d.external_tier = 'erpnext' and d.domain = 'expenses')
$$;
revoke all on function public.org_employs_expense_postings(uuid) from public, anon, authenticated;
grant execute on function public.org_employs_expense_postings(uuid) to service_role;

create or replace function public.enqueue_expense_posting(
  p_org_id uuid, p_claim_id uuid, p_return_id uuid, p_posting text, p_stamp timestamptz, p_actor uuid)
returns void language sql security invoker set search_path = public, pg_temp as $$
  insert into public.expense_posting_erp_mirror (org_id, claim_id, return_id, posting, posting_identity, state_stamp, actor_id)
  values (p_org_id, p_claim_id, p_return_id, p_posting,
          coalesce(p_return_id, p_claim_id)::text || ':' || p_posting, p_stamp, p_actor)
  on conflict (org_id, posting_identity) do nothing
$$;
revoke all on function public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- DEFINER: the transition's caller cannot read the binding/ownership tables or write the mirror. It writes only
-- the side mirror, and `on conflict do nothing` keeps it from ever failing the transition (ADR-0059 §3.2).
create or replace function public.enqueue_expense_claim_postings() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.org_employs_expense_postings(new.org_id) then
    return new;
  end if;
  if new.kind = 'claim' and new.status = 'Approved' then
    perform public.enqueue_expense_posting(new.org_id, new.id, null, 'approval', new.approved_at, new.approved_by_id);
  elsif new.kind = 'claim' and new.status = 'Paid' then
    if new.amount - new.advance_applied > 0 then
      perform public.enqueue_expense_posting(new.org_id, new.id, null, 'claim-payment', new.paid_at, new.paid_by_id);
    end if;
    if new.advance_applied > 0 then
      perform public.enqueue_expense_posting(new.org_id, new.id, null, 'settlement', new.paid_at, new.paid_by_id);
    end if;
  elsif new.kind = 'advance' and new.status = 'Paid' then
    perform public.enqueue_expense_posting(new.org_id, new.id, null, 'advance-payment', new.paid_at, new.paid_by_id);
  elsif new.kind = 'claim' and old.status = 'Approved' and new.status = 'Cancelled'
        and exists (select 1 from public.expense_posting_erp_mirror m
                     where m.org_id = new.org_id and m.posting_identity = new.id::text || ':approval') then
    perform public.enqueue_expense_posting(new.org_id, new.id, null, 'approval-cancel', new.cancelled_at, auth.uid());
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_expense_claim_postings() from public, anon, authenticated, service_role;
create trigger expense_claims_enqueue_postings_trg
  after update of status on public.expense_claims
  for each row when (old.status is distinct from new.status)
  execute function public.enqueue_expense_claim_postings();

create or replace function public.enqueue_expense_return_posting() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.org_employs_expense_postings(new.org_id) then
    perform public.enqueue_expense_posting(new.org_id, new.advance_id, new.id, 'advance-return', new.recorded_at,
                                           new.recorded_by);
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_expense_return_posting() from public, anon, authenticated, service_role;
create trigger expense_advance_returns_enqueue_posting_trg
  after insert on public.expense_advance_returns
  for each row execute function public.enqueue_expense_return_posting();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — the sweep's database gate (ADR-0059 §3.3 / §6). SECURITY INVOKER, service_role only: the sweep is the
-- only originator (ADR-0081). Re-reads status, stamp and amounts, and re-asserts the RECORDED actor's CURRENT
-- standing — an offboarded or demoted person's authority does not keep posting (spec Q9).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- The actor half on its own: the gate runs it before a fresh posting, and the sweep runs it before replaying an
-- existing outbox command that may post anew (a replay re-reads nothing about the claim — its body is frozen).
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5b — read scope (NFR-EXP-010). The posting path writes into two SHARED tables whose existing policies admit
-- every active org member: the outbox (an expense command's payload names the employee, accounts and amount) and
-- the GL mirror (an Employee party's entries). Those rows are read only by approval rank — Finance, Admin,
-- Executive, Project Manager — the claim's own audience apart from the claimant. RESTRICTIVE, so it only narrows:
-- every other domain and party type keeps its read. `to authenticated`: anon already reads nothing here, and the
-- rank helper is not anon-executable. The sweep and the writers run as service_role (RLS bypassed).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create policy external_command_outbox_expenses_read_scope on public.external_command_outbox
  as restrictive for select to authenticated
  using (domain is distinct from 'expenses' or public.holds_spend_approval_authority(public.auth_role()));
create policy erp_gl_entry_mirror_employee_read_scope on public.erp_gl_entry_mirror
  as restrictive for select to authenticated
  using (party_type is distinct from 'Employee' or public.holds_spend_approval_authority(public.auth_role()));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — closing self-assertion (the 0211/0260 style). Hosted Supabase grants EXECUTE on new functions and ALL on
-- new tables to anon/authenticated by default; local Docker does not. Raise here so a deploy that does not land
-- this exact shape fails in the migration, on whichever database it runs.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_table text;
begin
  if has_function_privilege('anon', 'public.expense_posting_actor_check(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expense_posting_actor_check(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.expense_posting_actor_check(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.enqueue_expense_claim_postings()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_expense_claim_postings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.enqueue_expense_return_posting()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_expense_return_posting()', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_expense_advance_return(uuid, numeric, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_expense_advance_return(uuid, numeric, text)', 'EXECUTE') then
    raise exception '0263: expense posting function ACL is not the intended shape';
  end if;
  foreach v_table in array array['public.expense_advance_returns', 'public.expense_account_map',
                                 'public.expense_posting_erp_mirror'] loop
    if has_table_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE')
       or not has_table_privilege('authenticated', v_table, 'SELECT')
       -- (a comma list means ANY of them, so each privilege the sweep needs is checked on its own)
       or not has_table_privilege('service_role', v_table, 'SELECT')
       or not has_table_privilege('service_role', v_table, 'INSERT')
       or not has_table_privilege('service_role', v_table, 'UPDATE') then
      raise exception '0263: % ACL is not the intended shape', v_table;
    end if;
  end loop;
end $$;
