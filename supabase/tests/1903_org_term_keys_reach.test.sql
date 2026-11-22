-- 1903_org_term_keys_reach.test.sql — the 23 general terms are nameable (#2799).
-- AC-TR-001: the key table carries the 16 of 1491 plus the 23 of 1903; an Admin saves a rename under every added key
--   in both languages; the front-end registry's key set is the table's (the Vitest registry test reads the same two
--   migrations); an unknown key is still refused; the key table stays unreadable by clients.
-- Mutation notes: drop one key from the 1903 insert → the count and the diff go red (1/2); grant select on
--   org_term_keys to authenticated → the client-read refusal goes red (5).
-- Migration under test: 1903_org_term_keys_reach.sql.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name) values ('19030000-0000-0000-0000-000000000001', 'OTR Org A');
insert into auth.users (id, email) values ('19030000-0000-0000-0000-0000000000a1', 'otr-a-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('19030000-0000-0000-0000-0000000000a1', '19030000-0000-0000-0000-000000000001', 'OTR A Admin', 'otr-a-admin@example.com', 'Admin', 'active');

select is((select count(*)::int from public.org_term_keys), 39, 'AC-TR-001 the key table carries the 39 nameable terms');
select is(
  (select string_agg(term_key, ',' order by term_key) from public.org_term_keys where term_key in (
    'serviceRequest','purchaseOrder','dailySiteReport','surveyQuantity','quantityChangeRequest','workOrderTransfer',
    'billingPlan','billingStep','handoverCertificate','stockTransfer','stockReceipt','stockReturn','reservation',
    'crew','roster','issue','checkpoint','milestone','dailyTarget','rootCause','safetyRecordType',
    'candidateWorkOrder','closeOut')),
  'billingPlan,billingStep,candidateWorkOrder,checkpoint,closeOut,crew,dailySiteReport,dailyTarget,handoverCertificate,issue,milestone,purchaseOrder,quantityChangeRequest,reservation,rootCause,roster,safetyRecordType,serviceRequest,stockReceipt,stockReturn,stockTransfer,surveyQuantity,workOrderTransfer',
  'AC-TR-001 the 23 added keys are present (offenders are named by the diff)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"19030000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$
  insert into org_terminology (term_key, locale, singular, plural)
  select k, l, 'X ' || k, 'Xs ' || k
    from unnest(array[
      'serviceRequest','purchaseOrder','dailySiteReport','surveyQuantity','quantityChangeRequest','workOrderTransfer',
      'billingPlan','billingStep','handoverCertificate','stockTransfer','stockReceipt','stockReturn','reservation',
      'crew','roster','issue','checkpoint','milestone','dailyTarget','rootCause','safetyRecordType',
      'candidateWorkOrder','closeOut']) as k, unnest(array['en','id']) as l
$$, 'AC-TR-001 an Admin saves a rename under every added key in both languages');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('notATerm','en','X','Xs')$$,
  '23503', null, 'AC-TR-001 a key outside the table is still refused at the constraint layer');
select throws_ok($$select * from public.org_term_keys$$, '42501', null, 'AC-TR-001 the key table is code-owned: a client cannot read it');

reset role;
set local request.jwt.claims = '';
select is((select count(*)::int from public.org_terminology where org_id = '19030000-0000-0000-0000-000000000001'), 46,
  'AC-TR-001 (control) 23 keys x 2 languages were saved, one row each');

select * from finish();
rollback;
