-- 1360_billing_stage_targets.test.sql — billing stages: target days, overdue notice, optional (skippable) stages (#2592).
-- AC-BSX-001, 002, 004..011 (docs/specs/billing-stage-targets.spec.md). Ids: 13600000-… (synthetic).
-- Org a1: b1 fin1 (claims), b2 fin2 (raises), b3 admin, b4 pm (manager of project c1), b6 engineer. Org a2 (foreign): b8 admin, b9 finance.
begin;
create extension if not exists pgtap;
select plan(76);

insert into organizations (id, name, default_currency, default_timezone) values
  ('13600000-0000-0000-0000-0000000000a1', 'BSX Org A', 'IDR', 'UTC'),
  ('13600000-0000-0000-0000-0000000000a2', 'BSX Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('13600000-0000-0000-0000-0000000000b1', 'bsx-fin1@example.com'),
  ('13600000-0000-0000-0000-0000000000b2', 'bsx-fin2@example.com'),
  ('13600000-0000-0000-0000-0000000000b3', 'bsx-admin@example.com'),
  ('13600000-0000-0000-0000-0000000000b4', 'bsx-pm@example.com'),
  ('13600000-0000-0000-0000-0000000000b6', 'bsx-eng@example.com'),
  ('13600000-0000-0000-0000-0000000000b8', 'bsx-fadmin@example.com'),
  ('13600000-0000-0000-0000-0000000000b9', 'bsx-ffin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13600000-0000-0000-0000-0000000000b1', '13600000-0000-0000-0000-0000000000a1', 'BSX Finance 1', 'bsx-fin1@example.com', 'Finance', 'active'),
  ('13600000-0000-0000-0000-0000000000b2', '13600000-0000-0000-0000-0000000000a1', 'BSX Finance 2', 'bsx-fin2@example.com', 'Finance', 'active'),
  ('13600000-0000-0000-0000-0000000000b3', '13600000-0000-0000-0000-0000000000a1', 'BSX Admin', 'bsx-admin@example.com', 'Admin', 'active'),
  ('13600000-0000-0000-0000-0000000000b4', '13600000-0000-0000-0000-0000000000a1', 'BSX PM', 'bsx-pm@example.com', 'Project Manager', 'active'),
  ('13600000-0000-0000-0000-0000000000b6', '13600000-0000-0000-0000-0000000000a1', 'BSX Engineer', 'bsx-eng@example.com', 'Engineer', 'active'),
  ('13600000-0000-0000-0000-0000000000b8', '13600000-0000-0000-0000-0000000000a2', 'BSX Foreign Admin', 'bsx-fadmin@example.com', 'Admin', 'active'),
  ('13600000-0000-0000-0000-0000000000b9', '13600000-0000-0000-0000-0000000000a2', 'BSX Foreign Finance', 'bsx-ffin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('13600000-0000-0000-0000-0000000000cc', '13600000-0000-0000-0000-0000000000a1', 'BSX Client', 'Client'),
  ('13600000-0000-0000-0000-0000000000cd', '13600000-0000-0000-0000-0000000000a2', 'BSX Foreign Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('13600000-0000-0000-0000-0000000000c1', '13600000-0000-0000-0000-0000000000a1', 'BSX managed', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '13600000-0000-0000-0000-0000000000cc', '13600000-0000-0000-0000-0000000000b4'),
  ('13600000-0000-0000-0000-0000000000c2', '13600000-0000-0000-0000-0000000000a1', 'BSX unmanaged', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '13600000-0000-0000-0000-0000000000cc', null),
  ('13600000-0000-0000-0000-0000000000c3', '13600000-0000-0000-0000-0000000000a2', 'BSX foreign', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '13600000-0000-0000-0000-0000000000cd', null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('13600000-0000-0000-0000-000000000e01', '13600000-0000-0000-0000-0000000000a1', '13600000-0000-0000-0000-0000000000c1', 'TRENCH', 'Trench', 'm', 1000, 10000),
  ('13600000-0000-0000-0000-000000000e02', '13600000-0000-0000-0000-0000000000a1', '13600000-0000-0000-0000-0000000000c2', 'TRENCH', 'Trench', 'm', 1000, 10000),
  ('13600000-0000-0000-0000-000000000e03', '13600000-0000-0000-0000-0000000000a2', '13600000-0000-0000-0000-0000000000c3', 'TRENCH', 'Trench', 'm', 1000, 10000);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('13600000-0000-0000-0000-000000000f01', '13600000-0000-0000-0000-0000000000a1', '13600000-0000-0000-0000-0000000000c1', 'Contract', 'BSX measurement sheet', 'Approved',
   '13600000-0000-0000-0000-0000000000b1', '13600000-0000-0000-0000-0000000000a1/13600000-0000-0000-0000-0000000000c1/13600000-0000-0000-0000-000000000f01/doc.pdf');

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
  perform set_config('request.jwt.claims', '{"sub":"13600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
-- The scheduler has no user JWT: run the job as the table owner with no caller.
create function pg_temp.as_job() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.stage(p_claim text, p_pos int) returns uuid language sql as $$
  select s.id from claim_billing_stages s where s.claim_id = pg_temp.st(p_claim)::uuid and s.position = p_pos $$;
create function pg_temp.notices(p_user text) returns int language sql as $$
  select count(*)::int from notifications n where n.owner_id = ('13600000-0000-0000-0000-0000000000' || p_user)::uuid
     and n.title = 'Billing step is overdue' $$;
create function pg_temp.audits(p_action text, p_id uuid) returns int language sql security definer as $$
  select count(*)::int from audit_events where action = p_action and entity_id = p_id $$;
create function pg_temp.backdate(p_claim text, p_pos int, p_days int) returns void language sql as $$
  update claim_billing_stages set started_on = current_date - p_days where id = pg_temp.stage(p_claim, p_pos) $$;

-- ── AC-BSX-002: only Finance or an Admin saves a list with targets ────────────────────────────────
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"x","target_days":5}]'::jsonb)$q$),
  '42501 ', 'AC-BSX-002 a Project Manager cannot save a list with targets');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"x","optional":true}]'::jsonb)$q$),
  '42501 ', 'AC-BSX-002 an Engineer cannot save a list with optional stages');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"x","target_days":0}]'::jsonb)$q$),
  '23514 stage-target-invalid', 'a target of 0 days is refused');
select is(pg_temp.detail($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"x","target_days":366}]'::jsonb)$q$),
  '23514 stage-target-invalid', 'a target over 365 days is refused');
select is(pg_temp.detail($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"x","target_days":2.5}]'::jsonb)$q$),
  '23514 stage-target-invalid', 'a fractional target is refused');
select is(pg_temp.detail($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"x","target_days":"ten"}]'::jsonb)$q$),
  '23514 stage-target-invalid', 'a non-numeric target is refused');

-- ── AC-BSX-001: the list carries target and optional; a claim copies them; a later edit does not change it ──────────
select lives_ok($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[
  {"name":"Measure","target_days":10},
  {"name":"Review","target_days":5,"optional":true},
  {"name":"Approve"}]'::jsonb)$q$, 'AC-BSX-001 Finance saves a list with a target and an optional stage');
select is((select string_agg(name || ':' || coalesce(target_days::text, '-') || ':' || optional::text, ' > ' order by position)
             from billing_stage_templates where project_id = '13600000-0000-0000-0000-0000000000c1'),
  'Measure:10:false > Review:5:true > Approve:-:false', 'AC-BSX-001 the list stores target and optional per stage');
select lives_ok($q$insert into _state select 'pc1', create_progress_claim('13600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'AC-BSX-001 Finance creates a claim');
select is((select string_agg(name || ':' || coalesce(target_days::text, '-') || ':' || optional::text, ' > ' order by position)
             from claim_billing_stages where claim_id = pg_temp.st('pc1')::uuid),
  'Measure:10:false > Review:5:true > Approve:-:false', 'AC-BSX-001 the claim copies each stage''s target and optional flag');
select lives_ok($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[{"name":"Other","target_days":99}]'::jsonb)$q$,
  'AC-BSX-001 Finance edits the list afterwards');
select is((select string_agg(name || ':' || coalesce(target_days::text, '-') || ':' || optional::text, ' > ' order by position)
             from claim_billing_stages where claim_id = pg_temp.st('pc1')::uuid),
  'Measure:10:false > Review:5:true > Approve:-:false', 'AC-BSX-001 the claim already made keeps its copy');
select lives_ok($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c1', '[
  {"name":"Measure","target_days":10},{"name":"Review","target_days":5,"optional":true},{"name":"Approve"}]'::jsonb)$q$,
  'the three-stage list is restored for the next claims');
select is(pg_temp.detail($q$update claim_billing_stages set skipped_on = current_date$q$), '42501 ', 'no client write grant on the new columns');

-- ── claim A: skip rules, order, dates, gate success ───────────────────────────────────────────────
select lives_ok($q$insert into _state select 'pcA', create_progress_claim('13600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'claim A is created');
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), 'not applicable here')$q$),
  '42501 ', 'AC-BSX-011 a Project Manager cannot mark a stage not needed');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), 'not applicable here')$q$),
  '42501 ', 'AC-BSX-011 an Engineer cannot mark a stage not needed');
select pg_temp.as_user('b8');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), 'not applicable here')$q$),
  'P0002 ', 'AC-BSX-011 a foreign Admin cannot reach the stage');
select is((select count(*)::int from claim_billing_stages), 0, 'AC-BSX-011 a foreign Admin sees no stages of this organisation');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), 'not applicable here')$q$),
  '55000 stage-not-skippable', 'AC-BSX-008 an optional stage ahead of the current one cannot be skipped');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 1), 'not applicable here')$q$),
  '55000 stage-not-skippable', 'AC-BSX-008 a stage that is not optional cannot be skipped');
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('pcA', 1), current_date)$q$, 'the Project Manager completes the first stage');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), '  ')$q$),
  '23514 skip-reason-invalid', 'AC-BSX-008 a blank reason is refused');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), ' ab ')$q$),
  '23514 skip-reason-invalid', 'AC-BSX-008 a reason under 3 characters is refused');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), repeat('x', 501))$q$),
  '23514 skip-reason-invalid', 'AC-BSX-008 a reason over 500 characters is refused');
select is((select skipped_on from claim_billing_stages where id = pg_temp.stage('pcA', 2)), null, 'AC-BSX-008 nothing changed after the refusals');
select lives_ok($q$select skip_billing_stage(pg_temp.stage('pcA', 2), 'Not needed for this claim')$q$, 'AC-BSX-007 Finance marks the optional current stage not needed');
select is((select skipped_on::text || '|' || skipped_by::text || '|' || skipped_reason from claim_billing_stages where id = pg_temp.stage('pcA', 2)),
  current_date::text || '|13600000-0000-0000-0000-0000000000b1|Not needed for this claim', 'AC-BSX-007 date, person and reason are stored');
select is((select started_on from claim_billing_stages where id = pg_temp.stage('pcA', 3)), current_date,
  'AC-BSX-007 the next stage is current from the skip date');
select is(pg_temp.audits('billing_stage.skip', pg_temp.st('pcA')::uuid), 1,
  'AC-BSX-007 the skip is audited');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 2), 'Not needed again')$q$),
  '55000 stage-not-skippable', 'AC-BSX-008 a skipped stage cannot be skipped twice');
select is(pg_temp.detail($q$select skip_billing_stage(pg_temp.stage('pcA', 1), 'Not needed again')$q$),
  '55000 stage-not-skippable', 'AC-BSX-008 a completed stage cannot be skipped');
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pcA', 2), current_date)$q$),
  '55000 stage-already-skipped', 'FR-BSX-024 a skipped stage cannot be completed');
select is(pg_temp.detail($q$select note_billing_stage(pg_temp.stage('pcA', 2), 'late note')$q$),
  '55000 stage-already-skipped', 'FR-BSX-024 a skipped stage takes no note');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pcA', 3), current_date - 1)$q$),
  '22023 stage-date-before-previous', 'AC-BSX-010 the next stage cannot complete before the skip date');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('pcA', 3), current_date)$q$, 'AC-BSX-010 it completes on the skip date');
-- AC-BSX-006 (part): completed and skipped stages are never notified, however old
select pg_temp.as_job();
update claim_billing_stages set started_on = current_date - 30 where claim_id = pg_temp.st('pcA')::uuid and position in (1, 2);

select pg_temp.as_user('b1');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('pcA')::uuid, '13600000-0000-0000-0000-000000000f01')$q$, 'claim A has its evidence');
select pg_temp.as_job();
select is(pg_temp.detail($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('13600000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('pcA'), 'bsx-kA', 'erpnext', 'create', 'pending')$q$),
  'ok', 'AC-BSX-009 the ERP outbox command is accepted when the only unfinished stage was skipped');
delete from external_command_outbox where idempotency_key = 'bsx-kA';
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pcA')::uuid)$q$,
  'AC-BSX-009 the native invoice is raised when the only unfinished stage was skipped');

-- ── claim B: a required stage still open refuses; order with an open optional stage ────────────────
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pcB', create_progress_claim('13600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'claim B is created');
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pcB', 3), current_date)$q$),
  '55000 stage-out-of-order', 'AC-BSX-010 a later stage cannot complete while an earlier optional stage is still open');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('pcB', 1), current_date)$q$, 'claim B first stage completes');
select pg_temp.as_user('b1');
select lives_ok($q$select skip_billing_stage(pg_temp.stage('pcB', 2), 'Not needed for this claim')$q$, 'claim B optional stage is skipped');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('pcB')::uuid, '13600000-0000-0000-0000-000000000f01')$q$, 'claim B has its evidence');
select pg_temp.as_job();
select is(pg_temp.detail($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('13600000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('pcB'), 'bsx-kB', 'erpnext', 'create', 'pending')$q$),
  '55000 billing-stages-incomplete', 'AC-BSX-009 the ERP outbox command is refused while a required stage is open');
select pg_temp.as_user('b2');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('pcB')::uuid)$q$),
  '55000 billing-stages-incomplete', 'AC-BSX-009 the native invoice is refused while a required stage is open');

-- ── the overdue job: AC-BSX-004..006 ──────────────────────────────────────────────────────────────
-- Claim C on the managed project; claims in states that must never notify.
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pcC', create_progress_claim('13600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'claim C is created');
select lives_ok($q$insert into _state select 'pcW', create_progress_claim('13600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'claim W is created');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('pcW')::uuid)$q$, 'claim W is withdrawn');
select pg_temp.as_job();
select pg_temp.backdate('pcW', 1, 40);
-- an organisation project with no targets at all: nothing to read, nothing sent
select pg_temp.as_user('b1');
select lives_ok($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c2', '[{"name":"No target"},{"name":"Also none"}]'::jsonb)$q$, 'a list with no targets is saved');
select lives_ok($q$insert into _state select 'pcN', create_progress_claim('13600000-0000-0000-0000-0000000000c2', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e02","quantity":1}]'::jsonb)::text$q$, 'claim N (no targets) is created');
select pg_temp.as_job();
select pg_temp.backdate('pcN', 1, 400);
select is((select count(*)::int from notifications where org_id = '13600000-0000-0000-0000-0000000000a1' and title = 'Billing step is overdue'), 0, 'no notification exists before the job');
select is(notify_overdue_billing_stages(), 0,
  'AC-BSX-006 no target, completed, skipped or withdrawn: the job finds nothing (a no-op for an organisation with no targets)');
select is((select count(*)::int from notifications where org_id = '13600000-0000-0000-0000-0000000000a1' and title = 'Billing step is overdue'), 0, 'AC-BSX-006 nothing was sent');
select is((select count(*)::int from claim_billing_stages where overdue_notified_at is not null), 0, 'AC-BSX-006 nothing was stamped');

select pg_temp.backdate('pcC', 1, 10);
select is(notify_overdue_billing_stages(), 0, 'AC-BSX-004 a stage exactly at its target is not overdue');
select pg_temp.backdate('pcC', 1, 11);
select is(notify_overdue_billing_stages(), 1, 'AC-BSX-004 a stage one day past its target is overdue: the job notifies');
select is(pg_temp.notices('b4'), 1, 'AC-BSX-004 the claim''s project manager has one notice');
select is((select body from notifications n where n.owner_id = '13600000-0000-0000-0000-0000000000b4' and n.title = 'Billing step is overdue'),
  'Billing step "Measure" of a progress claim on BSX managed is 1 day past its 10-day target.', 'AC-BSX-004 the notice names the stage, the project and the days over');
select is((select metadata -> 'entity' ->> 'type' || ':' || (metadata -> 'entity' ->> 'id') from notifications n
            where n.owner_id = '13600000-0000-0000-0000-0000000000b4' and n.title = 'Billing step is overdue'),
  'project:13600000-0000-0000-0000-0000000000c1', 'FR-BSX-013 the notice opens the claim''s project');
select isnt((select overdue_notified_at from claim_billing_stages where id = pg_temp.stage('pcC', 1)), null, 'AC-BSX-004 the stage is stamped');
select is(notify_overdue_billing_stages(), 0, 'AC-BSX-004 a second run notifies nobody');
select is(pg_temp.notices('b4'), 1, 'AC-BSX-004 the manager still has one notice');
select is(pg_temp.audits('billing_stage.overdue', pg_temp.st('pcC')::uuid), 1, 'FR-BSX-012 an audit row is written once');

-- AC-BSX-005: no active manager -> the organisation's Admins; another organisation is not told
select pg_temp.as_user('b1');
select lives_ok($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c2', '[{"name":"Review","target_days":3}]'::jsonb)$q$, 'the unmanaged project gets a target');
select lives_ok($q$insert into _state select 'pcD', create_progress_claim('13600000-0000-0000-0000-0000000000c2', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e02","quantity":1}]'::jsonb)::text$q$, 'claim D (no manager) is created');
select pg_temp.as_user('b8');
select lives_ok($q$select set_billing_stage_template('13600000-0000-0000-0000-0000000000c3', '[{"name":"Foreign step","target_days":2}]'::jsonb)$q$, 'the foreign Admin sets a target');
select pg_temp.as_user('b9');
select lives_ok($q$insert into _state select 'pcF', create_progress_claim('13600000-0000-0000-0000-0000000000c3', 'progress',
  p_lines => '[{"boq_item_id":"13600000-0000-0000-0000-000000000e03","quantity":1}]'::jsonb)::text$q$, 'the foreign claim is created');
select pg_temp.as_job();
select pg_temp.backdate('pcD', 1, 4);
select pg_temp.backdate('pcF', 1, 5);
select is(notify_overdue_billing_stages(), 2, 'AC-BSX-005 the job handles the two newly overdue stages');
select is(pg_temp.notices('b3'), 1, 'AC-BSX-005 with no project manager the Admin is notified once');
select is(pg_temp.notices('b4'), 1, 'AC-BSX-005 the manager of the other project got no second notice');
select is(pg_temp.notices('b8'), 1, 'AC-BSX-005 the other organisation''s Admin is told of its own stage');
select is((select count(*)::int from notifications n where n.owner_id = '13600000-0000-0000-0000-0000000000b3' and n.body like '%Foreign step%'), 0,
  'AC-BSX-005 no notice crosses organisations');

select ok(not has_function_privilege('authenticated', 'public.notify_overdue_billing_stages()', 'execute'),
  'authenticated clients cannot run the overdue job');
select ok(not has_function_privilege('anon', 'public.skip_billing_stage(uuid,text)', 'execute'), 'anon cannot call skip_billing_stage');
select is((select count(*)::int from cron.job where jobname = 'billing-stage-overdue'), 1, 'the daily job is scheduled');
select * from finish();
rollback;
