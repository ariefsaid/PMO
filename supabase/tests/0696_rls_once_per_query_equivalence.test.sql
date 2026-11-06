-- 0696_rls_once_per_query_equivalence.test.sql — #1254.
-- Migration under test: supabase/migrations/0696_rls_row_policies_once_per_query.sql (+ rollback/0696_..._down.sql).
--
--   §1  STANDING GUARD: no public/storage policy may call auth.uid(), auth.jwt(), stock_admin(),
--       stock_master_writer() or holds_spend_approval_authority(..) in the per-row form; each must be the
--       scalar-subselect form `(select fn(..))` (one InitPlan per statement). 0646's guard covers the org/role/
--       membership helpers; this one covers the rest. Catalog-derived, so it binds policies not yet written.
--   §2  The guard's SELF-TEST (a detector that matches nothing looks like a passing one).
--   §3  EQUIVALENCE: for six callers (Admin, Executive, Finance, Project Manager, Engineer of org A; Admin of org B)
--       and five representative tables, record which rows each caller sees and the outcome of every write probe
--       (insert own / foreign owner / foreign org, update, delete; expense_claims/erp_gl/stock inserts and updates are not granted to
--       authenticated, so only their reads and the granted stock delete are reachable and probed) under the 0696 policies ("new"), then restore the
--       pre-0696 definitions of exactly those policies ("old"), record again, and require the two to be identical.
--       Each write probe runs in a rolled-back sub-transaction, so both phases see the same data.
--   Mutation check (recorded in the PR): drop the org predicate from expense_claims_select in the migration and AC-OQ-EQ-002/003/008 go red
--   (notifications_select is not a valid target: its owner_id predicate masks the org predicate).
begin;
select plan(26);

create function pg_temp.q696_strip(expr text) returns text language sql immutable as $$
  select regexp_replace(coalesce(expr, ''), '''([^'']|'''')*''', '''''', 'g') $$;

create function pg_temp.q696_bare(expr text) returns integer language plpgsql immutable as $$
declare
  i int; v text := pg_temp.q696_strip(expr); total int := 0; wrapped int := 0;
  -- a call is counted by its head; it is "wrapped" only as the WHOLE of an uncorrelated scalar sub-select:
  -- (select fn(..) [as x]) with nothing after the call, so (select fn() from t where t.x = col) stays bare.
  heads text[] := array['auth\.uid[[:space:]]*\(','auth\.jwt[[:space:]]*\(','stock_admin[[:space:]]*\(','stock_master_writer[[:space:]]*\(',
                        'holds_spend_approval_authority[[:space:]]*\([[:space:]]*\([[:space:]]*select'];
  whole text[] := array['auth\.uid[[:space:]]*\([[:space:]]*\)','auth\.jwt[[:space:]]*\([[:space:]]*\)','stock_admin[[:space:]]*\([[:space:]]*\)','stock_master_writer[[:space:]]*\([[:space:]]*\)',
                        'holds_spend_approval_authority[[:space:]]*\([[:space:]]*\([[:space:]]*select[[:space:]]+(public\.)?auth_role[[:space:]]*\([[:space:]]*\)[[:space:]]*(as[[:space:]]+[[:alnum:]_]+)?[[:space:]]*\)[[:space:]]*\)'];
begin
  if v = '' then return 0; end if;
  for i in 1 .. array_length(heads, 1) loop
    total   := total   + (select count(*) from regexp_matches(v, '(^|[^.[:alnum:]_])(public\.)?' || heads[i], 'gi'));
    wrapped := wrapped + (select count(*) from regexp_matches(v,
      '\([[:space:]]*select[[:space:]]+(public\.)?' || whole[i] || '[[:space:]]*(as[[:space:]]+[[:alnum:]_]+)?[[:space:]]*\)', 'gi'));
  end loop;
  return greatest(total - wrapped, 0);
end $$;

-- (holds_spend_approval_authority(<column>) is per-row by nature; only a call whose argument is a scalar-select, i.e. the caller's role, is counted)
-- ── §1 gate ──
select is_empty(
  $$select schemaname || '.' || tablename || ' ' || policyname || ' (' || cmd || ')'
      from pg_policies
     where schemaname in ('public', 'storage')
       and pg_temp.q696_bare(qual) + pg_temp.q696_bare(with_check) > 0$$,
  'AC-OQ-GUARD-001 no public/storage policy calls auth.uid/auth.jwt/stock_admin/stock_master_writer/holds_spend_approval_authority per row');

select ok((select count(*) from pg_policies where schemaname in ('public', 'storage')) >= 300,
  'AC-OQ-GUARD-002 the gate scans at least 300 policies');
select ok((select count(*) from pg_policies where schemaname = 'public'
         and (qual ~* '\(\s*select\s+auth\.uid\(' or with_check ~* '\(\s*select\s+auth\.uid\(')) >= 40,
  'AC-OQ-GUARD-003 at least 40 policies carry the scalar-selected auth.uid() (the guard has real input)');

-- ── §2 self-test ──
create table pg_temp.q696_ctl (id uuid primary key default gen_random_uuid(), owner_id uuid, note text);
alter table pg_temp.q696_ctl enable row level security;
create policy c_bare    on pg_temp.q696_ctl for select using (owner_id = auth.uid() and stock_admin());
create policy c_wrapped on pg_temp.q696_ctl for select using (owner_id = (select auth.uid()) and (select stock_admin()));
create policy c_mixed   on pg_temp.q696_ctl for all using (owner_id = (select auth.uid()) or owner_id = auth.uid())
  with check ((select holds_spend_approval_authority((select auth_role()))) and holds_spend_approval_authority((select auth_role())));
create policy c_nested  on pg_temp.q696_ctl for select
  using (exists (select 1 from public.projects z where z.project_manager_id = auth.uid()));
create policy c_other   on pg_temp.q696_ctl for select using (note = 'auth.uid()' or (auth.jwt() ->> 'role') is null);
create policy c_corr    on pg_temp.q696_ctl for select
  using (owner_id = (select auth.uid() from public.projects z where z.project_manager_id = pg_temp.q696_ctl.owner_id limit 1));
create policy c_jwt     on pg_temp.q696_ctl for update using (((select auth.jwt()) ->> 'role') = 'service_role');

select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_bare'), 2,
  'AC-OQ-GUARD-004 detector: two bare calls are two violations');
select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_wrapped'), 0,
  'AC-OQ-GUARD-005 detector: the scalar-selected form is clean');
select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_mixed'), 1,
  'AC-OQ-GUARD-006 detector: a MIXED USING reports its one bare call');
select is((select pg_temp.q696_bare(with_check) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_mixed'), 1,
  'AC-OQ-GUARD-007 detector: WITH CHECK is examined separately, argument-taking call included');
select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_nested'), 1,
  'AC-OQ-GUARD-008 detector: a bare call in a nested subquery is a violation');
select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_other'), 1,
  'AC-OQ-GUARD-009 detector: a string literal that reads like a call is ignored, the real bare auth.jwt() is not');
select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_jwt'), 0,
  'AC-OQ-GUARD-010 detector: wrapped auth.jwt() with a trailing operator is clean');

select is((select pg_temp.q696_bare(qual) from pg_policies where tablename = 'q696_ctl' and policyname = 'c_corr'), 1,
  'AC-OQ-GUARD-011 detector: a correlated (select auth.uid() from t where ..) is NOT the once-per-statement form');

-- ── §3 equivalence fixtures (postgres) ──
insert into organizations (id, name) values
  ('06960000-0000-0000-0000-0000000000a1', 'OQ Org A'),
  ('06960000-0000-0000-0000-0000000000b1', 'OQ Org B');
insert into auth.users (id, email) values
  ('06960000-0000-0000-0000-000000000001', 'oq-admin@example.com'),
  ('06960000-0000-0000-0000-000000000002', 'oq-exec@example.com'),
  ('06960000-0000-0000-0000-000000000003', 'oq-fin@example.com'),
  ('06960000-0000-0000-0000-000000000004', 'oq-pm@example.com'),
  ('06960000-0000-0000-0000-000000000005', 'oq-eng@example.com'),
  ('06960000-0000-0000-0000-000000000008', 'oq-admin-b@example.com');
insert into org_plans (org_id, plan_id) values
  ('06960000-0000-0000-0000-0000000000a1', 'enterprise'), ('06960000-0000-0000-0000-0000000000b1', 'enterprise');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06960000-0000-0000-0000-000000000001', '06960000-0000-0000-0000-0000000000a1', 'OQ Admin', 'oq-admin@example.com', 'Admin', 'active'),
  ('06960000-0000-0000-0000-000000000002', '06960000-0000-0000-0000-0000000000a1', 'OQ Exec',  'oq-exec@example.com',  'Executive', 'active'),
  ('06960000-0000-0000-0000-000000000003', '06960000-0000-0000-0000-0000000000a1', 'OQ Fin',   'oq-fin@example.com',   'Finance', 'active'),
  ('06960000-0000-0000-0000-000000000004', '06960000-0000-0000-0000-0000000000a1', 'OQ PM',    'oq-pm@example.com',    'Project Manager', 'active'),
  ('06960000-0000-0000-0000-000000000005', '06960000-0000-0000-0000-0000000000a1', 'OQ Eng',   'oq-eng@example.com',   'Engineer', 'active'),
  ('06960000-0000-0000-0000-000000000008', '06960000-0000-0000-0000-0000000000b1', 'OQ Admin B','oq-admin-b@example.com','Admin', 'active');

insert into notifications (org_id, owner_id, title)
  select p.org_id, p.id, 'n-' || p.full_name from profiles p where p.id::text like '06960000%';
insert into user_views (org_id, user_id, name, scope)
  select p.org_id, p.id, 'v-' || p.full_name, 'private' from profiles p where p.id::text like '06960000%';
insert into user_views (org_id, user_id, name, scope) values
  ('06960000-0000-0000-0000-0000000000a1', '06960000-0000-0000-0000-000000000001', 'v-shared', 'shared_org');
insert into expense_claims (org_id, claimant_id, title, amount) values
  ('06960000-0000-0000-0000-0000000000a1', '06960000-0000-0000-0000-000000000005', 'oq claim eng', 10),
  ('06960000-0000-0000-0000-0000000000a1', '06960000-0000-0000-0000-000000000004', 'oq claim pm', 10),
  ('06960000-0000-0000-0000-0000000000b1', '06960000-0000-0000-0000-000000000008', 'oq claim b', 10);
insert into erp_gl_entry_mirror (org_id, erp_name, account, party_type, erp_modified) values
  ('06960000-0000-0000-0000-0000000000a1', 'GL-OQ-1', 'a', 'Employee', '2026-01-01'),
  ('06960000-0000-0000-0000-0000000000a1', 'GL-OQ-2', 'a', 'Supplier', '2026-01-01'),
  ('06960000-0000-0000-0000-0000000000b1', 'GL-OQ-3', 'a', 'Employee', '2026-01-01'),
  ('06960000-0000-0000-0000-0000000000b1', 'GL-OQ-4', 'a', 'Supplier', '2026-01-01');
insert into stock_units (id, org_id, code, name, whole_only) values
  ('06960000-0000-0000-0000-0000000000d1', '06960000-0000-0000-0000-0000000000a1', 'bag', 'Bag', true),
  ('06960000-0000-0000-0000-0000000000d2', '06960000-0000-0000-0000-0000000000b1', 'bag', 'Bag', true);
insert into stock_items (org_id, code, name, unit_id) values
  ('06960000-0000-0000-0000-0000000000a1', 'OQ1', 'oq item a', '06960000-0000-0000-0000-0000000000d1'),
  ('06960000-0000-0000-0000-0000000000b1', 'OQ2', 'oq item b', '06960000-0000-0000-0000-0000000000d2');

create temporary table q696_snap (phase text, caller text, probe text, outcome text);
grant all on q696_snap to public;

create function pg_temp.q696_snap(p_phase text) returns void language plpgsql as $f$
declare
  callers jsonb := jsonb_build_array(
    jsonb_build_object('c','admin','u','06960000-0000-0000-0000-000000000001','o','06960000-0000-0000-0000-0000000000a1','x','06960000-0000-0000-0000-000000000005','xo','06960000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','exec', 'u','06960000-0000-0000-0000-000000000002','o','06960000-0000-0000-0000-0000000000a1','x','06960000-0000-0000-0000-000000000005','xo','06960000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','fin',  'u','06960000-0000-0000-0000-000000000003','o','06960000-0000-0000-0000-0000000000a1','x','06960000-0000-0000-0000-000000000005','xo','06960000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','pm',   'u','06960000-0000-0000-0000-000000000004','o','06960000-0000-0000-0000-0000000000a1','x','06960000-0000-0000-0000-000000000005','xo','06960000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','eng',  'u','06960000-0000-0000-0000-000000000005','o','06960000-0000-0000-0000-0000000000a1','x','06960000-0000-0000-0000-000000000004','xo','06960000-0000-0000-0000-0000000000b1'),
    jsonb_build_object('c','adminB','u','06960000-0000-0000-0000-000000000008','o','06960000-0000-0000-0000-0000000000b1','x','06960000-0000-0000-0000-000000000001','xo','06960000-0000-0000-0000-0000000000a1'));
  caller jsonb; probes jsonb; pr jsonb; v text; n int; res text[]; labels text[];
begin
  for caller in select * from jsonb_array_elements(callers) loop
    probes := jsonb_build_object(
      -- reads: fingerprint + count of the rows the caller can see
      'notifications_ids', 'select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.notifications',
      'user_views_ids',    'select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.user_views',
      'expense_claims_ids','select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.expense_claims',
      'expense_claims_n',  'select count(*)::text from public.expense_claims',
      'gl_ids',            'select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.erp_gl_entry_mirror',
      'gl_n',              'select count(*)::text from public.erp_gl_entry_mirror',
      'stock_items_ids',   'select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.stock_items',
      'user_views_n',      'select count(*)::text from public.user_views',
      -- writes (each rolled back)
      'notif_ins_self',    format('insert into public.notifications (owner_id, org_id, title) values (%L, %L, ''p'')', caller->>'u', caller->>'o'),
      'notif_ins_other_owner', format('insert into public.notifications (owner_id, org_id, title) values (%L, %L, ''p'')', caller->>'x', caller->>'o'),
      'notif_ins_other_org',   format('insert into public.notifications (owner_id, org_id, title) values (%L, %L, ''p'')', caller->>'u', caller->>'xo'),
      'notif_upd',         'update public.notifications set title = title',
      'notif_del',         'delete from public.notifications',
      'uv_ins_self',       format('insert into public.user_views (org_id, user_id, name) values (%L, %L, ''p'')', caller->>'o', caller->>'u'),
      'uv_ins_other_user', format('insert into public.user_views (org_id, user_id, name) values (%L, %L, ''p'')', caller->>'o', caller->>'x'),
      'uv_upd',            'update public.user_views set name = name',
      'uv_del',            'delete from public.user_views',
      'si_del',            'delete from public.stock_items');
    res := '{}'; labels := '{}';
    perform set_config('request.jwt.claims', json_build_object('sub', caller->>'u', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    for pr in select jsonb_build_object('k', key, 'q', value) from jsonb_each_text(probes) loop
      begin
        if pr->>'k' ~ '_(ids|n)$' then
          execute pr->>'q' into v;
          labels := labels || (pr->>'k'); res := res || v;
        else
          execute pr->>'q'; get diagnostics n = row_count;
          raise exception using errcode = 'P0999', message = n::text;
        end if;
      exception when others then
        if sqlstate = 'P0999' then v := 'rows=' || sqlerrm; else v := 'err=' || sqlstate; end if;
        if pr->>'k' !~ '_(ids|n)$' then labels := labels || (pr->>'k'); res := res || v; end if;
      end;
    end loop;
    execute 'reset role';
    insert into q696_snap select p_phase, caller->>'c', l, o from unnest(labels, res) as t(l, o);
  end loop;
end $f$;

select pg_temp.q696_snap('new');

-- Restore the pre-0696 (per-row) definitions of the policies on the five tables under test.

alter policy erp_gl_entry_mirror_employee_read_scope on public.erp_gl_entry_mirror
  using (((party_type IS DISTINCT FROM 'Employee'::text) OR holds_spend_approval_authority(( SELECT auth_role() AS auth_role))));
alter policy expense_claims_insert on public.expense_claims
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (claimant_id = auth.uid()) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = expense_claims.project_id) AND (p.org_id = ( SELECT auth_org_id() AS auth_org_id))))))));
alter policy expense_claims_select on public.expense_claims
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ((claimant_id = auth.uid()) OR holds_spend_approval_authority(( SELECT auth_role() AS auth_role)))));
alter policy expense_claims_update on public.expense_claims
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (claimant_id = auth.uid()) AND (status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (claimant_id = auth.uid()) AND (status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = expense_claims.project_id) AND (p.org_id = ( SELECT auth_org_id() AS auth_org_id))))))));
alter policy notifications_delete on public.notifications
  using (((owner_id = auth.uid()) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy notifications_insert on public.notifications
  with check (((owner_id = auth.uid()) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy notifications_select on public.notifications
  using (((owner_id = auth.uid()) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy notifications_update on public.notifications
  using (((owner_id = auth.uid()) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = auth.uid()) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy stock_items_delete on public.stock_items
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND stock_admin() AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_items_insert on public.stock_items
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND stock_master_writer() AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_items_update on public.stock_items
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND stock_master_writer() AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND stock_master_writer() AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy user_views_delete on public.user_views
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = auth.uid()) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)));
alter policy user_views_insert on public.user_views
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (user_id = auth.uid()) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)));
alter policy user_views_select on public.user_views
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = auth.uid()) OR (scope = 'shared_org'::text)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy user_views_update on public.user_views
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = auth.uid()) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = auth.uid()) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)));

select pg_temp.q696_snap('old');

-- ── §3 assertions ──
select ok((select count(*) from q696_snap where phase = 'new') >= 6 * 18 and (select count(*) from q696_snap where phase = 'new') = (select count(*) from q696_snap where phase = 'old'),
  'AC-OQ-EQ-001 both phases recorded every probe for every caller');
select is_empty($$select * from (select caller, probe, outcome from q696_snap where phase = 'new' except select caller, probe, outcome from q696_snap where phase = 'old') d$$,
  'AC-OQ-EQ-002 nothing the callers see or may write changed (new minus old is empty)');
select is_empty($$select * from (select caller, probe, outcome from q696_snap where phase = 'old' except select caller, probe, outcome from q696_snap where phase = 'new') d$$,
  'AC-OQ-EQ-003 and old minus new is empty');

-- Anti-vacuity: the probes distinguish the roles and tenants, so equality above is not equality of nothing.
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'gl_n'), '2', 'AC-OQ-EQ-004 org A Admin sees both org-A ledger rows (Employee row via spend authority)');
select is((select outcome from q696_snap where phase = 'new' and caller = 'pm' and probe = 'gl_n'), '0', 'AC-OQ-EQ-005 a Project Manager sees no ledger rows (role gate)');
select is((select outcome from q696_snap where phase = 'new' and caller = 'adminB' and probe = 'gl_n'), '2', 'AC-OQ-EQ-006 org B Admin sees exactly its own two ledger rows');
select is((select outcome from q696_snap where phase = 'new' and caller = 'eng' and probe = 'expense_claims_n'), '1', 'AC-OQ-EQ-007 an Engineer sees only their own expense claim');
select is((select outcome from q696_snap where phase = 'new' and caller = 'pm' and probe = 'expense_claims_n'), '2', 'AC-OQ-EQ-008 a Project Manager (spend authority) sees every org-A claim and none of org B');
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'notif_ins_self'), 'rows=1', 'AC-OQ-EQ-009 a caller may insert their own notification');
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'notif_ins_other_org'), 'err=42501', 'AC-OQ-EQ-010 inserting a notification into a foreign org is denied');
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'notif_ins_other_owner'), 'err=42501', 'AC-OQ-EQ-011 inserting a notification owned by someone else is denied');
select is((select outcome from q696_snap where phase = 'new' and caller = 'eng' and probe = 'si_del'), 'rows=0', 'AC-OQ-EQ-012 an Engineer deletes zero stock items (stock_admin gate)');
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'si_del'), 'rows=1', 'AC-OQ-EQ-013 an Admin deletes exactly the one org-A stock item (never org B)');
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'notif_del'), 'rows=1', 'AC-OQ-EQ-014 a caller deletes only their own notification (not org-mates, not the foreign org)');
select is((select outcome from q696_snap where phase = 'new' and caller = 'admin' and probe = 'user_views_n'), '2', 'AC-OQ-EQ-015 a caller sees their own view plus the shared one, never org B');

select * from finish();
rollback;
