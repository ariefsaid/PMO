-- budget_occupant_resolution.test.sql — 0483 (ECA-6, #1603). Owns the database half of AC-ECA-031 (docs/specs/erp-connect-anytime.spec.md):
-- the recorded, single-use replace consent and the Draft built from an ERP budget.
begin;
create extension if not exists pgtap;
select plan(28);

insert into public.organizations(id, name, default_currency) values
  ('16030000-0000-0000-0000-00000000000a', 'BOC Org', 'IDR'),
  ('16030000-0000-0000-0000-00000000000b', 'BOC Other', 'IDR');
insert into auth.users(id, email) values
  ('16030000-0000-0000-0000-0000000000a1', 'boc-admin@example.test'),
  ('16030000-0000-0000-0000-0000000000a2', 'boc-fin@example.test'),
  ('16030000-0000-0000-0000-0000000000a3', 'boc-eng@example.test'),
  ('16030000-0000-0000-0000-0000000000a4', 'boc-pm@example.test'),
  ('16030000-0000-0000-0000-0000000000a5', 'boc-exec@example.test'),
  ('16030000-0000-0000-0000-0000000000b1', 'boc-xorg@example.test');
insert into public.profiles(id, org_id, full_name, email, role, status) values
  ('16030000-0000-0000-0000-0000000000a1', '16030000-0000-0000-0000-00000000000a', 'BOC Admin', 'boc-admin@example.test', 'Admin', 'active'),
  ('16030000-0000-0000-0000-0000000000a2', '16030000-0000-0000-0000-00000000000a', 'BOC Fin', 'boc-fin@example.test', 'Finance', 'active'),
  ('16030000-0000-0000-0000-0000000000a3', '16030000-0000-0000-0000-00000000000a', 'BOC Eng', 'boc-eng@example.test', 'Engineer', 'active'),
  ('16030000-0000-0000-0000-0000000000a4', '16030000-0000-0000-0000-00000000000a', 'BOC PM', 'boc-pm@example.test', 'Project Manager', 'active'),
  ('16030000-0000-0000-0000-0000000000a5', '16030000-0000-0000-0000-00000000000a', 'BOC Exec', 'boc-exec@example.test', 'Executive', 'active'),
  ('16030000-0000-0000-0000-0000000000b1', '16030000-0000-0000-0000-00000000000b', 'BOC XOrg', 'boc-xorg@example.test', 'Admin', 'active');
insert into public.projects(id, org_id, code, name, status) values
  ('16030000-0000-0000-0000-0000000000c1', '16030000-0000-0000-0000-00000000000a', 'BOC1', 'Has active budget', 'Ongoing Project'),
  ('16030000-0000-0000-0000-0000000000c2', '16030000-0000-0000-0000-00000000000a', 'BOC2', 'No budget', 'Ongoing Project'),
  ('16030000-0000-0000-0000-0000000000cb', '16030000-0000-0000-0000-00000000000b', 'BOCX', 'Other org', 'Ongoing Project');
insert into public.budget_versions(id, org_id, project_id, version, name, status) values
  ('16030000-0000-0000-0000-0000000000d1', '16030000-0000-0000-0000-00000000000a', '16030000-0000-0000-0000-0000000000c1', 1, 'PMO v1', 'Active'),
  ('16030000-0000-0000-0000-0000000000db', '16030000-0000-0000-0000-00000000000b', '16030000-0000-0000-0000-0000000000cb', 1, 'Other v1', 'Active');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table _c (k text primary key, v uuid) on commit drop;
grant all on _c to authenticated;
set local role authenticated;

-- ── the consent ────────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('16030000-0000-0000-0000-0000000000a3');   -- Engineer
select throws_ok($$ select consent_budget_occupant_replace('16030000-0000-0000-0000-0000000000c1', '2026', '5100 - Labor', 'DESK-BUDGET') $$,
  '42501', null, 'AC-ECA-031 an Engineer cannot record a replace consent');

select pg_temp.act_as('16030000-0000-0000-0000-0000000000a2');   -- Finance
insert into _c select 'c1', consent_budget_occupant_replace('16030000-0000-0000-0000-0000000000c1', '2026', '5100 - Labor', 'DESK-BUDGET');
select is((select count(*)::int from budget_occupant_consents), 1, 'AC-ECA-031 Finance records the consent and can read it');
select is((select consumed_at is null and consented_by = '16030000-0000-0000-0000-0000000000a2'::uuid
             and erp_budget_name = 'DESK-BUDGET' and erp_account = '5100 - Labor' from budget_occupant_consents),
  true, 'AC-ECA-031 the consent names the exact ERP budget, account and year, is unconsumed, and records who consented');
select throws_ok($$ select consent_budget_occupant_replace('16030000-0000-0000-0000-0000000000c2', '2026', '5100 - Labor', 'DESK-BUDGET') $$,
  'P0001', null, 'AC-ECA-031 a project with no active budget version cannot be consented (nothing to push)');
select throws_ok($$ select consent_budget_occupant_replace('16030000-0000-0000-0000-0000000000cb', '2026', '5100 - Labor', 'DESK-BUDGET') $$,
  'P0002', null, 'AC-ECA-031 another org''s project cannot be consented');
select throws_ok($$ select consent_budget_occupant_replace('16030000-0000-0000-0000-0000000000c1', '2026', '5100 - Labor', '  ') $$,
  '22023', null, 'AC-ECA-031 a consent must name an ERP budget');
select throws_ok($$ insert into budget_occupant_consents(org_id, project_id, fiscal_year, erp_account, erp_budget_name, consented_by)
  values ('16030000-0000-0000-0000-00000000000a', '16030000-0000-0000-0000-0000000000c1', '2026', 'x', 'FORGED', '16030000-0000-0000-0000-0000000000a2') $$,
  '42501', null, 'AC-ECA-031 a client cannot write a consent row directly');

select pg_temp.act_as('16030000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from budget_occupant_consents), 0, 'AC-ECA-031 an Engineer cannot read consents');
select pg_temp.act_as('16030000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from budget_occupant_consents), 0, 'AC-ECA-031 another org''s Admin cannot read consents');

select ok(not has_function_privilege('authenticated', 'public.consume_budget_occupant_consent(uuid, uuid, uuid)', 'EXECUTE'),
  'AC-ECA-031 a client cannot spend a consent');

reset role;
select is((select count(*)::int from audit_events where action = 'budget.occupant_replace_consent' and entity_id = (select v from _c where k = 'c1')), 1,
  'AC-ECA-031 the consent is audited');

-- ── single use ─────────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select consume_budget_occupant_consent('16030000-0000-0000-0000-00000000000a', (select v from _c where k = 'c1'), '16030000-0000-0000-0000-0000000000a2') $$,
  'AC-ECA-031 the service spends the consent');
select ok((select consumed_at is not null from budget_occupant_consents where id = (select v from _c where k = 'c1')), 'AC-ECA-031 the consent is consumed');
select lives_ok($$ select consume_budget_occupant_consent('16030000-0000-0000-0000-00000000000a', (select v from _c where k = 'c1'), '16030000-0000-0000-0000-0000000000a2') $$,
  'AC-ECA-031 spending twice is harmless');
select is((select count(*)::int from audit_events where action = 'budget.occupant_replaced' and entity_id = (select v from _c where k = 'c1')), 1,
  'AC-ECA-031 one audit row for the replacement, not one per call');
select lives_ok($$ select consume_budget_occupant_consent('16030000-0000-0000-0000-00000000000b', (select v from _c where k = 'c1'), '16030000-0000-0000-0000-0000000000b1') $$,
  'AC-ECA-031 another org cannot spend this consent (no effect)');
select is((select count(*)::int from audit_events where action = 'budget.occupant_replaced'), 1, 'AC-ECA-031 a cross-org spend wrote nothing');

set local role authenticated;
select pg_temp.act_as('16030000-0000-0000-0000-0000000000a1');   -- Admin consents again for the same document
insert into _c select 'c1again', consent_budget_occupant_replace('16030000-0000-0000-0000-0000000000c1', '2026', '5100 - Labor', 'DESK-BUDGET');
select is((select v from _c where k = 'c1again'), (select v from _c where k = 'c1'), 'AC-ECA-031 consenting again reuses the one row for that document');
select ok((select consumed_at is null from budget_occupant_consents where id = (select v from _c where k = 'c1')), 'AC-ECA-031 and re-arms it');

-- ── the Draft built from the ERP figures ───────────────────────────────────────────────────────────
select pg_temp.act_as('16030000-0000-0000-0000-0000000000a3');
select throws_ok($$ select create_budget_draft_from_erp('16030000-0000-0000-0000-0000000000c1', 'DESK-BUDGET',
  '[{"category":"Labor","budgeted_amount":"50000000.00","fiscal_year":"2026"}]'::jsonb) $$,
  '42501', null, 'AC-ECA-031 an Engineer cannot create the draft');

-- Admin and Finance only (FR-ECA-041): a PM or an Executive can write budget lines elsewhere, but cannot label a Draft as the ERP's.
select pg_temp.act_as('16030000-0000-0000-0000-0000000000a4');   -- Project Manager
select throws_ok($$ select create_budget_draft_from_erp('16030000-0000-0000-0000-0000000000c1', 'DESK-BUDGET',
  '[{"category":"Labor","budgeted_amount":"50000000.00","fiscal_year":"2026"}]'::jsonb) $$,
  '42501', null, 'AC-ECA-031 a Project Manager cannot create the draft');
select pg_temp.act_as('16030000-0000-0000-0000-0000000000a5');   -- Executive
select throws_ok($$ select create_budget_draft_from_erp('16030000-0000-0000-0000-0000000000c1', 'DESK-BUDGET',
  '[{"category":"Labor","budgeted_amount":"50000000.00","fiscal_year":"2026"}]'::jsonb) $$,
  '42501', null, 'AC-ECA-031 an Executive cannot create the draft');
select is((select count(*)::int from budget_versions where project_id = '16030000-0000-0000-0000-0000000000c1' and name like 'From ERP%'), 0,
  'AC-ECA-031 the refused callers left no draft behind');

select pg_temp.act_as('16030000-0000-0000-0000-0000000000a2');
insert into _c select 'draft', create_budget_draft_from_erp('16030000-0000-0000-0000-0000000000c1', 'DESK-BUDGET',
  '[{"category":"Labor","budgeted_amount":"50000000.00","fiscal_year":"2026"},{"category":"Materials","budgeted_amount":"1250.50","fiscal_year":"2026"}]'::jsonb);
select is((select status::text || ':' || version::text || ':' || name from budget_versions where id = (select v from _c where k = 'draft')),
  'Draft:2:From ERP DESK-BUDGET', 'AC-ECA-031 a Draft version is created after the existing ones');
select is((select string_agg(category::text || '=' || budgeted_amount::text, ',' order by category::text) from budget_line_items where budget_version_id = (select v from _c where k = 'draft')),
  'Labor=50000000.00,Materials=1250.50', 'AC-ECA-031 the draft holds the ERP figures');
select is((select status::text from budget_versions where id = '16030000-0000-0000-0000-0000000000d1'), 'Active', 'AC-ECA-031 the active version is untouched');
select throws_ok($$ select create_budget_draft_from_erp('16030000-0000-0000-0000-0000000000cb', 'DESK-BUDGET',
  '[{"category":"Labor","budgeted_amount":"1.00","fiscal_year":"2026"}]'::jsonb) $$,
  'P0002', null, 'AC-ECA-031 another org''s project cannot get a draft');
select throws_ok($$ select create_budget_draft_from_erp('16030000-0000-0000-0000-0000000000c1', 'DESK-BUDGET', '[]'::jsonb) $$,
  '22023', null, 'AC-ECA-031 a draft with no lines is refused');

select * from finish();
rollback;
