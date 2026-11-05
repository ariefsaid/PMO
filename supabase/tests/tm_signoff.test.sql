-- tm_signoff.test.sql — T3 of #1514: client sign-off and the invoice bridge for time-and-materials claims.
-- Fixture F1: docs/plans/2026-11-02-time-and-materials-claims.md (copied from tm_assembly.test.sql, then extended).
-- Ids: 15140000-… (synthetic). Users: b1 fin1, b2 fin2, b3 admin, b4 pm1 (project c1), b5 pm2, b6 eng1, b7 eng2,
-- b8 foreign admin (org a2), b9 the only member of org a3 (sole-operator case).
begin;
create extension if not exists pgtap;
select plan(108);

-- ── Fixture F1 ──────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('15140000-0000-0000-0000-0000000000a1', 'TM Org A', 'IDR', 'UTC'),
  ('15140000-0000-0000-0000-0000000000a2', 'TM Org B', 'IDR', 'UTC'),
  ('15140000-0000-0000-0000-0000000000a3', 'TM Org C (one member)', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15140000-0000-0000-0000-0000000000b1', 'tm-fin1@example.com'),
  ('15140000-0000-0000-0000-0000000000b2', 'tm-fin2@example.com'),
  ('15140000-0000-0000-0000-0000000000b3', 'tm-admin@example.com'),
  ('15140000-0000-0000-0000-0000000000b4', 'tm-pm1@example.com'),
  ('15140000-0000-0000-0000-0000000000b5', 'tm-pm2@example.com'),
  ('15140000-0000-0000-0000-0000000000b6', 'tm-eng1@example.com'),
  ('15140000-0000-0000-0000-0000000000b7', 'tm-eng2@example.com'),
  ('15140000-0000-0000-0000-0000000000b8', 'tm-foreign-admin@example.com'),
  ('15140000-0000-0000-0000-0000000000b9', 'tm-sole@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1', 'TM Finance 1', 'tm-fin1@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000b2', '15140000-0000-0000-0000-0000000000a1', 'TM Finance 2', 'tm-fin2@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000b3', '15140000-0000-0000-0000-0000000000a1', 'TM Admin', 'tm-admin@example.com', 'Admin', 'active'),
  ('15140000-0000-0000-0000-0000000000b4', '15140000-0000-0000-0000-0000000000a1', 'TM PM 1', 'tm-pm1@example.com', 'Project Manager', 'active'),
  ('15140000-0000-0000-0000-0000000000b5', '15140000-0000-0000-0000-0000000000a1', 'TM PM 2', 'tm-pm2@example.com', 'Project Manager', 'active'),
  ('15140000-0000-0000-0000-0000000000b6', '15140000-0000-0000-0000-0000000000a1', 'TM Engineer 1', 'tm-eng1@example.com', 'Engineer', 'active'),
  ('15140000-0000-0000-0000-0000000000b7', '15140000-0000-0000-0000-0000000000a1', 'TM Engineer 2', 'tm-eng2@example.com', 'Engineer', 'active'),
  ('15140000-0000-0000-0000-0000000000b8', '15140000-0000-0000-0000-0000000000a2', 'TM Foreign Admin', 'tm-foreign-admin@example.com', 'Admin', 'active'),
  ('15140000-0000-0000-0000-0000000000b9', '15140000-0000-0000-0000-0000000000a3', 'TM Sole Finance', 'tm-sole@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency, contract_value, tax_treatment, tax_amount) values
  ('15140000-0000-0000-0000-0000000000c1', '15140000-0000-0000-0000-0000000000a1', 'TM Project 1', 'Ongoing Project', '15140000-0000-0000-0000-0000000000b4', 'IDR', 5000000, 'exclusive', 0),
  ('15140000-0000-0000-0000-0000000000c2', '15140000-0000-0000-0000-0000000000a1', 'TM Project 2', 'Ongoing Project', '15140000-0000-0000-0000-0000000000b5', 'IDR', 1000000, 'exclusive', 0),
  ('15140000-0000-0000-0000-0000000000c3', '15140000-0000-0000-0000-0000000000a3', 'TM Project 3', 'Ongoing Project', null, 'IDR', 1000000, 'exclusive', 0),
  ('15140000-0000-0000-0000-0000000000cb', '15140000-0000-0000-0000-0000000000a2', 'TM Foreign Project', 'Ongoing Project', null, 'IDR', 1000000, 'exclusive', 0);
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at, submitted_at) values
  ('15140000-0000-0000-0000-0000000000d1', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-05', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d2', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-12', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d3', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-19', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d4', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-05', 'Submitted', null, null, now()),
  ('15140000-0000-0000-0000-0000000000d5', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-12', 'Rejected', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-11-02', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000db', '15140000-0000-0000-0000-0000000000a3', '15140000-0000-0000-0000-0000000000b9', '2026-10-05', 'Approved', '15140000-0000-0000-0000-0000000000b9', now(), now());
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
select '15140000-0000-0000-0000-0000000000a1',
       case when n < 5 then '15140000-0000-0000-0000-0000000000d1'::uuid
            when n < 10 then '15140000-0000-0000-0000-0000000000d2'::uuid
            else '15140000-0000-0000-0000-0000000000d3'::uuid end,
       '15140000-0000-0000-0000-0000000000c1',
       date '2026-10-05' + ((n / 5) * 7 + (n % 5))::int, 8
  from generate_series(0, 14) as g(n);
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d4', '15140000-0000-0000-0000-0000000000c1', '2026-10-05', 8),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d5', '15140000-0000-0000-0000-0000000000c1', '2026-10-12', 8);
-- Week of 2 Nov: four days, assembled in different claims below.
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-000000000e10', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-03', 8),
  ('15140000-0000-0000-0000-000000000e11', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-04', 8),
  ('15140000-0000-0000-0000-000000000e12', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-05', 8),
  ('15140000-0000-0000-0000-000000000e13', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-06', 8);
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-0000000000a3', '15140000-0000-0000-0000-0000000000db', '15140000-0000-0000-0000-0000000000c3', '2026-10-05', 10);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('15140000-0000-0000-0000-0000000000f1', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM signed document', 'Approved', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c1/15140000-0000-0000-0000-0000000000f1/tm-signed.pdf'),
  ('15140000-0000-0000-0000-0000000000f2', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM document without file', 'Approved', '15140000-0000-0000-0000-0000000000b1', null),
  ('15140000-0000-0000-0000-0000000000f6', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM draft document', 'Draft', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c1/15140000-0000-0000-0000-0000000000f6/tm-draft.pdf'),
  ('15140000-0000-0000-0000-0000000000f7', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c2', 'Contract', 'Other project document', 'Approved', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c2/15140000-0000-0000-0000-0000000000f7/other.pdf'),
  ('15140000-0000-0000-0000-0000000000f8', '15140000-0000-0000-0000-0000000000a3', '15140000-0000-0000-0000-0000000000c3', 'Contract', 'Sole org signed document', 'Approved', '15140000-0000-0000-0000-0000000000b9', '15140000-0000-0000-0000-0000000000a3/15140000-0000-0000-0000-0000000000c3/15140000-0000-0000-0000-0000000000f8/tm-signed.pdf');
-- Work orders on project 1: f3 is worth less than the 120 h claim, f4 more.
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency) values
  ('15140000-0000-0000-0000-0000000000f3', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'TM WO small', 'Issued', 'WO-TM-3', 5000000, 'exclusive', 0, 'IDR'),
  ('15140000-0000-0000-0000-0000000000f4', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'TM WO large', 'Issued', 'WO-TM-4', 10000000, 'exclusive', 0, 'IDR');

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
-- Scalar probe that survives a missing relation/function, so the red run fails assertion by assertion.
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return r;
exception when undefined_table or undefined_function or undefined_column then return 'missing';
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then return sqlerrm;
end $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select v from _state where k = p_k $$;
create function pg_temp.live(p_claim text) returns text language sql as $$
  select pg_temp.sc(format('select count(*) from public.tm_claim_sources where claim_id = %L and is_live', p_claim))
$$;
create function pg_temp.status(p_claim text) returns text language sql as $$
  select pg_temp.sc(format('select status from public.tm_claims where id = %L', p_claim))
$$;

-- ── rate card (Finance sets it) ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e1","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$, 'Fixture F1 Site engineer line (50,000.00/h)');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b6','2026-01-01','2026-12-31')$q$, 'Fixture F1 assigns Engineer 1');

-- ── AC-TM-010: the work-order fence at confirm (claim W: 120 h = 6,000,000.00 against a 5,000,000.00 work order) ──
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claimW', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-23','15140000-0000-0000-0000-0000000000f3',null)::text$q$,
  'AC-TM-010 the PM assembles the 120 h claim on the small work order');
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimW')::uuid, '15140000-0000-0000-0000-0000000000f1', 'signed by the client 23 Oct')$q$,
  'AC-TM-010 the PM prepares the sign-off');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimW')::uuid)$q$, 'BW001', null,
  'AC-TM-010 the work-order fence refuses the confirm when the claim exceeds the remaining value');
select is(pg_temp.status(pg_temp.st('claimW')), 'Draft', 'AC-TM-010 nothing was written: the claim is still Draft');
reset role;
select is((select count(*)::int from progress_claims where id = pg_temp.st('claimW')::uuid), 0, 'AC-TM-010 and no progress claim exists for it');
-- Withdraw a Draft claim: only its preparer, Admin or Finance; sources are released.
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($q$select withdraw_tm_signoff(pg_temp.st('claimW')::uuid)$q$, '42501', null,
  'FR-TM-024 another PM cannot withdraw the Draft claim');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$select withdraw_tm_signoff(pg_temp.st('claimW')::uuid)$q$, 'FR-TM-024 its preparer withdraws the Draft claim');
select is(pg_temp.status(pg_temp.st('claimW')) || '/' || pg_temp.live(pg_temp.st('claimW')), 'Withdrawn/0',
  'FR-TM-024 the withdrawn claim releases every source');
select throws_ok($q$select withdraw_tm_signoff(pg_temp.st('claimW')::uuid)$q$, 'P0001', null, 'FR-TM-024 a claim is withdrawn once');
reset role;
select throws_ok(format($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('15140000-0000-0000-0000-0000000000a1', 'revenue', %L, 'tm-key-w', 'erpnext', 'create', 'pending')$q$, pg_temp.st('claimW')),
  '55000', null, 'AC-TM-019 a withdrawn T&M claim cannot be raised as an invoice');

-- ── AC-TM-001/006: the 120 h acceptance (claim A on the large work order) ───────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claimA', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-23','15140000-0000-0000-0000-0000000000f4',null)::text$q$,
  'AC-TM-001 Finance 1 assembles the 120 h claim');
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, 'P0001', null,
  'FR-TM-020 a claim whose sign-off was never prepared cannot be confirmed');
select throws_ok($q$select prepare_tm_signoff(pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000f7', 'x')$q$, '23514', null,
  'FR-TM-020 the sign-off document must belong to the claim''s project');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($q$select prepare_tm_signoff(pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000f1', 'x')$q$, '42501', null,
  'FR-TM-020 an Engineer cannot prepare a sign-off');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b8","role":"authenticated"}';
select throws_ok($q$select prepare_tm_signoff(pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000f1', 'x')$q$, 'P0002', null,
  'AC-TM-011 another organisation''s admin cannot see the claim to prepare it');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed the hours 23 Oct')$q$,
  'FR-TM-020 Finance 1 prepares the sign-off with the signed document');
select is(pg_temp.sc(format('select (signoff_prepared_by = %L)::text || '' '' || note from tm_claims where id = %L', '15140000-0000-0000-0000-0000000000b1', pg_temp.st('claimA'))),
  'true client signed the hours 23 Oct', 'FR-TM-020 the sign-off records who prepared it and the note');
-- AC-TM-006 confirm refusals
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, '42501', 'separation of duties: the preparer cannot confirm this sign-off',
  'AC-TM-006 the preparer cannot confirm their own sign-off while others are active');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, '42501', 'only Admin or Finance may confirm a sign-off',
  'AC-TM-006 a PM cannot confirm');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, '42501', 'only Admin or Finance may confirm a sign-off',
  'AC-TM-006 an Engineer cannot confirm');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b8","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, 'P0002', null,
  'AC-TM-011 another organisation cannot confirm this organisation''s claim');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, 'AC-TM-001 a second Finance user confirms the sign-off');
select is(pg_temp.sc(format('select status || '' '' || confirm_basis || '' '' || (confirmed_by = %L)::text || '' '' || gross_amount from tm_claims where id = %L',
  '15140000-0000-0000-0000-0000000000b2', pg_temp.st('claimA'))), 'SignedOff standard true 6000000.00',
  'AC-TM-001 the claim is SignedOff on the standard basis by the confirmer');
select is(pg_temp.sc(format('select units::text || '' x '' || rate::text || '' = '' || amount::text from tm_claim_lines where claim_id = %L', pg_temp.st('claimA'))),
  '120.00 x 50000.00 = 6000000.00', 'AC-TM-001 the claim line is 120 h x 50,000.00 = 6,000,000.00');
reset role;
select is((select kind || ' ' || gross_amount::text || ' ' || dp_recovery_amount::text || ' ' || currency || ' ' || (created_by = '15140000-0000-0000-0000-0000000000b1')::text
             || ' ' || (work_order_id = '15140000-0000-0000-0000-0000000000f4')::text
             from progress_claims where id = pg_temp.st('claimA')::uuid),
  'time_materials 6000000.00 0.00 IDR true true', 'FR-TM-030 confirm creates the progress claim record: kind, gross, no recovery, work order');
select is((select count(*)::int from progress_claim_evidence where claim_id = pg_temp.st('claimA')::uuid and document_id = '15140000-0000-0000-0000-0000000000f1'
              and attached_by = '15140000-0000-0000-0000-0000000000b2'), 1, 'FR-TM-030 the signed document is attached as billing evidence');
select is((select count(*)::int from audit_events where action = 'tm_signoff.prepare' and entity_id = pg_temp.st('claimA')::uuid), 1, 'FR-TM-025 the prepare is audited');
select is((select detail ->> 'basis' from audit_events where action = 'tm_signoff.confirm' and entity_id = pg_temp.st('claimA')::uuid), 'standard',
  'FR-TM-025 the confirm is audited with its basis');
select is(pg_temp.live(pg_temp.st('claimA')), '15', 'FR-TM-021 the confirm keeps all 15 sources live');
select is((select billed::text from work_order_billing_lines where record_id = pg_temp.st('claimA')::uuid), '6000000.00',
  'FR-TM-033 the confirmed claim reserves its gross against the work order');
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, 'P0001', null, 'FR-TM-024 a confirmed sign-off is not confirmed twice');
select throws_ok($q$select prepare_tm_signoff(pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000f1', 'again')$q$, 'P0001', null,
  'FR-TM-024 a confirmed sign-off cannot be prepared again');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select withdraw_tm_signoff(pg_temp.st('claimA')::uuid)$q$, '42501', null, 'FR-TM-024 a PM cannot withdraw a confirmed sign-off');
-- the signed quantities cannot be rewritten, even by the owner role
reset role;
select throws_ok(format($q$update tm_claim_lines set units = 1, amount = rate where claim_id = %L$q$, pg_temp.st('claimA')), '42501', null,
  'FR-TM-024 the lines of a confirmed sign-off are immutable');
select throws_ok(format($q$update tm_claims set gross_amount = 1 where id = %L$q$, pg_temp.st('claimA')), '42501', null,
  'FR-TM-024 the header of a confirmed sign-off is immutable');
select throws_ok(format($q$delete from tm_claim_sources where claim_id = %L$q$, pg_temp.st('claimA')), '42501', null,
  'FR-TM-024 the sources of a confirmed sign-off cannot be removed');
select throws_ok(format($q$update tm_claim_sources set is_live = false where claim_id = %L$q$, pg_temp.st('claimA')), '42501', null,
  'FR-TM-024 the sources of a confirmed sign-off cannot be released except by withdrawing the claim');
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($q$insert into tm_claims (project_id, period_from, period_to, currency, prepared_by) values ('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-06','IDR','15140000-0000-0000-0000-0000000000b1')$q$,
  '42501', null, 'FR-TM-041 a client has no direct insert on claims');

-- ── AC-TM-002 / AC-TM-019: the fence at the single choke point ──────────────────────────────────
-- Claim B: Finance 1 assembles 3 and 4 Nov (two sources), the PM prepares nothing yet.
select lives_ok($q$insert into _state select 'claimB', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-11-03','2026-11-04',null,null)::text$q$,
  'AC-TM-002 Finance 1 assembles claim B (3 and 4 Nov)');
reset role;
select throws_ok(format($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('15140000-0000-0000-0000-0000000000a1', 'revenue', %L, 'tm-key-b', 'erpnext', 'create', 'pending')$q$, pg_temp.st('claimB')),
  '55000', null, 'AC-TM-002 an invoice cannot be raised for a Draft T&M claim');
select lives_ok(format($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('15140000-0000-0000-0000-0000000000a1', 'revenue', %L, 'tm-key-a', 'erpnext', 'create', 'pending')$q$, pg_temp.st('claimA')),
  'AC-TM-002 CONTROL a confirmed T&M claim with its evidence can be raised');
select throws_ok(format($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('15140000-0000-0000-0000-0000000000a2', 'revenue', %L, 'tm-key-x', 'erpnext', 'create', 'pending')$q$, pg_temp.st('claimB')),
  '42501', null, 'AC-TM-002 the fence fails closed on a T&M claim id raised under another organisation');
select lives_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('15140000-0000-0000-0000-0000000000a1', 'revenue', '15140000-0000-0000-0000-00000000aa01', 'tm-key-o', 'erpnext', 'create', 'pending')$q$,
  'AC-TM-002 CONTROL an ordinary invoice is untouched by the fence');

-- ── AC-TM-006: documents, assembler and preparer ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimB')::uuid, '15140000-0000-0000-0000-0000000000f2', 'document without a file')$q$,
  'FR-TM-020 a same-project document can be named at prepare');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, '23514', 'confirmation requires an Issued or Approved project document with a file',
  'AC-TM-006 confirm refuses a document with no file');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimB')::uuid, '15140000-0000-0000-0000-0000000000f6', 'draft document')$q$, 'FR-TM-020 the preparer re-prepares with another document');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, '23514', 'confirmation requires an Issued or Approved project document with a file',
  'AC-TM-006 confirm refuses a Draft document');
-- Deselect after prepare changes what the client was shown: the confirm demands a new prepare.
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimB')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed 4 Nov')$q$, 'FR-TM-020 prepared with the signed document');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select deselect_tm_source(pg_temp.st('claimB')::uuid, (select s.id from tm_claim_sources s where s.claim_id = pg_temp.st('claimB')::uuid and s.source_id = '15140000-0000-0000-0000-000000000e11'))$q$,
  'FR-TM-023 the assembler deselects the 4 Nov hours after the prepare');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is(pg_temp.sc(format($q$select to_jsonb(source)->>'signoff_is_current'
  from list_tm_claim_source_details(%L) source limit 1$q$, pg_temp.st('claimB'))), 'false',
  'AC-TM-006 a confirmer can see that the prepared sign-off is stale');
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, 'P0001', 'the claim changed after its sign-off was prepared: prepare it again',
  'FR-TM-023 the signed quantities are the assembled quantities: a changed claim must be prepared again');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimB')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed 3 Nov')$q$, 'FR-TM-023 prepared again for the remaining hours');
-- Assembler and sign-off preparer are both barred from confirming.
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, '42501', 'separation of duties: the preparer cannot confirm this sign-off',
  'AC-TM-006 whoever assembled the claim cannot confirm it');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, '42501', 'separation of duties: the preparer cannot confirm this sign-off',
  'AC-TM-006 whoever prepared the sign-off cannot confirm it');
-- The approve-then-reopen race: the week is no longer Approved when the confirm reads it.
reset role;
update timesheets set status = 'Draft' where id = '15140000-0000-0000-0000-0000000000da';
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, 'P0001', 'an hour in this claim is no longer approved: withdraw the claim and assemble it again',
  'FR-TM-021 confirm re-checks that every source is still Approved');
select is(pg_temp.status(pg_temp.st('claimB')), 'Draft', 'FR-TM-021 the refused confirm left the claim Draft');
reset role;
update timesheets set status = 'Approved' where id = '15140000-0000-0000-0000-0000000000da';
-- Hours that changed after assembly are refused as well.
update timesheet_entries set hours = 7 where id = '15140000-0000-0000-0000-000000000e10';
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, 'P0001', null, 'FR-TM-021 confirm refuses an hour whose quantity changed since assembly');
reset role;
update timesheet_entries set hours = 8 where id = '15140000-0000-0000-0000-000000000e10';

-- ── AC-TM-004: the rate changes after claim A was confirmed ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":60000,"currency":"IDR","effective_from":"2026-11-01","effective_to":"2026-12-31"}')$q$,
  'AC-TM-004 Finance changes the rate to 60,000.00 from 1 Nov');
select is(pg_temp.sc(format('select rate::text || '' v'' || rate_version::text from tm_claim_lines where claim_id = %L', pg_temp.st('claimA'))), '50000.00 v1',
  'AC-TM-004 the signed-off claim still reads 50,000.00');
-- Claim B was assembled before the change and keeps its frozen rate; the 5 and 6 Nov hours are priced at the new rate.
select is(pg_temp.sc(format('select rate::text || '' v'' || rate_version::text from tm_claim_lines where claim_id = %L', pg_temp.st('claimB'))), '50000.00 v1',
  'AC-TM-004 a Draft claim assembled before the change keeps its frozen rate too');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claimD', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-11-05','2026-11-06',null,null)::text$q$,
  'AC-TM-004 a later claim for 5 and 6 Nov');
select is(pg_temp.sc(format('select units::text || '' x '' || rate::text || '' = '' || amount::text || '' v'' || rate_version::text from tm_claim_lines where claim_id = %L', pg_temp.st('claimD'))),
  '16.00 x 60000.00 = 960000.00 v2', 'AC-TM-004 the later claim uses 60,000.00');
-- Claim B (3 Nov only): confirmed by the Admin, a third person.
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('claimB')::uuid)$q$, 'AC-TM-006 the Admin, who neither assembled nor prepared, confirms claim B');
select is(pg_temp.sc(format('select gross_amount::text from tm_claims where id = %L', pg_temp.st('claimB'))), '400000.00',
  'AC-TM-004 claim B bills 8 h x 50,000.00 = 400,000.00 at its frozen rate');

-- ── FR-TM-037: a claim whose currency no longer matches the project's ───────────────────────────
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimD')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed 6 Nov')$q$, 'FR-TM-037 claim D prepared');
reset role;
update tm_claims set currency = 'USD' where id = pg_temp.st('claimD')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($q$select confirm_tm_signoff(pg_temp.st('claimD')::uuid)$q$, '23514', null, 'FR-TM-037 confirm refuses a claim in another currency than its project');
reset role;
update tm_claims set currency = 'IDR' where id = pg_temp.st('claimD')::uuid;
-- Admin withdraws the Draft; the hours are offered again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select withdraw_tm_signoff(pg_temp.st('claimD')::uuid)$q$, 'FR-TM-024 the Admin withdraws a Draft claim');
reset role;
select is((select count(*)::int from tm_assignable_sources('15140000-0000-0000-0000-0000000000c1','2026-11-05','2026-11-06') where unrated_reason is null), 2,
  'AC-TM-003 the withdrawn claim''s hours are offered again');

-- ── AC-TM-007: invoice approval separation (claim A's invoice) ──────────────────────────────────
reset role;
set local request.jwt.claims = '{}';
insert into sales_invoices (id, org_id, project_id, si_number, invoice_date, amount, erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus) values
  (pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'SI-TM-A', '2026-10-30', 6000000, 6000000, 'exclusive', 0, 'IDR', 'Unpaid', 1),
  (pg_temp.st('claimB')::uuid, '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'SI-TM-B', '2026-11-04', 400000, 400000, 'exclusive', 0, 'IDR', 'Draft', null);
select is((select string_agg(user_id::text, ',' order by user_id::text) from sales_invoice_authors where sales_invoice_id = pg_temp.st('claimA')::uuid),
  '15140000-0000-0000-0000-0000000000b1,15140000-0000-0000-0000-0000000000b2',
  'FR-TM-035 the invoice authors are the claim''s preparer and its confirmer');
select is((select string_agg(user_id::text, ',' order by user_id::text) from sales_invoice_authors where sales_invoice_id = pg_temp.st('claimB')::uuid),
  '15140000-0000-0000-0000-0000000000b1,15140000-0000-0000-0000-0000000000b2,15140000-0000-0000-0000-0000000000b3',
  'FR-TM-035 the authors also include whoever assembled and whoever prepared the sign-off');
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($q$select submit_sales_invoice(pg_temp.st('claimA')::uuid)$q$, '42501', 'approver must differ from author (SoD)',
  'AC-TM-007 the claim''s preparer cannot approve its invoice');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($q$select submit_sales_invoice(pg_temp.st('claimA')::uuid)$q$, '42501', 'approver must differ from author (SoD)',
  'AC-TM-007 the claim''s confirmer cannot approve its invoice');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select submit_sales_invoice(pg_temp.st('claimA')::uuid)$q$, 'AC-TM-007 a third user approves the invoice');

-- ── AC-TM-009: the invoice is contract billing and draws down the contract ─────────────────────
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select billing_kind from sales_invoices where id = pg_temp.st('claimA')::uuid), 'contract', 'AC-TM-009 the T&M invoice is contract billing');
select is((get_project_finances('15140000-0000-0000-0000-0000000000c1') ->> 'contract_invoiced')::numeric, 6000000::numeric,
  'AC-TM-009 contract billing on the project rises by the T&M invoice net (the Draft invoice does not count)');
select is((get_project_finances('15140000-0000-0000-0000-0000000000c1') -> 'contract_excess' ->> 'amount')::numeric, 1000000::numeric,
  'AC-TM-009 a total above the 5,000,000.00 contract value shows the excess in the existing payload');
select is(get_project_finances('15140000-0000-0000-0000-0000000000c1') -> 'contract_excess' -> 'contributors' -> 0 ->> 'invoice_id', pg_temp.st('claimA'),
  'AC-TM-009 and lists the T&M invoice as the contributor');

-- ── Withdraw a confirmed sign-off ─────────────────────────────────────────────────────────────
-- Claim E (5 and 6 Nov) is confirmed, then withdrawn through the existing claim withdraw: the sources are released.
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claimE', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-11-05','2026-11-06',null,null)::text$q$, 'FR-TM-036 claim E assembled');
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimE')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed 6 Nov')$q$, 'FR-TM-036 claim E prepared');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('claimE')::uuid)$q$, 'FR-TM-036 claim E confirmed (no work order, no invoice yet)');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('claimE')::uuid)$q$, 'FR-TM-036 Finance withdraws the unraised claim through the existing withdraw');
select is(pg_temp.status(pg_temp.st('claimE')) || '/' || pg_temp.live(pg_temp.st('claimE')), 'Withdrawn/0',
  'FR-TM-036 the T&M claim is Withdrawn and its hours are released');
-- Claim F: the same hours again; its invoice exists, so withdrawing is refused until the invoice is cancelled.
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claimF', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-11-05','2026-11-06',null,null)::text$q$, 'FR-TM-036 claim F assembled from the released hours');
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimF')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed 6 Nov')$q$, 'FR-TM-036 claim F prepared');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('claimF')::uuid)$q$, 'FR-TM-036 claim F confirmed');
reset role;
set local request.jwt.claims = '{}';
insert into sales_invoices (id, org_id, project_id, si_number, invoice_date, amount, erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus) values
  (pg_temp.st('claimF')::uuid, '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'SI-TM-F', '2026-11-06', 960000, 960000, 'exclusive', 0, 'IDR', 'Unpaid', 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($q$select withdraw_tm_signoff(pg_temp.st('claimF')::uuid)$q$, 'P0001', 'this claim already has an invoice — cancel the invoice instead',
  'FR-TM-036 a claim whose invoice is live cannot be withdrawn');
reset role;
update sales_invoices set status = 'Cancelled' where id = pg_temp.st('claimF')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select withdraw_tm_signoff(pg_temp.st('claimF')::uuid)$q$, 'FR-TM-036 once the invoice is cancelled the claim can be withdrawn');
select is(pg_temp.status(pg_temp.st('claimF')) || '/' || pg_temp.live(pg_temp.st('claimF')), 'Withdrawn/0', 'FR-TM-036 and its hours are released for billing again');
reset role;
select is((select (withdrawn_at is not null)::text from progress_claims where id = pg_temp.st('claimF')::uuid), 'true',
  'FR-TM-036 the progress claim record carries the withdrawal');
select is((select count(*)::int from audit_events where action = 'tm_signoff.withdraw' and entity_id = pg_temp.st('claimF')::uuid), 1,
  'FR-TM-025 the withdrawal of a confirmed sign-off is audited');
-- An ERP-side Amend converges the mirror row back to live; the released hours must not be billed twice.
select throws_ok($q$update sales_invoices set status = 'Unpaid' where id = pg_temp.st('claimF')::uuid$q$, '55000', null,
  'FR-TM-036 a withdrawn claim''s cancelled invoice cannot come back live (an amend would bill the released hours twice)');
select throws_ok($q$update sales_invoices set status = 'Paid', erp_docstatus = 1 where id = pg_temp.st('claimF')::uuid$q$, '55000', null,
  'FR-TM-036 nor any other live status');
select is((select status from sales_invoices where id = pg_temp.st('claimF')::uuid), 'Cancelled', 'FR-TM-036 the invoice stays Cancelled');

-- ── AC-TM-006: the sole active member confirms with basis sole_operator ─────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e2","project_id":"15140000-0000-0000-0000-0000000000c3","kind":"labour","label":"Operator","unit":"hour","rate":10000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$, 'AC-TM-006 the sole member sets a rate');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c3','15140000-0000-0000-0000-0000000000e2','15140000-0000-0000-0000-0000000000b9','2026-01-01','2026-12-31')$q$, 'AC-TM-006 and assigns themselves');
select lives_ok($q$insert into _state select 'claimS', assemble_tm_claim('15140000-0000-0000-0000-0000000000c3','2026-10-05','2026-10-09',null,null)::text$q$, 'AC-TM-006 the sole member assembles');
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimS')::uuid, '15140000-0000-0000-0000-0000000000f8', 'client signed')$q$, 'AC-TM-006 prepares');
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('claimS')::uuid)$q$, 'AC-TM-006 and confirms: the only active member may');
select is(pg_temp.sc(format('select confirm_basis from tm_claims where id = %L', pg_temp.st('claimS'))), 'sole_operator', 'AC-TM-006 the basis is sole_operator');
reset role;
select is((select detail ->> 'basis' from audit_events where action = 'tm_signoff.confirm' and entity_id = pg_temp.st('claimS')::uuid), 'sole_operator',
  'AC-TM-006 the audit records the sole_operator basis');

-- ── progress claim shape, immutability and grants ───────────────────────────────────────────────
select throws_ok($q$insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, down_payment_amount, dp_recovery_amount, created_by)
  values (gen_random_uuid(), '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'time_materials', 'IDR', 10, 10, 0, '15140000-0000-0000-0000-0000000000b1')$q$,
  '23514', null, 'FR-TM-037 a time-and-materials claim carries no down-payment fields');
select throws_ok($q$insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, dp_item_code, created_by)
  values (gen_random_uuid(), '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'time_materials', 'IDR', 10, 5, 'DP', '15140000-0000-0000-0000-0000000000b1')$q$,
  '23514', null, 'FR-TM-037 and recovers no down payment');
select is((select count(*)::int from information_schema.table_privileges where table_schema = 'public'
            and table_name in ('tm_claims', 'tm_claim_lines', 'tm_claim_sources') and grantee in ('authenticated', 'anon')
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0, 'FR-TM-041 no client role may write the claim tables directly');
select ok(has_function_privilege('authenticated', 'public.prepare_tm_signoff(uuid, uuid, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.withdraw_tm_signoff(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.confirm_tm_signoff(uuid)', 'EXECUTE'),
  'FR-TM-041 the three sign-off writers are callable by signed-in users');
select ok(not has_function_privilege('anon', 'public.prepare_tm_signoff(uuid, uuid, text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.withdraw_tm_signoff(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.confirm_tm_signoff(uuid)', 'EXECUTE'),
  'FR-TM-041 and not by anon');
select ok(not has_function_privilege('authenticated', 'public.tm_claim_fingerprint(uuid)', 'EXECUTE'),
  'FR-TM-041 the fingerprint helper is not client-callable');

select * from finish();
rollback;
