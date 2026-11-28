begin;
create extension if not exists pgtap;
select plan(3);
insert into organizations (id, name, default_currency, built_in_roles_enabled) values ('28030000-0000-0000-0000-000000000001', 'Attendance rights', 'IDR', true);
insert into auth.users (id, email) values ('28030000-0000-0000-0000-000000000011', 'attendance-hr@example.com'), ('28030000-0000-0000-0000-000000000012', 'attendance-store@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
('28030000-0000-0000-0000-000000000011', '28030000-0000-0000-0000-000000000001', 'HR', 'attendance-hr@example.com', 'Engineer', 'active', 'hr_officer'),
('28030000-0000-0000-0000-000000000012', '28030000-0000-0000-0000-000000000001', 'Store', 'attendance-store@example.com', 'Engineer', 'active', 'storekeeper');
insert into projects (id, org_id, name, status) values ('28030000-0000-0000-0000-000000000021', '28030000-0000-0000-0000-000000000001', 'Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values ('28030000-0000-0000-0000-000000000031', '28030000-0000-0000-0000-000000000001', '28030000-0000-0000-0000-000000000021', 'Order', 'Issued', 0, 'exclusive', 0);
insert into crews (id, org_id, code, name) values ('28030000-0000-0000-0000-000000000041', '28030000-0000-0000-0000-000000000001', 'A', 'Crew');
insert into people (id, org_id, kind, name) values ('28030000-0000-0000-0000-000000000051', '28030000-0000-0000-0000-000000000001', 'own', 'Worker');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values ('28030000-0000-0000-0000-000000000001', '28030000-0000-0000-0000-000000000041', '28030000-0000-0000-0000-000000000051', current_date - 1);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values ('28030000-0000-0000-0000-000000000001', '28030000-0000-0000-0000-000000000031', '28030000-0000-0000-0000-000000000041', current_date - 1);
insert into attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source) values ('28030000-0000-0000-0000-000000000001', '28030000-0000-0000-0000-000000000051', '28030000-0000-0000-0000-000000000031', '28030000-0000-0000-0000-000000000021', '28030000-0000-0000-0000-000000000041', current_date, 'present', 8, 'roster_tick');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select is((select count(*)::int from attendance_days), 1, 'AC-RR-007 HR officer reads crew attendance');
select throws_ok($$select attendance_record('28030000-0000-0000-0000-000000000031', current_date, 'roster_tick', '[{"worker_id":"28030000-0000-0000-0000-000000000051","status":"present","hours":8}]')$$, '42501', 'not authorized', 'HR officer does not gain attendance recording');
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select is((select count(*)::int from attendance_days), 0, 'AC-RR-007 unrelated role cannot read crew attendance');
select * from finish();
rollback;
