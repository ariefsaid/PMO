-- 0179_seed_contract_value_witness.test.sql
-- Seed-data guard for ADR-0070 / migrations 0177, 0181, and 0183.
-- The seeded projects are fixtures for the contract-value witness SoD, not production data.

begin;
create extension if not exists pgtap;
select plan(10);

-- Every priced seed row except the named self-witness fixture must have a witness.  The
-- string_agg is intentional: a future missing witness reports the project(s), not only a count.
select is(
  (
    select coalesce(
      string_agg(format('%s (%s)', coalesce(code, '<no code>'), name), ', ' order by code, name),
      '<none>'
    )
    from public.projects
    where contract_value > 0
      and contract_value_set_by is null
      and coalesce(code, '') <> 'SP-2408'
  ),
  '<none>',
  'AC-0179-001 every priced seeded project other than the documented self-witness fixture has a contract-value witness, naming offenders'
);

select is(
  (select contract_value_set_by::text from public.projects where code = 'SP-2408'),
  (select project_manager_id::text from public.projects where code = 'SP-2408'),
  'AC-0179-002 SP-2408 is still deliberately self-witnessed by its Project Manager (a2)'
);

select ok(
  not exists (
    select 1
    from public.projects
    where contract_value > 0
      and start_date is not null
      and contract_value_set_at >= start_date::timestamptz
  ),
  'AC-0179-003 every dated priced seed project was witnessed before its work start date'
);

-- The self-witness fixture starts at Leads. Walk the legal path before testing the win refusal.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_project(
       (select id from public.projects where code = 'SP-2408'),
       'PQ Submitted'::project_status) $$,
  'AC-0179-004 the seeded PM can walk the deliberate self-witness deal from Leads to PQ Submitted'
);
select lives_ok(
  $$ select transition_project(
       (select id from public.projects where code = 'SP-2408'),
       'Quotation Submitted'::project_status) $$,
  'AC-0179-005 the seeded PM can walk the deliberate self-witness deal from PQ Submitted to Quotation Submitted'
);
select throws_ok(
  $$ select transition_project(
       (select id from public.projects where code = 'SP-2408'),
       'Won, Pending KoM'::project_status, 'CPO-SEED-SELF-2408', '2026-03-15'::date) $$,
  '42501',
  'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-0179-006 the seeded PM cannot win the deliberately self-witnessed SP-2408 deal (0181 self-authored refusal)'
);
reset role;
select is(
  (select status::text from public.projects where code = 'SP-2408'),
  'Quotation Submitted',
  'AC-0179-007 the deliberately self-witnessed SP-2408 deal does not move after the refused win'
);

-- SP-2407 is Mara-witnessed and starts at PQ Submitted. Walk that legal path too, proving the
-- normal seeded happy path remains available to the PM who did not author the value.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_project(
       (select id from public.projects where code = 'SP-2407'),
       'Quotation Submitted'::project_status) $$,
  'AC-0179-008 the seeded PM can walk the Mara-witnessed deal from PQ Submitted to Quotation Submitted'
);
select lives_ok(
  $$ select transition_project(
       (select id from public.projects where code = 'SP-2407'),
       'Won, Pending KoM'::project_status, 'CPO-SEED-MARA-2407', '2026-03-15'::date) $$,
  'AC-0179-009 the seeded PM can win the Mara-witnessed SP-2407 deal after the legal path'
);
reset role;
select is(
  (select status::text from public.projects where code = 'SP-2407'),
  'Won, Pending KoM',
  'AC-0179-010 the Mara-witnessed seeded happy-path deal really reaches Won, Pending KoM'
);

select * from finish();
rollback;
