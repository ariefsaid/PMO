-- spend_approval_enforce.test.sql — #803 transition_procurement enforces the route.
-- Orgs: A (configured), C (no config → flat), D (senior set configured, but its members are disabled or
-- demoted → only an Admin decides, DD-APR-4). DD-APR-3 (a budget changed under a request routes it to the
-- senior set) and DD-APR-5 (an untrustworthy amount routes to the senior set) on org A.
-- Migration: 0243_spend_approval_routing.sql §7.
begin;
select plan(29);

insert into organizations (id, name, default_currency) values
  ('02343000-0000-0000-0000-00000000000a','APR Enf Org A','IDR'),
  ('02343000-0000-0000-0000-00000000000c','APR Enf Org C','IDR'),
  ('02343000-0000-0000-0000-00000000000d','APR Enf Org D','IDR');
insert into auth.users (id, email) values
  ('02343000-0000-0000-0000-0000000000a0','apr-enf-admin@example.com'),
  ('02343000-0000-0000-0000-0000000000a1','apr-enf-pm-a@example.com'),
  ('02343000-0000-0000-0000-0000000000a2','apr-enf-pm-b@example.com'),
  ('02343000-0000-0000-0000-0000000000a3','apr-enf-fin-x@example.com'),
  ('02343000-0000-0000-0000-0000000000a4','apr-enf-exec-y@example.com'),
  ('02343000-0000-0000-0000-0000000000a5','apr-enf-fin-z@example.com'),
  ('02343000-0000-0000-0000-0000000000a6','apr-enf-eng-r@example.com'),
  ('02343000-0000-0000-0000-0000000000c1','apr-enf-pm-c@example.com'),
  ('02343000-0000-0000-0000-0000000000c2','apr-enf-eng-c@example.com'),
  ('02343000-0000-0000-0000-0000000000c3','apr-enf-eng-c2@example.com'),
  ('02343000-0000-0000-0000-0000000000d1','apr-enf-pm-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d2','apr-enf-fin-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d3','apr-enf-eng-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d0','apr-enf-admin-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d4','apr-enf-exec-d@example.com'),
  ('02343000-0000-0000-0000-0000000000d5','apr-enf-eng-d2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02343000-0000-0000-0000-0000000000a0','02343000-0000-0000-0000-00000000000a','Enf Admin','apr-enf-admin@example.com','Admin','active'),
  ('02343000-0000-0000-0000-0000000000a1','02343000-0000-0000-0000-00000000000a','Enf PM A','apr-enf-pm-a@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000a2','02343000-0000-0000-0000-00000000000a','Enf PM B','apr-enf-pm-b@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000a3','02343000-0000-0000-0000-00000000000a','Enf Fin X','apr-enf-fin-x@example.com','Finance','active'),
  ('02343000-0000-0000-0000-0000000000a4','02343000-0000-0000-0000-00000000000a','Enf Exec Y','apr-enf-exec-y@example.com','Executive','active'),
  ('02343000-0000-0000-0000-0000000000a5','02343000-0000-0000-0000-00000000000a','Enf Fin Z','apr-enf-fin-z@example.com','Finance','active'),
  ('02343000-0000-0000-0000-0000000000a6','02343000-0000-0000-0000-00000000000a','Enf Eng R','apr-enf-eng-r@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000c1','02343000-0000-0000-0000-00000000000c','Enf PM C','apr-enf-pm-c@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000c2','02343000-0000-0000-0000-00000000000c','Enf Eng C','apr-enf-eng-c@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000c3','02343000-0000-0000-0000-00000000000c','Enf Eng C2','apr-enf-eng-c2@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000d1','02343000-0000-0000-0000-00000000000d','Enf PM D','apr-enf-pm-d@example.com','Project Manager','active'),
  ('02343000-0000-0000-0000-0000000000d2','02343000-0000-0000-0000-00000000000d','Enf Fin D','apr-enf-fin-d@example.com','Finance','disabled'),
  ('02343000-0000-0000-0000-0000000000d3','02343000-0000-0000-0000-00000000000d','Enf Eng D','apr-enf-eng-d@example.com','Engineer','active'),
  ('02343000-0000-0000-0000-0000000000d0','02343000-0000-0000-0000-00000000000d','Enf Admin D','apr-enf-admin-d@example.com','Admin','active'),
  ('02343000-0000-0000-0000-0000000000d4','02343000-0000-0000-0000-00000000000d','Enf Exec D','apr-enf-exec-d@example.com','Executive','active'),
  ('02343000-0000-0000-0000-0000000000d5','02343000-0000-0000-0000-00000000000d','Enf Eng D2','apr-enf-eng-d2@example.com','Engineer','active');

insert into projects (id, org_id, name, status) values
  ('02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-00000000000a','Enf Project P','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-00000000000a','Enf Project Q','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000103','02343000-0000-0000-0000-00000000000c','Enf Project C','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000110','02343000-0000-0000-0000-00000000000a','Enf Project R','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000111','02343000-0000-0000-0000-00000000000a','Enf Project S','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000112','02343000-0000-0000-0000-00000000000a','Enf Project T','Ongoing Project'),
  ('02343000-0000-0000-0000-000000000113','02343000-0000-0000-0000-00000000000a','Enf Project U','Ongoing Project');
-- budget_line_items_draft_guard: lines only land on a Draft version, so seed Draft → lines → Active.
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02343000-0000-0000-0000-000000000201','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000101','v1',1,'Draft'),
  ('02343000-0000-0000-0000-000000000202','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000102','v1',1,'Draft'),
  ('02343000-0000-0000-0000-000000000210','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000110','v1',1,'Draft'),
  ('02343000-0000-0000-0000-000000000211','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000110','v2',2,'Draft'),
  ('02343000-0000-0000-0000-000000000212','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000111','v1',1,'Draft'),
  ('02343000-0000-0000-0000-000000000213','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000112','v1',1,'Draft'),
  ('02343000-0000-0000-0000-000000000214','02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000113','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000201','Materials',1000),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000202','Materials',1000),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000210','Materials', 100),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000211','Materials',1000),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000212','Materials',1000),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000213','Materials',1000),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000214','Materials',1000);
update budget_versions set status = 'Active' where id in ('02343000-0000-0000-0000-000000000201', '02343000-0000-0000-0000-000000000202',
  '02343000-0000-0000-0000-000000000210');

-- Org A: PM A approves for P and Q; senior set = Fin X + Exec Y. Org D: senior set = disabled Fin D.
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a',null,'02343000-0000-0000-0000-0000000000a3'),
  ('02343000-0000-0000-0000-00000000000a',null,'02343000-0000-0000-0000-0000000000a4'),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000110','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000111','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000112','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000113','02343000-0000-0000-0000-0000000000a1'),
  ('02343000-0000-0000-0000-00000000000d',null,'02343000-0000-0000-0000-0000000000d2'),
  ('02343000-0000-0000-0000-00000000000d',null,'02343000-0000-0000-0000-0000000000d5');

insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02343000-0000-0000-0000-000000000401','02343000-0000-0000-0000-00000000000a','E1 fits',      '02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a6','Requested',400,'Materials'),
  ('02343000-0000-0000-0000-000000000402','02343000-0000-0000-0000-00000000000a','E2 over',      '02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a6','Requested',700,'Materials'),
  ('02343000-0000-0000-0000-000000000403','02343000-0000-0000-0000-00000000000a','E3 overhead',  null,                                  '02343000-0000-0000-0000-0000000000a6','Requested', 50,null),
  ('02343000-0000-0000-0000-000000000404','02343000-0000-0000-0000-00000000000a','E4 by approver','02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a1','Requested', 10,'Materials'),
  ('02343000-0000-0000-0000-000000000405','02343000-0000-0000-0000-00000000000a','E5 reject',    '02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a6','Requested', 20,'Materials'),
  ('02343000-0000-0000-0000-000000000406','02343000-0000-0000-0000-00000000000a','E6 admin',     '02343000-0000-0000-0000-000000000102','02343000-0000-0000-0000-0000000000a6','Requested', 30,'Materials'),
  ('02343000-0000-0000-0000-000000000407','02343000-0000-0000-0000-00000000000c','EC1 flat',     '02343000-0000-0000-0000-000000000103','02343000-0000-0000-0000-0000000000c2','Requested', 10,'Materials'),
  ('02343000-0000-0000-0000-000000000408','02343000-0000-0000-0000-00000000000c','EC2 flat eng', '02343000-0000-0000-0000-000000000103','02343000-0000-0000-0000-0000000000c2','Requested', 10,'Materials'),
  ('02343000-0000-0000-0000-000000000409','02343000-0000-0000-0000-00000000000d','ED1 overhead', null,                                  '02343000-0000-0000-0000-0000000000d3','Requested',  5,null),
  ('02343000-0000-0000-0000-000000000410','02343000-0000-0000-0000-00000000000a','E7 budget raised','02343000-0000-0000-0000-000000000110','02343000-0000-0000-0000-0000000000a6','Requested',300,'Materials'),
  ('02343000-0000-0000-0000-000000000411','02343000-0000-0000-0000-00000000000a','E8 decider set', '02343000-0000-0000-0000-000000000111','02343000-0000-0000-0000-0000000000a6','Requested',100,'Materials'),
  ('02343000-0000-0000-0000-000000000412','02343000-0000-0000-0000-00000000000a','E9 set later',   '02343000-0000-0000-0000-000000000112','02343000-0000-0000-0000-0000000000a6','Requested',100,'Materials'),
  ('02343000-0000-0000-0000-000000000413','02343000-0000-0000-0000-00000000000a','E10 settled',    '02343000-0000-0000-0000-000000000113','02343000-0000-0000-0000-0000000000a6','Requested',100,'Materials');
-- DD-APR-3: E7–E10 were submitted yesterday.
insert into procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, created_at)
select id, '02343000-0000-0000-0000-00000000000a', 'Draft', 'Requested', '02343000-0000-0000-0000-0000000000a6', now() - interval '1 day'
  from procurements where id in ('02343000-0000-0000-0000-000000000410','02343000-0000-0000-0000-000000000411',
                                 '02343000-0000-0000-0000-000000000412','02343000-0000-0000-0000-000000000413');

-- DD-APR-5: a row that predates the non-negative rule (simulated by lifting it for this transaction).
alter table procurement_items drop constraint if exists procurement_items_quantity_nonneg;
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02343000-0000-0000-0000-000000000414','02343000-0000-0000-0000-00000000000a','E11 negative line','02343000-0000-0000-0000-000000000101','02343000-0000-0000-0000-0000000000a6','Requested',0,'Materials');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000414','Steel',  1, 900),
  ('02343000-0000-0000-0000-00000000000a','02343000-0000-0000-0000-000000000414','Credit',-1, 800);

set local role authenticated;

-- DD-APR-3 setup: PM A (the project approver) activates R's bigger v2 and S's v1; PM B activates T's and U's.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select activate_budget_version('02343000-0000-0000-0000-000000000211');
select activate_budget_version('02343000-0000-0000-0000-000000000212');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select activate_budget_version('02343000-0000-0000-0000-000000000213');
select activate_budget_version('02343000-0000-0000-0000-000000000214');
reset role;
-- S and U were activated two days ago — before their requests were submitted.
update budget_versions set activated_at = now() - interval '2 days'
 where id in ('02343000-0000-0000-0000-000000000212','02343000-0000-0000-0000-000000000214');
set local role authenticated;

-- E1 (400 of 1000, within) — PM B is not named; PM A is.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000401','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-APR-002: an approver-rank PM who is not named cannot approve a routed request');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000401','Approved') $$,
  'AC-APR-001: the named project approver approves a within-budget request');

-- E2 (700; 400 now Approved on the line → 1100 > 1000).
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000402','Approved') $$,
  '42501', 'approval routing: exceeds_line requires a named approver',
  'AC-APR-003: the project approver cannot approve spend that would exceed the line');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000402','Approved') $$,
  'AC-APR-003: a senior-set member approves the over-line request');

-- E3 overhead.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000403','Approved') $$,
  '42501', 'approval routing: no_project requires a named approver',
  'AC-APR-004: a Finance user outside the senior set cannot approve overhead');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000403','Approved') $$,
  'AC-APR-005: the second senior-set member alone approves overhead');

-- E4: the only project approver raised it → escalates to the senior set.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000404','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-APR-009: when the project approver is the requester, a non-senior Finance user cannot approve');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000404','Approved') $$,
  'AC-APR-009: the request escalates and a senior-set member approves');

-- E5: Reject follows the route.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000405','Rejected') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'AC-APR-013: a non-named PM cannot reject a routed request');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000405','Rejected') $$,
  'AC-APR-013: the named approver rejects');

-- E6: Admin break-glass.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a0","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000406','Approved') $$,
  'AC-APR-014: an Admin may still decide a routed request (OD-PROC-1 break-glass)');

-- Org C: nothing configured → flat matrix.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000407','Approved') $$,
  'AC-APR-008: with no configuration any PM approves (flat matrix)');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000c3","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000408','Approved') $$,
  '42501', 'not authorized for transition Requested -> Approved',
  'AC-APR-008: the role matrix still refuses an Engineer');

-- Org D (DD-APR-4): a senior set is configured but one member is disabled and the other demoted → Admin only.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select route from get_procurement_approval_routes(array['02343000-0000-0000-0000-000000000409']::uuid[])), 'admin',
  'AC-APR-010: a configured senior set with nobody eligible routes to an Admin');
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000409','Approved') $$,
  '42501', 'approval routing: no_project requires an Admin (no senior approver is eligible)',
  'AC-APR-010: with a configured senior set nobody can act on, a Project Manager cannot approve');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000d4","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000409','Approved') $$,
  '42501', 'approval routing: no_project requires an Admin (no senior approver is eligible)',
  'AC-APR-010: with a configured senior set nobody can act on, an Executive cannot approve either');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000d0","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000409','Approved') $$,
  'AC-APR-010: an Admin decides a request whose senior set nobody can act on');

-- DD-APR-3: a budget changed under a request does not route it to the person who changed it.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000410','Approved') $$,
  '42501', 'approval routing: budget_changed requires a named approver',
  'DD-APR-3: a project approver who activated a bigger budget after submission cannot approve against it');
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000411','Approved') $$,
  '42501', 'approval routing: budget_changed requires a named approver',
  'DD-APR-3: a project approver who activated the budget themselves cannot approve against it');
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000412','Approved') $$,
  '42501', 'approval routing: budget_changed requires a named approver',
  'DD-APR-3: a budget someone else activated after submission still routes to the senior set');
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000413','Approved') $$,
  'DD-APR-3: a budget someone else activated before submission routes normally');
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000410','Approved') $$,
  'DD-APR-3: a senior-set member decides a request whose budget changed under it');

-- DD-APR-5: an amount that cannot be trusted routes up.
set local request.jwt.claims = '{"sub":"02343000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02343000-0000-0000-0000-000000000414','Approved') $$,
  '42501', 'approval routing: amount_invalid requires a named approver',
  'DD-APR-5: the project approver cannot approve a request with a negative line');

reset role;

select is((select approved_by_id from procurements where id = '02343000-0000-0000-0000-000000000401'),
  '02343000-0000-0000-0000-0000000000a1'::uuid, 'AC-APR-001: approved_by_id is the named approver');
select is((select status::text from procurements where id = '02343000-0000-0000-0000-000000000403'), 'Approved',
  'AC-APR-005: one signature from the set is enough');
select is((select status::text from procurements where id = '02343000-0000-0000-0000-000000000405'), 'Rejected',
  'AC-APR-013: the rejection landed');
select is(
  (select detail - 'to' - 'break_glass' - 'budget_category' from audit_events
    where action = 'procurement.approval_route' and entity_id = '02343000-0000-0000-0000-000000000401'),
  '{"route":"project","reason":"within_budget","request_amount":400,"line_budget":1000,"line_used":0}'::jsonb,
  'AC-APR-015: the approval records its route, reason and the line figures');
select is(
  (select detail->>'break_glass' from audit_events
    where action = 'procurement.approval_route' and entity_id = '02343000-0000-0000-0000-000000000406'),
  'true', 'AC-APR-014: the Admin decision is marked break_glass in the audit');

select is(
  (select detail->>'route' || '/' || (detail->>'break_glass') from audit_events
    where action = 'procurement.approval_route' and entity_id = '02343000-0000-0000-0000-000000000409'),
  'admin/true', 'AC-APR-010: the Admin decision is recorded as break-glass on the admin route');

select * from finish();
rollback;
