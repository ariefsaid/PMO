-- #1273 AC-BAD-009: the review-and-activate list calls activate_budget_version once per ticked draft, so every
-- refusal is per budget. A looped batch reports each outcome independently; nothing is activated that was refused.
begin;
select plan(9);

insert into organizations (id, name) values
  ('b0000000-0000-0000-0000-000000000001','Bulk Activate Org'),
  ('b0000000-0000-0000-0000-000000000002','Bulk Activate Other Org');
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000f1','bad-fin@example.com'),
  ('b0000000-0000-0000-0000-0000000000d1','bad-drafter@example.com'),
  ('b0000000-0000-0000-0000-0000000000e1','bad-eng@example.com'),
  ('b0000000-0000-0000-0000-0000000000f2','bad-other@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('b0000000-0000-0000-0000-0000000000f1','b0000000-0000-0000-0000-000000000001','Fin','bad-fin@example.com','Finance'),
  ('b0000000-0000-0000-0000-0000000000d1','b0000000-0000-0000-0000-000000000001','Drafter','bad-drafter@example.com','Project Manager'),
  ('b0000000-0000-0000-0000-0000000000e1','b0000000-0000-0000-0000-000000000001','Eng','bad-eng@example.com','Engineer'),
  ('b0000000-0000-0000-0000-0000000000f2','b0000000-0000-0000-0000-000000000002','Other Fin','bad-other@example.com','Finance');

insert into projects (id, org_id, name, status) values
  ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','P ok','Ongoing Project'),
  ('b1000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','P own draft','Ongoing Project'),
  ('b1000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','P edited','Ongoing Project'),
  ('b1000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000001','P eng','Ongoing Project'),
  ('b1000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000001','P active','Ongoing Project'),
  ('b1000000-0000-0000-0000-000000000009','b0000000-0000-0000-0000-000000000002','P other org','Ongoing Project');

insert into budget_versions (id, org_id, project_id, version, name, status, created_by) values
  ('b2000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',1,'ok','Draft','b0000000-0000-0000-0000-0000000000d1'),
  ('b2000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002',1,'own','Draft','b0000000-0000-0000-0000-0000000000f1'),
  ('b2000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000003',1,'edited','Draft','b0000000-0000-0000-0000-0000000000d1'),
  ('b2000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000004',1,'eng','Draft','b0000000-0000-0000-0000-0000000000d1'),
  ('b2000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000005',1,'active','Active','b0000000-0000-0000-0000-0000000000d1'),
  ('b2000000-0000-0000-0000-000000000009','b0000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000009',1,'other','Draft','b0000000-0000-0000-0000-0000000000f2');
-- Finance edited draft 3 (DD-BUDGET-7: any editor is barred).
insert into budget_version_editors (budget_version_id, user_id, org_id) values
  ('b2000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-0000000000f1','b0000000-0000-0000-0000-000000000001');

-- Finance (a second person, not the drafter) runs the "batch": one call per draft, outcome recorded per row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

create temp table bad_outcomes (version_id uuid, outcome text);
grant all on bad_outcomes to authenticated;
do $$
declare v uuid;
begin
  foreach v in array array[
    'b2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000003',
    'b2000000-0000-0000-0000-000000000005','b2000000-0000-0000-0000-000000000009']::uuid[] loop
    begin
      perform public.activate_budget_version(v);
      insert into bad_outcomes values (v, 'activated');
    exception when others then
      insert into bad_outcomes values (v, 'refused:' || sqlstate);
    end;
  end loop;
end $$;

select is((select outcome from bad_outcomes where version_id='b2000000-0000-0000-0000-000000000001'), 'activated',
  'AC-BAD-009: a draft by someone else is activated');
select is((select outcome from bad_outcomes where version_id='b2000000-0000-0000-0000-000000000002'), 'refused:42501',
  'AC-BAD-009: a draft the activator drafted is refused when the org has other members (OD-BUDGET-6)');
select is((select outcome from bad_outcomes where version_id='b2000000-0000-0000-0000-000000000003'), 'refused:42501',
  'AC-BAD-009: a draft the activator edited is refused (DD-BUDGET-7)');
select is((select outcome from bad_outcomes where version_id='b2000000-0000-0000-0000-000000000005'), 'refused:P0001',
  'AC-BAD-009: an already-Active version is refused (Draft only)');
select is((select outcome from bad_outcomes where version_id='b2000000-0000-0000-0000-000000000009'), 'refused:42501',
  'AC-BAD-009: another org''s draft is refused (org seam)');
select is((select count(*)::int from bad_outcomes where outcome='activated'), 1,
  'AC-BAD-009: only the one permitted draft in the batch was activated');

reset role;
select is((select status::text from budget_versions where id='b2000000-0000-0000-0000-000000000002'), 'Draft',
  'AC-BAD-009: a refused draft stays a Draft');

-- A non-permitted role is refused per budget.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$ select public.activate_budget_version('b2000000-0000-0000-0000-000000000004') $$, '42501', null,
  'AC-BAD-009: an Engineer is refused');
reset role;
select is((select status::text from budget_versions where id='b2000000-0000-0000-0000-000000000004'), 'Draft',
  'AC-BAD-009: the Engineer''s refused draft stays a Draft');

select * from finish();
rollback;
