-- 0081_feature_flag_write_enforcement.sql — SERVER-ENFORCE feature entitlements on WRITES
-- (audit HIGH: feature flags were FE-only via useFeature; a direct PostgREST call with a valid
-- JWT could WRITE to a gated feature's tables even when the org had the feature disabled).
--
-- 0070_org_features.sql shipped org_has_feature(p_org_id, p_key) as the FUTURE server-enforcement
-- hook, explicitly UNUSED by RLS. This migration WIRES feature-flag enforcement into the WRITE RLS
-- policies of every gated feature's business tables: each write policy's predicate is conjoined with
--   and public.org_feature_enabled(public.auth_org_id(), '<feature_key>')
-- so an otherwise-authorized member's INSERT/UPDATE/DELETE is DENIED when the org has the feature
-- disabled (org_features row enabled=false) and ADMITTED when enabled or absent (FR-ENT-004 absence
-- = default-on). SELECT/read policies are NEVER gated (reading a disabled feature's existing rows
-- stays fine; only WRITES are gated).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY A DO BLOCK (not hand-written drop+create per policy)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0063_is_active_member_conjunction.sql APPENDED `and public.is_active_member()` to EVERY business-
-- table policy AT APPLY TIME via a DO block reading pg_policies — so the LIVE stored predicate of
-- every gated-table policy is (source predicate) + `and is_active_member()`, which the SOURCE
-- migration files do NOT show. Hand-copying each policy's source predicate verbatim would therefore
-- DROP the active-member guard (a security regression — a disabled user could write again). Mirroring
-- 0063's own DO block (read LIVE pg_policies, append the conjunct, drop+recreate preserving
-- permissive/restrictive + cmd + the FULL current predicate) is the safe, proven way to conjoin the
-- feature check without losing the active-member guard. This migration IS that mirror, scoped to
-- WRITE policies (cmd in insert/update/delete/all) on the gated tables only. Confirmed at write time:
-- NO migration 0064..0080 creates a policy on any gated table, so every gated-table policy carries
-- the 0063 append and the DO block preserves it.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY org_feature_enabled (a NON-RAISING wrapper), NOT org_has_feature
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- org_has_feature (0070) RAISES 42501 for inactive / cross-org / null-org callers. In a policy
-- predicate that raise PROPAGATES and turns a 0-row deny into a query ERROR on the SELECT path: a
-- permissive FOR ALL write policy's qual is OR'd with the table's separate SELECT policy during
-- reads, so a disabled / no-profile caller evaluating that OR hits org_has_feature(null, …) → RAISE
-- → the whole SELECT errors 42501 (instead of returning 0 rows) — a read-path regression for
-- disabled/no-profile users who may still hold a valid JWT. To keep the security outcome identical
-- (writes AND reads denied for feature-off / inactive / cross-org) WITHOUT error propagation, this
-- migration adds org_feature_enabled() — a non-raising boolean twin that returns FALSE (never
-- raises) for inactive / cross-org / null-org callers and is otherwise byte-identical to
-- org_has_feature for an in-org active member. Leak-safe: a cross-org probe always yields false (the
-- real value is never returned for another org); the own-org value is not a secret (useFeature reads
-- it directly). org_has_feature is KEPT AS-IS (the raising variant stays for direct/RPC assertion).
-- (The brief explicitly sanctions this: "if a raise-in-policy is a problem for any path, add a plain
-- non-raising boolean wrapper instead and say so." — it is, so we do.)
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- feature_key → [tables] MAP APPLIED HERE
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--   incidents   → incident_reports
--   crm         → companies, contacts, crm_activities
--   procurement → procurements, procurement_items, procurement_quotations, procurement_documents,
--                 procurement_receipts, procurement_invoices, procurement_quotation_files,
--                 procurement_receipt_files, procurement_invoice_files, purchase_requests,
--                 purchase_orders, rfqs, payments, purchase_request_files, rfq_files,
--                 purchase_order_files, payment_files
--   timesheets  → timesheets, timesheet_entries
--   user_views  → user_views
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- SKIPPED (with reasons — the Director may add any of these)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--   import_export  : an ACTION (data import/export), not an entity — NO business table to gate.
--                    (import_provenance / import_provenance_projects, 0072/0073, are audit/
--                    provenance logs with their own RLS — NOT the import_export entity; left ungated.)
--   agent_assistant: the agent_* tables are org-scoped but the agent_assistant entitlement is
--                    READ-ONLY / not toggleable today (its EFFECTIVE gate is the
--                    VITE_FEATURES_AGENT_ASSISTANT env flag — features.ts FEATURE_KEYS_TOGGLEABLE
--                    excludes it), and the agent surface is separately credit-gated
--                    (agent_usage/credits). Gating agent_* on the entitlement would diverge from the
--                    env-flag gate and risks breaking the in-dev agent surface. Left ungated — gate
--                    when agent_assistant becomes a real toggleable entitlement.
--   pipeline_stage_config : AMBIGUOUS — sales-pipeline win-probability config surfaced under the CRM
--                    feature, but it lives in the projects/revenue schema (0008), is seeded per-org,
--                    and is read by RPCs. Per "leave ambiguous ungated", left ungated.
--   procurement_doc_counters : internal doc-number counter, RPC-only (next_procurement_doc_number),
--                    NO client write policy, excluded from is_active_member (0063). No write path.
--   procurement_status_events : RPC-only append-only transition log (transition_procurement), NO
--                    client write policy. No write path.
--   purchase_requests / rfqs / purchase_orders / payments : INCLUDED (gated) — the brief names
--                    PR/PO/RFQ/payment tables; NOTE 0058 already REVOKED their client
--                    INSERT/UPDATE/DELETE grants (RPC-only writes), so for these four the RLS
--                    feature-gate is belt-and-suspenders (direct PostgREST writes are already
--                    privilege-denied). The procurement SECURITY-DEFINER RPCs themselves are NOT
--                    feature-gated server-side — a RESIDUAL follow-up (out of scope for an RLS slice).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- SELECT INVARIANT (verified per-table at write time)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- EVERY gated table below has a SEPARATE permissive *_select (or *_read) policy. Conjoining the
-- feature check onto a FOR ALL write policy's qual therefore does NOT gate reads: the FOR ALL qual
-- applies to SELECT too, but permissive policies for the same command are OR'd, so reads survive via
-- the dedicated SELECT policy (which is untouched — cmd='select' is excluded from the DO block). For
-- the no-profile / disabled caller the non-raising wrapper returns false (not raise), so the OR
-- evaluation cannot error. pgTAP 0138 proves reads stay open with the feature disabled.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset` (0002..0058 + 0063 re-create the
-- original policies on reset; 0081 is not re-applied). No per-policy manual reverse — the canonical
-- reverse is db reset (same contract as 0063).

-- ============================================================================
-- A1 — org_feature_enabled: the non-raising, RLS-policy-safe boolean twin of org_has_feature.
-- Stable + security-definer + pinned search_path (mirrors org_has_feature / org_credit_balance).
-- Security-definer + granted to authenticated ⇒ it MUST re-assert org membership + active status
-- itself (relying on org_features' RLS would (a) make p_org_id a lie and (b) leak entitlement state
-- to a cross-org prober). It re-asserts by RETURNING FALSE (not raising) for those callers.
-- ============================================================================
create or replace function public.org_feature_enabled(p_org_id uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  -- Non-raising guards: caller must be an ACTIVE member of p_org_id's org. Returns false (never
  -- raises) so the function is safe inside a policy predicate's OR evaluation on the SELECT path.
  -- `is distinct from` is null-safe: a null auth_org_id() vs a non-null p_org_id ⇒ distinct ⇒ false.
  if p_org_id is null
     or p_org_id is distinct from public.auth_org_id()
     or not public.is_active_member() then
    return false;
  end if;
  -- Core keys are NEVER gatable (FR-ENT-007); org_has_feature's core short-circuit, preserved.
  return case when p_key in ('projects','dashboard','approvals','administration') then true
              else coalesce((select enabled from public.org_features
                              where org_id = p_org_id and feature_key = p_key), true)
             end;
end $$;
revoke all on function public.org_feature_enabled(uuid,text) from public;
grant  execute on function public.org_feature_enabled(uuid,text) to authenticated;

-- ============================================================================
-- A2 — Conjoin the feature check onto every WRITE policy of the gated tables.
-- Mirrors 0063's DO block exactly: read LIVE pg_policies (which already carry the 0063
-- is_active_member append), append the feature conjunct to qual and/or with_check (whichever the
-- policy's command kind has), drop+recreate preserving permissive/restrictive + command + the FULL
-- current predicate. Scoped to WRITE policies (cmd in insert/update/delete/all) on the gated tables.
-- ============================================================================
do $$
declare
  r record;
  feat text;
  q text;
  wc text;
  using_clause text;
  check_clause text;
begin
  for r in (
    select tablename, policyname, permissive, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and cmd in ('insert','update','delete','all')   -- WRITE policies only (never SELECT)
      and tablename in (
        'incident_reports',                                                   -- incidents
        'companies','contacts','crm_activities',                              -- crm
        'procurements','procurement_items','procurement_quotations',          -- procurement
        'procurement_documents','procurement_receipts','procurement_invoices',
        'procurement_quotation_files','procurement_receipt_files','procurement_invoice_files',
        'purchase_requests','purchase_orders','rfqs','payments',
        'purchase_request_files','rfq_files','purchase_order_files','payment_files',
        'timesheets','timesheet_entries',                                     -- timesheets
        'user_views'                                                          -- user_views
      )
    order by tablename, policyname
  ) loop
    -- Resolve this table's feature_key (the gated-table filter above guarantees a hit).
    feat := case r.tablename
      when 'incident_reports' then 'incidents'
      when 'companies'        then 'crm'
      when 'contacts'         then 'crm'
      when 'crm_activities'   then 'crm'
      when 'procurements'                  then 'procurement'
      when 'procurement_items'             then 'procurement'
      when 'procurement_quotations'        then 'procurement'
      when 'procurement_documents'         then 'procurement'
      when 'procurement_receipts'          then 'procurement'
      when 'procurement_invoices'          then 'procurement'
      when 'procurement_quotation_files'   then 'procurement'
      when 'procurement_receipt_files'     then 'procurement'
      when 'procurement_invoice_files'     then 'procurement'
      when 'purchase_requests'             then 'procurement'
      when 'purchase_orders'               then 'procurement'
      when 'rfqs'                          then 'procurement'
      when 'payments'                      then 'procurement'
      when 'purchase_request_files'        then 'procurement'
      when 'rfq_files'                     then 'procurement'
      when 'purchase_order_files'          then 'procurement'
      when 'payment_files'                 then 'procurement'
      when 'timesheets'       then 'timesheets'
      when 'timesheet_entries' then 'timesheets'
      when 'user_views'       then 'user_views'
    end;

    -- Append the feature conjunct to whichever clause(s) this policy's command kind has
    -- (INSERT → with_check only; UPDATE/ALL → both; DELETE → qual only). The LIVE qual/with_check
    -- already carry the 0063 is_active_member() append, which is preserved verbatim.
    q  := case when r.qual       is null then null
               else r.qual       || ' and public.org_feature_enabled(public.auth_org_id(), ' || quote_literal(feat) || ')' end;
    wc := case when r.with_check is null then null
               else r.with_check || ' and public.org_feature_enabled(public.auth_org_id(), ' || quote_literal(feat) || ')' end;
    using_clause := case when q  is null then '' else ' using (' || q  || ')' end;
    check_clause := case when wc is null then '' else ' with check (' || wc || ')' end;

    execute 'drop policy if exists ' || quote_ident(r.policyname) || ' on public.' || quote_ident(r.tablename);
    execute 'create policy ' || quote_ident(r.policyname)
         || ' on public.' || quote_ident(r.tablename)
         || ' as ' || lower(r.permissive)            -- preserve PERMISSIVE vs RESTRICTIVE (regression guard)
         || ' for ' || lower(r.cmd)                  -- select | insert | update | delete | all
         || using_clause
         || check_clause;
  end loop;
end $$;
