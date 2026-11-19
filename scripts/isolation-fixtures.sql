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
-- The seed org has no expiry registry rows; give A a complete person/document chain for by-id probes.
insert into public.people (id, org_id, code, name)
values ('a6120000-0000-4000-8000-0000000000f1', 'a6120000-0000-4000-8000-00000000000a', 'iso-person', 'Isolation proof person');
insert into public.document_types (id, org_id, name, applies_to)
values ('a6120000-0000-4000-8000-0000000000f2', 'a6120000-0000-4000-8000-00000000000a', 'Isolation proof document', 'person');
insert into public.expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on)
values ('a6120000-0000-4000-8000-0000000000f3', 'a6120000-0000-4000-8000-00000000000a', 'person',
        'a6120000-0000-4000-8000-0000000000f1', 'a6120000-0000-4000-8000-0000000000f2', current_date + 30);
-- Cover the previously unseeded equipment chain too: read-mode deliberately skips updates,
-- so its ceiling also requires by-id reads on existing tables.
insert into public.equipment_assets (id, org_id, code, name)
values ('a6120000-0000-4000-8000-0000000000f4', 'a6120000-0000-4000-8000-00000000000a', 'iso-asset', 'Isolation proof asset');
insert into public.equipment_costing_settings (id, org_id, asset_id, setting_key, version, basis, effective_from)
values ('a6120000-0000-4000-8000-0000000000f5', 'a6120000-0000-4000-8000-00000000000a',
        'a6120000-0000-4000-8000-0000000000f4', 'a6120000-0000-4000-8000-0000000000f6', 1, 'none', current_date);
insert into public.equipment_usage_entries (id, org_id, asset_id, project_id, work_date, quantity, unit, author_id)
select 'a6120000-0000-4000-8000-0000000000f7', 'a6120000-0000-4000-8000-00000000000a',
       'a6120000-0000-4000-8000-0000000000f4', p.id, current_date, 1, 'hours', u.id
  from public.projects p cross join public.profiles u
  where p.org_id = 'a6120000-0000-4000-8000-00000000000a' and u.org_id = p.org_id
  order by p.id, u.id limit 1;
-- Provide disposable rows even when the seed contains no work orders or disciplines.
insert into public.cost_disciplines (id, org_id, code, name)
values ('a6120000-0000-4000-8000-0000000000d1', 'a6120000-0000-4000-8000-00000000000a', 'iso', 'Isolation discipline');
insert into public.work_orders (id, org_id, project_id, title, currency, tax_treatment, tax_amount)
select 'a6120000-0000-4000-8000-0000000000d2', p.org_id, p.id, 'Isolation work order', 'IDR', 'exclusive', 0
from public.projects p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate)
select 'a6120000-0000-4000-8000-0000000000d3', org_id, project_id, 'iso', 'Isolation line', 'each', 1, 1
from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.work_order_lines (id, org_id, work_order_id, boq_item_id, quantity)
values ('a6120000-0000-4000-8000-0000000000d4', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000d2', 'a6120000-0000-4000-8000-0000000000d3', 1);
insert into public.work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, prepared_by)
select 'a6120000-0000-4000-8000-0000000000d5', w.org_id, w.project_id, w.id, current_date, p.id
from public.work_orders w join lateral (select id from public.profiles where org_id = w.org_id order by id limit 1) p on true
where w.id = 'a6120000-0000-4000-8000-0000000000d2';
-- Material request rows ensure the cross-org by-id read and update probes run on the new tables.
insert into public.material_request_settings (org_id) values ('a6120000-0000-4000-8000-00000000000a') on conflict do nothing;
insert into public.approval_chain_steps (id, org_id, position, role, label)
values ('a6120000-0000-4000-8000-0000000000c1', 'a6120000-0000-4000-8000-00000000000a', 1, 'Finance', 'Isolation review');
insert into public.approval_stand_ins (id, org_id, delegator_id, stand_in_id, starts_on, ends_on, created_by)
select 'a6120000-0000-4000-8000-0000000000c2', a.org_id, a.id, b.id, current_date, current_date, a.id
from public.profiles a cross join lateral (select id from public.profiles where org_id = a.org_id and id <> a.id order by id limit 1) b
where a.org_id = 'a6120000-0000-4000-8000-00000000000a' order by a.id limit 1;
insert into public.material_requests (id, org_id, number, work_order_id, project_id, needed_by, created_by)
select 'a6120000-0000-4000-8000-0000000000c3', w.org_id, 'ISO-MRQ', w.id, w.project_id, current_date + 1, p.id
from public.work_orders w join lateral (select id from public.profiles where org_id = w.org_id order by id limit 1) p on true
where w.id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.material_request_lines (id, org_id, request_id, line_no, item_id, quantity)
select 'a6120000-0000-4000-8000-0000000000c4', r.org_id, r.id, 1, i.id, 1
from public.material_requests r join lateral (select id from public.stock_items where org_id = r.org_id order by id limit 1) i on true
where r.id = 'a6120000-0000-4000-8000-0000000000c3';
insert into public.material_request_steps (id, org_id, request_id, round, position, role, label, status)
values ('a6120000-0000-4000-8000-0000000000c5', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 1, 1, 'Finance', 'Isolation review', 'open');
insert into public.material_request_events (id, org_id, request_id, action, to_status)
values ('a6120000-0000-4000-8000-0000000000c6', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 'created', 'draft');
-- Cover additional real by-id probes so read-mode skip counts stay within the existing ceiling.
insert into public.user_views (id, org_id, user_id, name)
select 'a6120000-0000-4000-8000-0000000000b2', org_id, id, 'Isolation view' from public.profiles
where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1;
insert into public.notifications (id, org_id, owner_id, title)
select 'a6120000-0000-4000-8000-0000000000b3', org_id, id, 'Isolation notification' from public.profiles
where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1;
insert into public.spend_approvers (id, org_id, project_id, profile_id)
select 'a6120000-0000-4000-8000-0000000000b4', w.org_id, w.project_id, p.id
from public.work_orders w join lateral (select id from public.profiles where org_id = w.org_id order by id limit 1) p on true
where w.id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.project_progress_entries (id, org_id, project_id, month, pct_complete)
select 'a6120000-0000-4000-8000-0000000000b5', org_id, project_id, date '2001-01-01', 0
from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2';
select 'ISO-COPY-SKIPPED ' || tbl || ': ' || why from _iso_skipped order by tbl;
\endif

do $$ declare r record; begin
  for r in select * from _iso_always loop execute format('alter table %s enable always trigger %I', r.tbl, r.tgname); end loop;
end $$;
commit;
