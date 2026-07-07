-- 0074_org_id_stamp_trigger.sql — make the org_id tenancy seam FORWARD-COMPATIBLE (charter goal;
-- post-audit MED-1/2). NON-DESTRUCTIVE, regression-safe: the seed-org column DEFAULT is preserved.
--
-- ── PROBLEM ─────────────────────────────────────────────────────────────────────────────────────
-- Every core business table declares `org_id ... not null ... default '…-0001'` (the seed org, 0001)
-- and the DAL never sends org_id — it relies on that constant default under the invariant "never send
-- org_id; RLS stamps it". But RLS INSERT WITH CHECK requires `org_id = auth_org_id()`. For an
-- authenticated NON-seed-org user the constant default (seed org) ≠ their real org, so the insert is
-- rejected with 42501 (proven by 0002 tenant-isolation AC-103b). The "forward-compatible B2B seam"
-- the charter promises therefore only worked one-project-per-seed-org. (0061 already fixed this for the
-- three agent tables via a coalesce(auth_org_id(), seed) DEFAULT; this migration generalizes the fix to
-- every remaining seed-org-default business table, and adds anti-forgery override, via a trigger.)
--
-- ── FIX ─────────────────────────────────────────────────────────────────────────────────────────
-- A `before insert` trigger, stamp_org_id(), on each affected table. For an AUTHENTICATED caller
-- (auth_org_id() is not null) it stamps NEW.org_id := auth_org_id() ONLY when NEW.org_id is NULL or
-- still the seed-org literal ('…-0001') — i.e. only when the caller relied on the column default /
-- sent nothing. An EXPLICITLY-supplied, genuinely-foreign org_id (anything other than the seed
-- literal) is left untouched, so RLS WITH CHECK (org_id = auth_org_id()) rejects it with 42501 as
-- before (hard-reject, not silent-coerce — see "Design note" below). For a service-role / table-owner
-- / pre-auth-context caller (auth_org_id() is null) it no-ops, so the constant seed-org DEFAULT and any
-- explicitly-set org_id are preserved unchanged.
--
-- ── WHY THIS IS SAFE (and proven — pgTAP 0131 + the untouched 0002/0051/0052/… conventions) ────────
--   • Authenticated SEED-org user: auth_org_id() = seed org → NEW.org_id (null/default/seed-literal)
--     stamps to the same seed org either way. Identical to the old default. No change.
--   • Authenticated NON-seed-org user relying on the default (sends no org_id, or the DAL's constant
--     seed-org default lands in NEW): now stamped with THEIR org → the write SUCCEEDS (was broken).
--     ← this is the fix. (0131 AC-ORGSTAMP-001/002/003.)
--   • Service-role / pgTAP-as-owner (auth_org_id() null): trigger no-ops → constant default / explicit
--     org_id preserved. Onboarding's historical-import loader sets org_id explicitly under service-role
--     and is unaffected. (0002 tenant-isolation stays green — the default-fallback path is intact.)
--   • Cross-org forgery via a GENUINELY foreign org_id (not the seed literal): the trigger leaves it
--     alone and RLS WITH CHECK rejects the write with 42501 — unchanged from pre-trigger behavior.
--     (0131 AC-ORGSTAMP-004; also why ~11 existing pgTAP files' "explicit foreign org_id → 42501"
--     assertions are untouched by this migration.)
--
-- ── DESIGN NOTE (narrow vs. override-always — Director decision 2026-07-07) ─────────────────────────
-- An earlier draft of this migration made the trigger override NEW.org_id unconditionally for any
-- authenticated caller (silently coercing even a genuinely-forged foreign org_id to the caller's own).
-- That is REJECTED here in favor of the narrow condition above, because the codebase already ships and
-- documents the narrow contract (supabase/tests/0070_procurement_files_rls.test.sql lines ~122-124:
-- "an explicitly-supplied cross-org UUID is preserved, so the RLS WITH CHECK … rejects the row") across
-- ~11 pgTAP files. Both designs deliver identical tenant isolation (a cross-org row can never land
-- either way) — the narrow variant additionally preserves the existing "hard reject with 42501" proof
-- surface instead of quietly rewriting ~15 assertions across 13 files. Only the 3 pgTAP assertions that
-- literally used the SEED-ORG LITERAL as their "foreign" org value change (0002 AC-103b, 0051 AC-CO-108,
-- 0052 AC-IN-104) — those are the genuine bug being fixed (a default/seed-literal org_id is not a forged
-- value from a real other org, it's the DAL's known non-forgery default), not a design casualty.
--
-- ── SCOPE / EXCLUSION (deliberate) ────────────────────────────────────────────────────────────────
-- Applied to EVERY table that carries the seed-org default (enumerated below) EXCEPT `credits`.
-- `credits` is excluded because operator_grant_credits() (0067) is a shipped security-definer RPC that,
-- under an authenticated Operator's JWT, inserts a credits row for a CROSS-ORG target
-- (p_org_id ≠ auth_org_id()). A blanket stamp would override that target back to the Operator's home org
-- and silently corrupt cross-org grants. `credits` already has a correct, tighter org flow (RLS
-- is_operator() + org_id = auth_org_id() for direct inserts; cross-org only via the definer RPC), so it
-- must NOT receive the blanket stamp. (The three agent tables keep their 0061 coalesce-default too; the
-- trigger simply overrides to the same value for an authenticated caller there.)
--
-- NOTE (future-proofing, security audit 2026-07-07): `org_features` is the SECOND cross-org
-- authenticated-JWT insert path — operator_toggle_feature() (0070) inserts for p_org_id ≠ auth_org_id()
-- under an Operator JWT, structurally identical to credits. It is correctly ABSENT from the list below
-- only because `org_features.org_id` has NO seed-org column default, so the "enumerate by seed-org
-- default" construction never picked it up (the trigger never fires on it → no corruption). If a future
-- migration adds a seed-org default to `org_features` and re-runs this enumeration, it MUST stay
-- excluded here for the same reason as credits.
--
-- ── Reversibility (pre-production, ADR-0006): supabase db reset. Manual rollback:
--   drop each `<tbl>_stamp_org_id` trigger, then `drop function public.stamp_org_id();`.

-- ── The stamp function. security definer + pinned search_path (matches auth_org_id()/auth_role()). ──
create or replace function public.stamp_org_id() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- authenticated user (auth_org_id() not null) AND the row is relying on "no real org_id supplied"
  -- (NULL, or still the seed-org literal default) → stamp THEIR real org. An explicitly-supplied,
  -- genuinely-foreign org_id is left untouched so RLS WITH CHECK rejects it (42501) — narrow variant,
  -- see the Design note above. Service-role / table-owner / pre-auth context (auth_org_id() null) →
  -- always keep NEW.org_id (constant default or the explicitly-set value) — no-op.
  if auth_org_id() is not null
     and (new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001') then
    new.org_id := auth_org_id();
  end if;
  return new;
end $$;

-- ── Attach an idempotent before-insert trigger to every seed-org-default business table (minus
-- credits). Enumerated via `grep -rl "default '…-0001'" migrations` and deduped to the live set. The
-- DO block drops-then-creates each trigger so this migration is re-runnable. ────────────────────────
do $$
declare
  t text;
  tbls text[] := array[
    -- 0001_init_schema
    'companies','profiles','projects','procurements','procurement_items','procurement_quotations',
    'procurement_documents','budget_versions','budget_line_items','timesheets','timesheet_entries',
    'tasks','task_dependencies','incident_reports','project_documents',
    -- 0006_procurement_lifecycle
    'procurement_receipts','procurement_invoices','procurement_doc_counters',
    -- 0008_project_revenue
    'pipeline_stage_config',
    -- 0023_delivery_milestones
    'project_milestones',
    -- 0028_procurement_files
    'procurement_quotation_files','procurement_receipt_files','procurement_invoice_files',
    -- 0030_crm_contacts_activity
    'contacts','crm_activities',
    -- 0035_procurement_record_tables
    'purchase_requests','rfqs','purchase_orders','payments',
    -- 0036_procurement_record_files
    'purchase_request_files','rfq_files','purchase_order_files','payment_files',
    -- 0038_transition_writes_records
    'procurement_status_events',
    -- 0045_user_views
    'user_views',
    -- 0046_agent_persistence  (0061 coalesce-default; trigger overrides to same value for auth callers)
    'agent_threads','agent_runs','agent_events',
    -- 0047_agent_usage_credits  (credits DELIBERATELY EXCLUDED — cross-org operator RPC, see header)
    'agent_usage',
    -- 0048_agent_automations_notifications
    'agent_automations','notifications',
    -- 0060_agent_attachments
    'agent_attachments'
  ];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp_org_id', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.stamp_org_id()',
      t || '_stamp_org_id', t);
  end loop;
end $$;
