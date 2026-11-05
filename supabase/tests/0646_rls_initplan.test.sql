-- 0646_rls_initplan.test.sql — #1254.
-- Migration under test: supabase/migrations/0646_rls_caller_initplans.sql (+ rollback/0646_..._down.sql).
--
-- ── WHAT THIS FILE IS ─────────────────────────────────────────────────────────────────────────────
--   §1  The STANDING GUARD: no policy in public/storage may call a caller-context helper directly.
--       Every such call must be the scalar-subselect form — (select public.auth_org_id()) — so the
--       planner resolves it once per statement (InitPlan) instead of once per scanned row. This is
--       catalog-derived, so it also binds policies that do not exist yet.
--   §2  The guard's own SELF-TEST (§2), because a detector that silently matches nothing looks
--       exactly like a passing detector. Temporary policies are created with a bare call, a wrapped
--       call, a mixed one, a nested one, and argument-taking/other-schema expressions, and the
--       detector is run on PostgreSQL's own deparse output (pg_policies), not on hand-written text.
--   §3  The behaviour proof: the same access matrix the pre-0646 predicates enforced, exercised
--       under real authenticated JWTs — own/foreign org, writer/engineer roles, active/disabled/
--       future-banned/expired-ban/no-profile callers, USING and WITH CHECK independently, a
--       restrictive⊕permissive composition, cross-statement claim switches, and the one restrictive
--       storage policy that references the Same helpers.
--
-- ⚑ The detector is bounded and token-aware, not a blanket lookbehind: an occurrence counts as
-- BARE only when the call itself is not the sole expression of an enclosing scalar sub-select.
-- A "this expression mentions no helper at all" test would go green on a policy that mentions the
-- helper nine times around one scalar SELECT — §2's mixed case is exactly that shape.
-- =================================================================================================

begin;
select plan(41);

-- ⚑ SCOPE BOUNDARY: the approved caller-context set is public.auth_org_id(), public.auth_role(),
-- public.is_active_member() and public.is_operator(). auth.uid()/auth.jwt() are OUT of scope, and the
-- public.profiles is left byte-identical as a RELATION (all six policies): it is the only relation with
-- policies that reference their own table in a subquery, and the isolation matrix (diag attempt
-- 20261104T185507Z) showed that wrapping profiles_select ALONE reproduces 42P17 on the three real
-- profiles UPDATEs, while profiles_hierarchy_update alone, profiles_admin_insert alone and
-- profiles_admin_delete alone are green. Rather than generalise a per-command rule from that, the whole
-- relation stays untouched — the remaining INSERT/DELETE wrappers had no demonstrated material gain. §2's
-- control 5 pins that boundary: auth.uid() is not counted as bare OR wrapped, so a future change that
-- starts wrapping it has to update this file deliberately rather than slip through.
--
-- ── The detector, defined ONCE and used by both §1 and §2 ────────────────────────────────────────
-- Returns the number of BARE eligible calls in an expression:
--   total eligible zero-argument calls - calls that are the sole expression of a scalar sub-select.
-- Argument-taking overloads (public.is_active_member(uuid)) and other schemas cannot match the
-- zero-argument / schema-anchored patterns, so they are never counted either way.
-- Argument-taking overloads, already-wrapped calls and string literals cannot be bare calls, and the
-- detector must not count them. String literals are neutralised first: a policy may legitimately
-- compare against text that reads like a call ('auth_org_id()'), and that must not redden CI.
create function pg_temp.q12_strip_literals(expr text) returns text
language sql immutable as $$
  select regexp_replace(coalesce(expr, ''), '''([^'']|'''')*''', '''''', 'g')
$$;

create function pg_temp.q12_total_calls(expr text) returns integer
language plpgsql immutable as $$
declare
  total int := 0;
  n     text;
  v     text;
begin
  v := pg_temp.q12_strip_literals(expr);
  if v is null or v = '' then return 0; end if;
  foreach n in array array['auth_org_id','auth_role','is_active_member','is_operator'] loop
    total := total + (select count(*) from regexp_matches(v,
      '(^|[^.[:alnum:]_])(public\.)?' || n || '[[:space:]]*\([[:space:]]*\)', 'gi'));
  end loop;
  return total;
end $$;

create function pg_temp.q12_wrapped_calls(expr text) returns integer
language plpgsql immutable as $$
declare
  wrapped int := 0;
  n       text;
  v       text;
begin
  v := pg_temp.q12_strip_literals(expr);
  if v is null or v = '' then return 0; end if;
  foreach n in array array['auth_org_id','auth_role','is_active_member','is_operator'] loop
    wrapped := wrapped + (select count(*) from regexp_matches(v,
      '\([[:space:]]*select[[:space:]]+(public\.)?' || n
      || '[[:space:]]*\([[:space:]]*\)[[:space:]]*(as[[:space:]]+[[:alnum:]_]+)?[[:space:]]*\)', 'gi'));
  end loop;
  return wrapped;
end $$;

create function pg_temp.q12_bare_calls(expr text) returns integer
language sql immutable as $$
  select greatest(pg_temp.q12_total_calls(expr) - pg_temp.q12_wrapped_calls(expr), 0)
$$;

-- Relations with self-referential policies are exempt as a whole: all six profiles policies
-- remain unchanged. Adding a sublink to this relation's policy set caused recursion in the
-- observed profile update path. §4 pins the relation-wide exemption.
create temporary view q12_selfref_relations as
select distinct schemaname, tablename
  from pg_policies
 where schemaname in ('public', 'storage')
   and (coalesce(qual, '') ~* ('from[[:space:]]+(public\.)?' || tablename || '\M')
     or coalesce(with_check, '') ~* ('from[[:space:]]+(public\.)?' || tablename || '\M'));

create temporary view q12_violations as
select p.schemaname, p.tablename, p.policyname, p.cmd,
       pg_temp.q12_bare_calls(p.qual)       as bare_using,
       pg_temp.q12_bare_calls(p.with_check) as bare_with_check,
       p.qual, p.with_check
  from pg_policies p
 where p.schemaname in ('public', 'storage')
   and not exists (select 1 from q12_selfref_relations r
                    where r.schemaname = p.schemaname
                      and r.tablename = p.tablename);

-- ── §1 — THE GATE ────────────────────────────────────────────────────────────────────────────────
select is_empty(
  $$select schemaname || '.' || tablename || ' ' || policyname || ' (' || cmd || ') bare USING='
      || bare_using || ' bare WITH CHECK=' || bare_with_check
      from q12_violations where bare_using + bare_with_check > 0$$,
  'AC-IP-GUARD-001 no public/storage policy calls a caller-context helper per row (all are scalar-selected)');

-- Anti-vacuity: the gate must scan a real catalog with real input. A detector whose denominator is
-- empty is not a passing detector.
select ok(
  (select count(*) from q12_violations) >= 150,
  'AC-IP-GUARD-002 the gate scans at least 150 public/storage policies');

select ok(
  (select coalesce(sum(pg_temp.q12_wrapped_calls(qual) + pg_temp.q12_wrapped_calls(with_check)), 0)
     from pg_policies where schemaname in ('public', 'storage')) >= 200,
  'AC-IP-GUARD-003 at least 200 scalar-selected caller-context calls exist (the guard has real input)');

-- 0333 shipped the first statement-snapshot policy. 0646 must ADD wrappers, never unwrap what a
-- previous migration already wrapped: that policy keeps its five scalar selects and gains none of
-- the per-row form back.
select is(
  (select pg_temp.q12_wrapped_calls(qual) from pg_policies
    where schemaname = 'public' and policyname = 'erp_financial_statement_snapshot_select'),
  5,
  'AC-IP-GUARD-004 the pre-existing 0333 statement-snapshot policy keeps exactly its five scalar selects');

-- ── §2 — SELF-TEST: the detector must detect, and must not over-detect ───────────────────────────
-- A temporary table (its policies are outside public/storage by construction, so it cannot pollute
-- §1) carrying the shapes the detector has to tell apart. Expressions are read back from pg_policies
-- so the detector is proven against PostgreSQL's own deparse formatting, not a hand-written string.
create table pg_temp.q12_ip_control (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid,
  ref_id uuid,
  note   text
);
alter table pg_temp.q12_ip_control enable row level security;

-- control 1: two bare calls.
create policy q12_control_bare on pg_temp.q12_ip_control for select
  using (org_id = auth_org_id() and is_active_member());

-- control 2: the correct form, both calls wrapped.
create policy q12_control_wrapped on pg_temp.q12_ip_control for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- control 3: MIXED — one wrapped call and one bare call in USING, and the reverse in WITH CHECK.
-- This is the shape a whole-expression "is it wrapped?" check goes green on.
create policy q12_control_mixed on pg_temp.q12_ip_control for all
  using (org_id = (select public.auth_org_id()) and auth_role() = 'Admin')
  with check (org_id = (select public.auth_org_id()) and is_active_member());

-- control 4: a bare call inside a nested subquery.
create policy q12_control_nested on pg_temp.q12_ip_control for select
  using (exists (select 1 from public.projects pz where pz.id = ref_id and pz.org_id = auth_org_id()));

-- control 5: NOT violations — an argument-taking overload, a string literal that reads like a call, and
-- both forms of the out-of-scope auth.uid() (bare AND wrapped). The detector must count none of them, in
-- either direction: that is the scope boundary from the header.
create policy q12_control_unrelated on pg_temp.q12_ip_control for select
  using (id = auth.uid()
         or id = (select auth.uid())
         or is_active_member('00000000-0000-0000-0000-000000000001'::uuid)
         or note = 'auth_org_id()');

select is(
  (select pg_temp.q12_bare_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_bare'),
  2, 'AC-IP-GUARD-005 detector: two bare calls are two violations');
select is(
  (select pg_temp.q12_bare_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_wrapped'),
  0, 'AC-IP-GUARD-006 detector: the scalar-selected form is not a violation');
select is(
  (select pg_temp.q12_wrapped_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_wrapped'),
  2, 'AC-IP-GUARD-007 detector: and it is recognised as wrapped (positive polarity, not silence)');
select is(
  (select pg_temp.q12_bare_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_mixed'),
  1, 'AC-IP-GUARD-008 detector: a MIXED USING clause still reports its one bare call');
select is(
  (select pg_temp.q12_bare_calls(with_check) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_mixed'),
  1, 'AC-IP-GUARD-009 detector: WITH CHECK is examined separately from USING');
select is(
  (select pg_temp.q12_bare_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_nested'),
  1, 'AC-IP-GUARD-010 detector: a bare call inside a nested subquery is a violation');
select is(
  (select pg_temp.q12_bare_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_unrelated'),
  0, 'AC-IP-GUARD-011 detector: argument-taking overloads, string literals and the out-of-scope auth.uid() are not bare calls');
select is(
  (select pg_temp.q12_wrapped_calls(qual) from pg_policies where tablename = 'q12_ip_control' and policyname = 'q12_control_unrelated'),
  0, 'AC-IP-GUARD-012 detector: the out-of-scope auth.uid() counts as neither bare nor wrapped — the scope boundary is pinned');

-- ── §3 — BEHAVIOUR: the access matrix the rewritten predicates must still enforce ───────────────
-- Fixtures: two orgs, one project trio in org A and a pair in org B, and the caller states that the
-- caller-context helpers distinguish (active / disabled / banned / expired ban / no profile).
insert into organizations (id, name) values
  ('06460000-0000-0000-0000-0000000000a1', 'IP Org A'),
  ('06460000-0000-0000-0000-0000000000b1', 'IP Org B');

insert into auth.users (id, email, banned_until) values
  ('06460000-0000-0000-0000-000000000001', 'ip-admin-a@example.com',   null),
  ('06460000-0000-0000-0000-000000000002', 'ip-pm-a@example.com',      null),
  ('06460000-0000-0000-0000-000000000003', 'ip-eng-a@example.com',     null),
  ('06460000-0000-0000-0000-000000000004', 'ip-disabled-a@example.com', null),
  ('06460000-0000-0000-0000-000000000005', 'ip-banned-a@example.com',  now() + interval '1 year'),
  ('06460000-0000-0000-0000-000000000006', 'ip-expired-a@example.com', now() - interval '1 day'),
  ('06460000-0000-0000-0000-000000000007', 'ip-noprofile@example.com', null),
  ('06460000-0000-0000-0000-000000000008', 'ip-admin-b@example.com',   null);

insert into profiles (id, org_id, full_name, email, role, status) values
  ('06460000-0000-0000-0000-000000000001', '06460000-0000-0000-0000-0000000000a1', 'IP Admin A',    'ip-admin-a@example.com',   'Admin',             'active'),
  ('06460000-0000-0000-0000-000000000002', '06460000-0000-0000-0000-0000000000a1', 'IP PM A',       'ip-pm-a@example.com',      'Project Manager',   'active'),
  ('06460000-0000-0000-0000-000000000003', '06460000-0000-0000-0000-0000000000a1', 'IP Engineer A', 'ip-eng-a@example.com',     'Engineer',          'active'),
  ('06460000-0000-0000-0000-000000000004', '06460000-0000-0000-0000-0000000000a1', 'IP Disabled A', 'ip-disabled-a@example.com','Admin',             'disabled'),
  ('06460000-0000-0000-0000-000000000005', '06460000-0000-0000-0000-0000000000a1', 'IP Banned A',   'ip-banned-a@example.com',  'Admin',             'active'),
  ('06460000-0000-0000-0000-000000000006', '06460000-0000-0000-0000-0000000000a1', 'IP Expired A',  'ip-expired-a@example.com', 'Project Manager',   'active'),
  ('06460000-0000-0000-0000-000000000008', '06460000-0000-0000-0000-0000000000b1', 'IP Admin B',    'ip-admin-b@example.com',   'Admin',             'active');

insert into projects (id, org_id, name, status, project_manager_id) values
  ('06460000-0000-0000-0000-0000000c0001', '06460000-0000-0000-0000-0000000000a1', 'IP A1', 'Ongoing Project', '06460000-0000-0000-0000-000000000002'),
  ('06460000-0000-0000-0000-0000000c0002', '06460000-0000-0000-0000-0000000000a1', 'IP A2', 'Ongoing Project', '06460000-0000-0000-0000-000000000002'),
  ('06460000-0000-0000-0000-0000000c0003', '06460000-0000-0000-0000-0000000000a1', 'IP A3', 'Ongoing Project', '06460000-0000-0000-0000-000000000002'),
  ('06460000-0000-0000-0000-0000000d0001', '06460000-0000-0000-0000-0000000000b1', 'IP B1', 'Ongoing Project', '06460000-0000-0000-0000-000000000008'),
  ('06460000-0000-0000-0000-0000000d0002', '06460000-0000-0000-0000-0000000000b1', 'IP B2', 'Ongoing Project', '06460000-0000-0000-0000-000000000008');

-- external_refs carries exactly ONE permissive policy for SELECT — of the form
-- (org_id = auth_org_id() AND is_active_member()) — so it isolates each conjunct without another
-- policy ORing the row back in. That makes it the security-mutation target: flipping its org
-- predicate to true must break MUTATION-001/002, and dropping its membership conjunct must break
-- MUTATION-003, while every other assertion stays green.
insert into external_refs (id, org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('06460000-0000-0000-0000-0000000f0001', '06460000-0000-0000-0000-0000000000a1', 'clickup', 'IP-A', 'pmo', 'ext-a'),
  ('06460000-0000-0000-0000-0000000f0002', '06460000-0000-0000-0000-0000000000b1', 'clickup', 'IP-B', 'pmo', 'ext-b');

-- The denials below must be RLS denials, not unreachable tables: the authenticated role holds the
-- grants on both tables this section exercises (role_table_grants, not policy presence, decides that).
select ok(has_table_privilege('authenticated', 'public.projects', 'SELECT,INSERT,UPDATE,DELETE'),
  'AC-IP-GRANT-001 authenticated holds SELECT/INSERT/UPDATE/DELETE on public.projects (denials are RLS, not grants)');
select ok(has_table_privilege('authenticated', 'storage.objects', 'SELECT,INSERT,UPDATE,DELETE'),
  'AC-IP-GRANT-002 authenticated holds SELECT/INSERT/UPDATE/DELETE on storage.objects (denials are RLS, not grants)');

-- ── active Admin of org A ──
-- New rows are created as 'Leads': 0173's origination trigger (P0001) rejects any other status at
-- create time for a user JWT, and these assertions must be decided by RLS alone, not by that trigger.
set local role authenticated;
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from projects), 3,
  'AC-IP-TENANT-001 active Admin A reads all three org-A projects in one statement (per-row evaluation still works)');
select is((select count(*)::int from projects where org_id = '06460000-0000-0000-0000-0000000000b1'), 0,
  'AC-IP-TENANT-002 active Admin A reads zero org-B projects');
select lives_ok(
  $$insert into projects (org_id, name, status) values ('06460000-0000-0000-0000-0000000000a1','IP A4','Leads')$$,
  'AC-IP-TENANT-003 active Admin A may insert an own-org project (WITH CHECK admits the caller''s org)');
select throws_ok(
  $$insert into projects (org_id, name, status) values ('06460000-0000-0000-0000-0000000000b1','IP spoofed','Leads')$$,
  '42501', null,
  'AC-IP-TENANT-004 active Admin A may not insert a foreign-org project (WITH CHECK denies)');
with changed as (update projects set name = 'IP B1 hacked' where id = '06460000-0000-0000-0000-0000000d0001' returning 1)
select is((select count(*)::int from changed), 0,
  'AC-IP-TENANT-005 a foreign-org UPDATE matches zero rows (USING denies)');
with changed as (delete from projects where id = '06460000-0000-0000-0000-0000000d0001' returning 1)
select is((select count(*)::int from changed), 0,
  'AC-IP-TENANT-006 a foreign-org DELETE matches zero rows (USING denies)');
select throws_ok(
  $$update projects set org_id = '06460000-0000-0000-0000-0000000000b1' where id = '06460000-0000-0000-0000-0000000c0001'$$,
  '42501', null,
  'AC-IP-TENANT-007 moving an own-org row to a foreign org is denied by WITH CHECK (independent of USING)');

-- ── active Engineer of org A: reads in-org, may not write ──
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from projects), 4,
  'AC-IP-TENANT-008 active Engineer A still reads every org-A project (read gate is org+membership, not role)');
with changed as (update projects set name = 'IP A1 eng' where id = '06460000-0000-0000-0000-0000000c0001' returning 1)
select is((select count(*)::int from changed), 0,
  'AC-IP-ROLE-001 an Engineer UPDATE in its own org matches zero rows (writer-role gate in USING)');
select throws_ok(
  $$insert into projects (org_id, name, status) values ('06460000-0000-0000-0000-0000000000a1','IP eng insert','Leads')$$,
  '42501', null,
  'AC-IP-ROLE-002 an Engineer INSERT in its own org is denied (writer-role gate in WITH CHECK)');

-- ── caller states that the membership helper distinguishes ──
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from projects), 0,
  'AC-IP-STATUS-001 a disabled member reads zero rows (is_active_member conjunct)');
select throws_ok(
  $$insert into projects (org_id, name, status) values ('06460000-0000-0000-0000-0000000000a1','IP disabled','Leads')$$,
  '42501', null,
  'AC-IP-STATUS-002 a disabled member may not insert (membership conjunct in WITH CHECK)');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from projects), 0,
  'AC-IP-STATUS-003 a member whose ban is still in force reads zero rows (active profile, future banned_until)');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from projects), 4,
  'AC-IP-STATUS-004 a member whose ban has expired reads every org-A project (no lock-out regression)');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((select count(*)::int from projects), 0,
  'AC-IP-STATUS-005 a caller with no profile row reads zero rows (NULL org from auth_org_id, not an error)');

-- ── the security-mutation target: single-policy table, org AND membership conjuncts ──
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from external_refs), 1,
  'AC-IP-MUTATION-001 active Admin A reads exactly one external ref: its own org''s (mutation: org predicate -> true)');
select is((select count(*)::int from external_refs where org_id = '06460000-0000-0000-0000-0000000000b1'), 0,
  'AC-IP-MUTATION-002 the other org''s external ref stays invisible (mutation: org predicate -> true)');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from external_refs), 0,
  'AC-IP-MUTATION-003 a disabled caller reads zero external refs (mutation: membership conjunct removed)');

-- ── claim context changes between statements: nothing may be cached across statements ──
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000008","role":"authenticated"}';
select is((select count(*)::int from projects), 2,
  'AC-IP-CACHE-001 switching the JWT to org B between statements reads exactly org B''s two projects');
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from projects), 4,
  'AC-IP-CACHE-002 switching back to org A re-resolves the caller (no cross-statement caching)');

-- ── restrictive ⊕ permissive composition: projects_delete_admin_only stays ANDed in ──
set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000002","role":"authenticated"}';
with changed as (delete from projects where id = '06460000-0000-0000-0000-0000000c0003' returning 1)
select is((select count(*)::int from changed), 0,
  'AC-IP-RESTRICTIVE-001 a Project Manager (permissive writer) deletes zero rows: the restrictive Admin-only policy still applies');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000001","role":"authenticated"}';
with changed as (delete from projects where id = '06460000-0000-0000-0000-0000000c0003' returning 1)
select is((select count(*)::int from changed), 1,
  'AC-IP-RESTRICTIVE-002 an Admin deletes the same own-org row (control: the restrictive policy is not a blanket deny)');

-- ── the storage policy that references the same helpers (restrictive, on storage.objects) ──
reset role;
insert into project_documents (id, org_id, project_id, category, title, status, author_id) values
  ('06460000-0000-0000-0000-0000000e0001', '06460000-0000-0000-0000-0000000000a1',
   '06460000-0000-0000-0000-0000000c0001', 'Drawing', 'IP Doc', 'Draft', '06460000-0000-0000-0000-000000000002');
set local role authenticated;

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('project-documents',
      '06460000-0000-0000-0000-0000000000a1/06460000-0000-0000-0000-0000000c0001/06460000-0000-0000-0000-0000000e0001/author.pdf')$$,
  'AC-IP-STORAGE-001 the document author may add an object at that document''s canonical path (restrictive policy admits)');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000008","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('project-documents',
      '06460000-0000-0000-0000-0000000000a1/06460000-0000-0000-0000-0000000c0001/06460000-0000-0000-0000-0000000e0001/foreign.pdf')$$,
  '42501', null,
  'AC-IP-STORAGE-002 a foreign-org Admin may not add an object to an org-A document path (restrictive policy still denies)');

set local request.jwt.claims = '{"sub":"06460000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('project-documents',
      '06460000-0000-0000-0000-0000000000a1/06460000-0000-0000-0000-0000000c0001/06460000-0000-0000-0000-0000000e0001/disabled.pdf')$$,
  '42501', null,
  'AC-IP-STORAGE-003 a disabled caller may not add an object (membership conjunct in the restrictive policy)');

reset role;

-- ── §4 — GUARD COVERAGE: the self-referential exemption is exactly one relation ──
select is_empty(
  $$select schemaname || '.' || tablename from q12_selfref_relations
     where schemaname || '.' || tablename not in ('public.profiles')$$,
  'AC-IP-GUARD-013 the only exemption from the gate is the pinned self-referential relation (a new one must be reviewed, not silently exempted)');

select is_empty(
  $$select v from (values ('public.profiles')) t(v)
     where not exists (select 1 from q12_selfref_relations r
                        where r.schemaname || '.' || r.tablename = t.v)$$,
  'AC-IP-GUARD-014 the pinned exempt relation still exists and still owns a self-referential policy (the exemption cannot rot)');

select * from finish();
rollback;
