-- 0534_feature_enforcement.sql — S2: SERVER-ENFORCE plan switches on writes, RPCs and job enqueues.
--
-- While a key resolves off for an org (global → override → plan, 0532/0533), a client write to that
-- module's tables, a client RPC that writes them, or a new outbox command for it refuses with the typed
-- `feature_off` error (P0001). Reads are NEVER gated (0081's SELECT invariant; OQ-5): a disabled
-- module's rows stay readable and turn fully editable again when the switch comes back on (FR-PLN-007).
--
-- Precedence is ENTITLEMENT (resolve_feature_internal → enabled), never the revenue display rule
-- (FR-PLN-005a): an ERP-owned org whose revenue screens are hidden by the display rule still passes the
-- revenue write gate, so ERP invoice sync keeps working.
--
-- Two mechanisms, matching how each path runs:
--   §B  RLS conjunct on every WRITE policy of every newly gated table — client writes (and INVOKER
--       RPCs, which run as the caller and are therefore RLS-subject) are refused by policy.
--   §C  an explicit assert_feature_on() at the top of every SECURITY DEFINER RPC that writes a gated
--       table (a definer body bypasses RLS), and at the two outbox enqueue definers (§D), so a
--       feature-off org never mints a new ERP command.
-- Service-role maintenance paths are deliberately untouched: claim_outbox_for_commit/confirm_outbox/
-- quarantine_committing/release_outbox_hold, the timesheet push finalize/witness paths, core expense
-- postings, hygiene ticks and disconnect/unlink paths must still reach a terminal state (or a clean
-- teardown) for work that was minted while the module was on. assert_feature_on() is revoked from every
-- client role and from service_role, and §B gates client policies only (service_role bypasses RLS), so
-- those paths are unchanged.
--
-- No table, grant or policy is created for service_role; 0137's service-grant inventory and 0178's
-- anon-executable allow-list are unchanged (no definer here is anon-executable).
--
-- Scope notes (deliberate, recorded for review):
--   • Goods receipts stay gated on `procurement`; the `procurement_full` re-boundary is DEFERRED
--     (Director ruling: owner sign-off #1720 + a live-org check come first). The receipts policies are
--     therefore skipped by §B's idempotence guard and keep 0081's gate untouched.
--   • Reads stay ungated (OQ-5): the import lookup/normalise helpers and the published-statement /
--     purchase / pipeline readers gain no gate.
--   • `imprest_lock_float` (an advisory-lock helper with no org argument) gains no gate; every imprest
--     writer that calls it is gated above it.
--   • `m365_record_folder_sweep_save` is SECURITY INVOKER and is called by the sweep with the service
--     key, which cannot execute the definer-only gate; the sweep that produces its summary is held at
--     pass start instead (erpnext-sweep featureEnforcement.test.ts).
--   • Outbox/job enforcement lives with the job: erpnext-sweep's outbox pass holds a switched-off
--     domain and the doctype walk, timesheet and imprest passes skip; `imprest-cash-account` returns
--     the typed 409 `feature_off` before any ERP call. The remaining edge preconditions (m365 custody,
--     compose-view, agent-chat, clickup, external-connect) are follow-ups in their own slices — the
--     assistant surfaces are S4's, and the teardown-safe set needs per-route care.
--   • CLOSURE IS NEVER GATED (FR-PLN-006): cancelling/rejecting/PAYING an existing row, and cancelling a
--     draft stock document, stay callable while the module is off, so work minted while it was on can
--     always reach a terminal state. Only the forward/minting transitions are gated. The same rule is
--     applied in the sweep: a candidate ERP already accepted still finalizes while its module is off.
-- Reversible: supabase/migrations/rollback/0534_feature_enforcement_down.sql.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — the raising gate and the service twin.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- assert_feature_on: the RPC-side twin of the non-raising RLS hook org_feature_enabled (0532). It reads
-- the SAME resolver, keyed on ENTITLEMENT (enabled), and raises the typed refusal. Not granted to any
-- role: only the security-definer bodies below call it, so it can never be used to probe an org.
create or replace function public.assert_feature_on(p_org_id uuid, p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled boolean;
begin
  if p_org_id is null then
    raise exception 'feature_off' using errcode = 'P0001', detail = 'org-unresolved';
  end if;
  select r.enabled into v_enabled from public.resolve_feature_internal(p_org_id, p_key) r;
  if not coalesce(v_enabled, false) then
    raise exception 'feature_off' using errcode = 'P0001', detail = p_key;
  end if;
end $$;
revoke all on function public.assert_feature_on(uuid, text) from public, anon, authenticated, service_role;

-- service_feature_enabled: the non-raising service-only twin used by sweep passes and edge
-- preconditions (the plan's §Jobs and edges). Same auth.role() guard as service_resolved_org_features
-- (0533), fail-closed on an unknown org, and it never raises for a missing entitlement.
create or replace function public.service_feature_enabled(p_org_id uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_only' using errcode = '42501';
  end if;
  if p_org_id is null or not exists (select 1 from public.organizations o where o.id = p_org_id) then
    return false;
  end if;
  select r.enabled into v_enabled from public.resolve_feature_internal(p_org_id, p_key) r;
  return coalesce(v_enabled, false);
end $$;
revoke all on function public.service_feature_enabled(uuid, text) from public, anon, authenticated;
grant execute on function public.service_feature_enabled(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — RLS conjuncts on the newly gated tables (mirrors 0081's proven DO block).
-- Reads LIVE pg_policies so the 0063 is_active_member append survives; paren-wraps the existing
-- predicate before AND-ing (an un-wrapped `A or B` + ` and F` would gate only the B branch); preserves
-- permissive/restrictive + command; WRITE policies only, so every table's dedicated SELECT policy keeps
-- reads open. A policy that already carries org_feature_enabled (0081's five module families, which
-- include procurement_receipts/procurement_receipt_files) is skipped — that is why the receipts stay
-- gated on `procurement` exactly as today (Director ruling: the procurement_full re-boundary is
-- deferred until owner sign-off #1720). Tables absent from this schema simply contribute no row.
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
    select p.tablename, p.policyname, p.permissive, p.cmd, p.qual, p.with_check, m.feature_key
      from pg_policies p
      join (values
        ('incoming_payments','revenue'),
        ('sales_invoices','sales_invoices'), ('sales_invoice_authors','sales_invoices'),
        ('sales_invoice_submit_authorizations','sales_invoices'),
        ('progress_claims','sales_invoices'), ('progress_claim_lines','sales_invoices'),
        ('progress_claim_evidence','sales_invoices'), ('progress_assessment_quantities','sales_invoices'),
        ('boq_items','sales_invoices'), ('contract_rate_lines','sales_invoices'),
        ('contract_rate_assignees','sales_invoices'), ('tm_claims','sales_invoices'),
        ('tm_claim_lines','sales_invoices'), ('tm_claim_sources','sales_invoices'),
        ('imprest_plans','imprest'), ('imprest_plan_lines','imprest'), ('imprest_floats','imprest'),
        ('imprest_float_changes','imprest'), ('imprest_replenishments','imprest'),
        ('imprest_cash_counts','imprest'), ('imprest_posting_erp_mirror','imprest'),
        ('org_imprest_settings','imprest'),
        ('stock_items','stock'), ('stock_units','stock'), ('stock_warehouses','stock'),
        ('stock_keepers','stock'), ('stock_documents','stock'), ('stock_document_lines','stock'),
        ('stock_ledger','stock'), ('stock_balances','stock'), ('stock_reorder_levels','stock'),
        ('budget_projections','budget_projection'),
        ('project_progress_entries','management_pack'),
        ('fx_rates','multi_currency'),
        ('procurement_create_intents','procurement'), ('procurement_import_runs','procurement'),
        ('procurement_erp_links','procurement'), ('vendor_withholding_slips','procurement'),
        ('vendor_withholding_bills','procurement'), ('purchase_order_lines','procurement'),
        ('purchase_order_revisions','procurement'), ('po_variations','procurement'),
        ('po_variation_lines','procurement'), ('subcontract_acceptances','procurement'),
        ('subcontract_acceptance_lines','procurement'), ('procurement_invoice_lines','procurement'),
        ('erp_purchase_documents','erp_purchases'), ('erp_purchase_document_marks','erp_purchases'),
        ('ms_graph_connections','m365_integration')
      ) as m(tablename, feature_key) on m.tablename = p.tablename::text
     where p.schemaname = 'public'
       and p.cmd in ('INSERT','UPDATE','DELETE','ALL')
       and coalesce(p.qual, '') not like '%org_feature_enabled%'
       and coalesce(p.with_check, '') not like '%org_feature_enabled%'
     order by p.tablename, p.policyname
  ) loop
    feat := r.feature_key;
    q  := case when r.qual is null then null
               else '(' || r.qual || ') and public.org_feature_enabled(public.auth_org_id(), ' || quote_literal(feat) || ')' end;
    wc := case when r.with_check is null then null
               else '(' || r.with_check || ') and public.org_feature_enabled(public.auth_org_id(), ' || quote_literal(feat) || ')' end;
    using_clause := case when q is null then '' else ' using (' || q || ')' end;
    check_clause := case when wc is null then '' else ' with check (' || wc || ')' end;

    execute 'drop policy if exists ' || quote_ident(r.policyname) || ' on public.' || quote_ident(r.tablename);
    execute 'create policy ' || quote_ident(r.policyname)
         || ' on public.' || quote_ident(r.tablename)
         || ' as ' || lower(r.permissive)
         || ' for ' || lower(r.cmd)
         || using_clause
         || check_clause;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — RPC gates. Each body is the latest shipped definition, verbatim, with ONE added statement
--     (marked by the assert_feature_on line) immediately after the function's own authorization gate.
--     CREATE OR REPLACE keeps each function's existing ownership and grants.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- create_native_sales_invoice → sales_invoices
create or replace function public.create_native_sales_invoice(
  p_project_id    uuid,
  p_customer_id   uuid,
  p_lines         jsonb,
  p_work_order_id uuid default null,
  p_billing_kind  text default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid      := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_uid         uuid      := auth.uid();
  v_valid       boolean;
  v_lines       jsonb;
  v_amount      numeric;
  v_p_org       uuid;
  v_currency    text;
  v_vat         boolean;
  v_rate        numeric;
  v_num         integer;
  v_den         integer;
  v_contract    text;
  v_wo_org      uuid;
  v_wo_currency text;
  v_wo_po       text;
  v_id          uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can raise a customer invoice' using errcode = '42501';
  end if;
  if p_billing_kind is not null and p_billing_kind not in ('contract','other') then
    raise exception 'billing kind must be contract or other' using errcode = '23514', detail = 'billing-kind-invalid';
  end if;
  -- Serialise with an ERP take-over of revenue (§7) BEFORE reading who owns it.
  perform 1 from public.organizations o where o.id = v_org for share;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'an invoice needs between 1 and 100 lines' using errcode = '23514', detail = 'invoice-lines-count';
  end if;
  -- CASE, not a bare cast: a non-number qty/rate becomes NULL (refused below), never a cast error or a coercion.
  with lines as (
    select x.ord,
           nullif(btrim(x.l ->> 'item_code'), '')   as item_code,
           nullif(btrim(x.l ->> 'description'), '') as description,
           case when jsonb_typeof(x.l -> 'qty')  = 'number' then (x.l ->> 'qty')::numeric  end as qty,
           case when jsonb_typeof(x.l -> 'rate') = 'number' then (x.l ->> 'rate')::numeric end as rate
      from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
  )
  select bool_and((item_code is not null or description is not null)
                  and coalesce(length(item_code), 0) <= 140 and coalesce(length(description), 0) <= 140
                  and coalesce(qty > 0 and qty < 'Infinity'::numeric and qty = round(qty, 3), false)
                  and coalesce(rate >= 0 and rate < 'Infinity'::numeric and rate = round(rate, 2), false)),
         jsonb_agg(jsonb_build_object('item_code', item_code, 'description', description, 'qty', qty, 'rate', rate,
                                      'amount', round(qty * rate, 2)) order by ord),
         sum(round(qty * rate, 2))
    into v_valid, v_lines, v_amount
    from lines;
  if not coalesce(v_valid, false) then
    raise exception 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals'
      using errcode = '23514', detail = 'invoice-line-invalid';
  end if;
  if not coalesce(v_amount > 0 and v_amount < 1000000000000, false) then
    raise exception 'the invoice total must be above zero' using errcode = '23514', detail = 'invoice-total-invalid';
  end if;

  -- DD-BWO-5: the work order's billing lock BEFORE the project row lock — the order every billing writer uses.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency, p.subject_to_vat, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
         p.customer_contract_ref
    into v_p_org, v_currency, v_vat, v_rate, v_num, v_den, v_contract
    from public.projects p where p.id = p_project_id for share;
  if not found or v_p_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_customer_id and c.org_id = v_org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_work_order_id is not null then
    select wo.org_id, wo.currency, wo.client_po_number into v_wo_org, v_wo_currency, v_wo_po
      from public.work_orders wo where wo.id = p_work_order_id;
    if not found or v_wo_org is distinct from v_org then
      raise exception 'work order not found' using errcode = 'P0002';
    end if;
    v_currency := v_wo_currency;
  end if;

  -- OD-TAX-4 / DD-NAR-7: the project says whether it is subject to VAT; its own rate and base apply.
  if v_vat then
    if v_rate is null or v_rate <= 0 then
      raise exception 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing'
        using errcode = 'P0001', detail = 'vat-rate-missing';
    end if;
  else
    v_rate := 0; v_num := 1; v_den := 1;
  end if;

  -- tax_amount 0 is a placeholder the 0227 trigger (sales_invoices_zz_apply_tax_base) replaces from tax_rate on insert.
  insert into public.sales_invoices
    (id, org_id, project_id, customer_id, work_order_id, reference_number, native_lines, amount, currency,
     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id,
     billing_kind)
  values
    (v_id, v_org, p_project_id, p_customer_id, p_work_order_id,
     coalesce(nullif(btrim(v_wo_po), ''), nullif(btrim(v_contract), '')),
     v_lines, v_amount, v_currency,
     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid,
     coalesce(p_billing_kind, 'contract'));

  -- 0132's SoD oracle: nobody in this set may approve the invoice (§4).
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values (v_org, v_id, v_uid);
  return v_id;
end; $$;

-- transition_native_sales_invoice → sales_invoices
create or replace function public.transition_native_sales_invoice(p_id uuid, p_to text)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_row    public.sales_invoices%rowtype;
  v_after  public.sales_invoices%rowtype;
  v_uid    uuid      := auth.uid();
  v_role   user_role := public.auth_role();
  v_today  date;
  v_number text;
  v_legal  jsonb := jsonb_build_object('Draft',  jsonb_build_array('Unpaid','Cancelled'),
                                       'Unpaid', jsonb_build_array('Cancelled'));
begin
  perform public.assert_is_active_member();
  -- FR-PLN-006 closure: cancelling an existing invoice is a CLOSING transition, so a switched-off module
  -- must still let the work it already minted reach a terminal state. Only the forward (approval) path is
  -- gated.
  if coalesce(p_to, '') is distinct from 'Cancelled' then
    perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  end if;
  select * into v_row from public.sales_invoices where id = p_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  -- SECURITY: the org re-assertion MUST stay — a SECURITY DEFINER body bypasses RLS.
  if v_row.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can approve or cancel a customer invoice' using errcode = '42501';
  end if;
  if public.domain_externally_owned(v_row.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  if not v_row.pmo_native
     and not (p_to = 'Cancelled' and v_row.status = 'Draft' and v_row.si_number is null and v_row.erp_docstatus is null) then
    raise exception 'this invoice belongs to the ERP: approve or cancel it there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  -- NULL-safe: `? NULL` is NULL and `not NULL` would fall through (0176 §6).
  if p_to is null or not coalesce((v_legal -> v_row.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_row.status, coalesce(p_to, '<NULL>')
      using errcode = 'P0001', detail = 'illegal-transition';
  end if;

  if p_to = 'Unpaid' then
    perform public.assert_sales_invoice_approver(p_id, v_row.author_user_id, v_uid);
    v_today  := public.native_org_today(v_row.org_id);
    v_number := public.native_revenue_doc_number(v_row.org_id, 'INV', v_today);
    update public.sales_invoices set
      status         = 'Unpaid',
      pmo_number     = v_number,
      invoice_date   = v_today,
      approved_by_id = v_uid,
      approved_at    = now()
    where id = p_id;
    -- Nothing is settled yet: the restated balance is the gross.
    v_after := public.native_invoice_restate(p_id);
  else
    if v_row.status = 'Unpaid' and public.native_invoice_settled(v_row.org_id, p_id) > 0 then
      raise exception 'cancel the receipts recorded against this invoice first'
        using errcode = 'P0001', detail = 'invoice-has-receipts';
    end if;
    update public.sales_invoices set
      status                 = 'Cancelled',
      erp_outstanding_amount = case when v_row.status = 'Unpaid' then 0 else erp_outstanding_amount end
    where id = p_id;
  end if;

  perform public.log_audit('sales_invoice.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status, 'to', p_to, 'pmo_number', coalesce(v_number, v_row.pmo_number),
                       'pmo_native', v_row.pmo_native,
                       'gross', public.native_invoice_gross(v_row.amount, v_row.tax_amount, v_row.tax_treatment)));
end; $$;

-- record_native_receipt → revenue
create or replace function public.record_native_receipt(
  p_sales_invoice_id        uuid,
  p_amount                  numeric default null,
  p_received_amount         numeric default null,
  p_withheld_amount         numeric default null,
  p_withholding_slip_number text    default null,
  p_date                    date    default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_si       public.sales_invoices%rowtype;
  v_role     user_role := public.auth_role();
  v_withheld numeric   := coalesce(p_withheld_amount, 0);
  v_amount   numeric;
  v_received numeric;
  v_today    date;
  v_id       uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'revenue');
  select * into v_si from public.sales_invoices where id = p_sales_invoice_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_si.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can record a customer receipt' using errcode = '42501';
  end if;
  if not v_si.pmo_native then
    raise exception 'receipts for an ERP invoice are recorded in the ERP' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if public.domain_externally_owned(v_si.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  if v_si.status is distinct from 'Unpaid' then
    raise exception 'a receipt can be recorded only against an approved invoice that is not fully paid'
      using errcode = 'P0001', detail = 'invoice-not-receivable';
  end if;

  -- DD-NAR-17: the payment date is stated by the caller, never later than today in the org's time zone and never
  -- before the invoice's own date.
  v_today := public.native_org_today(v_si.org_id);
  if p_date is null then
    raise exception 'a receipt needs its payment date' using errcode = '23502', detail = 'payment-date-missing';
  end if;
  if p_date > v_today then
    raise exception 'the payment date cannot be in the future' using errcode = '23514', detail = 'payment-date-future';
  end if;
  if p_date < v_si.invoice_date then
    raise exception 'the payment date cannot be before the invoice date' using errcode = '23514', detail = 'payment-date-before-invoice';
  end if;

  -- DD-NAR-17: no amount stated settles what is outstanding (the restated balance); a different amount (less or
  -- more) is recorded as given. Every figure is bounded below the numeric(14,2) ceiling, as create bounds its total.
  v_amount := coalesce(p_amount, (public.native_invoice_restate(p_sales_invoice_id)).erp_outstanding_amount);
  if not coalesce(v_amount > 0 and v_amount < 1000000000000 and v_amount = round(v_amount, 2), false) then
    raise exception 'the receipt amount must be a positive number with at most 2 decimals' using errcode = '23514', detail = 'receipt-amount-invalid';
  end if;
  if not coalesce(v_withheld >= 0 and v_withheld < 1000000000000 and v_withheld = round(v_withheld, 2), false) then
    raise exception 'the tax withheld must be zero or more with at most 2 decimals' using errcode = '23514', detail = 'withheld-amount-invalid';
  end if;
  v_received := coalesce(p_received_amount, v_amount - v_withheld);
  if not coalesce(v_received >= 0 and v_received = round(v_received, 2) and v_received + v_withheld = v_amount, false) then
    raise exception 'cash received plus tax withheld must equal the amount settled' using errcode = '23514', detail = 'receipt-split-mismatch';
  end if;
  if v_withheld > 0 and nullif(btrim(p_withholding_slip_number), '') is null then
    raise exception 'tax withheld needs its withholding-slip number' using errcode = '23514', detail = 'withholding-slip-missing';
  end if;

  insert into public.incoming_payments
    (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount,
     withholding_slip_number, currency, status, pmo_native, pmo_number)
  values
    (v_id, v_si.org_id, v_si.customer_id, p_sales_invoice_id, p_date, v_amount, v_received, v_withheld,
     nullif(btrim(p_withholding_slip_number), ''), v_si.currency, 'Paid', true,
     public.native_revenue_doc_number(v_si.org_id, 'RCV', v_today));

  perform public.native_invoice_restate(p_sales_invoice_id);
  return v_id;
end; $$;

-- cancel_native_receipt → revenue
create or replace function public.cancel_native_receipt(p_receipt_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_rc     public.incoming_payments%rowtype;
  v_after  public.sales_invoices%rowtype;
  v_uid    uuid      := auth.uid();
  v_role   user_role := public.auth_role();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  -- FR-PLN-006 closure: reversing a receipt recorded while the module was on is a CLOSING transition and is
  -- deliberately NOT gated, so a switch-off never strands a transaction that already exists.
  perform public.assert_is_active_member();
  select * into v_rc from public.incoming_payments where id = p_receipt_id;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if v_rc.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can cancel a customer receipt' using errcode = '42501';
  end if;
  if not v_rc.pmo_native then
    raise exception 'receipts recorded in the ERP are cancelled there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  -- Serialise with an ERP take-over of revenue (§7) BEFORE reading who owns it — the same org-row lock
  -- create_native_sales_invoice takes from before its own ownership read. The take-over either commits first
  -- (this cancel then refuses below) or waits for it. After the org row, the locks go invoice → receipt
  -- (record_native_receipt locks only the invoice), then the receipt is re-read.
  perform 1 from public.organizations o where o.id = v_rc.org_id for share;
  if public.domain_externally_owned(v_rc.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  -- Lock order invoice → receipt (record_native_receipt locks only the invoice), then re-read the receipt.
  perform 1 from public.sales_invoices where id = v_rc.sales_invoice_id for update;
  select * into v_rc from public.incoming_payments where id = p_receipt_id for update;
  if v_rc.cancelled_at is not null then
    raise exception 'this receipt is already cancelled' using errcode = 'P0001', detail = 'receipt-already-cancelled';
  end if;

  update public.incoming_payments set cancelled_at = now() where id = p_receipt_id;
  v_after := public.native_invoice_restate(v_rc.sales_invoice_id);

  perform public.log_audit('incoming_payment.cancel', v_rc.org_id, v_uid, p_receipt_id,
    jsonb_build_object('sales_invoice_id', v_rc.sales_invoice_id, 'amount', v_rc.amount, 'pmo_number', v_rc.pmo_number,
                       'outstanding_after', v_after.erp_outstanding_amount, 'overpaid_after', v_after.overpaid_amount));
end; $$;

-- submit_sales_invoice → sales_invoices
create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row      public.sales_invoices;
  v_uid      uuid := auth.uid();
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  -- (0124/0130 predicates preserved) org + still-an-active-member; the ROLE set is the revenue write
  -- set (finding 3, owner ruling 2026-07-20) rather than the four master-data money roles.
  -- SECURITY: this authorization runs BEFORE the switch read, so a row the caller may not touch is
  -- refused on authorization alone and can never reveal another organisation's plan state.
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform public.assert_feature_on(v_row.org_id, 'sales_invoices');

  -- 0275: a PMO invoice is approved in PMO (transition_native_sales_invoice), never submitted through the ERP path.
  if v_row.pmo_native then
    raise exception 'this invoice was raised in PMO: approve it in PMO' using errcode = 'P0001', detail = 'pmo-native';
  end if;

  -- (0127 §B + 0132 DEFECT 1, preserved) fail closed on an unknown author; nobody who ever wrote the body may approve.
  perform public.assert_sales_invoice_approver(p_si_id, v_row.author_user_id, v_uid);   -- 0275: the one SoD helper

  return v_row;
end; $$;

-- claim_sales_invoice_author → sales_invoices
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

  -- SECURITY: authorize BEFORE the switch read (a foreign row is refused on authorization alone and
  -- never reveals that organisation's plan state).
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform public.assert_feature_on(v_row.org_id, 'sales_invoices');

  -- 0275: a PMO invoice's body is fixed at creation; the ERP path never re-authors it.
  if v_row.pmo_native then
    raise exception 'this invoice was raised in PMO: its lines are fixed when it is raised' using errcode = 'P0001', detail = 'pmo-native';
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

-- set_sales_invoice_received_date → sales_invoices
create or replace function public.set_sales_invoice_received_date(p_si_id uuid, p_received_date date)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row public.sales_invoices;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  -- Org comes from the row; same revenue write set as submit/cancel (Admin + Finance); offboarded
  -- members refused (0130).
  -- SECURITY: authorization first, then the switch read — a foreign row never reveals its org's plan state.
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.assert_feature_on(v_row.org_id, 'sales_invoices');
  -- 0275: a PMO invoice is frozen while an ERP owns revenue (DD-NAR-11).
  -- Serialise with an ERP take-over of revenue (§7) BEFORE reading who owns it — the same org-row lock every
  -- PMO revenue writer takes from before its own ownership read, so a take-over either commits first (this
  -- writer then refuses: frozen) or waits for it.
  perform 1 from public.organizations o where o.id = v_row.org_id for share;
  if v_row.pmo_native and public.domain_externally_owned(v_row.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  if v_row.status = 'Cancelled' then
    raise exception 'cannot record a receipt date on a cancelled invoice' using errcode = '23514';
  end if;
  if p_received_date is not null and v_row.invoice_date is not null and p_received_date < v_row.invoice_date then
    raise exception 'the received date cannot be before the invoice date' using errcode = '23514';
  end if;
  update public.sales_invoices set received_date = p_received_date where id = p_si_id
    returning * into v_row;
  return v_row;
end; $$;

-- create_progress_claim → sales_invoices
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
  v_locked_count integer;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  -- ⚑ 0262 (OD-BILL-1, DD-BWO-5): the work order's billing lock BEFORE the project row lock — the order every billing
  --   writer uses, so a claim and a native invoice on one work order cannot deadlock.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or (p_work_order_id is not null and not exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or (p_work_order_id is null and exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))) then
      raise exception 'every line must be allocated to the selected work order, or have no allocation for a project-level claim'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    -- Hold every referenced rate stable through cap validation and line insertion.
    perform b.id
      from public.boq_items b
      join jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric) on x.boq_item_id = b.id
     order by b.id
     for share of b;
    get diagnostics v_locked_count = row_count;
    if v_locked_count <> jsonb_array_length(p_lines) then
      raise exception 'every progress claim line must lock a BoQ row' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4): a claim reserves its gross against its work order when it is created.
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
    if v_gross is distinct from (select coalesce(sum(l.amount),0) from public.progress_claim_lines l where l.claim_id=v_id) then
      raise exception 'the progress claim header must equal the sum of its priced lines' using errcode = '23514';
    end if;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;

-- record_progress_assessment → sales_invoices
create or replace function public.record_progress_assessment(
  p_project_id uuid, p_month date, p_quantities jsonb, p_note text default null)
  returns numeric language plpgsql volatile set search_path = public as $$
declare
  v_total numeric;
  v_done  numeric;
  v_pct   numeric;
  v_entry uuid;
begin

  -- 0534: SECURITY INVOKER, so the gate uses the client-callable RLS hook and raises the same typed refusal.
  if not public.org_feature_enabled(public.auth_org_id(), 'sales_invoices') then
    raise exception 'feature_off' using errcode = 'P0001', detail = 'sales_invoices';
  end if;
  if p_project_id is null or p_month is null or p_quantities is null
     or jsonb_typeof(p_quantities) <> 'array' or jsonb_array_length(p_quantities) = 0 then
    raise exception 'project, month and at least one quantity are required' using errcode = '23502';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
              where not coalesce(x.quantity_to_date >= 0 and x.quantity_to_date < 'Infinity'::numeric
                                 and x.quantity_to_date = round(x.quantity_to_date, 3), false)) then
    raise exception 'each quantity done to date must be 0 or more with at most 3 decimals' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               join public.boq_items b on b.id=x.boq_item_id and b.project_id=p_project_id
              where b.earning_basis='lump_sum' and x.quantity_to_date>1) then
    raise exception 'lump-sum assessment quantity cannot exceed one' using errcode='23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
              where b.id is null) then
    raise exception 'every line must be a bill of quantities line of this project' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric))
     <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)) then
    raise exception 'each bill of quantities line may appear once per assessment' using errcode = '23514';
  end if;
  select coalesce(sum(b.quantity * b.rate), 0) into v_total from public.boq_items b where b.project_id = p_project_id;
  if v_total <= 0 then
    raise exception 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead'
      using errcode = '23514';
  end if;
  select coalesce(sum(least(x.quantity_to_date, b.quantity) * b.rate), 0) into v_done
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
    join public.boq_items b on b.id = x.boq_item_id;
  v_pct := round(v_done / v_total * 100, 2);

  -- ⚑ 0252: the derived writer is the one path allowed to change a quantity-measured month's percent.
  perform set_config('pmo.derived_pct_write', 'on', true);
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, v_pct, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note
  returning id into v_entry;
  -- Clear the flag at once: it is transaction-local, so leaving it on would let a later direct UPDATE in the
  -- same transaction slip past the guard.
  perform set_config('pmo.derived_pct_write', '', true);

  delete from public.progress_assessment_quantities q
   where q.entry_id = v_entry
     and not exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
                      where x.boq_item_id = q.boq_item_id);
  insert into public.progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select v_entry, x.boq_item_id, x.quantity_to_date
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
  on conflict (entry_id, boq_item_id) do update set quantity_to_date = excluded.quantity_to_date;
  return v_pct;
end; $$;

-- assemble_tm_claim → sales_invoices
create or replace function public.assemble_tm_claim(
  p_project uuid, p_from date, p_to date, p_work_order uuid default null, p_exclude jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_currency text;
  v_wo_project uuid;
  v_exclude uuid[] := '{}';
  v_id uuid := gen_random_uuid();
  v_count integer;
  v_other uuid;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  if p_project is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'a project and a valid date range are required' using errcode = '22023';
  end if;
  if p_exclude is not null then
    begin
      if jsonb_typeof(p_exclude) <> 'array' then raise exception 'x'; end if;
      select coalesce(array_agg(x::uuid), '{}') into v_exclude from jsonb_array_elements_text(p_exclude) x;
    exception when others then
      raise exception 'exclude must be a list of source ids' using errcode = '22023';
    end;
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- SECURITY: the role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  if not public.may_record_project_progress(p_project) then
    raise exception 'not authorized to prepare a time-and-materials claim for this project' using errcode = '42501';
  end if;
  -- Lock order as create_progress_claim: the work order's billing lock, then the project row.
  if p_work_order is not null then
    perform public.lock_work_order_billing(p_work_order);
    select wo.project_id into v_wo_project from public.work_orders wo where wo.id = p_work_order and wo.org_id = v_org;
    if v_wo_project is distinct from p_project then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
  end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = v_org for update;
  -- Hold the Approved weeks while we read them: a concurrent reopen takes the row lock first, so the helper below
  -- either sees the week Draft (and offers nothing) or this claim is live before the reopen checks.
  perform 1 from public.timesheets t
   where t.org_id = v_org and t.status = 'Approved'
     and t.id in (select en.timesheet_id from public.timesheet_entries en
                   where en.org_id = v_org and en.project_id = p_project and en.entry_date between p_from and p_to)
   order by t.id for share;

  begin
    with src as materialized (
      select s.* from public.tm_assignable_sources(p_project, p_from, p_to) s
       where s.unrated_reason is null and s.source_id <> all (v_exclude)
    ), grp as (
      select s.line_key, s.rate_version, s.kind, s.label, s.unit, s.rate, sum(s.units) as units
        from src s group by 1, 2, 3, 4, 5, 6
    ), ins_claim as (
      insert into public.tm_claims (id, org_id, project_id, work_order_id, period_from, period_to, currency, gross_amount, prepared_by)
      select v_id, v_org, p_project, p_work_order, p_from, p_to, v_currency,
             (select sum(round(g.units * g.rate, 2)) from grp g), v_uid
       where exists (select 1 from src)
      returning id
    ), ins_lines as (
      insert into public.tm_claim_lines (org_id, claim_id, line_key, rate_version, kind, label, unit, units, rate, amount)
      select v_org, c.id, g.line_key, g.rate_version, g.kind, g.label, g.unit, g.units, g.rate, round(g.units * g.rate, 2)
        from grp g cross join ins_claim c
      returning id, claim_id, line_key, rate_version
    ), ins_sources as (
      insert into public.tm_claim_sources (org_id, claim_id, claim_line_id, source_kind, source_id, units)
      select v_org, l.claim_id, l.id, s.source_kind, s.source_id, s.units
        from src s join ins_lines l on l.line_key = s.line_key and l.rate_version = s.rate_version
      returning 1
    )
    select count(*) into v_count from ins_sources;
  exception when unique_violation then
    select s.claim_id into v_other
      from public.tm_claim_sources s join public.timesheet_entries en on en.id = s.source_id
     where s.is_live and s.source_kind = 'timesheet_entry' and en.project_id = p_project
       and en.entry_date between p_from and p_to
     limit 1;
    raise exception 'an hour is already in claim %', v_other using errcode = 'P0001';
  end;
  if v_count = 0 then
    raise exception 'no approved, rated hours left to claim in this period' using errcode = 'P0001';
  end if;
  perform public.log_audit('tm_claim.assemble', v_org, v_uid, v_id,
    jsonb_build_object('project_id', p_project, 'period_from', p_from, 'period_to', p_to,
                       'work_order_id', p_work_order, 'sources', v_count));
  return v_id;
end $$;

-- deselect_tm_source → sales_invoices
create or replace function public.deselect_tm_source(p_claim uuid, p_source uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_project uuid;
  v_wo uuid;
  v_status text;
  v_src public.tm_claim_sources;
  v_units numeric;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  select c.project_id, c.work_order_id into v_project, v_wo from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if not public.may_record_project_progress(v_project) then
    raise exception 'not authorized to change this claim' using errcode = '42501';
  end if;
  if v_wo is not null then perform public.lock_work_order_billing(v_wo); end if;
  perform 1 from public.projects p where p.id = v_project and p.org_id = v_org for update;
  select c.status into v_status from public.tm_claims c where c.id = p_claim for update;
  if v_status is distinct from 'Draft' then
    raise exception 'only a Draft claim can be changed (this one is %)', v_status using errcode = 'P0001';
  end if;
  select * into v_src from public.tm_claim_sources s where s.id = p_source and s.claim_id = p_claim for update;
  if not found then raise exception 'source not found in this claim' using errcode = 'P0002'; end if;
  delete from public.tm_claim_sources where id = v_src.id;
  select coalesce(sum(s.units), 0) into v_units from public.tm_claim_sources s where s.claim_line_id = v_src.claim_line_id;
  if v_units = 0 then
    delete from public.tm_claim_lines where id = v_src.claim_line_id;
  else
    update public.tm_claim_lines set units = v_units, amount = round(v_units * rate, 2) where id = v_src.claim_line_id;
  end if;
  update public.tm_claims set gross_amount = coalesce((select sum(l.amount) from public.tm_claim_lines l where l.claim_id = p_claim), 0)
   where id = p_claim;
  perform public.log_audit('tm_claim.deselect', v_org, v_uid, p_claim,
    jsonb_build_object('source_kind', v_src.source_kind, 'source_id', v_src.source_id, 'units', v_src.units));
end $$;

-- establish_imprest_float → imprest
create or replace function public.establish_imprest_float(p_project uuid, p_custodian uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_float uuid; v_cur text;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'only an Admin or Finance member establishes a site float' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_imprest_settings s where s.org_id = v_org) then
    raise exception 'set the org''s procurement limit before establishing a site float' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org and p.archived_at is null) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.imprest_custodian_eligible(v_org, p_project, p_custodian) then
    raise exception 'a custodian must be an active Finance member or the manager of this project' using errcode = '23514';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a float amount must be greater than zero' using errcode = 'P0001';
  end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  insert into public.imprest_floats (org_id, project_id, custodian_id, currency, created_by)
  values (v_org, p_project, p_custodian, v_cur, v_uid) returning id into v_float;
  insert into public.imprest_float_changes (org_id, float_id, proposed_amount, proposed_by)
  values (v_org, v_float, round(p_amount, 2), v_uid);
  perform public.log_audit('imprest_float.established', v_org, v_uid, v_float,
    jsonb_build_object('project_id', p_project, 'custodian_id', p_custodian, 'proposed_amount', round(p_amount, 2)));
  return v_float;
end; $$;

-- decide_imprest_float_change → imprest
create or replace function public.decide_imprest_float_change(p_change uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.imprest_float_changes%rowtype; v_uid uuid := auth.uid(); v_admin boolean := public.auth_role() = 'Admin';
        v_route record; v_f public.imprest_floats%rowtype;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  select * into v_c from public.imprest_float_changes where id = p_change for update;
  if not found or v_c.org_id is distinct from public.auth_org_id() then
    raise exception 'float change not found' using errcode = 'P0002';
  end if;
  perform public.imprest_lock_float(v_c.float_id);
  if v_c.status <> 'Proposed' then
    raise exception 'this float change is already %', lower(v_c.status) using errcode = 'P0001';
  end if;
  if v_uid = v_c.proposed_by then
    raise exception 'separation of duties: the proposer cannot decide their own float amount' using errcode = '42501';
  end if;
  select * into v_f from public.imprest_floats where id = v_c.float_id;
  if v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  -- DD-IMP-7.3: the person holding the cash never decides how much they hold, via the senior set or break-glass alike.
  if v_uid = v_f.custodian_id then
    raise exception 'separation of duties: a custodian cannot decide their own float amount' using errcode = '42501';
  end if;
  select * into v_route from public.imprest_senior_route(v_c.org_id, v_c.proposed_by);
  if not v_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    raise exception 'approval routing: a float amount needs the senior approver set%',
      case when v_route.route = 'admin' then ' (none eligible: an Admin)' else '' end using errcode = '42501';
  end if;
  if p_approve and v_c.proposed_amount < public.imprest_funded(v_c.float_id) then
    raise exception 'lowering a float below the cash already funded is a wind-down, not in scope' using errcode = 'P0001';
  end if;
  update public.imprest_float_changes
     set status = case when p_approve then 'Approved' else 'Rejected' end, decided_by = v_uid, decided_at = now(),
         notes = nullif(btrim(p_notes), '')
   where id = p_change;
  if p_approve then
    update public.imprest_floats set float_amount = v_c.proposed_amount where id = v_c.float_id;
  end if;
  perform public.log_audit('imprest_float_change.decided', v_c.org_id, v_uid, p_change,
    jsonb_build_object('float_id', v_c.float_id, 'approved', p_approve, 'amount', v_c.proposed_amount,
                       'route', v_route.route,
                       'break_glass', v_admin and not coalesce(v_uid = any (v_route.approver_ids), false)));
end; $$;

-- transition_imprest_plan → imprest
create or replace function public.transition_imprest_plan(p_id uuid, p_to text, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p      public.imprest_plans%rowtype;
  v_f      public.imprest_floats%rowtype;
  v_uid    uuid := auth.uid();
  v_admin  boolean := public.auth_role() = 'Admin';
  v_tz     text;
  v_today  date;
  v_lines  int;
  v_l      record;
  v_route  record;
  v_routes jsonb := '[]'::jsonb;
  v_glass  boolean := false;
  v_legal  jsonb := jsonb_build_object(
    'Draft', jsonb_build_array('Submitted','Cancelled'), 'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Rejected', jsonb_build_array('Draft','Cancelled'), 'Approved', jsonb_build_array(), 'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  -- FR-PLN-006 closure: rejecting or cancelling an EXISTING plan changes nothing forward — a switch-off
  -- must not strand a plan minted while the module was on. Every other transition is gated.
  if coalesce(p_to, '') not in ('Rejected','Cancelled') then
    perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  end if;
  select * into v_p from public.imprest_plans where id = p_id for update;
  if not found or v_p.org_id is distinct from public.auth_org_id() then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if not (v_legal -> v_p.status) ? p_to then
    raise exception 'illegal transition % -> %', v_p.status, p_to using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_p.float_id;
  if v_f.archived_at is not null and p_to <> 'Cancelled' then  -- an archived float's plans may still be cancelled
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  -- Lock order (plan delta 5): every spend-line lock BEFORE the float lock, never after — transition_expense_claim
  -- takes spend-line then float, so the reverse here could deadlock. Category order keeps plan approvals consistent.
  if p_to in ('Approved','Rejected') then
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_f.project_id::text || ':' || l.budget_category::text, 0))
       from public.imprest_plan_lines l where l.plan_id = p_id order by l.budget_category;
  end if;
  perform public.imprest_lock_float(v_p.float_id);
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_p.org_id), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  if p_to in ('Approved','Rejected') then
    if v_uid = v_p.author_id then
      raise exception 'separation of duties: the author cannot decide their own plan' using errcode = '42501';
    end if;
    if v_uid = v_f.custodian_id then
      raise exception 'separation of duties: a custodian cannot decide a plan for their own float' using errcode = '42501';
    end if;
  end if;

  if p_to = 'Submitted' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can submit this plan' using errcode = '42501';
    end if;
    select count(*) into v_lines from public.imprest_plan_lines where plan_id = p_id;
    if v_lines = 0 then
      raise exception 'a plan needs at least one line before it can be submitted' using errcode = 'P0001';
    end if;
    if v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    if exists (select 1 from public.imprest_plans o where o.float_id = v_p.float_id and o.month = v_p.month
                 and o.id <> p_id and o.status in ('Submitted','Approved')) then
      raise exception 'this float already has a plan for that month' using errcode = 'P0001';
    end if;
  elsif p_to = 'Draft' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can reopen this plan' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not (v_uid = v_p.author_id or v_admin or public.auth_role() = 'Finance') then
      raise exception 'not authorized to cancel this plan' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    if p_to = 'Approved' and (v_p.month + interval '1 month')::date <= v_today then
      raise exception 'the plan''s month has ended; it can no longer be approved' using errcode = 'P0001';
    end if;
    if p_to = 'Approved' and v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    for v_l in select l.budget_category, l.planned_amount from public.imprest_plan_lines l where l.plan_id = p_id
               order by l.budget_category loop
      select * into v_route from public.spend_approval_route(v_p.org_id, v_f.project_id, v_l.budget_category,
        v_l.planned_amount, v_f.currency, v_p.author_id, v_uid, v_p.submitted_at);
      if coalesce(v_route.route, 'senior') = 'flat' then
        if not (v_admin or public.holds_spend_approval_authority(public.auth_role())) then
          raise exception 'not authorized to decide this plan' using errcode = '42501';
        end if;
      elsif not coalesce(v_uid = any (v_route.approver_ids), false) then
        if not v_admin then
          raise exception 'approval routing: the % line needs %', v_l.budget_category,
            case v_route.route when 'admin' then 'an Admin' else 'a named approver' end using errcode = '42501';
        end if;
        v_glass := true;
      end if;
      v_routes := v_routes || jsonb_build_object('budget_category', v_l.budget_category::text, 'amount', v_l.planned_amount,
                                                 'route', v_route.route, 'reason', v_route.reason);
    end loop;
    perform public.log_audit('imprest_plan.approval_route', v_p.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to, 'lines', v_routes, 'break_glass', v_glass,
                         'late', p_to = 'Approved' and v_p.month <= v_today));
  end if;

  update public.imprest_plans set
    status         = p_to,
    number         = case when p_to = 'Submitted' then coalesce(number, public.next_procurement_doc_number(org_id, 'IMP')) else number end,
    submitted_at   = case when p_to = 'Submitted' then now() else submitted_at end,
    approved_by    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by end,
    approved_at    = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    decision_notes = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decision_notes end,
    is_late        = case when p_to = 'Approved' then v_p.month <= v_today else is_late end
  where id = p_id;
  perform public.log_audit('imprest_plan.transition', v_p.org_id, v_uid, p_id,
    jsonb_build_object('from', v_p.status, 'to', p_to, 'notes', p_notes));
end; $$;

-- set_imprest_procurement_limit → imprest
create or replace function public.set_imprest_procurement_limit(p_amount numeric) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_old numeric;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin sets the procurement limit' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'the procurement limit must be greater than zero' using errcode = 'P0001';
  end if;
  select procurement_limit into v_old from public.org_imprest_settings where org_id = v_org;
  insert into public.org_imprest_settings (org_id, procurement_limit, updated_by) values (v_org, round(p_amount, 2), v_uid)
  on conflict (org_id) do update set procurement_limit = excluded.procurement_limit, updated_by = excluded.updated_by,
                                     updated_at = now();
  perform public.log_audit('imprest_settings.procurement_limit', v_org, v_uid, v_org,
    jsonb_build_object('from', v_old, 'to', round(p_amount, 2)));
end; $$;

-- request_imprest_replenishment → imprest
create or replace function public.request_imprest_replenishment(p_float uuid, p_kind text default 'replenishment')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_id uuid; v_amount numeric; v_gap numeric;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() or v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if v_uid is distinct from v_f.custodian_id or not public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid) then
    raise exception 'only this site float''s custodian requests its cash' using errcode = '42501';
  end if;
  if p_kind not in ('replenishment','funding') then
    raise exception 'unknown request kind %', p_kind using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  if p_kind = 'funding' then
    if exists (select 1 from public.imprest_replenishments r where r.float_id = p_float and r.kind = 'funding'
                 and r.status in ('Requested','Approved')) then
      raise exception 'a funding request for this float is already open' using errcode = 'P0001';
    end if;
    v_gap := v_f.float_amount - (public.imprest_cash_book(p_float) + public.imprest_advances_out(p_float)
                                 + public.imprest_receipts_waiting(p_float));
    if not (v_gap > 0) then
      raise exception 'this float is fully funded' using errcode = 'P0001';
    end if;
    v_amount := v_gap;
  else
    select coalesce(sum(c.amount), 0) into v_amount from public.expense_claims c
     where c.imprest_float_id = p_float and c.kind = 'claim' and c.status = 'Paid' and c.imprest_replenishment_id is null;
    if not (v_amount > 0) then
      raise exception 'there are no settled receipts waiting to be replenished' using errcode = 'P0001';
    end if;
  end if;
  insert into public.imprest_replenishments (org_id, float_id, kind, number, amount, requested_by)
  values (v_f.org_id, p_float, p_kind, public.next_procurement_doc_number(v_f.org_id, 'REP'), v_amount, v_uid)
  returning id into v_id;
  if p_kind = 'replenishment' then
    update public.expense_claims set imprest_replenishment_id = v_id
     where imprest_float_id = p_float and kind = 'claim' and status = 'Paid' and imprest_replenishment_id is null;
  end if;
  perform public.log_audit('imprest_replenishment.requested', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'kind', p_kind, 'amount', v_amount));
  return v_id;
end; $$;

-- transition_imprest_replenishment → imprest
create or replace function public.transition_imprest_replenishment(p_id uuid, p_to text, p_notes text default null,
                                                                   p_payment_reference text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r   public.imprest_replenishments%rowtype;
  v_f   public.imprest_floats%rowtype;
  v_uid uuid := auth.uid();
  v_fin boolean := public.auth_role() in ('Finance','Admin');
  v_tz  text;
  v_legal jsonb := jsonb_build_object('Requested', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved', jsonb_build_array('Paid','Cancelled'), 'Paid', jsonb_build_array(), 'Rejected', jsonb_build_array(),
    'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  -- FR-PLN-006 closure: deciding or paying an EXISTING request is a CLOSING transition — a switch-off
  -- must not strand a request minted while the module was on. Only minting a new decision path forward
  -- (Approved) is gated.
  if coalesce(p_to, '') not in ('Rejected','Paid','Cancelled') then
    perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  end if;
  select * into v_r from public.imprest_replenishments where id = p_id for update;
  if not found or v_r.org_id is distinct from public.auth_org_id() then
    raise exception 'replenishment not found' using errcode = 'P0002';
  end if;
  if not (v_legal -> v_r.status) ? p_to then
    raise exception 'illegal transition % -> %', v_r.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_r.float_id;
  if v_f.archived_at is not null and p_to in ('Approved','Paid') then  -- an archived float's requests may still be closed
    raise exception 'this site float is archived: its requests can no longer be approved or paid' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(v_r.float_id);
  -- SoD (FR-IMP-052/053), for every caller including an Admin: site finance never tops up its own float.
  if p_to in ('Approved','Rejected','Paid') and (v_uid = v_f.custodian_id or v_uid = v_r.requested_by) then
    raise exception 'separation of duties: the custodian or requester cannot % this request', lower(p_to) using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_r.approved_by then
    raise exception 'separation of duties: the approver cannot also pay this request' using errcode = '42501';
  end if;
  if p_to in ('Approved','Rejected','Paid') and not v_fin then
    raise exception 'only Finance or an Admin decides or pays a replenishment' using errcode = '42501';
  end if;
  if p_to = 'Cancelled' and not (v_fin or (v_r.status = 'Requested' and v_uid = v_r.requested_by)) then
    raise exception 'not authorized to cancel this request' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_r.kind = 'funding'                                                -- FR-IMP-054 (plan delta 3)
     and public.imprest_cash_book(v_r.float_id) + public.imprest_advances_out(v_r.float_id)
         + public.imprest_receipts_waiting(v_r.float_id) + v_r.amount > v_f.float_amount then
    raise exception 'paying this funding would take the float above its fixed amount' using errcode = 'P0001';
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_r.org_id), 'UTC');
  update public.imprest_replenishments set
    status            = p_to,
    approved_by       = case when p_to = 'Approved' then v_uid else approved_by end,
    approved_at       = case when p_to = 'Approved' then now() else approved_at end,
    decided_notes     = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decided_notes end,
    paid_by           = case when p_to = 'Paid' then v_uid else paid_by end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then (now() at time zone v_tz)::date else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;
  if p_to in ('Rejected','Cancelled') then                                                 -- FR-IMP-051: release
    update public.expense_claims set imprest_replenishment_id = null where imprest_replenishment_id = p_id;
  end if;
  perform public.log_audit('imprest_replenishment.transition', v_r.org_id, v_uid, p_id,
    jsonb_build_object('from', v_r.status, 'to', p_to, 'kind', v_r.kind, 'amount', v_r.amount, 'notes', p_notes));
end; $$;

-- record_imprest_count → imprest
create or replace function public.record_imprest_count(p_float uuid, p_counted numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_book numeric; v_id uuid;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if not (public.auth_role() in ('Finance','Admin')
          or (v_uid = v_f.custodian_id and public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid))) then
    raise exception 'only the custodian, Finance or an Admin records a cash count' using errcode = '42501';
  end if;
  if p_counted is null or not (p_counted >= 0 and p_counted < 'Infinity'::numeric) then
    raise exception 'a counted amount must be zero or more' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  v_book := public.imprest_cash_book(p_float);
  if round(p_counted, 2) <> v_book and btrim(coalesce(p_note, '')) = '' then
    raise exception 'the count differs from the book by %: add a note', round(p_counted, 2) - v_book using errcode = 'P0001';
  end if;
  insert into public.imprest_cash_counts (org_id, float_id, counted_amount, book_amount, variance, note, counted_by)
  values (v_f.org_id, p_float, round(p_counted, 2), v_book, round(p_counted, 2) - v_book, nullif(btrim(p_note), ''), v_uid)
  returning id into v_id;
  perform public.log_audit('imprest_count.recorded', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'counted', round(p_counted, 2), 'book', v_book, 'variance', round(p_counted, 2) - v_book));
  return v_id;
end; $$;

-- create_stock_document → stock
create or replace function public.create_stock_document(p_header jsonb, p_lines jsonb, p_post boolean default false, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_kind text; v_wh uuid; v_occ date; v_doc public.stock_documents; v_id uuid; v_override boolean;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then                                                               -- D7: replay returns the original
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(p_post, false) then perform public.stock_assert_standalone(v_org); end if;                -- D6, before any write
  v_kind := p_header->>'kind';
  perform public.stock_validate_payload(v_org, v_kind, p_header, p_lines);
  v_wh := (p_header->>'warehouse_id')::uuid;
  v_override := public.stock_assert_keeper(v_org, v_wh, v_uid);                                         -- PQ-1: authors are keepers (or Admin)
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note,
                                      occurred_on, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix(v_kind)), v_kind, v_wh,
          nullif(p_header->>'to_warehouse_id', '')::uuid, case when v_kind = 'issue' then nullif(p_header->>'project_id', '')::uuid end,
          nullif(p_header->>'procurement_id', '')::uuid, nullif(btrim(p_header->>'reason'), ''), nullif(btrim(p_header->>'note'), ''),
          v_occ, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning * into v_doc;
  if v_doc.id is null then                                                                               -- lost a race to a concurrent replay
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.stock_insert_lines(v_doc, p_lines);
  perform public.stock_apply(v_doc, false);                                                              -- static validation per kind
  if coalesce(p_post, false) then perform public.stock_post_core(v_doc.id);                              -- a post audits its own override
  elsif v_override then
    perform public.log_audit('stock.admin_author', v_org, v_uid, v_doc.id, jsonb_build_object('kind', v_kind, 'warehouse_id', v_wh, 'number', v_doc.number));
  end if;
  return v_doc.id;
end $$;

-- save_stock_draft → stock
create or replace function public.save_stock_draft(p_document_id uuid, p_header jsonb, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); d public.stock_documents; v_occ date; v_old jsonb;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = v_org for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: only a draft can be edited' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid then raise exception 'only the author edits a draft' using errcode = '42501'; end if;
  if coalesce(p_header->>'kind', d.kind) <> d.kind then raise exception 'STK_INVALID: a document''s kind cannot change' using errcode = 'P0001'; end if;
  perform public.stock_validate_payload(v_org, d.kind, p_header, p_lines);
  if public.stock_assert_keeper(v_org, (p_header->>'warehouse_id')::uuid, v_uid) then
    perform public.log_audit('stock.admin_author', v_org, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', p_header->>'warehouse_id', 'number', d.number));
  end if;
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, d.occurred_on);
  perform public.stock_assert_dates(v_org, v_occ);
  update public.stock_documents set warehouse_id = (p_header->>'warehouse_id')::uuid, to_warehouse_id = nullif(p_header->>'to_warehouse_id', '')::uuid,
         project_id = case when d.kind = 'issue' then nullif(p_header->>'project_id', '')::uuid else d.project_id end, procurement_id = nullif(p_header->>'procurement_id', '')::uuid,
         reason = nullif(btrim(p_header->>'reason'), ''), note = nullif(btrim(p_header->>'note'), ''), occurred_on = v_occ,
         revision = d.revision + 1                                                                                   -- mut:revision
   where id = d.id returning * into d;
  select coalesce(jsonb_agg(o), '[]'::jsonb) into v_old from (
    select distinct on (l.item_id, l.direction) l.item_id, l.direction, l.unit_cost from public.stock_document_lines l
     where l.document_id = d.id and l.unit_cost is not null order by l.item_id, l.direction, l.line_no) o;
  delete from public.stock_document_lines where document_id = d.id;
  perform public.stock_insert_lines(d, p_lines);
  if d.kind in ('adjustment','count') then
    update public.stock_document_lines n set unit_cost = (o->>'unit_cost')::numeric                                 -- mut:keepcost
      from jsonb_array_elements(v_old) o
     where n.document_id = d.id and n.unit_cost is null and n.item_id = (o->>'item_id')::uuid
       and n.direction is not distinct from (o->>'direction') and (d.kind = 'count' or n.direction = 'in');
  end if;
  perform public.stock_apply(d, false);
end $$;

-- post_stock_document → stock
create or replace function public.post_stock_document(p_document_id uuid, p_expected_revision integer default null) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_fresh boolean;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;   -- lock order (1)
  if found and d.status = 'Draft' and d.kind in ('adjustment','count') then
    v_fresh := p_expected_revision is not distinct from d.revision;                                                -- mut:stale
    if not v_fresh then raise exception 'STK_STALE: this draft changed since you opened it; review it again' using errcode = 'P0001'; end if;
  end if;
  perform public.stock_post_core(p_document_id);                      -- refuses a missing or other-org document itself
  return p_document_id;
end $$;

-- cancel_stock_document → stock
create or replace function public.cancel_stock_document(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  -- FR-PLN-006 closure: cancelling a DRAFT document writes nothing to the ledger; a switch-off must not
  -- strand a draft minted while the module was on.
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be cancelled' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid and not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'only the author or an Admin cancels a draft' using errcode = '42501'; end if;
  update public.stock_documents set status = 'Cancelled', cancelled_by = v_uid, cancelled_at = now() where id = d.id;
end $$;

-- set_stock_reorder_level → stock
create or replace function public.set_stock_reorder_level(p_warehouse_id uuid, p_item_id uuid, p_level numeric, p_quantity numeric default null) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_ok boolean; v_before public.stock_reorder_levels;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  v_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false);                                    -- mut:reorder_rank (PQ-6)
  if not v_ok then raise exception 'only a Project Manager or above sets a reorder level' using errcode = '42501'; end if;
  if not exists (select 1 from public.stock_items i where i.id = p_item_id and i.org_id = v_org)   -- mut:set_item_org
     or not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then   -- mut:set_org
    raise exception 'STK_NOT_FOUND: item or warehouse is not in your organisation' using errcode = 'P0001'; end if;
  select * into v_before from public.stock_reorder_levels where item_id = p_item_id and warehouse_id = p_warehouse_id;
  if p_level is null then                                                                                 -- clearing
    delete from public.stock_reorder_levels where item_id = p_item_id and warehouse_id = p_warehouse_id;
  else
    if p_level < 0 or p_level >= 1e11 or p_level <> round(p_level, 3) then raise exception 'STK_INVALID: a reorder level is 0 or more, 3 decimals at most' using errcode = 'P0001'; end if;
    if p_quantity is not null and (p_quantity <= 0 or p_quantity >= 1e11 or p_quantity <> round(p_quantity, 3)) then
      raise exception 'STK_INVALID: an order quantity is more than 0, 3 decimals at most' using errcode = 'P0001'; end if;
    insert into public.stock_reorder_levels (org_id, item_id, warehouse_id, reorder_level, reorder_quantity, set_by, set_at)
      values (v_org, p_item_id, p_warehouse_id, p_level, p_quantity, v_uid, now())
      on conflict (item_id, warehouse_id) do update set reorder_level = excluded.reorder_level, reorder_quantity = excluded.reorder_quantity, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
  perform public.log_audit('stock.reorder_level.set', v_org, v_uid, p_item_id,
    jsonb_build_object('warehouse_id', p_warehouse_id,
      'before', case when v_before.item_id is null then null else jsonb_build_object('reorder_level', trim_scale(v_before.reorder_level), 'reorder_quantity', v_before.reorder_quantity) end,
      'after',  case when p_level is null then null else jsonb_build_object('reorder_level', trim_scale(p_level), 'reorder_quantity', p_quantity) end));
end $$;

-- set_stock_warehouse_keeper → stock
create or replace function public.set_stock_warehouse_keeper(p_warehouse_id uuid, p_user_id uuid, p_assigned boolean)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_admin boolean; v_n integer;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);   -- mut:admin_only
  if not v_admin then
    raise exception 'only an Admin assigns warehouse keepers' using errcode = '42501';
  end if;
  if p_warehouse_id is null or p_user_id is null or p_assigned is null then
    raise exception 'STK_INVALID: warehouse, user and assigned are required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0001';
  end if;
  if p_assigned then
    if exists (select 1 from public.stock_warehouses w where w.id = p_warehouse_id and w.archived_at is not null) then
      raise exception 'STK_ARCHIVED: the warehouse is archived' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = p_user_id and pr.org_id = v_org and pr.status = 'active') then
      raise exception 'STK_NOT_FOUND: the user is not an active member of your organisation' using errcode = 'P0001';
    end if;
    insert into public.stock_warehouse_keepers (org_id, warehouse_id, user_id, created_by)
      values (v_org, p_warehouse_id, p_user_id, auth.uid()) on conflict do nothing;
  else
    delete from public.stock_warehouse_keepers where warehouse_id = p_warehouse_id and user_id = p_user_id and org_id = v_org;
  end if;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.log_audit(case when p_assigned then 'stock.keeper.assign' else 'stock.keeper.remove' end,
      v_org, auth.uid(), p_warehouse_id, jsonb_build_object('user_id', p_user_id));
  end if;
end $$;

-- create_procurement_receipt → procurement
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
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
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
  if public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_procurement_id), false) then   -- ECA-4 (PD-ECA-9)
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

-- create_procurement_invoice → procurement
create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0,
  p_withheld_pph_type text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices; v_currency text;                                 -- 0373
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  select org_id, currency into v_org, v_currency from public.procurements where id = p_procurement_id;  -- 0373
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_procurement_id), false) then   -- ECA-4 (PD-ECA-9)
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  if coalesce(p_withheld_amount, 0) <> 0
     and (p_withheld_pph_type is null or btrim(p_withheld_pph_type) not in ('pph23', 'pph4_2')) then
    raise exception 'a vendor invoice that withholds tax must state the withholding type: pph23 or pph4_2'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref,
     withheld_amount, withheld_pph_type, currency)                                                       -- 0373
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''),
            coalesce(p_withheld_amount, 0),
            case when coalesce(p_withheld_amount, 0) <> 0 then btrim(p_withheld_pph_type) end,
            v_currency)                                                                                  -- 0373
    returning * into v_row;
  return v_row;
end; $$;

-- create_payment → procurement
create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
        v_bill_gross numeric;                                                                -- 0349
        v_currency text;                                                                     -- 0373
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  select org_id, currency into v_org, v_currency from public.procurements where id = p_procurement_id; -- 0373
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
  if public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_procurement_id, p_invoice_id), false) then   -- ECA-4 (PD-ECA-9)
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
  if p_amount is not null then                                                               -- 0349
    perform 1 from public.procurements where id = p_procurement_id for update;               -- 0349
    select sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end) -- 0349
      into v_bill_gross from public.procurement_invoices i                                   -- 0349
     where i.procurement_id = p_procurement_id and i.amount is not null                      -- 0349
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;                 -- 0349
    if v_bill_gross is not null and p_amount + coalesce((                                    -- 0349
         select sum(pay.amount) from public.payments pay                                     -- 0349
          where pay.procurement_id = p_procurement_id                                        -- 0349
            and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null), 0)    -- 0349
         > v_bill_gross then                                                                 -- 0349
      raise exception 'scheduled payments cannot exceed the billed gross amount'             -- 0349
        using errcode = '23514';                                                             -- 0349
    end if;                                                                                  -- 0349
  end if;                                                                                    -- 0349
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, currency)                                      -- 0373
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, v_currency)                       -- 0373
    returning * into v_row;
  return v_row;
end; $$;

-- create_procurement_quotation → procurement
create or replace function public.create_procurement_quotation(
  p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_quotations language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_quotations;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
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

-- transition_procurement → procurement
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_is_active_member();
  -- FR-PLN-006 closure: cancelling or rejecting an EXISTING purchase is a CLOSING transition (paid closes
  -- an already-invoiced one); a switch-off must not strand it. Every forward/minting transition is gated.
  if p_to is null or p_to::text not in ('Cancelled','Rejected','Paid') then
    perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  end if;
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds is a no-op — its current step, or a lower step it
  -- has evidence for (e.g. Received, then a request for Ordered once an order is recorded).
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid')
     and (v_from = p_to
          or (public.procurement_step_rank(p_to) < public.procurement_step_rank(v_from)
              and (exists (select 1 from public.purchase_orders x where p_to = 'Ordered' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_receipts x where p_to = 'Received' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_invoices x where p_to = 'Vendor Invoiced' and x.procurement_id = p_id
                                and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
                   or exists (select 1 from public.procurement_erp_links l
                                join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                               where l.procurement_id = p_id and d.erp_docstatus = 1
                                 and d.erp_doctype = case p_to::text when 'Ordered' then 'Purchase Order'
                                                     when 'Received' then 'Purchase Receipt' else 'Purchase Invoice' end)))) then
    return;
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null and v_category is not null then
      perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
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
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;

-- transition_timesheet → timesheets
create or replace function public.transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from  timesheet_status;
  v_org   uuid;
  v_owner uuid;
  v_uid   uuid      := auth.uid();
  v_role  user_role := auth_role();
  v_mgr   uuid;
  v_tm_claim uuid;
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
  -- FR-PLN-006 closure: rejecting a SUBMITTED sheet is a CLOSING decision on work already minted, so a
  -- switch-off must not strand the approval queue. Every other transition is gated.
  if p_to is null or p_to::text is distinct from 'Rejected' then
    perform public.assert_feature_on(public.auth_org_id(), 'timesheets');
  end if;
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
    -- #1514 T2 (FR-TM-017): hours that feed a live time-and-materials claim stay approved until the claim is withdrawn.
    if exists (select 1 from public.timesheet_entries e
                where e.timesheet_id = p_timesheet_id and public.tm_source_is_live('timesheet_entry', e.id)) then
      select s.claim_id into v_tm_claim
        from public.timesheet_entries e
        join public.tm_claim_sources s on s.source_kind = 'timesheet_entry' and s.source_id = e.id and s.is_live
       where e.timesheet_id = p_timesheet_id limit 1;
      raise exception 'timesheet hours are in time-and-materials claim %', v_tm_claim using errcode = '55000';
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

-- m365_link_record_folder → m365_integration
create or replace function public.m365_link_record_folder(
  p_kind text, p_record_id uuid, p_reference jsonb,
  p_default_site_id text, p_default_drive_id text, p_settings_updated_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_existing uuid;
  v_id uuid;
  v_drive text;
  v_item text;
  v_url text;
  v_name text;
  v_shared boolean;
begin
  if not public.is_active_member() then raise insufficient_privilege; end if;
  if v_role not in ('Admin','Executive','Project Manager','Finance') then raise insufficient_privilege; end if;
  -- 0534: SECURITY INVOKER, so the gate uses the client-callable RLS hook and raises the same typed refusal.
  if not public.org_feature_enabled(v_org, 'm365_integration') then
    raise exception 'feature_off' using errcode = 'P0001', detail = 'm365_integration';
  end if;

  if p_kind not in ('project','procurement') or p_record_id is null
    or p_reference is null or jsonb_typeof(p_reference)<>'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_reference) key)
       is distinct from array['drive_id','item_id','item_kind','name','web_url']::text[]
    or p_reference->>'item_kind'<>'folder'
    or nullif(btrim(p_reference->>'drive_id'),'') is null
    or nullif(btrim(p_reference->>'item_id'),'') is null
    or nullif(btrim(p_reference->>'name'),'') is null
    or not public.m365_browser_url_valid(p_reference->>'web_url') then
    raise exception using errcode='22023', message='invalid folder reference';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('m365-record-folder:'||p_kind||':'||p_record_id::text,0));
  if p_kind='project' then
    if not exists(select 1 from public.projects p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
    select d.id into v_existing from public.project_documents d
     where d.project_id=p_record_id and d.org_id=v_org and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  else
    if not exists(select 1 from public.procurements p where p.id=p_record_id and p.org_id=v_org) then raise insufficient_privilege; end if;
    select d.id into v_existing from public.procurement_documents d
     where d.procurement_id=p_record_id and d.org_id=v_org and d.source='onedrive' and d.ms_item_kind='folder'
     order by d.ms_linked_at,d.id limit 1;
  end if;
  if v_existing is not null then return jsonb_build_object('document_id',v_existing,'state','already_linked'); end if;
  if not public.m365_record_folder_default_matches(p_default_site_id,p_default_drive_id,p_settings_updated_at) then
    raise exception using errcode='23514', message='m365 default changed', detail='m365-default-changed';
  end if;
  v_drive:=p_reference->>'drive_id'; v_item:=p_reference->>'item_id';
  v_url:=p_reference->>'web_url'; v_name:=p_reference->>'name';
  -- Serialise per folder (after the record lock, always in this order) so the check and the insert below cannot
  -- interleave with another record linking the same folder.
  perform pg_advisory_xact_lock(hashtextextended('m365-folder-item:'||v_org::text||':'||v_drive||':'||v_item,0));
  -- Two records of one kind must never silently share a folder: refuse and insert nothing.
  v_shared:=public.m365_folder_linked_elsewhere(p_kind,p_record_id,v_drive,v_item);
  if v_shared then return jsonb_build_object('state','needs_choice'); end if;
  if p_kind='project' then
    insert into public.project_documents(project_id,category,title,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
    values(p_record_id,'Reference',v_name,auth.uid(),'onedrive',v_drive,v_item,v_url,v_name,'folder') returning id into v_id;
  else
    insert into public.procurement_documents(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
    values(p_record_id,'Microsoft reference','Draft',v_url,'onedrive',v_drive,v_item,v_name,'folder') returning id into v_id;
  end if;
  return jsonb_build_object('document_id',v_id,'state','linked');
end $$;

-- link_m365_documents_batch → m365_integration
create or replace function public.link_m365_documents_batch(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_row jsonb;
  v_target_count integer;
  v_state text;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_lock text;  -- 0375
  v_new uuid[] := '{}';  -- 0375: ids inserted by this call (hidden from a dry run's results)
begin
  if not public.is_active_member() or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise insufficient_privilege;
  end if;
  perform public.assert_feature_on(v_org, 'm365_integration');

  if v_org is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>500 then
    raise exception using errcode='22023',message='p_rows must contain 1 to 500 rows';
  end if;
  -- Links must point at the org's own SharePoint host (0372: the shared rule). Asked once before any row is read, so an
  -- organisation with no library is refused m365_not_configured whatever the rows hold.
  perform public.sharepoint_url_on_org_host(v_org, null);
  -- 0375: serialise per folder with the same key as m365_link_record_folder (0338), every folder lock taken up front in
  -- one key order so the check below cannot interleave with another writer and two batches can never deadlock.
  for v_lock in
    select distinct ('m365-folder-item:'||v_org::text||':'||(r->>'drive_id')||':'||(r->>'item_id')) collate "C"
      from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r)='object' and r->>'kind'='folder' and (r ? 'project_id' or r ? 'procurement_id')
       and r->>'drive_id' is not null and r->>'item_id' is not null
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock,0));
  end loop;
  -- 0375: a dry run performs every real insert inside this block and then rolls the block back.
  begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_target_count := (case when v_row ? 'project_id' then 1 else 0 end)
      + (case when v_row ? 'budget_version_id' then 1 else 0 end)
      + (case when v_row ? 'procurement_id' then 1 else 0 end);
    if v_target_count<>1 or jsonb_typeof(v_row)<>'object'
      or v_row - array['project_id','budget_version_id','procurement_id','drive_id','item_id','web_url','name','kind']::text[] <> '{}'::jsonb
      or nullif(btrim(v_row->>'drive_id'),'') is null or nullif(btrim(v_row->>'item_id'),'') is null
      or nullif(btrim(v_row->>'name'),'') is null or coalesce(v_row->>'kind','') not in ('file','folder')  -- 0375: a missing kind is refused
      or not public.m365_browser_url_valid(v_row->>'web_url') then
      raise exception using errcode='22023',message=format('invalid document link row %s',v_n);
    end if;
    if not public.sharepoint_url_on_org_host(v_org, v_row->>'web_url') then
      raise exception using errcode='22023',message=format('web_url host is not the organisation SharePoint host (row %s)',v_n);
    end if;
    v_id := null;
    if v_row ? 'project_id' then
      if not exists(select 1 from public.projects where id=(v_row->>'project_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.project_documents where project_id=(v_row->>'project_id')::uuid
        and org_id=v_org and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        if v_row->>'kind'='folder' and public.m365_folder_linked_elsewhere('project',(v_row->>'project_id')::uuid,v_row->>'drive_id',v_row->>'item_id') then
          raise exception using errcode='23514',message='folder already linked to another project';
        end if;
        v_state:='linked';
        -- 0375: inserted on a dry run too, then rolled back with the block
        insert into public.project_documents(project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
        values((v_row->>'project_id')::uuid,'Reference',v_row->>'name','Draft',auth.uid(),'onedrive',v_row->>'drive_id',v_row->>'item_id',v_row->>'web_url',v_row->>'name',v_row->>'kind') returning id into v_id;
        v_new := v_new || v_id;  -- 0375
      end if;
    elsif v_row ? 'budget_version_id' then
      if not exists(select 1 from public.budget_versions b join public.projects p on p.id=b.project_id
        where b.id=(v_row->>'budget_version_id')::uuid and p.org_id=v_org and b.status='Draft') then raise insufficient_privilege; end if;
      select id into v_id from public.budget_version_document_links where budget_version_id=(v_row->>'budget_version_id')::uuid
        and org_id=v_org and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        v_state:='linked';
        -- 0375: inserted on a dry run too, then rolled back with the block
        insert into public.budget_version_document_links(budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
        values((v_row->>'budget_version_id')::uuid,v_row->>'drive_id',v_row->>'item_id',v_row->>'web_url',v_row->>'name',v_row->>'kind') returning id into v_id;
        v_new := v_new || v_id;  -- 0375
      end if;
    else
      if not exists(select 1 from public.procurements where id=(v_row->>'procurement_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.procurement_documents where procurement_id=(v_row->>'procurement_id')::uuid
        and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        if v_row->>'kind'='folder' and public.m365_folder_linked_elsewhere('procurement',(v_row->>'procurement_id')::uuid,v_row->>'drive_id',v_row->>'item_id') then
          raise exception using errcode='23514',message='folder already linked to another purchase';
        end if;
        v_state:='linked';
        -- 0375: inserted on a dry run too, then rolled back with the block
        insert into public.procurement_documents(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
        values((v_row->>'procurement_id')::uuid,'Microsoft reference','Draft',v_row->>'web_url','onedrive',v_row->>'drive_id',v_row->>'item_id',v_row->>'name',v_row->>'kind') returning id into v_id;
        v_new := v_new || v_id;  -- 0375
      end if;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('row',v_n,'state',v_state,
      'document_id',case when p_dry_run and v_id = any (v_new) then null else v_id end));  -- 0375
  end loop;
  if p_dry_run then
    raise exception using errcode='P0001',message='pmo_dry_run_complete';  -- 0375: rolls back this block's inserts
  end if;
  exception when sqlstate 'P0001' then  -- 0375
    if sqlerrm<>'pmo_dry_run_complete' then raise; end if;  -- 0375
  end;  -- 0375
  return jsonb_build_object('dry_run',p_dry_run,'results',v_results);
end;
$$;

-- record_project_progress → management_pack
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin

  -- 0534: SECURITY INVOKER, so the gate uses the client-callable RLS hook and raises the same typed refusal.
  if not public.org_feature_enabled(public.auth_org_id(), 'management_pack') then
    raise exception 'feature_off' using errcode = 'P0001', detail = 'management_pack';
  end if;
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  -- ⚑ 0250 (#766, DD-PBL-3): the one added refusal.
  if exists (select 1 from public.project_progress_entries e
               join public.progress_assessment_quantities q on q.entry_id = e.id
              where e.project_id = p_project_id and e.month = date_trunc('month', p_month)::date) then
    raise exception 'this month''s progress is measured by quantities — record the quantities done to date instead'
      using errcode = 'P0001';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;

-- import_budget_line_v2 → import_export
create or replace function public.import_budget_line_v2(
  p_version_id uuid, p_category public.budget_category, p_description text,
  p_budgeted_amount numeric, p_fiscal_year text, p_batch_id uuid, p_imported_at timestamptz,
  p_v2_key text, p_legacy_key text, p_has_reference boolean
) returns table(outcome text, line_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_project uuid; v_status public.budget_status; v_line uuid;
begin
  if p_version_id is null or p_category is null or p_budgeted_amount is null
     or p_budgeted_amount::text in ('NaN','Infinity','-Infinity')
     or abs(p_budgeted_amount) >= 1000000000000 or p_budgeted_amount <> trunc(p_budgeted_amount, 2)
     or p_batch_id is null or p_imported_at is null or p_has_reference is null
     or p_v2_key is null or p_v2_key = '' or p_legacy_key is null or p_legacy_key = '' then
    raise exception 'Invalid budget import arguments' using errcode = '22023';
  end if;
  if not coalesce(auth.uid() is not null and public.is_active_member()
      and public.auth_role()::text in ('Admin','Executive','Project Manager','Finance'), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'import_export');

  select v.org_id, v.project_id, v.status into v_org, v_project, v_status
    from public.budget_versions v join public.projects p on p.id = v.project_id and p.org_id = v.org_id
    where v.id = p_version_id and v.org_id = public.auth_org_id()
    for update of v;
  if not found then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_status <> 'Draft' then raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001'; end if;

  select li.id into v_line from public.budget_line_items li
    where li.budget_version_id = p_version_id and li.import_origin is null
      and (li.import_key collate "C" = p_v2_key collate "C"
        or (li.import_key collate "C" = p_legacy_key collate "C"
            and (not p_has_reference or left(p_legacy_key, 3) = 'fp:' or p_legacy_key collate "C" = p_v2_key collate "C")))
    order by li.id limit 1;
  if found then return query select 'conflict'::text, v_line; return; end if;
  select li.id into v_line from public.budget_line_items li
    where li.budget_version_id = p_version_id
      and ((li.import_origin = 2 and li.import_key collate "C" = p_v2_key collate "C")
        or (li.import_origin is null and p_has_reference and left(p_legacy_key, 3) <> 'fp:'
            and li.import_key collate "C" = p_legacy_key collate "C"))
    order by li.id limit 1;
  if found then return query select 'skipped'::text, v_line; return; end if;
  insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, fiscal_year,
      import_batch_id, imported_at, import_key, import_origin)
    values (v_org, p_version_id, p_category, p_description, p_budgeted_amount, p_fiscal_year,
      p_batch_id, p_imported_at, p_v2_key, 2) returning id into v_line;
  return query select 'created'::text, v_line;
end $$;

-- start_procurement_import_run → import_export
create or replace function public.start_procurement_import_run(p_org_id uuid default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid;
  v_id uuid;
begin
  -- SECURITY DEFINER: current_user inside this body is the owner, never the caller, so the bypass
  -- check resolves the CALLER's session role and hands it to the one shared trust-boundary
  -- predicate through its name-parameter entry point (0168 AC-UPS-053: exactly one copy of the
  -- catalog lookup, under the actor_bypasses_rls name). The no-arg form would always read postgres
  -- here and exempt every caller.
  if public.actor_bypasses_rls(coalesce(nullif(current_setting('role', true), 'none'), session_user)) then
    v_org := p_org_id;
  else
    perform public.assert_is_active_member();
    v_org := public.auth_org_id();
    if p_org_id is not null and p_org_id is distinct from v_org then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  if v_org is null then raise exception 'organization required' using errcode = '42501'; end if;
  perform public.assert_feature_on(v_org, 'import_export');

  loop
    v_id := gen_random_uuid();
    begin
      insert into public.procurement_import_runs(id, org_id, identity_version) values (v_id, v_org, 2);
      return v_id;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- import_project_stage_history → import_export
create or replace function public.import_project_stage_history(p_project_id uuid, p_entries jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_status project_status;
  v_count  int;
  v_n      int := jsonb_array_length(coalesce(p_entries, '[]'::jsonb));
  v_i      int := 0;
  v_idx    int;
  v_prev   int := 0;
  v_stage  project_status;
  v_on     date;
  v_lead   uuid;
  v_last   project_status;
  v_norm   jsonb := '[]'::jsonb;
  x        jsonb;
begin
  perform public.assert_is_active_member();                                     -- mut:amg_import (0173 AC-AMG-001)
  select org_id, status into v_org, v_status from public.projects where id = p_project_id for update;
  if v_org is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- SECURITY: authorization runs BEFORE the switch read — a foreign project is refused on authorization
  -- alone and can never reveal that organisation's plan state.
  perform public.assert_stage_date_editor(v_org);
  perform public.assert_feature_on(v_org, 'import_export');

  select count(*) into v_count from public.project_stage_entries where project_id = p_project_id;
  if v_status <> 'Leads' or v_count <> 1 then                         -- idempotent: only a fresh Leads row
    raise exception 'stage history can be imported only into a new lead' using errcode = 'P0001';
  end if;
  select id into v_lead from public.project_stage_entries where project_id = p_project_id;
  for x in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_idx := array_position(public.pipeline_project_statuses(), x ->> 'stage');
    if v_idx is null or v_idx <= v_prev then                           -- pre-award only, canonical order
      raise exception 'imported stage % is not a pre-award stage in journey order', x ->> 'stage' using errcode = 'P0001';
    end if;
    v_prev  := v_idx;
    v_stage := (x ->> 'stage')::project_status;
    v_on    := (x ->> 'entered_on')::date;
    if v_on is null or v_on > public.native_org_today(v_org) then
      raise exception 'a stage date cannot be in the future' using errcode = '23514';
    end if;
    if v_i = 1 then
      -- The lead: its own date when given, else no later than the first imported date (spec FR-PSH-020).
      update public.project_stage_entries
         set entered_on = case when v_stage = 'Leads' then v_on else least(entered_on, v_on) end,
             redated_at = case when entered_on is distinct from
                   case when v_stage = 'Leads' then v_on else least(entered_on, v_on) end
                 then now() else redated_at end
       where id = v_lead;
    end if;
    v_norm := v_norm || jsonb_build_object('stage', v_stage::text, 'entered_on', v_on);
    continue when v_stage = 'Leads';
    if v_i < v_n then
      insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
      select v_org, p_project_id, v_stage, v_on, max(position) + 1, 'import', auth.uid()
        from public.project_stage_entries where project_id = p_project_id;
    else
      -- Pre-award stages carry no SoD; the move is an editor's and goes on the audit trail below. The trigger
      -- appends the entry dated today; date it and mark it imported.
      update public.projects set status = v_stage, last_update = now() where id = p_project_id;
      update public.project_stage_entries set entered_on = v_on, source = 'import'
       where project_id = p_project_id
         and position = (select max(position) from public.project_stage_entries where project_id = p_project_id);
    end if;
    v_last := v_stage;
  end loop;
  if v_last is not null then
    perform public.log_audit('project.transition', v_org, auth.uid(), p_project_id,
      jsonb_build_object('from', 'Leads', 'to', v_last::text, 'source', 'import', 'entries', v_norm));
  elsif v_n > 0 then                                   -- lead-only: dates the lead, no move
    perform public.log_audit('project.stage_entry.import', v_org, auth.uid(), p_project_id,
      jsonb_build_object('entries', v_norm));
  end if;
end; $$;

-- insert_procurement_outbox_pending → procurement
create or replace function public.insert_procurement_outbox_pending(
  p_org uuid, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid, p_case uuid, p_snapshot jsonb
) returns public.external_command_outbox
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.external_command_outbox; v_mismatch boolean; v_input_digest text;
begin

  perform public.assert_feature_on(p_org, 'procurement');
  if p_tier is distinct from 'erpnext' or p_operation is distinct from 'create'
     or public.procurement_case_uuid(p_payload->>'procurementId') is distinct from p_case
     or not coalesce(p_payload->>'erp_doc_kind' in ('purchase-order', 'goods-receipt', 'purchase-invoice'), false)
     or jsonb_typeof(p_snapshot) is distinct from 'array' then
    raise exception 'invalid procurement snapshot' using errcode = '22023';
  end if;
  if p_payload->>'erp_doc_kind' = 'goods-receipt' then
    v_input_digest := p_payload->'pmo_gr_snapshot'->>'raw_digest';
    if v_input_digest is null or v_input_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid receipt witness' using errcode = '22023';
    end if;
  end if;
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, payload_digest, actor_user_id, procurement_input_digest)
  values (p_org, 'procurement', p_record_id, p_key, p_tier, p_operation, 'pending', p_payload, p_digest, p_actor, v_input_digest)
  returning * into v_row;
  perform 1 from public.procurements where id = p_case and org_id = p_org for update;
  if not found then raise exception 'procurement case not found' using errcode = '42501'; end if;
  with current_lines as (
    select name, description, quantity::numeric as quantity, rate::numeric as rate
      from public.procurement_items where org_id = p_org and procurement_id = p_case
  ), snapshot_lines as (
    select x.name, x.description, x.quantity, x.rate
      from jsonb_to_recordset(p_snapshot) as x(name text, description text, quantity numeric, rate numeric)
  )
  select exists (
    (select * from current_lines except all select * from snapshot_lines)
    union all
    (select * from snapshot_lines except all select * from current_lines)
  ) into v_mismatch;
  if v_mismatch then raise exception 'procurement line snapshot changed' using errcode = '40001'; end if;
  return v_row;
end $$;

-- insert_timesheet_outbox_pending → timesheets
create or replace function public.insert_timesheet_outbox_pending(
  p_org uuid, p_domain text, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
declare
  v_status      timesheet_status;
  v_approved_at timestamptz;
  v_witness     timestamptz;
  v_row    public.external_command_outbox;
  -- ⚑ ONE IDENTITY PER SHEET (Luna code review BLOCK 3). `p_record_id` arrives as TEXT from a caller
  -- that may spell the same uuid differently ('…FA' vs '…fa' — `approved_timesheet_for_push(uuid)` casts
  -- and passes either). Hashing/storing the RAW text made two spellings take DIFFERENT advisory locks
  -- and write DIFFERENT text-keyed `pmo_record_id`s, so the re-open's in-flight-push predicate could not
  -- see the push it was racing (and the one-in-flight partial index, also text-keyed, did not catch it):
  -- PMO goes Draft while ERP is handed the original hours ⇒ the corrected week double-counts. Round-trip
  -- through `uuid` FIRST, and use ONLY the canonical text below — the lock key, the status read, and the
  -- persisted row identity. A non-uuid id raises 22P02 here, before any lock or write.
  v_record_id text := (p_record_id::uuid)::text;
begin
  -- FENCE 2: serialize the push INSERT against a concurrent re-open (the SAME named lock the
  -- Approved→Draft arm holds, keyed on the SAME canonical uuid text) so the status re-check below
  -- observes the re-open's committed effect.
  perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || v_record_id, 0));
  perform public.assert_feature_on(p_org, 'timesheets');

  select status, approved_at into v_status, v_approved_at
    from public.timesheets where id = v_record_id::uuid;
  if v_status is distinct from 'Approved' then
    raise exception 'timesheet-no-longer-approved' using errcode = 'P0001';
  end if;
  -- ⚑ THE GENERATION FENCE (Luna round-2 BLOCK 1) — `Approved` alone is not enough. A command decided
  -- on generation T1 and inserted after T2's approval would post the SUPERSEDED hours alongside the
  -- corrected ones. This command's own witness (§A2, read from its deterministic key) must be the
  -- sheet's CURRENT `approved_at`. NULL ⇒ the command cannot prove which generation it belongs to ⇒
  -- refuse: fail closed, exactly as for a mismatch.
  v_witness := public.timesheet_push_key_witness(p_key);
  if v_witness is null or v_witness is distinct from v_approved_at then
    raise exception 'timesheet-approval-superseded' using errcode = 'P0001';
  end if;
  -- Same insert columns as the generic path (moneyOutboxDeps.ts:insertOutboxPending). state is
  -- 'pending' (the dispatch claims it next). org_id is the explicit, definer-trusted arg — never the
  -- client (the outbox is machine-written; the service-role edge fn supplies the verified org).
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state,
     payload, payload_digest, actor_user_id)
  values (p_org, p_domain, v_record_id, p_key, p_tier, p_operation, 'pending',
          p_payload, p_digest, p_actor)
  returning * into v_row;
  return v_row;
end; $$;

-- transition_project → sales_pipeline
create or replace function public.transition_project(
  p_id uuid, p_to project_status, p_customer_contract_ref text default null, p_contract_date date default null,
  p_lost_reason text default null, p_lost_note text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from project_status;
  v_org  uuid;
  v_role user_role := auth_role();
  v_reason text := nullif(btrim(p_lost_reason), '');  -- ⚑ 0461
  v_note   text := nullif(btrim(p_lost_note), '');    -- ⚑ 0461
  v_value  numeric;      -- 0176: read for the audit detail.
  v_set_by uuid;         -- ⚑ 0177: the contract_value witness — the SoD subject of the win branch.
  v_set_at timestamptz;  -- ⚑ 0177: NULL here = no witness was ever taken -> FAIL CLOSED.
  v_legal jsonb := jsonb_build_object(
    'Leads',               jsonb_build_array('PQ Submitted','Loss Tender','Internal Project','Declined'),
    'PQ Submitted',        jsonb_build_array('Quotation Submitted','Leads','Loss Tender','Declined'),
    'Quotation Submitted', jsonb_build_array('Tender Submitted','PQ Submitted','Won, Pending KoM','Loss Tender','Declined'),
    'Tender Submitted',    jsonb_build_array('Negotiation','Quotation Submitted','Won, Pending KoM','Loss Tender','Declined'),
    'Negotiation',         jsonb_build_array('Won, Pending KoM','Tender Submitted','Loss Tender','Declined'),
    'Won, Pending KoM',    jsonb_build_array('Ongoing Project','On Hold','Close Out'),
    'Ongoing Project',     jsonb_build_array('On Hold','Close Out'),
    'On Hold',             jsonb_build_array('Ongoing Project','Close Out'),
    'Close Out',           jsonb_build_array('Ongoing Project'),
    'Loss Tender',         jsonb_build_array('Negotiation'),
    'Declined',            jsonb_build_array('Negotiation'),
    'Internal Project',    jsonb_build_array()
  );
begin
  -- Load + lock the row (serializes concurrent transitions on the SAME project). P0002 if absent.
  -- ⚑ 0177: the witness is read under the SAME lock as the value it witnesses — a concurrent
  --   set_project_contract_value takes that lock too, so the pair can never be read torn.
  select status, org_id, contract_value, contract_value_set_by, contract_value_set_at
    into v_from, v_org, v_value, v_set_by, v_set_at
    from public.projects where id = p_id for update;
  if v_from is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-PR-004): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- 0534 (OQ-3): entering a pre-award pipeline stage is the sales_pipeline module's write.
  if p_to::text = any (public.pipeline_project_statuses()) then
    perform public.assert_feature_on(v_org, 'sales_pipeline');
  end if;

  -- ⚑ 0178 (§5). SECURITY: this active-membership conjunct MUST stay — see the twin comment in
  -- set_project_contract_value. Two DISABLED Project Managers satisfied the money SoD between them
  -- before this line existed (probed live at 0177).
  if not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Coarse role gate (FR-PR-004, OD-SP-1): no per-transition matrix (sales is not procurement).
  -- SECURITY: this coarse role gate MUST stay — removing it lets any authenticated user transition.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-PR-001/003): (from,to) must be in the data map and not a no-op, else P0001.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- ⚑ 0461 (#1577, FR-LR-002/003): a lost or declined deal must say why. The role, org, membership and legality
  -- checks above run first, so an unauthorized or illegal call still gets its own error.
  if p_to in ('Loss Tender','Declined') then
    if v_reason is null or not (v_reason = any (array['price','competitor','scope_fit','timing','capacity',
         'relationship','client_cancelled','no_decision','other'])) then
      raise exception 'a reason is required when a deal is lost or declined' using errcode = 'P0001';
    end if;
    if v_reason = 'other' and v_note is null then
      raise exception 'a note is required when the reason is other' using errcode = 'P0001';
    end if;
    if char_length(v_note) > 500 then
      raise exception 'the note is limited to 500 characters' using errcode = 'P0001';
    end if;
  end if;

  -- Branch on the target (OD-PR-C/D, FR-PR-005/006/007).
  if p_to = 'Won, Pending KoM'
     and v_from in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation') then

    -- ⚑ 0177 — THE MONEY SoD. SECURITY: this block MUST stay. Without it a Project Manager sets
    -- their own contract_value at origination, runs the legal pipeline alone, and lands a won deal
    -- at a value NOBODY ELSE EVER APPROVED — set_project_contract_value's Admin/Executive/Finance
    -- gate binds only once the project is already on-hand, so the value rides in underneath it.
    -- Every clause is TOTAL (never NULL) on purpose — `is distinct from` rather than `=`, and an
    -- explicit `v_set_at is null` branch — because a NULL-valued condition does not fire an `if`
    -- and that is the exact defect 0176 §6 had to repair in four other guards.
    -- ⚑ 0178 REPLACES 0177's RULE (ADR-0070). 0177 said "approver != author, any second person" and
    -- carved out an ENUMERATED {Admin, Executive, Finance} on a justification that was false (see the
    -- file header §6). The rule is now RANK + LINE MANAGEMENT, and it reads in three clauses:
    --
    --   (i)   there is money on the row                       -> otherwise nothing to ratify;
    --   (ii)  the WINNER does not themselves hold won-value authority (ADR-0019 §1, as rank) ->
    --         a Finance/Executive/Admin winner is already the accountable party and needs nobody;
    --   (iii) the value was NOT authored by someone who may approve THIS winner's work — i.e. not by
    --         the winner's line manager and not by anyone who outranks them.
    --
    -- The direction in (iii) is the subtle part and a first draft got it backwards: the question is
    -- NOT "may the winner approve the value's author?" but "did someone with authority OVER THE
    -- WINNER put their name on this number?" A PM whose line manager set the value is cleared; a PM
    -- whose PEER set it is NOT — which is the behaviour change ADR-0070 makes, and the reason a
    -- second signature can no longer be the colleague at the next desk.
    --
    -- Every clause is TOTAL: `coalesce(v_value,0)`, an explicit `v_set_at is null` branch, and three
    -- helpers that all coalesce to FALSE. A missing manager_id (5 of 11 seeded profiles) falls back
    -- to the rank test and can never wave a win through — 0176 §6's defect, not repeated.
    --
    -- ⚑ `v_set_by IS NULL with a non-NULL v_set_at` is deliberately NOT refused: that is the witness
    --   shape of a SERVER-SIDE authority (seed.sql / the historical importer / service_role, where
    --   auth.uid() is NULL). It is not a person, so it has no rank, and refusing it would block every
    --   seeded and imported deal. Pinned by 0170 AC-PMS-019. (The 0183 witness-active conjunct below
    --   is guarded by `v_set_by is not null`, so a NULL server-side witness still passes here.)
    --
    -- ⚑ 0181 — the win now ADDITIONALLY requires the value-setter to be a DISTINCT person from the
    --   winner: the conjunct "v_set_by is distinct from auth.uid()" is the PERMIT requirement (the
    --   setter must be someone other than the winner). This is a REFUSAL gate, so that permit
    --   conjunct appears here De Morgan-negated as a new OR branch:
    --       or (v_set_by is not distinct from auth.uid())
    --   which fires (refuses) ONLY when the winner set the value themselves — NULL-safe, so a
    --   server-side NULL setter (v_set_by is null) is still permitted (AC-PMS-019), and a legitimate
    --   senior setter (v_set_by != winner) is still permitted. This branch is INDEPENDENT of
    --   may_approve_work_of: even if a future bug ever made may_approve_work_of(X, X) TRUE again,
    --   a self-authored win is refused here, so the SoD is not reachable through the identity
    --   predicate at all. (§1 and §3 are defence in depth — §1 is the primary; §3 is the backstop.)
    --
    -- ⚑ 0183 — the win now ADDITIONALLY requires the value-setter to be a CURRENTLY ACTIVE member.
    --   may_approve_work_of answers "could this person approve the winner's work?" by rank + line
    --   management ALONE; it does NOT ask whether the person is employed today, so an OFFBOARDED
    --   manager (or any offboarded outranker) still satisfies it. The permit requirement is therefore
    --   "v_set_by is null OR is_active_member(v_set_by)" (NULL-safe for the server-side witness), and
    --   in this REFUSAL gate it appears De Morgan-negated as a new OR branch guarded by
    --   `v_set_by is not null` so the server-side NULL witness is unaffected (AC-PMS-019). This uses
    --   the uuid overload of is_active_member (0180) — the WHOLE rule (status + banned_until), run as
    --   the definer's owner since the overload is revoked from authenticated. Its refusal MESSAGE is
    --   its own (see the elsif below), distinguishable from "not set by anyone senior to you": the
    --   setter HAD authority but is no longer active, which is a different, more actionable diagnosis.
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                          -- no witness -> FAIL CLOSED
             or v_set_by is not distinct from auth.uid()                  -- ⚑ 0181: winner self-authored
             or (v_set_by is not null and not public.is_active_member(v_set_by))  -- ⚑ 0183: witness offboarded
             or (v_set_by is not null and not public.may_approve_work_of(v_set_by, auth.uid())) )
    then
      if v_set_at is null then
        raise exception
          'this deal''s contract value has no recorded author, so you cannot win it: the value must be set by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal'
          using errcode = '42501';
      elsif v_set_by is not null and not public.is_active_member(v_set_by) then
        -- ⚑ 0183 (FR-AMG-004): the witness exists and HAD authority over the winner, but is no
        -- longer an active member. Distinct from the "senior" branch below: that one says the setter
        -- never had authority; this one says they did but are gone. Ordered BEFORE the senior branch
        -- so the offboarded diagnosis wins when both would fire (an offboarded peer is offboarded
        -- first, not-senior second — the operator needs "get someone who is still here").
        raise exception
          'this deal''s contract value was set by someone who is no longer an active member of this organisation, so you cannot win it: the value must be re-set by your supervisor or by someone who outranks you who is currently active, through set_project_contract_value (which records who set it) — or ask them to win the deal'
          using errcode = '42501';
      else
        raise exception
          'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal'
          using errcode = '42501';
      end if;
    end if;

    -- Win-capture (OD-PR-C): fires only on FIRST reach of Won from a pipeline stage.
    if p_customer_contract_ref is null or btrim(p_customer_contract_ref) = '' or p_contract_date is null then
      raise exception 'customer contract ref and date are required to win' using errcode = 'P0001';
    end if;
    update public.projects set
      status                = p_to,
      customer_contract_ref = p_customer_contract_ref,
      contract_date         = p_contract_date,
      decided_at            = p_contract_date::timestamptz,
      last_update           = now()
    where id = p_id;
  elsif p_to in ('Loss Tender','Declined') then
    update public.projects set
      status      = p_to,
      decided_at  = now(),
      lost_reason = v_reason,  -- ⚑ 0461
      lost_note   = v_note,    -- ⚑ 0461
      last_update = now()
    where id = p_id;
  else
    update public.projects set
      status      = p_to,
      lost_reason = null,  -- ⚑ 0461 FR-LR-005: a revived deal is no longer lost
      lost_note   = null,  -- ⚑ 0461
      last_update = now()
    where id = p_id;
  end if;

  -- 0176: the transition is on the audit trail. ⚑ 0177 adds the witness to the detail — the audit
  -- row now answers "who set this value, and who turned it into revenue" in one read.
  perform public.log_audit('project.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',                  v_from::text,
                                              'to',                    p_to::text,
                                              'contract_value',        v_value,
                                              'contract_value_set_by', v_set_by,
                                              'contract_value_set_at', v_set_at,
                                              'customer_contract_ref', p_customer_contract_ref,
                                              'contract_date',         p_contract_date,
                                              'lost_reason', case when p_to in ('Loss Tender','Declined') then v_reason end,  -- ⚑ 0461
                                              'lost_note',   case when p_to in ('Loss Tender','Declined') then v_note end));  -- ⚑ 0461
end; $$;


notify pgrst, 'reload schema';
