-- profiles_org_id_immutable.test.sql — `profiles.org_id` cannot be changed by ANY role.
-- Migration under test: supabase/migrations/0190_profiles_org_id_immutable.sql
-- Ruling under test:    DD-ORG-2 (docs/decisions.md, #441 → #485).
--
-- DD-ORG-2 ruled that a user in the wrong org is handled by OFFBOARD + REINVITE, and that
-- reassigning org_id is ruled out on tenancy-integrity grounds. The one-line
-- `update profiles set org_id = ...` looks obviously correct to anyone who has not read that, and
-- would strand historical authorship across a tenancy line, land on the known-weak SoD surface, and
-- silently carry org-scoped integration connections across the boundary that offboarding exists to
-- cascade-delete.
--
-- ── THE THREE LAYERS, AND WHICH ONE THIS FILE OWNS ──────────────────────────────────────────────
-- org_id is refused at three independent layers, and only ONE of them is new here. Saying which is
-- which is the whole point of §C–§E below: a test that cannot tell them apart would go green on the
-- neighbours' work and never notice the trigger was gone.
--   layer 1  COLUMN GRANT (0182/0184) — `authenticated` is refused 42501 before RLS is reached.
--            Owned by 0175_profiles_status_allowlist.test.sql §E; re-asserted here (§D) only to
--            establish that layer 3 is genuinely unreachable from a normal client, which is why §E
--            has to peel the layers to observe it.
--   layer 2  RLS — profiles_update_self (0007/0021) and profiles_hierarchy_update (0179) both pin
--            org_id. Owned by 0004_rls_remediation.test.sql.
--   layer 3  THE TRIGGER (0190) — this file. It is the only layer that binds service_role, the
--            table owner, and any SECURITY DEFINER path, i.e. every role that gets past 1 and 2.
--
-- ⚑ MUTATION ORACLE. Dropping `profiles_org_id_immutable` must turn §B, §C and §E red. §A and §D go
--   red / stay green on their own layers and are not the oracle — §D in particular stays GREEN with
--   the trigger gone, because the column grant still refuses it. That is not a weakness in the
--   guard; it is the reason the trigger had to be observed at layers where the grant does not bind.

begin;
create extension if not exists pgtap;
select plan(18);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01900000-0000-0000-0000-000000000001','ORGID Home Org'),
  ('01900000-0000-0000-0000-000000000002','ORGID Other Org');

insert into auth.users (id, email) values
  ('01900000-0000-0000-0000-0000000000a1','orgid-admin@example.com'),
  ('01900000-0000-0000-0000-0000000000a2','orgid-pm@example.com'),
  ('01900000-0000-0000-0000-0000000000a3','orgid-eng@example.com'),
  ('01900000-0000-0000-0000-0000000000b1','orgid-new-home@example.com'),
  ('01900000-0000-0000-0000-0000000000b2','orgid-new-other@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01900000-0000-0000-0000-0000000000a1','01900000-0000-0000-0000-000000000001',
   'ORGID Admin','orgid-admin@example.com','Admin','active'),
  ('01900000-0000-0000-0000-0000000000a2','01900000-0000-0000-0000-000000000001',
   'ORGID PM','orgid-pm@example.com','Project Manager','active'),
  ('01900000-0000-0000-0000-0000000000a3','01900000-0000-0000-0000-000000000001',
   'ORGID Engineer','orgid-eng@example.com','Engineer','active');

-- Captures the diagnostics of a failing statement so the HINT (where "offboard + reinvite" lives)
-- can be asserted, not just the errcode/message pair throws_ok can see.
create function pg_temp.orgid_capture(p_sql text,
                                      out out_sqlstate text, out out_message text, out out_hint text)
language plpgsql as $$
begin
  execute p_sql;
  out_sqlstate := 'NO ERROR'; out_message := null; out_hint := null;
exception when others then
  get stacked diagnostics
    out_sqlstate = returned_sqlstate,
    out_message  = message_text,
    out_hint     = pg_exception_hint;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — the guard is installed the way the migration argues it must be.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select has_trigger('public','profiles','profiles_org_id_immutable',
  'AC-ORGID-001 the immutability trigger exists on public.profiles');

-- `A` = ENABLE ALWAYS. The default `O` (origin) would be silenced by
-- session_replication_role = 'replica', which is exactly the kind of quiet disarming an integrity
-- invariant must survive.
select is((select tgenabled from pg_trigger
            where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_org_id_immutable'),
  'A'::"char",
  'AC-ORGID-002 the trigger is ENABLE ALWAYS — it still fires under session_replication_role=replica');

-- tgtype bit 1 (value 2) is BEFORE. It must be 0: a BEFORE trigger runs ahead of the RLS WITH CHECK
-- and would pre-empt layer 2, turning 0004_rls_remediation.test.sql's RLS-pin assertion into an
-- assertion about this trigger instead — the "passes for a different reason" failure that file's own
-- comment records having already been caught once.
select is((select (tgtype & 2)::int from pg_trigger
            where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_org_id_immutable'),
  0,
  'AC-ORGID-003 the trigger is AFTER, not BEFORE — so the RLS layer stays independently observable');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — service_role is refused. THE point of the guard: service_role bypasses RLS and holds the
-- table-wide grant, so layers 1 and 2 do not bind it at all. This is the role a migration, a
-- back-office script or an edge function would run the "obvious" one-liner as.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role service_role;
select throws_ok(
  $$ update public.profiles set org_id = '01900000-0000-0000-0000-000000000002'
       where id = '01900000-0000-0000-0000-0000000000a2' $$,
  '23514',
  'profiles.org_id is immutable (DD-ORG-2): profile 01900000-0000-0000-0000-0000000000a2 '
  'cannot be moved from org 01900000-0000-0000-0000-000000000001 '
  'to org 01900000-0000-0000-0000-000000000002',
  'AC-ORGID-010 service_role CANNOT change org_id — 23514, and the message names DD-ORG-2');

-- A good error teaches. The hint must say what to do instead, or the next person just looks for a
-- role that is allowed.
select matches(
  (select out_hint from pg_temp.orgid_capture(
     $$ update public.profiles set org_id = '01900000-0000-0000-0000-000000000002'
          where id = '01900000-0000-0000-0000-0000000000a2' $$)),
  'offboard \+ reinvite',
  'AC-ORGID-011 the error HINT names the sanctioned path — "offboard + reinvite"');

reset role;
select is((select org_id::text from public.profiles where id = '01900000-0000-0000-0000-0000000000a2'),
  '01900000-0000-0000-0000-000000000001',
  'AC-ORGID-012 the PM''s org_id is unchanged — asserted on persisted state, not by errcode alone');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — the table owner is refused too. No exemption exists for the "trusted" path, because a
-- bypass for the trusted path is exactly how such a guard gets used.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ update public.profiles set org_id = '01900000-0000-0000-0000-000000000002'
       where id = '01900000-0000-0000-0000-0000000000a3' $$,
  '23514', null,
  'AC-ORGID-020 the table owner CANNOT change org_id either — this is an integrity invariant, not an authorization rule');

select is((select org_id::text from public.profiles where id = '01900000-0000-0000-0000-0000000000a3'),
  '01900000-0000-0000-0000-000000000001',
  'AC-ORGID-021 the Engineer''s org_id is unchanged after the owner attempt');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §D — a normal authenticated client never reaches the trigger: layer 1 (the 0182/0184 column
-- allow-list) refuses at parse/rewrite time. Asserted here so §E's peeling is understood as
-- deliberate rather than as the trigger being unreachable in practice.
-- ⚑ This assertion stays GREEN if the trigger is dropped — it belongs to layer 1. It is not the
--   mutation oracle; §B/§C/§E are.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01900000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set org_id = '01900000-0000-0000-0000-000000000002'
       where id = '01900000-0000-0000-0000-0000000000a2' $$,
  '42501', 'permission denied for table profiles',
  'AC-ORGID-030 an authenticated user is refused at layer 1 (column grant) before the trigger is reached');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §E — with layers 1 and 2 peeled, the trigger refuses the SAME statement from `authenticated`.
-- The peel is scoped (granted + policy created here, revoked + dropped immediately after) so the
-- net grant/policy state of the database is unchanged for anything that follows. This is the same
-- technique 0004_rls_remediation.test.sql uses to reach the RLS layer under the column grant.
--
-- ⚑ TWO policies are needed, not one, and the second is not obvious: on an UPDATE, Postgres applies
--   the table's SELECT policies to the POST-image as well — the updated row must remain visible to
--   the writer. profiles_select is `org_id = auth_org_id()`, so a cross-org write fails that check
--   with the same 42501 "new row violates row-level security policy" a missing UPDATE policy gives.
--   Peeling only the UPDATE side therefore looks like the trigger never fired. Verified live.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
grant update (org_id) on public.profiles to authenticated;
create policy orgid_peel_tmp on public.profiles for update to authenticated
  using (true) with check (true);
create policy orgid_peel_sel_tmp on public.profiles for select to authenticated
  using (true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"01900000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set org_id = '01900000-0000-0000-0000-000000000002'
       where id = '01900000-0000-0000-0000-0000000000a2' $$,
  '23514',
  'profiles.org_id is immutable (DD-ORG-2): profile 01900000-0000-0000-0000-0000000000a2 '
  'cannot be moved from org 01900000-0000-0000-0000-000000000001 '
  'to org 01900000-0000-0000-0000-000000000002',
  'AC-ORGID-040 with the column grant AND RLS peeled away, the trigger still refuses `authenticated` — the guard binds every role');
reset role;

select is((select org_id::text from public.profiles where id = '01900000-0000-0000-0000-0000000000a2'),
  '01900000-0000-0000-0000-000000000001',
  'AC-ORGID-041 the PM''s org_id is still unchanged after the peeled attempt');

drop policy orgid_peel_tmp on public.profiles;
drop policy orgid_peel_sel_tmp on public.profiles;
revoke update (org_id) on public.profiles from authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §F — INSERT stays free. Setting org_id once is how every profile row is created (seed.sql,
-- seed-admin.sql, admin-invite-user's service-role insert, every pgTAP fixture). A guard that broke
-- this would break account creation.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into public.profiles (id, org_id, full_name, email, role, status) values
       ('01900000-0000-0000-0000-0000000000b1','01900000-0000-0000-0000-000000000001',
        'ORGID New Home','orgid-new-home@example.com','Engineer','active') $$,
  'AC-ORGID-050 INSERT may still set org_id — the value is set once, at creation');

select lives_ok(
  $$ insert into public.profiles (id, org_id, full_name, email, role, status) values
       ('01900000-0000-0000-0000-0000000000b2','01900000-0000-0000-0000-000000000002',
        'ORGID New Other','orgid-new-other@example.com','Engineer','active') $$,
  'AC-ORGID-051 INSERT into a DIFFERENT org still works — reinvite (the sanctioned path) is an insert');

select is((select org_id::text from public.profiles where id = '01900000-0000-0000-0000-0000000000b2'),
  '01900000-0000-0000-0000-000000000002',
  'AC-ORGID-052 the reinvited profile really landed in the other org');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §G — the guard does not over-block. A trigger that rejected unrelated updates would be worse than
-- the bug it prevents, so every shape that legitimately updates a profile today is asserted alive.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role service_role;
select lives_ok(
  $$ update public.profiles set full_name = 'ORGID PM Renamed'
       where id = '01900000-0000-0000-0000-0000000000a2' $$,
  'AC-ORGID-060 an unrelated column still updates freely — the guard compares org_id, it does not block the table');

-- The WHEN clause compares VALUES, not the SET list, so re-writing the same org_id is a no-op rather
-- than a rejection. scripts/m365-deadlock-probe.sh and scripts/m365-race-probe.sh depend on this.
select lives_ok(
  $$ update public.profiles set org_id = org_id, status = 'active'
       where id = '01900000-0000-0000-0000-0000000000a2' $$,
  'AC-ORGID-061 naming org_id in the SET list with an UNCHANGED value is allowed — the guard compares values, not columns');

select lives_ok(
  $$ insert into public.profiles (id, org_id, full_name, email, role, status) values
       ('01900000-0000-0000-0000-0000000000a2','01900000-0000-0000-0000-000000000001',
        'ORGID PM','orgid-pm@example.com','Project Manager','active')
     on conflict (id) do update set org_id = excluded.org_id, status = 'active', role = excluded.role $$,
  'AC-ORGID-062 the m365 probe scripts'' `on conflict do update set org_id = excluded.org_id` re-seed shape still works');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01900000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set full_name = 'ORGID Engineer Renamed' where id = auth.uid() $$,
  'AC-ORGID-063 a normal authenticated self-edit is untouched by the guard');
reset role;

select * from finish();
rollback;
