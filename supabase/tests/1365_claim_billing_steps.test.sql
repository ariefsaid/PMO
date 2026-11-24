-- 1365_claim_billing_steps.test.sql — billing steps per claim: templates, live edits, owner role, needs-you reads (#2680).
-- AC-CBS-001..011 (docs/specs/claim-billing-steps.spec.md). Ids: 26800000-… (synthetic).
-- Org a1: b1 fin1 (claims), b2 fin2 (raises), b3 admin, b4 pm (manager of c1), b5 pm2 (manager of c2), b6 engineer. Org a2 (foreign): b8 admin, b9 finance.
begin;
create extension if not exists pgtap;
select plan(159);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26800000-0000-0000-0000-0000000000a1', 'CBS Org A', 'IDR', 'UTC'),
  ('26800000-0000-0000-0000-0000000000a2', 'CBS Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26800000-0000-0000-0000-0000000000b1', 'cbs-fin1@example.com'),
  ('26800000-0000-0000-0000-0000000000b2', 'cbs-fin2@example.com'),
  ('26800000-0000-0000-0000-0000000000b3', 'cbs-admin@example.com'),
  ('26800000-0000-0000-0000-0000000000b4', 'cbs-pm@example.com'),
  ('26800000-0000-0000-0000-0000000000b5', 'cbs-pm2@example.com'),
  ('26800000-0000-0000-0000-0000000000b6', 'cbs-eng@example.com'),
  ('26800000-0000-0000-0000-0000000000b8', 'cbs-fadmin@example.com'),
  ('26800000-0000-0000-0000-0000000000b9', 'cbs-ffin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26800000-0000-0000-0000-0000000000b1', '26800000-0000-0000-0000-0000000000a1', 'CBS Finance 1', 'cbs-fin1@example.com', 'Finance', 'active'),
  ('26800000-0000-0000-0000-0000000000b2', '26800000-0000-0000-0000-0000000000a1', 'CBS Finance 2', 'cbs-fin2@example.com', 'Finance', 'active'),
  ('26800000-0000-0000-0000-0000000000b3', '26800000-0000-0000-0000-0000000000a1', 'CBS Admin', 'cbs-admin@example.com', 'Admin', 'active'),
  ('26800000-0000-0000-0000-0000000000b4', '26800000-0000-0000-0000-0000000000a1', 'CBS PM', 'cbs-pm@example.com', 'Project Manager', 'active'),
  ('26800000-0000-0000-0000-0000000000b5', '26800000-0000-0000-0000-0000000000a1', 'CBS PM 2', 'cbs-pm2@example.com', 'Project Manager', 'active'),
  ('26800000-0000-0000-0000-0000000000b6', '26800000-0000-0000-0000-0000000000a1', 'CBS Engineer', 'cbs-eng@example.com', 'Engineer', 'active'),
  ('26800000-0000-0000-0000-0000000000b8', '26800000-0000-0000-0000-0000000000a2', 'CBS Foreign Admin', 'cbs-fadmin@example.com', 'Admin', 'active'),
  ('26800000-0000-0000-0000-0000000000b9', '26800000-0000-0000-0000-0000000000a2', 'CBS Foreign Finance', 'cbs-ffin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('26800000-0000-0000-0000-0000000000cc', '26800000-0000-0000-0000-0000000000a1', 'CBS Client', 'Client'),
  ('26800000-0000-0000-0000-0000000000cd', '26800000-0000-0000-0000-0000000000a2', 'CBS Foreign Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-0000000000a1', 'CBS managed', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '26800000-0000-0000-0000-0000000000cc', '26800000-0000-0000-0000-0000000000b4'),
  ('26800000-0000-0000-0000-0000000000c2', '26800000-0000-0000-0000-0000000000a1', 'CBS second', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '26800000-0000-0000-0000-0000000000cc', '26800000-0000-0000-0000-0000000000b5'),
  ('26800000-0000-0000-0000-0000000000c3', '26800000-0000-0000-0000-0000000000a2', 'CBS foreign', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '26800000-0000-0000-0000-0000000000cd', null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26800000-0000-0000-0000-000000000e01', '26800000-0000-0000-0000-0000000000a1', '26800000-0000-0000-0000-0000000000c1', 'TRENCH', 'Trench', 'm', 1000, 10000),
  ('26800000-0000-0000-0000-000000000e02', '26800000-0000-0000-0000-0000000000a1', '26800000-0000-0000-0000-0000000000c2', 'TRENCH', 'Trench', 'm', 1000, 10000);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('26800000-0000-0000-0000-000000000f01', '26800000-0000-0000-0000-0000000000a1', '26800000-0000-0000-0000-0000000000c1', 'Contract', 'CBS measurement sheet', 'Approved',
   '26800000-0000-0000-0000-0000000000b1', '26800000-0000-0000-0000-0000000000a1/26800000-0000-0000-0000-0000000000c1/26800000-0000-0000-0000-000000000f01/doc.pdf');

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select v from _state where k = p_k $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"26800000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.as_job() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.stage(p_claim text, p_pos int) returns uuid language sql as $$
  select s.id from claim_billing_stages s where s.claim_id = pg_temp.st(p_claim)::uuid and s.position = p_pos $$;
create function pg_temp.names(p_claim text) returns text language sql as $$
  select string_agg(name, ' > ' order by position) from claim_billing_stages where claim_id = pg_temp.st(p_claim)::uuid $$;
create function pg_temp.notices(p_user text) returns int language sql as $$
  select count(*)::int from notifications n where n.owner_id = ('26800000-0000-0000-0000-0000000000' || p_user)::uuid
     and n.title = 'Billing step is overdue' $$;
create function pg_temp.audits(p_action text, p_id uuid) returns int language sql security definer as $$
  select count(*)::int from audit_events where action = p_action and entity_id = p_id $$;
create function pg_temp.backdate(p_claim text, p_pos int, p_days int) returns void language sql as $$
  update claim_billing_stages set started_on = current_date - p_days where id = pg_temp.stage(p_claim, p_pos) $$;
create function pg_temp.new_claim(p_key text, p_project text, p_boq text) returns text language plpgsql as $$
declare v uuid;
begin
  v := create_progress_claim(p_project::uuid, 'progress', p_lines => jsonb_build_array(jsonb_build_object('boq_item_id', p_boq, 'quantity', 1)));
  insert into _state values (p_key, v::text);
  return v::text;
end $$;


-- ═══ AC-CBS-001: templates ═══════════════════════════════════════════════════════════════════════
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select save_billing_step_template(null, 'PM template', '[{"name":"x"}]'::jsonb)$q$), '42501 ', 'AC-CBS-001 a Project Manager cannot create a template');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select save_billing_step_template(null, 'Eng template', '[{"name":"x"}]'::jsonb)$q$), '42501 ', 'AC-CBS-001 an Engineer cannot create a template');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select save_billing_step_template(null, '  ', '[{"name":"x"}]'::jsonb)$q$), '23514 template-name-invalid', 'AC-CBS-001 a blank template name is refused');
select is(pg_temp.detail($q$select save_billing_step_template(null, 'Bad role', '[{"name":"x","owner_role":"Wizard"}]'::jsonb)$q$), '22P02 ', 'AC-CBS-001 an owner role outside the role set is refused');
select is(pg_temp.detail($q$select save_billing_step_template(null, 'Bad days', '[{"name":"x","target_days":400}]'::jsonb)$q$), '23514 stage-target-invalid', 'AC-CBS-001 a target over 365 days is refused');
select lives_ok($q$insert into _state select 'T1', save_billing_step_template(null, 'Standard', '[
  {"name":"Measure","owner_role":"Project Manager","target_days":10,"documents":[{"name":"Sheet","required":false}]},
  {"name":"Review","owner_role":"Finance","optional":true},
  {"name":"Approve","owner_role":"Admin","target_days":5}]'::jsonb)::text$q$, 'AC-CBS-001 Finance saves a template with owner roles, targets and a document');
select lives_ok($q$insert into _state select 'T2', save_billing_step_template(null, 'Solo', '[{"name":"Solo"}]'::jsonb)::text$q$, 'AC-CBS-001 Finance saves a second template');
select lives_ok($q$insert into _state select 'T3', save_billing_step_template(null, 'Alt', '[{"name":"First","owner_role":"Finance"},{"name":"Second"}]'::jsonb)::text$q$, 'AC-CBS-001 Finance saves a third template');
select lives_ok($q$insert into _state select 'T0', save_billing_step_template(null, 'Empty', '[]'::jsonb)::text$q$, 'AC-CBS-001 an empty template can be saved');
select is((select string_agg(name || ':' || coalesce(owner_role::text, '-') || ':' || coalesce(target_days::text, '-') || ':' || optional::text, ' > ' order by position)
             from billing_step_template_steps where template_id = pg_temp.st('T1')::uuid),
  'Measure:Project Manager:10:false > Review:Finance:-:true > Approve:Admin:5:false', 'AC-CBS-001 the template stores owner role, target and optional per step');
select is((select count(*)::int from billing_step_template_documents d join billing_step_template_steps s on s.id = d.step_id where s.template_id = pg_temp.st('T1')::uuid), 1, 'AC-CBS-001 the template stores its documents');
select pg_temp.as_user('b4');
select is((select count(*)::int from billing_step_template_steps where template_id = pg_temp.st('T1')::uuid), 3, 'AC-CBS-001 a Project Manager can read the templates');
select is(pg_temp.detail($q$select archive_billing_step_template(pg_temp.st('T3')::uuid)$q$), '42501 ', 'AC-CBS-001 a Project Manager cannot archive a template');
select is(pg_temp.detail($q$insert into billing_step_templates (org_id, name) values ('26800000-0000-0000-0000-0000000000a1', 'direct')$q$), '42501 ', 'AC-CBS-001 no client write grant on templates');
select pg_temp.as_user('b8');
select is((select count(*)::int from billing_step_templates), 0, 'AC-CBS-001 another organisation sees no template');
select is(pg_temp.detail($q$select save_billing_step_template(pg_temp.st('T1')::uuid, 'Hijack', '[{"name":"x"}]'::jsonb)$q$), 'P0002 template-not-found', 'AC-CBS-001 another organisation cannot replace the template');

-- ═══ AC-CBS-002: load onto a project ════════════════════════════════════════════════════════════
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select load_billing_step_template_onto_project('26800000-0000-0000-0000-0000000000c1', pg_temp.st('T1')::uuid)$q$), '42501 ', 'AC-CBS-002 a Project Manager cannot load a template onto a project');
select pg_temp.as_user('b1');
select is((select load_billing_step_template_onto_project('26800000-0000-0000-0000-0000000000c1', pg_temp.st('T1')::uuid)), 3, 'AC-CBS-002 Finance loads the template onto the project');
select is((select string_agg(name || ':' || coalesce(owner_role::text, '-') || ':' || coalesce(target_days::text, '-'), ' > ' order by position)
             from billing_stage_templates where project_id = '26800000-0000-0000-0000-0000000000c1'),
  'Measure:Project Manager:10 > Review:Finance:- > Approve:Admin:5', 'AC-CBS-002 the project list equals the template, owner role included');
select is((select count(*)::int from billing_stage_template_documents d join billing_stage_templates t on t.id = d.template_id where t.project_id = '26800000-0000-0000-0000-0000000000c1'), 1, 'AC-CBS-002 the template''s documents came along');

select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('A', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim A is created');
select is((select string_agg(name || ':' || coalesce(owner_role::text, '-'), ' > ' order by position) from claim_billing_stages where claim_id = pg_temp.st('A')::uuid),
  'Measure:Project Manager > Review:Finance > Approve:Admin', 'AC-CBS-002 a new claim copies the owner role');
select lives_ok($q$select load_billing_step_template_onto_project('26800000-0000-0000-0000-0000000000c1', pg_temp.st('T2')::uuid)$q$, 'AC-CBS-002 Finance loads another template later');
select is(pg_temp.names('A'), 'Measure > Review > Approve', 'AC-CBS-002 the claim already made is unchanged');
select lives_ok($q$select load_billing_step_template_onto_project('26800000-0000-0000-0000-0000000000c1', pg_temp.st('T1')::uuid)$q$, 'the three-step list is restored for the next claims');
select lives_ok($q$select archive_billing_step_template(pg_temp.st('T2')::uuid)$q$, 'AC-CBS-002 Finance archives a template');
select is(pg_temp.detail($q$select load_billing_step_template_onto_project('26800000-0000-0000-0000-0000000000c1', pg_temp.st('T2')::uuid)$q$), 'P0002 template-not-found', 'AC-CBS-002 an archived template cannot be loaded');
select is((select count(*)::int from billing_stage_templates where project_id = '26800000-0000-0000-0000-0000000000c1'), 3, 'AC-CBS-002 the project list is untouched after the refusal');

-- ═══ AC-CBS-004: edit a live claim (claim A: Measure > Review > Approve) ════════════════════════
select lives_ok($q$insert into _state select 'SV', add_claim_billing_step(pg_temp.st('A')::uuid, 1, '{"name":"Survey","owner_role":"Finance","target_days":3,"documents":[{"name":"Plan","required":true}]}'::jsonb)::text$q$, 'AC-CBS-004 Finance adds a step after the first');
select is(pg_temp.names('A'), 'Measure > Survey > Review > Approve', 'AC-CBS-004 the new step sits where it was put and later steps moved down');
select is((select count(distinct position)::int || ':' || min(position) || ':' || max(position) from claim_billing_stages where claim_id = pg_temp.st('A')::uuid), '4:1:4', 'AC-CBS-004 positions stay unique and contiguous');
select is((select count(*)::int from claim_billing_stage_documents where stage_id = pg_temp.st('SV')::uuid), 1, 'AC-CBS-004 the added step carries its checklist');
select lives_ok($q$select update_claim_billing_step(pg_temp.st('SV')::uuid, jsonb_build_object('name', 'Joint survey', 'owner_role', 'Admin', 'target_on', (current_date + 5)::text))$q$, 'AC-CBS-004 Finance renames a step and sets owner role and target date');
select is((select name || ':' || owner_role::text || ':' || target_on::text from claim_billing_stages where id = pg_temp.st('SV')::uuid),
  'Joint survey:Admin:' || (current_date + 5)::text, 'AC-CBS-004 the edit persisted');
select lives_ok($q$select move_claim_billing_step(pg_temp.stage('A', 4), 2)$q$, 'AC-CBS-004 Finance moves the last step to second place');
select is(pg_temp.names('A'), 'Measure > Approve > Joint survey > Review', 'AC-CBS-004 the order changed');
select is((select count(distinct position)::int from claim_billing_stages where claim_id = pg_temp.st('A')::uuid), 4, 'AC-CBS-004 positions are still unique after the move');
select is((select count(*)::int from claim_billing_stages where claim_id = pg_temp.st('A')::uuid and started_on is not null), 1, 'AC-CBS-004 exactly one step is current after the edits');
select is((select name from claim_billing_stages where claim_id = pg_temp.st('A')::uuid and started_on is not null), 'Measure', 'AC-CBS-004 the current step did not change');
select is(pg_temp.audits('billing_step.add', pg_temp.st('A')::uuid) + pg_temp.audits('billing_step.update', pg_temp.st('A')::uuid) + pg_temp.audits('billing_step.move', pg_temp.st('A')::uuid), 3, 'AC-CBS-004 each edit is audited');
select is(pg_temp.detail($q$select add_claim_billing_step(pg_temp.st('A')::uuid, 9, '{"name":"Far"}'::jsonb)$q$), '22023 stages-shape', 'AC-CBS-004 a position beyond the list is refused');
select is(pg_temp.detail($q$select add_claim_billing_step(pg_temp.st('A')::uuid, 1, '{"name":" "}'::jsonb)$q$), '23514 stage-name-missing', 'AC-CBS-004 a step needs a name');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 1), '{"target_days":0}'::jsonb)$q$), '23514 stage-target-invalid', 'AC-CBS-004 a target of 0 days is refused');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 1), '{"owner_role":"Wizard"}'::jsonb)$q$), '22P02 ', 'AC-CBS-004 an unknown owner role is refused');

select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('D', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim D is created');
select lives_ok($q$select add_claim_billing_step(pg_temp.st('D')::uuid, 0, '{"name":"Intake"}'::jsonb)$q$, 'AC-CBS-004 Finance adds a step before the current one');
select is(pg_temp.names('D'), 'Intake > Measure > Review > Approve', 'AC-CBS-004 the new step is first');
select is((select name from claim_billing_stages where claim_id = pg_temp.st('D')::uuid and started_on is not null), 'Intake', 'AC-CBS-004 the new first step is the current one and the clock moved to it');
select lives_ok($q$select remove_claim_billing_step(pg_temp.stage('D', 1), 'Not needed on this claim')$q$, 'AC-CBS-004 Finance removes the current step with a reason');
select is(pg_temp.names('D'), 'Measure > Review > Approve', 'AC-CBS-004 the list closed up');
select is((select started_on from claim_billing_stages where id = pg_temp.stage('D', 1)), current_date, 'AC-CBS-004 the next step is current from the removal day');
select is(pg_temp.audits('billing_step.remove', pg_temp.st('D')::uuid), 1, 'AC-CBS-007 the removal is audited');

-- ═══ AC-CBS-005: finished steps do not change (claim A: complete Measure) ═══════════════════════
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('A', 1), current_date)$q$, 'the Project Manager completes the first step of claim A');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 1), '{"owner_role":"Admin"}'::jsonb)$q$), '55000 stage-not-editable', 'AC-CBS-005 a completed step cannot be edited');
select is(pg_temp.detail($q$select add_claim_billing_step(pg_temp.st('A')::uuid, 0, '{"name":"Early"}'::jsonb)$q$), '55000 stage-not-editable', 'AC-CBS-005 no step can be added before a completed one');
select is(pg_temp.detail($q$select move_claim_billing_step(pg_temp.stage('A', 3), 1)$q$), '55000 stage-not-editable', 'AC-CBS-005 no step can be moved before a completed one');
select is(pg_temp.detail($q$select remove_claim_billing_step(pg_temp.stage('A', 1), 'trying to remove')$q$), '55000 stage-not-editable', 'AC-CBS-005 a completed step cannot be removed');
select is(pg_temp.names('A'), 'Measure > Approve > Joint survey > Review', 'AC-CBS-005 nothing changed after the refusals');

-- ═══ AC-CBS-006: a Project Manager sets owner role and target date only ═════════════════════════
select pg_temp.as_user('b4');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('A', 2), jsonb_build_object('owner_role', 'Finance', 'target_on', (current_date + 7)::text))$q$, 'AC-CBS-006 the project''s manager sets owner role and target date');
select is((select owner_role::text || ':' || target_on::text from claim_billing_stages where id = pg_temp.stage('A', 2)), 'Finance:' || (current_date + 7)::text, 'AC-CBS-006 the PM''s edit persisted');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 2), '{"name":"Renamed"}'::jsonb)$q$), '42501 ', 'AC-CBS-006 a Project Manager cannot rename a step');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 2), '{"target_days":4}'::jsonb)$q$), '42501 ', 'AC-CBS-006 a Project Manager cannot change target days');
select is(pg_temp.detail($q$select add_claim_billing_step(pg_temp.st('A')::uuid, 2, '{"name":"PM step"}'::jsonb)$q$), '42501 ', 'AC-CBS-006 a Project Manager cannot add a step');
select is(pg_temp.detail($q$select remove_claim_billing_step(pg_temp.stage('A', 4), 'PM removing a step')$q$), '42501 ', 'AC-CBS-006 a Project Manager cannot remove a step');
select is(pg_temp.detail($q$select move_claim_billing_step(pg_temp.stage('A', 4), 2)$q$), '42501 ', 'AC-CBS-006 a Project Manager cannot reorder');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 2), '{"owner_role":"Admin"}'::jsonb)$q$), '42501 ', 'AC-CBS-006 another project''s manager cannot edit this claim');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 2), '{"owner_role":"Admin"}'::jsonb)$q$), '42501 ', 'AC-CBS-006 an Engineer cannot edit a step');
select pg_temp.as_user('b8');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 2), '{"owner_role":"Admin"}'::jsonb)$q$), 'P0002 ', 'AC-CBS-006 another organisation cannot reach the step');

select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('B', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim B is created');
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('B', 1), current_date)$q$, 'claim B first step completes');
select pg_temp.as_user('b1');
select lives_ok($q$select skip_billing_stage(pg_temp.stage('B', 2), 'Not needed for this claim')$q$, 'claim B optional step is skipped');
select pg_temp.as_job();
select is(billing_stages_open(pg_temp.st('B')::uuid), true, 'AC-CBS-007 the gate is closed while the last step is open');
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select remove_claim_billing_step(pg_temp.stage('B', 3), 'PM waiving the last step')$q$), '42501 ', 'AC-CBS-007 a Project Manager cannot remove (waive) a step');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select remove_claim_billing_step(pg_temp.stage('B', 3), '  ')$q$), '23514 step-reason-invalid', 'AC-CBS-007 removal needs a reason');
select is(pg_temp.detail($q$select remove_claim_billing_step(pg_temp.stage('B', 3), 'ab')$q$), '23514 step-reason-invalid', 'AC-CBS-007 a reason under 3 characters is refused');
select pg_temp.as_job();
select is(billing_stages_open(pg_temp.st('B')::uuid), true, 'AC-CBS-007 the gate is still closed after the refusals');
select pg_temp.as_user('b1');
select lives_ok($q$select remove_claim_billing_step(pg_temp.stage('B', 3), 'Not part of this claim')$q$, 'AC-CBS-007 Finance removes the last open step with a reason');
select pg_temp.as_job();
select is(billing_stages_open(pg_temp.st('B')::uuid), false, 'AC-CBS-007 the gate opens once the last open step is removed');
select pg_temp.as_user('b1');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('B')::uuid, '26800000-0000-0000-0000-000000000f01')$q$, 'claim B has its evidence');
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('B')::uuid)$q$, 'AC-CBS-007 the invoice is raised after the waiver');

-- ═══ AC-CBS-008: an invoiced claim keeps its structure ═══════════════════════════════════════════
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select add_claim_billing_step(pg_temp.st('B')::uuid, 2, '{"name":"Late"}'::jsonb)$q$), '55000 claim-invoiced', 'AC-CBS-008 no step can be added to an invoiced claim');
select is(pg_temp.detail($q$select remove_claim_billing_step(pg_temp.stage('B', 2), 'late removal')$q$), '55000 claim-invoiced', 'AC-CBS-008 no step can be removed from an invoiced claim');
select is(pg_temp.detail($q$select move_claim_billing_step(pg_temp.stage('B', 2), 1)$q$), '55000 claim-invoiced', 'AC-CBS-008 no step can be moved on an invoiced claim');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('B', 2), '{"name":"Late rename"}'::jsonb)$q$), '55000 claim-invoiced', 'AC-CBS-008 a step of an invoiced claim cannot be renamed');
select pg_temp.as_job();
insert into claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, started_on, owner_role)
  values ('26800000-0000-0000-0000-0000000000a1', pg_temp.st('B')::uuid, '26800000-0000-0000-0000-0000000000c1', 3, 'Open after invoice', false, current_date, 'Admin');
create temp table _gate (k text primary key, v boolean not null) on commit drop;
insert into _gate select 'before', billing_stages_open(pg_temp.st('B')::uuid);
select pg_temp.as_user('b4');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('B', 3), jsonb_build_object('owner_role', 'Finance', 'target_on', (current_date + 3)::text))$q$, 'AC-CBS-008 owner role and target date stay editable on an invoiced claim''s open step');
select pg_temp.as_job();
select is(billing_stages_open(pg_temp.st('B')::uuid), (select v from _gate where k = 'before'), 'AC-CBS-008 that edit does not change the gate');

-- ═══ AC-CBS-003: load a template onto a claim ═══════════════════════════════════════════════════

select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('F', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim F is created');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T3')::uuid)$q$), '42501 ', 'AC-CBS-003 another project''s manager cannot load a template onto the claim');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T3')::uuid)$q$), '42501 ', 'AC-CBS-003 an Engineer cannot load a template onto a claim');
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T3')::uuid)$q$), '42501 ', 'AC-CBS-003 the project''s own manager cannot load a template onto the claim (it can shorten the list, a gate waiver)');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T0')::uuid)$q$), '22023 template-empty', 'AC-CBS-003 a template with no steps cannot be loaded onto a claim');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T2')::uuid)$q$), 'P0002 template-not-found', 'AC-CBS-003 an archived template cannot be loaded onto a claim');
select is((select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T3')::uuid)), 2, 'AC-CBS-003 Finance loads a template onto an untouched claim');
select is(pg_temp.names('F'), 'First > Second', 'AC-CBS-003 the claim''s steps were replaced');
select is((select started_on from claim_billing_stages where id = pg_temp.stage('F', 1)), current_date, 'AC-CBS-003 the first step is current from today');
select is((select started_on from claim_billing_stages where id = pg_temp.stage('F', 2)), null, 'AC-CBS-003 the second step has not started');
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('F', 1), current_date)$q$, 'claim F first step completes');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('F')::uuid, pg_temp.st('T3')::uuid)$q$), '55000 claim-steps-started', 'AC-CBS-003 a claim with a completed step refuses a template');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('B')::uuid, pg_temp.st('T3')::uuid)$q$), '55000 claim-steps-started', 'AC-CBS-003 an invoiced claim refuses a template');

select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('W', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim W is created');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('W')::uuid)$q$, 'claim W is withdrawn');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select load_billing_step_template_onto_claim(pg_temp.st('W')::uuid, pg_temp.st('T3')::uuid)$q$), '55000 claim-steps-started', 'AC-CBS-003 a withdrawn claim refuses a template');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('W', 1), '{"owner_role":"Admin"}'::jsonb)$q$), '55000 claim-withdrawn', 'AC-CBS-005 a withdrawn claim''s steps cannot be edited');

-- ═══ AC-CBS-009 / 010: the overdue job reads the step's own date and owner role ═══════════════════

select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('H', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim H is created');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('I', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim I is created');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('J', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim J is created');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('K', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim K is created');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('L', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim L is created');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('M', '26800000-0000-0000-0000-0000000000c1', '26800000-0000-0000-0000-000000000e01')$q$, 'claim M is created');
select pg_temp.as_job();
-- H: owner Project Manager, target 10 days, 30 days old
select pg_temp.backdate('H', 1, 30);
select is(notify_overdue_billing_stages(), 1, 'AC-CBS-010 the job finds the one overdue step');
select is(pg_temp.notices('b4'), 1, 'AC-CBS-010 an owner role of Project Manager reaches the project''s manager');
select is(pg_temp.notices('b5'), 0, 'AC-CBS-010 another Project Manager is not told');
select is(pg_temp.notices('b3') + pg_temp.notices('b1'), 0, 'AC-CBS-010 Admin and Finance are not told of a Project Manager step');
select is(notify_overdue_billing_stages(), 0, 'AC-CBS-010 a second run notifies nobody');
-- I: target date only (yesterday); J: date and days both (date wins); K: neither
select pg_temp.as_user('b1');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('I', 1), jsonb_build_object('target_days', null, 'target_on', (current_date - 1)::text))$q$, 'claim I gets only a target date, yesterday');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('J', 1), jsonb_build_object('target_on', (current_date - 2)::text))$q$, 'claim J keeps 10 days and gets a target date two days ago');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('K', 1), '{"target_days":null}'::jsonb)$q$, 'claim K has no target at all');
select pg_temp.as_job();
select pg_temp.backdate('I', 1, 5);
select pg_temp.backdate('J', 1, 0);
select pg_temp.backdate('K', 1, 40);
select is((select billing_stage_due_on(s) from claim_billing_stages s where s.id = pg_temp.stage('I', 1)), current_date - 1, 'AC-CBS-009 the due day is the step''s own target date');
select is((select billing_stage_due_on(s) from claim_billing_stages s where s.id = pg_temp.stage('J', 1)), current_date - 2, 'AC-CBS-009 the target date wins over target days');
select is((select billing_stage_due_on(s) from claim_billing_stages s where s.id = pg_temp.stage('K', 1)), null, 'AC-CBS-009 a step with neither has no due day');
-- L: owner Finance, overdue; M: owner Executive (nobody holds it), overdue
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('L', 1), current_date)$q$, 'claim L first step completes so the Finance step is current');
select pg_temp.as_user('b1');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('L', 2), '{"target_days":5}'::jsonb)$q$, 'claim L Finance step gets a 5-day target');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('M', 1), '{"owner_role":"Executive"}'::jsonb)$q$, 'claim M step is owned by a role nobody holds');
select pg_temp.as_job();
select pg_temp.backdate('L', 2, 20);
select pg_temp.backdate('M', 1, 30);
select is(notify_overdue_billing_stages(), 4, 'AC-CBS-009 the job notifies the four newly overdue steps (I, J, L, M) and not K');
select is(pg_temp.notices('b4'), 3, 'AC-CBS-009 the manager was told of H, I and J (a target date, and a date that wins over days)');
select is((select body from notifications n where n.owner_id = '26800000-0000-0000-0000-0000000000b4' and n.body like '%past its target date.' order by n.created_at limit 1) is not null, true, 'AC-CBS-009 a step with its own target date gets the target-date wording');
select is((select overdue_notified_at from claim_billing_stages where id = pg_temp.stage('K', 1)), null, 'AC-CBS-009 a step with no target is never stamped');
select is(pg_temp.notices('b1'), 1, 'AC-CBS-010 an owner role of Finance reaches Finance users (first)');
select is(pg_temp.notices('b2'), 1, 'AC-CBS-010 an owner role of Finance reaches Finance users (second)');
select is(pg_temp.notices('b3'), 1, 'AC-CBS-010 an owner role nobody holds falls back to the Admins');
select is(pg_temp.notices('b5') + pg_temp.notices('b8') + pg_temp.notices('b9'), 0, 'AC-CBS-010 no other Project Manager and no other organisation is told');
select is(notify_overdue_billing_stages(), 0, 'AC-CBS-010 a re-run notifies nobody again');

-- ═══ AC-CBS-011: waiting steps, project 2 (manager b5) ═════════════════════════════════════════
select pg_temp.as_user('b1');
select lives_ok($q$select set_billing_stage_template('26800000-0000-0000-0000-0000000000c2', '[{"name":"S1","owner_role":"Finance"},{"name":"S2","owner_role":"Finance"},{"name":"S3","owner_role":"Project Manager"}]'::jsonb)$q$, 'project 2 gets a list owned by Finance, Finance and Project Manager');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('X', '26800000-0000-0000-0000-0000000000c2', '26800000-0000-0000-0000-000000000e02')$q$, 'claim X is created');
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.new_claim('Y', '26800000-0000-0000-0000-0000000000c2', '26800000-0000-0000-0000-000000000e02')$q$, 'claim Y is created');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 2, 'AC-CBS-011 Finance sees the two claims waiting on Finance');
select pg_temp.as_user('b3');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 0, 'AC-CBS-011 an Admin is not waiting on a Finance step');
select pg_temp.as_user('b5');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 0, 'AC-CBS-011 the manager sees nothing while the steps wait on Finance');
select pg_temp.as_user('b1');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('X', 1), current_date)$q$, 'X step 1 completes');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 2, 'AC-CBS-011 Finance still has two: X step 2 and Y step 1');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('X', 2), current_date)$q$, 'X step 2 completes');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 1, 'AC-CBS-011 a completed step clears from the list with no other write');
select pg_temp.as_user('b5');
select is((select step_name from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 'S3', 'AC-CBS-011 the project''s manager now sees the step owned by their role');
select pg_temp.as_user('b4');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 0, 'AC-CBS-011 a manager of another project does not see it');
-- 2044: a step with a named owner is completed by that owner, never by the claim's creator (b1), so the manager completes it.
select pg_temp.as_user('b5');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('X', 3), current_date)$q$, 'X step 3 completes (by its owner, the project''s manager)');
select pg_temp.as_user('b5');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 0, 'AC-CBS-011 the manager''s pointer clears when the step completes');
select pg_temp.as_user('b1');
select lives_ok($q$select update_claim_billing_step(pg_temp.stage('Y', 1), '{"target_days":3}'::jsonb)$q$, 'Y step 1 gets a 3-day target');
select pg_temp.as_job();
select pg_temp.backdate('Y', 1, 10);
select pg_temp.as_user('b1');
select is((select days_over from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 7, 'AC-CBS-011 the pointer carries days over target');
select is((select due_on from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), current_date - 7, 'AC-CBS-011 the pointer carries the due date');
select is((select claim_id::text || ':' || step_name || ':' || days_over from overdue_billing_steps_by_claim('26800000-0000-0000-0000-0000000000c2')), pg_temp.st('Y') || ':S1:7', 'AC-CBS-011 the claim list marker names the overdue step and the days over');
select is((select count(*)::int from overdue_billing_steps_by_claim('26800000-0000-0000-0000-0000000000c2') where claim_id = pg_temp.st('X')::uuid), 0, 'AC-CBS-011 a claim with no overdue step has no marker');
select pg_temp.as_user('b9');
select is((select count(*)::int from my_waiting_billing_steps()), 0, 'AC-CBS-011 another organisation''s Finance sees none of these steps');
select pg_temp.as_user('b8');
select is((select count(*)::int from overdue_billing_steps_by_claim('26800000-0000-0000-0000-0000000000c2')), 0, 'AC-CBS-011 another organisation''s marker read returns nothing');
select pg_temp.as_user('b6');
select is((select count(*)::int from my_waiting_billing_steps()), 0, 'AC-CBS-011 an Engineer gets no pointers');
select pg_temp.as_user('b1');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('Y')::uuid)$q$, 'claim Y is withdrawn');
select is((select count(*)::int from my_waiting_billing_steps() where project_id = '26800000-0000-0000-0000-0000000000c2'), 0, 'AC-CBS-011 a withdrawn claim''s steps are not pointers');

-- ═══ grants ═══════════════════════════════════════════════════════════════════════════════════
select ok(not has_function_privilege('anon', 'public.remove_claim_billing_step(uuid,text)', 'execute'), 'anon cannot call remove_claim_billing_step');
select ok(not has_function_privilege('authenticated', 'public.renumber_claim_steps(uuid,uuid[],date)', 'execute'), 'authenticated cannot call the renumber helper');
select ok(not has_function_privilege('authenticated', 'public.lock_claim_for_step_edit(uuid,boolean)', 'execute'), 'authenticated cannot call the claim lock helper');
select * from finish();
rollback;
