-- 0184_profiles_email_and_dead_grants_narrow.sql — narrow the profiles UPDATE allow-list from
-- 0182's eleven columns to seven. email (the identity key) becomes non-client-writable; three dead
-- grants go too.
--
-- OWNER RULING (2026-07-30, "Option B"): self-edit of the five non-app profile fields STAYS
-- (full_name, avatar_url, title, location, skills); only the IDENTITY KEY (email) and the genuinely
-- DEAD grants are removed.
--
-- 0182 left eleven columns client-writable:
--     full_name, email, avatar_url, title, location, skills, utilization,
--     company_id, role, manager_id, updated_at
-- This file narrows that to SEVEN:
--     full_name, avatar_url, title, location, skills, role, manager_id
--
-- ── WHY EACH ONE GOES ───────────────────────────────────────────────────────────────────────────
-- email — THE SECURITY REASON. It is an IDENTITY KEY in three live places, and profiles_update_self
--   (0007/0021) pins only org_id/role/manager_id, so at 0182 ANY user could rewrite their OWN
--   profiles.email via `PATCH /rest/v1/profiles?id=eq.<self>`:
--     • org_has_member_email() (0065) — `lower(pr.email) = lower(p_email)`, the invite-duplicate
--       gate. Squatting a colleague's address makes every Admin invite of that person return
--       DUPLICATE_EMAIL.
--     • supabase/functions/_shared/erpnextFeedDeps.ts (~712/723) — the ERP Employee -> PMO profile
--       link proposal on 'work-email-exact-match'. Squatting gets a colleague's Employee record
--       proposed against your profile.
--     • supabase/functions/clickup-onboard/index.ts (~119-121) — joins profiles.email to ClickUp
--       List members.
--   profiles.email should track auth.users.email and NEVER diverge under user control.
--   ⚑ Pre-existing since 0075's table-wide grant — NOT introduced by 0182. 0182 merely enumerated it.
--
-- company_id, utilization, updated_at — DEAD GRANTS. No writer anywhere in the tree (the ONLY
--   client-side profile UPDATEs are `role` at pmo-portal/src/lib/db/adminUsers.ts:51 and
--   `manager_id` at adminUsers.ts:61 — both KEPT in the allow-list), and no policy, RPC or
--   calculation reads any of them as an authorization or money input. Removed because an UNGRANTED
--   column cannot be abused later by a feature nobody reviewed.
--
-- THE FIVE KEPT NON-APP COLUMNS (full_name, avatar_url, title, location, skills) are deliberate,
--   NOT an oversight: the suite encodes client-side profile SELF-EDIT as intended behaviour
--   (0172 AC-PHW-042 "an Executive CAN edit own non-pinned fields (no over-block)", AC-PHW-062 the
--   Admin equivalent, and 0004 HIGH-1). A future narrower must NOT re-break them.
--
-- role, manager_id are kept because they are the ONLY client profile writes (adminUsers.ts:51/:61).
--
-- STILL UNGRANTED (0182's ruling, untouched here): status, org_id, id, created_at.
--
-- *** THE SILENT NO-OP TRAP — DO NOT FALL INTO IT (same as 0182) ***
-- `revoke update (email) on public.profiles from authenticated` is a SILENT NO-OP while a table-level
-- grant exists: a column revoke CANNOT subtract from a table grant, so has_column_privilege() would
-- still return TRUE. (Proven live at 0182.) The ONLY form that holds is revoke-table-wide-then-
-- re-grant-an-explicit-list, so the end state is declared IN FULL by this file and does not require
-- reading 0182 to know what is granted:
--     revoke update on public.profiles from authenticated, anon;
--     grant update (<seven>) on public.profiles to authenticated;
--
-- anon holds NO update on profiles today (revoked in the 0075->0105 sweep); the revoke names anon
-- for defence in depth (a future re-grant lands on the allow-list, not on the table) and is a no-op
-- now, correctly so.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse is an operation on THIS
--   file (it restores a NARROWER-but-still-VULNERABLE state — email and the three dead grants become
--   client-writable again):
--     revoke update (full_name, avatar_url, title, location, skills, role, manager_id)
--       on public.profiles from authenticated;
--     grant update (full_name, email, avatar_url, title, location, skills, utilization,
--                   company_id, role, manager_id, updated_at) on public.profiles to authenticated;
--   i.e. drop the seven-column list this file granted and restore 0182's eleven-column grant to
--   `authenticated`. `anon` is deliberately NOT re-granted (see above). ⚑ Do NOT reverse by naming a
--   migration number: 0182's grant is the one being modified here, and a later migration may touch
--   profiles grants again — edit the current file's text, as above.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Revoke the table-wide UPDATE (defence in depth — already revoked by 0182; re-stated so this file
-- is self-contained), then re-grant the explicit SEVEN-column allow-list. email, company_id,
-- utilization and updated_at are now non-writable by any client role, alongside 0182's status,
-- org_id, id and created_at.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url, title, location, skills, role, manager_id)
  on public.profiles to authenticated;

comment on table public.profiles is
  '⚑ client UPDATE on profiles is an explicit column allow-list (full_name, avatar_url, title, '
  'location, skills, role, manager_id). email, company_id, utilization and updated_at were removed '
  'in 0184 (email is an identity key — see org_has_member_email / the erpnext link proposal / '
  'clickup-onboard; the other three were dead grants). id, org_id, created_at and status are NOT '
  'client-writable — status is ADMIN-ONLY via admin_set_user_status (owner ruling 2026-07-30). A '
  'table-wide grant would re-open the hole: a column revoke cannot subtract from one, so the '
  'allow-list is the only shape that holds. has_column_privilege() is the oracle.';
