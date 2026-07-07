-- 0065_admin_set_user_status.sql — admin_set_user_status security-definer RPC (FR-INV-002/003,
-- AC-INV-003/004) + the two invite-helper RPCs (FR-INV-005, folded here so S3 is a no-new-migration
-- slice per the plan's Task S1-F).
--
-- admin_set_user_status re-asserts (Admin-in-target-org OR Operator); caller-agnostic sole-/self-
-- Admin lockout guard (rejects even an Operator — no Operator can brick an org's only Admin); revokes
-- the target's active session via auth.users.banned_until (security-definer reaches the auth schema
-- as the migration-owner role, like the GoTrue admin path); re-asserts is_active_member() at entry
-- (FR-INV-003 last clause: a disabled caller reaches nothing).
--
-- operator_org_exists / org_has_member_email: the invite-helper RPCs consumed by the
-- admin-invite-user edge fn (S3). operator_org_exists is Operator-only; org_has_member_email is
-- scoped to the target org (no cross-org leak to an org-Admin — FR-INV-005 conscious decision).
--
-- Reversibility (ADR-0006): supabase db reset. Manual:
--   drop function if exists public.org_has_member_email(uuid,text);
--   drop function if exists public.operator_org_exists(uuid);
--   drop function if exists public.admin_set_user_status(uuid,public.profile_status,uuid);

create or replace function public.admin_set_user_status(
  p_profile_id uuid,
  p_status     public.profile_status,
  p_org_id     uuid
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_caller_org  uuid := public.auth_org_id();
  v_caller_role user_role := public.auth_role();
  v_target_org  uuid;
  v_target_role user_role;
  v_admin_count int;
begin
  -- entry guard: a disabled caller reaches nothing (FR-INV-003).
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;

  -- resolve target (definer bypasses RLS — read the raw row to authorize).
  select org_id, role into v_target_org, v_target_role
    from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'not_found' using errcode = '42501';
  end if;

  -- p_org_id is the client-supplied scope; assert it matches the target's real org so an Operator
  -- can't reach across by lying about p_org_id, and an org-Admin can't reach another org.
  if p_org_id <> v_target_org then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;

  -- AUTHORITY: Admin-in-target-org (caller_org = target_org AND caller Admin) OR Operator.
  if not (
    (v_caller_org = v_target_org and v_caller_role = 'Admin')
    or public.is_operator()
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- CALLER-AGNOSTIC lockout guard (FR-INV-002 / AC-INV-004): cannot disable self; cannot disable the
  -- org's sole Admin — regardless of who the caller is (incl. an Operator).
  if p_status = 'disabled' then
    if p_profile_id = auth.uid() then
      raise exception 'cannot disable yourself' using errcode = 'P0001';
    end if;
    if v_target_role = 'Admin' then
      -- TOCTOU guard (security review L4): take a self-serializing lock so two concurrent
      -- disable calls can't both pass the <= 1 check and leave the org with zero Admins.
      -- SHARE ROW EXCLUSIVE is the weakest mode that conflicts with itself + writes.
      lock table public.profiles in share row exclusive mode;
      select count(*) into v_admin_count
        from public.profiles
       where org_id = v_target_org and role = 'Admin' and status = 'active';
      if v_admin_count <= 1 then
        raise exception 'cannot disable the only Admin' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- apply the status change (definer bypasses profiles RLS).
  update public.profiles set status = p_status where id = p_profile_id;

  -- revoke / restore the active session: banned_until is a native auth.users column.
  if p_status = 'disabled' then
    update auth.users set banned_until = '2999-12-31T23:59:59+00'::timestamptz
      where id = p_profile_id;
  else
    update auth.users set banned_until = null where id = p_profile_id;
  end if;
end $$;

revoke all on function public.admin_set_user_status(uuid,public.profile_status,uuid) from public;
grant execute on function public.admin_set_user_status(uuid,public.profile_status,uuid) to authenticated;

-- ── Invite-helper RPCs (FR-INV-005, consumed by the admin-invite-user edge fn in S3). ──────────

-- operator_org_exists: Operator-only org existence probe (the edge fn validates p_org_id).
-- is_active_member() conjunct (security review M1): disabled-Operator cached-JWT guard.
create or replace function public.operator_org_exists(p_org_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_operator() and public.is_active_member()
     and exists (select 1 from public.organizations where id = p_org_id)
$$;
revoke all on function public.operator_org_exists(uuid) from public;
grant execute on function public.operator_org_exists(uuid) to authenticated;

-- org_has_member_email: Operator (any org) OR Admin-in-org (own org) email-membership probe.
-- Scoped to the target org: no cross-org leak to an org-Admin (FR-INV-005 conscious decision). An
-- Operator may probe any org (trusted platform staff); a non-Operator only ever sees their own org.
create or replace function public.org_has_member_email(p_org_id uuid, p_email text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
     where lower(pr.email) = lower(p_email)
       and public.is_active_member()                      -- security review M1 (operator path)
       and (
         public.is_operator()
         or (pr.org_id = p_org_id and p_org_id = public.auth_org_id() and public.auth_role() = 'Admin')
       )
  )
$$;
revoke all on function public.org_has_member_email(uuid,text) from public;
grant execute on function public.org_has_member_email(uuid,text) to authenticated;
