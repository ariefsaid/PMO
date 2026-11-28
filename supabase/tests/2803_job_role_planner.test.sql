begin;
create extension if not exists pgtap;
select no_plan();
insert into organizations (id, name, default_currency, built_in_roles_enabled) values ('28030000-0000-0000-0000-000000000004', 'Planner rights', 'IDR', true);
insert into auth.users (id, email) values ('28030000-0000-0000-0000-0000000000d1', 'rights-planner2@example.com'), ('28030000-0000-0000-0000-0000000000d2', 'rights-store2@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
 ('28030000-0000-0000-0000-0000000000d1', '28030000-0000-0000-0000-000000000004', 'Planner', 'rights-planner2@example.com', 'Engineer', 'active', 'planner'),
 ('28030000-0000-0000-0000-0000000000d2', '28030000-0000-0000-0000-000000000004', 'Store', 'rights-store2@example.com', 'Engineer', 'active', 'storekeeper');
insert into projects (id, org_id, name, status) values ('28030000-0000-0000-0000-0000000000e1', '28030000-0000-0000-0000-000000000004', 'Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values ('28030000-0000-0000-0000-0000000000e2', '28030000-0000-0000-0000-000000000004', '28030000-0000-0000-0000-0000000000e1', 'Order', 'Draft', 0, 'exclusive', 0);
insert into tasks (id, org_id, project_id, name, status, created_by) values
 ('28030000-0000-0000-0000-0000000000f1', '28030000-0000-0000-0000-000000000004', '28030000-0000-0000-0000-0000000000e1', 'First', 'To Do', '28030000-0000-0000-0000-0000000000d2'),
 ('28030000-0000-0000-0000-0000000000f2', '28030000-0000-0000-0000-000000000004', '28030000-0000-0000-0000-0000000000e1', 'Second', 'To Do', '28030000-0000-0000-0000-0000000000d2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select lives_ok($$update tasks set work_order_id = '28030000-0000-0000-0000-0000000000e2' where id = '28030000-0000-0000-0000-0000000000f1'$$, 'AC-RR-006 planner links a task');
select is((select work_order_id from tasks where id = '28030000-0000-0000-0000-0000000000f1'), '28030000-0000-0000-0000-0000000000e2'::uuid, 'task link persists');
select lives_ok($$insert into task_dependencies (task_id, depends_on_id) values ('28030000-0000-0000-0000-0000000000f1', '28030000-0000-0000-0000-0000000000f2')$$, 'AC-RR-006 planner adds dependency');
select throws_ok($$update tasks set name = 'Renamed' where id = '28030000-0000-0000-0000-0000000000f2'$$, '42501', 'only the task status may be changed by its assignee', 'planner changes the link and nothing else on a task');
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select throws_ok($$update tasks set work_order_id = '28030000-0000-0000-0000-0000000000e2' where id = '28030000-0000-0000-0000-0000000000f2'$$, '42501', null, 'unrelated role cannot link a task');
select throws_ok($$insert into task_dependencies (task_id, depends_on_id) values ('28030000-0000-0000-0000-0000000000f2', '28030000-0000-0000-0000-0000000000f1')$$, '42501', null, 'unrelated role cannot add dependency');
select * from finish();
rollback;
