-- 2797 (#1128): the Projects list money and delivery columns read the requested projects, and give the same answer as before.
-- The four bodies the migration replaced live here under temporary names (old_*); every figure the list shows is read both
-- ways for every seeded project and every fixture project, as every calling role and as a second organisation, and
-- EXCEPT must be empty in both directions. A figure the set read does not return, or returns extra, fails here.
begin;
select plan(177);

-- Old bodies, verbatim from before 2797 (held_many 2690 head, open_commitments 0723, get_projects_delivery 1971, get_projects_money_collection 2768).
create or replace function pg_temp.old_ledger_held_many(p_ids uuid[])
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

create or replace function pg_temp.old_open_commitments(p_ids uuid[])
 RETURNS TABLE(procurement_id uuid, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with flag as (
    select public.org_reads_erp_ledger() as erp
  ), procs as (
    select p.id, p.org_id, p.currency, p.status, p.origin, p.total_value
      from public.procurements p where p.id = any (p_ids)
  ), held as (
    select h.procurement_id, h.held
      from pg_temp.old_ledger_held_many((select array_agg(id) from procs where (select erp from flag))) h
  ), paid as (
    select pay.procurement_id,
           count(*) filter (where pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity')
                               or pay.currency is distinct from p.currency) as bad,
           coalesce(sum(pay.amount), 0) as amount
      from procs p join public.payments pay on pay.procurement_id = p.id and pay.org_id = p.org_id
     where not (select erp from flag) and p.origin is distinct from 'erp_link'
       and pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.procurement_id
  ), invoiced as (
    select i.procurement_id,
           count(*) filter (where i.currency is distinct from p.currency
                               or i.amount::text in ('NaN','Infinity','-Infinity')) as bad,
           sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end) as pre_tax,
           sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
               - coalesce(i.withheld_amount, 0)) as payable
      from procs p join public.procurement_invoices i on i.procurement_id = p.id and i.org_id = p.org_id
     where not (select erp from flag) and p.origin is distinct from 'erp_link'
       and i.amount is not null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     group by i.procurement_id
  )
  select p.id,
         case
           when p.status::text in ('Cancelled','Rejected') then 0::numeric
           when (select erp from flag) then greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(h.held, 0))
           when p.origin = 'erp_link' then coalesce(p.total_value, 0)::numeric
           else (select case when x.paid is null then coalesce(p.total_value, 0)::numeric
                             else greatest(0::numeric, coalesce(p.total_value, 0) - x.paid) end
                   from (select case when pa.bad > 0 then null::numeric
                                     when coalesce(pa.amount, 0) = 0 then 0::numeric
                                     when iv.bad > 0 then null::numeric
                                     when iv.payable > 0 then round(pa.amount * iv.pre_tax / iv.payable, 2)
                                     else pa.amount end as paid) x)
         end
    from procs p
    left join held h on h.procurement_id = p.id
    left join paid pa on pa.procurement_id = p.id
    left join invoiced iv on iv.procurement_id = p.id
$function$;

create or replace function pg_temp.old_projects_delivery(p_ids uuid[])
 RETURNS TABLE(project_id uuid, delivery_pct numeric, committed_spend numeric, budget numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with eff as (
    select
      m.project_id,
      m.weight,
      coalesce(
        m.input_pct,
        count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
        0
      ) as effective_pct,
      (m.input_pct is not null or count(t.id) > 0) as has_signal
    from project_milestones m
    left join tasks t on (t.milestone_id = m.id
                          or exists (select 1 from task_groups g          -- #2679: a task in an active group linked to m
                                      where g.id = t.task_group_id and g.milestone_id = m.id and g.archived_at is null))
                     and t.archived_at is null
                     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)   -- #2807 leaf test, set-based (inline, not a per-row call)
    where m.project_id = any(p_ids)
    group by m.id
  ),
  -- The 0396 body selected the requested projects without an explicit org filter: under the caller's RLS that
  -- is the caller's org, and under service_role it is the requested set (the commitment figure stays NULL there,
  -- exactly as the per-project function returned). Keep that row set: rows are returned for EVERY requested
  -- project; only the commitment figure needs the four money roles, so that gate sits on its own CTE.
  proj as (
    select p.id, p.currency
      from public.projects p
     where p.id = any(p_ids)
  ),
  -- The per-project commitment position is exactly `sum(procurement_open_commitment)` over the project's
  -- committed-status purchases, in the project currency. 0723 already computes that CASE for many purchases
  -- in one set-based call (proved row for row by supabase/tests/0651_committed_spend_equivalence.test.sql),
  -- so the delivery read reuses it instead of calling the position once per project.
  cprocs as (
    select pr.id, pr.project_id, pr.currency, pr.total_value
      from public.procurements pr
      join proj on proj.id = pr.project_id
     where pr.org_id = public.auth_org_id()
       and pr.status::text = any (public.committed_procurement_statuses())
  ),
  open_commitment as materialized (
    select o.procurement_id, o.amount
      from pg_temp.old_open_commitments((select array_agg(id) from cprocs)) o
  ),
  commitment as (
    select proj.id as project_id,
           -- project_pmo_commitment_position: the project-currency open commitment, ignoring other currencies.
           coalesce(sum(o.amount) filter (where p.currency = proj.currency), 0) as amount,
           -- ...and complete only while every committed purchase is in the project currency and readable.
           coalesce(bool_and(coalesce(p.currency = proj.currency, false) and p.total_value is not null
                             and p.total_value::text not in ('NaN','Infinity','-Infinity')) filter (where p.id is not null), true) as complete
      from proj
      left join cprocs p on p.project_id = proj.id
      left join open_commitment o on o.procurement_id = p.id
     where public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     group by proj.id
  ),
  committed as (
    select
      proj.id as project_id,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = proj.id and v.status = 'Active'), 0) as budget,
      case when cm.complete then cm.amount else null end as committed_spend
    from proj
    left join commitment cm on cm.project_id = proj.id

  )
  select
    c.project_id,
    case
      when bool_or(e.has_signal) then sum(e.weight * e.effective_pct) / nullif(sum(e.weight), 0)
      else null
    end as delivery_pct,
    c.committed_spend,
    c.budget
  from committed c
  left join eff e on e.project_id = c.project_id
  group by c.project_id, c.committed_spend, c.budget;
$function$;

create or replace function pg_temp.old_money_collection(p_project_ids uuid[])
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

CREATE OR REPLACE FUNCTION public.project_erp_journal_lines(p_project_id uuid)
 RETURNS TABLE(erp_doctype text, voucher_no text, project_id uuid, account text, category budget_category, posting_date date, amount numeric, currency text, remarks text, party text, is_cancelled boolean, erp_url text, link_id uuid, procurement_id uuid, procurement_title text, possibly_reversed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_catalog, pg_temp
AS $function$
  select q.* from (with ln as (select * from public.erp_journal_cost_lines(public.auth_org_id(), p_project_id))
  select l.erp_doctype, l.voucher_no, l.project_id, l.account, l.category, l.posting_date, l.amount,
         o.default_currency, l.remarks, l.party, l.is_cancelled,
         case when b.site_url is null then null
              when b.external_tier = 'erpnext' then rtrim(b.site_url, '/') || '/app/journal-entry/' || l.voucher_no
              end,
         k.id, k.procurement_id, pr.title,
         k.id is not null and not l.is_cancelled and exists (
           select 1 from ln r where r.account = l.account and r.voucher_no <> l.voucher_no
              and r.amount < 0 and not r.is_cancelled and r.posting_date >= l.posting_date)
    from ln l
    join public.organizations o on o.id = public.auth_org_id()
    left join public.external_org_bindings b
      on b.org_id = o.id and b.external_tier = case when l.erp_doctype = 'account.move' then 'odoo' else 'erpnext' end
     and b.activated_at is not null
    left join public.erp_journal_line_links k
      on k.org_id = o.id and k.erp_doctype = l.erp_doctype and k.voucher_no = l.voucher_no
     and k.project_id = l.project_id and k.account = l.account
    left join public.procurements pr on pr.id = k.procurement_id
   where public.is_active_member()
     and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     and public.org_reads_erp_ledger()
     and public.project_money_in_scope(p_project_id)
   order by l.posting_date desc, l.voucher_no, l.account
) q where public.assert_not_light()
$function$;

grant execute on function pg_temp.old_ledger_held_many(uuid[]), pg_temp.old_open_commitments(uuid[]),
  pg_temp.old_projects_delivery(uuid[]), pg_temp.old_money_collection(uuid[]) to authenticated;

-- Fixtures. Org P (PMO basis), org E (ERP ledger basis), org B (another organisation).
insert into organizations (id, name, default_currency) values
  ('27970000-0000-0000-0000-0000000000a0','PLM P','IDR'), ('27970000-0000-0000-0000-0000000000e0','PLM E','IDR'),
  ('27970000-0000-0000-0000-0000000000b0','PLM B','IDR');
insert into auth.users (id, email) values
  ('27970000-0000-0000-0000-0000000000a1','plm-a1@example.test'), ('27970000-0000-0000-0000-0000000000a2','plm-a2@example.test'),
  ('27970000-0000-0000-0000-0000000000a3','plm-a3@example.test'), ('27970000-0000-0000-0000-0000000000a4','plm-a4@example.test'),
  ('27970000-0000-0000-0000-0000000000a5','plm-a5@example.test'),
  ('27970000-0000-0000-0000-0000000000e1','plm-e1@example.test'), ('27970000-0000-0000-0000-0000000000e2','plm-e2@example.test'),
  ('27970000-0000-0000-0000-0000000000e4','plm-e4@example.test'), ('27970000-0000-0000-0000-0000000000e5','plm-e5@example.test'),
  ('27970000-0000-0000-0000-0000000000b1','plm-b1@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000a0','P Fin','plm-a1@example.test','Finance','active'),
  ('27970000-0000-0000-0000-0000000000a2','27970000-0000-0000-0000-0000000000a0','P Admin','plm-a2@example.test','Admin','active'),
  ('27970000-0000-0000-0000-0000000000a3','27970000-0000-0000-0000-0000000000a0','P Exec','plm-a3@example.test','Executive','active'),
  ('27970000-0000-0000-0000-0000000000a4','27970000-0000-0000-0000-0000000000a0','P PM','plm-a4@example.test','Project Manager','active'),
  ('27970000-0000-0000-0000-0000000000a5','27970000-0000-0000-0000-0000000000a0','P Eng','plm-a5@example.test','Engineer','active'),
  ('27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000e0','E Fin','plm-e1@example.test','Finance','active'),
  ('27970000-0000-0000-0000-0000000000e2','27970000-0000-0000-0000-0000000000e0','E Admin','plm-e2@example.test','Admin','active'),
  ('27970000-0000-0000-0000-0000000000e4','27970000-0000-0000-0000-0000000000e0','E PM','plm-e4@example.test','Project Manager','active'),
  ('27970000-0000-0000-0000-0000000000e5','27970000-0000-0000-0000-0000000000e0','E Eng','plm-e5@example.test','Engineer','active'),
  ('27970000-0000-0000-0000-0000000000b1','27970000-0000-0000-0000-0000000000b0','B Fin','plm-b1@example.test','Finance','active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('27970000-0000-0000-0000-0000000000d1','27970000-0000-0000-0000-0000000000a0','P one','Ongoing Project','IDR','27970000-0000-0000-0000-0000000000a4'),
  ('27970000-0000-0000-0000-0000000000d2','27970000-0000-0000-0000-0000000000a0','P two','Ongoing Project','IDR',null),
  ('27970000-0000-0000-0000-0000000000d3','27970000-0000-0000-0000-0000000000e0','E one','Ongoing Project','IDR','27970000-0000-0000-0000-0000000000e4'),
  ('27970000-0000-0000-0000-0000000000d4','27970000-0000-0000-0000-0000000000e0','E two','Ongoing Project','IDR',null),
  ('27970000-0000-0000-0000-0000000000d5','27970000-0000-0000-0000-0000000000e0','E three, no budget','Ongoing Project','IDR',null);

-- Budgets: an Active version with lines on d1, d3, d4; a Draft-only project d2.
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('27970000-0000-0000-0000-0000000000f1','27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000000d1',1,'v1','Draft','IDR'),
  ('27970000-0000-0000-0000-0000000000f2','27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000000d2',1,'v1','Draft','IDR'),
  ('27970000-0000-0000-0000-0000000000f3','27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000d3',1,'v1','Draft','IDR'),
  ('27970000-0000-0000-0000-0000000000f4','27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000d4',1,'v1','Draft','IDR');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000000f1','Materials',1000),
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000000f1','Subcontractors',500),
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000000f2','Materials',77),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000f3','Materials',2000),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000f3','Subcontractors',900),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000f4','Subcontractors',400);

update budget_versions set status = 'Active' where id in ('27970000-0000-0000-0000-0000000000f1','27970000-0000-0000-0000-0000000000f3','27970000-0000-0000-0000-0000000000f4');

-- Org E: ledger basis, actuals snapshot, journal ledger rows mapped to the projects.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('27970000-0000-0000-0000-0000000000e0','erpnext','https://erp.example.test','plm-ref',
   '{"company":"Example Co","project_map":{"27970000-0000-0000-0000-0000000000d3":"ERP-D3","27970000-0000-0000-0000-0000000000d4":"ERP-D4"}}'::jsonb, now(), 'active');
insert into budget_category_account_map (org_id, category, erp_account) values
  ('27970000-0000-0000-0000-0000000000e0','Materials','5100-X'), ('27970000-0000-0000-0000-0000000000e0','Subcontractors','5200-X');
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at) values
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000d3','5100-X','2026',500,now(),'27970000-0000-0000-0000-0000000000c1',now()),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000d3','5200-X','2026',120,now(),'27970000-0000-0000-0000-0000000000c1',now()),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000000d4','5200-X','2026',300,now(),'27970000-0000-0000-0000-0000000000c1',now());
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, remarks, erp_modified) values
  ('27970000-0000-0000-0000-0000000000e0','g1a','Example Co','5100-X','ERP-D3','Journal Entry','JV-1','2026-03-01',700,0,false,'one','2026-03-01'),
  ('27970000-0000-0000-0000-0000000000e0','g1b','Example Co','5200-X','ERP-D3','Journal Entry','JV-1','2026-03-01',200,0,false,'one','2026-03-01'),
  ('27970000-0000-0000-0000-0000000000e0','g2a','Example Co','5100-X','ERP-D3','Journal Entry','JV-2','2026-03-05',50,0,false,null,'2026-03-05'),
  ('27970000-0000-0000-0000-0000000000e0','g2b','Example Co','5100-X','ERP-D3','Journal Entry','JV-2','2026-03-05',10,0,false,null,'2026-03-05'),
  ('27970000-0000-0000-0000-0000000000e0','g3a','Example Co','5200-X','ERP-D4','Journal Entry','JV-3','2026-03-09',400,0,false,null,'2026-03-09'),
  ('27970000-0000-0000-0000-0000000000e0','g4a','Example Co','5100-X','ERP-D3','Journal Entry','JV-4','2026-03-10',0,30,false,null,'2026-03-10'),
  ('27970000-0000-0000-0000-0000000000e0','g5a','Example Co','5100-X','ERP-D3','Journal Entry','JV-5','2026-03-11',90,0,false,null,'2026-03-11');

insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, origin) values
  -- org P (PMO basis): plain, paid, over-paid, other currency, linked origin, not committed
  ('27970000-0000-0000-0000-0000000001a1','27970000-0000-0000-0000-0000000000a0','p plain','27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000d1','IDR',1000,'Ordered',null),
  ('27970000-0000-0000-0000-0000000001a2','27970000-0000-0000-0000-0000000000a0','p paid','27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000d1','IDR',2000,'Paid',null),
  ('27970000-0000-0000-0000-0000000001a3','27970000-0000-0000-0000-0000000000a0','p usd','27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000d1','USD',40,'Received',null),
  ('27970000-0000-0000-0000-0000000001a4','27970000-0000-0000-0000-0000000000a0','p linked','27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000d2','IDR',900,'Paid','erp_link'),
  ('27970000-0000-0000-0000-0000000001a5','27970000-0000-0000-0000-0000000000a0','p cancelled','27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000d2','IDR',777,'Cancelled',null),
  ('27970000-0000-0000-0000-0000000001a6','27970000-0000-0000-0000-0000000000a0','p draft','27970000-0000-0000-0000-0000000000a1','27970000-0000-0000-0000-0000000000d2','IDR',111,'Draft',null),
  -- org E (ledger basis): plain; linked purchase documents; confirmed invoices; journal links on two projects; a journal capture
  ('27970000-0000-0000-0000-0000000001e1','27970000-0000-0000-0000-0000000000e0','e plain','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d3','IDR',1000,'Ordered',null),
  ('27970000-0000-0000-0000-0000000001e2','27970000-0000-0000-0000-0000000000e0','e docs','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d3','IDR',1000,'Paid','erp_link'),
  ('27970000-0000-0000-0000-0000000001e3','27970000-0000-0000-0000-0000000000e0','e invoices','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d3','IDR',3000,'Vendor Invoiced',null),
  ('27970000-0000-0000-0000-0000000001e4','27970000-0000-0000-0000-0000000000e0','e journal many','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d3','IDR',5000,'Ordered',null),
  ('27970000-0000-0000-0000-0000000001e5','27970000-0000-0000-0000-0000000000e0','e journal credit','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d3','IDR',800,'Ordered',null),
  ('27970000-0000-0000-0000-0000000001e6','27970000-0000-0000-0000-0000000000e0','e journal other project','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d4','IDR',600,'Ordered',null),
  ('27970000-0000-0000-0000-0000000001e7','27970000-0000-0000-0000-0000000000e0','e captured','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d3','IDR',1500,'Ordered',null),
  ('27970000-0000-0000-0000-0000000001e8','27970000-0000-0000-0000-0000000000e0','e usd','27970000-0000-0000-0000-0000000000e1','27970000-0000-0000-0000-0000000000d4','USD',50,'Paid',null),
  ('27970000-0000-0000-0000-0000000001e9','27970000-0000-0000-0000-0000000000e0','e eng','27970000-0000-0000-0000-0000000000e5','27970000-0000-0000-0000-0000000000d4','IDR',800,'Ordered',null);
insert into procurement_invoices (org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, withheld_amount, erp_docstatus) values
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000001a2','Paid',1000,'IDR','inclusive',100,0,null),
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000001a2','Paid',500,'IDR','exclusive',50,20,null),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e3','Paid',1000,'IDR','inclusive',100,0,1),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e3','Paid',500,'IDR','exclusive',50,0,1),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e8','Paid',80,'USD','inclusive',0,0,1);
insert into payments (org_id, procurement_id, status, amount, currency, date) values
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000001a2','Paid',1200,'IDR',current_date),
  ('27970000-0000-0000-0000-0000000000a0','27970000-0000-0000-0000-0000000001a3','Paid',10,'IDR',current_date);
insert into erp_purchase_documents (id, org_id, erp_doctype, erp_name, erp_docstatus, erp_modified, grand_total, net_total) values
  ('27970000-0000-0000-0000-0000000003d1','27970000-0000-0000-0000-0000000000e0','Purchase Invoice','PINV-1',1,'m1',600,550);
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id) values
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e2','27970000-0000-0000-0000-0000000003d1');
-- journal links: e4 carries three lines over two vouchers, e5 a credit-only voucher, e6 a line on the other project, e7 is journal-captured
insert into erp_journal_line_links (org_id, procurement_id, erp_doctype, voucher_no, project_id, account) values
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e4','Journal Entry','JV-1','27970000-0000-0000-0000-0000000000d3','5100-X'),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e4','Journal Entry','JV-1','27970000-0000-0000-0000-0000000000d3','5200-X'),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e4','Journal Entry','JV-2','27970000-0000-0000-0000-0000000000d3','5100-X'),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e5','Journal Entry','JV-4','27970000-0000-0000-0000-0000000000d3','5100-X'),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e6','Journal Entry','JV-3','27970000-0000-0000-0000-0000000000d4','5200-X'),
  ('27970000-0000-0000-0000-0000000000e0','27970000-0000-0000-0000-0000000001e7','Journal Entry','JV-5','27970000-0000-0000-0000-0000000000d3','5100-X');
insert into erp_purchase_captures (procurement_id, org_id, binding_id, request_id, payload, kind, stage, captured_by)
select '27970000-0000-0000-0000-0000000001e7', b.org_id, b.id, '27970000-0000-0000-0000-0000000004c1', '{}'::jsonb, 'journal', 'ordered', '27970000-0000-0000-0000-0000000000e1'
  from external_org_bindings b where b.org_id = '27970000-0000-0000-0000-0000000000e0' and b.external_tier = 'erpnext';

-- Every project, purchase and seeded member, read as the owner (RLS bypassed), so each caller is handed ids it can and cannot see.
create temp table plm_seed_members as select id, role::text as role from public.profiles where org_id = '00000000-0000-0000-0000-000000000001';
create temp table plm_ids as select
  (select array_agg(id order by id) from public.projects where org_id = '00000000-0000-0000-0000-000000000001') as seed_projects,
  (select array_agg(id order by id) from public.projects where id::text like '27970000-%') as fixture_projects,
  (select array_agg(id order by id) from public.procurements) as procurements;
grant select on plm_seed_members, plm_ids to authenticated;

-- One caller, one set of project ids: all four figures, old and new, EXCEPT both ways.
create function pg_temp.parity(p_label text, p_ids uuid[], p_money_allowed boolean) returns setof text language plpgsql as $$
declare
  lit text := format('%L::uuid[]', p_ids);
  plit text := format('%L::uuid[]', (select procurements from plm_ids));
begin
  if p_money_allowed then
    return next is_empty(format('select * from pg_temp.old_money_collection(%s) except select * from public.get_projects_money_collection(%s)', lit, lit),
      p_label || ': money column, old minus new is empty');
    return next is_empty(format('select * from public.get_projects_money_collection(%s) except select * from pg_temp.old_money_collection(%s)', lit, lit),
      p_label || ': money column, new minus old is empty');
  else
    return next throws_ok(format('select * from pg_temp.old_money_collection(%s)', lit), '42501', null, p_label || ': money column, old refuses');
    return next throws_ok(format('select * from public.get_projects_money_collection(%s)', lit), '42501', null, p_label || ': money column, new refuses the same way');
  end if;
  return next is_empty(format('select * from pg_temp.old_projects_delivery(%s) except select * from public.get_projects_delivery(%s)', lit, lit),
    p_label || ': delivery columns, old minus new is empty');
  return next is_empty(format('select * from public.get_projects_delivery(%s) except select * from pg_temp.old_projects_delivery(%s)', lit, lit),
    p_label || ': delivery columns, new minus old is empty');
  return next is_empty(format('select * from pg_temp.old_ledger_held_many(%s) except select * from public.procurement_ledger_held_many(%s)', plit, plit),
    p_label || ': held amounts, old minus new is empty');
  return next is_empty(format('select * from public.procurement_ledger_held_many(%s) except select * from pg_temp.old_ledger_held_many(%s)', plit, plit),
    p_label || ': held amounts, new minus old is empty');
  return next is_empty(format('select * from pg_temp.old_open_commitments(%s) except select * from public.procurement_open_commitments(%s)', plit, plit),
    p_label || ': open commitments, old minus new is empty');
  return next is_empty(format('select * from public.procurement_open_commitments(%s) except select * from pg_temp.old_open_commitments(%s)', plit, plit),
    p_label || ': open commitments, new minus old is empty');
end $$;
grant execute on function pg_temp.parity(text, uuid[], boolean) to authenticated;

-- Every seeded member, in turn, over every seeded project.
create function pg_temp.parity_seed() returns setof text language plpgsql as $$
declare m record;
begin
  for m in select id, role from plm_seed_members order by role, id loop
    perform set_config('request.jwt.claims', json_build_object('sub', m.id, 'role', 'authenticated')::text, true);
    return query select * from pg_temp.parity('seed ' || m.role, (select seed_projects from plm_ids),
                                               m.role in ('Admin','Finance','Executive','Project Manager'));
  end loop;
end $$;
grant execute on function pg_temp.parity_seed() to authenticated;

set local role authenticated;

-- Non-vacuity: the fixtures produce figures, so an empty EXCEPT means equal figures, not no figures.
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*) from public.get_projects_money_collection((select fixture_projects from plm_ids)))::int, 3,
  'fixtures: the ledger-basis Finance member reads money for its three projects');
select ok((select count(*) from public.procurement_ledger_held_many((select procurements from plm_ids)) where held > 0) >= 5,
  'fixtures: the ledger-basis held amounts are non-zero for the invoice, document and journal purchases');
select is((select held from public.procurement_ledger_held_many(array['27970000-0000-0000-0000-0000000001e4']::uuid[])), 960::numeric,
  'fixtures: three journal lines over two vouchers are held as their sum, 700 + 200 + 60 (pinned)');
select is((select held from public.procurement_ledger_held_many(array['27970000-0000-0000-0000-0000000001e5']::uuid[])), 0::numeric,
  'fixtures: a credit-only journal line holds nothing');
select is((select held from public.procurement_ledger_held_many(array['27970000-0000-0000-0000-0000000001e7']::uuid[])), 1500::numeric,
  'fixtures: a journal-captured purchase holds its whole value');

select * from pg_temp.parity('E Finance', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select * from pg_temp.parity('E Admin', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000e4","role":"authenticated"}';
select * from pg_temp.parity('E Project Manager', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select * from pg_temp.parity('E Engineer', (select fixture_projects from plm_ids), false);

set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select * from pg_temp.parity('P Finance', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select * from pg_temp.parity('P Admin', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select * from pg_temp.parity('P Executive', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select * from pg_temp.parity('P Project Manager', (select fixture_projects from plm_ids), true);
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select * from pg_temp.parity('P Engineer', (select fixture_projects from plm_ids), false);

-- A second organisation is handed every other organisation's ids and reads nothing, old or new.
set local request.jwt.claims = '{"sub":"27970000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select * from pg_temp.parity('B Finance', (select fixture_projects from plm_ids), true);
select is((select count(*) from public.get_projects_money_collection((select fixture_projects from plm_ids)))::int, 0,
  'another organisation: the money read returns no row for other organisations'' projects');
select is((select count(*) from public.procurement_ledger_held_many((select procurements from plm_ids)) h
            where h.procurement_id::text like '27970000-%'), 0::bigint,
  'another organisation: no held amount for other organisations'' purchases');

-- The seeded organisation: every seeded member over every seeded project.
select * from pg_temp.parity_seed();

reset role;
select ok(not has_function_privilege('anon', 'public.get_projects_money_collection(uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.get_projects_money_collection(uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.procurement_ledger_held_many(uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.procurement_ledger_held_many(uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.project_mapped_actuals_for(uuid[], text)', 'execute')
      and not has_function_privilege('authenticated', 'public.project_mapped_actuals_for(uuid[], text)', 'execute'),
  'grants: the two reads keep their signed-in-only grant; the new internal read has no client grant');
select ok((select p.prosecdef and p.proconfig = array['search_path=public, pg_catalog, pg_temp'] from pg_proc p where p.oid = 'public.procurement_ledger_held_many(uuid[])'::regprocedure)
      and (select p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'public.get_projects_money_collection(uuid[])'::regprocedure),
  'definer status and search path unchanged on both reads');

select * from finish();
rollback;
