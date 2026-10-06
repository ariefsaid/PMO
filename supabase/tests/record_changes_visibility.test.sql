-- record_changes_visibility.test.sql — #719 record change history, visibility (spec D2, FR-CHG-007).
-- A history row is readable exactly when its source row is readable under the source table's own RLS.
-- AC-CHG-007 same-org reader sees · cross-org user (negative) reads zero and cannot write into org A ·
-- AC-CHG-008 lower-privilege role reads what it can read · deactivated member (negative) reads zero ·
-- a narrower source policy hides the history with it · a hard-deleted source leaves its history unreadable.
-- Migration under test: 0260_record_change_history.sql.
-- Cast: a4 PM · a5 Engineer · a6 Engineer (disabled) of org A; b1 Admin of org B.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A'),
  ('07190000-0000-0000-0000-000000000002', 'CHG Org B');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a4', 'chg-pm@example.com'),
  ('07190000-0000-0000-0000-0000000000a5', 'chg-eng@example.com'),
  ('07190000-0000-0000-0000-0000000000a6', 'chg-off@example.com'),
  ('07190000-0000-0000-0000-0000000000b1', 'chg-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a4', '07190000-0000-0000-0000-000000000001', 'CHG PM', 'chg-pm@example.com', 'Project Manager', 'active'),
  ('07190000-0000-0000-0000-0000000000a5', '07190000-0000-0000-0000-000000000001', 'CHG Eng', 'chg-eng@example.com', 'Engineer', 'active'),
  ('07190000-0000-0000-0000-0000000000a6', '07190000-0000-0000-0000-000000000001', 'CHG Off', 'chg-off@example.com', 'Engineer', 'disabled'),
  ('07190000-0000-0000-0000-0000000000b1', '07190000-0000-0000-0000-000000000002', 'CHG XOrg', 'chg-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, code, name, status) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Alpha', 'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('07190000-0000-0000-0000-0000000000b9', '07190000-0000-0000-0000-000000000001', 'CHG Client', 'Client');
insert into tasks (id, org_id, project_id, name, status) values
  ('07190000-0000-0000-0000-0000000000d1', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000c1', 'Survey', 'To Do');
update projects set name = 'Alpha 2' where id = '07190000-0000-0000-0000-0000000000c1';
update companies set name = 'CHG Client 2' where id = '07190000-0000-0000-0000-0000000000b9';
update tasks set name = 'Survey 2' where id = '07190000-0000-0000-0000-0000000000d1';

create temp view chg_seen with (security_invoker = true) as
  select entity_type, count(*)::int n from record_changes
   where entity_id in ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-0000000000b9',
                       '07190000-0000-0000-0000-0000000000d1')
   group by entity_type;
grant select on chg_seen to authenticated;

-- ── AC-CHG-007: a same-org member reads the record's events ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select n from chg_seen where entity_type = 'project'), 2,
  'AC-CHG-007 the PM reads both of the project''s events (insert + update)');
select is((select coalesce(sum(n), 0)::int from chg_seen), 6,
  'AC-CHG-007 the PM reads every event of the three records they can read');

-- ── AC-CHG-007: cross-org negative ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select coalesce(sum(n), 0)::int from chg_seen), 0,
  'AC-CHG-007 an org-B Admin reads zero of org A''s events');
select is((select count(*)::int from record_changes where org_id = '07190000-0000-0000-0000-000000000001'), 0,
  'AC-CHG-007 an org-B Admin reads zero org-A rows even when filtering by org A''s id');
select throws_ok(
  $$ insert into record_changes (org_id, entity_type, entity_id, op)
     values ('07190000-0000-0000-0000-000000000001', 'project', '07190000-0000-0000-0000-0000000000c1', 'update') $$,
  '42501', null, 'AC-CHG-007 an org-B user cannot insert an event with org A''s org_id');
update projects set name = 'Hijacked' where id = '07190000-0000-0000-0000-0000000000c1';
reset role;
set local request.jwt.claims = '';
select is((select count(*)::int from record_changes where entity_id = '07190000-0000-0000-0000-0000000000c1'), 2,
  'AC-CHG-007 an org-B user''s update attempt on an org-A project writes no org-A event');

-- ── AC-CHG-008: lower-privilege role and deactivated member ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select coalesce(sum(n), 0)::int from chg_seen), 6,
  'AC-CHG-008 an Engineer reads the history of every record they can read (history read = record read)');
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is((select coalesce(sum(n), 0)::int from chg_seen), 0,
  'AC-CHG-008 a deactivated member reads zero events');
select is((select count(*)::int from record_changes), 0,
  'AC-CHG-008 a deactivated member reads zero rows of any kind');

-- ── AC-CHG-008: the source table's own RLS decides (a narrower policy added in this transaction) ──
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select n from chg_seen where entity_type = 'company'), 2,
  'AC-CHG-008 (control) the PM reads the company''s events before the narrower policy');
reset role;
create policy chg_test_hide_company on public.companies as restrictive for select to authenticated
  using (id <> '07190000-0000-0000-0000-0000000000b9');
set local role authenticated;
select is((select n from chg_seen where entity_type = 'company'), null::int,
  'AC-CHG-008 a company hidden by a narrower policy hides its history too');
select is((select n from chg_seen where entity_type = 'project'), 2,
  'AC-CHG-008 records still visible keep their history under the narrower policy');
reset role;
drop policy chg_test_hide_company on public.companies;

-- ── a hard-deleted source row leaves its history unreadable (no record page; audit keeps deletes) ──
delete from tasks where id = '07190000-0000-0000-0000-0000000000d1';
set local role authenticated;
select is((select n from chg_seen where entity_type = 'task'), null::int,
  'AC-CHG-008 history of a hard-deleted record is unreadable');
reset role;
select is((select count(*)::int from record_changes where entity_id = '07190000-0000-0000-0000-0000000000d1'), 2,
  'AC-CHG-008 (control) the deleted record''s events still exist; only visibility changed');
set local request.jwt.claims = '';

select * from finish();
rollback;
