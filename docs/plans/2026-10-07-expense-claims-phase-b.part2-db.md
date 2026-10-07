# Plan part 2 — #775 phase B: database (Tasks D1–D12)

Part of [`2026-10-07-expense-claims-phase-b.md`](2026-10-07-expense-claims-phase-b.md). Conventions: §1.8 there.
Every DB command runs from the worktree root under `scripts/with-db-lock.sh`.

Order: the two intent tests are written first and stay red until §1, §3 and §4 exist (D3–D5); then the gate (D6–D7);
then the ACL test and §2 + §6 (D8–D9). A pgTAP file that touches a missing relation errors as a whole, so each test
file is run only once everything it touches exists.

---

### D1 — RED: returns test (AC-EXP-102)

Create `supabase/tests/0270_expense_advance_returns.test.sql`:

```sql
-- 0270_expense_advance_returns.test.sql — #775 phase B: each cash return is its own row and its own posting intent
-- (FR-EXP-102, DD-EXP-17). AC-EXP-102. Migration under test: 0270_expense_postings.sql §1 + §4.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02700000-0000-0000-0000-00000000000a','EXP-B Returns Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1','expb-r-e1@example.com'),
  ('02700000-0000-0000-0000-0000000000a4','expb-r-f1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1','02700000-0000-0000-0000-00000000000a','R Eng','expb-r-e1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000000a4','02700000-0000-0000-0000-00000000000a','R Fin','expb-r-f1@example.com','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('02700000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref','{"company":"Example Co"}'::jsonb, now());
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('02700000-0000-0000-0000-00000000000a','erpnext','expenses');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number,
                            approved_by_id, paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000301','02700000-0000-0000-0000-00000000000a','advance',
   '02700000-0000-0000-0000-0000000000a1','Float',500,'Paid','ADV-2610070001',
   '02700000-0000-0000-0000-0000000000a4','02700000-0000-0000-0000-0000000000a4', now(),
   (now() at time zone 'Asia/Jakarta')::date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select record_expense_advance_return('02700000-0000-0000-0000-000000000301', 100, 'CB-1') $$,
  'AC-EXP-102: Finance records a 100 cash return');
select throws_ok($$ select record_expense_advance_return('02700000-0000-0000-0000-000000000301', 450) $$,
  'P0001', 'a return of 450.00 exceeds the 400.00 still outstanding on this advance',
  'AC-EXP-102: the phase-A ceiling still refuses a return above what is outstanding');
reset role;

select is((select returned_amount from expense_claims where id = '02700000-0000-0000-0000-000000000301'),
  100.00::numeric, 'AC-EXP-102: returned_amount carries the return');
select is((select count(*)::int from expense_advance_returns where advance_id = '02700000-0000-0000-0000-000000000301'),
  1, 'AC-EXP-102: one return row — the refused 450 wrote none');
select is((select amount::text || '/' || reference || '/' || recorded_by::text
             from expense_advance_returns where advance_id = '02700000-0000-0000-0000-000000000301'),
  '100.00/CB-1/02700000-0000-0000-0000-0000000000a4',
  'AC-EXP-102: the row holds the amount, the reference and the recorder');
select is((select returned_on from expense_advance_returns where advance_id = '02700000-0000-0000-0000-000000000301'),
  (now() at time zone 'Asia/Jakarta')::date, 'AC-EXP-102: returned_on is today in the org timezone');
select is((select count(*)::int
             from expense_posting_erp_mirror m join expense_advance_returns r on r.id = m.return_id
            where r.advance_id = '02700000-0000-0000-0000-000000000301' and m.posting = 'advance-return'
              and m.push_state = 'pending' and m.state_stamp = r.recorded_at and m.actor_id = r.recorded_by),
  1, 'AC-EXP-102: one pending advance-return intent carries the row''s stamp and recorder');
select is((select posting_identity from expense_posting_erp_mirror
            where posting = 'advance-return' and claim_id = '02700000-0000-0000-0000-000000000301'),
  (select id::text || ':advance-return' from expense_advance_returns
    where advance_id = '02700000-0000-0000-0000-000000000301'),
  'AC-EXP-102: the intent identity is <return id>:advance-return');

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0270_expense_advance_returns.test.sql` → fails
with `relation "expense_advance_returns" does not exist`.

### D2 — RED: intent test (AC-EXP-100, AC-EXP-101, AC-EXP-103)

Create `supabase/tests/0270_expense_postings_enqueue.test.sql`:

```sql
-- 0270_expense_postings_enqueue.test.sql — #775 phase B: the event writes its posting intents in its own
-- transaction, and only while the org employs `expenses` (FR-EXP-100/101, DD-EXP-12/13). AC-EXP-100, 101, 103.
-- Migration under test: 0270_expense_postings.sql §3 + §4.
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02700000-0000-0000-0000-00000000010a','EXP-B Employing Org','IDR','Asia/Jakarta'),
  ('02700000-0000-0000-0000-00000000010c','EXP-B Connected Only Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000001a1','expb-q-e1@example.com'),
  ('02700000-0000-0000-0000-0000000001a3','expb-q-pm@example.com'),
  ('02700000-0000-0000-0000-0000000001a4','expb-q-f1@example.com'),
  ('02700000-0000-0000-0000-0000000001c1','expb-q-ce1@example.com'),
  ('02700000-0000-0000-0000-0000000001c3','expb-q-cpm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000001a1','02700000-0000-0000-0000-00000000010a','Q Eng','expb-q-e1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000001a3','02700000-0000-0000-0000-00000000010a','Q PM','expb-q-pm@example.com','Project Manager','active'),
  ('02700000-0000-0000-0000-0000000001a4','02700000-0000-0000-0000-00000000010a','Q Fin','expb-q-f1@example.com','Finance','active'),
  ('02700000-0000-0000-0000-0000000001c1','02700000-0000-0000-0000-00000000010c','QC Eng','expb-q-ce1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000001c3','02700000-0000-0000-0000-00000000010c','QC PM','expb-q-cpm@example.com','Project Manager','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('02700000-0000-0000-0000-00000000010a','erpnext','https://erp.example.test','test-ref-a','{"company":"Example Co"}'::jsonb, now()),
  ('02700000-0000-0000-0000-00000000010c','erpnext','https://erp.example.test','test-ref-c','{"company":"Other Co"}'::jsonb, now());
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('02700000-0000-0000-0000-00000000010a','erpnext','expenses');

-- advances (paid ones first: the advance-link check needs them)
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number,
                            approved_by_id, approved_at, paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000311','02700000-0000-0000-0000-00000000010a','advance','02700000-0000-0000-0000-0000000001a1','Adv 500',500,'Paid','ADV-2610070011','02700000-0000-0000-0000-0000000001a3',now(),'02700000-0000-0000-0000-0000000001a4',now(),(now() at time zone 'Asia/Jakarta')::date),
  ('02700000-0000-0000-0000-000000000312','02700000-0000-0000-0000-00000000010a','advance','02700000-0000-0000-0000-0000000001a1','Adv 1000',1000,'Paid','ADV-2610070012','02700000-0000-0000-0000-0000000001a3',now(),'02700000-0000-0000-0000-0000000001a4',now(),(now() at time zone 'Asia/Jakarta')::date);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02700000-0000-0000-0000-000000000313','02700000-0000-0000-0000-00000000010a','advance','02700000-0000-0000-0000-0000000001a1','Adv 200',200,'Approved','ADV-2610070013','02700000-0000-0000-0000-0000000001a3',now());
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, submitted_at) values
  ('02700000-0000-0000-0000-000000000411','02700000-0000-0000-0000-00000000010a','claim','02700000-0000-0000-0000-0000000001a1','To approve',100,'Submitted','EXP-2610070011',now()),
  ('02700000-0000-0000-0000-000000000412','02700000-0000-0000-0000-00000000010c','claim','02700000-0000-0000-0000-0000000001c1','Org C claim',100,'Submitted','EXP-2610070012',now()),
  ('02700000-0000-0000-0000-000000000415','02700000-0000-0000-0000-00000000010a','claim','02700000-0000-0000-0000-0000000001a1','Withdrawn',100,'Submitted','EXP-2610070015',now());
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at, advance_id) values
  ('02700000-0000-0000-0000-000000000413','02700000-0000-0000-0000-00000000010a','claim','02700000-0000-0000-0000-0000000001a1','Claim 800',800,'Approved','EXP-2610070013','02700000-0000-0000-0000-0000000001a3',now(),'02700000-0000-0000-0000-000000000311'),
  ('02700000-0000-0000-0000-000000000414','02700000-0000-0000-0000-00000000010a','claim','02700000-0000-0000-0000-0000000001a1','Claim 300',300,'Approved','EXP-2610070014','02700000-0000-0000-0000-0000000001a3',now(),'02700000-0000-0000-0000-000000000312'),
  ('02700000-0000-0000-0000-000000000416','02700000-0000-0000-0000-00000000010a','claim','02700000-0000-0000-0000-0000000001a1','Approved before employment',100,'Approved','EXP-2610070016','02700000-0000-0000-0000-0000000001a3',now(),null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000001a3","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000411','Approved') $$,
  'AC-EXP-100: the PM approves E1''s claim in the org that employs expenses');
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000001c3","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000412','Approved') $$,
  'AC-EXP-100: the PM approves in the org that is connected but has not employed expenses');
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000001a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000413','Paid') $$,
  'AC-EXP-101: Finance pays the 800 claim (500 from the advance, 300 cash)');
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000414','Paid') $$,
  'AC-EXP-101: Finance pays the 300 claim (all from the advance)');
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000313','Paid') $$,
  'AC-EXP-101: Finance pays the 200 advance');
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000411','Cancelled') $$,
  'AC-EXP-103: Finance cancels the approved claim that has an approval intent');
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000416','Cancelled') $$,
  'AC-EXP-103: Finance cancels an approved claim that has no approval intent');
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000001a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02700000-0000-0000-0000-000000000415','Cancelled') $$,
  'AC-EXP-103: the claimant cancels a Submitted claim');
reset role;

select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000411' and posting = 'approval'),
  1, 'AC-EXP-100: exactly one approval intent');
select is((select m.push_state || '/' || (m.state_stamp = c.approved_at)::text || '/' || m.actor_id::text
             from expense_posting_erp_mirror m join expense_claims c on c.id = m.claim_id
            where m.posting_identity = '02700000-0000-0000-0000-000000000411:approval'),
  'pending/true/02700000-0000-0000-0000-0000000001a3',
  'AC-EXP-100: pending, stamped with approved_at, attributed to the approver');
select is((select count(*)::int from expense_posting_erp_mirror
            where org_id = '02700000-0000-0000-0000-00000000010c'),
  0, 'AC-EXP-100: an org that has not employed expenses gets no intent');
select is((select array_agg(posting order by posting) from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000413'),
  array['claim-payment','settlement'], 'AC-EXP-101: cash part and advance part are two intents');
select is((select array_agg(posting order by posting) from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000414'),
  array['settlement'], 'AC-EXP-101: a claim the advance fully covers has no cash payment intent');
select is((select array_agg(posting order by posting) from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000313'),
  array['advance-payment'], 'AC-EXP-101: a paid advance has one advance-payment intent');
select is((select actor_id from expense_posting_erp_mirror
            where posting_identity = '02700000-0000-0000-0000-000000000411:approval-cancel'),
  '02700000-0000-0000-0000-0000000001a4'::uuid, 'AC-EXP-103: the cancel intent is attributed to the canceller');
select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000415'),
  0, 'AC-EXP-103: cancelling a Submitted claim queues nothing');
select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000416'),
  0, 'AC-EXP-103: cancelling an approval that was never queued queues nothing');

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0270_expense_postings_enqueue.test.sql` → fails
with `relation "expense_posting_erp_mirror" does not exist`.

### D3 — GREEN part 1: migration header + §1 returns (FR-EXP-102)

Create `supabase/migrations/0270_expense_postings.sql` with exactly:

```sql
-- 0270_expense_postings.sql — #775 phase B: expense claims and cash advances post to ERPNext
-- (ADR-0059 Posture B; ADR-0081 one originator). Spec: docs/specs/expense-claims.spec.md §10.
-- Plan: docs/plans/2026-10-07-expense-claims-phase-b.md (+ part2..part6).
-- Proven by supabase/tests/0270_expense_advance_returns.test.sql, 0270_expense_postings_enqueue.test.sql,
--   0270_expense_posting_gate.test.sql, 0270_expense_postings_acl.test.sql and the §6 self-assertion.
--
-- §1 expense_advance_returns + record_expense_advance_return (0247 §9 body + one insert)
-- §2 expense_account_map (written only by external-set-company, as service role)
-- §3 expense_posting_erp_mirror (posting intent + Posture-B side mirror)
-- §4 org_employs_expense_postings, enqueue_expense_posting and the two enqueue triggers
-- §5 expense_posting_for_push (the sweep's database gate, service_role only)
-- §6 closing self-assertion (the ACL shape, whatever the database's default privileges)
--
-- ⛔ transition_expense_claim, spend_approval_route and every phase-A policy are NOT touched (ADR-0059 §3.1).
-- ⛔ org_id has NO default on the three new tables: every writer states it (the 0074/0213 seed-default class).
-- REVERSE: supabase/migrations/rollback/0270_expense_postings_down.sql (stop the sweep pass first).

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
  'Returns recorded before 0270 exist only as expense_advance.return audit events.';

alter table public.expense_advance_returns enable row level security;
alter table public.expense_advance_returns force  row level security;
create policy expense_advance_returns_select on public.expense_advance_returns for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_advance_returns.advance_id));
revoke all on public.expense_advance_returns from public, anon, authenticated;
grant select on public.expense_advance_returns to authenticated;
grant select, insert, update, delete on public.expense_advance_returns to service_role;

-- 0247 §9 VERBATIM except the one marked insert. Reverse: rollback/0270 restores the 0247 text.
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
  -- 0270 (DD-EXP-17): the return as its own row — the subject of its advance-return posting.
  insert into public.expense_advance_returns (org_id, advance_id, amount, reference, recorded_by, returned_on)
  values (v_row.org_id, p_id, p_amount, nullif(btrim(p_reference), ''), v_uid,
          (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = v_row.org_id),
                                       'UTC'))::date);
  perform public.log_audit('expense_advance.return', v_row.org_id, v_uid, p_id,
    jsonb_build_object('amount', p_amount, 'reference', nullif(btrim(p_reference), ''), 'outstanding_after', v_out - p_amount));
end; $$;
revoke all on function public.record_expense_advance_return(uuid, numeric, text) from public, anon;
grant execute on function public.record_expense_advance_return(uuid, numeric, text) to authenticated;
```

Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_advances.test.sql'`
→ `All tests successful` (phase A's return behaviour is unchanged; AC-EXP-031 still green).

### D4 — GREEN part 2: §3 the side mirror (FR-EXP-100, FR-EXP-115)

Append to `supabase/migrations/0270_expense_postings.sql`:

```sql
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
-- The sweep's work queue (NFR-EXP-013): pending/failed, oldest first, never a cancelled one.
create index expense_posting_erp_mirror_queue_idx
  on public.expense_posting_erp_mirror (org_id, push_state, created_at) where erp_cancelled_at is null;
create index expense_posting_erp_mirror_claim_idx on public.expense_posting_erp_mirror (claim_id);
comment on table public.expense_posting_erp_mirror is
  '#775 phase B — ERPNext posting intents for expense claims/advances (ADR-0081) and their ERP-side state.';

alter table public.expense_posting_erp_mirror enable row level security;
alter table public.expense_posting_erp_mirror force  row level security;
-- Never more visible than the claim it posts (the parent's own RLS decides).
create policy expense_posting_erp_mirror_select on public.expense_posting_erp_mirror for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_posting_erp_mirror.claim_id));
revoke all on public.expense_posting_erp_mirror from public, anon, authenticated;
grant select on public.expense_posting_erp_mirror to authenticated;
grant select, insert, update, delete on public.expense_posting_erp_mirror to service_role;
```

Verify: `scripts/with-db-lock.sh supabase db reset` → exits 0.

### D5 — GREEN part 3: §4 employment + the enqueue triggers (FR-EXP-100, FR-EXP-101)

Append:

```sql
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
```

Verify GREEN (one lock hold):
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_expense_advance_returns.test.sql supabase/tests/0270_expense_postings_enqueue.test.sql'`
→ `All tests successful. Files=2, Tests=25`.

### D6 — RED: gate test (AC-EXP-105)

Create `supabase/tests/0270_expense_posting_gate.test.sql`:

```sql
-- 0270_expense_posting_gate.test.sql — #775 phase B: the sweep re-reads DB truth and the recorded actor's CURRENT
-- standing before every attempt (FR-EXP-104, FR-EXP-109). AC-EXP-105. Migration under test: 0270 §5.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02700000-0000-0000-0000-00000000020a','EXP-B Gate Org','IDR','Asia/Jakarta'),
  ('02700000-0000-0000-0000-00000000020b','EXP-B Gate Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000002a1','expb-g-e1@example.com'),
  ('02700000-0000-0000-0000-0000000002a3','expb-g-pm@example.com'),
  ('02700000-0000-0000-0000-0000000002a4','expb-g-f1@example.com'),
  ('02700000-0000-0000-0000-0000000002a5','expb-g-pmx@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000002a1','02700000-0000-0000-0000-00000000020a','G Eng','expb-g-e1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000002a3','02700000-0000-0000-0000-00000000020a','G PM','expb-g-pm@example.com','Project Manager','active'),
  ('02700000-0000-0000-0000-0000000002a4','02700000-0000-0000-0000-00000000020a','G Fin','expb-g-f1@example.com','Finance','active'),
  ('02700000-0000-0000-0000-0000000002a5','02700000-0000-0000-0000-00000000020a','G PM Gone','expb-g-pmx@example.com','Project Manager','disabled');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02700000-0000-0000-0000-000000000501','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Trip',0,'Approved','EXP-2610080001','02700000-0000-0000-0000-0000000002a3','2026-10-07 18:30:00+00'),
  ('02700000-0000-0000-0000-000000000502','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Trip 2',0,'Approved','EXP-2610080002','02700000-0000-0000-0000-0000000002a5','2026-10-07 10:00:00+00');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02700000-0000-0000-0000-000000000501','2026-10-06','Travel','Bus',100),
  ('02700000-0000-0000-0000-000000000501','2026-10-06','Travel','Taxi',50),
  ('02700000-0000-0000-0000-000000000501','2026-10-06','Meals','Lunch',25);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000503','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Paid',200,'Paid','EXP-2610080003','02700000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a4','2026-10-07 02:00:00+00','2026-10-07'),
  ('02700000-0000-0000-0000-000000000504','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Paid 2',200,'Paid','EXP-2610080004','02700000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a4','2026-10-07 03:00:00+00','2026-10-07');
insert into expense_posting_erp_mirror (id, org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('02700000-0000-0000-0000-000000000601','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000501','approval','02700000-0000-0000-0000-000000000501:approval','2026-10-07 18:30:00+00','02700000-0000-0000-0000-0000000002a3'),
  ('02700000-0000-0000-0000-000000000602','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000502','approval','02700000-0000-0000-0000-000000000502:approval','2026-10-07 10:00:00+00','02700000-0000-0000-0000-0000000002a5'),
  ('02700000-0000-0000-0000-000000000603','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000503','claim-payment','02700000-0000-0000-0000-000000000503:claim-payment','2026-10-07 02:00:00+00','02700000-0000-0000-0000-0000000002a4'),
  ('02700000-0000-0000-0000-000000000604','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000504','claim-payment','02700000-0000-0000-0000-000000000504:claim-payment','2026-10-07 03:00:00+00','02700000-0000-0000-0000-0000000002a1');

set local role service_role;
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') ->> 'amount',
  '175.00', 'AC-EXP-105: the approval amount is the claim amount, as text with two decimals');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') -> 'lines',
  '[{"amount":"25.00","expense_type":"Meals"},{"amount":"150.00","expense_type":"Travel"}]'::jsonb,
  'AC-EXP-105: lines are summed per expense type, ordered by type');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') ->> 'posting_date',
  '2026-10-08', 'AC-EXP-105: 18:30 UTC is the next day in Asia/Jakarta (FR-EXP-109)');
select is((expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') ->> 'approval_posting_exists')::boolean,
  true, 'AC-EXP-105: the gate reports whether the claim has an approval intent');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000603') ->> 'amount',
  '200.00', 'AC-EXP-105: a claim payment is the cash part (amount - advance_applied)');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000602') $$,
  '42501', 'expense-posting-actor-inactive', 'AC-EXP-105: a disabled approver posts nothing');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000604') $$,
  '42501', 'expense-posting-actor-not-authorized', 'AC-EXP-105: a payment intent whose actor is not Finance/Admin posts nothing');
reset role;
update expense_posting_erp_mirror set state_stamp = state_stamp - interval '1 day'
 where id = '02700000-0000-0000-0000-000000000601';
set local role service_role;
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') $$,
  'P0001', 'expense-posting-precondition-failed', 'AC-EXP-105: an intent whose stamp no longer matches the claim posts nothing');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020b','02700000-0000-0000-0000-000000000603') $$,
  'P0002', 'expense posting not found', 'AC-EXP-105: another org''s id finds nothing');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000002a1","role":"authenticated"}';
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000603') $$,
  '42501', 'permission denied for function expense_posting_for_push', 'AC-EXP-105: no client can call the gate');

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0270_expense_posting_gate.test.sql` → fails with
`function expense_posting_for_push(unknown, unknown) does not exist`.

### D7 — GREEN: §5 the gate (FR-EXP-104, FR-EXP-109)

Append:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — the sweep's database gate (ADR-0059 §3.3 / §6). SECURITY INVOKER, service_role only: the sweep is the
-- only originator (ADR-0081). Re-reads status, stamp and amounts, and re-asserts the RECORDED actor's CURRENT
-- standing — an offboarded or demoted person's authority does not keep posting (spec Q9).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.expense_posting_for_push(p_org_id uuid, p_mirror_id uuid)
returns jsonb
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  m        public.expense_posting_erp_mirror%rowtype;
  c        public.expense_claims%rowtype;
  r        public.expense_advance_returns%rowtype;
  v_role   user_role;
  v_org    uuid;
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

  v_ok := case m.posting
    when 'approval'        then c.kind = 'claim' and c.status in ('Approved','Paid','Cancelled') and c.approved_at = m.state_stamp
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
```

Verify GREEN:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_expense_posting_gate.test.sql'`
→ `All tests successful. Files=1, Tests=10`.

### D8 — RED: ACL test (AC-EXP-104)

Create `supabase/tests/0270_expense_postings_acl.test.sql`:

```sql
-- 0270_expense_postings_acl.test.sql — #775 phase B: no client write path, visibility follows the claim, the gate
-- and the trigger functions are not client-callable, and the account-map keys track the expense_type enum
-- (NFR-EXP-010/012, FR-EXP-112). AC-EXP-104. Migration under test: 0270 §1–§5.
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02700000-0000-0000-0000-00000000030a','EXP-B ACL Org','IDR','Asia/Jakarta'),
  ('02700000-0000-0000-0000-00000000030b','EXP-B ACL Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000003a1','expb-a-e1@example.com'),
  ('02700000-0000-0000-0000-0000000003a2','expb-a-e2@example.com'),
  ('02700000-0000-0000-0000-0000000003a3','expb-a-pm@example.com'),
  ('02700000-0000-0000-0000-0000000003b1','expb-a-bad@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000003a1','02700000-0000-0000-0000-00000000030a','A Eng 1','expb-a-e1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000003a2','02700000-0000-0000-0000-00000000030a','A Eng 2','expb-a-e2@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000003a3','02700000-0000-0000-0000-00000000030a','A PM','expb-a-pm@example.com','Project Manager','active'),
  ('02700000-0000-0000-0000-0000000003b1','02700000-0000-0000-0000-00000000030b','B Admin','expb-a-bad@example.com','Admin','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on, returned_amount) values
  ('02700000-0000-0000-0000-000000000701','02700000-0000-0000-0000-00000000030a','advance','02700000-0000-0000-0000-0000000003a1','E1 float',300,'Paid','ADV-2610090001','02700000-0000-0000-0000-0000000003a3',now(),'02700000-0000-0000-0000-0000000003a3',now(),current_date,50);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02700000-0000-0000-0000-000000000702','02700000-0000-0000-0000-00000000030a','claim','02700000-0000-0000-0000-0000000003a2','E2 claim',90,'Approved','EXP-2610090002','02700000-0000-0000-0000-0000000003a3',now());
insert into expense_advance_returns (id, org_id, advance_id, amount, recorded_by, returned_on) values
  ('02700000-0000-0000-0000-000000000711','02700000-0000-0000-0000-00000000030a','02700000-0000-0000-0000-000000000701',50,'02700000-0000-0000-0000-0000000003a3',current_date);
insert into expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('02700000-0000-0000-0000-00000000030a','02700000-0000-0000-0000-000000000701','advance-payment','02700000-0000-0000-0000-000000000701:advance-payment',now(),'02700000-0000-0000-0000-0000000003a3'),
  ('02700000-0000-0000-0000-00000000030a','02700000-0000-0000-0000-000000000702','approval','02700000-0000-0000-0000-000000000702:approval',now(),'02700000-0000-0000-0000-0000000003a3');
insert into expense_account_map (org_id, account_key, erp_account) values
  ('02700000-0000-0000-0000-00000000030a','employee_payable','Employee Payable - EX');

create function pg_temp.map_key_accepted(p_key text) returns boolean language plpgsql as $$
begin
  begin
    insert into public.expense_account_map (org_id, account_key, erp_account)
      values ('02700000-0000-0000-0000-00000000030b', p_key, 'probe ' || p_key);
    delete from public.expense_account_map where org_id = '02700000-0000-0000-0000-00000000030b' and account_key = p_key;
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

-- ── table privileges (NFR-EXP-010) ──
select ok(has_table_privilege('authenticated', 'public.expense_posting_erp_mirror', 'SELECT')
      and has_table_privilege('authenticated', 'public.expense_advance_returns', 'SELECT')
      and has_table_privilege('authenticated', 'public.expense_account_map', 'SELECT'),
  'AC-EXP-104: authenticated may read the three tables');
select ok(not has_table_privilege('authenticated', 'public.expense_posting_erp_mirror', 'INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('authenticated', 'public.expense_advance_returns', 'INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('authenticated', 'public.expense_account_map', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'AC-EXP-104: authenticated may write none of them');
select ok(not has_table_privilege('anon', 'public.expense_posting_erp_mirror', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('anon', 'public.expense_advance_returns', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('anon', 'public.expense_account_map', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'AC-EXP-104: anon holds nothing on them');

-- ── visibility follows the claim ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000003a1","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror), 1, 'AC-EXP-104: E1 sees the intent of their own advance');
select is((select count(*)::int from expense_advance_returns), 1, 'AC-EXP-104: E1 sees the return on their own advance');
select is((select count(*)::int from expense_account_map), 1, 'AC-EXP-104: a member reads the org''s account map');
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000003a2","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02700000-0000-0000-0000-000000000701'), 0, 'AC-EXP-104: E2 does not see E1''s intents');
select is((select count(*)::int from expense_advance_returns), 0, 'AC-EXP-104: E2 does not see E1''s returns');
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000003a3","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror), 2, 'AC-EXP-104: approval rank sees every intent');
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000003b1","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror), 0, 'AC-EXP-104: another org''s Admin sees no intent');
select is((select count(*)::int from expense_account_map), 0, 'AC-EXP-104: another org''s Admin sees no account map');
reset role;

-- ── functions (NFR-EXP-012) ──
select ok(not has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.org_employs_expense_postings(uuid)', 'EXECUTE'),
  'AC-EXP-104: the gate and the employment check are service_role only');
select ok(not has_function_privilege('anon', 'public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.enqueue_expense_claim_postings()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_expense_claim_postings()', 'EXECUTE')
      and not has_function_privilege('anon', 'public.enqueue_expense_return_posting()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_expense_return_posting()', 'EXECUTE'),
  'AC-EXP-104: no client can call the enqueue functions');

-- ── the key CHECK tracks the enum (a new expense_type label must be added to the CHECK in the same change) ──
select is((select count(*)::int
             from (select unnest(enum_range(null::public.expense_type))::text as k
                   union all select 'employee_payable' union all select 'employee_advance') keys
            where pg_temp.map_key_accepted(keys.k)),
  (select count(*)::int + 2 from unnest(enum_range(null::public.expense_type))),
  'AC-EXP-104: every expense_type label and the two party keys are accepted');
select throws_ok($$ insert into expense_account_map (org_id, account_key, erp_account)
                    values ('02700000-0000-0000-0000-00000000030b','Bogus','Any') $$,
  '23514', 'new row for relation "expense_account_map" violates check constraint "expense_account_map_key"',
  'AC-EXP-104: an unknown key is refused');

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0270_expense_postings_acl.test.sql` → fails with
`relation "expense_account_map" does not exist`.

### D9 — GREEN: §2 account map + §6 self-assertion (FR-EXP-112 storage, NFR-EXP-010/012)

Insert **between §1 and §3** of `supabase/migrations/0270_expense_postings.sql`:

```sql
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
```

Append at the **end** of the file:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — closing self-assertion (the 0211/0260 style). Hosted Supabase grants EXECUTE on new functions and ALL on
-- new tables to anon/authenticated by default; local Docker does not. Raise here so a deploy that does not land
-- this exact shape fails in the migration, on whichever database it runs.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_table text;
begin
  if has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
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
    raise exception '0270: expense posting function ACL is not the intended shape';
  end if;
  foreach v_table in array array['public.expense_advance_returns', 'public.expense_account_map',
                                 'public.expense_posting_erp_mirror'] loop
    if has_table_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE')
       or not has_table_privilege('authenticated', v_table, 'SELECT')
       or not has_table_privilege('service_role', v_table, 'SELECT,INSERT,UPDATE') then
      raise exception '0270: % ACL is not the intended shape', v_table;
    end if;
  end loop;
end $$;
```

Verify GREEN (all four files, one hold):
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_expense_advance_returns.test.sql supabase/tests/0270_expense_postings_enqueue.test.sql supabase/tests/0270_expense_posting_gate.test.sql supabase/tests/0270_expense_postings_acl.test.sql'`
→ `All tests successful. Files=4, Tests=50`.

Hosted-shape proof (the self-assertion must be able to fire): on the scratch DB run
`psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -c "begin; grant execute on function public.expense_posting_for_push(uuid, uuid) to authenticated; do \$\$ begin if has_function_privilege('authenticated','public.expense_posting_for_push(uuid, uuid)','EXECUTE') then raise exception 'would fire'; end if; end \$\$; rollback;"`
→ `ERROR: would fire` (the check reads the privilege a hosted default would grant). Wrap it in `scripts/with-db-lock.sh`.

### D10 — Mutation checks on the refusals (do not commit)

Each under `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <file>'`, then revert and re-run green:

| # | Change in `0270_expense_postings.sql` | File | Expected red |
|---|---|---|---|
| M1 | §4 enqueue trigger: delete the `if not public.org_employs_expense_postings(...) then return new; end if;` block | enqueue | test 11 (org C gets an intent) |
| M2 | §4: `if new.amount - new.advance_applied > 0` → `if true` | enqueue | test 13 (`{claim-payment,settlement}` for the 300 claim) |
| M3 | §5: delete the `if not public.is_active_member(m.actor_id)` block | gate | test 6 (no exception) |
| M4 | §5: `(m.posting <> 'approval' and v_role = 'Finance')` → `(m.posting <> 'approval')` | gate | test 7 |
| M5 | §5: `c.approved_at = m.state_stamp` → `true` | gate | test 8 |
| M6 | §5: `grant execute … to service_role` → `… to authenticated, service_role` | gate | test 10 **and** the §6 assertion aborts the reset |

Record "M1–M6: red → reverted green" in the PR body.

### D11 — Rollback file + forward → down → forward (NFR-EXP-011)

Create `supabase/migrations/rollback/0270_expense_postings_down.sql`:

```sql
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
drop function if exists public.expense_posting_for_push(uuid, uuid);
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
```

Verify (one hold):
`scripts/with-db-lock.sh bash -c 'supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0270_expense_postings_down.sql && supabase test db supabase/tests/expense_advances.test.sql && supabase db reset && supabase test db supabase/tests/0270_expense_advance_returns.test.sql'`
→ the down file runs clean, phase A's `expense_advances.test.sql` is green after the down, and 0270's returns test is
green after the re-apply.

### D12 — Catalog gates, denominator, types (NFR-EXP-012)

1. `scripts/isolation-probe-denominator.json`, `"tables"` array — insert in alphabetical position (after
   `"error_events"`, around `"expense_claim_files"`):
   ```json
       {"table":"expense_account_map","has_org":true,"pk":"id"},
       {"table":"expense_advance_returns","has_org":true,"pk":"id"},
   ```
   and after `{"table":"expense_claims",…}`:
   ```json
       {"table":"expense_posting_erp_mirror","has_org":true,"pk":"id"},
   ```
   No `definer_functions` change: the two DEFINER functions return `trigger` (excluded by the guard's query) and the
   gate is INVOKER. Verify: `scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs` → PASS.
2. Catalog gates + phase-A regression, one hold:
   `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0173_rpc_active_member_gate.test.sql supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/0203_rls_active_member_composition.test.sql supabase/tests/0210_service_only_definers_execute_grants.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/dead_authenticated_write_grants.test.sql supabase/tests/record_changes_catalog_gate.test.sql supabase/tests/expense_claims_schema_rls.test.sql supabase/tests/expense_claims_transition.test.sql supabase/tests/expense_claims_routing.test.sql supabase/tests/expense_claims_line_lock.test.sql supabase/tests/expense_advances.test.sql supabase/tests/expense_claims_notify.test.sql'`
   → all green. **0178 must stay at 59** (no client-callable function was added). If a catalog gate names one of
   the 0270 objects, fix the object (grant/policy), never the gate, and say so in the PR.
3. Types: `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.
   `git diff --stat pmo-portal/src/lib/supabase/database.types.ts` must show only additions for the three tables and
   the two functions (`expense_posting_for_push`, `org_employs_expense_postings`; the trigger and enqueue functions
   do not appear). If unrelated drift appears, restore the file and hand-add only those five entries in the same
   shape as `expense_claim_files` / `get_expense_advance_aging`. Verify: `cd pmo-portal && npm run typecheck` → 0 errors.

Commit part 2: `feat(expenses): 0270 posting intents, returns rows, account map, sweep gate (#775 phase B)`.

Next: [part 3 — adapter seam](2026-10-07-expense-claims-phase-b.part3-seam.md).
