-- 0462_loss_breakdown.test.sql — #1577 S2
-- AC-LR-007 (ACLs), AC-LR-008 (oracle), AC-LR-009 (window = get_win_rate cohort), NFR-LR-002 (tenancy).
-- Isolated orgs; UUID prefix 04620000-…
-- Org A: clients C1 "Acme Client", C2 "Zeta Client". Projects (status / client / reason / decided_at):
--   W1 Ongoing Project C1 - 01-10; W2 Ongoing Project C1 - 02-05; L1 Loss C1 price 01-15; L2 Loss C2 price 02-10;
--   L3 Loss C2 competitor 02-12; D1 Declined C2 capacity 02-14; D2 Declined C1 price 03-01; L4 Loss C2 null undated.
-- Org B: one Loss Tender `price` 01-20.
begin;
select plan(9);

insert into organizations (id, name) values ('04620000-0000-0000-0000-000000000001', 'Loss Breakdown Org A (0462)'), ('04620000-0000-0000-0000-000000000002', 'Loss Breakdown Org B (0462)');
insert into auth.users (id, email) values ('04620000-0000-0000-0000-000000000161', 'pm-a@lossbreakdown0462.example'), ('04620000-0000-0000-0000-000000000177', 'pm-b@lossbreakdown0462.example');
insert into profiles (id, org_id, full_name, email, role) values
  ('04620000-0000-0000-0000-000000000161', '04620000-0000-0000-0000-000000000001', 'PM A 0462', 'pm-a@lossbreakdown0462.example', 'Project Manager'),
  ('04620000-0000-0000-0000-000000000177', '04620000-0000-0000-0000-000000000002', 'PM B 0462', 'pm-b@lossbreakdown0462.example', 'Project Manager');
insert into companies (id, org_id, name, type) values
  ('04620000-0000-0000-0000-000000000193', '04620000-0000-0000-0000-000000000001', 'Acme Client', 'Client'),
  ('04620000-0000-0000-0000-000000000194', '04620000-0000-0000-0000-000000000001', 'Zeta Client', 'Client'),
  ('04620000-0000-0000-0000-000000000203', '04620000-0000-0000-0000-000000000002', 'Other Org Client', 'Client');
insert into projects (id, org_id, code, name, status, project_manager_id, client_id, lost_reason, decided_at,
                      contract_value, tax_treatment, tax_amount) values
  ('04620000-0000-0000-0000-000000000101','04620000-0000-0000-0000-000000000001','W1','W1','Ongoing Project','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000193',null,'2026-01-10',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000102','04620000-0000-0000-0000-000000000001','W2','W2','Ongoing Project','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000193',null,'2026-02-05',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000103','04620000-0000-0000-0000-000000000001','L1','L1','Loss Tender','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000193','price','2026-01-15',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000104','04620000-0000-0000-0000-000000000001','L2','L2','Loss Tender','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000194','price','2026-02-10',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000105','04620000-0000-0000-0000-000000000001','L3','L3','Loss Tender','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000194','competitor','2026-02-12',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000106','04620000-0000-0000-0000-000000000001','D1','D1','Declined','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000194','capacity','2026-02-14',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000107','04620000-0000-0000-0000-000000000001','D2','D2','Declined','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000193','price','2026-03-01',0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000108','04620000-0000-0000-0000-000000000001','L4','L4','Loss Tender','04620000-0000-0000-0000-000000000161','04620000-0000-0000-0000-000000000194',null,null,0,'exclusive',0),
  ('04620000-0000-0000-0000-000000000201','04620000-0000-0000-0000-000000000002','LB','LB','Loss Tender','04620000-0000-0000-0000-000000000177','04620000-0000-0000-0000-000000000203','price','2026-01-20',0,'exclusive',0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"04620000-0000-0000-0000-000000000161","role":"authenticated"}';

-- AC-LR-008 oracle, all time: price 2 lost + 1 declined; ties by reason name; null (historic) is its own last row.
select is((get_loss_breakdown() -> 'by_reason')::jsonb,
  '[{"reason":"price","losses_count":2,"declined_count":1},
    {"reason":"capacity","losses_count":0,"declined_count":1},
    {"reason":"competitor","losses_count":1,"declined_count":0},
    {"reason":null,"losses_count":1,"declined_count":0}]'::jsonb,
  'AC-LR-008: all-time by_reason matches the oracle');

-- AC-LR-008 the other org's deal is absent: 6 lost/declined deals in org A, not 7.
select is((select sum((r ->> 'losses_count')::int + (r ->> 'declined_count')::int)::int
             from json_array_elements(get_loss_breakdown() -> 'by_reason') r),
  6, 'AC-LR-008: org B''s deal is absent from the all-time counts');

-- AC-LR-008 by_client: Declined excluded from client losses; tie broken by name.
select is((get_loss_breakdown() -> 'by_client')::jsonb,
  '[{"client_id":"04620000-0000-0000-0000-000000000193","client_name":"Acme Client","wins_count":2,"losses_count":1},
    {"client_id":"04620000-0000-0000-0000-000000000194","client_name":"Zeta Client","wins_count":0,"losses_count":3}]'::jsonb,
  'AC-LR-008: all-time by_client ranks and counts match the oracle (Declined excluded)');

-- AC-LR-009 window 2026-02: L1/D2 outside, L4 undated excluded.
select is((get_loss_breakdown('2026-02-01','2026-02-28') -> 'by_reason')::jsonb,
  '[{"reason":"capacity","losses_count":0,"declined_count":1},
    {"reason":"competitor","losses_count":1,"declined_count":0},
    {"reason":"price","losses_count":1,"declined_count":0}]'::jsonb,
  'AC-LR-009: windowed by_reason excludes outside-window and undated deals');
select is((get_loss_breakdown('2026-02-01','2026-02-28') -> 'by_client')::jsonb,
  '[{"client_id":"04620000-0000-0000-0000-000000000194","client_name":"Zeta Client","wins_count":0,"losses_count":2},
    {"client_id":"04620000-0000-0000-0000-000000000193","client_name":"Acme Client","wins_count":1,"losses_count":0}]'::jsonb,
  'AC-LR-009: windowed by_client matches the oracle');
select is((select sum((r ->> 'losses_count')::int + (r ->> 'declined_count')::int)::int
             from json_array_elements(get_loss_breakdown('2026-02-01','2026-02-28') -> 'by_reason') r),
  (select (w ->> 'losses_count')::int + (w ->> 'declined_count')::int from get_win_rate('2026-02-01','2026-02-28') w),
  'AC-LR-009: by_reason total equals get_win_rate losses + declined for the same window');

-- AC-LR-007 ACLs
select ok(not has_function_privilege('anon', 'public.get_loss_breakdown(date,date)', 'execute'),
  'AC-LR-007: anon cannot execute get_loss_breakdown');
select ok(has_function_privilege('authenticated', 'public.get_loss_breakdown(date,date)', 'execute'),
  'AC-LR-007: authenticated can execute get_loss_breakdown');

-- NFR-LR-002 tenancy: an org B user sees only org B's row.
set local request.jwt.claims = '{"sub":"04620000-0000-0000-0000-000000000177","role":"authenticated"}';
select is(get_loss_breakdown()::jsonb,
  '{"by_reason":[{"reason":"price","losses_count":1,"declined_count":0}],
    "by_client":[{"client_id":"04620000-0000-0000-0000-000000000203","client_name":"Other Org Client","wins_count":0,"losses_count":1}]}'::jsonb,
  'NFR-LR-002: org B sees only its own deal');

reset role;
select * from finish();
rollback;
