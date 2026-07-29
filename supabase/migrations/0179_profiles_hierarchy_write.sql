-- 0179_profiles_hierarchy_write.sql — ADR-0070's PROFILE-EDITING rule, in RLS.
-- Spec/authority: docs/adr/0070-approval-authority-is-rank-not-role-list.md, "Profile editing follows
-- the same order" (owner ruling, 2026-07-29). Proven by supabase/tests/0172_profiles_hierarchy_write.test.sql.
--
-- ── THE RULING ──────────────────────────────────────────────────────────────────────────────────
--   "You may edit a profile only if you OUTRANK the person whose profile it is, and you may only
--    assign a role BELOW your own." — plus ONE carve-out: an Admin may edit a peer Admin, never
--    themselves.
--
--   | actor                   | may edit the profile of                | may assign role       |
--   | Admin                   | anyone, incl. other Admins, NEVER self | any                   |
--   | Executive               | Finance, Project Manager, Engineer     | Finance, PM, Engineer |
--   | Finance / PM / Engineer | nobody                                 | nobody                |
--
-- ── WHY BOTH `USING` AND `WITH CHECK`, AND NOT EITHER ALONE ─────────────────────────────────────
-- `USING` governs WHOSE profile you may touch (the pre-image); `WITH CHECK` governs WHAT YOU MAY SET
-- IT TO (the post-image). They are different questions and both have to be asked:
--   • WITH CHECK alone -> an Executive could DEMOTE an Admin, because 'Finance' is a role an Executive
--     may legitimately assign; the illegal part is the SUBJECT, not the target role. (0172 AC-PHW-030.)
--   • USING alone      -> an Executive could PROMOTE a Project Manager to Executive, because a PM is
--     someone an Executive may legitimately edit. (0172 AC-PHW-021.)
-- This USING/WITH-CHECK asymmetry is a class this program has already had to repair twice, so both
-- clauses here are the SAME expression and the test names the mutation that catches each side.
--
-- ── WHY THERE IS AN AUTHORITY FLOOR AND NOT JUST "OUTRANKS" ─────────────────────────────────────
-- Read literally, "you may edit a profile only if you outrank its owner" would hand Finance authority
-- over Project Managers and a PM authority over Engineers — because role_rank (0178) is a STRICT total
-- order and Finance > PM > Engineer. The owner's matrix says row 3 is "nobody", so the predicate is a
-- CONJUNCTION: the actor must hold profile-administration authority (Executive rank and above) AND
-- outrank the subject. Dropping the floor is not a widening of convenience — a PM who can write a
-- peer's `manager_id` can re-point ADR-0070's own line-management limb and quietly undo the money SoD.
--
-- ── WHY THE ADMIN CARVE-OUT, AND WHY IT IS NOT "EQUAL RANK MAY EDIT EQUAL RANK" ─────────────────
-- Admin does not OUTRANK Admin, so strict outranking alone would mean nobody could ever edit an
-- Admin's profile and an Admin could never be demoted in-app. Generalising it to equal rank would let
-- one Executive edit another (explicitly ruled out) and one PM assign supervisors for their peers
-- (the money-SoD hole above). So it is written as the single named exception the ADR states, and
-- nowhere else. It grants an Admin nothing they did not already have — it only removes a lockout.
--
-- ── ⚑ WHAT THIS CHANGES THAT IS A NARROWING, NOT A WIDENING (read before reverting) ─────────────
-- `profiles_admin_write` was `FOR ALL` and matched the Admin's OWN row, so an Admin could change
-- their own `role` and their own `manager_id`. Probed live at 0178:
--     admin JWT: update profiles set role='Engineer' where id = <self>   ->   UPDATE 1
-- ADR-0070 asserted that self-edits of role/manager_id were "barred for everyone, Admin included, via
-- the profiles_update_self pin". That was TRUE for every other role and FALSE for Admin: the pin lives
-- on profiles_update_self, and permissive policies OR — profiles_admin_write satisfied the write on
-- its own. The owner's "never themselves" is what closes it, and the ADR text is corrected in this
-- change. The Admin keeps every other authority they had (INSERT, DELETE, editing anyone else,
-- editing their own non-pinned fields via profiles_update_self) — asserted as controls in 0172.
--
-- ── WHAT IS DELIBERATELY UNCHANGED ──────────────────────────────────────────────────────────────
-- • `profiles_update_self`'s pin on `role` AND `manager_id` — ⚑ LOAD-BEARING, and it is now load-
--   bearing for MORE than before. It is the only thing stopping an Executive from promoting THEMSELVES
--   to Admin in one statement (their own row is out of reach of the policy below, but it IS in reach
--   of profiles_update_self). ADR-0070 records it as a precondition; 0171 AC-SCC-076 and 0172
--   AC-PHW-040/041 assert it from two directions. Any future migration touching that policy must keep
--   the pin, or every rule built on ADR-0070 becomes self-serve.
-- • INSERT and DELETE on `profiles` stay ADMIN-ONLY. The ruling is about EDITING. Widening the
--   destructive path to Executives was never asked for and contradicts ADR-0019 (destructive deletes
--   are Admin-only), and the INSERT path is in practice the service-role invite edge function
--   (`admin-invite-user`, which bypasses RLS) — so widening it would buy nothing and cost a review.
--   Because a single `FOR ALL` policy cannot express "UPDATE has one rule and INSERT/DELETE another",
--   `profiles_admin_write` is split into three policies rather than edited in place.
-- • `is_active_member()` on every clause (the 0063 sweep): a disabled Admin still administers nobody.
-- • `admin_set_user_status` (0065) is a SECURITY DEFINER RPC that bypasses RLS entirely, so
--   offboarding is untouched by any of this — asserted rather than assumed (0172 AC-PHW-100/101/102),
--   including its own self-disable refusal.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse (⚑ RESTORES A STATE IN
-- WHICH AN ADMIN CAN SELF-DEMOTE AND AN EXECUTIVE CAN ADMINISTER NOBODY):
--   drop policy if exists profiles_hierarchy_update on public.profiles;
--   drop policy if exists profiles_admin_delete     on public.profiles;
--   drop policy if exists profiles_admin_insert     on public.profiles;
--   create policy profiles_admin_write on public.profiles for all
--     using      (org_id = auth_org_id() and auth_role() = 'Admin' and public.is_active_member())
--     with check (org_id = auth_org_id() and auth_role() = 'Admin' and public.is_active_member());
--   drop function if exists public.may_administer_profile(user_role, user_role);
--   drop function if exists public.holds_profile_admin_authority(user_role);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §0 — A ONE-LINE CORRECTION TO 0178's role_rank COMMENT. No behaviour changes here.
-- 0178's body implements the STRICT order the owner ruled (Admin 50 > Executive 40 > Finance 30 >
-- PM 20 > Engineer 10) and its inline comment says so — but the `comment on function` it also shipped
-- still reads "Admin = Executive > Finance > Project Manager > Engineer", from the ADR's first draft.
-- Everything in this file is built on Admin STRICTLY outranking Executive (it is what makes "only an
-- Admin may assign Executive" fall out with no special case), so a reader who trusts the catalog
-- comment reads the opposite of the rule. ⚑ This is the 0177 defect class exactly: a claim in prose
-- that no test can check, contradicting the code beside it. Corrected here rather than left.
comment on function public.role_rank(user_role) is
  'ADR-0070 — the ONE definition of role rank, a STRICT total order: Admin > Executive > Finance > '
  'Project Manager > Engineer. (An earlier draft had Admin = Executive; the owner ruled it strict on '
  '2026-07-29, because under equality nobody could ever assign the Executive role or edit an '
  'Executive''s profile.) Returns NULL for an unmapped role so every caller FAILS CLOSED '
  '(role_outranks, holds_won_value_authority, holds_pipeline_value_authority and '
  'holds_profile_admin_authority all coalesce to false). Adding a role is a one-line change here and '
  'must not require editing any SoD predicate — 0171 AC-SCC-075 asserts that property.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — The authority floor, as RANK. Same shape as 0178's holds_won_value_authority /
--      holds_pipeline_value_authority: a THRESHOLD over public.role_rank, never a list of literals.
--      An Operations Manager or Director slotted between Finance and Project Manager inherits the
--      right answer (no authority) with no edit here; one slotted above Executive inherits it too.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.holds_profile_admin_authority(p_role user_role) returns boolean
  language sql immutable set search_path = pg_catalog, public as $$
  -- coalesce so a NULL or unmapped role is "no authority" — never an exemption (0176 §6).
  select coalesce(public.role_rank(p_role) >= public.role_rank('Executive'), false)
$$;

comment on function public.holds_profile_admin_authority(user_role) is
  'ADR-0070 profile-editing rule, the AUTHORITY FLOOR as rank: may this role administer other '
  'people''s profiles at all? True at Executive rank and above. Without it, "may edit whoever you '
  'outrank" would hand Finance authority over Project Managers and a PM authority over Engineers — '
  'and a PM who can write a peer''s manager_id can re-point ADR-0070''s own line-management limb. '
  'NULL/unmapped roles coalesce to false (fail closed).';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — "May an actor of this role administer a profile at that role?" The ONE place the ruling is
--      expressed. It takes the SUBJECT'S ROLE as an argument precisely so the SAME predicate can be
--      applied to the pre-image (USING: old.role) and the post-image (WITH CHECK: new.role).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.may_administer_profile(p_actor_role user_role, p_subject_role user_role)
  returns boolean language sql immutable set search_path = pg_catalog, public as $$
  -- Outer coalesce: TOTAL. `p_subject_role` is NOT NULL on the table, but a NULL on either side must
  -- read as "no authority", not as a NULL that fails to fire a check (0176 §6's defect class).
  select coalesce(
    public.holds_profile_admin_authority(p_actor_role)
    and ( public.role_outranks(p_actor_role, p_subject_role)
          -- ⚑ THE ONE CARVE-OUT (ADR-0070, owner ruling 2026-07-29): an Admin may act on a peer
          --   Admin. This is the only role literal in the authority model and it is an EXCEPTION,
          --   not a list — without it nobody could ever edit an Admin's profile (Admin does not
          --   outrank Admin) and an Admin could never be demoted in-app. It is applied to the
          --   SUBJECT's role, so it holds identically in USING (the peer is an Admin today) and in
          --   WITH CHECK (the peer stays an Admin after a manager_id-only edit).
          --   ⚑ DO NOT generalise it to "equal rank may edit equal rank": that would let one
          --   Executive edit another (explicitly ruled out) and one Project Manager assign
          --   supervisors for their peers (which quietly undoes the money SoD).
          or (p_actor_role = 'Admin' and p_subject_role = 'Admin') ),
    false)
$$;

comment on function public.may_administer_profile(user_role, user_role) is
  'ADR-0070 — the ONE profile-editing predicate: TRUE when the actor holds profile-administration '
  'authority (Executive rank and above) AND either outranks the subject''s role or is an Admin acting '
  'on a peer Admin (the single carve-out). Applied to old.role in USING and to new.role in WITH CHECK '
  'by profiles_hierarchy_update, which is why the subject''s role is a parameter. Coalesces to FALSE. '
  '⚑ "Only an Admin may assign Executive" is a CONSEQUENCE of strict rank here, not a special case.';

grant execute on function public.holds_profile_admin_authority(user_role),
                          public.may_administer_profile(user_role, user_role)
  to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — Split profiles_admin_write (FOR ALL) into INSERT / DELETE (unchanged, Admin-only) and
--      UPDATE (the ruling). A FOR ALL policy cannot carry two different rules, and leaving the old
--      one in place would defeat the whole change: permissive policies OR, so it would keep granting
--      an Admin the self-edit the ruling bars.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop policy profiles_admin_write on public.profiles;

-- Byte-for-byte the old predicate, restricted to INSERT.
create policy profiles_admin_insert on public.profiles for insert
  with check (org_id = auth_org_id() and auth_role() = 'Admin' and public.is_active_member());

-- Byte-for-byte the old predicate, restricted to DELETE (ADR-0019: destructive delete is Admin-only).
create policy profiles_admin_delete on public.profiles for delete
  using (org_id = auth_org_id() and auth_role() = 'Admin' and public.is_active_member());

-- THE RULING. `id is distinct from (select auth.uid())` is the "never themselves" bar and is TOTAL,
-- so an unresolvable caller cannot slip through it. auth.uid() is wrapped as `(select auth.uid())`
-- per 0021/0058 AC-DBLINT-002 (initplan hoisting).
create policy profiles_hierarchy_update on public.profiles for update
  using (org_id = auth_org_id()
         and public.is_active_member()
         and id is distinct from (select auth.uid())
         and public.may_administer_profile(auth_role(), role))
  with check (org_id = auth_org_id()
         and public.is_active_member()
         and id is distinct from (select auth.uid())
         and public.may_administer_profile(auth_role(), role));

comment on policy profiles_hierarchy_update on public.profiles is
  'ADR-0070 profile-editing rule (owner ruling 2026-07-29). USING binds `role` to the PRE-image (whose '
  'profile may be touched); WITH CHECK binds the SAME expression to the POST-image (what the role may '
  'be set to). Both are required: WITH CHECK alone lets an Executive demote an Admin, USING alone lets '
  'an Executive promote a PM to Executive. `id is distinct from auth.uid()` is the "never themselves" '
  'bar — with profiles_update_self''s role/manager_id pin (LOAD-BEARING) it is what stops a self-grant.';

comment on policy profiles_admin_insert on public.profiles is
  'Admin-only, unchanged from profiles_admin_write. The ruling in profiles_hierarchy_update widens '
  'EDITING only; creating a profile stays Admin-only (in practice the service-role admin-invite-user '
  'edge function, which bypasses RLS). Split out because a FOR ALL policy cannot carry two rules.';

comment on policy profiles_admin_delete on public.profiles is
  'Admin-only, unchanged from profiles_admin_write. ADR-0019: destructive deletes are Admin-only, so '
  'the rank widening deliberately does not reach DELETE. Split out because a FOR ALL policy cannot '
  'carry two rules.';
