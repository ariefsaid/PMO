-- 1832_overdue_runner_checklists.test.sql — the one daily overdue runner now also scans close-out and clearance items (#2800).
-- AC-CTD-002, AC-CTD-003, AC-CTD-006, AC-CTD-008 (owning layer, pgTAP; also FR-CTD-005..008/010). Ids: 28320000-… (synthetic).
-- Org a1 (UTC, checklist on), org a2 (UTC, checklist on, foreign), org a3 (UTC, checklist off). One run, three kinds of notice:
-- billing steps (unchanged), close-out items and clearance items. Recipients are the active member who issued/created the record,
-- else the organisation's active Admins — never a disabled, missing or foreign one, never another organisation.
--
-- MUTATION NOTES (intended rules for the later VPS mutation job; NOT executed by this author — no mutation evidence is claimed):
--   1832 close-out scan: drop `and i.overdue_notified_at is null`
--        reddens 'AC-CTD-002 a second run notifies nobody' (the once-only stamp)
--   1832 close-out scan: drop `and i.done_on is null`
--        reddens 'AC-CTD-003 a done close-out item is never notified'
--   1832 close-out recipients: drop `m.org_id = (r.i).org_id` from the active-member test
--        reddens 'AC-CTD-003 the foreign issuer falls back to this organisation''s Admin'
--   1832 clearance scan: drop `and o.clearance_checklist_enabled`
--        reddens 'AC-CTD-006 an organisation with the clearance checklist off is not scanned'
--   1832 clearance scan: drop `and not exists (select 1 from person_clearance_overdue_notices ...)`
--        reddens 'AC-CTD-006 a notice another run already wrote is never written or sent twice'
--   1832 clearance scan: `people.created_by` -> `people.profile_id` in the recipient union
--        reddens 'AC-CTD-006 the person record''s active creator is told once'
--   1832 clearance scan: `x.expires_on is not null` -> `true` in the document branch
--        reddens 'AC-CTD-006 a live document marks the clearance done'
begin;
create extension if not exists pgtap;
-- 51 assertions.
select plan(51);

insert into organizations (id, name, default_currency, default_timezone, clearance_checklist_enabled) values
  ('28320000-0000-0000-0000-0000000000a1', 'CTD Run Org A', 'IDR', 'UTC', true),
  ('28320000-0000-0000-0000-0000000000a2', 'CTD Run Org B', 'IDR', 'UTC', true),
  ('28320000-0000-0000-0000-0000000000a3', 'CTD Run Org C', 'IDR', 'UTC', false);
insert into auth.users (id, email) values
  ('28320000-0000-0000-0000-000000000b01', 'ctdr-admin@example.com'),
  ('28320000-0000-0000-0000-000000000b02', 'ctdr-pm@example.com'),
  ('28320000-0000-0000-0000-000000000b03', 'ctdr-fin@example.com'),
  ('28320000-0000-0000-0000-000000000b04', 'ctdr-disabled@example.com'),
  ('28320000-0000-0000-0000-000000000b05', 'ctdr-eng@example.com'),
  ('28320000-0000-0000-0000-000000000b08', 'ctdr-foreign-admin@example.com'),
  ('28320000-0000-0000-0000-000000000b09', 'ctdr-foreign-pm@example.com'),
  ('28320000-0000-0000-0000-000000000b31', 'ctdr-off-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('28320000-0000-0000-0000-000000000b01', '28320000-0000-0000-0000-0000000000a1', 'CTDR Admin',    'ctdr-admin@example.com',    'Admin', 'active'),
  ('28320000-0000-0000-0000-000000000b02', '28320000-0000-0000-0000-0000000000a1', 'CTDR PM',       'ctdr-pm@example.com',       'Project Manager', 'active'),
  ('28320000-0000-0000-0000-000000000b03', '28320000-0000-0000-0000-0000000000a1', 'CTDR Finance',  'ctdr-fin@example.com',      'Finance', 'active'),
  ('28320000-0000-0000-0000-000000000b04', '28320000-0000-0000-0000-0000000000a1', 'CTDR Disabled', 'ctdr-disabled@example.com', 'Admin', 'disabled'),
  ('28320000-0000-0000-0000-000000000b05', '28320000-0000-0000-0000-0000000000a1', 'CTDR Eng',      'ctdr-eng@example.com',      'Engineer', 'active'),
  ('28320000-0000-0000-0000-000000000b08', '28320000-0000-0000-0000-0000000000a2', 'CTDR B Admin',  'ctdr-foreign-admin@example.com', 'Admin', 'active'),
  ('28320000-0000-0000-0000-000000000b09', '28320000-0000-0000-0000-0000000000a2', 'CTDR B PM',     'ctdr-foreign-pm@example.com', 'Project Manager', 'active'),
  ('28320000-0000-0000-0000-000000000b31', '28320000-0000-0000-0000-0000000000a3', 'CTDR C Admin',  'ctdr-off-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('28320000-0000-0000-0000-0000000000cc', '28320000-0000-0000-0000-0000000000a1', 'CTDR Client A', 'Client'),
  ('28320000-0000-0000-0000-0000000000cd', '28320000-0000-0000-0000-0000000000a2', 'CTDR Client B', 'Client'),
  ('28320000-0000-0000-0000-0000000000ce', '28320000-0000-0000-0000-0000000000a3', 'CTDR Client C', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('28320000-0000-0000-0000-0000000000c01', '28320000-0000-0000-0000-0000000000a1', 'CTD run project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28320000-0000-0000-0000-0000000000cc', '28320000-0000-0000-0000-000000000b02'),
  ('28320000-0000-0000-0000-0000000000c02', '28320000-0000-0000-0000-0000000000a2', 'CTD run foreign project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28320000-0000-0000-0000-0000000000cd', '28320000-0000-0000-0000-000000000b09'),
  ('28320000-0000-0000-0000-0000000000c03', '28320000-0000-0000-0000-0000000000a3', 'CTD run off project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28320000-0000-0000-0000-0000000000ce', '28320000-0000-0000-0000-000000000b31');
-- Issued work orders as the owner (the origination guard scopes itself to the RLS trust boundary): one per recipient rule.
insert into work_orders (id, org_id, project_id, wo_number, title, status, issued_by, issued_at, order_value, currency, tax_treatment, tax_amount) values
  ('28320000-0000-0000-0000-0000000000e01', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-1', 'CTD run one', 'Issued', '28320000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e02', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-2', 'CTD run two', 'Issued', '28320000-0000-0000-0000-000000000b04', now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e03', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-3', 'CTD run three', 'Issued', null, now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e04', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-4', 'CTD run four', 'Issued', '28320000-0000-0000-0000-000000000b09', now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e05', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-5', 'CTD run five', 'Issued', '28320000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e06', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-6', 'CTD run six', 'Issued', '28320000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e07', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'WO-7', 'CTD run seven', 'Issued', '28320000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('28320000-0000-0000-0000-0000000000e08', '28320000-0000-0000-0000-0000000000a2', '28320000-0000-0000-0000-0000000000c02', 'WO-B', 'CTD run foreign', 'Issued', '28320000-0000-0000-0000-000000000b09', now(), 10000, 'IDR', 'exclusive', 0);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('28320000-0000-0000-0000-000000000d01', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01',
   'Acceptance', 'CTD run acceptance', 'Approved', '28320000-0000-0000-0000-000000000b02',
   '28320000-0000-0000-0000-0000000000a1/28320000-0000-0000-0000-0000000000c01/doc.pdf');
-- Close-out items: overdue by rule, exactly due, done, without a due day, and one per issuer fallback.
insert into work_order_closeout_items
  (id, org_id, work_order_id, project_id, position, name, required, started_on, target_days, due_on, done_on, document_id, attached_by, done_by) values
  ('28320000-0000-0000-0000-000000000f01', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e01', '28320000-0000-0000-0000-0000000000c01', 1, 'Open punch list', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 6, null, null, null, null),
  ('28320000-0000-0000-0000-000000000f02', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e01', '28320000-0000-0000-0000-0000000000c01', 2, 'Exactly due today', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid), null, null, null, null),
  ('28320000-0000-0000-0000-000000000f03', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e02', '28320000-0000-0000-0000-0000000000c01', 1, 'Disabled issuer item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 2, null, null, null, null),
  ('28320000-0000-0000-0000-000000000f04', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e03', '28320000-0000-0000-0000-0000000000c01', 1, 'No issuer item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 1, null, null, null, null),
  ('28320000-0000-0000-0000-000000000f05', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e04', '28320000-0000-0000-0000-0000000000c01', 1, 'Foreign issuer item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 3, null, null, null, null),
  ('28320000-0000-0000-0000-000000000f06', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e05', '28320000-0000-0000-0000-0000000000c01', 1, 'Already done item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 6,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 5, '28320000-0000-0000-0000-000000000d01',
   '28320000-0000-0000-0000-000000000b02', '28320000-0000-0000-0000-000000000b02'),
  ('28320000-0000-0000-0000-000000000f07', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e06', '28320000-0000-0000-0000-0000000000c01', 1, 'No due item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5, null, null, null, null, null),
  ('28320000-0000-0000-0000-000000000f08', '28320000-0000-0000-0000-0000000000a2', '28320000-0000-0000-0000-0000000000e08', '28320000-0000-0000-0000-0000000000c02', 1, 'B overdue item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a2'::uuid) - 10, 5, public.native_org_today('28320000-0000-0000-0000-0000000000a2'::uuid) - 2, null, null, null, null);
-- Clearance: two A items (one document-driven), the module off in C, and the same targets everywhere.
insert into document_types (id, org_id, name, applies_to) values
  ('28320000-0000-0000-0000-000000000d11', '28320000-0000-0000-0000-0000000000a1', 'Person medical', 'person');
insert into clearance_items (id, org_id, name, is_required, sort_order, created_by, target_days, document_type_id) values
  ('28320000-0000-0000-0000-000000000c11', '28320000-0000-0000-0000-0000000000a1', 'Site induction', true, 1, '28320000-0000-0000-0000-000000000b01', 5, null),
  ('28320000-0000-0000-0000-000000000c12', '28320000-0000-0000-0000-0000000000a1', 'Medical check', true, 2, '28320000-0000-0000-0000-000000000b01', 5, '28320000-0000-0000-0000-000000000d11'),
  ('28320000-0000-0000-0000-000000000c21', '28320000-0000-0000-0000-0000000000a2', 'Foreign induction', true, 1, '28320000-0000-0000-0000-000000000b08', 5, null),
  ('28320000-0000-0000-0000-000000000c31', '28320000-0000-0000-0000-0000000000a3', 'Off induction', true, 1, '28320000-0000-0000-0000-000000000b31', 5, null);
-- The targets were set twenty days ago: a person created ten days ago is then five days past a 5-day target. A target set
-- today can never be overdue for a person created today or later, which is the rule under test, not a test artefact.
set local session_replication_role = replica;
update clearance_items set target_set_at = now() - interval '20 days'
 where id in ('28320000-0000-0000-0000-000000000c11', '28320000-0000-0000-0000-000000000c12',
              '28320000-0000-0000-0000-000000000c21', '28320000-0000-0000-0000-000000000c31');
set local session_replication_role = origin;
insert into people (id, org_id, code, name, created_by, created_at) values
  ('28320000-0000-0000-0000-000000000e11', '28320000-0000-0000-0000-0000000000a1', 'CTDR-1', 'Clearance One',
   '28320000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') + interval '10 days'),
  ('28320000-0000-0000-0000-000000000e12', '28320000-0000-0000-0000-0000000000a1', 'CTDR-2', 'Clearance Two',
   '28320000-0000-0000-0000-000000000b04', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') + interval '10 days'),
  ('28320000-0000-0000-0000-000000000e13', '28320000-0000-0000-0000-0000000000a1', 'CTDR-3', 'Clearance Three',
   null, (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') + interval '10 days'),
  ('28320000-0000-0000-0000-000000000e14', '28320000-0000-0000-0000-0000000000a1', 'CTDR-4', 'Clearance Four',
   '28320000-0000-0000-0000-000000000b09', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') + interval '10 days'),
  ('28320000-0000-0000-0000-000000000e15', '28320000-0000-0000-0000-0000000000a1', 'CTDR-5', 'Clearance Five',
   '28320000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') + interval '10 days'),
  ('28320000-0000-0000-0000-000000000e16', '28320000-0000-0000-0000-0000000000a1', 'CTDR-6', 'Clearance Today',
   '28320000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') + interval '20 days'),
  ('28320000-0000-0000-0000-000000000e17', '28320000-0000-0000-0000-0000000000a1', 'CTDR-7', 'Clearance Preexisting',
   '28320000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c11') - interval '1 second'),
  ('28320000-0000-0000-0000-000000000e61', '28320000-0000-0000-0000-0000000000a2', 'CTDR-B', 'Foreign Clearance',
   '28320000-0000-0000-0000-000000000b08', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c21') + interval '10 days'),
  ('28320000-0000-0000-0000-000000000e62', '28320000-0000-0000-0000-0000000000a3', 'CTDR-C', 'Off Clearance',
   '28320000-0000-0000-0000-000000000b31', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c31') + interval '10 days');
insert into person_clearances (id, person_id, item_id, done_on) values
  ('28320000-0000-0000-0000-000000000ae1', '28320000-0000-0000-0000-000000000e15', '28320000-0000-0000-0000-000000000c11', current_date);
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, issued_on, expires_on) values
  ('28320000-0000-0000-0000-000000000af1', '28320000-0000-0000-0000-0000000000a1', 'person',
   '28320000-0000-0000-0000-000000000e15', '28320000-0000-0000-0000-000000000d11', current_date - 30, current_date + 30);
-- One billing step with a target, overdue by one day: the unchanged part of the runner.
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, created_by) values
  ('28320000-0000-0000-0000-000000000ab1', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000c01', 'progress', 'IDR', 0,
   '28320000-0000-0000-0000-000000000b01');
insert into claim_billing_stages (id, org_id, claim_id, project_id, position, name, client_side, started_on, target_days) values
  ('28320000-0000-0000-0000-000000000ac1', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-000000000ab1',
   '28320000-0000-0000-0000-0000000000c01', 1, 'Measure', false, public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 11, 10);

create function pg_temp.as_job() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.notes(p_owner text, p_title text default null) returns int language sql as $$
  select count(*)::int from notifications n
   where n.owner_id = ('28320000-0000-0000-0000-000000000' || p_owner)::uuid
     and (p_title is null or n.title = p_title) $$;
create function pg_temp.org_notes(p_org text, p_title text) returns int language sql as $$
  select count(*)::int from notifications n
   where n.org_id = ('28320000-0000-0000-0000-000000000' || p_org)::uuid and n.title = p_title $$;
create function pg_temp.audits(p_action text) returns int language sql as $$
  select count(*)::int from audit_events where action = p_action $$;

-- ── nothing has run yet ─────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from notifications where title in
            ('Billing step is overdue', 'Close-out item is overdue', 'Clearance item is overdue')), 0,
  'no overdue notice exists before the daily run');

-- ── AC-CTD-002/003/006/008: one run notifies every overdue item once, to the right person ───────────────────────────────
select pg_temp.as_job();
select is(notify_overdue_billing_stages(), 15,
  'AC-CTD-008 the one daily run returns billing 1 + close-out 5 + clearance 9');
select is(pg_temp.org_notes('a1', 'Close-out item is overdue'), 4,
  'AC-CTD-002 the four overdue close-out items of this organisation are notified');
select is(pg_temp.org_notes('a1', 'Clearance item is overdue'), 8,
  'AC-CTD-006 the eight overdue clearance items of this organisation are notified');
select is(pg_temp.org_notes('a1', 'Billing step is overdue'), 1,
  'AC-CTD-008 the billing step is still notified exactly as before');
select is(pg_temp.org_notes('a2', 'Close-out item is overdue'), 1,
  'AC-CTD-003 the other organisation''s own overdue item is notified inside it');
select is(pg_temp.org_notes('a2', 'Clearance item is overdue'), 1,
  'AC-CTD-006 the other organisation''s own overdue clearance is notified inside it');
select is(pg_temp.org_notes('a3', 'Clearance item is overdue'), 0,
  'AC-CTD-006 an organisation with the clearance checklist off is not scanned');
select is(pg_temp.notes('b02', 'Close-out item is overdue'), 1,
  'AC-CTD-002 the active issuer is the one told (not the Admin)');
select is(pg_temp.notes('b02', 'Billing step is overdue'), 1,
  'AC-CTD-008 the project manager is still the billing recipient');
select is(pg_temp.notes('b01', 'Close-out item is overdue'), 3,
  'AC-CTD-003 a missing, a disabled and a foreign issuer each fall back to this organisation''s active Admin');
select is(pg_temp.notes('b01', 'Clearance item is overdue'), 6,
  'AC-CTD-006 the missing, disabled and foreign creators fall back to the active Admin');
select is(pg_temp.notes('b03', 'Clearance item is overdue'), 2,
  'AC-CTD-006 the person record''s active creator is told for both of their items');
select is(pg_temp.notes('b04'), 0, 'AC-CTD-003 a disabled issuer is never told');
select is(pg_temp.notes('b05'), 0, 'AC-CTD-006 an uninvolved member is never told');
select is(pg_temp.notes('b09', 'Clearance item is overdue'), 0,
  'AC-CTD-003 a foreign creator is told nothing about this organisation''s clearance');
select is((select count(*)::int from notifications n
            where n.org_id = '28320000-0000-0000-0000-0000000000a1' and n.owner_id = '28320000-0000-0000-0000-000000000b09'),
  0, 'AC-CTD-003 the foreign issuer is told nothing about this organisation''s work orders');
select is((select count(*)::int from notifications n join profiles p on p.id = n.owner_id where n.org_id <> p.org_id), 0,
  'FR-CTD-006 every notice stays inside its recipients'' own organisation');
select is((select body from notifications where owner_id = '28320000-0000-0000-0000-000000000b02' and title = 'Close-out item is overdue'),
  'Close-out item "Open punch list" on work order WO-1 is 6 days past its 5-day target.',
  'AC-CTD-002 the close-out notice names the item, the work order and the days over');
select is((select metadata -> 'entity' ->> 'type' || ':' || (metadata -> 'entity' ->> 'id') from notifications
            where owner_id = '28320000-0000-0000-0000-000000000b02' and title = 'Close-out item is overdue'),
  'work_order:28320000-0000-0000-0000-0000000000e01', 'AC-CTD-002 the close-out notice opens its work order');
select is((select body from notifications where owner_id = '28320000-0000-0000-0000-000000000b01'
            and title = 'Clearance item is overdue' and body like '%Clearance Two%'),
  'Clearance item "Site induction" for Clearance Two is 5 days past its 5-day target.',
  'AC-CTD-006 the clearance notice names the item, the person and the days over');
select is((select metadata -> 'entity' ->> 'type' || ':' || (metadata -> 'entity' ->> 'id') from notifications
            where owner_id = '28320000-0000-0000-0000-000000000b01'
              and title = 'Clearance item is overdue' and body like '%Clearance Two%'),
  'person_clearance:28320000-0000-0000-0000-000000000e12', 'AC-CTD-006 the clearance notice opens the person''s checklist');
select is((select body from notifications where owner_id = '28320000-0000-0000-0000-000000000b02' and title = 'Billing step is overdue'),
  'Billing step "Measure" of a progress claim on CTD run project is 1 day past its 10-day target.',
  'AC-CTD-008 the billing notice text is the unchanged 1363/1368 form');
select is(pg_temp.audits('closeout_item.overdue'), 5, 'AC-CTD-002 each notified close-out item is audited once');
select is(pg_temp.audits('clearance_item.overdue'), 9, 'AC-CTD-006 each notified clearance item is audited once');
select is(pg_temp.audits('billing_stage.overdue'), 1, 'AC-CTD-008 the billing audit is unchanged');
select is((select count(*)::int from work_order_closeout_items where overdue_notified_at is not null), 5,
  'AC-CTD-002 each notified close-out item carries its once-only stamp');
select is((select count(*)::int from person_clearance_overdue_notices), 9,
  'AC-CTD-006 each notified clearance pair carries its once-only row');
select is((select count(*)::int from (select person_id, item_id from person_clearance_overdue_notices
                                       group by person_id, item_id) q), 9,
  'AC-CTD-006 no clearance pair is written twice');
select is((select count(*)::int from work_order_closeout_items
            where id in ('28320000-0000-0000-0000-000000000f02',   -- exactly due today
                         '28320000-0000-0000-0000-000000000f06',   -- done
                         '28320000-0000-0000-0000-000000000f07')   -- no due day
              and overdue_notified_at is not null), 0,
  'AC-CTD-003 an item exactly due, a done item and a no-target item are never stamped');
select is((select count(*)::int from notifications
            where title = 'Close-out item is overdue' and body like '%Already done item%'), 0,
  'AC-CTD-003 a done close-out item is never notified');
select is((select count(*)::int from notifications
            where title = 'Close-out item is overdue' and body like '%No due item%'), 0,
  'AC-CTD-003 an item without a due day is never notified');
select is((select count(*)::int from notifications
            where metadata -> 'entity' ->> 'id' = '28320000-0000-0000-0000-000000000e15'), 0,
  'AC-CTD-006 a person whose items are done manually and by a live document is not notified');
select is((select count(*)::int from notifications
            where metadata -> 'entity' ->> 'id' in ('28320000-0000-0000-0000-000000000e16',
                                                     '28320000-0000-0000-0000-000000000e17')), 0,
  'AC-CTD-006 a person created today and an existing person are not notified');
select is((select count(*)::int from notifications
            where org_id = '28320000-0000-0000-0000-0000000000a1' and body like '%B overdue item%'), 0,
  'AC-CTD-003 no foreign item crosses into this organisation''s notices');

-- ── once-only: a second run, and a run where another run already won the race ────────────────────────────────────────────
select is(notify_overdue_billing_stages(), 0, 'AC-CTD-002 a second run notifies nobody');
select is((select count(*)::int from notifications where title in
            ('Billing step is overdue', 'Close-out item is overdue', 'Clearance item is overdue')), 15,
  'AC-CTD-002/006 a second run adds no notice (4 + 8 + 1 here, 1 + 1 in the other organisation)');
insert into work_order_closeout_items
  (id, org_id, work_order_id, project_id, position, name, required, started_on, target_days, due_on, overdue_notified_at) values
  ('28320000-0000-0000-0000-000000000f09', '28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-0000000000e07',
   '28320000-0000-0000-0000-0000000000c01', 1, 'Already told item', true,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 10, 5,
   public.native_org_today('28320000-0000-0000-0000-0000000000a1'::uuid) - 4, now());
insert into clearance_items (id, org_id, name, is_required, sort_order, created_by, target_days) values
  ('28320000-0000-0000-0000-000000000c13', '28320000-0000-0000-0000-0000000000a1', 'Already told clearance', true, 3, '28320000-0000-0000-0000-000000000b01', 5);
-- A target set forty days ago, with the person created thirty days ago, is overdue by twenty-five days and was created before
-- the other items' targets were set (so it is nobody else's item); the row then simulates a concurrent run that already wrote
-- the notice.
set local session_replication_role = replica;
update clearance_items set target_set_at = now() - interval '40 days' where id = '28320000-0000-0000-0000-000000000c13';
set local session_replication_role = origin;
insert into people (id, org_id, code, name, created_by, created_at) values
  ('28320000-0000-0000-0000-000000000e18', '28320000-0000-0000-0000-0000000000a1', 'CTDR-8', 'Clearance Eight',
   '28320000-0000-0000-0000-000000000b03', (select target_set_at from clearance_items where id = '28320000-0000-0000-0000-000000000c13') + interval '10 days');
insert into person_clearance_overdue_notices (id, org_id, person_id, item_id) values
  ('28320000-0000-0000-0000-000000000aa1', '28320000-0000-0000-0000-0000000000a1',
   '28320000-0000-0000-0000-000000000e18', '28320000-0000-0000-0000-000000000c13');
select pg_temp.as_job();
select is(notify_overdue_billing_stages(), 0,
  'AC-CTD-006 a run never repeats a close-out stamp or a clearance notice another run already wrote');
select is(pg_temp.notes('b02', 'Close-out item is overdue'), 1,
  'AC-CTD-002 the already-stamped close-out item is not told again');
select is(pg_temp.notes('b03', 'Clearance item is overdue'), 2,
  'AC-CTD-006 the clearance pair another run won is not told again');
select is((select count(*)::int from person_clearance_overdue_notices), 10,
  'AC-CTD-006 no notice row grew on the racing pair (the simulated winner''s row is the only one)');
select throws_ok($q$insert into person_clearance_overdue_notices (org_id, person_id, item_id)
  values ('28320000-0000-0000-0000-0000000000a1', '28320000-0000-0000-0000-000000000e18', '28320000-0000-0000-0000-000000000c13')$q$,
  '23505', null, 'AC-CTD-006 the (person, item) unique key refuses a second notice row');

-- ── the module switch is the existing organisation flag, nothing new ─────────────────────────────────────────────────────
update organizations set clearance_checklist_enabled = true where id = '28320000-0000-0000-0000-0000000000a3';
select pg_temp.as_job();
select is(notify_overdue_billing_stages(), 1,
  'AC-CTD-006 turning the existing clearance flag on makes the next run scan that organisation');
select is(pg_temp.notes('b31', 'Clearance item is overdue'), 1,
  'AC-CTD-006 the newly enabled organisation''s creator is told once');
select is(notify_overdue_billing_stages(), 0, 'AC-CTD-006 the following run is quiet again');

-- ── scheduling and the client boundary are unchanged ────────────────────────────────────────────────────────────────────
select is((select count(*)::int from cron.job where jobname = 'billing-stage-overdue'), 1,
  'FR-CTD-006 one daily schedule still drives all three scans');
select ok(to_regprocedure('public.notify_overdue_billing_stages()') is not null,
  'AC-CTD-008 the runner keeps its name and signature for the cron entry');
select ok(not has_function_privilege('authenticated', 'public.notify_overdue_closeout_items()', 'execute'),
  'FR-CTD-006 authenticated clients cannot run the close-out scan');
select ok(not has_function_privilege('authenticated', 'public.notify_overdue_clearance_items()', 'execute'),
  'FR-CTD-006 authenticated clients cannot run the clearance scan');
select ok(not has_function_privilege('authenticated', 'public.notify_overdue_billing_stages()', 'execute'),
  'AC-CTD-008 authenticated clients still cannot run the billing runner');
select ok(not has_function_privilege('anon', 'public.notify_overdue_clearance_items()', 'execute'),
  'FR-CTD-006 anon cannot run the clearance scan');

select * from finish();
rollback;
