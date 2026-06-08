-- 0015_procurement_crud.sql — Procurement CRUD hardening (CRUD+RBAC program, Procurement slice).
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- The existing procure-to-pay state machine + SoD (0006_procurement_lifecycle.sql) is UNCHANGED: this
-- migration adds ONLY (1) a select-quote RPC that was missing — the FE could create quotations but
-- nothing ever set `is_selected`, so a "selected" quote never synced into the header (the real bug
-- noted in the program plan §Phase-2.3) — and (2) a Draft-only / requester WITH-CHECK tightening on
-- procurement_items so the editable line-items table matches the RBAC contract
-- (docs/design/rbac-visibility.md §E2: line items editable by the requester (incl. Engineer) + the
-- write roles WHILE the PR is Draft).
--
-- ACL discipline mirrors 0006 / ADR-0009: the RPC does `revoke all from public`, `grant execute to
-- authenticated`, `revoke execute from anon`; it is SECURITY DEFINER, pins search_path = public, and
-- RE-ASSERTS auth_org_id()/auth_role()/SoD-shape internally because definer rights bypass RLS. Table
-- refs inside the definer function are schema-qualified (LOW-BV-1 lesson). Calls auth_org_id()/auth_role().
--
-- NOTE: transition_procurement / create_procurement_quotation / _receipt / _invoice (0006) and the
-- procurement column grants (0010) are NOT touched. select_procurement_quote does the same single-txn
-- status advance the transition RPC would, but additionally writes is_selected + the header total/vendor
-- sync, which is exactly why it must be its own RPC (the multi-row write is one indivisible txn).

-- ============================================================================
-- A1 — select_procurement_quote(p_quotation_id): the missing select-quote authority (FR-PROC-CRUD-001).
-- Sets the chosen quotation's is_selected=true (clearing any prior selection on the same PR so the
-- partial unique index procurement_quotations_one_selected_idx is never violated), syncs the header
-- total_value + vendor_id from the selected quote, and advances the PR Vendor Quoted → Quote Selected.
--
-- AUTHZ (re-asserted internally — definer bypasses RLS, so these MUST stay):
--   • the quotation's parent procurement must be in auth_org_id() (parent-org guard, HIGH-BV-1 shape);
--   • auth_role() ∈ ('Admin','Project Manager','Finance') — the sourcing roles that select a quote
--     (matches the FE can('create','quotation') set + the 4-role write policy minus Exec/Engineer);
--   • the PR must be in status 'Vendor Quoted' (the only stage a quote may be selected from) → P0001.
-- The SoD from 0006 is unaffected: selecting a quote is a sourcing action, not approve/pay.
-- ============================================================================
create or replace function select_procurement_quote(p_quotation_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid;
  v_proc     uuid;
  v_status   procurement_status;
  v_vendor   uuid;
  v_total    numeric(14,2);
  v_role     user_role := auth_role();
begin
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
revoke all     on function select_procurement_quote(uuid) from public;
grant  execute on function select_procurement_quote(uuid) to   authenticated;
revoke execute on function select_procurement_quote(uuid) from anon;

-- ============================================================================
-- A2 — procurement_items: Draft-only tightening + requester (incl. Engineer) widening (FR-PROC-CRUD-002).
--
-- The existing procurement_items_write (0002_rls.sql) is FOR ALL with (org + 4-role) in USING + WITH
-- CHECK. Two gaps vs the RBAC contract (rbac-visibility.md §E2 "Add/edit line items (Draft)"):
--   (a) it permits item writes at ANY stage, not just Draft — line items should be frozen once the PR
--       leaves Draft (the value is fixed at submit / quote-select);
--   (b) it EXCLUDES the Engineer who raised the PR — but an Engineer requester must be able to build
--       their own request's line items while it is Draft.
--
-- Fixes, both additive and minimal:
--   • A RESTRICTIVE policy on procurement_items for ALL: the parent PR must be in status 'Draft'. A
--     restrictive policy is AND-combined with every permissive policy and applies to the named command,
--     so this freezes item writes (insert/update/delete) once the PR advances — for EVERY writer,
--     including the 4 write-roles — without otherwise changing who may write.
--   • An additional PERMISSIVE policy granting the requester (auth.uid() = the parent PR's
--     requested_by_id) item writes regardless of their role — so an Engineer requester is admitted by
--     this policy while a non-requester Engineer is not (the base policy already excludes Engineers).
--     Combined with the restrictive Draft gate, the requester can only write while Draft, matching §E2.
-- The org + parent-org guard rides on each permissive policy's USING/WITH CHECK as before.
-- ============================================================================

-- (a) Draft-only freeze (restrictive → AND'd with the permissive write policies, both USING + CHECK).
create policy procurement_items_draft_only on procurement_items
  as restrictive
  for all
  using (exists (
    select 1 from public.procurements p
     where p.id = procurement_items.procurement_id
       and p.org_id = auth_org_id()
       and p.status = 'Draft'))
  with check (exists (
    select 1 from public.procurements p
     where p.id = procurement_items.procurement_id
       and p.org_id = auth_org_id()
       and p.status = 'Draft'));

-- (b) Requester widening (permissive → OR'd with procurement_items_write): the PR's requester may write
-- its items regardless of role. org + parent-org guard kept; the Draft restrictive policy above still
-- AND-gates this, so the requester can only write while Draft.
create policy procurement_items_requester on procurement_items
  for all
  using (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id()
                   and p.requested_by_id = auth.uid()))
  with check (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id()
                   and p.requested_by_id = auth.uid()));

-- ============================================================================
-- A3 — procurement_items.org_id inheritance from the parent PR (org_id seam fix).
--
-- The client NEVER sends org_id (createProcurementItem omits it — the unspoofable seam). Without this
-- trigger the column DEFAULT ('…-0001', the legacy org) is stamped on every insert, so a line item on a
-- PR in ANY OTHER org gets the wrong org_id and the write policies' WITH CHECK (org_id = auth_org_id())
-- fails with 42501. The other child tables avoid this because they are minted by SECURITY DEFINER RPCs
-- that compute org from the parent (create_procurement_quotation / _receipt, budget_line_items via
-- clone_budget_version); procurement_items is the only child written on the direct-INSERT RLS path, so it
-- needs an equivalent parent-inheritance stamp at the table layer. Multi-tenant-safe: org_id is taken
-- from the row's OWN parent procurement, not a static default.
--
-- BEFORE INSERT, security INVOKER (no definer rights needed — it only reads procurements, which the
-- caller may already read in-org; the write policies' parent-org guard still authorizes the row).
-- search_path pinned + schema-qualified (LOW-BV-1). Only fills org_id when the client left it at the
-- column default / null — an explicitly-sent org_id is preserved so the cross-org spoof tests
-- (org-B sending org-A's org_id) still hit the WITH CHECK rather than being silently rewritten.
-- ============================================================================
create or replace function stamp_procurement_item_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  -- Only inherit when the client did not explicitly set org_id (i.e. it is null or the table default).
  if new.org_id is null
     or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id
      from public.procurements p
     where p.id = new.procurement_id;
  end if;
  return new;
end; $$;

create trigger procurement_items_stamp_org
  before insert on procurement_items
  for each row execute function stamp_procurement_item_org();
