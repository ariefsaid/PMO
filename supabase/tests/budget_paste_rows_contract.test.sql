begin;
create extension if not exists pgtap;
select plan(16);

-- Synthetic fixtures exercise the same ordinary budget_line_items INSERT used by the repository.
insert into public.organizations (id, name) values
  ('a1473000-0000-0000-0000-000000000001', 'Paste Contract Org A'),
  ('a1473000-0000-0000-0000-000000000002', 'Paste Contract Org B');

insert into auth.users (id, email) values
  ('a1473000-0000-0000-0000-0000000000a1', 'paste-admin@example.invalid'),
  ('a1473000-0000-0000-0000-0000000000a2', 'paste-executive@example.invalid'),
  ('a1473000-0000-0000-0000-0000000000a3', 'paste-pm@example.invalid'),
  ('a1473000-0000-0000-0000-0000000000a4', 'paste-finance@example.invalid'),
  ('a1473000-0000-0000-0000-0000000000a5', 'paste-engineer@example.invalid');

insert into public.profiles (id, org_id, full_name, email, role) values
  ('a1473000-0000-0000-0000-0000000000a1', 'a1473000-0000-0000-0000-000000000001', 'Paste Admin', 'paste-admin@example.invalid', 'Admin'),
  ('a1473000-0000-0000-0000-0000000000a2', 'a1473000-0000-0000-0000-000000000001', 'Paste Executive', 'paste-executive@example.invalid', 'Executive'),
  ('a1473000-0000-0000-0000-0000000000a3', 'a1473000-0000-0000-0000-000000000001', 'Paste PM', 'paste-pm@example.invalid', 'Project Manager'),
  ('a1473000-0000-0000-0000-0000000000a4', 'a1473000-0000-0000-0000-000000000001', 'Paste Finance', 'paste-finance@example.invalid', 'Finance'),
  ('a1473000-0000-0000-0000-0000000000a5', 'a1473000-0000-0000-0000-000000000001', 'Paste Engineer', 'paste-engineer@example.invalid', 'Engineer');

insert into public.projects (id, org_id, name, status) values
  ('b1473000-0000-0000-0000-000000000001', 'a1473000-0000-0000-0000-000000000001', 'Paste Contract Project A', 'Ongoing Project'),
  ('b1473000-0000-0000-0000-000000000002', 'a1473000-0000-0000-0000-000000000002', 'Paste Contract Project B', 'Ongoing Project');

insert into public.budget_versions (id, org_id, project_id, version, name, status, budget_mode) values
  ('c1473000-0000-0000-0000-000000000001', 'a1473000-0000-0000-0000-000000000001', 'b1473000-0000-0000-0000-000000000001', 1, 'Paste Per Year Draft', 'Draft', 'per_year'),
  ('c1473000-0000-0000-0000-000000000002', 'a1473000-0000-0000-0000-000000000001', 'b1473000-0000-0000-0000-000000000001', 2, 'Paste Whole Project Draft', 'Draft', 'whole_project'),
  ('c1473000-0000-0000-0000-000000000003', 'a1473000-0000-0000-0000-000000000001', 'b1473000-0000-0000-0000-000000000001', 3, 'Paste Active', 'Draft', 'per_year'),
  ('c1473000-0000-0000-0000-000000000004', 'a1473000-0000-0000-0000-000000000001', 'b1473000-0000-0000-0000-000000000001', 4, 'Paste Archived', 'Archived', 'per_year'),
  ('c1473000-0000-0000-0000-000000000005', 'a1473000-0000-0000-0000-000000000002', 'b1473000-0000-0000-0000-000000000002', 1, 'Paste Foreign Draft', 'Draft', 'per_year');

insert into public.budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
values ('d1473000-0000-0000-0000-000000000001', 'a1473000-0000-0000-0000-000000000001',
        'c1473000-0000-0000-0000-000000000003', 'Labor', 'Active fixture line', 1, 0);
update public.budget_versions set status = 'Active' where id = 'c1473000-0000-0000-0000-000000000003';

-- Admin may use the ordinary insert path; tenant and phase are supplied by database defaults.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1473000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000001', 'Labor', 'Paste Admin line', 101.25) $$,
  'AC-007: Admin inserts a same-tenant per-year Draft line through the ordinary path');
reset role;

-- Executive may use the same ordinary path.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1473000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000001', 'Equipment', 'Paste Executive line', 102.25) $$,
  'AC-007: Executive inserts a same-tenant Draft line through the ordinary path');
reset role;

-- Project Manager writes a reviewed amount with no fiscal-year input.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1473000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000001', 'Materials', 'Paste PM line', 103.25) $$,
  'AC-007: Project Manager inserts a same-tenant Draft line through the ordinary path');
reset role;

select is((select count(*)::int from public.budget_line_items
            where budget_version_id = 'c1473000-0000-0000-0000-000000000001'
              and description = 'Paste PM line'),
          1, 'AC-007: the ordinary insert persisted the PM line');
select is((select fiscal_year from public.budget_line_items where description = 'Paste PM line'),
          null::text, 'AC-007: a pasted line remains un-phased in per-year mode');
select is((select actual_amount from public.budget_line_items where description = 'Paste PM line'),
          0::numeric, 'AC-007: an ordinary pasted line keeps the server default actual amount');
select is((select org_id from public.budget_line_items where description = 'Paste PM line'),
          'a1473000-0000-0000-0000-000000000001'::uuid, 'AC-007: the database stamps the current organization');
select ok(exists (
  select 1 from public.budget_version_editors
   where budget_version_id = 'c1473000-0000-0000-0000-000000000001'
     and user_id = 'a1473000-0000-0000-0000-0000000000a3'
), 'AC-007: the ordinary insert tracks the human editor');

-- Finance can append to a whole-project Draft; the ordinary line remains null-phased.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1473000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000002', 'Overheads', 'Paste Finance whole-project line', 104.25) $$,
  'AC-007: Finance inserts a same-tenant whole-project Draft line through the ordinary path');
reset role;
select is((select fiscal_year from public.budget_line_items where description = 'Paste Finance whole-project line'),
          null::text, 'AC-007: a whole-project pasted line remains null-phased');

-- Engineer is read-only for budget lines even though they can read the Draft.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1473000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000001', 'Labor', 'Paste denied Engineer line', 105.25) $$,
  '42501', null, 'AC-007: Engineer cannot insert a budget line');
reset role;

-- A same-tenant caller cannot graft a line onto a foreign organization version.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1473000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000005', 'Labor', 'Paste denied foreign line', 106.25) $$,
  '42501', null, 'AC-007: Project Manager cannot insert against a foreign-tenant Draft');

-- Existing Draft-only guard codes are pinned to the real ordinary insert for Active and Archived.
select throws_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000003', 'Labor', 'Paste denied Active line', 107.25) $$,
  'P0001', null, 'AC-007: Active budget version rejects an ordinary line insert');
select throws_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000004', 'Labor', 'Paste denied Archived line', 108.25) $$,
  'P0001', null, 'AC-007: Archived budget version rejects an ordinary line insert');

-- PostgreSQL proves the only additional retryable row-local database rejection the hook classifies.
select throws_ok(
  $$ insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount)
     values ('c1473000-0000-0000-0000-000000000001', 'Labor', 'Paste amount overflow', 1000000000000.00) $$,
  '22003', null, 'AC-007: numeric(14,2) overflow is a confirmed non-committed row failure');

-- A user who authored a line remains excluded from activation by existing server-side SoD.
select throws_ok(
  $$ select public.activate_budget_version('c1473000-0000-0000-0000-000000000001') $$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'AC-007: a pasted-line editor cannot activate the same budget version');
reset role;

select * from finish();
rollback;
