-- manual_journals.test.sql — #895 accountant's desk piece 1: manual journals (migration 0887).
-- AC-ACD-020: the three journal tables are read-only to clients, Finance-or-above only, own org only.
-- AC-ACD-001 (server half), AC-ACD-002: balance and account refusals at submit; a second approver who did not
-- write the journal (owner ruling: every journal, any Finance-or-above non-author).
-- FR-ACD-020/-021/-022/-023/-024/-025/-116; desk-journal setup refusal (owner ruling 4).
begin;
select plan(78);

-- ── Fixtures (table owner) ──────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('08950000-0000-0000-0000-000000000001','Desk Org'),
  ('08950000-0000-0000-0000-000000000002','Other Org');

insert into auth.users (id, email) values
  ('08950000-0000-0000-0000-0000000000a1','fin-a@example.test'),
  ('08950000-0000-0000-0000-0000000000a2','fin-b@example.test'),
  ('08950000-0000-0000-0000-0000000000a3','fin-c@example.test'),
  ('08950000-0000-0000-0000-0000000000a4','pm@example.test'),
  ('08950000-0000-0000-0000-0000000000a5','eng@example.test'),
  ('08950000-0000-0000-0000-0000000000a6','admin@example.test'),
  ('08950000-0000-0000-0000-0000000000a7','exec@example.test'),
  ('08950000-0000-0000-0000-0000000000b1','fin-other@example.test');

insert into profiles (id, org_id, full_name, email, role) values
  ('08950000-0000-0000-0000-0000000000a1','08950000-0000-0000-0000-000000000001','Fin A','fin-a@example.test','Finance'),
  ('08950000-0000-0000-0000-0000000000a2','08950000-0000-0000-0000-000000000001','Fin B','fin-b@example.test','Finance'),
  ('08950000-0000-0000-0000-0000000000a3','08950000-0000-0000-0000-000000000001','Fin C','fin-c@example.test','Finance'),
  ('08950000-0000-0000-0000-0000000000a4','08950000-0000-0000-0000-000000000001','PM','pm@example.test','Project Manager'),
  ('08950000-0000-0000-0000-0000000000a5','08950000-0000-0000-0000-000000000001','Eng','eng@example.test','Engineer'),
  ('08950000-0000-0000-0000-0000000000a6','08950000-0000-0000-0000-000000000001','Admin','admin@example.test','Admin'),
  ('08950000-0000-0000-0000-0000000000a7','08950000-0000-0000-0000-000000000001','Exec','exec@example.test','Executive'),
  ('08950000-0000-0000-0000-0000000000b1','08950000-0000-0000-0000-000000000002','Fin Other','fin-other@example.test','Finance');

insert into projects (id, org_id, name) values
  ('08950000-0000-0000-0000-0000000000c1','08950000-0000-0000-0000-000000000001','Linked Project'),
  ('08950000-0000-0000-0000-0000000000c2','08950000-0000-0000-0000-000000000001','Unlinked Project');

insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status) values
  ('08950000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','vault:desk','active');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
  ('08950000-0000-0000-0000-000000000001','08950000-0000-0000-0000-0000000000c1','odoo','77');

insert into external_master_records (org_id, external_tier, kind, external_id, code, name, active, source_write_date, attrs) values
  ('08950000-0000-0000-0000-000000000001','odoo','account','601','6100','Bank charges',true,'2026-11-01 00:00:00','{}'),
  ('08950000-0000-0000-0000-000000000001','odoo','account','101','1100','Bank',true,'2026-11-01 00:00:00','{}'),
  ('08950000-0000-0000-0000-000000000001','odoo','account','999','9990','Old suspense',false,'2026-11-01 00:00:00','{}'),
  ('08950000-0000-0000-0000-000000000001','odoo','journal','3','MISC','Miscellaneous',true,'2026-11-01 00:00:00','{"type":"general"}'),
  ('08950000-0000-0000-0000-000000000001','odoo','journal','7','BNK1','Bank',true,'2026-11-01 00:00:00','{"type":"bank"}');

-- Helper: act as a profile.
create function pg_temp.act(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.owner() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- Lines used below.
create function pg_temp.lines(p_debit text, p_credit text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('account','6100','debit',p_debit,'credit','0','label','Bank fee','project_id','08950000-0000-0000-0000-0000000000c1'),
    jsonb_build_object('account','1100','debit','0','credit',p_credit,'label','Bank fee'))
$$;

-- ── AC-ACD-020: read-only, role- and org-scoped ─────────────────────────────────────────────────
-- A seeded posted journal (owner insert) so the select checks have something to hide.
insert into journal_entries (id, org_id, kind, entry_date, memo, status, maker_id, external_record_id) values
  ('08950000-0000-0000-0000-0000000000e1','08950000-0000-0000-0000-000000000001','fee','2026-11-01','Seeded fee','posted',
   '08950000-0000-0000-0000-0000000000a1','account.move:41');
insert into journal_entry_lines (org_id, journal_id, line_no, account, debit, credit, label) values
  ('08950000-0000-0000-0000-000000000001','08950000-0000-0000-0000-0000000000e1',1,'6100',10,0,'fee'),
  ('08950000-0000-0000-0000-000000000001','08950000-0000-0000-0000-0000000000e1',2,'1100',0,10,'fee');
insert into journal_entry_authors (org_id, journal_id, profile_id) values
  ('08950000-0000-0000-0000-000000000001','08950000-0000-0000-0000-0000000000e1','08950000-0000-0000-0000-0000000000a1');

select pg_temp.act('08950000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from journal_entries), 0, 'AC-ACD-020 a Project Manager sees no journal');
select is((select count(*)::int from journal_entry_lines), 0, 'AC-ACD-020 a Project Manager sees no journal line');
select is((select count(*)::int from journal_entry_authors), 0, 'AC-ACD-020 a Project Manager sees no journal author');
select throws_ok($$ select save_journal_draft(null, 'fee', '2026-11-15', 'x', pg_temp.lines('1','1')) $$, '42501', null,
  'AC-ACD-020 a Project Manager cannot draft a journal');
select throws_ok($$ select approve_journal('08950000-0000-0000-0000-0000000000e1') $$, '42501', null,
  'AC-ACD-020 a Project Manager cannot approve a journal');
select throws_ok($$ select approved_journal_for_push('08950000-0000-0000-0000-0000000000e1') $$, '42501', null,
  'AC-ACD-020 a Project Manager cannot read a journal for push');
select throws_ok($$ select list_journals('2026-01-01','2026-12-31') $$, '42501', null,
  'AC-ACD-020 a Project Manager cannot list journals');

select pg_temp.act('08950000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from journal_entries), 0, 'AC-ACD-020 an Engineer sees no journal');
select throws_ok($$ select submit_journal('08950000-0000-0000-0000-0000000000e1') $$, '42501', null,
  'AC-ACD-020 an Engineer cannot submit a journal');
select throws_ok($$ select request_journal_reversal('08950000-0000-0000-0000-0000000000e1', '2026-11-20', 'wrong') $$, '42501', null,
  'AC-ACD-020 an Engineer cannot request a reversal');

select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from journal_entries), 1, 'AC-ACD-020 Finance sees its org''s journal');
select throws_ok($$ insert into journal_entries (kind, entry_date, memo, maker_id) values ('fee','2026-11-15','direct','08950000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'AC-ACD-020 Finance cannot insert a journal directly');
select throws_ok($$ update journal_entries set status = 'posted' $$, '42501', null, 'AC-ACD-020 Finance cannot update a journal directly');
select throws_ok($$ delete from journal_entries $$, '42501', null, 'AC-ACD-020 Finance cannot delete a journal directly');
select throws_ok($$ insert into journal_entry_lines (journal_id, line_no, account, debit) values ('08950000-0000-0000-0000-0000000000e1', 9, '6100', 1) $$,
  '42501', null, 'AC-ACD-020 Finance cannot insert a journal line directly');
select throws_ok($$ update journal_entry_lines set debit = 999 $$, '42501', null, 'AC-ACD-020 Finance cannot update a journal line directly');
select throws_ok($$ delete from journal_entry_lines $$, '42501', null, 'AC-ACD-020 Finance cannot delete a journal line directly');
select throws_ok($$ insert into journal_entry_authors (journal_id, profile_id) values ('08950000-0000-0000-0000-0000000000e1','08950000-0000-0000-0000-0000000000a3') $$,
  '42501', null, 'AC-ACD-020 Finance cannot insert an author directly');
select throws_ok($$ delete from journal_entry_authors $$, '42501', null, 'AC-ACD-020 Finance cannot delete an author directly');
select throws_ok($$ select record_journal_outcome('08950000-0000-0000-0000-0000000000e1', 'posted', 'account.move:1', null, '2026-11-01', null) $$,
  '42501', null, 'FR-ACD-116 an authenticated caller cannot record a ledger outcome');

select pg_temp.act('08950000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from journal_entries), 0, 'AC-ACD-020 Finance of another org sees no journal');
select is((select count(*)::int from journal_entry_lines), 0, 'AC-ACD-020 Finance of another org sees no journal line');
select throws_ok($$ select approve_journal('08950000-0000-0000-0000-0000000000e1') $$, '42501', null,
  'AC-ACD-020 Finance of another org cannot approve the journal');

-- ── FR-ACD-020/-023: draft and the author set ───────────────────────────────────────────────────
select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
create temp table j (id uuid) on commit drop;
grant all on j to authenticated, service_role;
insert into j select save_journal_draft(null, 'fee', '2026-11-15', 'November bank fee', pg_temp.lines('100.00','100.00'));
select pg_temp.owner();
select is((select status::text from journal_entries where id = (select id from j)), 'draft', 'FR-ACD-020 Finance A drafts a journal');
select is((select org_id from journal_entries where id = (select id from j)), '08950000-0000-0000-0000-000000000001'::uuid,
  'FR-ACD-020 the org is stamped server-side');
select is((select count(*)::int from journal_entry_lines where journal_id = (select id from j)), 2, 'FR-ACD-020 the draft has its two lines');
select is((select array_agg(profile_id) from journal_entry_authors where journal_id = (select id from j)),
  array['08950000-0000-0000-0000-0000000000a1'::uuid], 'FR-ACD-023 the maker is the only author');

select pg_temp.act('08950000-0000-0000-0000-0000000000a2');
select lives_ok($$ select save_journal_draft((select id from j), 'fee', '2026-11-15', 'November bank fee', pg_temp.lines('100.00','100.00')) $$,
  'FR-ACD-023 Finance B edits the draft');
select pg_temp.owner();
select is((select count(*)::int from journal_entry_authors where journal_id = (select id from j)), 2, 'FR-ACD-023 the editor joins the author set');
select is((select maker_id from journal_entries where id = (select id from j)), '08950000-0000-0000-0000-0000000000a1'::uuid,
  'FR-ACD-023 an edit does not change the maker');

select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
select throws_ok($$ select save_journal_draft(null, 'fee', '2026-11-15', 'bad', '[{"account":"6100","debit":"1","credit":"1","label":"x"},{"account":"1100","debit":"0","credit":"0","label":"x"}]'::jsonb) $$,
  '22023', null, 'FR-ACD-020 a line with both a debit and a credit is refused');
select throws_ok($$ select save_journal_draft(null, 'fee', '2026-11-15', 'bad', '[{"account":"6100","debit":"1","credit":"0","label":"x","project_id":"08950000-0000-0000-0000-00000000ffff"}]'::jsonb) $$,
  '22023', null, 'FR-ACD-020 a line naming a project outside the org is refused');

-- ── FR-ACD-021, AC-ACD-001 server half: submit refusals ────────────────────────────────────────
create temp table u (id uuid) on commit drop;
grant all on u to authenticated, service_role;
insert into u select save_journal_draft(null, 'fee', '2026-11-15', 'Unbalanced', pg_temp.lines('100.00','99.99'));
select throws_like($$ select submit_journal((select id from u)) $$, '%does not balance by 0.01%',
  'AC-ACD-001 an unbalanced journal is refused at submit, naming the difference');
select pg_temp.owner();
select is((select count(*)::int from external_command_outbox where pmo_record_id = (select id from u)::text), 0,
  'AC-ACD-001 a refused journal mints no outbox row');
select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
insert into u select save_journal_draft(null, 'fee', '2026-11-15', 'One line', '[{"account":"6100","debit":"5","credit":"0","label":"x"}]'::jsonb);
select throws_like($$ select submit_journal(id) from journal_entries where memo = 'One line' $$,
  '%two or more lines%', 'FR-ACD-021 a one-line journal is refused at submit');
insert into u select save_journal_draft(null, 'fee', '2026-11-15', 'Archived account',
  '[{"account":"9990","debit":"5","credit":"0","label":"x"},{"account":"1100","debit":"0","credit":"5","label":"x"}]'::jsonb);
select throws_like($$ select submit_journal(id) from journal_entries where memo = 'Archived account' $$,
  '%account 9990 is archived in the ledger%', 'FR-ACD-021 an account archived in the ledger is refused at submit');
insert into u select save_journal_draft(null, 'fee', '2026-11-15', 'Unknown account',
  '[{"account":"4242","debit":"5","credit":"0","label":"x"},{"account":"1100","debit":"0","credit":"5","label":"x"}]'::jsonb);
select throws_like($$ select submit_journal(id) from journal_entries where memo = 'Unknown account' $$,
  '%account 4242 is not in the ledger%', 'FR-ACD-021 an account the ledger chart does not hold is refused at submit');

select lives_ok($$ select submit_journal((select id from j)) $$, 'FR-ACD-021 a balanced journal submits');
select pg_temp.owner();
select is((select status::text from journal_entries where id = (select id from j)), 'submitted', 'FR-ACD-021 the journal is submitted');

-- ── AC-ACD-002: a second approver who did not write it ─────────────────────────────────────────
select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
select throws_ok($$ select approve_journal((select id from j)) $$, '42501', null, 'AC-ACD-002 the maker cannot approve their journal');
select pg_temp.act('08950000-0000-0000-0000-0000000000a2');
select throws_ok($$ select approve_journal((select id from j)) $$, '42501', null, 'AC-ACD-002 a Finance member who edited a line cannot approve');
select pg_temp.act('08950000-0000-0000-0000-0000000000a4');
select throws_ok($$ select approve_journal((select id from j)) $$, '42501', null, 'AC-ACD-002 a Project Manager cannot approve');
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select throws_ok($$ select return_journal((select id from j), '  ') $$, '22023', null, 'FR-ACD-022 a return needs a reason');
select lives_ok($$ select return_journal((select id from j), 'Wrong account') $$, 'FR-ACD-022 a non-author returns the journal with a reason');
select pg_temp.owner();
select results_eq($$ select status::text, return_reason from journal_entries where id = (select id from j) $$,
  $$ values ('draft'::text, 'Wrong account'::text) $$, 'FR-ACD-022 a returned journal is a draft and keeps the reason');
select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
select lives_ok($$ select submit_journal((select id from j)) $$, 'FR-ACD-022 the maker resubmits');
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select lives_ok($$ select approve_journal((select id from j)) $$, 'AC-ACD-002 Finance C, who did not write it, approves');
select pg_temp.owner();
select results_eq($$ select status::text, approver_id from journal_entries where id = (select id from j) $$,
  $$ values ('approved'::text, '08950000-0000-0000-0000-0000000000a3'::uuid) $$, 'AC-ACD-002 the journal is approved by Finance C');
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select throws_like($$ select approve_journal((select id from j)) $$, '%only a submitted journal%', 'AC-ACD-002 an approved journal cannot be approved twice');
select throws_like($$ select save_journal_draft((select id from j), 'fee', '2026-11-15', 'edit after approval', pg_temp.lines('1','1')) $$,
  '%only a draft can be edited%', 'FR-ACD-020 an approved journal cannot be edited');
select is(may_approve_journal((select id from j), '08950000-0000-0000-0000-0000000000a7'), true,
  'AC-ACD-002 an Executive who did not write it may approve');
select is(may_approve_journal((select id from j), '08950000-0000-0000-0000-0000000000b1'), false,
  'AC-ACD-002 a Finance member of another org may not approve');

-- ── Owner ruling 4 and FR-ACD-022: the dispatch re-read ─────────────────────────────────────────
select throws_like($$ select approved_journal_for_push((select id from j)) $$,
  '%An Admin must choose the Odoo journal for desk entries%', 'OQ-4 posting is refused until an Admin picks the desk journal');
select throws_ok($$ select set_desk_journal('3') $$, '42501', null, 'OQ-4 Finance cannot pick the desk journal');
select pg_temp.act('08950000-0000-0000-0000-0000000000a6');
select throws_like($$ select set_desk_journal('7') $$, '%not a general journal%', 'OQ-4 a bank journal cannot be the desk journal');
select lives_ok($$ select set_desk_journal('3') $$, 'OQ-4 an Admin picks the general journal');
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select is(approved_journal_for_push((select id from j)) #>> '{lines,0,analytic}', '77',
  'FR-ACD-022 a project line carries the project''s ledger analytic');
select is(approved_journal_for_push((select id from j)) #>> '{lines,0,account_id}', '601',
  'FR-ACD-022 a line carries the ledger account id');
select results_eq($$ select x->>'key', x->>'desk_journal_id', x->>'tier' from (select approved_journal_for_push((select id from j)) x) s $$,
  $$ select 'journal:' || (select id from j)::text, '3'::text, 'odoo'::text $$, 'FR-ACD-022 the push carries the key, the desk journal and the tier');
select throws_ok($$ select approved_journal_for_push(id) from journal_entries where memo = 'Unbalanced' $$, '42501', null,
  'FR-ACD-022 a draft journal is never read for push');
insert into u select save_journal_draft(null, 'fee', '2026-11-15', 'Unlinked project',
  '[{"account":"6100","debit":"5","credit":"0","label":"x","project_id":"08950000-0000-0000-0000-0000000000c2"},{"account":"1100","debit":"0","credit":"5","label":"x"}]'::jsonb);
select pg_temp.owner();
update journal_entries set status = 'approved' where memo = 'Unlinked project';
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select throws_like($$ select approved_journal_for_push(id) from journal_entries where memo = 'Unlinked project' $$,
  '%project Unlinked Project is not linked to the ledger%', 'FR-ACD-022 a project with no ledger link is refused');

-- ── FR-ACD-116: the outcome writer (service role) ──────────────────────────────────────────────
select set_config('role', 'service_role', true);
select lives_ok($$ select record_journal_outcome((select id from j), 'posted', 'account.move:52', 'MISC/2026/0052', '2026-11-15', null) $$,
  'FR-ACD-116 the service role records the post');
select pg_temp.owner();
select results_eq($$ select status::text, external_record_id, posted_date from journal_entries where id = (select id from j) $$,
  $$ values ('posted'::text, 'account.move:52'::text, '2026-11-15'::date) $$, 'FR-ACD-116 the posted journal carries the ledger ref and date');
select set_config('role', 'service_role', true);
select lives_ok($$ select record_journal_outcome(id, 'held', null, null, null, 'posted in the ledger on 2026-12-01, not 2026-11-15') from journal_entries where memo = 'Unlinked project' $$,
  'FR-ACD-116 the service role records a hold');
select pg_temp.owner();
select is((select held_reason from journal_entries where memo = 'Unlinked project'), 'posted in the ledger on 2026-12-01, not 2026-11-15',
  'FR-ACD-116 a held journal keeps the reason');

-- ── FR-ACD-024/-025: reversal ───────────────────────────────────────────────────────────────────
select pg_temp.act('08950000-0000-0000-0000-0000000000a2');
select throws_like($$ select request_journal_reversal(id, '2026-11-20', 'x') from journal_entries where memo = 'Unbalanced' $$,
  '%only a posted journal%', 'FR-ACD-024 a draft cannot be reversed');
create temp table r (id uuid) on commit drop;
grant all on r to authenticated, service_role;
insert into r select request_journal_reversal((select id from j), '2026-11-20', 'Charged twice');
select pg_temp.owner();
select results_eq($$ select status::text, reverses_journal_id, reversal_reason from journal_entries where id = (select id from r) $$,
  $$ select 'draft'::text, (select id from j), 'Charged twice'::text $$, 'FR-ACD-025 the reversal is a new draft naming the original');
select results_eq($$ select account, debit, credit from journal_entry_lines where journal_id = (select id from r) order by line_no $$,
  $$ values ('6100'::text, 0::numeric(18,2), 100.00::numeric(18,2)), ('1100'::text, 100.00::numeric(18,2), 0::numeric(18,2)) $$,
  'FR-ACD-025 each reversal line has its sides swapped');
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select throws_like($$ select request_journal_reversal((select id from j), '2026-11-21', 'again') $$, '%already reversed%',
  'FR-ACD-025 a second reversal while the first is live is refused');
select throws_like($$ select save_journal_draft((select id from r), 'fee', '2026-11-20', 'edit', pg_temp.lines('1','1')) $$,
  '%a reversal cannot be edited%', 'FR-ACD-025 a reversal keeps the original''s lines');
select lives_ok($$ select submit_journal((select id from r)) $$, 'FR-ACD-025 the reversal submits');
select pg_temp.act('08950000-0000-0000-0000-0000000000a1');
select throws_ok($$ select approve_journal((select id from r)) $$, '42501', null,
  'FR-ACD-025 the original''s maker cannot approve its reversal');
select pg_temp.act('08950000-0000-0000-0000-0000000000a7');
select lives_ok($$ select approve_journal((select id from r)) $$, 'FR-ACD-025 an Executive who wrote neither approves the reversal');
select is(approved_journal_for_push((select id from r)) ->> 'key', 'journal-rev:' || (select id from r)::text,
  'FR-ACD-025 the reversal pushes under its own reversal key');
select is(approved_journal_for_push((select id from r)) #>> '{reverses,external_record_id}', 'account.move:52',
  'FR-ACD-025 the reversal push names the original''s ledger ref');

-- ── AC-ACD-006/-007: listed once ───────────────────────────────────────────────────────────────
select pg_temp.owner();
insert into erp_gl_entry_mirror (org_id, erp_name, account, voucher_type, voucher_no, posting_date, debit, credit, erp_modified) values
  ('08950000-0000-0000-0000-000000000001','odoo:900:1','6100','account.move','MISC/2026/0052','2026-11-15',100,0,'2026-11-15'),
  ('08950000-0000-0000-0000-000000000001','odoo:900:2','1100','account.move','MISC/2026/0052','2026-11-15',0,100,'2026-11-15'),
  ('08950000-0000-0000-0000-000000000001','odoo:901:1','6100','account.move','MISC/2026/0060','2026-11-16',7,0,'2026-11-16'),
  ('08950000-0000-0000-0000-000000000001','odoo:901:2','1100','account.move','MISC/2026/0060','2026-11-16',0,7,'2026-11-16');
select pg_temp.act('08950000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from jsonb_array_elements(list_journals('2026-11-01','2026-11-30')) x
            where x->>'ledger_name' = 'MISC/2026/0052'), 1, 'AC-ACD-006 a posted PMO journal also in the ledger mirror is listed once');
select is((select x->>'origin' from jsonb_array_elements(list_journals('2026-11-01','2026-11-30')) x
            where x->>'ledger_name' = 'MISC/2026/0052'), 'pmo', 'AC-ACD-006 it is listed as the PMO journal');
select results_eq($$ select x->>'origin', x->>'total' from jsonb_array_elements(list_journals('2026-11-01','2026-11-30')) x
            where x->>'ledger_name' = 'MISC/2026/0060' $$, $$ values ('outside-pmo'::text, '7.00'::text) $$,
  'AC-ACD-007 a ledger move PMO did not write is listed as outside PMO');

select * from finish();
rollback;
