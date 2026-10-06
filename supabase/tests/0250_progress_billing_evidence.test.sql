-- 0250_progress_billing_evidence.test.sql — #766 AC-PB-018: a billing claim needs evidence (an Issued/Approved
-- project document with a file) before any invoice can be raised. Project c1 has no down payment, so its
-- progress claims recover nothing and need no DP invoice.
begin;
create extension if not exists pgtap;
select plan(16);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('07660000-0000-0000-0000-00000000d0c1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Progress report', 'Issued', 'A', 'docs/pb/report.pdf'),
  ('07660000-0000-0000-0000-00000000d0c2', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Draft report', 'Draft', 'A', 'docs/pb/draft.pdf'),
  ('07660000-0000-0000-0000-00000000d0c3', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'Report', 'Report without file', 'Issued', 'A', null),
  ('07660000-0000-0000-0000-00000000d0c4', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', 'Report', 'Other project report', 'Issued', 'A', 'docs/pb/other.pdf');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('pb.k1', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb)::text, true);
  perform set_config('pb.k2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":2}]'::jsonb)::text, true);
  perform set_config('pb.k3', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":3}]'::jsonb)::text, true);
  perform public.withdraw_progress_claim(current_setting('pb.k3')::uuid);
end $$;
select lives_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'AC-PB-018 Finance attaches an issued project document as evidence');                                     -- 1
select is((select document_status || '/' || document_revision || '/' || attached_by from progress_claim_evidence
            where claim_id = current_setting('pb.k1')::uuid),
  'Issued/A/07660000-0000-0000-0000-0000000000a2', 'AC-PB-018 the evidence records the document''s status, revision and who attached it'); -- 2
select lives_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'AC-PB-018 attaching the same document again is harmless');                                               -- 3
select is((select count(*)::int from progress_claim_evidence where claim_id = current_setting('pb.k1')::uuid), 1,
  'AC-PB-018 a repeat attach adds nothing');                                                                -- 4
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c2') $$,
  'P0001', 'only an issued or approved document can be billing evidence — its content is frozen from issue',
  'AC-PB-018 a Draft document is not evidence');                                                            -- 5
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c3') $$,
  'P0001', 'the evidence document has no file attached', 'AC-PB-018 a document without a file is not evidence'); -- 6
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k1')::uuid, '07660000-0000-0000-0000-00000000d0c4') $$,
  '23514', 'the evidence must be a document of the claim''s project', 'AC-PB-018 another project''s document is not evidence'); -- 7
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k3')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'P0001', 'this progress claim was withdrawn', 'AC-PB-018 a withdrawn claim takes no evidence');            -- 8
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k2')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  '42501', 'only Admin or Finance may attach billing evidence', 'AC-PB-018 a PM cannot attach billing evidence'); -- 9
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.attach_claim_evidence(current_setting('pb.k2')::uuid, '07660000-0000-0000-0000-00000000d0c1') $$,
  'P0002', 'progress claim not found', 'AC-PB-018 another org cannot attach to this org''s claim');          -- 10
reset role;
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.k2'), 'pb-ev-k2', 'erpnext', 'create', 'pending') $$,
  '55000', 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice',
  'AC-PB-018 the database refuses to raise a claim without evidence');                                      -- 11
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('07660000-0000-0000-0000-000000000001', 'revenue', current_setting('pb.k1'), 'pb-ev-k1', 'erpnext', 'create', 'pending') $$,
  'AC-PB-018 CONTROL a claim with evidence may be raised');                                                 -- 12
select throws_ok($$ delete from project_documents where id = '07660000-0000-0000-0000-00000000d0c1' $$,
  '23503', 'update or delete on table "project_documents" violates foreign key constraint "progress_claim_evidence_document_id_fkey" on table "progress_claim_evidence"',
  'AC-PB-018 a document cited as evidence cannot be deleted');                                              -- 13
select is((select count(*)::int from audit_events where action = 'progress_claim.evidence.attach'
            and entity_id = current_setting('pb.k1')::uuid), 1, 'AC-PB-018 the attach is audited once');      -- 14
select is((select count(*)::int from information_schema.table_privileges
            where table_schema = 'public' and table_name = 'progress_claim_evidence'
              and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'AC-PB-018 no client role may write evidence directly');                                                  -- 15
select is(has_function_privilege('anon', 'public.attach_claim_evidence(uuid,uuid)', 'EXECUTE'), false,
  'AC-PB-018 anon cannot attach evidence');                                                                 -- 16

select * from finish();
rollback;
