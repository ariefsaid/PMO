-- tm_native_invoice.test.sql — #1817: a no-ERP org invoices a signed-off time-and-materials claim in PMO.
-- AC-TM-020..026 (plan docs/plans/2026-11-06-no-erp-tm-claim-invoice.md). Ids: 17170000-… (synthetic).
-- Users: b1 fin1 (prepares), b2 fin2 (confirms), b3 admin (approves), b4 pm (assembles), b5 fin3 (creates the invoice),
-- b6 engineer, b7 executive, b8 foreign admin, b9 disabled admin. Org a1 has no ERP (native revenue); a2 is foreign.
-- Real flow (rate card → assemble → prepare → confirm) builds claims R1/R2/R3; the variants (VAT, work order, equipment,
-- unsigned, ...) are built with direct owner inserts so each refusal has the smallest fixture that can show it.
begin;
create extension if not exists pgtap;
select plan(60);

insert into organizations (id, name, default_currency, default_timezone) values
  ('17170000-0000-0000-0000-0000000000a1', 'TMN Org A', 'IDR', 'UTC'),
  ('17170000-0000-0000-0000-0000000000a2', 'TMN Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('17170000-0000-0000-0000-0000000000b1', 'tmn-fin1@example.com'),
  ('17170000-0000-0000-0000-0000000000b2', 'tmn-fin2@example.com'),
  ('17170000-0000-0000-0000-0000000000b3', 'tmn-admin@example.com'),
  ('17170000-0000-0000-0000-0000000000b4', 'tmn-pm@example.com'),
  ('17170000-0000-0000-0000-0000000000b5', 'tmn-fin3@example.com'),
  ('17170000-0000-0000-0000-0000000000b6', 'tmn-eng@example.com'),
  ('17170000-0000-0000-0000-0000000000b7', 'tmn-exec@example.com'),
  ('17170000-0000-0000-0000-0000000000b8', 'tmn-foreign@example.com'),
  ('17170000-0000-0000-0000-0000000000b9', 'tmn-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17170000-0000-0000-0000-0000000000b1', '17170000-0000-0000-0000-0000000000a1', 'TMN Finance 1', 'tmn-fin1@example.com', 'Finance', 'active'),
  ('17170000-0000-0000-0000-0000000000b2', '17170000-0000-0000-0000-0000000000a1', 'TMN Finance 2', 'tmn-fin2@example.com', 'Finance', 'active'),
  ('17170000-0000-0000-0000-0000000000b3', '17170000-0000-0000-0000-0000000000a1', 'TMN Admin', 'tmn-admin@example.com', 'Admin', 'active'),
  ('17170000-0000-0000-0000-0000000000b4', '17170000-0000-0000-0000-0000000000a1', 'TMN PM', 'tmn-pm@example.com', 'Project Manager', 'active'),
  ('17170000-0000-0000-0000-0000000000b5', '17170000-0000-0000-0000-0000000000a1', 'TMN Finance 3', 'tmn-fin3@example.com', 'Finance', 'active'),
  ('17170000-0000-0000-0000-0000000000b6', '17170000-0000-0000-0000-0000000000a1', 'TMN Engineer', 'tmn-eng@example.com', 'Engineer', 'active'),
  ('17170000-0000-0000-0000-0000000000b7', '17170000-0000-0000-0000-0000000000a1', 'TMN Executive', 'tmn-exec@example.com', 'Executive', 'active'),
  ('17170000-0000-0000-0000-0000000000b8', '17170000-0000-0000-0000-0000000000a2', 'TMN Foreign Admin', 'tmn-foreign@example.com', 'Admin', 'active'),
  ('17170000-0000-0000-0000-0000000000b9', '17170000-0000-0000-0000-0000000000a1', 'TMN Disabled Admin', 'tmn-off@example.com', 'Admin', 'disabled');
insert into companies (id, org_id, name, type) values
  ('17170000-0000-0000-0000-0000000000cc', '17170000-0000-0000-0000-0000000000a1', 'TMN Client', 'Client');
insert into projects (id, org_id, name, status, project_manager_id, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('17170000-0000-0000-0000-0000000000c1', '17170000-0000-0000-0000-0000000000a1', 'TMN no-VAT', 'Ongoing Project', '17170000-0000-0000-0000-0000000000b4', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '17170000-0000-0000-0000-0000000000cc'),
  ('17170000-0000-0000-0000-0000000000c2', '17170000-0000-0000-0000-0000000000a1', 'TMN VAT', 'Ongoing Project', null, 'IDR', 90000000, 'exclusive', 0, 12, 11, 12, true, '17170000-0000-0000-0000-0000000000cc'),
  ('17170000-0000-0000-0000-0000000000c3', '17170000-0000-0000-0000-0000000000a1', 'TMN VAT no rate', 'Ongoing Project', null, 'IDR', 90000000, 'exclusive', 0, null, 1, 1, true, '17170000-0000-0000-0000-0000000000cc'),
  ('17170000-0000-0000-0000-0000000000c4', '17170000-0000-0000-0000-0000000000a1', 'TMN no client', 'Ongoing Project', null, 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, null);
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at, submitted_at) values
  ('17170000-0000-0000-0000-0000000000d1', '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000b6', '2026-10-05', 'Approved', '17170000-0000-0000-0000-0000000000b1', now(), now()),
  ('17170000-0000-0000-0000-0000000000d2', '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000b6', '2026-10-12', 'Approved', '17170000-0000-0000-0000-0000000000b1', now(), now()),
  ('17170000-0000-0000-0000-0000000000d3', '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000b6', '2026-10-19', 'Approved', '17170000-0000-0000-0000-0000000000b1', now(), now()),
  ('17170000-0000-0000-0000-0000000000da', '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000b6', '2026-11-02', 'Approved', '17170000-0000-0000-0000-0000000000b1', now(), now());
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
select '17170000-0000-0000-0000-0000000000a1',
       case when n < 5 then '17170000-0000-0000-0000-0000000000d1'::uuid
            when n < 10 then '17170000-0000-0000-0000-0000000000d2'::uuid
            else '17170000-0000-0000-0000-0000000000d3'::uuid end,
       '17170000-0000-0000-0000-0000000000c1',
       date '2026-10-05' + ((n / 5) * 7 + (n % 5))::int, 8
  from generate_series(0, 14) as g(n);
-- Four days in the week of 2 Nov: the re-assembly case (R2 is withdrawn, R3 bills the same hours again).
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
select '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000da', '17170000-0000-0000-0000-0000000000c1',
       date '2026-11-03' + n, 8 from generate_series(0, 3) as g(n);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('17170000-0000-0000-0000-0000000000f1', '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000c1', 'Contract', 'TMN signed document', 'Approved', '17170000-0000-0000-0000-0000000000b1',
   '17170000-0000-0000-0000-0000000000a1/17170000-0000-0000-0000-0000000000c1/17170000-0000-0000-0000-0000000000f1/tmn-signed.pdf');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency) values
  ('17170000-0000-0000-0000-0000000000f4', '17170000-0000-0000-0000-0000000000a1', '17170000-0000-0000-0000-0000000000c1', 'TMN WO', 'Issued', 'WO-TMN-4', 10000000, 'exclusive', 0, 'IDR');

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ' ' || sqlerrm || ' | ' || coalesce(
  (select '' ), ''); end $$;
create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select v from _state where k = p_k $$;

-- A claim built by direct owner inserts. p_lines = [{kind,basis,label,unit,units,rate}]; p_state: signed | draft | withdrawn |
-- no_evidence | no_progress | bad_total. Returns the claim id.
create function pg_temp.mk(p_id uuid, p_project uuid, p_wo uuid, p_state text, p_lines jsonb) returns uuid language plpgsql as $$
declare
  v_org uuid := '17170000-0000-0000-0000-0000000000a1';
  v_fin1 uuid := '17170000-0000-0000-0000-0000000000b1';
  v_fin2 uuid := '17170000-0000-0000-0000-0000000000b2';
  v_pm uuid := '17170000-0000-0000-0000-0000000000b4';
  v_gross numeric := (select sum(round((l ->> 'units')::numeric * (l ->> 'rate')::numeric, 2)) from jsonb_array_elements(p_lines) l);
  v_status text := case p_state when 'draft' then 'Draft' when 'withdrawn' then 'Withdrawn' else 'SignedOff' end;
begin
  insert into tm_claims (id, org_id, project_id, work_order_id, period_from, period_to, status, currency, gross_amount, prepared_by,
                         confirmed_by, confirm_basis, document_id, signoff_prepared_by, prepared_fingerprint)
  values (p_id, v_org, p_project, p_wo, '2026-10-01', '2026-10-31', v_status, 'IDR',
          case when p_state = 'bad_total' then v_gross + 1 else v_gross end, v_pm,
          case when v_status = 'SignedOff' then v_fin2 end, case when v_status = 'SignedOff' then 'standard' end,
          case when v_status = 'SignedOff' then '17170000-0000-0000-0000-0000000000f1'::uuid end,
          case when v_status = 'SignedOff' then v_fin1 end, case when v_status = 'SignedOff' then 'fp' end);
  insert into tm_claim_lines (org_id, claim_id, line_key, rate_version, kind, basis, label, unit, units, rate, amount)
  select v_org, p_id, gen_random_uuid(), 1, l ->> 'kind', l ->> 'basis', l ->> 'label', l ->> 'unit',
         (l ->> 'units')::numeric, (l ->> 'rate')::numeric, round((l ->> 'units')::numeric * (l ->> 'rate')::numeric, 2)
    from jsonb_array_elements(p_lines) l;
  if p_state not in ('draft', 'no_progress') then
    insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, dp_recovery_amount, created_by,
                                 withdrawn_by, withdrawn_at)
    values (p_id, v_org, p_project, p_wo, 'time_materials', 'IDR', v_gross, 0, v_pm,
            case when p_state = 'withdrawn' then v_fin1 end, case when p_state = 'withdrawn' then now() end);
  end if;
  if p_state in ('signed', 'bad_total') then
    insert into progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
    values (v_org, p_id, '17170000-0000-0000-0000-0000000000f1', 'Approved', null, v_fin2);
  end if;
  return p_id;
end $$;

-- ── Fixture: rate card + the real flow for R1 (120 h × 50,000.00 = 6,000,000.00) ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"17170000-0000-0000-0000-0000000000e1","project_id":"17170000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$, 'Fixture: Site engineer line (50,000.00/h)');
select lives_ok($q$select set_contract_rate_assignee('17170000-0000-0000-0000-0000000000c1','17170000-0000-0000-0000-0000000000e1','17170000-0000-0000-0000-0000000000b6','2026-01-01','2026-12-31')$q$, 'Fixture: assigns the Engineer');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'r1', assemble_tm_claim('17170000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-23',null,null)::text$q$, 'Fixture: the PM assembles the 120 h claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('r1')::uuid, '17170000-0000-0000-0000-0000000000f1', 'signed 23 Oct')$q$, 'Fixture: Finance 1 prepares the sign-off');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('r1')::uuid)$q$, 'Fixture: Finance 2 confirms it');
reset role;

-- Variant claims by direct insert (owner).
select pg_temp.mk('17170000-0000-0000-0000-000000000101', '17170000-0000-0000-0000-0000000000c1', null, 'draft',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":8,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000102', '17170000-0000-0000-0000-0000000000c1', null, 'withdrawn',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":8,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000103', '17170000-0000-0000-0000-0000000000c2', null, 'signed',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":10,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000104', '17170000-0000-0000-0000-0000000000c3', null, 'signed',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":10,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000105', '17170000-0000-0000-0000-0000000000c1', '17170000-0000-0000-0000-0000000000f4', 'signed',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":16,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000106', '17170000-0000-0000-0000-0000000000c1', null, 'signed',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":2,"rate":50000},
    {"kind":"equipment","basis":"work","label":"Loader","unit":"hour","units":3,"rate":800000},
    {"kind":"equipment","basis":"standby","label":"Loader","unit":"hour","units":6,"rate":200000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000107', '17170000-0000-0000-0000-0000000000c4', null, 'signed',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":8,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000108', '17170000-0000-0000-0000-0000000000c1', null, 'no_evidence',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":8,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-000000000109', '17170000-0000-0000-0000-0000000000c1', null, 'no_progress',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":8,"rate":50000}]');
select pg_temp.mk('17170000-0000-0000-0000-00000000010a', '17170000-0000-0000-0000-0000000000c1', null, 'bad_total',
  '[{"kind":"labour","basis":"work","label":"Site engineer","unit":"hour","units":8,"rate":50000}]');

-- ── AC-TM-020: Finance creates the Draft invoice from the signed-off claim ──────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(create_native_tm_invoice(pg_temp.st('r1')::uuid), pg_temp.st('r1')::uuid,
  'AC-TM-020 Finance creates the invoice from a signed-off claim and its id is the claim id');
reset role;
select is((select row(pmo_native, status, amount, tax_amount, billing_kind, project_id, customer_id, currency, author_user_id)::text
             from sales_invoices where id = pg_temp.st('r1')::uuid),
  row(true, 'Draft', 6000000.00::numeric, 0.00::numeric, 'contract', '17170000-0000-0000-0000-0000000000c1'::uuid,
      '17170000-0000-0000-0000-0000000000cc'::uuid, 'IDR', '17170000-0000-0000-0000-0000000000b5'::uuid)::text,
  'AC-TM-020 it is a PMO-native Draft of 6,000,000.00, a contract invoice for the project''s client, authored by the caller');
select is((select native_lines::text from sales_invoices where id = pg_temp.st('r1')::uuid),
  '[{"qty": 120.00, "rate": 50000.00, "amount": 6000000.00, "item_code": null, "description": "Site engineer (hour)"}]',
  'AC-TM-020 one line: the signed label and unit, 120 h at 50,000.00');

-- ── AC-TM-021: only a confirmed, live claim of the caller's org ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000101')$q$, '55000',
  'confirm the client''s sign-off before raising this time-and-materials claim''s invoice', 'AC-TM-021 a Draft claim is refused');
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000102')$q$, '55000',
  'this progress claim was withdrawn, so no invoice can be raised for it', 'AC-TM-021 a withdrawn claim is refused');
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000108')$q$, '55000',
  'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice',
  'AC-TM-021 a claim with no billing evidence is refused');
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000109')$q$, '55000', null,
  'AC-TM-021 a signed-off claim with no progress-claim record is refused');
select throws_ok($q$select create_native_tm_invoice(gen_random_uuid())$q$, 'P0002', null, 'AC-TM-021 an unknown claim is refused');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b8","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, 'P0002', null,
  'AC-TM-021 another organisation''s admin cannot invoice this organisation''s claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.detail($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000107')$q$), 'P0002 no-client',
  'AC-TM-021 a project with no client is refused with no-client');
select is(pg_temp.detail($q$select create_native_tm_invoice('17170000-0000-0000-0000-00000000010a')$q$), '23514 claim-total-mismatch',
  'AC-TM-021 a claim whose header differs from its lines is refused');
reset role;
select is((select count(*)::int from sales_invoices where id in (select id from tm_claims where id::text like '17170000-0000-0000-0000-0000000001%'
              and id <> pg_temp.st('r1')::uuid)), 0, 'AC-TM-021 CONTROL none of the refused calls left an invoice');

-- ── AC-TM-022: a claim is billed once ──────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.detail($q$select create_native_tm_invoice(pg_temp.st('r1')::uuid)$q$), 'P0001 claim-already-invoiced',
  'AC-TM-022 a second call for the same claim is refused with claim-already-invoiced');
-- R2: 32 h from the week of 2 Nov, invoiced, cancelled, withdrawn, re-assembled as R3.
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'r2', assemble_tm_claim('17170000-0000-0000-0000-0000000000c1','2026-11-02','2026-11-08',null,null)::text$q$, 'AC-TM-022 the PM assembles the week of 2 Nov');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('r2')::uuid, '17170000-0000-0000-0000-0000000000f1', null)$q$, 'AC-TM-022 Finance 1 prepares it');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('r2')::uuid)$q$, 'AC-TM-022 Finance 2 confirms it');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select lives_ok($q$select create_native_tm_invoice(pg_temp.st('r2')::uuid)$q$, 'AC-TM-022 Finance 3 invoices it');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('r2')::uuid, 'Cancelled')$q$, 'AC-TM-022 the Admin cancels that invoice');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.detail($q$select create_native_tm_invoice(pg_temp.st('r2')::uuid)$q$), 'P0001 claim-already-invoiced',
  'AC-TM-022 a cancelled invoice still blocks the same claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select withdraw_tm_signoff(pg_temp.st('r2')::uuid)$q$, 'AC-TM-022 Finance withdraws the claim behind the cancelled invoice');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice(pg_temp.st('r2')::uuid)$q$, '55000', null,
  'AC-TM-022 the withdrawn claim cannot be invoiced');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'r3', assemble_tm_claim('17170000-0000-0000-0000-0000000000c1','2026-11-02','2026-11-08',null,null)::text$q$, 'AC-TM-022 the released hours are assembled into a new claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('r3')::uuid, '17170000-0000-0000-0000-0000000000f1', null)$q$, 'AC-TM-022 …prepared');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('r3')::uuid)$q$, 'AC-TM-022 …confirmed');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select lives_ok($q$select create_native_tm_invoice(pg_temp.st('r3')::uuid)$q$, 'AC-TM-022 the new claim is invoiced once');
select is(pg_temp.detail($q$select create_native_tm_invoice(pg_temp.st('r3')::uuid)$q$), 'P0001 claim-already-invoiced', 'AC-TM-022 …and only once');
reset role;

-- ── AC-TM-023: access and ownership ────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-TM-023 a Project Manager cannot invoice a claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-TM-023 an Engineer cannot invoice a claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-TM-023 an Executive cannot invoice a claim');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, '42501', null, 'AC-TM-023 a disabled Admin is refused');
reset role;
select ok(not has_function_privilege('anon', 'public.create_native_tm_invoice(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.create_native_tm_invoice(uuid)', 'execute'),
  'AC-TM-023 anon cannot execute it, authenticated can');
-- an ERP that owns revenue keeps the ERP path
-- (the open-drafts take-over guard is a trigger; this test only needs the ownership row to exist)
set local session_replication_role = replica;
insert into external_domain_ownership (org_id, external_tier, domain) values ('17170000-0000-0000-0000-0000000000a1', 'erpnext', 'revenue');
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.detail($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$), '42501 erp-owns-revenue',
  'AC-TM-023b an org whose ERP owns revenue is refused with erp-owns-revenue');
reset role;
delete from external_domain_ownership where org_id = '17170000-0000-0000-0000-0000000000a1';
insert into org_features (org_id, feature_key, enabled) values ('17170000-0000-0000-0000-0000000000a1', 'sales_invoices', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, 'P0001', 'feature_off', 'AC-TM-023 with sales invoices switched off it refuses feature_off');
reset role;
delete from org_features where org_id = '17170000-0000-0000-0000-0000000000a1' and feature_key = 'sales_invoices';

-- ── AC-TM-024: separation of duties on approval ────────────────────────────────────────────────
select is((select array_agg(user_id order by user_id) from sales_invoice_authors where sales_invoice_id = pg_temp.st('r1')::uuid),
  array['17170000-0000-0000-0000-0000000000b1','17170000-0000-0000-0000-0000000000b2','17170000-0000-0000-0000-0000000000b4','17170000-0000-0000-0000-0000000000b5']::uuid[],
  'AC-TM-024 the authors are the creator, the assembler, the sign-off preparer and the confirmer');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.detail($q$select transition_native_sales_invoice(pg_temp.st('r1')::uuid, 'Unpaid')$q$), '42501 sod-self-approval', 'AC-TM-024 the creator cannot approve');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(pg_temp.detail($q$select transition_native_sales_invoice(pg_temp.st('r1')::uuid, 'Unpaid')$q$), '42501 sod-self-approval', 'AC-TM-024 the sign-off preparer cannot approve');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(pg_temp.detail($q$select transition_native_sales_invoice(pg_temp.st('r1')::uuid, 'Unpaid')$q$), '42501 sod-self-approval', 'AC-TM-024 the confirmer cannot approve');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select transition_native_sales_invoice(pg_temp.st('r1')::uuid, 'Unpaid')$q$, '42501', null, 'AC-TM-024 the assembler (a Project Manager) cannot approve');
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('r1')::uuid, 'Unpaid')$q$, 'AC-TM-024 a different Admin approves');
reset role;
select is((select status || ' ' || (pmo_number like 'INV-%')::text from sales_invoices where id = pg_temp.st('r1')::uuid), 'Unpaid true',
  'AC-TM-024 the approved invoice is Unpaid and numbered');

-- ── AC-TM-025: tax and currency parity with the generic native creator, and the work order is not double counted ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select lives_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000103')$q$, 'AC-TM-025 a VAT project''s claim is invoiced');
select lives_ok($q$insert into _state select 'generic', create_native_sales_invoice('17170000-0000-0000-0000-0000000000c2', '17170000-0000-0000-0000-0000000000cc',
  '[{"description":"Site engineer (hour)","qty":10,"rate":50000}]'::jsonb)::text$q$, 'AC-TM-025 the generic creator invoices the same single line');
reset role;
select is((select row(a.amount, a.tax_rate, a.tax_amount, a.tax_base_numerator, a.tax_base_denominator, a.tax_treatment, a.currency)::text
             from sales_invoices a where a.id = '17170000-0000-0000-0000-000000000103'),
          (select row(b.amount, b.tax_rate, b.tax_amount, b.tax_base_numerator, b.tax_base_denominator, b.tax_treatment, b.currency)::text
             from sales_invoices b where b.id = pg_temp.st('generic')::uuid),
  'AC-TM-025 amount, VAT rate, base, tax and currency equal the generic native invoice for the same body');
select is((select tax_amount from sales_invoices where id = '17170000-0000-0000-0000-000000000103'), 55000.00::numeric,
  'AC-TM-025 CONTROL the VAT is 12% on 11/12 of 500,000.00');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.detail($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000104')$q$), 'P0001 vat-rate-missing',
  'AC-TM-025 a VAT project with no rate is refused with vat-rate-missing');
reset role;
select is((select sum(billed)::text from work_order_billing_lines where work_order_id = '17170000-0000-0000-0000-0000000000f4'), '800000.00',
  'AC-TM-025 CONTROL the unraised claim counts against its work order at gross');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select lives_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000105')$q$, 'AC-TM-025 the work-order claim is invoiced');
reset role;
select is((select sum(billed)::text from work_order_billing_lines where work_order_id = '17170000-0000-0000-0000-0000000000f4'), '800000.00',
  'AC-TM-025 the work order''s billed total does not change when its claim becomes an invoice');
select is((select work_order_id from sales_invoices where id = '17170000-0000-0000-0000-000000000105'), '17170000-0000-0000-0000-0000000000f4'::uuid,
  'AC-TM-025 the invoice carries the claim''s work order');

-- ── AC-TM-026: consistency ─────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17170000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select lives_ok($q$select create_native_tm_invoice('17170000-0000-0000-0000-000000000106')$q$, 'AC-TM-026 the mixed labour / equipment / standby claim is invoiced');
reset role;
select is((select string_agg(l ->> 'description' || ' ' || (l ->> 'qty') || ' x ' || (l ->> 'rate'), ' | ' order by ord)
             from sales_invoices, jsonb_array_elements(native_lines) with ordinality t(l, ord)
            where id = '17170000-0000-0000-0000-000000000106'),
  'Loader (hour) standby 6.00 x 200000.00 | Loader (hour) 3.00 x 800000.00 | Site engineer (hour) 2.00 x 50000.00',
  'AC-TM-026 lines are ordered equipment then labour; standby is marked in the text; qty and rate are the signed ones');
select is((select amount from sales_invoices where id = '17170000-0000-0000-0000-000000000106'), 3700000.00::numeric,
  'AC-TM-026 the header is the sum of the lines');
select is((select (select sum((l ->> 'amount')::numeric) from jsonb_array_elements(si.native_lines) l) = si.amount
                  and si.amount = c.gross_amount and si.id = pc.id and pc.id = c.id
             from sales_invoices si join tm_claims c on c.id = si.id join progress_claims pc on pc.id = si.id
            where si.id = pg_temp.st('r1')::uuid), true,
  'AC-TM-026 header = sum of lines = claim gross, and claim, progress claim and invoice share one id');
select is((select count(*)::int from audit_events where action = 'tm_native_invoice.create' and entity_id = pg_temp.st('r1')::uuid), 1,
  'AC-TM-026 the creation is audited');
select is((select count(*)::int from sales_invoices where id = pg_temp.st('r1')::uuid), 1, 'AC-TM-026 exactly one invoice per claim');

select * from finish();
rollback;
