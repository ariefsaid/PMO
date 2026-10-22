begin;
select plan(9);

insert into organizations (id,name,default_currency) values
 ('03420000-0000-0000-0000-00000000000a','Evidence A','IDR'),
 ('03420000-0000-0000-0000-00000000000b','Evidence B','IDR');
insert into auth.users(id,email) values
 ('03420000-0000-0000-0000-0000000000a1','evidence-pm@example.com'),
 ('03420000-0000-0000-0000-0000000000b1','evidence-pm-b@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03420000-0000-0000-0000-0000000000a1','03420000-0000-0000-0000-00000000000a','Evidence PM','evidence-pm@example.com','Project Manager','active'),
 ('03420000-0000-0000-0000-0000000000b1','03420000-0000-0000-0000-00000000000b','Evidence PM B','evidence-pm-b@example.com','Project Manager','active');
insert into projects(id,org_id,name,status) values
 ('03420000-0000-0000-0000-000000000101','03420000-0000-0000-0000-00000000000a','Project A','Ongoing Project'),
 ('03420000-0000-0000-0000-000000000102','03420000-0000-0000-0000-00000000000a','Project A2','Ongoing Project'),
 ('03420000-0000-0000-0000-000000000201','03420000-0000-0000-0000-00000000000b','Project B','Ongoing Project');
insert into project_documents(id,org_id,project_id,category,title,author_id,status) values
 ('03420000-0000-0000-0000-000000000301','03420000-0000-0000-0000-00000000000a','03420000-0000-0000-0000-000000000101','Drawing','Doc A','03420000-0000-0000-0000-0000000000a1','Draft'),
 ('03420000-0000-0000-0000-000000000302','03420000-0000-0000-0000-00000000000a','03420000-0000-0000-0000-000000000101','Drawing','Doc B','03420000-0000-0000-0000-0000000000a1','Draft'),
 ('03420000-0000-0000-0000-000000000303','03420000-0000-0000-0000-00000000000b','03420000-0000-0000-0000-000000000201','Drawing','Foreign parent','03420000-0000-0000-0000-0000000000b1','Issued');

insert into expense_claims(id,org_id,kind,claimant_id,title,amount,status) values
 ('03420000-0000-0000-0000-000000000401','03420000-0000-0000-0000-00000000000a','claim','03420000-0000-0000-0000-0000000000a1','Claim A',0,'Draft'),
 ('03420000-0000-0000-0000-000000000402','03420000-0000-0000-0000-00000000000a','claim','03420000-0000-0000-0000-0000000000a1','Claim B',0,'Draft');

select throws_ok($$update project_documents set file_path='03420000-0000-0000-0000-00000000000a/03420000-0000-0000-0000-000000000101/03420000-0000-0000-0000-000000000302/other.pdf' where id='03420000-0000-0000-0000-000000000301'$$,
 '23514', 'Document storage key does not match its record.', 'AC-EVID-001 document storage key matches row identity');
select lives_ok($$update project_documents set file_path='03420000-0000-0000-0000-00000000000a/03420000-0000-0000-0000-000000000101/03420000-0000-0000-0000-000000000301/file.pdf' where id='03420000-0000-0000-0000-000000000301'$$,
 'AC-EVID-001 canonical document storage key remains accepted');
select throws_ok($$insert into project_documents(id,org_id,project_id,category,title,author_id,file_path) values ('03420000-0000-0000-0000-000000000305','03420000-0000-0000-0000-00000000000a','03420000-0000-0000-0000-000000000101','Drawing','Document storage identity','03420000-0000-0000-0000-0000000000a1','03420000-0000-0000-0000-00000000000a/03420000-0000-0000-0000-000000000101/03420000-0000-0000-0000-000000000302/other.pdf')$$,
 '23514', 'Document storage key does not match its record.', 'AC-EVID-001 insert requires a canonical document storage key');
select throws_ok($$insert into expense_claim_files(claim_id,file_path) values ('03420000-0000-0000-0000-000000000401','03420000-0000-0000-0000-00000000000a/03420000-0000-0000-0000-000000000402/random-file/receipt.pdf')$$,
 '23514', 'Expense receipt storage key does not match its claim.', 'AC-EVID-002 receipt key binds org and claim, not random file segment');
select lives_ok($$insert into expense_claim_files(claim_id,file_path) values ('03420000-0000-0000-0000-000000000401','03420000-0000-0000-0000-00000000000a/03420000-0000-0000-0000-000000000401/random-file/receipt.pdf')$$,
 'AC-EVID-002 canonical receipt key accepts independent file segment');
select throws_ok($$update expense_claim_files set file_path='03420000-0000-0000-0000-00000000000a/03420000-0000-0000-0000-000000000402/random-file/receipt.pdf' where claim_id='03420000-0000-0000-0000-000000000401'$$,
 '23514', 'Expense receipt storage key does not match its claim.', 'AC-EVID-002 updates retain claim-bound receipt keys');
select throws_ok($$insert into project_documents(id,org_id,project_id,category,title,author_id,parent_document_id) values ('03420000-0000-0000-0000-000000000304','03420000-0000-0000-0000-00000000000a','03420000-0000-0000-0000-000000000101','Drawing','Foreign lineage','03420000-0000-0000-0000-0000000000a1','03420000-0000-0000-0000-000000000303')$$,
 '23503', null, 'AC-EVID-003 revision parent belongs to the same org and project');
select throws_ok($$update project_documents set parent_document_id='03420000-0000-0000-0000-000000000303' where id='03420000-0000-0000-0000-000000000301'$$,
 '23503', null, 'AC-EVID-003 existing document cannot acquire foreign lineage');
set local role authenticated;
set local request.jwt.claims='{"sub":"03420000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.transition_document_status('03420000-0000-0000-0000-000000000301','Issued')$$,
 'AC-EVID-004 authenticated role can execute a legal document transition');
reset role;
select finish();
rollback;
