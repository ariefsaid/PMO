-- 2810_shell_bootstrap.test.sql
-- shell_bootstrap() returns, for each role, only the caller's own rows, and each section equals the separate
-- request the shell used to make. A second organisation sees none of the first's rows.
begin;
select plan(25);

insert into organizations (id, name, default_locale, default_timezone) values
  ('28100000-0000-0000-0000-000000000001','SB Org A','id','Asia/Jakarta'),
  ('28100000-0000-0000-0000-000000000002','SB Org B','en','UTC');
insert into auth.users (id, email) values
  ('28100000-0000-0000-0000-0000000000a1','sb-a-admin@example.com'),
  ('28100000-0000-0000-0000-0000000000a2','sb-a-eng@example.com'),
  ('28100000-0000-0000-0000-0000000000a3','sb-a-gone@example.com'),
  ('28100000-0000-0000-0000-0000000000b1','sb-b-admin@example.com'),
  ('28100000-0000-0000-0000-0000000000c1','sb-nobody@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('28100000-0000-0000-0000-0000000000a1','28100000-0000-0000-0000-000000000001','A Admin','sb-a-admin@example.com','Admin','active'),
  ('28100000-0000-0000-0000-0000000000a2','28100000-0000-0000-0000-000000000001','A Eng','sb-a-eng@example.com','Engineer','active'),
  ('28100000-0000-0000-0000-0000000000a3','28100000-0000-0000-0000-000000000001','A Gone','sb-a-gone@example.com','Engineer','disabled'),
  ('28100000-0000-0000-0000-0000000000b1','28100000-0000-0000-0000-000000000002','B Admin','sb-b-admin@example.com','Admin','active');
insert into org_terminology (org_id, term_key, locale, singular, plural) values
  ('28100000-0000-0000-0000-000000000001','workOrder','en','Job Card','Job Cards');
insert into org_role_names (org_id, role_key, locale, name) values
  ('28100000-0000-0000-0000-000000000001','project_manager','en','Field Lead');
delete from pipeline_stage_config where org_id = '28100000-0000-0000-0000-000000000001' and status = 'Leads';
insert into pipeline_stage_config (org_id, status, win_probability, label_en) values ('28100000-0000-0000-0000-000000000001','Leads',0.1,'A stage');

create temp table sb (who text primary key, j jsonb) on commit drop;
grant all on sb to authenticated;

set local role authenticated;

-- Org A Engineer
set local request.jwt.claims = '{"sub":"28100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into sb select 'a_eng', public.shell_bootstrap();
select is((select j->'profile'->>'id' from sb where who = 'a_eng'), '28100000-0000-0000-0000-0000000000a2', 'Engineer gets their own profile');
select is((select j->'profile' from sb where who = 'a_eng'),
  (select to_jsonb(p) from profiles p where id = '28100000-0000-0000-0000-0000000000a2'), 'profile equals the row the shell read before');
select is((select j->'org'->>'default_locale' from sb where who = 'a_eng'), 'id', 'Engineer gets their own organisation''s locale default');
select is((select j->'terminology'->0->>'singular' from sb where who = 'a_eng'), 'Job Card', 'Engineer gets their own organisation''s term names');
select is((select jsonb_array_length(j->'terminology') from sb where who = 'a_eng'), (select count(*)::int from org_terminology), 'terms: exactly the rows a plain read returns');
select is((select j->'role_names'->0->>'name' from sb where who = 'a_eng'), 'Field Lead', 'Engineer gets their own organisation''s role names');
select is((select j->'stage_names' from sb where who = 'a_eng'),
  (select coalesce(jsonb_agg(s order by s.status), '[]') from (select status, label_en, label_id from pipeline_stage_config order by status limit 12) s),
  'stage names equal the plain read');
select ok((select j->'stage_names' from sb where who = 'a_eng') @> '[{"label_en":"A stage"}]', 'Engineer sees their own organisation''s stage name');
select is((select j->'features' from sb where who = 'a_eng'),
  (select coalesce(jsonb_agg(f), '[]') from resolved_org_features() f), 'features equal resolved_org_features()');
select is((select j->'plan' from sb where who = 'a_eng'), (select to_jsonb(p) from resolved_org_plan() p limit 1), 'plan equals resolved_org_plan()');
select is((select (j->>'is_operator')::boolean from sb where who = 'a_eng'), false, 'Engineer is not an Operator');
select is((select (j->>'hide_prices_enabled')::boolean from sb where who = 'a_eng'), get_hide_prices_enabled(), 'hide-prices equals get_hide_prices_enabled()');

-- Org A Admin: same organisation rows, own profile
set local request.jwt.claims = '{"sub":"28100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into sb select 'a_admin', public.shell_bootstrap();
select is((select j->'profile'->>'role' from sb where who = 'a_admin'), 'Admin', 'Admin gets their own profile');
select is((select j - 'profile' from sb where who = 'a_admin'), (select j - 'profile' from sb where who = 'a_eng'),
  'Admin and Engineer of one organisation get the same organisation facts');

-- Hide prices on: the caller's own answer rides along, equal to get_may_see_prices()
select ok(not ((select j from sb where who = 'a_eng') ? 'may_see_prices'), 'no price answer while the setting is off');
select set_hide_prices_enabled(true);
set local request.jwt.claims = '{"sub":"28100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((public.shell_bootstrap()->>'hide_prices_enabled')::boolean, true, 'Engineer sees the setting on');
select is((public.shell_bootstrap()->>'may_see_prices')::boolean, get_may_see_prices(), 'Engineer''s price answer equals get_may_see_prices()');

-- Org B Admin: none of org A's rows
set local request.jwt.claims = '{"sub":"28100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into sb select 'b_admin', public.shell_bootstrap();
select is((select j->'profile'->>'org_id' from sb where who = 'b_admin'), '28100000-0000-0000-0000-000000000002', 'second organisation gets its own profile');
select is((select j->'org'->>'default_locale' from sb where who = 'b_admin'), 'en', 'second organisation gets its own locale default');
select is((select j->'terminology' from sb where who = 'b_admin'), '[]'::jsonb, 'second organisation gets none of the first''s term names');
select is((select j->'role_names' from sb where who = 'b_admin'), '[]'::jsonb, 'second organisation gets none of the first''s role names');
select ok(not ((select j->'stage_names' from sb where who = 'b_admin') @> '[{"label_en":"A stage"}]'), 'second organisation gets none of the first''s stage names');

-- Disabled member: no features or plan (those calls refuse them; the client reads them itself as before)
set local request.jwt.claims = '{"sub":"28100000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok(not (public.shell_bootstrap() ?| array['features','plan']), 'disabled member gets no features or plan section');

-- No profile: nothing but a null profile
set local request.jwt.claims = '{"sub":"28100000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(public.shell_bootstrap(), '{"profile":null}'::jsonb, 'a user with no profile gets only a null profile');

reset role;
select ok(not has_function_privilege('anon', 'public.shell_bootstrap()', 'execute'), 'signed-out callers cannot run it');

select * from finish();
rollback;
