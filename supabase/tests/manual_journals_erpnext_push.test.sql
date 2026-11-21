-- manual_journals_erpnext_push.test.sql — #895 manual journals for an ERPNext-connected org (migration 0887).
-- FR-MJE-022: approve → approved_journal_for_push returns the approved journal; once posted it is not returned again.
-- AC-MJE-004 (database half): a line holding the ERPNext account NUMBER is sent as the ERP's full account name; the
-- outbox claim takes a journal's row once (a second dispatch of the same row claims nothing).
-- FR-MJE-116: record_journal_outcome writes posted and refused back.
begin;
select plan(17);

insert into organizations (id, name) values ('08951000-0000-0000-0000-000000000001','Erp Desk Org');
insert into auth.users (id, email) values
  ('08951000-0000-0000-0000-0000000000a1','erp-fin-a@example.test'),
  ('08951000-0000-0000-0000-0000000000a2','erp-fin-b@example.test');
insert into profiles (id, org_id, full_name, email, role) values
  ('08951000-0000-0000-0000-0000000000a1','08951000-0000-0000-0000-000000000001','Fin A','erp-fin-a@example.test','Finance'),
  ('08951000-0000-0000-0000-0000000000a2','08951000-0000-0000-0000-000000000001','Fin B','erp-fin-b@example.test','Finance');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config) values
  ('08951000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','vault:erp-desk','active','{"company":"Test Co"}');

-- The mirrored ERPNext chart: the same number exists in another company of the same site, so the bound company decides.
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, is_group, account_number,
                                account_currency, lft, rgt, refresh_id) values
  ('08951000-0000-0000-0000-000000000001','Test Co','6100 - Bank Charges - TC','Bank Charges','Expense','Profit and Loss',false,'6100','IDR',1,2,gen_random_uuid()),
  ('08951000-0000-0000-0000-000000000001','Test Co','1110 - Cash - TC','Cash','Asset','Balance Sheet',false,'1110','IDR',3,4,gen_random_uuid()),
  ('08951000-0000-0000-0000-000000000001','Other Co','1110 - Cash - OC','Cash','Asset','Balance Sheet',false,'1110','IDR',5,6,gen_random_uuid()),
  ('08951000-0000-0000-0000-000000000001','Test Co','1000 - Assets - TC','Assets','Asset','Balance Sheet',true,'1000','IDR',0,7,gen_random_uuid());

create function pg_temp.act(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.owner() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;
create temp table j (memo text, id uuid) on commit drop;
grant all on j to authenticated, service_role;

-- Fin A writes three journals: one by account number, one by full name, one to refuse. Fin B approves them.
select pg_temp.act('08951000-0000-0000-0000-0000000000a1');
insert into j select 'By number', save_journal_draft(null, 'fee', '2026-11-15', 'By number',
  '[{"account":"6100","debit":"25.00","credit":"0","label":"fee"},{"account":"1110","debit":"0","credit":"25.00","label":"fee"}]'::jsonb);
insert into j select 'By name', save_journal_draft(null, 'fee', '2026-11-15', 'By name',
  '[{"account":"6100 - Bank Charges - TC","debit":"5.00","credit":"0","label":"fee"},{"account":"1110 - Cash - TC","debit":"0","credit":"5.00","label":"fee"}]'::jsonb);
insert into j select 'To refuse', save_journal_draft(null, 'fee', '2026-11-15', 'To refuse',
  '[{"account":"6100","debit":"7.00","credit":"0","label":"fee"},{"account":"1110","debit":"0","credit":"7.00","label":"fee"}]'::jsonb);
select lives_ok($$ select submit_journal(id) from j where memo <> 'Group' $$, 'AC-MJE-004 a journal naming ERPNext account numbers of the bound company submits');
insert into j select 'Group', save_journal_draft(null, 'fee', '2026-11-15', 'Group',
  '[{"account":"1000","debit":"1.00","credit":"0","label":"x"},{"account":"1110","debit":"0","credit":"1.00","label":"x"}]'::jsonb);
select throws_like($$ select submit_journal((select id from j where memo = 'Group')) $$, '%account 1000 is archived in the ledger%',
  'AC-MJE-004 a group account named by its number is refused at submit');
delete from j where memo = 'Group';

select pg_temp.act('08951000-0000-0000-0000-0000000000a2');
select lives_ok($$ select approve_journal(id) from j $$, 'FR-MJE-022 the second approver approves the three journals');

-- ── approve → approved_journal_for_push ────────────────────────────────────────────────────────────
select results_eq($$ select x->>'id', x->>'key', x->>'tier', x->>'status' from (select approved_journal_for_push((select id from j where memo = 'By number')) x) s $$,
  $$ select (select id from j where memo = 'By number')::text, 'journal:' || (select id from j where memo = 'By number')::text, 'erpnext'::text, 'approved'::text $$,
  'FR-MJE-022 the approved journal is read for push with its key and the ERPNext tier');
select is(jsonb_array_length(approved_journal_for_push((select id from j where memo = 'By number')) -> 'lines'), 2,
  'FR-MJE-022 the push carries both lines');
select results_eq($$ select l->>'account', l->>'debit', l->>'credit' from jsonb_array_elements(approved_journal_for_push((select id from j where memo = 'By number')) -> 'lines') l $$,
  $$ values ('6100 - Bank Charges - TC'::text, '25.00'::text, '0.00'::text), ('1110 - Cash - TC', '0.00', '25.00') $$,
  'AC-MJE-004 a line holding an account number is sent as the ERPNext full account name of the bound company');
select results_eq($$ select l->>'account' from jsonb_array_elements(approved_journal_for_push((select id from j where memo = 'By name')) -> 'lines') l $$,
  $$ values ('6100 - Bank Charges - TC'::text), ('1110 - Cash - TC') $$,
  'AC-MJE-004 a line holding the full account name is sent unchanged');
select pg_temp.owner();
select is((select string_agg(account, ',' order by line_no) from journal_entry_lines where journal_id = (select id from j where memo = 'By number')),
  '6100,1110', 'AC-MJE-004 the stored line keeps what the accountant entered');

-- ── the outbox claim takes a journal's row once ──────────────────────────────────────────────────
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  select '08951000-0000-0000-0000-000000000001', 'accounting', id::text, 'journal:' || id::text, 'erpnext', 'create', 'pending'
    from j where memo = 'By number';
select set_config('role', 'service_role', true);
select is((select claim_generation from claim_outbox_for_commit(
    (select id from external_command_outbox where idempotency_key = 'journal:' || (select id from j where memo = 'By number')::text))), 1,
  'AC-MJE-004 the first dispatch claims the journal''s outbox row');
select is((select id from claim_outbox_for_commit(
    (select id from external_command_outbox where idempotency_key = 'journal:' || (select id from j where memo = 'By number')::text))), null,
  'AC-MJE-004 a second dispatch of the same row while it commits claims nothing');
select pg_temp.owner();
update external_command_outbox set state = 'confirmed' where idempotency_key = 'journal:' || (select id from j where memo = 'By number')::text;
select set_config('role', 'service_role', true);
select is((select id from claim_outbox_for_commit(
    (select id from external_command_outbox where idempotency_key = 'journal:' || (select id from j where memo = 'By number')::text))), null,
  'AC-MJE-004 a dispatch of a confirmed row claims nothing');
select pg_temp.owner();
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  select '08951000-0000-0000-0000-000000000001', 'accounting', id::text, 'journal:' || id::text, 'erpnext', 'create', 'pending' from j where memo = 'By number' $$,
  '23505', null, 'AC-MJE-004 one journal key opens one outbox row');

-- ── record_journal_outcome writes posted and refused back ────────────────────────────────────────
select set_config('role', 'service_role', true);
select lives_ok($$ select record_journal_outcome((select id from j where memo = 'By number'), 'posted', 'ACC-JV-2026-00001', 'ACC-JV-2026-00001', '2026-11-15', null) $$,
  'FR-MJE-116 the service role records the post');
select lives_ok($$ select record_journal_outcome((select id from j where memo = 'To refuse'), 'refused', null, null, null, 'the ledger refused the entry') $$,
  'FR-MJE-116 the service role records a refusal');
select pg_temp.owner();
select results_eq($$ select memo, status::text, external_record_id, posted_date, held_reason from journal_entries where id in (select id from j where memo <> 'By name') order by memo $$,
  $$ values ('By number'::text, 'posted'::text, 'ACC-JV-2026-00001'::text, '2026-11-15'::date, null::text),
            ('To refuse', 'refused', null, null, 'the ledger refused the entry') $$,
  'FR-MJE-116 the posted journal carries the ledger ref and date; the refused one carries the reason');
select pg_temp.act('08951000-0000-0000-0000-0000000000a2');
select throws_ok($$ select approved_journal_for_push((select id from j where memo = 'By number')) $$, '42501', null,
  'FR-MJE-022 a posted journal is not read for push again');
select throws_ok($$ select approved_journal_for_push((select id from j where memo = 'To refuse')) $$, '42501', null,
  'FR-MJE-022 a refused journal is not read for push again');

select * from finish();
rollback;
