-- isolation-fixtures.sql — throwaway tenants for the standing isolation proof (#612). LOCAL / CI STACK ONLY.
-- Driven by scripts/isolation-proof.sh:  psql -v action=up|down -v b_password=... < this file.
--   up   : org B (attacker, one active Admin who can sign in) + org A (disposable) = a self-consistent copy of
--          the seed org: every org-scoped row re-keyed (new ids, every id reference remapped), org_id = A.
--   down : removes every row of both orgs and B's sign-in. Both are safe to repeat.
-- Namespace: orgs a6120000-0000-4000-8000-00000000000a / …0b, B's user …0b1. Nothing here touches the seed org.
\set ON_ERROR_STOP on
select :'action' = 'up' as is_up \gset
begin;
set local storage.allow_delete_query = 'true';
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
  delete from storage.objects where id = 'a6120000-0000-4000-8000-000000000f92';
  delete from public.organizations where id in ('a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-00000000000b');
  delete from auth.refresh_tokens where user_id = 'a6120000-0000-4000-8000-0000000000b1';  -- B's sign-in leaves these behind
  delete from auth.sessions where user_id = 'a6120000-0000-4000-8000-0000000000b1';
  delete from auth.identities where user_id = 'a6120000-0000-4000-8000-0000000000b1';
  delete from auth.users where id in ('a6120000-0000-4000-8000-0000000000a1', 'a6120000-0000-4000-8000-0000000000b1');
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
-- A real active auth user is required by is_active_member; copied profiles have no matching auth.users.
insert into auth.users (id, email) values
  ('a6120000-0000-4000-8000-0000000000a1', 'isolation-proof-a@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a6120000-0000-4000-8000-0000000000a1', 'a6120000-0000-4000-8000-00000000000a',
   'Isolation Proof A', 'isolation-proof-a@example.invalid', 'Admin', 'active');
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
-- 1018 (#2525): the seed org carries no three-way match rows either. Give A one of each so their by-id probes run. The
-- match stays off for A (enabled = false), so none of A's purchases is gated. Each child has a real parent in A,
-- so an authenticated A member can see it through the parent-visible policies.
insert into public.procurement_items (id, org_id, procurement_id, name, quantity, rate)
select 'a6120000-0000-4000-8000-0000000000e4', p.org_id, p.id, 'isolation-proof item', 1, 1
  from public.procurements p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.procurement_receipts (id, org_id, procurement_id, status)
select 'a6120000-0000-4000-8000-0000000000e3', p.org_id, p.procurement_id, 'Partial'
  from public.procurement_items p where p.id = 'a6120000-0000-4000-8000-0000000000e4';
insert into public.procurement_invoices (id, org_id, procurement_id, status, tax_treatment, tax_amount, currency)
select 'a6120000-0000-4000-8000-0000000000e5', p.org_id, p.procurement_id, 'Received', 'exclusive', 0, 'IDR'
  from public.procurement_items p where p.id = 'a6120000-0000-4000-8000-0000000000e4';
insert into public.org_three_way_match_settings (org_id, enabled, updated_by)
select 'a6120000-0000-4000-8000-00000000000a', false, p.id
  from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.procurement_receipt_lines (receipt_id, item_id, org_id, quantity, recorded_by)
select 'a6120000-0000-4000-8000-0000000000e3', 'a6120000-0000-4000-8000-0000000000e4', 'a6120000-0000-4000-8000-00000000000a', 1, p.id
  from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.procurement_bill_matches (invoice_id, org_id, recorded_by)
select 'a6120000-0000-4000-8000-0000000000e5', 'a6120000-0000-4000-8000-00000000000a', p.id
  from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.procurement_bill_match_lines (invoice_id, item_id, org_id, quantity, rate)
values ('a6120000-0000-4000-8000-0000000000e5', 'a6120000-0000-4000-8000-0000000000e4', 'a6120000-0000-4000-8000-00000000000a', 1, 1);
insert into public.bill_match_exceptions (invoice_id, org_id, approved_by, reason, match)
select 'a6120000-0000-4000-8000-0000000000e5', 'a6120000-0000-4000-8000-00000000000a', p.id, 'isolation-proof exception', '{}'::jsonb
  from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
-- A complete B purchase and match, so its own-organisation reads are non-vacuous.
insert into public.projects (id, org_id, name, status, pmo_project_number, currency) values
  ('a6120000-0000-4000-8000-0000000000b2', 'a6120000-0000-4000-8000-00000000000b', 'isolation-proof project B', 'Ongoing Project', 'ISO-B-1', 'IDR');
insert into public.procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
  approved_by_id, budget_category, currency, is_subcontract) values
  ('a6120000-0000-4000-8000-0000000000b3', 'a6120000-0000-4000-8000-00000000000b', 'isolation-proof purchase B',
   'a6120000-0000-4000-8000-0000000000b2', 'a6120000-0000-4000-8000-0000000000b1', 'Vendor Invoiced', 1, 1,
   'a6120000-0000-4000-8000-0000000000b1', 'Materials', 'IDR', false);
insert into public.procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('a6120000-0000-4000-8000-0000000000b4', 'a6120000-0000-4000-8000-00000000000b', 'a6120000-0000-4000-8000-0000000000b3', 'isolation-proof item B', 1, 1);
insert into public.procurement_receipts (id, org_id, procurement_id, status) values
  ('a6120000-0000-4000-8000-0000000000b5', 'a6120000-0000-4000-8000-00000000000b', 'a6120000-0000-4000-8000-0000000000b3', 'Partial');
insert into public.procurement_invoices (id, org_id, procurement_id, status, tax_treatment, tax_amount, currency) values
  ('a6120000-0000-4000-8000-0000000000b6', 'a6120000-0000-4000-8000-00000000000b', 'a6120000-0000-4000-8000-0000000000b3', 'Received', 'exclusive', 0, 'IDR');
insert into public.org_three_way_match_settings (org_id, enabled, updated_by) values
  ('a6120000-0000-4000-8000-00000000000b', false, 'a6120000-0000-4000-8000-0000000000b1');
insert into public.procurement_receipt_lines (receipt_id, item_id, org_id, quantity, recorded_by) values
  ('a6120000-0000-4000-8000-0000000000b5', 'a6120000-0000-4000-8000-0000000000b4', 'a6120000-0000-4000-8000-00000000000b', 1, 'a6120000-0000-4000-8000-0000000000b1');
insert into public.procurement_bill_matches (invoice_id, org_id, recorded_by) values
  ('a6120000-0000-4000-8000-0000000000b6', 'a6120000-0000-4000-8000-00000000000b', 'a6120000-0000-4000-8000-0000000000b1');
insert into public.procurement_bill_match_lines (invoice_id, item_id, org_id, quantity, rate) values
  ('a6120000-0000-4000-8000-0000000000b6', 'a6120000-0000-4000-8000-0000000000b4', 'a6120000-0000-4000-8000-00000000000b', 1, 1);
insert into public.bill_match_exceptions (invoice_id, org_id, approved_by, reason, match) values
  ('a6120000-0000-4000-8000-0000000000b6', 'a6120000-0000-4000-8000-00000000000b', 'a6120000-0000-4000-8000-0000000000b1', 'isolation-proof exception B', '{}'::jsonb);
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
insert into public.approval_step_pins (id, org_id, project_id, position, role, approver_id, created_by)
select 'a6120000-0000-4000-8000-0000000000c4', w.org_id, w.project_id, 1, 'Finance', p.id, p.id
from public.work_orders w join lateral (select id from public.profiles where org_id = w.org_id order by id limit 1) p on true
where w.id = 'a6120000-0000-4000-8000-0000000000d2';
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
insert into public.spend_approval_settings (id, org_id, tiers_enabled)
values ('a6120000-0000-4000-8000-0000000000fa', 'a6120000-0000-4000-8000-00000000000a', false);
insert into public.project_progress_entries (id, org_id, project_id, month, pct_complete)
select 'a6120000-0000-4000-8000-0000000000b5', org_id, project_id, date '2001-01-01', 0
from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2';
-- Site report chain for A (the seed org has no reports): a draft report on the disposable work order, one row per child table.
insert into public.dsr_idle_reasons (id, org_id, label)
values ('a6120000-0000-4000-8000-0000000000c1', 'a6120000-0000-4000-8000-00000000000a', 'iso-idle-reason') on conflict do nothing;
insert into public.dsr_weather_conditions (id, org_id, label)
values ('a6120000-0000-4000-8000-0000000000c2', 'a6120000-0000-4000-8000-00000000000a', 'iso-weather') on conflict do nothing;
insert into public.daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id)
select 'a6120000-0000-4000-8000-0000000000c3', w.org_id, w.project_id, w.id, current_date,
       (select id from public.profiles where org_id = w.org_id order by id limit 1)
  from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
-- work_order_id is NOT NULL since #2576 (a trigger stamps it from the report, but triggers are off in replica mode).
insert into public.dsr_progress_lines (id, org_id, report_id, work_order_id, position, work_order_line_id, quantity, unit)
values ('a6120000-0000-4000-8000-0000000000c4', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 'a6120000-0000-4000-8000-0000000000d2', 1, 'a6120000-0000-4000-8000-0000000000d4', 1, 'each');
insert into public.dsr_idle_periods (id, org_id, report_id, position, minutes, reason_id)
values ('a6120000-0000-4000-8000-0000000000c5', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 1, 10, 'a6120000-0000-4000-8000-0000000000c1');
insert into public.dsr_consumables (id, org_id, report_id, position, stock_item_id, quantity, unit)
select 'a6120000-0000-4000-8000-0000000000c6', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 1, i.id, 1, 'each'
  from public.stock_items i where i.org_id = 'a6120000-0000-4000-8000-00000000000a' order by i.id limit 1;
insert into public.dsr_photos (id, org_id, report_id, kind, file_path)
values ('a6120000-0000-4000-8000-0000000000c7', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 'other', 'iso/none/none/none.jpg');
insert into public.dsr_events (id, org_id, report_id, action)
values ('a6120000-0000-4000-8000-0000000000c8', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000c3', 'created');
-- #2519: a plan figure and a shared-cost split row on the isolation work order.
insert into public.work_order_plan_lines (id, org_id, project_id, work_order_id, kind, value)
select 'a6120000-0000-4000-8000-0000000000d6', w.org_id, w.project_id, w.id, 'direct_budget', 1
from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.project_shared_cost_splits (org_id, project_id, work_order_id, percent)
select w.org_id, w.project_id, w.id, 100
from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
-- #2576: a section on the isolation work order (its guard trigger writes the first readiness event, so both tables hold an A row).
insert into public.work_order_sections (id, org_id, project_id, work_order_id, code, name)
select 'a6120000-0000-4000-8000-0000000000d7', w.org_id, w.project_id, w.id, 'ISO-1', 'iso section'
from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
-- Integration of the after-go-live features (#2575 to #2587): one A row for each of their tables, so the by-id and update probes run
-- instead of skipping (the proof's skip ceiling only falls). Ids a6120000-...-0200 to 02ff; parents need not exist (FK triggers are off here).
insert into public.client_requisitions (id, org_id, number, work_order_id, project_id, created_by)
values ('a6120000-0000-4000-8000-000000000201', 'a6120000-0000-4000-8000-00000000000a', 'CSR-ISO-1', 'a6120000-0000-4000-8000-0000000000d2', (select project_id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2'), (select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1));
insert into public.client_requisition_lines (id, org_id, requisition_id, line_no, stock_item_id, takeoff_quantity, requested_quantity, unit_code)
values ('a6120000-0000-4000-8000-000000000202', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000201', 1, (select id from public.stock_items where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), 1, 1, 'each');
insert into public.client_requisition_events (id, org_id, requisition_id, kind) values ('a6120000-0000-4000-8000-000000000203', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000201', 'created');
insert into public.client_requisition_pickups (id, org_id, requisition_id, line_id, quantity, picked_up_on, warehouse_id, stock_document_id, recorded_by)
values ('a6120000-0000-4000-8000-000000000204', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000201', 'a6120000-0000-4000-8000-000000000202', 1, current_date, 'a6120000-0000-4000-8000-0000000002f1', 'a6120000-0000-4000-8000-0000000002f2', (select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1));
insert into public.consumable_usage_standards (id, org_id, item_id, work_unit, qty_per_unit) values ('a6120000-0000-4000-8000-000000000205', 'a6120000-0000-4000-8000-00000000000a', (select id from public.stock_items where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), 'iso', 1);
insert into public.work_order_consumable_plan_lines (id, org_id, work_order_id, item_id) values ('a6120000-0000-4000-8000-000000000206', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000d2', (select id from public.stock_items where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1));
insert into public.crew_tool_lines (id, org_id, crew_id, name, held_qty) values ('a6120000-0000-4000-8000-000000000207', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000101', 'iso tool', 1);
insert into public.crew_tool_reports (id, org_id, line_id, kind, qty, reported_on, due_on)
values ('a6120000-0000-4000-8000-000000000208', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000207', 'lost', 1, current_date, current_date + 3);
insert into public.crew_tool_report_files (id, org_id, report_id, file_path) values ('a6120000-0000-4000-8000-000000000209', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000208', 'iso/none/none/none.jpg');
insert into public.quantity_change_requests (id, org_id, project_id, work_order_id, author_id, editor_ids)
values ('a6120000-0000-4000-8000-000000000210', 'a6120000-0000-4000-8000-00000000000a', (select project_id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2'), 'a6120000-0000-4000-8000-0000000000d2', (select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), array[(select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1)]);
insert into public.quantity_change_request_lines (id, org_id, request_id, boq_item_id, requested_quantity, reason, trigger_kind, trigger_figure, base_quantity, base_version_no)
values ('a6120000-0000-4000-8000-000000000211', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000210', 'a6120000-0000-4000-8000-0000000000d3', 2, 'iso', 'forecast', 1, 1, 1);
insert into public.quantity_change_request_events (id, org_id, request_id, action) values ('a6120000-0000-4000-8000-000000000212', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000210', 'created');
insert into public.quantity_change_request_files (id, org_id, request_id, kind, file_path) values ('a6120000-0000-4000-8000-000000000213', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000210', 'supporting', 'iso/none/none/none.pdf');
insert into public.quantity_forecasts (id, org_id, boq_item_id, quantity) values ('a6120000-0000-4000-8000-000000000214', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000d3', 1);
insert into public.subcontract_backcharges (id, org_id, vendor_company_id, project_id, currency, amount, reason_code, created_by)
values ('a6120000-0000-4000-8000-000000000215', 'a6120000-0000-4000-8000-00000000000a', (select id from public.companies where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), (select project_id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2'), 'IDR', 1, 'other', (select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1));
insert into public.subcontract_certificates (id, org_id, procurement_id, po_id, project_id, work_order_id, vendor_company_id, currency, period_start, period_end, prepared_by)
values ('a6120000-0000-4000-8000-000000000216', 'a6120000-0000-4000-8000-00000000000a', (select id from public.procurements where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), 'a6120000-0000-4000-8000-0000000002f3', (select project_id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2'), 'a6120000-0000-4000-8000-0000000000d2', (select id from public.companies where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), 'IDR', '2026-03-01', '2026-03-31', (select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1));
insert into public.subcontract_certificate_claims (id, org_id, certificate_id, work_order_id, work_date, work_order_line_id, crew_id, boq_item_id, quantity)
values ('a6120000-0000-4000-8000-000000000217', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000216', 'a6120000-0000-4000-8000-0000000000d2', '2026-03-10', 'a6120000-0000-4000-8000-0000000000d4', 'a6120000-0000-4000-8000-000000000101', 'a6120000-0000-4000-8000-0000000000d3', 1);
insert into public.subcontract_certificate_lines (id, org_id, certificate_id, boq_item_id, item_code, unit, measured_quantity, rate, po_rate)
values ('a6120000-0000-4000-8000-000000000218', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000216', 'a6120000-0000-4000-8000-0000000000d3', 'iso', 'each', 1, 1, 1);
insert into public.subcontractor_rate_lines (id, org_id, vendor_company_id, boq_item_id, unit, rate, currency, effective_from, version)
values ('a6120000-0000-4000-8000-000000000219', 'a6120000-0000-4000-8000-00000000000a', (select id from public.companies where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), 'a6120000-0000-4000-8000-0000000000d3', 'each', 1, 'IDR', '2026-03-01', 1);
insert into public.third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date)
values ('a6120000-0000-4000-8000-00000000021a', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000d2', (select project_id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2'), 'iso inspection', current_date);
insert into public.third_party_inspection_files (id, org_id, inspection_id, file_path)
values ('a6120000-0000-4000-8000-00000000021b', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-00000000021a', 'iso/none/none/none.pdf');
insert into public.work_order_section_material_plan (id, org_id, work_order_id, section_id, item_id, quantity) values ('a6120000-0000-4000-8000-00000000021c', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000d2', 'a6120000-0000-4000-8000-0000000000d7', (select id from public.stock_items where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), 1);
insert into public.work_order_section_readiness_events (id, org_id, work_order_id, section_id, readiness) values ('a6120000-0000-4000-8000-00000000021d', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000d2', 'a6120000-0000-4000-8000-0000000000d7', 'not_ready');
-- Give the new evidence table an A row so the cross-organization probes exercise it.
insert into storage.objects (id, bucket_id, name)
select 'a6120000-0000-4000-8000-000000000f92', 'incident-files',
       org_id::text || '/' || id::text || '/a6120000-0000-4000-8000-000000000f91/photo.jpg'
from public.incident_reports where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1;
insert into public.incident_files (id, org_id, incident_id, kind, file_path, storage_object_id)
select 'a6120000-0000-4000-8000-000000000f91', i.org_id, i.id, 'at_raise', o.name, o.id
from public.incident_reports i join storage.objects o on o.id = 'a6120000-0000-4000-8000-000000000f92'
where i.org_id = 'a6120000-0000-4000-8000-00000000000a' order by i.id limit 1;
-- Disposable rate catalogue rows (variant, item, rate, stage weight) so its by-id reads and writes are probed, not skipped.
insert into public.rate_catalogue_variants (id, org_id, project_id, name)
select 'a6120000-0000-4000-8000-0000000000e1', w.org_id, w.project_id, 'iso' from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.rate_catalogue_items (id, org_id, project_id, item_code, description, unit)
select 'a6120000-0000-4000-8000-0000000000e2', w.org_id, w.project_id, 'iso', 'Isolation catalogue item', 'each' from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.rate_catalogue_rates (id, org_id, item_id, variant_id, rate, effective_from)
values ('a6120000-0000-4000-8000-0000000000e3', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000e2', 'a6120000-0000-4000-8000-0000000000e1', 1, current_date);
insert into public.rate_catalogue_stage_weights (id, org_id, item_id, effective_from, position, stage, weight_pct)
values ('a6120000-0000-4000-8000-0000000000e4', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000e2', current_date, 1, 'iso', 100);
-- Crew and attendance rows make each new tenant-scoped relation probeable.
insert into public.crews (id, org_id, code, name) values
 ('a6120000-0000-4000-8000-000000000101', 'a6120000-0000-4000-8000-00000000000a', 'iso-crew', 'Isolation crew');
insert into public.crew_standard_roles (id, org_id, crew_id, name, headcount) values
 ('a6120000-0000-4000-8000-000000000102', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000101', 'Worker', 1);
insert into public.crew_members (id, org_id, crew_id, worker_id, standard_role_id, valid_from) values
 ('a6120000-0000-4000-8000-000000000103', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000101', 'a6120000-0000-4000-8000-0000000000f1', 'a6120000-0000-4000-8000-000000000102', current_date);
insert into public.work_order_crews (id, org_id, crew_id, work_order_id, valid_from) values
 ('a6120000-0000-4000-8000-000000000104', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000101', 'a6120000-0000-4000-8000-0000000000d2', current_date);
insert into public.crew_worker_rotation_off (id, org_id, worker_id, off_from, off_to) values
 ('a6120000-0000-4000-8000-000000000105', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-0000000000f1', current_date - 1, current_date - 1);
insert into public.attendance_days (id, org_id, crew_id, worker_id, work_order_id, project_id, work_date, status, hours, source)
select 'a6120000-0000-4000-8000-000000000106', w.org_id, 'a6120000-0000-4000-8000-000000000101', 'a6120000-0000-4000-8000-0000000000f1', w.id, w.project_id, current_date, 'present', 8, 'roster_tick'
from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
insert into public.attendance_photos (id, org_id, crew_id, work_order_id, work_date, file_path) values
 ('a6120000-0000-4000-8000-000000000107', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000101', 'a6120000-0000-4000-8000-0000000000d2', current_date, 'isolation-fixture');
-- Supplement the second-org probe with otherwise empty, org-scoped rows.
insert into public.user_views (id, org_id, user_id, name, scope)
select 'a6120000-0000-4000-8000-000000000111', p.org_id, p.id, 'Isolation view', 'private'
from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.comments (id, org_id, entity_type, entity_id, author_id, body)
select 'a6120000-0000-4000-8000-000000000112', p.org_id, 'project', p.id, u.id, 'Isolation comment'
from public.projects p join public.profiles u on u.org_id = p.org_id
where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id, u.id limit 1;
insert into public.agent_threads (id, org_id, owner_id, title)
select 'a6120000-0000-4000-8000-000000000113', p.org_id, p.id, 'Isolation thread'
from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
insert into public.agent_runs (id, org_id, owner_id, thread_id, title)
select 'a6120000-0000-4000-8000-000000000114', t.org_id, t.owner_id, t.id, 'Isolation run'
from public.agent_threads t where t.id = 'a6120000-0000-4000-8000-000000000113';
insert into public.agent_events (id, org_id, owner_id, run_id, seq, type)
select 'a6120000-0000-4000-8000-000000000115', r.org_id, r.owner_id, r.id, 1, 'user'
from public.agent_runs r where r.id = 'a6120000-0000-4000-8000-000000000114';
insert into public.agent_usage (id, org_id, owner_id, run_id, model)
select 'a6120000-0000-4000-8000-000000000116', r.org_id, r.owner_id, r.id, 'fixture'
from public.agent_runs r where r.id = 'a6120000-0000-4000-8000-000000000114';
insert into public.agent_attachments (id, org_id, owner_id, thread_id, storage_path, mime_type, size_bytes, original_filename)
select 'a6120000-0000-4000-8000-000000000117', t.org_id, t.owner_id, t.id,
  'org/a6120000-0000-4000-8000-00000000000a/agent-attachments/a6120000-0000-4000-8000-000000000117',
  'application/pdf', 1, 'fixture.pdf'
from public.agent_threads t where t.id = 'a6120000-0000-4000-8000-000000000113';
insert into public.agent_automations (id, org_id, owner_id, kind, prompt, schedule)
select 'a6120000-0000-4000-8000-000000000118', p.org_id, p.id, 'schedule', 'Isolation automation', '0 0 * * *'
from public.profiles p where p.org_id = 'a6120000-0000-4000-8000-00000000000a' order by p.id limit 1;
-- issue_department_groups (#2678, integration merge 2): the only by_id-applicable table of the r1-local
-- features with no seed row; without it its by-id read/update probes skip.
insert into public.issue_department_groups (id, org_id, name, issue_types)
values ('a6120000-0000-4000-8000-0000000000b6', 'a6120000-0000-4000-8000-00000000000a', 'Isolation department group', '{}');
-- Round 1 integration (the #2519..#2733 merge): one real tenant-A row for every by_id-applicable table the
-- seed-copy cannot fill, so each table's by-id read and update probe RUNS instead of skipping twice per mode
-- (r0 run-1 line-14). Ids a6120000-...-0301..0332; parents are A's own rows (work order -d2, its project,
-- a profile, crew -101, person -f1, report -c3, section -d7); FK triggers are off in this transaction.
-- A second crew and a second work order, both created here: the seed carries neither, and two probes need
-- two distinct rows (crew_loans host≠home; stock_wo_transfers from≠to).
insert into public.crews (id, org_id, code, name)
values ('a6120000-0000-4000-8000-000000000333', 'a6120000-0000-4000-8000-00000000000a', 'iso-crew-2', 'Isolation crew two');
insert into public.work_orders (id, org_id, project_id, title, currency, tax_treatment, tax_amount)
select 'a6120000-0000-4000-8000-000000000334', w.org_id, w.project_id, 'Isolation work order two', w.currency, w.tax_treatment, w.tax_amount
from public.work_orders w where w.id = 'a6120000-0000-4000-8000-0000000000d2';
create temp table _iso_a on commit drop as
select (select id from public.profiles where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as profile,
       (select id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2') as wo,
       (select project_id from public.work_orders where id = 'a6120000-0000-4000-8000-0000000000d2') as project,
       'a6120000-0000-4000-8000-000000000334'::uuid as wo2,
       (select id from public.crews where id = 'a6120000-0000-4000-8000-000000000101') as crew,
       'a6120000-0000-4000-8000-000000000333'::uuid as crew2,
       (select id from public.people where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as person,
       (select id from public.daily_site_reports where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as report,
       (select id from public.stock_items where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as item,
       (select id from public.dsr_consumables where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as consumable,
       (select id from public.companies where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as company,
       (select id from public.equipment_assets where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as asset,
       (select id from public.incident_reports where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as incident,
       (select id from public.tasks where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as task,
       (select id from public.stock_warehouses where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1) as wh1,
       (select id from public.stock_warehouses where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1 offset 1) as wh2,
       (select id from public.stock_warehouses where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1 offset 2) as wh3;
insert into public.billing_plan_month_targets (org_id, month, target, updated_by)
  select 'a6120000-0000-4000-8000-00000000000a', date_trunc('month', current_date)::date, 1, profile from _iso_a;
insert into public.billing_step_templates (id, org_id, name, created_by)
  select 'a6120000-0000-4000-8000-000000000301', 'a6120000-0000-4000-8000-00000000000a', 'Isolation billing steps', profile from _iso_a;
insert into public.billing_step_template_steps (id, org_id, template_id, position, name)
  values ('a6120000-0000-4000-8000-000000000302', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000301', 1, 'Isolation step');
insert into public.billing_step_template_documents (id, org_id, step_id, position, name)
  values ('a6120000-0000-4000-8000-000000000303', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000302', 1, 'Isolation document');
insert into public.clearance_items (id, org_id, name, created_by)
  select 'a6120000-0000-4000-8000-000000000304', 'a6120000-0000-4000-8000-00000000000a', 'Isolation clearance', profile from _iso_a;
insert into public.closeout_checklist_templates (id, org_id, position, name)
  values ('a6120000-0000-4000-8000-000000000305', 'a6120000-0000-4000-8000-00000000000a', 1, 'Isolation closeout item');
insert into public.crew_loans (id, org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to)
  select 'a6120000-0000-4000-8000-000000000306', 'a6120000-0000-4000-8000-00000000000a',
         person, crew, crew2, current_date - 1, current_date + 1 from _iso_a;
insert into public.done_not_claimed_notices (id, org_id, work_order_id)
  select 'a6120000-0000-4000-8000-000000000307', 'a6120000-0000-4000-8000-00000000000a', wo from _iso_a;
insert into public.dsr_stock_postings (id, org_id, report_id, state)
  select 'a6120000-0000-4000-8000-000000000308', 'a6120000-0000-4000-8000-00000000000a', report, 'posted' from _iso_a;
insert into public.dsr_stock_posting_lines (id, org_id, posting_id, consumable_id, item_id, quantity, state)
  select 'a6120000-0000-4000-8000-000000000309', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000308', consumable, item, 1, 'posted' from _iso_a;
insert into public.equipment_plan_categories (id, org_id, name)
  select 'a6120000-0000-4000-8000-00000000030a', 'a6120000-0000-4000-8000-00000000000a', 'Isolation category' from _iso_a;
insert into public.equipment_plans (id, org_id, project_id, plan_month, created_by)
  select 'a6120000-0000-4000-8000-00000000030b', 'a6120000-0000-4000-8000-00000000000a',
         project, date_trunc('month', current_date)::date, profile from _iso_a;
insert into public.equipment_plan_lines (id, org_id, plan_id, work_order_id, category_id, equipment_asset_id,
  description, quantity, rate, vendor_id, date_from, date_to)
  select 'a6120000-0000-4000-8000-00000000030c', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-00000000030b', wo, 'a6120000-0000-4000-8000-00000000030a', asset,
         'Isolation plan line', 1, 1, company, current_date, current_date + 1 from _iso_a;
insert into public.equipment_vendor_responses (id, org_id, asset_id, period_start, vendor_id, reported_at, responded_at)
  select 'a6120000-0000-4000-8000-00000000030d', 'a6120000-0000-4000-8000-00000000000a',
         asset, date_trunc('month', current_date)::date, company, now(), now() from _iso_a;
insert into public.incident_tasks (id, org_id, incident_id, task_id)
  select 'a6120000-0000-4000-8000-00000000030e', 'a6120000-0000-4000-8000-00000000000a', incident, task from _iso_a;
insert into public.labour_cost_classes (id, org_id, code, name)
  select 'a6120000-0000-4000-8000-00000000030f', 'a6120000-0000-4000-8000-00000000000a', 'isolation_class', 'Isolation class' from _iso_a;
insert into public.labour_cost_rates (id, org_id, subject_kind, person_id, class_id, basis, amount, effective_from)
  select 'a6120000-0000-4000-8000-000000000310', 'a6120000-0000-4000-8000-00000000000a',
         'person', person, 'a6120000-0000-4000-8000-00000000030f', 'hourly', 1, current_date from _iso_a;
insert into public.leave_types (id, org_id, name)
  select 'a6120000-0000-4000-8000-000000000311', 'a6120000-0000-4000-8000-00000000000a', 'Isolation leave' from _iso_a;
insert into public.leave_requests (id, org_id, person_id, leave_type_id, start_date, end_date, entered_by)
  select 'a6120000-0000-4000-8000-000000000312', 'a6120000-0000-4000-8000-00000000000a',
         person, 'a6120000-0000-4000-8000-000000000311', current_date, current_date + 1, profile from _iso_a;
insert into public.material_request_usage_alerts (id, org_id, work_order_id, item_id, slot, pct, use_qty, plan_qty)
  select 'a6120000-0000-4000-8000-000000000313', 'a6120000-0000-4000-8000-00000000000a',
         wo, item, 1, 50, 1, 2 from _iso_a;
insert into public.material_installed_usage_alerts (id, org_id, work_order_id, item_id, pct, installed_qty, plan_qty, source)
  select 'a6120000-0000-4000-8000-000000000314', 'a6120000-0000-4000-8000-00000000000a',
         wo, item, 50, 1, 2, 'site_reports' from _iso_a;
insert into public.org_billing_plan_settings (org_id, updated_by)
  select 'a6120000-0000-4000-8000-00000000000a', profile from _iso_a;
-- 1670 gives every organisation a row in the seven switch tables, so the demo org already owns one here and the seed
-- copy above has already re-keyed it to A (payment channel ON, no actor). The two switch rows are therefore upserts
-- that overwrite the copied row with the fixture's own values — never a second row, and no insert is left to chance.
insert into public.org_payment_channel_settings (org_id, enabled, updated_by)
  select 'a6120000-0000-4000-8000-00000000000a', false, profile from _iso_a
  on conflict (org_id) do update set enabled = excluded.enabled, enabled_at = excluded.enabled_at,
    updated_by = excluded.updated_by;
insert into public.org_payment_channels (id, org_id, name, created_by)
  select 'a6120000-0000-4000-8000-000000000314', 'a6120000-0000-4000-8000-00000000000a', 'Isolation channel', profile from _iso_a;
insert into public.org_revenue_plan_settings (org_id, enabled, updated_by)
  select 'a6120000-0000-4000-8000-00000000000a', true, profile from _iso_a
  on conflict (org_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by;
insert into public.person_clearances (id, org_id, person_id, item_id, done_on, updated_by)
  select 'a6120000-0000-4000-8000-000000000315', 'a6120000-0000-4000-8000-00000000000a',
         person, 'a6120000-0000-4000-8000-000000000304', current_date, profile from _iso_a;
insert into public.phone_check_ins (id, org_id, work_order_id, worker_id, requester_id, crew_id, work_date, hours, outcome, status)
  select 'a6120000-0000-4000-8000-000000000316', 'a6120000-0000-4000-8000-00000000000a',
         wo, person, profile, crew, current_date, 1, 'inside', 'recorded' from _iso_a;
insert into public.purchase_line_categories (id, org_id, name)
  select 'a6120000-0000-4000-8000-000000000317', 'a6120000-0000-4000-8000-00000000000a', 'Isolation line category' from _iso_a;
insert into public.purchase_types (id, org_id, name)
  select 'a6120000-0000-4000-8000-000000000318', 'a6120000-0000-4000-8000-00000000000a', 'Isolation purchase type' from _iso_a;
insert into public.safety_days (id, org_id, project_id, work_order_id, work_date, author_id)
  select 'a6120000-0000-4000-8000-000000000319', 'a6120000-0000-4000-8000-00000000000a',
         project, wo, current_date, profile from _iso_a;
insert into public.safety_checklist_answers (id, org_id, day_id, label, answer)
  values ('a6120000-0000-4000-8000-00000000031a', 'a6120000-0000-4000-8000-00000000000a',
          'a6120000-0000-4000-8000-000000000319', 'Isolation check', 'yes');
insert into public.safety_fitness_checks (id, org_id, day_id, worker_id, result)
  select 'a6120000-0000-4000-8000-00000000031b', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000319', person, 'fit' from _iso_a;
insert into public.safety_list_items (id, org_id, kind, label)
  select 'a6120000-0000-4000-8000-00000000031c', 'a6120000-0000-4000-8000-00000000000a', 'checklist_item', 'Isolation list item' from _iso_a;
insert into public.safety_officer_entries (id, org_id, day_id, body, author_id)
  select 'a6120000-0000-4000-8000-00000000031d', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000319', 'Isolation safety note', profile from _iso_a;
insert into public.safety_permits (id, org_id, day_id, permit_number, valid_from, valid_to)
  values ('a6120000-0000-4000-8000-00000000031e', 'a6120000-0000-4000-8000-00000000000a',
          'a6120000-0000-4000-8000-000000000319', 'ISO-PERMIT-1', now(), now() + interval '1 hour');
insert into public.safety_toolbox_talks (id, org_id, day_id, topic, presenter, held_at)
  values ('a6120000-0000-4000-8000-00000000031f', 'a6120000-0000-4000-8000-00000000000a',
          'a6120000-0000-4000-8000-000000000319', 'Isolation toolbox topic', 'Isolation presenter', now());
insert into public.safety_toolbox_attendees (id, org_id, day_id, talk_id, worker_id)
  select 'a6120000-0000-4000-8000-000000000320', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000319', 'a6120000-0000-4000-8000-00000000031f', person from _iso_a;
insert into public.safety_toolbox_photos (id, org_id, day_id, talk_id, file_path)
  select 'a6120000-0000-4000-8000-000000000321', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000319', 'a6120000-0000-4000-8000-00000000031f',
         'iso/none/none/toolbox.jpg' from _iso_a;
insert into public.site_checkpoint_templates (id, org_id, position, name, due_time)
  select 'a6120000-0000-4000-8000-000000000322', 'a6120000-0000-4000-8000-00000000000a', 1, 'Isolation checkpoint', '08:00' from _iso_a;
insert into public.site_checkpoints (id, org_id, work_order_id, crew_id, work_date, position, name, due_at)
  select 'a6120000-0000-4000-8000-000000000323', 'a6120000-0000-4000-8000-00000000000a',
         wo, crew, current_date, 1, 'Isolation checkpoint', now() + interval '1 hour' from _iso_a;
insert into public.stock_reservations (id, org_id, work_order_id, item_id, warehouse_id, quantity, created_by)
  select 'a6120000-0000-4000-8000-000000000324', 'a6120000-0000-4000-8000-00000000000a',
         wo, item, wh1, 1, profile from _iso_a;
insert into public.stock_reservation_events (id, org_id, reservation_id, action, qty, actor_id)
  values ('a6120000-0000-4000-8000-000000000325', 'a6120000-0000-4000-8000-00000000000a',
          'a6120000-0000-4000-8000-000000000324', 'reserve', 1, null);
insert into public.stock_transfers (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, sent_by)
  select 'a6120000-0000-4000-8000-000000000326', 'a6120000-0000-4000-8000-00000000000a', 'ISO-TR-1',
         wh1, wh2, wh3, profile from _iso_a;
insert into public.stock_transfer_lines (id, org_id, transfer_id, line_no, item_id, qty_sent)
  select 'a6120000-0000-4000-8000-000000000327', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000326', 1, item, 1 from _iso_a;
insert into public.stock_handover_confirmations (id, org_id, transfer_id, stage, proof_type, signer_kind, signer_name,
  recorded_by, counts, paper_photo_path)
  select 'a6120000-0000-4000-8000-000000000328', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000326', 'send', 'paper', 'guest', 'Isolation visitor', profile,
         '[]'::jsonb, 'iso/none/none/handover.jpg' from _iso_a;
insert into public.stock_wo_transfers (id, org_id, number, project_id, warehouse_id, from_work_order_id,
  to_work_order_id, occurred_on, created_by)
  select 'a6120000-0000-4000-8000-000000000329', 'a6120000-0000-4000-8000-00000000000a', 'ISO-WOT-1',
         project, wh1, wo, wo2, current_date, profile from _iso_a;
insert into public.task_groups (id, org_id, project_id, name)
  select 'a6120000-0000-4000-8000-00000000032a', 'a6120000-0000-4000-8000-00000000000a', project, 'Isolation task group' from _iso_a;
insert into public.work_order_areas (id, org_id, code, name)
  select 'a6120000-0000-4000-8000-00000000032b', 'a6120000-0000-4000-8000-00000000000a', 'ISO-AREA', 'Isolation area' from _iso_a;
insert into public.work_order_candidates (id, org_id, project_id, title, offered_on, created_by)
  select 'a6120000-0000-4000-8000-00000000032c', 'a6120000-0000-4000-8000-00000000000a',
         project, 'Isolation candidate work order', current_date, profile from _iso_a;
insert into public.work_order_candidate_items (id, org_id, candidate_id, label)
  select 'a6120000-0000-4000-8000-00000000032d', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-00000000032c', 'Isolation candidate item' from _iso_a;
insert into public.work_order_candidate_proofs (id, org_id, item_id, file_path)
  select 'a6120000-0000-4000-8000-00000000032e', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-00000000032d', 'iso/none/none/candidate.jpg' from _iso_a;
insert into public.work_order_checklist_items (id, org_id, label)
  select 'a6120000-0000-4000-8000-00000000032f', 'a6120000-0000-4000-8000-00000000000a', 'Isolation checklist item' from _iso_a;
insert into public.work_order_closeout_items (id, org_id, work_order_id, project_id, position, name, required)
  select 'a6120000-0000-4000-8000-000000000330', 'a6120000-0000-4000-8000-00000000000a',
         wo, project, 1, 'Isolation closeout', true from _iso_a;
insert into public.org_billing_step_settings (org_id, default_template_id, updated_by)
  select 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000301', profile from _iso_a;
insert into public.work_order_billing_steps (id, org_id, work_order_id, project_id, position, name, started_on)
  select 'a6120000-0000-4000-8000-000000000340', 'a6120000-0000-4000-8000-00000000000a', wo, project, 1, 'Isolation billing step', current_date from _iso_a;
insert into public.work_order_billing_step_documents (id, org_id, step_id, work_order_id, position, name)
  select 'a6120000-0000-4000-8000-000000000341', 'a6120000-0000-4000-8000-00000000000a',
         'a6120000-0000-4000-8000-000000000340', wo, 1, 'Isolation step document' from _iso_a;
-- #2800: the seed org carries no people or clearance items either, so the new notice table's by-id read and its no-write
-- probe would both skip. Give A one person, one clearance item and one notice row. (ids moved to 343-345: 340/341 are
-- the isolation billing step and its document above)
insert into public.people (id, org_id, code, name, created_by)
  select 'a6120000-0000-4000-8000-000000000343', 'a6120000-0000-4000-8000-00000000000a', 'ISO-P1',
         'Isolation person', profile from _iso_a;
insert into public.clearance_items (id, org_id, name, is_required, sort_order, created_by)
  select 'a6120000-0000-4000-8000-000000000344', 'a6120000-0000-4000-8000-00000000000a',
         'Isolation clearance item', true, 1, profile from _iso_a;
insert into public.person_clearance_overdue_notices (id, org_id, person_id, item_id)
  values ('a6120000-0000-4000-8000-000000000345', 'a6120000-0000-4000-8000-00000000000a',
          'a6120000-0000-4000-8000-000000000343', 'a6120000-0000-4000-8000-000000000344');
insert into public.work_order_groups (id, org_id, code, name)
  select 'a6120000-0000-4000-8000-000000000331', 'a6120000-0000-4000-8000-00000000000a', 'ISO-GROUP', 'Isolation group' from _iso_a;
insert into public.work_order_revenue_plan (id, org_id, project_id, work_order_id, plan_date, amount, created_by)
  select 'a6120000-0000-4000-8000-000000000332', 'a6120000-0000-4000-8000-00000000000a',
         project, wo, current_date, 1, profile from _iso_a;
insert into public.survey_records (id, org_id, project_id, work_order_id, boq_item_id, survey_date, surveyed_quantity, recorded_by)
  select 'a6120000-0000-4000-8000-000000000335', 'a6120000-0000-4000-8000-00000000000a', project, wo,
         (select id from public.boq_items where org_id = 'a6120000-0000-4000-8000-00000000000a' order by id limit 1), current_date, 1, profile from _iso_a;
insert into public.survey_participants (id, org_id, record_id, name)
  values ('a6120000-0000-4000-8000-000000000336', 'a6120000-0000-4000-8000-00000000000a', 'a6120000-0000-4000-8000-000000000335', 'Isolation participant');
insert into public.project_documents (id, org_id, project_id, code, category, title, status, author_id, file_path)
  select 'a6120000-0000-4000-8000-000000000337', 'a6120000-0000-4000-8000-00000000000a', project, 'ISO-SVY-DOC', 'Report', 'Isolation survey document',
         'Issued', profile, 'iso/none/none/survey.pdf' from _iso_a;
insert into public.survey_record_documents (record_id, document_id, org_id, attached_by)
  select 'a6120000-0000-4000-8000-000000000335', 'a6120000-0000-4000-8000-000000000337',
         'a6120000-0000-4000-8000-00000000000a', profile from _iso_a;
select 'ISO-COPY-SKIPPED ' || tbl || ': ' || why from _iso_skipped order by tbl;
\endif

do $$ declare r record; begin
  for r in select * from _iso_always loop execute format('alter table %s enable always trigger %I', r.tbl, r.tgname); end loop;
end $$;
commit;
