-- 0180_rpc_active_member_gate.sql — a DISABLED account must not be able to write.
-- Spec: docs/specs/active-member-write-gate.spec.md (FR-AMG-001..005, NFR-AMG-001).
-- Proven by supabase/tests/0173_rpc_active_member_gate.test.sql.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
-- `is_active_member()` (0062, + 0095's banned_until) is conjoined into every business-table RLS
-- policy, so a deactivated employee holding a still-valid JWT READS nothing. The `security definer`
-- RPCs bypass RLS by design and were supposed to re-assert the same conditions; most re-assert org
-- and role, and NONE of these fifteen re-asserted active membership. Probed live at 0178:
--
--     select count(*) from procurements;                        -->  0      (RLS read blocked)
--     select create_procurement_invoice(<pr>,'Paid',…,424242);  -->  VI-…   Paid  424242.00
--
-- Offboarding is precisely when writes must stop — the disabled account IS the threat model.
-- `activate_budget_version`, `admin_set_user_status`, `claim_sales_invoice_author` and (since 0178)
-- `transition_project` / `set_project_contract_value` already carry it: this was a known pattern
-- applied inconsistently, which is why the proof asserts EVERY function and not a sample.
--
-- ── ⚑ SCOPE, STATED SO NOBODY READS MORE INTO IT ────────────────────────────────────────────────
-- This closes the WRITE SURFACE for a disabled account. It does **NOT** shorten the life of an
-- already-issued JWT: a just-disabled user's token stays cryptographically valid until it expires,
-- and this migration is what makes that harmless for writes. **Offboarding is not "solved" by this
-- file.** Token lifetime / revocation is a separate auth-side decision (Supabase `jwt_expiry`, refresh
-- rotation), and it is not in this slice. `admin_set_user_status` already sets `auth.users.banned_until`
-- alongside `profiles.status`, which is what 0095's ban check reads — so the two halves agree.
--
-- ── ⚑ THE TRAP, AND WHY THERE IS AN OVERLOAD RATHER THAN A CONJUNCT ─────────────────────────────
-- `is_active_member()` takes no arguments and resolves `auth.uid()`. For a **service_role** caller
-- `auth.uid()` is NULL ⇒ it returns FALSE. Adding the plain conjunct to an RPC that an edge function
-- invokes as service_role would break that path IN PRODUCTION and break it **CLOSED** — silently
-- stopping the integration rather than erroring at deploy.
--
-- Per-RPC caller analysis (every caller read in the tree, 2026-07-29 — `grep` over `pmo-portal/src`,
-- `pmo-portal/pages`, `pmo-portal/e2e`, `supabase/functions`, `scripts/`, plus a catalog scan for
-- SQL-internal callers):
--
--   THIRTEEN reachable ONLY by a user JWT -> the RESOLVED form degenerates to auth.uid(), which is
--   exactly the plain conjunct:
--     clone_budget_version .......... src/lib/db/budgets.ts:198 only
--     create_payment ................ src/lib/db/procurementRecords.ts:144 only
--                                     (the historical importer writes `payments` with the service-role
--                                      client via scripts/lib/historicalImportRecordInsert.mjs, NOT
--                                      through this RPC — verified: `scripts/**` contains no `.rpc(`
--                                      call at all; and transition_procurement's `-> Paid` branch
--                                      inserts the row directly as the definer's owner)
--     create_procurement_invoice .... src/lib/db/procurementLifecycle.ts:282, and public.capture_vendor_invoice
--                                     (itself a definer called under the user's JWT, so auth.uid() flows through)
--     create_procurement_quotation .. src/lib/db/procurementLifecycle.ts:227 only
--     create_procurement_receipt .... src/lib/db/procurementLifecycle.ts:254 only
--     create_purchase_order ......... src/lib/db/procurementRecords.ts:113 only
--     create_purchase_request ....... src/lib/db/procurementRecords.ts:55 only
--     create_rfq .................... src/lib/db/procurementRecords.ts:84 only
--     save_timesheet_week ........... src/lib/db/timesheets.ts:135 only (and it ALREADY refuses a NULL
--                                     auth.uid() with 'not authenticated', so it never had a machine caller)
--     select_procurement_quote ...... src/lib/db/procurementCrud.ts:205 only
--     transition_document_status .... src/lib/db/documents.ts:140 only
--     transition_procurement ........ src/lib/db/procurementLifecycle.ts:206, and public.capture_vendor_invoice
--     transition_timesheet .......... src/lib/db/timesheetTransition.ts:78/91/104/119/135 only
--                                     (erpnext-sweep only *mentions* it in comments — no call)
--
--   TWO with a real service_role caller, both already resolving coalesce(auth.uid(), p_actor_id) for
--   their PRIVILEGE check — the active-member check must be made against the SAME resolved actor or
--   the integration breaks closed:
--     create_vault_secret_for_org ... supabase/functions/external-connect/index.ts:365
--                                     `serviceClient.rpc(..., { p_actor_id: userId })`
--     admin_change_domain_ownership . supabase/functions/external-disconnect/index.ts:187
--                                     `serviceClient.rpc(..., { p_actor_id: userId })`
--
-- ⚑ THE MECHANISM IS THE ONE THE REPO ALREADY CHOSE, NOT A SECOND ONE. `approved_timesheet_for_push`
--   resolves `coalesce(auth.uid(), p_actor)` — auth.uid() FIRST, so a JWT caller can never override
--   their own identity with the parameter. `public.assert_is_active_member(p_actor)` is exactly that,
--   packaged once, so the refusal MESSAGE has a single definition and cannot drift across fifteen
--   call sites. A call site that passes an argument is declaring "this RPC has a machine caller"; a
--   call site that passes none is declaring "user JWT only". The distinction is visible in one line.
--
-- ⚑ WHY IT IS `is_active_member(uuid)` AND NOT A `profiles.status = 'active'` LOOKUP.
--   `approved_timesheet_for_push` reads the resolved actor's `profiles.status` and then applies
--   `is_active_member()` only when there IS a JWT — which means the **p_actor path never gets 0095's
--   `banned_until` check**. That is a hole on exactly the path that matters (an out-of-band ban set
--   from the dashboard, which `admin_set_user_status` does not own). The overload carries the WHOLE
--   rule for both paths. 0173 AC-AMG-005 pins it: a raw-banned Admin passed as `p_actor_id` is refused.
--
-- ⚑ WHY `is_active_member()` (0 args) IS LEFT EXACTLY AS 0095 WROTE IT, and the overload duplicates
--   the body instead of the 0-arg delegating to it. The 0-arg form is conjoined into ~30 RLS policies
--   and is evaluated on the RLS hot path; a SECURITY DEFINER function is never inlined by the planner,
--   so delegating would add a second non-inlinable call to every policy evaluation for a purely
--   cosmetic gain. The cost of duplication is DRIFT, and drift is what the test closes rather than the
--   code: 0173 asserts the two forms agree across all four states (active / disabled / raw-banned /
--   unknown uuid), so a change to one that is not made to the other fails.
--
-- ── COMPLETENESS IS CATALOG-DERIVED, NOT A LIST ─────────────────────────────────────────────────
-- The fifteen were re-derived from the live catalog with the query below, and 0173 asserts that the
-- SAME query now returns ZERO rows. That makes the proof self-maintaining: a future `security definer`
-- write-RPC granted to `authenticated` that forgets this gate fails CI, instead of being appended to a
-- list nobody re-runs. (This is 0178's "the completeness test is not per-slice" lesson, as a query.)
--
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      and pg_get_functiondef(p.oid) not ilike '%is_active_member%'
--      and pg_get_functiondef(p.oid) ~* '(insert into|update public|delete from)';
--
-- ⚑ The helper is deliberately named `assert_is_active_member` and not `assert_active_member`, so the
--   `ilike '%is_active_member%'` filter above keeps recognising a guarded function. A shorter name
--   would have left all fifteen still flagged by the sweep — a self-inflicted false positive.
--
-- ── PLACEMENT ───────────────────────────────────────────────────────────────────────────────────
-- Entry guard (first statement) for the thirteen, matching 0065/0067/0079. For the two admin RPCs it
-- sits immediately AFTER the actor is resolved and the existing `actor required` refusal, so their
-- current diagnostics are unchanged and the check is still ahead of every write.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse (⚑ RESTORES A STATE IN
-- WHICH AN OFFBOARDED ACCOUNT CAN CREATE VENDOR INVOICES AND PAYMENTS):
--   For each of the fifteen functions in §2, re-apply its definition from this file with its single
--   inserted `perform public.assert_is_active_member(...)` line (and its comment) removed, then
--     drop function if exists public.assert_is_active_member(uuid);
--     drop function if exists public.is_active_member(uuid);
--   and drop the three policy comments in §3.
--   ⚑ The numbered-list form was removed because it cannot be maintained: tracking migration numbers
--   across edits produces stale references. Following a stale header would revert SoD rules and
--   validations that have since been tightened (0178's payment origination gate, 0172's timesheet
--   entry_date bound, 0164's unknown-witness stamping, 0153's fiscal_year clone).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — THE RESOLVED-ACTOR FORM OF THE GATE.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- The whole 0062+0095 rule, keyed on an explicit actor instead of auth.uid(). SECURITY DEFINER for
-- the same reason the 0-arg form is: it must read `profiles` and `auth.users` rows RLS would hide.
-- ⚑ Body kept BYTE-FOR-BYTE identical to public.is_active_member() apart from the key — 0173 asserts
--   the two agree across active / disabled / raw-banned / unknown.
create or replace function public.is_active_member(p_user_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = p_user_id
      and p.status = 'active'
      and (u.banned_until is null or u.banned_until <= now())
  )
$$;

comment on function public.is_active_member(uuid) is
  'FR-AMG-002 — the active-member rule keyed on an EXPLICIT actor, for the SECURITY DEFINER RPCs that '
  'have a service_role caller (auth.uid() is NULL there, so the 0-arg form returns false and would '
  'break the integration CLOSED). Same body as public.is_active_member(), including 0095''s '
  'banned_until check — which is the half a `profiles.status` lookup would miss on the p_actor path. '
  'NOT granted to authenticated/anon: it is called only from definer bodies (which run as the owner), '
  'and granting it would hand any caller an is-this-uuid-an-active-user oracle across orgs.';

revoke execute on function public.is_active_member(uuid) from public, anon, authenticated;

-- The ONE definition of the refusal. ⚑ auth.uid() FIRST — a JWT caller can NEVER override their own
-- identity with p_actor. `coalesce(p_actor, auth.uid())` (the opposite order) is an impersonation
-- hole, and it is one this repo has already shipped and fixed once (approved_timesheet_for_push).
-- p_actor is ONLY for the service_role path, where auth.uid() is null — which this ordering says
-- exactly. FAILS CLOSED: an actor that resolves to NULL is not an active member.
create or replace function public.assert_is_active_member(p_actor uuid default null) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_member(coalesce(auth.uid(), p_actor)) then
    raise exception
      'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid'
      using errcode = '42501';
  end if;
end $$;

comment on function public.assert_is_active_member(uuid) is
  'FR-AMG-001/002/003/004 — the offboarding write gate for SECURITY DEFINER RPCs. Call it with NO '
  'argument when the RPC is reachable only by a user JWT, and with the RPC''s actor parameter when it '
  'also has a service_role caller (the argument IS the declaration that such a caller exists). '
  'Resolves coalesce(auth.uid(), p_actor) — auth.uid() first, so p_actor can never be used to '
  'impersonate. Its message is deliberately NOT "not authorized" (FR-AMG-004): an offboarded user''s '
  'failure must be diagnosable and must not read as a role-permissions bug.';

revoke execute on function public.assert_is_active_member(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — THE FIFTEEN. Each body is its current definition VERBATIM with ONE inserted line, marked.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.clone_budget_version(version_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_next int; v_new uuid;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select project_id, org_id into v_project, v_org from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Defense-in-depth (audit HIGH-BV-1): the parent project must also be in the caller's org, so a definer
  -- clone can never read/write across orgs even if a grafted source version slipped past RLS.
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(max(version),0)+1 into v_next from budget_versions where project_id = v_project;
  insert into budget_versions (org_id, project_id, version, name, status)
    select v_org, v_project, v_next, name || ' (copy)', 'Draft'
    from budget_versions where id = version_id
    returning id into v_new;
  -- ⚑ THE ONE CHANGE: `fiscal_year` rides along. `actual_amount` is still reset to 0 (a clone has spent
  -- nothing yet); a NULL year stays NULL — the clone never INVENTS a year for a line the operator
  -- deliberately left un-phased (ADR-0048).
  insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
    select v_org, v_new, category, description, budgeted_amount, 0, fiscal_year
    from budget_line_items where budget_version_id = version_id;
  return v_new;
end; $$;

create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant (0039, AC-PR-SEC-001 / FR-ENA-130d): invoice must belong to the same case.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's payment writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — payments route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0178: the origination-status gate. NULL is ACCEPTED on purpose (it is the permissive-capture
  -- default, sent by procurementRecords.ts and by four assertions in 0079) and the explicit
  -- `is not null` keeps the condition TOTAL — `p_status <> 'Scheduled'` alone is NULL for a NULL
  -- p_status and would fall through, which is 0176 §6's defect exactly.
  if p_status is not null and p_status <> 'Scheduled' then
    raise exception
      'payments.status "%" is not an origination status: a payment record is captured as Scheduled, and Paid is reached only by paying the case — the transition that is Finance-only and enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's invoice writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0176: the origination-status gate. NULL-safe by construction (`not in` over a NULL p_status is
  -- NULL, so the explicit null check comes first). A NULL p_status would otherwise have fallen through
  -- to the NOT NULL constraint — the wrong error, and the §6 class.
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_procurement_quotation(
  p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_quotations language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_quotations;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_quotations
    (procurement_id, vendor_id, total_amount, received_date, vq_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
            next_procurement_doc_number(v_org, 'VQ'),
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_procurement_receipt(
  p_procurement_id uuid, p_status procurement_receipt_status, p_receipt_date date,
  p_reference_number text default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_receipts language plpgsql security definer set search_path = public as $$
declare
  v_org       uuid;
  v_requester uuid;
  v_row       public.procurement_receipts;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, requested_by_id into v_org, v_requester
    from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (auth_role() = 'Admin'
          or auth_role() = 'Project Manager'
          or (auth.uid() is not null and auth.uid() = v_requester))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's GR writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — goods receipts route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  insert into public.procurement_receipts
    (procurement_id, status, receipt_date, gr_number, reference_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_receipt_date,
            next_procurement_doc_number(v_org, 'GR'), p_reference_number,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's PO writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_rfq(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns rfqs language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.rfqs;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.rfqs
    (procurement_id, rfq_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'RFQ'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.save_timesheet_week(
  p_timesheet_id uuid, p_week_start_date date, p_upserts jsonb default '[]'::jsonb,
  p_delete_ids uuid[] default '{}'::uuid[])
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_org        uuid := auth_org_id();
  v_sheet_id   uuid := p_timesheet_id;
  v_owner      uuid;
  v_status     timesheet_status;
  v_sheet_org  uuid;
  v_sheet_week date;
  v_bad_proj   int;
  v_bad_date   int;
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller — this RPC already refuses a NULL auth.uid() below, so
  -- it never had a machine caller to protect. Placed FIRST so an offboarded user gets the offboarding
  -- message rather than a bare 'not authenticated'/'no org context'.
  perform public.assert_is_active_member();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'no org context' using errcode = '42501';
  end if;

  -- 1. Resolve (or create) the Draft sheet. Creating self-stamps user_id = caller.
  if v_sheet_id is null then
    insert into public.timesheets (org_id, user_id, week_start_date, status)
    values (v_org, v_uid, p_week_start_date, 'Draft')
    returning id into v_sheet_id;
  end if;

  -- 2. Ownership + Draft + tenancy re-assertion (mirrors timesheets_insert / entries_write RLS).
  --    (i) week_start_date is read HERE: the sheet — not the caller's argument — defines the week.
  select user_id, status, org_id, week_start_date
    into v_owner, v_status, v_sheet_org, v_sheet_week
    from public.timesheets where id = v_sheet_id for update;
  if v_owner is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;
  if v_sheet_org is distinct from v_org or v_owner is distinct from v_uid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status <> 'Draft' then
    raise exception 'timesheet is not editable (status %)', v_status using errcode = 'P0001';
  end if;

  -- 2b. (ii) The caller named a sheet AND a week; if they disagree, one of them is wrong and the
  --     server must not pick. Silently using v_sheet_week would honour a call whose entries were
  --     authored against a different week — the FE's own week is what it renders and diffs against.
  if p_timesheet_id is not null and p_week_start_date is distinct from v_sheet_week then
    raise exception 'p_week_start_date % does not match the timesheet week %',
      to_char(p_week_start_date, 'YYYY-MM-DD'), to_char(v_sheet_week, 'YYYY-MM-DD')
      using errcode = '22023';
  end if;

  -- 3. Upserts. Every referenced project must be in the caller's org (parent-project
  --    tenancy guard from 0011). Reject BEFORE any write if a foreign project appears.
  if jsonb_array_length(p_upserts) > 0 then
    select count(*) into v_bad_proj
      from jsonb_to_recordset(p_upserts) as u(project_id uuid)
     where not exists (
       select 1 from public.projects p where p.id = u.project_id and p.org_id = v_org);
    if v_bad_proj > 0 then
      raise exception 'not authorized' using errcode = '42501';
    end if;

    -- 3b. (iii) Week-bounds preflight against the SHEET's week. Rejecting before any write keeps
    --     0168's all-or-nothing guarantee (no partial draft). `u.entry_date is null` is explicit:
    --     a missing key compares as NULL, which is not TRUE, so a two-sided comparison alone would
    --     let it through to surface as a bare 23502 not-null violation instead of this reason.
    select count(*) into v_bad_date
      from jsonb_to_recordset(p_upserts) as u(entry_date date)
     where u.entry_date is null
        or u.entry_date < v_sheet_week
        or u.entry_date > (v_sheet_week + 6);
    if v_bad_date > 0 then
      raise exception 'entry_date is outside the timesheet week (%)',
        to_char(v_sheet_week, 'YYYY-MM-DD') using errcode = '23514';
    end if;

    insert into public.timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, notes)
    select v_org, v_sheet_id, u.project_id, u.entry_date, u.hours, u.notes
      from jsonb_to_recordset(p_upserts)
             as u(project_id uuid, entry_date date, hours numeric, notes text)
    on conflict (timesheet_id, project_id, entry_date)
      do update set hours = excluded.hours, notes = excluded.notes;
  end if;

  -- 4. Deletes — pinned to entries on the RESOLVED (own) sheet, so a caller can never
  --    delete another sheet's rows by passing foreign ids (they simply match nothing).
  if array_length(p_delete_ids, 1) is not null then
    delete from public.timesheet_entries
     where id = any(p_delete_ids) and timesheet_id = v_sheet_id;
  end if;

  return v_sheet_id;
end; $$;

create or replace function public.select_procurement_quote(p_quotation_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid;
  v_proc     uuid;
  v_status   procurement_status;
  v_vendor   uuid;
  v_total    numeric(14,2);
  v_role     user_role := auth_role();
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- Load the quotation + its parent PR (lock the PR row to serialize concurrent selects on the same PR).
  select q.procurement_id, q.vendor_id, q.total_amount, p.org_id, p.status
    into v_proc, v_vendor, v_total, v_org, v_status
    from public.procurement_quotations q
    join public.procurements p on p.id = q.procurement_id
   where q.id = p_quotation_id
   for update of p;
  if v_proc is null then
    raise exception 'quotation not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation + role gate (definer bypasses RLS → re-assert here). MUST stay.
  if v_org is distinct from auth_org_id()
     or v_role not in ('Admin','Project Manager','Finance')
  then
    raise exception 'not authorized to select a quote' using errcode = '42501';
  end if;

  -- Stage legality: a quote may only be selected while the PR is Vendor Quoted (FR-PROC-CRUD-001).
  if v_status is distinct from 'Vendor Quoted' then
    raise exception 'cannot select a quote from stage %', v_status using errcode = 'P0001';
  end if;

  -- Clear any prior selection on this PR FIRST (keeps the one-selected partial unique index valid),
  -- then mark the chosen quotation selected.
  update public.procurement_quotations
     set is_selected = false
   where procurement_id = v_proc and is_selected;
  update public.procurement_quotations
     set is_selected = true
   where id = p_quotation_id;

  -- Sync the header from the selected quote + advance the stage. One statement, one indivisible txn.
  update public.procurements
     set status      = 'Quote Selected',
         total_value = v_total,
         vendor_id   = v_vendor,
         updated_at  = now()
   where id = v_proc;
end; $$;

create or replace function public.transition_document_status(p_doc_id uuid, p_to doc_status)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from      doc_status;
  v_org       uuid;
  v_author    uuid;
  v_parent_id uuid;
  v_uid       uuid      := auth.uid();
  v_role      user_role := auth_role();
  v_legal jsonb := jsonb_build_object(
    'Draft',      jsonb_build_array('Issued'),
    'Issued',     jsonb_build_array('Approved','Rejected'),
    'Approved',   jsonb_build_array('Closed'),
    'Rejected',   jsonb_build_array('Draft','Closed'),
    'Closed',     jsonb_build_array(),
    'Superseded', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- Load + lock the row (serializes concurrent transitions on the SAME document). P0002 if absent.
  select status, org_id, author_id, parent_document_id
    into v_from, v_org, v_author, v_parent_id
    from public.project_documents where id = p_doc_id for update;
  if v_from is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation: proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Role gate: only the master-data write-roles move a document's workflow.
  -- SECURITY: this role gate MUST stay — removing it lets any authenticated user transition a document.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode = '42501';
  end if;

  -- Status-map legality: (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal document transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- approver≠author SoD: the actor approving/rejecting a document may not be its author.
  -- SECURITY: this MUST stay — it is the segregation of duties being enforced.
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then
    raise exception 'separation of duties: cannot approve or reject your own document'
      using errcode = '42501';
  end if;

  update public.project_documents
    set status = p_to
  where id = p_doc_id;

  -- audit (C-3): durable record of the workflow transition (from→to) on the success path.
  -- ::text casts the doc_status enum to its label so detail->>'from'/'to' read as 'Draft'/'Issued'.
  perform public.log_audit('project_document.transition', v_org, v_uid, p_doc_id,
                           jsonb_build_object('from', v_from::text, 'to', p_to::text));

  -- Auto-Superseded (from 0025): when a child revision is Approved, mark the parent Superseded.
  -- Parent must be in ('Issued','Approved') — both valid starting states for a new revision.
  if p_to = 'Approved' and v_parent_id is not null then
    perform 1 from public.project_documents where id = v_parent_id for update;
    update public.project_documents
      set status = 'Superseded'
    where id = v_parent_id
      and status in ('Issued','Approved');
    -- Idempotent: no error if the parent was not Issued/Approved (already superseded/closed).
  end if;
end; $$;

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id
    into v_from, v_org, v_requester, v_approver
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-approve (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-pay (OD-PROC-8).
  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- Atomic single update: + FR-FIN-DEBT-002 vendor_invoiced_at stamp (fires ONLY on →'Vendor Invoiced',
  -- coalesce so a re-entry can't blank it; mirrors the approved_by_id/pr_number conditional stamps).
  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to = 'Vendor Invoiced' then now() else vendor_invoiced_at end,
    updated_at         = now()
  where id = p_id;

  -- FR-PR-016 / OQ-3: write the just-minted number onto the owning RECORD row (idempotent per [PD-3]).
  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_requests pr
                        where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_orders po
                        where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    insert into public.payments (procurement_id, pay_number, status, date, amount)
    select p_id, next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date, p.total_value
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id);
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  -- v_from = current status captured BEFORE the status update above (same value SoD/map validation read).
  -- v_org = the RPC's existing org local.
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;

create or replace function public.transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from  timesheet_status;
  v_org   uuid;
  v_owner uuid;
  v_uid   uuid      := auth.uid();
  v_role  user_role := auth_role();
  v_mgr   uuid;
  -- The transition map (OD-TS-2 config seam): legal (from → [allowed to]) superset, as data.
  -- Slice A (FR-TSC-001): `Approved` is no longer terminal — `Approved → Draft` is the one new edge.
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted'),
    'Submitted', jsonb_build_array('Approved','Rejected'),
    'Rejected',  jsonb_build_array('Draft'),
    'Approved',  jsonb_build_array('Draft')
  );
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- Load + lock the row (serializes concurrent transitions on the SAME timesheet). P0002 if absent.
  select status, org_id, user_id
    into v_from, v_org, v_owner
    from public.timesheets where id = p_timesheet_id for update;
  if v_from is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-TS-003): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-TS-001): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Authorization matrix + SoD (OD-TS-1/OD-TS-4, FR-TS-004/005/006). Resolve the owner's line manager.
  -- SECURITY: these re-assertions MUST stay (definer bypasses RLS).
  select manager_id into v_mgr from public.profiles where id = v_owner;

  if p_to = 'Submitted' then
    -- Submit: only the owner may submit their own Draft sheet (FR-TS-004).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS — even an Admin can never approve/reject their own timesheet (OD-TS-4-D, FR-TS-005).
    -- This `actor = owner` check is intentionally ordered BEFORE the role/manager check so break-glass
    -- can never defeat separation of duties. Do not reorder.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot approve own timesheet' using errcode = '42501';
    end if;
    -- Then: the assigned line manager (exclusive when set); OR Admin/Exec fallback ONLY when manager is
    -- null; OR Admin break-glass (OD-TS-4-D).
    -- HIGH-TS-1: `v_uid is not distinct from v_mgr` is null-safe — it yields FALSE (not NULL) when
    -- v_mgr is null, so `not (false or ...)` no longer short-circuits to NULL and skips the raise.
    -- The Admin/Exec fallback is therefore gated STRICTLY to a null manager; a non-privileged
    -- bystander on a null-manager sheet now correctly hits 42501.
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to = 'Draft' and v_from = 'Approved' then
    -- Slice A (FR-TSC-020/021): re-open an Approved sheet. The AUTHORITY is the same approver
    -- population as the approve arm above — line manager, Admin/Exec-when-manager-null, or Admin
    -- break-glass — and the OWNER is excluded. SoD FIRST (mirrors the approve arm ordering): an
    -- owner can never re-open their own approved sheet, even if they are Admin.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot re-open own approved timesheet' using errcode = '42501';
    end if;
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    -- FENCE 2 (FR-TSC-008/010, scoped): serialize against a concurrent push insert. The SAME named
    -- per-timesheet advisory lock is acquired by insert_timesheet_outbox_pending (§B), so whichever
    -- side wins the lock the other sees its effect.
    perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
    -- Refuse if ERP may hold a LIVE document — a mirror row with ts_number set and not cancelled
    -- (Luna f1, mirror side). A pushed sheet is refused here; Slice B will fill the cancel-confirmed
    -- admit branch for it. Fail closed on any doubt.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
      raise exception 'reopen-erp-document-held' using errcode = 'P0001';
    end if;
    -- ⚑ THE UNKNOWN ERP OUTCOME (Luna FU-1a round-8 BLOCK — THE money predicate). `post_submit_unknown_at`
    -- is set the moment PMO loses track of a submit's result and is cleared ONLY by learning a real
    -- `ts_number` or by an audited operator attestation (0157 §2/§5). It is deliberately INDEPENDENT of
    -- `push_state` and of the outbox: those answer "can the backstop retry this?", and a re-queue —
    -- including `release_outbox_hold`, which clears BOTH hold states in one transaction — establishes
    -- NOTHING about what ERPNext holds. Before this predicate, a release therefore opened the correction
    -- path over a live ERP document: re-open + re-approve minted a SECOND Timesheet for the week and the
    -- client's hours double-counted permanently (the original command can never be adopted afterwards,
    -- so it never learns the `ts_number` that would have fenced the second push).
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.post_submit_unknown_at is not null) then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- The mirror's own `held` state, kept as an INDEPENDENT predicate (0152 §B). It fences the pre-0157
    -- residue — a `held` row written before the witness column existed — and any future writer that
    -- parks `held` without stamping one. Same refusal, so the caller sees one story.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id and m.push_state = 'held') then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2).
    --
    -- ⚑ WHAT TERMINAL `failed` DOES AND DOES NOT PROVE (CORRECTED IN ROUND 8; the 0152 text this
    -- replaces was false). `failed` on the OUTBOX means only "no retry is queued". It does NOT mean
    -- "ERP holds no document":
    --   • an operator `release_outbox_hold` writes `failed` over a POST-SUBMIT UNKNOWN (0152 §A) —
    --     that is the round-8 BLOCK, and it is why the predicate above no longer reads push state at all;
    --   • `commitCreate` creates then submits (`erpnext/adapter.ts`), so a create that succeeded and a
    --     submit ERP rejected is terminal `failed` while ERPNext holds a DRAFT Timesheet PMO has no
    --     pointer to (no costing, so clutter rather than a double-count — but not "no document");
    --   • a row written by the PRE-0151 code carries no guarantee at all: a succeeded submit whose
    --     read-back failed was marked terminal `failed` with a `ts_number`-less mirror.
    -- So this arm no longer LEANS on `failed`; it admits `failed` only once the independent
    -- unknown-outcome witness above says the ERP question has actually been answered. THE PRE-0151
    -- DISPOSITION IS UNCHANGED AND STILL EXPLICIT: those rows carry no witness (the column did not
    -- exist), this arm will ADMIT them, and an OPERATOR must establish what ERP holds before trusting
    -- that admit. The census + the operator's action are named in
    -- `docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 ("Pre-0151 residue"); an environment that
    -- never ran the P3b push before 0151 has an empty census and nothing to do.
    if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
      raise exception 'reopen-push-in-flight' using errcode = 'P0001';
    end if;
    -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
    -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
    -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case (no live doc, no
    -- unknown outcome, no non-terminal outbox row); a pushed sheet is refused above (Slice B's entry
    -- point). Do NOT widen without the intent table + cancel machinery.
  elsif p_to = 'Draft' and v_from = 'Rejected' then
    -- Rework: only the owner reworks a Rejected sheet back to Draft (FR-TS-006). Byte-for-byte with
    -- 0007 (the arm is narrowed by `v_from`, not widened in authority).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + the relevant stamp(s) in the SAME statement ⇒ no observable partial
  -- state (NFR-TS-ATOM-001). Approved→Draft leaves submitted_at/approved_by/approved_at as-is (OD-TS-4-A:
  -- audit trail of the last cycle; overwritten on the next submit/approve). Unchanged from 0007.
  update public.timesheets set
    status       = p_to,
    submitted_at = case when p_to = 'Submitted'            then now()  else submitted_at end,
    approved_by  = case when p_to in ('Approved','Rejected') then v_uid else approved_by  end,
    approved_at  = case when p_to in ('Approved','Rejected') then now() else approved_at  end
  where id = p_timesheet_id;
end; $$;

-- ── The two with a service_role caller: the RESOLVED-ACTOR form (FR-AMG-002) ────────────────────
-- ⚑ A plain `assert_is_active_member()` here would refuse EVERY call from external-connect /
--   external-disconnect (auth.uid() is NULL under service_role) and break the ClickUp/ERPNext connect
--   and disconnect flows in production, silently and closed. The argument is what prevents that, and
--   0173 AC-AMG-003 is the control that keeps it that way.

create or replace function public.admin_change_domain_ownership(
  p_org_id uuid, p_external_tier text, p_domain text, p_action text, p_actor_id uuid default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_is_admin boolean;
  v_is_operator boolean;
begin
  -- Resolve effective actor: JWT path (auth.uid()) takes precedence; service_role path uses p_actor_id
  v_actor := coalesce(auth.uid(), p_actor_id);
  if v_actor is null then
    raise exception 'actor required' using errcode = '42501';
  end if;

  -- ⚑ 0180 (FR-AMG-002): the RESOLVED actor must be an active member. Placed after the actor
  -- resolution so the existing 'actor required' diagnostic is unchanged, and before every write.
  perform public.assert_is_active_member(p_actor_id);

  -- Gate: actor must be Admin of p_org_id OR platform Operator
  select exists (
    select 1 from public.profiles
    where id = v_actor
      and org_id = p_org_id
      and role = 'Admin'
  ) into v_is_admin;

  select exists (
    select 1 from public.platform_operators
    where user_id = v_actor
  ) into v_is_operator;

  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  -- Validate org exists (FK enforcement via 23503 on insert)
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;

  -- Perform the SAME ownership write as operator_set_domain_ownership
  if p_action = 'employ' then
    insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
      values (p_org_id, p_external_tier, p_domain, v_actor)
    on conflict (org_id, external_tier, domain) do nothing;
  elsif p_action = 'release' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = p_external_tier and domain = p_domain;
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;

  -- Audit: use the 5-arg signature of public.log_audit
  -- log_audit(p_action text, p_org_id uuid, p_actor_id uuid, p_entity_id uuid, p_detail jsonb)
  -- entity_id is null since we're logging ownership changes, not a specific entity row
  perform public.log_audit(
    case p_action when 'employ' then 'integration.domain_ownership.employ'
                  when 'release' then 'integration.domain_ownership.release'
                  else 'integration.domain_ownership.unknown' end,
    p_org_id,
    v_actor,
    null,  -- entity_id
    jsonb_build_object(
      'tier', p_external_tier,
      'domain', p_domain,
      'action', p_action,
      'actor', v_actor
    )
  );
end;
$$;

create or replace function public.create_vault_secret_for_org(
  p_org_id uuid, p_external_tier text, p_secret_value text, p_secret_name text, p_actor_id uuid default null)
  returns text language plpgsql security definer set search_path = public, vault as $$
declare
  v_secret_name text;
  v_effective_actor uuid;
  v_old_secret_ref text;
  v_is_admin boolean;
  v_is_operator boolean;
begin
  -- Resolve effective actor: auth.uid() (JWT path) takes precedence; p_actor_id (service_role path) only when auth.uid() is null
  v_effective_actor := coalesce(auth.uid(), p_actor_id);

  -- ⚑ 0180 (FR-AMG-002): the RESOLVED actor must be an active member. Ahead of the privilege check
  -- and of the Vault write, so an offboarded Admin can neither mint a secret nor rotate a live one.
  perform public.assert_is_active_member(p_actor_id);

  -- Gate: effective actor must be Admin of p_org_id OR platform Operator
  -- Check profiles.role = 'Admin' AND profiles.org_id = p_org_id
  select exists (
    select 1 from public.profiles
    where id = v_effective_actor
      and org_id = p_org_id
      and role = 'Admin'
  ) into v_is_admin;

  -- Check platform operator directly for effective actor (bypass is_operator() which runs as function owner)
  select exists (
    select 1 from public.platform_operators
    where user_id = v_effective_actor
  ) into v_is_operator;

  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  -- Create Vault secret (idempotent on name); it returns a UUID, we return the name we passed
  perform vault.create_secret(p_secret_value, p_secret_name);
  v_secret_name := p_secret_name;

  -- Capture old secret_ref for rotation revocation (if reconnecting)
  select secret_ref into v_old_secret_ref
  from public.external_org_bindings
  where org_id = p_org_id and external_tier = p_external_tier;

  -- Upsert external_org_bindings row
  insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
  values (p_org_id, p_external_tier, '', v_secret_name, 'active', v_effective_actor, now())
  on conflict (org_id, external_tier) do update set
    secret_ref = excluded.secret_ref,
    status = 'active',
    connected_by = excluded.connected_by,
    connected_at = excluded.connected_at,
    updated_at = now();

  -- AC-EAC-006: reconnect rotates + REVOKES old secret
  if v_old_secret_ref is not null and v_old_secret_ref <> v_secret_name then
    perform public.delete_vault_secret(v_old_secret_ref);
  end if;

  -- Emit audit event (log_audit exists per 0076_audit_events.sql)
  -- Use 'integration.reconnect' when rotating an existing binding
  perform public.log_audit(
    case when v_old_secret_ref is not null and v_old_secret_ref <> v_secret_name
         then 'integration.reconnect' else 'integration.connect' end,
    p_org_id,
    null,  -- entity_type
    null,  -- entity_id
    jsonb_build_object(
      'tier', p_external_tier,
      'actor', v_effective_actor,
      'secret_ref', v_secret_name,
      'rotated', v_old_secret_ref is not null and v_old_secret_ref <> v_secret_name
    )
  );

  return v_secret_name;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — FR-AMG-005 / AC-AMG-006. Annotate the RLS conjuncts the create-path slices made UNREACHABLE.
--
-- Slices 2-4 (0174/0175) revoked client INSERT on the three procure-to-pay child tables, so their
-- `create_*` definer RPCs became the SOLE client write path. Verified against the live catalog
-- (2026-07-29): `authenticated` and `anon` hold **SELECT only** on all three. The write policies are
-- therefore dead code that reads like a live control — the next auditor sees the conjunct and
-- concludes the path is covered.
--
-- ⚑ TWO CORRECTIONS TO THE SPEC'S FRAMING, both from reading the catalog rather than the prose:
--   (a) `procurement_receipts_insert` NEVER carried `is_active_member()` at all (0063's sweep predates
--       it). So the goods-receipt create path had NO active-member control ANYWHERE — neither in RLS
--       nor in the RPC — until §2 of this file. That is worse than the "dead conjunct" the spec
--       describes, not better, and it is why the annotation says what it says.
--   (b) `procurement_quotations_write` is `FOR ALL`, so its USING clause is still evaluated for
--       SELECT. It is not wholly dead: only its INSERT/UPDATE/DELETE arms are unreachable. Its SELECT
--       contribution is strictly narrower than `procurement_quotations_select` (same predicate plus a
--       role gate, an org_feature gate and a parent-procurement existence test), so it widens nothing
--       and removing it would change no read. Saying "dead policy" would have been false.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
comment on policy procurement_invoices_insert on public.procurement_invoices is
  'SUPERSEDED and UNREACHABLE since 0174: `authenticated`/`anon` hold SELECT only on this table, so no '
  'client INSERT can reach this policy. The sole client write path is the SECURITY DEFINER RPC '
  'create_procurement_invoice, which re-asserts org, role, the ERPNext-ownership fence, the '
  'origination-status gate AND — since 0180 — active membership (assert_is_active_member). ⚑ The '
  'is_active_member() conjunct below is DEAD CODE THAT READS LIKE A LIVE CONTROL: do not cite it as '
  'evidence that offboarding is enforced here; 0180 §2 is. Kept as the second layer if a future '
  'migration re-grants INSERT — dropping it would make such a re-grant fully open.';

comment on policy procurement_receipts_insert on public.procurement_receipts is
  'SUPERSEDED and UNREACHABLE since 0174: `authenticated`/`anon` hold SELECT only on this table. The '
  'sole client write path is the SECURITY DEFINER RPC create_procurement_receipt, which re-asserts '
  'org, the Admin/PM/requester gate, the ERPNext-ownership fence and — since 0180 — active membership '
  '(assert_is_active_member). ⚑ NOTE THE ASYMMETRY WITH ITS TWIN: this policy never carried '
  'is_active_member() at all (0063''s sweep predates it), so the goods-receipt create path had NO '
  'active-member control on ANY layer until 0180 — RLS included. Kept as the second layer if a future '
  'migration re-grants INSERT.';

comment on policy procurement_quotations_write on public.procurement_quotations is
  'Its INSERT/UPDATE/DELETE arms are SUPERSEDED and UNREACHABLE since 0174 (`authenticated`/`anon` '
  'hold SELECT only on this table); the sole client write path is the SECURITY DEFINER RPC '
  'create_procurement_quotation, which re-asserts org, role and — since 0180 — active membership '
  '(assert_is_active_member), and select_procurement_quote for the is_selected flip. ⚑ NOT wholly '
  'dead: being FOR ALL, its USING is still evaluated for SELECT, where it is strictly narrower than '
  'procurement_quotations_select (same predicate plus a role gate, an org_feature gate and a '
  'parent-procurement existence test) and therefore widens no read. The is_active_member() conjunct '
  'is live for reads and dead for writes; 0180 §2 is what enforces it on the write path.';
