-- 0182_profiles_status_column_allowlist.sql — profiles.status is ADMIN-ONLY.
--
-- OWNER RULING (2026-07-30): only `admin_set_user_status` may change profiles.status.
--
-- THE DEFECT. 0075_explicit_api_grants.sql grants TABLE-WIDE update on public.profiles to
-- `authenticated`:
--     grant update on public.profiles to authenticated;
-- So every RLS policy on that table is ROW-SCOPED only and every UNNAMED column is in scope. Probed
-- live on this DB:
--   • an Executive can `update profiles set status='disabled'` on any Finance/PM/Engineer -> UPDATE 1
--   • an Executive can re-activate a disabled report                                  -> UPDATE 1
--   • ANY user can disable THEMSELVES via profiles_update_self (which pins org_id/role/manager_id
--     but NOT status)                                                                 -> UPDATE 1
-- `admin_set_user_status` explicitly refuses a self-disable; the RLS path does not. And disabling
-- fires the irreversible m365_offboard_trigger cascade (0114) — so a self-disable is not just an
-- authz hole, it is an irreversible offboarding a user can perform on themselves.
--
-- *** THE TRAP, PROVEN BY THE DIRECTOR — DO NOT FALL INTO IT ***
-- `revoke update (status) on public.profiles from authenticated` is a SILENT NO-OP. A column-level
-- revoke CANNOT subtract from a table-level grant; after it, has_column_privilege() still returns
-- TRUE. Verified live. The ONLY shape that works is revoke-table-wide then re-grant an explicit
-- column allow-list:
--     revoke update on public.profiles from authenticated, anon;
--     grant update (<allow-list>) on public.profiles to authenticated;
-- So `id`, `org_id`, `created_at`, `status` become non-writable by any client role.
--
-- WHY THIS BREAKS NO CALLER (verified against the whole tree, 2026-07-30):
--   • The ONLY client-side profile UPDATEs in the tree are `role`
--     (pmo-portal/src/lib/db/adminUsers.ts:51, `supabase.from('profiles').update({ role })`) and
--     `manager_id` (adminUsers.ts:61, `.update({ manager_id })`) — BOTH in the allow-list.
--   • `admin_set_user_status` is SECURITY DEFINER (runs as its owner): column grants do not bind a
--     definer at all, so offboarding is unaffected — asserted by 0175.
--   • The only edge-function profile write is an INSERT by `serviceClient` (service_role) in
--     admin-invite-user — service_role bypasses every grant, and this file touches UPDATE only.
--   • profiles_update_self's legitimate self-edits (full_name, email, avatar_url, title, location,
--     skills, …) are all in the allow-list; the policy still pins org_id/role/manager_id via WITH
--     CHECK, so the column grant widens nothing — it is the SECOND layer (RLS remains the first).
--   • anon holds NO update on profiles today (revoked between 0075 and now); the revoke is a no-op
--     for anon and is included for defence in depth (so a future re-grant lands on the allow-list,
--     not on the table).
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse is an operation on THIS
--   file (it restores a VULNERABLE state — every column client-writable again):
--     revoke update (full_name, email, avatar_url, title, location, skills, utilization,
--                    company_id, role, manager_id, updated_at) on public.profiles from authenticated;
--     grant update on public.profiles to authenticated, anon;
--   i.e. drop the column list this file granted and restore 0075's table-wide grant. ⚑ Do NOT
--   reverse by naming a migration number: 0075's grant is the one being modified here, and a later
--   migration may touch profiles grants again — edit the current file's text, as above.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Revoke the table-wide UPDATE (the source of the hole), then re-grant the explicit allow-list.
-- `id`, `org_id`, `created_at`, `status` are now non-writable by any client role. The allow-list is
-- every profiles column EXCEPT those four (11 of 15), matching the verified client-write surface.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke update on public.profiles from authenticated, anon;
grant update (full_name, email, avatar_url, title, location, skills, utilization,
              company_id, role, manager_id, updated_at) on public.profiles to authenticated;

comment on table public.profiles is
  '⚑ 0182: client UPDATE is an explicit column allow-list (full_name, email, avatar_url, title, '
  'location, skills, utilization, company_id, role, manager_id, updated_at). id, org_id, created_at '
  'and status are NOT client-writable — status is ADMIN-ONLY via admin_set_user_status (owner ruling '
  '2026-07-30). A table-wide grant would re-open the hole: a column revoke cannot subtract from one, '
  'so the allow-list is the only shape that holds. has_column_privilege() is the oracle.';
