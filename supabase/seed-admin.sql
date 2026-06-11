-- seed-admin.sql — minimal "demo admin only" bootstrap for the CLOUD demo/staging env.
-- Idempotent. Run against the cloud DB (NOT local — local gets the full seed via `db reset`):
--   . supabase/op.prod.env && \
--   psql "$(~/.local/bin/op-get.sh "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")" -f supabase/seed-admin.sql
--
-- Creates ONLY admin@acme.test (password Passw0rd!dev, pre-confirmed) + its profile (role Admin)
-- + the one company its profile references. NO demo business data. The dev password is a public,
-- well-known demo credential (also in seed.sql / .env.example) — never a real secret.
\set ON_ERROR_STOP on
set search_path = public, extensions;

begin;

-- Admin's employer company (profiles.company_id FK). org_id defaults to the single Default Org.
insert into companies (id, name, type) values
  ('c0000000-0000-0000-0000-000000000001','Acme Consulting Group','Internal')
on conflict (id) do nothing;

-- GoTrue auth user (pre-confirmed; password Passw0rd!dev). Mirrors the dev seed's admin row.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a5',
   'authenticated','authenticated','admin@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '')
on conflict (id) do nothing;

-- Email identity so password sign-in resolves.
insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('admin@acme.test','00000000-0000-0000-0000-0000000000a5',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a5','email','admin@acme.test'),
   'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- App profile (role = Admin). org_id defaults to the single Default Org.
insert into profiles (id, company_id, full_name, email, role, title, location, skills, utilization) values
  ('00000000-0000-0000-0000-0000000000a5','c0000000-0000-0000-0000-000000000001','Erin Admin','admin@acme.test','Admin','System Administrator','HQ','{}',10)
on conflict (id) do nothing;

commit;
