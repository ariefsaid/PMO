-- 0105_sales_invoice_submit_sod.sql (ERPNext P3a, Slice 3, tasks 3.2 + 3.4)
-- Carries BOTH the process_gates helper RPC (§A) and the SI-submit SoD RPC + author_user_id column (§B/C).
-- They are one PR per the plan. Re-verify migration number: ls supabase/migrations | tail -3 = 0104 at write time.
--
-- Reversibility (pre-production): supabase db reset. Manual reverse:
--   drop function if exists public.get_process_gates(uuid);
--   drop function if exists public.submit_sales_invoice(uuid);
--   alter table public.sales_invoices drop column if exists author_user_id;

-- ============================================================================
-- §A — process_gates (data in external_org_bindings.config; no schema change).
-- A read helper so the dispatch + the UI read ONE normalized shape with safe defaults.
-- The Admin-only flip is the EXISTING external_org_bindings RLS (Admin-only UPDATE
-- policy added here) — no new policy type needed.
-- ============================================================================

-- Admin-only UPDATE policy on external_org_bindings (0096 only had SELECT).
-- This gate protects the process_gates flip (FR-SAR-192).
create policy external_org_bindings_update_admin_only on public.external_org_bindings
  as restrictive
  for update
  using (auth_role() = 'Admin');

-- Read helper RPC: returns the process_gates jsonb with safe defaults when absent.
create or replace function public.get_process_gates(p_org uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(
    (select (config -> 'process_gates') from public.external_org_bindings
       where org_id = p_org and external_tier = 'erpnext'),
    '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb
  );
$$;
revoke all on function public.get_process_gates(uuid) from public;
grant execute on function public.get_process_gates(uuid) to authenticated;

-- ============================================================================
-- §B — author_user_id on sales_invoices (records who authored the draft; the SoD
-- compares against the submitting JWT user). Nullable for inbound-adopted SIs
-- (no PMO author).
-- ============================================================================

alter table public.sales_invoices add column if not exists author_user_id uuid references auth.users(id);

-- ============================================================================
-- §C — submit_sales_invoice: SECURITY DEFINER, enforces approver ≠ author on the
-- money-commitment step. Mirrors the ADR-0019 procurement approver pattern.
-- The dispatch calls this BEFORE issuing the ERP submit; a self-approval is
-- rejected with a typed error (no ERP call).
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
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_author    := v_row.author_user_id;
  v_submitter := coalesce(auth.uid()::text, '');

  -- SoD (FR-SAR-195): the submitter must differ from the author. Null author (inbound-adopted) is allowed.
  if v_author is not null and v_author::text = v_submitter then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  return v_row;
end; $$;

revoke all on function public.submit_sales_invoice(uuid) from public;
grant execute on function public.submit_sales_invoice(uuid) to authenticated;