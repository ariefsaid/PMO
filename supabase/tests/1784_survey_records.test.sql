-- 1784_survey_records.test.sql — survey-cap-record (part C): the survey record, the certified quantity, the seam, and the claim stop that reads it.
-- AC-SCR-001..011 (+ view isolation). Mutation lines (break, the named assertion must go red, restore):
--   confirm_survey: delete the `v_r.recorded_by = auth.uid()` branch ....... 'AC-SCR-003 the recorder cannot confirm their own survey'
--   survey_records_quality_within_surveyed: drop the constraint AND the p_quality_ready > p_surveyed test ..... 'AC-SCR-002 ...'
--   survey_quantity_for_line / view: drop `r.status = 'confirmed'` ......... 'AC-SCR-006 drafts do not count' and 'AC-SCR-007 ...'
--   confirm_survey: delete the superseded_at update ........ 'AC-SCR-005 the corrected record no longer counts'
begin;
create extension if not exists pgtap;
select plan(51);
create function pg_temp.err(q text) returns text language plpgsql as $f$ begin execute q; return null; exception when others then return sqlerrm; end $f$;

insert into organizations(id,name) values ('17840000-0000-0000-0000-000000000001','Svy Org A'),('17840000-0000-0000-0000-000000000002','Svy Org B');
insert into auth.users(id,email) values
 ('17840000-0000-0000-0000-000000000011','svy-admin@example.invalid'),('17840000-0000-0000-0000-000000000012','svy-fin@example.invalid'),
 ('17840000-0000-0000-0000-000000000013','svy-pm@example.invalid'),('17840000-0000-0000-0000-000000000014','svy-pm2@example.invalid'),
 ('17840000-0000-0000-0000-000000000015','svy-eng@example.invalid'),('17840000-0000-0000-0000-000000000016','svy-light@example.invalid'),
 ('17840000-0000-0000-0000-000000000017','svy-b-admin@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status,built_in_role) values
 ('17840000-0000-0000-0000-000000000011','17840000-0000-0000-0000-000000000001','Svy admin','svy-admin@example.invalid','Admin','active',null),
 ('17840000-0000-0000-0000-000000000012','17840000-0000-0000-0000-000000000001','Svy fin','svy-fin@example.invalid','Finance','active',null),
 ('17840000-0000-0000-0000-000000000013','17840000-0000-0000-0000-000000000001','Svy pm','svy-pm@example.invalid','Project Manager','active',null),
 ('17840000-0000-0000-0000-000000000014','17840000-0000-0000-0000-000000000001','Svy pm2','svy-pm2@example.invalid','Project Manager','active',null),
 ('17840000-0000-0000-0000-000000000015','17840000-0000-0000-0000-000000000001','Svy eng','svy-eng@example.invalid','Engineer','active',null),
 ('17840000-0000-0000-0000-000000000016','17840000-0000-0000-0000-000000000001','Svy light','svy-light@example.invalid','Engineer','active','foreman'),
 ('17840000-0000-0000-0000-000000000017','17840000-0000-0000-0000-000000000002','Svy b admin','svy-b-admin@example.invalid','Admin','active',null);
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,currency,project_manager_id) values
 ('17840000-0000-0000-0000-000000000021','17840000-0000-0000-0000-000000000001','Svy Project A','Ongoing Project',1000000,'exclusive',0,'USD','17840000-0000-0000-0000-000000000013'),
 ('17840000-0000-0000-0000-000000000022','17840000-0000-0000-0000-000000000002','Svy Project B','Ongoing Project',1000000,'exclusive',0,'USD',null),
 ('17840000-0000-0000-0000-000000000023','17840000-0000-0000-0000-000000000001','Svy Project A2','Ongoing Project',1000000,'exclusive',0,'USD','17840000-0000-0000-0000-000000000014');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount,currency) values
 ('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','Svy WO1','Issued',50000,'exclusive',0,'USD'),
 ('17840000-0000-0000-0000-000000000032','17840000-0000-0000-0000-000000000002','17840000-0000-0000-0000-000000000022','Svy WOB','Issued',50000,'exclusive',0,'USD'),
 ('17840000-0000-0000-0000-000000000033','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','Svy WO closed','Draft',50000,'exclusive',0,'USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate,earning_basis) values
 ('17840000-0000-0000-0000-000000000041','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SV1','Svy line 1','unit',100,10,'unit_rate'),
 ('17840000-0000-0000-0000-000000000042','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SV2','Svy line 2','unit',100,10,'unit_rate'),
 ('17840000-0000-0000-0000-000000000043','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SV3','Svy lump','lot',1,1000,'lump_sum'),
 ('17840000-0000-0000-0000-000000000044','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SV4','Svy unallocated','unit',100,10,'unit_rate'),
 ('17840000-0000-0000-0000-000000000045','17840000-0000-0000-0000-000000000002','17840000-0000-0000-0000-000000000022','SV5','Svy B line','unit',100,10,'unit_rate');
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041',20),
 ('17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000042',20),
 ('17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000043',1),
 ('17840000-0000-0000-0000-000000000002','17840000-0000-0000-0000-000000000032','17840000-0000-0000-0000-000000000045',20);
insert into project_documents(id,org_id,project_id,code,category,title,status,author_id,file_path) values
 ('17840000-0000-0000-0000-000000000051','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SD-1','Report','Svy quality doc','Issued','17840000-0000-0000-0000-000000000011','svy/a.pdf'),
 ('17840000-0000-0000-0000-000000000052','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000023','SD-2','Report','Svy other project doc','Issued','17840000-0000-0000-0000-000000000011','svy/b.pdf'),
 ('17840000-0000-0000-0000-000000000053','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SD-3','Report','Svy draft doc','Draft','17840000-0000-0000-0000-000000000011','svy/c.pdf'),
 ('17840000-0000-0000-0000-000000000054','17840000-0000-0000-0000-000000000001','17840000-0000-0000-0000-000000000021','SD-4','Report','Svy fileless doc','Issued','17840000-0000-0000-0000-000000000011',null);

create temp table ids(k text, v uuid);
grant all on ids to authenticated;
set local role authenticated;
-- PM of the project records
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000013","role":"authenticated"}';
insert into ids select 's1', record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-10',4,3,
  '[{"name":"Site supervisor","company":"Customer side","role":"Supervisor"},{"name":"Typed Person"}]'::jsonb);
select is((select count(*)::int from survey_participants where record_id=(select v from ids where k='s1')), 2, 'AC-SCR-001 a draft is recorded with two participants, one a typed name without an account');
select is((select org_id from survey_records where id=(select v from ids where k='s1')), '17840000-0000-0000-0000-000000000001'::uuid, 'AC-SCR-001 org_id is stamped by the database');
select is((select status from survey_records where id=(select v from ids where k='s1')), 'draft', 'AC-SCR-001 it starts as a draft');
select throws_ok($q$select survey_quantity_for_line('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041')$q$, '42501', null, 'AC-SCR-006 the seam is not callable by the signed-in role');
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-10',4,5,'[{"name":"X"}]'::jsonb)$q$), 'SVY_QUALITY_OVER:%', 'AC-SCR-002 quality-ready above surveyed is refused');
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-10',4,1,'[]'::jsonb)$q$), 'SVY_NEEDS_PARTICIPANT:%', 'AC-SCR-001 who took part is required');
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000044','2026-11-10',4,1,'[{"name":"X"}]'::jsonb)$q$), 'SVY_NOT_ALLOCATED:%', 'AC-SCR-001 a line not allocated to the work order is refused');
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000043','2026-11-10',1,1,'[{"name":"X"}]'::jsonb)$q$), 'SVY_LUMP_SUM:%', 'AC-SCR-001 a lump-sum line is refused');
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000033','17840000-0000-0000-0000-000000000041','2026-11-10',1,1,'[{"name":"X"}]'::jsonb)$q$), 'SVY_NOT_ISSUED:%', 'AC-SCR-001 only an issued work order takes a survey');
select throws_ok($q$update survey_records set surveyed_quantity = 99$q$, '42501', null, 'AC-SCR-004 no direct write grant exists for the signed-in role');
select like(pg_temp.err($q$select confirm_survey((select v from ids where k='s1'))$q$), 'SVY_CONFIRM_ROLE:%', 'AC-SCR-003 a project manager cannot confirm');
-- documents
select like(pg_temp.err($q$select attach_survey_document((select v from ids where k='s1'),'17840000-0000-0000-0000-000000000052')$q$), 'SVY_DOCUMENT_INVALID:%', 'AC-SCR-011 another project''s document is refused');
select like(pg_temp.err($q$select attach_survey_document((select v from ids where k='s1'),'17840000-0000-0000-0000-000000000053')$q$), 'SVY_DOCUMENT_INVALID:%', 'AC-SCR-011 a draft-status document is refused');
select like(pg_temp.err($q$select attach_survey_document((select v from ids where k='s1'),'17840000-0000-0000-0000-000000000054')$q$), 'SVY_DOCUMENT_INVALID:%', 'AC-SCR-011 a document without a file is refused');
-- quality-ready needs a document at confirm
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000012","role":"authenticated"}';
select like(pg_temp.err($q$select confirm_survey((select v from ids where k='s1'))$q$), 'SVY_QUALITY_NEEDS_DOCUMENT:%', 'AC-SCR-016 a quality-ready quantity needs an attached document to confirm');
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($q$select attach_survey_document((select v from ids where k='s1'),'17840000-0000-0000-0000-000000000051')$q$, 'AC-SCR-011 an issued document with a file is accepted');
-- who may record / confirm
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000014","role":"authenticated"}';
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-10',1,0,'[{"name":"X"}]'::jsonb)$q$), 'SVY_NOT_PERMITTED:%', 'AC-SCR-010 a manager of another project cannot record');
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000015","role":"authenticated"}';
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-10',1,0,'[{"name":"X"}]'::jsonb)$q$), 'SVY_NOT_PERMITTED:%', 'AC-SCR-010 an engineer cannot record');
select like(pg_temp.err($q$select confirm_survey((select v from ids where k='s1'))$q$), 'SVY_CONFIRM_ROLE:%', 'AC-SCR-010 an engineer cannot confirm');
-- SoD: Finance records, then cannot confirm it; the Admin can
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000012","role":"authenticated"}';
insert into ids select 's2', record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000042','2026-11-11',3,0,'[{"name":"Finance Person"}]'::jsonb);
select like(pg_temp.err($q$select confirm_survey((select v from ids where k='s2'))$q$), 'SVY_RECORDER_CONFIRMS:%', 'AC-SCR-003 the recorder cannot confirm their own survey');
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($q$select confirm_survey((select v from ids where k='s2'))$q$, 'AC-SCR-003 another Admin confirms');
select is((select confirm_basis from survey_records where id=(select v from ids where k='s2')), 'standard', 'AC-SCR-003 basis standard');
select lives_ok($q$select confirm_survey((select v from ids where k='s1'))$q$, 'AC-SCR-003 the Admin confirms the quality-ready survey (document attached)');
-- immutability
select like(pg_temp.err($q$select attach_survey_document((select v from ids where k='s1'),'17840000-0000-0000-0000-000000000051')$q$), 'SVY_FROZEN:%', 'AC-SCR-004 a confirmed survey takes no more documents');
select like(pg_temp.err($q$select archive_survey_draft((select v from ids where k='s1'))$q$), 'SVY_FROZEN:%', 'AC-SCR-004 a confirmed survey cannot be discarded');
reset role;
select throws_ok($q$update survey_records set surveyed_quantity = 9 where id=(select v from ids where k='s1')$q$, '42501', null, 'AC-SCR-004 not even the owner can change a confirmed survey''s figures');
select throws_ok($q$delete from survey_records where id=(select v from ids where k='s1')$q$, '42501', null, 'AC-SCR-004 a survey record cannot be deleted');
select throws_ok($q$update survey_participants set name='Y' where record_id=(select v from ids where k='s1')$q$, '42501', null, 'AC-SCR-004 participants of a confirmed survey are frozen');
select throws_ok($q$delete from survey_record_documents where record_id=(select v from ids where k='s1')$q$, '42501', null, 'AC-SCR-004 documents of a confirmed survey are frozen');
-- AC-SCR-006 certified sum
select is(survey_quantity_for_line('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041'), 4::numeric, 'AC-SCR-006 one confirmed 4 = certified 4');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000013","role":"authenticated"}';
insert into ids select 's3', record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-12',3,0,'[{"name":"P"}]'::jsonb);
select is((select certified_quantity from survey_certified_lines where boq_item_id='17840000-0000-0000-0000-000000000041'), 4::numeric, 'AC-SCR-006 a draft does not count');
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($q$select confirm_survey((select v from ids where k='s3'))$q$, 'AC-SCR-006 the second survey is confirmed');
select ok((select certified_quantity = 7 and quality_ready_quantity = 3 from survey_certified_lines where boq_item_id='17840000-0000-0000-0000-000000000041'), 'AC-SCR-006 two confirmed (4 and 3) sum to certified 7, quality-ready 3');
-- AC-SCR-005 correction
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000013","role":"authenticated"}';
insert into ids select 's4', record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-13',2,0,'[{"name":"P"}]'::jsonb,(select v from ids where k='s3'));
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-13',1,0,'[{"name":"P"}]'::jsonb,(select v from ids where k='s3'))$q$), 'SVY_ALREADY_CORRECTED:%', 'AC-SCR-005 a second open correction of the same survey is refused');
select like(pg_temp.err($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000042','2026-11-13',1,0,'[{"name":"P"}]'::jsonb,(select v from ids where k='s3'))$q$), 'SVY_NOT_CORRECTABLE:%', 'AC-SCR-005 a correction must name a survey of the same line');
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($q$select confirm_survey((select v from ids where k='s4'))$q$, 'AC-SCR-005 the correction is confirmed');
select ok((select certified_quantity = 6 from survey_certified_lines where boq_item_id='17840000-0000-0000-0000-000000000041'), 'AC-SCR-005 the corrected record no longer counts: 4 + 2 = 6');
select ok((select superseded_at is not null from survey_records where id=(select v from ids where k='s3')), 'AC-SCR-005 the old record keeps its history and is marked superseded');
-- discarded draft does not count and frees the correction slot
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000013","role":"authenticated"}';
insert into ids select 's5', record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-14',50,0,'[{"name":"P"}]'::jsonb);
select lives_ok($q$select archive_survey_draft((select v from ids where k='s5'))$q$, 'AC-SCR-006 the recorder discards their draft');
select ok((select certified_quantity = 6 from survey_certified_lines where boq_item_id='17840000-0000-0000-0000-000000000041'), 'AC-SCR-006 an archived draft does not count');

-- AC-SCR-007 the seam feeds part B's stop: org on block, certified 6 on line 1 (ordered 20)
reset role;
update organizations set claim_quantity_over_cap='block' where id='17840000-0000-0000-0000-000000000001';
select is(survey_quantity_for_line('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041'), 6::numeric, 'AC-SCR-007 the seam returns the certified quantity');
select ok((select basis='surveyed' and ceiling=6 from work_order_line_headroom('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041')), 'AC-SCR-007 the headroom ceiling is on the surveyed basis');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000012","role":"authenticated"}';
select like(pg_temp.err($q$select create_progress_claim('17840000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17840000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17840000-0000-0000-0000-000000000041","quantity":6.001}]'::jsonb)$q$), 'CLM_OVER_CAP:%surveyed%', 'AC-SCR-007 on block a claim over the surveyed quantity is refused');
select lives_ok($q$select create_progress_claim('17840000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17840000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17840000-0000-0000-0000-000000000041","quantity":6}]'::jsonb)$q$, 'AC-SCR-007 a claim at the surveyed quantity is created');
reset role;
-- AC-SCR-008 another organisation
set local role authenticated;
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000017","role":"authenticated"}';
select is((select count(*)::int from survey_records) + (select count(*)::int from survey_participants) + (select count(*)::int from survey_record_documents) + (select count(*)::int from survey_certified_lines), 0, 'AC-SCR-008 another organisation sees no record, participant, document or certified line');
select like(pg_temp.err($q$select confirm_survey((select v from ids where k='s2'))$q$), 'SVY_NOT_FOUND:%', 'AC-SCR-008 another organisation cannot confirm a record of this one');
-- AC-SCR-009 light account
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000016","role":"authenticated"}';
select is((select count(*)::int from survey_records) + (select count(*)::int from survey_certified_lines), 0, 'AC-SCR-009 a light account sees no survey record or certified line');
select throws_ok($q$select record_survey('17840000-0000-0000-0000-000000000031','17840000-0000-0000-0000-000000000041','2026-11-10',1,0,'[{"name":"X"}]'::jsonb)$q$, null, null, 'AC-SCR-009 a light account cannot record');
select throws_ok($q$select confirm_survey((select v from ids where k='s2'))$q$, null, null, 'AC-SCR-009 a light account cannot confirm');
reset role;
-- sole operator: only one active member in a fresh organisation may confirm their own record
insert into organizations(id,name) values ('17840000-0000-0000-0000-000000000003','Svy Org C');
insert into auth.users(id,email) values ('17840000-0000-0000-0000-000000000018','svy-c-admin@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('17840000-0000-0000-0000-000000000018','17840000-0000-0000-0000-000000000003','Svy c admin','svy-c-admin@example.invalid','Admin','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,currency) values ('17840000-0000-0000-0000-000000000024','17840000-0000-0000-0000-000000000003','Svy Project C','Ongoing Project',1000,'exclusive',0,'USD');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount,currency) values ('17840000-0000-0000-0000-000000000034','17840000-0000-0000-0000-000000000003','17840000-0000-0000-0000-000000000024','Svy WOC','Issued',500,'exclusive',0,'USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate,earning_basis) values ('17840000-0000-0000-0000-000000000046','17840000-0000-0000-0000-000000000003','17840000-0000-0000-0000-000000000024','SV6','Svy C line','unit',10,10,'unit_rate');
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values ('17840000-0000-0000-0000-000000000003','17840000-0000-0000-0000-000000000034','17840000-0000-0000-0000-000000000046',10);
set local role authenticated;
set local request.jwt.claims = '{"sub":"17840000-0000-0000-0000-000000000018","role":"authenticated"}';
insert into ids select 's6', record_survey('17840000-0000-0000-0000-000000000034','17840000-0000-0000-0000-000000000046','2026-11-10',5,0,'[{"name":"Solo"}]'::jsonb);
select lives_ok($q$select confirm_survey((select v from ids where k='s6'))$q$, 'AC-SCR-003 the only active member may confirm their own survey');
reset role;
select is((select confirm_basis from survey_records where id=(select v from ids where k='s6')), 'sole_operator', 'AC-SCR-003 and the basis says so');
select * from finish();
rollback;
