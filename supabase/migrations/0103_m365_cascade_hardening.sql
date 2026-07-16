-- 0103_m365_cascade_hardening.sql — Luna BLOCK fixes (C1/H2/H3/H5/M2/M3/L1) for the M365 cascade.
-- Closes every path by which NFR-M365-107 (tokens deleted on offboard / disentitlement) was
-- bypassable. Replaces the 0101 _core + disentitle trigger with hardened versions and adds:
--   • C1(b): BEFORE INSERT OR UPDATE write-guard on ms_graph_connections — the authority that makes
--            token resurrection structurally impossible (a callback-only check is TOCTOU-vulnerable).
--   • C1(a): _core ALSO purges pending m365_pkce_states (per-user / per-org) so an in-flight OAuth
--            callback dies with INVALID_STATE instead of upserting a resurrected connection.
--   • H2:    AFTER INSERT cascade on org_features (absent-row toggle-OFF) + broadened DELETE
--            (any m365_integration row deletion cascades, not just enabled=true).
--   • H3:    BEFORE UPDATE immutability guard on org_features (feature_key + org_id are row identity).
--   • H5(i): _core single-user branch deletes by user_id ALONE (a mis-orged row is still cleaned).
--   • H5(ii): UNIQUE (id, org_id) on profiles + composite FK (user_id, org_id) on ms_graph_connections
--            so a connection's user and org MUST agree.
--   • M2:    _core audits via DELETE ... RETURNING only (concurrency-safe — no SELECT/DELETE race,
--            no double-audit, no unaudited row inserted in between).
--   • M3:    entra_tenant_id CHECK tightened to reject '..' anywhere and all-dot values.
--   • L1:    index on m365_pkce_states (expires_at) — the sweep predicate.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (exact statements):
--   drop trigger if exists m365_connection_write_guard on public.ms_graph_connections;
--   drop function if exists public.m365_connection_write_guard();
--   drop trigger if exists m365_disentitle_insert_trigger on public.org_features;
--   drop trigger if exists m365_org_features_immutable_trigger on public.org_features;
--   drop function if exists public.m365_org_features_immutable();
--   -- restore the 0102 (looser) tenant CHECK:
--   alter table public.ms_graph_connections drop constraint if exists ms_graph_connections_entra_tenant_id_fmt;
--   alter table public.ms_graph_connections add constraint ms_graph_connections_entra_tenant_id_fmt
--     check (entra_tenant_id ~ '^[A-Za-z0-9._-]+$');
--   -- drop the H5(ii) composite FK + profiles uniqueness, restore the single-column user_id FK:
--   alter table public.ms_graph_connections drop constraint if exists ms_graph_connections_user_org_fkey;
--   alter table public.ms_graph_connections
--     add constraint ms_graph_connections_user_id_fkey
--     foreign key (user_id) references public.profiles(id) on delete cascade;
--   alter table public.profiles drop constraint if exists profiles_id_org_id_key;
--   drop index if exists public.m365_pkce_states_expires_at_idx;
--   -- _core + m365_disentitle_trigger revert to their 0101 definitions on a fresh db reset.

-- ============================================================================
-- 1. C1(a) + H5(i) + M2: harden the internal cascade core.
--    Single-user branch now deletes by user_id ALONE (H5i) and audits only DELETE ... RETURNING
--    rows (M2). Both branches ALSO purge pending PKCE states (C1a).
-- ============================================================================
create or replace function public._m365_disconnect_cascade_core(
  p_org_id   uuid,
  p_user_id  uuid,      -- null = all users in org (operator disentitlement / org disable)
  p_reason   text,      -- allowlisted: 'disentitled' | 'offboard' | 'org_disabled' | 'admin_disconnect'
  p_actor_id uuid       -- the actor performing the action (auth.uid() from caller context)
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_conn_id   uuid;
  v_conn_org  uuid;
  v_user_id   uuid;
  v_detail    jsonb;
  -- 'reconciled' is the one-time migration scrub reason (0103 preflight + 0105 reconcile): a
  -- connection scrubbed because it was already stale (user inactive / org disentitled / bad tenant).
  v_allowed_reasons constant text[] := array['disentitled','offboard','org_disabled','admin_disconnect','reconciled'];
begin
  -- Reason allowlist (LOW-2): enforced in core so ALL call paths are guarded.
  if p_reason is null or p_reason <> all(v_allowed_reasons) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if p_user_id is not null then
    -- Single user (offboard / admin_disconnect).
    -- H5(i): delete by user_id ALONE (not org_id AND user_id) so a mis-orged row is still cleaned.
    --         The composite FK (H5ii) prevents that going forward; this is defense-in-depth.
    -- M2: DELETE ... RETURNING + audit ONLY the returned rows — concurrency-safe (no SELECT-then-
    --     DELETE race, no double-audit, no row inserted-and-deleted-without-audit between the two).
    -- Each deleted connection is audited under ITS OWN org_id (correct attribution for any legacy
    -- mis-orged row; equals p_org_id for a conforming row).
    for v_conn_id, v_conn_org in
      delete from public.ms_graph_connections where user_id = p_user_id returning id, org_id
    loop
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', p_user_id);
      perform public.log_audit('m365.connection.revoked', v_conn_org, p_actor_id, v_conn_id, v_detail);
    end loop;
    -- C1(a): purge pending PKCE states for this user so an in-flight OAuth callback cannot
    -- resurrect a connection (the state row is gone → consume returns null → INVALID_STATE).
    delete from public.m365_pkce_states where user_id = p_user_id;
  else
    -- All users in org (disentitled / org_disabled).
    -- M2: DELETE ... RETURNING + audit only returned rows.
    for v_conn_id, v_user_id in
      delete from public.ms_graph_connections where org_id = p_org_id returning id, user_id
    loop
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', v_user_id);
      perform public.log_audit('m365.connection.revoked', p_org_id, p_actor_id, v_conn_id, v_detail);
    end loop;
    -- C1(a): purge pending PKCE states for the whole org.
    delete from public.m365_pkce_states where org_id = p_org_id;
  end if;

  -- No exception if zero rows deleted (idempotent).
end $$;

revoke all on function public._m365_disconnect_cascade_core(uuid, uuid, text, uuid) from public;

-- ============================================================================
-- 2. C1(b): BEFORE INSERT OR UPDATE write-guard on ms_graph_connections.
--    The AUTHORITY that makes token resurrection structurally impossible. Rejects any write unless
--    the target user is active AND the org is entitled for m365_integration — regardless of any
--    callback/cascade race (a callback-only check is TOCTOU). errcode 42501 so the callback maps it
--    to a clear, token-free error_event + FE error redirect (C1c).
--    Fires for EVERY role including service_role (RLS bypass does not skip triggers) → the callback's
--    service-role upsert is rejected when the user was disabled / org disentitled mid-flight.
-- ============================================================================
create or replace function public.m365_connection_write_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_status public.profile_status;
begin
  -- The target user must be active AND belong to NEW.org_id (the composite FK structurally
  -- enforces the agreement; this read is the live status check the FK cannot encode).
  select status into v_status from public.profiles where id = NEW.user_id and org_id = NEW.org_id;
  if not found or v_status <> 'active' then
    raise exception 'user_not_active' using errcode = '42501';
  end if;
  -- The org must hold an ENABLED m365_integration entitlement (absence = not entitled).
  if not exists (
    select 1 from public.org_features
     where org_id = NEW.org_id and feature_key = 'm365_integration' and enabled
  ) then
    raise exception 'org_not_entitled' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.m365_connection_write_guard() from public;

drop trigger if exists m365_connection_write_guard on public.ms_graph_connections;
create trigger m365_connection_write_guard
  before insert or update on public.ms_graph_connections
  for each row
  execute function public.m365_connection_write_guard();

-- ============================================================================
-- 3. H2: disentitlement trigger now handles INSERT (absent-row toggle-OFF) and a broadened DELETE.
--    - INSERT: feature_key='m365_integration' AND enabled=false → cascade (cleans a stale connection
--      from a callback race / legacy data / service-role write that predates the C1(b) guard).
--    - UPDATE: unchanged (true → false cascades).
--    - DELETE: broadened — ANY m365_integration row deletion cascades (previously only enabled=true).
-- ============================================================================
create or replace function public.m365_disentitle_trigger() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    -- H2: an absent-row toggle-OFF lands here as INSERT enabled=false.
    if NEW.feature_key <> 'm365_integration' or NEW.enabled then
      return new;  -- non-m365, or an enable — never cascades
    end if;
    perform public._m365_disconnect_cascade_core(NEW.org_id, null, 'disentitled', auth.uid());
    return new;

  elsif TG_OP = 'UPDATE' then
    -- Only fire when m365_integration toggles true → false.
    if NEW.feature_key <> 'm365_integration' then
      return new;
    end if;
    if not (OLD.enabled = true and NEW.enabled = false) then
      return new;
    end if;
    perform public._m365_disconnect_cascade_core(NEW.org_id, null, 'disentitled', auth.uid());
    return new;

  elsif TG_OP = 'DELETE' then
    -- H2 (broadened): cascade on deletion of ANY m365_integration row (the prior guard skipped a
    -- deleted-but-disabled row, which could leave a stale connection behind).
    if OLD.feature_key <> 'm365_integration' then
      return old;
    end if;
    perform public._m365_disconnect_cascade_core(OLD.org_id, null, 'disentitled', auth.uid());
    return old;

  else
    return null; -- safety
  end if;
end $$;

drop trigger if exists m365_disentitle_insert_trigger on public.org_features;
create trigger m365_disentitle_insert_trigger
  after insert on public.org_features
  for each row
  execute function public.m365_disentitle_trigger();

drop trigger if exists m365_disentitle_update_trigger on public.org_features;
create trigger m365_disentitle_update_trigger
  after update on public.org_features
  for each row
  execute function public.m365_disentitle_trigger();

drop trigger if exists m365_disentitle_delete_trigger on public.org_features;
create trigger m365_disentitle_delete_trigger
  after delete on public.org_features
  for each row
  execute function public.m365_disentitle_trigger();

-- ============================================================================
-- 4. H3: feature_key + org_id are row IDENTITY on org_features — make them immutable.
--    Client roles hold direct UPDATE on org_features (0075); without this, an enabled
--    m365_integration row could be renamed (feature_key → 'crm') or moved (org_id changed), evading
--    the disentitlement cascade (which keys on NEW.feature_key) and orphaning the old org's tokens.
--    enabled/updated_at/updated_by remain freely mutable (operator_toggle_feature upserts those).
-- ============================================================================
create or replace function public.m365_org_features_immutable() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if NEW.feature_key is distinct from OLD.feature_key then
    raise exception 'feature_key_immutable' using errcode = '42501';
  end if;
  if NEW.org_id is distinct from OLD.org_id then
    raise exception 'org_id_immutable' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.m365_org_features_immutable() from public;

drop trigger if exists m365_org_features_immutable_trigger on public.org_features;
create trigger m365_org_features_immutable_trigger
  before update on public.org_features
  for each row
  execute function public.m365_org_features_immutable();

-- ============================================================================
-- 5a. HIGH (Luna 'Conditional migration deployment failure'): RECONCILE before the constraints.
--    The composite FK (§5b) and the tightened tenant CHECK (§6) both validate EXISTING rows the
--    instant they are added. On a database that already holds (i) a legacy mis-orged connection
--    (user_id whose profile is in a DIFFERENT org, or an orphaned user_id) or (ii) a legacy
--    path-confusion tenant value ('..' / all-dot), those ALTERs would ABORT — leaving the ENTIRE
--    hardening silently half-applied (a fresh local reset has no rows, which is why this only bites
--    a populated prod DB). We DELETE the offending rows FIRST; the constraints then add cleanly, so
--    the migration can never land half-applied (if a DELETE failed, none of the DDL below would run).
--
--    Why deletion is safe (vs NOT VALID/VALIDATE): both classes are UNUSABLE TOKENS by definition —
--    a mis-orged connection structurally violates the new (user_id, org_id)↔profiles invariant
--    (it can never be a legitimate connection) and a '..'/all-dot tenant is SSRF path-confusion
--    garbage the tightened CHECK exists to forbid. They carry no valid org attribution to audit
--    under and are already opaque ciphertext we cannot read. The DELETEs are idempotent (no-ops on
--    a clean/fresh DB). Reversibility: a row once deleted here is gone — but it was unusable;
--    repopulate via a fresh OAuth connect after deploy.
--
--    Luna round-3 (HIGH + MED-audit): (1) the tenant preflight regex was MIS-ESCAPED —
--    under standard_conforming_strings=on, '~ \'\\\\.\\\\.\'' matches a literal BACKSLASH + any char
--    (twice), NOT 'foo..bar', so a legacy dot-segment tenant SURVIVED the preflight and the
--    (correctly-escaped) CHECK then rejected it → 0103 ABORTED → the composite FK, write guard, and
--    ALL hardening never installed. The correct pattern is '~ \'\\.\\.\'' (literal dot, literal
--    dot). (2) The preflight deletes dropped ciphertext IRREVERSIBLY with NO audit trail — both
--    deletes now run as DELETE ... RETURNING + log_audit loops (reason='reconciled', allowlisted in
--    §1) so every scrubbed connection leaves a durable m365.connection.revoked audit row.
-- ============================================================================
do $$
declare
  v_id  uuid;
  v_org uuid;
begin
  -- (i) mis-orged (profile exists in a different org) OR orphaned (no profile at all) — would
  --     violate the composite FK (user_id, org_id) → profiles (id, org_id) added in §5b.
  for v_id, v_org in
    delete from public.ms_graph_connections c
     where not exists (
       select 1 from public.profiles p where p.id = c.user_id and p.org_id = c.org_id
     )
    returning c.id, c.org_id
  loop
    perform public.log_audit('m365.connection.revoked', v_org, null, v_id,
      jsonb_build_object('reason','reconciled','source','preflight_misorg_or_orphan'));
  end loop;

  -- (ii) entra_tenant_id the tightened CHECK (§6) will reject: '..' anywhere (dot-segment) or
  --      all-dot values. FIXED regexes: '\.\.' = literal-dot literal-dot (matches 'foo..bar'); and
  --      '^[.]+$' = ALL-dot values only (., .., ...). Luna round-4 (LOW-4): the prior '^[.]+'
  --      (one-or-more leading dots) OVERMATCHED — it matched '.foo' (leading dot + real chars),
  --      but the final CHECK ACCEPTS '.foo' (it only rejects all-dot '^[.]+$'). A leading-dot but
  --      non-all-dot tenant is a valid (if unusual) value the CHECK keeps, so the preflight must
  --      NOT delete it. '^[.]+$' deletes exactly what the CHECK rejects (the all-dot set) plus the
  --      '\.\.' arm catches any dot-segment anywhere. Verified: '.foo'→survives, '..'/'.'→deleted,
  --      'foo..bar'→deleted (via '\.\.'), GUID→survives.
  for v_id, v_org in
    delete from public.ms_graph_connections
     where entra_tenant_id ~ '\.\.' or entra_tenant_id ~ '^[.]+$'
    returning id, org_id
  loop
    perform public.log_audit('m365.connection.revoked', v_org, null, v_id,
      jsonb_build_object('reason','reconciled','source','preflight_bad_tenant'));
  end loop;
end $$;

-- ============================================================================
-- 5b. H5(ii): enforce that a connection's user and org AGREE.
--    (a) profiles (id, org_id) uniqueness so a composite FK can target it (id is already PK, so this
--        is trivially satisfied by existing data — safe to add on a fresh reset).
--    (b) replace the single-column user_id FK with a composite (user_id, org_id) → profiles (id,
--        org_id). A row can no longer exist with org_id = A while its user's profile is in org B.
-- ============================================================================
alter table public.profiles
  add constraint profiles_id_org_id_key unique (id, org_id);

alter table public.ms_graph_connections drop constraint if exists ms_graph_connections_user_id_fkey;
alter table public.ms_graph_connections
  add constraint ms_graph_connections_user_org_fkey
  foreign key (user_id, org_id) references public.profiles (id, org_id) on delete cascade;

-- ============================================================================
-- 6. M3: tighten the entra_tenant_id format CHECK (the 0102 version accepted '.' and '..').
--    Keep GUIDs / common / organizations / consumers / ASCII+punycode domains valid; reject '..'
--    anywhere (path-confusion) and all-dot values ('.', '..', '...'). The host stays pinned so this
--    is path-confusion hardening, not arbitrary-host SSRF; runtime re-validation lives in the edge
--    functions (refresh/revoke/callback) via the shared graphPkce.isValidTenant.
-- ============================================================================
alter table public.ms_graph_connections drop constraint if exists ms_graph_connections_entra_tenant_id_fmt;
alter table public.ms_graph_connections
  add constraint ms_graph_connections_entra_tenant_id_fmt
  check (
       entra_tenant_id ~ '^[A-Za-z0-9._-]+$'
   and entra_tenant_id !~ '\.\.'     -- no consecutive dots (path-confusion / dot-segments)
   and entra_tenant_id !~ '^[.]+$'   -- reject all-dot values (., .., ...)
  );

comment on constraint ms_graph_connections_entra_tenant_id_fmt on public.ms_graph_connections is
  'M3: SSRF defense-in-depth for refresh/revoke URL construction. Tightened from 0102 to reject dot-segments (..) and all-dot values while keeping GUIDs / common / organizations / consumers / verified domains valid.';

-- ============================================================================
-- 7. L1: index the PKCE sweep's predicate (the 0102 cron deletes where expires_at < now()).
-- ============================================================================
create index if not exists m365_pkce_states_expires_at_idx on public.m365_pkce_states (expires_at);
