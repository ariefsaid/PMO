-- 0192_operator_create_org.sql — operator_create_org(): ONE auditable path that creates an org AND
-- its required companion rows atomically (#484, DD-ORG-1 / DD-RIS-2). Operator surface, no UI.
--
-- WHY IT EXISTS AT ALL. Org creation happens ~3× in a deployment's life (DD-ORG-1), so the cost that
-- matters is not ergonomics — it is that the list of things a new org must carry KEEPS GROWING, and
-- every hand-written `insert into organizations` is a chance to miss one. This function is where that
-- list lives. When the next required column lands, it is added HERE and every future org gets it.
--
-- AUTHORIZATION SHAPE — copied from operator_set_domain_ownership (0087), not invented:
--   security definer + `set search_path = public` · is_active_member() then is_operator(), both 42501
--   · `revoke all ... from public` then an explicit `grant execute to authenticated`.
-- 0185 revoked the postgres default-privilege EXECUTE grant to anon/authenticated, so the explicit
-- grant below is the ONLY thing that makes this callable — anon never gets one.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- COMPANION INVENTORY — what this function sets today, and what it CANNOT set yet.
-- Checked against the live schema at 0190 (`grep` over supabase/migrations for each column name),
-- not assumed. A column that does not exist is recorded here as a TODO, never silently skipped.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SET HERE (columns exist today):
--   organizations.name              — 0001_init_schema
--   organizations.default_currency  — 0187_money_currency_seam. ⚑ REQUIRED PARAMETER, no default.
--       The column carries `not null default 'USD'`, so an org created without stating a currency
--       silently becomes a USD org. For an IDR client that is a wrong answer that never raises. The
--       parameter is mandatory for the same reason DD-CUR-3 gave `tax_treatment` no default:
--       omission must be a hard error, not a plausible-looking wrong value.
--   the first Admin membership     — a `profiles` row (org_id + role 'Admin' + status 'active').
--       There is no separate memberships table; `profiles.org_id` IS the membership (DD-ORG-2).
--
-- ⛔ TODO — NOT SET HERE, because the columns DO NOT EXIST YET. Each one must be added to this
--    function in the SAME migration that adds the column, or the org silently inherits a default:
--   • organizations.default_locale / .default_number_locale / .default_timezone — DD-I18N-2,
--     built by the i18n seam, **issue #468**. Not on `dev` at 0190. DD-RIS-2 needs the RIS org
--     created with `id` / Indonesian number format / `Asia/Jakarta`; until #468 lands, this
--     function cannot state them and an operator must set them by hand afterwards.
--   • organizations.pmo_epoch_at — DD-XING-2, the standalone→connected boundary. Described in
--     ADR-0055 §5A / DD-XING-2 but NOT built. It is free at creation and guesswork to reconstruct
--     once an ERP arrives, so this is the companion with the highest cost of being late.
--   • organizations.lifecycle_state — DD-RIS-1, built by **issue #489**. Not on `dev` at 0190.
--     When it lands, the caller must pass it EXPLICITLY and it must be settable to 'live' at
--     creation: the guard is default-deny so an unmarked org is already protected, but the real
--     client's protection should rest on a decision, not a default — and `live` is terminal, so
--     creation is the only moment stamping it is free.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TWO TRAPS CHECKED BEFORE WRITING THIS (both from the currency work that just landed).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- DD-CUR-4 (column-level INSERT grants): `organizations` and `profiles` carry TABLE-level grants,
--   not column-level ones, so no per-column INSERT grant is needed for anything written here.
--   It would not matter either way: a SECURITY DEFINER function runs as the table owner, and grants
--   gate CLIENT roles, not the owner. Recorded because the check is the point, not the answer.
-- DD-CUR-2 (BEFORE triggers fire in NAME ORDER): `profiles` carries `profiles_stamp_org_id` (0074),
--   which rewrites NEW.org_id to `auth_org_id()` — the OPERATOR's org — but ONLY when the row relied
--   on the default (org_id null, or still the seed-org literal). This function supplies a freshly
--   minted gen_random_uuid() org_id, so the predicate is false and the trigger is a no-op. ⚑ If
--   0074's narrow predicate is ever widened, the first Admin lands in the OPERATOR's org instead of
--   the new one and nothing raises. AC-ORG-005 asserts the resulting org_id, which is what catches it.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- THE GRANT REVOKE. The DoD requires that no client INSERT grant on `organizations` exists, so the
-- RPC is the sole write path. `authenticated` still held table-level INSERT/UPDATE/DELETE from
-- 0075's blanket re-grant. Those are inert today — `organizations` FORCEs RLS and its ONLY policy is
-- `organizations_select` (verified: no write policy anywhere in supabase/migrations), so every client
-- write already fails the RLS check — but inert is not denied, and 0105's reasoning applies verbatim:
-- the privilege check runs BEFORE RLS, so revoking makes the statement unattemptable rather than
-- merely unsuccessful. Nothing in the app tree writes `organizations` as a client role (swept:
-- pmo-portal/src, pmo-portal/pages, supabase/functions — zero hits). The one writer,
-- e2e/serial/AC-TSP-031-cross-org.spec.ts, uses the service-role client, whose grants come from 0080
-- and are untouched here. `anon` is named for defence in depth only — 0105 already revoked its write
-- DML, so that half is a correct no-op.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- WHY THE ADMIN'S EMAIL IS NOT A PARAMETER. 0184 made `profiles.email` non-client-writable because it
-- is an identity key that must track auth.users.email and never diverge (it keys the invite-duplicate
-- gate, the ERP employee link proposal, and the ClickUp member join). A `p_admin_email` parameter
-- would be a fresh way to make them diverge on day one, so the email is READ from auth.users instead.
-- The caller therefore creates the auth user first (Auth Admin API / `supabase auth-admin invite`)
-- and passes its id. This function deliberately does NOT create auth.users rows — password hashing
-- and identity provisioning belong to GoTrue.
--
-- ⚑ BOOTSTRAP LIMIT, stated rather than hidden: this RPC needs a live Operator (is_operator() reads
-- platform_operators under the caller's JWT), so it cannot create the FIRST org in a brand-new
-- Supabase project, which has no profiles and no operators yet. That case stays with the
-- seed/provisioning path (scripts/lib/provisionOrgAdmin.mjs). On the SHARED deployment — the case
-- DD-ORG-1 is about, where RIS/Gordi/Demo live side by side — an Operator already exists and this
-- function is the path. Runbook: docs/environments.md § "Creating an org (operator)".
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.9.0 is in production. The manual reverse is an operation on THIS
--   file's text (do not name a migration number: 0075's grant list is not the current state and a
--   later migration may touch organizations grants again):
--     drop function if exists public.operator_create_org(text,uuid,text,text);
--     grant insert, update, delete on public.organizations to authenticated;
--   Reversing the revoke restores a state in which `authenticated` may ATTEMPT a write on
--   organizations (still RLS-denied), so do it only alongside a reversal of DD-ORG-1. `anon` is
--   deliberately NOT re-granted — 0105 removed its write DML on every table and that stands.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the RPC becomes the sole write path: strip the inert client write grants.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke insert, update, delete on public.organizations from authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — operator_create_org(): the org + every companion it can set, in ONE transaction.
-- A plpgsql function runs inside the caller's transaction, so the organizations row and the first
-- Admin membership commit together or not at all. That atomicity is the whole contract: an org with
-- no administrator is not a created org, it is a half-created one nobody can finish.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.operator_create_org(
  p_name             text,   -- the org's display name
  p_admin_user_id    uuid,   -- an EXISTING auth.users id — the first Admin
  p_admin_full_name  text,   -- display name for the Admin's profile
  p_default_currency text    -- ISO-4217 alpha-3; REQUIRED (see the companion inventory above)
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id      uuid;
  v_admin_email text;
begin
  -- Gate, in 0087's order: membership standing first, then the platform grant. Both 42501.
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;

  -- Inputs. Every one of these is a P0001 rather than a silent fallback: a blank name or a missing
  -- currency is an operator typo, and the whole point of this function is that the org does not get
  -- created holding a value nobody chose.
  if p_name is null or btrim(p_name) = '' then
    raise exception 'org_name_required' using errcode = 'P0001';
  end if;
  if p_admin_user_id is null then
    raise exception 'admin_user_required' using errcode = 'P0001';
  end if;
  if p_admin_full_name is null or btrim(p_admin_full_name) = '' then
    raise exception 'admin_full_name_required' using errcode = 'P0001';
  end if;
  if p_default_currency is null or btrim(p_default_currency) = '' then
    raise exception 'default_currency_required' using errcode = 'P0001';
  end if;

  -- Duplicate-name guard. `organizations` has no unique constraint on name and this file does not add
  -- one (existing rows are not known to be unique, and a unique index is a separate, riskier change),
  -- so this is an operator-typo guard, NOT a concurrency-safe uniqueness guarantee. It matters
  -- because the shipped provisioning script keys its idempotency on the org name.
  if exists (select 1 from public.organizations where lower(name) = lower(btrim(p_name))) then
    raise exception 'org_name_taken' using errcode = '23505';
  end if;

  -- The first Admin must be a real auth user with no profile yet. A profile that already exists
  -- belongs to some org, and DD-ORG-2 forbids moving it — the answer there is offboard + reinvite,
  -- so refuse loudly rather than raising a bare PK violation the operator has to decode.
  select u.email into v_admin_email from auth.users u where u.id = p_admin_user_id;
  if not found then
    raise exception 'unknown_admin_user' using errcode = '23503';
  end if;
  if v_admin_email is null or btrim(v_admin_email) = '' then
    raise exception 'admin_user_has_no_email' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = p_admin_user_id) then
    raise exception 'admin_already_has_profile' using errcode = '23505';
  end if;

  insert into public.organizations (name, default_currency)
  values (btrim(p_name), p_default_currency)
  returning id into v_org_id;

  -- ⚑ The companion, not an afterthought. org_id is stated explicitly (see the DD-CUR-2 note above).
  insert into public.profiles (id, org_id, full_name, email, role, status)
  values (p_admin_user_id, v_org_id, btrim(p_admin_full_name), v_admin_email, 'Admin', 'active');

  -- ⛔ NEXT COLUMN GOES HERE. See the TODO block in this file's header — locale defaults (#468),
  -- pmo_epoch_at (DD-XING-2), lifecycle_state (#489). Add the parameter, set the column, and extend
  -- supabase/tests/operator_create_org.test.sql in the same migration.

  return v_org_id;
end $$;

comment on function public.operator_create_org(text,uuid,text,text) is
  'DD-ORG-1 (#484): Operator-only, security-definer creation of an org AND its required companions '
  '(first Admin membership, default_currency) in one transaction. No UI. Locale defaults (#468), '
  'pmo_epoch_at (DD-XING-2) and lifecycle_state (#489) are TODO — their columns do not exist yet; '
  'see this function''s migration header. Runbook: docs/environments.md.';

revoke all     on function public.operator_create_org(text,uuid,text,text) from public;
grant  execute on function public.operator_create_org(text,uuid,text,text) to authenticated;
