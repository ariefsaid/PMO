-- #1462: source-kind compatibility and reversible account-only schema contract.
-- The shell proof exercises the actual down/up migration files because an expected DDL failure
-- aborts a pgTAP transaction before the assertion can run.
begin;
select plan(11);

insert into organizations(id, name)
values ('0575cc00-0000-0000-0000-000000000001', 'Archive rollback fixture');
insert into auth.users(id, email)
values ('0575cc00-0000-0000-0000-0000000000a1', 'archive-rollback@example.invalid');
insert into profiles(id, org_id, full_name, email, role, status)
values ('0575cc00-0000-0000-0000-0000000000a1', '0575cc00-0000-0000-0000-000000000001',
        'Archive rollback fixture', 'archive-rollback@example.invalid', 'Finance', 'active');
insert into projects(id, org_id, name, status)
values ('0575cc00-0000-0000-0000-0000000000c1', '0575cc00-0000-0000-0000-000000000001', 'Rollback fixture project', 'Ongoing Project');
insert into budget_versions(id, org_id, project_id, version, name, status, activated_at)
values ('0575cc00-0000-0000-0000-0000000000d1', '0575cc00-0000-0000-0000-000000000001',
        '0575cc00-0000-0000-0000-0000000000c1', 1, 'Rollback fixture budget', 'Archived', '2026-10-28T00:00:00Z');
insert into budget_archive_requests(id, org_id, project_id, budget_version_id, requested_by, cancel_erp)
values ('0575cc00-0000-0000-0000-0000000000e1', '0575cc00-0000-0000-0000-000000000001',
        '0575cc00-0000-0000-0000-0000000000c1', '0575cc00-0000-0000-0000-0000000000d1',
        '0575cc00-0000-0000-0000-0000000000a1', true);

select has_column('public', 'budget_archive_cancel_intents', 'source_kind',
  'AC-BUD-122: reversible schema records explicit archive source kind');
select ok(has_function_privilege('authenticated', 'public.get_budget_archive_targets(uuid)', 'EXECUTE'),
  'AC-BUD-122: authenticated members can read the disclosed inventory');
select ok(not has_function_privilege('anon', 'public.get_budget_archive_targets(uuid)', 'EXECUTE'),
  'AC-BUD-122: anonymous callers cannot read the disclosed inventory');
select ok(has_function_privilege('service_role', 'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)', 'EXECUTE'),
  'AC-BUD-122: source-kind transitions remain service-role only');
select ok(has_function_privilege('service_role', 'public.budget_archive_target_inventory(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.budget_archive_target_inventory(uuid)', 'EXECUTE'),
  'AC-BUD-122: internal inventory is not directly callable by authenticated users');

insert into budget_archive_cancel_intents
  (id, org_id, request_id, project_id, budget_version_id, source_mirror_id, actor_user_id,
   fiscal_year, erp_account, erp_budget_name, activated_at_witness)
values ('0575cc00-0000-0000-0000-0000000000a2', '0575cc00-0000-0000-0000-000000000001',
        '0575cc00-0000-0000-0000-0000000000e1', '0575cc00-0000-0000-0000-0000000000c1',
        '0575cc00-0000-0000-0000-0000000000d1', '0575cc00-0000-0000-0000-0000000000f1',
        '0575cc00-0000-0000-0000-0000000000a1', '2026', '5100 - Labor - RB', 'BUD-ACCOUNT-RB', '2026-10-28T00:00:00Z');
select is((select source_kind from budget_archive_cancel_intents where id='0575cc00-0000-0000-0000-0000000000a2'), 'account',
  'AC-BUD-122: existing inserts default to account provenance');

insert into budget_archive_cancel_intents
  (id, org_id, request_id, project_id, budget_version_id, source_kind, source_mirror_id, actor_user_id,
   fiscal_year, erp_account, erp_budget_name, activated_at_witness)
values ('0575cc00-0000-0000-0000-0000000000a3', '0575cc00-0000-0000-0000-000000000001',
        '0575cc00-0000-0000-0000-0000000000e1', '0575cc00-0000-0000-0000-0000000000c1',
        '0575cc00-0000-0000-0000-0000000000d1', 'legacy', '0575cc00-0000-0000-0000-0000000000f1',
        '0575cc00-0000-0000-0000-0000000000a1', '2026', null, 'BUD-LEGACY-RB', '2026-10-28T00:00:00Z');
select is((select count(*)::int from budget_archive_cancel_intents where request_id='0575cc00-0000-0000-0000-0000000000e1'), 2,
  'AC-BUD-122: account and legacy sources may coexist in one request');
select throws_ok($$ insert into budget_archive_cancel_intents
  (org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness)
  values ('0575cc00-0000-0000-0000-000000000001','0575cc00-0000-0000-0000-0000000000e1','0575cc00-0000-0000-0000-0000000000c1','0575cc00-0000-0000-0000-0000000000d1','account','0575cc00-0000-0000-0000-0000000000f2','0575cc00-0000-0000-0000-0000000000a1','2026',null,'BUD-NULL-ACCOUNT','2026-10-28T00:00:00Z') $$,
  '23514', null, 'AC-BUD-122: account intent cannot omit its ERP account');
select throws_ok($$ insert into budget_archive_cancel_intents
  (org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness)
  values ('0575cc00-0000-0000-0000-000000000001','0575cc00-0000-0000-0000-0000000000e1','0575cc00-0000-0000-0000-0000000000c1','0575cc00-0000-0000-0000-0000000000d1','legacy','0575cc00-0000-0000-0000-0000000000f2','0575cc00-0000-0000-0000-0000000000a1','2026','5100 - Labor - RB','BUD-ACCOUNT-FOR-LEGACY','2026-10-28T00:00:00Z') $$,
  '23514', null, 'AC-BUD-122: legacy intent cannot carry an invented account');
select throws_ok($$ insert into budget_archive_cancel_intents
  (org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness)
  values ('0575cc00-0000-0000-0000-000000000001','0575cc00-0000-0000-0000-0000000000e1','0575cc00-0000-0000-0000-0000000000c1','0575cc00-0000-0000-0000-0000000000d1','other','0575cc00-0000-0000-0000-0000000000f3','0575cc00-0000-0000-0000-0000000000a1','2026','5100 - Labor - RB','BUD-UNKNOWN-KIND','2026-10-28T00:00:00Z') $$,
  '23514', null, 'AC-BUD-122: unsupported source kinds are refused');
select throws_ok($$ insert into budget_archive_cancel_intents
  (org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness)
  values ('0575cc00-0000-0000-0000-000000000001','0575cc00-0000-0000-0000-0000000000e1','0575cc00-0000-0000-0000-0000000000c1','0575cc00-0000-0000-0000-0000000000d1','legacy','0575cc00-0000-0000-0000-0000000000f1','0575cc00-0000-0000-0000-0000000000a1','2026',null,'BUD-DUPLICATE-LEGACY','2026-10-28T00:00:00Z') $$,
  '23505', null, 'AC-BUD-122: same-kind source replay remains unique');

select finish();
rollback;
