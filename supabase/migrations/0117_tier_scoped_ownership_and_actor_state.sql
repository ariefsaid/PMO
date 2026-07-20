-- 0117_tier_scoped_ownership_and_actor_state.sql — round-7 cross-family audit, B9 + B6.
--
-- §A (B9) domain_owned_by_tier(org, domain, tier): `domain_externally_owned(org, domain)` (0087:48-51)
--    ignores `external_tier`, and the adapter-dispatch authorization guard called it without one. So an
--    org that assigned `revenue` to a DIFFERENT external tier while an ERPNext binding still existed
--    kept passing the ERPNext dispatch surface — it would accept and POST real money documents for a
--    domain ERPNext no longer owns. The sweep already scopes its ownership read by tier
--    (`listEmployingOrgsLive`: `.eq('external_tier','erpnext')`); the dispatch is the one place the
--    tier was dropped. 0087's tier-agnostic function is KEPT AS IS (0088's read-model write-policy flip
--    asks a genuinely tier-agnostic question: "is this domain externally owned at all?").
--
-- §B (B6) actor_authorization_state(org, user): the sweep's recovery pass rebuilds a money command from
--    the frozen outbox payload and dispatches it directly, so a replay re-runs NONE of the dispatch
--    gates and the original actor may since have been demoted, deactivated or banned. Re-asserting the
--    authorization rule at replay time needs the actor's CURRENT role + active membership for an
--    ARBITRARY user id, evaluated by a machine (service-role) caller that cannot use `auth.uid()`-based
--    `is_active_member()` and, being RLS-exempt, must not simply read `profiles` unguarded. This
--    SECURITY DEFINER accessor answers exactly that, in one round trip, for BOTH paths — the deputy
--    (caller-JWT) client on the synchronous dispatch and the service client on recovery — so the rule
--    in `adapter-dispatch/authGuard.ts` has ONE implementation rather than a forked replay copy.
--
--    `active` is the SAME predicate as `is_active_member()` (0095: profiles.status='active' AND
--    auth.users.banned_until null-or-past), conjoined with membership of the org being asked about.
--    A user-JWT caller may only ask about THEMSELVES in their OWN org (else 42501) — the definer must
--    not become a role/status oracle for other users; the machine caller (service_role) may ask about
--    any actor, which is the whole point of the recovery re-check.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.actor_authorization_state(uuid,uuid);
--   drop function if exists public.domain_owned_by_tier(uuid,text,text);
-- (plus reverting authGuard.ts to `domain_externally_owned` + the profiles.role read).

-- ============================================================================
-- §A — tier-scoped domain ownership.
-- ============================================================================

-- SECURITY INVOKER + stable, exactly like 0087's `domain_externally_owned`: a user-JWT caller reads
-- under its own-org RLS (own-org ownership is not a secret — the Integrations view renders it), and the
-- service client (RLS-exempt) reads the row it needs for the recovery re-check.
create or replace function public.domain_owned_by_tier(p_org_id uuid, p_domain text, p_tier text)
  returns boolean
  language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.external_domain_ownership
     where org_id = p_org_id and domain = p_domain and external_tier = p_tier
  )
$$;

revoke all on function public.domain_owned_by_tier(uuid,text,text) from public;
grant  execute on function public.domain_owned_by_tier(uuid,text,text) to authenticated;
grant  execute on function public.domain_owned_by_tier(uuid,text,text) to service_role;

comment on function public.domain_owned_by_tier(uuid,text,text) is
  'Is p_domain assigned to p_tier for p_org_id? The TIER-SCOPED form of domain_externally_owned() — '
  'the adapter-dispatch authorization guard must not accept an ERPNext money command for a domain '
  'another external tier owns (round-7 audit B9).';

-- ============================================================================
-- §B — the actor's current authorization state (role + active membership).
-- ============================================================================

create or replace function public.actor_authorization_state(p_org_id uuid, p_user_id uuid)
  returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_role   text;
  v_active boolean;
begin
  -- A user-JWT caller may only ask about ITSELF, in its OWN org. The machine (service_role — the sweep
  -- recovery re-check, and the dispatch's own service client) may ask about the recorded actor of any
  -- outbox row in the org it is reconciling.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and (p_user_id is distinct from auth.uid() or p_org_id is distinct from auth_org_id()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select p.role::text,
         (p.status = 'active'
          and p.org_id = p_org_id
          and (u.banned_until is null or u.banned_until <= now()))
    into v_role, v_active
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.id = p_user_id;

  -- No profile row ⇒ nothing to authorize. Fail closed with a shape the caller can read uniformly.
  if not found then
    return jsonb_build_object('role', null, 'active', false);
  end if;
  return jsonb_build_object('role', v_role, 'active', v_active);
end $$;

revoke all on function public.actor_authorization_state(uuid,uuid) from public;
grant  execute on function public.actor_authorization_state(uuid,uuid) to authenticated;
grant  execute on function public.actor_authorization_state(uuid,uuid) to service_role;

comment on function public.actor_authorization_state(uuid,uuid) is
  'The actor''s CURRENT role + active membership (the is_active_member() predicate, for an arbitrary '
  'user id) — so adapter-dispatch and the erpnext-sweep recovery pass run ONE authorization rule '
  'against the live JWT caller and against an outbox row''s recorded actor_user_id (round-7 audit B6). '
  'Self-only for user callers; any actor for service_role.';
