-- 0111_si_rpcs_active_member.sql — Luna re-audit: the offboarding gate must cover the SI RPCs.
--
-- 0109/0110 conjoined `is_active_member()` into the AR/AP table policies, so a disabled user with a
-- still-valid JWT reads nothing from `sales_invoices` directly. Two SECURITY DEFINER functions read
-- around those policies and were left out of that pass:
--
--   §A `get_process_gates` (0108 §A) — guards only `auth_org_id()`.
--   §B `submit_sales_invoice` (0108 §B) — guards only `auth_org_id()` + `auth_role()`, and RETURNS
--      THE WHOLE `public.sales_invoices` ROW. Neither helper looks at status: both read `profiles`
--      with no status filter, whereas `is_active_member()` (0062, tightened in 0095) is the one that
--      checks `profiles.status = 'active'` AND `auth.users.banned_until`.
--
-- So a disabled/offboarded user (`admin_set_user_status`, 0065) holding a still-valid JWT could call
-- the RPC and read back amount, erp_outstanding_amount, customer, project and si_number — exactly the
-- data 0109 denies them — and, on `submit_sales_invoice`, obtain the SoD clearance that gates a real
-- ERP submit.
--
-- Same INLINE idiom as 0109/0110: every existing predicate is preserved VERBATIM, only the
-- active-member conjunct is added. Both bodies are otherwise byte-identical to 0108's.
--
-- ⚑ `get_process_gates`'s service_role bypass is preserved EXACTLY. It is load-bearing:
-- adapter-dispatch calls this RPC with the service client, whose `auth_org_id()` AND `auth.uid()` are
-- both NULL — so the active-member conjunct is placed INSIDE the user-only branch (the `<> 'service_role'`
-- conjunct still short-circuits first) and can never be evaluated for the machine caller. Putting it
-- outside that branch would fail every SI create with 'gate-check-failed'.
-- `submit_sales_invoice` has no such bypass and needs none: it is only ever invoked under the CALLER's
-- JWT (adapter-dispatch/sodGuard.ts) and is granted to `authenticated` alone.
--
-- Out of scope (filed separately): the same omission exists on ~17 other SECURITY DEFINER functions
-- app-wide. This migration does not touch them.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse: re-create 0108 §A and
-- §B's bodies without the `is_active_member()` conjunct.

-- ============================================================================
-- §A — get_process_gates: a disabled member may not read the org's gates.
-- ============================================================================

create or replace function public.get_process_gates(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- The single source of truth for gate defaults (mirrors DEFAULT_GATES in
  -- pmo-portal/src/lib/adapterSeam/erpnext/processGates.ts). require_project_on_si defaults TRUE.
  v_defaults constant jsonb :=
    '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb;
  v_stored   jsonb;
begin
  -- (0107/0108, predicates unchanged) A SECURITY DEFINER reader must not hand back another org's config
  -- to a USER. The machine (service_role — the adapter-dispatch pre-flight gate check reads the command's
  -- own org) is exempt; a user-JWT caller may read only its OWN org's gates, and only while it is still
  -- an ACTIVE member (0111 — a disabled user with a live JWT is no longer a member).
  -- The service_role short-circuit remains FIRST and unmodified: the machine caller has neither an org
  -- nor a uid, so neither user-side conjunct is ever evaluated for it.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and (p_org is distinct from auth_org_id() or not is_active_member()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select (config -> 'process_gates') into v_stored
    from public.external_org_bindings
   where org_id = p_org and external_tier = 'erpnext';

  -- Absent, JSON null, or a non-object (a malformed config must never shape the gates) -> defaults.
  if v_stored is null or jsonb_typeof(v_stored) <> 'object' then
    return v_defaults;
  end if;

  -- Merge per-key OVER the defaults, taking ONLY known keys carrying a real boolean. A non-boolean
  -- (null/string/number) therefore falls back to its default rather than reaching the dispatch as a
  -- falsy value that would read as "gate off" — fail closed. Unknown keys are dropped, so the returned
  -- shape is always exactly the three documented gates.
  return v_defaults || coalesce(
    (select jsonb_object_agg(e.key, e.value)
       from jsonb_each(v_stored) as e
      where jsonb_typeof(e.value) = 'boolean'
        and v_defaults ? e.key),
    '{}'::jsonb);
end; $$;

revoke all on function public.get_process_gates(uuid) from public;
grant execute on function public.get_process_gates(uuid) to authenticated;

-- ============================================================================
-- §B — submit_sales_invoice: a disabled member may neither read the SI row nor clear the SoD gate.
-- ============================================================================

create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row       public.sales_invoices;
  v_org       uuid;
  v_author    uuid;
  v_submitter text;
begin
  select * into v_row from public.sales_invoices where id = p_si_id;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  v_org := v_row.org_id;
  -- 0111: `is_active_member()` conjoined. auth_org_id()/auth_role() read `profiles` with NO status
  -- filter, so without this an offboarded user with a live JWT kept both the row (this function RETURNS
  -- the whole sales_invoices row) and the submit clearance. Only ever called under the caller's JWT —
  -- there is no machine caller to exempt.
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_author    := v_row.author_user_id;
  v_submitter := coalesce(auth.uid()::text, '');

  -- BLOCK 6 (defence in depth): FAIL CLOSED on an unknown author. Previously a NULL author was treated
  -- as SoD-exempt, so the approver≠author check below passed trivially for every caller — the rows we
  -- cannot attribute were exactly the rows with no two-person control. A submit now requires a known
  -- author; an inbound-adopted/unattributed SI must be attributed before it can be submitted from PMO.
  if v_author is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- SoD (FR-SAR-195): the submitter must differ from the author. Note the AUTHOR is re-stamped by every
  -- BODY-BUILDING write (adapter-dispatch/readModelWriters.ts — an `update` or `transition{verb:'amend'}`
  -- rebuilds the ERP Sales Invoice body from the caller's items), so an approver who rewrites the money
  -- becomes its author here and can no longer clear this check.
  if v_author::text = v_submitter then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  return v_row;
end; $$;

revoke all on function public.submit_sales_invoice(uuid) from public;
grant execute on function public.submit_sales_invoice(uuid) to authenticated;
