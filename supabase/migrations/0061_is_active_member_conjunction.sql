-- 0061_is_active_member_conjunction.sql — conjoin is_active_member() into EVERY business-table
-- policy (FR-INV-003, AC-INV-002). The C1 gap: the prior conjunction pass covered select|all only
-- and silently missed ~30 write policies (INSERT/UPDATE/DELETE) — a disabled user with a still-valid
-- JWT could still WRITE. This mechanical pass closes it by appending
--   "and public.is_active_member()"
-- to the USING and/or WITH CHECK clause of EVERY business-table policy (all 5 kinds: SELECT, INSERT,
-- UPDATE, DELETE, ALL), single-sourced through is_active_member() (0060, security-definer — bypasses
-- RLS to avoid recursion when conjoined into profiles_select itself).
--
-- Implementation choice (robust, no transcription error): a DO block reads pg_policies AT APPLY TIME
-- and drops+recreates each policy, appending the conjunct to whichever of qual/with_check exists for
-- that policy's command kind (SELECT/DELETE → USING; INSERT → WITH CHECK; UPDATE/ALL → both). The
-- permissive/restrictive nature of each policy is preserved verbatim (a restrictive policy recreated
-- as permissive would OR-in and BROADEN access — a real regression), so we read pg_policies.permissive
-- and re-emit `as permissive`/`as restrictive`. Predicates are preserved VERBATIM from pg_policies
-- (the canonical stored form). pgTAP 0112 proves the read-deny AND the write-deny.
--
-- EXCLUDED (NOT member-business tables — conjoining would be wrong or redundant):
--   organizations.organizations_select — the tenant boundary; auth_org_id() is security-definer and
--     already reads profiles under the caller JWT (the disable check happens at the profiles lookup).
--   pipeline_stage_config.* — read by RPC, not a user-facing member table.
--   procurement_doc_counters.* — read by the doc-number RPC, not user-facing.
-- (agent_dispatch_watermarks has RLS forced + no policy → default-deny already; platform_operators
--  is created in 0062 with its own ONE policy and is intentionally NOT conjoined.)
--
-- Reversibility (ADR-0006): supabase db reset (the original policies are re-created by 0002+later on
-- reset). There is no manual per-policy reverse — the canonical reverse is db reset.
--
-- Build-time audit (grep inventory at the time of this migration — the DO block reads the LIVE
-- pg_policies, so any policy a later migration adds is also conioned; this grep is the snapshot):
--   line-based `create policy ... for (select|all|insert|update|delete)` returned 97 policy-creation
--   lines across 0002..0059; the multiline restrictive policies (companies/contacts/payment_files/
--   project_documents/projects/procurement_items/procurement_*_files/rfq_files/purchase_*_files/
--   procurement_invoice_files `_delete_admin_only`, procurement_items_draft_only(+_mod/_del),
--   procurements_insert_self_requester) split `create policy` across lines and are listed in the
--   plan's enumerated table; the DO block reads them ALL from pg_policies regardless of line shape.

do $$
declare
  r record;
  q text;
  wc text;
  using_clause text;
  check_clause text;
begin
  for r in (
    select tablename, policyname, permissive, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename not in ('organizations', 'pipeline_stage_config', 'procurement_doc_counters')
    order by tablename, policyname
  ) loop
    -- Append the conjunct to whichever clause(s) this policy kind has.
    q  := case when r.qual       is null then null else r.qual       || ' and public.is_active_member()' end;
    wc := case when r.with_check is null then null else r.with_check || ' and public.is_active_member()' end;
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
