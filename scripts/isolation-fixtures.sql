-- isolation-fixtures.sql — throwaway tenants for the standing isolation proof (#612). LOCAL / CI STACK ONLY.
-- Driven by scripts/isolation-proof.sh:  psql -v action=up|down -v b_password=... < this file.
--   up   : org B (attacker, one active Admin who can sign in) + org A (disposable) = a self-consistent copy of
--          the seed org: every org-scoped row re-keyed (new ids, every id reference remapped), org_id = A.
--   down : removes every row of both orgs and B's sign-in. Both are safe to repeat.
-- Namespace: orgs a6120000-0000-4000-8000-00000000000a / …0b, B's user …0b1. Nothing here touches the seed org.
\set ON_ERROR_STOP on
select :'action' = 'up' as is_up \gset
begin;
set local session_replication_role = replica;  -- FK triggers off: whole orgs are written and removed in one step
-- ENABLE-ALWAYS triggers (append-only guards) still fire in replica mode; switch them off for this transaction only.
create temp table _iso_always on commit drop as
  select c.oid::regclass::text as tbl, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relnamespace = 'public'::regnamespace and t.tgenabled = 'A' and not t.tgisinternal;
do $$ declare r record; begin
  for r in select * from _iso_always loop execute format('alter table %s disable trigger %I', r.tbl, r.tgname); end loop;
end $$;

-- Remove whatever a previous run left (every org_id table, then the orgs, then B's sign-in).
do $$ declare t record; begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
           and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped) loop
    execute format('delete from public.%I where org_id in (%L, %L)', t.relname,
                   'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-00000000000b');
  end loop;
  delete from public.organizations where id in ('a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-00000000000b');
  delete from auth.refresh_tokens where user_id = 'a6120000-0000-4000-8000-0000000000b1';  -- B's sign-in leaves these behind
  delete from auth.sessions where user_id = 'a6120000-0000-4000-8000-0000000000b1';
  delete from auth.identities where user_id = 'a6120000-0000-4000-8000-0000000000b1';
  delete from auth.users where id = 'a6120000-0000-4000-8000-0000000000b1';
end $$;

\if :is_up
-- B: the attacker. A password-capable auth user + an active Admin profile.
insert into organizations (id, name, lifecycle_state) values ('a6120000-0000-4000-8000-00000000000b', 'isolation-proof B (attacker)', 'test');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token)
values ('00000000-0000-0000-0000-000000000000', 'a6120000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'isolation-proof-b@example.invalid',
  crypt(:'b_password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '');
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('isolation-proof-b@example.invalid', 'a6120000-0000-4000-8000-0000000000b1',
  jsonb_build_object('sub', 'a6120000-0000-4000-8000-0000000000b1', 'email', 'isolation-proof-b@example.invalid'), 'email', now(), now(), now());
insert into profiles (id, org_id, full_name, email, role, status)
values ('a6120000-0000-4000-8000-0000000000b1', 'a6120000-0000-4000-8000-00000000000b', 'Isolation Proof B', 'isolation-proof-b@example.invalid', 'Admin', 'active');

-- A: copy the seed org. Pass 1 gives every row a new id; pass 2 writes the copies with each id remapped.
insert into organizations select (jsonb_populate_record(null::organizations,
  to_jsonb(o) || jsonb_build_object('id', 'a6120000-0000-4000-8000-00000000000a', 'name', 'isolation-proof A (disposable)', 'lifecycle_state', 'test'))).*
  from organizations o where o.id = '00000000-0000-0000-0000-000000000001';
create temp table _iso_map (old uuid primary key, new uuid not null default gen_random_uuid()) on commit drop;
create temp table _iso_skipped (tbl text, why text) on commit drop;
do $$
declare t record; cols text; seed constant uuid := '00000000-0000-0000-0000-000000000001'; a constant uuid := 'a6120000-0000-4000-8000-00000000000a';
begin
  create temp table _iso_tables on commit drop as
    select c.oid, c.relname,
           (select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
             where i.indrelid = c.oid and i.indisprimary order by a.attnum limit 1) as pk
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relname <> 'profiles'
      and exists (select 1 from pg_attribute x where x.attrelid = c.oid and x.attname = 'org_id' and not x.attisdropped);
  for t in select * from _iso_tables where pk is not null and pk <> 'org_id' loop
    begin
      execute format('insert into _iso_map(old) select %I from public.%I where org_id = %L and %I is not null on conflict do nothing', t.pk, t.relname, seed, t.pk);
    exception when others then null;  -- a non-uuid key is simply not remapped
    end;
  end loop;
  insert into _iso_map(old) select id from public.profiles where org_id = seed on conflict do nothing;
  for t in select * from _iso_tables union all select 0::oid, 'profiles', 'id' loop
    select string_agg(format('%I', attname), ',' order by attnum) into cols from pg_attribute
      where attrelid = format('public.%I', t.relname)::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity <> 'a';
    begin
      execute format($f$
        insert into public.%1$I (%2$s)
        select %2$s from (
          select (jsonb_populate_record(null::public.%1$I, q.j)).* from (
            select (select jsonb_object_agg(e.k,
                      case when e.v #>> '{}' = %3$L then to_jsonb(%4$L::text)
                           when m.new is not null then to_jsonb(m.new::text)
                           when %1$L = 'profiles' and e.k = 'email' then to_jsonb('iso-a-' || (e.v #>> '{}'))
                           else e.v end)
                    from jsonb_each(to_jsonb(s)) e(k, v)
                    left join _iso_map m on m.old = case when e.v #>> '{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (e.v #>> '{}')::uuid end) as j
            from public.%1$I s where s.org_id = %3$L) q) z$f$, t.relname, cols, seed, a);
    exception when others then
      insert into _iso_skipped values (t.relname, sqlerrm);
    end;
  end loop;
end $$;
-- The seed org carries no journal, so the copy leaves the three journal tables empty and their by-id read and update
-- probes would skip. Give A one draft journal (one line, one author) so every probe on them runs.
insert into public.journal_entries (id, org_id, kind, entry_date, memo, status, maker_id)
select 'a6120000-0000-4000-8000-0000000000e1', 'a6120000-0000-4000-8000-00000000000a', 'fee', current_date, 'isolation-proof journal', 'draft', p.id
  from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.journal_entry_lines (id, org_id, journal_id, line_no, account, debit, credit, label)
values ('a6120000-0000-4000-8000-0000000000e2', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000e1', 1, 'iso-account', 10, 0, '');
insert into public.journal_entry_authors (journal_id, profile_id, org_id)
select 'a6120000-0000-4000-8000-0000000000e1', p.id, 'a6120000-0000-4000-8000-00000000000a'
  from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
select 'ISO-COPY-SKIPPED ' || tbl || ': ' || why from _iso_skipped order by tbl;
\endif

do $$ declare r record; begin
  for r in select * from _iso_always loop execute format('alter table %s enable always trigger %I', r.tbl, r.tgname); end loop;
end $$;
commit;
