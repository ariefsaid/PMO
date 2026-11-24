-- 2043_report_validation_checkpoints_expiry.test.sql — report validation reads its capability; the Project Control Manager reads
-- checkpoint days (migration 2043). The medical expiry notice to the manager is proven in document_expiry.test.sql and
-- document_expiry_manager.test.sql.
-- Validation: no job role holds daily_report_validate by default, so the default validators are today's (Admin, Finance, the project's
-- own manager); a job role given the capability validates; one without it does not; the author never validates their own report.
-- MUTATION NOTES (remove the condition tagged in 2043; the named assertion must go red; restore):
--   mut:rr_dsr_capability ... 'RR-DV-03 a job role given the capability validates another person''s report'
--   mut:rr_pcm_checkpoint ... 'RR-CP-01 the Project Control Manager reads a crew''s checkpoint days'
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20430000-0000-0000-0000-00000000000a', 'RR DV Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20430000-0000-0000-0000-0000000000' || k)::uuid, 'rrdv-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20430000-0000-0000-0000-0000000000a1', '20430000-0000-0000-0000-00000000000a', 'Admin',      'rrdv-a1@example.com', 'Admin', 'active', null),
  ('20430000-0000-0000-0000-0000000000a2', '20430000-0000-0000-0000-00000000000a', 'Supervisor', 'rrdv-a2@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('20430000-0000-0000-0000-0000000000a3', '20430000-0000-0000-0000-00000000000a', 'PCM',        'rrdv-a3@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('20430000-0000-0000-0000-0000000000a4', '20430000-0000-0000-0000-00000000000a', 'QS',         'rrdv-a4@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('20430000-0000-0000-0000-0000000000a5', '20430000-0000-0000-0000-00000000000a', 'PM',         'rrdv-a5@example.com', 'Project Manager', 'active', null),
  ('20430000-0000-0000-0000-0000000000a6', '20430000-0000-0000-0000-00000000000a', 'Field',      'rrdv-a6@example.com', 'Engineer', 'active', 'field_user'),
  ('20430000-0000-0000-0000-0000000000a7', '20430000-0000-0000-0000-00000000000a', 'Construction', 'rrdv-a7@example.com', 'Project Manager', 'active', 'construction_manager');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20430000-0000-0000-0000-0000000000c1', '20430000-0000-0000-0000-00000000000a', 'RRDV project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20430000-0000-0000-0000-0000000000a5');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20430000-0000-0000-0000-000000000031', '20430000-0000-0000-0000-00000000000a', '20430000-0000-0000-0000-0000000000c1', 'RRDV WO', 'Issued', 10000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('20430000-0000-0000-0000-000000000041', '20430000-0000-0000-0000-00000000000a', 'CA', 'Crew A');
-- two submitted reports, written by the quantity surveyor and by the supervisor
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id, status) values
  ('20430000-0000-0000-0000-000000000051', '20430000-0000-0000-0000-00000000000a', '20430000-0000-0000-0000-0000000000c1',
   '20430000-0000-0000-0000-000000000031', current_date - 1, '20430000-0000-0000-0000-0000000000a4', 'submitted'),
  ('20430000-0000-0000-0000-000000000052', '20430000-0000-0000-0000-00000000000a', '20430000-0000-0000-0000-0000000000c1',
   '20430000-0000-0000-0000-000000000031', current_date - 2, '20430000-0000-0000-0000-0000000000a2', 'submitted');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20430000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || sqlerrm;
end $$;
-- the gate is passed when the next refusal is the missing paper-form photo (the validation itself needs one)
create function pg_temp.validate(p_user text, p_report text) returns text language sql as $$
  select pg_temp.err(p_user, format('select dsr_validate(%L)', '20430000-0000-0000-0000-0000000000' || p_report)) $$;

-- ── defaults: nobody holds the capability, so the validators are today's ────────────────────────────────────────────────────────
select is((select count(*)::int from built_in_role_capabilities where capability = 'daily_report_validate'), 0,
  'RR-DV-01 no job role holds daily_report_validate by default');
select is(pg_temp.validate('a2', '51'), '42501 you cannot validate site reports on this project', 'RR-DV-02 a Site Supervisor does not validate by default');
select is(pg_temp.validate('a3', '51'), '42501 you cannot validate site reports on this project', 'RR-DV-02 a Project Control Manager does not validate by default');
select is(pg_temp.validate('a5', '51'), '23514 a photo of the paper form is required to validate', 'RR-DV-02 the project''s own manager still validates');
select is(pg_temp.validate('a1', '51'), '23514 a photo of the paper form is required to validate', 'RR-DV-02 an Admin still validates');

-- ── an Admin's setting gives the capability to the Site Supervisor job role ─────────────────────────────────────────────────────
insert into built_in_role_capabilities (role_key, capability) values ('site_supervisor', 'daily_report_validate');
select is(pg_temp.validate('a2', '51'), '23514 a photo of the paper form is required to validate', 'RR-DV-03 a job role given the capability validates another person''s report');
select is(pg_temp.validate('a2', '52'), '42501 the author of a report cannot validate it', 'RR-DV-04 it never validates its own report');
select is(pg_temp.err('a2', $$select dsr_return('20430000-0000-0000-0000-000000000052', 'redo')$$), '42501 you cannot return this report',
  'RR-DV-04 nor returns its own report');
select is(pg_temp.validate('a3', '51'), '42501 you cannot validate site reports on this project', 'RR-DV-05 a job role without the capability still does not');
select is(pg_temp.validate('a6', '51'), '42501 LIGHT_ACCOUNT: this account has one phone home screen and cannot read this', 'RR-DV-05 a field account does not');

-- ── checkpoint days ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.reads(p_user text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"20430000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  v := public.site_checkpoint_may_read('20430000-0000-0000-0000-000000000031', '20430000-0000-0000-0000-000000000041');
  execute 'reset role';
  return v;
end $$;
select ok(pg_temp.reads('a3'), 'RR-CP-01 the Project Control Manager reads a crew''s checkpoint days');
select ok(not pg_temp.reads('a7'), 'RR-CP-02 a Construction Manager at the same access level who does not manage the project does not');
select ok(pg_temp.reads('a5'), 'RR-CP-02 the project''s own manager still does');

select * from finish();
rollback;
