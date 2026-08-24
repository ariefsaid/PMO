-- locale_preferences.test.sql — proof for 0198_locale_preference_columns.sql (#468, FR-L10N-001..006).
--
-- AC ids owned here:
--   AC-L10N-005  a non-Admin user writing ANOTHER profile's locale is RLS-denied; and the
--               restrictive policy extends "no one else's" to Admin/Executive writers too.
--   (companions, owned elsewhere: AC-L10N-003 reset-writes-NULL is owned by the DAL unit test
--    src/lib/db/preferences.test.ts; AC-L10N-004 by operator_create_org.test.sql)
--
-- ⚑ pgTAP runs as the superuser migration role, which BYPASSES RLS and grants. Authz assertions
-- therefore run under `set local role authenticated` + request.jwt.claims (the operator_create_org
-- idiom). Catalog assertions use has_column_privilege / has_table_privilege.
--
-- MUTATION-CHECKED (see the plan's battery M1-M4; observations in the build report):
--   M2 (drop the §3 re-grant)     reddens the own-write lives_ok + the three column-privilege oks;
--   M3 (drop the §4 policy)       reddens the ADMIN-writes-another's-locale throws_ok;
--   M4 (loosen profiles_update_self) reddens the NON-Admin-writes-another's-locale throws_ok.
-- No schema changes (fixtures inside begin/rollback); re-run is a no-op.
begin;
select plan(14);

-- ── Fixtures (0468… ids, #468). All inserted before any jwt claims are set.
insert into organizations (id, name, default_currency, default_locale, default_number_locale, default_timezone)
values ('04680000-0000-0000-0000-000000000001', 'AC-L10N Home Org', 'IDR', 'id', null, 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('04680000-0000-0000-0000-0000000000a1','l10n-self@example.com'),
  ('04680000-0000-0000-0000-0000000000a2','l10n-peer@example.com'),
  ('04680000-0000-0000-0000-0000000000a3','l10n-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04680000-0000-0000-0000-0000000000a1','04680000-0000-0000-0000-000000000001','Self','l10n-self@example.com','Engineer','active'),
  ('04680000-0000-0000-0000-0000000000a2','04680000-0000-0000-0000-000000000001','Peer','l10n-peer@example.com','Engineer','active'),
  ('04680000-0000-0000-0000-0000000000a3','04680000-0000-0000-0000-000000000001','Admin','l10n-admin@example.com','Admin','active');

-- ═══ FR-L10N-001/002 — the columns exist with the ruled shapes (shape companions). ═══
select is((select column_default from information_schema.columns
            where table_schema='public' and table_name='organizations' and column_name='default_locale'),
          '''en''::text', 'FR-L10N-001 organizations.default_locale defaults to en');
select is((select is_nullable from information_schema.columns
            where table_schema='public' and table_name='organizations' and column_name='default_number_locale'),
          'YES', 'FR-L10N-001 organizations.default_number_locale is nullable (NULL = derive)');
select is((select is_nullable from information_schema.columns
            where table_schema='public' and table_name='profiles' and column_name='locale'),
          'YES', 'FR-L10N-002 profiles.locale is nullable (NULL = inherit org)');

-- ═══ FR-L10N-006 — the grant surface. The 0182/0184 allow-list is re-declared + extended. ═══
select ok(has_column_privilege('authenticated','public.profiles','locale','UPDATE'),
  'FR-L10N-006 authenticated may UPDATE profiles.locale (0198 allow-list)');
select ok(has_column_privilege('authenticated','public.profiles','number_locale','UPDATE'),
  'FR-L10N-006 authenticated may UPDATE profiles.number_locale');
select ok(has_column_privilege('authenticated','public.profiles','timezone','UPDATE'),
  'FR-L10N-006 authenticated may UPDATE profiles.timezone');
select ok(has_column_privilege('authenticated','public.profiles','role','UPDATE')
      and has_column_privilege('authenticated','public.profiles','full_name','UPDATE'),
  'FR-L10N-006 regression: the 0184 seven-column allow-list survived the re-grant');
select ok(not has_table_privilege('authenticated','public.organizations','UPDATE'),
  'FR-L10N-006 organizations has NO client write path (default_currency posture, org defaults are operator-set only)');

-- ═══ AC-L10N-005 — the write contract, as a live authenticated caller. ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"04680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update profiles set locale='en', number_locale='en-US', timezone='UTC'
      where id = '04680000-0000-0000-0000-0000000000a1' $$,
  'AC-L10N-005 companion: a user CAN write their OWN three preference columns (FR-L10N-006)');
select is((select locale from profiles where id='04680000-0000-0000-0000-0000000000a1'), 'en',
  'AC-L10N-005 companion: the own-write persisted');

-- ⚑ A PEER's write is denied at the USING phase, and a USING-phase denial is a SILENT 0-ROW UPDATE —
-- Postgres raises 42501 only for a WITH CHECK violation. `throws_ok` here would assert the wrong
-- mechanism and fail against a policy set that is behaving correctly; the Admin case below DOES
-- throw, because the restrictive policy catches it in WITH CHECK. The oracle is therefore "nothing
-- happened": zero rows touched AND the peer's value unchanged. Both halves matter — a rowcount alone
-- would pass against a policy that admitted the write and happened to store the same value.
do $$
declare v_rows int;
begin
  update profiles set locale='en' where id = '04680000-0000-0000-0000-0000000000a2';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'a peer''s locale write touched % row(s)', v_rows;
  end if;
end $$;
select pass('AC-L10N-005 a non-Admin writing another profile''s locale touches ZERO rows — the peer '
  'is invisible to them at the USING phase, which is a silent no-op and not a 42501');
select is(
  (select locale from profiles where id = '04680000-0000-0000-0000-0000000000a2'),
  null,
  'AC-L10N-005 …and the peer''s locale is genuinely unchanged — the rowcount alone would pass against '
  'a policy that admitted the write and happened to store the same value');

set local request.jwt.claims = '{"sub":"04680000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ update profiles set locale='en' where id = '04680000-0000-0000-0000-0000000000a2' $$,
  '42501', null,
  'AC-L10N-005 an ADMIN writing another profile''s locale is denied too (restrictive policy — FR-L10N-006 ''no one else''s'')');
select lives_ok(
  $$ update profiles set full_name='Admin Renamed'
      where id = '04680000-0000-0000-0000-0000000000a2' $$,
  'AC-L10N-005 companion: the 0179 hierarchy policy still lets an Admin edit others'' NON-preference columns (0198 narrows only locale/number_locale/timezone)');

reset role;
select finish();
rollback;
