-- performance_indices_settings.test.sql — #2597: AC-CSP-019 (setting writes are Admin-only, own organisation, defaults off)
-- and the validation half of AC-CSP-020 (bands: 0 < low < 1 < high). Migration under test: 1285.
begin;
create extension if not exists pgtap;
select plan(14);
insert into organizations (id, name) values ('25970000-0000-0000-0000-00000000000a', 'CSP Settings A'), ('25970000-0000-0000-0000-00000000000b', 'CSP Settings B');
-- this switch is on by default now; this file proves the off state, so setup switches it off as an explicit step
update organizations set performance_indices_enabled = false where id in ('25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-00000000000b');
insert into auth.users (id, email) values ('25970000-0000-0000-0000-0000000000a1', 'cps-admin@example.com'), ('25970000-0000-0000-0000-0000000000a2', 'cps-pm@example.com'),
  ('25970000-0000-0000-0000-0000000000a3', 'cps-fin@example.com'), ('25970000-0000-0000-0000-0000000000b1', 'cps-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25970000-0000-0000-0000-0000000000a1', '25970000-0000-0000-0000-00000000000a', 'Admin', 'cps-admin@example.com', 'Admin', 'active'),
  ('25970000-0000-0000-0000-0000000000a2', '25970000-0000-0000-0000-00000000000a', 'PM', 'cps-pm@example.com', 'Project Manager', 'active'),
  ('25970000-0000-0000-0000-0000000000a3', '25970000-0000-0000-0000-00000000000a', 'Fin', 'cps-fin@example.com', 'Finance', 'active'),
  ('25970000-0000-0000-0000-0000000000b1', '25970000-0000-0000-0000-00000000000b', 'XAdmin', 'cps-xadmin@example.com', 'Admin', 'active');

select is((select performance_indices_enabled from organizations where id = '25970000-0000-0000-0000-00000000000a'), false, 'AC-CSP-019 an organisation that switched the panels off has them off');
select is((select (performance_band_low, performance_band_high)::text from organizations where id = '25970000-0000-0000-0000-00000000000a'), '(0.90,1.10)', 'AC-CSP-019 and the bands 0.90 and 1.10');

set local role authenticated;
set local request.jwt.claims = '{"sub":"25970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
with c as (update organizations set performance_indices_enabled = true, performance_band_low = 0.80, performance_band_high = 1.25 where id = '25970000-0000-0000-0000-00000000000a' returning id)
select is((select count(*)::int from c), 1, 'AC-CSP-019 an Admin sets the switch and both bands');
select is((select (performance_indices_enabled, performance_band_low, performance_band_high)::text from organizations where id = '25970000-0000-0000-0000-00000000000a'), '(t,0.80,1.25)', 'AC-CSP-019 the values persist');
with c as (update organizations set performance_indices_enabled = true where id = '25970000-0000-0000-0000-00000000000b' returning id)
select is((select count(*)::int from c), 0, 'AC-CSP-019 an Admin cannot change another organisation');
select throws_ok($$update organizations set performance_band_low = 1 where id = '25970000-0000-0000-0000-00000000000a'$$, '23514', null, 'AC-CSP-020 low must be below 1');
select throws_ok($$update organizations set performance_band_low = 0 where id = '25970000-0000-0000-0000-00000000000a'$$, '23514', null, 'AC-CSP-020 low must be above 0');
select throws_ok($$update organizations set performance_band_high = 1 where id = '25970000-0000-0000-0000-00000000000a'$$, '23514', null, 'AC-CSP-020 high must be above 1');
select throws_ok($$update organizations set performance_band_low = 1.05, performance_band_high = 1.20 where id = '25970000-0000-0000-0000-00000000000a'$$, '23514', null, 'AC-CSP-020 low above 1 is refused');
set local request.jwt.claims = '{"sub":"25970000-0000-0000-0000-0000000000a2","role":"authenticated"}';
with c as (update organizations set performance_indices_enabled = false where id = '25970000-0000-0000-0000-00000000000a' returning id)
select is((select count(*)::int from c), 0, 'AC-CSP-019 a Project Manager changes nothing');
set local request.jwt.claims = '{"sub":"25970000-0000-0000-0000-0000000000a3","role":"authenticated"}';
with c as (update organizations set performance_band_low = 0.5 where id = '25970000-0000-0000-0000-00000000000a' returning id)
select is((select count(*)::int from c), 0, 'AC-CSP-019 a Finance user changes nothing');
set local request.jwt.claims = '{"sub":"25970000-0000-0000-0000-0000000000b1","role":"authenticated"}';
with c as (update organizations set performance_indices_enabled = false where id = '25970000-0000-0000-0000-00000000000a' returning id)
select is((select count(*)::int from c), 0, 'AC-CSP-019 an Admin of another organisation changes nothing');
reset role;
select is((select performance_indices_enabled from organizations where id = '25970000-0000-0000-0000-00000000000a'), true, 'AC-CSP-019 the switch is untouched by every refused write');
select is((select performance_band_low from organizations where id = '25970000-0000-0000-0000-00000000000a'), 0.80::numeric, 'AC-CSP-019 and so are the bands');
select * from finish();
rollback;
