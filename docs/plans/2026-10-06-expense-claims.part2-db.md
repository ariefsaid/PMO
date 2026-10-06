# Plan part 2 — Expense claims (#775): routing, lock, advances, notifications, gates (Tasks 5–13)

Part of `docs/plans/2026-10-06-expense-claims.md` (conventions §0 apply: `$WT`, one lock hold, AC-first titles).
#803 is merged as `supabase/migrations/0243_spend_approval_routing.sql`; every reference below is to that file.

### Task 5 — RED: routing (AC-EXP-020…025) and the shared line lock (AC-EXP-026)

Create `supabase/tests/expense_claims_routing.test.sql`:

```sql
-- expense_claims_routing.test.sql — #775 claims are decided by spend_approval_route (#803) and count on the
-- budget line; advances do not (DD-EXP-2); Special expenses is just a category (DD-EXP-8). AC-EXP-020..025.
-- Budget version is activated by plain UPDATE as postgres: activated_at stays NULL and no audit row names a
-- decider, so DD-APR-3 never fires here.
begin;
select plan(9);

insert into organizations (id, name, default_currency) values
  ('02473000-0000-0000-0000-00000000000a','EXP Route Org A','IDR'),
  ('02473000-0000-0000-0000-00000000000b','EXP Route Org B','IDR');
insert into auth.users (id, email) values
  ('02473000-0000-0000-0000-0000000000a1','exp-r-e1@example.com'),
  ('02473000-0000-0000-0000-0000000000a2','exp-r-pma@example.com'),
  ('02473000-0000-0000-0000-0000000000a3','exp-r-pmb@example.com'),
  ('02473000-0000-0000-0000-0000000000a4','exp-r-ad@example.com'),
  ('02473000-0000-0000-0000-0000000000a5','exp-r-f1@example.com'),
  ('02473000-0000-0000-0000-0000000000b1','exp-r-ba@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-00000000000a','R Eng','exp-r-e1@example.com','Engineer','active'),
  ('02473000-0000-0000-0000-0000000000a2','02473000-0000-0000-0000-00000000000a','R PM A','exp-r-pma@example.com','Project Manager','active'),
  ('02473000-0000-0000-0000-0000000000a3','02473000-0000-0000-0000-00000000000a','R PM B','exp-r-pmb@example.com','Project Manager','active'),
  ('02473000-0000-0000-0000-0000000000a4','02473000-0000-0000-0000-00000000000a','R Admin','exp-r-ad@example.com','Admin','active'),
  ('02473000-0000-0000-0000-0000000000a5','02473000-0000-0000-0000-00000000000a','R Fin','exp-r-f1@example.com','Finance','active'),
  ('02473000-0000-0000-0000-0000000000b1','02473000-0000-0000-0000-00000000000b','R B Admin','exp-r-ba@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('02473000-0000-0000-0000-000000000101','02473000-0000-0000-0000-00000000000a','R Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02473000-0000-0000-0000-000000000201','02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000201','Overheads',1000),
  ('02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000201','Special expenses',500);
update budget_versions set status = 'Active' where id = '02473000-0000-0000-0000-000000000201';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02473000-0000-0000-0000-00000000000a','02473000-0000-0000-0000-000000000101','02473000-0000-0000-0000-0000000000a2'),
  ('02473000-0000-0000-0000-00000000000a',null,'02473000-0000-0000-0000-0000000000a5');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number, submitted_at, paid_on) values
  ('02473000-0000-0000-0000-000000000401','02473000-0000-0000-0000-00000000000a','claim','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Overheads','R1 within',400,'Submitted','EXP-2610020001',now() + interval '1 hour',null),
  ('02473000-0000-0000-0000-000000000402','02473000-0000-0000-0000-00000000000a','claim','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Special expenses','R3 special',300,'Submitted','EXP-2610020002',now() + interval '1 hour',null),
  ('02473000-0000-0000-0000-000000000403','02473000-0000-0000-0000-00000000000a','claim','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Overheads','R4 admin',100,'Submitted','EXP-2610020003',now() + interval '1 hour',null),
  ('02473000-0000-0000-0000-000000000404','02473000-0000-0000-0000-00000000000a','advance','02473000-0000-0000-0000-0000000000a1','02473000-0000-0000-0000-000000000101','Overheads','Paid advance',900,'Paid','ADV-2610020004',now(),current_date);
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02473000-0000-0000-0000-000000000501','02473000-0000-0000-0000-00000000000a','PR on the line','02473000-0000-0000-0000-000000000101','02473000-0000-0000-0000-0000000000a1','Requested',700,'Overheads');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02473000-0000-0000-0000-000000000401','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-EXP-020: a Project Manager who is not the named approver cannot approve');

set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02473000-0000-0000-0000-000000000401','Approved') $$,
  'AC-EXP-020: the named project approver approves');
select is((select route || '/' || reason || '/' || line_used::text
             from get_procurement_approval_routes(array['02473000-0000-0000-0000-000000000501']::uuid[])),
  'org/exceeds_line/400.00',
  'AC-EXP-021: the approved 400 claim is spend on the line, so a 700 request now exceeds 1000');
select is((select route || '/' || reason || '/' || line_used::text
             from get_expense_claim_approval_routes(array['02473000-0000-0000-0000-000000000403']::uuid[])),
  'project/within_budget/400.00',
  'AC-EXP-022: the paid 900 advance is not on the line; only the approved claim is');
select is((select route || '/' || reason || '|' || (approvers->0->>'id')
             from get_expense_claim_approval_routes(array['02473000-0000-0000-0000-000000000402']::uuid[])),
  'project/within_budget|02473000-0000-0000-0000-0000000000a2',
  'AC-EXP-023: a Special expenses claim routes like any other category');
select is((select count(*)::int from get_expense_claim_approval_routes(
             array['02473000-0000-0000-0000-000000000401','02473000-0000-0000-0000-000000000402']::uuid[])), 1,
  'AC-EXP-025: only Submitted ids return a route');

set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02473000-0000-0000-0000-000000000403','Approved') $$,
  'AC-EXP-024: an Admin who is not named approves (break-glass)');

set local request.jwt.claims = '{"sub":"02473000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from get_expense_claim_approval_routes(array['02473000-0000-0000-0000-000000000402']::uuid[])), 0,
  'AC-EXP-025: another org''s caller gets no route');
reset role;

select is((select (detail->>'break_glass')::boolean from audit_events
            where action = 'expense_claim.approval_route' and entity_id = '02473000-0000-0000-0000-000000000403'), true,
  'AC-EXP-024: the break-glass approval is marked in the audit trail');

select * from finish();
rollback;
```

Create `supabase/tests/expense_claims_line_lock.test.sql`:

```sql
-- expense_claims_line_lock.test.sql — #775: a claim approval takes the SAME per-line lock procurement takes
-- (0243 §7 key), so claims and purchase requests cannot both spend one line's headroom. A second, genuinely
-- concurrent session (dblink — the 0151 / AC-APR-021 idiom) holds the key. AC-EXP-026.
-- password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
begin;
select plan(3);
create extension if not exists dblink;

insert into organizations (id, name, default_currency) values ('02474000-0000-0000-0000-00000000000a','EXP Lock Org','IDR');
insert into auth.users (id, email) values
  ('02474000-0000-0000-0000-0000000000a1','exp-l-pm@example.com'),
  ('02474000-0000-0000-0000-0000000000a2','exp-l-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02474000-0000-0000-0000-0000000000a1','02474000-0000-0000-0000-00000000000a','L PM','exp-l-pm@example.com','Project Manager','active'),
  ('02474000-0000-0000-0000-0000000000a2','02474000-0000-0000-0000-00000000000a','L Eng','exp-l-eng@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values
  ('02474000-0000-0000-0000-000000000101','02474000-0000-0000-0000-00000000000a','L Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02474000-0000-0000-0000-000000000201','02474000-0000-0000-0000-00000000000a','02474000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02474000-0000-0000-0000-00000000000a','02474000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active' where id = '02474000-0000-0000-0000-000000000201';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02474000-0000-0000-0000-00000000000a','02474000-0000-0000-0000-000000000101','02474000-0000-0000-0000-0000000000a1');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number, submitted_at) values
  ('02474000-0000-0000-0000-000000000401','02474000-0000-0000-0000-00000000000a','claim','02474000-0000-0000-0000-0000000000a2','02474000-0000-0000-0000-000000000101','Materials','Locked line',100,'Submitted','EXP-2610030001',now() + interval '1 hour');

select dblink_connect('exp_line', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('exp_line', 'begin');
select ok(
  (select count(*)::int from dblink('exp_line', format($q$select pg_advisory_xact_lock(%s)$q$,
     hashtextextended('spend-line:02474000-0000-0000-0000-000000000101:Materials', 0))) as t(a text)) = 1,
  'AC-EXP-026: a second session holds the Materials line lock');

set local lock_timeout = '200ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02474000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02474000-0000-0000-0000-000000000401','Approved') $$,
  '55P03', 'canceling statement due to lock timeout',
  'AC-EXP-026: a claim approval on a locked line waits for the lock');
reset role;

select dblink_exec('exp_line', 'commit');
select dblink_disconnect('exp_line');
set local lock_timeout = 0;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02474000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02474000-0000-0000-0000-000000000401','Approved') $$,
  'AC-EXP-026: once the other session ends the same approval proceeds');
reset role;

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_routing.test.sql supabase/tests/expense_claims_line_lock.test.sql'`
→ routing: assertion 1 fails "no exception raised" (Task 4's branch is the flat floor only); lock: assertion 2 fails
"no exception raised" (nothing takes the lock yet).

### Task 6 — GREEN: routing block in §7, §8 `spend_approval_route` (+claims), `get_expense_claim_approval_routes`

**6a.** In `0247_expense_claims.sql` §7, replace exactly these four lines:

```sql
    -- APPROVE-BRANCH (Task 6 replaces this branch body with the routing block).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
```

with:

```sql
    -- #803 routing, called — never copied (ADR-0075 §3). Same lock key as transition_procurement (0243 §7) so a
    -- claim and a purchase request on one line serialize (FR-EXP-022). Classification runs AFTER the lock is held.
    if v_row.project_id is not null and v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
    end if;
    select * into v_route
      from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_row.amount,
                                       v_row.currency, v_row.claimant_id, v_uid, v_row.submitted_at);
    -- coalesce: a NULL route must refuse, never pass (DD-APR-5).
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason
          using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown')
        using errcode = '42501';
    end if;
    -- The flat floor still applies to everyone but an Admin (named approvers hold this rank by construction).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    perform public.log_audit('expense_claim.approval_route', v_row.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_row.amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_row.budget_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
```

**6b.** Append §8. Under this banner, copy §5 of `supabase/migrations/0243_spend_approval_routing.sql` **verbatim** —
from the line `create or replace function public.spend_approval_route(` through its `revoke` and `grant`
statements (lines 185–304 of 0243 as merged) — then insert the block below **immediately after** 0243's statement
ending `and pr.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid');`
(0243 line 235) and **before** the comment line that begins `-- Explicit` (0243 line 236). Every inserted line
carries `-- 0247`; nothing else changes.

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — spend_approval_route: 0243 §5 VERBATIM plus the lines marked `0247` (ADR-0075 §3 contract: claims
-- extend only this function's "line used"). Reverse = this text minus the `0247` lines.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
```

```sql
      -- 0247 (#775, DD-EXP-2): approved and paid expense CLAIMS on this line are spend too. Advances are not:  -- 0247
      -- cash in custody is not cost, and counting it and the claims that settle it would count twice.          -- 0247
      -- The claim being decided is 'Submitted', so it is never in its own sum.                                  -- 0247
      select v_used + coalesce(sum(greatest(0, c.amount)), 0),                                                  -- 0247
             v_foreign or coalesce(bool_or(c.currency is distinct from v_currency), false)                      -- 0247
        into v_used, v_foreign                                                                                   -- 0247
        from public.expense_claims c                                                                             -- 0247
       where c.org_id = p_org_id and c.project_id = p_project_id and c.budget_category = p_category              -- 0247
         and c.kind = 'claim' and c.status in ('Approved','Paid');                                               -- 0247
```

Then append the claims' UI read:

```sql
-- §8b — the UI read for claims (FR-EXP-031), the twin of 0243 §6. SECURITY INVOKER: RLS on expense_claims is
-- the org boundary; an id the caller cannot see yields no row. Decider = the viewer unless they are the claimant.
create or replace function public.get_expense_claim_approval_routes(p_ids uuid[])
returns table (claim_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select c.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         c.amount, r.line_budget, r.line_used
    from public.expense_claims c
    cross join lateral public.spend_approval_route(c.org_id, c.project_id, c.budget_category, c.amount, c.currency,
                                                   c.claimant_id, nullif(auth.uid(), c.claimant_id), c.submitted_at) r
   where c.id = any (p_ids) and c.status = 'Submitted'
$$;
revoke all on function public.get_expense_claim_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_expense_claim_approval_routes(uuid[]) to authenticated;
```

**Verify (GREEN), then #803's own suites (one hold):**
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_routing.test.sql supabase/tests/expense_claims_line_lock.test.sql supabase/tests/expense_claims_transition.test.sql supabase/tests/spend_approval_classify.test.sql supabase/tests/spend_approval_enforce.test.sql supabase/tests/spend_approval_line_lock.test.sql supabase/tests/spend_approval_inputs_frozen.test.sql supabase/tests/spend_approval_notify.test.sql supabase/tests/spend_approvers_config.test.sql'`
→ every file `ok`; 9/9 routing, 3/3 lock. A red #803 file means §8 drifted from 0243 §5 — fix the copy, never the test.

### Task 7 — RED: settlement, returns, aging, ACL (AC-EXP-017, 030…032)

Create `supabase/tests/expense_advances.test.sql`:

```sql
-- expense_advances.test.sql — #775 advances: claims settle against them at payment, Finance records cash
-- returns, aging is in the org's timezone (DD-EXP-6/7). AC-EXP-017, 030..032.
begin;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02475000-0000-0000-0000-00000000000a','EXP Adv Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02475000-0000-0000-0000-0000000000a1','exp-a-e1@example.com'),
  ('02475000-0000-0000-0000-0000000000a2','exp-a-e2@example.com'),
  ('02475000-0000-0000-0000-0000000000a3','exp-a-pm@example.com'),
  ('02475000-0000-0000-0000-0000000000a4','exp-a-f1@example.com'),
  ('02475000-0000-0000-0000-0000000000a5','exp-a-f2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02475000-0000-0000-0000-0000000000a1','02475000-0000-0000-0000-00000000000a','A Eng One','exp-a-e1@example.com','Engineer','active'),
  ('02475000-0000-0000-0000-0000000000a2','02475000-0000-0000-0000-00000000000a','A Eng Two','exp-a-e2@example.com','Engineer','active'),
  ('02475000-0000-0000-0000-0000000000a3','02475000-0000-0000-0000-00000000000a','A PM','exp-a-pm@example.com','Project Manager','active'),
  ('02475000-0000-0000-0000-0000000000a4','02475000-0000-0000-0000-00000000000a','A Fin One','exp-a-f1@example.com','Finance','active'),
  ('02475000-0000-0000-0000-0000000000a5','02475000-0000-0000-0000-00000000000a','A Fin Two','exp-a-f2@example.com','Finance','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, paid_on, returned_amount) values
  ('02475000-0000-0000-0000-000000000301','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Trip float',1000,'Paid','ADV-2610040001','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 10,0),
  ('02475000-0000-0000-0000-000000000302','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Returnable',500,'Paid','ADV-2610040002','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 10,0),
  ('02475000-0000-0000-0000-000000000303','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a5','F2 own',200,'Paid','ADV-2610040003','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 5,0),
  ('02475000-0000-0000-0000-000000000304','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Not yet paid',100,'Approved','ADV-2610040004','02475000-0000-0000-0000-0000000000a3',null,0),
  ('02475000-0000-0000-0000-000000000305','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Settled',50,'Paid','ADV-2610040005','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 100,50),
  ('02475000-0000-0000-0000-000000000306','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Aged',500,'Paid','ADV-2610040006','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 45,0);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, advance_id) values
  ('02475000-0000-0000-0000-000000000401','02475000-0000-0000-0000-00000000000a','claim','02475000-0000-0000-0000-0000000000a1','Claim 300',300,'Approved','EXP-2610040007','02475000-0000-0000-0000-0000000000a3','02475000-0000-0000-0000-000000000301'),
  ('02475000-0000-0000-0000-000000000402','02475000-0000-0000-0000-00000000000a','claim','02475000-0000-0000-0000-0000000000a1','Claim 900',900,'Approved','EXP-2610040008','02475000-0000-0000-0000-0000000000a3','02475000-0000-0000-0000-000000000301');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02475000-0000-0000-0000-000000000401','Paid') $$,
  'AC-EXP-030: Finance pays the 300 claim');
select is((select advance_applied from expense_claims where id = '02475000-0000-0000-0000-000000000401'), 300.00::numeric,
  'AC-EXP-030: the advance covers all 300');
select is(expense_advance_outstanding('02475000-0000-0000-0000-000000000301'), 700.00::numeric,
  'AC-EXP-030: 700 of the advance remains');
select lives_ok($$ select transition_expense_claim('02475000-0000-0000-0000-000000000402','Paid') $$,
  'AC-EXP-030: Finance pays the 900 claim');
select is((select advance_applied from expense_claims where id = '02475000-0000-0000-0000-000000000402'), 700.00::numeric,
  'AC-EXP-030: the advance covers only the 700 left; 200 is paid in cash');
select is(expense_advance_outstanding('02475000-0000-0000-0000-000000000301'), 0.00::numeric,
  'AC-EXP-030: the advance is fully settled');
select lives_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 100, 'Cash back') $$,
  'AC-EXP-031: Finance records a 100 cash return');
select is(expense_advance_outstanding('02475000-0000-0000-0000-000000000302'), 400.00::numeric,
  'AC-EXP-031: 400 remains outstanding');
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 450) $$,
  'P0001', 'a return of 450.00 exceeds the 400.00 still outstanding on this advance',
  'AC-EXP-031: a return cannot exceed what is outstanding');
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 'NaN') $$,
  'P0001', 'a return amount must be greater than zero', 'AC-EXP-031: NaN is refused');
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000304', 10) $$,
  'P0001', 'only a paid advance can have cash returned against it', 'AC-EXP-031: an unpaid advance takes no return');

set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000303', 10) $$,
  '42501', 'separation of duties: a claimant cannot record a return of their own advance',
  'AC-EXP-031: Finance cannot record a return on their own advance');

set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 10) $$,
  '42501', 'only Finance or an Admin records an advance return', 'AC-EXP-031: a Project Manager cannot record a return');
select is((select age_days || '/' || bucket || '/' || outstanding::text
             from get_expense_advance_aging() where advance_id = '02475000-0000-0000-0000-000000000306'),
  '45/31-60/500.00', 'AC-EXP-032: age is counted in org days and bucketed');
select is((select count(*)::int from get_expense_advance_aging()
            where advance_id in ('02475000-0000-0000-0000-000000000301','02475000-0000-0000-0000-000000000305')), 0,
  'AC-EXP-032: settled advances are not aging');

set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from get_expense_advance_aging()), 0,
  'AC-EXP-032: an Engineer sees no one else''s advances');
reset role;

select ok(exists (select 1 from audit_events where action = 'expense_advance.return'
                   and entity_id = '02475000-0000-0000-0000-000000000302' and (detail->>'amount')::numeric = 100),
  'AC-EXP-031: the return is on the audit trail');
select is(has_function_privilege('anon','public.transition_expense_claim(uuid, public.expense_claim_status, text, text)','EXECUTE'), false,
  'AC-EXP-017: anon cannot execute transition_expense_claim');
select is(has_function_privilege('anon','public.record_expense_advance_return(uuid, numeric, text)','EXECUTE'), false,
  'AC-EXP-017: anon cannot execute record_expense_advance_return');
select is(has_function_privilege('authenticated','public.transition_expense_claim(uuid, public.expense_claim_status, text, text)','EXECUTE'), true,
  'AC-EXP-017: members can execute transition_expense_claim');
select is(has_function_privilege('authenticated','public.record_expense_advance_return(uuid, numeric, text)','EXECUTE'), true,
  'AC-EXP-017: members can execute record_expense_advance_return');

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_advances.test.sql'`
→ assertions 1–6 pass (settlement shipped in Task 4); assertion 7 fails `function record_expense_advance_return(…)
does not exist` — the stated reason (returns and aging are new).

### Task 8 — GREEN: §9 `record_expense_advance_return`, `get_expense_advance_aging`

Append to the migration:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — cash returned on an advance (FR-EXP-041) and aging (FR-EXP-042, DD-EXP-7).
-- `p_amount > 0 and < Infinity` also rejects NaN ('NaN' > 0 is TRUE in Postgres; NaN < Infinity is FALSE).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
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

-- Aging: every visible Paid advance with money outstanding, oldest first. A Paid advance with no paid date (an
-- import) ages as 90+. SECURITY INVOKER — RLS decides whose advances the caller sees.
create or replace function public.get_expense_advance_aging()
returns table (advance_id uuid, claim_number text, claimant_id uuid, claimant_name text,
               project_id uuid, project_name text, currency text, amount numeric, settled numeric,
               returned numeric, outstanding numeric, paid_on date, age_days int, bucket text)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with adv as (
    select a.*,
           (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as org_today,
           coalesce((select sum(c.advance_applied) from public.expense_claims c
                      where c.advance_id = a.id and c.status = 'Paid'), 0) as settled_sum
      from public.expense_claims a
      join public.organizations o on o.id = a.org_id
     where a.kind = 'advance' and a.status = 'Paid'
  )
  select adv.id, adv.claim_number, adv.claimant_id, pf.full_name, adv.project_id, p.name, adv.currency,
         adv.amount, adv.settled_sum, adv.returned_amount,
         adv.amount - adv.settled_sum - adv.returned_amount,
         adv.paid_on,
         (adv.org_today - adv.paid_on)::int,
         case when adv.paid_on is null then '90+'
              when adv.org_today - adv.paid_on <= 30 then '0-30'
              when adv.org_today - adv.paid_on <= 60 then '31-60'
              when adv.org_today - adv.paid_on <= 90 then '61-90'
              else '90+' end
    from adv
    left join public.profiles pf on pf.id = adv.claimant_id
    left join public.projects p  on p.id = adv.project_id
   where adv.amount - adv.settled_sum - adv.returned_amount > 0
   order by adv.paid_on nulls first, adv.id
$$;
revoke all on function public.get_expense_advance_aging() from public, anon;
grant execute on function public.get_expense_advance_aging() to authenticated;
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_advances.test.sql supabase/tests/expense_claims_transition.test.sql'` → 21/21, 24/24.

### Task 9 — RED: notifications (AC-EXP-040…041)

Create `supabase/tests/expense_claims_notify.test.sql`:

```sql
-- expense_claims_notify.test.sql — #775 hand-offs (the #788 pattern): submit → the route's approvers; approve →
-- claimant + Finance; reject/pay → claimant. Never the claimant on submit. AC-EXP-040..041.
begin;
select plan(14);

insert into organizations (id, name, default_currency) values ('02476000-0000-0000-0000-00000000000a','EXP Notify Org','IDR');
insert into auth.users (id, email) values
  ('02476000-0000-0000-0000-0000000000a1','exp-n-e1@example.com'),
  ('02476000-0000-0000-0000-0000000000a2','exp-n-pma@example.com'),
  ('02476000-0000-0000-0000-0000000000a3','exp-n-pmb@example.com'),
  ('02476000-0000-0000-0000-0000000000a4','exp-n-f1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02476000-0000-0000-0000-0000000000a1','02476000-0000-0000-0000-00000000000a','N Eng','exp-n-e1@example.com','Engineer','active'),
  ('02476000-0000-0000-0000-0000000000a2','02476000-0000-0000-0000-00000000000a','N PM A','exp-n-pma@example.com','Project Manager','active'),
  ('02476000-0000-0000-0000-0000000000a3','02476000-0000-0000-0000-00000000000a','N PM B','exp-n-pmb@example.com','Project Manager','active'),
  ('02476000-0000-0000-0000-0000000000a4','02476000-0000-0000-0000-00000000000a','N Fin','exp-n-f1@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('02476000-0000-0000-0000-000000000101','02476000-0000-0000-0000-00000000000a','N Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02476000-0000-0000-0000-000000000201','02476000-0000-0000-0000-00000000000a','02476000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02476000-0000-0000-0000-00000000000a','02476000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active' where id = '02476000-0000-0000-0000-000000000201';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02476000-0000-0000-0000-00000000000a','02476000-0000-0000-0000-000000000101','02476000-0000-0000-0000-0000000000a2');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status) values
  ('02476000-0000-0000-0000-000000000401','02476000-0000-0000-0000-00000000000a','claim','02476000-0000-0000-0000-0000000000a1','02476000-0000-0000-0000-000000000101','Materials','Notify claim',0,'Draft'),
  ('02476000-0000-0000-0000-000000000402','02476000-0000-0000-0000-00000000000a','advance','02476000-0000-0000-0000-0000000000a1',null,null,'Notify advance',300,'Draft'),
  ('02476000-0000-0000-0000-000000000403','02476000-0000-0000-0000-00000000000a','claim','02476000-0000-0000-0000-0000000000a1','02476000-0000-0000-0000-000000000101','Materials','Notify reject',0,'Draft');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02476000-0000-0000-0000-000000000401','2026-10-01','Travel','Train',200),
  ('02476000-0000-0000-0000-000000000403','2026-10-01','Meals','Lunch',50);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02476000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000401','Submitted') $$, 'AC-EXP-040: submit the claim');
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000402','Submitted') $$, 'AC-EXP-040: submit the advance');
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000403','Submitted') $$, 'AC-EXP-041: submit the claim to reject');
reset role;

select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a2'
            and title = 'Expense claim awaiting your approval' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-040: the named project approver is told');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a3'
            and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 0,
  'AC-EXP-040: a Project Manager who is not named is not');
select is((select count(*)::int from notifications where title = 'Cash advance awaiting your approval'
            and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000402'
            and owner_id in ('02476000-0000-0000-0000-0000000000a2','02476000-0000-0000-0000-0000000000a3','02476000-0000-0000-0000-0000000000a4')), 3,
  'AC-EXP-040: an unrouted advance goes to every approval-rank member');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and metadata->'entity'->>'id' in ('02476000-0000-0000-0000-000000000401','02476000-0000-0000-0000-000000000402')), 0,
  'AC-EXP-040: never the claimant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02476000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000401','Approved') $$, 'AC-EXP-041: approve');
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000403','Rejected', 'No receipt') $$, 'AC-EXP-041: reject');
set local request.jwt.claims = '{"sub":"02476000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02476000-0000-0000-0000-000000000401','Paid') $$, 'AC-EXP-041: pay');
reset role;

select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and title = 'Your expense claim was approved' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-041: the claimant hears it was approved');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a4'
            and title = 'Expense claim ready to pay' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-041: Finance hears it is ready to pay');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and title = 'Your expense claim was rejected' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000403'), 1,
  'AC-EXP-041: the claimant hears it was rejected');
select is((select count(*)::int from notifications where owner_id = '02476000-0000-0000-0000-0000000000a1'
            and title = 'Your expense claim was paid' and metadata->'entity'->>'id' = '02476000-0000-0000-0000-000000000401'), 1,
  'AC-EXP-041: the claimant hears it was paid');

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_notify.test.sql'`
→ the six lives_ok pass; every count assertion that expects 1 or 3 reads 0 (no trigger yet) — the stated reason.

### Task 10 — GREEN: §10 notification trigger

Append to the migration:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §10 — hand-offs (FR-EXP-050/051), the 0237 / 0243 §9 pattern. Recipients on submit = the route's people, from
-- the SAME function the transition enforces with (one copy of the rule). notify_workflow_user drops the actor,
-- other orgs and inactive members itself.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.notify_expense_claim_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r       record;
  v_route record;
  v_noun  text := case new.kind when 'advance' then 'Cash advance' else 'Expense claim' end;
  v_label text := coalesce(new.claim_number, new.title);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'Draft' and new.status = 'Submitted' then
    select * into v_route
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category, new.amount, new.currency,
                                       new.claimant_id, null, new.submitted_at);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.claimant_id
                and case coalesce(v_route.route, 'admin')
                      when 'flat'  then public.holds_spend_approval_authority(p.role)
                      when 'admin' then p.role = 'Admin'
                      else p.id = any (v_route.approver_ids)
                    end
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' awaiting your approval',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was approved',
      coalesce(nullif(btrim(new.approval_notes), ''), new.title), 'info', 'expense_claim', new.id, v_label);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id and p.role = 'Finance'
                and p.id is distinct from new.claimant_id and p.id is distinct from new.approved_by_id
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' ready to pay',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was rejected',
      coalesce(nullif(btrim(new.rejection_notes), ''), new.title), 'warning', 'expense_claim', new.id, v_label);
  elsif old.status = 'Approved' and new.status = 'Paid' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was paid',
      new.title, 'info', 'expense_claim', new.id, v_label);
  end if;
  return new;
end; $$;
revoke execute on function public.notify_expense_claim_transition() from public, anon, authenticated;
create trigger expense_claims_notify_transition_trg
  after update of status on public.expense_claims
  for each row execute function public.notify_expense_claim_transition();
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_notify.test.sql supabase/tests/0237_workflow_notifications.test.sql supabase/tests/0099_notifications.test.sql supabase/tests/spend_approval_notify.test.sql'`
→ 14/14; the existing notification files stay `ok`.

### Task 11 — RED→GREEN: declare the two client-callable definers in the 0178 allow-list (NFR-EXP-003)

**RED:** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0178_anon_executable_definers.test.sql'`
→ AC-ACL-004 fails naming `record_expense_advance_return, transition_expense_claim` (the stated reason: undeclared
SECURITY DEFINER writers granted to `authenticated`).

**GREEN:** in `supabase/tests/0178_anon_executable_definers.test.sql`:
1. In the `insert into client_callable_rpc_names` list insert `('record_expense_advance_return'),` directly after
   `('org_usage_summary'),` and `('transition_expense_claim'),` directly after `('transition_document_status'),`
   (keeps the list alphabetical).
2. Change the count in AC-ACL-002 and AC-ACL-003 — the numeral **and** both description strings — from the value on
   `dev` (**54** as of 2026-10-06, after #803) to that value + 2 (**56**). **Re-derive by hand** by counting the list
   rows after any rebase (the file's own MERGE HAZARD note).
3. Add under the latest amendment paragraph:
   ```sql
   -- ⚑ AMENDED BY 0247 (#775): `transition_expense_claim` and `record_expense_advance_return` join the retained
   -- set (+2). Both are SECURITY DEFINER writers invoked through PostgREST under a member's JWT; both re-assert
   -- org + assert_is_active_member() + role in their bodies, with pgTAP pairing in
   -- supabase/tests/expense_claims_transition.test.sql and expense_advances.test.sql (AC-EXP-010..017, 030..031).
   -- `get_expense_claim_approval_routes`, `get_expense_advance_aging` and `expense_advance_outstanding` are
   -- SECURITY INVOKER by design and deliberately NOT listed.
   ```

**Verify:** the RED command → `ok`.

### Task 12 — Regenerate types + full new-suite run + catalog neighbours (one hold)

```bash
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset \
  && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts \
  && supabase test db supabase/tests/expense_claims_schema_rls.test.sql supabase/tests/expense_claims_transition.test.sql \
     supabase/tests/expense_claims_routing.test.sql supabase/tests/expense_claims_line_lock.test.sql \
     supabase/tests/expense_advances.test.sql supabase/tests/expense_claims_notify.test.sql \
     supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0171_sod_class_completeness.test.sql \
     supabase/tests/dead_authenticated_write_grants.test.sql supabase/tests/0215_org_checks_after_stamp.test.sql \
     supabase/tests/0002_tenant_isolation.test.sql supabase/tests/spend_approval_enforce.test.sql \
     supabase/tests/spend_approval_classify.test.sql'
```
**Verify:** all `ok` (23 + 24 + 9 + 3 + 21 + 14 in the new files);
`grep -c "expense_claims: {\|expense_claim_lines: {\|expense_claim_files: {\|get_expense_claim_approval_routes\|expense_claim_status" "$WT/pmo-portal/src/lib/supabase/database.types.ts"` ≥ 5.

### Task 13 — Mutation battery (money path; Director runs or witnesses)

Each mutation is applied to a scratch copy of the migration, `db reset` + the named file run in one hold, observed
RED, then reverted. A mutation that stays green is a dead oracle — stop and fix the test.

| # | Mutation in `0247` | Must go RED |
|---|---|---|
| M1 | §7: delete the `separation of duties: a claimant cannot approve…` block | AC-EXP-011 (transition) |
| M2 | §7: change `v_uid = v_row.approved_by_id` to `false` | AC-EXP-013 (transition) |
| M3 | §8: delete the nine `-- 0247` lines | AC-EXP-021 (routing) — **and** re-run the `spend_approval_*` files: they must stay green |
| M4 | §8: drop `and c.kind = 'claim'` | AC-EXP-022 (routing) |
| M5 | §7: delete the `pg_advisory_xact_lock` statement | AC-EXP-026 (line lock) |
| M6 | §7: replace `least(v_row.amount, …)` with `v_row.amount` | AC-EXP-030 (advances) |
| M7 | §9: delete the claimant check in `record_expense_advance_return` | AC-EXP-031 (advances) |
| M8 | §4: drop `claimant_id = auth.uid() or` from `expense_claims_select` | AC-EXP-002 (schema) |

**Continue with `docs/plans/2026-10-06-expense-claims.part3-fe-data.md`.**
