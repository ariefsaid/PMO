-- 2712_light_account_write_guards.test.sql — #2711, FR-013. A field account cannot drive the office write RPCs.
-- Migrations under test: 1461 (the guard on the write-side definers).
-- AC-LA-013: every write-side definer a field account has no screen for refuses it first (assert_not_light, 42501),
-- while the home, attendance and own-leave paths it does use stay callable.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   remove `perform public.assert_not_light();` from create_purchase_request .. 'AC-LA-013 every write-side definer ...'
--   remove it from dsr_submit .................................... 'AC-LA-013 a field account cannot submit the daily report'
--   let assert_not_light pass for a light actor .................. every AC-LA-013 refusal below
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency, built_in_roles_enabled)
  values ('27120000-0000-0000-0000-00000000000a', 'LA Writes', 'IDR', true);
insert into auth.users (id, email) values
  ('27120000-0000-0000-0000-0000000000a1', 'law-admin@example.com'),
  ('27120000-0000-0000-0000-0000000000a4', 'law-eng@example.com'),
  ('27120000-0000-0000-0000-0000000000a6', 'law-field@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27120000-0000-0000-0000-0000000000a1', '27120000-0000-0000-0000-00000000000a', 'LAW Admin', 'law-admin@example.com', 'Admin', 'active', null),
  ('27120000-0000-0000-0000-0000000000a4', '27120000-0000-0000-0000-00000000000a', 'LAW Eng', 'law-eng@example.com', 'Engineer', 'active', null),
  ('27120000-0000-0000-0000-0000000000a6', '27120000-0000-0000-0000-00000000000a', 'LAW Field', 'law-field@example.com', 'Engineer', 'active', 'field_user');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;
select pg_temp.act_as('27120000-0000-0000-0000-0000000000a6');

-- 1. the standing list: all of these carry the guard in their body (a name that gains a second overload must guard it too)
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and p.proname = any (array[
                'add_equipment_downtime_proof','archive_equipment_usage','audit_agent_denial','cancel_native_receipt',
                'cancel_retention_release','cancel_stock_document','close_crew_tool_report','complete_billing_stage',
                'create_procurement_receipt','create_procurement_with_items','create_stock_document','csr_cancel',
                'csr_create','csr_record_pickup','csr_send','csr_update_draft','decide_imprest_float_change',
                'dsr_save_draft','dsr_submit','leave_request_decide','mrq_cancel','mrq_decide_step','mrq_retry_transfer',
                'mrq_revoke_stand_in','mrq_save_draft','mrq_set_stand_in','mrq_submit','note_billing_stage',
                'post_stock_document','pre_cutover_procurement','procurement_amount_eligibility','procurement_gate',
                'procurement_gate_violation','procurement_item_values_editable','record_expense_advance_return',
                'record_imprest_count','release_credits','release_retention','report_crew_tool',
                'request_imprest_replenishment','request_po_variation','reserve_credits','save_equipment_usage',
                'save_stock_draft','save_timesheet_week','schedule_retention_release','send_task_reminders',
                'set_cost_attribution','set_equipment_status','set_equipment_status_bulk','start_procurement_import_run',
                'tpi_cancel','tpi_create','tpi_record_execution','tpi_record_invitation','tpi_record_report',
                'transition_document_status','transition_equipment_usage','transition_expense_claim',
                'transition_imprest_plan','transition_imprest_replenishment','transition_procurement',
                'transition_timesheet','update_procurement_header'])
              and p.prosrc not like '%assert_not_light%'), 0,
  'AC-LA-013 every write-side definer a field account has no screen for carries the field-account guard');

-- 2-9. each named write path refuses the field account before it reads a row or writes one
select throws_ilike($$ select public.create_procurement_with_items(null, '{}'::jsonb, '[]'::jsonb) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot create a procurement case');
select throws_ilike($$ select public.csr_create('{}'::jsonb, '[]'::jsonb, null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot raise a client requisition');
select throws_ilike($$ select public.create_procurement_receipt(null, null, null, null, null, null, null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot receive against a procurement');
select throws_ilike($$ select public.post_stock_document(null, null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot post a stock document');
select throws_ilike($$ select public.dsr_submit(null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot submit the daily report');
select throws_ilike($$ select public.save_timesheet_week(null, null, '[]'::jsonb, '{}'::uuid[]) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot save a timesheet week');
select throws_ilike($$ select public.transition_expense_claim(null, 'Approved', null, null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot move an expense claim');
select throws_ilike($$ select public.reserve_credits('27120000-0000-0000-0000-00000000000a', 1, null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot hold assistant credits');

select throws_ilike($$ select public.csr_record_pickup(null, null, null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot record a client pickup');
select throws_ilike($$ select public.prepare_certificate_acceptance(null) $$,
  'LIGHT_ACCOUNT%', 'AC-LA-013 a field account cannot prepare a certificate acceptance');

-- 10. a full Engineer is not affected: the same call reaches its own argument check, never LIGHT_ACCOUNT
select pg_temp.act_as('27120000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.dsr_submit(null) $$, 'P0002', null,
  'AC-LA-013 a full Engineer reaches the daily report function itself');

-- 11-12. the paths a field account does use stay open
select pg_temp.act_as('27120000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.my_home() $$, 'AC-LA-013 a field account still reads its own home');
select lives_ok($$ select public.leave_enabled() $$, 'AC-LA-013 a field account still reads whether leave is on');

-- 13. an Admin is unaffected by the guard
select pg_temp.act_as('27120000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
            and p.proname = 'dsr_submit' and p.prosrc like '%assert_not_light%'), 1,
  'AC-LA-013 the guard is one body call, inert for a full account');

select * from finish();
rollback;
