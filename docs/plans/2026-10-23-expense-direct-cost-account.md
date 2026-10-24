# Plan — expense postings: the debit account follows the project (OD-EXP-PB-1, 2026-10-23)

> **Spec:** `docs/specs/expense-claims.spec.md` §10.8 (FR-EXP-119..122, NFR-EXP-015..017, AC-EXP-106, AC-EXP-119) and
> the in-place amendments listed at the end of §10.8.
> **Ruling:** owner, OD-EXP-PB-1 item 2 (2026-10-07), confirmed and refined 2026-10-23. No owner sign-off pending.
> **Lane:** money path → **Director-dispatched** (CLAUDE.md executor routing), not the ADW.
> **Worktree:** `/Users/ariefsaid/Coding/PMO-wt-overhead` (feature branch off `origin/dev`). Every command below
> starts with `cd` into it. PR to `dev`; `dev` is the ceiling.
> **Migration number:** `0354` (0353 is held by an open PR; 0355 is reserved by a parallel task — do not renumber).
> **Read first:** `docs/money-path-primer.md` (bucket 4: service role bypasses RLS — the new project read scopes
> by org explicitly).

## 1. Design (one decision at a time)

**D1 — Where the project's status is read: the database gate, at every fresh attempt.**
`expense_posting_for_push` (0270 §5, SECURITY INVOKER, `service_role` only) already re-reads the claim, amounts and
the actor's standing before each fresh attempt; it gains one primary-key read of `projects` and returns
`project_is_internal`. *Rejected:* stamping the status on the intent at approval time (the Director asked for
posting-time truth, and it would add a column + trigger change for no gain); reading it in the sweep through a second
PostgREST call (two round trips, and a second place that must remember the org filter). The read is
`where p.id = c.project_id and p.org_id = p_org_id`; a project that does not resolve inside the org raises the
existing `expense-posting-precondition-failed` (fail closed, primer "Invariants").

**D2 — Shape: a boolean, `false` when untagged, required by the parser.** `project_is_internal: boolean` on
`ExpenseGateTruth`. `parseExpenseGateTruth` refuses a missing or non-boolean value (`expense-gate-truth-malformed`),
so a sweep deployed ahead of its database posts nothing rather than defaulting to either account.

**D3 — One decision function, used twice.** `postsToProjectDirectCost(truth)` in `expensePostingResolve.ts` is
`posting === 'approval' && project_id !== null && !project_is_internal`. `accountKeysFor` uses it to ask for
`['employee_payable', 'project_direct_cost']`; the ready-refs builder uses it to point every expense type present at
the direct-cost account. No duplicate rule anywhere else.

**D4 — Body shape unchanged: one debit row per expense type, each on the direct-cost account.**
`ExpenseResolvedRefs.expenseAccounts` stays `Record<expense type, account>`; for a delivery claim every type maps to
the same account. `buildExpensePostingCommand` and `expenseJournalToBody` do not change, so the frozen payload shape,
its digest and the AC-EXP-111/117 body proofs are untouched. ERPNext accepts repeated accounts in one Journal Entry
and the GL still carries the per-type amounts. *Rejected:* collapsing to one row (changes the builder and the body
tests for no accounting gain).

**D5 — Missing direct-cost key = the shipped "unmapped key" path.** Verified in code: a missing key makes
`resolveExpensePosting` return `refuse('expense-account-unmapped', …)` (`expensePostingResolve.ts:101-104`); the
backstop records the intent `failed` and raises `expense-posting-failed` (deduplicated)
(`erpnext-sweep/index.ts` `recordOutcome`), and `listPending` re-takes `pending` and `failed` every tick. So it is
**`failed`, retried every tick, not `held`** (`held` is never re-driven, FR-EXP-115). Nothing new to build: adding the
key to `accountKeysFor` is the whole mechanism.

**D6 — Cut-over needs no code.** An intent with an outbox row is replayed from its frozen payload without the gate
(`expensePostingBackstop`, already proven by AC-EXP-121); `pushed` intents are never re-driven (FR-EXP-115). Pending
and failed intents with no outbox row are decided by the new rule at their next attempt (FR-EXP-122).

**D7 — Key name and placement.** `project_direct_cost`, third in `EXPENSE_ACCOUNT_KEYS` (after the two party keys,
before the expense types). Validation is the expense-type rule (root type Expense) — the existing fall-through branch
of `expenseAccountProblem`; no new branch. `external-set-company` needs **no code change**: it validates keys with the
shared `isExpenseAccountKey` / `expenseAccountProblem`.

**D8 — Setup UI: one more row in the existing list.** `pages/admin/ExpenseAccountMap.tsx` renders
`EXPENSE_ACCOUNT_KEYS`; the new row reuses the same `<li>`, `StatusPill`, `Button`, `EntityFormModal`/`TextField`
form. Only a label (`admin.expenseMap.key.projectDirectCost`, en + id) is added. No new copy, colour or component.

**D9 — No ADR.** A business rule inside ADR-0081's architecture plus a gate-field addition; the spec records it.

**Scaling / risk notes.** +1 indexed PK read per attempt (≤ 200 intents per org per tick); a delivery approval makes
2 account reads instead of 1 + types (NFR-EXP-017). Risk: deploying the sweep before the migration fails every fresh
expense posting closed — deploy order is DB → edge functions → FE (back to front). Risk: an org that employs
`expenses` but has not mapped `project_direct_cost` gets one action-required notice per delivery approval until it
maps it — intended (FR-EXP-121).

## 2. File map

| File | Change |
|---|---|
| `supabase/migrations/0354_expense_direct_cost_account.sql` | new — key CHECK + gate `project_is_internal` + ACL assertion |
| `supabase/migrations/rollback/0354_expense_direct_cost_account_down.sql` | new — restores 0270 shape, self-asserts |
| `supabase/tests/0354_expense_direct_cost_account.test.sql` | new — AC-EXP-106 |
| `pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.ts` (+ `.test.ts`) | key list — AC-EXP-118 |
| `supabase/functions/external-set-company/setup.test.ts` | one test — AC-EXP-120 |
| `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts` (+ `.test.ts`) | gate field + parser — AC-EXP-117 |
| `supabase/functions/erpnext-sweep/expensePostingBackstopLive.test.ts` | fixtures gain the field |
| `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts` (+ `.test.ts`) | the rule — AC-EXP-119, AC-EXP-115 |
| `pmo-portal/src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts` | one test title — AC-EXP-111 |
| `pmo-portal/pages/admin/ExpenseAccountMap.tsx` (+ `.test.tsx`) | label + header comment — AC-EXP-130 |
| `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json` | one key each |
| `pmo-portal/e2e/serial/_expHelpers.ts`, `pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` | map + oracle — AC-EXP-140 |

**Existing assertions this plan changes, and why (BDD rule — the requirement changed, not the app being bent):**
AC-EXP-118's key-list equality (FR-EXP-112/DD-EXP-16 now name 8 keys); AC-EXP-130's "6 of 7"/row count (FR-EXP-116
now 8 keys); one AC-EXP-115 `project-unmapped` line now names a delivery project (FR-EXP-106 amended); AC-EXP-140's
debit account (FR-EXP-119). Each goal oracle stays intact.

## 3. Tasks

### Task 1 — RED: AC-EXP-106 pgTAP (gate field, key, ACL)  *(4 min)*

Create `supabase/tests/0354_expense_direct_cost_account.test.sql`:

```sql
-- 0354_expense_direct_cost_account.test.sql — OD-EXP-PB-1 (owner 2026-10-07, confirmed 2026-10-23): the sweep's gate
-- reports whether the claim's project is an Internal Project, read from the org's own project row at call time, and
-- the account map admits the project direct-cost key (FR-EXP-119, NFR-EXP-016). AC-EXP-106. Migration under test: 0354.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values
  ('03540000-0000-0000-0000-00000000000a','EXP-DC Org','IDR','Asia/Jakarta'),
  ('03540000-0000-0000-0000-00000000000b','EXP-DC Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('03540000-0000-0000-0000-0000000000a1','expdc-e1@example.com'),
  ('03540000-0000-0000-0000-0000000000a3','expdc-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-00000000000a','DC Eng','expdc-e1@example.com','Engineer','active'),
  ('03540000-0000-0000-0000-0000000000a3','03540000-0000-0000-0000-00000000000a','DC PM','expdc-pm@example.com','Project Manager','active');
insert into projects (id, org_id, name, status) values
  ('03540000-0000-0000-0000-000000000101','03540000-0000-0000-0000-00000000000a','DC Internal','Internal Project'),
  ('03540000-0000-0000-0000-000000000102','03540000-0000-0000-0000-00000000000a','DC Delivery','Ongoing Project'),
  ('03540000-0000-0000-0000-000000000103','03540000-0000-0000-0000-00000000000b','DC Other Org','Ongoing Project');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('03540000-0000-0000-0000-000000000501','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-000000000101','Internal trip',0,'Approved','EXP-2610230001','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00'),
  ('03540000-0000-0000-0000-000000000502','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-000000000102','Site trip',0,'Approved','EXP-2610230002','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00'),
  ('03540000-0000-0000-0000-000000000503','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1',null,'Office trip',0,'Approved','EXP-2610230003','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00'),
  ('03540000-0000-0000-0000-000000000504','03540000-0000-0000-0000-00000000000a','claim','03540000-0000-0000-0000-0000000000a1','03540000-0000-0000-0000-000000000103','Cross-org trip',0,'Approved','EXP-2610230004','03540000-0000-0000-0000-0000000000a3','2026-10-23 02:00:00+00');
insert into expense_posting_erp_mirror (id, org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('03540000-0000-0000-0000-000000000601','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000501','approval','03540000-0000-0000-0000-000000000501:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3'),
  ('03540000-0000-0000-0000-000000000602','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000502','approval','03540000-0000-0000-0000-000000000502:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3'),
  ('03540000-0000-0000-0000-000000000603','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000503','approval','03540000-0000-0000-0000-000000000503:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3'),
  ('03540000-0000-0000-0000-000000000604','03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000504','approval','03540000-0000-0000-0000-000000000504:approval','2026-10-23 02:00:00+00','03540000-0000-0000-0000-0000000000a3');

select lives_ok($$ insert into expense_account_map (org_id, account_key, erp_account)
                   values ('03540000-0000-0000-0000-00000000000a','project_direct_cost','Project Direct Cost - EX') $$,
  'AC-EXP-106: the account map admits the project direct-cost key');
select throws_ok($$ insert into expense_account_map (org_id, account_key, erp_account)
                    values ('03540000-0000-0000-0000-00000000000a','project_direct_costs','X') $$,
  '23514', 'new row for relation "expense_account_map" violates check constraint "expense_account_map_key"',
  'AC-EXP-106: the key list stays closed (a near-miss key is refused)');

set local role service_role;
select is((expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000601') ->> 'project_is_internal')::boolean,
  true, 'AC-EXP-106: a claim on an Internal Project reads project_is_internal = true');
select is((expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000602') ->> 'project_is_internal')::boolean,
  false, 'AC-EXP-106: a claim on a delivery (Ongoing) project reads false');
select is(expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000603') -> 'project_is_internal',
  'false'::jsonb, 'AC-EXP-106: an untagged claim reads false, never null or absent');
select throws_ok($$ select expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000604') $$,
  'P0001', 'expense-posting-precondition-failed', 'AC-EXP-106: a project outside the claim''s org fails closed');
reset role;
update expense_claims set project_id = '03540000-0000-0000-0000-000000000102' where id = '03540000-0000-0000-0000-000000000501';
set local role service_role;
select is((expense_posting_for_push('03540000-0000-0000-0000-00000000000a','03540000-0000-0000-0000-000000000601') ->> 'project_is_internal')::boolean,
  false, 'AC-EXP-106: the status is read at call time — re-tagged to a delivery project, the next read is false');
reset role;
select ok(not has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE'),
  'AC-EXP-106: no client can execute the gate after its replacement');
select ok(has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE'),
  'AC-EXP-106: the sweep (service_role) still executes the gate');

select * from finish();
rollback;
```

Verify RED (the key insert violates the 0270 CHECK; the gate returns no `project_is_internal`):
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0354_expense_direct_cost_account.test.sql'
```
Expected: `Failed` lines for tests 1, 3, 5 and 6 at least; exit non-zero.

### Task 2 — GREEN: migration 0354  *(5 min)*

Create `supabase/migrations/0354_expense_direct_cost_account.sql`:

```sql
-- 0354_expense_direct_cost_account.sql — OD-EXP-PB-1 (owner 2026-10-07, confirmed 2026-10-23): an expense claim on a
-- DELIVERY project (status not 'Internal Project') posts to the single project direct-cost account; an Internal
-- Project or untagged claim posts to the overhead account of its expense type.
-- Spec: docs/specs/expense-claims.spec.md §10.8 (FR-EXP-119..122). Plan: docs/plans/2026-10-23-expense-direct-cost-account.md.
-- Proven by supabase/tests/0354_expense_direct_cost_account.test.sql (AC-EXP-106) and the §3 self-assertion.
--
-- §1 expense_account_map admits `project_direct_cost` (still written only by external-set-company, FR-EXP-112)
-- §2 expense_posting_for_push also returns `project_is_internal`, read from the org's own project row at call time
-- §3 closing self-assertion (the gate's ACL survives the replace, on whichever database this runs)
--
-- ⛔ No new table, policy or function; the gate stays SECURITY INVOKER, service_role only (0178 count unchanged).
-- ⛔ service_role bypasses RLS: the project read states the org explicitly (money-path primer, bucket 4).
-- REVERSE: supabase/migrations/rollback/0354_expense_direct_cost_account_down.sql (stop the sweep pass first).

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the direct-cost key (DD-EXP-16 amended). The rule it must pass is the expense-type rule (FR-EXP-112).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.expense_account_map drop constraint expense_account_map_key;
alter table public.expense_account_map add constraint expense_account_map_key check (account_key in
  ('employee_payable','employee_advance','project_direct_cost','Travel','Accommodation','Meals','Local transport','Other'));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — 0270 §5 VERBATIM except the lines marked `0354`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — closing self-assertion (the 0270 §6 style): hosted defaults must not leave the gate client-callable.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE') then
    raise exception '0354: expense_posting_for_push ACL is not the intended shape';
  end if;
end $$;
```

Verify GREEN (reset + the new file + the 0270 files that read the gate/map, in ONE lock hold):
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0354_expense_direct_cost_account.test.sql supabase/tests/0270_expense_posting_gate.test.sql supabase/tests/0270_expense_postings_acl.test.sql supabase/tests/0270_expense_postings_enqueue.test.sql'
```
Expected: `All tests successful`; the 0354 file reports `ok 1..9`.

### Task 3 — rollback file + reversibility proof  *(4 min)*

Create `supabase/migrations/rollback/0354_expense_direct_cost_account_down.sql`:

```sql
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
```

Verify (apply 0354, roll it back, prove 0270's tests pass on the restored shape, then reset to head — one hold):
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead && scripts/with-db-lock.sh bash -c 'supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0354_expense_direct_cost_account_down.sql && supabase test db supabase/tests/0270_expense_posting_gate.test.sql supabase/tests/0270_expense_postings_acl.test.sql && supabase db reset'
```
Expected: psql completes with no `ERROR`; both 0270 files pass; the final reset succeeds. **Checkpoint commit**
(Director/executor): migration + rollback + pgTAP file.

### Task 4 — mutation check: the database half of the money rule  *(4 min)*

1. In `supabase/migrations/0354_expense_direct_cost_account.sql` change
   `select p.status::text = 'Internal Project' into v_internal` → `select false into v_internal`.
2. Run Task 2's verify command. **Must go RED:** "a claim on an Internal Project reads project_is_internal = true".
3. Restore the line exactly. Then change `from public.projects p where p.id = c.project_id and p.org_id = p_org_id;`
   → `from public.projects p where p.id = c.project_id;`
4. Run Task 2's verify command. **Must go RED:** "a project outside the claim's org fails closed".
5. Restore the line exactly; run Task 2's verify command → green. Record both RED outputs in the PR evidence.

### Task 5 — RED: AC-EXP-118 the key list and the direct-cost account rule  *(3 min)*

In `pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts` replace the test
`'AC-EXP-118 the keys are the two party keys plus every expense type'` (lines 36-40) with:

```ts
  it('AC-EXP-118 the keys are the two party keys, the project direct-cost key and every expense type', () => {
    expect(EXPENSE_ACCOUNT_KEYS).toEqual(['employee_payable', 'employee_advance', 'project_direct_cost', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other']);
    expect(isExpenseAccountKey('project_direct_cost')).toBe(true);
    expect(isExpenseAccountKey('Meals')).toBe(true);
    expect(isExpenseAccountKey('Bogus')).toBe(false);
  });

  it('AC-EXP-118 project direct cost: an Expense-root ledger account, the expense-type rule', () => {
    expect(expenseAccountProblem('project_direct_cost', acct({ name: 'Project Direct Cost - PSC' }), ctx)).toBeNull();
    expect(expenseAccountProblem('project_direct_cost', acct({ name: 'Employee Payable - PSC', root_type: 'Liability', account_type: 'Payable' }), ctx))
      .toBe('project_direct_cost: Employee Payable - PSC must be an Expense account');
    expect(expenseAccountProblem('project_direct_cost', acct({ is_group: 1 }), ctx)).toMatch(/group/);
  });
```

Verify RED:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts
```
Expected: the key-list test fails (`project_direct_cost` missing). (The rule test already passes at runtime — the
generic Expense branch covers any key; it pins the behaviour so a future per-key branch cannot loosen it.)

### Task 6 — RED: AC-EXP-120 the setup action saves and clears the new key  *(3 min)*

Append to `supabase/functions/external-set-company/setup.test.ts` directly after the test
`"AC-EXP-120 a Project Manager is refused; an unknown key or a blank account is a bad request"`:

```ts
// OD-EXP-PB-1 (2026-10-23): the single project direct-cost account is one more validated key (FR-EXP-112 expense rule).
Deno.test("AC-EXP-120 an Admin maps project_direct_cost to an Expense account; a Liability account is refused; it can be cleared", async () => {
  const save = (account: string, over: Record<string, unknown>) =>
    withFetchMock([
      ...base(), companyRoute, mapWrite("POST"),
      erp("erp.example.test", `/api/resource/Account/${encodeURIComponent(account)}`, () => ACCOUNT(account, over)),
    ], async ({ calls }) => {
      const res = await handleSetCompanyRequest(await request({
        tier: "erpnext", setupAction: "save-expense-account", accountKey: "project_direct_cost", erpAccount: account,
      }));
      return { status: res.status, text: await res.text(), calls };
    });
  const ok = await save("Project Direct Cost - EX", { root_type: "Expense", account_type: "" });
  assertEquals(ok.status, 200, ok.text);
  const row = restCall(ok.calls, "expense_account_map", "POST")[0].bodyJson as Record<string, unknown>;
  assertEquals([row.org_id, row.account_key, row.erp_account], ["org-1", "project_direct_cost", "Project Direct Cost - EX"]);

  const wrong = await save("Employee Payable - EX", {});
  assertEquals(wrong.status, 422, wrong.text);
  assertEquals(wrong.text.includes("must be an Expense account"), true, wrong.text);
  assertEquals(restCall(wrong.calls, "expense_account_map").length, 0);

  const cleared = await withFetchMock([...base(), mapWrite("DELETE")], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "clear-expense-account", accountKey: "project_direct_cost" }));
    return { status: res.status, calls };
  });
  assertEquals(cleared.status, 200);
  assertEquals(restCall(cleared.calls, "expense_account_map", "DELETE")[0].url.searchParams.get("account_key"), "eq.project_direct_cost");
});
```

Verify RED (an unknown key is 400 today):
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/supabase/functions/external-set-company && deno test setup.test.ts --config deno.json --allow-env --allow-net --allow-read --filter "project_direct_cost"
```
Expected: 1 failed (`400` ≠ `200`).

### Task 7 — GREEN: the key  *(2 min)*

`pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.ts` — replace line 8 with (comment included):

```ts
/** OD-EXP-PB-1 (2026-10-23): `project_direct_cost` is the client's single direct-cost account, debited by an approval
 *  on a delivery project (FR-EXP-119). It passes the expense-type rule (root type Expense) — the fall-through below. */
export const EXPENSE_ACCOUNT_KEYS = ['employee_payable', 'employee_advance', 'project_direct_cost', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other'] as const;
```

Verify GREEN (unit + the whole setup Deno file):
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts
cd /Users/ariefsaid/Coding/PMO-wt-overhead/supabase/functions/external-set-company && deno test setup.test.ts --config deno.json --allow-env --allow-net --allow-read
```
Expected: all pass, including every existing AC-EXP-120/128 test.
**Expected red window until Task 16:** `npm run typecheck` (the label map in `ExpenseAccountMap.tsx` lacks the key)
and `pages/admin/ExpenseAccountMap.test.tsx` ("6 of 7" now reads "7 of 8"). Do not widen types or touch that test
here — Tasks 15–16 own both. Do not commit inside this window.

### Task 8 — RED: AC-EXP-117 the gate truth carries `project_is_internal`  *(3 min)*

In `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts`:
- in the fixture `t` (line 12) change `project_id: 'p1', currency: 'IDR', amount: '175.00',` to
  `project_id: 'p1', project_is_internal: false, currency: 'IDR', amount: '175.00',`
- in the `it.each([...])` table (lines 105-115) add two rows after `['a non-boolean approval flag', …],`:

```ts
    ['a missing internal-project flag', { ...t({}), project_is_internal: undefined }],
    ['a non-boolean internal-project flag', { ...t({}), project_is_internal: 'false' }],
```
- after the `'AC-EXP-117 accepts the gate\'s jsonb shape unchanged'` test add:

```ts
  it('AC-EXP-117 keeps the gate\'s project_is_internal verbatim (FR-EXP-119 reads it, never a default)', () => {
    expect(parseExpenseGateTruth(t({ project_is_internal: true })).project_is_internal).toBe(true);
    expect(parseExpenseGateTruth(t({ project_id: null, project_is_internal: false })).project_is_internal).toBe(false);
  });
```

Verify RED:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts
```
Expected: the round-trip test, the two new malformed rows and the new test fail.

### Task 9 — GREEN: type + parser  *(2 min)*

`pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.ts`:
- in `interface ExpenseGateTruth`, after `project_id: string | null;` add:

```ts
  /** 0354 (FR-EXP-119): the claim's project is an `Internal Project`, read by the gate at this attempt; false when
   *  the claim names no project. Decides direct-cost vs overhead — never sent by a client, never defaulted. */
  project_is_internal: boolean;
```
- in `parseExpenseGateTruth`, after `if (typeof d.approval_posting_exists !== 'boolean') bad('approval_posting_exists');` add:

```ts
  if (typeof d.project_is_internal !== 'boolean') bad('project_is_internal');
```
- in the returned object change
  `claimant_id: text('claimant_id'), project_id: textOrNull('project_id'), currency: text('currency'), amount, lines,`
  to
  `claimant_id: text('claimant_id'), project_id: textOrNull('project_id'), project_is_internal: d.project_is_internal as boolean, currency: text('currency'), amount, lines,`

Verify GREEN: the Task 8 command → all pass.

### Task 10 — sweep fixtures carry the field  *(3 min)*

`supabase/functions/erpnext-sweep/expensePostingBackstopLive.test.ts`:
- line 97 (`GATE_TRUTH`): `claim_number: 'EXP-1', claimant_id: 'u-claimant', project_id: null, currency: 'IDR', amount: '100.00', lines: [],`
  → `claim_number: 'EXP-1', claimant_id: 'u-claimant', project_id: null, project_is_internal: false, currency: 'IDR', amount: '100.00', lines: [],`
- line 246 (the `driveFresh` truth literal): the same replacement.

Verify — run once before the edit (RED: the parser now refuses `GATE_TRUTH` as malformed) and once after (GREEN),
then type-check the sweep entry point:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/supabase/functions/erpnext-sweep && deno test expensePostingBackstopLive.test.ts expensePostingBackstop.test.ts expenseResolveDepsLive.test.ts --config deno.json --allow-env --allow-net --allow-read && deno check index.ts --config deno.json
```
Expected after the edit: all pass; `deno check` clean.

### Task 11 — RED: AC-EXP-119 the resolver chooses by project  *(5 min)*

`pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts`:
- `ACCOUNTS` (lines 8-14): add a sixth entry
  `'Project Direct Cost - PSC': { name: 'Project Direct Cost - PSC', root_type: 'Expense', account_type: 'Cost of Goods Sold', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },`
- fixture `truth` (line 19): `claimant_id: 'user-e1', project_id: 'proj-1', currency: 'IDR', amount: '175.00',`
  → `claimant_id: 'user-e1', project_id: 'proj-1', project_is_internal: true, currency: 'IDR', amount: '175.00',`
  (every existing AC-EXP-115 case keeps its meaning: a linked project posting to the type accounts.)
- AC-EXP-115 refusal case (lines 55-56) — FR-EXP-106 amended, `project-unmapped` is now a **delivery** project's
  refusal; replace those two lines with:

```ts
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: false }), deps({
      readAccountMap: async () => ({ employee_payable: 'Employee Payable - PSC', project_direct_cost: 'Project Direct Cost - PSC' }),
      readBinding: async () => ({ company: 'PMO Smoke Co', cashAccount: 'Cash - PSC', costCenter: null, projectMap: {} }),
    }))).toMatchObject({ outcome: 'refuse', code: 'project-unmapped' });
```
- append a new `describe` at the end of the file:

```ts
describe('the debit account follows the project (AC-EXP-119, OD-EXP-PB-1 2026-10-23)', () => {
  const DIRECT = 'Project Direct Cost - PSC';
  const MAP_WITH_DIRECT = {
    employee_payable: 'Employee Payable - PSC', employee_advance: 'Employee Advances - PSC', project_direct_cost: DIRECT,
    Travel: 'Travel Expenses - PSC', Meals: 'Meals - PSC',
  };
  const withDirect = (over: Partial<ExpenseResolveDeps> = {}) => deps({ readAccountMap: async () => MAP_WITH_DIRECT, ...over });
  const unlinked: Partial<ExpenseResolveDeps> = {
    readBinding: async () => ({ company: 'PMO Smoke Co', cashAccount: 'Cash - PSC', costCenter: 'Main - PSC', projectMap: {} }),
  };

  it('AC-EXP-119 a delivery-project approval debits the direct-cost account for every type and keeps the ERP project', async () => {
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: false }), withDirect())).toEqual({ outcome: 'ready', refs: {
      company: 'PMO Smoke Co', employee: 'HR-EMP-00002', payableAccount: 'Employee Payable - PSC', advanceAccount: null,
      expenseAccounts: { Meals: DIRECT, Travel: DIRECT }, erpProject: 'PROJ-0001', costCenter: 'Main - PSC',
      cashAccount: 'Cash - PSC', approvalJournal: null } });
  });

  it('AC-EXP-119 with no direct-cost account mapped a delivery approval is refused unmapped before any ERP read — the type accounts never stand in', async () => {
    const d = deps(); // payable, advance, Travel, Meals mapped — no project_direct_cost
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: false }), d))
      .toMatchObject({ outcome: 'refuse', code: 'expense-account-unmapped', message: expect.stringMatching(/: project_direct_cost$/) });
    expect(d.calls).not.toContain('accounts');
    expect(d.calls).not.toContain('company');
  });

  it('AC-EXP-119 a linked Internal Project approval debits each type\'s own account and keeps the ERP project', async () => {
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: true }), withDirect())).toMatchObject({ outcome: 'ready', refs: {
      expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: 'PROJ-0001' } });
  });

  it('AC-EXP-119 an unlinked Internal Project posts as overhead with no project; an unlinked delivery project is still refused', async () => {
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: true }), withDirect(unlinked))).toMatchObject({ outcome: 'ready', refs: {
      expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: null } });
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: false }), withDirect(unlinked)))
      .toMatchObject({ outcome: 'refuse', code: 'project-unmapped' });
  });

  it('AC-EXP-119 an untagged approval is overhead with no project, even with the direct-cost account mapped', async () => {
    expect(await resolveExpensePosting(truth('approval', { project_id: null, project_is_internal: false }), withDirect())).toMatchObject({ outcome: 'ready', refs: {
      expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: null } });
  });

  it('AC-EXP-119 the direct-cost account is checked against ERPNext before posting', async () => {
    expect(await resolveExpensePosting(truth('approval', { project_is_internal: false }), deps({
      readAccountMap: async () => ({ ...MAP_WITH_DIRECT, project_direct_cost: 'Employee Payable - PSC' }),
    }))).toEqual({ outcome: 'refuse', code: 'expense-account-invalid', message: 'project_direct_cost: Employee Payable - PSC must be an Expense account' });
  });

  it('AC-EXP-119 a claim payment on a delivery project never needs the direct-cost account', async () => {
    expect(await resolveExpensePosting(truth('claim-payment', { project_is_internal: false, approval_posting_exists: false }), deps()))
      .toMatchObject({ outcome: 'ready', refs: { expenseAccounts: {}, payableAccount: 'Employee Payable - PSC' } });
  });
});
```

Verify RED:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts
```
Expected: four AC-EXP-119 tests fail — the delivery ready case (type accounts returned), the unmapped case (ready
instead of refuse), the unlinked Internal Project case (`project-unmapped` instead of ready), the invalid-account case
(ready instead of refuse). The untagged and claim-payment cases and every AC-EXP-115 case pass (they guard the
unchanged paths).

### Task 12 — GREEN: the rule  *(4 min)*

`pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.ts`:

1. Above `accountKeysFor` add:

```ts
/**
 * OD-EXP-PB-1 (owner 2026-10-07, confirmed 2026-10-23) — FR-EXP-119: an approval of a claim on a DELIVERY project (any
 * status but `Internal Project`) debits the single project direct-cost account; an Internal Project or untagged claim
 * debits the overhead account of each expense type. `project_is_internal` is the database gate's read of the project
 * row at this attempt (0354) — never a client value, never a frozen one.
 */
export function postsToProjectDirectCost(truth: ExpenseGateTruth): boolean {
  return truth.posting === 'approval' && truth.project_id !== null && !truth.project_is_internal;
}
```

2. In `accountKeysFor`, replace the `case 'approval':` return with:

```ts
    case 'approval':
      return postsToProjectDirectCost(truth)
        ? ['employee_payable', 'project_direct_cost']
        : ['employee_payable', ...Array.from(new Set(truth.lines.map((l) => l.expense_type as ExpenseAccountKey)))];
```

3. Replace the project block (lines 106-110) with:

```ts
  let erpProject: string | null = null;
  if (truth.posting === 'approval' && truth.project_id) {
    erpProject = binding.projectMap[truth.project_id] ?? null;
    // FR-EXP-120: an unlinked Internal Project posts as overhead with no project tag; an unlinked delivery project is
    // refused — its cost must not reach the direct-cost account without the project that carries it.
    if (!erpProject && !truth.project_is_internal) {
      return refuse('project-unmapped', 'the claim’s project is not linked to an ERPNext project');
    }
  }
```

4. Replace the two lines that build `expenseAccounts` (lines 136-137) with:

```ts
  const expenseAccounts: Record<string, string> = {};
  if (postsToProjectDirectCost(truth)) {
    // One debit row per expense type (the body builder keys rows by type), each on the direct-cost account.
    for (const line of truth.lines) expenseAccounts[line.expense_type] = map.project_direct_cost as string;
  } else {
    for (const key of keys) if (key !== 'employee_payable' && key !== 'employee_advance') expenseAccounts[key] = map[key] as string;
  }
```

5. File header, first line: `#775 phase B — FR-EXP-106/110/111: resolve every reference …` →
   `#775 phase B — FR-EXP-106/110/111/119/120: resolve every reference …`.

Verify GREEN:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts
cd /Users/ariefsaid/Coding/PMO-wt-overhead/supabase/functions/erpnext-sweep && deno test expensePostingBackstopLive.test.ts expensePostingBackstop.test.ts expenseResolveDepsLive.test.ts --config deno.json --allow-env --allow-net --allow-read && deno check index.ts --config deno.json
```
Expected: all pass.

### Task 13 — mutation check: the TypeScript half of the money rule  *(4 min)*

Run the Task 12 vitest command after each mutation; each **must go RED**; then restore the exact original text.
1. `postsToProjectDirectCost` body → `return false;` — RED: "a delivery-project approval debits the direct-cost
   account…" and "with no direct-cost account mapped…".
2. `!truth.project_is_internal` inside `postsToProjectDirectCost` → `true` — RED: "a linked Internal Project
   approval debits each type's own account…".
3. In the project block, `if (!erpProject && !truth.project_is_internal)` → `if (!erpProject)` — RED: "an unlinked
   Internal Project posts as overhead…".
4. In `parseExpenseGateTruth`, delete the `project_is_internal` boolean-check line — RED: AC-EXP-117
   "refuses a missing internal-project flag".
Restore all four; re-run → green. Paste the four RED summaries into the PR evidence.

### Task 14 — AC-EXP-111 title follows the amended wording  *(2 min)*

`pmo-portal/src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts` line 27: change the title
`'AC-EXP-111 overhead approval: no project key at all'` to
`'AC-EXP-111 a debit row with no ERP project (untagged, or an unlinked Internal Project) has no project key'`.
The test body does not change (the builder is unchanged, D4).

Verify:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts
```

### Task 15 — RED: AC-EXP-130 the setup screen shows and saves the eighth key  *(4 min)*

`pmo-portal/pages/admin/ExpenseAccountMap.test.tsx`:
- line 102: `'6 of 7 accounts are not mapped yet. A posting that needs an unmapped account stops until it is mapped.'`
  → `'7 of 8 accounts are not mapped yet. A posting that needs an unmapped account stops until it is mapped.'`
- line 103: `toHaveLength(6)` → `toHaveLength(7)`
- line 107: `const allKeys = ['employee_payable', 'employee_advance', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other'];`
  → `const allKeys = ['employee_payable', 'employee_advance', 'project_direct_cost', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other'];`
- append inside the `describe` (before its closing `});`):

```tsx
  it('AC-EXP-130 the project direct-cost account is an eighth row an Admin maps under its own key', async () => {
    h.binding = { status: 'active' };
    h.ownership = [{ externalTier: 'erpnext', domain: 'expenses' }];
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: 'Map Project direct cost' }));
    await user.type(await screen.findByRole('textbox'), '  Project Direct Cost - ABC ');
    await user.click(screen.getByRole('button', { name: /Save account|Simpan akun/ }));
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledWith({ accountKey: 'project_direct_cost', erpAccount: 'Project Direct Cost - ABC' }));
    expect(screen.getAllByTestId('expense-account-row')).toHaveLength(8);
  });
```

Verify RED:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/admin/ExpenseAccountMap.test.tsx
```
Expected: the new test fails — the eighth row has no label yet, so there is no "Map Project direct cost" button. The
three updated count lines pass (Task 7 already added the key).

### Task 16 — GREEN: label, comment, locales  *(3 min)*

`pmo-portal/pages/admin/ExpenseAccountMap.tsx`:
- header comment, line 27: `The 7 keys an expense posting needs.` →
  `The 8 keys an expense posting needs (OD-EXP-PB-1: a delivery-project claim posts to Project direct cost, other claims to their expense type).`
- in `label`, after the `employee_advance:` line add:

```tsx
    project_direct_cost: t('admin.expenseMap.key.projectDirectCost', 'Project direct cost'),
```

`pmo-portal/public/locales/en/common.json` — in `admin.expenseMap.key` (alphabetical), between `"other": "Other",` and
`"travel": "Travel"`, add `"projectDirectCost": "Project direct cost",`.
`pmo-portal/public/locales/id/common.json` — same place, between `"other": "Lainnya",` and `"travel": "Perjalanan"`,
add `"projectDirectCost": "Biaya langsung proyek",`.

Verify GREEN and the type window closed:
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/admin/ExpenseAccountMap.test.tsx src/lib/repositories/expensePostings.test.ts && npm run typecheck
```
Expected: all pass; `tsc --noEmit` zero errors. **Checkpoint commit** (Tasks 5–16).

### Task 17 — AC-EXP-140: the served journey asserts the direct-cost account  *(5 min)*

`pmo-portal/e2e/serial/_expHelpers.ts`:
- after `export const TRAVEL_ACCOUNT = 'Travel Expenses - PSC';` add:

```ts
/** The bench Standard-COA `Cost of Goods Sold` ledger (root Expense, a leaf) — the journey's project direct-cost
 *  account (OD-EXP-PB-1, FR-EXP-119). Already on the bench; nothing is created. */
export const DIRECT_COST_ACCOUNT = 'Cost of Goods Sold - PSC';
```
- in the `expense_account_map` insert array add a fourth row
  `{ org_id: ORG_ID, account_key: 'project_direct_cost', erp_account: DIRECT_COST_ACCOUNT },`
  (keep the Travel row — the journey proves a delivery project does NOT use it).

`pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts`:
- header line 2: `…exactly once, tagged to the project.` →
  `…exactly once, on the project direct-cost account and tagged to the project (OD-EXP-PB-1).`
- import line 7: `CASH_ACCOUNT, EMPLOYEE_ADVANCE, EMPLOYEE_PAYABLE, ENGINEER_EMAIL, FINANCE_EMAIL, PM_EMAIL, TRAVEL_ACCOUNT,`
  → `CASH_ACCOUNT, DIRECT_COST_ACCOUNT, EMPLOYEE_ADVANCE, EMPLOYEE_PAYABLE, ENGINEER_EMAIL, FINANCE_EMAIL, PM_EMAIL, TRAVEL_ACCOUNT,`
- test title line 46: `'AC-EXP-140 a claim settled against an advance posts once to ERPNext, tagged to the project'` →
  `'AC-EXP-140 a claim settled against an advance posts once to ERPNext, on the project direct-cost account, tagged to the project'`
- line 86 comment → `// ── the approval Journal Entry: keyed, the delivery project's cost on the direct-cost account with the project, Employee credit`
- line 93 → two lines:

```ts
  expect(approvalRows.find((r) => r.account === DIRECT_COST_ACCOUNT)).toMatchObject({ debit_in_account_currency: 150000, project: s.erpProject });
  expect(approvalRows.some((r) => r.account === TRAVEL_ACCOUNT), 'a delivery-project claim never debits the overhead Travel account').toBe(false);
```
- lines 119-121 →

```ts
  const { data: gl } = await admin.from('erp_gl_entry_mirror').select('account, project, debit')
    .eq('org_id', ORG_ID).eq('voucher_no', byPosting.approval).eq('account', DIRECT_COST_ACCOUNT).eq('is_cancelled', false);
  expect(gl, `second sweep tick: ${JSON.stringify(tick2.body)}`).toEqual([{ account: DIRECT_COST_ACCOUNT, project: s.erpProject, debit: 150000 }]);
```

Verify (served lane + bench; the branch adds a migration, so reset):
```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead && scripts/serve-functions.sh   # in its own terminal, per its header
cd /Users/ariefsaid/Coding/PMO-wt-overhead && scripts/e2e-local.sh --reset AC-EXP-140
```
Expected: `1 passed`. **A `skipped` result is not proof** (the spec skips when the served lane or the bench key is
absent). If it cannot run locally, run it on the PR with `scripts/ci-e2e.sh <branch>` (this PR closes a money piece,
so it qualifies under the v0.23 throughput rule) and attach that run.

### Task 18 — local final gate  *(5 min)*

```bash
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && npm run typecheck
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && npx eslint --max-warnings=0 src/lib/adapterSeam/erpnext/expenseAccountRules.ts src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts src/lib/adapterSeam/erpnext/expensePostingCommand.ts src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts src/lib/adapterSeam/erpnext/expensePostingResolve.ts src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts pages/admin/ExpenseAccountMap.tsx pages/admin/ExpenseAccountMap.test.tsx e2e/serial/_expHelpers.ts e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts
cd /Users/ariefsaid/Coding/PMO-wt-overhead/pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
cd /Users/ariefsaid/Coding/PMO-wt-overhead/supabase/functions/external-set-company && deno test --allow-all
cd /Users/ariefsaid/Coding/PMO-wt-overhead/supabase/functions/erpnext-sweep && deno test --allow-all
cd /Users/ariefsaid/Coding/PMO-wt-overhead && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0354_expense_direct_cost_account.test.sql supabase/tests/0270_expense_posting_gate.test.sql supabase/tests/0270_expense_postings_acl.test.sql supabase/tests/0270_expense_postings_enqueue.test.sql supabase/tests/0270_expense_advance_returns.test.sql'
cd /Users/ariefsaid/Coding/PMO-wt-overhead && (git log --format=%B origin/dev..HEAD | grep -qi co-authored && echo "STOP: attribution trailer") || echo "trailers clean"
```
Expected: zero type errors, zero lint warnings, every listed suite green, `trailers clean`. CI (`verify` + `pgtap`)
is the full-suite gate for the PR to `dev`.

## 4. Traceability (AC → owning layer → task)

| AC | Owning layer | Test file | Task(s) |
|---|---|---|---|
| AC-EXP-106 (new) | pgTAP | `supabase/tests/0354_expense_direct_cost_account.test.sql` | 1, 2, 3, 4 |
| AC-EXP-111 (wording) | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts` | 14 |
| AC-EXP-115 (amended line) | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts` | 11, 12 |
| AC-EXP-117 (amended) | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts` | 8, 9, 13 |
| AC-EXP-118 (amended) | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts` | 5, 7 |
| AC-EXP-119 (new) | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts` | 11, 12, 13 |
| AC-EXP-120 (amended) | Deno | `supabase/functions/external-set-company/setup.test.ts` | 6, 7 |
| AC-EXP-121 (FR-EXP-122's replay half — test unchanged; sibling Live fixtures gain the field) | Deno | `supabase/functions/erpnext-sweep/expensePostingBackstop.test.ts` | 10 |
| AC-EXP-130 (amended) | Unit (RTL) | `pmo-portal/pages/admin/ExpenseAccountMap.test.tsx` | 15, 16 |
| AC-EXP-140 (amended) | E2E (serial, served) | `pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` | 17 |

FR coverage: FR-EXP-119 → AC-EXP-106 (DB read) + AC-EXP-119 (choice) + AC-EXP-140 (cross-stack); FR-EXP-120 →
AC-EXP-119; FR-EXP-121 → AC-EXP-119 (refusal code) + the shipped AC-EXP-121 (a refusal is recorded `failed` with a
notice); FR-EXP-122 → AC-EXP-121 (replay without the gate) + FR-EXP-115's existing proofs (`pushed` never re-driven).

## 5. Rollout

Back to front, `dev` ceiling: migration 0354 → edge functions `erpnext-sweep` and `external-set-company` → FE. After
release, an Admin of an org that employs `expenses` maps **Project direct cost** in Administration › Accounting ›
Expense account map; until then each delivery-project approval raises one action-required notice and waits
(FR-EXP-121). Production remains a separate owner-gated step.
