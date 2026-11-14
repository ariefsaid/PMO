-- AC-PLN-009 / AC-PLN-010 [pgTAP] — plan limits: seats and active projects (FR-PLN-010/011, D11/D12).
--
-- Seat authority: the count is `profiles.status = 'active'` in the org. A pending invite IS that row —
-- the admin-invite-user edge fn writes it at issuance (supabase/functions/admin-invite-user/index.ts:157)
-- — so "active members + pending invites" needs no reservation table. What makes the count exact is
-- that the lock, the count and the row write happen in ONE transaction: the profiles AFTER INSERT
-- trigger holds the organisations row lock while it counts and rolls back an over-limit row.
--
-- ⚑ The organisation row lock covers the ROW WRITE, never the invite email. The external
-- `inviteUserByEmail` call happens after the authorising transaction ends, so the trigger — not the
-- pre-issuance `assert_seat_available` — is the authority. A pending account is kept when the
-- insert is refused and adopted by the next successful invite.
--
-- Concurrency proof (modelled on 0163_automation_cap_race.test.sql: a genuine second session via
-- dblink holds the SAME organisations row FOR NO KEY UPDATE, and both the RPC and a concurrent profiles
-- INSERT are asserted to BLOCK on it — 55P03 under a short lock_timeout — rather than sail through).
-- It runs FIRST and it locks an organisation this transaction never writes: a row lock is held to the
-- end of the transaction, so a fixture insert into the SAME org would make this session hold the lock
-- the second session is waiting for, and the synchronous `dblink()` call would then wait forever — a
-- self-deadlock across two connections that nothing can detect (0163's header warns about it).
--
-- ⚑ It locks the DEFAULT organisation, which already exists and always resolves Enterprise (unlimited):
-- no fixture has to be COMMITTED for the second session to see a row, so this file commits nothing,
-- and both extensions are created INSIDE the transaction. That also closes 0163's FR-CPS-050 leak
-- (it must create dblink outside so its post-rollback cleanup can run; nothing here needs that). The
-- trailing `drop extension if exists` is unconditional, so a run still heals a leak left by an earlier
-- aborted file.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
create extension if not exists pgrowlocks;
select plan(48);

select ok(
  (select (tgtype & 2) = 0 from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_zy_plan_org_guard'),
  'AC-PLN-009 the profile org guard runs after row authorization');
select ok(
  (select (tgtype & 2) = 0 from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_zz_plan_seat_guard'),
  'AC-PLN-009 the seat cap runs after row authorization and immutable-org enforcement');

-- ⚑ THE LOCK PROOF RUNS ON AN ORGANIZATION ROW THIS TRANSACTION NEVER MODIFIES, and that is the whole trick.
-- `plan_enforce_seat_limit` locks the organisation row before counting (as it must), and a row lock is
-- held to the END of the transaction — so a successful fixture write to the org the second session locks
-- would make this session hold that lock, the second session wait on it, and the synchronous `dblink()` call wait
-- forever: a self-deadlock across two connections that nothing can detect. The DEFAULT organisation is
-- used because it exists without an organization fixture; this transaction assigns it Starter so the
-- cap takes its bounded-plan lock. The caller is an OPERATOR of another org, so the RPC's authority
-- check passes without this transaction writing to the locked organization row.
--
-- Every second-session statement also carries its own lock/statement timeout, so the competing session
-- can never hang the suite — it can only fail fast.
-- FOR NO KEY UPDATE is deliberate: the profile's auth/org foreign keys take KEY SHARE, which is
-- compatible with this lock, so the INSERT must reach the AFTER seat guard to satisfy its wait check.
insert into organizations (id, name) values
  ('0535a000-0000-0000-0000-000000000002', 'Plan Limits B Enterprise');
update public.org_plans
   set plan_id = 'starter'
 where org_id = '00000000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('0535a000-0000-0000-0000-0000000000b9','plan-limits-b9@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0535a000-0000-0000-0000-0000000000b9','0535a000-0000-0000-0000-000000000002','Plan Limits Operator','plan-limits-b9@example.invalid','Finance','active');
select ok(
  not exists (
    select 1
      from pgrowlocks('public.organizations') l
      join public.organizations o on o.ctid = l.locked_row
     where o.id = '0535a000-0000-0000-0000-000000000002'
       and l.modes && array['For Share','For No Key Update','For Update']::text[]
  ),
  'AC-PLN-009 inserting a profile on an unlimited org does not take an org row lock');
insert into public.projects (org_id, name, status)
values ('0535a000-0000-0000-0000-000000000002', 'Plan Limits B Unlimited Lock Probe', 'Ongoing Project');
select ok(
  not exists (
    select 1
      from pgrowlocks('public.organizations') l
      join public.organizations o on o.ctid = l.locked_row
     where o.id = '0535a000-0000-0000-0000-000000000002'
       and l.modes && array['For Share','For No Key Update','For Update']::text[]
  ),
  'AC-PLN-010 inserting a project on an unlimited org does not take an org row lock');
insert into platform_operators (user_id) values ('0535a000-0000-0000-0000-0000000000b9');

select dblink_connect('cap', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
-- AFTER triggers run only after the profile's auth.users FK and RLS checks. Commit the disposable
-- auth row through dblink so this session can reach the guard while the cap connection owns the org.
select dblink_exec('cap', $setup$
  insert into auth.users (id, email)
  values ('0535a000-0000-0000-0000-0000000000ca', 'plan-limits-lock-ca@example.invalid')
  on conflict (id) do nothing
$setup$);
select dblink_exec('cap', 'begin');
-- Hang guard: if this session ever has to wait, it gives up in seconds instead of blocking the suite.
select dblink_exec('cap', $s1$set lock_timeout = '2s'$s1$);
select dblink_exec('cap', $s2$set statement_timeout = '5s'$s2$);
select ok(
  (select count(*)::int from dblink('cap', $q$
     select id from public.organizations
      where id = '00000000-0000-0000-0000-000000000001' for no key update$q$) as t(id uuid)) = 1,
  'AC-PLN-009 setup: a second session holds the default org row FOR NO KEY UPDATE');

-- The waiting side gives up after 1500 ms — `lock_timeout` (not statement_timeout) fires ONLY on a
-- lock wait, so neither assertion can be satisfied by a merely-slow statement.
set local lock_timeout = '1500ms';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select throws_ok(
  $$ select public.assert_seat_available('00000000-0000-0000-0000-000000000001') $$,
  '55P03', null,
  'AC-PLN-009 assert_seat_available WAITS for the organisation row lock (drop the lock and it sails through)');
reset role;
-- ⚑ The claims go too: 0074's stamp would rewrite the seed-org literal in the fixture to the caller's
-- org (b9's org B), and the seat check would then lock the wrong organisation and not block.
reset request.jwt.claims;
select throws_ok(
  $$ insert into public.profiles (id, org_id, full_name, email, role, status)
     values ('0535a000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-000000000001',
             'Plan Limits Lock Two','plan-limits-lock-two@example.invalid','Finance','active') $$,
  '55P03', null,
  'AC-PLN-009 a concurrent profiles INSERT WAITS for the organisation row lock (the AFTER seat trigger locks before it counts)');
set local lock_timeout = 0;

select is(
  (select count(*)::int from public.profiles
    where id = '0535a000-0000-0000-0000-0000000000ca'),
  0,
  'AC-PLN-009 the blocked invite created no profile row (it never got past the lock)');
select dblink_exec('cap', 'rollback');
select dblink_exec('cap', $cleanup$
  delete from auth.users where id = '0535a000-0000-0000-0000-0000000000ca'
$cleanup$);
select dblink_disconnect('cap');
reset request.jwt.claims;   -- the remaining fixtures are written by the migration runner, not a caller

-- ── The rest of the fixtures live in THIS transaction (rolled back at the end) ───────────────────
insert into organizations (id, name) values
  ('0535a000-0000-0000-0000-000000000001', 'Plan Limits A Starter'),
  ('0535a000-0000-0000-0000-000000000003', 'Plan Limits C Growth'),
  ('0535a000-0000-0000-0000-000000000004', 'Plan Limits D Downgraded');
insert into auth.users (id, email) values
  ('0535a000-0000-0000-0000-0000000000a1','plan-limits-a1@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a2','plan-limits-a2@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a3','plan-limits-a3@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a4','plan-limits-a4@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a5','plan-limits-a5@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a6','plan-limits-a6@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a7','plan-limits-a7@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a8','plan-limits-a8@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000a9','plan-limits-a9@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000aa','plan-limits-aa@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000ab','plan-limits-ab@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000ac','plan-limits-ac@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000b1','plan-limits-b1@example.invalid'),
  ('0535a000-0000-0000-0000-0000000000d1','plan-limits-d1@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0535a000-0000-0000-0000-0000000000a1','0535a000-0000-0000-0000-000000000001','Plan Limits A Admin','plan-limits-a1@example.invalid','Admin','active'),
  ('0535a000-0000-0000-0000-0000000000b1','0535a000-0000-0000-0000-000000000002','Plan Limits B Admin','plan-limits-b1@example.invalid','Admin','active'),
  ('0535a000-0000-0000-0000-0000000000d1','0535a000-0000-0000-0000-000000000004','Plan Limits D Admin','plan-limits-d1@example.invalid','Admin','active');
insert into org_plans (org_id, plan_id) values
  ('0535a000-0000-0000-0000-000000000001','starter'),
  ('0535a000-0000-0000-0000-000000000003','growth');
-- Starter disables the pipeline module. Enable it for this fixture so the revival checks exercise
-- the project-cap guard rather than stopping at transition_project's independent feature gate.
insert into public.org_features (org_id, feature_key, enabled)
values ('0535a000-0000-0000-0000-000000000001', 'sales_pipeline', true);

-- 9 more active members in A (a2..aa) and one disabled (ab) — the invariant is asserted below.
insert into profiles (id, org_id, full_name, email, role, status)
select ('0535a000-0000-0000-0000-0000000000' || x)::uuid,
       '0535a000-0000-0000-0000-000000000001',
       'Plan Limits A ' || x,
       'plan-limits-' || x || '@example.invalid',
       'Finance', 'active'
  from unnest(array['a2','a3','a4','a5','a6','a7','a8','a9','aa']) x;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0535a000-0000-0000-0000-0000000000ab','0535a000-0000-0000-0000-000000000001',
   'Plan Limits A Disabled','plan-limits-ab@example.invalid','Finance','disabled');

select is(public.org_seat_usage('0535a000-0000-0000-0000-000000000001'),
  10, 'AC-PLN-009 seat usage counts the 10 active members and ignores a disabled one');
select is((select seat_limit from public.org_plan_limits('0535a000-0000-0000-0000-000000000001')),
  10, 'AC-PLN-009 the org limits come from its plan (starter = 10 seats)');
select is((select seat_limit from public.org_plan_limits('0535a000-0000-0000-0000-000000000002')),
  null::integer, 'AC-PLN-009 an org with no plan assignment resolves to Enterprise (NULL = unlimited)');

-- ── The refusal (AC-PLN-009 / FR-PLN-010) ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_like(
  $$ select public.assert_seat_available('0535a000-0000-0000-0000-000000000001') $$,
  '%seat_limit_reached: the starter plan allows 10 seats%',
  'AC-PLN-009 an Admin inviting past the seat limit is refused with the typed PL001, naming the limit');
reset role;

select throws_ok(
  $$ insert into public.profiles (id, org_id, full_name, email, role, status)
     values ('0535a000-0000-0000-0000-0000000000ac','0535a000-0000-0000-0000-000000000001',
             'Plan Limits A Over','plan-limits-ac@example.invalid','Finance','active') $$,
  'PL001', null,
  'AC-PLN-009 the invite path itself (the profile write) is refused at the limit, not only the pre-check');

select is((select count(*)::int from public.profiles
            where org_id = '0535a000-0000-0000-0000-000000000001'), 11,
  'AC-PLN-009 the refused invite left the member list untouched (10 active + 1 disabled)');

-- Existing members are unaffected: the Admin who was refused is still an active member.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.is_active_member(), true,
  'AC-PLN-009 the existing members keep working — the refused invite does not disturb them');
reset role;

-- ── Authority: same guard as the invite itself ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select public.assert_seat_available('0535a000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'AC-PLN-009 a non-Admin member cannot probe the seat limit');
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.assert_seat_available('0535a000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'AC-PLN-009 an org Admin cannot probe another org''s seat limit (no cross-org oracle)');
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select throws_ok(
  $$ select public.assert_seat_available('0535a000-0000-0000-0000-000000000001') $$,
  'PL001', null,
  'AC-PLN-009 an Operator inviting into a full org gets the same typed refusal');
select throws_ok(
  $$ select public.assert_seat_available('0535a000-0000-0000-0000-0000000000ff') $$,
  'P0002', null,
  'AC-PLN-009 an unknown org is refused rather than silently allowed');
reset role;
reset request.jwt.claims;   -- the seat fixtures below are written by the migration runner

-- ── A freed seat is usable again; re-enabling a profile consumes one ─────────────────────────────
update public.profiles set status = 'disabled'
 where id = '0535a000-0000-0000-0000-0000000000a3';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.assert_seat_available('0535a000-0000-0000-0000-000000000001') $$,
  'AC-PLN-009 disabling a member frees a seat for one more invite');
reset role;

select lives_ok(
  $$ insert into public.profiles (id, org_id, full_name, email, role, status)
     values ('0535a000-0000-0000-0000-0000000000ac','0535a000-0000-0000-0000-000000000001',
             'Plan Limits A Over','plan-limits-ac@example.invalid','Finance','active') $$,
  'AC-PLN-009 the invite at exactly the limit succeeds (the cap is not off-by-one)');
select throws_ok(
  $$ update public.profiles set status = 'active'
      where id = '0535a000-0000-0000-0000-0000000000a3' $$,
  'PL001', null,
  'AC-PLN-009 re-enabling a disabled user consumes a seat and is refused when the org is full');
select is(
  (select status::text from public.profiles where id = '0535a000-0000-0000-0000-0000000000a3'),
  'disabled',
  'AC-PLN-009 the refused re-enable left the user disabled');

-- ── AC-PLN-010: the active-project cap ──────────────────────────────────────────────────────────
select is(public.project_counts_toward_limit('Ongoing Project'::public.project_status, null), true,
  'AC-PLN-010 an ongoing project counts toward the cap');
select is(public.project_counts_toward_limit('Close Out'::public.project_status, null), true,
  'AC-PLN-010 a project in Close Out still counts (on-hand delivery, 0044 on-hand set)');
select is(public.project_counts_toward_limit('Loss Tender'::public.project_status, null), false,
  'AC-PLN-010 a lost deal does not count');
select is(public.project_counts_toward_limit('Declined'::public.project_status, null), false,
  'AC-PLN-010 a declined deal does not count');
select is(public.project_counts_toward_limit('Ongoing Project'::public.project_status, now()), false,
  'AC-PLN-010 an archived project does not count');

-- Org A is on starter: project_limit 25. Insert 25 active projects plus the non-counting shapes.
reset request.jwt.claims;   -- fixture writes below are the migration runner's, not a caller's
insert into public.projects (id, org_id, name, status)
select ('0535a000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       '0535a000-0000-0000-0000-000000000001',
       'Plan Limits A Project ' || g,
       'Ongoing Project'
  from generate_series(1, 25) g;
insert into public.projects (id, org_id, name, status) values
  ('0535a000-0000-0000-0000-000000000031','0535a000-0000-0000-0000-000000000001','Plan Limits A Lost','Loss Tender'),
  ('0535a000-0000-0000-0000-000000000032','0535a000-0000-0000-0000-000000000001','Plan Limits A Declined','Declined');
insert into public.projects (id, org_id, name, status, archived_at) values
  ('0535a000-0000-0000-0000-000000000033','0535a000-0000-0000-0000-000000000001','Plan Limits A Archived','Ongoing Project', now());

select is((select project_limit from public.org_plan_limits('0535a000-0000-0000-0000-000000000001')),
  25, 'AC-PLN-010 starter allows 25 active projects');

-- Create past the cap, as a real Admin client (AC-PLN-010).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_like(
  $$ insert into public.projects (org_id, name, status, client_id)
     values ('0535a000-0000-0000-0000-000000000001','Plan Limits A Over Cap','Leads', null) $$,
  '%project_limit_reached: the starter plan allows 25 active projects%',
  'AC-PLN-010 creating a project past the active-project cap is refused with the typed PL002, naming the limit');
reset role;

-- Reactivation: reviving a lost deal is a new active project.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.transition_project('0535a000-0000-0000-0000-000000000031','Negotiation') $$,
  'PL002', null,
  'AC-PLN-010 reactivating a lost deal past the cap is refused (same typed error)');
reset role;

-- Reactivation by un-archiving is the other crossing edge.
select throws_ok(
  $$ update public.projects set archived_at = null
      where id = '0535a000-0000-0000-0000-000000000033' $$,
  'PL002', null,
  'AC-PLN-010 un-archiving a project past the cap is refused');
select is(
  (select archived_at is not null from public.projects
    where id = '0535a000-0000-0000-0000-000000000033'),
  true, 'AC-PLN-010 the refused un-archive left the project archived');

select is((select count(*)::int from public.projects
            where org_id = '0535a000-0000-0000-0000-000000000001'
              and public.project_counts_toward_limit(status, archived_at)), 25,
  'AC-PLN-010 the refused writes added no active project');

-- ── D12: freeing a slot makes the same create succeed, and over-limit items survive a downgrade ──
update public.projects set archived_at = now()
 where id = '0535a000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.transition_project('0535a000-0000-0000-0000-000000000031','Negotiation') $$,
  'AC-PLN-010 with a slot free, reviving the lost deal is allowed (the guard is not over-broad)');
reset role;

update public.projects set archived_at = now()
 where id = '0535a000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.projects (org_id, name, status, client_id)
     values ('0535a000-0000-0000-0000-000000000001','Plan Limits A Now Fits','Leads', null) $$,
  'AC-PLN-010 archiving another project frees a slot and the same create succeeds');
reset role;

-- Enterprise = NULL project limit (unlimited).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.projects (org_id, name, status)
     select '0535a000-0000-0000-0000-000000000002', 'Plan Limits B Project ' || g, 'Leads'
       from generate_series(1, 30) g $$,
  'AC-PLN-010 an Enterprise org (NULL project limit) is unlimited');
reset role;

-- The downgrade case: org D is Enterprise with 30 active projects, then moves to starter (25).
reset request.jwt.claims;   -- the 30 project rows are seeded as the migration runner
insert into public.projects (id, org_id, name, status)
select ('0535a000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       '0535a000-0000-0000-0000-000000000004',
       'Plan Limits D Project ' || g,
       'Ongoing Project'
  from generate_series(1, 30) g;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_set_org_plan('0535a000-0000-0000-0000-000000000004','starter') $$,
  'D12 an Operator can downgrade an over-limit org (the downgrade itself is never refused)');
reset role;

select is((select count(*)::int from public.projects
            where org_id = '0535a000-0000-0000-0000-000000000004'
              and public.project_counts_toward_limit(status, archived_at)), 30,
  'D12 the over-limit projects stay in place after the downgrade');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.projects (org_id, name, status, client_id)
     values ('0535a000-0000-0000-0000-000000000004','Plan Limits D Over Cap','Leads', null) $$,
  'PL002', null,
  'D12 nothing new may be added after a downgrade');
reset role;

-- ── Cross-tenant oracle guard on the project trigger (0170's rule) ──────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0535a000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.projects (org_id, name, status)
     values ('0535a000-0000-0000-0000-000000000001','Plan Limits Cross Org','Leads') $$,
  '42501', null,
  'AC-PLN-010 a client cannot use the cap trigger to probe another org (org re-asserted before any count)');
reset role;

-- ── Catalogue surface: the RPCs are not reachable by anon, and the limits reader stays internal ──
select ok(not has_function_privilege('anon', 'public.assert_seat_available(uuid)', 'EXECUTE'),
  'AC-PLN-009 assert_seat_available is not executable by anon');
select ok(not has_function_privilege('authenticated', 'public.org_plan_limits(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.org_seat_usage(uuid)', 'EXECUTE'),
  'AC-PLN-009 the limit readers stay internal to the definer helpers');
select ok((select prosecdef from pg_proc where oid = 'public.assert_seat_available(uuid)'::regprocedure),
  'AC-PLN-009 assert_seat_available is SECURITY DEFINER (it must see every row of the org)');
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_zz_plan_seat_guard'),
  1,
  'AC-PLN-009 the seat guard is attached to profiles');
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.projects'::regclass and tgname = 'projects_zz_plan_cap_guard'),
  1,
  'AC-PLN-010 the active-project guard is attached to projects');
-- The `zy_`/`zz_` slots are what make the guards see the STAMPED org (0074) and refuse a foreign org
-- before any count: assert the ordering rather than trusting the names alone.
select is(
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname in ('profiles_stamp_org_id','profiles_zy_plan_org_guard','profiles_zz_plan_seat_guard')),
  'profiles_stamp_org_id,profiles_zy_plan_org_guard,profiles_zz_plan_seat_guard',
  'AC-PLN-009 profiles fires stamp → org guard → seat count, in that order');
select is(
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.projects'::regclass
      and tgname in ('projects_stamp_org_id','projects_zy_plan_org_guard','projects_zz_plan_cap_guard')),
  'projects_stamp_org_id,projects_zy_plan_org_guard,projects_zz_plan_cap_guard',
  'AC-PLN-010 projects fires stamp → org guard → cap count, in that order');

select * from finish();
rollback;

-- ⚑ Cleanup is the rollback itself: every fixture in this file lives in the transaction above, so
-- nothing is committed and nothing needs a second session to delete it. The extension created inside
-- the transaction is rolled back with it; the drop below is belt-and-braces for a database that
-- already carried a leaked copy from an earlier aborted file (0163's FR-CPS-050 lesson).
drop extension if exists dblink;
