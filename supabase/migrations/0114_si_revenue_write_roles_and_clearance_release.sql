-- 0114_si_revenue_write_roles_and_clearance_release.sql — round-6 findings 2 + 3, re-worked to close
-- round-7 cross-family finding B1.
--
-- ── FINDING 3: the owner's revenue ruling was not enforced by the server.
-- `pmo-portal/src/auth/policy.ts` sets REVENUE_WRITE = Admin + Finance (owner ruling 2026-07-20), but
-- both server-side authorities still admitted Executive and Project Manager: the dispatch guard
-- (`adapter-dispatch/authGuard.ts`, fixed in the same change — now a per-domain role map) and these
-- SECURITY DEFINER RPCs. The FE-stricter-than-RLS principle allows a NARROWER front end; it does not
-- allow the enforcement authority to be the permissive side.
-- Fix (§B/§D/§E): every SI submit/authorship gate uses ('Admin','Finance'). PROCUREMENT's roles are a
-- DIFFERENT ruling and are deliberately untouched (Admin·Exec·PM·Finance), here and in authGuard.
--
-- ── ROUND-7 FINDING B1: the submit clearance could be BYPASSED — self-approval was still reachable.
-- 0113 §C made `submit_sales_invoice` record a clearance whose side effect is that
-- `claim_sales_invoice_author` raises 55006, refusing a body rewrite while a submit is in flight. Three
-- separate defects made that a decoration rather than a barrier:
--
--   (B1a) THE TTL WAS SHORTER THAN THE SUBMIT. The clearance lapsed after a hand-picked 5 minutes,
--         while an ERP submit can legitimately stay in flight far longer: `erpnext/client.ts` retries an
--         IDEMPOTENT request (a submit is a PUT; the mandatory post-submit re-fetch a GET) up to
--         ERP_DEFAULT_MAX_RETRIES times at ERP_REQUEST_TIMEOUT_MS each, plus the capped Retry-After
--         waits, and a submit dispatch issues several such requests. So approver B could pass the SoD
--         gate, wait for the clearance to lapse WHILE THE SUBMIT WAS STILL RUNNING, call
--         `claim_sales_invoice_author`, be appended to the author set, rewrite the amount — and the
--         still-running submit would commit B's numbers under B's own earlier approval.
--         Fix: `c_clearance_ttl` is now DERIVED from that retry budget (ERP_SUBMIT_MAX_IN_FLIGHT_MS =
--         26.25 min ⇒ 30 minutes here), and `submitClearanceTtl.test.ts` reads THIS FILE and fails if
--         the two ever drift apart. It is a backstop only — see the release design below.
--
--   (B1b) THE RELEASE WAS FENCED TO THE PARTY IT CONSTRAINS. The first cut of this migration let any
--         authenticated grantee release their OWN clearance (`user_id = auth.uid()`). But the attacker
--         IS the grantee: B could simply release the clearance mid-submit and walk straight through the
--         gate. A fence that names the constrained party is not a fence.
--         Fix (§E/§F): a clearance is now GRANTED and RELEASED only by the dispatch, through
--         SERVICE-ROLE-ONLY RPCs that `authenticated` cannot execute at all, and the release is fenced
--         to the CLEARANCE ID the granting dispatch holds — not to any caller identity.
--
--   (B1c) ONE CLEARANCE ROW PER INVOICE COLLAPSED CONCURRENT SUBMITS. With a single row per invoice, a
--         second submit dispatch overwrote the first's clearance, and when the SECOND resolved it
--         released the row — un-freezing the invoice while the FIRST submit was still in flight. Same
--         bypass, no direct RPC call needed.
--         Fix (§A): the table holds ONE ROW PER GRANT, keyed `(sales_invoice_id, clearance_id)`. A
--         rewrite is refused while ANY unexpired grant is outstanding, and each dispatch releases only
--         its own — so the freeze lasts until the LAST in-flight submit resolves.
--
-- ⚑ AND NO PERMANENT FREEZE. Deleting the release would have re-created the round-6 insider-DoS (a
--   frozen amount Finance can never correct). Both properties hold here:
--     • no self-approval window — the constrained party can neither release a clearance nor outlive it;
--     • no freeze — the ONLY way to create a clearance is a real submit dispatch, which releases it on
--       EVERY exit path (success, ERP rejection, adapter-select failure); the 30-minute TTL is the
--       backstop for the one case nothing else covers (the edge worker dying mid-dispatch).
--   Critically, `submit_sales_invoice` (the caller-callable RPC, §B) NO LONGER RECORDS A CLEARANCE. It
--   is the SoD CHECK the FE repository pre-flights with; it is no longer a grantable, repeatable
--   body-FREEZE primitive that any Admin/Finance member could aim at a draft every few minutes.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse:
--   drop function if exists public.grant_sales_invoice_submit_clearance(uuid, uuid, uuid);
--   drop function if exists public.release_sales_invoice_submit_clearance(uuid, uuid);
--   -- re-create 0113 §B/§D's bodies (the 4-role, clearance-recording variants);
--   alter table public.sales_invoice_submit_authorizations drop column clearance_id;  -- + restore PK

-- ============================================================================
-- §A — sales_invoice_submit_authorizations: ONE ROW PER GRANT (B1c).
--
-- 0113 keyed the table by `sales_invoice_id` alone, so a second submit's `on conflict do update`
-- REPLACED the first's clearance and the second's release then un-froze an invoice whose first submit
-- was still in flight. A grant is now identified by the `clearance_id` its dispatch minted; the gate
-- asks "is ANY grant outstanding?" and the release names exactly one.
--
-- The table is machine-only (no INSERT/UPDATE/DELETE policy, no write grant), so pre-existing rows
-- carry no operator meaning; the truncate keeps the key change simple and is safe pre-production.
-- ============================================================================

truncate table public.sales_invoice_submit_authorizations;

alter table public.sales_invoice_submit_authorizations
  add column if not exists clearance_id uuid not null default gen_random_uuid();

alter table public.sales_invoice_submit_authorizations
  drop constraint if exists sales_invoice_submit_authorizations_pkey;

alter table public.sales_invoice_submit_authorizations
  add primary key (sales_invoice_id, clearance_id);

create index if not exists sales_invoice_submit_authorizations_si_idx
  on public.sales_invoice_submit_authorizations (sales_invoice_id, authorized_at desc);

comment on table public.sales_invoice_submit_authorizations is
  'One row per OUTSTANDING submit clearance — granted by grant_sales_invoice_submit_clearance under the '
  'invoice row lock, released by release_sales_invoice_submit_clearance when THAT dispatch resolves. '
  'While any unexpired grant is outstanding a body rewrite is refused 55006, closing the window in which '
  'an approver could rewrite the amount their own in-flight submit is about to commit. Both RPCs are '
  'service-role-only: the party the clearance constrains can neither grant nor release one.';

comment on column public.sales_invoice_submit_authorizations.clearance_id is
  'The granting dispatch''s fencing token. The release names this id, so a SECOND concurrent submit '
  'resolving can never clear the FIRST submit''s still-outstanding clearance.';

-- ============================================================================
-- §B — submit_sales_invoice: the SoD CHECK, and nothing else (B1b).
--
-- Byte-identical to 0113 §B except: (1) the role list is the revenue write set (finding 3), and (2) it
-- NO LONGER RECORDS A CLEARANCE. Recording one here made every Admin/Finance member holder of a
-- repeatable body-freeze primitive (round-6 finding 2) and, worse, made the freeze releasable by its own
-- grantee once §C released it (B1b). The authoritative, clearance-taking gate is §E, reachable only by
-- the dispatch. This RPC stays the caller-callable SoD oracle the FE repository pre-flights with, and it
-- still runs under the invoice row lock so its verdict is read from a stable row.
-- ============================================================================

create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row      public.sales_invoices;
  v_uid      uuid := auth.uid();
  v_authors  int;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  -- (0105/0111 predicates preserved) org + still-an-active-member; the ROLE set is the revenue write
  -- set (finding 3, owner ruling 2026-07-20) rather than the four master-data money roles.
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_authors
    from public.sales_invoice_authors a
   where a.sales_invoice_id = p_si_id;

  -- (0108 §B, preserved) FAIL CLOSED on an unknown author.
  if v_authors = 0 and v_row.author_user_id is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- (0113 DEFECT 1, preserved) NOBODY WHO EVER WROTE THE BODY MAY APPROVE.
  if v_row.author_user_id = v_uid
     or exists (select 1 from public.sales_invoice_authors a
                 where a.sales_invoice_id = p_si_id and a.user_id = v_uid)
  then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  return v_row;
end; $$;

revoke all on function public.submit_sales_invoice(uuid) from public;
grant execute on function public.submit_sales_invoice(uuid) to authenticated;

comment on function public.submit_sales_invoice(uuid) is
  'The caller-callable Sales Invoice submit SoD check (approver must not be in the author set). It has '
  'NO side effect: the clearance that freezes body rewrites is taken by the dispatch-only '
  'grant_sales_invoice_submit_clearance, so no authenticated caller can freeze an invoice''s amount.';

-- ============================================================================
-- §C — the clearance TTL, in one place.
--
-- DERIVED, not chosen (B1a): `erpnext/client.ts` ERP_SUBMIT_MAX_IN_FLIGHT_MS = 3 full-budget idempotent
-- ERP requests × ((3+1) × 120 s + 3 × 15 s) = 1 575 s = 26.25 minutes — the longest a submit dispatch
-- can still be running and still commit. 30 minutes covers it with margin.
-- `pmo-portal/src/lib/adapterSeam/erpnext/submitClearanceTtl.test.ts` PARSES this literal and fails if
-- the client's retry budget ever grows past it.
--
-- It is a BACKSTOP, not the normal lifetime: a clearance is released the moment its dispatch resolves
-- (§F, called from adapter-dispatch's `finally`). The TTL only matters if the edge worker dies mid-flight.
-- ============================================================================

create or replace function public.si_submit_clearance_ttl()
returns interval language plpgsql immutable set search_path = public as $$
declare
  -- Kept as a named constant so `submitClearanceTtl.test.ts` can read the value out of this migration.
  c_clearance_ttl constant interval := interval '30 minutes';
begin
  return c_clearance_ttl;
end; $$;

grant execute on function public.si_submit_clearance_ttl() to authenticated, service_role;

-- ============================================================================
-- §D — claim_sales_invoice_author: refuse while ANY grant is outstanding (B1c).
--
-- 0113 §D's mechanism (the SAME `select … for update` on the invoice that the submit gate takes) is
-- preserved verbatim; what changes is the role list (finding 3), the TTL source (§C) and the predicate,
-- which now asks whether ANY unexpired grant exists rather than looking at one collapsed row.
-- ============================================================================

create or replace function public.claim_sales_invoice_author(p_si_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.sales_invoices;
  v_uid  uuid := auth.uid();
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  -- No PMO row yet: nothing to protect, and no submit can race an invoice that does not exist.
  if not found then
    return;
  end if;

  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Refuse while ANY submit clearance is OUTSTANDING (granted within the TTL, invoice not yet at ERP —
  -- docstatus 1 = submitted, 2 = cancelled, both meaning the clearance is consumed or moot and the
  -- amend path must stay open).
  if exists (
    select 1 from public.sales_invoice_submit_authorizations s
     where s.sales_invoice_id = p_si_id
       and s.authorized_at > now() - public.si_submit_clearance_ttl()
       and coalesce(v_row.erp_docstatus, 0) < 1
  ) then
    raise exception 'a submit authorization is outstanding for this sales invoice — its body cannot be rewritten'
      using errcode = '55006',  -- object_in_use
            detail = 'si-submit-in-progress';
  end if;

  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  values (v_row.org_id, p_si_id, v_uid)
  on conflict do nothing;
end; $$;

revoke all on function public.claim_sales_invoice_author(uuid) from public;
grant execute on function public.claim_sales_invoice_author(uuid) to authenticated;

-- ============================================================================
-- §E — grant_sales_invoice_submit_clearance: the AUTHORITATIVE, DISPATCH-ONLY submit gate (B1b).
--
-- Does everything 0113 §B did — the org/role/active-member gate, the fail-closed unknown-author rule and
-- the author-set SoD check, all under `select … for update` on the invoice — and THEN records the
-- clearance under that same lock, so the check and its consequence stay atomic with respect to a
-- concurrent `claim_sales_invoice_author` (0113 DEFECT 2's mechanism, unchanged).
--
-- Two things make it a barrier rather than a decoration:
--   • SERVICE-ROLE ONLY. `authenticated` cannot execute it, so the only way to obtain a clearance is to
--     go through `adapter-dispatch`, which always releases it. The subject of the two-person rule can
--     neither mint a freeze nor lift one.
--   • It authorizes an EXPLICIT ACTOR (`p_actor_id`), because the service-role connection has no
--     `auth.uid()`. The edge function passes the user id it verified from the JWT (the established
--     `p_actor_id` service-role-write pattern), and every predicate below reads that actor's own
--     profile — never the connection's.
--
-- `p_clearance_id` is the granting dispatch's fencing token; §F releases by it.
-- ============================================================================

create or replace function public.grant_sales_invoice_submit_clearance(
  p_si_id uuid,
  p_actor_id uuid,
  p_clearance_id uuid
) returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_row        public.sales_invoices;
  v_actor_org  uuid;
  v_actor_role user_role;
  v_active     boolean;
  v_authors    int;
begin
  if p_actor_id is null or p_clearance_id is null then
    raise exception 'grant_sales_invoice_submit_clearance requires an actor and a clearance id'
      using errcode = '22023';
  end if;

  -- The SAME lock claim_sales_invoice_author takes — the serialization point for the whole rule.
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  -- The actor's own org/role/active-membership (the auth_org_id()/auth_role()/is_active_member()
  -- predicates, re-expressed for an explicit actor because service_role has no auth.uid()).
  select p.org_id, p.role, (p.status = 'active' and (u.banned_until is null or u.banned_until <= now()))
    into v_actor_org, v_actor_role, v_active
    from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_actor_id;

  if v_actor_org is null
     or v_row.org_id is distinct from v_actor_org
     or v_actor_role not in ('Admin','Finance')
     or not coalesce(v_active, false)
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_authors
    from public.sales_invoice_authors a
   where a.sales_invoice_id = p_si_id;

  -- (0108 §B, preserved) FAIL CLOSED on an unknown author.
  if v_authors = 0 and v_row.author_user_id is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- (0113 DEFECT 1, preserved) NOBODY WHO EVER WROTE THE BODY MAY APPROVE.
  if v_row.author_user_id = p_actor_id
     or exists (select 1 from public.sales_invoice_authors a
                 where a.sales_invoice_id = p_si_id and a.user_id = p_actor_id)
  then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  -- Record THIS dispatch's clearance while the row is still locked. A body rewrite arriving after this
  -- commit is refused by §D; one that arrived before it is already in the author set checked above.
  insert into public.sales_invoice_submit_authorizations
    (sales_invoice_id, clearance_id, org_id, user_id, authorized_at)
  values (p_si_id, p_clearance_id, v_row.org_id, p_actor_id, now())
  on conflict (sales_invoice_id, clearance_id) do update
    set authorized_at = excluded.authorized_at;

  return v_row;
end; $$;

revoke all on function public.grant_sales_invoice_submit_clearance(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_sales_invoice_submit_clearance(uuid, uuid, uuid) to service_role;

comment on function public.grant_sales_invoice_submit_clearance(uuid, uuid, uuid) is
  'The authoritative SI submit gate: the author-set SoD check AND the body-rewrite clearance, taken '
  'together under the invoice row lock for an EXPLICIT actor. SERVICE-ROLE ONLY — only adapter-dispatch '
  'may obtain a clearance, and it always releases it, so no authenticated caller can freeze an amount.';

-- ============================================================================
-- §F — release_sales_invoice_submit_clearance: end the freeze THIS dispatch imposed (B1b/B1c).
--
-- Called by `adapter-dispatch/index.ts` (service-role) once the submit dispatch has RESOLVED, on every
-- exit path, so the freeze lasts exactly as long as the dispatch it protects instead of the full TTL.
--
-- FENCED TO THE CLEARANCE ID, NOT TO A CALLER IDENTITY. The first cut fenced it to `user_id =
-- auth.uid()` and exposed it to `authenticated` — but the attacker IS the grantee, so that let the very
-- approver the clearance constrains release it mid-submit and rewrite the body (B1b). Here the caller
-- must be service_role AND must name the clearance id its own grant minted, so:
--   • the constrained party cannot call it at all;
--   • a SECOND concurrent submit resolving cannot clear the FIRST submit's clearance (B1c) — it names
--     only its own, and the first's grant keeps the invoice frozen until IT resolves.
-- A non-matching id is a deliberate silent no-op (a lapse or an operator may already have removed it).
-- ============================================================================

create or replace function public.release_sales_invoice_submit_clearance(
  p_si_id uuid,
  p_clearance_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.sales_invoice_submit_authorizations s
   where s.sales_invoice_id = p_si_id
     and s.clearance_id = p_clearance_id;
end; $$;

revoke all on function public.release_sales_invoice_submit_clearance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_sales_invoice_submit_clearance(uuid, uuid) to service_role;

comment on function public.release_sales_invoice_submit_clearance(uuid, uuid) is
  'Releases the ONE clearance identified by p_clearance_id, called by adapter-dispatch when the submit '
  'it granted resolves. Service-role only and fenced to the clearance id — never to a caller identity — '
  'so neither the constrained approver nor a second concurrent submit can lift an in-flight freeze.';
