-- 1810_change_review.test.sql — change-review: the reviewer-role setting.
-- AC-CHR-001..007. Spec docs/specs/change-review.spec.md. Builds on the 1177 shape (one org, one work order, one over-contract item).
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('18100000-0000-0000-0000-0000000000a1', 'CHR Org A', 'USD', 'UTC', true),
  ('18100000-0000-0000-0000-0000000000a2', 'CHR Org B', 'USD', 'UTC', true);
insert into auth.users (id, email) values
  ('18100000-0000-0000-0000-0000000000b1', 'chr-author@example.com'),
  ('18100000-0000-0000-0000-0000000000b2', 'chr-pcm@example.com'),
  ('18100000-0000-0000-0000-0000000000b3', 'chr-admin@example.com'),
  ('18100000-0000-0000-0000-0000000000b4', 'chr-eng@example.com'),
  ('18100000-0000-0000-0000-0000000000b5', 'chr-pcm-foreign@example.com'),
  ('18100000-0000-0000-0000-0000000000b6', 'chr-fin@example.com'),
  ('18100000-0000-0000-0000-0000000000b7', 'chr-pcm-editor@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18100000-0000-0000-0000-0000000000b1', '18100000-0000-0000-0000-0000000000a1', 'CHR Author', 'chr-author@example.com', 'Project Manager', 'active', null),
  ('18100000-0000-0000-0000-0000000000b2', '18100000-0000-0000-0000-0000000000a1', 'CHR Control', 'chr-pcm@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('18100000-0000-0000-0000-0000000000b3', '18100000-0000-0000-0000-0000000000a1', 'CHR Admin', 'chr-admin@example.com', 'Admin', 'active', null),
  ('18100000-0000-0000-0000-0000000000b4', '18100000-0000-0000-0000-0000000000a1', 'CHR Engineer', 'chr-eng@example.com', 'Engineer', 'active', null),
  ('18100000-0000-0000-0000-0000000000b5', '18100000-0000-0000-0000-0000000000a2', 'CHR Foreign Control', 'chr-pcm-foreign@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('18100000-0000-0000-0000-0000000000b6', '18100000-0000-0000-0000-0000000000a1', 'CHR Finance', 'chr-fin@example.com', 'Finance', 'active', null),
  ('18100000-0000-0000-0000-0000000000b7', '18100000-0000-0000-0000-0000000000a1', 'CHR Control Two', 'chr-pcm-editor@example.com', 'Project Manager', 'active', 'project_control_manager');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('18100000-0000-0000-0000-0000000000c1', '18100000-0000-0000-0000-0000000000a1', 'CHR Contract', 'Ongoing Project', 'USD', '18100000-0000-0000-0000-0000000000b1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'WO issued', 'Issued', 100000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis) values
  ('18100000-0000-0000-0000-0000000000f1', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'EXC', 'Excavation', 'm3', 1000, 50, 'unit_rate'),
  ('18100000-0000-0000-0000-0000000000f2', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'ROAD', 'Road', 'm', 200, 100, 'unit_rate'),
  ('18100000-0000-0000-0000-0000000000f3', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'WALL', 'Wall', 'm2', 100, 100, 'unit_rate'),
  ('18100000-0000-0000-0000-0000000000f4', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', 'PIPE', 'Pipe', 'm', 100, 100, 'unit_rate');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f1', 600),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f2', 100),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f3', 100),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000e1', '18100000-0000-0000-0000-0000000000f4', 100);
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-0000000000c1', '2026-02-01', 50);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f1', 1040),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f2', 250),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f3', 120),
  ('18100000-0000-0000-0000-0000000000a1', '18100000-0000-0000-0000-000000000d01', '18100000-0000-0000-0000-0000000000f4', 130);
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- ── default: today's route (AC-CHR-001) ─────────────────────────────────────────────────────────────
select is((select quantity_change_approver_roles from organizations where id = '18100000-0000-0000-0000-0000000000a1'), '{}'::text[], 'AC-CHR-001 the reviewer list is empty by default');
set local role authenticated;
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r1', qcr_raise('18100000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"18100000-0000-0000-0000-0000000000f1","requested_quantity":1100,"reason":"Rock found"}]'::jsonb);
select lives_ok($$select qcr_submit((select v from ids where k = 'r1'))$$, 'the author submits');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501',
  'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list',
  'AC-CHR-001 with the default list the Project Control Manager cannot approve');
select is((select reason from qcr_approval_state((select v from ids where k = 'r1'))), 'role', 'AC-CHR-001 the screen is told why');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select is((select eligible_approver_exists from qcr_approval_state((select v from ids where k = 'r1'))), true, 'AC-CHR-001 Finance is still an approver (today unchanged)');

-- ── the setting (AC-CHR-005) ────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b2","role":"authenticated"}';
update organizations set quantity_change_approver_roles = array['project_control_manager'] where id = '18100000-0000-0000-0000-0000000000a1';
reset role;
select is((select quantity_change_approver_roles from organizations where id = '18100000-0000-0000-0000-0000000000a1'), '{}'::text[], 'AC-CHR-005 a non-Admin changing the list changes nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$update organizations set quantity_change_approver_roles = array['no_such_role'] where id = '18100000-0000-0000-0000-0000000000a1'$$, '22023',
  'QCR_APPROVER_ROLE_UNKNOWN: choose reviewer roles from the role list', 'AC-CHR-005 a key outside the catalogue is refused');
select throws_ok($$update organizations set quantity_change_approver_roles = array['foreman'] where id = '18100000-0000-0000-0000-0000000000a1'$$, '22023',
  'QCR_APPROVER_ROLE_LIGHT: a field role cannot review requests; choose a manager or officer role', 'AC-CHR-005 a light-account (field) role is refused');
select throws_ok($$update organizations set quantity_change_approver_roles = array['engineer'] where id = '18100000-0000-0000-0000-0000000000a1'$$, '22023',
  'QCR_APPROVER_ROLE_CANNOT_READ: choose a role that can see change requests', 'AC-CHR-005 an officer role with Engineer base (cannot read change requests) is refused');
update organizations set quantity_change_approver_roles = array['project_control_manager'] where id = '18100000-0000-0000-0000-0000000000a1';
select is((select quantity_change_approver_roles from organizations where id = '18100000-0000-0000-0000-0000000000a1'), array['project_control_manager'], 'AC-CHR-005 the Admin sets the list');
reset role;
select is((select detail::text from audit_events where action = 'org.quantity_change_approver_roles.change' and entity_id = '18100000-0000-0000-0000-0000000000a1'),
  '{"to": ["project_control_manager"], "from": []}', 'AC-CHR-005 the audit row holds the before and after');
set local role authenticated;

-- ── the listed role approves; separation of duties holds (AC-CHR-002..004, 007) ─────────────────────
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select can_approve from qcr_approval_state((select v from ids where k = 'r1'))), true, 'AC-CHR-007 the listed role can approve a request it did not touch');
select lives_ok($$select qcr_return((select v from ids where k = 'r1'), 'Please justify')$$, 'AC-CHR-002 the listed role returns with a reason');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r1')), 'returned', 'AC-CHR-002 the request is returned');
-- the listed role edits and submits, so it is now an editor and the submitter and cannot approve its own work
select lives_ok($$select qcr_update_draft((select v from ids where k = 'r1'), null, 'Control revised')$$, 'the listed role edits the returned request (joins the editor set)');
select lives_ok($$select qcr_submit((select v from ids where k = 'r1'))$$, 'and resubmits it');
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501',
  'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer',
  'AC-CHR-003 a listed-role user who edited and submitted cannot approve');
select throws_ok($$select qcr_return((select v from ids where k = 'r1'), 'no')$$, '42501',
  'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer',
  'AC-CHR-003 nor return it');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501',
  'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list',
  'AC-CHR-004 an Engineer with no listed role is refused');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, 'P0002', 'request not found', 'AC-CHR-004 a listed-role user of another organisation cannot approve');
-- ── the shared waiting list and decision standing follow the setting (AC-CHR-012) ───────────────────
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select is((select count(*)::int from my_waiting_decisions() w where w.kind = 'quantity_change' and w.record_id = (select v from ids where k = 'r1')), 1,
  'AC-CHR-012 a listed-role holder sees the pending request in the waiting list');
select is(my_decision_standing(), true, 'AC-CHR-012 and has decision standing');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from my_waiting_decisions() w where w.kind = 'quantity_change'), 0, 'AC-CHR-012 the editor and submitter does not see it');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from my_waiting_decisions() w where w.kind = 'quantity_change'), 0, 'AC-CHR-012 the author does not see it');
set local role authenticated;
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b3","role":"authenticated"}';
update organizations set quantity_change_approver_roles = '{}' where id = '18100000-0000-0000-0000-0000000000a1';
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select is((select count(*)::int from my_waiting_decisions() w where w.kind = 'quantity_change'), 0, 'AC-CHR-012 with the list empty the role does not see it');
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b3","role":"authenticated"}';
update organizations set quantity_change_approver_roles = array['project_control_manager'] where id = '18100000-0000-0000-0000-0000000000a1';
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select lives_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, 'AC-CHR-002 a second listed-role user approves');
select is((select status || ':' || approved_by::text from quantity_change_requests where id = (select v from ids where k = 'r1')),
  'approved:18100000-0000-0000-0000-0000000000b7', 'AC-CHR-002 the request is approved with that person as approver');
-- the listed roles were told when it was submitted (the waiting notice)
reset role;
select ok(exists (select 1 from notifications where owner_id = '18100000-0000-0000-0000-0000000000b7' and title = 'Quantity change request awaiting approval'),
  'AC-CHR-002 a listed-role user was told the request awaits approval');
select ok(exists (select 1 from notifications where owner_id = '18100000-0000-0000-0000-0000000000b1' and title = 'Quantity change request approved'),
  'AC-CHR-002 the person who raised it was told the outcome');

-- ── the listed-role branch needs the organisation's built-in roles switched on (AC-CHR-011) ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r2', qcr_raise('18100000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"18100000-0000-0000-0000-0000000000f2","requested_quantity":260,"reason":"more road"}]'::jsonb);
select lives_ok($$select qcr_submit((select v from ids where k = 'r2'))$$, 'a second request is submitted');
reset role;
update organizations set built_in_roles_enabled = false where id = '18100000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r2'))$$, '42501',
  'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list',
  'AC-CHR-011 a listed-role holder is refused once the organisation turns built-in roles off');
select is((select reason from qcr_approval_state((select v from ids where k = 'r2'))), 'role', 'AC-CHR-011 the screen is told why');
reset role;
update organizations set built_in_roles_enabled = true where id = '18100000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18100000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select lives_ok($$select qcr_approve((select v from ids where k = 'r2'))$$, 'AC-CHR-011 with built-in roles back on the listed role approves again');

select * from finish();
rollback;
