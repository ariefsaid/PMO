-- 0484_invoice_pairs.sql - ECA-5 (#1602): pair an invoice PMO raised with the same invoice already in the ERP, so revenue and
-- receivables count the sale once (spec erp-connect-anytime.spec.md FR-ECA-040, AC-ECA-030; plan §11; PD-ECA-10, PD-ECA-11).
-- Rollback: migrations/rollback/0484_invoice_pairs_down.sql.
--
-- ⚑ Count-once is ONE column. sales_invoices.paired_erp_invoice_id is set only by accept_invoice_pairs (a person's Admin/Finance
--   accept; nothing pairs on its own) and every figure that sums or lists billed or receivable invoices reads past a paired
--   PMO copy: the shared billed-work view (the management pack, both dashboards, project billing, work-order billing and the
--   work-order capacity check all read it) and get_project_finances (billed, receivable, contract draw-down, cash). The client
--   and agent readers carry the same filter (revenue.ts, overdue.ts).
-- ⚑ Only a PMO invoice with NO live receipt can be paired, so no receipt is ever counted twice.
-- ⚑ Pairing is SQL over sales_invoices and tier-agnostic: it pairs a PMO-raised row with an ERP-brought-in row whichever ERP.

-- §1 storage. The unique index makes an ERP invoice the target of at most one PMO copy; the shape check keeps the three
-- pair columns together; an invoice never pairs with itself.
alter table public.sales_invoices
  add column paired_erp_invoice_id uuid references public.sales_invoices(id),
  add column paired_at timestamptz,
  add column paired_by uuid references public.profiles(id),
  add constraint sales_invoices_pair_shape check (
    (paired_erp_invoice_id is null) = (paired_at is null)
    and (paired_erp_invoice_id is null) = (paired_by is null)
    and paired_erp_invoice_id is distinct from id);
create unique index sales_invoices_one_pair on public.sales_invoices (paired_erp_invoice_id) where paired_erp_invoice_id is not null;
comment on column public.sales_invoices.paired_erp_invoice_id is
  'ECA-5 PD-ECA-11: the ERP invoice that counts for this PMO-raised invoice. Set only by accept_invoice_pairs; a non-null value removes this row from every revenue, receivable and overdue figure.';

-- §2 history: classified once (the catalog gate fails on an unclassified column). The pair is the event; who and when are in the audit row.
update public.record_history_config
   set captured = captured || '{"paired_erp_invoice_id":"ref"}'::jsonb,
       omit_cols = omit_cols || array['paired_at','paired_by']
 where entity_type = 'sales_invoice';

-- §3 mirror guard: 0410 body verbatim + the pair-column pin and one narrow exemption (a pairing may fill an empty work order).
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- 0484 (#1602): the pair columns are written only by accept_invoice_pairs (a definer, current_user = postgres, flag set
  -- in its own transaction). Pinned before the externally-owned early return: a person never sets them directly.
  if (new.paired_erp_invoice_id is distinct from old.paired_erp_invoice_id
      or new.paired_at is distinct from old.paired_at
      or new.paired_by is distinct from old.paired_by)
     and not (current_user = 'postgres' and current_setting('pmo.invoice_pairing', true) = 'on') then
    raise exception 'an invoice is paired only by accepting a proposed pair' using errcode = '42501';
  end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
     or (new.billing_kind is distinct from old.billing_kind and current_user <> 'postgres') -- 0410 (#1471): only the definer RPCs change it
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or (new.work_order_id is distinct from old.work_order_id    -- 0193 (#498): which scope grant this bills
         and not (current_user = 'postgres' and current_setting('pmo.invoice_pairing', true) = 'on' and old.work_order_id is null)) -- 0484: a pairing may fill an empty one
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- §4 the shared billed-work view (0262 §1 verbatim + the filter). work_order_billing_lines, work_order_billing, the management
-- pack, both dashboards, project billing and the work-order capacity check read through it, so a paired copy leaves them all.
create or replace view public.sales_invoice_work_billed with (security_invoker = true) as
  select si.id, si.org_id, si.project_id, si.currency, si.invoice_date, si.status,
         coalesce(pc.kind = 'down_payment', false) as is_down_payment,
         case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net,
         coalesce(pc.dp_recovery_amount, 0) as recovery,
         si.work_order_id
    from public.sales_invoices si
    left join public.progress_claims pc on pc.id = si.id and pc.org_id = si.org_id
   where si.paired_erp_invoice_id is null;   -- 0484 (#1602, PD-ECA-11): a paired PMO copy counts through its ERP invoice only
revoke all on public.sales_invoice_work_billed from public, anon, authenticated;
grant select on public.sales_invoice_work_billed to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — work_order_billing_lines (DD-BWO-1): one row per record that bills a work order.
--   • a linked invoice that is not Cancelled, at its billed work (net + recovery; a down payment bills 0);
--   • a live progress claim on the work order with NO invoice yet, at its gross (it will become an invoice, and
--     0250 makes its invoice reuse the claim id — so a raised claim appears exactly once, as its invoice).
-- `billed` is NULL when the invoice has no amount; the aggregate below reports that as "not totalled".
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 get_project_finances (0410 verbatim + the filter on the two invoice sets it reads directly).
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
      and si.paired_erp_invoice_id is null   -- 0484 (#1602, PD-ECA-11): count the ERP copy once
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
       and si.paired_erp_invoice_id is null   -- 0484 (#1602): a paired copy never carries receipts, and none is read through it
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

-- §6 candidates: the one rule every pairing step uses. SECURITY INVOKER (RLS and the caller's org apply); a PMO-raised invoice
-- with no live receipt against a submitted ERP invoice of the same client, reference (or ERP number), tax-inclusive total,
-- currency and month (FR-ECA-040). Optional filters let accept re-check a single pair without scanning the org.
create or replace function public.invoice_pair_candidates(p_pmo_id uuid default null, p_erp_id uuid default null)
  returns table (pmo_invoice_id uuid, erp_invoice_id uuid)
  language sql stable security invoker set search_path = public as $$
  select n.id, e.id
    from public.sales_invoices n
    join public.sales_invoices e on e.org_id = n.org_id and e.customer_id = n.customer_id
   where n.org_id = public.auth_org_id()
     and (p_pmo_id is null or n.id = p_pmo_id) and (p_erp_id is null or e.id = p_erp_id)
     and n.pmo_native and n.status = 'Unpaid' and n.paired_erp_invoice_id is null
     and not exists (select 1 from public.incoming_payments ip
                      where ip.org_id = n.org_id and ip.sales_invoice_id = n.id and ip.cancelled_at is null)
     and not e.pmo_native and e.erp_docstatus = 1 and e.erp_cancelled_at is null
     and e.status in ('Submitted', 'Unpaid', 'Paid')
     and not exists (select 1 from public.sales_invoices t where t.paired_erp_invoice_id = e.id)
     and ((n.reference_number is not null and n.reference_number = e.reference_number)
          or (n.si_number is not null and n.si_number = e.si_number))
     -- Compared on the tax-inclusive total: PMO invoices are raised exclusive of tax, the ERP mirror stores its grand total (inclusive),
     -- so equal `amount` and equal `tax_treatment` could never both hold for a real pair.
     and n.currency = e.currency
     and case when n.tax_treatment = 'inclusive' then n.amount else n.amount + n.tax_amount end
       = case when e.tax_treatment = 'inclusive' then e.amount else e.amount + e.tax_amount end
     and date_trunc('month', n.invoice_date) = date_trunc('month', e.invoice_date)
$$;
revoke all on function public.invoice_pair_candidates(uuid, uuid) from public, anon;
grant execute on function public.invoice_pair_candidates(uuid, uuid) to authenticated;

-- §7 propose (read-only). Admin/Finance of an org whose ERP owns revenue. `ambiguous` = either side has more than one candidate;
-- those rows are listed for a person to decide and are never accepted in bulk.
create or replace function public.propose_invoice_pairs()
  returns table (pmo_invoice_id uuid, erp_invoice_id uuid, ambiguous boolean, pmo_number text, erp_number text,
                 customer_name text, amount numeric, currency text, invoice_date date)
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
    with c as (select * from public.invoice_pair_candidates())
    select c.pmo_invoice_id, c.erp_invoice_id,
           (count(*) over (partition by c.pmo_invoice_id) > 1 or count(*) over (partition by c.erp_invoice_id) > 1),
           n.pmo_number, e.si_number, co.name, n.amount, n.currency, n.invoice_date
      from c
      join public.sales_invoices n on n.id = c.pmo_invoice_id
      join public.sales_invoices e on e.id = c.erp_invoice_id
      left join public.companies co on co.id = n.customer_id
     order by n.invoice_date, n.pmo_number, e.si_number;
end $$;
revoke all on function public.propose_invoice_pairs() from public, anon;
grant execute on function public.propose_invoice_pairs() to authenticated;

-- §8 the PMO invoices that keep counting as they are, with the reason (FR-ECA-040: unpaired copies stay listed until resolved).
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
                else 'no-match' end
      from public.sales_invoices n
      left join public.companies co on co.id = n.customer_id
     where n.org_id = public.auth_org_id() and n.pmo_native and n.paired_erp_invoice_id is null
       and n.status in ('Submitted', 'Unpaid', 'Paid')
       and (n.id in (select pmo_invoice_id from amb) or n.id not in (select pmo_invoice_id from c))
     order by n.invoice_date, n.pmo_number;
end $$;
revoke all on function public.list_unpaired_native_invoices() from public, anon;
grant execute on function public.list_unpaired_native_invoices() to authenticated;

-- §9 accept. SECURITY DEFINER: it writes rows the caller cannot write directly (the pair columns, an empty project and work order
-- on the ERP copy). Role, active membership, org and the ERP-owns-revenue gate are re-asserted here; the pair list is never
-- trusted: every pair is re-checked against the same candidate rule (and must be unambiguous) with both rows locked.
-- Returns the number of pairs applied; a pair already applied is skipped, so a repeat is a no-op.
create or replace function public.accept_invoice_pairs(p_pairs jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := public.auth_org_id();
  v_role  public.user_role := public.auth_role();
  v_uid   uuid := auth.uid();
  v_pair  record;
  v_n     public.sales_invoices%rowtype;
  v_e     public.sales_invoices%rowtype;
  v_count int := 0;
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay - a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin', 'Finance') then
    raise exception 'only Finance or an Admin can accept invoice pairs' using errcode = '42501';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'pairs must be a list' using errcode = '22023';
  end if;
  if not public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'invoices pair only once the ERP owns revenue' using errcode = '23514', detail = 'revenue-not-employed';
  end if;
  perform set_config('pmo.invoice_pairing', 'on', true);
  -- Sorted so two concurrent accepts lock rows in the same order.
  for v_pair in
    select (x ->> 'pmo')::uuid as pmo_id, (x ->> 'erp')::uuid as erp_id
      from jsonb_array_elements(p_pairs) x order by 1, 2
  loop
    select * into v_n from public.sales_invoices where id = v_pair.pmo_id and org_id = v_org for update;
    if not found then raise exception 'invoice pair not found' using errcode = '23514', detail = 'pair-not-found'; end if;
    select * into v_e from public.sales_invoices where id = v_pair.erp_id and org_id = v_org for update;
    if not found then raise exception 'invoice pair not found' using errcode = '23514', detail = 'pair-not-found'; end if;
    if v_n.paired_erp_invoice_id = v_e.id then continue; end if;   -- already applied
    if v_n.paired_erp_invoice_id is not null then
      raise exception 'this PMO invoice already counts as another ERP invoice' using errcode = '23514', detail = 'already-paired';
    end if;
    -- The candidate rule again, now on locked rows: both sides, the receipt check and the one-to-one rule.
    if not exists (select 1 from public.invoice_pair_candidates(v_n.id, v_e.id))
       or (select count(*) from public.invoice_pair_candidates(v_n.id, null)) <> 1
       or (select count(*) from public.invoice_pair_candidates(null, v_e.id)) <> 1 then
      raise exception 'these invoices are not an unambiguous match' using errcode = '23514', detail = 'pair-not-eligible';
    end if;
    -- The PMO copy stops counting first, so the work-order capacity check below sees the sale once.
    update public.sales_invoices
       set paired_erp_invoice_id = v_e.id, paired_at = now(), paired_by = v_uid
     where id = v_n.id;
    -- The ERP copy takes the PMO copy's project, kind and work order when it has none of its own.
    if v_e.project_id is null and v_n.project_id is not null then
      update public.sales_invoices set project_id = v_n.project_id, billing_kind = v_n.billing_kind where id = v_e.id;
      v_e.project_id := v_n.project_id;
    end if;
    if v_e.work_order_id is null and v_n.work_order_id is not null and v_e.project_id is not distinct from v_n.project_id then
      update public.sales_invoices set work_order_id = v_n.work_order_id where id = v_e.id;
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform public.log_audit('revenue.invoice_pair', v_org, v_uid, null, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end $$;
alter function public.accept_invoice_pairs(jsonb) owner to postgres;
revoke all on function public.accept_invoice_pairs(jsonb) from public, anon;
grant execute on function public.accept_invoice_pairs(jsonb) to authenticated;
comment on function public.accept_invoice_pairs(jsonb) is
  'ECA-5 FR-ECA-040: Admin/Finance accepts proposed invoice pairs in bulk. Re-checks every pair; sets paired_erp_invoice_id; the PMO copy stops counting.';
