-- 0214_member_email_probe_pinned.sql — #627 (map #618): two second-org companions found by the sweep.
--
-- §1 org_has_member_email(p_org_id, p_email) — the invite duplicate gate (inviteHandler FR-INV-005).
--    The Operator branch never constrained pr.org_id = p_org_id, so for an Operator it answered "does
--    this email exist in ANY org" while the caller believed "in the target org". Inviting a person into
--    a second org was refused as a duplicate whenever that email already lived in the seed org.
--    Indistinguishable with one org. Pinned to the target org on both branches.
-- §2 assert_org_destroyable(uuid) — only scripts/assert-org-destroyable.mjs calls it, under the DB URL;
--    the authenticated EXECUTE grant answered any org id's lifecycle state to any member. Revoked.
--
-- Reversibility: re-run 0065's org_has_member_email; re-grant 0191's EXECUTE.

create or replace function public.org_has_member_email(p_org_id uuid, p_email text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
     where lower(pr.email) = lower(p_email)
       and pr.org_id = p_org_id                              -- #627: pinned for BOTH branches
       and public.is_active_member()
       and (
         public.is_operator()
         or (p_org_id = public.auth_org_id() and public.auth_role() = 'Admin')
       )
  )
$$;

revoke execute on function public.assert_org_destroyable(uuid) from authenticated;
