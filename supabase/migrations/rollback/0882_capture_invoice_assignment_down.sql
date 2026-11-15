-- Down for 0882 (#2195 B1). Run this whole file in ONE transaction. Pause assignment and payment traffic first; on lock-not-available, retry.
-- It restores every function 0882 replaced to its exact previous body, then removes what 0882 added. It refuses while any assignment
-- decision exists, because dropping the table would erase the audit record of who placed which invoice.
lock table public.erp_capture_invoice_assignments in access exclusive mode nowait;
lock table public.erp_purchase_captures in access exclusive mode nowait;
lock table public.procurement_erp_links in access exclusive mode nowait;
lock table public.erp_purchase_document_marks in access exclusive mode nowait;
do $$
begin
  if exists (select 1 from public.erp_capture_invoice_assignments) then
    raise exception 'assignment_history_exists' using errcode = '55000';
  end if;
end $$;

-- restored: 0471 engine
create or replace function public.cost_attribution_engine(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                               p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(source text, gl_id uuid, rule_id uuid, rule_key uuid, version int, asset_id uuid, project_id uuid, account text,
              fiscal_year text, posting_date date, party_type text, amount numeric, as_of timestamptz, pool numeric,
              driver text, driver_value numeric, driver_total numeric, line_count int, entry_count int, status text)
language sql stable set search_path = public, pg_temp as $$
  with draft as (
    select coalesce((p_draft->>'rule_key')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as rule_key
    where p_draft is not null
  ), eq_versions as (                                                                                 -- 0471
    select v.* from public.equipment_settings_effective(p_org_id, p_equipment_draft) v where v.basis = 'actual_cost'  -- 0471
  ), rules as (
    select r.id, r.rule_key, r.specificity, r.match_account, r.match_account_group, r.match_cost_center,
           r.match_party_type, r.match_party, r.effective_from, r.effective_to, 'rule'::text as source          -- 0471 source
      from public.cost_attribution_rules r
     where r.org_id = p_org_id and r.is_current
       and r.rule_key is distinct from p_exclude_rule_key
       and not exists (select 1 from draft d where d.rule_key = r.rule_key)
    union all
    select null::uuid, d.rule_key, (p_draft->>'specificity')::int, p_draft->>'account', p_draft->>'account_group',
           p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'effective_from')::date, (p_draft->>'effective_to')::date, 'rule'                         -- 0471 source
      from draft d
    union all                                                                                         -- 0471
    select v.id, v.setting_key, v.specificity, v.match_account, v.match_account_group, v.match_cost_center,   -- 0471
           v.match_party_type, v.match_party, v.window_from, nullif(v.window_to, 'infinity'::date), 'equipment'  -- 0471
      from eq_versions v                                                                              -- 0471
  ), targets as (
    select r.rule_key, t.position::int as position, t.project_id, t.percent
      from rules r join public.cost_attribution_rule_targets t on t.rule_id = r.id
    union all
    select d.rule_key, (e.ord - 1)::int, (e.v->>'project_id')::uuid, (e.v->>'percent')::numeric
      from draft d cross join lateral jsonb_array_elements(p_draft->'targets') with ordinality e(v, ord)
  ), project_rules as (
    select distinct t.rule_key from targets t where p_project_id is null or t.project_id = p_project_id
    union                                                                                             -- 0471
    select v.setting_key from eq_versions v                                                           -- 0471
     where p_project_id is null or exists (select 1 from public.equipment_usage_entries e             -- 0471
             where e.org_id = p_org_id and e.asset_id = v.asset_id and e.project_id = p_project_id    -- 0471
               and e.status = 'Approved' and e.archived_at is null)                                   -- 0471
  ), rule_accounts as (
    select r.*, r.match_account as acct from rules r where r.match_account is not null
    union all
    select r.*, a.erp_name
      from rules r
      join public.erp_account_mirror g on g.org_id = p_org_id and g.erp_name = r.match_account_group and g.is_group
      join public.erp_account_mirror a on a.org_id = p_org_id and a.company = g.company
                                       and a.lft > g.lft and a.rgt < g.rgt and not a.is_group
     where r.match_account_group is not null
  ), scan_accounts as (
    select distinct ra.acct from rule_accounts ra join project_rules pr on pr.rule_key = ra.rule_key
  ), ledger as materialized (                                 -- 0471 NFR-EQU-003: read once, then hash-joined to the rules on the cost centre
    select l.id, l.account, l.cost_center, l.party, l.party_type, l.fiscal_year, l.posting_date, l.debit - l.credit as net, l.as_of
      from scan_accounts sa
      join public.erp_gl_entry_mirror l
        on l.org_id = p_org_id and l.account = sa.acct
       and coalesce(l.project, '') = '' and not l.is_cancelled
  ), candidates as (                                          -- the 0376 join, split on the cost centre so each half is an equi-join
    select l.id as gl_id, ra.id as rule_id, ra.rule_key, ra.source, ra.specificity, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.net, l.as_of
      from ledger l
      join rule_accounts ra
        on ra.acct = l.account and ra.match_cost_center = l.cost_center
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
    union all
    select l.id, ra.id, ra.rule_key, ra.source, ra.specificity, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.net, l.as_of
      from ledger l
      join rule_accounts ra
        on ra.acct = l.account and ra.match_cost_center is null
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
  ), winners as (
    select distinct on (c.gl_id) c.gl_id, c.rule_id, c.rule_key, c.source, c.account, c.fiscal_year, c.posting_date,
           c.party_type, c.net, c.as_of
      from candidates c
     order by c.gl_id, c.specificity desc, c.rule_key
  ), shares as (
    select w.*, t.project_id, t.position, round(w.net * t.percent / 100, 2) as share,
           row_number() over (partition by w.gl_id order by t.position desc) = 1 as is_last
      from winners w join targets t on t.rule_key = w.rule_key
     where w.source = 'rule' and w.rule_key in (select pr.rule_key from project_rules pr)                -- 0471 source
  ), placed as (
    select s.gl_id, s.rule_id, s.rule_key, s.project_id, s.account, s.fiscal_year, s.posting_date, s.party_type,
           case when s.is_last then s.net - (sum(s.share) over (partition by s.gl_id) - s.share) else s.share end as amount,
           s.as_of
      from shares s
  ), eq_pools as (                                                                                    -- 0471 FR-EQU-041/042
    select w.rule_id, w.rule_key, date_trunc('month', w.posting_date)::date as month, w.account, w.fiscal_year, w.party_type,
           sum(w.net) as pool, count(*)::int as line_count, max(w.as_of) as as_of
      from winners w where w.source = 'equipment'
     group by 1, 2, 3, 4, 5, 6
  ), eq_all as materialized (                                                                         -- 0471 aggregated once, not per version
    select u.* from public.equipment_usage_by_project(p_org_id) u where u.asset_id in (select v.asset_id from eq_versions v)
  ), eq_usage as materialized (                                                                                    -- 0471 OQ-2, OQ-6
    select v.setting_key, v.id as version_id, u.month, u.project_id,
           sum(case v.driver when 'units' then u.quantity when 'fuel' then u.fuel_litres else u.trips end) as driver_value,
           sum(u.entry_count)::int as entry_count
      from eq_versions v join eq_all u on u.asset_id = v.asset_id
     where (u.kind = 'work' or v.count_standby)
       and (v.driver <> 'units' or u.unit = v.rate_unit)       -- never add hours to days (FR-EQU-032 refuses the mix; this holds if one slipped in)
     group by 1, 2, 3, 4
  ), eq_split as (                                                                                    -- 0471
    select p.*, v.version, v.asset_id, v.driver, x.project_id, x.driver_value, x.entry_count,
           sum(x.driver_value) over (partition by p.rule_key, p.rule_id, p.month, p.account, p.fiscal_year, p.party_type) as driver_total
      from eq_pools p
      join eq_versions v on v.setting_key = p.rule_key and v.id is not distinct from p.rule_id
      left join eq_usage x on x.setting_key = p.rule_key and x.version_id is not distinct from p.rule_id
                          and x.month = p.month and x.driver_value > 0
  ), eq_shares as (                                                                                   -- 0471 PQ-6
    select s.*, round(s.pool * s.driver_value / s.driver_total, 2) as share,
           row_number() over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type
                              order by s.project_id desc) = 1 as is_last
      from eq_split s where s.driver_total > 0
  ), eq_placed as (                                                                                   -- 0471 FR-CAT-022
    select s.*, case when s.is_last
                     then s.pool - (sum(s.share) over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type) - s.share)
                     else s.share end as amount
      from eq_shares s
  )
  select 'rule'::text, p.gl_id, p.rule_id, p.rule_key, null::int, null::uuid, p.project_id, p.account, p.fiscal_year,
         p.posting_date, p.party_type, p.amount, p.as_of, null::numeric, null::text, null::numeric, null::numeric, 1,
         null::int, 'allocated'::text
    from placed p where p_project_id is null or p.project_id = p_project_id
  union all                                                                                           -- 0471
  select 'equipment', null, e.rule_id, e.rule_key, e.version, e.asset_id, e.project_id, e.account, e.fiscal_year, e.month,
         e.party_type, e.amount, e.as_of, e.pool, e.driver, e.driver_value, e.driver_total, e.line_count, e.entry_count, 'allocated'
    from eq_placed e where p_project_id is null or e.project_id = p_project_id
  union all                                                                                           -- 0471 never dropped
  select distinct on (s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type)
         'equipment', null, s.rule_id, s.rule_key, s.version, s.asset_id, null::uuid, s.account, s.fiscal_year, s.month,
         s.party_type, s.pool, s.as_of, s.pool, s.driver, null::numeric, 0::numeric, s.line_count, 0, 'unallocated'
    from eq_split s where coalesce(s.driver_total, 0) = 0 and p_project_id is null
$$;

-- restored: 0471 allocations
create or replace function public.cost_attribution_allocations(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                                    p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(gl_id uuid, rule_id uuid, rule_key uuid, project_id uuid, account text, fiscal_year text,
              posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select e.gl_id, e.rule_id, e.rule_key, e.project_id, e.account, e.fiscal_year, e.posting_date, e.party_type, e.amount, e.as_of
    from public.cost_attribution_engine(p_org_id, p_draft, p_exclude_rule_key, p_project_id, p_equipment_draft) e
   where e.status = 'allocated'      -- an unallocated pool reaches no project figure
$$;

-- restored: 0720 org actuals
create or replace function public.cost_attribution_org_actuals(p_fiscal_year text default null)
returns table(project_id uuid, category public.budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.project_id, m.category, count(*),
         case when count(*) filter (where a.amount is null or a.amount::text in ('NaN','Infinity','-Infinity')) > 0
              then null else sum(a.amount) end,
         sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, null) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and (exists (select 1 from public.cost_attribution_rules r where r.org_id = public.auth_org_id() and r.is_current)   -- 0720
          or exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'actual_cost'))
     and (p_fiscal_year is null or a.fiscal_year = p_fiscal_year)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
   group by a.project_id, m.category
$$;

-- restored: 0794 project actuals
create or replace function public.cost_attribution_project_actuals(p_project_id uuid, p_fiscal_year text default null)
returns table(category public.budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.category, count(*),
         case when count(*) filter (where a.amount is null or a.amount::text in ('NaN','Infinity','-Infinity')) > 0
              then null else sum(a.amount) end,
         sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, p_project_id) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and (exists (select 1 from public.cost_attribution_rules r where r.org_id = public.auth_org_id() and r.is_current)   -- 0721
          or exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'actual_cost'))
     and (p_fiscal_year is null or a.fiscal_year = p_fiscal_year)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by m.category
$$;

-- restored: 0380 linker
create or replace function public.link_erp_purchase_documents(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_results jsonb := '[]'::jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_created uuid[] := '{}';
  v_row jsonb; v_n integer := 0; v_matches integer;
  v_doc public.erp_purchase_documents%rowtype;
  v_proc public.procurements%rowtype;
  v_existing uuid; v_target uuid; v_project uuid; v_vendor uuid;
  v_group_key text; v_outcome text; v_reason text; v_gate text; v_vendor_name text;
  v_step public.procurement_status; v_sp jsonb; v_new boolean;
  v_orders text[]; v_sp_ok boolean; v_before numeric;                                                      -- 0372
  v_vendor_suppliers text[];                                                                               -- 0380
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Only Admin, Executive, Project Manager or Finance members can link ERP documents.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Send 1 to 500 rows per call.' using errcode = '22023';
  end if;

  begin  -- the batch; a dry run is rolled back at the end of this block (FR-PFE-030)
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_n := v_n + 1;
      v_outcome := 'link'; v_reason := null; v_target := null; v_new := false; v_doc := null; v_proc := null;
      begin  -- one row: a refusal rolls back this row only
        if jsonb_typeof(v_row) <> 'object' or coalesce(btrim(v_row->>'erp_name'), '') = '' then
          raise exception using errcode = 'PFE02', message = 'erp_name_missing';
        end if;
        select count(*) into v_matches from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'));
        if v_matches = 0 then raise exception using errcode = 'PFE02', message = 'document_not_found'; end if;
        if v_matches > 1 then raise exception using errcode = 'PFE02', message = 'document_ambiguous'; end if;
        -- 0372: an order and the invoices billing it are linked one at a time — the lock on the ERP order name(s) is
        -- taken before the document and the purchase are locked, so the order/invoice checks below see any link of
        -- the same order another call has committed. Lock order: order names (sorted), document, purchase.
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'));
        v_orders := public.erp_order_family(v_doc.erp_doctype, v_doc.erp_name, v_doc.purchase_orders);           -- 0372
        perform public.lock_erp_order_family(v_org, v_orders);                                                   -- 0372
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'))
         for update;
        -- 0372: the mirror may have changed the orders an invoice bills in between; lock any new one too.
        perform public.lock_erp_order_family(v_org, array(
          select unnest(public.erp_order_family(v_doc.erp_doctype, v_doc.erp_name, v_doc.purchase_orders))
          except select unnest(v_orders)));
        if v_doc.erp_docstatus <> 1 then raise exception using errcode = 'PFE02', message = 'document_cancelled'; end if;
        -- 0378: recorded by PMO = a procurement reference to a live PMO record of this document's kind, read now (M-2:
        -- the mirror's pmo_owned stamp may predate a push or outlive the record).
        if public.erp_document_recorded_by_pmo(v_org, v_doc.erp_doctype, v_doc.erp_name) then
          raise exception using errcode = 'PFE02', message = 'document_recorded_by_pmo';
        end if;
        -- M-6: returns / debit notes are not linked.
        if v_doc.is_return then raise exception using errcode = 'PFE02', message = 'document_is_return'; end if;
        -- 0372: an invoice recorded against several projects in ERPNext is not linked into one purchase: the purchase
        -- would deduct the whole invoice while each project's actuals carry only its share. Link it per project from
        -- ERPNext, or record it in PMO.
        if v_doc.erp_doctype = 'Purchase Invoice' and cardinality(v_doc.project_ids) > 1 then
          raise exception using errcode = 'PFE02', message = 'document_spans_projects';
        end if;
        -- 0372: a SharePoint file sent with the link must be on the organisation's own SharePoint host (the rule
        -- link_procurement_sharepoint_item and link_m365_documents_batch apply).
        v_sp := v_row -> 'sharepoint';
        if v_sp is not null and jsonb_typeof(v_sp) = 'object' then
          begin
            v_sp_ok := public.sharepoint_url_on_org_host(v_org, v_sp->>'web_url');
          exception when invalid_parameter_value then
            raise exception using errcode = 'PFE02', message = 'm365_not_configured';
          end;
          if not v_sp_ok then raise exception using errcode = 'PFE02', message = 'sharepoint_host_not_allowed'; end if;
        end if;

        v_target  := nullif(btrim(v_row->>'procurement_id'), '')::uuid;
        v_project := nullif(btrim(v_row->>'project_id'), '')::uuid;
        select l.procurement_id into v_existing from public.procurement_erp_links l where l.erp_purchase_document_id = v_doc.id;
        if found then
          if v_target is null or v_target = v_existing then
            -- FR-PFE-028 re-runs: a row that named no purchase re-joins its group's existing linked purchase,
            -- so a fixed sibling row in the same group links there instead of creating a second purchase.
            -- (Variables survive the PFE03 rollback below; only data changes are undone.)
            if v_target is null and exists (select 1 from public.procurements p
                                             where p.id = v_existing and p.origin = 'erp_link'
                                               and p.project_id is not distinct from v_project) then
              v_groups := v_groups || jsonb_build_object(
                coalesce(v_project::text, '-') || '|' || coalesce(nullif(btrim(v_row->>'group'), ''), v_doc.erp_name), v_existing);
            end if;
            v_target := v_existing; v_reason := 'already_linked';
            raise exception using errcode = 'PFE03', message = 'skip';
          end if;
          raise exception using errcode = 'PFE02', message = 'document_linked_to_another_purchase';
        end if;

        if v_target is null then
          if v_project is not null and not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
            raise exception using errcode = 'PFE02', message = 'project_not_found';
          end if;
          v_group_key := coalesce(v_project::text, '-') || '|' || coalesce(nullif(btrim(v_row->>'group'), ''), v_doc.erp_name);
          v_target := (v_groups ->> v_group_key)::uuid;
          if v_target is null then
            v_vendor := public.erp_supplier_company(v_org, v_doc.supplier, v_doc.supplier_name);                   -- 0369
            insert into public.procurements (org_id, code, title, requested_by_id, project_id, vendor_id, budget_category, currency, total_value, origin)
            values (v_org, public.next_procurement_doc_number(v_org, 'PROC'),                                      -- 0369
                    coalesce(nullif(btrim(v_row->>'title'), ''), concat_ws(' ', coalesce(v_doc.supplier_name, v_doc.supplier), v_doc.erp_name)),
                    v_uid, v_project, v_vendor, nullif(btrim(v_row->>'budget_category'), '')::public.budget_category,
                    v_doc.currency, 0, 'erp_link')
            returning id into v_target;
            v_new := true;
          end if;
        end if;

        select * into v_proc from public.procurements where id = v_target for update;
        if not found or v_proc.org_id is distinct from v_org then raise exception using errcode = 'PFE02', message = 'purchase_not_found'; end if;
        if v_proc.status::text in ('Cancelled','Rejected') then raise exception using errcode = 'PFE02', message = 'purchase_closed'; end if;
        if v_doc.currency is distinct from v_proc.currency then raise exception using errcode = 'PFE02', message = 'currency_mismatch'; end if;
        if cardinality(v_doc.project_ids) > 0
           and (v_proc.project_id is null or not (v_proc.project_id = any (v_doc.project_ids))) then
          raise exception using errcode = 'PFE02', message = 'project_mismatch';
        end if;
        -- I-3: an invoice with no project in ERPNext would lower this project's commitment while its actuals miss it.
        if v_doc.erp_doctype = 'Purchase Invoice' and cardinality(v_doc.project_ids) = 0 and v_proc.project_id is not null then
          raise exception using errcode = 'PFE02', message = 'document_has_no_project';
        end if;
        if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = v_proc.id and d.supplier is distinct from v_doc.supplier) then
          raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
        end if;
        if v_proc.vendor_id is not null then
          v_vendor_name := null;
          -- 0380: the vendor's ERPNext supplier ids: 'Supplier:<id>' references with the prefix removed, plus a legacy bare
          -- reference; a 'Customer:' reference (a party that is also a customer), or any other doctype's, is not one.
          select array_agg(case when x.external_record_id like 'Supplier:%' then substr(x.external_record_id, 10)
                                else x.external_record_id end)
            into v_vendor_suppliers from public.external_refs x
           where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext' and x.pmo_record_id = v_proc.vendor_id::text
             and x.external_record_id !~ '^(Customer|Contact|Employee):';
          if cardinality(v_vendor_suppliers) > 0 then                                                              -- 0380
            if v_doc.supplier is null or not (v_doc.supplier = any (v_vendor_suppliers)) then                      -- 0380
              raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
            end if;
          else
            select c.name into v_vendor_name from public.companies c where c.id = v_proc.vendor_id;
            if lower(btrim(coalesce(v_vendor_name, ''))) is distinct from lower(btrim(coalesce(v_doc.supplier_name, v_doc.supplier, '')))
               and not exists (select 1 from public.companies c where c.id = v_proc.vendor_id and c.org_id = v_org and c.erp_supplier_name = v_doc.supplier) then  -- 0369
              raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
            end if;
          end if;
        end if;
        -- I-2: an invoice and the ERP order it bills sit in one purchase (else the order stays committed in
        -- one purchase while the ledger holds its invoice under another — a double count).
        if v_doc.erp_doctype = 'Purchase Invoice' and exists (
             select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
              where d.org_id = v_org and d.erp_doctype = 'Purchase Order' and d.erp_name = any (v_doc.purchase_orders)
                and l.procurement_id <> v_proc.id) then
          raise exception using errcode = 'PFE02', message = 'order_linked_to_another_purchase';
        end if;
        if v_doc.erp_doctype = 'Purchase Order' and exists (
             select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
              where d.org_id = v_org and d.erp_doctype = 'Purchase Invoice' and v_doc.erp_name = any (d.purchase_orders)
                and l.procurement_id <> v_proc.id) then
          raise exception using errcode = 'PFE02', message = 'invoice_linked_to_another_purchase';
        end if;
        v_step := case v_doc.erp_doctype when 'Purchase Order' then 'Ordered' when 'Purchase Receipt' then 'Received'
                    when 'Purchase Invoice' then 'Vendor Invoiced' else 'Paid' end;
        v_gate := public.procurement_gate_violation(v_proc.id, v_step);
        if v_gate is not null then raise exception using errcode = 'PFE02', message = v_gate; end if;

        v_before := public.erp_linked_documents_total(v_proc.id);                                                -- 0372
        insert into public.procurement_erp_links (org_id, procurement_id, erp_purchase_document_id, linked_by)
        values (v_org, v_proc.id, v_doc.id, v_uid);
        -- FR-PFE-016 approver ≠ payer on the link path. Checked here, not left to the update guard: at 0361
        -- that guard only covers amount_approved_by_id (0362 widens it); the check stays as defence in depth.
        if v_proc.status::text <> 'Paid' and public.procurement_evidenced_step(v_proc.id) = 'Paid'
           and v_uid is not null and (v_uid = v_proc.approved_by_id or v_uid = v_proc.amount_approved_by_id) then
          raise exception using errcode = 'PFE02', message = 'separation_of_duties';
        end if;
        if v_proc.vendor_id is null then
          update public.procurements p set vendor_id = x.pmo_record_id::uuid
            from (select pmo_record_id from public.external_refs
                   where org_id = v_org and domain = 'companies' and external_tier = 'erpnext'
                     and external_record_id in ('Supplier:' || v_doc.supplier, v_doc.supplier)                          -- 0380
                     and pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                   order by created_at limit 1) x
           where p.id = v_proc.id and p.vendor_id is null;
        end if;
        if v_proc.origin = 'erp_link' then perform public.refresh_erp_linked_purchase_total(v_proc.id);
        else perform public.refresh_native_purchase_total_from_links(v_proc.id, v_before);                       -- 0372
        end if;
        perform public.advance_procurement_status(v_proc.id, 'Derived: linked ERPNext ' || v_doc.erp_doctype || ' ' || v_doc.erp_name);
        if v_sp is not null and jsonb_typeof(v_sp) = 'object' then                                              -- 0372: checked above
          insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
          values (v_org, v_proc.id, 'Microsoft reference', v_sp->>'web_url', 'onedrive', v_sp->>'drive_id', v_sp->>'item_id',
                  v_sp->>'name', v_sp->>'kind', 'erp_document', v_doc.id);
        end if;
        perform public.log_audit('procurement.erp_link', v_org, v_uid, v_proc.id,
          jsonb_build_object('erp_doctype', v_doc.erp_doctype, 'erp_name', v_doc.erp_name, 'new_purchase', v_new));
        if v_new then
          v_groups := v_groups || jsonb_build_object(v_group_key, v_proc.id);
          v_created := v_created || v_proc.id;
        end if;
      exception
        when sqlstate 'PFE03' then v_outcome := 'skip';
        when sqlstate 'PFE02' then v_outcome := 'refused'; v_reason := sqlerrm; v_target := null;
        when invalid_text_representation then v_outcome := 'refused'; v_reason := 'invalid_id'; v_target := null;
        -- M-6: reasons are codes; raw error text never leaves the function (it goes to the server log).
        when insufficient_privilege then v_outcome := 'refused'; v_target := null;
          v_reason := case when sqlerrm like 'separation of duties%' then 'separation_of_duties' else 'not_permitted' end;
        when check_violation then v_outcome := 'refused'; v_target := null;
          v_reason := case when sqlerrm like 'Cannot pay without a recorded approved amount%' then 'approval_missing'
                           when sqlerrm like 'This purchase is awaiting approval%' then 'awaiting_approval'  -- 0362 (Requested never derives)
                           when sqlerrm like 'Vendor bill exceeds the approved amount%' then 'exceeds_approved_amount'
                           else 'rule_violation' end;
          raise log 'link_erp_purchase_documents row %: % %', v_n, sqlstate, sqlerrm;
        when others then v_outcome := 'refused'; v_target := null; v_reason := 'internal_error';
          raise log 'link_erp_purchase_documents row %: % %', v_n, sqlstate, sqlerrm;
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_n, 'erp_doctype', v_doc.erp_doctype, 'erp_name', coalesce(v_doc.erp_name, v_row->>'erp_name'),
        'outcome', v_outcome, 'reason', v_reason,
        'procurement_id', case when p_dry_run and v_target = any (v_created) then null else v_target end,
        'new_purchase', coalesce(v_target = any (v_created), false)));
    end loop;
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception when sqlstate 'PFE01' then null;
  end;
  return jsonb_build_object(
    'dry_run', p_dry_run,
    'counts', jsonb_build_object(
      'link',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'link'),
      'skip',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'skip'),
      'refused', (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'refused')),
    'results', v_results);
end $$;

-- restored: 0868 undo
create or replace function public.undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_kind text; v_proc public.procurements%rowtype; v_history jsonb;
begin
  select kind into v_kind from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id;
  if v_kind is null or v_kind='journal' then
    return public.undo_captured_journal_purchase(p_procurement_id,p_reason,p_dry_run);
  end if;
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then raise exception 'not authorized' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'reason_required' using errcode='22023'; end if;
  select * into v_proc from public.procurements where id=p_procurement_id and org_id=v_org for update;
  if not found or not v_proc.record_only or v_kind not in ('order','supplier_invoice') then raise exception 'purchase_not_found' using errcode='P0002'; end if;
  perform 1 from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id for update;
  select coalesce(jsonb_agg(distinct s.value order by s.value),'[]'::jsonb) into v_history
    from public.erp_purchase_captures c cross join lateral jsonb_array_elements(c.payload->'source_ids') s(value)
    where c.org_id=v_org and c.procurement_id=p_procurement_id;
  if v_proc.status='Cancelled' then return jsonb_build_object('outcome','skip','reason','already_undone'); end if;
  if exists(select 1 from public.external_command_outbox o where o.org_id=v_org and o.domain='procurement' and o.operation='create'
    and o.payload->>'erp_doc_kind'='payment' and public.procurement_case_uuid(o.payload->>'procurementId')=p_procurement_id
    and o.payload ? 'capturedInvoiceDocumentId'
    and (o.state in ('pending','committing','committed','quarantined','held')
         or (o.state='failed' and o.attempt_count<public.outbox_max_auto_attempts()))) then
    raise exception 'has_later_pmo_steps' using errcode='55000';
  end if;
  if exists(select 1 from public.purchase_requests where procurement_id=p_procurement_id)
    or exists(select 1 from public.rfqs where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_quotations where procurement_id=p_procurement_id)
    or exists(select 1 from public.purchase_orders where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_receipts where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_invoices where procurement_id=p_procurement_id)
    or exists(select 1 from public.payments where procurement_id=p_procurement_id) then
    raise exception 'has_later_pmo_steps' using errcode='55000';
  end if;
  if not p_dry_run then
    update public.procurement_documents set record_kind=null,record_id=null
      where procurement_id=p_procurement_id and record_kind='erp_document';
    delete from public.procurement_erp_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(),undo_reason=p_reason where org_id=v_org and procurement_id=p_procurement_id;
    update public.procurements set status='Cancelled',updated_at=now() where id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history,
        'reason',p_reason,'assignment_origin','erp_project','actuals_delta',0));
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false);
end $$;

drop function public.purchase_capture_assignment_report(uuid);
drop function public.assign_capture_invoices(jsonb,text,boolean);
drop function public.capture_assignment_row(uuid,uuid,uuid,jsonb,text,boolean,jsonb);
drop function public.capture_assignment_batch(uuid,uuid[]);
drop function public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb);
drop function public.capture_assignment_claim(uuid,uuid,uuid,jsonb,text,boolean);
drop trigger erp_purchase_document_marks_release_set_aside on public.erp_purchase_document_marks;
drop function public.capture_assignment_release_set_aside();
drop function public.capture_assigned_gl(uuid,uuid);
drop trigger erp_capture_invoice_assignments_immutable on public.erp_capture_invoice_assignments;
drop function public.guard_capture_assignment_update();
drop table public.erp_capture_invoice_assignments;

-- restored: 0872 request guard
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
  -- #1835 stage-date correction tier: exact RPC + read endpoint, active Admin only.
  stage_admin_rpcs constant text[] := array['redate_stage_entry'];
  stage_admin_tables constant text[] := array['project_stage_entries'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item',
    'attach_erp_journal_lines', 'project_erp_journal_lines', 'create_record_only_journal_purchase', 'undo_captured_purchase'];  -- 0688 (#1919)
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  -- ACTIVE-ADMIN `pmo rpc` TIER (#1326) — keep in step with scripts/pmo.mjs ADMIN_RPCS.  -- 0366
  admin_cli_rpcs constant text[] := array['recategorise_budget_lines'];  -- 0366
  -- OPERATOR READ TIER (`pmo get/documents/m365`, #1270) — keep in step with scripts/pmo.mjs.  -- 0367
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps',  -- 0367
    'contract_rate_lines', 'contract_rate_assignees'];  -- 0518
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
  -- EQUIPMENT TIER (`pmo equipment`, #1519): costing preview/save/end for active Admin/Finance; costing and allocation
  -- reads for the amounts audience; usage totals for any active member. Same role sets as the RPCs' own checks.  -- 0497
  equipment_write_rpcs constant text[] := array['preview_equipment_costing', 'save_equipment_costing', 'end_equipment_costing'];  -- 0497
  equipment_read_rpcs constant text[] := array['list_equipment_costing', 'list_equipment_allocations'];  -- 0497
  equipment_usage_rpcs constant text[] := array['list_equipment_usage_totals'];  -- 0497
  -- TIME-AND-MATERIALS TIER (`pmo tm`, #1514): the rate and sign-off writers for active Admin/Finance; the claim list and
  -- preview for the amounts audience. Same role sets as the RPCs' own checks. The rate card itself is a table read, so
  -- `contract_rate_lines` and `contract_rate_assignees` join the operator read tier below; RLS stays the tenancy rule.  -- 0518
  tm_write_rpcs constant text[] := array['save_contract_rate_line', 'end_contract_rate_line', 'set_contract_rate_assignee', 'end_contract_rate_assignee', 'assemble_tm_claim', 'deselect_tm_source', 'prepare_tm_signoff', 'withdraw_tm_signoff', 'confirm_tm_signoff'];  -- 0518
  tm_read_rpcs constant text[] := array['list_tm_claims', 'preview_tm_claim', 'list_tm_claim_source_details'];  -- 0588
  -- NATIVE RECEIPT TIER (`pmo purchases receive` on a PMO-owned org, #1866): same role set as the RPC's own check.  -- 0702
  native_receipt_rpcs constant text[] := array['create_procurement_receipt'];  -- 0702
  -- ACTIVE-ADMIN CAPTURE-READ TIER (`pmo purchases capture`, #2276) — keep in step with supabase/functions/purchase-capture.  -- 0872
  capture_read_rpcs constant text[] := array['purchase_capture_source_page', 'purchase_capture_ledger_page', 'purchase_capture_feed_health'];  -- 0872
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
    if method = 'POST' and target = any (stage_admin_rpcs) then  -- 0585
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
    if method = 'POST' and target = any (equipment_write_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_read_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_usage_rpcs) then  -- 0497
      if coalesce(public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (tm_write_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (tm_read_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (native_receipt_rpcs) then  -- 0702
      if coalesce(public.auth_role()::text in ('Admin', 'Project Manager') and public.is_active_member(), false) then  -- 0702
        return;  -- 0702
      end if;  -- 0702
    end if;  -- 0702
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (capture_read_rpcs) then  -- 0872
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0872
        return;  -- 0872
      end if;  -- 0872
    end if;  -- 0872
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
    if method = 'GET' and target = any (stage_admin_tables) then  -- 0585
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
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
