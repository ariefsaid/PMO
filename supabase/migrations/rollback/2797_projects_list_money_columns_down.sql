-- Reverses 2797_projects_list_money_columns.sql: the money read goes back to the organisation-wide actuals read, and
-- procurement_ledger_held_many to its per-link journal read. Bodies are the 2768 / 2690 heads, verbatim.
begin;
CREATE OR REPLACE FUNCTION public.get_projects_money_collection(p_project_ids uuid[])
 RETURNS TABLE(project_id uuid, actuals jsonb, ledger_basis text, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_role public.user_role := public.auth_role();
  v_org uuid := public.auth_org_id();
  v_erp boolean;
begin
  perform public.assert_not_light();
  -- Validation order, messages and SQLSTATEs are byte-for-byte the 0700 body's (0493 asserts them).
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;
  v_erp := public.org_reads_erp_ledger();

  return query
  with requested as (
    select distinct requested.id
      from unnest(p_project_ids) requested(id)
      join public.projects p on p.id = requested.id and p.org_id = v_org and public.project_money_in_scope(p.id)
  ), proj as (
    select p.id, p.currency, o.default_currency
      from public.projects p
      join public.organizations o on o.id = p.org_id
      join requested r on r.id = p.id
  ), -- the newest Active version's currency (the loop's ORDER BY version DESC, created_at DESC, id DESC)
  active_version as (
    select distinct on (v.project_id) v.project_id, v.currency
      from public.budget_versions v
     where v.org_id = v_org and v.status = 'Active'
       and v.project_id in (select id from requested)
     order by v.project_id, v.version desc, v.created_at desc, v.id desc
  ), -- the loop's budget columns: Active presence, an unreadable line, and the Active-version sum
  active_budget as (
    select v.project_id,
           true as has_active,
           count(li.id) filter (
             where li.budgeted_amount is null
                or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')
           ) > 0 as unreadable,
           sum(li.budgeted_amount) as amount
      from public.budget_versions v
      left join public.budget_line_items li
        on li.budget_version_id = v.id and li.org_id = v.org_id
     where v.org_id = v_org and v.status = 'Active'
       and v.project_id in (select id from requested)
     group by v.project_id
  ), -- ERP Actuals: one org-wide attributed pass, the same rows project_mapped_actuals returns per project.
  -- The lateral's argument reads the gate row, so a PMO-basis org (no gate row) never runs the pass at all.
  pma as materialized (
    select a.*
      from (select null::text as fiscal_year where v_erp) gated
      cross join lateral public.project_mapped_actuals_all(gated.fiscal_year) a
     where a.project_id in (select id from requested)
  ), pma_agg as (
    select pma.project_id,
           -- get_project_finances: max(actuals_as_of) over the project's mapped-actuals rows.
           max(actuals_as_of) as as_of,
           -- get_project_finances: no mapped category, or a mapped one with no reading, leaves the total unstated.
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and actuals_to_date is null) > 0) as incomplete,
           sum(actuals_to_date) filter (where mapped) as total,
           -- 0376/0497: the same rule for the split totals the record header states beside `total`.
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and tagged_to_date is null) > 0) as tagged_incomplete,
           sum(tagged_to_date) filter (where mapped) as tagged_total,
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and attributed_to_date is null) > 0) as attributed_incomplete,
           sum(attributed_to_date) filter (where mapped) as attributed_total,
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and equipment_charge_to_date is null) > 0) as charge_incomplete,
           sum(equipment_charge_to_date) filter (where mapped) as equipment_charge_total,
           -- get_project_finances: every category, mapped flag and amount, ordered by the category enum.
           jsonb_agg(jsonb_build_object('category', category, 'mapped', mapped,
                                        'amount', actuals_to_date::text,
                                        'tagged_amount', tagged_to_date::text,
                                        'attributed_amount', attributed_to_date::text,
                                        'equipment_charge_amount', equipment_charge_to_date::text) order by category) as categories
      from pma
     group by pma.project_id
  ), pma_ok as (
    select distinct pma.project_id, category
      from pma
     where mapped and actuals_to_date is not null
  ), -- the loop's categories-complete rule: every Active-budget line category has a mapped, read actual
  category_coverage as (
    select b.project_id,
           count(distinct li.category) as n,
           count(distinct ok.category) as n_ok
      from public.budget_versions b
      join public.budget_line_items li on li.budget_version_id = b.id
      left join pma_ok ok on ok.project_id = b.project_id and ok.category = li.category
     where b.status = 'Active'
       and b.project_id in (select id from requested)
     group by b.project_id
  ), -- PMO Actuals (0700 basis): the set-based spent/committed positions, proven equal to the per-project pair
  pmp as materialized (
    select * from public.project_pmo_positions(p_project_ids)
  )
  select proj.id,
         case when v_erp then
           jsonb_set(
             jsonb_build_object(
               'currency', proj.default_currency,
               'as_of', pa.as_of,
               'excludes_restricted_rows', not coalesce(public.holds_spend_approval_authority(v_role), false),
               'total', case when pa.incomplete then null else pa.total end::text,
               'tagged_total', case when pa.tagged_incomplete then null else pa.tagged_total end::text,
               'attributed_total', case when pa.attributed_incomplete then null else pa.attributed_total end::text,
               'equipment_charge_total', case when pa.charge_incomplete then null else pa.equipment_charge_total end::text,
               'categories', coalesce(pa.categories, '[]'::jsonb)
             ),
             '{complete}',
             to_jsonb(
               coalesce(cc.n > 0 and cc.n = cc.n_ok, false)
               and coalesce(public.holds_spend_approval_authority(v_role), false)))
         else
           jsonb_build_object(
             'currency', proj.currency,
             'total', pm.spent::text,
             'as_of', null,
             'excludes_restricted_rows', false,
             'complete', pm.spent_complete,
             'committed_total', pm.committed::text,
             'committed_complete', pm.committed_complete,
             'categories', '[]'::jsonb)
         end,
         case when v_erp then 'erp' else 'pmo' end,
         case when ab.project_id is null then null
              when ab.unreadable then null
              else coalesce(ab.amount, 0)::text end,
         av.currency,
         coalesce(ab.has_active, false)
    from proj
    left join active_version av on av.project_id = proj.id
    left join active_budget ab on ab.project_id = proj.id
    left join pma_agg pa on pa.project_id = proj.id
    left join category_coverage cc on cc.project_id = proj.id
    left join pmp pm on pm.project_id = proj.id
   order by proj.id;
end $function$;

CREATE OR REPLACE FUNCTION public.procurement_ledger_held_many(p_ids uuid[])
 RETURNS TABLE(procurement_id uuid, held numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  select q.* from (select p.id,
         case when exists (select 1 from public.erp_purchase_captures r where r.procurement_id = p.id and r.kind='journal' and r.undone_at is null) then p.total_value else coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
       + coalesce((select sum(greatest(l.amount, 0))                                        -- 0687 FR-JEC-021
                     from public.erp_journal_line_links k
                     cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l
                    where k.procurement_id = p.id
                      and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)
       end
    from public.procurements p
   where p.id = any (p_ids) and (auth.uid() is null or p.org_id = public.auth_org_id())
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())
) q where public.assert_not_light()
$function$;

drop function if exists public.project_mapped_actuals_for(uuid[], text);
drop function if exists public.erp_journal_cost_lines_for(uuid, uuid, text[]);
commit;
