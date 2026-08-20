-- project_contract_value_tax.test.sql — 0197_project_contract_value_tax.sql (#513).
-- Owns AC-CVT-001..025; `grep -r AC-CVT-` finds exactly this file.
--
-- The defect this proves closed: `get_project_drawdown` summed `work_orders.order_value` — which
-- carries a tax_treatment — against a `contract_value` that carried none. The two sides could be
-- keyed differently and nothing said which.
--
-- ⛔ AND THE ERROR IS NOT ONE-DIRECTIONAL, which is why §C tests BOTH directions rather than one.
-- A tax-EXCLUSIVE work order under a tax-INCLUSIVE ceiling makes the drawdown look SMALLER than it
-- is, so the system UNDER-DETECTS the over-commitment it exists to detect — and DD-WO-2's whole
-- design is that over-commitment is ALLOWED but must be acknowledged by name. A control that
-- silently never fires is worse than one that fires wrongly: nobody is ever asked.
begin;
select plan(25);

insert into organizations (id, name, default_currency) values
  ('05130000-0000-0000-0000-000000000001','#513 Tax Org','IDR');
insert into auth.users (id, email) values
  ('05130000-0000-0000-0000-0000000000a1','cvt-exec@example.com'),
  ('05130000-0000-0000-0000-0000000000a2','cvt-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05130000-0000-0000-0000-0000000000a1','05130000-0000-0000-0000-000000000001',
   'CVT Exec','cvt-exec@example.com','Executive','active'),
  ('05130000-0000-0000-0000-0000000000a2','05130000-0000-0000-0000-000000000001',
   'CVT PM','cvt-pm@example.com','Project Manager','active');

-- ── §A — the constraint is tied to the VALUE, not to the row. ───────────────────────────────────
-- A project at 0 states nothing and claims nothing, so it owes no basis. This is the whole reason
-- the rule is a conditional CHECK rather than the flat NOT NULL its siblings use: attached to the
-- row it would have forced a tax answer onto 115 of 294 pgTAP fixtures, in suites about RLS,
-- timesheets and tenancy that have no interest in tax.
select lives_ok(
  $$ insert into projects (id, org_id, name, status)
     values ('05130000-0000-0000-0000-000000000f00','05130000-0000-0000-0000-000000000001',
             'CVT Zero-value project','Leads') $$,
  'AC-CVT-001 a project with no contract value needs no tax basis — the rule follows the FACT, not '
  'the row');

select throws_ok(
  $$ insert into projects (id, org_id, name, status, contract_value)
     values ('05130000-0000-0000-0000-000000000f09','05130000-0000-0000-0000-000000000001',
             'CVT Unstated','Leads', 1000) $$,
  '23514',
  null,
  'AC-CVT-002 …but a NON-ZERO contract value with no basis is refused outright');

select throws_ok(
  $$ update projects set contract_value = 5000
      where id = '05130000-0000-0000-0000-000000000f00' $$,
  '23514',
  null,
  'AC-CVT-003 and the same rule catches an UPDATE that gives a bare project a value — a constraint '
  'that only guarded INSERT would be a door left open');

select throws_ok(
  $$ insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount)
     values ('05130000-0000-0000-0000-000000000f08','05130000-0000-0000-0000-000000000001',
             'CVT Bad domain','Leads', 1000, 'unknown', 0) $$,
  '23514', null,
  'AC-CVT-004 no third "we do not know" state');

select throws_ok(
  $$ insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount)
     values ('05130000-0000-0000-0000-000000000f07','05130000-0000-0000-0000-000000000001',
             'CVT NaN','Leads', 1000, 'exclusive', 'NaN'::numeric) $$,
  '23514', null,
  'AC-CVT-005 tax_amount = NaN is refused — `>= 0` alone would let it through (0169''s lesson)');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name in ('tax_treatment','tax_amount','tax_rate','tax_template')
      and column_default is not null),
  0::bigint,
  'AC-CVT-006 none of the four columns carries a DEFAULT — an omitted basis must FAIL, never quietly '
  'become one of the two answers');

-- ── §B — grants. INSERT yes (origination states the basis with the value); UPDATE deliberately NOT:
--    contract_value has not been client-updatable since 0014, and the basis must not outflank it. ──
select is(
  (select bool_and(has_column_privilege('authenticated', 'public.projects', c, 'INSERT'))
     from unnest(array['tax_treatment','tax_amount','tax_rate','tax_template']) c),
  true,
  'AC-CVT-007 authenticated may INSERT all four columns — origination states the basis alongside the '
  'value it states');

select is(
  (select bool_or(has_column_privilege('authenticated', 'public.projects', c, 'UPDATE'))
     from unnest(array['tax_treatment','tax_amount','tax_rate','tax_template']) c),
  false,
  'AC-CVT-008 …and may UPDATE none of them: set_project_contract_value is contract_value''s sole '
  'writer since 0014, and a basis a client could re-key behind that RPC''s back would move the money '
  'without the witness the SoD depends on');

-- ── §C — THE DRAWDOWN, in BOTH directions. ──────────────────────────────────────────────────────
-- Ceiling: 11,100 INCLUSIVE of 1,100 tax  ⇒  net 10,000.
insert into projects (id, org_id, name, status, contract_value, currency, tax_treatment, tax_amount)
values ('05130000-0000-0000-0000-000000000fc1','05130000-0000-0000-0000-000000000001',
        'CVT Inclusive ceiling','Ongoing Project', 11100, 'IDR', 'inclusive', 1100);

-- Work order: 9,000 EXCLUSIVE of 990 tax  ⇒  net 9,000. Under the net ceiling; NOT under the raw
-- one if you compared 9,000 against 11,100 and called it 81% — which is the old arithmetic.
insert into work_orders (id, org_id, project_id, title, order_value, currency, tax_treatment, tax_amount, status)
values ('05130000-0000-0000-0000-000000000fa1','05130000-0000-0000-0000-000000000001',
        '05130000-0000-0000-0000-000000000fc1','WO exclusive', 9000, 'IDR', 'exclusive', 990, 'Issued');

select is(
  (select ceiling from get_project_drawdown('05130000-0000-0000-0000-000000000fc1')),
  10000::numeric,
  'AC-CVT-009 an INCLUSIVE ceiling is reported NET — 11,100 gross less 1,100 tax');

select is(
  (select committed from get_project_drawdown('05130000-0000-0000-0000-000000000fc1')),
  9000::numeric,
  'AC-CVT-010 an EXCLUSIVE work order is already net — 9,000 stands');

select is(
  (select basis from get_project_drawdown('05130000-0000-0000-0000-000000000fc1')),
  'net',
  'AC-CVT-011 the basis is RETURNED, not inferred — inferring it is the entire defect');

-- ⚑ THE UNDER-DETECTION ORACLE. Under the OLD arithmetic this pair compared 9,000 against 11,100 —
-- 81% of ceiling, comfortably inside, no acknowledgement demanded. Normalised, it is 9,000 of
-- 10,000: 90%. Add one more and the difference decides whether anyone is ever asked.
insert into work_orders (id, org_id, project_id, title, order_value, currency, tax_treatment, tax_amount, status)
values ('05130000-0000-0000-0000-000000000fa2','05130000-0000-0000-0000-000000000001',
        '05130000-0000-0000-0000-000000000fc1','WO second', 1500, 'IDR', 'exclusive', 165, 'Issued');

select is(
  (select committed > ceiling from get_project_drawdown('05130000-0000-0000-0000-000000000fc1')),
  true,
  'AC-CVT-012 10,500 net against a 10,000 net ceiling IS an over-commitment. Under the old raw '
  'comparison it was 10,500 against 11,100 — inside the ceiling, and NOBODY would have been asked');

-- The mirror direction: an INCLUSIVE work order under an EXCLUSIVE ceiling.
insert into projects (id, org_id, name, status, contract_value, currency, tax_treatment, tax_amount)
values ('05130000-0000-0000-0000-000000000fc2','05130000-0000-0000-0000-000000000001',
        'CVT Exclusive ceiling','Ongoing Project', 10000, 'IDR', 'exclusive', 1100);
insert into work_orders (id, org_id, project_id, title, order_value, currency, tax_treatment, tax_amount, status)
values ('05130000-0000-0000-0000-000000000fa3','05130000-0000-0000-0000-000000000001',
        '05130000-0000-0000-0000-000000000fc2','WO inclusive', 11100, 'IDR', 'inclusive', 1100, 'Issued');

select is(
  (select committed from get_project_drawdown('05130000-0000-0000-0000-000000000fc2')),
  10000::numeric,
  'AC-CVT-013 an INCLUSIVE work order is reported NET too — 11,100 gross less 1,100');

select is(
  (select committed > ceiling from get_project_drawdown('05130000-0000-0000-0000-000000000fc2')),
  false,
  'AC-CVT-014 …so it does NOT over-commit a 10,000 net ceiling. The raw comparison said 11,100 > '
  '10,000 and would have demanded an acknowledgement for an over-commitment that does not exist — '
  'the error runs BOTH ways, which is why both are pinned');

select is(
  (select draft from get_project_drawdown('05130000-0000-0000-0000-000000000fc1')),
  0::numeric,
  'AC-CVT-015 Draft work orders stay out of `committed` — 0193''s split is unchanged');

-- §E's fixture, built so the OLD and NEW arithmetics DISAGREE — which the first version of this
-- test did not do. ⚑ Recorded because the mutation battery is what caught it: de-normalising the
-- gate left the whole suite GREEN, because the original numbers over-committed under BOTH
-- comparisons. A test that passes whether or not the fix is present is not a test, and this is
-- exactly the class the repo keeps paying for.
--
--   ceiling  11,100 inclusive of 1,100  ⇒  net 10,000   (raw 11,100)
--   issued    9,500 exclusive           ⇒  net  9,500   (raw  9,500)
--   candidate   700 exclusive           ⇒  net 10,200 > 10,000  REFUSE
--                                          raw 10,200 < 11,100  would have gone straight through
insert into projects (id, org_id, name, status, contract_value, currency, tax_treatment, tax_amount)
values ('05130000-0000-0000-0000-000000000fc3','05130000-0000-0000-0000-000000000001',
        'CVT Gate project','Ongoing Project', 11100, 'IDR', 'inclusive', 1100);
insert into work_orders (id, org_id, project_id, title, order_value, currency, tax_treatment, tax_amount, status)
values ('05130000-0000-0000-0000-000000000fa5','05130000-0000-0000-0000-000000000001',
        '05130000-0000-0000-0000-000000000fc3','WO issued', 9500, 'IDR', 'exclusive', 0, 'Issued');
insert into work_orders (id, org_id, project_id, title, order_value, currency, tax_treatment, tax_amount, status,
                         order_value_set_by, order_value_set_at)
values ('05130000-0000-0000-0000-000000000fa4','05130000-0000-0000-0000-000000000001',
        '05130000-0000-0000-0000-000000000fc3','WO to issue', 700, 'IDR', 'exclusive', 0, 'Draft',
        '05130000-0000-0000-0000-0000000000a1', now());

-- ── §D — the RPC gate. ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05130000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select set_project_contract_value('05130000-0000-0000-0000-000000000fc1'::uuid, 20000::numeric) $$,
  'P0001',
  'a contract value must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the value already include the tax?) and p_tax_amount must be given (0 when there is no tax). Without it the drawdown compares this ceiling against work-order values on an unknown basis',
  'AC-CVT-016 the RPC refuses a value with no basis, and the message NAMES the omission — not a bare '
  '23514 from the constraint, which names a rule instead of the thing the caller must fix');

-- ── §E — THE CONTROL ITSELF, not just the figure on the screen. ─────────────────────────────────
-- `get_project_drawdown` is what a PM READS; `transition_work_order` is what actually REFUSES. If
-- only the first were normalised the two would disagree, and a screen showing 105% beside an issue
-- that goes through unchallenged is worse than either being wrong alone — neither is visibly at
-- fault. Both compute the same expression, and this is the assertion that says so.
--
-- The fixture is built to be over-committed ONLY under normalisation: 10,500 net against a 10,000
-- net ceiling, which the old raw comparison read as 10,500 against 11,100 — inside, no
-- acknowledgement demanded, nobody asked.
select throws_ok(
  $$ select transition_work_order('05130000-0000-0000-0000-000000000fa4'::uuid,
       'Issued'::work_order_status) $$,
  'P0001',
  'issuing this work order would commit 10200.00 against a contract ceiling of 10000.00 (already committed: 9500.00): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
  'AC-CVT-017 the over-commit gate REFUSES an issue that exceeds the ceiling ONLY once both sides '
  'are net — 10,200 of 10,000. The raw comparison read 10,200 of 11,100, let it through, and asked '
  'nobody (DD-WO-2). De-normalise the GATE alone and this is the assertion that goes red');

select lives_ok(
  $$ select transition_work_order('05130000-0000-0000-0000-000000000fa4'::uuid,
       'Issued'::work_order_status, true) $$,
  'AC-CVT-018 …and the explicit acknowledgement still lets it through — DD-WO-2 permits '
  'over-commitment, it just insists somebody owns the decision');

-- ⚑ THE POSITIVE PATH — the RPC must actually WRITE the basis, and nothing proved it did.
-- Every other assertion here passes `'exclusive', 0` into a fixture already inserted as
-- `'exclusive', 0`, so before and after were identical BY CONSTRUCTION: deleting the four tax
-- columns from §2's UPDATE left the whole suite green. Caught by the code-quality review, and it is
-- the same dead-oracle shape as §E's fixture. `…fc1` starts INCLUSIVE/1,100 and is restated
-- EXCLUSIVE/500, so both columns must move and the ceiling must move with them.
select lives_ok(
  $$ select set_project_contract_value('05130000-0000-0000-0000-000000000fc1'::uuid, 12000::numeric,
       p_tax_treatment => 'exclusive', p_tax_amount => 500) $$,
  'AC-CVT-019 CONTROL an Executive restates the value and its basis together');

select is(
  (select tax_treatment || ':' || tax_amount::text from projects
    where id = '05130000-0000-0000-0000-000000000fc1'),
  'exclusive:500.00',
  'AC-CVT-020 the RPC WROTE the basis — delete the tax columns from §2''s UPDATE and this is the '
  'one assertion that notices');

select is(
  (select ceiling from get_project_drawdown('05130000-0000-0000-0000-000000000fc1')),
  12000::numeric,
  'AC-CVT-021 …and the ceiling followed it: 12,000 exclusive is already net. Had the treatment stayed '
  'INCLUSIVE behind the new value, this would read 10,900 — plausible, wrong, and unrecoverable');

reset role;

-- ⚑ `tax_rate`/`tax_template` are PRESERVED on a set that does not mention them. Writing them
-- unconditionally would silently erase a recorded ERPNext template on the first value edit.
update projects set tax_rate = 11.000, tax_template = 'PPN 11% - RIS'
  where id = '05130000-0000-0000-0000-000000000fc1';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05130000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('05130000-0000-0000-0000-000000000fc1'::uuid, 13000::numeric,
       p_tax_treatment => 'exclusive', p_tax_amount => 600) $$,
  'AC-CVT-022 CONTROL a set that mentions no rate or template');
reset role;
select is(
  (select coalesce(tax_rate::text,'-') || ':' || coalesce(tax_template,'-') from projects
    where id = '05130000-0000-0000-0000-000000000fc1'),
  '11.000:PPN 11% - RIS',
  'AC-CVT-023 the rate and template SURVIVED — they are descriptive, no gate reads them, and '
  'clearing them on every value edit would erase a fact ERPNext still holds');

-- ⛔ §5's ATTACK, run as the attacker. A PM re-keys a DRAFT work order's tax basis after the
-- Executive set its value, zeroing the drawdown so the issue passes the over-commit gate with no
-- acknowledgement.
--
-- ⚑ A FRESH Draft row, and that detail is the test. The first version of this assertion reused
-- `…fa4`, which AC-CVT-018 had just ISSUED — so the post-issue content freeze raised 42501 whatever
-- the grants said, and re-granting the columns left the suite GREEN. The mutation battery caught it;
-- reading the assertion would not have. Third dead oracle of this shape in one session.
insert into work_orders (id, org_id, project_id, title, order_value, currency, tax_treatment, tax_amount, status)
values ('05130000-0000-0000-0000-000000000fa6','05130000-0000-0000-0000-000000000001',
        '05130000-0000-0000-0000-000000000fc3','WO still draft', 700, 'IDR', 'exclusive', 0, 'Draft');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05130000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update work_orders set tax_treatment = 'inclusive', tax_amount = 700
      where id = '05130000-0000-0000-0000-000000000fa6' $$,
  '42501',
  null,
  'AC-CVT-024 a client cannot re-key a work order''s tax basis directly — the basis travels with the '
  'value through set_work_order_value, or the over-commit control can be zeroed by a PATCH');

reset role;

-- ⚑ LAYER (b), tested on its own. §5 closes the attack twice: the grant (AC-CVT-024) and the
-- witness. This asserts the SECOND — that re-keying the basis by ANY route re-stamps the witness the
-- issue SoD asks about. It runs as the table OWNER precisely because that route bypasses the grant:
-- if a future migration re-grants the columns, or a definer writer reaches them, this is the layer
-- still standing. Narrow the trigger back to `order_value` alone and this goes red while
-- AC-CVT-024 stays green — which is what "a test per layer" means.
-- ⚑ The oracle is `order_value_set_BY`, not `_set_at`: `now()` is the TRANSACTION timestamp and is
-- constant inside a pgTAP test, so a `_set_at` comparison can never move and would be a third dead
-- assertion. The row was inserted by the owner (auth.uid() NULL); a claim is set so the trigger has
-- a different identity to stamp, without switching role — the grant is not what is under test here.
set local request.jwt.claims =
  '{"sub":"05130000-0000-0000-0000-0000000000a2","role":"authenticated"}';
update work_orders set tax_amount = 123
 where id = '05130000-0000-0000-0000-000000000fa6';
reset request.jwt.claims;
select is(
  (select order_value_set_by from work_orders
    where id = '05130000-0000-0000-0000-000000000fa6'),
  '05130000-0000-0000-0000-0000000000a2'::uuid,
  'AC-CVT-025 changing the tax basis RE-STAMPS the value witness — whoever last moved any part of '
  'the figure the drawdown computes from is the person the issue SoD asks about');

select * from finish();
rollback;
