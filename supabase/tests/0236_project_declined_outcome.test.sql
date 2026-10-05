-- 0236_project_declined_outcome.test.sql — #774
-- AC-DEC-001: 'Declined' is a legal terminal outcome from every pre-award stage, stamps decided_at,
--             is illegal from a won/on-hand stage, and may be revived to Negotiation (like Loss Tender).
-- AC-DEC-002: Declined is excluded from the win-rate denominators and reported as declined_count.
-- Isolated org; UUID prefix 02360000-…
begin;
select plan(13);

insert into organizations (id, name) values ('02360000-0000-0000-0000-000000000001', 'Declined Org (0236)');
insert into auth.users (id, email) values ('02360000-0000-0000-0000-0000000000a1', 'pm@declined0236.example');
insert into profiles (id, org_id, full_name, email, role) values
  ('02360000-0000-0000-0000-0000000000a1', '02360000-0000-0000-0000-000000000001',
   'PM 0236', 'pm@declined0236.example', 'Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id, contract_value, tax_treatment, tax_amount, decided_at) values
  ('02360000-0000-0000-0000-000000000101','02360000-0000-0000-0000-000000000001','D-LEADS','Leads','Leads','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000102','02360000-0000-0000-0000-000000000001','D-PQ','PQ','PQ Submitted','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000103','02360000-0000-0000-0000-000000000001','D-QUO','Quotation','Quotation Submitted','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000104','02360000-0000-0000-0000-000000000001','D-TEN','Tender','Tender Submitted','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000105','02360000-0000-0000-0000-000000000001','D-NEG','Negotiation','Negotiation','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000106','02360000-0000-0000-0000-000000000001','D-ONG','Ongoing','Ongoing Project','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000107','02360000-0000-0000-0000-000000000001','D-KOM','Won KoM','Won, Pending KoM','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  ('02360000-0000-0000-0000-000000000108','02360000-0000-0000-0000-000000000001','D-INT','Internal','Internal Project','02360000-0000-0000-0000-0000000000a1',0,'exclusive',0,null),
  -- win-rate fixture: 1 win (3M), 1 loss (1M), already-declined rows (must not move the ratios)
  ('02360000-0000-0000-0000-000000000201','02360000-0000-0000-0000-000000000001','W-WIN','Win','Ongoing Project','02360000-0000-0000-0000-0000000000a1',3000000,'exclusive',0,'2026-01-10T00:00:00Z'),
  ('02360000-0000-0000-0000-000000000202','02360000-0000-0000-0000-000000000001','W-LOSS','Loss','Loss Tender','02360000-0000-0000-0000-0000000000a1',1000000,'exclusive',0,'2026-01-11T00:00:00Z'),
  ('02360000-0000-0000-0000-000000000203','02360000-0000-0000-0000-000000000001','W-DEC1','Declined 1','Declined','02360000-0000-0000-0000-0000000000a1',5000000,'exclusive',0,'2026-01-12T00:00:00Z'),
  ('02360000-0000-0000-0000-000000000204','02360000-0000-0000-0000-000000000001','W-DEC2','Declined 2','Declined','02360000-0000-0000-0000-0000000000a1',7000000,'exclusive',0,'2026-01-13T00:00:00Z');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02360000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ select transition_project('02360000-0000-0000-0000-000000000101','Declined') $$,
  'AC-DEC-001: Leads -> Declined');
select lives_ok($$ select transition_project('02360000-0000-0000-0000-000000000102','Declined') $$,
  'AC-DEC-001: PQ Submitted -> Declined');
select lives_ok($$ select transition_project('02360000-0000-0000-0000-000000000103','Declined') $$,
  'AC-DEC-001: Quotation Submitted -> Declined');
select lives_ok($$ select transition_project('02360000-0000-0000-0000-000000000104','Declined') $$,
  'AC-DEC-001: Tender Submitted -> Declined');
select lives_ok($$ select transition_project('02360000-0000-0000-0000-000000000105','Declined') $$,
  'AC-DEC-001: Negotiation -> Declined');

select is(
  (select count(*) from projects where id between '02360000-0000-0000-0000-000000000101' and '02360000-0000-0000-0000-000000000105'
     and status = 'Declined' and decided_at is not null),
  5::bigint, 'AC-DEC-001: Declined stamps decided_at');

select throws_ok($$ select transition_project('02360000-0000-0000-0000-000000000106','Declined') $$,
  'P0001', null, 'AC-DEC-001: Declined is illegal from a won/on-hand stage');

select throws_ok($$ select transition_project('02360000-0000-0000-0000-000000000107','Declined') $$,
  'P0001', null, 'AC-DEC-001: Declined is illegal from Won, Pending KoM');

select throws_ok($$ select transition_project('02360000-0000-0000-0000-000000000108','Declined') $$,
  'P0001', null, 'AC-DEC-001: Declined is illegal from Internal Project');

select lives_ok($$ select transition_project('02360000-0000-0000-0000-000000000101','Negotiation') $$,
  'AC-DEC-001: Declined -> Negotiation (revive)');

select is(
  (get_win_rate('2026-01-01','2026-01-31') ->> 'declined_count')::int,
  2, 'AC-DEC-002: declined_count = 2 (the two Declined rows decided in the window)');

select is(
  (get_win_rate('2026-01-01','2026-01-31') ->> 'win_rate_count')::numeric,
  0.5::numeric, 'AC-DEC-002: win_rate_count stays 1/(1+1)=0.50 (Declined not in the denominator)');

select is(
  (get_win_rate('2026-01-01','2026-01-31') ->> 'win_rate_value')::numeric,
  0.75::numeric, 'AC-DEC-002: win_rate_value stays 3M/(3M+1M)=0.75 (Declined value not in the denominator)');

reset role;
select * from finish();
rollback;
