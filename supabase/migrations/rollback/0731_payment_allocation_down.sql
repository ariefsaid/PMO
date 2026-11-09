-- 0731_payment_allocation_down.sql - reverses 0731 (#1415). Refuses while any live PMO receipt is on account, partly applied, split across
-- invoices or applied to an invoice other than the one it was recorded from, and while any receipt of either kind has no invoice at all:
-- the old model cannot represent them (an invoice's settled figure would silently change, or the old constraint would refuse the row).
-- Unapply or cancel them first (unapply_native_allocation / cancel_native_receipt). Then the readers go back to their pre-0731 text, the
-- allocation table and the three RPCs are dropped, and the old receipt-to-invoice settlement is restored.
do $$ begin
  if exists (select 1 from public.incoming_payments ip where ip.pmo_native and ip.sales_invoice_id is null) then
    raise exception 'on-account PMO receipts exist (no invoice); rollback refused - cancel them first (cancel_native_receipt)'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.incoming_payments ip
     where ip.pmo_native and ip.cancelled_at is null
       and ((select count(*) from public.incoming_payment_allocations a
              where a.incoming_payment_id = ip.id and a.reversed_at is null) <> 1
         or exists (select 1 from public.incoming_payment_allocations a
                     where a.incoming_payment_id = ip.id and a.reversed_at is null
                       and (a.sales_invoice_id is distinct from ip.sales_invoice_id or a.amount <> ip.amount)))) then
    raise exception 'a live PMO receipt is partly applied, split or applied elsewhere; rollback refused - unapply or cancel it first'
      using errcode = 'P0001';
  end if;
end $$;

-- readers back to their pre-0731 text
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
      and si.paired_erp_invoice_id is null   -- 0498 (#1602, PD-ECA-11): count the ERP copy once
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
    select * from public.project_finance_actuals(p_project_id)
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
       and si.paired_erp_invoice_id is null   -- 0498 (#1602): a paired copy never carries receipts, and none is read through it
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
      'currency',case when public.org_reads_erp_ledger() then o.default_currency else p.currency end,'as_of',(select max(actuals_as_of) from gl),
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
      -- 0497 (#1519, FR-EQU-051): the hire-rate internal charge, inside `total`, stated on its own.
      'equipment_charge_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and equipment_charge_to_date is null) > 0 then null
                          else sum(equipment_charge_to_date) filter(where mapped) end::text from gl),
      'categories',(select jsonb_agg(jsonb_build_object('category',category,'mapped',mapped,
                                                       'amount',actuals_to_date::text,
                                                       'tagged_amount',tagged_to_date::text,
                                                       'attributed_amount',attributed_to_date::text,
                                                       'equipment_charge_amount',equipment_charge_to_date::text) order by category) from gl)  -- 0497
    )
  ) into v_result from public.projects p join public.organizations o on o.id = p.org_id
    cross join contract_sum cs where p.id = p_project_id;
  return v_result;
end $function$
;

create or replace function public.invoice_pair_candidates(p_pmo_id uuid default null, p_erp_id uuid default null, p_ignore_scope boolean default false)
  returns table (pmo_invoice_id uuid, erp_invoice_id uuid)
  language sql stable security invoker set search_path = public as $$
  select n.id, e.id
    from public.sales_invoices n
    join public.sales_invoices e on e.org_id = n.org_id and e.customer_id = n.customer_id
   where n.org_id = public.auth_org_id()
     and public.auth_role() in ('Admin', 'Finance')   -- the roles that may pair; INVOKER, so RLS applies on top
     and (p_pmo_id is null or n.id = p_pmo_id) and (p_erp_id is null or e.id = p_erp_id)
     and n.pmo_native and n.status = 'Unpaid' and n.paired_erp_invoice_id is null
     and not exists (select 1 from public.incoming_payments ip
                      where ip.org_id = n.org_id and ip.sales_invoice_id = n.id and ip.cancelled_at is null)
     and not e.pmo_native and e.erp_docstatus = 1 and e.erp_cancelled_at is null
     and e.status in ('Submitted', 'Unpaid', 'Paid')
     and not exists (select 1 from public.sales_invoices t where t.paired_erp_invoice_id = e.id)
     -- A pair never moves revenue: the ERP copy has no project (or work order) of its own yet, or the PMO copy's own.
     -- p_ignore_scope drops only this test, so the review list can say "same invoice, different project".
     and (p_ignore_scope or ((e.project_id is null or e.project_id = n.project_id)
                             and (e.work_order_id is null or e.work_order_id = n.work_order_id)))
     and ((n.reference_number is not null and n.reference_number = e.reference_number)
          or (n.si_number is not null and n.si_number = e.si_number))
     -- Compared on the tax-inclusive total: PMO invoices are raised exclusive of tax, the ERP mirror stores its grand total (inclusive),
     -- so equal `amount` and equal `tax_treatment` could never both hold for a real pair.
     and n.currency = e.currency
     and case when n.tax_treatment = 'inclusive' then n.amount else n.amount + n.tax_amount end
       = case when e.tax_treatment = 'inclusive' then e.amount else e.amount + e.tax_amount end
     -- Equal totals alone do not make equal tax (net 100 + tax 10 vs net 110 + tax 0): the tax must match too, so net does.
     and n.tax_amount = e.tax_amount
     and date_trunc('month', n.invoice_date) = date_trunc('month', e.invoice_date)
$$;

create or replace function public.list_unpaired_native_invoices()
  returns table (invoice_id uuid, pmo_number text, customer_name text, invoice_date date, amount numeric, currency text, reason text)
  language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(public.auth_org_id(), 'revenue') then return; end if;
  return query
    with c as (select * from public.invoice_pair_candidates()),
    amb as (select x.pmo_invoice_id from c x
             where (select count(*) from c y where y.pmo_invoice_id = x.pmo_invoice_id) > 1
                or (select count(*) from c y where y.erp_invoice_id = x.erp_invoice_id) > 1)
    select n.id, n.pmo_number, co.name, n.invoice_date, n.amount, n.currency,
           case when exists (select 1 from public.incoming_payments ip
                              where ip.org_id = n.org_id and ip.sales_invoice_id = n.id and ip.cancelled_at is null) then 'has-receipt'
                when n.id in (select pmo_invoice_id from amb) then 'ambiguous'
                when n.id in (select pmo_invoice_id from public.invoice_pair_candidates(null, null, true)) then 'project-differs'
                else 'no-match' end
      from public.sales_invoices n
      left join public.companies co on co.id = n.customer_id
     where n.org_id = public.auth_org_id() and n.pmo_native and n.paired_erp_invoice_id is null
       and n.status in ('Unpaid', 'Paid')   -- a PMO invoice is Draft, Unpaid, Paid or Cancelled; a Draft is not yet a sale
       and (n.id in (select pmo_invoice_id from amb) or n.id not in (select pmo_invoice_id from c))
     order by n.invoice_date, n.pmo_number;
end $$;

-- settlement back to the receipts themselves
create or replace function public.native_invoice_settled(p_org uuid, p_si_id uuid) returns numeric
  language sql stable set search_path = public as $$
  select coalesce(sum(ip.amount), 0)
    from public.incoming_payments ip
   where ip.org_id = p_org and ip.sales_invoice_id = p_si_id and ip.pmo_native and ip.cancelled_at is null
$$;
revoke all on function public.native_invoice_settled(uuid, uuid) from public, anon, authenticated;

-- the two writers back to their 0534 text (they stop writing allocations)
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

drop function public.apply_native_receipt(uuid, jsonb, uuid);
drop function public.unapply_native_allocation(uuid);
drop function public.record_native_on_account_receipt(uuid, numeric, numeric, numeric, text, date, uuid);
drop function public.native_receipt_allocations_backfill();
drop trigger incoming_payments_amount_covers_allocations on public.incoming_payments;
drop function public.incoming_payments_amount_covers_allocations();
drop table public.incoming_payment_allocations;
drop function public.ipa_consistency();

alter table public.incoming_payments drop constraint incoming_payments_pmo_native_shape;
alter table public.incoming_payments add constraint incoming_payments_pmo_native_shape check (
  not pmo_native or (ip_number is null and erp_docstatus is null and sales_invoice_id is not null));
