-- preference_validation.test.sql — proof for 0219_preference_value_validation.sql (#711, follow-up to #684).
--
-- The locale / number-format / timezone preference columns (0198) were free text. The app falls back
-- safely from an unusable stored value, but any server-side reader (SQL tz conversion, an edge fn,
-- email rendering) would not, and an unusable value could be re-saved unchanged. 0219 refuses values
-- outside the supported set, on BOTH profiles (self-service write, a trust boundary) and organizations.
--
--   locale         en | id
--   number locale  en-US | id-ID | en | id      (bare language tag is a legal Intl number locale, 0198)
--   timezone       an exact pg_timezone_names name (a CHECK cannot query the catalogue → trigger)
--
-- ⚑ Profile cases run as a live `authenticated` caller (the real trust boundary; also proves the
-- trigger can read pg_timezone_names without elevated rights). Organizations have NO client write
-- path, so those cases run as the migration role.
-- Fixtures live inside begin/rollback; no schema change.
--
-- MUTATION-CHECKED: dropping the two CHECK constraints reddens the locale/number cases; dropping the
-- two triggers reddens the timezone cases (observations in the build report).
begin;
select plan(30);

insert into organizations (id, name, default_currency, default_locale, default_number_locale, default_timezone)
values ('07110000-0000-0000-0000-000000000001', 'PV Org', 'IDR', 'id', null, 'Asia/Jakarta');
insert into auth.users (id, email) values ('07110000-0000-0000-0000-0000000000a1','pv-self@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07110000-0000-0000-0000-0000000000a1','07110000-0000-0000-0000-000000000001','PV Self','pv-self@example.com','Engineer','active');
insert into auth.users (id, email) values
  ('07110000-0000-0000-0000-0000000000c1','pv-operator@example.com'),
  ('07110000-0000-0000-0000-0000000000c2','pv-new-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07110000-0000-0000-0000-0000000000c1','07110000-0000-0000-0000-000000000001','PV Operator','pv-operator@example.com','Admin','active');
insert into platform_operators (user_id) values ('07110000-0000-0000-0000-0000000000c1');

-- ═══ profiles — as the row owner ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"07110000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$ update profiles set locale='fr' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: an unsupported locale tag is rejected');
select throws_ok($$ update profiles set locale=' en' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: a locale with surrounding whitespace is rejected');
select throws_ok($$ update profiles set locale='en_US' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: a malformed locale tag is rejected');
select throws_ok($$ update profiles set locale='' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: an empty locale is rejected (reset is NULL, never blank)');
select throws_ok($$ update profiles set number_locale='de-DE' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: an unsupported number-format tag is rejected');
select throws_ok($$ update profiles set number_locale='en-US ' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: a number-format tag with trailing whitespace is rejected');
select throws_ok(format($$ update profiles set number_locale=%L where id='07110000-0000-0000-0000-0000000000a1' $$, repeat('x', 5000)),
  '23514', null, '#711 profile: an over-long number-format value is rejected');
select throws_ok($$ update profiles set timezone='Mars/Olympus_Mons' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', 'invalid_timezone', '#711 profile: an unknown timezone is rejected with a generic message that does not echo the value');
select throws_ok($$ update profiles set timezone='asia/jakarta' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', 'invalid_timezone', '#711 profile: a wrong-case zone name is rejected (exact catalogue name only)');
select throws_ok($$ update profiles set timezone=' UTC' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', 'invalid_timezone', '#711 profile: a timezone with surrounding whitespace is rejected');
select throws_ok($$ update profiles set timezone='' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', 'invalid_timezone', '#711 profile: an empty timezone is rejected');
select throws_ok($$ update profiles set timezone='EST5EDT-not-a-zone' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', 'invalid_timezone', '#711 profile: a POSIX-looking non-catalogue string is rejected');

-- Nothing bad persisted through any of the refused writes.
select is((select count(*)::int from profiles where id='07110000-0000-0000-0000-0000000000a1'
             and locale is null and number_locale is null and timezone is null), 1,
  '#711 profile: every refused write left the three preference columns untouched (all still NULL)');

-- Valid values still save (regression: the validation must not break the supported journeys).
select lives_ok($$ update profiles set locale='id', number_locale='id-ID', timezone='Asia/Jakarta'
                    where id='07110000-0000-0000-0000-0000000000a1' $$,
  '#711 profile: the supported Indonesian set saves');
select lives_ok($$ update profiles set locale='en', number_locale='en-US', timezone='UTC'
                    where id='07110000-0000-0000-0000-0000000000a1' $$,
  '#711 profile: the supported English set (and UTC) saves');
select is((select locale || '|' || number_locale || '|' || timezone from profiles
            where id='07110000-0000-0000-0000-0000000000a1'), 'en|en-US|UTC', '#711 profile: the valid write persisted');
select lives_ok($$ update profiles set locale=null, number_locale=null, timezone=null
                    where id='07110000-0000-0000-0000-0000000000a1' $$,
  '#711 profile: reset-to-org-default (all NULL) still saves (FR-L10N-004)');
select lives_ok($$ update profiles set full_name='PV Self 2' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '#711 profile: an unrelated edit is unaffected');

-- ═══ organizations — no client write path; the migration role stands in for the operator RPC ═══
reset role;
select throws_ok($$ update organizations set default_locale='fr' where id='07110000-0000-0000-0000-000000000001' $$,
  '23514', null, '#711 org: an unsupported default_locale is rejected');
select throws_ok($$ update organizations set default_number_locale='de-DE' where id='07110000-0000-0000-0000-000000000001' $$,
  '23514', null, '#711 org: an unsupported default_number_locale is rejected');
select throws_ok($$ update organizations set default_number_locale='' where id='07110000-0000-0000-0000-000000000001' $$,
  '23514', null, '#711 org: a blank default_number_locale is rejected (NULL = derive)');
select throws_ok($$ update organizations set default_timezone='Nowhere/Land' where id='07110000-0000-0000-0000-000000000001' $$,
  '23514', 'invalid_timezone', '#711 org: an unknown default_timezone is rejected');
select throws_ok($$ insert into organizations (name, default_currency, default_locale, default_number_locale, default_timezone)
                    values ('PV Bad Org', 'IDR', 'id', null, 'Asia/Jakarta ') $$,
  '23514', 'invalid_timezone', '#711 org: an INSERT with a padded timezone is rejected too (not only updates)');
select lives_ok($$ update organizations set default_locale='en', default_number_locale='en-US', default_timezone='UTC'
                    where id='07110000-0000-0000-0000-000000000001' $$,
  '#711 org: the supported values save');
select lives_ok($$ update organizations set default_number_locale=null where id='07110000-0000-0000-0000-000000000001' $$,
  '#711 org: NULL default_number_locale (derive) still saves');
select is((select default_locale || '|' || default_timezone from organizations
            where id='07110000-0000-0000-0000-000000000001'), 'en|UTC', '#711 org: the valid write persisted');

-- ═══ review follow-up: the real org-creation path, profile INSERT, and bare tags on a profile ═══
reset role;
select throws_ok($$ insert into profiles (id, org_id, full_name, email, role, status, timezone)
  values ('07110000-0000-0000-0000-0000000000c2','07110000-0000-0000-0000-000000000001','PV New','pv-new-admin@example.com','Engineer','active','Mars/Base') $$,
  '23514', 'invalid_timezone', '#711 profile INSERT: an unknown timezone is rejected');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update profiles set number_locale='en' where id='07110000-0000-0000-0000-0000000000a1' $$,
  '23514', null, '#711 profile: a bare language tag is not a personal number format (org-level derive only)');
set local request.jwt.claims = '{"sub":"07110000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$ select operator_create_org('PV Org FR','07110000-0000-0000-0000-0000000000c2','PV New','IDR','fr',null,'Asia/Jakarta') $$,
  '23514', null, '#711 operator_create_org: an unsupported default locale is rejected on the real org-creation path');
select throws_ok($$ select operator_create_org('PV Org TZ','07110000-0000-0000-0000-0000000000c2','PV New','IDR','id',null,'Mars/Base') $$,
  '23514', 'invalid_timezone', '#711 operator_create_org: an unknown default timezone is rejected on the real org-creation path');
reset role;

select finish();
rollback;
