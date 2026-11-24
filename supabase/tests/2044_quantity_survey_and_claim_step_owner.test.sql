-- 2044_quantity_survey_and_claim_step_owner.test.sql — the Quantity Surveyor records surveys and reads claims; a claim step is done
-- by its named owner or the standing privileged access levels (migration 2052).
-- MUTATION NOTES (remove the condition tagged in 2044; the named assertion must go red; restore):
--   mut:rr_qs_survey ...... 'RR-QS-01 the Quantity Surveyor records a survey'
--   mut:rr_qs_claims ...... 'RR-QS-04 the Quantity Surveyor reads the project''s claims and steps'
--   mut:rr_step_owner ..... 'RR-BS-01 the Quantity Surveyor records a step its access level owns'
--   mut:claim_step_privileged_creator (2052; restore creator refusal) ... 'RR-BS-03 Finance creator records a step another owner holds'
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20440000-0000-0000-0000-00000000000a', 'RR QS Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20440000-0000-0000-0000-0000000000' || k)::uuid, 'rrqs-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20440000-0000-0000-0000-0000000000a1', '20440000-0000-0000-0000-00000000000a', 'Admin',    'rrqs-a1@example.com', 'Admin', 'active', null),
  ('20440000-0000-0000-0000-0000000000a2', '20440000-0000-0000-0000-00000000000a', 'QS',       'rrqs-a2@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('20440000-0000-0000-0000-0000000000a3', '20440000-0000-0000-0000-00000000000a', 'Planner',  'rrqs-a3@example.com', 'Engineer', 'active', 'planner'),
  ('20440000-0000-0000-0000-0000000000a4', '20440000-0000-0000-0000-00000000000a', 'Engineer', 'rrqs-a4@example.com', 'Engineer', 'active', null),
  ('20440000-0000-0000-0000-0000000000a5', '20440000-0000-0000-0000-00000000000a', 'Field',    'rrqs-a5@example.com', 'Engineer', 'active', 'field_user'),
  ('20440000-0000-0000-0000-0000000000a6', '20440000-0000-0000-0000-00000000000a', 'Finance',  'rrqs-a6@example.com', 'Finance', 'active', null),
  ('20440000-0000-0000-0000-0000000000a7', '20440000-0000-0000-0000-00000000000a', 'Finance2', 'rrqs-a7@example.com', 'Finance', 'active', null),
  ('20440000-0000-0000-0000-0000000000a8', '20440000-0000-0000-0000-00000000000a', 'PM',       'rrqs-a8@example.com', 'Project Manager', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20440000-0000-0000-0000-0000000000c1', '20440000-0000-0000-0000-00000000000a', 'RRQS project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20440000-0000-0000-0000-0000000000a8');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('20440000-0000-0000-0000-000000000e01', '20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-0000000000c1', 'L1', 'Pipe', 'm', 100, 10);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20440000-0000-0000-0000-000000000031', '20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-0000000000c1', 'RRQS WO', 'Draft', 1000, 'exclusive', 0);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-000000000031', '20440000-0000-0000-0000-000000000e01', 100);
update work_orders set status = 'Issued', issued_at = now() where id = '20440000-0000-0000-0000-000000000031';
-- a claim created by Finance, with a step owned by Engineer level, one owned by Finance and one with no owner
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, created_by) values
  ('20440000-0000-0000-0000-000000000061', '20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-0000000000c1', 'progress', 'IDR', 500,
   '20440000-0000-0000-0000-0000000000a6');
delete from claim_billing_stages where claim_id = '20440000-0000-0000-0000-000000000061';
insert into claim_billing_stages (id, org_id, claim_id, project_id, position, name, client_side, owner_role, started_on) values
  ('20440000-0000-0000-0000-000000000071', '20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-000000000061', '20440000-0000-0000-0000-0000000000c1', 1, 'Measured quantities', false, 'Engineer', current_date),
  ('20440000-0000-0000-0000-000000000072', '20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-000000000061', '20440000-0000-0000-0000-0000000000c1', 2, 'No owner', false, null, null),
  ('20440000-0000-0000-0000-000000000073', '20440000-0000-0000-0000-00000000000a', '20440000-0000-0000-0000-000000000061', '20440000-0000-0000-0000-0000000000c1', 3, 'Invoice pack', false, 'Finance', null);

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20440000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"20440000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.survey() returns text language sql as $$
  select $s$select record_survey('20440000-0000-0000-0000-000000000031', '20440000-0000-0000-0000-000000000e01', current_date, 40, 30,
    '[{"name":"Client supervisor","company":"Owner"}]'::jsonb)$s$ $$;
create function pg_temp.note(p_stage text) returns text language sql as $$
  select format('select note_billing_stage(%L, %L)', '20440000-0000-0000-0000-0000000000' || p_stage, 'checked') $$;

-- ── surveys ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.survey()), 'ok', 'RR-QS-01 the Quantity Surveyor records a survey');
select is(pg_temp.err('a2', $$select confirm_survey((select id from survey_records limit 1))$$), '42501 SVY_CONFIRM_ROLE',
  'RR-QS-02 the Quantity Surveyor cannot confirm the survey it recorded');
select is(pg_temp.err('a3', pg_temp.survey()), '42501 SVY_NOT_PERMITTED', 'RR-QS-03 a Planner at the same access level cannot record a survey');
select is(pg_temp.err('a4', pg_temp.survey()), '42501 SVY_NOT_PERMITTED', 'RR-QS-03 an Engineer with no job role still cannot');
select is(pg_temp.err('a5', pg_temp.survey()), '42501 LIGHT_ACCOUNT', 'RR-QS-03 a field account cannot');
select is(pg_temp.err('a8', pg_temp.survey()), 'ok', 'RR-QS-03 the project''s manager still records a survey');

-- ── reading claims ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.val('a2', 'select (select count(*) from progress_claims) || ''/'' || (select count(*) from claim_billing_stages)'), '1/3',
  'RR-QS-04 the Quantity Surveyor reads the project''s claims and steps');
select is(pg_temp.val('a3', 'select (select count(*) from progress_claims) || ''/'' || (select count(*) from claim_billing_stages)'), '0/0',
  'RR-QS-05 a Planner reads no claim, as before');
select is(pg_temp.val('a4', 'select count(*)::text from progress_claims'), '0', 'RR-QS-05 an Engineer with no job role reads no claim, as before');

-- ── claim steps follow their owner ──────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.note('71')), 'ok', 'RR-BS-01 the Quantity Surveyor records a step its access level owns');
select is(pg_temp.err('a2', pg_temp.note('72')), '42501 only Finance, an Admin, a Project Manager or the step''s owner can record billing stages',
  'RR-BS-02 but not a step with no owner');
select is(pg_temp.err('a3', pg_temp.note('71')), '42501 only Finance, an Admin, a Project Manager or the step''s owner can record billing stages',
  'RR-BS-02 a Planner (no run-steps right) cannot record the Engineer-owned step');
select is(pg_temp.err('a4', pg_temp.note('71')), '42501 only Finance, an Admin, a Project Manager or the step''s owner can record billing stages',
  'RR-BS-02 an Engineer with no job role still cannot');
select is(pg_temp.err('a5', pg_temp.note('71')), '42501 LIGHT_ACCOUNT', 'RR-BS-02 a field account cannot');
-- mut:claim_step_privileged_creator: restoring the creator refusal must fail this assertion.
select is(pg_temp.err('a6', pg_temp.note('71')), 'ok',
  'RR-BS-03 Finance creator records a step another owner holds');
select is(pg_temp.err('a7', pg_temp.note('71')), 'ok', 'RR-BS-04 another Finance user still records it, as before');
select is(pg_temp.err('a6', pg_temp.note('73')), 'ok', 'RR-BS-04 the creator records a step its own access level owns');
select is(pg_temp.err('a6', pg_temp.note('72')), 'ok', 'RR-BS-04 the creator still records a step with no owner');
select is(pg_temp.err('a8', pg_temp.note('71')), 'ok', 'RR-BS-04 a Project Manager still records a step, as before');

update progress_claims set created_by = '20440000-0000-0000-0000-0000000000a1';
select is(pg_temp.err('a1', pg_temp.note('71')), 'ok', 'RR-BS-06 Admin creator records another owner step');
update progress_claims set created_by = '20440000-0000-0000-0000-0000000000a8';
select is(pg_temp.err('a8', pg_temp.note('71')), 'ok', 'RR-BS-07 Project Manager creator records another owner step');

select * from finish();
rollback;
