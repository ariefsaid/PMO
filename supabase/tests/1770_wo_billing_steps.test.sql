-- 1770_wo_billing_steps.test.sql — a work order's billing step list: copy at issue, hidden-from, rights, acting rules, notices, waiting read.
-- Migrations under test: 1770-1774 (docs/specs/billing-steps.spec.md). AC-WBS-001..005, 007..010. Ids: 17700000-… (synthetic).
-- Org a1: b1 admin, b2 finance (finance_officer), b3 PM of c1 (project_manager), b4 survey (quantity_surveyor), b5 quality manager,
-- b6 engineer, b7 foreman (light), b8 legacy Finance (no key), b9 legacy Engineer (no key), b11 other PM, b12 project control manager.
-- Org a2 (foreign): b0 admin. Step names are generic on purpose: the list is organisation data.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   actor_may_see_billing_steps returns true ................ 'AC-WBS-004 a role without the see right ...' and the engineer/legacy-engineer reads
--   actor_may_run_billing_steps returns true ................ 'AC-WBS-005 a reader without the run right ... is refused'
--   drop the `not coalesce(... any (p_hidden) ...)` term in wo_step_readable ... 'AC-WBS-004 a role the step is hidden from reads ...' (steps and documents)
--   drop `perform public.assert_not_light()` from complete_work_order_step ........ 'AC-WBS-005 a field account is refused ... complete'
begin;
create extension if not exists pgtap;
select plan(67);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('17700000-0000-0000-0000-0000000000a1', 'WBS Org A', 'IDR', 'UTC', true),
  ('17700000-0000-0000-0000-0000000000a2', 'WBS Org B', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('17700000-0000-0000-0000-0000000000b0', 'wbs-fadmin@example.com'),
  ('17700000-0000-0000-0000-0000000000b1', 'wbs-admin@example.com'),
  ('17700000-0000-0000-0000-0000000000b2', 'wbs-fin@example.com'),
  ('17700000-0000-0000-0000-0000000000b3', 'wbs-pm@example.com'),
  ('17700000-0000-0000-0000-0000000000b4', 'wbs-survey@example.com'),
  ('17700000-0000-0000-0000-0000000000b5', 'wbs-quality@example.com'),
  ('17700000-0000-0000-0000-0000000000b6', 'wbs-eng@example.com'),
  ('17700000-0000-0000-0000-0000000000b7', 'wbs-foreman@example.com'),
  ('17700000-0000-0000-0000-0000000000b8', 'wbs-legacy-fin@example.com'),
  ('17700000-0000-0000-0000-0000000000b9', 'wbs-legacy-eng@example.com'),
  ('17700000-0000-0000-0000-0000000000bb', 'wbs-pm2@example.com'),
  ('17700000-0000-0000-0000-0000000000bc', 'wbs-pcm@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('17700000-0000-0000-0000-0000000000b0', '17700000-0000-0000-0000-0000000000a2', 'WBS Foreign Admin', 'wbs-fadmin@example.com', 'Admin', 'active', 'administrator'),
  ('17700000-0000-0000-0000-0000000000b1', '17700000-0000-0000-0000-0000000000a1', 'WBS Admin', 'wbs-admin@example.com', 'Admin', 'active', 'administrator'),
  ('17700000-0000-0000-0000-0000000000b2', '17700000-0000-0000-0000-0000000000a1', 'WBS Finance', 'wbs-fin@example.com', 'Finance', 'active', 'finance_officer'),
  ('17700000-0000-0000-0000-0000000000b3', '17700000-0000-0000-0000-0000000000a1', 'WBS PM', 'wbs-pm@example.com', 'Project Manager', 'active', 'project_manager'),
  ('17700000-0000-0000-0000-0000000000b4', '17700000-0000-0000-0000-0000000000a1', 'WBS Survey', 'wbs-survey@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('17700000-0000-0000-0000-0000000000b5', '17700000-0000-0000-0000-0000000000a1', 'WBS Quality', 'wbs-quality@example.com', 'Project Manager', 'active', 'quality_manager'),
  ('17700000-0000-0000-0000-0000000000b6', '17700000-0000-0000-0000-0000000000a1', 'WBS Engineer', 'wbs-eng@example.com', 'Engineer', 'active', 'engineer'),
  ('17700000-0000-0000-0000-0000000000b7', '17700000-0000-0000-0000-0000000000a1', 'WBS Foreman', 'wbs-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('17700000-0000-0000-0000-0000000000b8', '17700000-0000-0000-0000-0000000000a1', 'WBS Legacy Finance', 'wbs-legacy-fin@example.com', 'Finance', 'active', null),
  ('17700000-0000-0000-0000-0000000000b9', '17700000-0000-0000-0000-0000000000a1', 'WBS Legacy Engineer', 'wbs-legacy-eng@example.com', 'Engineer', 'active', null),
  ('17700000-0000-0000-0000-0000000000bb', '17700000-0000-0000-0000-0000000000a1', 'WBS PM Two', 'wbs-pm2@example.com', 'Project Manager', 'active', 'project_manager'),
  ('17700000-0000-0000-0000-0000000000bc', '17700000-0000-0000-0000-0000000000a1', 'WBS Project Control', 'wbs-pcm@example.com', 'Project Manager', 'active', 'project_control_manager');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('17700000-0000-0000-0000-0000000000c1', '17700000-0000-0000-0000-0000000000a1', 'WBS project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, '17700000-0000-0000-0000-0000000000b3');
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('17700000-0000-0000-0000-000000000f01', '17700000-0000-0000-0000-0000000000a1', '17700000-0000-0000-0000-0000000000c1', 'Acceptance', 'WBS survey sheet', 'Approved',
   '17700000-0000-0000-0000-0000000000b2', '17700000-0000-0000-0000-0000000000a1/17700000-0000-0000-0000-0000000000c1/f01/doc.pdf'),
  ('17700000-0000-0000-0000-000000000f02', '17700000-0000-0000-0000-0000000000a1', '17700000-0000-0000-0000-0000000000c1', 'Acceptance', 'WBS draft sheet', 'Draft',
   '17700000-0000-0000-0000-0000000000b2', '17700000-0000-0000-0000-0000000000a1/17700000-0000-0000-0000-0000000000c1/f02/doc.pdf');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"17700000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
-- sqlstate and the refusal code (the text before the colon), or 'ok'
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare m text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics m = message_text; return sqlstate || ' ' || split_part(m, ':', 1); end $$;
create function pg_temp.step(p_wo text, p_pos int) returns uuid language sql as $$
  select s.id from work_order_billing_steps s where s.work_order_id = p_wo::uuid and s.position = p_pos $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;

-- ── AC-WBS-002: no default template, no list, no error ─────────────────────────────────────────────────────────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17700000-0000-0000-0000-000000000031', '17700000-0000-0000-0000-0000000000a1', '17700000-0000-0000-0000-0000000000c1', 'WBS none', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now() where id = '17700000-0000-0000-0000-000000000031';
select is((select count(*)::int from work_order_billing_steps), 0, 'AC-WBS-002 with no default template an issued work order has no list');

-- the organisation's template (Admin saves it; roles set through the roles function)
select pg_temp.as_user('b1');
select is((select save_billing_step_template(null, 'WBS template',
  '[{"name":"Survey","target_days":3,"documents":[{"name":"Survey sheet","required":true}]},{"name":"Certified quantity","target_days":5},{"name":"Invoice pack","optional":true}]'::jsonb)) is not null, true,
  'AC-WBS-001 Admin saves a three-step template');
reset role;
select set_config('wbs.tpl', (select id::text from billing_step_templates where name = 'WBS template'), false);
select pg_temp.as_user('b1');
select is(pg_temp.err(format($$select set_billing_step_template_roles(%L, '[{"position":1,"owner_role_key":"foreman"}]')$$, current_setting('wbs.tpl'))), '23514 WBS_TEMPLATE_ROLE',
  'AC-WBS-005 a field role cannot own a step');
select is(pg_temp.err(format($$select set_billing_step_template_roles(%L, '[{"position":1,"hidden_from_role_keys":["field_user"]}]')$$, current_setting('wbs.tpl'))), '23514 WBS_TEMPLATE_ROLE',
  'AC-WBS-005 a field role cannot be named in a hidden-from list');
select is(pg_temp.err(format($$select set_billing_step_template_roles(%L, '[{"position":1,"owner_role_key":"nonsense"}]')$$, current_setting('wbs.tpl'))), '23514 WBS_TEMPLATE_ROLE',
  'AC-WBS-005 an unknown role key is refused');
select is((select set_billing_step_template_roles(current_setting('wbs.tpl')::uuid,
  '[{"position":1,"owner_role_key":"quantity_surveyor"},{"position":2,"owner_role_key":"project_control_manager","hidden_from_role_keys":["quality_manager"]},{"position":3,"owner_role_key":"finance_officer"}]'::jsonb)),
  3, 'AC-WBS-001 Admin sets owner roles and the hidden-from list');
-- only Admin or Finance choose the default
select pg_temp.as_user('b6');
select is(pg_temp.err(format('select set_default_billing_step_template(%L)', current_setting('wbs.tpl'))), '42501 WBS_SETTER_ROLE', 'AC-WBS-005 an Engineer cannot choose the default template');
select pg_temp.as_user('b7');
select is(pg_temp.err(format('select set_default_billing_step_template(%L)', current_setting('wbs.tpl'))), '42501 LIGHT_ACCOUNT', 'AC-WBS-005 a field account is refused the default setting');
select pg_temp.as_user('b2');
select is(pg_temp.err(format('select set_default_billing_step_template(%L)', current_setting('wbs.tpl'))), 'ok', 'AC-WBS-001 Finance chooses the default template');
reset role;

-- ── AC-WBS-001/008: issue copies the list; the first step is current; its people are told ───────────────────────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17700000-0000-0000-0000-000000000032', '17700000-0000-0000-0000-0000000000a1', '17700000-0000-0000-0000-0000000000c1', 'WBS two', 'Draft', 10000, 'exclusive', 0);
select is((select count(*)::int from work_order_billing_steps where work_order_id = '17700000-0000-0000-0000-000000000032'), 0, 'AC-WBS-001 a Draft work order has no list yet');
update work_orders set status = 'Issued', issued_at = now() where id = '17700000-0000-0000-0000-000000000032';
select is((select string_agg(position || ':' || name || ':' || coalesce(owner_role_key, '-') || ':' || (started_on is not null) || ':' || optional, ',' order by position)
             from work_order_billing_steps where work_order_id = '17700000-0000-0000-0000-000000000032'),
  '1:Survey:quantity_surveyor:true:false,2:Certified quantity:project_control_manager:false:false,3:Invoice pack:finance_officer:false:true',
  'AC-WBS-001 issuing copies three steps with their owner roles; only the first is current');
select is((select started_on from work_order_billing_steps where id = pg_temp.step('17700000-0000-0000-0000-000000000032', 1)), pg_temp.today(), 'AC-WBS-001 the first step is current from the issue day');
select is((select count(*)::int from work_order_billing_step_documents where work_order_id = '17700000-0000-0000-0000-000000000032' and name = 'Survey sheet' and required), 1, 'AC-WBS-001 the checklist document is copied');
select is((select count(*)::int from work_order_billing_steps where work_order_id = '17700000-0000-0000-0000-000000000031'), 0, 'AC-WBS-001 a work order issued before the default existed keeps no list');
select is((select count(*)::int from notifications where owner_id = '17700000-0000-0000-0000-0000000000b4' and title = 'A billing step is waiting for you'), 1,
  'AC-WBS-008 the holder of the first step''s owner role is told in the app');
select is((select count(*)::int from notifications where owner_id = '17700000-0000-0000-0000-0000000000b6' and title = 'A billing step is waiting for you'), 0, 'AC-WBS-008 nobody else is told');
select is((select count(*)::int from email_outbox where event_key = 'billing_step'), 0, 'AC-WBS-008 with the billing_step email switch off nothing is queued');

-- AC-WBS-010: claims and the invoicing gate are untouched
select is((select count(*)::int from claim_billing_stages), 0, 'AC-WBS-010 issuing a work order makes no claim step');
select is((select position('work_order_billing_steps' in prosrc) from pg_proc where proname = 'billing_stages_open' and pronamespace = 'public'::regnamespace), 0,
  'AC-WBS-010 the invoicing gate does not read the work-order list');

-- ── AC-WBS-003: a later template edit changes nothing already issued ─────────────────────────────────────────────────────────────────────
select pg_temp.as_user('b1');
select is((select save_billing_step_template(current_setting('wbs.tpl')::uuid, 'WBS template renamed', '[{"name":"Only step"}]'::jsonb)) is not null, true, 'AC-WBS-003 Admin edits the template');
reset role;
select is((select count(*)::int from work_order_billing_steps where work_order_id = '17700000-0000-0000-0000-000000000032'), 3, 'AC-WBS-003 the issued list is unchanged');

-- ── AC-WBS-004: who reads what ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('b4');
select is((select count(*)::int from work_order_billing_steps), 3, 'AC-WBS-004 survey staff hold the see right and read all three steps');
select pg_temp.as_user('b5');
select is((select string_agg(position::text, ',' order by position) from work_order_billing_steps), '1,3', 'AC-WBS-004 a role the step is hidden from reads the other steps, not the hidden one');
select is((select count(*)::int from work_order_billing_step_documents d where d.step_id = pg_temp.step('17700000-0000-0000-0000-000000000032', 2)), 0, 'AC-WBS-004 nor its documents');
select pg_temp.as_user('b6');
select is((select count(*)::int from work_order_billing_steps), 0, 'AC-WBS-004 a role without the see right reads no step');
select pg_temp.as_user('b9');
select is((select count(*)::int from work_order_billing_steps), 0, 'AC-WBS-004 a person with no role key and an Engineer level reads no step');
select pg_temp.as_user('b8');
select is((select count(*)::int from work_order_billing_steps), 3, 'AC-WBS-004 a person with no role key keeps today''s claim-step readers (Finance)');
select pg_temp.as_user('b7');
select is((select count(*)::int from work_order_billing_steps), 0, 'AC-WBS-005 a field account reads no step');
select is((select count(*)::int from work_order_billing_step_documents), 0, 'AC-WBS-005 nor any step document');
select pg_temp.as_user('b0');
select is((select count(*)::int from work_order_billing_steps) + (select count(*)::int from work_order_billing_step_documents) + (select count(*)::int from org_billing_step_settings), 0,
  'AC-WBS-004 another organisation reads nothing');
select is(pg_temp.err(format('select complete_work_order_step(%L, current_date)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '' || 'P0002 WBS_NOT_FOUND', 'AC-WBS-004 another organisation cannot act on the step');
reset role;

-- the named person reads a step they would otherwise not (and is exempt from the hidden-from list)
select pg_temp.as_user('b1');
select is(pg_temp.err(format('select assign_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2), '17700000-0000-0000-0000-0000000000b7')), '23514 WBS_ASSIGNEE',
  'AC-WBS-005 a field account cannot be the named person');
select is(pg_temp.err(format('select assign_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2), '17700000-0000-0000-0000-0000000000b0')), '23514 WBS_ASSIGNEE',
  'AC-WBS-005 a member of another organisation cannot be the named person');
select is(pg_temp.err(format('select assign_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2), '17700000-0000-0000-0000-0000000000b6')), 'ok', 'AC-WBS-004 Admin names the Engineer on step 2');
reset role;
select pg_temp.as_user('b6');
select is((select string_agg(position::text, ',') from work_order_billing_steps), '2', 'AC-WBS-004 the named person reads exactly their step');
select pg_temp.as_user('b1');
select is(pg_temp.err(format('select assign_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2), '17700000-0000-0000-0000-0000000000b5')), 'ok', 'AC-WBS-004 Admin names the quality manager on the hidden step');
reset role;
select pg_temp.as_user('b5');
select is((select string_agg(position::text, ',' order by position) from work_order_billing_steps), '1,2,3', 'AC-WBS-004 a role the step is hidden from still reads it when named');
select pg_temp.as_user('b1');
select is(pg_temp.err(format('select assign_work_order_step(%L, null)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2))), 'ok', 'AC-WBS-004 the person is cleared');
reset role;

-- ── AC-WBS-005/007: acting on a step ─────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('b5');
select is(pg_temp.err(format('select complete_work_order_step(%L, current_date)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '42501 WBS_NOT_YOURS',
  'AC-WBS-005 a reader without the run right who does not own the step is refused');
select pg_temp.as_user('b7');
select is(pg_temp.err(format('select complete_work_order_step(%L, current_date)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '42501 LIGHT_ACCOUNT', 'AC-WBS-005 a field account is refused to complete');
select is(pg_temp.err(format('select skip_work_order_step(%L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 3))), '42501 LIGHT_ACCOUNT', 'AC-WBS-005 a field account is refused to skip');
select is(pg_temp.err(format('select attach_work_order_step_document(%L, null, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1), '17700000-0000-0000-0000-000000000f01')), '42501 LIGHT_ACCOUNT',
  'AC-WBS-005 a field account is refused to attach');
select is(pg_temp.err(format('select assign_work_order_step(%L, null)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '42501 LIGHT_ACCOUNT', 'AC-WBS-005 a field account is refused to name a person');
select pg_temp.as_user('b4');
select is(pg_temp.err(format('select complete_work_order_step(%L, current_date)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '55000 WBS_DOCS_MISSING', 'AC-WBS-007 a required document is needed first');
select is(pg_temp.err(format('select attach_work_order_step_document(%L, null, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1), '17700000-0000-0000-0000-000000000f02')), '23514 WBS_DOC_INVALID', 'AC-WBS-007 a draft document cannot be attached');
select is(pg_temp.err(format('select attach_work_order_step_document(%L, (select id from work_order_billing_step_documents where step_id = %L), %L)',
  pg_temp.step('17700000-0000-0000-0000-000000000032', 1), pg_temp.step('17700000-0000-0000-0000-000000000032', 1), '17700000-0000-0000-0000-000000000f01')), 'ok',
  'AC-WBS-007 the owner role attaches an approved project document to the slot');
select is(pg_temp.err(format('select complete_work_order_step(%L, current_date + 1)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '22023 WBS_DATE_FUTURE', 'AC-WBS-007 a future finish date is refused');
select is(pg_temp.err(format('select complete_work_order_step(%L, current_date - 1)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '22023 WBS_DATE_BEFORE_START', 'AC-WBS-007 a date before the step started is refused');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 3), pg_temp.today())), '55000 WBS_OUT_OF_ORDER', 'AC-WBS-007 a step that has not opened cannot be finished');
select is(pg_temp.err(format('select skip_work_order_step(%L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1))), '55000 WBS_NOT_OPTIONAL', 'AC-WBS-007 only an optional step can be skipped');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1), pg_temp.today())), 'ok', 'AC-WBS-005 the holder of the owner role finishes their step');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 1), pg_temp.today())), '55000 WBS_CLOSED', 'AC-WBS-007 a finished step cannot be finished again');
reset role;
select is((select started_on from work_order_billing_steps where id = pg_temp.step('17700000-0000-0000-0000-000000000032', 2)), pg_temp.today(), 'AC-WBS-007 finishing a step opens the next one');
select is((select count(*)::int from notifications where owner_id = '17700000-0000-0000-0000-0000000000bc' and title = 'A billing step is waiting for you'), 1, 'AC-WBS-008 the next step''s role holder is told');
select is((select count(*)::int from notifications where owner_id = '17700000-0000-0000-0000-0000000000bc' and body like '%Certified%'), 0, 'AC-WBS-008 a hidden step''s notice does not name the step');
select is((select count(*)::int from notifications where owner_id = '17700000-0000-0000-0000-0000000000b4' and title = 'A billing step is waiting for you'), 1, 'AC-WBS-008 the person who acted is not told');

-- a Project Manager level person acts through the run right only on a project they manage
select pg_temp.as_user('bb');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2), pg_temp.today())), '42501 WBS_NOT_PM', 'AC-WBS-005 another project''s manager is refused');
select pg_temp.as_user('b3');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 2), pg_temp.today())), 'ok', 'AC-WBS-005 the project''s manager finishes a step through the run right');
-- the optional last step: skip, and the list ends
select is(pg_temp.err(format('select skip_work_order_step(%L)', pg_temp.step('17700000-0000-0000-0000-000000000032', 3))), 'ok', 'AC-WBS-007 an optional current step is skipped');
reset role;
select is((select skipped_on from work_order_billing_steps where id = pg_temp.step('17700000-0000-0000-0000-000000000032', 3)), pg_temp.today(), 'AC-WBS-007 the skip is dated');

-- ── AC-WBS-009: the waiting list ───────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17700000-0000-0000-0000-000000000033', '17700000-0000-0000-0000-0000000000a1', '17700000-0000-0000-0000-0000000000c1', 'WBS three', 'Draft', 10000, 'exclusive', 0);
-- the earlier edit left the one-step template: the default now yields a single step with no owner
select pg_temp.as_user('b1');
select is((select set_billing_step_template_roles(current_setting('wbs.tpl')::uuid, '[{"position":1,"owner_role_key":"quantity_surveyor"}]'::jsonb)), 1, 'AC-WBS-009 Admin gives the one-step template an owner role');
reset role;
update work_orders set status = 'Issued', issued_at = now() where id = '17700000-0000-0000-0000-000000000033';
select pg_temp.as_user('b4');
select is((select count(*)::int from my_waiting_work_order_steps()), 1, 'AC-WBS-009 the survey holder sees the step waiting for them');
select is(pg_temp.err(format('select complete_work_order_step(%L, %L)', pg_temp.step('17700000-0000-0000-0000-000000000033', 1), pg_temp.today())), 'ok', 'AC-WBS-009 completing it');
select is((select count(*)::int from my_waiting_work_order_steps()), 0, 'AC-WBS-009 the step leaves the waiting list when done');
select pg_temp.as_user('b6');
select is((select count(*)::int from my_waiting_work_order_steps()), 0, 'AC-WBS-009 a person it is not waiting for sees nothing');
select pg_temp.as_user('b7');
select is(pg_temp.err('select count(*) from my_waiting_work_order_steps()'), 'ok', 'AC-WBS-005 a field account reads an empty waiting list');
reset role;

-- ── AC-WBS-008: the email event goes through the existing per-organisation switch ───────────────────────────────────────────────────────────
insert into email_event_settings (org_id, event_key, enabled) values ('17700000-0000-0000-0000-0000000000a1', 'billing_step', true);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17700000-0000-0000-0000-000000000034', '17700000-0000-0000-0000-0000000000a1', '17700000-0000-0000-0000-0000000000c1', 'WBS four', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now() where id = '17700000-0000-0000-0000-000000000034';
select is((select count(*)::int from email_outbox where event_key = 'billing_step' and recipient_id = '17700000-0000-0000-0000-0000000000b4'), 1, 'AC-WBS-008 with the switch on one email is queued for the person told');

select * from finish();
rollback;
