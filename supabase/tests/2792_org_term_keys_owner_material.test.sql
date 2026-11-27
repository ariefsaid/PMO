-- 2792_org_term_keys_owner_material.test.sql — the eight owner-material stage terms are nameable (#3010, FR-016).
-- AC-OMT-001: the key table carries the eight; an Admin saves a rename under each in both languages; an unknown key is refused.
-- Mutation note: drop one key from the 2792 insert → the diff and the Admin write go red.
-- Migration under test: 2792_org_term_keys_owner_material.sql.
begin;
create extension if not exists pgtap;
select plan(3);

insert into organizations (id, name) values ('27920000-0000-0000-0000-000000000001', 'OMT Org A');
insert into auth.users (id, email) values ('27920000-0000-0000-0000-0000000000a1', 'omt-a-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27920000-0000-0000-0000-0000000000a1', '27920000-0000-0000-0000-000000000001', 'OMT A Admin', 'omt-a-admin@example.com', 'Admin', 'active');

select is(
  (select string_agg(term_key, ',' order by term_key) from public.org_term_keys where term_key in (
    'stageRequested','stageSetAside','stageReceived','stageIssued','stageReturned','stageTransferred','stageClosing','materialReconciliation')),
  'materialReconciliation,stageClosing,stageIssued,stageReceived,stageRequested,stageReturned,stageSetAside,stageTransferred',
  'AC-OMT-001 the eight added keys are present (offenders are named by the diff)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"27920000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$
  insert into public.org_terminology (term_key, locale, singular, plural)
  select k, l, 'x', 'x' from unnest(array['stageRequested','stageSetAside','stageReceived','stageIssued','stageReturned','stageTransferred','stageClosing','materialReconciliation']) k,
         unnest(array['en','id']) l
$$, 'AC-OMT-001 an Admin saves a rename under every added key in both languages');

select throws_ok($$
  insert into public.org_terminology (term_key, locale, singular, plural) values ('stageNothing', 'en', 'x', 'x')
$$, '23503', null, 'AC-OMT-001 an unknown key is still refused');

select * from finish();
rollback;
