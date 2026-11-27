-- Projects list: the money and delivery columns read the requested page of projects, not the whole organisation (#1128).
-- Speed only. Same rows, same figures, same callers; nothing is counted differently.
--  * project_mapped_actuals_for(ids, fiscal_year): the project_mapped_actuals_all body with its project set limited to
--    the ids; get_projects_money_collection reads it for the requested projects instead of every project and then
--    filtering. Internal: reachable only through the definer reads that call it (no client grant, as no new surface).
--  * procurement_ledger_held_many: the four session helpers are evaluated once per statement, and the journal cost
--    lines are read once per organisation and project (for the linked vouchers) instead of once per link, through
--    erp_journal_cost_lines_for, an internal read with no client grant.
-- Reverse: rollback/2797_projects_list_money_columns_down.sql.
-- drops: get_projects_money_collection(uuid[]) | "cross join lateral public.project_mapped_actuals_all(gated.fiscal_year) a" | Read the actuals for the requested projects only.
-- drops: procurement_ledger_held_many(uuid[]) | "select p.id," | The purchase set is selected once, with the session helpers evaluated once per statement.
-- drops: procurement_ledger_held_many(uuid[]) | "case when exists (select 1 from public.erp_purchase_captures r where r.procurement_id = p.id and r.kind='journal' and r.undone_at is null) then p.total_value else coalesce((select sum(coalesce(d.net_total, d.grand_total))" | Same case, reading the journal-captured set computed once.
-- drops: procurement_ledger_held_many(uuid[]) | "cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l" | Journal lines are read once per organisation and project.
-- drops: procurement_ledger_held_many(uuid[]) | "where p.id = any (p_ids) and (auth.uid() is null or p.org_id = public.auth_org_id())" | Same filter, evaluated once per statement.
-- drops: procurement_ledger_held_many(uuid[]) | "and (auth.uid() is null" | Same filter, evaluated once per statement.
-- drops: procurement_ledger_held_many(uuid[]) | "or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))" | Same filter, evaluated once per statement.
-- drops: procurement_ledger_held_many(uuid[]) | "and (auth.uid() is null or public.is_active_member())" | Same filter, evaluated once per statement.
-- drops: procurement_ledger_held_many(uuid[]) | "+ coalesce((select sum(greatest(l.amount, 0))" | The journal sum is computed once per purchase in journal_held and added below.
-- drops: procurement_ledger_held_many(uuid[]) | "where k.procurement_id = p.id" | Moved into journal_held.
-- drops: procurement_ledger_held_many(uuid[]) | "and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)" | Moved into journal_held, which joins on the same document type and account.
begin;

create or replace function public.project_mapped_actuals_for(p_project_ids uuid[], p_fiscal_year text DEFAULT NULL::text)
 RETURNS TABLE(project_id uuid, category budget_category, mapped boolean, has_rows boolean, actuals_to_date numeric, actuals_as_of timestamp with time zone, source_sum numeric, tagged_to_date numeric, attributed_to_date numeric, equipment_charge_to_date numeric)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_temp
AS $function$
  with visible as (
    select p.id from public.projects p where p.id = any (p_project_ids)
  ), in_scope as (                                     -- a client's money reads only projects in scope (2751)
    select v.id from visible v
     where (select public.money_read_is_internal()) or (select not public.actor_money_scoped())
        or v.id in (select public.actor_money_projects())
  ), generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as materialized (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id in (select id from in_scope)
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
    where x.project_id in (select id from in_scope)
  ), charged as materialized (                                                       -- 0497
    select x.* from public.equipment_charge_org_actuals(p_fiscal_year) x
    where x.project_id in (select id from in_scope)
  ), reading_as_of as (
    select v.id as project_id,
      greatest((select max(r.as_of) from reading r where r.project_id = v.id),
               (select max(t.as_of) from attributed t where t.project_id = v.id),
               (select max(q.as_of) from charged q where q.project_id = v.id)) as v   -- 0497
    from visible v
  )
  select v.id,c.category,mc.category is not null,coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) > 0,   -- 0497 q
    case when mc.category is null or o.v is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) = 0 then 0::numeric                     -- 0497 q
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) + coalesce(q.amount,0) end,                     -- 0497 q
    o.v,
    case when coalesce(a.n,0) + coalesce(t.n,0) = 0                                  -- 0497 budget-vs-actual
         then case when q.n > 0 then q.amount end                                    -- 0497 charge-only (null when none)
         else (case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum        -- 0376 verbatim
                    when a.n > 0 then a.source_sum
                    when t.n > 0 then t.source_sum end)
              + coalesce(case when q.n > 0 then q.amount end,0) end,                 -- 0497
    case when mc.category is null or o.v is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    case when mc.category is null or o.v is null then null
         when t.n > 0 then t.amount else 0::numeric end,
    case when mc.category is null or o.v is null then null
         when q.n > 0 then q.amount else 0::numeric end                              -- 0497 equipment_charge_to_date
  from visible v
  join reading_as_of o on o.project_id = v.id
  cross join unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.project_id = v.id and a.category = c.category
  left join attributed t on t.project_id = v.id and t.category = c.category
  left join charged q on q.project_id = v.id and q.category = c.category            -- 0497
$function$;

revoke all on function public.project_mapped_actuals_for(uuid[], text) from public, anon, authenticated;

-- erp_journal_cost_lines for a set of vouchers: the same rows the per-voucher read returns for each named voucher
-- (the voucher filter is row-level, before the grouping), with the organisation-wide posted-journal lookup built once.
create or replace function public.erp_journal_cost_lines_for(p_org_id uuid, p_project_id uuid, p_voucher_nos text[] DEFAULT NULL::text[])
 RETURNS TABLE(erp_doctype text, voucher_no text, project_id uuid, account text, category budget_category, posting_date date, amount numeric, remarks text, party text, is_cancelled boolean)
 LANGUAGE sql
 STABLE
 SET search_path = public, pg_catalog, pg_temp
AS $function$
  with map as (
    select m.value as erp_name, min(m.key)::uuid as project_id
      from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map', '{}'::jsonb)) m
     where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
       and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
     group by m.value having count(*) = 1
    union all
    select pb.external_container_id, (array_agg(pb.project_id))[1]
      from public.external_project_bindings pb
     where pb.org_id = p_org_id and pb.external_tier = 'odoo' and pb.external_container_id <> ''
       and exists (select 1 from public.external_org_bindings b
                    where b.org_id = p_org_id and b.external_tier = 'odoo' and b.activated_at is not null)
     group by pb.external_container_id having count(*) = 1
  ), pmo_posted as (
    select e.erp_name from public.expense_posting_erp_mirror e where e.org_id = p_org_id and e.erp_name is not null
    union
    select i.erp_name from public.imprest_posting_erp_mirror i where i.org_id = p_org_id and i.erp_name is not null
    union
    select d.erp_name from public.erp_purchase_documents d
     where d.org_id = p_org_id and d.external_ref is not null
       and (d.pmo_owned or d.external_ref ~ '^account\.move:' or public.erp_document_recorded_by_pmo(p_org_id, d.erp_doctype, d.erp_name))
    union
    select r.erp_name from public.revenue_erp_mirror r
     where r.org_id = p_org_id and (r.pmo_owned or r.sales_invoice_id is not null or r.external_ref ~ '^account\.move:')
  )
  select g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category,
         min(g.posting_date),
         coalesce(sum(coalesce(g.debit, 0) - coalesce(g.credit, 0)) filter (where not g.is_cancelled), 0),
         string_agg(distinct nullif(btrim(g.remarks), ''), ' · '),
         string_agg(distinct g.party, ', '),
         bool_and(g.is_cancelled)
    from public.erp_gl_entry_mirror g
    join map on map.erp_name = g.project and map.project_id = p_project_id
    join public.projects p on p.id = map.project_id and p.org_id = p_org_id
    join public.budget_category_account_map cm on cm.org_id = g.org_id and cm.erp_account = g.account
   where g.org_id = p_org_id and g.voucher_type in ('Journal Entry', 'account.move') and g.voucher_no <> '/'
     and (p_voucher_nos is null or g.voucher_no = any (p_voucher_nos))
     and not exists (select 1 from pmo_posted x where x.erp_name = g.voucher_no)
   group by g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category
$function$;
revoke all on function public.erp_journal_cost_lines_for(uuid, uuid, text[]) from public, anon, authenticated;

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
  ), -- ERP Actuals: the same rows project_mapped_actuals returns per project, read for the requested projects only.
  -- The lateral's argument reads the gate row, so a PMO-basis org (no gate row) never runs the read at all.
  pma as materialized (
    select a.*
      from (select null::text as fiscal_year where v_erp) gated
      cross join lateral public.project_mapped_actuals_for(array(select id from requested), gated.fiscal_year) a
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

create or replace function public.procurement_ledger_held_many(p_ids uuid[])
 returns table(procurement_id uuid, held numeric)
 language sql
 stable security definer
 set search_path = public, pg_catalog, pg_temp
as $function$
  with eligible as materialized (
    select p.id, p.total_value
      from public.procurements p
     where p.id = any (p_ids) and ((select auth.uid()) is null or p.org_id = (select public.auth_org_id()))
       and ((select auth.uid()) is null
            or (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance'))
       and ((select auth.uid()) is null or (select public.is_active_member()))
  ), journal_captured as (
    select distinct r.procurement_id from public.erp_purchase_captures r
     where r.procurement_id in (select id from eligible) and r.kind = 'journal' and r.undone_at is null
  ), -- 0687 FR-JEC-021: the journal lines a purchase is linked to, read once per organisation and project for its vouchers
  journal_projects as (
    select k.org_id, k.project_id, array_agg(distinct k.voucher_no) as vouchers
      from public.erp_journal_line_links k
     where k.procurement_id in (select id from eligible)
       and not exists (select 1 from journal_captured c where c.procurement_id = k.procurement_id)
     group by k.org_id, k.project_id
  ), journal_lines as materialized (
    select jp.org_id, jp.project_id, l.erp_doctype, l.voucher_no, l.account, l.amount
      from journal_projects jp
     cross join lateral public.erp_journal_cost_lines_for(jp.org_id, jp.project_id, jp.vouchers) l
  ), journal_held as (
    select k.procurement_id, sum(greatest(l.amount, 0)) as amount
      from public.erp_journal_line_links k
      join journal_lines l
        on l.org_id = k.org_id and l.project_id = k.project_id and l.voucher_no = k.voucher_no
       and l.erp_doctype = k.erp_doctype and l.account = k.account
     where k.procurement_id in (select id from eligible)
     group by k.procurement_id
  )
  select q.* from (select p.id,
         case when exists (select 1 from journal_captured c where c.procurement_id = p.id) then p.total_value else coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
       + coalesce(jh.amount, 0)
       end
    from eligible p
    left join journal_held jh on jh.procurement_id = p.id
) q where public.assert_not_light()
$function$;

commit;
