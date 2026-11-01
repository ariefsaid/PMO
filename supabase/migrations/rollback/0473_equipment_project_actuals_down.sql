-- 0473_equipment_project_actuals_down.sql — reverse of 0473 (#1519 S4), reverse dependency order. Restores the bodies 0473
-- replaced, verbatim: api_client_request_guard (0397), get_project_finances (0410), project_mapped_actuals_all and
-- project_mapped_actuals (0376, the 9 / 8 column shapes); then drops the two charge helpers.
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project', 'import_budget_line_v2'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item'];
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  -- ACTIVE-ADMIN `pmo rpc` TIER (#1326) — keep in step with scripts/pmo.mjs ADMIN_RPCS.  -- 0366
  admin_cli_rpcs constant text[] := array['recategorise_budget_lines'];  -- 0366
  -- OPERATOR READ TIER (`pmo get/documents/m365`, #1270) — keep in step with scripts/pmo.mjs.  -- 0367
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps'];  -- 0367
  operator_read_rpcs constant text[] := array['project_mapped_actuals', 'link_m365_documents_batch'];  -- 0367
  -- BUDGET OPS TIER (`pmo budgets`, #1270 B): the activation check. Same role set as the RPC's own check. A Draft's source
  -- file goes through link_m365_documents_batch (0367 tier, host-pinned). activate_budget_version is deliberately NOT here
  -- (owner has not ruled).  -- 0370
  budget_ops_rpcs constant text[] := array['budget_activation_mode'];  -- 0370
  -- ACTIVE-ADMIN ACCOUNT-MAP TIER (`pmo accounts map set`, #1270 B) — the same Admin rule as the table's own policy.  -- 0370
  account_map_tables constant text[] := array['budget_category_account_map'];  -- 0370
  account_map_rpcs constant text[] := array['set_budget_push_account'];  -- 0370
  -- COST ATTRIBUTION TIER (`pmo attribution`, #1271): preview/save/end for active Admin/Finance; list for the
  -- project-actuals audience. Same role sets as the RPCs' own checks.  -- 0376
  cost_attribution_write_rpcs constant text[] := array['preview_cost_attribution', 'save_cost_attribution_rule', 'end_cost_attribution_rule'];  -- 0376
  cost_attribution_read_rpcs constant text[] := array['list_cost_attribution_rules'];  -- 0376
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (purchase_rpcs) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (operator_read_rpcs) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'POST' and target = any (budget_ops_rpcs) then  -- 0370
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (account_map_rpcs) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (cost_attribution_write_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (cost_attribution_read_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (admin_cli_rpcs) then  -- 0366
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0366
        return;  -- 0366
      end if;  -- 0366
    end if;  -- 0366
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method in ('GET', 'POST') and target = any (account_map_tables) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'GET' and target = any (operator_read_tables) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'GET' and target = any (purchase_read_views) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

CREATE OR REPLACE FUNCTION public.get_project_finances(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_result jsonb; v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  with invoice_rows as (
    select si.* from public.sales_invoices si
    where si.org_id = public.auth_org_id() and si.project_id = p_project_id
      and si.status in ('Submitted','Unpaid','Paid')
      and coalesce(si.erp_docstatus,1) <> 2 and si.erp_cancelled_at is null
  ), invoice_gross as (
    select i.*, case
      when i.amount is null or i.amount::text in ('NaN','Infinity','-Infinity') then null
      when i.tax_treatment = 'inclusive' then i.amount
      when i.tax_treatment = 'exclusive' and i.tax_amount is not null
        and i.tax_amount::text not in ('NaN','Infinity','-Infinity') then i.amount + i.tax_amount
      else null end as gross
    from invoice_rows i
  ), inv as (
    select currency,count(*)::int as invoice_count,
      count(*) filter(where gross is null)::int as missing_gross,
      count(*) filter(where amount is null or amount::text in ('NaN','Infinity','-Infinity'))::int as missing_amount,
      count(*) filter(where erp_outstanding_amount is null or erp_outstanding_amount::text in ('NaN','Infinity','-Infinity'))::int as missing_outstanding,
      sum(amount) as invoiced,sum(erp_outstanding_amount) as outstanding,
      sum(gross-erp_outstanding_amount) as settled,
      case when count(distinct tax_treatment) = 1 then min(tax_treatment) else 'mixed' end as tax_basis
    from invoice_gross group by currency
  ), work as (
    select w.currency,
      count(*) filter(where w.net is null or w.net::text in ('NaN','Infinity','-Infinity')
                     or w.recovery is null or w.recovery::text in ('NaN','Infinity','-Infinity'))::int as missing_work,
      sum(w.net+w.recovery) as revenue
    from public.sales_invoice_work_billed w join invoice_rows i on i.id = w.id and i.org_id = w.org_id
    where not w.is_down_payment group by w.currency
  ), chosen_budget as (
    select v.* from public.budget_versions v
    where v.org_id = public.auth_org_id() and v.project_id = p_project_id and v.status in ('Active','Draft')
    order by (v.status = 'Active') desc,v.version desc,v.created_at desc,v.id desc limit 1
  ), budget_sum as (
    select case when count(*) filter(where li.budgeted_amount is null
                    or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')) > 0 then null
                else coalesce(sum(li.budgeted_amount),0) end as amount
    from public.budget_line_items li join chosen_budget b on b.id = li.budget_version_id and b.org_id = li.org_id
  ), gl as (
    select * from public.project_mapped_actuals(p_project_id,null)
  ), contract_rows as (
    select i.id, i.si_number, i.pmo_number, i.invoice_date,
           case when i.currency <> p.currency or p.tax_treatment not in ('inclusive','exclusive')
                     or i.tax_treatment not in ('inclusive','exclusive') or i.amount is null or i.tax_amount is null
                     or i.amount::text in ('NaN','Infinity','-Infinity') or i.tax_amount::text in ('NaN','Infinity','-Infinity')
                then null
                when i.tax_treatment = p.tax_treatment then i.amount
                when p.tax_treatment = 'inclusive' then i.amount+i.tax_amount
                else i.amount-i.tax_amount end as amount
    from invoice_rows i cross join public.projects p
    -- #1471 FR-006: only Contract billing draws down the contract. `inv`, `work`, settlement, outstanding, cash and
    -- margin inputs keep reading invoice_rows (both kinds), which is what makes FR-007 hold by construction.
    where p.id = p_project_id and i.billing_kind = 'contract'
  ), contract_sum as (
    select case when count(*) filter(where amount is null) > 0 then null
                else coalesce(sum(amount),0) end as amount from contract_rows
  ), target_invoices as (
    select si.*
      from public.sales_invoices si
     where si.org_id = public.auth_org_id() and si.project_id = p_project_id
  ), candidate_receipt_ids as (
    -- UNION deduplicates the receipt before any allocation fan-out, regardless of which identity path matched.
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id and ti.id = ip.sales_invoice_id
     where ip.org_id = public.auth_org_id() and ip.pmo_native
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id and ti.id = ip.sales_invoice_id
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and (ip.allocation_details is null or jsonb_array_length(ip.allocation_details) > 0)
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id
       and ip.allocation_details @> jsonb_build_array(jsonb_build_object('invoice_id', ti.id::text))
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and ip.allocation_details is not null and jsonb_array_length(ip.allocation_details) > 0
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id
      join public.external_refs er on er.org_id = ti.org_id and er.domain = 'revenue'
       and er.pmo_record_id = ti.id::text
       and ip.allocation_details @> jsonb_build_array(jsonb_build_object('invoice_number', er.external_record_id))
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and ip.allocation_details is not null and jsonb_array_length(ip.allocation_details) > 0
  ), receipt_scope as (
    select ip.*
      from public.incoming_payments ip
      join candidate_receipt_ids cr on cr.id = ip.id
     where ip.org_id = public.auth_org_id()
  ), receipt_allocations as (
    select r.id as receipt_id, r.org_id as receipt_org_id, r.sales_invoice_id as receipt_invoice_id,
           r.currency as receipt_currency, a.ordinality::int as allocation_ordinal,
           ap.invoice_id_text, ap.invoice_number_text, ap.currency_text, ap.allocation_amount,
           coalesce(ap.shape_valid, false) as shape_valid,
           by_id.id as resolved_invoice_id, by_id.project_id as resolved_invoice_project_id,
           by_id.currency as resolved_invoice_currency, by_id.pmo_native as resolved_invoice_native,
           by_id.status as resolved_invoice_status, by_id.erp_docstatus as resolved_invoice_docstatus,
           by_id.erp_cancelled_at as resolved_invoice_cancelled_at,
           by_number.id as number_invoice_id, by_number.project_id as number_invoice_project_id,
           coalesce(by_id.id, by_number.id) as source_invoice_id,
           (by_id.id is not null and by_number.id is not null and by_id.id is distinct from by_number.id) as identity_conflict,
           (by_id.id is not null and
             case when r.pmo_native then
               by_id.pmo_native and by_id.status in ('Unpaid','Paid') and by_id.erp_docstatus is null
                 and by_id.erp_cancelled_at is null and by_id.project_id = p_project_id
             else
               not by_id.pmo_native and by_id.status in ('Submitted','Unpaid','Paid') and by_id.erp_docstatus = 1
                 and by_id.erp_cancelled_at is null
             end) as invoice_lifecycle_valid,
           (ap.currency_text is not null and ap.currency_text ~ '^[A-Z]{3}$'
             and ap.currency_text = r.currency and ap.currency_text = by_id.currency) as currency_valid
      from receipt_scope r
      left join lateral jsonb_array_elements(
        case when not r.pmo_native and jsonb_typeof(r.allocation_details) = 'array'
             then r.allocation_details else '[]'::jsonb end
      ) with ordinality as a(value, ordinality) on true
      cross join lateral (
        select a.value->>'invoice_id' as invoice_id_text,
               a.value->>'invoice_number' as invoice_number_text,
               a.value->>'currency' as currency_text,
               case when length(a.value->>'amount') <= 15
                          and a.value->>'amount' ~ '^[0-9]+[.][0-9]{2}$'
                    then (a.value->>'amount')::numeric end as allocation_amount,
               (jsonb_typeof(a.value) = 'object'
                 and a.value ? 'invoice_id' and jsonb_typeof(a.value->'invoice_id') in ('string','null')
                 and a.value ? 'invoice_number' and jsonb_typeof(a.value->'invoice_number') in ('string','null')
                 and a.value ? 'amount' and jsonb_typeof(a.value->'amount') in ('string','null')
                 and a.value ? 'currency' and jsonb_typeof(a.value->'currency') in ('string','null')) as shape_valid
      ) ap
      left join public.sales_invoices by_id
        on by_id.org_id = r.org_id
       and by_id.id = case when ap.invoice_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then ap.invoice_id_text::uuid end
      left join public.external_refs er
        on er.org_id = r.org_id and er.domain = 'revenue' and er.external_record_id = ap.invoice_number_text
      left join public.sales_invoices by_number
        on by_number.org_id = r.org_id and by_number.id::text = er.pmo_record_id
  ), receipt_allocation_totals as (
    select ra.receipt_id,
           count(ra.allocation_ordinal)::int as allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (not ra.shape_valid or ra.allocation_amount is null))::int as invalid_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (ra.resolved_invoice_id is null
               or (ra.number_invoice_project_id = p_project_id and ra.resolved_invoice_id is distinct from ra.number_invoice_id)))::int as unresolved_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (not coalesce(ra.currency_valid, false)))::int as currency_mismatch_count,
           count(*) filter (where ra.allocation_ordinal is not null and ra.resolved_invoice_id is not null
             and not coalesce(ra.invoice_lifecycle_valid, false))::int as invalid_invoice_lifecycle_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and ra.resolved_invoice_project_id = p_project_id)::int as target_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and ra.resolved_invoice_project_id is distinct from p_project_id)::int as non_target_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null and ra.identity_conflict)::int as identity_conflict_count,
           coalesce(sum(ra.allocation_amount) filter (where ra.allocation_ordinal is not null
             and ra.allocation_amount is not null), 0::numeric) as allocated_total,
           coalesce(sum(ra.allocation_amount) filter (where ra.allocation_ordinal is not null
             and ra.allocation_amount is not null and ra.resolved_invoice_project_id = p_project_id), 0::numeric) as target_allocated_total,
           coalesce(bool_or(ra.source_invoice_id = ra.receipt_invoice_id) filter (where ra.allocation_ordinal is not null), false) as fk_allocation_matches
      from receipt_allocations ra
     group by ra.receipt_id
  ), receipt_facts as (
    select r.*,
           coalesce(at.allocation_count, 0) as allocation_count,
           coalesce(at.invalid_allocation_count, 0) as invalid_allocation_count,
           coalesce(at.unresolved_allocation_count, 0) as unresolved_allocation_count,
           coalesce(at.currency_mismatch_count, 0) as currency_mismatch_count,
           coalesce(at.invalid_invoice_lifecycle_count, 0) as invalid_invoice_lifecycle_count,
           coalesce(at.target_allocation_count, 0) as target_allocation_count,
           coalesce(at.non_target_allocation_count, 0) as non_target_allocation_count,
           coalesce(at.identity_conflict_count, 0) as identity_conflict_count,
           coalesce(at.allocated_total, 0::numeric) as allocated_total,
           coalesce(at.target_allocated_total, 0::numeric) as target_allocated_total,
           coalesce(at.fk_allocation_matches, false) as fk_allocation_matches,
           native_si.id as native_invoice_id, native_si.project_id as native_invoice_project_id,
           native_si.pmo_native as native_invoice_marker, native_si.status as native_invoice_status,
           native_si.erp_docstatus as native_invoice_docstatus, native_si.erp_cancelled_at as native_invoice_erp_cancelled_at,
           native_si.currency as native_invoice_currency,
           coalesce((r.cancelled_at is not null or
             (not r.pmo_native and (r.erp_cancelled_at is not null or r.erp_docstatus = 2
               or r.erp_docstatus = 0 or (r.status = 'Scheduled' and r.erp_docstatus is null)))), false) as is_excluded,
           (r.pmo_native and r.status = 'Paid' and r.erp_docstatus is null and r.erp_cancelled_at is null)
             or (not r.pmo_native and r.status = 'Paid' and r.erp_docstatus = 1
               and r.erp_cancelled_at is null and r.cancelled_at is null) as posting_confirmed,
           (r.amount is not null and r.amount::text ~ '^[0-9]+[.][0-9]{2}$' and r.amount < 1000000000000
             and r.received_amount is not null and r.received_amount::text ~ '^[0-9]+[.][0-9]{2}$'
             and r.received_amount < 1000000000000
             and r.withheld_amount is not null and r.withheld_amount::text ~ '^[0-9]+[.][0-9]{2}$'
             and r.withheld_amount < 1000000000000) as header_money_valid,
           (r.currency is not null and r.currency ~ '^[A-Z]{3}$') as receipt_currency_valid
      from receipt_scope r
      left join receipt_allocation_totals at on at.receipt_id = r.id
      left join public.sales_invoices native_si on native_si.id = r.sales_invoice_id and native_si.org_id = r.org_id
  ), receipt_reason_rows as (
    select rf.id as receipt_id, 'posting-unconfirmed'::text as reason
      from receipt_facts rf where not rf.is_excluded and not coalesce(rf.posting_confirmed, false)
    union all
    select rf.id, 'allocation-unreported'
      from receipt_facts rf where not rf.is_excluded and not rf.pmo_native and rf.allocation_details is null
    union all
    select ra.receipt_id, 'allocation-invalid'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null
       and (not ra.shape_valid or ra.allocation_amount is null)
    union all
    select ra.receipt_id, 'allocation-unresolved'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null
       and (ra.resolved_invoice_id is null
         or (ra.number_invoice_project_id = p_project_id and ra.resolved_invoice_id is distinct from ra.number_invoice_id))
    union all
    select ra.receipt_id, 'currency-mismatch'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and not coalesce(ra.currency_valid, false)
    union all
    select ra.receipt_id, 'source-inconsistent'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and ra.identity_conflict
    union all
    select ra.receipt_id, 'invoice-lifecycle'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and ra.resolved_invoice_id is not null
       and not coalesce(ra.invoice_lifecycle_valid, false)
    union all
    select rf.id, 'invoice-lifecycle'
      from receipt_facts rf where not rf.is_excluded and rf.pmo_native
       and not coalesce(rf.native_invoice_marker and rf.native_invoice_project_id = p_project_id
         and rf.native_invoice_status in ('Unpaid','Paid') and rf.native_invoice_docstatus is null
         and rf.native_invoice_erp_cancelled_at is null, false)
    union all
    select rf.id, 'currency-mismatch'
      from receipt_facts rf where not rf.is_excluded and
       (not coalesce(rf.receipt_currency_valid, false)
         or (rf.pmo_native and rf.native_invoice_currency is distinct from rf.currency))
    union all
    select rf.id, 'source-inconsistent'
      from receipt_facts rf where not rf.is_excluded and
       (not coalesce(rf.header_money_valid, false)
         or rf.amount is distinct from (rf.received_amount + rf.withheld_amount)
         or (not rf.pmo_native and rf.allocation_count > 0 and rf.sales_invoice_id is not null
             and not rf.fk_allocation_matches)
         or (not rf.pmo_native and rf.allocated_total > rf.amount)
         or (not rf.pmo_native and rf.withheld_amount = 0 and rf.allocated_total > rf.received_amount)
         or (not rf.pmo_native and rf.withheld_amount > 0 and rf.allocation_count > 0
             and rf.allocated_total <> rf.amount))
    union all
    select rf.id, 'ambiguous-withholding'
      from receipt_facts rf where not rf.is_excluded and not rf.pmo_native and rf.withheld_amount > 0
       and (rf.allocation_count = 0 or rf.target_allocation_count <> rf.allocation_count
         or rf.allocated_total <> rf.amount or rf.invalid_allocation_count > 0
         or rf.unresolved_allocation_count > 0 or rf.currency_mismatch_count > 0
         or rf.invalid_invoice_lifecycle_count > 0)
  ), receipt_classified as (
    select rf.*,
           coalesce((select array_agg(distinct rr.reason order by rr.reason)
                       from receipt_reason_rows rr where rr.receipt_id = rf.id), array[]::text[]) as reasons,
           case when rf.pmo_native or rf.withheld_amount > 0 then rf.received_amount
                else rf.target_allocated_total end as cash_amount
      from receipt_facts rf
     where not rf.is_excluded
  ), receipt_cash_buckets as (
    select rc.currency, sum(rc.cash_amount)::text as amount
      from receipt_classified rc
     where cardinality(rc.reasons) = 0
     group by rc.currency
  ), receipt_bucket_json as (
    select coalesce(jsonb_agg(jsonb_build_object('currency', b.currency, 'amount', b.amount) order by b.currency), '[]'::jsonb) as buckets
      from receipt_cash_buckets b
  ), receipt_cash_payload as (
    select case when count(*) filter (where cardinality(rc.reasons) > 0) > 0 then
      jsonb_build_object('state','incomplete','buckets','[]'::jsonb,'receipt_count',count(*)::int,
        'reasons',coalesce((select jsonb_agg(reason order by reason) from
          (select distinct reason from receipt_reason_rows) distinct_reasons),'[]'::jsonb))
      else jsonb_build_object('state','known','buckets',(select buckets from receipt_bucket_json),'receipt_count',count(*)::int)
      end as payload
      from receipt_classified rc
  )
  select jsonb_build_object(
    'project_id',p.id,
    'contract_invoiced',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                           then null else cs.amount::text end,
    'remaining_to_invoice',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                    or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                               then null else (p.contract_value-cs.amount)::text end,
    -- #1471 FR-009: present only when comparable Contract billing exceeds a known contract value. Built from the same
    -- contract_rows as contract_invoiced, so the list reconciles to contract_billing by construction.
    'contract_excess',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                              or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                              or cs.amount is null or cs.amount <= p.contract_value then null
                      else jsonb_build_object(
                        'amount',(cs.amount-p.contract_value)::text,
                        'contract_billing',cs.amount::text,
                        'contributors',coalesce((select jsonb_agg(jsonb_build_object(
                            'invoice_id',r.id,'invoice_number',coalesce(r.si_number,r.pmo_number),
                            'invoice_date',r.invoice_date,'contribution',r.amount::text)
                          order by r.invoice_date desc nulls last,r.id) from contract_rows r where r.amount <> 0),'[]'::jsonb)) end,
    'cash_received',(select payload from receipt_cash_payload),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object(
      'currency',i.currency,'invoice_count',i.invoice_count,'missing_amount',i.missing_amount,
      'missing_outstanding',i.missing_outstanding,'tax_basis',i.tax_basis,
      'invoiced',case when i.missing_amount = 0 then i.invoiced::text end,
      'outstanding',case when i.missing_outstanding = 0 then i.outstanding::text end,
      'settled',case when i.missing_gross = 0 and i.missing_outstanding = 0 then i.settled::text end,
      'work_revenue',case when coalesce(w.missing_work,0) = 0 then coalesce(w.revenue,0)::text end,
      'missing_work',coalesce(w.missing_work,0)
    ) order by i.currency) from inv i left join work w on w.currency = i.currency),'[]'::jsonb),
    'budget',(select jsonb_build_object('id',b.id,'name',b.name,'version',b.version,'status',b.status,
                                      'currency',b.currency,'amount',bs.amount::text)
              from chosen_budget b cross join budget_sum bs),
    'actuals',jsonb_build_object(
      'currency',o.default_currency,'as_of',(select max(actuals_as_of) from gl),
      'excludes_restricted_rows',not coalesce(public.holds_spend_approval_authority(v_role),false),
      'total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and actuals_to_date is null) > 0 then null
                          else sum(actuals_to_date) filter(where mapped) end::text from gl),
      -- 0376 (#1271): the split of `total` into ERP-project-tagged and rule-attributed cost.
      'tagged_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and tagged_to_date is null) > 0 then null
                          else sum(tagged_to_date) filter(where mapped) end::text from gl),
      'attributed_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and attributed_to_date is null) > 0 then null
                          else sum(attributed_to_date) filter(where mapped) end::text from gl),
      'categories',(select jsonb_agg(jsonb_build_object('category',category,'mapped',mapped,
                                                       'amount',actuals_to_date::text,
                                                       'tagged_amount',tagged_to_date::text,
                                                       'attributed_amount',attributed_to_date::text) order by category) from gl)
    )
  ) into v_result from public.projects p join public.organizations o on o.id = p.org_id
    cross join contract_sum cs where p.id = p_project_id;
  return v_result;
end $function$
;
revoke all on function public.get_project_finances(uuid) from public,anon,authenticated;
grant execute on function public.get_project_finances(uuid) to authenticated;

drop function public.project_mapped_actuals_all(text);
drop function public.project_mapped_actuals(uuid, text);
create function public.project_mapped_actuals(p_project_id uuid,p_fiscal_year text default null)
returns table(category public.budget_category,mapped boolean,has_rows boolean,
              actuals_to_date numeric,actuals_as_of timestamptz,source_sum numeric,
              tagged_to_date numeric,attributed_to_date numeric)
language sql stable security invoker set search_path = public,pg_temp as $$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id = p_project_id
      and s.snapshot_id = (select snapshot_id from generation)
      and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
      and exists (select 1 from public.projects p where p.id = p_project_id)
  ), mapped_categories as (
    select distinct m.category from public.budget_category_account_map m
    where m.org_id = public.auth_org_id()
  ), actuals as (
    select m.category,count(*) as n,
      case when count(*) filter(where r.net is null or r.net::text in ('NaN','Infinity','-Infinity')) > 0
           then null else sum(r.net) end as amount,
      sum(r.net) as source_sum
    from reading r join public.budget_category_account_map m
      on m.org_id = r.org_id and m.erp_account = r.account
    group by m.category
  ), attributed as (
    -- #1271: rule-attributed untagged ledger lines, same category map (0376).
    select x.* from public.cost_attribution_project_actuals(p_project_id,p_fiscal_year) x
    where exists (select 1 from public.projects p where p.id = p_project_id)
  ), reading_as_of as (
    select greatest((select max(as_of) from reading),(select max(as_of) from attributed)) as v
  )
  select c.category,mc.category is not null,coalesce(a.n,0) + coalesce(t.n,0) > 0,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) = 0 then 0::numeric
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) end,
    (select v from reading_as_of),
    case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum
         when a.n > 0 then a.source_sum
         when t.n > 0 then t.source_sum end,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when t.n > 0 then t.amount else 0::numeric end
  from unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.category = c.category
  left join attributed t on t.category = c.category
$$;
revoke all on function public.project_mapped_actuals(uuid,text) from public,anon,authenticated;
grant execute on function public.project_mapped_actuals(uuid,text) to authenticated;

create function public.project_mapped_actuals_all(p_fiscal_year text default null)
returns table(project_id uuid,category public.budget_category,mapped boolean,has_rows boolean,
              actuals_to_date numeric,actuals_as_of timestamptz,source_sum numeric,
              tagged_to_date numeric,attributed_to_date numeric)
language sql stable security invoker set search_path = public,pg_temp as $$
  with visible as (
    select p.id from public.projects p
  ), generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as materialized (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id in (select id from visible)
      and s.snapshot_id = (select snapshot_id from generation)
      and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
  ), mapped_categories as (
    select distinct m.category from public.budget_category_account_map m
    where m.org_id = public.auth_org_id()
  ), actuals as (
    select r.project_id,m.category,count(*) as n,
      case when count(*) filter(where r.net is null or r.net::text in ('NaN','Infinity','-Infinity')) > 0
           then null else sum(r.net) end as amount,
      sum(r.net) as source_sum
    from reading r join public.budget_category_account_map m
      on m.org_id = r.org_id and m.erp_account = r.account
    group by r.project_id,m.category
  ), attributed as materialized (
    select x.* from public.cost_attribution_org_actuals(p_fiscal_year) x
    where x.project_id in (select id from visible)
  ), reading_as_of as (
    select v.id as project_id,
      greatest((select max(r.as_of) from reading r where r.project_id = v.id),
               (select max(t.as_of) from attributed t where t.project_id = v.id)) as v
    from visible v
  )
  select v.id,c.category,mc.category is not null,coalesce(a.n,0) + coalesce(t.n,0) > 0,
    case when mc.category is null or o.v is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) = 0 then 0::numeric
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) end,
    o.v,
    case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum
         when a.n > 0 then a.source_sum
         when t.n > 0 then t.source_sum end,
    case when mc.category is null or o.v is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    case when mc.category is null or o.v is null then null
         when t.n > 0 then t.amount else 0::numeric end
  from visible v
  join reading_as_of o on o.project_id = v.id
  cross join unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.project_id = v.id and a.category = c.category
  left join attributed t on t.project_id = v.id and t.category = c.category
$$;
revoke all on function public.project_mapped_actuals_all(text) from public,anon,authenticated;
grant execute on function public.project_mapped_actuals_all(text) to authenticated;

drop function if exists public.equipment_charge_org_actuals(text);
drop function if exists public.equipment_charge_project_actuals(uuid, text);
