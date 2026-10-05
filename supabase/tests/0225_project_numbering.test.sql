-- 0231_project_numbering.test.sql — project numbering contract (#771, OD-ID-1).
-- Canonical pgTAP owner: AC-CODE-001 (configuration) + database allocation invariants for AC-CODE-002.
begin;
select plan(36);

insert into organizations (id, name, default_timezone) values
  ('00771000-0000-0000-0000-000000000001', 'Numbering Org A', 'Asia/Jakarta'),
  ('00771000-0000-0000-0000-000000000002', 'Numbering Org B', 'UTC');
insert into auth.users (id, email) values
  ('00771000-0000-0000-0000-0000000000a1', 'numbering-admin@example.com'),
  ('00771000-0000-0000-0000-0000000000b1', 'numbering-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00771000-0000-0000-0000-0000000000a1', '00771000-0000-0000-0000-000000000001', 'Numbering Admin', 'numbering-admin@example.com', 'Admin', 'active'),
  ('00771000-0000-0000-0000-0000000000b1', '00771000-0000-0000-0000-000000000001', 'Numbering PM', 'numbering-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('00771000-0000-0000-0000-000000000011', '00771000-0000-0000-0000-000000000001', 'Segment Client', 'Client'),
  ('00771000-0000-0000-0000-000000000012', '00771000-0000-0000-0000-000000000001', 'No Segment Client', 'Client'),
  ('00771000-0000-0000-0000-000000000021', '00771000-0000-0000-0000-000000000002', 'Other Tenant Client', 'Client');

select has_column('public', 'organizations', 'project_number_pattern', 'AC-CODE-001 organization pattern is stored separately');
select has_column('public', 'companies', 'client_number_segment', 'AC-CODE-001 client segment is a company-local field');
select has_column('public', 'projects', 'pmo_project_number', 'AC-CODE-002 PMO number is distinct from Client Project Code');
select has_table('public', 'project_number_counters', 'NFR-PNO-001 yearly allocation counter exists');
select ok(
  has_column_privilege('authenticated', 'public.organizations', 'project_number_pattern', 'UPDATE'),
  'AC-CODE-001 project-number pattern receives its column-scoped UPDATE grant'
);
select ok(
  has_column_privilege('authenticated', 'public.organizations', 'default_tax_treatment', 'UPDATE'),
  'AC-CODE-001 existing organization tax-default UPDATE grant is preserved'
);
select ok(
  not has_table_privilege('authenticated', 'public.organizations', 'UPDATE'),
  'AC-CODE-001 project-number settings do not widen UPDATE to the organizations table'
);
select ok(
  has_column_privilege('authenticated', 'public.projects', 'pmo_project_number', 'INSERT')
  and not has_column_privilege('authenticated', 'public.projects', 'pmo_project_number', 'UPDATE'),
  'AC-CODE-002 PMO number is insertable but not updateable by authenticated users'
);
select ok(
  not has_table_privilege('authenticated', 'public.projects', 'INSERT'),
  'AC-CODE-002 project numbering does not widen INSERT to the whole projects table'
);
select ok(
  has_column_privilege('authenticated', 'public.projects', 'code', 'INSERT')
  and has_column_privilege('authenticated', 'public.projects', 'end_client_id', 'INSERT')
  and has_column_privilege('authenticated', 'public.projects', 'currency', 'INSERT')
  and has_column_privilege('authenticated', 'public.projects', 'tax_treatment', 'INSERT')
  and has_column_privilege('authenticated', 'public.projects', 'tax_amount', 'INSERT')
  and has_column_privilege('authenticated', 'public.projects', 'tax_rate', 'INSERT')
  and has_column_privilege('authenticated', 'public.projects', 'tax_template', 'INSERT'),
  'AC-CODE-002 existing Client Project Code, end-client, currency, and tax INSERT grants are preserved'
);
select function_returns('public', 'propose_project_number', array['uuid'], 'text', 'AC-CODE-002 proposal RPC returns one text number');

update companies set client_number_segment = 'ACME' where id = '00771000-0000-0000-0000-000000000011';
insert into projects (id, org_id, code, name, status, client_id, created_at) values
  ('00771000-0000-0000-0000-000000000101', '00771000-0000-0000-0000-000000000001', 'CLIENT-CODE-KEEP', 'Legacy Project', 'Internal Project', '00771000-0000-0000-0000-000000000011', '2025-12-31 12:00:00+00');
select is((select code from projects where id='00771000-0000-0000-0000-000000000101'), 'CLIENT-CODE-KEEP', 'AC-CODE-001 existing Client Project Code remains unchanged');
select isnt((select pmo_project_number from projects where id='00771000-0000-0000-0000-000000000101'), 'CLIENT-CODE-KEEP', 'AC-CODE-001 backfill assigns an independent PMO number');
select is((select pmo_project_number from projects where id='00771000-0000-0000-0000-000000000101'), 'PRJ-25-0001', 'AC-CODE-001 legacy numbers use local creation year and stable sequence');

select throws_ok($$update organizations set project_number_pattern='BAD-{YY}-{SEQ4}' where id='00771000-0000-0000-0000-000000000001'$$, '23514', null, 'AC-CODE-001 an unknown token is rejected by the database');
select throws_ok($$update organizations set project_number_pattern='{CLIENT}-{CLIENT}-{YY}-{SEQ4}' where id='00771000-0000-0000-0000-000000000001'$$, '23514', null, 'AC-CODE-001 a repeated required token is rejected');
select throws_ok($$update organizations set project_number_pattern='{CLIENT}-{YY}-{SEQ4' where id='00771000-0000-0000-0000-000000000001'$$, '23514', null, 'AC-CODE-001 unmatched braces are rejected');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00771000-0000-0000-0000-0000000000a1","role":"authenticated"}';
with changed as (
  update organizations set project_number_pattern='PR-{CLIENT}-{YY}-{SEQ4}'
   where id='00771000-0000-0000-0000-000000000001' returning 1
) select is((select count(*)::int from changed), 1, 'AC-CODE-001 Admin saves a valid pattern on the RLS-visible org');
select throws_ok($$update organizations set name='not allowed' where id='00771000-0000-0000-0000-000000000001'$$, '42501', null, 'AC-CODE-001 pattern grant cannot update unrelated organization columns');
select is(public.propose_project_number('00771000-0000-0000-0000-000000000011'), format('PR-ACME-%s-0001', to_char(current_timestamp at time zone 'Asia/Jakarta', 'YY')), 'AC-CODE-002 valid pattern proposes the next org-local sequence');
select is(public.propose_project_number('00771000-0000-0000-0000-000000000011'), format('PR-ACME-%s-0002', to_char(current_timestamp at time zone 'Asia/Jakarta', 'YY')), 'AC-CODE-002 repeated proposals atomically advance the sequence');
select throws_ok($$select public.propose_project_number('00771000-0000-0000-0000-000000000012')$$, 'P0001', null, 'AC-CODE-002 a required missing company segment is refused');
select throws_ok($$insert into project_number_counters(org_id,business_year,last_seq) values ('00771000-0000-0000-0000-000000000001',2026,900)$$, '42501', null, 'NFR-PNO-001 authenticated callers cannot write allocator counters');

-- A distinct tenant starts its own counter and cannot propose another tenant's client.
set local request.jwt.claims = '{"sub":"00771000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.propose_project_number('00771000-0000-0000-0000-000000000021')$$, '42501', null, 'NFR-PNO-001 a caller cannot propose against a company in another org');

-- The direct INSERT fallback runs after projects_stamp_org_id and preserves the supplied client code.
-- Cross the UTC year boundary into the current business year, whose first two
-- allocations were exercised above; keep this fixture independent of calendar year.
insert into projects (name, status, client_id, code, created_at)
values ('Direct Insert Fallback', 'Internal Project', '00771000-0000-0000-0000-000000000011', 'CLIENT-DIRECT',
  make_timestamptz(extract(year from current_timestamp at time zone 'Asia/Jakarta')::integer - 1, 12, 31, 17, 30, 0, 'UTC'));
select is((select pmo_project_number from projects where name='Direct Insert Fallback'), format('PR-ACME-%s-0003', to_char(current_timestamp at time zone 'Asia/Jakarta', 'YY')), 'NFR-PNO-002 insert fallback uses the business timezone at the UTC year boundary');
select is((select code from projects where name='Direct Insert Fallback'), 'CLIENT-DIRECT', 'AC-CODE-002 fallback does not reuse or overwrite Client Project Code');
insert into projects (org_id, pmo_project_number, code, name, status, client_id)
values ('00771000-0000-0000-0000-000000000001', 'PIPELINE-PMO-771', 'PIPELINE-CLIENT-81', 'Pipeline projection check', 'Leads', '00771000-0000-0000-0000-000000000011');
select is(public.get_sales_pipeline() #>> '{projects,0,pmo_project_number}', 'PIPELINE-PMO-771', 'AC-CODE-003 pipeline projection preserves the PMO Project Number');
select is(public.get_sales_pipeline() #>> '{projects,0,code}', 'PIPELINE-CLIENT-81', 'AC-CODE-003 pipeline projection preserves the Client Project Code separately');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00771000-0000-0000-0000-0000000000b1","role":"authenticated"}';
with changed as (
  update organizations set project_number_pattern='X-{CLIENT}-{YY}-{SEQ4}'
   where id='00771000-0000-0000-0000-000000000001' returning 1
) select is((select count(*)::int from changed), 0, 'AC-CODE-001 a non-Admin cannot change the organization pattern');
with changed as (
  update organizations set project_number_pattern='X-{CLIENT}-{YY}-{SEQ4}'
   where id='00771000-0000-0000-0000-000000000002' returning 1
) select is((select count(*)::int from changed), 0, 'AC-CODE-001 an Admin cannot change another organization pattern');
reset role;
select throws_ok($$update projects set pmo_project_number='CHANGED' where id='00771000-0000-0000-0000-000000000101'$$, 'P0001', null, 'AC-CODE-002 an assigned PMO number is immutable');
select throws_ok($$insert into projects (org_id, pmo_project_number, code, name, status) values ('00771000-0000-0000-0000-000000000001','PRJ-25-0001','OTHER-CODE','Duplicate PMO','Internal Project')$$, '23505', null, 'AC-CODE-002 PMO number uniqueness is enforced within an organization');
select throws_ok($$insert into projects (org_id, pmo_project_number, code, name, status) values ('00771000-0000-0000-0000-000000000001','UNIQUE-PMO-TEST','CLIENT-CODE-KEEP','Duplicate client code','Internal Project')$$, '23505', null, 'AC-CODE-001 existing Client Project Code uniqueness remains independent');
insert into projects (org_id, pmo_project_number, code, name, status) values ('00771000-0000-0000-0000-000000000002','PRJ-25-0001','OTHER-TENANT-CODE','Same PMO text in another tenant','Internal Project');
select is((select count(*)::int from projects where org_id='00771000-0000-0000-0000-000000000002' and pmo_project_number='PRJ-25-0001'), 1, 'AC-CODE-002 PMO number uniqueness is tenant-scoped');

-- The public proposal must expand past the padding width, never truncate the sequence.
reset role;
insert into public.project_number_counters (org_id, business_year, last_seq)
values ('00771000-0000-0000-0000-000000000001',
 extract(year from (now() at time zone 'Asia/Jakarta'))::integer, 9999)
on conflict (org_id, business_year) do update set last_seq = excluded.last_seq;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00771000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select matches(public.propose_project_number('00771000-0000-0000-0000-000000000011'),
 '^PR-ACME-[0-9]{2}-10000$', 'AC-CODE-002 the ten-thousandth proposal expands without truncating');
select matches(public.propose_project_number('00771000-0000-0000-0000-000000000011'),
 '^PR-ACME-[0-9]{2}-10001$', 'AC-CODE-002 expanded proposals continue with distinct identifiers');

select * from finish();
rollback;
