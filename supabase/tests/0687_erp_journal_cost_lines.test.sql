-- 0687 (#1919): ERP journal cost lines on the project: list, attach (link only), detach, count once.
-- Owns AC-JEC-001..012. Money path: attach/detach move open commitment, never actuals.
begin;
select plan(62);

-- ids: org A 0687…0a, org B 0687…0b; profiles a1 Finance, a2 PM, a3 Engineer, a4 Admin, b1 Finance (org B)
insert into organizations (id, name, default_currency) values
  ('06870000-0000-0000-0000-00000000000a','JEC A','IDR'), ('06870000-0000-0000-0000-00000000000b','JEC B','IDR');
insert into auth.users (id, email) values
  ('06870000-0000-0000-0000-0000000000a1','jec-fin@example.com'), ('06870000-0000-0000-0000-0000000000a2','jec-pm@example.com'),
  ('06870000-0000-0000-0000-0000000000a3','jec-eng@example.com'), ('06870000-0000-0000-0000-0000000000a4','jec-admin@example.com'),
  ('06870000-0000-0000-0000-0000000000b1','jec-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06870000-0000-0000-0000-0000000000a1','06870000-0000-0000-0000-00000000000a','Fin','jec-fin@example.com','Finance','active'),
  ('06870000-0000-0000-0000-0000000000a2','06870000-0000-0000-0000-00000000000a','PM','jec-pm@example.com','Project Manager','active'),
  ('06870000-0000-0000-0000-0000000000a3','06870000-0000-0000-0000-00000000000a','Eng','jec-eng@example.com','Engineer','active'),
  ('06870000-0000-0000-0000-0000000000a4','06870000-0000-0000-0000-00000000000a','Admin','jec-admin@example.com','Admin','active'),
  ('06870000-0000-0000-0000-0000000000b1','06870000-0000-0000-0000-00000000000b','B Fin','jec-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('06870000-0000-0000-0000-0000000000d1','06870000-0000-0000-0000-00000000000a','JEC A1','Ongoing Project'),
  ('06870000-0000-0000-0000-0000000000d2','06870000-0000-0000-0000-00000000000a','JEC A2','Ongoing Project'),
  ('06870000-0000-0000-0000-0000000000d3','06870000-0000-0000-0000-00000000000b','JEC B1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('06870000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"06870000-0000-0000-0000-0000000000d1":"ERP-A1","06870000-0000-0000-0000-0000000000d2":"ERP-A2"}}'::jsonb, now(), 'active'),
  ('06870000-0000-0000-0000-00000000000b','erpnext','https://erp-b.example.test','test-ref-b',
   '{"company":"Other Co","project_map":{"06870000-0000-0000-0000-0000000000d3":"ERP-B1"}}'::jsonb, now(), 'active');
insert into budget_category_account_map (org_id, category, erp_account) values
  ('06870000-0000-0000-0000-00000000000a','Subcontractors','Project Subcontractors - X'),
  ('06870000-0000-0000-0000-00000000000a','Materials','Cost of Goods - X'),
  ('06870000-0000-0000-0000-00000000000b','Subcontractors','Project Subcontractors - X');

-- Ledger rows. JV-1 splits one bank payment across A1 (60) and A2 (120); JV-2 is two rows on one line (40+10);
-- JV-3 nets to a credit; JV-PMO is a journal PMO posted itself; JV-B is org B's.
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, remarks, erp_modified) values
  ('06870000-0000-0000-0000-00000000000a','g1a','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-1','2026-03-01',60,0,false,'Vendor Lab inv 7','2026-03-01'),
  ('06870000-0000-0000-0000-00000000000a','g1b','Example Co','Project Subcontractors - X','ERP-A2','Journal Entry','JV-1','2026-03-01',120,0,false,'Vendor Lab inv 7','2026-03-01'),
  ('06870000-0000-0000-0000-00000000000a','g1c','Example Co','Bank - X',null,'Journal Entry','JV-1','2026-03-01',0,180,false,'Vendor Lab inv 7','2026-03-01'),
  ('06870000-0000-0000-0000-00000000000a','g2a','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-2','2026-03-05',40,0,false,null,'2026-03-05'),
  ('06870000-0000-0000-0000-00000000000a','g2b','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-2','2026-03-05',10,0,false,null,'2026-03-05'),
  ('06870000-0000-0000-0000-00000000000a','g3a','Example Co','Cost of Goods - X','ERP-A1','Journal Entry','JV-3','2026-03-09',0,5,false,null,'2026-03-09'),
  ('06870000-0000-0000-0000-00000000000a','gp','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-PMO','2026-03-10',20,0,false,null,'2026-03-10'),
  ('06870000-0000-0000-0000-00000000000a','gu','Example Co','Cost of Goods - X','ERP-A1','Purchase Invoice','PINV-9','2026-03-11',77,0,false,null,'2026-03-11'),
  ('06870000-0000-0000-0000-00000000000b','gb','Other Co','Project Subcontractors - X','ERP-B1','Journal Entry','JV-B','2026-03-02',30,0,false,null,'2026-03-02');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('06870000-0000-0000-0000-000000000501','06870000-0000-0000-0000-00000000000a','claim','06870000-0000-0000-0000-0000000000a3','06870000-0000-0000-0000-0000000000d1','Trip',0,'Approved','EXP-2611050001','06870000-0000-0000-0000-0000000000a2','2026-11-05 02:00:00+00');
insert into expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, actor_id, erp_name) values
  ('06870000-0000-0000-0000-00000000000a','06870000-0000-0000-0000-000000000501','approval','06870000-0000-0000-0000-000000000501:approval','2026-11-05 02:00:00+00','06870000-0000-0000-0000-0000000000a2','JV-PMO');
-- The actuals snapshot the project reads (a separate job fills it from the rows above; a fixed value is enough to prove attach never touches it).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at) values
  ('06870000-0000-0000-0000-00000000000a','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','2026',110,now(),'06870000-0000-0000-0000-0000000000f1',now()),
  ('06870000-0000-0000-0000-00000000000a','06870000-0000-0000-0000-0000000000d2','Project Subcontractors - X','2026',120,now(),'06870000-0000-0000-0000-0000000000f1',now());

insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('06870000-0000-0000-0000-0000000000e1','06870000-0000-0000-0000-00000000000a','P1','06870000-0000-0000-0000-0000000000a2','06870000-0000-0000-0000-0000000000d1','IDR',100,'Ordered'),
  ('06870000-0000-0000-0000-0000000000e2','06870000-0000-0000-0000-00000000000a','P2','06870000-0000-0000-0000-0000000000a2','06870000-0000-0000-0000-0000000000d1','IDR',70,'Ordered'),
  ('06870000-0000-0000-0000-0000000000e3','06870000-0000-0000-0000-00000000000a','PX','06870000-0000-0000-0000-0000000000a2','06870000-0000-0000-0000-0000000000d1','IDR',10,'Cancelled'),
  ('06870000-0000-0000-0000-0000000000e4','06870000-0000-0000-0000-00000000000a','PU','06870000-0000-0000-0000-0000000000a2','06870000-0000-0000-0000-0000000000d1','USD',10,'Ordered'),
  ('06870000-0000-0000-0000-0000000000e5','06870000-0000-0000-0000-00000000000a','Q1','06870000-0000-0000-0000-0000000000a2','06870000-0000-0000-0000-0000000000d2','IDR',500,'Ordered'),
  ('06870000-0000-0000-0000-0000000000e6','06870000-0000-0000-0000-00000000000b','B purchase','06870000-0000-0000-0000-0000000000b1','06870000-0000-0000-0000-0000000000d3','IDR',90,'Ordered');

-- helpers: the numbers under test, read as Finance (the money-role audience)
create or replace function pg_temp.open_c(p uuid) returns numeric language sql as
  $$ select public.procurement_open_commitment(pr) from public.procurements pr where pr.id = p $$;
create or replace function pg_temp.committed(p uuid) returns numeric language sql as
  $$ select coalesce(sum(amount), 0) from public.project_committed_spend(p) where currency = 'IDR' $$;
create or replace function pg_temp.actuals(p uuid) returns numeric language sql as
  $$ select coalesce(sum(actuals_to_date), 0) from public.project_mapped_actuals(p) $$;
create or replace function pg_temp.attach(v text, proj text, acct text, proc text) returns jsonb language sql as
  $$ select public.attach_erp_journal_lines(jsonb_build_array(jsonb_build_object(
       'voucher_no', v, 'project_id', proj, 'account', acct, 'procurement_id', proc))) #> '{results,0}' $$;
grant execute on function pg_temp.open_c(uuid), pg_temp.committed(uuid), pg_temp.actuals(uuid), pg_temp.attach(text,text,text,text) to public;

set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-JEC-001 list
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1')), 3,
  'AC-JEC-001 A1 lists JV-1, JV-2, JV-3 (no purchase invoice, no PMO-posted journal)');
select is((select amount from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-2'), 50::numeric,
  'AC-JEC-001 two rows of one journal, project and account are one line of 50');
select is((select remarks from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-1'), 'Vendor Lab inv 7',
  'AC-JEC-001 the line carries the journal remark');
select is((select category::text from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-1'), 'Subcontractors',
  'AC-JEC-001 the line carries its budget category');
select ok((select erp_url from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-1') like '%/app/journal-entry/JV-1',
  'AC-JEC-001 the line links to the journal in the ERP');
select is((select currency from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-1'), 'IDR',
  'AC-JEC-001 the line carries the org currency');

-- AC-JEC-002 split journal
select is((select amount from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-1'), 60::numeric, 'AC-JEC-002 A1 sees only its 60');
select is((select amount from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d2') where voucher_no = 'JV-1'), 120::numeric, 'AC-JEC-002 A2 sees only its 120');
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d2')), 1, 'AC-JEC-002 A2 lists only its own line');

-- AC-JEC-003 PMO-posted journal
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-PMO'), 0,
  'AC-JEC-003 a journal PMO posted is not listed');
select is(pg_temp.attach('JV-PMO','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'reason',
  'journal_posted_by_pmo', 'AC-JEC-003 attaching it is refused');

-- AC-JEC-004 count once
select set_config('jec.a0', pg_temp.actuals('06870000-0000-0000-0000-0000000000d1')::text, true);
select set_config('jec.c0', pg_temp.open_c('06870000-0000-0000-0000-0000000000e1')::text, true);
select set_config('jec.s0', pg_temp.committed('06870000-0000-0000-0000-0000000000d1')::text, true);
select is(current_setting('jec.c0')::numeric, 100::numeric, 'AC-JEC-004 precondition: open commitment is the purchase total');
select is(pg_temp.attach('JV-1','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'outcome',
  'attach', 'AC-JEC-004 the line attaches');
select is(pg_temp.actuals('06870000-0000-0000-0000-0000000000d1'), current_setting('jec.a0')::numeric, 'AC-JEC-004 actuals are unchanged');
select is(pg_temp.open_c('06870000-0000-0000-0000-0000000000e1'), greatest(0, current_setting('jec.c0')::numeric - 60),
  'AC-JEC-004 open commitment drops by the line amount');
select is(pg_temp.committed('06870000-0000-0000-0000-0000000000d1'), current_setting('jec.s0')::numeric - 60,
  'AC-JEC-004 the project committed spend drops by exactly 60');
select is(public.procurement_ledger_held('06870000-0000-0000-0000-0000000000e1'), 60::numeric, 'AC-JEC-004 ledger-held counts the line');
select is((select held from public.procurement_ledger_held_many(array['06870000-0000-0000-0000-0000000000e1']::uuid[])), 60::numeric,
  'AC-JEC-004 the set-based ledger-held agrees');

-- AC-JEC-005 detach (Finance may)
select lives_ok($$select detach_erp_journal_line((select link_id from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-1'))$$,
  'AC-JEC-005 Finance detaches');
select is(pg_temp.open_c('06870000-0000-0000-0000-0000000000e1'), current_setting('jec.c0')::numeric, 'AC-JEC-005 open commitment returns');
select is(pg_temp.actuals('06870000-0000-0000-0000-0000000000d1'), current_setting('jec.a0')::numeric, 'AC-JEC-005 actuals are unchanged');

-- AC-JEC-006 one purchase per line
select pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1');
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e2') ->> 'reason',
  'line_attached_to_another_purchase', 'AC-JEC-006 a second purchase is refused');
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'reason',
  'already_attached', 'AC-JEC-006 the same purchase is a no-op');
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'outcome',
  'skip', 'AC-JEC-006 and reports skip');
reset role;
select is((select count(*)::int from erp_journal_line_links where voucher_no = 'JV-2'), 1, 'AC-JEC-006 exactly one link row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-JEC-007 split journal across projects
select set_config('jec.a2', pg_temp.actuals('06870000-0000-0000-0000-0000000000d2')::text, true);
select set_config('jec.s2', pg_temp.committed('06870000-0000-0000-0000-0000000000d2')::text, true);
select pg_temp.attach('JV-1','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1');
select is(pg_temp.committed('06870000-0000-0000-0000-0000000000d2'), current_setting('jec.s2')::numeric, 'AC-JEC-007 A2 committed spend is unchanged');
select is(pg_temp.actuals('06870000-0000-0000-0000-0000000000d2'), current_setting('jec.a2')::numeric, 'AC-JEC-007 A2 actuals are unchanged');
select is(pg_temp.attach('JV-1','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e5') ->> 'reason',
  'project_mismatch', 'AC-JEC-007 the A1 line cannot attach to an A2 purchase');

-- AC-JEC-008 the ERP cancels the journal
reset role;
select set_config('jec.h0', public.procurement_ledger_held('06870000-0000-0000-0000-0000000000e1')::text, true);
update erp_gl_entry_mirror set is_cancelled = true where voucher_no = 'JV-1';
select is(public.procurement_ledger_held('06870000-0000-0000-0000-0000000000e1'), current_setting('jec.h0')::numeric - 60,
  'AC-JEC-008 a cancelled journal holds nothing');
select is((select count(*)::int from erp_journal_line_links where voucher_no = 'JV-1'), 1, 'AC-JEC-008 the link stays');
update erp_gl_entry_mirror set is_cancelled = false where voucher_no = 'JV-1';

-- AC-JEC-009 refusals write nothing
select set_config('jec.links', (select count(*)::text from erp_journal_line_links), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.attach('JV-1','06870000-0000-0000-0000-0000000000d1','Cost of Goods - X','06870000-0000-0000-0000-0000000000e1') ->> 'reason',
  'line_not_found', 'AC-JEC-009 a line that does not exist is refused');
select is(pg_temp.attach('JV-3','06870000-0000-0000-0000-0000000000d1','Cost of Goods - X','06870000-0000-0000-0000-0000000000e1') ->> 'reason',
  'line_not_positive', 'AC-JEC-009 a non-positive line is refused');
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e3') ->> 'reason',
  'purchase_closed', 'AC-JEC-009 a Cancelled purchase is refused');
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e4') ->> 'reason',
  'currency_mismatch', 'AC-JEC-009 a purchase in another currency is refused');
reset role;
select is((select count(*)::text from erp_journal_line_links), current_setting('jec.links'), 'AC-JEC-009 nothing was written');

-- AC-JEC-010 dry run
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select detach_erp_journal_line((select link_id from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-2'));
reset role;
select set_config('jec.links', (select count(*)::text from erp_journal_line_links), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select array_agg(r ->> 'outcome' order by (r ->> 'row')::int) from jsonb_array_elements(attach_erp_journal_lines(
  '[{"voucher_no":"JV-2","project_id":"06870000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X","procurement_id":"06870000-0000-0000-0000-0000000000e1"},
    {"voucher_no":"JV-1","project_id":"06870000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X","procurement_id":"06870000-0000-0000-0000-0000000000e2"},
    {"voucher_no":"JV-404","project_id":"06870000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X","procurement_id":"06870000-0000-0000-0000-0000000000e1"}]'::jsonb,
  true) -> 'results') r), array['attach','refused','refused'], 'AC-JEC-010 dry run reports attach / refused / refused');
reset role;
select is((select count(*)::text from erp_journal_line_links), current_setting('jec.links'), 'AC-JEC-010 the dry run wrote no link');

-- AC-JEC-011 roles
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1')), 0, 'AC-JEC-011 an Engineer lists no journal lines');
select throws_ok($$select attach_erp_journal_lines('[{"voucher_no":"JV-2","project_id":"06870000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X","procurement_id":"06870000-0000-0000-0000-0000000000e1"}]'::jsonb)$$,
  '42501', null, 'AC-JEC-011 an Engineer cannot attach');
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'outcome',
  'attach', 'AC-JEC-011 a Project Manager attaches');
select throws_ok($$select detach_erp_journal_line((select link_id from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-2'))$$,
  '42501', null, 'AC-JEC-011 a Project Manager cannot detach');
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$select detach_erp_journal_line((select link_id from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1') where voucher_no = 'JV-2'))$$,
  'AC-JEC-011 an Admin detaches');

-- AC-JEC-012 other org
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1');
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1')), 0, 'AC-JEC-012 org B reads none of org A''s lines');
select is(pg_temp.attach('JV-2','06870000-0000-0000-0000-0000000000d1','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'reason',
  'line_not_found', 'AC-JEC-012 org A''s line is not found for org B');
select is(pg_temp.attach('JV-B','06870000-0000-0000-0000-0000000000d3','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e1') ->> 'reason',
  'purchase_not_found', 'AC-JEC-012 org A''s purchase is not found for org B');
select is((select count(*)::int from erp_journal_line_links), 0, 'AC-JEC-012 org B sees none of org A''s links');

-- I-A1 detach is org-scoped: org B's Finance cannot delete org A's link, and the link survives.
reset role;
select set_config('jec.l2', (select id::text from erp_journal_line_links where voucher_no = 'JV-2'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(format($$select detach_erp_journal_line(%L)$$, current_setting('jec.l2')), 'P0002', null,
  'AC-JEC-012 org B Finance cannot detach org A''s link');
reset role;
select is((select count(*)::int from erp_journal_line_links where id = current_setting('jec.l2')::uuid), 1,
  'AC-JEC-012 org A''s link survives the cross-org detach');

-- FR-JEC-015 audit: attach and detach each leave an event on the purchase.
select ok(exists (select 1 from audit_events where action = 'procurement.journal_attach' and entity_id = '06870000-0000-0000-0000-0000000000e1'
                     and actor_id = '06870000-0000-0000-0000-0000000000a1' and detail ->> 'voucher_no' = 'JV-1'),
  'FR-JEC-015 attach is audited');
select ok(exists (select 1 from audit_events where action = 'procurement.journal_detach' and entity_id = '06870000-0000-0000-0000-0000000000e1'
                     and actor_id = '06870000-0000-0000-0000-0000000000a4' and detail ->> 'voucher_no' = 'JV-2'),
  'FR-JEC-015 detach is audited');

-- FR-JEC-006 an org without an active ERP ledger lists nothing.
update external_org_bindings set status = 'disconnected' where org_id = '06870000-0000-0000-0000-00000000000a' and external_tier = 'erpnext';
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d1')), 0,
  'FR-JEC-006 no active ERP ledger: no journal lines');
reset role;
update external_org_bindings set status = 'active' where org_id = '06870000-0000-0000-0000-00000000000a' and external_tier = 'erpnext';

-- I-A3 a reversal is a new voucher with no link to the original in the mirror (GL rows carry no reversal reference),
-- so the original keeps its hold and is flagged possibly_reversed instead.
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select pg_temp.attach('JV-1','06870000-0000-0000-0000-0000000000d2','Project Subcontractors - X','06870000-0000-0000-0000-0000000000e5');
select is((select possibly_reversed from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d2') where voucher_no = 'JV-1'), false,
  'AC-JEC-018 before a reversal the attached line is not flagged');
reset role;
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('06870000-0000-0000-0000-00000000000a','grev','Example Co','Project Subcontractors - X','ERP-A2','Journal Entry','JV-REV','2026-03-20',0,120,false,'2026-03-20');
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select possibly_reversed from project_erp_journal_lines('06870000-0000-0000-0000-0000000000d2') where voucher_no = 'JV-1'), true,
  'AC-JEC-018 a later negative journal line on the same project and account flags the attached line');
select is(public.procurement_ledger_held('06870000-0000-0000-0000-0000000000e5'), 120::numeric,
  'AC-JEC-018 the hold is kept (no reliable reversal link); the flag is the signal');

-- #1507 S6-T4 AC-ODA-020: an Odoo org's `account.move` lines list through the project links; a PMO-posted bill or invoice is not a stray.
reset role;
insert into organizations (id, name, default_currency) values ('06870000-0000-0000-0000-0000000000a0','JEC Odoo','IDR');
insert into auth.users (id, email) values ('06870000-0000-0000-0000-0000000000a9','jec-odoo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06870000-0000-0000-0000-0000000000a9','06870000-0000-0000-0000-0000000000a0','O Fin','jec-odoo@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('06870000-0000-0000-0000-0000000000f1','06870000-0000-0000-0000-0000000000a0','JEC O1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('06870000-0000-0000-0000-0000000000a0','odoo','https://odoo.example.test/','fx-jec','{"ledger_basis_at":"2026-11-05T00:00:00Z"}'::jsonb, now(), 'active');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
  ('06870000-0000-0000-0000-0000000000a0','06870000-0000-0000-0000-0000000000f1','odoo','101');
insert into budget_category_account_map (org_id, category, erp_account) values ('06870000-0000-0000-0000-0000000000a0','Materials','5100');
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('06870000-0000-0000-0000-0000000000a0','odoo:1:101','5100','101','account.move','MISC/1','2026-03-01',80,0,false,'2026-03-01 00:00:00'),
  ('06870000-0000-0000-0000-0000000000a0','odoo:2:101','5100','101','account.move','BILL/9','2026-03-02',30,0,false,'2026-03-02 00:00:00'),
  ('06870000-0000-0000-0000-0000000000a0','odoo:3:101','5100','101','account.move','BILL/PMO','2026-03-03',20,0,false,'2026-03-03 00:00:00'),
  ('06870000-0000-0000-0000-0000000000a0','odoo:4:101','5100','101','account.move','INV/PMO','2026-03-04',10,0,false,'2026-03-04 00:00:00');
insert into erp_purchase_documents (org_id, erp_doctype, erp_name, erp_docstatus, erp_modified, external_ref, pmo_owned) values
  ('06870000-0000-0000-0000-0000000000a0','Purchase Invoice','BILL/9',1,'2026-03-02 00:00:00','account.move:90',false),
  ('06870000-0000-0000-0000-0000000000a0','Purchase Invoice','BILL/PMO',1,'2026-03-03 00:00:00','account.move:91',true);
insert into revenue_erp_mirror (org_id, erp_doctype, erp_name, external_ref, erp_status, erp_state, erp_docstatus, erp_modified, pmo_owned) values
  ('06870000-0000-0000-0000-0000000000a0','Sales Invoice','INV/PMO','account.move:92','Unpaid','posted',1,'2026-03-04 00:00:00',true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select is((select array_agg(voucher_no order by voucher_no) from project_erp_journal_lines('06870000-0000-0000-0000-0000000000f1')),
  array['BILL/9','MISC/1'], 'AC-ODA-020 the Odoo project lists its journal and its non-PMO bill, not the PMO-posted bill or invoice');
select is((select erp_doctype from project_erp_journal_lines('06870000-0000-0000-0000-0000000000f1') where voucher_no = 'MISC/1'), 'account.move',
  'AC-ODA-020 an Odoo line keeps its account.move type');
select is((select amount from project_erp_journal_lines('06870000-0000-0000-0000-0000000000f1') where voucher_no = 'MISC/1'), 80::numeric,
  'AC-ODA-020 the Odoo line carries the debit-credit amount');
select is((select erp_url from project_erp_journal_lines('06870000-0000-0000-0000-0000000000f1') where voucher_no = 'BILL/9'),
  'https://odoo.example.test/odoo/action-account.action_move_journal_line/90', 'AC-ODA-020 a move whose id is known links into Odoo');
select is((select erp_url from project_erp_journal_lines('06870000-0000-0000-0000-0000000000f1') where voucher_no = 'MISC/1'), null::text,
  'AC-ODA-020 a move whose id is unknown is plain text');
reset role;
update external_org_bindings set config = '{}'::jsonb where org_id = '06870000-0000-0000-0000-0000000000a0';
set local role authenticated;
set local request.jwt.claims = '{"sub":"06870000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select is((select count(*)::int from project_erp_journal_lines('06870000-0000-0000-0000-0000000000f1')), 0,
  'AC-ODA-020 an Odoo org that has not been switched has no journal list');
reset role;

-- Table privileges: link rows are written only through the definer RPCs.
select ok(not has_table_privilege('authenticated', 'public.erp_journal_line_links', 'insert')
      and not has_table_privilege('authenticated', 'public.erp_journal_line_links', 'update')
      and not has_table_privilege('authenticated', 'public.erp_journal_line_links', 'delete'),
  'AC-JEC-012 authenticated has no write grant on the link table');
select ok(not has_function_privilege('authenticated', 'public.erp_journal_cost_lines(uuid, uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.attach_erp_journal_lines(jsonb, boolean)', 'execute'),
  'AC-JEC-012 the internal line function and anon attach are not executable');

select * from finish();
rollback;
