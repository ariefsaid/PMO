-- 0193_work_orders.test.sql — DD-WO-1..6 / #498. Migration under test: 0193_work_orders.sql.
--
-- ── ORACLE DISCIPLINE (0171's rule, applied here) ────────────────────────────────────────────────
-- Every denial asserts the errcode AND the exact message. A bare throws_ok(sql,'42501',null) goes
-- green for the WRONG reason the moment another 42501 gate moves in front of the one under test —
-- which is precisely what happened to three AC-SAR-061 assertions when 0176 revoked a grant.
-- The two places a message is NOT asserted are marked inline with the reason (a PG-version-specific
-- not-null text, and a privilege denial whose text is the server's, not ours).
--
-- ── NO ASSERTION HERE MATCHES ON FUNCTION SOURCE TEXT ────────────────────────────────────────────
-- 0170 AC-PMS-021 proved nothing because it matched a `--` comment: the whole role gate could be
-- deleted and 62/62 stayed green. Every rule below is proven by a caller it must refuse or must
-- serve. The only catalog assertions are about PRIVILEGE and FUNCTION ATTRIBUTES (prosecdef,
-- proconfig, ACLs) — facts, not prose.
--
-- ── EVERY REVOKE IS PAIRED WITH A NO-OVER-BLOCKING CONTROL ──────────────────────────────────────
-- The SoD gates are asserted alongside the legitimate path they must still serve: a line manager's
-- ratification, an outranker's, a Finance issuer needing nobody, a zero-value work order, a Draft's
-- editable title, the drawdown that fits.
--
-- ── FIXTURE CAST ────────────────────────────────────────────────────────────────────────────────
--   MGR  (a1) Project Manager, active   — PM's LINE MANAGER (may_approve_work_of limb 1)
--   PM   (a2) Project Manager, active   — manager_id = MGR. The issuer in most cases.
--   PEER (a3) Project Manager, active   — neither manager nor outranker of PM (limb 1 and 2 both false)
--   FIN  (a4) Finance, active           — OUTRANKS PM (limb 2)
--   OFF  (a5) Finance, active -> disabled mid-test — HAD authority, is no longer employed
--   ENG  (a6) Engineer, active          — below every money threshold
--   XORG (b1) Admin in another org      — tenancy
begin;
create extension if not exists pgtap;
select plan(90);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- FIXTURES (owner inserts — bypass RLS, which is the point: they model server-side state)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('01930000-0000-0000-0000-000000000001','WO Org'),
  ('01930000-0000-0000-0000-000000000002','WO Other Org'),
  ('01930000-0000-0000-0000-000000000003','WO Flipped Org');

insert into auth.users (id, email) values
  ('01930000-0000-0000-0000-0000000000a1','wo-mgr@example.com'),
  ('01930000-0000-0000-0000-0000000000a2','wo-pm@example.com'),
  ('01930000-0000-0000-0000-0000000000a3','wo-peer@example.com'),
  ('01930000-0000-0000-0000-0000000000a4','wo-fin@example.com'),
  ('01930000-0000-0000-0000-0000000000a5','wo-off@example.com'),
  ('01930000-0000-0000-0000-0000000000a6','wo-eng@example.com'),
  ('01930000-0000-0000-0000-0000000000b1','wo-xorg@example.com'),
  ('01930000-0000-0000-0000-0000000000c9','wo-flip@example.com');

insert into profiles (id, org_id, full_name, email, role, status, manager_id) values
  ('01930000-0000-0000-0000-0000000000a1','01930000-0000-0000-0000-000000000001','WO Mgr','wo-mgr@example.com','Project Manager','active',null),
  ('01930000-0000-0000-0000-0000000000a2','01930000-0000-0000-0000-000000000001','WO PM','wo-pm@example.com','Project Manager','active','01930000-0000-0000-0000-0000000000a1'),
  ('01930000-0000-0000-0000-0000000000a3','01930000-0000-0000-0000-000000000001','WO Peer','wo-peer@example.com','Project Manager','active',null),
  ('01930000-0000-0000-0000-0000000000a4','01930000-0000-0000-0000-000000000001','WO Fin','wo-fin@example.com','Finance','active',null),
  ('01930000-0000-0000-0000-0000000000a5','01930000-0000-0000-0000-000000000001','WO Off','wo-off@example.com','Finance','active',null),
  ('01930000-0000-0000-0000-0000000000a6','01930000-0000-0000-0000-000000000001','WO Eng','wo-eng@example.com','Engineer','active',null),
  ('01930000-0000-0000-0000-0000000000b1','01930000-0000-0000-0000-000000000002','WO XOrg','wo-xorg@example.com','Admin','active',null),
  ('01930000-0000-0000-0000-0000000000c9','01930000-0000-0000-0000-000000000003','WO Flip','wo-flip@example.com','Admin','active',null);

-- P1 = the SoD playground (a generous ceiling so nothing here trips the drawdown gate).
-- P2 = the drawdown playground (ceiling exactly 1000.00).
-- P3 = a foreign-currency project, for the currency pin.
-- P9 = cross-org.
insert into projects (id, org_id, name, status, contract_value) values
  ('01930000-0000-0000-0000-0000000000c1','01930000-0000-0000-0000-000000000001','WO SoD Project','Ongoing Project',1000000),
  ('01930000-0000-0000-0000-0000000000c2','01930000-0000-0000-0000-000000000001','WO Ceiling Project','Ongoing Project',1000),
  ('01930000-0000-0000-0000-0000000000c3','01930000-0000-0000-0000-000000000001','WO Currency Project','Ongoing Project',5000),
  ('01930000-0000-0000-0000-0000000000c4','01930000-0000-0000-0000-000000000001','WO Ceiling Project 2','Ongoing Project',1000),
  ('01930000-0000-0000-0000-0000000000c8','01930000-0000-0000-0000-000000000003','WO Flip Project','Ongoing Project',5000),
  ('01930000-0000-0000-0000-0000000000c9','01930000-0000-0000-0000-000000000002','WO XOrg Project','Ongoing Project',5000);

insert into companies (id, org_id, name, type) values
  ('01930000-0000-0000-0000-0000000000f1','01930000-0000-0000-0000-000000000001','WO Client','Client');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — SHAPE. The DD-WO-1 ruling as schema facts, each one a thing a later migration could undo.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select col_not_null('work_orders','project_id',
  'AC-WO-001 work_orders.project_id is NOT NULL — a work order with no commitment has no ceiling to draw against (DD-WO-1, deliberately unlike tasks)');

select hasnt_column('work_orders','client_id',
  'AC-WO-002 there is no client_id — it is derived from projects.client_id, and a second copy would be a second answer (DD-WO-1)');

select col_hasnt_default('work_orders','tax_treatment',
  'AC-WO-003 tax_treatment has NO DEFAULT — a "plausible" default is exactly the silent-wrong-answer #478 exists to prevent (DD-CUR-3)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ⚑ Message deliberately NOT asserted: the not-null violation text is PG-version-specific. The
--   errcode plus the column-less omission is the whole content of the rule.
select throws_ok(
  $$ insert into work_orders (project_id, title, tax_amount)
       values ('01930000-0000-0000-0000-0000000000c1','No tax treatment', 0) $$,
  '23502', null,
  'AC-WO-003 …so omitting tax_treatment is a hard 23502, not a silent ''exclusive''');

select lives_ok(
  $$ insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-0000000000e1','01930000-0000-0000-0000-0000000000c1',
               'Stamping probe', 10, 'exclusive', 0) $$,
  'AC-WO-004 CONTROL a Project Manager may originate a Draft work order through the plain table path');

select is(
  (select org_id::text || '/' || currency from work_orders where id = '01930000-0000-0000-0000-0000000000e1'),
  '01930000-0000-0000-0000-000000000001/USD',
  'AC-WO-004 …and it is stamped with the caller''s REAL org and that org''s currency — work_orders_zz_stamp_currency fires AFTER work_orders_stamp_org_id (DD-CUR-2)');

select is(
  (select status::text from work_orders where id = '01930000-0000-0000-0000-0000000000e1'),
  'Draft',
  'AC-WO-004 …and it lands in the origination status');

reset role;

-- The currency pin. Today unreachable through any client path (both sides are stamped from the same
-- organizations.default_currency), which is why it is pinned BEFORE multi-currency arrives rather
-- than discovered later as a wrong figure on a screen.
update projects set currency = 'EUR' where id = '01930000-0000-0000-0000-0000000000c3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-0000000000c3','Currency mismatch','exclusive',0) $$,
  '23514',
  'work order currency USD does not match project currency EUR: a work order draws down against its project''s contract ceiling, so the two must be denominated alike',
  'AC-WO-005 a work order denominated differently from its project''s ceiling is refused — summing those rows would produce a silently meaningless drawdown');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — GRANT TOPOLOGY: the 0014 A2 mechanic. THE precise oracle for "set_work_order_value is the
--      SOLE writer of order_value" — a behavioural throws_ok can be satisfied by any gate, while
--      this asserts the exact privilege state the migration owns.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'work_orders'
      and grantee in ('authenticated','anon')
      and privilege_type in ('INSERT','UPDATE','DELETE')),
  0,
  'AC-WO-010 no client role holds a TABLE-level INSERT/UPDATE/DELETE on work_orders — which is WHY the column lists below are the whole surface (a column REVOKE against a table grant is a SILENT NO-OP)');

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'work_orders'
       and grantee = 'authenticated' and privilege_type = 'INSERT'),
  array['client_po_number','created_at','currency','description','end_date','id','order_date',
        'order_value','org_id','project_id','start_date','tax_amount','tax_rate','tax_template',
        'tax_treatment','title'],
  'AC-WO-011 the INSERT grant is exactly the BODY — status, wo_number and every witness/stamp column are withheld');

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'work_orders'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['client_po_number','description','end_date','order_date','start_date','tax_amount',
        'tax_rate','tax_template','tax_treatment','title'],
  'AC-WO-012 the UPDATE grant is the body list MINUS order_value (and minus status / currency / wo_number / every stamp) — that omission IS the SoD control');

select is(has_column_privilege('authenticated','public.work_orders','order_value','UPDATE'), false,
  'AC-WO-012 …stated directly: authenticated may NOT UPDATE order_value, so set_work_order_value is the only remaining writer');

select is(has_column_privilege('authenticated','public.work_orders','order_value','INSERT'), true,
  'AC-WO-012 CONTROL order_value IS insertable at origination — every legitimate create sends the client''s figure, and the witness trigger records who did');

select is(has_table_privilege('authenticated','public.work_orders','DELETE'), false,
  'AC-WO-013 there is no client DELETE grant: Cancelled IS the soft-delete, and a hard-deletable money document carrying a minted number is not a thing this schema owns');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'work_orders' and cmd = 'DELETE'),
  0,
  'AC-WO-013 …and no DELETE policy either, so the closure rests on two independent layers rather than on policy absence alone (the 0171 AC-SCC-082 lesson)');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'work_orders'
      and coalesce(qual,'') || coalesce(with_check,'') like '%is_active_member%'),
  3,
  'AC-WO-014 all three work_orders policies carry is_active_member() — 0063''s conjunction pass read pg_policies AT APPLY TIME, so a policy created after it carries the conjunct only if its own migration writes it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ update work_orders set title = 'Stamping probe (renamed)'
      where id = '01930000-0000-0000-0000-0000000000e1' $$,
  'AC-WO-015 CONTROL a Draft''s body IS editable through the plain table path — the lockdown is targeted, not a freeze on everything');

-- ⚑ Message NOT asserted: 'permission denied for table work_orders' is the server's text for a
--   privilege denial, not a rule of ours. The privilege assertions above are the real oracle; this
--   is the behavioural pair that proves they bind.
select throws_ok(
  $$ update work_orders set order_value = 999 where id = '01930000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'AC-WO-016 a direct UPDATE of order_value is denied at the PRIVILEGE check — the attacker never reaches a trigger');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — ORIGINATION GUARD. The grant layer above already denies these columns, so the guard's own
--      branches are only reachable once the columns are granted. Rather than lose the only proof
--      that the SECOND layer exists (and NAMES the offending column, which a 42501 never does), the
--      grant is issued INSIDE this transaction and revoked the moment the section ends — the same
--      device 0169 §B and ap_invoices_payments_offboarded_rls use, undone by the closing rollback.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
grant insert (status, wo_number, issued_by, issued_at,
              over_commit_ack_by, over_commit_ack_at, closed_at, cancelled_at)
  on public.work_orders to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, status)
       values ('01930000-0000-0000-0000-0000000000c1','Forged','exclusive',0,'Issued') $$,
  'P0001',
  'work_orders.status "Issued" is not the origination status: a work order is created as a Draft, and Issued / Closed / Cancelled are reached only through transition_work_order, whose issue gate enforces that the person who set the value is not the person issuing it',
  'AC-WO-020 THE EXPLOIT: a work order cannot be born already Issued — that would mint client revenue past the entire SoD');

select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, status)
       values ('01930000-0000-0000-0000-0000000000c1','Forged','exclusive',0,null) $$,
  'P0001',
  'work_orders.status "<NULL>" is not the origination status: a work order is created as a Draft, and Issued / Closed / Cancelled are reached only through transition_work_order, whose issue gate enforces that the person who set the value is not the person issuing it',
  'AC-WO-021 …and the guard is NULL-TOTAL: `status <> ''Draft''` is NULL for an explicit NULL and a NULL condition FALLS THROUGH (the defect 0176 §6 had to repair in four guards)');

select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, wo_number)
       values ('01930000-0000-0000-0000-0000000000c1','Forged','exclusive',0,'WO-000000') $$,
  'P0001',
  'work_orders.wo_number cannot be set when a work order is created: the document number is minted only by next_procurement_doc_number, called from transition_work_order at issue',
  'AC-WO-022 a client cannot choose its own document number');

select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, issued_at)
       values ('01930000-0000-0000-0000-0000000000c1','Forged','exclusive',0, timestamptz '2020-01-01 00:00:00Z') $$,
  'P0001',
  'work_orders.issued_by / issued_at cannot be set when a work order is created: the issue stamp is written only by transition_work_order, and it is what a later ERP push derives its idempotency key from',
  'AC-WO-023 a forged issue stamp is refused — it is the state stamp an ADR-0059 §4 key is derived from, and a wrong one makes a needed push SILENTLY SUPPRESSED (the OQ-BUD-2 failure, 0137)');

select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, over_commit_ack_by)
       values ('01930000-0000-0000-0000-0000000000c1','Forged','exclusive',0,'01930000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'work_orders.over_commit_ack_by / over_commit_ack_at cannot be set when a work order is created: the over-commitment acknowledgement is stamped only by transition_work_order, at the moment it is actually required',
  'AC-WO-024 an over-commitment acknowledgement cannot be pre-attached to a row, and certainly not in someone else''s name');

select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, cancelled_at)
       values ('01930000-0000-0000-0000-0000000000c1','Forged','exclusive',0, now()) $$,
  'P0001',
  'work_orders.closed_at / cancelled_at cannot be set when a work order is created: the terminal stamps are written only by transition_work_order',
  'AC-WO-025 the terminal stamps are refused too');

select lives_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount, status)
       values ('01930000-0000-0000-0000-0000000000c1','Explicit Draft','exclusive',0,'Draft') $$,
  'AC-WO-026 CONTROL naming the origination status EXPLICITLY still works — the guard refuses the wrong value, not the parameter');

reset role;
revoke insert (status, wo_number, issued_by, issued_at,
               over_commit_ack_by, over_commit_ack_at, closed_at, cancelled_at)
  on public.work_orders from authenticated;

select is(has_column_privilege('authenticated','public.work_orders','status','INSERT'), false,
  'AC-WO-027 …and the section''s temporary grant is gone again, so the assertions above proved the TRIGGER and not a privilege state this file created');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §D — THE ISSUE SoD. Each of the three recorded variants (witness = issuer, witness offboarded,
--      witness not senior) is proven by a caller it must refuse, and each refusal is paired with the
--      legitimate path it must still serve.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('01930000-0000-0000-0000-0000000000d1','01930000-0000-0000-0000-0000000000c1','Self-authored',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d2','01930000-0000-0000-0000-0000000000c1','Peer-authored',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d3','01930000-0000-0000-0000-0000000000c1','Manager-authored',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d4','01930000-0000-0000-0000-0000000000c1','Outranker-authored',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d5','01930000-0000-0000-0000-0000000000c1','Offboarded-authored',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d6','01930000-0000-0000-0000-0000000000c1','No witness at all',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d7','01930000-0000-0000-0000-0000000000c1','Unattributed witness',100,'exclusive',0),
  ('01930000-0000-0000-0000-0000000000d8','01930000-0000-0000-0000-0000000000c1','Zero value',0,'exclusive',0);

select is(
  (select order_value_set_by from work_orders where id = '01930000-0000-0000-0000-0000000000d1'),
  '01930000-0000-0000-0000-0000000000a2'::uuid,
  'AC-WO-030 the witness trigger records WHO set the value at origination — it is a witness, not an input, and it is what the issue gate reads');

-- (1) THE SELF-APPROVAL VARIANT (0181).
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d1','Issued') $$,
  '42501',
  'you set this work order''s value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it',
  'AC-WO-031 THE EXPLOIT: one person sets the value on a Draft and issues it alone — client revenue booked at a figure NOBODY ELSE EVER APPROVED. Refused.');
reset role;

-- (2) THE PEER VARIANT (ADR-0070: a second signature can no longer be the colleague at the next desk).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d2', 100) $$,
  'AC-WO-032 CONTROL a peer Project Manager MAY set a work order''s value — the gate is on issuing, not on authoring');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d2','Issued') $$,
  '42501',
  'this work order''s value was not set by anyone senior to you, so you cannot issue it: it must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it',
  'AC-WO-033 …but a PEER''s signature does not clear the issue: the question is not "may the issuer approve the author?" but "did someone with authority OVER THE ISSUER put their name on this number?"');
reset role;

-- (3) THE LEGITIMATE LINE-MANAGEMENT PATH — the control that proves the gate is not just a wall.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d3', 100) $$,
  'AC-WO-034 CONTROL the issuer''s LINE MANAGER sets the value…');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d3','Issued') $$,
  'AC-WO-034 …and the work order issues. Note the manager holds the SAME role — this limb is line management, not rank.');
reset role;

select ok(
  (select wo_number from work_orders where id = '01930000-0000-0000-0000-0000000000d3') like 'WO-%',
  'AC-WO-035 issuing MINTS the document number through the EXISTING next_procurement_doc_number(org,''WO'') — there is no second minter');

select is(
  (select issued_by::text || '/' || (issued_at is not null)::text || '/' || (over_commit_ack_by is null)::text
     from work_orders where id = '01930000-0000-0000-0000-0000000000d3'),
  '01930000-0000-0000-0000-0000000000a2/true/true',
  'AC-WO-035 …and stamps issued_by/issued_at, with NO over-commitment acknowledgement (this issue fits under the ceiling)');

select ok(
  exists (select 1 from audit_events
           where action = 'work_order.transition'
             and entity_id = '01930000-0000-0000-0000-0000000000d3'
             and detail ->> 'to' = 'Issued'
             and detail ->> 'order_value_set_by' = '01930000-0000-0000-0000-0000000000a1'),
  'AC-WO-036 the issue is on the audit trail and names the witness — the row answers "who priced this, and who turned it into revenue" in one read');

-- (4) THE OUTRANKER PATH (may_approve_work_of limb 2).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d4', 100) $$,
  'AC-WO-037 CONTROL Finance (who outranks a PM) sets the value…');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d4','Issued') $$,
  'AC-WO-037 …and the PM may issue — rank clears it with no line-management relationship at all');
reset role;

-- (5) THE OFFBOARDED-WITNESS VARIANT (0183). The setter HAD authority and is no longer employed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d5', 100) $$,
  'AC-WO-038 a Finance member sets the value while still active…');
reset role;
update profiles set status = 'disabled' where id = '01930000-0000-0000-0000-0000000000a5';
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d5','Issued') $$,
  '42501',
  'this work order''s value was set by someone who is no longer an active member of this organisation, so you cannot issue it: it must be re-set by your supervisor or by someone who outranks you who is currently active, through set_work_order_value (which records who set it) — or ask them to issue it',
  'AC-WO-039 …then is offboarded, and the SoD''s required second person can no longer be them. may_approve_work_of answers rank + line management ALONE and never asks whether the person is still employed.');
reset role;

-- (6) THE NULL-WITNESS SHAPES. ⚑ Both refuse, which is where this table DEPARTS from
--     transition_project: that one PERMITS a NULL set_by beside a non-NULL set_at (the server-side
--     authority shape, pinned by 0170 AC-PMS-019) because it had un-backfillable legacy rows and a
--     live importer. work_orders has neither, so an unattributed witness here would be a hole this
--     migration CREATED. DD-WO-3's "fail closed on NULL witness" is taken literally.
update work_orders set order_value_set_by = null, order_value_set_at = null
  where id = '01930000-0000-0000-0000-0000000000d6';
update work_orders set order_value_set_by = null
  where id = '01930000-0000-0000-0000-0000000000d7';
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d6','Issued') $$,
  '42501',
  'this work order''s value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it',
  'AC-WO-040 a work order that was never witnessed at all FAILS CLOSED');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d7','Issued') $$,
  '42501',
  'this work order''s value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it',
  'AC-WO-041 …and so does an UNATTRIBUTED witness (a stamp with no person behind it). ⚑ transition_project permits this shape; work_orders deliberately does not — changing it back must be a visible edit HERE.');

-- (7) NOTHING TO RATIFY, and (8) an issuer who is already the accountable party.
select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d8','Issued') $$,
  'AC-WO-042 CONTROL a ZERO-value work order issues with no second person — there is no money to ratify (the `coalesce(v_value,0) > 0` clause)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('01930000-0000-0000-0000-0000000000d9','01930000-0000-0000-0000-0000000000c1','Finance self-issued',100,'exclusive',0);
select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d9','Issued') $$,
  'AC-WO-043 CONTROL a FINANCE issuer needs nobody: holds_won_value_authority means they are already the accountable party (a rank threshold, never a role list — ADR-0070)');
reset role;

-- (9) The floor: below money authority, and offboarded.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d1', 50) $$,
  '42501',
  'not authorized to set the work order value',
  'AC-WO-044 an Engineer cannot author a work order''s value');
select throws_ok(
  $$ insert into work_orders (project_id, title, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-0000000000c1','Engineer origination','exclusive',0) $$,
  '42501', null,
  'AC-WO-045 …nor originate one at all (RLS: the write roles are Admin/Executive/Project Manager/Finance)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d1','Cancelled') $$,
  '42501',
  'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-WO-046 the OFFBOARDED account cannot transition a work order at all — auth_role() reads profiles.role with NO status filter, so without assert_is_active_member a disabled account still passes the role gate (probed live on projects at 0177)');
select throws_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d1', 50) $$,
  '42501',
  'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-WO-047 …and cannot author a value either');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §E — OVER-CEILING: ALLOWED, WARNED, ATTRIBUTED (DD-WO-2). Not a hard cap, because contract_value
--      is Exec/Finance-gated once a project is won — a cap would stop a PM RECORDING A REAL CLIENT
--      PO until someone a role away raised the ceiling.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
-- ⚑ TWO ceiling playgrounds on purpose. Once A+B have taken project c2 over its ceiling, EVERY
--   further issue there is an over-commitment — so the "there is nothing to acknowledge" case cannot
--   be probed on c2 at all. A first draft of this file asserted it there and the assertion passed for
--   the wrong reason (the ack was accepted because the issue really WAS over the ceiling), which also
--   silently shifted the drawdown figures §F asserts.
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('01930000-0000-0000-0000-000000000091','01930000-0000-0000-0000-0000000000c2','Ceiling A',600,'exclusive',0),
  ('01930000-0000-0000-0000-000000000092','01930000-0000-0000-0000-0000000000c2','Ceiling B',600,'exclusive',0),
  ('01930000-0000-0000-0000-000000000093','01930000-0000-0000-0000-0000000000c2','Ceiling C',100,'exclusive',0),
  ('01930000-0000-0000-0000-000000000094','01930000-0000-0000-0000-0000000000c2','Ceiling D',50,'exclusive',0),
  ('01930000-0000-0000-0000-000000000095','01930000-0000-0000-0000-0000000000c4','Fits E',100,'exclusive',0),
  ('01930000-0000-0000-0000-000000000096','01930000-0000-0000-0000-0000000000c4','Fits F',50,'exclusive',0);

select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000091','Issued') $$,
  'AC-WO-050 CONTROL the first 600 against a 1000 ceiling issues with no acknowledgement asked for');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000092','Issued') $$,
  'P0001',
  'issuing this work order would commit 1200.00 against a contract ceiling of 1000.00 (already committed: 600.00): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
  'AC-WO-051 the second 600 would take committed value past the ceiling and is refused WITHOUT an explicit acknowledgement — the refusal states all three figures');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000092','Issued', false) $$,
  'P0001',
  'issuing this work order would commit 1200.00 against a contract ceiling of 1000.00 (already committed: 600.00): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
  'AC-WO-052 …and an EXPLICIT false is refused identically. `is not true` covers both NULL and false; a `= false` test would have let the omitted parameter through');

select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000092','Issued', true) $$,
  'AC-WO-053 with the acknowledgement the over-commitment IS allowed — over-committing is a real business event, and blocking it would block recording reality');

select is(
  (select over_commit_ack_by::text || '/' || (over_commit_ack_at is not null)::text
     from work_orders where id = '01930000-0000-0000-0000-000000000092'),
  '01930000-0000-0000-0000-0000000000a4/true',
  'AC-WO-054 …and it is ATTRIBUTED. Without this stamp there is no record ANYWHERE of who chose to over-commit.');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000095','Issued', true) $$,
  'P0001',
  'there is no over-commitment to acknowledge: committing 100.00 leaves the contract ceiling of 1000.00 intact',
  'AC-WO-056 ⚑ the MIRROR of fail-closed: an acknowledgement with nothing to acknowledge is REFUSED, not accepted-and-ignored. If it were ignored a client could send it unconditionally and the stamp would stop meaning "a person saw an over-commitment and chose it".');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000096','Cancelled', true) $$,
  'P0001',
  'the over-commitment acknowledgement applies only to issuing a work order, not to a Cancelled transition',
  'AC-WO-057 …and it cannot be smuggled onto a transition it has no meaning for');
reset role;

-- ⚑ Asserted as the table OWNER, not inside the block above: `audit_events` is not client-readable,
--   so this `exists` would have been answered by RLS rather than by the audit write, and would have
--   failed for a reason that has nothing to do with the rule.
select ok(
  exists (select 1 from audit_events
           where action = 'work_order.transition'
             and entity_id = '01930000-0000-0000-0000-000000000092'
             and detail ->> 'over_commit_ack_by' = '01930000-0000-0000-0000-0000000000a4'
             and (detail ->> 'contract_ceiling')::numeric = 1000),
  'AC-WO-055 …and the audit row carries the ceiling and the acknowledger, so the decision is reconstructable later');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §F — THE DRAWDOWN: DERIVED, SECURITY INVOKER, Draft excluded (DD-WO-2).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_project_drawdown'),
  false,
  'AC-WO-060 get_project_drawdown is SECURITY INVOKER — copying get_project_budget (0005), which carries an explicit "do NOT add security definer" comment. As definer it would hand every authenticated caller every org''s committed revenue in one call.');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(
  (select committed::text || '/' || draft::text || '/' || ceiling::text || '/' || currency
     from get_project_drawdown('01930000-0000-0000-0000-0000000000c2')),
  '1200.00/150.00/1000.00/USD',
  'AC-WO-061 committed = Issued + Closed (600 + 600); the two still-Draft work orders (100 + 50) are reported SEPARATELY, or the PM''s headline number is polluted by drafts');

select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000093','Cancelled') $$,
  'AC-WO-062 CONTROL a Draft may be cancelled…');

select is(
  (select committed::text || '/' || draft::text
     from get_project_drawdown('01930000-0000-0000-0000-0000000000c2')),
  '1200.00/50.00',
  'AC-WO-062 …and a Cancelled work order counts towards NEITHER total');

select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000091','Closed') $$,
  'AC-WO-063 CONTROL an Issued work order may be closed…');

select is(
  (select committed::text from get_project_drawdown('01930000-0000-0000-0000-0000000000c2')),
  '1200.00',
  'AC-WO-063 …and Closed stays COMMITTED — the work was granted and delivered, so it has not stopped drawing down the ceiling');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from get_project_drawdown('01930000-0000-0000-0000-0000000000c2')),
  0,
  'AC-WO-064 a caller in ANOTHER org gets ZERO ROWS, never a fabricated zero — the invoker''s RLS on projects is what scopes it, with no org check written in the function at all');

select is(
  (select count(*)::int from work_orders where project_id = '01930000-0000-0000-0000-0000000000c2'),
  0,
  'AC-WO-065 …and cannot read the underlying rows either');
reset role;

select is(has_function_privilege('anon','public.get_project_drawdown(uuid)','EXECUTE'), false,
  'AC-WO-066 anon holds no EXECUTE on get_project_drawdown');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §G — THE POST-ISSUE FREEZE (DD-WO-5). If pushable content can move while `issued_at` stands still,
--      a re-push DERIVES AN IDENTICAL key, the outbox single-use constraint rejects it, and the write
--      is SILENTLY SUPPRESSED — leaving ERPNext holding the wrong figure with no error anywhere.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d3', 250) $$,
  '42501',
  'the value of a work order that is Issued can no longer be changed: `issued_at` is the stamp an ERPNext push derives its idempotency key from, so a changed value under an unchanged stamp would be silently discarded there — cancel this work order and issue a replacement',
  'AC-WO-070 THE OQ-BUD-2 CLASS, KILLED AT SOURCE: the SOLE writer of order_value refuses once the work order is Issued. An amended PO is Cancel + re-issue — which is how ERPNext amends too.');

select throws_ok(
  $$ update work_orders set title = 'renamed after issue' where id = '01930000-0000-0000-0000-0000000000d3' $$,
  '42501',
  'this work order is Issued and its content can no longer be changed: `issued_at` is the stamp an ERPNext push derives its idempotency key from, so an edit that leaves that stamp standing would be accepted here and SILENTLY DISCARDED there — cancel this work order and issue a replacement',
  'AC-WO-071 …and the freeze covers the WHOLE BODY, not only the value. Every frozen column is pushable content and each would break the stamp identically; freezing one and leaving the rest is the "closed one path, left the other open" shape behind SoD slices 2-6.');
reset role;

-- ⚑ THE REAL ORACLE FOR THE FREEZE. Run as the table OWNER, which is what a SECURITY DEFINER RPC runs
--   as: an `actor_bypasses_rls()` carve-out on this guard would have exempted exactly the writer the
--   freeze exists to stop, and every assertion above would still have passed.
select throws_ok(
  $$ update work_orders set order_value = 999 where id = '01930000-0000-0000-0000-0000000000d3' $$,
  '42501',
  'this work order is Issued and its content can no longer be changed: `issued_at` is the stamp an ERPNext push derives its idempotency key from, so an edit that leaves that stamp standing would be accepted here and SILENTLY DISCARDED there — cancel this work order and issue a replacement',
  'AC-WO-072 the freeze has NO server-authority exemption: even the table owner cannot rewrite an issued work order''s value. A future mirror writer needs a deliberate, test-visible carve-out here.');

select throws_ok(
  $$ update work_orders set project_id = '01930000-0000-0000-0000-0000000000c2' where id = '01930000-0000-0000-0000-0000000000d3' $$,
  '42501',
  'work_orders.project_id is immutable: a work order draws down against ONE project''s contract ceiling, and re-pointing it would move committed value between two projects with no record on either — cancel it and raise a new one',
  'AC-WO-073 project_id is immutable — re-pointing it would silently move committed value between two projects'' drawdowns');

select throws_ok(
  $$ update work_orders set wo_number = 'WO-999999' where id = '01930000-0000-0000-0000-0000000000d3' $$,
  '42501',
  'work_orders.wo_number is minted once and never changes',
  'AC-WO-074 the document number is mint-once — a re-mint is a second ERP document for one intent (ADR-0058''s whole invariant)');

select throws_ok(
  $$ update work_orders set org_id = '01930000-0000-0000-0000-000000000002' where id = '01930000-0000-0000-0000-0000000000d3' $$,
  '42501',
  'work_orders identity columns (id, org_id, created_at) are immutable',
  'AC-WO-075 a work order cannot be walked across the tenancy boundary');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §H — LIFECYCLE LEGALITY. Closed and Cancelled are TERMINAL, which is also what makes `issued_at` a
--      once-only stamp: there is no path back to Draft, so it can never be re-derived.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d1','Closed') $$,
  'P0001', 'illegal transition Draft -> Closed',
  'AC-WO-080 a Draft cannot skip straight to Closed');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d1','Draft') $$,
  'P0001', 'illegal transition Draft -> Draft',
  'AC-WO-081 a no-op transition is refused (it would re-stamp for nothing)');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000091','Cancelled') $$,
  'P0001', 'illegal transition Closed -> Cancelled',
  'AC-WO-082 Closed is TERMINAL');

select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-000000000093','Issued') $$,
  'P0001', 'illegal transition Cancelled -> Issued',
  'AC-WO-083 Cancelled is TERMINAL — a cancelled PO is not re-issued, a REPLACEMENT is raised, which is what gives the replacement its own issued_at');

select lives_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d9','Cancelled') $$,
  'AC-WO-084 CONTROL an Issued work order may be cancelled — that is the amendment path DD-WO-5 requires to exist');

select is(
  (select (cancelled_at is not null)::text from work_orders where id = '01930000-0000-0000-0000-0000000000d9'),
  'true',
  'AC-WO-084 …and the terminal stamp is written');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §I — TENANCY AND FUNCTION ACLs.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select transition_work_order('01930000-0000-0000-0000-0000000000d1','Cancelled') $$,
  '42501', 'not authorized',
  'AC-WO-090 the definer RPC re-asserts the org INTERNALLY — definer rights bypass RLS, so this is the only thing standing between an authenticated caller and another org''s work orders');

select throws_ok(
  $$ select set_work_order_value('01930000-0000-0000-0000-0000000000d1', 1) $$,
  '42501', 'not authorized',
  'AC-WO-091 …and so does the value setter');
reset role;

select is(has_function_privilege('anon','public.transition_work_order(uuid, public.work_order_status, boolean)','EXECUTE'), false,
  'AC-WO-092 anon holds no EXECUTE on transition_work_order');
select is(has_function_privilege('anon','public.set_work_order_value(uuid, numeric)','EXECUTE'), false,
  'AC-WO-093 anon holds no EXECUTE on set_work_order_value');

-- ⚑ THE PREMISE THIS SLICE RESTS ON. The minter is an internal-only helper: a direct PostgREST call
--   would let any authenticated user write an arbitrary org's per-day counter and pick an arbitrary
--   prefix. transition_work_order reaches it only because a SECURITY DEFINER function runs as the
--   function OWNER, who retains EXECUTE after the revoke.
select is(has_function_privilege('authenticated','public.next_procurement_doc_number(uuid, text)','EXECUTE'), false,
  'AC-WO-094 next_procurement_doc_number is STILL not client-callable — reusing it did not widen its surface by one grant');

select is(
  (select bool_and(p.prosecdef and 'search_path=public' = any(p.proconfig))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('transition_work_order','set_work_order_value')),
  true,
  'AC-WO-095 both write RPCs are SECURITY DEFINER with search_path pinned to public — unpinned, a caller-controlled search_path re-points every unqualified reference in the body');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §J — sales_invoices.work_order_id (DD-WO-4).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select col_is_null('sales_invoices','work_order_id',
  'AC-WO-100 sales_invoices.work_order_id is NULLABLE — FORCED, not preferred: this table doubles as the ERP mirror, and an ADOPTED ERPNext-originated invoice has no PMO work order, so NOT NULL would break adoption outright');

select is(has_column_privilege('authenticated','public.sales_invoices','work_order_id','INSERT'), true,
  'AC-WO-101 the native author MAY state it — sales_invoices'' INSERT grant is COLUMN-LEVEL (0176), so a new column is not insertable unless granted (the DD-CUR-4 inversion)');
select is(has_column_privilege('authenticated','public.sales_invoices','work_order_id','UPDATE'), false,
  'AC-WO-102 …and may never UPDATE it: authenticated holds no UPDATE on this table at all, and this column is not the exception that re-opens it');

select throws_ok(
  $$ insert into sales_invoices (org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-000000000001','01930000-0000-0000-0000-0000000000c2',
               '01930000-0000-0000-0000-0000000000d3','2026-08-20',10,'exclusive',0) $$,
  '42501',
  'the work order must be on the same project as the invoice',
  'AC-WO-103 an invoice cannot bill a work order belonging to a DIFFERENT project (precedent check_tasks_parent_same_project, 0140)');

select throws_ok(
  $$ insert into sales_invoices (org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-000000000001', null,
               '01930000-0000-0000-0000-0000000000d3','2026-08-20',10,'exclusive',0) $$,
  '42501',
  'the work order must be on the same project as the invoice',
  'AC-WO-104 …and the guard is TOTAL: a NULL invoice project_id naming a work order FAILS CLOSED rather than falling through');

select lives_ok(
  $$ insert into sales_invoices (id, org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-00000000e001','01930000-0000-0000-0000-000000000001',
               '01930000-0000-0000-0000-0000000000c1','01930000-0000-0000-0000-0000000000d3',
               '2026-08-20',10,'exclusive',0) $$,
  'AC-WO-105 CONTROL an invoice on the SAME project is accepted');

select lives_ok(
  $$ insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount)
       values ('01930000-0000-0000-0000-00000000e002','01930000-0000-0000-0000-000000000001',
               '01930000-0000-0000-0000-0000000000c1','2026-08-20',10,'exclusive',0) $$,
  'AC-WO-106 CONTROL and an invoice with NO work order is accepted — the adoption path the nullability exists for');

-- ⚑ THE MANDATORY PAIRED EDIT. `sales_invoices_native_mirror_guard` ENUMERATES its native fields, so
--   a column added later is simply absent from the list and stays USER-WRITABLE while the revenue it
--   describes is owned by ERPNext. That is exactly how `author_user_id` shipped unpinned (0124 after
--   0123's guard, closed by 0125). Run as the table OWNER so the column-grant layer cannot mask the
--   guard; the JWT claims are what the guard reads, and they say `authenticated`.
-- ⚑ The probe must CHANGE the column: the guard's test is `is distinct from`, so setting an
--   already-NULL column to NULL passes it without proving anything. A first draft did exactly that and
--   went green while the column was unpinned.
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount)
  values ('01930000-0000-0000-0000-00000000d0f1','01930000-0000-0000-0000-000000000003',
          '01930000-0000-0000-0000-0000000000c8','Flip-org work order',10,'exclusive',0);
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('01930000-0000-0000-0000-000000000003','erpnext','revenue');
insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount)
  values ('01930000-0000-0000-0000-00000000e003','01930000-0000-0000-0000-000000000003',
          '01930000-0000-0000-0000-0000000000c8','2026-08-20',10,'exclusive',0);
set local request.jwt.claims = '{"sub":"01930000-0000-0000-0000-0000000000c9","role":"authenticated"}';
select throws_ok(
  $$ update sales_invoices set work_order_id = '01930000-0000-0000-0000-00000000d0f1'
      where id = '01930000-0000-0000-0000-00000000e003' $$,
  '42501',
  'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-WO-107 sales_invoices_native_mirror_guard pins work_order_id while revenue is externally-owned — omitting it would have left the column user-writable on exactly the org where the money is not ours to describe');
reset request.jwt.claims;

select * from finish();
rollback;
