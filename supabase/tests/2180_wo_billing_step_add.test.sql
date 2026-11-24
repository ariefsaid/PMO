-- 2180_wo_billing_step_add.test.sql — add a step to one work order's billing checklist, and save that list as a template (wo-checklist-edit).
-- Migrations under test: 2180 (add_work_order_step) and 2181 (the organisation switch, a null place as the end of the list, and
-- save_work_order_steps_as_template, the server-side copy). AC-WCE-001..006 (docs/specs/wo-checklist-edit.spec.md). Ids: 21800000-… (synthetic).
-- Step names are generic on purpose: the list is organisation data.
-- Org a1: b1 admin, b2 finance (finance_officer), b3 PM of c1 (project_manager), b4 survey (quantity_surveyor), b5 quality manager
-- (sees, does not run), b6 engineer, b7 foreman (light), b8 legacy Finance (no key), b9 legacy Engineer (no key), bb another PM.
-- Org a2 (foreign): b0 admin.
-- POLARITY (the last section, inside this one transaction): each rule is broken in the live function text, the refusal that guards it
-- disappears, and the rule is restored — the mutation evidence runs with every pgTAP run instead of once by hand.
begin;
create extension if not exists pgtap;
select plan(142);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('21800000-0000-0000-0000-0000000000a1', 'WCE Org A', 'IDR', 'UTC', true),
  ('21800000-0000-0000-0000-0000000000a2', 'WCE Org B', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('21800000-0000-0000-0000-0000000000b0', 'wce-fadmin@example.com'),
  ('21800000-0000-0000-0000-0000000000b1', 'wce-admin@example.com'),
  ('21800000-0000-0000-0000-0000000000b2', 'wce-fin@example.com'),
  ('21800000-0000-0000-0000-0000000000b3', 'wce-pm@example.com'),
  ('21800000-0000-0000-0000-0000000000b4', 'wce-survey@example.com'),
  ('21800000-0000-0000-0000-0000000000b5', 'wce-quality@example.com'),
  ('21800000-0000-0000-0000-0000000000b6', 'wce-eng@example.com'),
  ('21800000-0000-0000-0000-0000000000b7', 'wce-foreman@example.com'),
  ('21800000-0000-0000-0000-0000000000b8', 'wce-legacy-fin@example.com'),
  ('21800000-0000-0000-0000-0000000000b9', 'wce-legacy-eng@example.com'),
  ('21800000-0000-0000-0000-0000000000bb', 'wce-pm2@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('21800000-0000-0000-0000-0000000000b0', '21800000-0000-0000-0000-0000000000a2', 'WCE Foreign Admin', 'wce-fadmin@example.com', 'Admin', 'active', 'administrator'),
  ('21800000-0000-0000-0000-0000000000b1', '21800000-0000-0000-0000-0000000000a1', 'WCE Admin', 'wce-admin@example.com', 'Admin', 'active', 'administrator'),
  ('21800000-0000-0000-0000-0000000000b2', '21800000-0000-0000-0000-0000000000a1', 'WCE Finance', 'wce-fin@example.com', 'Finance', 'active', 'finance_officer'),
  ('21800000-0000-0000-0000-0000000000b3', '21800000-0000-0000-0000-0000000000a1', 'WCE PM', 'wce-pm@example.com', 'Project Manager', 'active', 'project_manager'),
  ('21800000-0000-0000-0000-0000000000b4', '21800000-0000-0000-0000-0000000000a1', 'WCE Survey', 'wce-survey@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('21800000-0000-0000-0000-0000000000b5', '21800000-0000-0000-0000-0000000000a1', 'WCE Quality', 'wce-quality@example.com', 'Project Manager', 'active', 'quality_manager'),
  ('21800000-0000-0000-0000-0000000000b6', '21800000-0000-0000-0000-0000000000a1', 'WCE Engineer', 'wce-eng@example.com', 'Engineer', 'active', 'engineer'),
  ('21800000-0000-0000-0000-0000000000b7', '21800000-0000-0000-0000-0000000000a1', 'WCE Foreman', 'wce-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('21800000-0000-0000-0000-0000000000b8', '21800000-0000-0000-0000-0000000000a1', 'WCE Legacy Finance', 'wce-legacy-fin@example.com', 'Finance', 'active', null),
  ('21800000-0000-0000-0000-0000000000b9', '21800000-0000-0000-0000-0000000000a1', 'WCE Legacy Engineer', 'wce-legacy-eng@example.com', 'Engineer', 'active', null),
  ('21800000-0000-0000-0000-0000000000bb', '21800000-0000-0000-0000-0000000000a1', 'WCE PM Two', 'wce-pm2@example.com', 'Project Manager', 'active', 'project_manager');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('21800000-0000-0000-0000-0000000000c1', '21800000-0000-0000-0000-0000000000a1', 'WCE project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, '21800000-0000-0000-0000-0000000000b3');
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('21800000-0000-0000-0000-000000000f01', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'Acceptance', 'WCE survey sheet', 'Approved',
   '21800000-0000-0000-0000-0000000000b2', '21800000-0000-0000-0000-0000000000a1/21800000-0000-0000-0000-0000000000c1/21800000-0000-0000-0000-000000000f01/doc.pdf');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"21800000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
-- sqlstate and the refusal code (the text before the colon), or 'ok'
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare m text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics m = message_text; return sqlstate || ' ' || split_part(m, ':', 1); end $$;
-- the SQL text of one add_work_order_step call (a null place and step become SQL NULL)
create function pg_temp.call(p_wo text, p_after int, p_step jsonb) returns text language sql as $$
  select format('select add_work_order_step(%L, %L, %L::jsonb)', p_wo, p_after, p_step::text) $$;
-- the SQL text of one save_work_order_steps_as_template call
create function pg_temp.save(p_wo text, p_name text) returns text language sql as $$
  select format('select save_work_order_steps_as_template(%L, %L)', p_wo, p_name) $$;
create function pg_temp.step(p_wo text, p_pos int) returns text language sql as $$
  select s.id::text from work_order_billing_steps s where s.work_order_id = p_wo::uuid and s.position = p_pos $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;
-- position:name:owner:target:optional, in order (the content a template copies)
create function pg_temp.shape(p_wo text) returns text language sql as $$
  select string_agg(s.position || ':' || s.name || ':' || coalesce(s.owner_role_key, '-') || ':' || coalesce(s.target_days::text, '-') || ':' || s.optional::text,
                    ',' order by s.position)
    from work_order_billing_steps s where s.work_order_id = p_wo::uuid $$;
create function pg_temp.tplshape(p_name text) returns text language sql as $$
  select string_agg(s.position || ':' || s.name || ':' || coalesce(s.owner_role_key, '-') || ':' || coalesce(s.target_days::text, '-') || ':' || s.optional::text,
                    ',' order by s.position)
    from billing_step_templates t join billing_step_template_steps s on s.template_id = t.id
   where t.name = p_name and t.archived_at is null $$;
-- position:hidden+hidden of a template's steps
create function pg_temp.tplhidden(p_name text) returns text language sql as $$
  select string_agg(s.position || ':' || coalesce(array_to_string(s.hidden_from_role_keys, '+'), ''), ',' order by s.position)
    from billing_step_templates t join billing_step_template_steps s on s.template_id = t.id
   where t.name = p_name and t.archived_at is null $$;
-- step position:document:required of a template's checklist slots
create function pg_temp.tpldocs(p_name text) returns text language sql as $$
  select coalesce(string_agg(s.position || ':' || d.name || ':' || d.required::text, ',' order by s.position, d.position), '-')
    from billing_step_templates t
    join billing_step_template_steps s on s.template_id = t.id
    left join billing_step_template_documents d on d.step_id = s.id
   where t.name = p_name and t.archived_at is null $$;
-- position:name:status, in order (open = not started yet, current = started and not finished)
create function pg_temp.states(p_wo text) returns text language sql as $$
  select string_agg(s.position || ':' || s.name || ':' || case when s.done_on is not null then 'done' when s.skipped_on is not null then 'skipped'
                                                                when s.started_on is not null then 'current' else 'open' end, ',' order by s.position)
    from work_order_billing_steps s where s.work_order_id = p_wo::uuid $$;
-- the positions of the steps the current caller may read
create function pg_temp.seen(p_wo text) returns text language sql as $$
  select coalesce(string_agg(s.position::text, ',' order by s.position), '-') from work_order_billing_steps s where s.work_order_id = p_wo::uuid $$;
-- polarity helpers (last section)
create function pg_temp.def(p_sig text) returns text language sql as $$ select pg_get_functiondef(p_sig::regprocedure) $$;
create function pg_temp.redefine(p_sql text) returns void language plpgsql as $$ begin execute p_sql; end $$;
create function pg_temp.mutate(p_sig text, p_from text, p_to text) returns void language plpgsql as $$
declare v text := pg_temp.def(p_sig);
begin
  if position(p_from in v) = 0 then raise exception 'mutation target not in %: %', p_sig, p_from; end if;
  execute replace(v, p_from, p_to);
end $$;

-- ── fixtures: a work order issued before any default (no list), a three-step default template, two work orders issued from it ──────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21800000-0000-0000-0000-000000000030', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE none', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now() where id = '21800000-0000-0000-0000-000000000030';
select is((select count(*)::int from work_order_billing_steps where work_order_id = '21800000-0000-0000-0000-000000000030'), 0,
  'AC-WCE-005 a work order issued before a default template exists has no list');

select pg_temp.as_user('b1');
select is((select save_billing_step_template(null, 'WCE template',
  '[{"name":"Survey","target_days":3,"documents":[{"name":"Survey sheet","required":true}]},{"name":"Certified quantity","target_days":5},{"name":"Invoice pack","optional":true}]'::jsonb)) is not null, true,
  'AC-WCE-001 Admin saves a three-step template');
select is((select set_billing_step_template_roles((select id from billing_step_templates where name = 'WCE template'),
  '[{"position":1,"owner_role_key":"quantity_surveyor"},{"position":2,"owner_role_key":"finance_officer","hidden_from_role_keys":["finance_officer"]},{"position":3,"owner_role_key":"finance_officer"}]'::jsonb)), 3,
  'AC-WCE-001 with an owner job role on every step, and one step hidden from Finance');
select is(pg_temp.err(format('select set_default_billing_step_template(%L)', (select id from billing_step_templates where name = 'WCE template'))), 'ok',
  'AC-WCE-001 Admin chooses it as the default');
reset role;

insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21800000-0000-0000-0000-000000000031', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE one', 'Draft', 10000, 'exclusive', 0),
  ('21800000-0000-0000-0000-000000000032', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE two', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now()
 where id in ('21800000-0000-0000-0000-000000000031', '21800000-0000-0000-0000-000000000032');
select is(pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  '1:Survey:quantity_surveyor:3:false,2:Certified quantity:finance_officer:5:false,3:Invoice pack:finance_officer:-:true',
  'AC-WCE-001 the default list is copied at issue');
select is(pg_temp.states('21800000-0000-0000-0000-000000000031'), '1:Survey:current,2:Certified quantity:open,3:Invoice pack:open', 'AC-WCE-001 its first step is current');

-- ── FR-WCE-006: the switch is off for an organisation that never set it, and nothing can be edited ──────────────────────────────────
select is((select work_order_checklist_enabled from organizations where id = '21800000-0000-0000-0000-0000000000a1'), false,
  'FR-WCE-006 checklist editing is off for an organisation that never set it');
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 1, '{"name":"Joint survey sign-off"}'::jsonb)), '55000 WBS_CHECKLIST_OFF',
  'FR-WCE-006 with the switch off a runner cannot add a step');
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Remote site')), '55000 WBS_CHECKLIST_OFF',
  'FR-WCE-006 nor can Finance save the list as a template');
reset role;
select is(pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  '1:Survey:quantity_surveyor:3:false,2:Certified quantity:finance_officer:5:false,3:Invoice pack:finance_officer:-:true',
  'FR-WCE-006 nothing is written while the switch is off');
select is((select count(*)::int from billing_step_templates where name = 'Remote site'), 0, 'FR-WCE-006 and no template is made');

-- ── FR-WCE-006: who switches it, and what the switch records ─────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('b4');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), '42501 WBS_CHECKLIST_SETTING', 'FR-WCE-006 a runner who is neither Finance nor an Admin cannot switch it on');
select pg_temp.as_user('b3');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), '42501 WBS_CHECKLIST_SETTING', 'FR-WCE-006 nor can the project''s manager');
select pg_temp.as_user('b2');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), '42501 WBS_CHECKLIST_SETTING', 'FR-WCE-006 Finance cannot switch it on');
select pg_temp.as_user('b7');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), '42501 LIGHT_ACCOUNT', 'FR-WCE-006 a field account is refused');
select pg_temp.as_user('b0');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), 'ok', 'FR-WCE-006 another organisation''s Admin switches his own organisation''s');
select pg_temp.as_user('b1');
select is(pg_temp.err('select set_org_work_order_checklist_edit(null)'), '22023 WBS_CHECKLIST_SETTING', 'FR-WCE-006 the switch is on or off, never empty');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), 'ok', 'FR-WCE-006 an Admin switches it on');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), 'ok', 'FR-WCE-006 saving the same value again');
select pg_temp.as_user('b1');
select is(pg_temp.err('select set_org_work_order_checklist_edit(false)'), 'ok', 'FR-WCE-006 an Admin switches it off');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), 'ok', 'FR-WCE-006 and on again');
reset role;
select is((select count(*)::int from audit_events where action = 'org.setting.change' and org_id = '21800000-0000-0000-0000-0000000000a1'
             and detail->>'setting' = 'organizations.work_order_checklist_enabled' and detail->>'to' = 'true'), 2,
  'FR-WCE-006 each change to on is audited once (the unchanged second save writes none)');
select is((select count(*)::int from audit_events where action = 'org.setting.change' and org_id = '21800000-0000-0000-0000-0000000000a1'
             and detail->>'setting' = 'organizations.work_order_checklist_enabled' and detail->>'to' = 'false'), 1,
  'FR-WCE-006 and the change to off');
select is((select work_order_checklist_enabled from organizations where id = '21800000-0000-0000-0000-0000000000a1'), true, 'FR-WCE-006 the switch is on');
select is((select count(*)::int from audit_events where action = 'org.setting.change' and org_id = '21800000-0000-0000-0000-0000000000a2'
             and detail->>'setting' = 'organizations.work_order_checklist_enabled'), 1, 'FR-WCE-006 the other organisation''s change is its own');

-- ── AC-WCE-001: a permitted user adds a step to one work order's checklist; no other work order changes ────────────────────────────────
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 1,
  '{"name":"Joint survey sign-off","owner_role_key":"quantity_surveyor","target_days":2,"optional":true}'::jsonb)), 'ok',
  'AC-WCE-001 a person who runs the checklist adds "Joint survey sign-off" after the current step');
select is(pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  '1:Survey:quantity_surveyor:3:false,2:Joint survey sign-off:quantity_surveyor:2:true,3:Certified quantity:finance_officer:5:false,4:Invoice pack:finance_officer:-:true',
  'AC-WCE-001 the step appears on that work order''s checklist at the chosen position, with its owner job role');
select is((select '(' || s.org_id || ',' || s.project_id || ',' || coalesce(s.assignee_id::text, '-') || ',' || coalesce(s.done_on::text, '-')
                   || ',' || coalesce(s.skipped_on::text, '-') || ')'
              from work_order_billing_steps s where s.id = pg_temp.step('21800000-0000-0000-0000-000000000031', 2)::uuid),
  '(21800000-0000-0000-0000-0000000000a1,21800000-0000-0000-0000-0000000000c1,-,-,-)',
  'AC-WCE-001 the work order''s organisation and project are stamped server-side');
select is(pg_temp.shape('21800000-0000-0000-0000-000000000032'),
  '1:Survey:quantity_surveyor:3:false,2:Certified quantity:finance_officer:5:false,3:Invoice pack:finance_officer:-:true',
  'AC-WCE-001 no other work order''s checklist changes');
select is((select count(*)::int from work_order_billing_steps where work_order_id = '21800000-0000-0000-0000-000000000030'), 0,
  'AC-WCE-001 nor a work order without a list');
reset role;
select is((select count(*)::int from notifications where owner_id = '21800000-0000-0000-0000-0000000000b4' and body like '%WCE one%'), 1,
  'AC-WBS-007 an added step that is not current tells nobody');
select is((select count(*)::int from audit_events where action = 'wo_billing_step.add'
             and entity_id = '21800000-0000-0000-0000-000000000031' and actor_id = '21800000-0000-0000-0000-0000000000b4'
             and detail->>'name' = 'Joint survey sign-off' and (detail->>'position')::int = 2), 1,
  'AC-WCE-001 the addition is audited');
select pg_temp.as_user('b2');
select is(pg_temp.seen('21800000-0000-0000-0000-000000000031'), '1,2,4', 'AC-WBS-004 control: Finance does not read the step hidden from Finance');
reset role;

-- ── AC-WCE-003: who may not run the checklist is refused, and nothing is written ────────────────────────────────────────────────────────
select pg_temp.as_user('b5');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Refused"}'::jsonb)), '42501 WBS_STEP_ADD_RIGHT',
  'AC-WCE-003 a reader who may not run the checklist is refused');
select pg_temp.as_user('b6');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Refused"}'::jsonb)), '42501 WBS_STEP_ADD_RIGHT',
  'AC-WCE-003 a role without the see right is refused the same way');
select pg_temp.as_user('b9');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Refused"}'::jsonb)), '42501 WBS_STEP_ADD_RIGHT',
  'AC-WCE-003 a person with no job role and no writer level is refused');
select pg_temp.as_user('b7');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Refused"}'::jsonb)), '42501 LIGHT_ACCOUNT',
  'AC-WCE-003 a field account is refused');
select pg_temp.as_user('bb');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Refused"}'::jsonb)), '42501 WBS_STEP_ADD_PM',
  'AC-WCE-003 another project''s manager is refused');
select pg_temp.as_user('b0');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Refused"}'::jsonb)), 'P0002 WBS_ORDER_NOT_FOUND',
  'AC-WCE-003 another organisation cannot add to this work order');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-0000000000ff', 0, '{"name":"Refused"}'::jsonb)), 'P0002 WBS_ORDER_NOT_FOUND',
  'AC-WCE-003 a work order that does not exist is not found');
reset role;
select is(pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  '1:Survey:quantity_surveyor:3:false,2:Joint survey sign-off:quantity_surveyor:2:true,3:Certified quantity:finance_officer:5:false,4:Invoice pack:finance_officer:-:true',
  'AC-WCE-003 nothing is written by a refused call');
select is((select count(*)::int from audit_events where action = 'wo_billing_step.add'), 1, 'AC-WCE-003 and nothing is audited');

-- ── AC-WCE-003: a malformed step or place is refused before anything is written ─────────────────────────────────────────────────────────
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, null)), '23514 WBS_STEP_NAME', 'AC-WCE-003 a step without a body is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '[]'::jsonb)), '23514 WBS_STEP_NAME', 'AC-WCE-003 a step that is not an object is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"owner_role_key":"quantity_surveyor"}'::jsonb)), '23514 WBS_STEP_NAME',
  'AC-WCE-003 a step without a name is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"   "}'::jsonb)), '23514 WBS_STEP_NAME', 'AC-WCE-003 a blank name is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, jsonb_build_object('name', repeat('x', 121)))), '23514 WBS_STEP_NAME',
  'AC-WCE-003 a name over 120 characters is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Owner","owner_role_key":"nonsense"}'::jsonb)), '23514 WBS_STEP_ROLE',
  'AC-WCE-003 an unknown owner job role is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Owner","owner_role_key":"foreman"}'::jsonb)), '23514 WBS_STEP_ROLE',
  'AC-WCE-003 a field account role cannot own a step');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Target","target_days":0}'::jsonb)), '23514 WBS_STEP_DAYS',
  'AC-WCE-003 a target of 0 days is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Target","target_days":366}'::jsonb)), '23514 WBS_STEP_DAYS',
  'AC-WCE-003 a target over 365 days is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Target","target_days":"3"}'::jsonb)), '23514 WBS_STEP_DAYS',
  'AC-WCE-003 a target that is not a number is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 4, '{"name":"Target","target_days":2.5}'::jsonb)), '23514 WBS_STEP_DAYS',
  'AC-WCE-003 a target that is not a whole number is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', -1, '{"name":"Place"}'::jsonb)), '22023 WBS_STEP_SHAPE', 'AC-WCE-003 a negative place is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 5, '{"name":"Place"}'::jsonb)), '22023 WBS_STEP_SHAPE', 'AC-WCE-003 a place past the end of the list is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 0, '{"name":"Place"}'::jsonb)), '55000 WBS_STEP_CLOSED',
  'AC-WCE-005 a step cannot go before the current step');
reset role;
select is(pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  '1:Survey:quantity_surveyor:3:false,2:Joint survey sign-off:quantity_surveyor:2:true,3:Certified quantity:finance_officer:5:false,4:Invoice pack:finance_officer:-:true',
  'AC-WCE-003 a refused step leaves the list as it was');

-- ── AC-WCE-002: the list is saved as a template by a database copy, hidden rule and slots included; the next work order starts from it ────
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Remote site')), '42501 WBS_SETTER_ROLE',
  'AC-WCE-002 only Finance or an Admin can save a template');
select pg_temp.as_user('b7');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Remote site')), '42501 LIGHT_ACCOUNT', 'AC-WCE-002 a field account is refused');
select pg_temp.as_user('b0');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Remote site')), 'P0002 WBS_ORDER_NOT_FOUND',
  'AC-WCE-002 another organisation cannot save this work order''s list');
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000030', 'Empty')), '22023 WBS_TEMPLATE_EMPTY',
  'AC-WCE-002 a work order with no steps has nothing to save');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', '   ')), '23514 WBS_TEMPLATE_NAME', 'AC-WCE-002 a blank template name is refused');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', repeat('x', 121))), '23514 WBS_TEMPLATE_NAME',
  'AC-WCE-002 a template name over 120 characters is refused');
select is(pg_temp.seen('21800000-0000-0000-0000-000000000031'), '1,2,4', 'AC-WCE-002 control: Finance cannot see one step of the list being saved');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Remote site')), 'ok',
  'AC-WCE-002 Finance saves the work order''s checklist as a template named "Remote site"');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', ' remote SITE ')), '23505 WBS_TEMPLATE_TAKEN',
  'AC-WCE-002 an active template of the same name, case and surrounding spaces aside, is refused');
reset role;
select is((select count(*)::int from billing_step_templates where lower(btrim(name)) = 'remote site' and archived_at is null), 1,
  'AC-WCE-002 the refused second save made no second template');
select is((select string_agg(name, ',' order by name) from billing_step_templates where archived_at is null), 'Remote site,WCE template',
  'AC-WCE-002 the template list offers "Remote site"');
select is(pg_temp.tplshape('Remote site'), pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  'AC-WCE-002 with the same steps in the same order, owner job roles included');
select is(pg_temp.tplhidden('Remote site'), '1:,2:,3:finance_officer,4:', 'AC-WCE-002 and each step''s hidden-from rule, which the page never receives');
select is(pg_temp.tpldocs('Remote site'), '1:Survey sheet:true', 'AC-WCE-002 and the checklist slots');
select is((select count(*)::int from audit_events where action = 'wo_billing_steps.save_as_template' and actor_id = '21800000-0000-0000-0000-0000000000b2'
             and detail->>'name' = 'Remote site' and (detail->>'steps')::int = 4 and (detail->>'documents')::int = 1), 1, 'AC-WCE-002 the save is audited');
select pg_temp.as_user('b1');
select is(pg_temp.err(format($$select set_default_billing_step_template(%L)$$, (select id from billing_step_templates where name = 'Remote site'))), 'ok',
  'AC-WCE-002 Admin makes "Remote site" the default');
reset role;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21800000-0000-0000-0000-000000000033', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE three', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now() where id = '21800000-0000-0000-0000-000000000033';
select is(pg_temp.shape('21800000-0000-0000-0000-000000000033'), pg_temp.shape('21800000-0000-0000-0000-000000000031'),
  'AC-WCE-002 the next work order starts from the list actually used');
select pg_temp.as_user('b2');
select is(pg_temp.seen('21800000-0000-0000-0000-000000000033'), '1,2,4', 'AC-WCE-002 the role the step is hidden from still does not see it on the next work order');
select pg_temp.as_user('b4');
select is(pg_temp.seen('21800000-0000-0000-0000-000000000033'), '1,2,3,4', 'AC-WBS-004 control: another role reads every step');
reset role;

-- ── AC-WCE-004: the claim keeps its own steps ─────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from claim_billing_stages), 0, 'AC-WCE-004 adding to a work order writes no claim step: the lists stay separate');
select is((select position('work_order_billing_steps' in prosrc) from pg_proc where proname = 'billing_stages_open' and pronamespace = 'public'::regnamespace), 0,
  'AC-WCE-004 the invoicing gate does not read the work-order list');

-- ── AC-WCE-005: the current step stays current; a new step goes after it and opens in turn ─────────────────────────────────────────────────
select pg_temp.as_user('b4');
select is(pg_temp.err(format('select attach_work_order_step_document(%L, (select id from work_order_billing_step_documents where step_id = %L::uuid), %L)',
  pg_temp.step('21800000-0000-0000-0000-000000000031', 1), pg_temp.step('21800000-0000-0000-0000-000000000031', 1), '21800000-0000-0000-0000-000000000f01')), 'ok',
  'AC-WCE-005 the owner attaches the required survey sheet');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('21800000-0000-0000-0000-000000000031', 1), pg_temp.today())), 'ok',
  'AC-WCE-005 and finishes the first step');
select is(pg_temp.states('21800000-0000-0000-0000-000000000031'), '1:Survey:done,2:Joint survey sign-off:current,3:Certified quantity:open,4:Invoice pack:open',
  'AC-WCE-005 finishing a step opens the added step');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 2, '{"name":"Joint survey report","owner_role_key":"quantity_surveyor"}'::jsonb)), 'ok',
  'AC-WCE-005 a step goes after the current step');
select is(pg_temp.states('21800000-0000-0000-0000-000000000031'),
  '1:Survey:done,2:Joint survey sign-off:current,3:Joint survey report:open,4:Certified quantity:open,5:Invoice pack:open',
  'AC-WCE-005 the later steps move down one place');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 1, '{"name":"Too early"}'::jsonb)), '55000 WBS_STEP_CLOSED',
  'AC-WCE-005 a step cannot go before the current step');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 0, '{"name":"Too early"}'::jsonb)), '55000 WBS_STEP_CLOSED',
  'AC-WCE-005 nor before a finished step');
reset role;
select is((select started_on from work_order_billing_steps where id = pg_temp.step('21800000-0000-0000-0000-000000000031', 2)::uuid), pg_temp.today(),
  'AC-WCE-005 the current step keeps the day it opened');
select is((select started_on from work_order_billing_steps where id = pg_temp.step('21800000-0000-0000-0000-000000000031', 3)::uuid), null,
  'AC-WBS-007 an added step opens only when the step before it is finished');
select is((select done_on from work_order_billing_steps where id = pg_temp.step('21800000-0000-0000-0000-000000000031', 1)::uuid), pg_temp.today(),
  'AC-WCE-005 a finished step is not moved or changed');

-- ── AC-WCE-005: a work order with no list, or with every step finished, opens the added step and tells its people ───────────────────────────
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000030', 0, '{"name":"Kick-off record","owner_role_key":"quantity_surveyor"}'::jsonb)), 'ok',
  'AC-WCE-005 a work order with no list takes its first step');
reset role;
select is(pg_temp.states('21800000-0000-0000-0000-000000000030'), '1:Kick-off record:current', 'AC-WCE-005 and that step is current from today');
select is((select count(*)::int from notifications where owner_id = '21800000-0000-0000-0000-0000000000b4' and title = 'A billing step is waiting for you'
             and body like '%Kick-off record%' and body like '%WCE none%'), 1, 'AC-WBS-007 the holder of the new current step is told');
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000030', 0, '{"name":"Too early"}'::jsonb)), '55000 WBS_STEP_CLOSED',
  'AC-WCE-005 once a step is current, nothing goes before it');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000030', 1, '{"name":"Close-out note"}'::jsonb)), 'ok', 'AC-WCE-005 a second step goes after it');
reset role;
select is(pg_temp.states('21800000-0000-0000-0000-000000000030'), '1:Kick-off record:current,2:Close-out note:open', 'AC-WCE-005 ...and waits for the first');

select pg_temp.as_user('b4');
select is(pg_temp.err(format('select attach_work_order_step_document(%L, (select id from work_order_billing_step_documents where step_id = %L::uuid), %L)',
  pg_temp.step('21800000-0000-0000-0000-000000000032', 1), pg_temp.step('21800000-0000-0000-0000-000000000032', 1), '21800000-0000-0000-0000-000000000f01')), 'ok',
  'AC-WCE-005 the survey holder attaches the sheet on the second work order');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('21800000-0000-0000-0000-000000000032', 1), pg_temp.today())), 'ok',
  'AC-WCE-005 and finishes its first step');
select pg_temp.as_user('b1');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('21800000-0000-0000-0000-000000000032', 2), pg_temp.today())), 'ok',
  'AC-WCE-005 an Admin finishes the second step');
select is(pg_temp.err(format('select skip_work_order_step(%L)', pg_temp.step('21800000-0000-0000-0000-000000000032', 3))), 'ok', 'AC-WCE-005 and skips the optional last one');
select is(pg_temp.states('21800000-0000-0000-0000-000000000032'), '1:Survey:done,2:Certified quantity:done,3:Invoice pack:skipped',
  'AC-WCE-005 control: every step of the second work order is finished');
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', 3, '{"name":"Archive note","owner_role_key":"quantity_surveyor"}'::jsonb)), 'ok',
  'AC-WCE-005 a step can follow a finished list');
reset role;
select is(pg_temp.states('21800000-0000-0000-0000-000000000032'), '1:Survey:done,2:Certified quantity:done,3:Invoice pack:skipped,4:Archive note:current',
  'AC-WCE-005 ...and becomes current from today');
select is((select count(*)::int from notifications where owner_id = '21800000-0000-0000-0000-0000000000b4' and title = 'A billing step is waiting for you'
             and body like '%Archive note%' and body like '%WCE two%'), 1, 'AC-WBS-007 its holder is told');

-- ── AC-WCE-005: a null place is the end of the list, even when the viewer cannot see the last steps ──────────────────────────────────────────
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', null, '{"name":"Last words"}'::jsonb)), 'ok',
  'AC-WCE-005 a null place is the end of the list');
reset role;
select is(pg_temp.states('21800000-0000-0000-0000-000000000032'),
  '1:Survey:done,2:Certified quantity:done,3:Invoice pack:skipped,4:Archive note:current,5:Last words:open', 'AC-WCE-005 the step lands after the last one');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21800000-0000-0000-0000-000000000037', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE hidden tail', 'Issued', 10000, 'exclusive', 0);
insert into work_order_billing_steps (org_id, work_order_id, project_id, position, name, started_on, done_on, done_by, hidden_from_role_keys) values
  ('21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-000000000037', '21800000-0000-0000-0000-0000000000c1', 1, 'Plan', current_date - 4, current_date - 3, '21800000-0000-0000-0000-0000000000b2', '{}'),
  ('21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-000000000037', '21800000-0000-0000-0000-0000000000c1', 2, 'Measure', current_date - 3, current_date - 2, '21800000-0000-0000-0000-0000000000b2', '{}');
insert into work_order_billing_steps (org_id, work_order_id, project_id, position, name, started_on, owner_role_key, hidden_from_role_keys) values
  ('21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-000000000037', '21800000-0000-0000-0000-0000000000c1', 3, 'Report', current_date - 2, 'quantity_surveyor', '{finance_officer}'),
  ('21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-000000000037', '21800000-0000-0000-0000-0000000000c1', 4, 'File', null, 'quantity_surveyor', '{finance_officer}');
select pg_temp.as_user('b2');
select is(pg_temp.seen('21800000-0000-0000-0000-000000000037'), '1,2', 'AC-WCE-005 control: Finance sees only the two finished steps');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000037', 2, '{"name":"Counted from what is visible"}'::jsonb)), '55000 WBS_STEP_CLOSED',
  'AC-WCE-005 the visible row count is not the end of the list');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000037', null, '{"name":"Appended"}'::jsonb)), 'ok',
  'AC-WCE-005 the end is: the step goes after the steps the viewer cannot see');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000037', 5, '{"name":"Past the end"}'::jsonb)), '22023 WBS_STEP_SHAPE',
  'AC-WCE-005 a place past the real end is still refused');
reset role;
select is(pg_temp.states('21800000-0000-0000-0000-000000000037'), '1:Plan:done,2:Measure:done,3:Report:current,4:File:open,5:Appended:open',
  'AC-WCE-005 ...after position 4, the one the viewer could not name');

-- ── AC-WCE-003: the project's own manager and a Finance-level person with no job role may add; a Draft work order takes no step ─────────────
select pg_temp.as_user('bb');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', 5, '{"name":"Other manager"}'::jsonb)), '42501 WBS_STEP_ADD_PM',
  'AC-WCE-003 another project''s manager is refused on this project');
select pg_temp.as_user('b3');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', 5, '{"name":"Manager step"}'::jsonb)), 'ok', 'AC-WCE-003 the project''s manager adds a step');
select pg_temp.as_user('b8');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', null, '{"name":"Legacy step"}'::jsonb)), 'ok',
  'AC-WCE-003 a Finance-level person with no job role keeps today''s writer levels');
reset role;
select is(pg_temp.states('21800000-0000-0000-0000-000000000032'),
  '1:Survey:done,2:Certified quantity:done,3:Invoice pack:skipped,4:Archive note:current,5:Last words:open,6:Manager step:open,7:Legacy step:open',
  'AC-WCE-003 ...each after the last step');

insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21800000-0000-0000-0000-000000000035', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE draft', 'Draft', 10000, 'exclusive', 0);
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000035', 0, '{"name":"Draft step"}'::jsonb)), '55000 WBS_NOT_ISSUED',
  'AC-WBS-007 a step cannot be added while the work order is a Draft');
reset role;
select is((select count(*)::int from work_order_billing_steps where work_order_id = '21800000-0000-0000-0000-000000000035'), 0, 'AC-WBS-007 ...and nothing is written');

-- ── AC-WCE-005: the last place of a 19-step list can be used; a 21st step is refused, with a named place or the end ───────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21800000-0000-0000-0000-000000000036', '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-0000000000c1', 'WCE forced', 'Issued', 10000, 'exclusive', 0);
insert into work_order_billing_steps (org_id, work_order_id, project_id, position, name, started_on)
select '21800000-0000-0000-0000-0000000000a1', '21800000-0000-0000-0000-000000000036', '21800000-0000-0000-0000-0000000000c1', g, 'Forced ' || g,
       case when g = 1 then current_date end
  from generate_series(1, 19) as g;
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000036', 18, '{"name":"Twentieth"}'::jsonb)), 'ok', 'AC-WCE-005 the last place of a 19-step list can be used');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000036', 20, '{"name":"Twenty-first"}'::jsonb)), '22023 WBS_STEP_SHAPE', 'AC-WCE-005 a 21st step is refused');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000036', null, '{"name":"Twenty-first"}'::jsonb)), '22023 WBS_STEP_SHAPE',
  'AC-WCE-005 with the end as the place too');
reset role;
select is((select string_agg(s.position || ':' || s.name, ',' order by s.position) from work_order_billing_steps s
             where s.work_order_id = '21800000-0000-0000-0000-000000000036' and s.position >= 17),
  '17:Forced 17,18:Forced 18,19:Twentieth,20:Forced 19', 'AC-WCE-005 the moved steps keep their order');
select is((select count(*)::int from work_order_billing_steps where work_order_id = '21800000-0000-0000-0000-000000000036'), 20, 'AC-WCE-005 a work order has at most 20 billing steps');

-- ── grants: signed-in members can call the three functions (the bodies decide who may); anon cannot ─────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.add_work_order_step(uuid,integer,jsonb)', 'execute'), 'AC-WCE-003 anon cannot call add_work_order_step');
select ok(has_function_privilege('authenticated', 'public.add_work_order_step(uuid,integer,jsonb)', 'execute'), 'AC-WCE-001 a signed-in member can call it; the body decides who may add');
select ok(not has_function_privilege('anon', 'public.save_work_order_steps_as_template(uuid,text)', 'execute'), 'AC-WCE-002 anon cannot call save_work_order_steps_as_template');
select ok(not has_function_privilege('anon', 'public.set_org_work_order_checklist_edit(boolean)', 'execute'), 'FR-WCE-006 anon cannot call set_org_work_order_checklist_edit');

-- ── polarity: break each rule in the live function text, watch its refusal disappear, restore it ─────────────────────────────────────────────
-- Every mutation lives in this transaction and is restored; nothing here reaches another session.
select set_config('wce.gate', pg_temp.def('public.actor_may_run_billing_steps()'), false);
select set_config('wce.light', pg_temp.def('public.assert_not_light()'), false);
select set_config('wce.add', pg_temp.def('public.add_work_order_step(uuid,integer,jsonb)'), false);
select set_config('wce.save', pg_temp.def('public.save_work_order_steps_as_template(uuid,text)'), false);

-- run right (the refusal asserted by 'AC-WCE-003 a reader who may not run the checklist is refused')
select pg_temp.redefine($f$create or replace function public.actor_may_run_billing_steps() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$ select true $$;$f$);
select pg_temp.as_user('b6');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 5, '{"name":"Mutated right"}'::jsonb)), 'ok',
  'POLARITY run right: with the run gate answering true, a reader who may not run the checklist adds a step');
reset role;
select pg_temp.redefine(current_setting('wce.gate'));
select pg_temp.as_user('b6');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 6, '{"name":"Still refused"}'::jsonb)), '42501 WBS_STEP_ADD_RIGHT',
  'POLARITY run right: restored, the reader is refused again');
reset role;

-- field account (the refusal asserted by 'AC-WCE-003 a field account is refused')
select pg_temp.redefine($f$create or replace function public.assert_not_light() returns boolean
  language plpgsql stable security invoker set search_path = pg_catalog, public as $$ begin return true; end $$;$f$);
select pg_temp.as_user('b7');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 6, '{"name":"Mutated light"}'::jsonb)), '42501 WBS_STEP_ADD_RIGHT',
  'POLARITY field account: with the field-account guard inert the foreman is refused by the run right instead of LIGHT_ACCOUNT');
reset role;
select pg_temp.redefine(current_setting('wce.light'));
select pg_temp.as_user('b7');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 6, '{"name":"Still light"}'::jsonb)), '42501 LIGHT_ACCOUNT',
  'POLARITY field account: restored');
reset role;

-- organisation (the refusal asserted by 'AC-WCE-003 another organisation cannot add to this work order')
select pg_temp.mutate('public.add_work_order_step(uuid,integer,jsonb)', 'w.org_id = v_org', 'true');
select pg_temp.as_user('b0');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 6, '{"name":"Mutated scope"}'::jsonb)), 'ok',
  'POLARITY organisation: with the work order lookup unbound from the caller''s organisation, another organisation''s Admin adds a step');
reset role;
select pg_temp.redefine(current_setting('wce.add'));
select pg_temp.as_user('b0');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 7, '{"name":"Still foreign"}'::jsonb)), 'P0002 WBS_ORDER_NOT_FOUND',
  'POLARITY organisation: restored');
reset role;

-- project rule (the refusal asserted by 'AC-WCE-003 another project''s manager is refused')
select pg_temp.mutate('public.add_work_order_step(uuid,integer,jsonb)', 'public.auth_role() = ''Project Manager''', 'false');
select pg_temp.as_user('bb');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', 7, '{"name":"Mutated pm"}'::jsonb)), 'ok',
  'POLARITY project rule: with the manager test removed, another project''s manager adds a step');
reset role;
select pg_temp.redefine(current_setting('wce.add'));
select pg_temp.as_user('bb');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000032', 8, '{"name":"Still not his"}'::jsonb)), '42501 WBS_STEP_ADD_PM',
  'POLARITY project rule: restored');
reset role;

-- order (the refusal asserted by 'AC-WCE-005 a step cannot go before the current step')
select pg_temp.mutate('public.add_work_order_step(uuid,integer,jsonb)', 'v_after < coalesce(v_cur, v_k)', 'false');
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 0, '{"name":"Mutated order"}'::jsonb)), 'ok',
  'POLARITY order: with the place rule removed, a step goes before the current one');
reset role;
select pg_temp.redefine(current_setting('wce.add'));
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 0, '{"name":"Still too early"}'::jsonb)), '55000 WBS_STEP_CLOSED',
  'POLARITY order: restored');
reset role;

-- the switch (the refusals asserted by 'FR-WCE-006 with the switch off ...')
select pg_temp.as_user('b1');
select is(pg_temp.err('select set_org_work_order_checklist_edit(false)'), 'ok', 'POLARITY switch: the organisation''s switch goes off');
reset role;
select pg_temp.mutate('public.add_work_order_step(uuid,integer,jsonb)',
  'not coalesce((select o.work_order_checklist_enabled from public.organizations o where o.id = v_org), false)', 'false');
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 8, '{"name":"Mutated switch"}'::jsonb)), 'ok',
  'POLARITY switch: with the switch test removed from the add, a runner adds a step while the organisation''s switch is off');
reset role;
select pg_temp.redefine(current_setting('wce.add'));
select pg_temp.mutate('public.save_work_order_steps_as_template(uuid,text)',
  'not coalesce((select o.work_order_checklist_enabled from public.organizations o where o.id = v_org), false)', 'false');
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Mutated switch')), 'ok',
  'POLARITY switch: with the switch test removed from the save, Finance saves a template while the organisation''s switch is off');
reset role;
select pg_temp.redefine(current_setting('wce.save'));
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.call('21800000-0000-0000-0000-000000000031', 9, '{"name":"Still off"}'::jsonb)), '55000 WBS_CHECKLIST_OFF',
  'POLARITY switch: restored on the add');
select pg_temp.as_user('b2');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Still off')), '55000 WBS_CHECKLIST_OFF', 'POLARITY switch: restored on the save');
select pg_temp.as_user('b1');
select is(pg_temp.err('select set_org_work_order_checklist_edit(true)'), 'ok', 'POLARITY switch: back on');
reset role;

-- who may save (the refusal asserted by 'AC-WCE-002 only Finance or an Admin can save a template')
select pg_temp.mutate('public.save_work_order_steps_as_template(uuid,text)', 'v_role not in (''Admin'',''Finance'')', 'false');
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Mutated save')), 'ok', 'POLARITY save right: with the role test removed, a runner saves a template');
reset role;
select pg_temp.redefine(current_setting('wce.save'));
select pg_temp.as_user('b4');
select is(pg_temp.err(pg_temp.save('21800000-0000-0000-0000-000000000031', 'Still not his')), '42501 WBS_SETTER_ROLE', 'POLARITY save right: restored');
reset role;

select * from finish();
rollback;
