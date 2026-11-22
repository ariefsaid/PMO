-- 1904_org_naming_lookup.test.sql — terminology reach (#2799). AC-TR-008: org_naming / org_term; and the 1905 claim carries org_id.
-- Mutation notes: drop the `p_org` filter from the org_terminology subselects -> the other-org assertions go red; replace
-- `coalesce(n.name, r.name_en)` with `n.name` -> the catalogue-default role assertions go red; grant execute to authenticated
-- -> the client-refusal assertions go red; remove `upd.org_id` from the 1905 final select -> the claim org_id assertion goes red.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('19040000-0000-0000-0000-00000000000a', 'TR Org A'),
  ('19040000-0000-0000-0000-00000000000b', 'TR Org B');
insert into auth.users (id, email) values ('19040000-0000-0000-0000-0000000000a1', 'tr-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('19040000-0000-0000-0000-0000000000a1', '19040000-0000-0000-0000-00000000000a', 'TR A', 'tr-a@example.com', 'Engineer', 'active');

insert into org_terminology (org_id, term_key, locale, singular, plural) values
  ('19040000-0000-0000-0000-00000000000a', 'workOrder', 'en', 'job', 'jobs'),
  ('19040000-0000-0000-0000-00000000000a', 'workOrder', 'id', 'pekerjaan', 'pekerjaan');
insert into org_role_names (org_id, role_key, locale, name) values
  ('19040000-0000-0000-0000-00000000000a', 'storekeeper', 'en', 'Yard Keeper'),
  ('19040000-0000-0000-0000-00000000000a', 'storekeeper', 'id', 'Penjaga Gudang');

-- AC-TR-008: one override and one role rename, both languages
select is(public.org_naming('19040000-0000-0000-0000-00000000000a')#>>'{terms,en,workOrder,singular}', 'job', 'AC-TR-008 the English term override is returned');
select is(public.org_naming('19040000-0000-0000-0000-00000000000a')#>>'{terms,en,workOrder,plural}', 'jobs', 'AC-TR-008 the English plural is returned');
select is(public.org_naming('19040000-0000-0000-0000-00000000000a')#>>'{terms,id,workOrder,singular}', 'pekerjaan', 'AC-TR-008 the Bahasa term override is returned');
select is(public.org_naming('19040000-0000-0000-0000-00000000000a')#>>'{roles,en,storekeeper}', 'Yard Keeper', 'AC-TR-008 the English role rename is returned');
select is(public.org_naming('19040000-0000-0000-0000-00000000000a')#>>'{roles,id,storekeeper}', 'Penjaga Gudang', 'AC-TR-008 the Bahasa role rename is returned');
select is(public.org_naming('19040000-0000-0000-0000-00000000000a')#>>'{roles,en,buyer}',
  (select name_en from built_in_roles where key = 'buyer'), 'AC-TR-008 a role with no rename falls back to the catalogue name');

-- another org sees nothing of it
select is(public.org_naming('19040000-0000-0000-0000-00000000000b')#>'{terms,en}', '{}'::jsonb, 'AC-TR-008 another org has no term overrides');
select is(public.org_naming('19040000-0000-0000-0000-00000000000b')#>>'{roles,en,storekeeper}',
  (select name_en from built_in_roles where key = 'storekeeper'), 'AC-TR-008 another org keeps the catalogue role name');

-- org_term: the single word, null when none
select is(public.org_term('19040000-0000-0000-0000-00000000000a', 'workOrder', 'en', true), 'jobs', 'AC-TR-008 org_term returns the plural');
select is(public.org_term('19040000-0000-0000-0000-00000000000b', 'workOrder', 'en'), null, 'AC-TR-008 org_term is null for an org with no override');

-- service role only
set local role authenticated;
select throws_ok($$select public.org_naming('19040000-0000-0000-0000-00000000000a')$$, '42501', null, 'AC-TR-008 a client cannot call org_naming');
select throws_ok($$select public.org_term('19040000-0000-0000-0000-00000000000a', 'workOrder', 'en')$$, '42501', null, 'AC-TR-008 a client cannot call org_term');
reset role;

-- 1905: the claim returns the row's org_id
insert into email_event_settings (org_id, event_key, enabled) values ('19040000-0000-0000-0000-00000000000a', 'approval_request', true);
select public.notify_workflow_user('19040000-0000-0000-0000-00000000000a', '19040000-0000-0000-0000-0000000000a1', 'Timesheet awaiting your approval', 'body', 'info', 'task', gen_random_uuid(), 'label', null);
select is((select c.org_id from public.claim_email_outbox(5, interval '5 minutes') c limit 1), '19040000-0000-0000-0000-00000000000a'::uuid, 'AC-TR-007 the claimed row carries its org_id');
select is((select count(*)::int from email_outbox where status = 'sending' and attempts = 1), 1, 'the claim keeps its lease contract');

select * from finish();
rollback;
